'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  const redacted = redactSecrets('API_KEY=abc123 SECRET=supersecretvalue Authorization: Bearer tokenvalue');
  assert.match(redacted, /API_KEY=\[REDACTED\]/);
  assert.match(redacted, /SECRET=\[REDACTED\]/);
  assert.match(redacted, /Bearer \[REDACTED\]/);
});
