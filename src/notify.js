const fs = require('fs');
const path = require('path');
const { loadConfig, ROOT } = require('./lib/config');
const { sendDM, formatUpdate, formatFirstSeen, formatRecovery } = require('./lib/discord');

async function main() {
  const config = loadConfig();
  const file = path.join(ROOT, 'data', 'state', 'pending-notifications.json');
  if (!fs.existsSync(file)) return;

  const events = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.features.discord || !events.length) {
    fs.writeFileSync(file, '[]\n');
    return;
  }

  const token = process.env[config.discord.token_env];
  const userId = process.env[config.discord.user_id_env];
  if (!token || !userId) {
    console.log('Discord notification skipped: missing secret/user id.');
    return;
  }

  for (const event of events) {
    let content;
    if (event.event === 'updated') {
      content = formatUpdate({
        title: event.target.title,
        platform: event.target.platform,
        lastModified: event.metadata.last_modified,
        changes: event.changes,
        changelogUrl: event.changelogUrl
      });
    } else if (event.event === 'first_seen') {
      content = formatFirstSeen({
        title: event.target.title,
        platform: event.target.platform,
        lastModified: event.metadata.last_modified,
        changelogUrl: event.changelogUrl
      });
    } else if (event.event === 'recovery_wait') {
      content = formatRecovery({
        title: event.target.title,
        platform: event.target.platform,
        lastModified: event.metadata.last_modified,
        fileUrl: event.target.url
      });
    } else {
      continue;
    }
    await sendDM({ token, userId, content });
  }

  fs.writeFileSync(file, '[]\n');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
