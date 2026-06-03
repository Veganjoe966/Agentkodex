#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { readJson, writeJson, appendText, ensureDir, shellQuote } = require('../utils');
const { redactSecrets } = require('../policy');
const { hardenSocket, sanitizeError } = require('../security/controlPlane');
const { detectState, detectApproval, trimBuffer } = require('./stateDetector');
const { patchSession, appendEvent } = require('./sessionStore');
const { createApproval, markApproval } = require('./approvalQueue');
const { ensureSessionToken, assertSessionToken } = require('./controlToken');

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgv(argv);
  const metadataPath = flags.metadata;
  if (!metadataPath) throw new Error('Supervisor missing --metadata <metadata.json>');
  let metadata = readJson(metadataPath, null);
  if (!metadata) throw new Error(`Could not read session metadata: ${metadataPath}`);
  ensureSessionToken(metadata);
  const root = metadata.root;
  ensureDir(metadata.dir);
  ensureDir(path.dirname(metadata.files.transcript));
  ensureDir(path.dirname(metadata.files.events));
  ensureDir(path.dirname(metadata.files.supervisor));

  logSupervisor(metadata, `supervisor starting for ${metadata.id}`);
  cleanupSocket(metadata.socketPath);

  let child = null;
  let recentBuffer = '';
  let openApprovalId = null;
  const seenApprovalPrompts = new Set();
  let server = null;
  let stopping = false;

  function update(patch) {
    metadata = patchSession(root, metadata.id, { ...metadata, ...patch });
    return metadata;
  }

  function event(event) {
    try { appendEvent(root, metadata.id, event); } catch (error) { logSupervisor(metadata, `event write failed: ${error.message}`); }
  }

  function writeOutput(stream, chunk) {
    const text = redactSecrets(chunk.toString());
    fs.appendFileSync(metadata.files.transcript, text, 'utf8');
    event({ type: 'output', stream, text });
    recentBuffer = trimBuffer(recentBuffer + text);
    const detectedApproval = detectApproval(recentBuffer);
    const nextState = detectState(recentBuffer, metadata.state);
    const patch = { lastOutputAt: new Date().toISOString(), state: nextState };
    if (nextState === 'awaiting_approval' && detectedApproval) {
      const approvalKey = `${metadata.id}:${detectedApproval.text || detectedApproval.prompt || ''}`;
      if (!seenApprovalPrompts.has(approvalKey) && !metadata.openApprovalId && !openApprovalId) {
        seenApprovalPrompts.add(approvalKey);
        const approval = createApproval(root, {
          sessionId: metadata.id,
          runId: metadata.runId || null,
          agent: metadata.agent,
          text: detectedApproval.text,
          command: metadata.command,
          defaultApproveInput: detectedApproval.defaultApproveInput,
          defaultDenyInput: detectedApproval.defaultDenyInput,
          confidence: detectedApproval.confidence,
        });
        openApprovalId = approval.id;
        patch.openApprovalId = approval.id;
        patch.lastDetectedPrompt = detectedApproval.text;
        event({ type: 'approval_detected', approvalId: approval.id, text: detectedApproval.text });
      }
    }
    update(patch);
  }

  function respond(socket, value) {
    try { socket.write(`${JSON.stringify(value)}\n`); } catch (_) {}
    try { socket.end(); } catch (_) {}
  }

  function handleRequest(socket, request) {
    try { assertSessionToken(metadata, request); } catch (error) { return respond(socket, { ok: false, error: sanitizeError(error) }); }
    const action = request.action || 'status';
    if (action === 'status') {
      respond(socket, { ok: true, session: sanitizeMetadata(metadata), childAlive: Boolean(child && !child.killed) });
      return;
    }
    if (action === 'send') {
      const message = String(request.message || '');
      if (!child || child.killed || !child.stdin.writable) return respond(socket, { ok: false, error: 'session process is not writable' });
      child.stdin.write(message);
      if (request.newline !== false && !message.endsWith('\n')) child.stdin.write('\n');
      event({ type: 'input', source: 'user', text: redactSecrets(message) + (message.endsWith('\n') ? '' : '\n') });
      update({ state: 'agent_running', openApprovalId: null });
      respond(socket, { ok: true, session: sanitizeMetadata(metadata) });
      return;
    }
    if (action === 'approve' || action === 'deny') {
      const approvalId = request.approvalId || metadata.openApprovalId || openApprovalId;
      const approval = approvalId ? markApproval(root, approvalId, action === 'approve' ? 'approved' : 'denied') : null;
      const text = request.input || (action === 'approve' ? approval?.defaultApproveInput || 'y\n' : approval?.defaultDenyInput || 'n\n');
      if (!child || child.killed || !child.stdin.writable) return respond(socket, { ok: false, error: 'session process is not writable', approval });
      child.stdin.write(text);
      if (!String(text).endsWith('\n')) child.stdin.write('\n');
      event({ type: action, source: 'user', approvalId, text: action === 'approve' ? '[approved]' : '[denied]' });
      update({ state: 'agent_running', openApprovalId: null });
      respond(socket, { ok: true, approval, session: sanitizeMetadata(metadata) });
      return;
    }
    if (action === 'close_stdin') {
      if (!child || child.killed || !child.stdin) return respond(socket, { ok: false, error: 'session process is not writable' });
      try { child.stdin.end(); } catch (_) {}
      event({ type: 'close_stdin', source: 'user' });
      update({ state: 'stdin_closed' });
      respond(socket, { ok: true, session: sanitizeMetadata(metadata) });
      return;
    }
    if (action === 'close_stdin' || action === 'close-stdin') {
      if (!child || child.killed || !child.stdin.writable) return respond(socket, { ok: false, error: 'session stdin is not writable' });
      try { child.stdin.end(); } catch (error) { return respond(socket, { ok: false, error: error.message }); }
      event({ type: 'close_stdin', source: 'user' });
      update({ state: 'agent_running', stdinClosedAt: new Date().toISOString() });
      respond(socket, { ok: true, session: sanitizeMetadata(metadata) });
      return;
    }
    if (action === 'interrupt') {
      if (child && !child.killed) child.kill('SIGINT');
      event({ type: 'interrupt', source: 'user' });
      update({ state: 'interrupted' });
      respond(socket, { ok: true, session: sanitizeMetadata(metadata) });
      return;
    }
    if (action === 'kill') {
      stopping = true;
      if (child && !child.killed) child.kill('SIGTERM');
      setTimeout(() => { try { if (child && !child.killed) child.kill('SIGKILL'); } catch (_) {} }, 2500).unref();
      event({ type: 'kill', source: 'user' });
      update({ state: 'killing', status: 'stopping' });
      respond(socket, { ok: true, session: sanitizeMetadata(metadata) });
      return;
    }
    respond(socket, { ok: false, error: `unknown action: ${action}` });
  }

  server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try { handleRequest(socket, JSON.parse(line)); }
        catch (error) { respond(socket, { ok: false, error: sanitizeError(error) }); }
      }
    });
    socket.on('end', () => {
      if (!buffer.trim()) return;
      try { handleRequest(socket, JSON.parse(buffer.trim())); }
      catch (error) { respond(socket, { ok: false, error: sanitizeError(error) }); }
    });
  });

  await listen(server, metadata.socketPath);
  update({ status: 'running', state: 'starting', supervisorPid: process.pid, socketPath: metadata.socketPath, startedAt: new Date().toISOString() });
  const command = metadata.command;
  const displayCommand = redactSecrets(command);
  event({ type: 'session_started', command: displayCommand, cwd: metadata.cwd || root, pid: process.pid });

  const cwd = metadata.cwd || root;
  const env = { ...process.env, ...(metadata.env || {}) };
  const effectiveCommand = metadata.pty && process.platform !== 'win32'
    ? `script -qfec ${shellQuote(command)} /dev/null`
    : command;

  fs.appendFileSync(metadata.files.transcript, `\n$ ${displayCommand}\n`, 'utf8');
  event({ type: 'command_start', command: displayCommand, effectiveCommand: redactSecrets(effectiveCommand), cwd });
  child = spawn(effectiveCommand, { cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
  update({ pid: child.pid, command, effectiveCommand });

  child.stdout.on('data', (chunk) => writeOutput('stdout', chunk));
  child.stderr.on('data', (chunk) => writeOutput('stderr', chunk));
  child.on('error', (error) => {
    writeOutput('stderr', Buffer.from(error.stack || error.message || String(error)));
    event({ type: 'process_error', error: error.message });
  });

  if (metadata.initialInputFile && fs.existsSync(metadata.initialInputFile)) {
    const initial = fs.readFileSync(metadata.initialInputFile, 'utf8');
    child.stdin.write(initial);
    if (!initial.endsWith('\n')) child.stdin.write('\n');
    event({ type: 'input', source: 'agentkodex_initial_prompt', text: `[${initial.length} chars from ${metadata.initialInputFile}]` });
  }
  if (metadata.closeStdinAfterInitial) {
    try { child.stdin.end(); } catch (_) {}
  }

  child.on('close', (exitCode, signal) => {
    const endedAt = new Date().toISOString();
    fs.appendFileSync(metadata.files.transcript, `\n[exit ${exitCode}${signal ? ` signal ${signal}` : ''}]\n`, 'utf8');
    event({ type: 'command_finish', exitCode, signal, stopping });
    update({
      status: exitCode === 0 ? 'completed' : stopping ? 'stopped' : 'failed',
      state: exitCode === 0 ? 'completed' : stopping ? 'stopped' : 'failed',
      openApprovalId: null,
      exitCode,
      signal,
      endedAt,
    });
    logSupervisor(metadata, `child closed exit=${exitCode} signal=${signal || ''}`);
    setTimeout(() => {
      try { server.close(); } catch (_) {}
      cleanupSocket(metadata.socketPath);
      process.exit(0);
    }, 300);
  });
}

function sanitizeMetadata(metadata) {
  const copy = { ...metadata };
  delete copy.env;
  delete copy.controlToken;
  delete copy.token;
  return copy;
}

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      hardenSocket(socketPath);
      resolve();
    });
  });
}

function cleanupSocket(socketPath) {
  if (!socketPath || process.platform === 'win32') return;
  try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch (_) {}
}

function logSupervisor(metadata, message) {
  try {
    appendText(metadata.files.supervisor, `${new Date().toISOString()} ${message}\n`);
  } catch (_) {}
}

if (require.main === module) {
  main().catch((error) => {
    try { fs.appendFileSync(path.join(process.cwd(), 'agentkodex-supervisor-error.log'), `${error.stack || error.message}\n`, 'utf8'); } catch (_) {}
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main };
