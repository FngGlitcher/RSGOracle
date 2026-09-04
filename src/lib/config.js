const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const configPath = path.join(ROOT, 'config', 'config.json');

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config;
}

function getTargets(config) {
  const targets = [];
  for (const [title, titleConfig] of Object.entries(config.titles || {})) {
    if (!titleConfig.enabled) continue;
    for (const [platform, endpoint] of Object.entries(titleConfig.endpoints || {})) {
      if (!endpoint.enabled) continue;
      const url = endpoint.url ||
        config.source.url_template
          .replaceAll('{title}', title)
          .replaceAll('{platform}', endpoint.platform_path || platform)
          .replaceAll('{asset}', config.source.asset);
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

module.exports = { ROOT, loadConfig, getTargets };
