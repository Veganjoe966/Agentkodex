'use strict';

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function refreshSessionLiveness(session) {
  if (!session) return session;
  const live = isProcessAlive(session.pid)
    || isProcessAlive(session.childPid)
    || isProcessAlive(session.workerPid)
    || isProcessAlive(session.supervisorPid);
  if (['running', 'starting'].includes(session.status) && !live && session.exitCode !== null && session.exitCode !== undefined) {
    return { ...session, status: session.exitCode === 0 ? 'completed' : 'failed', state: session.exitCode === 0 ? 'completed' : 'failed' };
  }
  return session;
}

module.exports = {
  isProcessAlive,
  refreshSessionLiveness,
};
