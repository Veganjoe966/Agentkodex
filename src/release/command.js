'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { runReleaseGate } = require('./gate');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function releaseCommand(argv) {
  const [sub = 'gate', ...rest] = normalizeDashes(argv);
  if (sub !== 'gate') throw new Error(`Unknown release subcommand: ${sub}`);
  const { flags } = parseArgs(rest);
  const result = runReleaseGate(cwdFromFlags(flags));
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.summary);
    for (const check of result.checks) {
      console.log(`- ${check.name}: ${check.ok ? 'pass' : 'fail'}${check.errors ? ` (${check.errors} error${check.errors === 1 ? '' : 's'})` : ''}`);
      if (!check.ok && check.details) {
        console.log(`  details:\n${indentDetails(check.details)}`);
      }
    }
  }
  if (!result.ok) process.exitCode = 1;
}

function normalizeDashes(argv) {
  return argv.map((item) => String(item).replace(/^–/, '--'));
}

function indentDetails(details) {
  const text = Array.isArray(details) ? details.join('\n') : String(details || '');
  return text.split(/\r?\n/).map((line) => `    ${line}`).join('\n');
}

module.exports = {
  releaseCommand,
};
