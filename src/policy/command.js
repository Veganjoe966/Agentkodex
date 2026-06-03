'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { classifyCommand, policyAllows } = require('../policy.js');
const { authorizeCommand } = require('../authorization');
const { loadPolicyConfig } = require('./config');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function policyCommand(argv) {
  const normalized = normalizeDashes(argv);
  const sub = normalized[0] === 'check' ? 'check' : 'check';
  const rest = normalized[0] === 'check' ? normalized.slice(1) : normalized;
  if (sub !== 'check') throw new Error(`Unknown policy subcommand: ${sub}`);
  const { flags, positionals } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  const command = positionals.join(' ') || stringFlag(flags, 'command', '');
  const config = loadPolicyConfig(root);
  const output = command ? commandDecision(root, command, flags, config) : configDecision(root, config);
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(output, null, 2));
  else render(output);
  if (!output.ok) process.exitCode = 1;
}

function commandDecision(root, command, flags, config) {
  const mode = stringFlag(flags, 'mode', 'supervised');
  const yes = booleanFlag(flags, 'yes');
  const classification = classifyCommand(command);
  const decision = policyAllows(command, { root, mode, yes, policy: config });
  const authorization = authorizeCommand(command, { root, mode, yes, policy: config });
  return {
    ok: Boolean(decision.allowed && authorization.allowed),
    root,
    command,
    classification,
    decision,
    authorization,
    config,
  };
}

function configDecision(root, config) {
  return {
    ok: true,
    root,
    summary: 'Policy config loaded.',
    config,
  };
}

function render(output) {
  console.log(output.command ? `Policy check: ${output.command}` : 'Policy check');
  console.log(`ok: ${output.ok}`);
  if (output.decision) console.log(`decision: ${output.decision.reason}`);
  console.log(`defaultDeny: ${output.config.defaultDeny}`);
  console.log(`requireEd25519: ${output.config.requireEd25519}`);
  console.log(`allowLegacyHmac: ${output.config.allowLegacyHmac}`);
}

function normalizeDashes(argv) {
  return argv.map((item) => String(item).replace(/^–/, '--'));
}

module.exports = {
  policyCommand,
};
