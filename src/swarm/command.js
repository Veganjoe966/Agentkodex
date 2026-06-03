'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('../args');
const { PHASES, runSwarm } = require('./run');
const { isFailureStatus, setExitCodeForFailure } = require('../statusContract');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function swarmCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', '');
  const roles = {};
  const commands = {};
  for (const phase of PHASES) {
    roles[phase] = stringFlag(flags, phase, '');
    commands[phase] = stringFlag(flags, `${phase}Command`, stringFlag(flags, `${phase}-command`, ''));
  }
  if (!Object.values(roles).some(Boolean)) roles.builder = stringFlag(flags, 'agent', 'shell');
  const result = await runSwarm({
    root,
    task,
    roles,
    commands,
    command: stringFlag(flags, 'command', ''),
    mode: stringFlag(flags, 'mode', 'supervised'),
    gates: listFlag(flags, 'gates', ['lint', 'test', 'build']),
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    wait: booleanFlag(flags, 'wait'),
    closeStdin: booleanFlag(flags, 'closeStdin') || booleanFlag(flags, 'close-stdin'),
    pty: booleanFlag(flags, 'pty'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '300000'))),
  });
  const counts = lifecycleCounts(result.manifest.phases);
  console.log(`Swarm directory: ${result.dir}`);
  console.log(`Manifest: ${path.join(result.dir, 'manifest.json')}`);
  console.log(`Summary: ${path.join(result.dir, 'summary.md')}`);
  console.log(`Phases: running=${counts.runningCount} completed=${counts.completedCount} failed=${counts.failedCount} skipped=${counts.skippedCount} stale=${counts.staleCount} blocked=${counts.blockedCount}`);
  setExitCodeForFailure(counts.failedCount > 0 || counts.blockedCount > 0 || counts.staleCount > 0 || (counts.completedCount + counts.runningCount) === 0);
}

function lifecycleCounts(phases = []) {
  const counts = { runningCount: 0, completedCount: 0, failedCount: 0, skippedCount: 0, staleCount: 0, blockedCount: 0 };
  for (const phase of phases || []) {
    const status = String(phase.status || '');
    if (['completed', 'session_completed', 'passed'].includes(status)) counts.completedCount += 1;
    else if (['running', 'session_running', 'started'].includes(status)) counts.runningCount += 1;
    else if (status === 'skipped' || status === 'no_op') counts.skippedCount += 1;
    else if (status === 'stale') counts.staleCount += 1;
    else if (status === 'denied' || status === 'blocked') counts.blockedCount += 1;
    else if (isFailureStatus(status) || status === 'failed') counts.failedCount += 1;
  }
  return counts;
}

module.exports = {
  swarmCommand,
  lifecycleCounts,
};
