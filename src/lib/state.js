const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const stateDir = path.join(ROOT, 'data', 'state');
const stateFile = path.join(stateDir, 'state.json');

function loadState() {
  fs.mkdirSync(stateDir, { recursive: true });
  if (!fs.existsSync(stateFile)) return { targets: {} };
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, stateFile);
}

function targetId(target) {
  return `${target.title}/${target.platform}`;
}

module.exports = { loadState, saveState, targetId };
