const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { probe, getBuffer } = require('./http');
const { getResolver } = require('./resolver');
const { ROOT } = require('./config');
const { decryptTunables, normalizeTunables } = require('./decrypt');
const { diffValues } = require('./diff');

const BGSK_WATCH_KEYS = [
  'EXPECTEDBGSNUMBERBGSK',
  'POSIXTIMEBGSK',
  'DISABLEBGMINVERSION',
  'EXPECTEDBGMINVERSION',
  'POSIXTIMEBGMIN'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function targetId(target) {
  return `${target.title}/${target.platform}`;
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}

function buildUrl(config, target) {
  if (target.url) return target.url;

  return config.source.url_template
    .replaceAll('{title}', target.title)
    .replaceAll(
      '{platform}',
      target.platform_path || target.platform
    )
    .replaceAll('{asset}', config.source.asset);
}

function currentPath(target) {
  return path.join(
    ROOT,
    'data',
    'current',
    safeName(target.title),
    `${safeName(target.platform)}.json`
  );
}

function encryptedPath(target) {
  return path.join(
    ROOT,
    'data',
    'current',
    safeName(target.title),
    `${safeName(target.platform)}.encrypted`
  );
}

function decryptedPath(target) {
  return path.join(
    ROOT,
    'data',
    'current',
    safeName(target.title),
    `${safeName(target.platform)}.decrypted`
  );
}

function historyPath(target, timestamp) {
  return path.join(
    ROOT,
    'history',
    safeName(target.title),
    'tunable',
    `${timestamp}_${safeName(target.platform)}_0x1a098062.json`
  );
}

function changelogPath(target, timestamp) {
  return path.join(
    ROOT,
    'changelogs',
    safeName(target.title),
    `${safeName(target.platform)}-${timestamp}.json`
  );
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;

  try {
    return JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));

  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2) + '\n',
    'utf8'
  );
}

function writeBuffer(file, buffer) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, buffer);
}

function parseJson(body, id) {
  const text = Buffer.isBuffer(body)
    ? body.toString('utf8')
    : String(body || '');

  if (!text.trim()) {
    throw new Error(
      `Endpoint returned an empty body for ${id}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    const preview = text
      .trim()
      .slice(0, 120)
      .replace(/\s+/g, ' ');

    throw new Error(
      `Endpoint returned non-JSON data for ${id}` +
      ` (preview: ${preview})`
    );
  }
}

function metadataFromResponse(
  response,
  probeMetadata
) {
  const headers = Object.fromEntries(
    response.headers.entries()
  );

  return {
    ...probeMetadata,

    status:
      response.status,

    ok:
      response.ok,

    last_modified:
      headers['last-modified'] ||
      probeMetadata.lastModified ||
      null,

    etag:
      headers.etag ||
      probeMetadata.etag ||
      null,

    content_length:
      headers['content-length']
        ? Number(
            headers['content-length']
          )
        : null,

    headers
  };
}

function unavailable(
  state,
  id,
  previous,
  metadata,
  error
) {
  state.targets[id] = {
    ...previous,

    status:
      'unavailable',

    last_status:
      metadata?.status || 0,

    last_checked:
      nowIso(),

    last_error:
      error
  };

  return {
    event:
      previous?.status === 'active'
        ? 'recovery_wait'
        : 'unavailable',

    target:
      previous?.target || null,

    metadata: {
      ...(metadata || {}),
      error
    },

    changes: []
  };
}

function loadJobsDictionary() {
  const file = path.join(
    ROOT,
    'data',
    'dictionaries',
    'dictionary-jobs.json'
  );

  if (!fs.existsSync(file)) {
    return {};
  }

  try {
    const data =
      JSON.parse(
        fs.readFileSync(
          file,
          'utf8'
        )
      );

    if (
      !data ||
      typeof data !== 'object'
    ) {
      return {};
    }

    return data;
  } catch (error) {
    console.warn(
      `[JOBS] Unable to load jobs dictionary: ${error.message}`
    );

    return {};
  }
}

function resolveContentListValue(
  value,
  jobsDictionary
) {
  if (
    typeof value !== 'number'
  ) {
    return value;
  }

  const signed =
    value | 0;

  const name =
    jobsDictionary[
      String(signed)
    ];

  if (
    name !== undefined &&
    name !== null
  ) {
    return String(name);
  }

  return value;
}

function resolveContentLists(raw) {
  if (
    !raw ||
    !Array.isArray(
      raw.contentlists
    )
  ) {
    return raw;
  }

  const jobsDictionary =
    loadJobsDictionary();

  if (
    !Object.keys(
      jobsDictionary
    ).length
  ) {
    return raw;
  }

  return {
    ...raw,

    contentlists:
      raw.contentlists.map(
        contentlist => {
          if (
            !Array.isArray(
              contentlist
            )
          ) {
            return contentlist;
          }

          return contentlist.map(
            content =>
              resolveContentListValue(
                content,
                jobsDictionary
              )
          );
        }
      )
  };
}

function applyCustomDictionary(tunables) {
  const file = path.join(
    ROOT,
    'data',
    'dictionaries',
    'dictionary-custom.json'
  );

  if (!fs.existsSync(file)) {
    return tunables;
  }

  let dictionary;

  try {
    dictionary = JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
  } catch {
    return tunables;
  }

  const output = {};

  for (
    const [key, value]
    of Object.entries(tunables || {})
  ) {
    const customName =
      dictionary[key];

    if (
      typeof customName === 'string' &&
      customName.trim()
    ) {
      output[
        customName.trim()
      ] = value;
    } else {
      output[key] = value;
    }
  }

  return output;
}

async function resolveData(
  raw,
  config,
  target
) {
  if (
    config.resolver?.enabled === false
  ) {
    return raw;
  }

  try {
    console.log(
      `[RESOLVER] Resolving tunables for ${targetId(target)}...`
    );

    const resolver =
      await getResolver(
        config,
        target.platform
      );

    let resolvedData =
      resolveContentLists(raw);

    if (
      resolvedData &&
      typeof resolvedData === 'object' &&
      resolvedData.tunables &&
      typeof resolvedData.tunables === 'object'
    ) {
      let resolvedTunables =
        resolver.resolve(
          resolvedData.tunables
        );

      resolvedTunables =
        applyCustomDictionary(
          resolvedTunables
        );

      resolvedData = {
        ...resolvedData,

        TUNABLES:
          resolvedTunables
      };

      delete resolvedData.tunables;

      console.log(
        `[RESOLVER] Resolution completed for ${targetId(target)}`
      );

      return resolvedData;
    }

    console.warn(
      `[RESOLVER] No normalized tunables found for ${targetId(target)}`
    );

    return resolvedData;
  } catch (error) {
    console.error(
      `[RESOLVER] Failed for ${targetId(target)}: ${error.message}`
    );

    console.warn(
      `[RESOLVER] Keeping raw data for ${targetId(target)}`
    );

    return raw;
  }
}

function repositoryFileUrl(relativePath) {
  const repo =
    process.env.GITHUB_REPOSITORY;

  const ref =
    process.env.GITHUB_REF_NAME ||
    'main';

  if (!repo) {
    return null;
  }

  return (
    `https://github.com/${repo}` +
    `/blob/${ref}/${relativePath}`
  );
}

function getTunableVersion(tunables) {
  if (
    Object.prototype.hasOwnProperty.call(
      tunables || {},
      'TUNABLE_VERSION'
    )
  ) {
    return tunables.TUNABLE_VERSION;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      tunables || {},
      '_0x1EED3E39'
    )
  ) {
    return tunables._0x1EED3E39;
  }

  return null;
}

function updateTunableWatch(
  state,
  target,
  currentData,
  metadata,
  enabled
) {
  if (!enabled) {
    return null;
  }

  const tunables =
    currentData?.TUNABLES;

  if (
    !tunables ||
    typeof tunables !== 'object'
  ) {
    return null;
  }

  if (
    !state.tunable_watch ||
    typeof state.tunable_watch !== 'object'
  ) {
    state.tunable_watch = {};
  }

  const id =
    targetId(target);

  const previous =
    state.tunable_watch[id] || null;

  const currentValues = {};

  let hasBgskChange =
    false;

  for (
    const key of BGSK_WATCH_KEYS
  ) {
    const hasCurrent =
      Object.prototype.hasOwnProperty.call(
        tunables,
        key
      );

    const currentValue =
      hasCurrent
        ? tunables[key]
        : null;

    currentValues[key] =
      currentValue;

    if (!previous) {
      continue;
    }

    const hasPrevious =
      previous.values &&
      Object.prototype.hasOwnProperty.call(
        previous.values,
        key
      );

    if (!hasPrevious) {
      hasBgskChange = true;
      continue;
    }

    if (
      !Object.is(
        currentValue,
        previous.values[key]
      )
    ) {
      hasBgskChange = true;
    }
  }

  /*
   * First observation:
   *
   * Create the baseline silently.
   */
  if (!previous) {
    state.tunable_watch[id] = {
      values:
        Object.fromEntries(
          BGSK_WATCH_KEYS.map(
            key => [
              key,
              currentValues[key]
            ]
          )
        ),

      tunable_version:
        getTunableVersion(
          tunables
        ),

      last_modified:
        metadata?.last_modified ||
        null
    };

    console.log(
      `[TUNABLE WATCH] ${id}: baseline initialized`
    );

    return null;
  }

  /*
   * No BGSK value changed.
   *
   * IMPORTANT:
   * Do not update tunable_version or
   * last_modified here.
   */
  if (!hasBgskChange) {
    return null;
  }

  const previousValues =
    {};

  const nextValues =
    {};

  for (
    const key of BGSK_WATCH_KEYS
  ) {
    const hasPrevious =
      previous.values &&
      Object.prototype.hasOwnProperty.call(
        previous.values,
        key
      );

    previousValues[key] =
      hasPrevious
        ? previous.values[key]
        : null;

    nextValues[key] =
      currentValues[key];
  }

  const currentTunableVersion =
    getTunableVersion(
      tunables
    );

  const currentLastModified =
    metadata?.last_modified ||
    null;

  const result = {
    changed:
      true,

    values:
      nextValues,

    previous_values:
      previousValues,

    tunable_version:
      currentTunableVersion,

    previous_tunable_version:
      previous.tunable_version ??
      null,

    last_modified:
      currentLastModified,

    previous_last_modified:
      previous.last_modified ??
      null
  };

  /*
   * Only now do we update the BGSK
   * snapshot metadata.
   */
  state.tunable_watch[id] = {
    values:
      nextValues,

    tunable_version:
      currentTunableVersion,

    last_modified:
      currentLastModified
  };

  console.log(
    `[TUNABLE WATCH] ${id}: BGSK values changed`
  );

  return result;
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
    state.targets[id] || {};

  const timestamp =
    nowIso().replace(
      /[:.]/g,
      '-'
    );

  console.log(
    `[TARGET] Processing ${id}`
  );

  console.log(
    `[TARGET] URL: ${url}`
  );

  let metadata;

  try {
    metadata =
      await probe(
        url,
        {
          timeout:
            config.polling?.timeout_ms ??
            15000,

          retries:
            config.polling?.retry_count ??
            1
        }
      );
  } catch (error) {
    const event =
      unavailable(
        state,
        id,
        previous,
        {
          status: 0,
          ok: false
        },
        `Endpoint probe failed for ${id}: ${error.message}`
      );

    event.target =
      target;

    return event;
  }

  console.log(
    `[TARGET] ${id}: HTTP ${metadata.status}`
  );

  if (!metadata.ok) {
    const event =
      unavailable(
        state,
        id,
        previous,
        metadata,
        `Endpoint unavailable for ${id}: HTTP ${metadata.status}`
      );

    event.target =
      target;

    return event;
  }

  let response;
  let body;

  try {
    const result =
      await getBuffer(
        url,
        {
          timeout:
            config.polling?.timeout_ms ??
            15000,

          retries:
            config.polling?.retry_count ??
            1
        }
      );

    response =
      result.response;

    body =
      result.body;

    metadata =
      metadataFromResponse(
        response,
        metadata
      );
  } catch (error) {
    const event =
      unavailable(
        state,
        id,
        previous,
        metadata,
        `Endpoint download failed for ${id}: ${error.message}`
      );

    event.target =
      target;

    return event;
  }

  if (!response.ok) {
    const event =
      unavailable(
        state,
        id,
        previous,
        metadata,
        `Endpoint unavailable for ${id}: HTTP ${response.status}`
      );

    event.target =
      target;

    return event;
  }

  console.log(
    `[TARGET] ${id}: received ${body.length} bytes`
  );

  /*
   * Hash the encrypted payload immediately.
   */
  const encryptedHash =
    sha256(body);

  /*
   * Save the encrypted payload.
   */
  if (
    config.features?.save_encrypted !== false
  ) {
    writeBuffer(
      encryptedPath(target),
      body
    );
  }

  /*
   * Fast path:
   *
   * If the encrypted payload did not change,
   * the tunables cannot have changed either.
   */
  if (
    previous.last_encrypted_hash &&
    previous.last_encrypted_hash ===
      encryptedHash
  ) {
    console.log(
      `[HASH] ${id}: encrypted payload unchanged`
    );

    state.targets[id] = {
      ...previous,

      status:
        'active',

      last_status:
        metadata.status,

      last_checked:
        nowIso(),

      last_modified:
        metadata.last_modified,

      etag:
        metadata.etag,

      last_content_length:
        metadata.content_length,

      last_encrypted_hash:
        encryptedHash,

      last_error:
        null
    };

    return {
      event:
        'unchanged',

      target,

      metadata,

      changes: []
    };
  }

  console.log(
    `[HASH] ${id}: encrypted payload changed or no previous hash`
  );

  /*
   * Encrypted payload changed.
   *
   * decrypt -> normalize -> resolver -> diff.
   */

  let raw;

  try {
    if (
      target.decrypt === false
    ) {
      raw =
        parseJson(
          body,
          id
        );
    } else {
      raw =
        decryptTunables(
          body,
          process.env.TUNABLES_AES_KEY ||
            undefined
        );

      raw =
        normalizeTunables(
          raw,
          target.platform
        );
    }
  } catch (error) {
    const event =
      unavailable(
        state,
        id,
        previous,
        metadata,
        `Payload processing failed for ${id}: ${error.message}`
      );

    event.target =
      target;

    return event;
  }

  if (
    config.features?.save_decrypted !== false
  ) {
    writeBuffer(
      decryptedPath(target),
      Buffer.from(
        JSON.stringify(
          raw,
          null,
          2
        ) + '\n'
      )
    );
  }

  const resolved =
    await resolveData(
      raw,
      config,
      target
    );

  const previousData =
    readJson(
      currentPath(target)
    );

  const changes =
    previousData === null
      ? []
      : diffValues(
          previousData,
          resolved
        );

  const dataHash =
    sha256(
      Buffer.from(
        JSON.stringify(
          resolved
        )
      )
    );

  const firstSeen =
    previousData === null &&
    !previous.last_hash;

  const recovered =
    previous.status ===
    'unavailable';

  const hasChanged =
    changes.length > 0 ||
    previous.last_hash !==
      dataHash;

  writeJson(
    currentPath(target),
    resolved
  );

  /*
   * The watcher deliberately reads the finalized
   * current file, after resolver + custom dictionary.
   */
  const currentData =
    readJson(
      currentPath(target)
    );

  metadata.detected_at =
    nowIso();

  metadata.previous_content_length =
    previous.last_content_length ??
    metadata.content_length;

  metadata.previous_last_modified =
    previous.last_modified ||
    null;

  metadata.encrypted_hash =
    encryptedHash;

  metadata.previous_encrypted_hash =
    previous.last_encrypted_hash ||
    null;

  const tunableWatch =
    updateTunableWatch(
      state,
      target,
      currentData,
      metadata,
      config.tunable_watch?.enabled === true
    );

  if (
    config.features?.save_history !== false &&
    hasChanged
  ) {
    writeJson(
      historyPath(
        target,
        timestamp
      ),
      resolved
    );

    console.log(
      `[HISTORY] Tunables history saved for ${id} because data changed`
    );
  } else if (
    config.features?.save_history !== false
  ) {
    console.log(
      `[HISTORY] No tunables history saved for ${id}: unchanged`
    );
  }

  let changelogUrl =
    null;

  if (
    config.features?.generate_changelog !==
      false &&
    (
      firstSeen ||
      recovered ||
      changes.length
    )
  ) {
    const relative =
      path
        .relative(
          ROOT,
          changelogPath(
            target,
            timestamp
          )
        )
        .replaceAll(
          path.sep,
          '/'
        );

    writeJson(
      changelogPath(
        target,
        timestamp
      ),
      {
        generated_at:
          nowIso(),

        target:
          id,

        source:
          url,

        metadata,

        changes
      }
    );

    changelogUrl =
      repositoryFileUrl(
        relative
      );
  }

  state.targets[id] = {
    ...previous,

    target,

    status:
      'active',

    last_status:
      metadata.status,

    last_checked:
      nowIso(),

    last_modified:
      metadata.last_modified,

    etag:
      metadata.etag,

    last_content_length:
      metadata.content_length,

    last_encrypted_hash:
      encryptedHash,

    last_hash:
      dataHash,

    last_error:
      null
  };

  let event =
    'unchanged';

  if (firstSeen) {
    event =
      'first_seen';
  } else if (recovered) {
    event =
      'recovery_wait';
  } else if (
    changes.length ||
    previous.last_hash !==
      dataHash
  ) {
    event =
      'updated';
  }

  return {
    event,

    target,

    metadata,

    changes,

    tunableWatch,

    currentUrl:
      repositoryFileUrl(
        path
          .relative(
            ROOT,
            currentPath(target)
          )
          .replaceAll(
            path.sep,
            '/'
          )
      ),

    changelogUrl
  };
}

module.exports = {
  processTarget
};
