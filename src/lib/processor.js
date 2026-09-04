const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { probe, getBuffer } = require('./http');
const { getResolver } = require('./resolver');
const { ROOT } = require('./config');
const { decryptTunables, normalizeTunables } = require('./decrypt');
const { diffValues } = require('./diff');

function ensureDir(dir) {
  fs.mkdirSync(dir, {
    recursive: true
  });
}

function targetId(target) {
  return `${target.title}/${target.platform}`;
}

function safeName(value) {
  return String(value).replace(
    /[^a-zA-Z0-9._-]/g,
    '_'
  );
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
  if (target.url) {
    return target.url;
  }

  return config.source.url_template
    .replaceAll(
      '{title}',
      target.title
    )
    .replaceAll(
      '{platform}',
      target.platform_path || target.platform
    )
    .replaceAll(
      '{asset}',
      config.source.asset
    );
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
    `${safeName(target.platform)}-${timestamp}.json`
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
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
      )
    );
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  ensureDir(
    path.dirname(file)
  );

  fs.writeFileSync(
    file,
    JSON.stringify(
      value,
      null,
      2
    ) + '\n',
    'utf8'
  );
}

function writeBuffer(file, buffer) {
  ensureDir(
    path.dirname(file)
  );

  fs.writeFileSync(
    file,
    buffer
  );
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
    status: response.status,
    ok: response.ok,
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
        ? Number(headers['content-length'])
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
    status: 'unavailable',
    last_status:
      metadata?.status || 0,
    last_checked: nowIso(),
    last_error: error
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

    const resolved =
      resolver.resolve(raw);

    console.log(
      `[RESOLVER] Resolution completed for ${targetId(target)}`
    );

    return resolved;
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

function repositoryFileUrl(
  relativePath
) {
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

    event.target = target;

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

    event.target = target;

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

    event.target = target;

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

    event.target = target;

    return event;
  }

  console.log(
    `[TARGET] ${id}: received ${body.length} bytes`
  );

  if (
    config.features?.save_encrypted !== false
  ) {
    writeBuffer(
      encryptedPath(target),
      body
    );
  }

  let raw;

  try {
    if (target.decrypt === false) {
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

    event.target = target;

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
        JSON.stringify(resolved)
      )
    );

  const firstSeen =
    previousData === null &&
    !previous.last_hash;

  const recovered =
    previous.status ===
    'unavailable';

  writeJson(
    currentPath(target),
    resolved
  );

  if (
    config.features?.save_history !== false
  ) {
    writeJson(
      historyPath(
        target,
        timestamp
      ),
      resolved
    );
  }

  let changelogUrl = null;

  if (
    config.features?.generate_changelog !== false &&
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
        generated_at: nowIso(),
        target: id,
        source: url,
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
    status: 'active',
    last_status:
      metadata.status,
    last_checked:
      nowIso(),
    last_modified:
      metadata.last_modified,
    etag:
      metadata.etag,
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
    previous.last_hash !== dataHash
  ) {
    event =
      'updated';
  }

  return {
    event,
    target,
    metadata,
    changes,
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
