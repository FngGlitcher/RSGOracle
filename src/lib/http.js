const { setTimeout: sleep } = require('timers/promises');

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 1;

async function request(url, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const attemptNumber = attempt + 1;

    console.log(
      `[HTTP] ${options.method || 'GET'} ${url} ` +
      `(attempt ${attemptNumber}/${retries + 1}, timeout ${timeout}ms)`
    );

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'GTAV-Tunables-Monitor/1.0',
          'Accept': 'application/json, text/plain, */*',
          ...(options.headers || {})
        },
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timer);

      console.log(
        `[HTTP] ${response.status} ${response.statusText || ''} ${url}`
      );

      return response;
    } catch (error) {
      clearTimeout(timer);

      lastError = error;

      const reason =
        error?.name === 'AbortError'
          ? `timeout after ${timeout}ms`
          : error?.message || String(error);

      console.error(
        `[HTTP] FAILED ${url}: ${reason}`
      );

      if (attempt < retries) {
        const delay = 1000 * (attempt + 1);

        console.log(
          `[HTTP] Retrying in ${delay}ms...`
        );

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

async function probe(url, options = {}) {
  let response;

  try {
    response = await request(url, {
      ...options,
      method: 'HEAD'
    });

    if ([405, 501].includes(response.status)) {
      console.log(
        `[HTTP] HEAD not supported (${response.status}), falling back to GET: ${url}`
      );

      response = await request(url, {
        ...options,
        method: 'GET'
      });
    }
  } catch (error) {
    console.log(
      `[HTTP] HEAD failed, falling back to GET: ${url}`
    );

    response = await request(url, {
      ...options,
      method: 'GET'
    });
  }

  const headers = Object.fromEntries(response.headers.entries());

  return {
    status: response.status,
    ok: response.ok,
    lastModified: headers['last-modified'] || null,
    etag: headers.etag || null,
    contentLength: headers['content-length']
      ? Number(headers['content-length'])
      : null,
    headers
  };
}

async function getBuffer(url, options = {}) {
  console.log(`[HTTP] Downloading body: ${url}`);

  const response = await request(url, {
    ...options,
    method: options.method || 'GET'
  });

  const body = Buffer.from(await response.arrayBuffer());

  console.log(
    `[HTTP] Download complete: ${body.length} bytes`
  );

  return {
    response,
    body
  };
}

module.exports = {
  request,
  probe,
  getBuffer
};
