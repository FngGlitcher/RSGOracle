const {
  loadConfig,
  getEnabledDiscordTargets
} = require('./lib/config');

const {
  loadState,
  saveState
} = require('./lib/state');

const {
  sendDM,
  formatUpdate,
  formatFirstSeen,
  formatRecovery,
  formatBackgroundNewBuild,
  formatBackgroundFirstSeen,
  formatBackgroundUpdated,
  formatTunableWatchUpdated,
  formatNewswireArticle
} = require('./lib/discord');

const {
  readJson
} = require('./lib/utils');

const path =
  require('path');

const {
  ROOT
} = require('./lib/config');

const pendingPath =
  path.join(
    ROOT,
    'data',
    'pending-notifications.json'
  );

async function main() {
  const config =
    loadConfig();

  const state =
    loadState();

  if (
    !require('fs').existsSync(
      pendingPath
    )
  ) {
    console.log(
      'No pending notifications.'
    );

    return;
  }

  const pending =
    readJson(
      pendingPath
    );

  if (
    !Array.isArray(pending) ||
    pending.length === 0
  ) {
    console.log(
      'No pending notifications.'
    );

    return;
  }

  const discordTargets =
    getEnabledDiscordTargets(
      config
    );

  if (
    discordTargets.length === 0
  ) {
    console.log(
      'No enabled Discord targets.'
    );

    return;
  }

  for (
    const event of pending
  ) {
    const eventType =
      event.event;

    let content =
      null;

    /*
     * Normal Tunables update
     */
    if (
      eventType ===
      'updated'
    ) {
      content =
        formatUpdate({
          title:
            event.target.title,

          platform:
            event.target.platform,

          changes:
            event.changes,

          detectedAt:
            event.metadata
              ?.detected_at
        });
    }

    /*
     * First seen
     */
    else if (
      eventType ===
      'first_seen'
    ) {
      content =
        formatFirstSeen({
          title:
            event.target.title,

          platform:
            event.target.platform,

          detectedAt:
            event.metadata
              ?.detected_at
        });
    }

    /*
     * Recovery
     */
    else if (
      eventType ===
      'recovery'
    ) {
      content =
        formatRecovery({
          title:
            event.target.title,

          platform:
            event.target.platform,

          detectedAt:
            event.metadata
              ?.detected_at
        });
    }

    /*
     * Background new build
     */
    else if (
      eventType ===
      'background_new_build'
    ) {
      content =
        formatBackgroundNewBuild({
          title:
            event.target.title,

          platform:
            event.target.platform,

          metadata:
            event.metadata
        });
    }

    /*
     * Background first seen
     */
    else if (
      eventType ===
      'background_first_seen'
    ) {
      content =
        formatBackgroundFirstSeen({
          title:
            event.target.title,

          platform:
            event.target.platform,

          metadata:
            event.metadata
        });
    }

    /*
     * Background updated
     */
    else if (
      eventType ===
      'background_updated'
    ) {
      content =
        formatBackgroundUpdated({
          title:
            event.target.title,

          platform:
            event.target.platform,

          metadata:
            event.metadata
        });
    }

    /*
     * BGSK Tunable Watch
     *
     * The BGSK snapshot is stored on
     * event.tunableWatch, not event.metadata.
     */
    else if (
      eventType ===
      'tunable_watch_updated'
    ) {
      content =
        formatTunableWatchUpdated({
          title:
            event.target.title,

          platform:
            event.target.platform,

          values:
            event.tunableWatch
              ?.values,

          previousValues:
            event.tunableWatch
              ?.previous_values,

          tunableVersion:
            event.tunableWatch
              ?.tunable_version,

          previousTunableVersion:
            event.tunableWatch
              ?.previous_tunable_version,

          lastModified:
            event.tunableWatch
              ?.last_modified,

          previousLastModified:
            event.tunableWatch
              ?.previous_last_modified,

          detectedAt:
            event.metadata
              ?.detected_at
        });
    }

    /*
     * Newswire article
     */
    else if (
      eventType ===
      'newswire_article'
    ) {
      content =
        formatNewswireArticle({
          article:
            event.article
        });
    }

    if (
      !content
    ) {
      console.log(
        `Skipping unsupported event: ${eventType}`
      );

      continue;
    }

    for (
      const target of discordTargets
    ) {
      try {
        await sendDM(
          target,
          content
        );

        console.log(
          `Notification sent: ${eventType}`
        );
      } catch (
        error
      ) {
        console.error(
          `Failed to send notification: ${eventType}`,
          error
        );
      }
    }
  }

  /*
   * Notifications were processed.
   */
  require('fs').unlinkSync(
    pendingPath
  );

  saveState(
    state
  );

  console.log(
    'Pending notifications processed.'
  );
}

main()
  .catch(
    error => {
      console.error(
        error
      );

      process.exit(
        1
      );
    }
  );
