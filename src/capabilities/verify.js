'use strict';

const crypto = require('crypto');
const path = require('path');
const { legacySign, canonical } = require('./issuer');
const { verificationKeys } = require('./keys');
const { writeAuditEvidence } = require('../audit/evidence');
const { isSubpath } = require('../utils');
const { loadPolicyConfig } = require('../policy/config');
const { isCapabilityRevoked } = require('./revocation');

function verifyCapability(root, capability, expected = {}) {
  const result = checkCapability(root, capability, expected);
  if (result.allowed) {
    writeAuditEvidence(root, {
      type: 'capability_validation',
      allowed: true,
      reason: result.reason,
      expected,
      capability: publicCapability(capability),
    }, { runDir: expected.runDir });
  } else {
    writeAuditEvidence(root, {
      type: 'capability_validation',
      allowed: false,
      reason: result.reason,
      expected,
      capability: publicCapability(capability),
    }, { runDir: expected.runDir });
    writeAuditEvidence(root, {
      type: 'capability_verification_failure',
      allowed: false,
      reason: result.reason,
      capability: publicCapability(capability),
    }, { runDir: expected.runDir });
    if (/signature/i.test(result.reason)) {
      writeAuditEvidence(root, {
        type: 'signature_mismatch',
        allowed: false,
        reason: result.reason,
        capability: publicCapability(capability),
      }, { runDir: expected.runDir });
    }
  }
  if (result.allowed && result.warning) {
    writeAuditEvidence(root, {
      type: 'legacy_capability_used',
      allowed: true,
      warning: result.warning,
      capability: publicCapability(capability),
      expected,
    }, { runDir: expected.runDir });
  }
  return result;
}

function checkCapability(root, capability, expected = {}) {
  if (!capability) return denied('Missing Agentguard capability.');
  if (capability.issuedBy !== 'agentguard') return denied('Capability issuer is not Agentguard.');
  const signature = verifySignature(root, capability);
  if (!signature.allowed) return signature;
  if (isCapabilityRevoked(root, capability.capabilityId)) return denied('Capability is revoked.');
  const expiresAt = Date.parse(capability.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return denied('Capability is expired.');
  if (expected.sessionId && capability.sessionId !== expected.sessionId) return denied('Capability session scope does not match.');
  if (expected.agentId && capability.agentId !== expected.agentId) return denied('Capability agent scope does not match.');
  if (expected.phase && capability.phase !== expected.phase) return denied('Capability phase scope does not match.');
  if (expected.action && !(capability.allowedActions || []).includes(expected.action)) return denied('Capability action is not allowed.');
  if (expected.path && !pathAllowed(capability.allowedPaths || [], expected.path)) return denied('Capability path is not allowed.');
  return { allowed: true, reason: 'Capability verified.', capability, warning: signature.warning || null };
}

function verifySignature(root, capability) {
  if (!capability.signature) return denied('Capability signature is invalid.');
  const policy = loadPolicyConfig(root);
  if (!capability.algorithm || capability.algorithm === 'hmac-sha256') {
    if (policy.requireEd25519 || !policy.allowLegacyHmac) return denied('Legacy HMAC capabilities are disabled by policy.');
    return legacySign(root, capability) === capability.signature
      ? { allowed: true, warning: 'legacy_hmac_capability' }
      : denied('Capability signature is invalid.');
  }
  if (capability.algorithm !== 'ed25519') return denied('Capability algorithm is unsupported.');
  const key = verificationKeys(root).find((item) => item.keyId === capability.keyId);
  if (!key) return denied('Capability verification key is unavailable.');
  try {
    const ok = crypto.verify(null, Buffer.from(canonical(capability)), key.publicKeyPem, Buffer.from(capability.signature, 'base64url'));
    return ok ? { allowed: true } : denied('Capability signature is invalid.');
  } catch (_) {
    return denied('Capability signature is invalid.');
  }
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
    algorithm: capability.algorithm || 'hmac-sha256',
    keyId: capability.keyId || null,
  };
}

module.exports = {
  verifyCapability,
  checkCapability,
  publicCapability,
};
