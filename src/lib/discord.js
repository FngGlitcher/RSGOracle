const DISCORD_API_BASE =
  'https://discord.com/api/v10';

const DEFAULT_TIMEOUT =
  15000;

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

function formatDetectionTime(value) {
  if (!value) {
    return 'unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Europe/Paris'
  });
}

function formatSize(value) {
  return Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function formatSizeLine(previousSize, currentSize) {
  const previous = formatSize(previousSize);
  const current = formatSize(currentSize);

  if (previous === null || current === null) {
    return null;
  }

  const difference = current - previous;
  const sign = difference > 0 ? '+' : '';

  return `Size: ${previous} → ${current} bytes (${sign}${difference})`;
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
    options.timeout ?? DEFAULT_TIMEOUT;

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

  const displayPlatform =
    getPlatformDisplayName(
      title,
      platform
    );

  return [
    `**Tunables ${title} ${displayPlatform} Updated at ${formatDetectionTime(detectedAt)}**`,

    `Last modified: \`${lastModified || 'unknown'}\``,

    formatSizeLine(
      previousSize,
      currentSize
    ),

    `Changes: +${counts.added || 0} ~${counts.changed || 0} -${counts.removed || 0}`
  ]
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
  const displayPlatform =
    getPlatformDisplayName(
      title,
      platform
    );

  return [
    `**Tunables ${title} ${displayPlatform} First seen at ${formatDetectionTime(detectedAt)}**`,

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
  const displayPlatform =
    getPlatformDisplayName(
      title,
      platform
    );

  return [
    `**Tunables ${title} ${displayPlatform} Available Again at ${formatDetectionTime(detectedAt)}**`,

    `Last modified: \`${lastModified || 'unknown'}\``
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  sendDM,
  formatUpdate,
  formatFirstSeen,
  formatRecovery
};
