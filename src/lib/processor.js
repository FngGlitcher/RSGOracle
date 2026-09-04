const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('./config');
const { getBuffer, probe } = require('./http');
const { decryptTunables, normalizeTunables, DEFAULT_KEY } = require('./decrypt');
const { getResolver } = require('./resolver');
const { diffValues, markdownDiff } = require('./diff');
const { targetId } = require('./state');

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function paths(target, ts) {
  const id = `${safeName(target.title)}_${safeName(target.platform)}_${safeName(target.asset || '0x1a098062')}`;
  return {
    encrypted: path.join(ROOT, 'data', 'encrypted', target.title, target.platform, `${id}.json`),
    decrypted: path.join(ROOT, 'data', 'decrypted', target.title, target.platform, `${id}.json`),
    current: path.join(ROOT, 'data', 'current', target.title, target.platform, `${id}.json`),
    history: path.join(ROOT, 'history', target.title, target.platform, `${ts}_${id}.json`),
    metadata: path.join(ROOT, 'history', target.title, target.platform, `${ts}_${id}.metadata.json`),
    changelog: path.join(ROOT, 'changelogs', target.title, target.platform, `${ts}_${id}.md`)
  };
}

function githubUrl(relativePath) {
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME || 'main';
  return repo ? `https://github.com/${repo}/blob/${branch}/${relativePath.replaceAll(path.sep, '/')}` : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

async function processTarget(target, config, state) {
  const id = targetId(target);
  const previous = state.targets[id] || {};
  const metadata = await probe(target.url, {
    timeout: config.polling.timeout_ms,
    retries: config.polling.retry_count
  });

  const now = new Date().toISOString();
  if (metadata.status !== 200) {
    state.targets[id] = {
      ...previous,
      status: 'unavailable',
      last_status: metadata.status
    };
    return { event: previous.status === 'active' ? 'recovery_wait' : 'unavailable', target, metadata };
  }

  const { response, body } = await getBuffer(target.url, {
    timeout: config.polling.timeout_ms,
    retries: config.polling.retry_count
  });

  const headers = Object.fromEntries(response.headers.entries());
  const hash = sha256(body);
  const lastModified = headers['last-modified'] || metadata.lastModified || null;
  const isFirstSeen = !previous.first_seen;
  const changed = !previous.sha256 || previous.sha256 !== hash;

  state.targets[id] = {
    ...previous,
    status: 'active',
    first_seen: previous.first_seen || now,
    last_modified: lastModified,
    etag: headers.etag || metadata.etag || null,
    content_length: body.length,
    sha256: hash,
    url: target.url
  };

  if (!changed && !isFirstSeen) {
    return { event: 'unchanged', target, metadata: state.targets[id] };
  }

  const ts = timestamp();
  const p = paths({ ...target, asset: config.source.asset }, ts);

  fs.mkdirSync(path.dirname(p.encrypted), { recursive: true });
  if (config.features.save_encrypted) fs.writeFileSync(p.encrypted, body);

  let raw;
  if (target.decrypt === false) {
    try {
      raw = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error(`Endpoint returned non-JSON data for ${id}`);
    }
  } else {
    try {
      raw = decryptTunables(body, process.env.TUNABLES_AES_KEY || DEFAULT_KEY);
    } catch (decryptError) {
      // Some endpoints may expose an already-decrypted JSON payload.
      try {
        raw = JSON.parse(body.toString('utf8'));
      } catch {
        throw new Error(`Unable to decrypt/parse ${id}: ${decryptError.message}`);
      }
    }
  }

  let normalized = target.decrypt === false ? raw : normalizeTunables(raw, target.platform);

  if (config.features.save_decrypted) writeJson(p.decrypted, normalized);

  let resolved = normalized;
  if (config.resolver.enabled && target.decrypt !== false) {
    const resolver = await getResolver(config, target.platform);
    if (resolver) resolved = resolver.resolve(normalized);
  }

  const currentPath = p.current;
  const oldResolved = readJson(currentPath);
  const changes = oldResolved ? diffValues(oldResolved, resolved) : [];
  writeJson(currentPath, resolved);

  const relativeCurrent = path.relative(ROOT, currentPath);
  const relativeChangelog = path.relative(ROOT, p.changelog);
  const changelog = [
    `# Tunables ${target.title.toUpperCase()} ${target.platform.toUpperCase()}`,
    '',
    `- Event: ${isFirstSeen ? 'First seen' : 'Updated'}`,
    `- URL: ${target.url}`,
    `- Last-Modified: ${lastModified || 'unknown'}`,
    `- Checked at: ${now}`,
    `- SHA-256: \`${hash}\``,
    '',
    `## Diff`,
    '',
    markdownDiff(changes)
  ].join('\n');

  if (config.features.save_history) {
    writeJson(p.history, resolved);
    writeJson(p.metadata, {
      title: target.title,
      platform: target.platform,
      url: target.url,
      first_seen: isFirstSeen ? now : previous.first_seen,
      last_modified: lastModified,
      etag: headers.etag || null,
      sha256: hash,
      checked_at: now,
      event: isFirstSeen ? 'first_seen' : 'updated'
    });
  }

  if (config.features.generate_changelog) {
    fs.mkdirSync(path.dirname(p.changelog), { recursive: true });
    fs.writeFileSync(p.changelog, changelog);
  }

  return {
    event: isFirstSeen ? 'first_seen' : (previous.status === 'unavailable' ? 'recovery_wait' : 'updated'),
    target,
    metadata: state.targets[id],
    changes,
    currentUrl: githubUrl(relativeCurrent),
    changelogUrl: githubUrl(relativeChangelog)
  };
}

module.exports = { processTarget };
