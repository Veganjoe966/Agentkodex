'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { ensureDir, hashString, readJson, writeJson } = require('../utils');
const { writeAuditEvidence } = require('../audit/evidence');

function keyStorePath(root) {
  ensureKodex(root);
  const dir = kodexPath(root, 'runtime');
  ensureDir(dir);
  return path.join(dir, 'capability-keys.json');
}

function loadKeyStore(root) {
  const file = keyStorePath(root);
  const store = readJson(file, null);
  if (store?.activeKeyId && Array.isArray(store.keys)) return store;
  const initial = { activeKeyId: null, keys: [] };
  const next = addKey(initial);
  saveKeyStore(root, next);
  return next;
}

function saveKeyStore(root, store) {
  const file = keyStorePath(root);
  writeJson(file, store);
  try { fs.chmodSync(file, 0o600); } catch (_) {}
}

function activeSigningKey(root) {
  const store = loadKeyStore(root);
  return store.keys.find((key) => key.keyId === store.activeKeyId) || store.keys[0];
}

function signingKey(root, keyId) {
  const store = loadKeyStore(root);
  return store.keys.find((key) => key.keyId === keyId) || activeSigningKey(root);
}

function verificationKeys(root) {
  return loadKeyStore(root).keys.filter((key) => key.publicKeyPem);
}

function rotateCapabilityKey(root, options = {}) {
  const store = loadKeyStore(root);
  for (const key of store.keys) {
    if (key.keyId === store.activeKeyId) key.status = 'retired';
  }
  const next = addKey(store);
  saveKeyStore(root, next);
  writeAuditEvidence(root, {
    type: 'capability_key_rotation',
    keyId: next.activeKeyId,
    previousKeyId: store.activeKeyId || null,
    reason: options.reason || 'manual',
  }, { runDir: options.runDir });
  return activeSigningKey(root);
}

function addKey(store) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyId = `ak_${hashString(`${Date.now()}:${publicKeyPem}`, 14)}`;
  const key = {
    keyId,
    algorithm: 'ed25519',
    status: 'active',
    createdAt: new Date().toISOString(),
    publicKeyPem,
    privateKeyPem,
  };
  return { activeKeyId: keyId, keys: [...(store.keys || []), key] };
}

module.exports = {
  keyStorePath,
  loadKeyStore,
  activeSigningKey,
  signingKey,
  verificationKeys,
  rotateCapabilityKey,
};
