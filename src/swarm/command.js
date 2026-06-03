'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('../args');
const { PHASES, runSwarm } = require('./run');

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
  console.log(`Swarm directory: ${result.dir}`);
  console.log(`Manifest: ${path.join(result.dir, 'manifest.json')}`);
  console.log(`Summary: ${path.join(result.dir, 'summary.md')}`);
}

module.exports = {
  swarmCommand,
};
