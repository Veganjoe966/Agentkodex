'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { kodexPath, ensureKodex } = require('../kodexStore');
const { readJson, writeJson, exists } = require('../utils');
const { isProcessAlive } = require('./sessionStore');

function daemonStatus(root) {
  ensureKodex(root);
  const file = kodexPath(root, 'daemon.json');
  const status = readJson(file, null);
  if (!status) return { status: 'not_running', live: false, file };
  return { ...status, live: isProcessAlive(status.pid), file };
}

function startDaemon(root) {
  ensureKodex(root);
  const current = daemonStatus(root);
  if (current.live) return { ...current, alreadyRunning: true };
  const worker = path.join(__dirname, 'daemonWorker.js');
  const child = spawn(process.execPath, [worker, path.resolve(root)], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  writeJson(kodexPath(root, 'daemon.json'), {
    pid: child.pid,
    root: path.resolve(root),
    status: 'starting',
    startedAt: new Date().toISOString(),
    heartbeatAt: null,
    version: 2,
  });
  return daemonStatus(root);
}

function stopDaemon(root) {
  const status = daemonStatus(root);
  if (!status.pid) return status;
  writeJson(status.file, { ...status, stopRequested: true, status: 'stop_requested', updatedAt: new Date().toISOString() });
  try { process.kill(status.pid, 'SIGTERM'); } catch (_) {}
  return daemonStatus(root);
}

module.exports = {
  daemonStatus,
  startDaemon,
  stopDaemon,
};
