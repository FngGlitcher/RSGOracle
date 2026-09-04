const fs = require('fs');
const path = require('path');
const { loadConfig, getTargets, ROOT } = require('./lib/config');
const { loadState, saveState } = require('./lib/state');
const { processTarget } = require('./lib/processor');

async function main() {
  const config = loadConfig();

  if (!config.enabled) {
    console.log('Monitor disabled by config.');
    return;
  }

  const state = loadState();
  const targets = getTargets(config);
  const notifications = [];

  let stateDirty = false;

  console.log(`Checking ${targets.length} configured targets...`);

  for (const target of targets) {
    try {
      console.log(
        `Starting ${target.title}/${target.platform}...`
      );

      const event = await processTarget(target, config, state);

      if (!['unchanged', 'unavailable'].includes(event.event)) {
        stateDirty = true;

        notifications.push({
          event: event.event,
          target: event.target,
          metadata: event.metadata,
          changes: event.changes || [],
          currentUrl: event.currentUrl || null,
          changelogUrl: event.changelogUrl || null
        });

        console.log(
          `${target.title}/${target.platform}: ${event.event}`
        );
      } else {
        if (event.event === 'recovery_wait') {
          stateDirty = true;
        }

        console.log(
          `${target.title}/${target.platform}: ${event.event}`
        );
      }
    } catch (error) {
      console.error(
        `${target.title}/${target.platform}: ERROR: ${error.message}`
      );

      if (error.stack) {
        console.error(error.stack);
      }

      process.exitCode = 1;
    }
  }

  if (stateDirty) {
    saveState(state);
    console.log('State saved.');
  } else {
    console.log('No state changes to save.');
  }

  const stateDir = path.join(ROOT, 'data', 'state');

  fs.mkdirSync(stateDir, {
    recursive: true
  });

  const notificationsPath = path.join(
    stateDir,
    'pending-notifications.json'
  );

  fs.writeFileSync(
    notificationsPath,
    JSON.stringify(notifications, null, 2) + '\n',
    'utf8'
  );

  console.log(
    `Pending notifications written: ${notifications.length}`
  );
}

main().catch(error => {
  console.error('Fatal error:', error);

  if (error.stack) {
    console.error(error.stack);
  }

  process.exit(1);
});
