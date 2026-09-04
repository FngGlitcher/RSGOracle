const assert = require('assert');
const crypto = require('crypto');
const { decryptTunables } = require('../src/lib/decrypt');

const keyHex = '00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF';
const plaintext = Buffer.from('{"tunables":{"ABCDEF01":[{"value":42}]}}');
const pad = (16 - (plaintext.length % 16)) % 16;
const padded = Buffer.concat([plaintext, Buffer.from(' '.repeat(pad))]);
const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(keyHex, 'hex'), null);
cipher.setAutoPadding(false);
const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
const output = decryptTunables(encrypted, keyHex);
assert.strictEqual(output.tunables.ABCDEF01[0].value, 42);
console.log('decrypt tests passed');
