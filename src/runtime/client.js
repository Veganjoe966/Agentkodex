'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir, readText } = require('../utils');
const { ensureKodex } = require('../kodexStore');
const { socketPathForRoot, daemonLogPath, readDaemonInfo, writeDaemonInfo, getSession } = require('./sessionStore');

function request(root, payload, options = {}) {
  const socketPath = socketPathForRoot(root);
  return requestSocket(socketPath, payload, options).then((value) => {
    if (value && value.ok === false) throw new Error(value.error || 'Agentkodex daemon request failed');
    return value && Object.prototype.hasOwnProperty.call(value, 'response') ? value.response : value;
  });
}

function requestSession(root, idOrLast, payload, options = {}) {
  const session = getSession(root, idOrLast || 'last');
  if (!session) return Promise.reject(new Error(`Session not found: ${idOrLast || 'last'}`));
  return request(root, { type: payload.action || payload.type || 'status', sessionId: session.id, ...payload }, options);
}

function requestSocket(socketPath, payload, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 5000);
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';
    let done = false;
    const timer = setTimeout(() => finish(new Error(`Timed out connecting to Agentkodex socket: ${socketPath}`)), timeoutMs);

    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { client.destroy(); } catch (_) {}
      if (error) reject(error);
      else resolve(value);
    }

    client.on('connect', () => client.write(`${JSON.stringify(payload)}\n`));
    client.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try { finish(null, JSON.parse(line)); }
        catch (error) { finish(error); }
      }
    });
    client.on('error', (error) => finish(error));
    client.on('end', () => {
      if (!buffer.trim()) return;
      try { finish(null, JSON.parse(buffer.trim())); } catch (error) { finish(error); }
    });
  });
}

async function pingDaemon(root) {
  try {
    return await request(root, { type: 'ping' }, { timeoutMs: 800 });
  } catch (_) {
    return null;
  }
}

async function ensureDaemon(root, options = {}) {
  ensureKodex(root);
  const existing = await pingDaemon(root);
  if (existing) return existing;
  if (options.noStart) throw new Error('Agentkodex daemon is not running. Start it with: agentkodex daemon start');
  await startDaemonProcess(root);
  const deadline = Date.now() + Number(options.waitMs || 5000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const ping = await pingDaemon(root);
      if (ping) return ping;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const log = readText(daemonLogPath(root), '').slice(-4000);
  throw new Error(`Agentkodex daemon did not start.${lastError ? ` ${lastError.message}` : ''}\n${log}`);
}

function startDaemonProcess(root) {
  return new Promise((resolve, reject) => {
    ensureKodex(root);
    ensureDir(path.dirname(daemonLogPath(root)));
    const out = fs.openSync(daemonLogPath(root), 'a');
    const err = fs.openSync(daemonLogPath(root), 'a');
    const child = spawn(process.execPath, [path.join(__dirname, 'daemonServerEntry.js'), '--root', path.resolve(root)], {
      cwd: root,
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, AGENTKODEX_DAEMON: '1' },
    });
    child.once('error', reject);
    child.unref();
    writeDaemonInfo(root, {
      pid: child.pid,
      status: 'starting',
      startedAt: new Date().toISOString(),
    });
    resolve({ pid: child.pid });
  });
}

async function stopDaemon(root) {
  try {
    return await request(root, { type: 'stop' }, { timeoutMs: 2000 });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function waitForSession(root, sessionId, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30 * 60 * 1000);
  const pollMs = Number(options.pollMs || 250);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await request(root, { type: 'status', sessionId }, { timeoutMs: 2000 });
      const status = last && last.session && last.session.status;
      if (status && !['created', 'starting', 'running', 'awaiting_approval'].includes(status)) return last;
    } catch (error) {
      last = { error: error.message };
    }
    await sleep(pollMs);
  }
  return last || { session: getSession(root, sessionId) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  request,
  requestSession,
  requestSocket,
  pingDaemon,
  ensureDaemon,
  startDaemonProcess,
  stopDaemon,
  waitForSession,
};
