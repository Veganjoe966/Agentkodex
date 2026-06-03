'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { authorizeCommand } = require('../src/authorization');
const { findAgentguardSource } = require('../src/agentguard/bridge');

const source = findAgentguardSource('/root/agentkodex', {});

test('agentguard bridge authorizes safe commands and gates risky commands', { skip: !source }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-agentguard-'));
  const safe = authorizeCommand('npm run test', { root: dir, mode: 'supervised' });
  assert.equal(safe.allowed, true);
  assert.equal(safe.agentguard.available, true);
  assert.equal(safe.agentguard.capability.signaturePresent, true);

  const risky = authorizeCommand('pnpm add left-pad', { root: dir, mode: 'sandbox_auto' });
  assert.equal(risky.allowed, false);
  assert.equal(risky.requiresApproval, true);

  const approved = authorizeCommand('pnpm add left-pad', { root: dir, mode: 'sandbox_auto', yes: true });
  assert.equal(approved.allowed, true);
  assert.equal(approved.agentguard.explicitApproval, true);
  assert.ok(fs.existsSync(path.join(dir, '.agentkodex', 'agentguard-policy.yaml')));
});
