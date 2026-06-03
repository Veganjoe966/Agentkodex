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
  const bannedPackages = flags.bannedPackages === undefined ? undefined : listFlag(flags, 'bannedPackages', []);
  const result = await runQualityGate({
    projectRoot: cwdFromFlags(flags),
    changedFiles: [...listFlag(flags, 'files', []), ...positionals],
    mode: stringFlag(flags, 'mode', 'sandbox_auto'),
    yes: booleanFlag(flags, 'yes', true),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '600000'))),
    maxFileLines: Number(stringFlag(flags, 'maxFileLines', stringFlag(flags, 'max-file-lines', '400'))),
    maxComplexity: Number(stringFlag(flags, 'maxComplexity', stringFlag(flags, 'max-complexity', '60'))),
    unusedImportsMode: stringFlag(flags, 'unusedImports', stringFlag(flags, 'unused-imports', 'warn')),
    analysisMode: stringFlag(flags, 'analysisMode', stringFlag(flags, 'analysis-mode', 'auto')),
    bannedPackages,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  qualityCommand,
};
