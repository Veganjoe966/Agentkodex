'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyCommand, policyAllows, redactSecrets } = require('../src/policy');

test('blocks destructive commands', () => {
  assert.equal(classifyCommand('rm -rf /').risk, 'blocked');
  assert.equal(policyAllows('rm -rf /', { mode: 'trusted_auto', yes: true }).allowed, false);
});

test('allows test commands', () => {
  const decision = policyAllows('npm run test', { mode: 'supervised' });
  assert.equal(decision.allowed, true);
});

test('observe mode only allows read-only commands', () => {
  assert.equal(policyAllows('git diff', { mode: 'observe' }).allowed, true);
  assert.equal(policyAllows('npm run test', { mode: 'observe' }).allowed, false);
});

test('requires approval for installs', () => {
  assert.equal(policyAllows('pnpm add lodash', { mode: 'supervised' }).allowed, false);
  assert.equal(policyAllows('pnpm add lodash', { mode: 'supervised', yes: true }).allowed, true);
});

test('manual approval patterns still require explicit yes in auto modes', () => {
  assert.equal(policyAllows('sudo true', { mode: 'sandbox_auto' }).allowed, false);
  assert.equal(policyAllows('sudo true', { mode: 'sandbox_auto', yes: true }).allowed, true);
});

test('redacts secret-looking values', () => {
  const redacted = redactSecrets('API_KEY=abc123 SECRET=supersecretvalue Authorization: Bearer tokenvalue github_pat_abcdefghijklmnopqrstuvwxyz npm_abcdefghijklmnopqrstuvwxyz sk_live_abcdefghijklmnopqrstuvwxyz');
  assert.match(redacted, /API_KEY=\[REDACTED\]/);
  assert.match(redacted, /SECRET=\[REDACTED\]/);
  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(redacted, /github_pat_/);
  assert.doesNotMatch(redacted, /npm_/);
  assert.doesNotMatch(redacted, /sk_live_/);
});

test('policy config can deny unknown and disabled command classes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-policy-config-'));
  fs.writeFileSync(path.join(root, 'agentkodex.policy.json'), JSON.stringify({
    defaultDeny: true,
    allowNetwork: false,
    allowedActions: ['^npm run test$'],
  }));
  assert.equal(policyAllows('npm run test', { root, mode: 'sandbox_auto' }).allowed, true);
  assert.equal(policyAllows('curl https://example.com', { root, mode: 'trusted_auto', yes: true }).allowed, false);
  assert.equal(policyAllows('custom-tool does-something', { root, mode: 'trusted_auto', yes: true }).allowed, false);
});
