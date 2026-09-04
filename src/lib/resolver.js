const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');
const joaat = require('./joaat');
const { request } = require('./http');

const cacheDir = path.join(ROOT, 'data', 'cache');
const dictionaryPath = path.join(cacheDir, 'dictionary.json');

const CONTEXTS = [
  'CONTENT_MODIFIER_0','CONTENT_MODIFIER_1','CONTENT_MODIFIER_2','CONTENT_MODIFIER_3','CONTENT_MODIFIER_4',
  'CONTENT_MODIFIER_MEMBERSHIP_0','CONTENT_MODIFIER_MEMBERSHIP_1','CONTENT_MODIFIER_MEMBERSHIP_2',
  'CONTENT_MODIFIER_MEMBERSHIP_3','CONTENT_MODIFIER_MEMBERSHIP_4','BASE_GLOBALS','CD_GLOBAL','MP_Global',
  'MP_FM_MEMBERSHIP','MP_CNC_TEAM_COP','MP_CNC_TEAM_VAGOS','MP_CNC_TEAM_LOST','MP_FM','MP_FM_DM',
  'MP_FM_RACES','MP_FM_RACES_CAR','MP_FM_RACES_BIKE','MP_FM_RACES_CYCLE','MP_FM_RACES_AIR',
  'MP_FM_RACES_SEA','MP_FM_RACES_STUNT','MP_FM_MISSIONS','MP_FM_SURVIVAL','MP_FM_BASEJUMP',
  'MP_FM_CAPTURE','MP_FM_LTS','MP_FM_HEIST','MP_FM_CONTACT','MP_FM_RANDOM','MP_FM_VERSUS',
  'MP_FM_GANG_ATTACK','MP_FMADVERSARY'
];

async function text(url) {
  const response = await request(url);
  if (!response.ok) throw new Error(`Dictionary HTTP ${response.status}: ${url}`);
  return response.text();
}

function addSum(a, b) {
  return (parseInt(a, 16) + parseInt(b, 16)).toString(16).toUpperCase();
}

async function buildDictionary(config) {
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!config.resolver.download_dictionaries && fs.existsSync(dictionaryPath)) {
    return JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
  }

  const [namesText, gtaText, labelsText, jobsText] = await Promise.all([
    text(config.resolver.tunable_names_url),
    text(config.resolver.gta_dictionary_url),
    text(config.resolver.gta_labels_url),
    text(config.resolver.jobs_dictionary_url)
  ]);

  const contexts = Object.fromEntries(CONTEXTS.map(context => [context, joaat(context)]));
  const tunables = {};
  for (const line of namesText.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
    const hash = joaat(line).hex;
    tunables[line] = { hash, sum: {} };
    for (const context of CONTEXTS) tunables[line].sum[context] = addSum(hash, contexts[context].hex);
  }

  const other = {};
  for (const line of gtaText.split(/\r?\n/).filter(Boolean)) {
    const [hash, key] = line.split(/\t/);
    if (key) other[key] = hash;
  }
  for (const line of labelsText.split(/\r?\n/).filter(Boolean)) {
    other[line] = String(joaat(line).signed);
  }

  let jobs = {};
  try {
    jobs = JSON.parse(jobsText);
    jobs = Object.fromEntries(
      Object.entries(jobs).map(([key, value]) => [String(joaat(key.toLowerCase()).signed), value])
    );
  } catch {
    jobs = {};
  }

  const dictionary = { contexts, tunables, other, jobs };
  fs.writeFileSync(dictionaryPath, JSON.stringify(dictionary));
  return dictionary;
}

function makeResolver(dictionary, platform) {
  const cache = new Map();
  const tunableByContext = Object.fromEntries(
    Object.keys(dictionary.contexts).map(context => [context, new Map()])
  );

  for (const [name, data] of Object.entries(dictionary.tunables)) {
    for (const [context, sum] of Object.entries(data.sum)) {
      const normalizedSum = sum.replace(/^0x/i, '').toUpperCase();
      for (let i = 0; i <= normalizedSum.length - 8; i++) {
        const fragment = normalizedSum.slice(i, i + 8);
        if (/^[0-9A-F]{8}$/.test(fragment) && !tunableByContext[context].has(fragment)) {
          tunableByContext[context].set(fragment, name);
        }
      }
    }
    cache.set(data.hash.toUpperCase(), { tunableKey: name, contextKey: null });
  }

  function stripHex(key) {
    return String(key).replace(/^_?0x/i, '').toUpperCase();
  }

  function jobName(value) {
    return dictionary.jobs[String(value)] || value;
  }

  function resolveValue(value) {
    if (typeof value !== 'number') return value;
    for (const [key, hash] of Object.entries(dictionary.other)) {
      if (String(hash) === String(value)) return key.toUpperCase();
    }
    return value;
  }

  function save(result, context, key, value) {
    if (!result[context]) result[context] = {};
    result[context][key] = value;
  }

  let previousContext = null;

  function lookup(key, value, missingName = false) {
    const normalized = stripHex(key);
    if (normalized === '8B7D3320') return false;

    if (normalized === '52BDAF86') {
      save(result, 'MP_Global', '_0x19EEFD4F', value);
      return true;
    }

    const numericValue = resolveValue(value);
    const direct = cache.get(normalized);
    if (direct && direct.contextKey) {
      const finalValue = direct.tunableKey.includes('ROOT_CONTENT_ID')
        ? jobName(numericValue)
        : numericValue;
      save(result, direct.contextKey, direct.tunableKey, finalValue);
      return true;
    }

    if (previousContext) {
      const contextKey = previousContext.contextKey;
      const contextValue = previousContext.contextValue;
      if (missingName) {
        const signed = parseInt(normalized, 16) - contextValue.signed;
        const reversed = `_0x${(signed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
        save(result, contextKey, reversed, numericValue);
        cache.set(normalized, { tunableKey: reversed, contextKey });
        return true;
      }

      const dictionaryKey = tunableByContext[contextKey]?.get(normalized);
      if (dictionaryKey) {
        const finalValue = dictionaryKey.includes('ROOT_CONTENT_ID')
          ? jobName(numericValue)
          : numericValue;
        save(result, contextKey, dictionaryKey, finalValue);
        cache.set(normalized, { tunableKey: dictionaryKey, contextKey });
        previousContext = { contextKey, contextValue };
        return true;
      }
    }

    for (const [contextKey, contextValue] of Object.entries(dictionary.contexts)) {
      if (platform !== 'ps5' && platform !== 'xboxsx' && contextKey === 'MP_FM_MEMBERSHIP') continue;

      if (missingName && !contextKey.includes('_MODIFIER_')) {
        const signed = parseInt(normalized, 16) - contextValue.signed;
        const reversed = `_0x${(signed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
        save(result, contextKey, reversed, numericValue);
        cache.set(normalized, { tunableKey: reversed, contextKey });
        previousContext = { contextKey, contextValue };
        return true;
      }

      const dictionaryKey = tunableByContext[contextKey]?.get(normalized);
      if (dictionaryKey) {
        const finalValue = dictionaryKey.includes('ROOT_CONTENT_ID')
          ? jobName(numericValue)
          : numericValue;
        save(result, contextKey, dictionaryKey, finalValue);
        cache.set(normalized, { tunableKey: dictionaryKey, contextKey });
        previousContext = { contextKey, contextValue };
        return true;
      }
    }

    return false;
  }

  let result = {};
  return {
    resolve(input) {
      result = {};
      const source = input.tunables || {};
      let decrypted = 0;

      for (const [key, value] of Object.entries(source)) {
        if (!lookup(key, value, false)) {
          if (!lookup(key, value, true)) {
            save(result, 'UNKNOWN', stripHex(key), resolveValue(value));
          } else decrypted++;
        } else decrypted++;
      }

      return {
        ...input,
        tunables: result,
        _resolver: {
          decrypted,
          encrypted: Object.keys(source).length,
          unknown: Object.keys(result.UNKNOWN || {}).length
        }
      };
    }
  };
}

async function getResolver(config, platform) {
  if (!config.resolver.enabled) return null;
  const dictionary = await buildDictionary(config);
  return makeResolver(dictionary, platform);
}

module.exports = { getResolver, CONTEXTS };
