'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { detectAgent, withReadiness } = require('../src/agents');
const { packageConsistencyCheck } = require('../src/release/packageConsistency');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'agentkodex.js');

function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.error) throw result.error;
  return result;
}

function makeProject(prefix, scripts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: prefix, scripts }, null, 2));
  return dir;
}

test('package docs consistency check covers packed command claims', () => {
  const result = packageConsistencyCheck(ROOT);
  assert.equal(result.ok, true, result.details.join('\n'));
});

test('command contracts fail closed while preserving JSON output', () => {
  const dir = makeProject('ak-contract-', { test: 'node -e "process.exit(7)"' });
  const quality = cli(['quality', 'check', '--cwd', dir, '--json']);
  assert.notEqual(quality.status, 0);
  assert.equal(JSON.parse(quality.stdout).ok, false);

  const gates = cli(['gates', 'run', '--cwd', dir, '--gates', 'test', '--quiet']);
  assert.notEqual(gates.status, 0);
  assert.match(gates.stdout, /Exit code: 7/);

  const run = cli(['run', '--cwd', dir, '--skip-agent', '--gates', 'test', '--yes', '--quiet', '--json', 'contract failure']);
  assert.notEqual(run.status, 0);
  const status = JSON.parse(run.stdout);
  assert.equal(status.status, 'failed_gates');
});

test('failed session command returns non-zero and status reconciles completed session', () => {
  const failedDir = makeProject('ak-session-fail-', {});
  const failed = cli(['session', 'start', '--cwd', failedDir, '--agent', 'shell', '--command', 'node -e "process.exit(2)"', '--mode', 'sandbox_auto', '--yes', '--wait', '--no-finalize', 'fail session'], { timeout: 60000 });
  assert.notEqual(failed.status, 0);

  const okDir = makeProject('ak-session-ok-', {});
  const ok = cli(['session', 'start', '--cwd', okDir, '--agent', 'shell', '--command', 'node -e "console.log(123)"', '--mode', 'sandbox_auto', '--yes', '--wait', '--no-finalize', 'ok session'], { timeout: 60000 });
  assert.equal(ok.status, 0, ok.stderr);
  const status = cli(['status', 'last', '--cwd', okDir, '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'session_completed');
});

test('completed session control errors are safe and actionable', () => {
  const dir = makeProject('ak-session-safe-error-', {});
  const start = cli(['session', 'start', '--cwd', dir, '--agent', 'shell', '--command', 'node -e "console.log(1)"', '--mode', 'sandbox_auto', '--yes', '--wait', '--no-finalize', 'safe error'], { timeout: 60000 });
  assert.equal(start.status, 0, start.stderr);
  const send = cli(['session', 'send', '--cwd', dir, 'last', 'hello']);
  assert.notEqual(send.status, 0);
  assert.match(send.stderr, /not live|not accepting control/i);
  assert.doesNotMatch(send.stderr, /\.sock|ENOENT|ECONNREFUSED|\/src\//);
});

test('json-mode thrown errors use safe machine-readable contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-json-error-'));
  const result = cli(['audit', 'verify', '--cwd', dir, '--json']);
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.message, 'string');
  assert.equal(typeof parsed.hint, 'string');
  assert.doesNotMatch(result.stdout, /\.js:\d+|\/src\//);
});

test('swarm all-skipped required phases returns non-zero with lifecycle counts', () => {
  const dir = makeProject('ak-swarm-skip-', {});
  const result = cli(['swarm', '--cwd', dir, '--builder', 'shell', '--reviewer', 'shell', '--task', 'nothing to run']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /skipped=/);
});

test('adapter readiness distinguishes installed from runnable states', async () => {
  const missing = await withReadiness({ id: 'fake', kind: 'custom', installed: false, commandTemplate: null, reason: 'missing' });
  assert.equal(missing.readinessState, 'missing');
  const tty = await withReadiness({ id: 'codex', kind: 'interactive-cli', installed: true, binary: 'codex', commandTemplate: 'codex', stdin: true });
  assert.equal(tty.readinessState, 'installed_not_noninteractive_ready');
  const smoke = await withReadiness({ id: 'fake', kind: 'custom', installed: true, binary: 'node', commandTemplate: 'node {promptFile}', smokeCommand: `${process.execPath} -e "process.exit(3)"` });
  assert.equal(smoke.readinessState, 'failed_smoke');
  const ready = await withReadiness({ id: 'custom', kind: 'custom', installed: true, binary: 'node', commandTemplate: 'node {promptFile}', smokeCommand: `${process.execPath} -e "process.exit(0)"` });
  assert.equal(ready.ready, true);
});

test('doctor reports degraded readiness instead of plain availability', async () => {
  const dir = makeProject('ak-doctor-ready-', {});
  fs.mkdirSync(path.join(dir, '.agentkodex'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agentkodex', 'config.json'), JSON.stringify({
    defaultAgent: 'codex',
    agents: { codex: { kind: 'interactive-cli', commandTemplate: process.execPath, stdin: true } },
  }, null, 2));
  const result = cli(['doctor', '--cwd', dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /installed_not_noninteractive_ready|degraded/);
});

test('installed packed artifact exposes documented command surface', () => {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-pack-'));
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(packed.status, 0, packed.stderr);
  const tgz = path.join(packDir, JSON.parse(packed.stdout)[0].filename);
  const prefix = path.join(packDir, 'install');
  const install = spawnSync('npm', ['install', '-g', '--prefix', prefix, tgz], { encoding: 'utf8', timeout: 120000, env: { ...process.env, AGENTKODEX_SKIP_PATH_REPAIR: '1' } });
  assert.equal(install.status, 0, install.stderr);
  const bin = path.join(prefix, 'bin', 'agentkodex');
  const help = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /chat-first control plane for AI coding agents/);
  assert.match(help.stdout, /agentkodex setup/);
  assert.match(help.stdout, /agentkodex ask/);
  const full = spawnSync(bin, ['help', 'all'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /agentkodex audit anchor/);
  assert.match(full.stdout, /agentkodex quality check/);
});
