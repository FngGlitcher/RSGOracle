'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const { joaat } = require('./lib/joaat');

const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT_DIR, 'data');
const DICTIONARY_DIR = path.join(DATA_DIR, 'dictionaries');
const CACHE_DIR = path.join(DATA_DIR, 'dictionary-sources');

const OUTPUT_FILE = path.join(
  DICTIONARY_DIR,
  'dictionary.json'
);

const SOURCES = {
  tunableNames:
    'https://raw.githubusercontent.com/Wildbrick142/V-Tunable-Names/main/tunable_list.txt',

  tuneablesProcessing:
    'https://raw.githubusercontent.com/root-cause/v-decompiled-scripts/master/tuneables_processing.c',

  gtaDictionary:
    'https://raw.githubusercontent.com/calamity-inc/gta-v-joaat-hash-db/senpai/out/dictionary-dec_signed.tsv',

  gtaLabels:
    'https://raw.githubusercontent.com/root-cause/v-labels/master/TextKeys.txt',

  jobsDictionary:
    'https://raw.githubusercontent.com/Troplo/GTAV-Tunables/master/src/static/jobs_dictionary.json'
};

const TUNABLE_CONTEXTS = [
  'CONTENT_MODIFIER_0',
  'CONTENT_MODIFIER_1',
  'CONTENT_MODIFIER_2',
  'CONTENT_MODIFIER_3',
  'CONTENT_MODIFIER_4',

  'CONTENT_MODIFIER_MEMBERSHIP_0',
  'CONTENT_MODIFIER_MEMBERSHIP_1',
  'CONTENT_MODIFIER_MEMBERSHIP_2',
  'CONTENT_MODIFIER_MEMBERSHIP_3',
  'CONTENT_MODIFIER_MEMBERSHIP_4',

  'BASE_GLOBALS',
  'CD_GLOBAL',
  'MP_Global',
  'MP_FM_MEMBERSHIP',

  'MP_CNC_TEAM_COP',
  'MP_CNC_TEAM_VAGOS',
  'MP_CNC_TEAM_LOST',

  'MP_FM',
  'MP_FM_DM',
  'MP_FM_RACES',
  'MP_FM_RACES_CAR',
  'MP_FM_RACES_BIKE',
  'MP_FM_RACES_CYCLE',
  'MP_FM_RACES_AIR',
  'MP_FM_RACES_SEA',
  'MP_FM_RACES_STUNT',

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
  'MP_FMADVERSARY'
];

function ensureDirectories() {
  fs.mkdirSync(DICTIONARY_DIR, {
    recursive: true
  });

  fs.mkdirSync(CACHE_DIR, {
    recursive: true
  });
}

function request(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);

    const req = https.get(
      {
        hostname: requestUrl.hostname,
        path:
          requestUrl.pathname +
          requestUrl.search,
        headers: {
          'User-Agent':
            'gtav-tunables-monitor-dictionary-builder'
        }
      },
      response => {
        const status = response.statusCode || 0;

        if (
          status >= 300 &&
          status < 400 &&
          response.headers.location
        ) {
          response.resume();

          if (redirects <= 0) {
            reject(
              new Error(
                `Too many redirects while downloading ${url}`
              )
            );

            return;
          }

          const redirectedUrl =
            new URL(
              response.headers.location,
              url
            ).toString();

          request(
            redirectedUrl,
            redirects - 1
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();

          reject(
            new Error(
              `HTTP ${status} while downloading ${url}`
            )
          );

          return;
        }

        const chunks = [];

        response.on('data', chunk => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          resolve(
            Buffer.concat(chunks).toString('utf8')
          );
        });
      }
    );

    req.setTimeout(30000, () => {
      req.destroy(
        new Error(
          `Timeout while downloading ${url}`
        )
      );
    });

    req.on('error', reject);
  });
}

async function downloadSource(name, url) {
  const extension =
    name === 'jobsDictionary'
      ? '.json'
      : '.txt';

  const cacheFile = path.join(
    CACHE_DIR,
    `${name}${extension}`
  );

  try {
    console.log(
      `[dictionary] Downloading ${name}...`
    );

    const content = await request(url);

    fs.writeFileSync(
      cacheFile,
      content,
      'utf8'
    );

    console.log(
      `[dictionary] ${name}: ${content.length} bytes`
    );

    return content;
  } catch (error) {
    if (fs.existsSync(cacheFile)) {
      console.warn(
        `[dictionary] Failed to download ${name}, using cached copy`
      );

      return fs.readFileSync(
        cacheFile,
        'utf8'
      );
    }

    throw error;
  }
}

function signedInt32(value) {
  const uint =
    Number(value) >>> 0;

  return uint >= 0x80000000
    ? uint - 0x100000000
    : uint;
}

function unsignedInt(value) {
  return Number(value) >>> 0;
}

function hex8(value) {
  return (
    unsignedInt(value)
      .toString(16)
      .toUpperCase()
      .padStart(8, '0')
  );
}

function normalizeHex(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  let text = String(value)
    .trim()
    .replace(/^_?0x/i, '');

  if (!/^[0-9a-f]+$/i.test(text)) {
    return null;
  }

  text = text.padStart(8, '0');

  if (text.length > 8) {
    text = text.slice(-8);
  }

  return text.toUpperCase();
}

function hashObject(value) {
  if (
    value &&
    typeof value === 'object'
  ) {
    if (
      Number.isInteger(value.unsigned)
    ) {
      return unsignedInt(value.unsigned);
    }

    if (
      Number.isInteger(value.signed)
    ) {
      return unsignedInt(value.signed);
    }

    if (value.hex) {
      const normalized =
        normalizeHex(value.hex);

      if (normalized) {
        return parseInt(
          normalized,
          16
        ) >>> 0;
      }
    }
  }

  if (
    typeof value === 'number'
  ) {
    return unsignedInt(value);
  }

  const normalized =
    normalizeHex(value);

  if (normalized) {
    return parseInt(
      normalized,
      16
    ) >>> 0;
  }

  return null;
}

function createHashInfo(value) {
  const unsigned =
    unsignedInt(value);

  return {
    signed: signedInt32(unsigned),
    unsigned,
    hex: hex8(unsigned)
  };
}

function parseTunableNames(text) {
  const names = new Set();

  for (
    const rawLine of text.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    if (
      line.startsWith('#') ||
      line.startsWith('//')
    ) {
      continue;
    }

    const cleaned =
      line
        .replace(/^["']/, '')
        .replace(/["'],?$/, '')
        .trim();

    if (!cleaned) {
      continue;
    }

    if (
      /^[A-Za-z0-9_.$-]+$/.test(
        cleaned
      )
    ) {
      names.add(cleaned);
    }
  }

  return Array.from(names);
}

function parseGtaDictionary(text) {
  const dictionary = {};

  for (
    const rawLine of text.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    const columns =
      line.split('\t');

    if (columns.length < 2) {
      continue;
    }

    let key = columns[0].trim();

    const value =
      columns
        .slice(1)
        .join('\t')
        .trim();

    if (!key || !value) {
      continue;
    }

    const normalized =
      normalizeHex(key);

    if (normalized) {
      key = normalized;
    } else {
      try {
        const hash =
          joaat(key);

        key = hash.hex;
      } catch {
        continue;
      }
    }

    if (!dictionary[key]) {
      dictionary[key] = value;
    }
  }

  return dictionary;
}

function parseLabels(text) {
  const labels = {};

  for (
    const rawLine of text.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    const match =
      line.match(
        /^([^=\t]+)[=\t](.*)$/
      );

    if (!match) {
      continue;
    }

    const key =
      match[1].trim();

    const value =
      match[2].trim();

    if (
      key &&
      value &&
      !labels[key]
    ) {
      labels[key] = value;
    }
  }

  return labels;
}

function parseJobs(text) {
  try {
    const parsed =
      JSON.parse(text);

    if (
      parsed &&
      typeof parsed === 'object'
    ) {
      return parsed;
    }
  } catch (error) {
    console.warn(
      '[dictionary] jobs_dictionary.json is not valid JSON'
    );
  }

  return {};
}

function buildContexts() {
  const contexts = {};

  for (
    const context of TUNABLE_CONTEXTS
  ) {
    const hash =
      joaat(context);

    contexts[context] =
      createHashInfo(
        hash.unsigned ??
          unsignedInt(hash.signed)
      );
  }

  return contexts;
}

function buildContextHashIndexes(
  contexts
) {
  const byUnsigned = {};
  const bySigned = {};
  const byHex = {};

  for (
    const [
      context,
      info
    ] of Object.entries(contexts)
  ) {
    byUnsigned[
      String(info.unsigned)
    ] = context;

    bySigned[
      String(info.signed)
    ] = context;

    byHex[
      info.hex
    ] = context;
  }

  return {
    byUnsigned,
    bySigned,
    byHex
  };
}

function calculateContextHash(
  name,
  context
) {
  const nameHash =
    joaat(name);

  const contextHash =
    joaat(context);

  const result =
    signedInt32(
      unsignedInt(
        signedInt32(
          nameHash.signed +
            contextHash.signed
        )
      )
    );

  return createHashInfo(
    result
  );
}

function buildTunables(
  names,
  contexts
) {
  const tunables = {};

  for (
    const name of names
  ) {
    if (
      !name ||
      typeof name !== 'string'
    ) {
      continue;
    }

    const entry = {
      hash: createHashInfo(
        joaat(name).unsigned
      ),
      sum: {}
    };

    for (
      const context of Object.keys(
        contexts
      )
    ) {
      const contextHash =
        calculateContextHash(
          name,
          context
        );

      entry.sum[context] =
        contextHash.hex;
    }

    tunables[name] =
      entry;
  }

  return tunables;
}

function buildReverseTunableIndex(
  tunables
) {
  const index = {};

  for (
    const [
      name,
      entry
    ] of Object.entries(tunables)
  ) {
    for (
      const [
        context,
        hash
      ] of Object.entries(
        entry.sum || {}
      )
    ) {
      const normalized =
        normalizeHex(hash);

      if (!normalized) {
        continue;
      }

      if (!index[normalized]) {
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

function buildOtherDictionary(
  gtaDictionary,
  labels
) {
  const other = {
    ...gtaDictionary
  };

  for (
    const [
      key,
      value
    ] of Object.entries(labels)
  ) {
    if (
      typeof value !== 'string'
    ) {
      continue;
    }

    const trimmed =
      value.trim();

    if (!trimmed) {
      continue;
    }

    const normalized =
      normalizeHex(key);

    if (normalized) {
      if (!other[normalized]) {
        other[normalized] =
          trimmed;
      }

      continue;
    }

    try {
      const hash =
        joaat(key);

      if (
        !other[hash.hex]
      ) {
        other[hash.hex] =
          trimmed;
      }
    } catch {
      // Ignore labels that cannot be hashed.
    }
  }

  return other;
}

function buildValueReverseIndex(
  other
) {
  const index = {};

  for (
    const [
      hash,
      value
    ] of Object.entries(other)
  ) {
    const normalized =
      normalizeHex(hash);

    if (!normalized) {
      continue;
    }

    const key =
      String(value);

    if (!index[key]) {
      index[key] = [];
    }

    index[key].push(
      normalized
    );
  }

  return index;
}

function normalizeJobs(
  jobs
) {
  const output = {};

  function walk(
    value,
    prefix = ''
  ) {
    if (
      Array.isArray(value)
    ) {
      value.forEach(
        (item, index) => {
          walk(
            item,
            prefix
              ? `${prefix}.${index}`
              : String(index)
          );
        }
      );

      return;
    }

    if (
      !value ||
      typeof value !== 'object'
    ) {
      return;
    }

    for (
      const [
        key,
        child
      ] of Object.entries(value)
    ) {
      const current =
        prefix
          ? `${prefix}.${key}`
          : key;

      if (
        typeof child === 'string' ||
        typeof child === 'number'
      ) {
        output[
          String(child)
        ] = current;
      } else {
        walk(
          child,
          current
        );
      }
    }
  }

  walk(jobs);

  return output;
}

function buildMetadata({
  names,
  contexts,
  other,
  jobs,
  sourceSizes
}) {
  return {
    generated_at:
      new Date().toISOString(),

    generator:
      'gtav-tunables-monitor',

    format_version: 1,

    tunable_names:
      names.length,

    contexts:
      Object.keys(contexts).length,

    other:
      Object.keys(other).length,

    jobs:
      Object.keys(jobs).length,

    sources:
      sourceSizes
  };
}

async function main() {
  console.log(
    '[dictionary] Building local GTA V dictionary...'
  );

  ensureDirectories();

  const [
    tunableNamesText,
    tuneablesProcessingText,
    gtaDictionaryText,
    gtaLabelsText,
    jobsDictionaryText
  ] = await Promise.all([
    downloadSource(
      'tunableNames',
      SOURCES.tunableNames
    ),

    downloadSource(
      'tuneablesProcessing',
      SOURCES.tuneablesProcessing
    ),

    downloadSource(
      'gtaDictionary',
      SOURCES.gtaDictionary
    ),

    downloadSource(
      'gtaLabels',
      SOURCES.gtaLabels
    ),

    downloadSource(
      'jobsDictionary',
      SOURCES.jobsDictionary
    )
  ]);

  const names =
    parseTunableNames(
      tunableNamesText
    );

  const gtaDictionary =
    parseGtaDictionary(
      gtaDictionaryText
    );

  const labels =
    parseLabels(
      gtaLabelsText
    );

  const jobsRaw =
    parseJobs(
      jobsDictionaryText
    );

  const contexts =
    buildContexts();

  const contextIndexes =
    buildContextHashIndexes(
      contexts
    );

  const tunables =
    buildTunables(
      names,
      contexts
    );

  const reverseTunables =
    buildReverseTunableIndex(
      tunables
    );

  const other =
    buildOtherDictionary(
      gtaDictionary,
      labels
    );

  const otherReverse =
    buildValueReverseIndex(
      other
    );

  const jobs =
    normalizeJobs(
      jobsRaw
    );

  const dictionary = {
    version: 1,

    format: 1,

    contexts,

    context_indexes:
      contextIndexes,

    tunables,

    tunable_hashes:
      reverseTunables,

    other,

    other_reverse:
      otherReverse,

    jobs,

    sources: {
      tunable_names:
        SOURCES.tunableNames,

      tuneables_processing:
        SOURCES.tuneablesProcessing,

      gta_dictionary:
        SOURCES.gtaDictionary,

      gta_labels:
        SOURCES.gtaLabels,

      jobs_dictionary:
        SOURCES.jobsDictionary
    },

    metadata:
      buildMetadata({
        names,
        contexts,
        other,
        jobs,
        sourceSizes: {
          tunable_names:
            tunableNamesText.length,

          tuneables_processing:
            tuneablesProcessingText.length,

          gta_dictionary:
            gtaDictionaryText.length,

          gta_labels:
            gtaLabelsText.length,

          jobs_dictionary:
            jobsDictionaryText.length
        }
      })
  };

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      dictionary,
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(
    '[dictionary] Dictionary written to:'
  );

  console.log(
    OUTPUT_FILE
  );

  console.log(
    `[dictionary] Tunable names: ${names.length}`
  );

  console.log(
    `[dictionary] Contexts: ${Object.keys(contexts).length}`
  );

  console.log(
    `[dictionary] Tunables: ${Object.keys(tunables).length}`
  );

  console.log(
    `[dictionary] Other hashes: ${Object.keys(other).length}`
  );

  console.log(
    `[dictionary] Jobs: ${Object.keys(jobs).length}`
  );

  console.log(
    '[dictionary] Done.'
  );
}

main().catch(error => {
  console.error(
    '[dictionary] Build failed:'
  );

  console.error(
    error.stack ||
      error.message ||
      error
  );

  process.exitCode = 1;
});
