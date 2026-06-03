'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir, appendText, shellQuote } = require('../utils');
const { redactSecrets } = require('../policy');
const { hardenSocket, sanitizeError } = require('../security/controlPlane');
const { ensureDaemonToken, assertDaemonToken } = require('./daemonAuth');
const {
  socketPathForRoot,
  writeDaemonInfo,
  daemonLogPath,
  createSession,
  readSession,
  updateSession,
  listSessions,
  resolveSession,
  appendSessionEvent,
  appendTranscript,
} = require('./sessionStore');
const { createApproval, listApprovals, resolveApproval, updateApproval } = require('./approvalQueue');
const { detectState, detectApprovalRequest, parseEventsFromOutput } = require('./stateDetector');
const { authorizeDaemonStart, assertDaemonRuntimeCapability } = require('./daemonSecurity');

class AgentkodexDaemon {
  constructor(root, options = {}) {
    this.root = path.resolve(root || process.cwd());
    this.socketPath = socketPathForRoot(this.root);
    this.logPath = daemonLogPath(this.root);
    this.children = new Map();
    this.buffers = new Map();
    this.server = null;
    this.options = options;
    this.token = ensureDaemonToken(this.root);
  }

  async start() {
    ensureDir(path.dirname(this.socketPath));
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch (_) {}
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.off('error', reject);
        hardenSocket(this.socketPath);
        resolve();
      });
    });

    writeDaemonInfo(this.root, {
      pid: process.pid,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    this.log(`daemon started pid=${process.pid} socket=${this.socketPath}`);
  }

  async stop() {
    this.log('daemon stopping');
    for (const [id, child] of this.children.entries()) {
      this.log(`leaving child session running until killed: ${id} pid=${child.pid}`);
    }
    if (this.server) this.server.close();
    writeDaemonInfo(this.root, {
      pid: process.pid,
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
    });
    setTimeout(() => process.exit(0), 30).unref();
    return { ok: true };
  }

  log(message) {
    appendText(this.logPath, `${new Date().toISOString()} ${message}\n`);
  }

  handleConnection(socket) {
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      raw += chunk;
      if (!raw.includes('\n')) return;
      const line = raw.slice(0, raw.indexOf('\n'));
      raw = raw.slice(raw.indexOf('\n') + 1);
      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        socket.write(`${JSON.stringify({ ok: true, response })}\n`);
      } catch (error) {
        this.log(`request error ${redactSecrets(error && error.stack ? error.stack : String(error))}`);
        socket.write(`${JSON.stringify({ ok: false, error: sanitizeError(error) })}\n`);
      } finally {
        socket.end();
      }
    });
  }

  async handleRequest(request) {
    assertDaemonToken(this.root, request);
    const type = request.type;
    if (type === 'ping') return { pid: process.pid, root: this.root, socketPath: this.socketPath, sessions: this.children.size };
    if (type === 'stop') return this.stop();
    if (type === 'startSession') return this.startSession(request.session || {});
    if (type === 'send') return this.send(request.sessionId, request.input || '', request.options || {});
    if (type === 'interrupt') return this.interrupt(request.sessionId || 'last');
    if (type === 'kill') return this.kill(request.sessionId || 'last');
    if (type === 'status') return this.status(request.sessionId || 'last');
    if (type === 'listSessions') return listSessions(this.root);
    if (type === 'listApprovals') return listApprovals(this.root, request.options || {});
    if (type === 'approve') return this.decideApproval(request.approvalId || 'last', 'approved', request.input);
    if (type === 'deny') return this.decideApproval(request.approvalId || 'last', 'denied', request.input);
    throw new Error(`Unknown daemon request type: ${type}`);
  }

  startSession(input) {
    const command = String(input.command || '').trim();
    if (!command) throw new Error('Missing session command.');
    const cwd = path.resolve(input.cwd || this.root);
    const mode = input.mode || 'supervised';
    const yes = Boolean(input.yes || input.autoApprove);
    const { sessionId, policy, capability } = authorizeDaemonStart(this.root, input, command, cwd, mode, yes);

    const session = createSession(this.root, {
      id: sessionId,
      agent: input.agent || 'custom',
      task: input.task || '',
      command,
      cwd,
      runDir: input.runDir || null,
      mode,
      gates: input.gates || [],
      status: policy.allowed ? 'starting' : 'awaiting_approval',
      state: policy.allowed ? 'starting' : 'awaiting_approval',
      policy,
      capabilities: { runtime: capability },
      initialInput: input.initialInput ? true : false,
      closeStdinAfterInitial: Boolean(input.closeStdin || input.closeStdinAfterInitial),
      pendingStart: policy.allowed ? null : { ...input, cwd, command, forceApproved: true },
    });

    const displayCommand = redactSecrets(command);
    appendSessionEvent(session, { type: 'session_created', command: displayCommand, cwd, agent: session.agent, mode, policy });
    appendText(session.files.policy, `${new Date().toISOString()} ${JSON.stringify({ command: displayCommand, policy })}\n`);

    if (!policy.allowed) {
      const approval = createApproval(this.root, {
        kind: 'command_execution',
        sessionId: session.id,
        agent: session.agent,
        command,
        reason: policy.reason,
        risk: policy.classification && policy.classification.risk,
        approveInput: null,
        denyInput: null,
        fingerprint: `command:${session.id}:${command}`,
      });
      appendSessionEvent(session, { type: 'approval_created', approvalId: approval.id, approval });
      appendTranscript(session, `\n$ ${displayCommand}\n[AWAITING APPROVAL] ${policy.reason}\nApproval: ${approval.id}\n`);
      this.log(`session ${session.id} awaiting command approval ${approval.id}`);
      return { session: readSession(this.root, session.id), approval };
    }

    const started = this.spawnForSession(session, input);
    return { session: started };
  }

  spawnForSession(session, input = {}) {
    const command = session.command;
    const displayCommand = redactSecrets(command);
    assertDaemonRuntimeCapability(this.root, session);
    const cwd = session.cwd || this.root;
    const env = { ...process.env, ...(input.env || {}) };
    const usePty = Boolean(input.pty || input.usePty) && process.platform !== 'win32';
    const spawnCommand = usePty ? `script -qfec ${shellQuote(command)} /dev/null` : command;
    const child = spawn(spawnCommand, {
      cwd,
      env,
      shell: true,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.children.set(session.id, child);
    this.buffers.set(session.id, '');

    const startedAt = new Date().toISOString();
    let next = updateSession(this.root, session.id, {
      status: 'running',
      state: 'agent_running',
      pid: child.pid,
      startedAt,
      policy: session.policy,
      pendingStart: null,
    });

    appendText(next.files.commands, `${JSON.stringify({ type: 'start', command: displayCommand, cwd, pid: child.pid, startedAt, mode: next.mode })}\n`);
    appendTranscript(next, `\n$ ${displayCommand}\n`);
    appendSessionEvent(next, { type: 'process_started', pid: child.pid, command: displayCommand, cwd, pty: usePty });
    this.log(`session ${session.id} started pid=${child.pid} command=${displayCommand}`);

    if (input.initialInput) {
      let initialText = String(input.initialInput);
      if (!initialText.endsWith('\n')) initialText += '\n';
      try {
        child.stdin.write(initialText);
        appendSessionEvent(next, { type: 'input_sent', source: 'mission', bytes: Buffer.byteLength(initialText) });
        appendText(next.files.input, `${new Date().toISOString()} mission bytes=${Buffer.byteLength(initialText)}\n`);
      } catch (error) {
        appendSessionEvent(next, { type: 'input_error', source: 'mission', error: error.message });
      }
    }

    if (input.closeStdin || input.closeStdinAfterInitial) {
      try { child.stdin.end(); } catch (_) {}
      appendSessionEvent(next, { type: 'stdin_closed', source: 'agentkodex' });
    }

    const onOutput = (stream, chunk) => {
      const text = redactSecrets(chunk.toString());
      const current = readSession(this.root, session.id) || next;
      appendTranscript(current, text);
      appendSessionEvent(current, { type: 'output', stream, text });
      for (const event of parseEventsFromOutput(text)) appendSessionEvent(current, event);

      const old = this.buffers.get(session.id) || '';
      const buffer = `${old}${text}`.slice(-16000);
      this.buffers.set(session.id, buffer);
      const state = detectState(buffer, current.state);
      const detectedApproval = detectApprovalRequest(buffer);
      const patch = { state, lastOutputAt: new Date().toISOString() };
      if (state === 'awaiting_approval' && detectedApproval) {
        const approval = createApproval(this.root, {
          kind: 'terminal_prompt',
          sessionId: session.id,
          agent: current.agent,
          prompt: detectedApproval.prompt,
          reason: 'Terminal output appears to be asking for confirmation or approval.',
          risk: 'interactive_prompt',
          approveInput: detectedApproval.defaultApproveInput,
          denyInput: detectedApproval.defaultDenyInput,
          fingerprint: `prompt:${session.id}:${detectedApproval.prompt}`,
        });
        patch.openApprovalId = approval.id;
        appendSessionEvent(current, { type: 'approval_detected', approvalId: approval.id, approval });
      }
      next = updateSession(this.root, session.id, patch);
    };

    child.stdout.on('data', (chunk) => onOutput('stdout', chunk));
    child.stderr.on('data', (chunk) => onOutput('stderr', chunk));
    child.on('error', (error) => {
      const current = readSession(this.root, session.id) || next;
      const text = redactSecrets(error.stack || error.message || String(error));
      appendTranscript(current, `\n[process error] ${text}\n`);
      appendSessionEvent(current, { type: 'process_error', text });
      next = updateSession(this.root, session.id, { status: 'failed', state: 'error_present', error: text });
    });
    child.on('close', (exitCode, signal) => {
      const current = readSession(this.root, session.id) || next;
      this.children.delete(session.id);
      this.buffers.delete(session.id);
      const endedAt = new Date().toISOString();
      const finalStatus = exitCode === 0 ? 'exited' : 'failed';
      appendText(current.files.commands, `${JSON.stringify({ type: 'finish', command: displayCommand, cwd, pid: child.pid, exitCode, signal, endedAt })}\n`);
      appendTranscript(current, `\n[exit ${exitCode}${signal ? ` signal ${signal}` : ''}]\n`);
      appendSessionEvent(current, { type: 'process_exited', exitCode, signal });
      updateSession(this.root, session.id, { status: finalStatus, state: exitCode === 0 ? 'completed' : 'failed', exitCode, signal, endedAt });
      this.log(`session ${session.id} exited code=${exitCode} signal=${signal || ''}`);
    });

    if (input.initialInput !== undefined && input.initialInput !== null && String(input.initialInput).length) {
      setTimeout(() => {
        try {
          child.stdin.write(String(input.initialInput));
          if (!String(input.initialInput).endsWith('\n')) child.stdin.write('\n');
          appendSessionEvent(readSession(this.root, session.id) || next, { type: 'input_sent', source: 'initialInput', bytes: String(input.initialInput).length });
        } catch (error) {
          this.log(`failed initial input for ${session.id}: ${error.message}`);
        }
      }, Number(input.initialInputDelayMs || 250)).unref();
    }

    if (input.closeStdin) {
      setTimeout(() => {
        try { child.stdin.end(); } catch (_) {}
      }, Number(input.closeStdinDelayMs || 500)).unref();
    }

    return readSession(this.root, session.id);
  }

  getLive(sessionIdOrLast) {
    const session = resolveSession(this.root, sessionIdOrLast || 'last');
    if (!session) throw new Error('No Agentkodex session found.');
    return { session, child: this.children.get(session.id) || null };
  }

  send(sessionIdOrLast, input, options = {}) {
    const { session, child } = this.getLive(sessionIdOrLast);
    if (!child || !child.stdin || child.killed) throw new Error(`Session is not controlled by this daemon or is not running: ${session.id}`);
    let text = String(input || '');
    if (!options.raw && !text.endsWith('\n')) text += '\n';
    child.stdin.write(text);
    const displayText = options.redact ? '[REDACTED]' : redactSecrets(text);
    appendSessionEvent(session, { type: 'input_sent', source: 'user', text: displayText });
    appendTranscript(session, `\n[agentkodex input] ${displayText}`);
    updateSession(this.root, session.id, { state: 'agent_running' });
    return { session: readSession(this.root, session.id), bytes: text.length };
  }

  interrupt(sessionIdOrLast) {
    const { session, child } = this.getLive(sessionIdOrLast);
    if (!child) throw new Error(`Session is not controlled by this daemon or is not running: ${session.id}`);
    child.kill('SIGINT');
    appendSessionEvent(session, { type: 'interrupt_sent', signal: 'SIGINT' });
    updateSession(this.root, session.id, { state: 'interrupted' });
    return { session: readSession(this.root, session.id), signal: 'SIGINT' };
  }

  kill(sessionIdOrLast) {
    const { session, child } = this.getLive(sessionIdOrLast);
    if (!child) throw new Error(`Session is not controlled by this daemon or is not running: ${session.id}`);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }, 2500).unref();
    appendSessionEvent(session, { type: 'kill_sent', signal: 'SIGTERM' });
    updateSession(this.root, session.id, { state: 'killing' });
    return { session: readSession(this.root, session.id), signal: 'SIGTERM' };
  }

  status(sessionIdOrLast) {
    const session = resolveSession(this.root, sessionIdOrLast || 'last');
    if (!session) throw new Error('No Agentkodex session found.');
    return { session, live: this.children.has(session.id) };
  }

  decideApproval(approvalIdOrLast, decision, inputOverride) {
    const approval = resolveApproval(this.root, approvalIdOrLast || 'last');
    if (!approval) throw new Error('No open Agentkodex approval found.');
    if (approval.status !== 'open') throw new Error(`Approval is already ${approval.status}: ${approval.id}`);
    const updated = updateApproval(this.root, approval.id, {
      status: decision,
      decision,
      decidedAt: new Date().toISOString(),
    });

    if (approval.kind === 'command_execution' && decision === 'approved') {
      const session = readSession(this.root, approval.sessionId);
      if (!session || !session.pendingStart) return { approval: updated, warning: 'Session no longer has pending start metadata.' };
      const patched = updateSession(this.root, session.id, { status: 'starting', state: 'starting' });
      const started = this.spawnForSession(patched, { ...session.pendingStart, yes: true, autoApprove: true });
      return { approval: updated, session: started };
    }

    if (approval.kind === 'terminal_prompt') {
      const input = inputOverride !== undefined && inputOverride !== null
        ? String(inputOverride)
        : (decision === 'approved' ? approval.approveInput : approval.denyInput);
      if (approval.sessionId && input !== null && input !== undefined) {
        try {
          const sendResult = this.send(approval.sessionId, input, { raw: true });
          return { approval: updated, sent: sendResult };
        } catch (error) {
          return { approval: updated, warning: error.message };
        }
      }
    }

    return { approval: updated };
  }
}

async function startDaemon(root, options = {}) {
  const daemon = new AgentkodexDaemon(root, options);
  await daemon.start();
  return daemon;
}

module.exports = {
  AgentkodexDaemon,
  startDaemon,
};
