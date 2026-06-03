'use strict';

const { verifyCapability } = require('./verify');
const { writeAuditEvidence } = require('../audit/evidence');

function verifyExecutionCapability(root, command, options = {}, policy = {}) {
  const required = requiresCapability(policy, options);
  if (!required) return { allowed: true, reason: 'Capability not required for safe action.' };
  const expected = {
    sessionId: options.sessionId || options.holder || '',
    agentId: options.agent || options.agentId || 'agentkodex',
    phase: options.capabilityPhase || 'runtime',
    action: options.capabilityAction || 'command:start',
    path: options.cwd || root,
    runDir: options.logDir || options.runDir,
  };
  const result = verifyCapability(root, options.capability, expected);
  if (!result.allowed) {
    writeAuditEvidence(root, {
      type: 'failed_capability_validation',
      allowed: false,
      reason: result.reason,
      command,
      expected,
    }, { runDir: expected.runDir });
  }
  return result;
}

function requiresCapability(policy = {}, options = {}) {
  if (options.requireCapability) return true;
  if (options.capabilityPhase || options.capabilityAction) return true;
  if (options.agentLaunch || options.agent) return true;
  const risk = policy.classification?.risk || policy.risk || 'unknown';
  return risk !== 'safe';
}

module.exports = {
  verifyExecutionCapability,
  requiresCapability,
};
