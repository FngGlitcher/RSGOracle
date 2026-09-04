const { request } = require('./http');
const { joaat, joaatSigned } = require('./joaat');

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

    const hash = parts[0];
    const name = parts.slice(1).join(' ').trim();

    if (!name) {
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

    if (!name || !hash) {
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

  /*
   * Keep the same general dictionary structure:
   *
   * - tunables: known tunable names
   * - other: GTA hash database + labels
   * - jobs: job dictionary
   */
  const other = {
    ...gta
  };

  for (const [name, value] of Object.entries(labels)) {
    other[name] = joaatSigned(value);
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
   * The old implementation rebuilt these indexes for every target.
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
      contexts.add(`${parts[0]}_${parts[1]}`);
    }

    if (parts.length >= 3) {
      contexts.add(`${parts[0]}_${parts[1]}_${parts[2]}`);
    }

    contexts.add('GLOBAL');

    for (const context of contexts) {
      if (!tunableByContext.has(context)) {
        tunableByContext.set(context, new Map());
      }

      tunableByContext
        .get(context)
        .set(hashString, upperName);
    }
  }

  /*
   * CRITICAL OPTIMIZATION
   *
   * The previous resolver did:
   *
   *   for every numeric value
   *     scan all ~678,000 dictionary.other entries
   *
   * That made the workflow effectively hang.
   *
   * We create a reverse index once:
   *
   *   hash -> name
   *
   * Resolution is therefore O(1) instead of O(678,000).
   *
   * Keep the FIRST matching entry to preserve the behavior of
   * Object.entries(dictionary.other).find(...).
   */
  const otherByValue = new Map();

  for (const [key, hash] of Object.entries(dictionary.other)) {
    const hashString = String(hash);

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

  /*
   * Per-resolve cache.
   */
  const cache = new Map();

  function resolveValue(value) {
    if (typeof value !== 'number') {
      return value;
    }

    /*
     * O(1) lookup instead of scanning 678k entries.
     */
    return otherByValue.get(String(value)) ?? value;
  }

  function lookup(hash, context) {
    const hashString = String(hash);

    /*
     * Try the current context first.
     */
    if (context) {
      const contextMap = tunableByContext.get(context);

      if (contextMap) {
        const name = contextMap.get(hashString);

        if (name) {
          return name;
        }
      }
    }

    /*
     * Try all known contexts.
     */
    for (const contextMap of tunableByContext.values()) {
      const name = contextMap.get(hashString);

      if (name) {
        return name;
      }
    }

    /*
     * Try the generic reverse dictionary.
     */
    const otherName = otherByValue.get(hashString);

    if (otherName) {
      return otherName;
    }

    /*
     * Job-specific lookup.
     */
    if (platform && platform.toLowerCase().includes('pc')) {
      const jobsName = dictionary.jobs[hashString];

      if (jobsName) {
        return String(jobsName).toUpperCase();
      }
    }

    return null;
  }

  function resolveObject(value, context, depth = 0) {
    if (depth > 50) {
      return value;
    }

    if (typeof value === 'number') {
      return resolveValue(value);
    }

    if (Array.isArray(value)) {
      return value.map(item =>
        resolveObject(item, context, depth + 1)
      );
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const result = {};

    for (const [key, item] of Object.entries(value)) {
      let nextContext = context;

      if (
        typeof item === 'string' &&
        item.length > 0
      ) {
        const upperKey = key.toUpperCase();

        if (
          upperKey.includes('CONTEXT') ||
          upperKey.includes('TUNABLE')
        ) {
          nextContext = item.toUpperCase();
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

    const entries = Object.entries(tunables);
    const total = entries.length;

    console.log(
      `[RESOLVER] Starting value resolution: ${total} entries`
    );

    /*
     * Do not keep context from a previous call.
     */
    let previousContext = null;

    for (const [key, value] of entries) {
      const upperKey = String(key).toUpperCase();

      /*
       * Determine a useful context from the key.
       */
      const parts = upperKey.split('_');

      if (parts.length >= 2) {
        previousContext = `${parts[0]}_${parts[1]}`;
      } else if (parts.length === 1) {
        previousContext = parts[0];
      }

      const cacheKey = `${previousContext || ''}:${upperKey}`;

      if (cache.has(cacheKey)) {
        result[key] = cache.get(cacheKey);
        processed++;
        continue;
      }

      let resolvedKey = lookup(
        joaatSigned(upperKey),
        previousContext
      );

      if (!resolvedKey) {
        resolvedKey = lookup(
          joaat(upperKey),
          previousContext
        );
      }

      if (resolvedKey) {
        resolved++;
        cache.set(cacheKey, resolvedKey);
        result[resolvedKey] = resolveObject(
          value,
          previousContext
        );
      } else {
        cache.set(cacheKey, upperKey);
        result[upperKey] = resolveObject(
          value,
          previousContext
        );
      }

      processed++;

      if (
        processed % 5000 === 0 ||
        processed === total
      ) {
        console.log(
          `[RESOLVER] Progress: ${processed}/${total} ` +
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

async function getResolver(config, platform) {
  /*
   * Download/build the dictionary only ONCE per Node process.
   *
   * All 10 targets share the same dictionary.
   */
  if (!dictionaryPromise) {
    dictionaryPromise = buildDictionary(config).catch(error => {
      dictionaryPromise = null;
      throw error;
    });
  }

  const dictionary = await dictionaryPromise;

  /*
   * Build the expensive indexes only ONCE.
   */
  if (!indexesPromise) {
    indexesPromise = Promise.resolve(
      buildIndexes(dictionary)
    ).catch(error => {
      indexesPromise = null;
      throw error;
    });
  }

  const indexes = await indexesPromise;

  return makeResolver(
    dictionary,
    indexes,
    platform
  );
}

module.exports = {
  getResolver
};
