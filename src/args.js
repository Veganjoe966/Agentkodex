'use strict';

const BOOLEAN_FLAGS = new Set([
  'all',
  'cockpit',
  'closeStdin',
  'empty',
  'events',
  'force',
  'fromStart',
  'help',
  'json',
  'local',
  'authEnabled',
  'authRequired',
  'noInitialPrompt',
  'noFinalize',
  'open',
  'pty',
  'quiet',
  'raw',
  'sendPrompt',
  'session',
  'skipAgent',
  'stdin',
  'unsafePublic',
  'wait',
  'watch',
  'y',
  'yes',
]);

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = normalizeArg(argv[i]);

    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const eqIndex = token.indexOf('=');
      if (eqIndex !== -1) {
        const key = token.slice(2, eqIndex);
        const value = token.slice(eqIndex + 1);
        setFlag(flags, key, value);
        continue;
      }

      const key = token.slice(2);
      const normalized = normalizeKey(key);
      if (BOOLEAN_FLAGS.has(normalized)) {
        setFlag(flags, key, true);
        continue;
      }
      const next = normalizeArg(argv[i + 1]);
      if (next && !next.startsWith('-')) {
        setFlag(flags, key, next);
        i += 1;
      } else {
        setFlag(flags, key, true);
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const letters = token.slice(1).split('');
      for (const letter of letters) setFlag(flags, letter, true);
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}

function normalizeArg(value) {
  return String(value || '').replace(/^–+/, '--');
}

function setFlag(flags, key, value) {
  const normalized = normalizeKey(key);
  if (Object.prototype.hasOwnProperty.call(flags, normalized)) {
    if (!Array.isArray(flags[normalized])) flags[normalized] = [flags[normalized]];
    flags[normalized].push(value);
  } else {
    flags[normalized] = value;
  }
}

function normalizeKey(key) {
  return String(key).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function booleanFlag(flags, name, defaultValue = false) {
  if (!Object.prototype.hasOwnProperty.call(flags, name)) return defaultValue;
  const value = flags[name];
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
  return Boolean(value);
}

function stringFlag(flags, name, defaultValue = '') {
  const value = flags[name];
  if (value === undefined || value === true || value === false) return defaultValue;
  if (Array.isArray(value)) return String(value[value.length - 1]);
  return String(value);
}

function listFlag(flags, name, defaultValue = []) {
  const value = flags[name];
  if (value === undefined || value === true || value === false) return defaultValue;
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

module.exports = {
  parseArgs,
  booleanFlag,
  stringFlag,
  listFlag,
};
