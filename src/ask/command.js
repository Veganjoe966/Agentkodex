'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('../args');
const { runAsk, renderAsk } = require('./runAsk');

async function askCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  if (booleanFlag(flags, 'help')) return printAskHelp();
  const prompt = positionals.join(' ').trim() || stringFlag(flags, 'prompt', '');
  const result = await runAsk({
    root: path.resolve(stringFlag(flags, 'cwd', stringFlag(flags, 'repo', process.cwd()))),
    prompt,
    mode: stringFlag(flags, 'mode', 'auto'),
    agents: listFlag(flags, 'agents', []),
    gates: listFlag(flags, 'gates', []),
    latency: latency(flags),
    compare: booleanFlag(flags, 'compare'),
    applyWinner: booleanFlag(flags, 'applyWinner') || booleanFlag(flags, 'apply-winner'),
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    json: booleanFlag(flags, 'json'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '0')) || 0) || undefined,
  });
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result, null, 2));
  else console.log(renderAsk(result));
  if (!result.ok) process.exitCode = 1;
}

function latency(flags) {
  if (booleanFlag(flags, 'fast')) return 'fast';
  if (booleanFlag(flags, 'max')) return 'max';
  if (booleanFlag(flags, 'compare')) return 'compare';
  return stringFlag(flags, 'latency', 'auto');
}

function printAskHelp() {
  console.log([
    'Usage:',
    '  agentkodex ask "Explain this project"',
    '  agentkodex ask --mode review "Review security risks"',
    '  agentkodex ask --mode patch "Fix failing tests"',
    '  agentkodex ask --mode patch --apply-winner --yes "Fix failing tests"',
    '',
    'Options:',
    '  --mode answer|review|patch|auto',
    '  --agents codex,claude-code,aider',
    '  --fast',
    '  --compare',
    '  --max',
    '  --apply-winner',
    '  --yes',
    '  --json',
    '',
    'Agentkodex chooses scoring and review strategy internally.',
  ].join('\n'));
}

module.exports = {
  askCommand,
};
