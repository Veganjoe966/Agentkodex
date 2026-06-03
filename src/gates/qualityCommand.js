'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('../args');
const { runQualityGate } = require('./qualityGate');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function qualityCommand(argv) {
  const [sub = 'check', ...rest] = argv;
  if (sub !== 'check') throw new Error(`Unknown quality subcommand: ${sub}`);
  const { flags, positionals } = parseArgs(rest);
  const result = await runQualityGate({
    projectRoot: cwdFromFlags(flags),
    changedFiles: [...listFlag(flags, 'files', []), ...positionals],
    mode: stringFlag(flags, 'mode', 'sandbox_auto'),
    yes: booleanFlag(flags, 'yes', true),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '600000'))),
    maxFileLines: Number(stringFlag(flags, 'maxFileLines', stringFlag(flags, 'max-file-lines', '400'))),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  qualityCommand,
};
