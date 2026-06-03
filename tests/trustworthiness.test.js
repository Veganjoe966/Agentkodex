'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { HELP } = require('../src/helpContract');
const { isFailureStatus } = require('../src/statusContract');
const { classifyAdapterRuntimeLimit } = require('../src/adapters/runtimeLimit');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'agentkodex.js');

test('every command help path exits zero and does not perform work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-help-contract-'));
  for (const command of Object.keys(HELP)) {
    const result = cli([command, '--cwd', dir, '--help']);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /Usage:/, command);
    assert.doesNotMatch(result.stderr, /Missing|Unknown|Error/i, command);
  }
  assert.equal(fs.existsSync(path.join(dir, '.agentkodex')), false);
});

test('skipped required gates are not reported as passed', () => {
  const dir = project('ak-skipped-gates-');
  const result = cli(['gates', 'run', '--cwd', dir, '--gates', 'lint', '--quiet']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Status: skipped/);
  assert.match(result.stdout, /Run directory:/);
});

test('run and status agree when required gates were not run', () => {
  const dir = project('ak-state-no-gates-');
  const run = cli(['run', '--cwd', dir, '--skip-agent', '--gates', 'lint', '--quiet', '--json', 'state truth']);
  assert.notEqual(run.status, 0);
  const parsedRun = JSON.parse(run.stdout);
  assert.equal(parsedRun.status, 'completed_no_gates_discovered');
  assert.equal(isFailureStatus(parsedRun.status), true);

  const status = cli(['status', 'last', '--cwd', dir, '--json']);
  assert.notEqual(status.status, 0);
  assert.equal(JSON.parse(status.stdout).status, parsedRun.status);
});

test('adapter sandbox errors are translated without raw low-level output', () => {
  const limit = classifyAdapterRuntimeLimit('codex', 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted');
  assert.equal(limit.readinessState, 'degraded');
  assert.match(limit.message, /Codex CLI is installed, but its internal sandbox cannot run here/);
  assert.doesNotMatch(limit.message, /RTM_NEWADDR|bwrap|loopback/i);
  assert.match(limit.hint, /user namespaces|another ready agent/);
});

function project(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: prefix, scripts: {} }));
  return dir;
}

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
}
