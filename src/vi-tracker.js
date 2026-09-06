const fs = require('fs');
const path = require('path');

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
    'vi-tracker.json'
  );

const PENDING_NOTIFICATIONS_FILE =
  path.join(
    ROOT_DIR,
    'data',
    'state',
    'pending-notifications.json'
  );

const DEFAULT_TIMEOUT =
  30000;

const TRACKED_URLS = [
  {
    base:
      'https://www.rockstargames.com',
    paths: [
      '/VI',
      '/VI/media',
      '/VI/media/videos',
      '/VI/media/screenshots',
      '/VI/media/artwork-wallpapers',
      '/VI/pc',
      '/VI/online',
      '/VI/gta-online',
      '/VI/buy',
      '/VI/preorder',
      '/VI/pre-order',
      '/VI/pre-load',
      '/VI/preload',
      '/VI/leonida',
      '/VI/collectors-edition',
      '/VI/collectors',
      '/VI/editions',
      '/VI/special-edition',
      '/VI/trailer-3',
      '/VI/companion',
      '/VI/soundtrack',
      '/VI/system-requirements',
      '/VI/world',
      '/VI/characters',
      '/VI/vice-city'
    ]
  },
  {
    base:
      'https://media.rockstargames.com',
    paths: [
      '/VI/downloads/videos/GTAVI_Videos.zip',
      '/VI/downloads/screenshots/GTAVI_Screenshots.zip'
    ]
  }
];

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
      urls: {},
      updated_at: null
    };
  }

  if (
    !state.urls ||
    typeof state.urls !==
      'object'
  ) {
    state.urls = {};
  }

  return state;
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

function buildUrl(
  base,
  trackedPath
) {
  return new URL(
    trackedPath,
    base
  ).href;
}

function getDisplayName(
  trackedPath
) {
  const cleanPath =
    trackedPath
      .replace(
        /^\/+/,
        ''
      )
      .replace(
        /\/+$/,
        ''
      );

  const parts =
    cleanPath.split(
      '/'
    );

  return (
    parts[
      parts.length - 1
    ] ||
    trackedPath
  );
}

async function checkUrl(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      DEFAULT_TIMEOUT
    );

  try {
    let response;

    try {
      response =
        await fetch(
          url,
          {
            method:
              'HEAD',

            redirect:
              'follow',

            signal:
              controller.signal
          }
        );
    } catch (error) {
      return {
        exists:
          false,

        status:
          null,

        etag:
          null,

        error:
          error.message
      };
    }

    /*
     * Some servers do not support HEAD correctly.
     * If HEAD returns 405/501, retry with GET while
     * asking only for headers and immediately aborting
     * after the response headers are received.
     */
    if (
      response.status === 405 ||
      response.status === 501
    ) {
      try {
        const getController =
          new AbortController();

        const getResponse =
          await fetch(
            url,
            {
              method:
                'GET',

              redirect:
                'follow',

              signal:
                getController.signal
            }
          );

        response =
          getResponse;

        getController.abort();
      } catch (error) {
        return {
          exists:
            false,

          status:
            null,

          etag:
            null,

          error:
            error.message
        };
      }
    }

    const etag =
      response.headers.get(
        'etag'
      );

    return {
      exists:
        response.status === 200,

      status:
        response.status,

      etag:
        etag || null,

      error:
        null
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}

function buildNotification(
  type,
  url,
  trackedPath
) {
  return {
    event:
      'vi_tracker_changed',

    metadata: {
      type,

      detected_at:
        new Date().toISOString(),

      path:
        trackedPath,

      name:
        getDisplayName(
          trackedPath
        ),

      url
    }
  };
}

async function main() {
  const config =
    readJson(
      CONFIG_FILE
    ) || {};

  const enabled =
    config
      ?.vi_tracker
      ?.enabled !== false;

  if (!enabled) {
    console.log(
      '[VI-TRACKER] Disabled by config.'
    );

    return;
  }

  console.log(
    '[VI-TRACKER] Checking GTA VI URLs...'
  );

  const previousState =
    loadState();

  const nextUrls = {};

  let firstSeenCount =
    0;

  let updatedCount =
    0;

  for (
    const group of TRACKED_URLS
  ) {
    for (
      const trackedPath of
        group.paths
    ) {
      const url =
        buildUrl(
          group.base,
          trackedPath
        );

      const previous =
        previousState.urls[
          url
        ];

      const result =
        await checkUrl(
          url
        );

      nextUrls[url] = {
        exists:
          result.exists,

        status:
          result.status,

        etag:
          result.exists
            ? result.etag
            : null,

        checked_at:
          new Date().toISOString()
      };

      if (
        result.exists
      ) {
        console.log(
          `[VI-TRACKER] 200 ${url} ${
            result.etag
              ? `(ETag: ${result.etag})`
              : '(no ETag)'
          }`
        );

        const wasPreviouslySeen =
          previous &&
          previous.exists ===
            true;

        if (
          !wasPreviouslySeen
        ) {
          console.log(
            `[VI-TRACKER] First seen: ${url}`
          );

          appendPendingNotification(
            buildNotification(
              'first_seen',
              url,
              trackedPath
            )
          );

          firstSeenCount++;
        } else if (
          previous.etag &&
          result.etag &&
          previous.etag !==
            result.etag
        ) {
          console.log(
            `[VI-TRACKER] Updated: ${url}`
          );

          appendPendingNotification(
            buildNotification(
              'updated',
              url,
              trackedPath
            )
          );

          updatedCount++;
        }
      } else {
        console.log(
          `[VI-TRACKER] ${
            result.status === null
              ? 'ERROR'
              : result.status
          } ${url}`
        );
      }
    }
  }

  writeJson(
    STATE_FILE,
    {
      urls:
        nextUrls,

      updated_at:
        new Date().toISOString()
    }
  );

  console.log(
    `[VI-TRACKER] Finished. First seen: ${firstSeenCount}, updated: ${updatedCount}.`
  );
}

main().catch(
  error => {
    console.error(
      `[VI-TRACKER] ${
        error.stack ||
        error.message
      }`
    );

    process.exitCode = 1;
  }
);
