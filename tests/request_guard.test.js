'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRequestGuard } = require('../src/runtime/requestGuard');

test('persistent request guard increments and stores hashed token bucket only', () => {
  const root = tempRoot();
  const statePath = path.join(root, '.agentkodex', 'runtime', 'rate.json');
  const guard = createRequestGuard({ root, statePath, maxInvalid: 3 });
  guard.record(new Error('Unauthorized daemon request.'), { type: 'send', token: 'raw-secret-token' });
  const text = fs.readFileSync(statePath, 'utf8');
  assert.doesNotMatch(text, /raw-secret-token/);
  const state = JSON.parse(text);
  assert.equal(Object.values(state.buckets)[0].count, 1);
});

test('persistent request guard survives re-init and denies repeated invalid requests', () => {
  const root = tempRoot();
  const statePath = path.join(root, '.agentkodex', 'runtime', 'rate.json');
  const first = createRequestGuard({ root, statePath, maxInvalid: 2 });
  first.record(new Error('Unauthorized daemon request.'), { type: 'ping', token: 't1' });
  first.record(new Error('Unauthorized daemon request.'), { type: 'ping', token: 't1' });
  const second = createRequestGuard({ root, statePath, maxInvalid: 2 });
  assert.throws(() => second.assert({ type: 'ping', token: 't1' }), /Too many invalid/);
  const evidence = fs.readFileSync(path.join(root, '.agentkodex', 'audit', 'evidence.jsonl'), 'utf8');
  assert.match(evidence, /daemon_request_rate_limited/);
});

test('persistent request guard ignores expired counters after ttl', async () => {
  const root = tempRoot();
  const statePath = path.join(root, '.agentkodex', 'runtime', 'rate.json');
  const guard = createRequestGuard({ root, statePath, maxInvalid: 1, windowMs: 5 });
  guard.record(new Error('Unauthorized daemon request.'), { type: 'ping', token: 't2' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.doesNotThrow(() => guard.assert({ type: 'ping', token: 't2' }));
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-rate-'));
}
