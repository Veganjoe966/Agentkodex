#!/usr/bin/env node
'use strict';

const path = require('path');
const { writeJson, readJson, ensureDir } = require('../utils');
const { kodexPath, ensureKodex } = require('../kodexStore');
const { listSessions, updateSession, isProcessAlive } = require('./sessionStore');

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  ensureKodex(root);
  const daemonFile = kodexPath(root, 'daemon.json');
  ensureDir(path.dirname(daemonFile));
  writeJson(daemonFile, {
    pid: process.pid,
    root,
    status: 'running',
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    version: 2,
  });

  const interval = setInterval(() => {
    const existing = readJson(daemonFile, {});
    if (existing.stopRequested) {
      writeJson(daemonFile, { ...existing, status: 'stopped', stoppedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
      clearInterval(interval);
      process.exit(0);
      return;
    }
    for (const session of listSessions(root)) {
      if (['exited', 'failed', 'killed'].includes(session.status)) continue;
      const live = isProcessAlive(session.pid) || isProcessAlive(session.workerPid) || isProcessAlive(session.workerLauncherPid);
      if (!live && session.status !== 'created') {
        updateSession(root, session.id, { status: 'unknown_stale', state: 'stale', staleDetectedAt: new Date().toISOString() });
      }
    }
    writeJson(daemonFile, { ...existing, pid: process.pid, root, status: 'running', heartbeatAt: new Date().toISOString(), version: 2 });
  }, 2000);
}

if (require.main === module) main();

module.exports = { main };
