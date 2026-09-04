const fs = require('fs');
const path = require('path');

const {
  loadConfig,
  ROOT
} = require('./lib/config');

const {
  sendDM,
  formatUpdate,
  formatFirstSeen,
  formatRecovery,
  formatBackgroundNewBuild,
  formatBackgroundFirstSeen,
  formatBackgroundUpdated
} = require('./lib/discord');

async function main() {
  const config =
    loadConfig();

  const file =
    path.join(
      ROOT,
      'data',
      'state',
      'pending-notifications.json'
    );

  if (!fs.existsSync(file)) {
    return;
  }

  const events =
    JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
      )
    );

  if (
    !config.features.discord ||
    !events.length
  ) {
    fs.writeFileSync(
      file,
      '[]\n'
    );

    return;
  }

  const token =
    process.env[
      config.discord.token_env
    ];

  const userId =
    process.env[
      config.discord.user_id_env
    ];

  if (!token || !userId) {
    console.log(
      'Discord notification skipped: missing secret/user id.'
    );

    return;
  }

  for (const event of events) {
    let content;

    /*
     * Tunables updated
     */
    if (
      event.event ===
      'updated'
    ) {
      content =
        formatUpdate({
          title:
            event.target.title,

          platform:
            event.target.platform,

          lastModified:
            event.metadata.last_modified,

          changes:
            event.changes,

          detectedAt:
            event.metadata.detected_at,

          previousSize:
            event.metadata
              .previous_content_length,

          currentSize:
            event.metadata
              .content_length
        });
    }

    /*
     * Tunables first seen
     */
    else if (
      event.event ===
      'first_seen'
    ) {
      content =
        formatFirstSeen({
          title:
            event.target.title,

          platform:
            event.target.platform,

          lastModified:
            event.metadata.last_modified,

          detectedAt:
            event.metadata.detected_at,

          previousSize:
            event.metadata
              .previous_content_length,

          currentSize:
            event.metadata
              .content_length
        });
    }

    /*
     * Tunables recovery
     */
    else if (
      event.event ===
      'recovery_wait'
    ) {
      content =
        formatRecovery({
          title:
            event.target.title,

          platform:
            event.target.platform,

          lastModified:
            event.metadata.last_modified,

          detectedAt:
            event.metadata.detected_at
        });
    }

    /*
     * Background Script new build
     */
    else if (
      event.event ===
      'background_new_build'
    ) {
      content =
        formatBackgroundNewBuild({
          title:
            event.target.title,

          platform:
            event.target.platform,

          build:
            event.metadata.build,

          previousBuild:
            event.metadata.previous_build
        });
    }

    /*
     * Background Script first seen
     */
    else if (
      event.event ===
      'background_first_seen'
    ) {
      content =
        formatBackgroundFirstSeen({
          title:
            event.target.title,

          platform:
            event.target.platform,

          detectedAt:
            event.metadata.detected_at,

          lastModified:
            event.metadata.last_modified,

          build:
            event.metadata.build,

          previousSize:
            event.metadata
              .previous_content_length,

          currentSize:
            event.metadata
              .content_length
        });
    }

    /*
     * Background Script updated
     */
    else if (
      event.event ===
      'background_updated'
    ) {
      content =
        formatBackgroundUpdated({
          title:
            event.target.title,

          platform:
            event.target.platform,

          detectedAt:
            event.metadata.detected_at,

          lastModified:
            event.metadata.last_modified,

          previousLastModified:
            event.metadata
              .previous_last_modified,

          build:
            event.metadata.build,

          previousSize:
            event.metadata
              .previous_content_length,

          currentSize:
            event.metadata
              .content_length
        });
    }

    /*
     * Unknown event
     */
    else {
      console.log(
        `Unknown notification event skipped: ${event.event}`
      );

      continue;
    }

    await sendDM({
      token,
      userId,
      content
    });
  }

  fs.writeFileSync(
    file,
    '[]\n'
  );
}

main().catch(error => {
  console.error(
    error
  );

  process.exit(1);
});
