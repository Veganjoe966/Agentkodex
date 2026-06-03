'use strict';

const SUCCESS_STATUSES = new Set([
  'passed',
  'completed',
  'completed_no_gates',
  'completed_no_gates_discovered',
  'session_completed',
]);

const FAILURE_RE = /^(failed|blocked|denied|stale|canceled|cancelled)|^session_(blocked|failed|stale)|failed_/;

function isFailureStatus(status) {
  const value = String(status || '').trim();
  if (!value) return false;
  if (SUCCESS_STATUSES.has(value)) return false;
  return FAILURE_RE.test(value);
}

function gateResultsFailed(results = []) {
  return results.some((gate) => {
    if (!gate || gate.skipped || gate.result?.skipped) return false;
    const code = gate.result && gate.result.exitCode;
    return code === undefined || code === null || Number(code) !== 0;
  });
}

function setExitCodeForFailure(failed) {
  if (failed) process.exitCode = 1;
}

module.exports = {
  gateResultsFailed,
  isFailureStatus,
  setExitCodeForFailure,
};
