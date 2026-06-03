'use strict';

const os = require('os');
const path = require('path');
const { ensureDir, hashString } = require('../utils');
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

function sessionDir(root, id) {
  const dir = path.join(sessionsDir(root), id);
  ensureDir(dir);
  return dir;
}

function daemonStatePath(root) {
  return path.join(runtimeDir(root), 'daemon.json');
}

function daemonLogPath(root) {
  return path.join(runtimeDir(root), 'daemon.log');
}

function socketPath(root) {
  const key = hashString(path.resolve(root), 20);
  if (process.platform === 'win32') return `\\\\.\\pipe\\agentkodex-${key}`;
  return path.join(os.tmpdir(), `agentkodex-${key}.sock`);
}

// Backwards-compatible names for older internal modules.
const daemonSocketPath = socketPath;
const daemonPidPath = (root) => path.join(runtimeDir(root), 'daemon.pid');
const sessionRecordPath = (root, id) => path.join(sessionDir(root, id), 'session.json');
const sessionEventsPath = (root, id) => path.join(sessionDir(root, id), 'events.ndjson');
const sessionTranscriptPath = (root, id) => path.join(sessionDir(root, id), 'transcript.log');
const sessionApprovalsPath = (root, id) => path.join(sessionDir(root, id), 'approvals.json');

module.exports = {
  runtimeDir,
  sessionsDir,
  sessionDir,
  socketPath,
  daemonStatePath,
  daemonLogPath,
  daemonSocketPath,
  daemonPidPath,
  sessionRecordPath,
  sessionEventsPath,
  sessionTranscriptPath,
  sessionApprovalsPath,
};
