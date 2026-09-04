const joaat = require('./joaat');
const { request } = require('./http');

let dictionaryPromise = null;
let indexesPromise = null;

async function text(url) {
  const response = await request(url, {
    method: 'GET',
    timeout: 15000,
    retries: 1
  });

  if (!response.ok) {
    throw new Error(
      `Dictionary request failed: ${response.status} ${response.statusText || ''} ${url}`
    );
  }

  return response.text();
}

async function downloadDictionary(name, url) {
  console.log(
    `[RESOLVER] Downloading dictionary: ${url}`
  );

  const value = await text(url);

  console.log(
    `[RESOLVER] Dictionary downloaded: ${url} (${value.length} chars)`
  );

  return {
    name,
    value
  };
}

function parseTunableNames(textValue) {
  const tunables = {};

  for (const rawLine of textValue.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const parts = line.split(/\s+/);

    if (parts.length < 2) {
      continue;
    }

    const hash = parts[0].trim();
    const name = parts.slice(1).join(' ').trim();

    if (!hash || !name) {
      continue;
    }

    tunables[name] = hash;
  }

  return tunables;
}

function parseGtaDictionary(textValue) {
  const other = {};

  for (const rawLine of textValue.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const parts = line.split(/\t+/);

    if (parts.length < 2) {
      continue;
    }

    const hash = parts[0].trim();
    const name = parts.slice(1).join('\t').trim();

    if (!hash || !name) {
      continue;
    }

    other[name] = hash;
  }

  return other;
}

function parseLabels(textValue) {
  const labels = {};

  for (const rawLine of textValue.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const parts = line.split(/\s+/);

    if (parts.length < 2) {
      continue;
    }

    const name = parts[0].trim();
    const value = parts.slice(1).join(' ').trim();

    if (!name || !value) {
      continue;
    }

    labels[name] = value;
  }

  return labels;
}

function parseJobs(textValue) {
  const parsed = JSON.parse(textValue);

  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  return parsed;
}

async function buildDictionary(config) {
  const resolverConfig = config.resolver || {};

  const sources = {
    names: resolverConfig.tunable_names_url,
    gta: resolverConfig.gta_dictionary_url,
    labels: resolverConfig.gta_labels_url,
    jobs: resolverConfig.jobs_dictionary_url
  };

  console.log('[RESOLVER] Dictionary sources:', sources);

  const downloads = await Promise.all([
    downloadDictionary('names', sources.names),
    downloadDictionary('gta', sources.gta),
    downloadDictionary('labels', sources.labels),
    downloadDictionary('jobs', sources.jobs)
  ]);

  const raw = {};

  for (const item of downloads) {
    raw[item.name] = item.value;
  }

  console.log('[RESOLVER] Building contexts...');

  const tunables = parseTunableNames(raw.names);
  const gta = parseGtaDictionary(raw.gta);
  const labels = parseLabels(raw.labels);
  const jobs = parseJobs(raw.jobs);

  const other = {
    ...gta
  };

  /*
   * TextKeys.txt contains labels that must be converted to
   * their signed JOAAT hash.
   *
   * joaat() returns:
   * {
   *   unsigned,
   *   signed,
   *   hex
   * }
   */
  for (const [name, value] of Object.entries(labels)) {
    other[name] = joaat(value).signed;
  }

  const dictionary = {
    tunables,
    other,
    jobs
  };

  console.log(
    `[RESOLVER] Dictionary ready. ` +
    `Tunables: ${Object.keys(dictionary.tunables).length}, ` +
    `other: ${Object.keys(dictionary.other).length}, ` +
    `jobs: ${Object.keys(dictionary.jobs).length}`
  );

  return dictionary;
}

function buildIndexes(dictionary) {
  console.log('[RESOLVER] Building resolver indexes...');

  const tunableByContext = new Map();

  /*
   * Build the tunable lookup indexes once.
   *
   * Each tunable is indexed under several possible contexts.
   */
  for (const [name, hash] of Object.entries(dictionary.tunables)) {
    const upperName = String(name).toUpperCase();
    const hashString = String(hash);

    const parts = upperName.split('_');
    const contexts = new Set();

    if (parts.length >= 1) {
      contexts.add(parts[0]);
    }

    if (parts.length >= 2) {
      contexts.add(
        `${parts[0]}_${parts[1]}`
      );
    }

    if (parts.length >= 3) {
      contexts.add(
        `${parts[0]}_${parts[1]}_${parts[2]}`
      );
    }

    contexts.add('GLOBAL');

    for (const context of contexts) {
      if (!tunableByContext.has(context)) {
        tunableByContext.set(
          context,
          new Map()
        );
      }

      tunableByContext
        .get(context)
        .set(hashString, upperName);
    }
  }

  /*
   * CRITICAL PERFORMANCE FIX
   *
   * Before:
   *
   *   for every numeric value:
   *     scan all ~678,000 entries
   *
   * That is effectively O(values * 678000).
   *
   * Now:
   *
   *   hash -> name
   *
   * giving an O(1) lookup.
   */
  const otherByValue = new Map();

  for (const [key, hash] of Object.entries(dictionary.other)) {
    const hashString = String(hash);

    /*
     * Preserve the first matching entry, just like the old
     * Object.entries(...).find(...) behavior.
     */
    if (!otherByValue.has(hashString)) {
      otherByValue.set(
        hashString,
        String(key).toUpperCase()
      );
    }
  }

  console.log(
    `[RESOLVER] Resolver indexes ready. ` +
    `Contexts: ${tunableByContext.size}, ` +
    `Reverse hash index: ${otherByValue.size}`
  );

  return {
    tunableByContext,
    otherByValue
  };
}

function makeResolver(dictionary, indexes, platform) {
  const {
    tunableByContext,
    otherByValue
  } = indexes;

  const cache = new Map();

  function resolveValue(value) {
    if (typeof value !== 'number') {
      return value;
    }

    /*
     * O(1) lookup.
     */
    return (
      otherByValue.get(String(value)) ??
      value
    );
  }

  function lookup(hash, context) {
    const hashString = String(hash);

    /*
     * 1. Current context.
     */
    if (context) {
      const contextMap =
        tunableByContext.get(context);

      if (contextMap) {
        const name =
          contextMap.get(hashString);

        if (name) {
          return name;
        }
      }
    }

    /*
     * 2. All contexts.
     */
    for (const contextMap of tunableByContext.values()) {
      const name =
        contextMap.get(hashString);

      if (name) {
        return name;
      }
    }

    /*
     * 3. Generic GTA dictionary.
     */
    const otherName =
      otherByValue.get(hashString);

    if (otherName) {
      return otherName;
    }

    /*
     * 4. Jobs dictionary.
     */
    if (
      platform &&
      platform.toLowerCase().includes('pc')
    ) {
      const jobsName =
        dictionary.jobs[hashString];

      if (jobsName) {
        return String(jobsName).toUpperCase();
      }
    }

    return null;
  }

  function resolveObject(
    value,
    context,
    depth = 0
  ) {
    if (depth > 50) {
      return value;
    }

    if (typeof value === 'number') {
      return resolveValue(value);
    }

    if (Array.isArray(value)) {
      return value.map(item =>
        resolveObject(
          item,
          context,
          depth + 1
        )
      );
    }

    if (
      !value ||
      typeof value !== 'object'
    ) {
      return value;
    }

    const result = {};

    for (const [key, item] of Object.entries(value)) {
      let nextContext = context;

      if (
        typeof item === 'string' &&
        item.length > 0
      ) {
        const upperKey =
          key.toUpperCase();

        if (
          upperKey.includes('CONTEXT') ||
          upperKey.includes('TUNABLE')
        ) {
          nextContext =
            item.toUpperCase();
        }
      }

      result[key] = resolveObject(
        item,
        nextContext,
        depth + 1
      );
    }

    return result;
  }

  function resolve(tunables) {
    const result = {};

    let processed = 0;
    let resolved = 0;

    const entries =
      Object.entries(tunables);

    const total = entries.length;

    console.log(
      `[RESOLVER] Starting value resolution: ${total} entries`
    );

    let previousContext = null;

    for (const [key, value] of entries) {
      const upperKey =
        String(key).toUpperCase();

      const parts =
        upperKey.split('_');

      if (parts.length >= 2) {
        previousContext =
          `${parts[0]}_${parts[1]}`;
      } else if (parts.length === 1) {
        previousContext =
          parts[0];
      }

      const cacheKey =
        `${previousContext || ''}:${upperKey}`;

      if (cache.has(cacheKey)) {
        result[key] =
          cache.get(cacheKey);

        processed++;
        continue;
      }

      /*
       * Try signed JOAAT first.
       */
      let resolvedKey =
        lookup(
          joaat(upperKey).signed,
          previousContext
        );

      /*
       * Then unsigned JOAAT.
       */
      if (!resolvedKey) {
        resolvedKey =
          lookup(
            joaat(upperKey).unsigned,
            previousContext
          );
      }

      if (resolvedKey) {
        resolved++;

        cache.set(
          cacheKey,
          resolvedKey
        );

        result[resolvedKey] =
          resolveObject(
            value,
            previousContext
          );
      } else {
        cache.set(
          cacheKey,
          upperKey
        );

        result[upperKey] =
          resolveObject(
            value,
            previousContext
          );
      }

      processed++;

      /*
       * Progress every 5,000 entries.
       */
      if (
        processed % 5000 === 0 ||
        processed === total
      ) {
        console.log(
          `[RESOLVER] Progress: ` +
          `${processed}/${total} ` +
          `(${resolved} resolved)`
        );
      }
    }

    console.log(
      `[RESOLVER] Resolution complete: ` +
      `${processed} entries processed, ` +
      `${resolved} resolved`
    );

    return result;
  }

  return {
    resolve,
    lookup,
    resolveValue
  };
}

async function getResolver(
  config,
  platform
) {
  /*
   * Download dictionaries only once per Node process.
   */
  if (!dictionaryPromise) {
    dictionaryPromise =
      buildDictionary(config)
        .catch(error => {
          dictionaryPromise = null;
          throw error;
        });
  }

  const dictionary =
    await dictionaryPromise;

  /*
   * Build resolver indexes only once.
   */
  if (!indexesPromise) {
    indexesPromise =
      Promise.resolve(
        buildIndexes(dictionary)
      ).catch(error => {
        indexesPromise = null;
        throw error;
      });
  }

  const indexes =
    await indexesPromise;

  return makeResolver(
    dictionary,
    indexes,
    platform
  );
}

module.exports = {
  getResolver
};
