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
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
  return path.join(dir, 'capability-keys.json');
}

function loadKeyStore(root) {
  const file = keyStorePath(root);
  if (fs.existsSync(file)) {
    const store = readJson(file, null);
    if (!validStore(store)) throw new Error('Capability key store is corrupt.');
    return store;
  }
  const initial = { activeKeyId: null, keys: [] };
  const next = addKey(initial);
  saveKeyStore(root, next);
  writeAuditEvidence(root, { type: 'ed25519_key_created', keyId: next.activeKeyId, reason: 'initial' });
  return next;
}

function saveKeyStore(root, store) {
  const file = keyStorePath(root);
  writeJson(file, store);
  try { fs.chmodSync(file, 0o600); } catch (_) {}
}

function activeSigningKey(root) {
  const store = loadKeyStore(root);
  const key = store.keys.find((item) => item.keyId === store.activeKeyId && item.status === 'active');
  if (!key) throw new Error('Capability active signing key is unavailable.');
  return key;
}

function signingKey(root, keyId) {
  const store = loadKeyStore(root);
  const key = store.keys.find((item) => item.keyId === keyId && item.status === 'active');
  if (!key) throw new Error('Capability signing key is unavailable.');
  return key;
}

function verificationKeys(root) {
  return loadKeyStore(root).keys.filter((key) => key.publicKeyPem && key.status !== 'retired');
}

function rotateCapabilityKey(root, options = {}) {
  let store;
  try {
    store = loadKeyStore(root);
  } catch (error) {
    writeAuditEvidence(root, { type: 'ed25519_key_rotation_failed', reason: error.message }, { runDir: options.runDir });
    throw error;
  }
  const previousKeyId = store.activeKeyId || null;
  for (const key of store.keys) {
    if (key.keyId === store.activeKeyId) key.status = 'verify';
  }
  const next = addKey(store);
  saveKeyStore(root, next);
  writeAuditEvidence(root, {
    type: 'ed25519_key_created',
    keyId: next.activeKeyId,
    reason: 'rotation',
  }, { runDir: options.runDir });
  writeAuditEvidence(root, {
    type: 'ed25519_key_rotated',
    keyId: next.activeKeyId,
    previousKeyId,
    reason: options.reason || 'manual',
  }, { runDir: options.runDir });
  return activeSigningKey(root);
}

function retireCapabilityKey(root, keyId, options = {}) {
  const store = loadKeyStore(root);
  const key = store.keys.find((item) => item.keyId === keyId);
  if (!key) throw new Error(`Capability key not found: ${keyId}`);
  if (key.keyId === store.activeKeyId) throw new Error('Cannot retire the active signing key. Rotate first.');
  key.status = 'retired';
  key.retiredAt = new Date().toISOString();
  saveKeyStore(root, store);
  writeAuditEvidence(root, { type: 'ed25519_key_retired', keyId, reason: options.reason || 'manual' }, { runDir: options.runDir });
  return publicKeyInfo(key, store.activeKeyId);
}

function keyStatus(root, options = {}) {
  const store = loadKeyStore(root);
  writeAuditEvidence(root, { type: 'ed25519_key_status_checked', activeKeyId: store.activeKeyId }, { runDir: options.runDir });
  return {
    activeKeyId: store.activeKeyId,
    activeKey: publicKeyInfo(store.keys.find((key) => key.keyId === store.activeKeyId), store.activeKeyId),
    verificationKeys: store.keys.filter((key) => key.status !== 'retired').map((key) => publicKeyInfo(key, store.activeKeyId)),
    retiredKeys: store.keys.filter((key) => key.status === 'retired').map((key) => publicKeyInfo(key, store.activeKeyId)),
  };
}

function publicKeyInfo(key, activeKeyId) {
  if (!key) return null;
  return {
    keyId: key.keyId,
    algorithm: key.algorithm,
    status: key.status,
    activeSigningKey: key.keyId === activeKeyId,
    createdAt: key.createdAt,
    retiredAt: key.retiredAt || null,
    publicKeySha256: hashString(key.publicKeyPem || '', 32),
    publicKeyPem: key.publicKeyPem,
  };
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

function validStore(store) {
  if (!store || typeof store !== 'object' || !store.activeKeyId || !Array.isArray(store.keys)) return false;
  return store.keys.some((key) => key.keyId === store.activeKeyId && key.status === 'active' && key.privateKeyPem && key.publicKeyPem);
}

module.exports = {
  keyStorePath,
  loadKeyStore,
  activeSigningKey,
  signingKey,
  verificationKeys,
  rotateCapabilityKey,
  retireCapabilityKey,
  keyStatus,
  publicKeyInfo,
};
