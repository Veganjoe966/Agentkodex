'use strict';

const path = require('path');
const { readJson } = require('../utils');

const DEFAULT_POLICY = {
  defaultDeny: false,
  dangerousActions: [],
  allowedActions: [],
  deniedActions: [],
  pathScopes: [],
  approvalRequiredActions: [],
  maxCapabilityTtlSeconds: 1800,
  allowLegacyHmac: false,
  requireEd25519: false,
  allowShell: true,
  allowNetwork: true,
  allowFileWrite: true,
  allowGitWrite: true,
  allowProcessKill: true,
};

function loadPolicyConfig(root, overrides = {}) {
  const fromFile = root ? readJson(path.join(root, 'agentkodex.policy.json'), {}) : {};
  const nested = overrides.policy || overrides.config?.policy || {};
  return normalizePolicy({ ...DEFAULT_POLICY, ...fromFile, ...nested });
}

function normalizePolicy(value = {}) {
  return {
    defaultDeny: Boolean(value.defaultDeny),
    dangerousActions: list(value.dangerousActions),
    allowedActions: list(value.allowedActions),
    deniedActions: list(value.deniedActions),
    pathScopes: list(value.pathScopes),
    approvalRequiredActions: list(value.approvalRequiredActions),
    maxCapabilityTtlSeconds: numberOr(value.maxCapabilityTtlSeconds, DEFAULT_POLICY.maxCapabilityTtlSeconds),
    allowLegacyHmac: value.allowLegacyHmac === true,
    requireEd25519: Boolean(value.requireEd25519),
    allowShell: value.allowShell !== false,
    allowNetwork: value.allowNetwork !== false,
    allowFileWrite: value.allowFileWrite !== false,
    allowGitWrite: value.allowGitWrite !== false,
    allowProcessKill: value.allowProcessKill !== false,
  };
}

function configuredCommandDecision(command, policy) {
  const value = String(command || '');
  if (matches(value, policy.deniedActions)) return blocked('matched configured denied action');
  if (!policy.allowShell && /^\s*(sh|bash|zsh|fish|powershell|pwsh)\b/i.test(value)) return blocked('shell execution disabled by policy');
  if (!policy.allowNetwork && /\b(curl|wget|ssh|scp|rsync|nc|netcat)\b/i.test(value)) return blocked('network commands disabled by policy');
  if (!policy.allowFileWrite && /\b(touch|rm|mv|cp|mkdir|rmdir|chmod|chown|sed\s+-i|perl\s+-pi)\b/i.test(value)) return blocked('file writes disabled by policy');
  if (!policy.allowGitWrite && /\bgit\s+(commit|push|reset|clean|checkout|merge|rebase|tag)\b/i.test(value)) return blocked('git writes disabled by policy');
  if (!policy.allowProcessKill && /\b(kill|pkill|killall)\b/i.test(value)) return blocked('process kill disabled by policy');
  if (matches(value, policy.allowedActions)) return { risk: 'safe', reason: 'matched configured allowed action' };
  if (matches(value, policy.approvalRequiredActions)) return { risk: 'approval_required', category: 'configured', reason: 'matched configured approval action' };
  if (matches(value, policy.dangerousActions)) return policy.defaultDeny
    ? blocked('matched configured dangerous action')
    : { risk: 'approval_required', category: 'configured', reason: 'matched configured dangerous action' };
  return null;
}

function matches(command, patterns) {
  return patterns.some((pattern) => {
    try { return new RegExp(pattern, 'i').test(command); } catch (_) { return command.includes(pattern); }
  });
}

function blocked(reason) {
  return { risk: 'blocked', reason };
}

function list(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

module.exports = {
  DEFAULT_POLICY,
  configuredCommandDecision,
  loadPolicyConfig,
};
