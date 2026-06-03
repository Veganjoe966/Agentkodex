'use strict';

const path = require('path');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { ensureDir, readJson, writeJson } = require('../utils');
const { writeAuditEvidence } = require('../audit/evidence');

function revocationPath(root) {
  ensureKodex(root);
  const dir = kodexPath(root, 'runtime');
  ensureDir(dir);
  return path.join(dir, 'capability-revocations.json');
}

function loadRevocations(root) {
  return readJson(revocationPath(root), { revoked: [] });
}

function isCapabilityRevoked(root, capabilityId) {
  if (!capabilityId) return false;
  return loadRevocations(root).revoked.some((item) => item.capabilityId === capabilityId);
}

function revokeCapability(root, capabilityId, options = {}) {
  const store = loadRevocations(root);
  if (!store.revoked.some((item) => item.capabilityId === capabilityId)) {
    store.revoked.push({
      capabilityId,
      reason: options.reason || 'manual',
      revokedAt: new Date().toISOString(),
    });
    writeJson(revocationPath(root), store);
  }
  writeAuditEvidence(root, {
    type: 'capability_revoked',
    capabilityId,
    reason: options.reason || 'manual',
  }, { runDir: options.runDir });
  return store.revoked.find((item) => item.capabilityId === capabilityId);
}

module.exports = {
  isCapabilityRevoked,
  loadRevocations,
  revocationPath,
  revokeCapability,
};
