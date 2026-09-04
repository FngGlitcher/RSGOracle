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
  console.log(`Checking ${targets.length} configured targets...`);

  for (const target of targets) {
    try {
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
        console.log(`${target.title}/${target.platform}: ${event.event}`);
      } else {
        if (event.event === 'recovery_wait') stateDirty = true;
        console.log(`${target.title}/${target.platform}: ${event.event}`);
      }
    } catch (error) {
      console.error(`${target.title}/${target.platform}: ERROR: ${error.message}`);
      process.exitCode = 1;
    }
  }

  if (stateDirty) saveState(state);
  fs.mkdirSync(path.join(ROOT, 'data', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'data', 'state', 'pending-notifications.json'),
    JSON.stringify(notifications, null, 2) + '\n'
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
