'use strict';

const { spawn } = require('child_process');
const { shellQuote } = require('../utils');

function spawnTerminal(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };
  const usePty = Boolean(options.usePty);

  if (usePty) {
    const nodePty = tryNodePty();
    if (nodePty) return spawnNodePty(nodePty, command, { cwd, env, cols: options.cols, rows: options.rows });
    if (process.platform !== 'win32' && options.useScriptFallback !== false) {
      return spawnChildProcess(`script -qfec ${shellQuote(command)} /dev/null`, { cwd, env, shell: true, ptyKind: 'script' });
    }
  }

  return spawnChildProcess(command, { cwd, env, shell: true, ptyKind: 'stdio' });
}

function tryNodePty() {
  try {
    // Optional dependency: Agentkodex works without it, but uses it when available.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('node-pty');
  } catch (_) {
    return null;
  }
}

function spawnNodePty(nodePty, command, options) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
  const args = process.platform === 'win32' ? ['-NoLogo', '-Command', command] : ['-lc', command];
  const child = nodePty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: options.cols || 120,
    rows: options.rows || 40,
    cwd: options.cwd,
    env: options.env,
  });

  return {
    kind: 'node-pty',
    pid: child.pid,
    write: (data) => child.write(data),
    kill: (signal = 'SIGTERM') => {
      try { child.kill(signal); } catch (_) {}
    },
    resize: (cols, rows) => {
      try { child.resize(cols, rows); } catch (_) {}
    },
    onData: (handler) => child.onData(handler),
    onExit: (handler) => child.onExit(({ exitCode, signal }) => handler(exitCode, signal)),
  };
}

function spawnChildProcess(command, options) {
  const child = spawn(command, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell !== false,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });
  return {
    kind: options.ptyKind || 'stdio',
    pid: child.pid,
    write: (data) => {
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(data);
    },
    kill: (signal = 'SIGTERM') => {
      try { child.kill(signal); } catch (_) {}
    },
    resize: () => {},
    onData: (handler) => {
      child.stdout.on('data', (chunk) => handler(chunk.toString()));
      child.stderr.on('data', (chunk) => handler(chunk.toString()));
    },
    onExit: (handler) => child.on('close', (exitCode, signal) => handler(exitCode, signal)),
    onError: (handler) => child.on('error', handler),
  };
}

module.exports = {
  spawnTerminal,
};
