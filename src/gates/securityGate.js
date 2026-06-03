'use strict';

const path = require('path');
const { classifyCommand, redactSecrets } = require('../policy');
const { authorizeCommand } = require('../authorization');
const { redactObject } = require('../security/redaction');

const SAFE_ACTIONS = new Set(['read', 'status', 'quality_check', 'command']);
const DANGEROUS_ACTIONS = new Set(['deploy', 'push', 'destructive', 'secret_read', 'secret_write', 'unknown']);

function authorizeAgentAction(input = {}) {
  const projectRoot = path.resolve(input.projectRoot || input.root || process.cwd());
  const actionType = String(input.actionType || 'unknown');
  const command = String(input.command || '').trim();
  const auditRecord = buildAuditRecord(projectRoot, actionType, input);

  if (DANGEROUS_ACTIONS.has(actionType) && !command) {
    return denied(`Action type ${actionType} requires explicit authorization.`, true, auditRecord);
  }
  if (!SAFE_ACTIONS.has(actionType) && !command) {
    return denied(`Unknown action type ${actionType} is denied by default.`, false, auditRecord);
  }
  if (!command) {
    return { allowed: true, reason: `Allowed safe action ${actionType}.`, requiredApproval: false, auditRecord };
  }

  const classification = classifyCommand(command);
  if (classification.risk === 'blocked') return denied('Blocked by Agentkodex policy.', false, auditRecord, classification);

  const policy = authorizeCommand(command, {
    root: projectRoot,
    mode: input.mode || 'supervised',
    yes: Boolean(input.approved),
    intent: actionType,
    holder: input.sessionId || input.agentId || 'security-gate',
    agent: input.agentId,
    config: input.config,
  });
  return {
    allowed: Boolean(policy.allowed),
    reason: policy.reason || (policy.allowed ? 'Allowed.' : 'Denied.'),
    requiredApproval: Boolean(policy.requiresApproval),
    auditRecord: redactObject({ ...auditRecord, classification, policy }),
  };
}

function denied(reason, requiredApproval, auditRecord, classification = null) {
  return {
    allowed: false,
    reason,
    requiredApproval: Boolean(requiredApproval),
    auditRecord: redactObject({ ...auditRecord, classification }),
  };
}

function buildAuditRecord(projectRoot, actionType, input) {
  return {
    createdAt: new Date().toISOString(),
    projectRoot,
    sessionId: input.sessionId || '',
    agentId: input.agentId || '',
    actionType,
    command: redactSecrets(input.command || ''),
    files: Array.isArray(input.files) ? input.files.map(String) : [],
    capabilityTokenPresent: Boolean(input.capabilityToken),
    untrustedInputCount: Array.isArray(input.untrustedInputs) ? input.untrustedInputs.length : 0,
  };
}

module.exports = {
  authorizeAgentAction,
};
