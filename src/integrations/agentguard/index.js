'use strict';

const { authorizeWithAgentguard } = require('../../agentguard/bridge');
const { authorizeAgentAction } = require('../../gates/securityGate');

module.exports = {
  authorizeWithAgentguard,
  authorizeAgentAction,
};
