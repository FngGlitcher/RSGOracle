const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { probe, getBuffer } = require('./http');
const { getResolver } = require('./resolver');
const { ROOT } = require('./config');
const { decrypt } = require('./decrypt');

function ensureDir(dir) {
fs.mkdirSync(dir, {
recursive: true
});
}

function sha256(buffer) {
return crypto
.createHash('sha256')
.update(buffer)
.digest('hex');
}

function nowIso() {
return new Date().toISOString();
}

function safeFileName(value) {
return String(value)
.replace(/[^a-zA-Z0-9.*-]/g, '*');
}

function buildUrl(config, target) {
const template =
config.source?.url_template;

if (!template) {
throw new Error(
'Missing source.url_template in config'
);
}

return template
.replace('{title}', target.title)
.replace('{platform}', target.platform);
}

function targetId(target) {
return `${target.title}/${target.platform}`;
}

function writeJson(filePath, value) {
ensureDir(path.dirname(filePath));

fs.writeFileSync(
filePath,
JSON.stringify(value, null, 2) + '\n',
'utf8'
);
}

function getHeaderValue(headers, name) {
if (!headers || typeof headers !== 'object') {
return '';
}

const wanted = name.toLowerCase();

for (const [key, value] of Object.entries(headers)) {
if (key.toLowerCase() === wanted) {
return String(value || '');
}
}

return '';
}

function parseJsonBody(body, id) {
const text = Buffer.isBuffer(body)
? body.toString('utf8')
: String(body || '');

const trimmed = text.trim();

if (!trimmed) {
throw new Error(
`Endpoint returned an empty body for ${id}`
);
}

try {
return JSON.parse(trimmed);
} catch (error) {
const preview = trimmed
.slice(0, 120)
.replace(/\s+/g, ' ');

```
throw new Error(
  `Endpoint returned non-JSON data for ${id}` +
  ` (preview: ${preview})`
);
```

}
}

function isJsonLikeContentType(contentType) {
const value = String(
contentType || ''
).toLowerCase();

return (
value.includes('application/json') ||
value.includes('+json') ||
value.includes('text/json')
);
}

function buildUnavailableEvent(
target,
previous,
metadata,
errorMessage
) {
const wasActive =
previous?.status === 'active';

const nextStatus =
wasActive
? 'unavailable'
: 'unavailable';

const event =
wasActive
? 'recovery_wait'
: 'unavailable';

return {
event,
target,
metadata: {
...metadata,
error: errorMessage
},
changes: []
};
}

function updateUnavailableState(
state,
id,
previous,
metadata,
errorMessage
) {
state.targets[id] = {
...previous,
status: 'unavailable',
last_status: metadata.status,
last_checked: nowIso(),
last_error: errorMessage
};
}

function getTargetState(
state,
id
) {
if (
!state ||
!state.targets ||
typeof state.targets !== 'object'
) {
return {};
}

return state.targets[id] || {};
}

function normalizeForComparison(value) {
if (
value === null ||
value === undefined
) {
return value;
}

if (Array.isArray(value)) {
return value.map(
normalizeForComparison
);
}

if (
typeof value !== 'object'
) {
return value;
}

const result = {};

for (
const key of Object.keys(value).sort()
) {
result[key] =
normalizeForComparison(
value[key]
);
}

return result;
}

function stableStringify(value) {
return JSON.stringify(
normalizeForComparison(value)
);
}

function diffValues(
previous,
current,
prefix = ''
) {
const changes = [];

if (
previous === current
) {
return changes;
}

const previousIsObject =
previous &&
typeof previous === 'object';

const currentIsObject =
current &&
typeof current === 'object';

if (
Array.isArray(previous) ||
Array.isArray(current)
) {
if (
stableStringify(previous) !==
stableStringify(current)
) {
changes.push({
type: 'changed',
path: prefix || '$',
before: previous,
after: current
});
}

```
return changes;
```

}

if (
!previousIsObject ||
!currentIsObject
) {
changes.push({
type: 'changed',
path: prefix || '$',
before: previous,
after: current
});

```
return changes;
```

}

const keys = new Set([
...Object.keys(previous),
...Object.keys(current)
]);

for (const key of keys) {
const currentPath =
prefix
? `${prefix}.${key}`
: key;

```
const hasPrevious =
  Object.prototype.hasOwnProperty.call(
    previous,
    key
  );

const hasCurrent =
  Object.prototype.hasOwnProperty.call(
    current,
    key
  );

if (!hasPrevious) {
  changes.push({
    type: 'added',
    path: currentPath,
    before: undefined,
    after: current[key]
  });

  continue;
}

if (!hasCurrent) {
  changes.push({
    type: 'removed',
    path: currentPath,
    before: previous[key],
    after: undefined
  });

  continue;
}

changes.push(
  ...diffValues(
    previous[key],
    current[key],
    currentPath
  )
);
```

}

return changes;
}

function getPreviousCurrentPath(
target
) {
return path.join(
ROOT,
'data',
'current',
safeFileName(target.title),
`${safeFileName(target.platform)}.json`
);
}

function getHistoryPath(
target,
timestamp
) {
return path.join(
ROOT,
'history',
safeFileName(target.title),
`${safeFileName(target.platform)}-${timestamp}.json`
);
}

function getChangelogPath(
target,
timestamp
) {
return path.join(
ROOT,
'changelogs',
safeFileName(target.title),
`${safeFileName(target.platform)}-${timestamp}.json`
);
}

function getEncryptedPath(
target
) {
return path.join(
ROOT,
'data',
'current',
safeFileName(target.title),
`${safeFileName(target.platform)}.encrypted`
);
}

function getDecryptedPath(
target
) {
return path.join(
ROOT,
'data',
'current',
safeFileName(target.title),
`${safeFileName(target.platform)}.decrypted`
);
}

function readPreviousJson(
target
) {
const filePath =
getPreviousCurrentPath(target);

if (!fs.existsSync(filePath)) {
return null;
}

try {
return JSON.parse(
fs.readFileSync(
filePath,
'utf8'
)
);
} catch (error) {
console.warn(
`[PROCESSOR] Unable to read previous JSON ` +
`for ${targetId(target)}: ${error.message}`
);

```
return null;
```

}
}

function writeHistory(
target,
timestamp,
value
) {
const filePath =
getHistoryPath(
target,
timestamp
);

writeJson(
filePath,
value
);

return filePath;
}

function writeChangelog(
target,
timestamp,
changes,
metadata
) {
const filePath =
getChangelogPath(
target,
timestamp
);

writeJson(
filePath,
{
generated_at: timestamp,
target: targetId(target),
metadata,
changes
}
);

return filePath;
}

async function resolveData(
raw,
config,
target
) {
if (
!config.resolver ||
config.resolver.enabled === false
) {
console.log(
`[RESOLVER] Disabled for ${targetId(target)}`
);

```
return raw;
```

}

try {
console.log(
`[RESOLVER] Resolving tunables for ${targetId(target)}...`
);

```
const resolver =
  await getResolver(
    config,
    target.platform
  );

const resolved =
  resolver.resolve(raw);

console.log(
  `[RESOLVER] Resolution completed for ${targetId(target)}`
);

return resolved;
```

} catch (error) {
console.error(
`[RESOLVER] Failed for ${targetId(target)}: ${error.message}`
);

```
if (error.stack) {
  console.error(error.stack);
}

/*
 * Resolver failure must not destroy the downloaded
 * data. Keep the raw payload so the monitor can still
 * save the current version and detect changes.
 */
console.warn(
  `[RESOLVER] Keeping raw data for ${targetId(target)}`
);

return raw;
```

}
}

async function processTarget(
target,
config,
state
) {
const id =
targetId(target);

const url =
buildUrl(
config,
target
);

const previous =
getTargetState(
state,
id
);

console.log(
`[TARGET] Processing ${id}`
);

console.log(
`[TARGET] URL: ${url}`
);

let metadata;

/*

* ---
* STEP 1 — Probe endpoint
* ---

*/
try {
metadata =
await probe(url, {
timeout:
config.polling?.timeout_ms ?? 15000,
retries:
config.polling?.retry_count ?? 1
});
} catch (error) {
const message =
`Endpoint probe failed for ${id}: ${error.message}`;

```
console.error(
  `[TARGET] ${message}`
);

updateUnavailableState(
  state,
  id,
  previous,
  {
    status: 0,
    ok: false
  },
  message
);

return buildUnavailableEvent(
  target,
  previous,
  {
    status: 0,
    ok: false
  },
  message
);
```

}

console.log(
`[TARGET] ${id}: HTTP ${metadata.status}`
);

/*

* ---
* STEP 2 — Handle unavailable HTTP status
* ---

*/
if (!metadata.ok) {
const message =
`Endpoint unavailable for ${id}: HTTP ${metadata.status}`;

```
console.warn(
  `[TARGET] ${message}`
);

updateUnavailableState(
  state,
  id,
  previous,
  metadata,
  message
);

return buildUnavailableEvent(
  target,
  previous,
  metadata,
  message
);
```

}

/*

* ---
* STEP 3 — Download body
* ---

*/
let body;

try {
const result =
await getBuffer(url, {
timeout:
config.polling?.timeout_ms ?? 15000,
retries:
config.polling?.retry_count ?? 1
});

```
body =
  result.body;

metadata =
  {
    ...metadata,
    status:
      result.response.status,
    ok:
      result.response.ok,
    headers:
      Object.fromEntries(
        result.response.headers.entries()
      )
  };

console.log(
  `[TARGET] ${id}: received ${body.length} bytes`
);
```

} catch (error) {
const message =
`Endpoint download failed for ${id}: ${error.message}`;

```
console.error(
  `[TARGET] ${message}`
);

updateUnavailableState(
  state,
  id,
  previous,
  metadata,
  message
);

return buildUnavailableEvent(
  target,
  previous,
  metadata,
  message
);
```

}

/*

* ---
* STEP 4 — Hash downloaded content
* ---

*/
const encryptedHash =
sha256(body);

console.log(
`[TARGET] ${id}: SHA-256 ${encryptedHash}`
);

/*

* ---
* STEP 5 — Save encrypted/raw payload
* ---

*/
if (
config.features?.save_encrypted !== false
) {
const encryptedPath =
getEncryptedPath(target);

```
ensureDir(
  path.dirname(encryptedPath)
);

fs.writeFileSync(
  encryptedPath,
  body
);

console.log(
  `[TARGET] Saved encrypted/raw data: ${encryptedPath}`
);
```

}

/*

* ---
* STEP 6 — Decode / decrypt
* ---

*/
let raw;

if (target.decrypt === false) {
console.log(
`[TARGET] ${id}: decryption disabled, parsing JSON...`
);

```
const contentType =
  getHeaderValue(
    metadata.headers,
    'content-type'
  );

if (
  contentType &&
  !isJsonLikeContentType(contentType)
) {
  console.warn(
    `[TARGET] ${id}: Content-Type is not JSON: ${contentType}`
  );

  /*
   * IMPORTANT:
   * Do NOT immediately reject the body here.
   *
   * Some endpoints may return valid JSON while
   * declaring an imperfect content type.
   *
   * We therefore continue and validate the actual body.
   */
}

try {
  raw =
    parseJsonBody(
      body,
      id
    );
} catch (error) {
  const message =
    error.message;

  console.warn(
    `[TARGET] ${message}`
  );

  updateUnavailableState(
    state,
    id,
    previous,
    metadata,
    message
  );

  return buildUnavailableEvent(
    target,
    previous,
    metadata,
    message
  );
}
```

} else {
console.log(
`[TARGET] ${id}: decrypting payload...`
);

```
try {
  raw =
    await decrypt(
      body,
      config
    );
} catch (error) {
  const message =
    `Decryption failed for ${id}: ${error.message}`;

  console.error(
    `[TARGET] ${message}`
  );

  updateUnavailableState(
    state,
    id,
    previous,
    metadata,
    message
  );

  return buildUnavailableEvent(
    target,
    previous,
    metadata,
    message
  );
}

/*
 * The decryptor may return a Buffer,
 * a string, or an already parsed object.
 */
if (Buffer.isBuffer(raw)) {
  try {
    raw =
      parseJsonBody(
        raw,
        id
      );
  } catch (error) {
    const message =
      `Decrypted payload is not valid JSON for ${id}: ${error.message}`;

    console.error(
      `[TARGET] ${message}`
    );

    updateUnavailableState(
      state,
      id,
      previous,
      metadata,
      message
    );

    return buildUnavailableEvent(
      target,
      previous,
      metadata,
      message
    );
  }
} else if (
  typeof raw === 'string'
) {
  try {
    raw =
      parseJsonBody(
        raw,
        id
      );
  } catch (error) {
    const message =
      `Decrypted payload is not valid JSON for ${id}: ${error.message}`;

    console.error(
      `[TARGET] ${message}`
    );

    updateUnavailableState(
      state,
      id,
      previous,
      metadata,
      message
    );

    return buildUnavailableEvent(
      target,
      previous,
      metadata,
      message
    );
  }
}
```

}

if (
raw === null ||
raw === undefined
) {
const message =
`Endpoint produced no usable data for ${id}`;

```
console.warn(
  `[TARGET] ${message}`
);

updateUnavailableState(
  state,
  id,
  previous,
  metadata,
  message
);

return buildUnavailableEvent(
  target,
  previous,
  metadata,
  message
);
```

}

/*

* ---
* STEP 7 — Save decrypted representation
* ---

*/
if (
config.features?.save_decrypted !== false
) {
const decryptedPath =
getDecryptedPath(target);

```
ensureDir(
  path.dirname(decryptedPath)
);

writeJson(
  decryptedPath,
  raw
);

console.log(
  `[TARGET] Saved decrypted JSON: ${decryptedPath}`
);
```

}

/*

* ---
* STEP 8 — Resolver
* ---

*/
const resolved =
await resolveData(
raw,
config,
target
);

/*

* ---
* STEP 9 — Compare with previous version
* ---

*/
const previousData =
readPreviousJson(target);

const changes =
previousData === null
? []
: diffValues(
previousData,
resolved
);

const isFirstSeen =
previousData === null;

const hasChanges =
!isFirstSeen &&
changes.length > 0;

/*

* ---
* STEP 10 — Save current data
* ---

*/
const currentPath =
getPreviousCurrentPath(
target
);

writeJson(
currentPath,
resolved
);

console.log(
`[TARGET] Saved current data: ${currentPath}`
);

/*

* ---
* STEP 11 — History
* ---

*/
const timestamp =
nowIso();

let historyPath =
null;

if (
config.features?.save_history !== false
) {
historyPath =
writeHistory(
target,
timestamp,
resolved
);

```
console.log(
  `[TARGET] History saved: ${historyPath}`
);
```

}

/*

* ---
* STEP 12 — Changelog
* ---

*/
let changelogPath =
null;

if (
config.features?.generate_changelog !== false &&
(isFirstSeen || hasChanges)
) {
changelogPath =
writeChangelog(
target,
timestamp,
changes,
{
status:
metadata.status,
sha256:
encryptedHash,
first_seen:
isFirstSeen
}
);

```
console.log(
  `[TARGET] Changelog saved: ${changelogPath}`
);
```

}

/*

* ---
* STEP 13 — Update state
* ---

*/
let eventName;

if (isFirstSeen) {
eventName =
'first_seen';
} else if (hasChanges) {
eventName =
'updated';
} else if (
previous.status === 'unavailable'
) {
eventName =
'recovered';
} else {
eventName =
'unchanged';
}

state.targets[id] = {
...previous,
status: 'active',
last_status:
metadata.status,
last_checked:
timestamp,
last_success:
timestamp,
last_error:
null,
sha256:
encryptedHash,
current_path:
currentPath,
history_path:
historyPath,
changelog_path:
changelogPath
};

console.log(
`[TARGET] ${id}: ${eventName}`
);

if (
changes.length > 0
) {
console.log(
`[TARGET] ${id}: ${changes.length} change(s)`
);
}

/*

* ---
* STEP 14 — Return event
* ---

*/
return {
event:
eventName,
target,
metadata: {
...metadata,
sha256:
encryptedHash,
bytes:
body.length,
firstSeen:
isFirstSeen
},
changes,
currentUrl:
currentPath,
changelogUrl:
changelogPath
};
}

module.exports = {
processTarget
};
