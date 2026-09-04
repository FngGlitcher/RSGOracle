const crypto = require('crypto');

const DEFAULT_KEY =
  'F06F12F49B843DADE4A7BE053505B19C9E415C95D93753450A269144D59A0115';

function decryptTunables(
  buffer,
  keyHex = DEFAULT_KEY
) {
  const key =
    Buffer.from(
      keyHex,
      'hex'
    );

  if (
    ![16, 24, 32].includes(
      key.length
    )
  ) {
    throw new Error(
      `Invalid AES key length: ${key.length}`
    );
  }

  const encryptedLength =
    buffer.length -
    (buffer.length % 16);

  const cipher =
    crypto.createDecipheriv(
      `aes-${key.length * 8}-ecb`,
      key,
      null
    );

  cipher.setAutoPadding(false);

  const decrypted =
    Buffer.concat([
      cipher.update(
        buffer.subarray(
          0,
          encryptedLength
        )
      ),
      cipher.final()
    ]);

  const text =
    decrypted.toString('utf8') +
    buffer
      .subarray(encryptedLength)
      .toString('utf8');

  return JSON.parse(text);
}

function normalizeTunables(
  output,
  platform
) {
  if (
    ['ps3', 'xbox360'].includes(
      platform.toLowerCase()
    )
  ) {
    return output;
  }

  return {
    ...output,

    tunables:
      Object.fromEntries(
        Object.entries(
          output.tunables || {}
        ).map(
          ([key, value]) => [
            `_0x${key.replace(
              /^_?0x/i,
              ''
            )}`,

            Array.isArray(value) &&
            value.length
              ? value[0].value
              : value
          ]
        )
      )
  };
}

module.exports = {
  DEFAULT_KEY,
  decryptTunables,
  normalizeTunables
};
