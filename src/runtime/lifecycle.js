'use strict';

const { updateRunStatus } = require('../kodexStore');
const { getSession } = require('./sessionStore');

const TERMINAL = new Set(['completed', 'failed', 'stopped', 'canceled', 'cancelled']);

function reconcileRunStatus(root, status = {}) {
  if (!status || status.status !== 'session_running' || !status.sessionId) return status || {};
  const session = getSession(root, status.sessionId);
  if (!session || !TERMINAL.has(session.status)) return status;
  const next = {
    ...status,
    status: session.status === 'completed' ? 'session_completed' : `session_${session.status}`,
    sessionExitCode: session.exitCode,
    sessionEndedAt: session.endedAt,
  };
  if (status.runDir || session.runDir) updateRunStatus(status.runDir || session.runDir, next);
  return next;
}

module.exports = {
  reconcileRunStatus,
};
