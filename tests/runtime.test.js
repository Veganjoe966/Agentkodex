'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureKodex } = require('../src/kodexStore');
const { ensureDaemon, request, requestSocket, stopDaemon, waitForSession } = require('../src/runtime/client');
const { resolveSession, socketPathForRoot } = require('../src/runtime/sessionStore');
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
