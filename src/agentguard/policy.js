'use strict';

const path = require('path');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { exists, writeText } = require('../utils');

function defaultPolicyYaml() {
  return `policies:
  - tool: shell_command_safe
    allow_if:
      arg_in:
        risk: [safe]
      arg_length_lt:
        command: 20000
    max_per_session: 1000
    expiry_seconds: 300

  - tool: shell_command_approval
    require: explicit_user_approval
    allow_if:
      arg_in:
        risk: [approval_required, unknown]
      arg_length_lt:
        command: 20000
    expiry_seconds: 300

  - tool: shell_command_blocked
    deny: true
`;
}

function ensureAgentguardPolicy(root, config = {}) {
  ensureKodex(root);
  const configured = config.agentguard?.policyPath || '.agentkodex/agentguard-policy.yaml';
  const policyPath = path.isAbsolute(configured) ? configured : path.join(root, configured);
  if (!exists(policyPath)) writeText(policyPath, defaultPolicyYaml());
  return policyPath;
}

function toolForRisk(risk) {
  if (risk === 'safe') return 'shell_command_safe';
  if (risk === 'blocked') return 'shell_command_blocked';
  return 'shell_command_approval';
}

function defaultAgentguardPaths(root) {
  return {
    seedPath: kodexPath(root, 'runtime', 'agentguard.seed'),
    auditPath: kodexPath(root, 'runtime', 'agentguard-audit.jsonl'),
  };
}

module.exports = {
  defaultPolicyYaml,
  ensureAgentguardPolicy,
  toolForRisk,
  defaultAgentguardPaths,
};
