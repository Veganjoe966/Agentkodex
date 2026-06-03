'use strict';

const path = require('path');
const { sign } = require('./issuer');
const { writeAuditEvidence } = require('../audit/evidence');
const { isSubpath } = require('../utils');

function verifyCapability(root, capability, expected = {}) {
  const result = checkCapability(root, capability, expected);
  if (!result.allowed) {
    writeAuditEvidence(root, {
      type: 'capability_validation',
      allowed: false,
      reason: result.reason,
      expected,
      capability: publicCapability(capability),
    }, { runDir: expected.runDir });
  }
  return result;
}

function checkCapability(root, capability, expected = {}) {
  if (!capability) return denied('Missing Agentguard capability.');
  if (capability.issuedBy !== 'agentguard') return denied('Capability issuer is not Agentguard.');
  if (!capability.signature || sign(root, capability) !== capability.signature) return denied('Capability signature is invalid.');
  if (Date.parse(capability.expiresAt) <= Date.now()) return denied('Capability is expired.');
  if (expected.sessionId && capability.sessionId !== expected.sessionId) return denied('Capability session scope does not match.');
  if (expected.agentId && capability.agentId !== expected.agentId) return denied('Capability agent scope does not match.');
  if (expected.phase && capability.phase !== expected.phase) return denied('Capability phase scope does not match.');
  if (expected.action && !(capability.allowedActions || []).includes(expected.action)) return denied('Capability action is not allowed.');
  if (expected.path && !pathAllowed(capability.allowedPaths || [], expected.path)) return denied('Capability path is not allowed.');
  return { allowed: true, reason: 'Capability verified.', capability };
}

function pathAllowed(allowedPaths, target) {
  if (!target) return true;
  return allowedPaths.some((allowed) => isSubpath(path.resolve(allowed), path.resolve(target)));
}

function denied(reason) {
  return { allowed: false, reason };
}

function publicCapability(capability) {
  if (!capability) return null;
  return {
    capabilityId: capability.capabilityId,
    sessionId: capability.sessionId,
    agentId: capability.agentId,
    phase: capability.phase,
    expiresAt: capability.expiresAt,
    issuedBy: capability.issuedBy,
  };
}

module.exports = {
  verifyCapability,
  checkCapability,
  publicCapability,
};
