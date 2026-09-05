'use strict';

const fs = require('fs');
const path = require('path');

const joaat = require('./joaat');

const ROOT_DIR = path.resolve(__dirname, '../..');

const DICTIONARY_FILE = path.join(
  ROOT_DIR,
  'data',
  'dictionaries',
  'dictionary.json'
);

const OVERRIDES_FILE = path.join(
  ROOT_DIR,
  'config',
  'tunable_overrides.json'
);

const HEX_PREFIX = /^_?0x/i;

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

    if (value.hex) {
      return normalizeHex(
        value.hex
      );
    }

    return null;
  }

  if (
    typeof value === 'number'
  ) {
    return (
      (value >>> 0)
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')
    );
  }

  const cleaned =
    stripHexPrefix(value);

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
  if (
    !fs.existsSync(
      DICTIONARY_FILE
    )
  ) {
    throw new Error(
      `Local dictionary not found: ${DICTIONARY_FILE}. Run "node src/build-dictionary.js" first.`
    );
  }

  return loadJson(
    DICTIONARY_FILE
  );
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

function getContextNames(
  dictionary
) {
  if (
    dictionary &&
    dictionary.contexts &&
    typeof dictionary.contexts === 'object'
  ) {
    return Object.keys(
      dictionary.contexts
    );
  }

  return [];
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

function buildContextIndex(
  dictionary
) {
  const index = {};

  for (
    const context of getContextNames(
      dictionary
    )
  ) {
    const hash =
      getContextHash(
        dictionary,
        context
      );

    if (
      hash === null
    ) {
      continue;
    }

    index[
      hash
    ] = context;
  }

  return index;
}

function buildTunableIndex(
  dictionary
) {
  const index = {};

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
    if (
      entry &&
      entry.hash
    ) {
      const normalized =
        normalizeHex(
          entry.hash
        );

      if (
        normalized &&
        !index[normalized]
      ) {
        index[normalized] =
          name;
      }
    }
  }

  return index;
}

function buildOtherIndex(
  dictionary
) {
  const index = {};

  const other =
    dictionary.other || {};

  for (
    const [
      hash,
      value
    ] of Object.entries(
      other
    )
  ) {
    const normalized =
      normalizeHex(hash);

    if (!normalized) {
      continue;
    }

    if (
      typeof value !== 'string' &&
      typeof value !== 'number'
    ) {
      continue;
    }

    index[normalized] =
      String(value);
  }

  return index;
}

function buildJobsIndex(
  dictionary
) {
  const index = {};

  const jobs =
    dictionary.jobs || {};

  for (
    const [
      hash,
      value
    ] of Object.entries(
      jobs
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

  const match =
    matches.find(
      item =>
        item.context === context
    );

  return (
    match ||
    null
  );
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

function resolveUsingOverrides(
  hash,
  overrides
) {
  const normalized =
    normalizeHex(hash);

  if (!normalized) {
    return null;
  }

  return (
    overrides[normalized] ||
    null
  );
}

function resolveDirectName(
  hash,
  dictionary,
  baseIndex
) {
  const normalized =
    normalizeHex(hash);

  if (!normalized) {
    return null;
  }

  if (
    baseIndex[normalized]
  ) {
    return {
      name:
        baseIndex[normalized],
      context: null,
      method: 'base'
    };
  }

  const tunables =
    dictionary.tunables || {};

  const direct =
    tunables[
      normalized
    ];

  if (
    typeof direct === 'string'
  ) {
    return {
      name: direct,
      context: null,
      method: 'direct'
    };
  }

  return null;
}

function createResolver(
  dictionary,
  overrides
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

  const jobsIndex =
    buildJobsIndex(
      dictionary
    );

  const contexts =
    getContextNames(
      dictionary
    );

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

    const override =
      resolveUsingOverrides(
        normalized,
        overrides
      );

    if (override) {
      return {
        key: normalized,
        value,
        resolved: true,
        name: override,
        context:
          state.context || null,
        method: 'override'
      };
    }

    const direct =
      resolveDirectName(
        normalized,
        dictionary,
        baseTunableIndex
      );

    if (direct) {
      return {
        key: normalized,
        value,
        resolved: true,
        name: direct.name,
        context: direct.context,
        method: direct.method
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
        value,
        resolved: true,
        name: exact.name,
        context: exact.context,
        method: 'context-hash'
      };
    }

    if (
      state.context
    ) {
      const contextual =
        findTunableByContext(
          tunableIndex,
          normalized,
          state.context
        );

      if (contextual) {
        return {
          key: normalized,
          value,
          resolved: true,
          name: contextual.name,
          context:
            contextual.context,
          method: 'previous-context'
        };
      }

      const contextHash =
        getContextHash(
          dictionary,
          state.context
        );

      const reversed =
        reverseContextHash(
          normalized,
          contextHash
        );

      if (reversed) {
        const reversedMatch =
          findTunableByContext(
            tunableIndex,
            calculateContextHash(
              '__placeholder__',
              state.context
            )?.hex,
            state.context
          );

        if (
          reversedMatch
        ) {
          return {
            key: normalized,
            value,
            resolved: true,
            name:
              reversedMatch.name,
            context:
              state.context,
            method:
              'reverse-context'
          };
        }

        const candidate =
          Object.entries(
            dictionary.tunables || {}
          ).find(
            ([
              name,
              entry
            ]) =>
              normalizeHex(
                entry?.hash
              ) === reversed
          );

        if (
          candidate
        ) {
          return {
            key: normalized,
            value,
            resolved: true,
            name:
              candidate[0],
            context:
              state.context,
            method:
              'reverse-context'
          };
        }
      }
    }

    for (
      const context of contexts
    ) {
      const contextual =
        findTunableByContext(
          tunableIndex,
          normalized,
          context
        );

      if (contextual) {
        return {
          key: normalized,
          value,
          resolved: true,
          name:
            contextual.name,
          context,
          method:
            'context-search'
        };
      }
    }

    if (
      otherIndex[normalized]
    ) {
      return {
        key: normalized,
        value,
        resolved: true,
        name:
          otherIndex[normalized],
        context: null,
        method: 'other'
      };
    }

    if (
      jobsIndex[normalized]
    ) {
      return {
        key: normalized,
        value,
        resolved: true,
        name:
          jobsIndex[normalized],
        context: null,
        method: 'job'
      };
    }

    return {
      key: normalized,
      value,
      resolved: false,
      name: null,
      context:
        state.context || null,
      method: null
    };
  }

  function resolve(
    tunables
  ) {
    const output = {};

    let currentContext =
      null;

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
        result.resolved
      ) {
        output[
          result.name
        ] = value;

        resolvedCount++;

        if (
          result.context
        ) {
          currentContext =
            result.context;
        }
      } else {
        output[
          `_0x${normalizeHex(key)}`
        ] = value;
      }
    }

    return {
      tunables: output,
      resolvedCount,
      totalCount,
      unresolvedCount:
        totalCount -
        resolvedCount
    };
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
          contexts.length,

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
          ).length
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

  const resolver =
    createResolver(
      dictionary,
      overrides
    );

  return {
    ...resolver,

    platform
  };
}

module.exports = {
  DICTIONARY_FILE,
  OVERRIDES_FILE,
  normalizeHex,
  calculateContextHash,
  reverseContextHash,
  getResolver
};
