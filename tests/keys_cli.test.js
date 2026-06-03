'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'agentkodex.js');

test('keys status and list work without printing private keys', () => {
  const dir = tempRoot();
  const status = cli(dir, ['keys', 'status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /active signing key/);
  const list = cli(dir, ['keys', 'list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  const parsed = JSON.parse(list.stdout);
  assert.ok(parsed.verificationKeys.length >= 1);
  assert.doesNotMatch(list.stdout, /PRIVATE KEY|privateKeyPem/i);
});

test('keys rotate json creates a new active key and writes audit evidence', () => {
  const dir = tempRoot();
  const before = JSON.parse(cli(dir, ['keys', 'list', '--json']).stdout).verificationKeys[0].keyId;
  const rotated = cli(dir, ['keys', 'rotate', '--json']);
  assert.equal(rotated.status, 0, rotated.stderr);
  const data = JSON.parse(rotated.stdout);
  assert.equal(data.rotated, true);
  assert.notEqual(data.activeKey.keyId, before);
  assert.doesNotMatch(rotated.stdout, /PRIVATE KEY|privateKeyPem/i);
  const evidence = fs.readFileSync(path.join(dir, '.agentkodex', 'audit', 'evidence.jsonl'), 'utf8');
  assert.match(evidence, /ed25519_key_created/);
  assert.match(evidence, /ed25519_key_rotated/);
});

test('keys retire disables an old verification key', () => {
  const dir = tempRoot();
  const first = JSON.parse(cli(dir, ['keys', 'list', '--json']).stdout).verificationKeys[0].keyId;
  cli(dir, ['keys', 'rotate']);
  const retired = cli(dir, ['keys', 'retire', first, '--json']);
  assert.equal(retired.status, 0, retired.stderr);
  const list = JSON.parse(cli(dir, ['keys', 'list', '--json']).stdout);
  assert.equal(list.verificationKeys.some((key) => key.keyId === first), false);
});

test('keys status fails safely on corrupt key store', () => {
  const dir = tempRoot();
  fs.mkdirSync(path.join(dir, '.agentkodex', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agentkodex', 'runtime', 'capability-keys.json'), '{bad json');
  const result = cli(dir, ['keys', 'status']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /key error/i);
  assert.doesNotMatch(result.stderr, /at .*src|PRIVATE KEY|privateKeyPem/i);
  const rotate = cli(dir, ['keys', 'rotate']);
  assert.notEqual(rotate.status, 0);
  const evidence = fs.readFileSync(path.join(dir, '.agentkodex', 'audit', 'evidence.jsonl'), 'utf8');
  assert.match(evidence, /ed25519_key_rotation_failed/);
});

function cli(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args, '--cwd', cwd], { encoding: 'utf8', timeout: 10000 });
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-keys-cli-'));
}
