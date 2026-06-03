'use strict';

const { authorizeCommand } = require('../authorization');
const { authorizeAgentAction } = require('../gates/securityGate');
const { issueRuntimeCapability, verifyRuntimeCapability } = require('../capabilities/phases');
const { writeAuditEvidence } = require('../audit/evidence');

function prepareRuntimeSecurity(input = {}) {
  const policy = authorizeCommand(input.command, {
    root: input.root,
    mode: input.mode,
    yes: input.yes,
    agentLaunch: input.trustedAgentLaunch,
    intent: input.task || input.command,
    holder: input.runId || input.sessionId || 'agentkodex-runtime',
    agent: input.agentId,
    adapterKind: input.adapterKind,
    config: input.config,
  });
  if (!policy.allowed) {
    writeAuditEvidence(input.root, { type: 'denied_action', allowed: false, reason: policy.reason, command: input.command, policy }, { runDir: input.runDir });
    return { policy, securityDecision: null, capability: null };
  }

  const securityDecision = authorizeAgentAction({
    projectRoot: input.root,
    runDir: input.runDir,
    sessionId: input.sessionId,
    agentId: input.agentId,
    actionType: 'command',
    command: input.command,
    files: [input.cwd || input.root],
    approved: input.yes,
    mode: input.mode,
    trustedAgentLaunch: input.trustedAgentLaunch,
    config: input.config,
  });
  if (!securityDecision.allowed) {
    return {
      policy: { ...policy, allowed: false, requiresApproval: securityDecision.requiredApproval, reason: securityDecision.reason },
      securityDecision,
      capability: null,
    };
  }

  const capability = issueRuntimeCapability(input.root, {
    sessionId: input.sessionId,
    agentId: input.agentId,
    cwd: input.cwd || input.root,
    runDir: input.runDir,
  });
  return { policy, securityDecision, capability };
}

function assertRuntimeCapability(root, session, options = {}) {
  const capability = options.capability || session.capabilities?.runtime;
  return verifyRuntimeCapability(root, capability, {
    sessionId: session.id,
    agentId: session.agent,
    path: session.cwd || root,
    runDir: session.runDir,
  });
}

module.exports = {
  prepareRuntimeSecurity,
  assertRuntimeCapability,
};
