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
  formatBackgroundUpdated,
  formatTunableWatchUpdated,
  formatNewswireArticle
} = require('./lib/discord');

function formatNewswireApiChanged(
  metadata
) {
  const results =
    Array.isArray(
      metadata?.results
    )
      ? metadata.results
      : [];

  const lines = [
    '**NewswireList API output changed**',
    `Results: **${
      metadata?.count ??
      results.length
    }**`,
    ''
  ];

  for (
    const [
      index,
      article
    ] of results.entries()
  ) {
    lines.push(
      `### Result ${index + 1}`,
      `ID: \`${article?.id ?? 'null'}\``,
      `Title: ${article?.title || 'null'}`,
      `URL: ${article?.url || 'null'}`,
      `Created: ${article?.created || 'null'}`,
      `Tags: ${
        Array.isArray(article?.tags) &&
        article.tags.length
          ? article.tags.join(', ')
          : 'none'
      }`,
      `Image: ${
        article?.image ||
        'null'
      }`,
      ''
    );
  }

  return lines
    .join('\n')
    .trim();
}

function formatGtaPlusUpdated(
  metadata
) {
  const name =
    metadata?.name ||
    'GTA+ Website';

  const detectedAt =
    metadata?.detected_at ||
    new Date().toISOString();

  const lastModified =
    metadata?.last_modified ||
    'unknown';

  return [
    `**${name} update detected at ${formatDetectedTime(detectedAt)}**`,
    `Last modified ${lastModified}`
  ].join('\n');
}

function formatViTrackerChanged(
  metadata
) {
  const type =
    metadata?.type ||
    'first_seen';

  const url =
    metadata?.url ||
    '';

  const name =
    metadata?.name ||
    'GTA VI';

  const detectedAt =
    metadata?.detected_at ||
    new Date().toISOString();

  const detectedTime =
    formatDetectedTime(
      detectedAt
    );

  if (
    type ===
    'first_seen'
  ) {
    return [
      `**VI TRACKER DETECTED AT ${detectedTime}**`,
      `First seen **${name}**`,
      url
    ].join('\n');
  }

  if (
    type ===
    'updated'
  ) {
    return [
      `**VI TRACKER UPDATE DETECTED AT ${detectedTime}**`,
      `Updated **${name}**`,
      url
    ].join('\n');
  }

  return [
    `**VI TRACKER DETECTED AT ${detectedTime}**`,
    `**${name}**`,
    url
  ].join('\n');
}

function formatDetectedTime(
  value
) {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(
      value
    );
  }

  return date.toLocaleTimeString(
    'fr-FR',
    {
      hour:
        '2-digit',

      minute:
        '2-digit',

      second:
        '2-digit',

      hour12:
        false,

      timeZone:
        'Europe/Paris'
    }
  );
}

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

  if (
    !token ||
    !userId
  ) {
    console.log(
      'Discord notification skipped: missing secret/user id.'
    );

    return;
  }

  for (
    const event of events
  ) {
    const eventType =
      event?.event ||
      event?.type;

    let content;

    /*
     * Tunables updated
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

          lastModified:
            event.metadata.last_modified,

          previousLastModified:
            event.metadata
              .previous_last_modified,

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
      eventType ===
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
      eventType ===
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
     * BGSK tunable watch
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
            event.metadata
              .values,

          previousValues:
            event.metadata
              .previous_values,

          tunableVersion:
            event.metadata
              .tunable_version,

          previousTunableVersion:
            event.metadata
              .previous_tunable_version,

          lastModified:
            event.metadata
              .last_modified,

          previousLastModified:
            event.metadata
              .previous_last_modified,

          detectedAt:
            event.metadata
              .detected_at
        });
    }

    /*
     * Background Script new build
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
      eventType ===
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
      eventType ===
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
     * Rockstar Newswire new article
     */
    else if (
      eventType ===
        'newswire_new_post' ||
      eventType ===
        'newswire_new_article'
    ) {
      content =
        formatNewswireArticle({
          title:
            event.title,

          url:
            event.url,

          date:
            event.date,

          lastModified:
            event.last_modified,

          updatedAt:
            event.updated_at,

          detectedAt:
            event.detected_at
        });
    }

    /*
     * Independent NewswireList API monitor
     */
    else if (
      eventType ===
      'newswire_api_changed'
    ) {
      content =
        formatNewswireApiChanged(
          event.metadata
        );
    }

    /*
     * GTA+ tracker
     */
    else if (
      eventType ===
      'gta_plus_updated'
    ) {
      content =
        formatGtaPlusUpdated(
          event.metadata
        );
    }

    /*
     * GTA VI tracker
     */
    else if (
      eventType ===
      'vi_tracker_changed'
    ) {
      content =
        formatViTrackerChanged(
          event.metadata
        );
    }

    /*
     * Unknown event
     */
    else {
      console.log(
        `Unknown notification event skipped: ${eventType}`
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

main().catch(
  error => {
    console.error(
      error
    );

    process.exit(1);
  }
);
