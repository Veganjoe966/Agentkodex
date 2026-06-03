'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { copyDirFiltered, readText } = require('../src/utils');
const { ensureKodex } = require('../src/kodexStore');
const {
  startAgentSession,
  sendToSession,
  finalizeSession,
  getSessionStatus,
} = require('../src/runtime/sessionManager');

function makeSample() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-session-manager-'));
  copyDirFiltered(path.join(__dirname, '..', 'examples', 'sample-js'), dir, { ignore: ['.agentkodex', 'node_modules'] });
  ensureKodex(dir);
  return dir;
}

async function waitForExit(root, id, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let session = null;
  while (Date.now() < deadline) {
    session = getSessionStatus(root, id);
    if (session && !['created', 'starting', 'running', 'stopping'].includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return session;
}

test('supervised per-session runtime captures output and finalizes gates', async () => {
  const dir = makeSample();
  const session = await startAgentSession({
    root: dir,
    task: 'active runtime smoke',
    agent: 'shell',
    command: 'node -e "console.log(\'ACTIVE_SESSION\')"',
    mode: 'sandbox_auto',
    yes: true,
    gates: ['lint', 'test', 'build'],
  });
  const final = await waitForExit(dir, session.id);
  assert.equal(final.exitCode, 0);
  const transcript = readText(final.files.transcript);
  assert.match(transcript, /ACTIVE_SESSION/);

  const result = await finalizeSession(dir, session.id, { force: true, yes: true, echo: false });
  assert.equal(result.status.status, 'passed');
  assert.equal(result.qa.pass, true);
  assert.equal(result.gateResults.filter((g) => g.result && g.result.exitCode === 0).length, 3);
});

test('supervised per-session runtime accepts live input', async () => {
  const dir = makeSample();
  const script = "process.stdin.on('data',d=>{console.log('LIVE_ECHO:'+d.toString().trim()); if(d.toString().includes('bye')) process.exit(0)}); console.log('READY_FOR_INPUT')";
  const session = await startAgentSession({
    root: dir,
    task: 'active send smoke',
    agent: 'shell',
    command: `node -e ${JSON.stringify(script)}`,
    mode: 'sandbox_auto',
    yes: true,
    gates: ['none'],
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await sendToSession(dir, session.id, 'bye');
  const final = await waitForExit(dir, session.id);
  assert.equal(final.exitCode, 0);
  const transcript = readText(final.files.transcript);
  assert.match(transcript, /READY_FOR_INPUT/);
  assert.match(transcript, /LIVE_ECHO:bye/);
});
