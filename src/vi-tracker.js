const fs = require('fs');
const path = require('path');

const {
  loadConfig,
  ROOT
} = require('./lib/config');

const STATE_FILE = path.join(
  ROOT,
  'data',
  'state',
  'vi-tracker.json'
);

const PENDING_NOTIFICATIONS_FILE = path.join(
  ROOT,
  'data',
  'state',
  'pending-notifications.json'
);

const DEFAULT_TIMEOUT = 30000;

const TRACKED_URLS = [
  {
    base: 'https://www.rockstargames.com',
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
    base: 'https://media.rockstargames.com',
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

  try {
    return JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
  } catch (error) {
    console.error(
      `[VI-TRACKER] Unable to read ${file}: ${error.message}`
    );

    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2) + '\n',
    'utf8'
  );
}

function loadState() {
  const state = readJson(STATE_FILE);

  if (
    !state ||
    typeof state !== 'object'
  ) {
    return {
      urls: {},
      updated_at: null
    };
  }

  if (
    !state.urls ||
    typeof state.urls !== 'object'
  ) {
    state.urls = {};
  }

  return state;
}

function loadNotifications() {
  const notifications = readJson(
    PENDING_NOTIFICATIONS_FILE
  );

  return Array.isArray(notifications)
    ? notifications
    : [];
}

function saveNotifications(notifications) {
  writeJson(
    PENDING_NOTIFICATIONS_FILE,
    notifications
  );
}

function buildUrl(base, trackedPath) {
  return new URL(
    trackedPath,
    base
  ).href;
}

function getDisplayName(trackedPath) {
  const cleanPath = trackedPath
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const parts = cleanPath.split('/');

  return (
    parts[parts.length - 1] ||
    trackedPath
  );
}

async function checkUrl(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    DEFAULT_TIMEOUT
  );

  try {
    let response;

    try {
      response = await fetch(
        url,
        {
          method: 'HEAD',
          redirect: 'follow',
          signal: controller.signal
        }
      );
    } catch (error) {
      return {
        exists: false,
        status: null,
        etag: null,
        error: error.message
      };
    }

    if (
      response.status === 405 ||
      response.status === 501
    ) {
      try {
        const getController = new AbortController();

        const getTimer = setTimeout(
          () => getController.abort(),
          DEFAULT_TIMEOUT
        );

        try {
          response = await fetch(
            url,
            {
              method: 'GET',
              redirect: 'follow',
              headers: {
                Range: 'bytes=0-0'
              },
              signal: getController.signal
            }
          );
        } finally {
          clearTimeout(getTimer);
          getController.abort();
        }
      } catch (error) {
        return {
          exists: false,
          status: null,
          etag: null,
          error: error.message
        };
      }
    }

    return {
      exists:
        response.status >= 200 &&
        response.status < 300,

      status: response.status,

      etag:
        response.headers.get('etag') || null,

      error: null
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildNotification(
  type,
  url,
  trackedPath
) {
  return {
    event: 'vi_tracker_changed',

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
  const config = loadConfig();

  const enabled =
    config?.vi_tracker?.enabled !== false;

  if (!enabled) {
    console.log(
      '[VI-TRACKER] Disabled by config.'
    );

    return;
  }

  console.log(
    '[VI-TRACKER] Checking GTA VI URLs...'
  );

  const previousState = loadState();
  const notifications = loadNotifications();
  const nextUrls = {};

  let firstSeenCount = 0;
  let updatedCount = 0;

  for (const group of TRACKED_URLS) {
    for (const trackedPath of group.paths) {
      const url = buildUrl(
        group.base,
        trackedPath
      );

      const previous =
        previousState.urls[url];

      const result = await checkUrl(url);

      nextUrls[url] = {
        exists: result.exists,

        status: result.status,

        etag:
          result.exists
            ? result.etag
            : null,

        checked_at:
          new Date().toISOString()
      };

      if (!result.exists) {
        console.log(
          `[VI-TRACKER] ${
            result.status === null
              ? 'ERROR'
              : result.status
          } ${url}`
        );

        continue;
      }

      console.log(
        `[VI-TRACKER] ${result.status} ${url} ${
          result.etag
            ? `(ETag: ${result.etag})`
            : '(no ETag)'
        }`
      );

      const wasPreviouslySeen =
        previous &&
        previous.exists === true;

      if (!wasPreviouslySeen) {
        console.log(
          `[VI-TRACKER] First seen: ${url}`
        );

        notifications.push(
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
        previous.etag !== result.etag
      ) {
        console.log(
          `[VI-TRACKER] Updated: ${url}`
        );

        notifications.push(
          buildNotification(
            'updated',
            url,
            trackedPath
          )
        );

        updatedCount++;
      }
    }
  }

  writeJson(
    STATE_FILE,
    {
      urls: nextUrls,

      updated_at:
        new Date().toISOString()
    }
  );

  saveNotifications(
    notifications
  );

  console.log(
    `[VI-TRACKER] Finished. First seen: ${firstSeenCount}, updated: ${updatedCount}.`
  );
}

main().catch(error => {
  console.error(
    `[VI-TRACKER] ${
      error.stack ||
      error.message
    }`
  );

  process.exitCode = 1;
});
