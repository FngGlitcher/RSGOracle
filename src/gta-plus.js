const fs = require('fs');
const path = require('path');

const {
  loadConfig,
  ROOT
} = require('./lib/config');

const URLS = [
  {
    key: 'website',
    name: 'GTA+ Website',
    url: 'https://www.rockstargames.com/gta-plus/join'
  },
  {
    key: 'benefits',
    name: 'GTA+ Benefits',
    url: 'https://www.rockstargames.com/gta-plus/benefits'
  }
];

const STATE_FILE =
  path.join(
    ROOT,
    'data',
    'state',
    'gta-plus.json'
  );

const NOTIFICATIONS_FILE =
  path.join(
    ROOT,
    'data',
    'state',
    'pending-notifications.json'
  );

async function checkUrl(url) {
  const response =
    await fetch(
      url,
      {
        method: 'HEAD',
        redirect: 'follow'
      }
    );

  return {
    exists:
      response.ok,

    status:
      response.status,

    etag:
      response.headers.get(
        'etag'
      ),

    lastModified:
      response.headers.get(
        'last-modified'
      )
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        STATE_FILE,
        'utf8'
      )
    );
  } catch (error) {
    console.error(
      `[GTA+] Unable to read state: ${error.message}`
    );

    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(
    path.dirname(STATE_FILE),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      state,
      null,
      2
    ) + '\n',
    'utf8'
  );
}

function loadNotifications() {
  if (!fs.existsSync(NOTIFICATIONS_FILE)) {
    return [];
  }

  try {
    const notifications =
      JSON.parse(
        fs.readFileSync(
          NOTIFICATIONS_FILE,
          'utf8'
        )
      );

    return Array.isArray(
      notifications
    )
      ? notifications
      : [];
  } catch (error) {
    console.error(
      `[GTA+] Unable to read pending notifications: ${error.message}`
    );

    return [];
  }
}

function saveNotifications(
  notifications
) {
  fs.mkdirSync(
    path.dirname(NOTIFICATIONS_FILE),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    NOTIFICATIONS_FILE,
    JSON.stringify(
      notifications,
      null,
      2
    ) + '\n',
    'utf8'
  );
}

async function main() {
  const config =
    loadConfig();

  if (
    config['web_gta-plus']?.enabled === false
  ) {
    console.log(
      '[GTA+] Monitor disabled by config.'
    );

    return;
  }

  const state =
    loadState();

  const notifications =
    loadNotifications();

  let stateDirty =
    false;

  for (const target of URLS) {
    try {
      const result =
        await checkUrl(
          target.url
        );

      const previous =
        state[target.key] ||
        null;

      const changed =
        Boolean(
          previous &&
          previous.exists &&
          result.exists &&
          previous.etag &&
          result.etag &&
          previous.etag !==
            result.etag
        );

      console.log(
        `[GTA+] ${target.name}: HTTP ${result.status} | exists=${result.exists} | ETag=${result.etag || 'none'} | Last-Modified=${result.lastModified || 'none'}`
      );

      if (changed) {
        const detectedAt =
          new Date().toISOString();

        notifications.push({
          event:
            'gta_plus_updated',

          metadata: {
            key:
              target.key,

            name:
              target.name,

            url:
              target.url,

            detected_at:
              detectedAt,

            etag:
              result.etag,

            previous_etag:
              previous.etag,

            last_modified:
              result.lastModified
          }
        });

        console.log(
          `[GTA+] ${target.name}: update detected.`
        );
      }

      state[target.key] = {
        name:
          target.name,

        url:
          target.url,

        exists:
          result.exists,

        status:
          result.status,

        etag:
          result.etag,

        last_modified:
          result.lastModified,

        checked_at:
          new Date().toISOString()
      };

      stateDirty =
        true;
    } catch (error) {
      console.error(
        `[GTA+] ${target.name}: ERROR: ${error.message}`
      );

      if (error.stack) {
        console.error(
          error.stack
        );
      }
    }
  }

  if (stateDirty) {
    saveState(
      state
    );
  }

  saveNotifications(
    notifications
  );

  console.log(
    `[GTA+] Pending notifications: ${notifications.length}`
  );
}

main().catch(
  error => {
    console.error(
      '[GTA+] Fatal error:',
      error
    );

    process.exit(1);
  }
);
