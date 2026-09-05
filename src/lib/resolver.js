const fs = require('fs');
const path = require('path');

const joaat = require('./joaat');

const DICTIONARY_PATH = path.resolve(
  __dirname,
  '../../data/dictionaries/dictionary.json'
);

const OVERRIDES_PATH = path.resolve(
  __dirname,
  '../../config/tunable_overrides.json'
);

let dictionaryPromise = null;

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const content = fs.readFileSync(
      filePath,
      'utf8'
    );

    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to load JSON file ${filePath}: ${error.message}`
    );
  }
}

function normalizeHash(hash) {
  if (
    typeof hash === 'number' &&
    Number.isInteger(hash)
  ) {
    return hash | 0;
  }

  let value = String(hash || '').trim();

  if (!value) {
    return null;
  }

  value = value.replace(
    /^_?0x/i,
    ''
  );

  if (!/^[0-9a-f]+$/i.test(value)) {
    if (/^-?\d+$/.test(value)) {
      const number = Number(value);

      if (Number.isSafeInteger(number)) {
        return number | 0;
      }
    }

    return null;
  }

  return parseInt(value, 16) | 0;
}

function hashAliases(hash) {
  const normalized = normalizeHash(hash);

  if (normalized === null) {
    return [];
  }

  const unsigned = normalized >>> 0;
  const signed = normalized | 0;

  const hex = unsigned
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');

  return [
    String(signed),
    String(unsigned),
    hex,
    `0x${hex}`,
    `_0x${hex}`
  ];
}

function canonicalHex(hash) {
  const normalized = normalizeHash(hash);

  if (normalized === null) {
    return null;
  }

  return (
    '0x' +
    (normalized >>> 0)
      .toString(16)
      .toUpperCase()
      .padStart(8, '0')
  );
}

function addIndex(index, hash, value) {
  for (const alias of hashAliases(hash)) {
    if (!index.has(alias)) {
      index.set(alias, value);
    }
  }
}

function buildOtherIndex(other) {
  const index = new Map();

  for (
    const [name, hash]
    of Object.entries(other || {})
  ) {
    addIndex(
      index,
      hash,
      String(name).toUpperCase()
    );
  }

  return index;
}

function buildJobsIndex(jobs) {
  const index = new Map();

  for (
    const [hash, name]
    of Object.entries(jobs || {})
  ) {
    addIndex(
      index,
      hash,
      String(name).toUpperCase()
    );
  }

  return index;
}

function buildTunableIndex(tunables) {
  const index = new Map();

  for (
    const [name, entry]
    of Object.entries(tunables || {})
  ) {
    const upperName =
      String(name).toUpperCase();

    if (
      entry &&
      typeof entry === 'object'
    ) {
      if (entry.hash !== undefined) {
        addIndex(
          index,
          entry.hash,
          upperName
        );
      }

      if (
        entry.sum &&
        typeof entry.sum === 'object'
      ) {
        for (
          const [context, hash]
          of Object.entries(entry.sum)
        ) {
          addIndex(
            index,
            hash,
            {
              name: upperName,
              context
            }
          );
        }
      }
    } else {
      addIndex(
        index,
        entry,
        upperName
      );
    }
  }

  return index;
}

function buildContextIndex(contexts) {
  const index = new Map();

  for (
    const [context, hash]
    of Object.entries(contexts || {})
  ) {
    index.set(
      String(context).toUpperCase(),
      {
        signed:
          normalizeHash(hash),
        hash
      }
    );
  }

  return index;
}

async function buildDictionary() {
  console.log(
    '[RESOLVER] Loading local dictionary...'
  );

  const dictionary = loadJson(
    DICTIONARY_PATH,
    null
  );

  if (!dictionary) {
    throw new Error(
      `Local resolver dictionary not found: ${DICTIONARY_PATH}`
    );
  }

  const overrides = loadJson(
    OVERRIDES_PATH,
    {}
  );

  const tunables =
    dictionary.tunables || {};

  const contexts =
    dictionary.contexts || {};

  const other =
    dictionary.other || {};

  const jobs =
    dictionary.jobs || {};

  const indexes = {
    tunables:
      buildTunableIndex(tunables),

    contexts:
      buildContextIndex(contexts),

    other:
      buildOtherIndex(other),

    jobs:
      buildJobsIndex(jobs),

    overrides:
      new Map()
  };

  for (
    const [hash, name]
    of Object.entries(overrides)
  ) {
    if (
      typeof name !== 'string' ||
      !name.trim()
    ) {
      continue;
    }

    indexes.overrides.set(
      canonicalHex(hash),
      name.trim().toUpperCase()
    );
  }

  console.log(
    `[RESOLVER] Local dictionary ready. ` +
    `Tunables: ${Object.keys(tunables).length}, ` +
    `Contexts: ${Object.keys(contexts).length}, ` +
    `Other: ${Object.keys(other).length}, ` +
    `Jobs: ${Object.keys(jobs).length}, ` +
    `Overrides: ${indexes.overrides.size}`
  );

  return {
    dictionary,
    indexes
  };
}

function lookupOverride(
  hash,
  overrides
) {
  const key =
    canonicalHex(hash);

  if (!key) {
    return null;
  }

  return (
    overrides.get(key) ||
    null
  );
}

function lookupDirect(
  hash,
  index
) {
  for (
    const alias
    of hashAliases(hash)
  ) {
    const result =
      index.get(alias);

    if (result) {
      return result;
    }
  }

  return null;
}

function resolveNumber(
  value,
  indexes
) {
  if (
    typeof value !== 'number'
  ) {
    return value;
  }

  const override =
    lookupOverride(
      value,
      indexes.overrides
    );

  if (override) {
    return override;
  }

  const other =
    lookupDirect(
      value,
      indexes.other
    );

  if (other) {
    return other;
  }

  const job =
    lookupDirect(
      value,
      indexes.jobs
    );

  if (job) {
    return job;
  }

  return value;
}

function resolveValue(
  value,
  context,
  indexes
) {
  if (
    typeof value === 'number'
  ) {
    return resolveNumber(
      value,
      indexes
    );
  }

  if (
    typeof value === 'string'
  ) {
    const override =
      lookupOverride(
        value,
        indexes.overrides
      );

    if (override) {
      return override;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      item =>
        resolveValue(
          item,
          context,
          indexes
        )
    );
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    const result = {};

    for (
      const [key, item]
      of Object.entries(value)
    ) {
      result[key] =
        resolveValue(
          item,
          context,
          indexes
        );
    }

    return result;
  }

  return value;
}

function resolveHash(
  hash,
  previousContext,
  indexes
) {
  const override =
    lookupOverride(
      hash,
      indexes.overrides
    );

  if (override) {
    return {
      name: override,
      context:
        previousContext || null,
      source: 'override'
    };
  }

  if (previousContext) {
    const context =
      String(previousContext)
        .toUpperCase();

    for (
      const alias
      of hashAliases(hash)
    ) {
      const entry =
        indexes.tunables.get(alias);

      if (
        entry &&
        typeof entry === 'object' &&
        entry.name &&
        String(entry.context)
          .toUpperCase() === context
      ) {
        return {
          name: entry.name,
          context,
          source: 'context'
        };
      }
    }
  }

  const direct =
    lookupDirect(
      hash,
      indexes.tunables
    );

  if (
    direct &&
    typeof direct === 'string'
  ) {
    return {
      name: direct,
      context:
        previousContext || null,
      source: 'direct'
    };
  }

  return null;
}

function extractContextFromName(
  key
) {
  const upper =
    String(key)
      .toUpperCase();

  const knownPrefixes = [
    'BASE_GLOBALS',
    'CD_GLOBAL',
    'MP_GLOBAL',
    'MP_FM_MEMBERSHIP',
    'MP_CNC_TEAM_COP',
    'MP_CNC_TEAM_VAGOS',
    'MP_CNC_TEAM_LOST',
    'MP_FM_DM',
    'MP_FM_RACES',
    'MP_FM_MISSIONS',
    'MP_FM_SURVIVAL',
    'MP_FM_BASEJUMP',
    'MP_FM_CAPTURE',
    'MP_FM_LTS',
    'MP_FM_HEIST',
    'MP_FM_CONTACT',
    'MP_FM_RANDOM',
    'MP_FM_VERSUS',
    'MP_FM_GANG_ATTACK',
    'MP_FMADVERSARY',
    'MP_FM'
  ];

  for (
    const prefix
    of knownPrefixes
  ) {
    if (
      upper === prefix ||
      upper.startsWith(
        `${prefix}_`
      )
    ) {
      return prefix;
    }
  }

  return null;
}

function resolve(
  tunables,
  platform,
  indexes
) {
  const result = {};

  const entries =
    Object.entries(
      tunables || {}
    );

  let processed = 0;
  let resolved = 0;

  let previousContext = null;

  console.log(
    `[RESOLVER] Starting value resolution: ${entries.length} entries`
  );

  for (
    const [key, value]
    of entries
  ) {
    const rawKey =
      String(key)
        .trim();

    const isHash =
      /^_?0x[0-9a-f]+$/i.test(
        rawKey
      );

    if (!isHash) {
      const context =
        extractContextFromName(
          rawKey
        );

      if (context) {
        previousContext =
          context;
      }

      result[rawKey] =
        resolveValue(
          value,
          previousContext,
          indexes
        );

      processed++;
      continue;
    }

    const match =
      resolveHash(
        rawKey,
        previousContext,
        indexes
      );

    if (match) {
      result[match.name] =
        resolveValue(
          value,
          match.context,
          indexes
        );

      resolved++;

      if (match.context) {
        previousContext =
          match.context;
      }
    } else {
      result[rawKey] =
        resolveValue(
          value,
          previousContext,
          indexes
        );
    }

    processed++;

    if (
      processed % 5000 === 0 ||
      processed === entries.length
    ) {
      console.log(
        `[RESOLVER] Progress: ` +
        `${processed}/${entries.length} ` +
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

async function getResolver(
  config,
  platform
) {
  if (!dictionaryPromise) {
    dictionaryPromise =
      buildDictionary()
        .catch(error => {
          dictionaryPromise = null;
          throw error;
        });
  }

  const {
    dictionary,
    indexes
  } =
    await dictionaryPromise;

  return {
    resolve(tunables) {
      return resolve(
        tunables,
        platform,
        indexes
      );
    },

    lookup(hash, context = null) {
      return resolveHash(
        hash,
        context,
        indexes
      );
    },

    resolveValue(value) {
      return resolveNumber(
        value,
        indexes
      );
    },

    dictionary
  };
}

module.exports = {
  getResolver
};
