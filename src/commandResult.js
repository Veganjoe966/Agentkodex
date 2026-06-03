'use strict';

function summarizeCommandResult(result) {
  if (!result) return null;
  return {
    command: result.command,
    cwd: result.cwd,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    skipped: result.skipped,
    policy: result.policy,
    stdoutTail: result.stdoutTail || tail(result.stdout || ''),
    stderrTail: result.stderrTail || tail(result.stderr || ''),
    durationMs: result.durationMs,
    outputFile: result.outputFile || null,
  };
}

function tail(value, max = 4000) {
  const text = String(value || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

module.exports = {
  summarizeCommandResult,
  tail,
};
