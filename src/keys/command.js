'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { keyStatus, rotateCapabilityKey, retireCapabilityKey } = require('../capabilities/keys');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function keysCommand(argv) {
  const [sub = 'status', ...rest] = normalizeDashes(argv);
  const { flags, positionals } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  try {
    if (sub === 'status') return output(keyStatus(root), flags, renderStatus);
    if (sub === 'list') return output({ verificationKeys: keyStatus(root).verificationKeys }, flags, renderList);
    if (sub === 'rotate') {
      const key = rotateCapabilityKey(root, { reason: stringFlag(flags, 'reason', 'manual') });
      return output({ rotated: true, activeKey: safeKey(key) }, flags, renderRotate);
    }
    if (sub === 'retire') {
      const keyId = positionals[0] || stringFlag(flags, 'keyId', stringFlag(flags, 'key-id', ''));
      if (!keyId) throw new Error('Missing key id. Example: agentkodex keys retire ak_...');
      return output({ retired: true, key: retireCapabilityKey(root, keyId) }, flags, renderRetire);
    }
    throw new Error(`Unknown keys subcommand: ${sub}`);
  } catch (error) {
    console.error(`Agentkodex key error: ${error.message}`);
    process.exitCode = 1;
  }
}

function output(value, flags, render) {
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(redactPrivate(value), null, 2));
  else console.log(render(redactPrivate(value)));
}

function renderStatus(status) {
  const lines = ['Agentkodex Ed25519 keys:'];
  lines.push(`- active signing key: ${status.activeKeyId}`);
  lines.push(`- active verification keys: ${status.verificationKeys.length}`);
  lines.push(`- retired keys: ${status.retiredKeys.length}`);
  lines.push(`- key store: ready`);
  return lines.join('\n');
}

function renderList(value) {
  const lines = ['Agentkodex active verification keys:'];
  for (const key of value.verificationKeys) lines.push(`- ${key.keyId} ${key.status} ${key.publicKeySha256}`);
  return lines.join('\n');
}

function renderRotate(value) {
  return `Rotated Agentkodex Ed25519 signing key: ${value.activeKey.keyId}`;
}

function renderRetire(value) {
  return `Retired Agentkodex Ed25519 verification key: ${value.key.keyId}`;
}

function safeKey(key) {
  return {
    keyId: key.keyId,
    algorithm: key.algorithm,
    status: key.status,
    createdAt: key.createdAt,
    publicKeySha256: require('../utils').hashString(key.publicKeyPem || '', 32),
  };
}

function redactPrivate(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === 'privateKeyPem' ? undefined : item));
}

function normalizeDashes(argv) {
  return argv.map((item) => String(item).replace(/^–/, '--'));
}

module.exports = {
  keysCommand,
};
