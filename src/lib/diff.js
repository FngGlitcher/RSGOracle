function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function diffValues(oldValue, newValue, path = '') {
  const changes = [];

  if (Object.is(oldValue, newValue)) return changes;

  if (Array.isArray(oldValue) || Array.isArray(newValue)) {
    const max = Math.max(oldValue?.length || 0, newValue?.length || 0);
    for (let i = 0; i < max; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= (oldValue?.length || 0)) {
        changes.push({ type: 'added', path: childPath, oldValue: undefined, newValue: newValue[i] });
      } else if (i >= (newValue?.length || 0)) {
        changes.push({ type: 'removed', path: childPath, oldValue: oldValue[i], newValue: undefined });
      } else {
        changes.push(...diffValues(oldValue[i], newValue[i], childPath));
      }
    }
    return changes;
  }

  if (isObject(oldValue) && isObject(newValue)) {
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    for (const key of [...keys].sort()) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in oldValue)) {
        changes.push({ type: 'added', path: childPath, oldValue: undefined, newValue: newValue[key] });
      } else if (!(key in newValue)) {
        changes.push({ type: 'removed', path: childPath, oldValue: oldValue[key], newValue: undefined });
      } else {
        changes.push(...diffValues(oldValue[key], newValue[key], childPath));
      }
    }
    return changes;
  }

  changes.push({ type: 'changed', path, oldValue, newValue });
  return changes;
}

function compactValue(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function markdownDiff(changes, maxEntries = 300) {
  if (!changes.length) return '_No tunable differences detected._\n';

  const lines = [
    `| Type | Tunable / path | Previous | Current |`,
    `|---|---|---|---|`
  ];

  for (const change of changes.slice(0, maxEntries)) {
    lines.push(
      `| ${change.type} | \`${change.path}\` | ${compactValue(change.oldValue).replaceAll('|', '\\|')} | ${compactValue(change.newValue).replaceAll('|', '\\|')} |`
    );
  }

  if (changes.length > maxEntries) {
    lines.push('', `> ${changes.length - maxEntries} additional changes omitted from this rendered table.`);
  }

  return lines.join('\n') + '\n';
}

module.exports = { diffValues, markdownDiff };
