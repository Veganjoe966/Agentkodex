'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureKodex } = require('../src/kodexStore');
const { startAgentSession, sendToSession, getSessionStatus, replaySession } = require('../src/runtime/sessionManager');

test('supervised session manager supports interactive send and replay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-session-manager-'));
  ensureKodex(root);
  const session = await startAgentSession({
    root,
    task: 'session manager smoke',
    agent: 'shell',
    command: 'printf "READY\\n"; read line; printf "GOT:%s\\n" "$line"',
    mode: 'sandbox_auto',
    yes: true,
    gates: ['none'],
  });
  assert.ok(session.id);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await sendToSession(root, session.id, 'hello');
  let status = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    status = getSessionStatus(root, session.id);
    if (status && status.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(status.status, 'completed');
  assert.match(replaySession(root, session.id), /GOT:hello/);
});
