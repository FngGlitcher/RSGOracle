async function discordRequest(token, url, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${url}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API ${response.status}: ${body}`);
  }
  return response.json();
}

async function sendDM({ token, userId, content }) {
  if (!token || !userId) return { skipped: true, reason: 'missing Discord secret or user id' };

  const channel = await discordRequest(token, '/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: userId })
  });

  return discordRequest(token, `/channels/${channel.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: content.slice(0, 2000) })
  });
}

function discordLinks({ changelogUrl, fileUrl }) {
  const links = [];
  if (changelogUrl) links.push(`[View changelog](${changelogUrl})`);
  if (fileUrl) links.push(`[View current file](${fileUrl})`);
  return links.join(' • ');
}

function formatUpdate({ title, platform, lastModified, changes, changelogUrl }) {
  const counts = changes.reduce((acc, x) => {
    acc[x.type] = (acc[x.type] || 0) + 1;
    return acc;
  }, {});
  return [
    `🔄 **Tunables ${title.toUpperCase()} ${platform.toUpperCase()} Updated**`,
    `Last modified: \`${lastModified || 'unknown'}\``,
    `Changes: +${counts.added || 0} ~${counts.changed || 0} -${counts.removed || 0}`,
    discordLinks({ changelogUrl })
  ].filter(Boolean).join('\n');
}

function formatFirstSeen({ title, platform, lastModified, changelogUrl }) {
  return [
    `🆕 **Tunables ${title.toUpperCase()} ${platform.toUpperCase()} First seen**`,
    `Last modified: \`${lastModified || 'unknown'}\``,
    `This endpoint is now available and has entered the normal processing pipeline.`,
    discordLinks({ changelogUrl })
  ].filter(Boolean).join('\n');
}

function formatRecovery({ title, platform, lastModified, fileUrl }) {
  return [
    `🟢 **Tunables ${title.toUpperCase()} ${platform.toUpperCase()} Available Again**`,
    `Last modified: \`${lastModified || 'unknown'}\``,
    discordLinks({ fileUrl })
  ].filter(Boolean).join('\n');
}

module.exports = { sendDM, formatUpdate, formatFirstSeen, formatRecovery };
