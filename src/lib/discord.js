const fs = require('fs');
const path = require('path');

const DISCORD_API_BASE =
  'https://discord.com/api/v10';

const DEFAULT_TIMEOUT =
  15000;

function getTitleDisplayName(title) {
  const names = {
    gta5: 'GTA5',
    gta6: 'GTA6'
  };

  return (
    names[String(title).toLowerCase()] ||
    title
  );
}

function getPlatformDisplayName(title, platform) {
  const gta5Names = {
    ps4: 'PS4',
    xboxone: 'XboxOne',
    pcros: 'PC Legacy',
    ps5: 'PS5',
    xboxsx: 'Xbox Series X|S',
    pcrosalt: 'PC Enhanced',
    ps6: 'PS6'
  };

  const gta6Names = {
    pcros: 'PC',
    ps5: 'PS5',
    xboxsx: 'Xbox Series X|S',
    ps6: 'PS6'
  };

  const names =
    String(title).toLowerCase() === 'gta6'
      ? gta6Names
      : gta5Names;

  return names[platform] || platform;
}

function getBackgroundPlatformDisplayName(platform) {
  const names = {
    ps4: 'PS4',
    xboxone: 'Xbox One',
    pcros: 'PC Legacy',
    ps5: 'PS5',
    xboxsx: 'Xbox Series X|S',
    pcrosalt: 'PC Enhanced',
    ps6: 'PS6'
  };

  return (
    names[
      String(platform).toLowerCase()
    ] || platform
  );
}

function formatDetectionTime(value) {
  if (!value) {
    return 'unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString(
    'fr-FR',
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Europe/Paris'
    }
  );
}

function formatNewswirePostedTime(value) {
  if (!value) {
    return 'unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(
    'en-US',
    {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Paris'
    }
  ).replace(
    ',',
    ' at'
  );
}

function formatNewswireDate(value) {
  if (!value) {
    return 'unknown';
  }

  return String(value);
}

function formatSize(value) {
  return Number.isFinite(
    Number(value)
  )
    ? Number(value)
    : null;
}

function formatSizeLine(
  previousSize,
  currentSize
) {
  const previous =
    formatSize(previousSize);

  const current =
    formatSize(currentSize);

  if (
    previous === null ||
    current === null
  ) {
    return null;
  }

  const difference =
    current - previous;

  const sign =
    difference >= 0
      ? '+'
      : '';

  return (
    `Size: ${previous} → ${current} bytes (${sign}${difference})`
  );
}

function loadTunablesSummary(
  title,
  platform
) {
  const decryptedFile =
    path.join(
      __dirname,
      '..',
      '..',
      'data',
      'current',
      String(title),
      `${String(platform)}.decrypted`
    );

  const resolvedFile =
    path.join(
      __dirname,
      '..',
      '..',
      'data',
      'current',
      String(title),
      `${String(platform)}.json`
    );

  try {
    if (
      fs.existsSync(
        decryptedFile
      )
    ) {
      const decryptedData =
        JSON.parse(
          fs.readFileSync(
            decryptedFile,
            'utf8'
          )
        );

      const decryptedTunables =
        decryptedData?.tunables;

      if (
        decryptedTunables &&
        typeof decryptedTunables ===
          'object'
      ) {
        const eventWeekly =
          decryptedTunables._0x6F758B7B ??
          null;

        const tunableVersion =
          decryptedTunables._0x1EED3E39 ??
          null;

        if (
          eventWeekly !== null ||
          tunableVersion !== null
        ) {
          return {
            eventWeekly,
            tunableVersion
          };
        }
      }
    }

    if (
      !fs.existsSync(
        resolvedFile
      )
    ) {
      return {
        eventWeekly: null,
        tunableVersion: null
      };
    }

    const resolvedData =
      JSON.parse(
        fs.readFileSync(
          resolvedFile,
          'utf8'
        )
      );

    const tunables =
      resolvedData?.TUNABLES;

    if (
      !tunables ||
      typeof tunables !==
        'object'
    ) {
      return {
        eventWeekly: null,
        tunableVersion: null
      };
    }

    return {
      eventWeekly:
        tunables.EVENT_WKLY ??
        tunables._0x6F758B7B ??
        null,

      tunableVersion:
        tunables.TUNABLE_VERSION ??
        tunables._0x1EED3E39 ??
        null
    };
  } catch (error) {
    console.warn(
      `[DISCORD] Unable to read tunables summary: ${error.message}`
    );

    return {
      eventWeekly: null,
      tunableVersion: null
    };
  }
}

async function discordRequest(
  token,
  url,
  options = {}
) {
  if (!token) {
    throw new Error(
      'Discord bot token is missing'
    );
  }

  const timeout =
    options.timeout ??
    DEFAULT_TIMEOUT;

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    console.log(
      `[DISCORD] ${options.method || 'GET'} ${url}`
    );

    const response =
      await fetch(
        `${DISCORD_API_BASE}${url}`,
        {
          ...options,

          headers: {
            Authorization:
              `Bot ${token}`,

            'Content-Type':
              'application/json',

            ...(options.headers || {})
          },

          signal:
            controller.signal
        }
      );

    const body =
      await response.text();

    console.log(
      `[DISCORD] HTTP ${response.status} ${url}`
    );

    if (!response.ok) {
      throw new Error(
        `Discord API ${response.status}: ${body}`
      );
    }

    if (!body) {
      return null;
    }

    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Discord API timeout after ${timeout}ms: ${url}`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendDM({
  token,
  userId,
  content
}) {
  if (!token || !userId) {
    return {
      skipped: true,
      reason:
        'missing Discord secret or user id'
    };
  }

  if (!content) {
    return {
      skipped: true,
      reason:
        'empty Discord message'
    };
  }

  console.log(
    `[DISCORD] Opening DM channel for user ${userId}`
  );

  const channel =
    await discordRequest(
      token,
      '/users/@me/channels',
      {
        method: 'POST',

        body: JSON.stringify({
          recipient_id:
            userId
        })
      }
    );

  if (
    !channel ||
    !channel.id
  ) {
    throw new Error(
      'Discord API did not return a DM channel id'
    );
  }

  console.log(
    `[DISCORD] DM channel created/found: ${channel.id}`
  );

  const message =
    String(content).slice(
      0,
      2000
    );

  console.log(
    '[DISCORD] Sending message...'
  );

  const result =
    await discordRequest(
      token,
      `/channels/${channel.id}/messages`,
      {
        method: 'POST',

        body: JSON.stringify({
          content: message
        })
      }
    );

  console.log(
    '[DISCORD] Message sent successfully'
  );

  return result;
}

function formatUpdate({
  title,
  platform,
  lastModified,
  previousLastModified,
  changes,
  detectedAt,
  previousSize,
  currentSize
}) {
  const counts =
    changes.reduce(
      (acc, change) => {
        acc[change.type] =
          (acc[change.type] || 0) + 1;

        return acc;
      },
      {}
    );

  const displayTitle =
    getTitleDisplayName(title);

  const displayPlatform =
    getPlatformDisplayName(
      title,
      platform
    );

  const tunables =
    loadTunablesSummary(
      title,
      platform
    );

  const lines = [
    `**Tunables ${displayTitle} ${displayPlatform} Updated at ${formatDetectionTime(detectedAt)}**`
  ];

  if (
    tunables.eventWeekly !== null &&
    tunables.eventWeekly !== undefined
  ) {
    lines.push(
      `EVENT_WKLY: **${tunables.eventWeekly}**`
    );
  }

  if (
    tunables.tunableVersion !== null &&
    tunables.tunableVersion !== undefined
  ) {
    lines.push(
      `TUNABLE_VERSION: **${tunables.tunableVersion}**`
    );
  }

  lines.push(
    `Last modified: \`${lastModified || 'unknown'}\``,
    `Prev last modified: \`${previousLastModified || 'unknown'}\``,
    formatSizeLine(
      previousSize,
      currentSize
    ),
    `Changes: +${counts.added || 0} ~${counts.changed || 0} -${counts.removed || 0}`
  );

  return lines
    .filter(Boolean)
    .join('\n');
}

function formatFirstSeen({
  title,
  platform,
  lastModified,
  detectedAt,
  previousSize,
  currentSize
}) {
  const displayTitle =
    getTitleDisplayName(title);

  const displayPlatform =
    getPlatformDisplayName(
      title,
      platform
    );

  return [
    `**Tunables ${displayTitle} ${displayPlatform} First seen at ${formatDetectionTime(detectedAt)}**`,
    `Last modified: \`${lastModified || 'unknown'}\``,
    formatSizeLine(
      previousSize,
      currentSize
    )
  ]
    .filter(Boolean)
    .join('\n');
}

function formatRecovery({
  title,
  platform,
  lastModified,
  detectedAt
}) {
  const displayTitle =
    getTitleDisplayName(title);

  const displayPlatform =
    getPlatformDisplayName(
      title,
      platform
    );

  return [
    `**Tunables ${displayTitle} ${displayPlatform} Available Again at ${formatDetectionTime(detectedAt)}**`,
    `Last modified: \`${lastModified || 'unknown'}\``
  ]
    .filter(Boolean)
    .join('\n');
}

function formatBackgroundNewBuild({
  title,
  platform,
  build,
  previousBuild
}) {
  const displayTitle =
    getTitleDisplayName(title);

  const displayPlatform =
    getBackgroundPlatformDisplayName(
      platform
    );

  return [
    `**New ${displayTitle} ${displayPlatform} Build detected**`,
    `${build} (previous ${previousBuild})`
  ].join('\n');
}

function formatBackgroundFirstSeen({
  title,
  platform,
  detectedAt,
  lastModified,
  build,
  previousSize,
  currentSize
}) {
  const displayTitle =
    getTitleDisplayName(title);

  const displayPlatform =
    getBackgroundPlatformDisplayName(
      platform
    );

  return [
    `**Background Script ${displayTitle} ${displayPlatform} First seen at ${formatDetectionTime(detectedAt)}**`,
    `Last modified: \`${lastModified || 'unknown'}\``,
    `Build: ${build}`,
    formatSizeLine(
      previousSize,
      currentSize
    )
  ]
    .filter(Boolean)
    .join('\n');
}

function formatBackgroundUpdated({
  title,
  platform,
  detectedAt,
  lastModified,
  previousLastModified,
  build,
  previousSize,
  currentSize
}) {
  const displayTitle =
    getTitleDisplayName(title);

  const displayPlatform =
    getBackgroundPlatformDisplayName(
      platform
    );

  return [
    `**Background Script ${displayTitle} ${displayPlatform} Updated at ${formatDetectionTime(detectedAt)}**`,
    `Last modified: \`${lastModified || 'unknown'}\``,
    `Prev last modified: \`${previousLastModified || 'unknown'}\``,
    `Build: ${build}`,
    formatSizeLine(
      previousSize,
      currentSize
    )
  ]
    .filter(Boolean)
    .join('\n');
}

function formatNewswireArticle({
  title,
  url,
  date,
  lastModified,
  detectedAt
}) {
  const safeTitle =
    String(
      title || 'Unknown article'
    );

  /*
   * Some previously generated notifications can contain
   * a Markdown link title after the URL:
   *
   * [Title](https://example.com "Title")
   *
   * Discord interprets the quoted part as a Markdown
   * link title. We only want the clean URL.
   */
  const safeUrl =
    String(
      url || ''
    )
      .trim()
      .replace(
        /\s+["'][\s\S]*["']\s*$/,
        ''
      )
      .replace(
        /\s+\([\s\S]*\)\s*$/,
        ''
      )
      .trim();

  const titleLink =
    safeUrl
      ? `[${safeTitle}](${safeUrl})`
      : safeTitle;

  const posted =
    formatNewswirePostedTime(date);

  return [
    `**New post detected at ${formatDetectionTime(detectedAt)}**`,
    `Posted on **${posted}**`,
    `Last modified **${formatNewswireDate(lastModified)}**`,
    titleLink
  ].join('\n');
}

module.exports = {
  sendDM,
  formatUpdate,
  formatFirstSeen,
  formatRecovery,
  formatBackgroundNewBuild,
  formatBackgroundFirstSeen,
  formatBackgroundUpdated,
  formatNewswireArticle
};
