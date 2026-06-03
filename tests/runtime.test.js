'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureKodex } = require('../src/kodexStore');
const { ensureDaemon, request, requestSocket, stopDaemon, waitForSession } = require('../src/runtime/client');
const { resolveSession, socketPathForRoot } = require('../src/runtime/sessionStore');
const { withDaemonToken } = require('../src/runtime/daemonAuth');
const { issueRuntimeCapability } = require('../src/capabilities/phases');
const { issueCapability } = require('../src/capabilities/issuer');
const { detectState, detectApprovalRequest } = require('../src/runtime/stateDetector');

test('state detector sees approval prompts', () => {
  assert.equal(detectState('Do you want to continue? [y/n]', 'agent_running'), 'awaiting_approval');
  const approval = detectApprovalRequest('Permission required. Approve command? y/n');
  assert.ok(approval);
  assert.match(approval.prompt, /Approve/);
});

test('runtime daemon starts a session and captures output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-runtime-'));
  ensureKodex(dir);
  await ensureDaemon(dir);
  const socketPath = socketPathForRoot(dir);
  const raw = await requestSocket(socketPath, { type: 'ping' });
  assert.equal(raw.ok, false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
  const command = 'node -e "console.log(\'AK_READY\'); setTimeout(()=>{console.log(\'AK_DONE\')}, 80)"';
  const started = await request(dir, {
    type: 'startSession',
    session: { agent: 'shell', task: 'runtime smoke', command, cwd: dir, mode: 'sandbox_auto', yes: true, closeStdin: true },
  });
  assert.ok(started.session.id);
  const final = await waitForSession(dir, started.session.id, { timeoutMs: 5000, pollMs: 100 });
  assert.equal(final.session.exitCode, 0);
  const saved = resolveSession(dir, started.session.id);
  const transcript = fs.readFileSync(saved.files.transcript, 'utf8');
  assert.match(transcript, /AK_READY/);
  assert.match(transcript, /AK_DONE/);
  await stopDaemon(dir);
});

test('runtime execution path denies command without valid capability', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-runtime-no-cap-'));
  ensureKodex(dir);
  await ensureDaemon(dir);
  const command = 'node -e "console.log(\'SHOULD_NOT_RUN\')"';
  const raw = await requestSocket(socketPathForRoot(dir), withDaemonToken(dir, {
    type: 'startSession',
    session: { agent: 'shell', task: 'no cap', command, cwd: dir, mode: 'sandbox_auto', yes: true },
  }));
  assert.equal(raw.ok, false);
  assert.match(raw.error, /capability/i);
  assert.equal(fs.existsSync(path.join(dir, '.agentkodex', 'last-session')), false);
  const evidence = fs.readFileSync(path.join(dir, '.agentkodex', 'audit', 'evidence.jsonl'), 'utf8');
  assert.match(evidence, /capability_validation/);
  await stopDaemon(dir);
});

test('runtime daemon denies expired and wrong-scope capabilities', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-runtime-bad-cap-'));
  ensureKodex(dir);
  await ensureDaemon(dir);
  const expired = issueRuntimeCapability(dir, { sessionId: 'expired', agentId: 'shell', cwd: dir, ttlMs: -1 });
  const wrongSession = issueRuntimeCapability(dir, { sessionId: 'other-session', agentId: 'shell', cwd: dir });
  const wrongAgent = issueRuntimeCapability(dir, { sessionId: 'wrong', agentId: 'other', cwd: dir });
  const wrongPhase = issueCapability(dir, { sessionId: 'phase', agentId: 'shell', phase: 'swarm', allowedActions: ['command:start'], allowedPaths: [dir] });
  const wrongPath = issueRuntimeCapability(dir, { sessionId: 'path', agentId: 'shell', cwd: path.join(dir, 'allowed-only') });
  for (const [sessionId, capability, pattern] of [
    ['expired', expired, /expired/i],
    ['wrong-session', wrongSession, /session scope/i],
    ['wrong', wrongAgent, /agent scope/i],
    ['phase', wrongPhase, /phase scope/i],
    ['path', wrongPath, /path/i],
  ]) {
    const raw = await requestSocket(socketPathForRoot(dir), withDaemonToken(dir, {
      type: 'startSession',
      session: { sessionId, agent: 'shell', task: 'bad cap', command: 'node -e "console.log(1)"', cwd: dir, mode: 'sandbox_auto', yes: true, capability },
    }));
    assert.equal(raw.ok, false);
    assert.match(raw.error, pattern);
  }
  await stopDaemon(dir);
});

test('runtime daemon allows valid scoped capability', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-runtime-valid-cap-'));
  ensureKodex(dir);
  await ensureDaemon(dir);
  const sessionId = 'valid-runtime-cap';
  const capability = issueRuntimeCapability(dir, { sessionId, agentId: 'shell', cwd: dir });
  const started = await requestSocket(socketPathForRoot(dir), withDaemonToken(dir, {
    type: 'startSession',
    session: { sessionId, agent: 'shell', task: 'valid cap', command: 'node -e "console.log(\'VALID_CAP\')"', cwd: dir, mode: 'sandbox_auto', yes: true, capability, closeStdin: true },
  }));
  assert.equal(started.ok, true);
  const final = await waitForSession(dir, sessionId, { timeoutMs: 5000, pollMs: 100 });
  assert.equal(final.session.exitCode, 0);
  assert.match(fs.readFileSync(resolveSession(dir, sessionId).files.transcript, 'utf8'), /VALID_CAP/);
  await stopDaemon(dir);
});

test('runtime daemon supports sending input to a live session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-runtime-send-'));
  ensureKodex(dir);
  await ensureDaemon(dir);
  const script = "process.stdin.on('data',d=>{console.log('ECHO:'+d.toString().trim()); if(d.toString().includes('bye')) process.exit(0)}); console.log('WAITING')";
  const command = `node -e ${JSON.stringify(script)}`;
  const started = await request(dir, {
    type: 'startSession',
    session: { agent: 'shell', task: 'send smoke', command, cwd: dir, mode: 'sandbox_auto', yes: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await request(dir, { type: 'send', sessionId: started.session.id, input: 'bye' });
  const final = await waitForSession(dir, started.session.id, { timeoutMs: 5000, pollMs: 100 });
  assert.equal(final.session.exitCode, 0);
  const saved = resolveSession(dir, started.session.id);
  const transcript = fs.readFileSync(saved.files.transcript, 'utf8');
  assert.match(transcript, /WAITING/);
  assert.match(transcript, /ECHO:bye/);
  await stopDaemon(dir);
});
