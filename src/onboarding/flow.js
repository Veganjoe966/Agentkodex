'use strict';

const GOALS = [
  'Explain this project',
  'Find likely bugs',
  'Review architecture',
  'Fix failing tests',
  'Ask my own question',
];

const ADVANCED_GOALS = [
  'Compare agents',
  'Show readiness',
];

const ONBOARDING_STEPS = [
  'Finding your project...',
  'Checking available coding agents...',
  'Preparing ways I can help...',
];

function renderGoalChoices(options = {}) {
  const lines = ['What would you like help with?', ''];
  GOALS.forEach((goal, index) => lines.push(`${index + 1}. ${goal}`));
  if (options.advanced) {
    lines.push('', 'Advanced:');
    ADVANCED_GOALS.forEach((goal, index) => lines.push(`${GOALS.length + index + 1}. ${goal}`));
  }
  return lines.join('\n');
}

function renderTryCommand(goal = GOALS[0]) {
  return `agentkodex ask "${goal}"`;
}

async function withOnboardingProgress(steps, work, options = {}) {
  if (options.json) return work();
  const output = options.output || process.stdout;
  if (!animationEnabled(output, options)) {
    writeFallback(output, steps);
    return work();
  }
  return animatedProgress(output, steps, work);
}

function animationEnabled(output = process.stdout, options = {}) {
  if (options.skip) return false;
  const env = options.env || process.env;
  if (env.AGENTKODEX_NO_ANIMATION || env.NO_COLOR || env.CI) return false;
  return Boolean(output && output.isTTY);
}

function writeFallback(output, steps) {
  for (const step of steps) output.write(`${step}\n`);
  if (steps.length) output.write('\n');
}

async function animatedProgress(output, steps, work) {
  let index = 0;
  const frames = ['-', '\\', '|', '/'];
  const interval = setInterval(() => {
    const label = steps[Math.min(Math.floor(index / frames.length), steps.length - 1)] || 'Preparing...';
    output.write(`\r${frames[index % frames.length]} ${label}`);
    index += 1;
  }, 90);
  try {
    return await work();
  } finally {
    clearInterval(interval);
    output.write(`\r${' '.repeat(72)}\r`);
  }
}

function primaryOnboardingText() {
  return [
    'Agentkodex',
    'The chat-first control plane for AI coding agents.',
    '',
    'Most useful commands:',
    '  agentkodex setup',
    '  agentkodex ask "Explain this project"',
    '  agentkodex ask "Find bugs"',
    '  agentkodex chat',
    '  agentkodex agents',
    '',
    'For advanced commands:',
    '  agentkodex help all',
  ].join('\n');
}

module.exports = {
  ADVANCED_GOALS,
  GOALS,
  ONBOARDING_STEPS,
  animationEnabled,
  primaryOnboardingText,
  renderGoalChoices,
  renderTryCommand,
  withOnboardingProgress,
};
