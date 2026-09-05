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

    tunables[line] = joaat(line).signed;
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

function normalizeHash(hash) {
  if (
    typeof hash === 'number' &&
    Number.isInteger(hash)
  ) {
    return hash | 0;
  }

  let value = String(hash).trim();

  if (!value) {
    return null;
  }

  const isHex =
    /^_?0x[0-9a-f]+$/i.test(value);

  if (isHex) {
    value = value.replace(/^_?0x/i, '');

    const unsigned =
      parseInt(value, 16) >>> 0;

    return unsigned | 0;
  }

  if (/^-?\d+$/.test(value)) {
    const number = Number(value);

    if (Number.isSafeInteger(number)) {
      return number | 0;
    }
  }

  return null;
}

function hashAliases(hash) {
  const normalized =
    normalizeHash(hash);

  if (normalized === null) {
    return [];
  }

  const unsigned =
    normalized >>> 0;

  const signed =
    normalized | 0;

  const hex =
    `0x${unsigned
      .toString(16)
      .toUpperCase()
      .padStart(8, '0')}`;

  const shortHex =
    `0x${unsigned
      .toString(16)
      .toUpperCase()}`;

  return [
    String(signed),
    String(unsigned),
    hex,
    shortHex
  ];
}

function addHashAliases(map, hash, value) {
  const aliases =
    hashAliases(hash);

  for (const alias of aliases) {
    if (!map.has(alias)) {
      map.set(alias, value);
    }
  }
}

async function buildDictionary(config) {
  const resolverConfig =
    config.resolver || {};

  const sources = {
    names:
      resolverConfig.tunable_names_url,
    gta:
      resolverConfig.gta_dictionary_url,
    labels:
      resolverConfig.gta_labels_url,
    jobs:
      resolverConfig.jobs_dictionary_url
  };

  console.log(
    '[RESOLVER] Dictionary sources:',
    sources
  );

  const downloads =
    await Promise.all([
      downloadDictionary(
        'names',
        sources.names
      ),
      downloadDictionary(
        'gta',
        sources.gta
      ),
      downloadDictionary(
        'labels',
        sources.labels
      ),
      downloadDictionary(
        'jobs',
        sources.jobs
      )
    ]);

  const raw = {};

  for (const item of downloads) {
    raw[item.name] =
      item.value;
  }

  console.log(
    '[RESOLVER] Building contexts...'
  );

  const tunables =
    parseTunableNames(
      raw.names
    );

  const gta =
    parseGtaDictionary(
      raw.gta
    );

  const labels =
    parseLabels(
      raw.labels
    );

  const jobs =
    parseJobs(
      raw.jobs
    );

  const other = {
    ...gta
  };

  for (
    const [name, value]
    of Object.entries(labels)
  ) {
    other[name] =
      joaat(value).signed;
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
  console.log(
    '[RESOLVER] Building resolver indexes...'
  );

  const tunableByContext =
    new Map();

  const tunableByHash =
    new Map();

  for (
    const [name, hash]
    of Object.entries(
      dictionary.tunables
    )
  ) {
    const upperName =
      String(name).toUpperCase();

    const parts =
      upperName.split('_');

    const contexts =
      new Set();

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

    addHashAliases(
      tunableByHash,
      hash,
      upperName
    );

    for (
      const context
      of contexts
    ) {
      if (
        !tunableByContext.has(
          context
        )
      ) {
        tunableByContext.set(
          context,
          new Map()
        );
      }

      addHashAliases(
        tunableByContext.get(
          context
        ),
        hash,
        upperName
      );
    }
  }

  const otherByValue =
    new Map();

  for (
    const [key, hash]
    of Object.entries(
      dictionary.other
    )
  ) {
    addHashAliases(
      otherByValue,
      hash,
      String(key).toUpperCase()
    );
  }

  console.log(
    `[RESOLVER] Resolver indexes ready. ` +
    `Contexts: ${tunableByContext.size}, ` +
    `Reverse hash index: ${tunableByHash.size}`
  );

  return {
    tunableByContext,
    tunableByHash,
    otherByValue
  };
}

function makeResolver(
  dictionary,
  indexes,
  platform
) {
  const {
    tunableByContext,
    tunableByHash,
    otherByValue
  } = indexes;

  const cache =
    new Map();

  function resolveValue(value) {
    if (
      typeof value !== 'number'
    ) {
      return value;
    }

    const aliases =
      hashAliases(value);

    for (
      const alias
      of aliases
    ) {
      const name =
        otherByValue.get(alias);

      if (name) {
        return name;
      }
    }

    return value;
  }

  function lookup(
    hash,
    context
  ) {
    const aliases =
      hashAliases(hash);

    if (!aliases.length) {
      return null;
    }

    if (context) {
      const contextMap =
        tunableByContext.get(
          context
        );

      if (contextMap) {
        for (
          const alias
          of aliases
        ) {
          const name =
            contextMap.get(alias);

          if (name) {
            return name;
          }
        }
      }
    }

    for (
      const alias
      of aliases
    ) {
      const name =
        tunableByHash.get(alias);

      if (name) {
        return name;
      }
    }

    for (
      const alias
      of aliases
    ) {
      const otherName =
        otherByValue.get(alias);

      if (otherName) {
        return otherName;
      }
    }

    if (
      platform &&
      platform
        .toLowerCase()
        .includes('pc')
    ) {
      for (
        const alias
        of aliases
      ) {
        const jobsName =
          dictionary.jobs[alias];

        if (jobsName) {
          return String(
            jobsName
          ).toUpperCase();
        }
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

    if (
      typeof value === 'number'
    ) {
      return resolveValue(value);
    }

    if (Array.isArray(value)) {
      return value.map(
        item =>
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

    for (
      const [key, item]
      of Object.entries(value)
    ) {
      let nextContext =
        context;

      if (
        typeof item === 'string' &&
        item.length > 0
      ) {
        const upperKey =
          key.toUpperCase();

        if (
          upperKey.includes(
            'CONTEXT'
          ) ||
          upperKey.includes(
            'TUNABLE'
          )
        ) {
          nextContext =
            item.toUpperCase();
        }
      }

      result[key] =
        resolveObject(
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

    const total =
      entries.length;

    console.log(
      `[RESOLVER] Starting value resolution: ${total} entries`
    );

    let previousContext =
      null;

    for (
      const [key, value]
      of entries
    ) {
      const rawKey =
        String(key).trim();

      const upperKey =
        rawKey.toUpperCase();

      let resolvedKey =
        null;

      const isHexHash =
        /^_?0x[0-9A-F]+$/i.test(
          rawKey
        );

      if (isHexHash) {
        resolvedKey =
          lookup(
            rawKey,
            previousContext
          );
      } else {
        const parts =
          upperKey.split('_');

        if (parts.length >= 2) {
          previousContext =
            `${parts[0]}_${parts[1]}`;
        } else if (
          parts.length === 1
        ) {
          previousContext =
            parts[0];
        }

        const calculated =
          joaat(upperKey);

        resolvedKey =
          lookup(
            calculated.signed,
            previousContext
          );

        if (!resolvedKey) {
          resolvedKey =
            lookup(
              calculated.unsigned,
              previousContext
            );
        }
      }

      const cacheKey =
        `${previousContext || ''}:${upperKey}`;

      if (
        cache.has(cacheKey)
      ) {
        const cached =
          cache.get(cacheKey);

        result[cached.key] =
          resolveObject(
            value,
            previousContext
          );

        processed++;

        continue;
      }

      if (resolvedKey) {
        resolved++;

        cache.set(
          cacheKey,
          {
            key: resolvedKey
          }
        );

        result[resolvedKey] =
          resolveObject(
            value,
            previousContext
          );
      } else {
        cache.set(
          cacheKey,
          {
            key: upperKey
          }
        );

        result[upperKey] =
          resolveObject(
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
  if (!dictionaryPromise) {
    dictionaryPromise =
      buildDictionary(config)
        .catch(error => {
          dictionaryPromise =
            null;
          throw error;
        });
  }

  const dictionary =
    await dictionaryPromise;

  if (!indexesPromise) {
    indexesPromise =
      Promise.resolve(
        buildIndexes(dictionary)
      ).catch(error => {
        indexesPromise =
          null;
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
