const fs = require('fs');
const path = require('path');

const {
  loadConfig,
  saveConfig,
  getTargets,
  ROOT
} = require('./lib/config');

const {
  loadState,
  saveState
} = require('./lib/state');

const {
  processTarget
} = require('./lib/processor');

const {
  processBackgroundScripts
} = require('./lib/background');

async function main() {
  const config =
    loadConfig();

  if (!config.enabled) {
    console.log(
      'Monitor disabled by config.'
    );

    return;
  }

  const state =
    loadState();

  const targets =
    getTargets(config);

  const notifications = [];

  let stateDirty = false;
  let configDirty = false;

  console.log(
    `Checking ${targets.length} configured targets...`
  );

  /*
   * Existing Tunables monitor
   */
  for (const target of targets) {
    try {
      console.log(
        `Starting ${target.title}/${target.platform}...`
      );

      const event =
        await processTarget(
          target,
          config,
          state
        );

      if (
        ![
          'unchanged',
          'unavailable'
        ].includes(
          event.event
        )
      ) {
        stateDirty = true;

        notifications.push({
          event:
            event.event,

          target:
            event.target,

          metadata:
            event.metadata,

          changes:
            event.changes || [],

          currentUrl:
            event.currentUrl ||
            null,

          changelogUrl:
            event.changelogUrl ||
            null
        });

        console.log(
          `${target.title}/${target.platform}: ${event.event}`
        );
      } else {
        if (
          event.event ===
          'recovery_wait'
        ) {
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
        console.error(
          error.stack
        );
      }

      process.exitCode = 1;
    }
  }

  /*
   * Background Scripts monitor
   */
  try {
    const background =
      await processBackgroundScripts(
        config,
        state
      );

    if (
      background.stateChanged
    ) {
      stateDirty = true;
    }

    if (
      background.configChanged
    ) {
      configDirty = true;
    }

    if (
      background.notifications.length
    ) {
      notifications.push(
        ...background.notifications
      );
    }
  } catch (error) {
    console.error(
      `[BACKGROUND] Fatal error: ${error.message}`
    );

    if (error.stack) {
      console.error(
        error.stack
      );
    }

    process.exitCode = 1;
  }

  /*
   * Save state
   */
  if (stateDirty) {
    saveState(state);

    console.log(
      'State saved.'
    );
  } else {
    console.log(
      'No state changes to save.'
    );
  }

  /*
   * Save updated Background Script build values
   */
  if (configDirty) {
    saveConfig(config);

    console.log(
      'Config saved.'
    );
  } else {
    console.log(
      'No config changes to save.'
    );
  }

  /*
   * Write all pending Discord notifications
   */
  const stateDir =
    path.join(
      ROOT,
      'data',
      'state'
    );

  fs.mkdirSync(
    stateDir,
    {
      recursive: true
    }
  );

  const notificationsPath =
    path.join(
      stateDir,
      'pending-notifications.json'
    );

  fs.writeFileSync(
    notificationsPath,
    JSON.stringify(
      notifications,
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(
    `Pending notifications written: ${notifications.length}`
  );
}

main().catch(error => {
  console.error(
    'Fatal error:',
    error
  );

  if (error.stack) {
    console.error(
      error.stack
    );
  }

  process.exit(1);
});
