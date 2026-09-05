'use strict';

const fs = require('fs');
const path = require('path');

const joaat = require('./joaat');

const ROOT_DIR = path.resolve(__dirname, '../..');

const DICTIONARY_DIR = path.join(
  ROOT_DIR,
  'data',
  'dictionaries'
);

const DICTIONARY_TUNABLES_FILE = path.join(
  DICTIONARY_DIR,
  'dictionary-tunables.json'
);

const DICTIONARY_OTHER_FILE = path.join(
  DICTIONARY_DIR,
  'dictionary-other.json'
);

const DICTIONARY_JOBS_FILE = path.join(
  DICTIONARY_DIR,
  'dictionary-jobs.json'
);

const DICTIONARY_CUSTOM_FILE = path.join(
  DICTIONARY_DIR,
  'dictionary-custom.json'
);

const OVERRIDES_FILE = path.join(
  ROOT_DIR,
  'config',
  'tunable_overrides.json'
);

const HEX_PREFIX = /^_?0x/i;

const CONTEXT_NAMES = [
  'BASE_GLOBALS',
  'BASE_GLOBALS_2',
  'BASE_GLOBALS_3',
  'BASE_GLOBALS_4',
  'BASE_GLOBALS_5',
  'BASE_GLOBALS_6',
  'BASE_GLOBALS_7',
  'BASE_GLOBALS_8',
  'BASE_GLOBALS_9',
  'BASE_GLOBALS_10',
  'BASE_GLOBALS_11',
  'BASE_GLOBALS_12',
  'BASE_GLOBALS_13',
  'BASE_GLOBALS_14',
  'BASE_GLOBALS_15',
  'BASE_GLOBALS_16',
  'BASE_GLOBALS_17',
  'BASE_GLOBALS_18',
  'BASE_GLOBALS_19',
  'BASE_GLOBALS_20',
  'BASE_GLOBALS_21',
  'BASE_GLOBALS_22',
  'BASE_GLOBALS_23',
  'BASE_GLOBALS_24',
  'BASE_GLOBALS_25',
  'BASE_GLOBALS_26',
  'BASE_GLOBALS_27',
  'BASE_GLOBALS_28',
  'BASE_GLOBALS_29',
  'BASE_GLOBALS_30',
  'MP_FM_MEMBERSHIP',
  'MP_GLOBAL',
  'MP_GLOBAL_2',
  'MP_GLOBAL_3',
  'MP_GLOBAL_4',
  'MP_GLOBAL_5',
  'MP_GLOBAL_6',
  'MP_GLOBAL_7'
];

function stripHexPrefix(value) {
  return String(value)
    .trim()
    .replace(HEX_PREFIX, '')
    .toUpperCase();
}

function normalizeHex(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === 'object'
  ) {
    if (
      Number.isInteger(value.unsigned)
    ) {
      return normalizeHex(
        value.unsigned
      );
    }

    if (
      Number.isInteger(value.signed)
    ) {
      return normalizeHex(
        value.signed
      );
    }

    if (
      value.hex !== undefined &&
      value.hex !== null
    ) {
      return normalizeHex(
        value.hex
      );
    }

    return null;
  }

  if (
    typeof value === 'number'
  ) {
    if (
      !Number.isFinite(value)
    ) {
      return null;
    }

    return (
      (value >>> 0)
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')
    );
  }

  const raw =
    String(value).trim();

  if (!raw) {
    return null;
  }

  if (
    /^[+-]?\d+$/.test(raw)
  ) {
    const decimal =
      Number(raw);

    if (
      !Number.isSafeInteger(decimal) ||
      decimal < -2147483648 ||
      decimal > 4294967295
    ) {
      return null;
    }

    return (
      (decimal >>> 0)
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')
    );
  }

  const cleaned =
    stripHexPrefix(raw);

  if (
    !/^[0-9A-F]+$/.test(cleaned)
  ) {
    return null;
  }

  return cleaned
    .padStart(8, '0')
    .slice(-8);
}

function toUnsigned(value) {
  const normalized =
    normalizeHex(value);

  if (!normalized) {
    return null;
  }

  return parseInt(
    normalized,
    16
  ) >>> 0;
}

function toSigned(value) {
  const unsigned =
    toUnsigned(value);

  if (unsigned === null) {
    return null;
  }

  return unsigned >= 0x80000000
    ? unsigned - 0x100000000
    : unsigned;
}

function hashInfo(value) {
  const unsigned =
    toUnsigned(value);

  if (unsigned === null) {
    return null;
  }

  return {
    signed:
      unsigned >= 0x80000000
        ? unsigned - 0x100000000
        : unsigned,

    unsigned,

    hex:
      unsigned
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')
  };
}

function calculateContextHash(
  tunableName,
  contextName
) {
  const tunableHash =
    joaat(tunableName);

  const contextHash =
    joaat(contextName);

  const signed =
    (
      tunableHash.signed +
      contextHash.signed
    ) | 0;

  return hashInfo(signed);
}

function reverseContextHash(
  hash,
  contextHash
) {
  const value =
    toUnsigned(hash);

  const context =
    toUnsigned(contextHash);

  if (
    value === null ||
    context === null
  ) {
    return null;
  }

  return (
    (value - context) >>> 0
  )
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
}

function loadJson(file) {
  try {
    if (
      !fs.existsSync(file)
    ) {
      return {};
    }

    return JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
      )
    );
  } catch (error) {
    throw new Error(
      `Unable to load ${file}: ${error.message}`
    );
  }
}

function loadDictionary() {
  const tunablesFileExists =
    fs.existsSync(
      DICTIONARY_TUNABLES_FILE
    );

  const otherFileExists =
    fs.existsSync(
      DICTIONARY_OTHER_FILE
    );

  const jobsFileExists =
    fs.existsSync(
      DICTIONARY_JOBS_FILE
    );

  if (
    !tunablesFileExists ||
    !otherFileExists ||
    !jobsFileExists
  ) {
    const missing = [];

    if (!tunablesFileExists) {
      missing.push(
        DICTIONARY_TUNABLES_FILE
      );
    }

    if (!otherFileExists) {
      missing.push(
        DICTIONARY_OTHER_FILE
      );
    }

    if (!jobsFileExists) {
      missing.push(
        DICTIONARY_JOBS_FILE
      );
    }

    throw new Error(
      `Local dictionary files not found: ${missing.join(', ')}. Run "node src/build-dictionary.js" first.`
    );
  }

  const tunablesData =
    loadJson(
      DICTIONARY_TUNABLES_FILE
    );

  const other =
    loadJson(
      DICTIONARY_OTHER_FILE
    );

  const jobs =
    loadJson(
      DICTIONARY_JOBS_FILE
    );

  const custom =
    loadJson(
      DICTIONARY_CUSTOM_FILE
    );

  return {
    contexts:
      tunablesData.contexts || {},

    tunables:
      tunablesData.tunables || {},

    tunableIndex:
      tunablesData.tunableIndex || {},

    other,

    jobs,

    custom
  };
}

function loadOverrides() {
  if (
    !fs.existsSync(
      OVERRIDES_FILE
    )
  ) {
    return {};
  }

  return loadJson(
    OVERRIDES_FILE
  );
}

function normalizeOverrides(
  overrides
) {
  const output = {};

  for (
    const [
      key,
      value
    ] of Object.entries(
      overrides || {}
    )
  ) {
    const normalized =
      normalizeHex(key);

    if (!normalized) {
      continue;
    }

    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      output[normalized] =
        value.trim();
    }
  }

  return output;
}

function buildContextIndex(
  dictionary
) {
  const index = {};

  for (
    const [
      context,
      value
    ] of Object.entries(
      dictionary.contexts || {}
    )
  ) {
    const hash =
      toUnsigned(value);

    if (
      hash === null
    ) {
      continue;
    }

    index[hash] =
      context;
  }

  return index;
}

function getContextHash(
  dictionary,
  context
) {
  if (
    !dictionary ||
    !dictionary.contexts
  ) {
    return null;
  }

  return toUnsigned(
    dictionary.contexts[
      context
    ]
  );
}

function buildTunableIndex(
  dictionary
) {
  const index = {};

  for (
    const [
      name,
      entry
    ] of Object.entries(
      dictionary.tunables || {}
    )
  ) {
    if (
      !entry ||
      typeof entry !== 'object'
    ) {
      continue;
    }

    const sums =
      entry.sum || {};

    for (
      const [
        context,
        hash
      ] of Object.entries(
        sums
      )
    ) {
      const normalized =
        normalizeHex(hash);

      if (!normalized) {
        continue;
      }

      if (
        !index[normalized]
      ) {
        index[normalized] = [];
      }

      index[normalized].push({
        name,
        context
      });
    }
  }

  return index;
}

function buildBaseTunableIndex(
  dictionary
) {
  const index = {};

  for (
    const [
      name,
      entry
    ] of Object.entries(
      dictionary.tunables || {}
    )
  ) {
    if (
      !entry ||
      typeof entry !== 'object'
    ) {
      continue;
    }

    const hash =
      normalizeHex(
        entry.hash
      );

    if (
      hash &&
      !index[hash]
    ) {
      index[hash] =
        name;
    }
  }

  return index;
}

function buildOtherIndex(
  dictionary
) {
  const index = {};

  for (
    const [
      hash,
      value
    ] of Object.entries(
      dictionary.other || {}
    )
  ) {
    const normalized =
      normalizeHex(hash);

    if (!normalized) {
      continue;
    }

    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    index[normalized] =
      String(value);
  }

  return index;
}

function buildOtherReverseIndex(
  otherIndex
) {
  const index = {};

  for (
    const [
      hash,
      name
    ] of Object.entries(
      otherIndex
    )
  ) {
    const normalizedName =
      String(name)
        .trim()
        .toUpperCase();

    if (
      !normalizedName
    ) {
      continue;
    }

    if (
      !index[normalizedName]
    ) {
      index[normalizedName] =
        hash;
    }
  }

  return index;
}

function buildJobsIndex(
  dictionary
) {
  const index = {};

  for (
    const [
      hash,
      value
    ] of Object.entries(
      dictionary.jobs || {}
    )
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    index[
      String(hash)
    ] = String(value);
  }

  return index;
}

function buildCustomIndex(
  dictionary
) {
  const index = {};

  for (
    const [
      hash,
      value
    ] of Object.entries(
      dictionary.custom || {}
    )
  ) {
    const normalized =
      normalizeHex(hash);

    if (!normalized) {
      continue;
    }

    if (
      typeof value !== 'string' ||
      !value.trim()
    ) {
      continue;
    }

    index[normalized] =
      value.trim();
  }

  return index;
}

function findTunableByHash(
  index,
  hash
) {
  const normalized =
    normalizeHex(hash);

  if (!normalized) {
    return null;
  }

  const matches =
    index[normalized];

  if (
    !matches ||
    !matches.length
  ) {
    return null;
  }

  return matches[0];
}

function findTunableByContext(
  index,
  hash,
  context
) {
  const normalized =
    normalizeHex(hash);

  if (!normalized) {
    return null;
  }

  const matches =
    index[normalized];

  if (
    !matches ||
    !matches.length
  ) {
    return null;
  }

  return (
    matches.find(
      item =>
        item.context === context
    ) ||
    null
  );
}

function findTunableBySum(
  dictionary,
  keyWithoutPrefix,
  context
) {
  const tunables =
    dictionary.tunables || {};

  for (
    const [
      name,
      entry
    ] of Object.entries(
      tunables
    )
  ) {
    const sums =
      entry?.sum || {};

    const sum =
      sums[context];

    if (
      sum === undefined ||
      sum === null
    ) {
      continue;
    }

    const normalizedSum =
      normalizeHex(sum);

    if (
      normalizedSum ===
      keyWithoutPrefix
    ) {
      return name;
    }

    if (
      String(sum)
        .toUpperCase()
        .includes(
          keyWithoutPrefix
        )
    ) {
      return name;
    }
  }

  return null;
}

function resolveNumericValue(
  value,
  otherIndex
) {
  if (
    typeof value !== 'number'
  ) {
    return value;
  }

  const normalized =
    normalizeHex(value);

  if (!normalized) {
    return value;
  }

  if (
    otherIndex[normalized]
  ) {
    return otherIndex[normalized]
      .toUpperCase();
  }

  return value;
}

function resolveJobValue(
  value,
  jobsIndex
) {
  if (
    typeof value !== 'number'
  ) {
    return value;
  }

  const signed =
    toSigned(value);

  if (
    signed === null
  ) {
    return value;
  }

  if (
    jobsIndex[String(signed)] !==
    undefined
  ) {
    return jobsIndex[
      String(signed)
    ];
  }

  return value;
}

function createResolver(
  dictionary,
  overrides,
  platform
) {
  const tunableIndex =
    buildTunableIndex(
      dictionary
    );

  const baseTunableIndex =
    buildBaseTunableIndex(
      dictionary
    );

  const contextIndex =
    buildContextIndex(
      dictionary
    );

  const otherIndex =
    buildOtherIndex(
      dictionary
    );

  const otherReverseIndex =
    buildOtherReverseIndex(
      otherIndex
    );

  const jobsIndex =
    buildJobsIndex(
      dictionary
    );

  const customIndex =
    buildCustomIndex(
      dictionary
    );

  const contexts =
    Object.keys(
      dictionary.contexts || {}
    ).length
      ? Object.keys(
          dictionary.contexts
        )
      : CONTEXT_NAMES;

  let previousContext =
    null;

  function translateValue(
    value,
    name
  ) {
    let output =
      resolveNumericValue(
        value,
        otherIndex
      );

    if (
      typeof name === 'string' &&
      name.includes(
        'ROOT_CONTENT_ID'
      )
    ) {
      output =
        resolveJobValue(
          value,
          jobsIndex
        );
    }

    return output;
  }

  function resolveOne(
    key,
    value,
    state = {}
  ) {
    const normalized =
      normalizeHex(key);

    if (!normalized) {
      return {
        key,
        value,
        resolved: false,
        name: null,
        context: null,
        method: null
      };
    }

    const keyWithoutPrefix =
      stripHexPrefix(key);

    if (
      keyWithoutPrefix.includes(
        '8B7D3320'
      )
    ) {
      return {
        key: normalized,
        value,
        resolved: false,
        name: null,
        context: null,
        method: 'ignored'
      };
    }

    if (
      keyWithoutPrefix.includes(
        '52BDAF86'
      )
    ) {
      return {
        key: normalized,
        value,
        resolved: true,
        name:
          '_0x19EEFD4F',
        context:
          'MP_GLOBAL',
        method:
          'special-52BDAF86'
      };
    }

    const override =
      overrides[normalized];

    if (override) {
      return {
        key: normalized,
        value:
          translateValue(
            value,
            override
          ),
        resolved: true,
        name: override,
        context:
          state.context ||
          null,
        method: 'override'
      };
    }

    const baseName =
      baseTunableIndex[
        normalized
      ];

    if (baseName) {
      return {
        key: normalized,
        value:
          translateValue(
            value,
            baseName
          ),
        resolved: true,
        name: baseName,
        context: null,
        method: 'base'
      };
    }

    const direct =
      dictionary.tunables[
        normalized
      ];

    if (
      typeof direct === 'string'
    ) {
      return {
        key: normalized,
        value:
          translateValue(
            value,
            direct
          ),
        resolved: true,
        name: direct,
        context: null,
        method: 'direct'
      };
    }

    const exact =
      findTunableByHash(
        tunableIndex,
        normalized
      );

    if (exact) {
      return {
        key: normalized,
        value:
          translateValue(
            value,
            exact.name
          ),
        resolved: true,
        name: exact.name,
        context:
          exact.context,
        method: 'context-hash'
      };
    }

    const previous =
      state.context ||
      previousContext;

    if (previous) {
      const contextName =
        typeof previous === 'string'
          ? previous
          : previous.context;

      if (contextName) {
        const named =
          findTunableBySum(
            dictionary,
            keyWithoutPrefix,
            contextName
          );

        if (named) {
          return {
            key: normalized,
            value:
              translateValue(
                value,
                named
              ),
            resolved: true,
            name: named,
            context:
              contextName,
            method:
              'previous-context'
          };
        }

        const contextHash =
          getContextHash(
            dictionary,
            contextName
          );

        const reversed =
          reverseContextHash(
            normalized,
            contextHash
          );

        if (reversed) {
          return {
            key: normalized,
            value:
              translateValue(
                value,
                null
              ),
            resolved: true,
            name:
              `_0x${reversed}`,
            context:
              contextName,
            method:
              'reverse-context'
          };
        }
      }
    }

    for (
      const context of contexts
    ) {
      if (
        platform !== 'ps5' &&
        platform !== 'xboxsx' &&
        context ===
          'MP_FM_MEMBERSHIP'
      ) {
        continue;
      }

      const named =
        findTunableBySum(
          dictionary,
          keyWithoutPrefix,
          context
        );

      if (named) {
        return {
          key: normalized,
          value:
            translateValue(
              value,
              named
            ),
          resolved: true,
          name: named,
          context,
          method:
            'context-search'
        };
      }
    }

    const other =
      otherIndex[normalized];

    if (other) {
      return {
        key: normalized,
        value,
        resolved: true,
        name: other,
        context: null,
        method: 'other'
      };
    }

    const job =
      jobsIndex[
        String(toSigned(normalized))
      ];

    if (job) {
      return {
        key: normalized,
        value,
        resolved: true,
        name: job,
        context: null,
        method: 'job'
      };
    }

    const custom =
      customIndex[normalized];

    if (custom) {
      return {
        key: normalized,
        value:
          translateValue(
            value,
            custom
          ),
        resolved: true,
        name: custom,
        context: null,
        method: 'custom'
      };
    }

    return {
      key: normalized,
      value,
      resolved: false,
      name: null,
      context:
        state.context ||
        null,
      method: null
    };
  }

  function resolve(
    tunables
  ) {
    const output = {};

    let currentContext =
      previousContext;

    let resolvedCount = 0;

    let totalCount = 0;

    for (
      const [
        key,
        value
      ] of Object.entries(
        tunables || {}
      )
    ) {
      totalCount++;

      const result =
        resolveOne(
          key,
          value,
          {
            context:
              currentContext
          }
        );

      if (
        result.method ===
        'ignored'
      ) {
        continue;
      }

      if (
        result.resolved
      ) {
        const outputName =
          result.name ||
          `_0x${normalizeHex(key)}`;

        output[
          outputName
        ] = result.value;

        resolvedCount++;

        if (
          result.context
        ) {
          currentContext =
            result.context;

          previousContext =
            result.context;
        }
      } else {
        output[
          `_0x${normalizeHex(key)}`
        ] = value;
      }
    }

    return output;
  }

  function resolveFlat(
    tunables
  ) {
    return resolve(
      tunables
    );
  }

  return {
    resolve,
    resolveFlat,
    resolveOne,

    getStats() {
      return {
        contexts:
          Object.keys(
            dictionary.contexts || {}
          ).length,

        tunables:
          Object.keys(
            dictionary.tunables || {}
          ).length,

        other:
          Object.keys(
            dictionary.other || {}
          ).length,

        jobs:
          Object.keys(
            dictionary.jobs || {}
          ).length,

        custom:
          Object.keys(
            dictionary.custom || {}
          ).length,

        resolved:
          null
      };
    }
  };
}

function getResolver(
  config,
  platform
) {
  const dictionary =
    loadDictionary();

  const overrides =
    normalizeOverrides(
      loadOverrides()
    );

  return createResolver(
    dictionary,
    overrides,
    platform
  );
}

module.exports = {
  DICTIONARY_TUNABLES_FILE,
  DICTIONARY_OTHER_FILE,
  DICTIONARY_JOBS_FILE,
  DICTIONARY_CUSTOM_FILE,
  OVERRIDES_FILE,
  normalizeHex,
  calculateContextHash,
  reverseContextHash,
  getResolver
};
