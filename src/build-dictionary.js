'use strict';

const fs = require('fs');
const path = require('path');

const http = require('./lib/http');
const joaat = require('./lib/joaat');

const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT_DIR, 'data');
const DICTIONARY_DIR = path.join(DATA_DIR, 'dictionaries');

const OUTPUT_TUNABLES = path.join(
  DICTIONARY_DIR,
  'dictionary-tunables.json'
);

const OUTPUT_OTHER = path.join(
  DICTIONARY_DIR,
  'dictionary-other.json'
);

const OUTPUT_JOBS = path.join(
  DICTIONARY_DIR,
  'dictionary-jobs.json'
);

const CONFIG_PATH = path.join(
  ROOT_DIR,
  'config',
  'config.json'
);

function loadConfig() {
  const content = fs.readFileSync(
    CONFIG_PATH,
    'utf8'
  );

  return JSON.parse(content);
}

function getResolverConfig(config) {
  return config.resolver || {};
}

function splitLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

async function downloadText(url) {
  const response = await http.request(url);

  if (!response || !response.ok) {
    throw new Error(
      `HTTP ${response ? response.status : 'unknown'} while downloading ${url}`
    );
  }

  const body = Buffer.from(
    await response.arrayBuffer()
  );

  return body.toString('utf8');
}

function parseTunableNames(text) {
  const tunables = {};

  for (const line of splitLines(text)) {
    const name = line.trim();

    if (!name) {
      continue;
    }

    const hash = joaat(name).hex;

    tunables[name] = {
      hash,
      sum: {}
    };
  }

  return tunables;
}

function buildContexts(tunables, contextNames) {
  const contexts = {};

  for (const context of contextNames) {
    const contextHash = joaat(context);

    contexts[context] = {
      signed: contextHash.signed,
      unsigned: contextHash.unsigned,
      hex: contextHash.hex
    };
  }

  for (const tunable of Object.values(tunables)) {
    for (const context of contextNames) {
      const tunableHash = parseInt(
        tunable.hash,
        16
      );

      const contextHash = parseInt(
        contexts[context].hex,
        16
      );

      const sum = (
        tunableHash +
        contextHash
      )
        .toString(16)
        .toUpperCase();

      tunable.sum[context] = sum;
    }
  }

  return contexts;
}

function parseGtaDictionary(text) {
  const other = {};

  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split('\t');

    if (parts.length < 2) {
      continue;
    }

    const rawHash = parts[0].trim();

    const key = parts
      .slice(1)
      .join('\t')
      .trim();

    if (!rawHash || !key) {
      continue;
    }

    let normalizedHash;

    if (/^[+-]?\d+$/.test(rawHash)) {
      const decimalHash = Number(rawHash);

      if (
        !Number.isSafeInteger(decimalHash) ||
        decimalHash < -2147483648 ||
        decimalHash > 4294967295
      ) {
        continue;
      }

      normalizedHash =
        (decimalHash >>> 0)
          .toString(16)
          .toUpperCase()
          .padStart(8, '0');
    } else {
      normalizedHash = rawHash
        .replace(/^0x/i, '')
        .toUpperCase()
        .padStart(8, '0');
    }

    other[normalizedHash] = key;
  }

  return other;
}

function parseLabels(text, other) {
  for (const line of splitLines(text)) {
    const label = line.trim();

    if (!label) {
      continue;
    }

    const hash = joaat(label).hex;

    if (!other[hash]) {
      other[hash] = label;
    }
  }

  return other;
}

function parseJobs(text) {
  const jobs = {};

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid jobs dictionary JSON: ${error.message}`
    );
  }

  if (!data || typeof data !== 'object') {
    return jobs;
  }

  for (const [key, value] of Object.entries(data)) {
    const hash = joaat(
      key.toLowerCase()
    );

    jobs[String(hash.signed)] = value;
  }

  return jobs;
}

function buildTunableHashIndex(tunables) {
  const index = {};

  for (const [name, data] of Object.entries(tunables)) {
    index[data.hash] = name;
  }

  return index;
}

function writeJson(filePath, data) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2) + '\n',
    'utf8'
  );
}

async function main() {
  const config = loadConfig();
  const resolver = getResolverConfig(config);

  const tunableNamesUrl =
    resolver.tunable_names_url;

  const gtaDictionaryUrl =
    resolver.gta_dictionary_url;

  const gtaLabelsUrl =
    resolver.gta_labels_url;

  const jobsDictionaryUrl =
    resolver.jobs_dictionary_url;

  if (!tunableNamesUrl) {
    throw new Error(
      'Missing resolver.tunable_names_url'
    );
  }

  if (!gtaDictionaryUrl) {
    throw new Error(
      'Missing resolver.gta_dictionary_url'
    );
  }

  if (!gtaLabelsUrl) {
    throw new Error(
      'Missing resolver.gta_labels_url'
    );
  }

  if (!jobsDictionaryUrl) {
    throw new Error(
      'Missing resolver.jobs_dictionary_url'
    );
  }

  fs.mkdirSync(
    DICTIONARY_DIR,
    {
      recursive: true
    }
  );

  console.log(
    '[dictionary] Building local GTA V dictionary...'
  );

  console.log(
    '[dictionary] Downloading tunableNames...'
  );

  const tunableNamesText =
    await downloadText(
      tunableNamesUrl
    );

  console.log(
    '[dictionary] Downloading gtaDictionary...'
  );

  const gtaDictionaryText =
    await downloadText(
      gtaDictionaryUrl
    );

  console.log(
    '[dictionary] Downloading gtaLabels...'
  );

  const gtaLabelsText =
    await downloadText(
      gtaLabelsUrl
    );

  console.log(
    '[dictionary] Downloading jobsDictionary...'
  );

  const jobsDictionaryText =
    await downloadText(
      jobsDictionaryUrl
    );

  console.log(
    `[dictionary] tunableNames: ${Buffer.byteLength(
      tunableNamesText,
      'utf8'
    )} bytes`
  );

  console.log(
    `[dictionary] gtaDictionary: ${Buffer.byteLength(
      gtaDictionaryText,
      'utf8'
    )} bytes`
  );

  console.log(
    `[dictionary] gtaLabels: ${Buffer.byteLength(
      gtaLabelsText,
      'utf8'
    )} bytes`
  );

  console.log(
    `[dictionary] jobsDictionary: ${Buffer.byteLength(
      jobsDictionaryText,
      'utf8'
    )} bytes`
  );

  const tunables =
    parseTunableNames(
      tunableNamesText
    );

  const contextNames = [
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

  const contexts =
    buildContexts(
      tunables,
      contextNames
    );

  const other =
    parseGtaDictionary(
      gtaDictionaryText
    );

  parseLabels(
    gtaLabelsText,
    other
  );

  const jobs =
    parseJobs(
      jobsDictionaryText
    );

  const tunableIndex =
    buildTunableHashIndex(
      tunables
    );

  console.log(
    `[dictionary] Tunable names: ${Object.keys(tunables).length}`
  );

  console.log(
    `[dictionary] Contexts: ${Object.keys(contexts).length}`
  );

  console.log(
    `[dictionary] Tunable hashes: ${Object.keys(tunableIndex).length}`
  );

  console.log(
    `[dictionary] Other hashes: ${Object.keys(other).length}`
  );

  console.log(
    `[dictionary] Jobs: ${Object.keys(jobs).length}`
  );

  const tunablesOutput = {
    contexts,
    tunables,
    tunableIndex
  };

  writeJson(
    OUTPUT_TUNABLES,
    tunablesOutput
  );

  writeJson(
    OUTPUT_OTHER,
    other
  );

  writeJson(
    OUTPUT_JOBS,
    jobs
  );

  console.log(
    `[dictionary] Dictionary written to: ${OUTPUT_TUNABLES}`
  );

  console.log(
    `[dictionary] Dictionary written to: ${OUTPUT_OTHER}`
  );

  console.log(
    `[dictionary] Dictionary written to: ${OUTPUT_JOBS}`
  );

  console.log(
    '[dictionary] Done.'
  );
}

main().catch(error => {
  console.error(
    '[dictionary] Failed:',
    error
  );

  process.exitCode = 1;
});
