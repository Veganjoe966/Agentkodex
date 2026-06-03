'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('../args');
const { ONBOARDING_STEPS, renderGoalChoices, withOnboardingProgress } = require('../onboarding/flow');
const { runAsk, renderAsk } = require('./runAsk');

async function askCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  if (booleanFlag(flags, 'help')) return printAskHelp();
  const prompt = positionals.join(' ').trim() || stringFlag(flags, 'prompt', '');
  if (!prompt) return printAskGuidance(flags);
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

async function printAskGuidance(flags) {
  const guidance = {
    ok: true,
    title: 'What would you like help with?',
    choices: [
      'Explain this project',
      'Find likely bugs',
      'Review architecture',
      'Fix failing tests',
      'Ask my own question',
    ],
    advanced: ['Compare agents', 'Show readiness'],
  };
  if (booleanFlag(flags, 'json')) {
    console.log(JSON.stringify(guidance, null, 2));
    return;
  }
  const text = await withOnboardingProgress(ONBOARDING_STEPS, async () => renderAskGuidance(), {
    skip: booleanFlag(flags, 'noAnimation') || booleanFlag(flags, 'no-animation'),
  });
  console.log(text);
}

function renderAskGuidance() {
  return [
    renderGoalChoices({ advanced: true }),
    '',
    'Try:',
    'agentkodex ask "Explain this project"',
  ].join('\n');
}

function printAskHelp() {
  console.log([
    'Agentkodex ask',
    '',
    'Ask once. Agentkodex uses your ready coding agents and returns the best result.',
    '',
    'Usage:',
    '  agentkodex ask "Explain this project"',
    '  agentkodex ask "Find bugs"',
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
    '  --no-animation',
    '',
    'No prompt? Run agentkodex ask to see guided choices.',
  ].join('\n'));
}

module.exports = {
  askCommand,
};
