'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { ensureKodex } = require('../kodexStore');
const { ensureDir, hashString } = require('../utils');
const { defaultAgentguardPaths } = require('../agentguard/policy');

function issueCapability(root, input = {}) {
  ensureKodex(root);
  const now = Date.now();
  const ttlMs = Number(input.ttlMs || 30 * 60 * 1000);
  const capability = {
    capabilityId: input.capabilityId || `cap_${hashString(`${now}:${Math.random()}:${input.agentId || ''}`, 16)}`,
    sessionId: String(input.sessionId || ''),
    agentId: String(input.agentId || ''),
    phase: String(input.phase || 'runtime'),
    allowedActions: normalizeList(input.allowedActions),
    allowedPaths: normalizeList(input.allowedPaths),
    expiresAt: new Date(now + ttlMs).toISOString(),
    issuedBy: 'agentguard',
  };
  return { ...capability, signature: sign(root, capability) };
}

function sign(root, capability) {
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
  canonical,
};
