const DISCORD_API_BASE =
  'https://discord.com/api/v10';

const DEFAULT_TIMEOUT =
  15000;

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

function discordLinks({
  changelogUrl,
  fileUrl
}) {
  const links = [];

  if (changelogUrl) {
    links.push(
      `[View changelog](${changelogUrl})`
    );
  }

  if (fileUrl) {
    links.push(
      `[View current file](${fileUrl})`
    );
  }

  return links.join(
    ' • '
  );
}

function formatUpdate({
  title,
  platform,
  lastModified,
  changes,
  changelogUrl
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

  return [
    `🔄 **Tunables ${title} ${platform} Updated**`,

    `Last modified: \`${lastModified || 'unknown'}\``,

    `Changes: +${counts.added || 0} ~${counts.changed || 0} -${counts.removed || 0}`,

    discordLinks({
      changelogUrl
    })
  ]
    .filter(Boolean)
    .join('\n');
}

function formatFirstSeen({
  title,
  platform,
  lastModified,
  changelogUrl
}) {
  return [
    `🆕 **Tunables ${title} ${platform} First seen**`,

    `Last modified: \`${lastModified || 'unknown'}\``,

    'This endpoint is now available and has entered the normal processing pipeline.',

    discordLinks({
      changelogUrl
    })
  ]
    .filter(Boolean)
    .join('\n');
}

function formatRecovery({
  title,
  platform,
  lastModified,
  fileUrl
}) {
  return [
    `🟢 **Tunables ${title} ${platform} Available Again**`,

    `Last modified: \`${lastModified || 'unknown'}\``,

    discordLinks({
      fileUrl
    })
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
