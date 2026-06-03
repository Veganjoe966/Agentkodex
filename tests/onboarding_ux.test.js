'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { helpText } = require('../src/help');
const { renderSetup } = require('../src/setup/agentSetup');
const {
  GOALS,
  ONBOARDING_STEPS,
  animationEnabled,
  withOnboardingProgress,
} = require('../src/onboarding/flow');

const BIN = path.join(__dirname, '..', 'bin', 'agentkodex.js');
const INFRA = /gates|routing|scorecards|sessions|tournaments|cockpit|audit|capabilities|judge/i;

test('ask with no prompt shows guidance instead of error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-ask-guidance-'));
  const result = cli(['ask', '--cwd', dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /What would you like help with/);
  assert.match(result.stdout, /Explain this project/);
  assert.match(result.stdout, /Find likely bugs/);
  assert.match(result.stdout, /Advanced:/);
  assert.doesNotMatch(result.stderr, /Missing prompt/);
  assert.doesNotMatch(result.stdout, /Missing prompt/);
});

test('default help emphasizes setup ask chat and keeps internals in help all', () => {
  const short = helpText();
  assert.match(short, /agentkodex setup/);
  assert.match(short, /agentkodex ask "Explain this project"/);
  assert.match(short, /agentkodex chat/);
  assert.doesNotMatch(short, INFRA);

  const all = helpText('all');
  assert.match(all, /Advanced commands/);
  assert.match(all, /agentkodex tournament/);
  assert.match(all, /agentkodex audit bundle/);
  assert.match(all, /agentkodex session start/);
});

test('setup rendering leads with outcomes and ready agents', () => {
  const text = renderSetup({
    next: 'agentkodex ask "Explain this project"',
    readyAgents: ['codex'],
    agents: [
      { id: 'codex', label: 'Codex CLI', ready: true, readinessState: 'ready' },
      { id: 'gemini', label: 'Gemini CLI', ready: false, readinessState: 'installed_not_authenticated' },
      { id: 'aider', label: 'Aider', ready: false, readinessState: 'missing' },
    ],
  });
  assert.match(text, /Ready to use:\n✓ Codex CLI/);
  assert.match(text, /Not ready:/);
  assert.match(text, /You can start now:/);
  assert.match(text, /agentkodex ask "Explain this project"/);
  const primary = text.split('Advanced Information')[0];
  assert.doesNotMatch(primary, /smoke_failed|scorecards|tournaments|audit|judge/i);
});

test('animated onboarding copy emphasizes user outcomes and avoids infrastructure', () => {
  assert.ok(ONBOARDING_STEPS.includes('Preparing ways I can help...'));
  assert.ok(GOALS.includes('Fix failing tests'));
  assert.doesNotMatch(`${ONBOARDING_STEPS.join('\n')}\n${GOALS.join('\n')}`, INFRA);
});

test('non-interactive terminals receive equivalent progress text', async () => {
  const writes = [];
  const value = await withOnboardingProgress(ONBOARDING_STEPS, async () => 'done', {
    output: { isTTY: false, write: (text) => writes.push(text) },
    env: {},
  });
  assert.equal(value, 'done');
  const text = writes.join('');
  assert.match(text, /Finding your project/);
  assert.match(text, /Checking available coding agents/);
  assert.match(text, /Preparing ways I can help/);
  assert.doesNotMatch(text, INFRA);
});

test('animation can be skipped for accessibility', () => {
  assert.equal(animationEnabled({ isTTY: true }, { env: {} }), true);
  assert.equal(animationEnabled({ isTTY: true }, { env: { AGENTKODEX_NO_ANIMATION: '1' } }), false);
  assert.equal(animationEnabled({ isTTY: true }, { env: {}, skip: true }), false);
  assert.equal(animationEnabled({ isTTY: false }, { env: {} }), false);
});

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000 });
}
