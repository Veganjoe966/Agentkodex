'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createApproval } = require('../src/runtime/approvalQueue');

const BIN = path.join(__dirname, '..', 'bin', 'agentkodex.js');

function run(args, options = {}) {
  const result = require('child_process').spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd || path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: options.timeout || 10000,
  });
  if (result.error) throw result.error;
  return result;
}

test('cli help and version boot without missing imports', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Agentkodex/);
  assert.match(help.stdout, /Runtime v2/);

  const version = run(['version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^0\.3\.0$/);
});

test('cli cockpit snapshot works without starting a long-lived server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-cli-cockpit-'));
  const result = run(['cockpit', '--cwd', dir, '--once']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agentkodex Cockpit Snapshot/);
});

test('cli approvals list includes open runtime approvals', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-cli-approvals-'));
  const approval = createApproval(dir, { prompt: 'Approve this operation? [y/n]', command: 'npm install demo' });
  const result = run(['approvals', 'list', '--cwd', dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(approval.id));
  assert.match(result.stdout, /open/);
});
