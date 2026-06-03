'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { resolveRun } = require('../report');
const { collectRunGovernance, collectRootGovernance } = require('./summary');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function governanceCommand(argv) {
  const [sub = 'summary', ...rest] = argv;
  if (sub !== 'summary') throw new Error(`Unknown governance subcommand: ${sub}`);
  const { flags, positionals } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  const target = positionals[0] || stringFlag(flags, 'run', 'last');
  const run = target === 'root' ? null : resolveRun(root, target);
  const governance = run ? collectRunGovernance(root, run.dir) : collectRootGovernance(root);
  if (booleanFlag(flags, 'json')) {
    console.log(JSON.stringify({ runId: run?.id || null, governance }, null, 2));
    return;
  }
  console.log(`Governance summary${run ? ` for ${run.id}` : ''}:`);
  for (const [key, value] of Object.entries(governance)) console.log(`- ${key}: ${value}`);
}

module.exports = {
  governanceCommand,
};
