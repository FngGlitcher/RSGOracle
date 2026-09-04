const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const configPath = path.join(
  ROOT,
  'config',
  'config.json'
);

function loadConfig() {
  return JSON.parse(
    fs.readFileSync(
      configPath,
      'utf8'
    )
  );
}

function saveConfig(config) {
  fs.mkdirSync(
    path.dirname(configPath),
    {
      recursive: true
    }
  );

  const tmp =
    `${configPath}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      config,
      null,
      2
    ) + '\n',
    'utf8'
  );

  fs.renameSync(
    tmp,
    configPath
  );
}

function getTargets(config) {
  const targets = [];

  for (const [
    title,
    titleConfig
  ] of Object.entries(
    config.titles || {}
  )) {
    if (!titleConfig.enabled) {
      continue;
    }

    for (const [
      platform,
      endpoint
    ] of Object.entries(
      titleConfig.endpoints || {}
    )) {
      if (!endpoint.enabled) {
        continue;
      }

      const url =
        endpoint.url ||
        config.source.url_template
          .replaceAll(
            '{title}',
            title
          )
          .replaceAll(
            '{platform}',
            endpoint.platform_path ||
              platform
          )
          .replaceAll(
            '{asset}',
            config.source.asset
          );

      targets.push({
        title,
        platform,
        ...endpoint,
        url
      });
    }
  }

  return targets;
}

module.exports = {
  ROOT,
  loadConfig,
  saveConfig,
  getTargets
};
