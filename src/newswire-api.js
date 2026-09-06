const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const ROOT_DIR =
  path.join(
    __dirname,
    '..'
  );

const CONFIG_FILE =
  path.join(
    ROOT_DIR,
    'config',
    'config.json'
  );

const STATE_FILE =
  path.join(
    ROOT_DIR,
    'data',
    'state',
    'newswire-api.json'
  );

const PENDING_NOTIFICATIONS_FILE =
  path.join(
    ROOT_DIR,
    'data',
    'state',
    'pending-notifications.json'
  );

const GRAPH_URL =
  'https://graph.rockstargames.com';

const NEWSWIRE_URL =
  'https://www.rockstargames.com/newswire';

const DEFAULT_TIMEOUT =
  30000;

function readJson(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(
      file,
      'utf8'
    )
  );
}

function writeJson(
  file,
  value
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
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

function stableValue(
  value
) {
  if (Array.isArray(value)) {
    return value.map(
      stableValue
    );
  }

  if (
    value &&
    typeof value ===
      'object'
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (
          result,
          key
        ) => {
          result[key] =
            stableValue(
              value[key]
            );

          return result;
        },
        {}
      );
  }

  return value;
}

function hashValue(
  value
) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        stableValue(value)
      ),
      'utf8'
    )
    .digest('hex');
}

function formatArticle(
  article
) {
  const tags =
    Array.isArray(
      article?.primary_tags
    )
      ? article.primary_tags
          .map(
            tag =>
              tag?.name
          )
          .filter(Boolean)
      : [];

  const image =
    article
      ?.preview_images_parsed
      ?.newswire_block
      ?.d16x9 ||
    null;

  const url =
    article?.url
      ? new URL(
          article.url,
          'https://www.rockstargames.com'
        ).href
      : null;

  return {
    id:
      article?.id ??
      null,

    title:
      article?.title ??
      null,

    url,

    created:
      article?.created ??
      null,

    tags,

    image
  };
}

async function getNewswireHash(
  browser
) {
  const page =
    await browser.newPage();

  let hash =
    null;

  await page.setRequestInterception(
    true
  );

  page.on(
    'request',
    request => {
      const url =
        request.url();

      if (
        !hash &&
        url.includes(
          'operationName=NewswireList'
        )
      ) {
        try {
          const parsedUrl =
            new URL(url);

          const extensions =
            parsedUrl.searchParams.get(
              'extensions'
            );

          if (extensions) {
            const parsedExtensions =
              JSON.parse(
                extensions
              );

            hash =
              parsedExtensions
                ?.persistedQuery
                ?.sha256Hash ||
              null;
          }
        } catch (error) {
          console.warn(
            `[NEWSWIRE-API] Unable to parse NewswireList request: ${error.message}`
          );
        }

        request
          .abort()
          .catch(
            () => {}
          );

        return;
      }

      request
        .continue()
        .catch(
          () => {}
        );
    }
  );

  await page.goto(
    NEWSWIRE_URL,
    {
      waitUntil:
        'networkidle2',

      timeout:
        DEFAULT_TIMEOUT
    }
  );

  await page.close();

  if (!hash) {
    throw new Error(
      'Unable to find the NewswireList persisted query hash'
    );
  }

  return hash;
}

async function requestNewswireList(
  hash
) {
  const variables =
    JSON.stringify({
      page: 1,
      tagId: null,
      metaUrl: '/newswire',
      locale: 'en_us'
    });

  const extensions =
    JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash:
          hash
      }
    });

  const url =
    new URL(
      GRAPH_URL
    );

  url.searchParams.set(
    'operationName',
    'NewswireList'
  );

  url.searchParams.set(
    'variables',
    variables
  );

  url.searchParams.set(
    'extensions',
    extensions
  );

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      DEFAULT_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          signal:
            controller.signal
        }
      );

    const body =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `Newswire GraphQL HTTP ${response.status}: ${body}`
      );
    }

    let result;

    try {
      result =
        JSON.parse(
          body
        );
    } catch {
      throw new Error(
        'Newswire GraphQL returned invalid JSON'
      );
    }

    if (
      result?.errors?.length &&
      result.errors.some(
        error =>
          error?.message ===
          'PersistedQueryNotFound'
      )
    ) {
      return {
        expiredHash: true,
        result
      };
    }

    if (
      result?.errors?.length
    ) {
      throw new Error(
        result.errors
          .map(
            error =>
              error?.message
          )
          .filter(Boolean)
          .join('; ') ||
        'Newswire GraphQL returned an error'
      );
    }

    return {
      expiredHash: false,
      result
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}

async function getNewswireOutput() {
  const browser =
    await puppeteer.launch({
      headless: true,

      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

  try {
    let hash =
      await getNewswireHash(
        browser
      );

    let response =
      await requestNewswireList(
        hash
      );

    if (
      response.expiredHash
    ) {
      console.log(
        '[NEWSWIRE-API] Persisted query hash expired. Refreshing hash.'
      );

      hash =
        await getNewswireHash(
          browser
        );

      response =
        await requestNewswireList(
          hash
        );
    }

    const results =
      response
        ?.result
        ?.data
        ?.posts
        ?.results;

    if (
      !Array.isArray(
        results
      )
    ) {
      throw new Error(
        'NewswireList returned no results array'
      );
    }

    return {
      hash,

      count:
        results.length,

      results:
        results.map(
          formatArticle
        ),

      raw:
        response.result
    };
  } finally {
    await browser.close();
  }
}

function buildNotification(
  output
) {
  return {
    event:
      'newswire_api_changed',

    metadata: {
      detected_at:
        new Date().toISOString(),

      count:
        output.count,

      results:
        output.results
    }
  };
}

function appendPendingNotification(
  notification
) {
  const existing =
    readJson(
      PENDING_NOTIFICATIONS_FILE
    );

  const notifications =
    Array.isArray(existing)
      ? existing
      : [];

  notifications.push(
    notification
  );

  writeJson(
    PENDING_NOTIFICATIONS_FILE,
    notifications
  );
}

function loadState() {
  const state =
    readJson(
      STATE_FILE
    );

  if (
    !state ||
    typeof state !==
      'object'
  ) {
    return {
      hash: null,
      count: 0,
      results: [],
      raw: null,
      updated_at: null
    };
  }

  return state;
}

async function main() {
  const config =
    readJson(
      CONFIG_FILE
    ) || {};

  const enabled =
    config
      ?.newswire_api
      ?.enabled !== false;

  if (!enabled) {
    console.log(
      '[NEWSWIRE-API] NewswireList API monitor disabled by config.'
    );

    return;
  }

  console.log(
    '[NEWSWIRE-API] Checking NewswireList API...'
  );

  const output =
    await getNewswireOutput();

  const comparisonValue = {
    count:
      output.count,

    results:
      output.results
  };

  const outputHash =
    hashValue(
      comparisonValue
    );

  const state =
    loadState();

  if (
    state.hash ===
    outputHash
  ) {
    console.log(
      '[NEWSWIRE-API] No change detected.'
    );

    return;
  }

  console.log(
    `[NEWSWIRE-API] Change detected: ${
      state.hash ||
      'none'
    } -> ${outputHash}`
  );

  appendPendingNotification(
    buildNotification(
      output
    )
  );

  writeJson(
    STATE_FILE,
    {
      hash:
        outputHash,

      count:
        output.count,

      results:
        output.results,

      raw:
        output.raw,

      updated_at:
        new Date().toISOString()
    }
  );

  console.log(
    '[NEWSWIRE-API] Notification queued for notify.js and state saved.'
  );
}

main().catch(
  error => {
    console.error(
      `[NEWSWIRE-API] ${
        error.stack ||
        error.message
      }`
    );

    process.exitCode = 1;
  }
);
