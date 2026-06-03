'use strict';

const { policyAllows } = require('./policy');
const { authorizeWithAgentguard } = require('./agentguard/bridge');

function authorizeCommand(command, options = {}) {
  const jsPolicy = policyAllows(command, {
    mode: options.mode,
    yes: options.yes,
    agentLaunch: options.agentLaunch,
  });
  const agentguard = authorizeWithAgentguard(command, {
    ...options,
    classification: jsPolicy.classification,
    approved: Boolean(options.yes || (jsPolicy.allowed && jsPolicy.classification?.risk === 'unknown')),
  });
  const required = Boolean(options.config?.agentguard?.required);

  if (!agentguard.available) {
    if (required) {
      return {
        allowed: false,
        requiresApproval: false,
        classification: jsPolicy.classification,
        reason: `Agentguard is required but unavailable: ${agentguard.reason}`,
        jsPolicy,
        agentguard,
      };
    }
    return { ...jsPolicy, jsPolicy, agentguard, reason: `${jsPolicy.reason}; Agentguard unavailable: ${agentguard.reason}` };
  }

  if (!jsPolicy.allowed) {
    return {
      allowed: false,
      requiresApproval: Boolean(jsPolicy.requiresApproval),
      classification: jsPolicy.classification,
      reason: jsPolicy.reason,
      jsPolicy,
      agentguard,
    };
  }

  if (!agentguard.allowed) {
    return {
      allowed: false,
      requiresApproval: Boolean(agentguard.requiresApproval),
      classification: jsPolicy.classification,
      reason: agentguard.message || agentguard.reason || 'Agentguard denied command',
      jsPolicy,
      agentguard,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    classification: jsPolicy.classification,
    reason: `Allowed by Agentkodex policy and Agentguard capability ${agentguard.capability?.id || ''}`.trim(),
    jsPolicy,
    agentguard,
  };
}

module.exports = {
  authorizeCommand,
};
