function joaat(input) {
  const buffer = Buffer.from(String(input).toLowerCase(), 'utf8');
  let hash = 0;

  for (const byte of buffer) {
    hash = (hash + byte) >>> 0;
    hash = (hash + ((hash << 10) >>> 0)) >>> 0;
    hash ^= hash >>> 6;
  }

  hash = (hash + ((hash << 3) >>> 0)) >>> 0;
  hash ^= hash >>> 11;
  hash = (hash + ((hash << 15) >>> 0)) >>> 0;

  return {
    unsigned: hash >>> 0,
    signed: hash | 0,
    hex: (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
  };
}

module.exports = joaat;
