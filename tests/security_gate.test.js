'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { authorizeAgentAction } = require('../src/gates/securityGate');

test('agentguard security gate denies unknown dangerous command', () => {
  const result = authorizeAgentAction({
    projectRoot: path.resolve(__dirname, '..'),
    sessionId: 's1',
    agentId: 'builder',
    actionType: 'command',
    command: 'rm -rf /',
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /blocked/i);
  assert.equal(result.auditRecord.command, 'rm -rf /');
});

test('agentguard security gate allows explicitly permitted safe action', () => {
  const result = authorizeAgentAction({
    projectRoot: path.resolve(__dirname, '..'),
    sessionId: 's2',
    agentId: 'qa',
    actionType: 'command',
    command: 'git status',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiredApproval, false);
  assert.equal(result.auditRecord.capabilityTokenPresent, false);
});

test('repo has no checked-in env files or disallowed telemetry artifacts', () => {
  const root = path.resolve(__dirname, '..');
  const files = walk(root).filter((file) => !file.includes(`${path.sep}.agentkodex${path.sep}`));
  assert.equal(files.some((file) => path.basename(file) === '.env'), false);
  assert.equal(files.some((file) => file.includes(`${path.sep}.emergent${path.sep}`)), false);
  const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /@emergentbase|posthog/i);
});

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
