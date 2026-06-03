'use strict';

const { spawn } = require('child_process');

function loadNodePty() {
  try {
    // Optional. Agentkodex works without it, but uses true PTY sessions when installed.
    return require('node-pty');
  } catch (_) {
    return null;
  }
}

function startManagedProcess(options) {
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };
  const command = options.command;
  const usePty = options.pty !== false;
  const nodePty = usePty ? loadNodePty() : null;

  if (nodePty && process.platform !== 'win32') {
    const shell = process.env.SHELL || 'sh';
    const pty = nodePty.spawn(shell, ['-lc', command], {
      name: 'xterm-256color',
      cols: Number(options.cols || 120),
      rows: Number(options.rows || 36),
      cwd,
      env,
    });
    pty.onData((data) => options.onOutput && options.onOutput(data, 'pty'));
    pty.onExit(({ exitCode, signal }) => options.onExit && options.onExit(exitCode, signal || null));
    return {
      kind: 'pty',
      pid: pty.pid,
      write(data) { pty.write(String(data)); },
      kill(signal = 'SIGTERM') { try { pty.kill(signal); } catch (_) {} },
      interrupt() { try { pty.write('\x03'); } catch (_) {} },
      resize(cols, rows) { try { pty.resize(cols, rows); } catch (_) {} },
    };
  }

  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout.on('data', (chunk) => options.onOutput && options.onOutput(chunk.toString(), 'stdout'));
  child.stderr.on('data', (chunk) => options.onOutput && options.onOutput(chunk.toString(), 'stderr'));
  child.on('error', (error) => options.onOutput && options.onOutput(`${error.stack || error.message || String(error)}\n`, 'stderr'));
  child.on('close', (exitCode, signal) => options.onExit && options.onExit(exitCode, signal || null));

  return {
    kind: 'pipe',
    pid: child.pid,
    write(data) { if (!child.stdin.destroyed) child.stdin.write(String(data)); },
    kill(signal = 'SIGTERM') { try { child.kill(signal); } catch (_) {} },
    interrupt() { try { child.kill('SIGINT'); } catch (_) {} },
    resize() {},
    child,
  };
}

module.exports = { startManagedProcess, loadNodePty };
