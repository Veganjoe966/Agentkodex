'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { ensureKodex } = require('../kodexStore');
const { ensureDir, hashString } = require('../utils');
const { defaultAgentguardPaths } = require('../agentguard/policy');
const { activeSigningKey, signingKey } = require('./keys');
const { writeAuditEvidence } = require('../audit/evidence');
const { loadPolicyConfig } = require('../policy/config');
const { isSubpath } = require('../utils');
const { normalizeCapabilityPath } = require('./pathScope');

function issueCapability(root, input = {}) {
  ensureKodex(root);
  const now = Date.now();
  const policy = loadPolicyConfig(root, input);
  const maxTtlMs = Number(policy.maxCapabilityTtlSeconds || 1800) * 1000;
  const requestedTtlMs = Number(input.ttlMs || maxTtlMs);
  const ttlMs = Math.min(requestedTtlMs, maxTtlMs);
  const allowedPaths = normalizeAllowedPaths(root, input.allowedPaths, policy);
  const capability = {
    capabilityId: input.capabilityId || `cap_${hashString(`${now}:${Math.random()}:${input.agentId || ''}`, 16)}`,
    sessionId: String(input.sessionId || ''),
    agentId: String(input.agentId || ''),
    phase: String(input.phase || 'runtime'),
    allowedActions: normalizeList(input.allowedActions),
    allowedPaths,
    expiresAt: new Date(now + ttlMs).toISOString(),
    issuedBy: 'agentguard',
    algorithm: 'ed25519',
  };
  const key = activeSigningKey(root);
  const unsigned = { ...capability, keyId: key.keyId };
  const issued = { ...unsigned, signature: sign(root, unsigned) };
  writeAuditEvidence(root, {
    type: 'capability_issued',
    allowed: true,
    capabilityId: issued.capabilityId,
    sessionId: issued.sessionId,
    agentId: issued.agentId,
    phase: issued.phase,
    allowedActions: issued.allowedActions,
    allowedPaths: issued.allowedPaths,
    expiresAt: issued.expiresAt,
    algorithm: issued.algorithm,
    keyId: issued.keyId,
  }, { runDir: input.runDir });
  return issued;
}

function normalizeAllowedPaths(root, paths, policy) {
  const allowed = normalizeList(paths).map(normalizeCapabilityPath);
  const scopes = normalizeList(policy.pathScopes).map((item) => normalizeCapabilityPath(path.resolve(root, item)));
  if (!scopes.length) return allowed;
  for (const item of allowed) {
    if (!scopes.some((scope) => isSubpath(scope, item))) throw new Error(`Capability path is outside configured policy scope: ${item}`);
  }
  return allowed;
}

function sign(root, capability) {
  if (!capability.algorithm || capability.algorithm === 'hmac-sha256') return legacySign(root, capability);
  const privateKey = signingKey(root, capability.keyId).privateKeyPem;
  return crypto.sign(null, Buffer.from(canonical(capability)), privateKey).toString('base64url');
}

function legacySign(root, capability) {
  return crypto.createHmac('sha256', capabilitySecret(root)).update(canonical(capability)).digest('base64url');
}

function capabilitySecret(root) {
  const seedPath = defaultAgentguardPaths(root).seedPath;
  ensureDir(path.dirname(seedPath));
  if (!fs.existsSync(seedPath)) {
    fs.writeFileSync(seedPath, crypto.randomBytes(32));
    try { fs.chmodSync(seedPath, 0o600); } catch (_) {}
  }
  return fs.readFileSync(seedPath);
}

function canonical(value) {
  const clean = { ...value };
  delete clean.signature;
  return JSON.stringify(Object.keys(clean).sort().reduce((out, key) => {
    out[key] = clean[key];
    return out;
  }, {}));
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

module.exports = {
  issueCapability,
  sign,
  legacySign,
  canonical,
};
