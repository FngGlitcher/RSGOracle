const { setTimeout: sleep } = require('timers/promises');

async function request(url, options = {}) {
  const timeout = options.timeout ?? 30000;
  const retries = options.retries ?? 2;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'GTAV-Tunables-Monitor/1.0',
          'Accept': 'application/json, text/plain, */*',
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function probe(url, options = {}) {
  let response;
  try {
    response = await request(url, { ...options, method: 'HEAD' });
    if ([405, 501].includes(response.status)) {
      response = await request(url, { ...options, method: 'GET' });
    }
  } catch {
    response = await request(url, { ...options, method: 'GET' });
  }

  const headers = Object.fromEntries(response.headers.entries());
  return {
    status: response.status,
    ok: response.ok,
    lastModified: headers['last-modified'] || null,
    etag: headers.etag || null,
    contentLength: headers['content-length'] ? Number(headers['content-length']) : null,
    headers
  };
}

async function getBuffer(url, options = {}) {
  const response = await request(url, options);
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

module.exports = { request, probe, getBuffer };
