'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig } = require('../kodexStore');
const { ensureDir } = require('../utils');
const { ensureAgentguardPolicy, toolForRisk, defaultAgentguardPaths } = require('./policy');

function authorizeWithAgentguard(command, context = {}) {
  const root = path.resolve(context.root || context.cwd || process.cwd());
  const config = context.config || loadConfig(root);
  const settings = config.agentguard || {};
  if (settings.enabled === false || context.agentguard === false) return unavailable('disabled');

  const source = findAgentguardSource(root, settings);
  if (!source) return unavailable('Agentguard source not found');
  const python = settings.python || process.env.AGENTGUARD_PYTHON || 'python3';
  const policyPath = ensureAgentguardPolicy(root, config);
  const paths = defaultAgentguardPaths(root);
  ensureDir(path.dirname(paths.seedPath));
  ensureDir(path.dirname(paths.auditPath));

  const risk = context.classification?.risk || 'unknown';
  const request = {
    policyPath,
    seedPath: paths.seedPath,
    auditPath: paths.auditPath,
    intent: context.intent || context.task || command,
    holder: context.holder || context.sessionId || context.runId || 'agentkodex',
    tool: toolForRisk(risk),
    approved: Boolean(context.approved),
    approver: context.approver || 'agentkodex',
    approvalNote: context.approvalNote || '',
    args: {
      command: String(command || ''),
      cwd: root,
      risk,
      category: context.classification?.category || '',
      mode: context.mode || 'supervised',
      agent: context.agent || '',
      adapterKind: context.adapterKind || '',
    },
  };

  const result = spawnSync(python, ['-m', 'agentguard.bridge'], {
    cwd: root,
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: Number(settings.timeoutMs || 10000),
    env: { ...process.env, PYTHONPATH: sourcePath(source) },
  });
  if (result.error) return unavailable(result.error.message, source);
  if (result.status !== 0 && !result.stdout) return unavailable(result.stderr || `Agentguard exited ${result.status}`, source);
  try {
    return { available: true, source, policyPath, seedPath: paths.seedPath, auditPath: paths.auditPath, ...JSON.parse(result.stdout) };
  } catch (error) {
    return unavailable(`Invalid Agentguard bridge output: ${error.message}`, source);
  }
}

function findAgentguardSource(root, settings = {}) {
  const candidates = [
    process.env.AGENTGUARD_SOURCE,
    settings.source,
    path.join(path.dirname(root), 'agentguard', 'Agentguard'),
    path.join(os.homedir(), 'agentguard', 'Agentguard'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'agentguard', 'bridge.py'))) || null;
}

function sourcePath(source) {
  const existing = process.env.PYTHONPATH ? `${source}${path.delimiter}${process.env.PYTHONPATH}` : source;
  return existing;
}

function unavailable(reason, source = null) {
  return { available: false, ok: false, allowed: false, requiresApproval: false, status: 'unavailable', reason, source };
}

module.exports = {
  authorizeWithAgentguard,
  findAgentguardSource,
};
