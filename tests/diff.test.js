const assert = require('assert');
const { diffValues } = require('../src/lib/diff');

const result = diffValues(
  { tunables: { A: 1, B: 2 } },
  { tunables: { A: 3, C: 4 } }
);

assert(result.some(x => x.path === 'tunables.A' && x.type === 'changed'));
assert(result.some(x => x.path === 'tunables.B' && x.type === 'removed'));
assert(result.some(x => x.path === 'tunables.C' && x.type === 'added'));
console.log('diff tests passed');
