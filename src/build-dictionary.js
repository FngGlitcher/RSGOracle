'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const joaat = require('./lib/joaat');

const ROOT_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT_DIR, 'data');
const DICTIONARY_DIR = path.join(DATA_DIR, 'dictionaries');
const CACHE_DIR = path.join(DATA_DIR, 'dictionary-sources');

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

```
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
    const status =
      response.statusCode || 0;

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

    if (
      status < 200 ||
      status >= 300
    ) {
      response.resume();

      reject(
        new Error(
          `HTTP ${status} while downloading ${url}`
        )
      );

      return;
    }

    const chunks = [];

    response.on(
      'data',
      chunk => {
        chunks.push(chunk);
      }
    );

    response.on(
      'end',
      () => {
        resolve(
          Buffer.concat(chunks)
            .toString('utf8')
        );
      }
    );
  }
);

req.setTimeout(
  30000,
  () => {
    req.destroy(
      new Error(
        `Timeout while downloading ${url}`
      )
    );
  }
);

req.on(
  'error',
  reject
);
```

});
}

async function downloadSource(
name,
url
) {
const extension =
name === 'jobsDictionary'
? '.json'
: '.txt';

const cacheFile =
path.join(
CACHE_DIR,
`${name}${extension}`
);

try {
console.log(
`[dictionary] Downloading ${name}...`
);

```
const content =
  await request(url);

fs.writeFileSync(
  cacheFile,
  content,
  'utf8'
);

console.log(
  `[dictionary] ${name}: ${content.length} bytes`
);

return content;
```

} catch (error) {
if (
fs.existsSync(cacheFile)
) {
console.warn(
`[dictionary] Failed to download ${name}, using cached copy`
);

```
  return fs.readFileSync(
    cacheFile,
    'utf8'
  );
}

throw error;
```

}
}

function normalizeHex(value) {
if (
value === null ||
value === undefined
) {
return null;
}

const text =
String(value)
.trim()
.replace(
/^_?0x/i,
''
);

if (
!/^[0-9a-f]+$/i.test(text)
) {
return null;
}

return text
.padStart(8, '0')
.slice(-8)
.toUpperCase();
}

function parseTunableNames(text) {
const names = new Set();

for (
const rawLine of
text.split(/\r?\n/)
) {
const line =
rawLine.trim();

```
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
    .replace(
      /^["']/,
      ''
    )
    .replace(
      /["'],?$/,
      ''
    )
    .trim();

if (
  cleaned &&
  /^[A-Za-z0-9_.$-]+$/.test(
    cleaned
  )
) {
  names.add(cleaned);
}
```

}

return Array.from(names);
}

function parseGtaDictionary(text) {
const other = {};

for (
const rawLine of
text.split(/\r?\n/)
) {
const line =
rawLine.trim();

```
if (!line) {
  continue;
}

const columns =
  line.split('\t');

if (
  columns.length < 2
) {
  continue;
}

const hash =
  columns[0].trim();

const key =
  columns
    .slice(1)
    .join('\t')
    .trim();

if (
  !hash ||
  !key
) {
  continue;
}

const normalizedHash =
  normalizeHex(hash);

if (!normalizedHash) {
  continue;
}

if (
  !Object.prototype.hasOwnProperty.call(
    other,
    normalizedHash
  )
) {
  other[normalizedHash] =
    key;
}
```

}

return other;
}

function parseLabels(text) {
const other = {};

for (
const rawLine of
text.split(/\r?\n/)
) {
const line =
rawLine.trim();

```
if (!line) {
  continue;
}

const hash =
  joaat(line);

other[
  normalizeHex(hash.hex)
] =
  line;
```

}

return other;
}

function parseJobs(text) {
try {
const parsed =
JSON.parse(text);

```
if (
  parsed &&
  typeof parsed === 'object' &&
  !Array.isArray(parsed)
) {
  return parsed;
}
```

} catch {
console.warn(
'[dictionary] jobs_dictionary.json is not valid JSON'
);
}

return {};
}

function buildContexts() {
const contexts = {};

for (
const context of
TUNABLE_CONTEXTS
) {
contexts[context] =
joaat(context);
}

return contexts;
}

function buildTunables(
names,
contexts
) {
const tunables = {};

for (
const name of names
) {
const hash =
joaat(name);

```
const entry = {
  hash: hash.hex,
  sum: {}
};

for (
  const [
    context,
    contextHash
  ] of Object.entries(contexts)
) {
  const sum =
    (
      parseInt(
        hash.hex,
        16
      ) +
      parseInt(
        contextHash.hex,
        16
      )
    )
      .toString(16)
      .toUpperCase();

  entry.sum[context] =
    sum;
}

tunables[name] =
  entry;
```

}

return tunables;
}

function buildTunableHashIndex(
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

```
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
```

}

return index;
}

function buildOtherIndex(
gtaDictionary,
labels
) {
const other = {};

for (
const [
hash,
key
] of Object.entries(
gtaDictionary
)
) {
const normalized =
normalizeHex(hash);

```
if (normalized) {
  other[normalized] =
    key;
}
```

}

for (
const [
hash,
key
] of Object.entries(
labels
)
) {
const normalized =
normalizeHex(hash);

```
if (
  normalized &&
  !other[normalized]
) {
  other[normalized] =
    key;
}
```

}

return other;
}

function buildJobs(
jobsDictionary
) {
const jobs = {};

for (
const [
key,
value
] of Object.entries(
jobsDictionary
)
) {
if (
value === null ||
value === undefined
) {
continue;
}

```
const hash =
  joaat(
    key.toLowerCase()
  );

jobs[
  String(hash.signed)
] =
  String(value);
```

}

return jobs;
}

function writeJson(
file,
data
) {
fs.writeFileSync(
file,
JSON.stringify(
data,
null,
2
) + '\n',
'utf8'
);
}

async function main() {
console.log(
'[dictionary] Building split GTA V dictionaries...'
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

```
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
```

]);

void tuneablesProcessingText;

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

const jobsDictionary =
parseJobs(
jobsDictionaryText
);

const contexts =
buildContexts();

const tunables =
buildTunables(
names,
contexts
);

const tunableHashes =
buildTunableHashIndex(
tunables
);

const other =
buildOtherIndex(
gtaDictionary,
labels
);

const jobs =
buildJobs(
jobsDictionary
);

const tunablesDictionary = {
version: 2,
type: 'tunables',
contexts,
tunables,
tunable_hashes: tunableHashes,
metadata: {
generated_at:
new Date().toISOString(),

```
  tunable_names:
    names.length,

  contexts:
    Object.keys(contexts).length,

  tunables:
    Object.keys(tunables).length,

  source_sizes: {
    tunable_names:
      tunableNamesText.length,

    tuneables_processing:
      tuneablesProcessingText.length
  }
}
```

};

const otherDictionary = {
version: 2,
type: 'other',
other,
metadata: {
generated_at:
new Date().toISOString(),

```
  entries:
    Object.keys(other).length,

  gta_dictionary_entries:
    Object.keys(gtaDictionary).length,

  label_entries:
    Object.keys(labels).length,

  source_sizes: {
    gta_dictionary:
      gtaDictionaryText.length,

    gta_labels:
      gtaLabelsText.length
  }
}
```

};

const jobsOutput = {
version: 2,
type: 'jobs',
jobs,
metadata: {
generated_at:
new Date().toISOString(),

```
  entries:
    Object.keys(jobs).length,

  source_size:
    jobsDictionaryText.length
}
```

};

writeJson(
OUTPUT_TUNABLES,
tunablesDictionary
);

writeJson(
OUTPUT_OTHER,
otherDictionary
);

writeJson(
OUTPUT_JOBS,
jobsOutput
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
`[dictionary] Written: ${OUTPUT_TUNABLES}`
);

console.log(
`[dictionary] Written: ${OUTPUT_OTHER}`
);

console.log(
`[dictionary] Written: ${OUTPUT_JOBS}`
);

console.log(
'[dictionary] Done.'
);
}

main().catch(
error => {
console.error(
'[dictionary] Failed:',
error
);

```
process.exitCode = 1;
```

}
);
