const assert = require('assert');
const joaat = require('../src/lib/joaat');

assert.strictEqual(joaat('hello').hex, 'C8FD181B');
assert.strictEqual(joaat('BASE_GLOBALS').hex, '0B5EE873');
console.log('joaat tests passed');
