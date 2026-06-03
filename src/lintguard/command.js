'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('../args');
const { runLintguardCheck } = require('./runner');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function lintguardCommand(argv) {
  const [sub = 'check', ...rest] = argv;
  if (sub !== 'check') throw new Error(`Unknown lintguard subcommand: ${sub}`);
  const { flags, positionals } = parseArgs(rest);
  const result = await runLintguardCheck({
    root: cwdFromFlags(flags),
    url: stringFlag(flags, 'url', ''),
    token: stringFlag(flags, 'token', ''),
    authRequired: booleanFlag(flags, 'authRequired', booleanFlag(flags, 'authEnabled')),
    local: booleanFlag(flags, 'local'),
    files: [...listFlag(flags, 'files', []), ...positionals],
    gates: listFlag(flags, 'gates', []),
    mode: stringFlag(flags, 'mode', 'supervised'),
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '300000'))),
    unsafePublic: booleanFlag(flags, 'unsafePublic'),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  lintguardCommand,
};
