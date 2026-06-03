'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCommand, firstCommandToken } = require('../src/sessionRunner');
const { issueRuntimeCapability } = require('../src/capabilities/phases');

test('firstCommandToken handles quoted commands', () => {
  assert.equal(firstCommandToken('node --version'), 'node');
  assert.equal(firstCommandToken('"my command" --flag'), 'my command');
});

test('runCommand captures stdout and exit code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-run-'));
  const capability = issueRuntimeCapability(dir, { sessionId: 'run-command', agentId: 'test-agent', cwd: dir });
  const result = await runCommand('node -e "console.log(123)"', {
    cwd: dir,
    logDir: dir,
    mode: 'sandbox_auto',
    echo: false,
    capability,
    sessionId: 'run-command',
    agent: 'test-agent',
    requireCapability: true,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /123/);
  assert.ok(fs.existsSync(path.join(dir, 'transcript.log')));
});

test('runCommand denies unknown command without valid capability', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-run-deny-'));
  const result = await runCommand('node -e "console.log(456)"', {
    cwd: dir,
    logDir: dir,
    mode: 'sandbox_auto',
    echo: false,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /capability/i);
});
