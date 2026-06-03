'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig, updateRunStatus } = require('../kodexStore');
const { appendText, redact } = require('../utils');
const { redactSecrets } = require('../policy');
const { spawnTerminal } = require('./terminalProcess');
const { loadSession, saveSession, appendEvent, readInbox } = require('./sessionStore');
const { detectState, detectApprovalRequest } = require('./stateDetector');
const { createApproval } = require('./approvalQueue');

function startWorkerProcess(root, sessionId) {
  const cliPath = path.resolve(__dirname, '..', '..', 'bin', 'agentkodex.js');
  const child = spawn(process.execPath, [cliPath, 'runtime-worker', '--cwd', root, '--session', sessionId], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AGENTKODEX_WORKER: '1' },
  });
  child.unref();
  return child.pid;
}

async function runWorker(root, sessionId) {
  let session = loadSession(root, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  appendText(session.files.workerLog, `${new Date().toISOString()} worker starting\n`);
  appendEvent(session, { type: 'worker.starting', pid: process.pid });
  session = saveSession(session, { workerPid: process.pid, status: 'starting', state: 'starting', startedAt: new Date().toISOString() });

  if (!session.command) {
    session = saveSession(session, { status: 'failed', state: 'failed', exitCode: 127, lastStateReason: 'No session command configured.' });
    appendEvent(session, { type: 'worker.failed', message: 'No session command configured.' });
    return;
  }

  appendText(session.files.transcript, `\n[Agentkodex session ${session.id}]\n$ ${session.command}\n`);
  appendEvent(session, { type: 'process.starting', command: session.command, cwd: session.root, usePty: Boolean(session.usePty) });

  const terminal = spawnTerminal(session.command, { cwd: session.root, usePty: Boolean(session.usePty), env: { AGENTKODEX_SESSION_ID: session.id } });
  session = saveSession(session, { status: 'running', state: 'command_running', childPid: terminal.pid, terminalKind: terminal.kind, lastStateReason: `spawned ${terminal.kind}` });
  appendEvent(session, { type: 'process.started', childPid: terminal.pid, terminalKind: terminal.kind });

  // Some adapters need the prompt sent after the process starts.
  const config = loadConfig(session.root);
  const adapterConfig = (config.agents || {})[session.agent] || {};
  if (adapterConfig.stdin) {
    const prompt = fs.existsSync(session.promptFile) ? fs.readFileSync(session.promptFile, 'utf8') : session.task;
    terminal.write(prompt.endsWith('\n') ? prompt : `${prompt}\n`);
    appendEvent(session, { type: 'input.sent', source: 'mission-prompt', bytes: Buffer.byteLength(prompt) });
  }

  let buffer = '';
  let lastState = session.state;
  let lastInboxSeq = Number(session.lastInboxSeq || 0);
  let lastApprovalFingerprint = '';
  let closed = false;

  const persistOutput = (chunk) => {
    const clean = redactSecrets(String(chunk || ''));
    if (!clean) return;
    buffer = `${buffer}${clean}`.slice(-100000);
    appendText(session.files.transcript, clean);
    appendEvent(session, { type: 'terminal.output', bytes: Buffer.byteLength(clean), text: clean.slice(-4000) });
    const state = detectState(buffer, lastState);
    const patch = { lastOutputAt: new Date().toISOString() };
    if (state.state !== lastState || state.confidence >= 0.8) {
      lastState = state.state;
      patch.state = state.state;
      patch.lastStateReason = state.reason;
      appendEvent(session, { type: 'state.detected', ...state });
    }
    session = saveSession(session, patch);

    const approvalRequest = detectApprovalRequest(buffer);
    if (approvalRequest && approvalRequest.fingerprint !== lastApprovalFingerprint) {
      lastApprovalFingerprint = approvalRequest.fingerprint;
      const approval = createApproval(session, approvalRequest);
      appendText(session.files.workerLog, `${new Date().toISOString()} approval created ${approval.id}\n`);
    }
  };

  terminal.onData(persistOutput);
  if (terminal.onError) terminal.onError((error) => {
    appendText(session.files.workerLog, `${new Date().toISOString()} child error ${error.stack || error.message}\n`);
    persistOutput(`\n[Agentkodex child error] ${error.message}\n`);
  });

  const interval = setInterval(() => {
    if (closed) return;
    try {
      const inbox = readInbox(session, lastInboxSeq);
      for (const item of inbox) {
        lastInboxSeq = Math.max(lastInboxSeq, Number(item.seq || 0));
        handleInboxItem(terminal, session, item);
      }
      session = saveSession(session, { lastInboxSeq, heartbeatAt: new Date().toISOString() });
    } catch (error) {
      appendText(session.files.workerLog, `${new Date().toISOString()} inbox error ${error.stack || error.message}\n`);
    }
  }, 300);
  interval.unref();

  await new Promise((resolve) => {
    terminal.onExit((exitCode, signal) => {
      closed = true;
      clearInterval(interval);
      appendText(session.files.transcript, `\n[exit ${exitCode}${signal ? ` signal ${signal}` : ''}]\n`);
      appendEvent(session, { type: 'process.exit', exitCode, signal });
      const finalStatus = exitCode === 0 ? 'completed' : 'failed';
      session = saveSession(session, {
        status: finalStatus,
        state: finalStatus,
        exitCode,
        signal,
        completedAt: new Date().toISOString(),
        lastStateReason: `process exited with code ${exitCode}${signal ? ` signal ${signal}` : ''}`,
      });
      if (session.runDir) {
        try { updateRunStatus(session.runDir, { status: finalStatus === 'completed' ? 'session_completed' : 'session_failed', sessionExitCode: exitCode, sessionSignal: signal }); } catch (_) {}
      }
      resolve();
    });
  });
}

function handleInboxItem(terminal, session, item) {
  const type = item.type;
  const payload = item.payload || {};
  appendEvent(session, { type: 'inbox.processed', inboxType: type, seq: item.seq });

  if (type === 'send') {
    const text = String(payload.text || '');
    terminal.write(text.endsWith('\n') ? text : `${text}\n`);
    appendText(session.files.transcript, `\n[Agentkodex send]\n${text}\n`);
    appendEvent(session, { type: 'input.sent', source: 'user', bytes: Buffer.byteLength(text) });
    return;
  }

  if (type === 'keystrokes') {
    const text = String(payload.text || '');
    terminal.write(text);
    appendEvent(session, { type: 'input.sent', source: 'keystrokes', bytes: Buffer.byteLength(text) });
    return;
  }

  if (type === 'approval_decision') {
    const response = String(payload.response || (payload.decision === 'approved' ? 'y' : 'n'));
    terminal.write(response.endsWith('\n') ? response : `${response}\n`);
    appendText(session.files.transcript, `\n[Agentkodex approval ${payload.decision || ''}: ${payload.approvalId || ''}]\n`);
    appendEvent(session, { type: 'approval.response_sent', approvalId: payload.approvalId, decision: payload.decision });
    return;
  }

  if (type === 'interrupt') {
    terminal.kill('SIGINT');
    appendText(session.files.transcript, '\n[Agentkodex interrupt: SIGINT]\n');
    appendEvent(session, { type: 'process.interrupt' });
    return;
  }

  if (type === 'kill') {
    terminal.kill(payload.signal || 'SIGTERM');
    appendText(session.files.transcript, `\n[Agentkodex kill: ${payload.signal || 'SIGTERM'}]\n`);
    appendEvent(session, { type: 'process.kill', signal: payload.signal || 'SIGTERM' });
    return;
  }

  if (type === 'resize') {
    terminal.resize(Number(payload.cols || 120), Number(payload.rows || 40));
    appendEvent(session, { type: 'terminal.resize', cols: payload.cols, rows: payload.rows });
  }
}

module.exports = {
  startWorkerProcess,
  runWorker,
};
