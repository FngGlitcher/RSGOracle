const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ROOT } = require('./config');
const { getBuffer, probe } = require('./http');
const {
  decryptTunables,
  normalizeTunables,
  DEFAULT_KEY
} = require('./decrypt');
const { getResolver } = require('./resolver');
const { diffValues, markdownDiff } = require('./diff');
const { targetId } = require('./state');

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/\.d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

function sha256(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}

function paths(target, ts) {
  const id =
    `${safeName(target.title)}_` +
    `${safeName(target.platform)}_` +
    `${safeName(target.asset || '0x1a098062')}`;

  return {
    encrypted: path.join(
      ROOT,
      'data',
      'encrypted',
      target.title,
      target.platform,
      `${id}.json`
    ),

    decrypted: path.join(
      ROOT,
      'data',
      'decrypted',
      target.title,
      target.platform,
      `${id}.json`
    ),

    current: path.join(
      ROOT,
      'data',
      'current',
      target.title,
      target.platform,
      `${id}.json`
    ),

    history: path.join(
      ROOT,
      'history',
      target.title,
      target.platform,
      `${ts}_${id}.json`
    ),

    metadata: path.join(
      ROOT,
      'history',
      target.title,
      target.platform,
      `${ts}_${id}.metadata.json`
    ),

    changelog: path.join(
      ROOT,
      'changelogs',
      target.title,
      target.platform,
      `${ts}_${id}.md`
    )
  };
}

function githubUrl(relativePath) {
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME || 'main';

  return repo
    ? `https://github.com/${repo}/blob/${branch}/${relativePath.replaceAll(
        path.sep,
        '/'
      )}`
    : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + '\n',
    'utf8'
  );
}

function readJson(file) {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : null;
}

async function processTarget(target, config, state) {
  const id = targetId(target);
  const previous = state.targets[id] || {};

  console.log('');
  console.log('='.repeat(70));
  console.log(
    `[TARGET] ${target.title}/${target.platform}`
  );
  console.log(`[TARGET] URL: ${target.url}`);
  console.log('='.repeat(70));

  let metadata;

  try {
    metadata = await probe(target.url, {
      timeout: config.polling.timeout_ms,
      retries: config.polling.retry_count
    });
  } catch (error) {
    console.error(
      `[TARGET] Metadata request failed for ${id}: ${error.message}`
    );

    state.targets[id] = {
      ...previous,
      status: 'unavailable',
      last_status: null,
      last_error: error.message
    };

    return {
      event: previous.status === 'active'
        ? 'recovery_wait'
        : 'unavailable',
      target,
      metadata: {
        status: null,
        ok: false,
        error: error.message
      }
    };
  }

  const now = new Date().toISOString();

  console.log(
    `[TARGET] HTTP status: ${metadata.status}`
  );

  if (metadata.status !== 200) {
    console.warn(
      `[TARGET] ${id} unavailable: HTTP ${metadata.status}`
    );

    state.targets[id] = {
      ...previous,
      status: 'unavailable',
      last_status: metadata.status,
      last_error: null
    };

    return {
      event:
        previous.status === 'active'
          ? 'recovery_wait'
          : 'unavailable',
      target,
      metadata
    };
  }

  let response;
  let body;

  try {
    const result = await getBuffer(target.url, {
      timeout: config.polling.timeout_ms,
      retries: config.polling.retry_count
    });

    response = result.response;
    body = result.body;
  } catch (error) {
    console.error(
      `[TARGET] Body download failed for ${id}: ${error.message}`
    );

    state.targets[id] = {
      ...previous,
      status: 'unavailable',
      last_status: metadata.status,
      last_error: error.message
    };

    return {
      event:
        previous.status === 'active'
          ? 'recovery_wait'
          : 'unavailable',
      target,
      metadata: {
        ...metadata,
        error: error.message
      }
    };
  }

  const headers = Object.fromEntries(
    response.headers.entries()
  );

  const hash = sha256(body);

  const lastModified =
    headers['last-modified'] ||
    metadata.lastModified ||
    null;

  const isFirstSeen = !previous.first_seen;
  const changed =
    !previous.sha256 ||
    previous.sha256 !== hash;

  console.log(
    `[TARGET] Received ${body.length} bytes`
  );

  console.log(
    `[TARGET] SHA-256: ${hash}`
  );

  console.log(
    `[TARGET] ${isFirstSeen ? 'First seen' : changed ? 'Changed' : 'Unchanged'}`
  );

  state.targets[id] = {
    ...previous,
    status: 'active',
    first_seen: previous.first_seen || now,
    last_modified: lastModified,
    etag: headers.etag || metadata.etag || null,
    content_length: body.length,
    sha256: hash,
    url: target.url,
    last_error: null
  };

  if (!changed && !isFirstSeen) {
    return {
      event: 'unchanged',
      target,
      metadata: state.targets[id]
    };
  }

  const ts = timestamp();

  const p = paths(
    {
      ...target,
      asset: config.source.asset
    },
    ts
  );

  fs.mkdirSync(
    path.dirname(p.encrypted),
    {
      recursive: true
    }
  );

  if (config.features.save_encrypted) {
    console.log(
      `[TARGET] Saving encrypted data...`
    );

    fs.writeFileSync(
      p.encrypted,
      body
    );
  }

  let raw;

  if (target.decrypt === false) {
    console.log(
      `[TARGET] Decryption disabled, parsing JSON...`
    );

    try {
      raw = JSON.parse(
        body.toString('utf8')
      );
    } catch {
      throw new Error(
        `Endpoint returned non-JSON data for ${id}`
      );
    }
  } else {
    console.log(
      `[TARGET] Decrypting tunables...`
    );

    try {
      raw = decryptTunables(
        body,
        process.env.TUNABLES_AES_KEY || DEFAULT_KEY
      );

      console.log(
        `[TARGET] Decryption successful.`
      );
    } catch (decryptError) {
      console.warn(
        `[TARGET] AES decryption failed, trying plain JSON...`
      );

      try {
        raw = JSON.parse(
          body.toString('utf8')
        );

        console.log(
          `[TARGET] Plain JSON parsing successful.`
        );
      } catch {
        throw new Error(
          `Unable to decrypt/parse ${id}: ${decryptError.message}`
        );
      }
    }
  }

  let normalized;

  if (target.decrypt === false) {
    normalized = raw;
  } else {
    console.log(
      `[TARGET] Normalizing tunables...`
    );

    normalized = normalizeTunables(
      raw,
      target.platform
    );
  }

  if (config.features.save_decrypted) {
    console.log(
      `[TARGET] Saving decrypted data...`
    );

    writeJson(
      p.decrypted,
      normalized
    );
  }

  let resolved = normalized;

  if (
    config.resolver.enabled &&
    target.decrypt !== false
  ) {
    console.log(
      `[RESOLVER] Starting resolver for ${id}...`
    );

    try {
      const resolver = await getResolver(
        config,
        target.platform
      );

      if (resolver) {
        console.log(
          `[RESOLVER] Resolving tunables for ${id}...`
        );

        resolved = resolver.resolve(
          normalized
        );

        console.log(
          `[RESOLVER] Resolver completed for ${id}.`
        );
      } else {
        console.log(
          `[RESOLVER] No resolver available for ${id}.`
        );
      }
    } catch (error) {
      console.error(
        `[RESOLVER] Failed for ${id}: ${error.message}`
      );

      console.warn(
        `[RESOLVER] Keeping normalized data instead of failing target.`
      );

      resolved = normalized;
    }
  }

  const currentPath = p.current;

  const oldResolved = readJson(
    currentPath
  );

  const changes = oldResolved
    ? diffValues(
        oldResolved,
        resolved
      )
    : [];

  writeJson(
    currentPath,
    resolved
  );

  console.log(
    `[TARGET] Current data saved.`
  );

  const relativeCurrent =
    path.relative(
      ROOT,
      currentPath
    );

  const relativeChangelog =
    path.relative(
      ROOT,
      p.changelog
    );

  const changelog = [
    `# Tunables ${target.title.toUpperCase()} ${target.platform.toUpperCase()}`,
    '',
    `- Event: ${isFirstSeen ? 'First seen' : 'Updated'}`,
    `- URL: ${target.url}`,
    `- Last-Modified: ${lastModified || 'unknown'}`,
    `- Checked at: ${now}`,
    `- SHA-256: \`${hash}\``,
    '',
    '## Diff',
    '',
    markdownDiff(changes)
  ].join('\n');

  if (config.features.save_history) {
    console.log(
      `[TARGET] Saving history...`
    );

    writeJson(
      p.history,
      resolved
    );

    writeJson(
      p.metadata,
      {
        title: target.title,
        platform: target.platform,
        url: target.url,
        first_seen: isFirstSeen
          ? now
          : previous.first_seen,
        last_modified: lastModified,
        etag: headers.etag || null,
        sha256: hash,
        checked_at: now,
        event: isFirstSeen
          ? 'first_seen'
          : 'updated'
      }
    );
  }

  if (config.features.generate_changelog) {
    console.log(
      `[TARGET] Generating changelog...`
    );

    fs.mkdirSync(
      path.dirname(p.changelog),
      {
        recursive: true
      }
    );

    fs.writeFileSync(
      p.changelog,
      changelog,
      'utf8'
    );
  }

  console.log(
    `[TARGET] Completed ${id}.`
  );

  return {
    event: isFirstSeen
      ? 'first_seen'
      : (
          previous.status === 'unavailable'
            ? 'recovery_wait'
            : 'updated'
        ),
    target,
    metadata: state.targets[id],
    changes,
    currentUrl: githubUrl(relativeCurrent),
    changelogUrl: githubUrl(relativeChangelog)
  };
}

module.exports = {
  processTarget
};
