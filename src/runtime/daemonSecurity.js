'use strict';

const path = require('path');
const { authorizeCommand } = require('../authorization');
const { verifyRuntimeCapability } = require('../capabilities/phases');
const { writeAuditEvidence } = require('../audit/evidence');
const { newSessionId } = require('./sessionStore');

function authorizeDaemonStart(root, input, command, cwd, mode, yes) {
  const sessionId = input.sessionId || newSessionId(`${input.agent || 'custom'}:${input.task || ''}:${command}`);
  const policy = authorizeCommand(command, {
    root,
    mode,
    yes,
    agentLaunch: Boolean(input.trustedAgentLaunch),
    intent: input.task || command,
    holder: input.runId || sessionId || 'agentkodex-daemon',
    agent: input.agent,
    adapterKind: input.adapterKind,
  });
  const capability = verifyRuntimeCapability(root, input.capability, {
    sessionId,
    agentId: input.agent || 'custom',
    path: path.resolve(cwd || root),
    runDir: input.runDir,
  });
  if (!capability.allowed) throw new Error(capability.reason);
  if (!policy.allowed) {
    writeAuditEvidence(root, { type: 'denied_action', allowed: false, reason: policy.reason, command, policy }, { runDir: input.runDir });
    return { sessionId, policy, capability: input.capability };
  }
  return { sessionId, policy, capability: input.capability };
}

function assertDaemonRuntimeCapability(root, session) {
  const result = verifyRuntimeCapability(root, session.capabilities?.runtime, {
    sessionId: session.id,
    agentId: session.agent,
    path: session.cwd || root,
    runDir: session.runDir,
  });
  if (!result.allowed) throw new Error(result.reason);
  return result;
}

module.exports = {
  authorizeDaemonStart,
  assertDaemonRuntimeCapability,
};
