const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

  const etag =
    response.headers.get(
      'etag'
    );

  const lastModified =
    response.headers.get(
      'last-modified'
    );

  let contentHash =
    null;

  /*
   * Rockstar may not provide an ETag.
   *
   * In that case we download the page and create
   * a SHA-256 fingerprint of the response body.
   *
   * This gives us a reliable fallback for change
   * detection even when ETag is null.
   */
  if (!etag && response.ok) {
    const getResponse =
      await fetch(
        url,
        {
          method: 'GET',
          redirect: 'follow'
        }
      );

    if (getResponse.ok) {
      const body =
        await getResponse.text();

      contentHash =
        crypto
          .createHash('sha256')
          .update(body, 'utf8')
          .digest('hex');
    }
  }

  return {
    exists:
      response.ok,

    status:
      response.status,

    etag,

    lastModified,

    contentHash
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

function detectChange(
  previous,
  result
) {
  if (
    !previous ||
    !previous.exists ||
    !result.exists
  ) {
    return false;
  }

  /*
   * Preferred method:
   *
   * If both previous and current responses have
   * an ETag, compare them.
   */
  if (
    previous.etag &&
    result.etag
  ) {
    return (
      previous.etag !==
      result.etag
    );
  }

  /*
   * Fallback:
   *
   * Rockstar currently may return no ETag.
   * In that case compare the SHA-256 content hash.
   *
   * We require the previous hash to exist so that
   * upgrading from an old state file does not cause
   * a false "updated" notification.
   */
  if (
    previous.content_hash &&
    result.contentHash
  ) {
    return (
      previous.content_hash !==
      result.contentHash
    );
  }

  return false;
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
        detectChange(
          previous,
          result
        );

      console.log(
        `[GTA+] ${target.name}: HTTP ${result.status} | exists=${result.exists} | ETag=${result.etag || 'none'} | Last-Modified=${result.lastModified || 'none'} | Content-Hash=${result.contentHash || 'none'}`
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
              previous.etag || null,

            content_hash:
              result.contentHash,

            previous_content_hash:
              previous.content_hash || null,

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

        content_hash:
          result.contentHash,

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
