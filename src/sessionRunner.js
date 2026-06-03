'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { appendText, ensureDir, shellQuote, writeText } = require('./utils');
const { redactSecrets } = require('./policy');
const { authorizeCommand } = require('./authorization');

function commandExists(commandName) {
  return new Promise((resolve) => {
    const probe = process.platform === 'win32'
      ? spawn('where', [commandName], { stdio: 'ignore' })
      : spawn('sh', ['-lc', `command -v ${shellQuote(commandName)} >/dev/null 2>&1`], { stdio: 'ignore' });
    probe.on('close', (code) => resolve(code === 0));
    probe.on('error', () => resolve(false));
  });
}

function firstCommandToken(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const end = trimmed.indexOf(quote, 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/)[0];
}

async function runCommand(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };
  const timeoutMs = Number(options.timeoutMs || 30 * 60 * 1000);
  const logDir = options.logDir || cwd;
  const transcriptFile = options.transcriptFile || path.join(logDir, 'transcript.log');
  const commandsFile = options.commandsFile || path.join(logDir, 'commands.log');
  const policyFile = options.policyFile || path.join(logDir, 'policy.log');
  const outputFile = options.outputFile || null;
  const mode = options.mode || 'supervised';
  const yes = Boolean(options.yes);
  const echo = options.echo !== false;

  ensureDir(logDir);
  if (outputFile) writeText(outputFile, '');

  const policy = authorizeCommand(command, {
    root: cwd,
    mode,
    yes,
    intent: options.intent || command,
    holder: options.holder || 'agentkodex-command',
    agent: options.agent,
    adapterKind: options.adapterKind,
    config: options.config,
  });
  const displayCommand = redactSecrets(command);
  appendText(policyFile, `${new Date().toISOString()} ${JSON.stringify({ command: displayCommand, policy })}\n`);
  if (!policy.allowed) {
    const result = {
      command: displayCommand,
      cwd,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: null,
      signal: null,
      timedOut: false,
      skipped: true,
      policy,
      stdout: '',
      stderr: policy.reason,
      durationMs: 0,
    };
    appendText(commandsFile, `${JSON.stringify(safeCommandRecord(result))}\n`);
    appendText(transcriptFile, `\n$ ${displayCommand}\n[POLICY] ${policy.reason}\n`);
    if (outputFile) appendText(outputFile, `$ ${displayCommand}\n[POLICY] ${policy.reason}\n`);
    if (echo) console.error(`[policy] ${policy.reason}: ${displayCommand}`);
    return result;
  }

  const startedAt = new Date();
  appendText(commandsFile, `${JSON.stringify({ type: 'start', command: displayCommand, cwd, startedAt: startedAt.toISOString(), mode })}\n`);
  appendText(transcriptFile, `\n$ ${displayCommand}\n`);
  if (outputFile) appendText(outputFile, `$ ${displayCommand}\n`);
  if (echo) console.log(`$ ${displayCommand}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;

    const usePtyWrapper = Boolean(options.pty) && process.platform !== 'win32';
    if (usePtyWrapper) {
      const wrapped = `script -qfec ${shellQuote(command)} /dev/null`;
      child = spawn(wrapped, { cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      child = spawn(command, { cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, 3000).unref();
    }, timeoutMs);
    timer.unref();

    if (options.stdin) {
      child.stdin.write(String(options.stdin));
      if (!String(options.stdin).endsWith('\n')) child.stdin.write('\n');
    }
    if (options.closeStdin !== false) child.stdin.end();

    child.stdout.on('data', (chunk) => {
      const text = redactSecrets(chunk.toString());
      stdout += text;
      appendText(transcriptFile, text);
      if (outputFile) appendText(outputFile, text);
      if (echo) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = redactSecrets(chunk.toString());
      stderr += text;
      appendText(transcriptFile, text);
      if (outputFile) appendText(outputFile, text);
      if (echo) process.stderr.write(text);
    });

    child.on('error', (error) => {
      stderr += redactSecrets(error.stack || error.message || String(error));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const endedAt = new Date();
      const result = {
        command: displayCommand,
        cwd,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        exitCode,
        signal,
        timedOut,
        skipped: false,
        policy,
        stdout,
        stderr,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        outputFile,
      };
      appendText(commandsFile, `${JSON.stringify(safeCommandRecord(result))}\n`);
      appendText(transcriptFile, `\n[exit ${exitCode}${signal ? ` signal ${signal}` : ''}${timedOut ? ' timed out' : ''}]\n`);
      if (outputFile) appendText(outputFile, `\n[exit ${exitCode}${signal ? ` signal ${signal}` : ''}${timedOut ? ' timed out' : ''}]\n`);
      resolve(result);
    });
  });
}

function tail(value, max = 4000) {
  const text = String(value || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function safeCommandRecord(result) {
  return {
    type: 'finish',
    command: redactSecrets(result.command),
    cwd: result.cwd,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    skipped: result.skipped,
    policy: result.policy,
    stdoutTail: tail(result.stdout || ''),
    stderrTail: tail(result.stderr || ''),
    durationMs: result.durationMs,
    outputFile: result.outputFile || null,
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

module.exports = {
  runCommand,
  commandExists,
  firstCommandToken,
  formatDuration,
};
