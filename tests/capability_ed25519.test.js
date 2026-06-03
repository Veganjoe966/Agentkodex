'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { issueCapability, legacySign } = require('../src/capabilities/issuer');
const { verifyCapability } = require('../src/capabilities/verify');
const { rotateCapabilityKey } = require('../src/capabilities/keys');

test('ed25519 capability signature is accepted', () => {
  const dir = tempRoot();
  const cap = issueCapability(dir, scoped(dir));
  const result = verifyCapability(dir, cap, expected(dir));
  assert.equal(result.allowed, true);
  assert.equal(cap.algorithm, 'ed25519');
  assert.match(cap.keyId, /^ak_/);
});

test('invalid ed25519 signature is rejected and audited', () => {
  const dir = tempRoot();
  const cap = { ...issueCapability(dir, scoped(dir)), signature: 'bad' };
  const result = verifyCapability(dir, cap, expected(dir));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /signature/i);
  assert.match(evidence(dir), /signature_mismatch/);
});

test('tampered ed25519 payload is rejected', () => {
  const dir = tempRoot();
  const cap = issueCapability(dir, scoped(dir));
  const result = verifyCapability(dir, { ...cap, allowedActions: ['other'] }, expected(dir));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /signature/i);
});

test('expired capability is rejected after signature validation', () => {
  const dir = tempRoot();
  const cap = issueCapability(dir, scoped(dir, { ttlMs: -1 }));
  const result = verifyCapability(dir, cap, expected(dir));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /expired/i);
});

test('rotated ed25519 verification keys keep old capabilities valid', () => {
  const dir = tempRoot();
  const first = issueCapability(dir, scoped(dir));
  rotateCapabilityKey(dir, { reason: 'test' });
  const second = issueCapability(dir, scoped(dir, { sessionId: 'session-two' }));
  assert.equal(verifyCapability(dir, first, expected(dir)).allowed, true);
  assert.equal(verifyCapability(dir, second, expected(dir, { sessionId: 'session-two' })).allowed, true);
  assert.match(evidence(dir), /capability_key_rotation/);
});

test('legacy hmac capability works in compatibility mode and logs warning', () => {
  const dir = tempRoot();
  const cap = legacyCapability(dir);
  const result = verifyCapability(dir, cap, expected(dir));
  assert.equal(result.allowed, true);
  assert.equal(result.warning, 'legacy_hmac_capability');
  assert.match(evidence(dir), /legacy_capability_used/);
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-cap-ed-'));
}

function scoped(dir, overrides = {}) {
  return {
    sessionId: overrides.sessionId || 'session-one',
    agentId: 'agent-one',
    phase: 'runtime',
    allowedActions: ['command:start'],
    allowedPaths: [dir],
    ttlMs: overrides.ttlMs,
  };
}

function expected(dir, overrides = {}) {
  return {
    sessionId: overrides.sessionId || 'session-one',
    agentId: 'agent-one',
    phase: 'runtime',
    action: 'command:start',
    path: dir,
  };
}

function legacyCapability(dir) {
  const cap = {
    capabilityId: 'legacy-one',
    sessionId: 'session-one',
    agentId: 'agent-one',
    phase: 'runtime',
    allowedActions: ['command:start'],
    allowedPaths: [dir],
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    issuedBy: 'agentguard',
  };
  return { ...cap, signature: legacySign(dir, cap) };
}

function evidence(dir) {
  return fs.readFileSync(path.join(dir, '.agentkodex', 'audit', 'evidence.jsonl'), 'utf8');
}
