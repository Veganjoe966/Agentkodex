'use strict';

const os = require('os');
const path = require('path');
const { ensureDir, readJson, writeJson, timestampId, hashString } = require('../utils');
const { ensureKodex, kodexPath } = require('../kodexStore');

function runtimeDir(root) {
  ensureKodex(root);
  const dir = kodexPath(root, 'runtime');
  ensureDir(dir);
  return dir;
}

function sessionsDir(root) {
  ensureKodex(root);
  const dir = kodexPath(root, 'sessions');
  ensureDir(dir);
  return dir;
}

function sessionDir(root, sessionId) {
  const dir = path.join(sessionsDir(root), sessionId);
  ensureDir(dir);
  return dir;
}

function socketPathForRoot(root) {
  const key = hashString(path.resolve(root), 20);
  if (process.platform === 'win32') return `\\\\.\\pipe\\agentkodex-${key}`;
  return path.join(os.tmpdir(), `agentkodex-${key}.sock`);
}

function makeSocketPath(root, sessionId) {
  const key = hashString(path.resolve(root), 20);
  if (process.platform === 'win32') return `\\\\.\\pipe\\agentkodex-${key}-${sessionId}`;
  return path.join(os.tmpdir(), `agentkodex-${key}-${sessionId}.sock`);
}

function daemonInfoPath(root) {
  return path.join(runtimeDir(root), 'daemon.json');
}

function daemonLogPath(root) {
  return path.join(runtimeDir(root), 'daemon.log');
}

function readDaemonInfo(root) {
  return readJson(daemonInfoPath(root), null);
}

function writeDaemonInfo(root, info) {
  writeJson(daemonInfoPath(root), {
    ...info,
    root: path.resolve(root),
    socketPath: socketPathForRoot(root),
    logPath: daemonLogPath(root),
    updatedAt: new Date().toISOString(),
  });
}

function newSessionId(seed = '') {
  return `sess_${timestampId()}_${hashString(`${seed}:${process.pid}:${Date.now()}:${Math.random()}`, 8)}`;
}

function sessionFiles(root, id, runDir = null) {
  const dir = sessionDir(root, id);
  const base = runDir || dir;
  ensureDir(base);
  ensureDir(dir);
  return {
    session: path.join(dir, 'session.json'),
    metadata: path.join(dir, 'metadata.json'),
    transcript: path.join(base, 'transcript.log'),
    events: path.join(base, 'session-events.ndjson'),
    commands: path.join(base, 'commands.log'),
    policy: path.join(base, 'policy.log'),
    approvals: path.join(dir, 'approvals.json'),
    inbox: path.join(dir, 'inbox.ndjson'),
    input: path.join(base, 'input.log'),
    workerLog: path.join(dir, 'worker.log'),
    supervisor: path.join(dir, 'supervisor.log'),
  };
}

module.exports = {
  runtimeDir,
  sessionsDir,
  sessionDir,
  sessionFiles,
  socketPathForRoot,
  makeSocketPath,
  daemonInfoPath,
  daemonLogPath,
  readDaemonInfo,
  writeDaemonInfo,
  newSessionId,
};
