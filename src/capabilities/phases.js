'use strict';

const path = require('path');
const { issueCapability } = require('./issuer');
const { verifyCapability } = require('./verify');

function issueRuntimeCapability(root, input = {}) {
  return issueCapability(root, {
    sessionId: input.sessionId,
    agentId: input.agentId || input.agent || 'custom',
    phase: 'runtime',
    allowedActions: ['command:start', 'session:send', 'session:interrupt', 'session:kill', 'stdin:close'],
    allowedPaths: [path.resolve(input.cwd || root)],
    ttlMs: input.ttlMs,
    runDir: input.runDir,
  });
}

function issueSwarmCapability(root, input = {}) {
  return issueCapability(root, {
    sessionId: `swarm:${input.swarmId}:${input.phase}:${input.agentId}`,
    agentId: input.agentId,
    phase: 'swarm',
    allowedActions: ['phase:execute', 'command:start'],
    allowedPaths: [path.resolve(input.cwd || root)],
    ttlMs: input.ttlMs,
    runDir: input.runDir,
  });
}

function issueTournamentCapability(root, input = {}) {
  return issueCapability(root, {
    sessionId: `tournament:${input.tournamentId}:${input.round || 1}:${input.agentId}`,
    agentId: input.agentId,
    phase: 'tournament',
    allowedActions: ['contestant:run', 'command:start'],
    allowedPaths: [path.resolve(input.cwd || root)],
    ttlMs: input.ttlMs,
    runDir: input.runDir,
  });
}

function issueAuditCapability(root, input = {}) {
  return issueCapability(root, {
    sessionId: input.sessionId || `audit:${input.auditId || 'local'}`,
    agentId: input.agentId || 'audit-bundle',
    phase: 'audit',
    allowedActions: ['audit:git', 'audit:zip'],
    allowedPaths: [path.resolve(input.cwd || root)],
    ttlMs: input.ttlMs,
    runDir: input.runDir,
  });
}

function issueQualityCapability(root, input = {}) {
  return issueCapability(root, {
    sessionId: input.sessionId || `quality:${input.runId || 'local'}`,
    agentId: input.agentId || 'lintguard',
    phase: 'quality',
    allowedActions: ['quality:command'],
    allowedPaths: [path.resolve(input.cwd || root)],
    ttlMs: input.ttlMs,
    runDir: input.runDir,
  });
}

function verifyRuntimeCapability(root, capability, expected = {}) {
  return verifyCapability(root, capability, { ...expected, phase: 'runtime', action: expected.action || 'command:start' });
}

module.exports = {
  issueRuntimeCapability,
  issueSwarmCapability,
  issueTournamentCapability,
  issueAuditCapability,
  issueQualityCapability,
  verifyRuntimeCapability,
  verifyCapability,
};
