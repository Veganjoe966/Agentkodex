'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runSetup } = require('../src/setup/agentSetup');
const { runAsk, renderAsk } = require('../src/ask/runAsk');
const { loadConfig, saveConfig } = require('../src/kodexStore');
const { loadReputation, recordAskReputation } = require('../src/ask/reputation');
const { planAskStrategy } = require('../src/ask/strategy');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'agentkodex.js');

function project(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: prefix, scripts: { test: 'node -e "console.log(1)"' } }));
  return dir;
}

test('setup auto-detects ready agents and preserves manual templates', async () => {
  const dir = project('ak-setup-');
  const config = loadConfig(dir);
  config.agents.manual = { kind: 'custom', commandTemplate: 'node scripts/manual.js', stdin: false };
  config.agents.disabled = { kind: 'custom', commandTemplate: 'node scripts/disabled.js', stdin: false, disabled: true };
  saveConfig(dir, config);
  const result = await runSetup(dir, {
    adapters: [
      { id: 'ready', label: 'Ready Fake', commandTemplate: `${process.execPath} --version`, smokeCommand: `${process.execPath} -e "process.exit(0)"` },
      { id: 'broken', label: 'Broken Fake', commandTemplate: `${process.execPath} --version`, smokeCommand: `${process.execPath} -e "process.exit(4)"` },
      { id: 'manual', label: 'Manual Fake', commandTemplate: `${process.execPath} --version`, smokeCommand: `${process.execPath} -e "process.exit(0)"` },
      { id: 'disabled', label: 'Disabled Fake', commandTemplate: `${process.execPath} --version`, smokeCommand: `${process.execPath} -e "process.exit(0)"` },
    ],
  });
  assert.equal(result.agents.find((agent) => agent.id === 'ready').readinessState, 'ready');
  assert.equal(result.agents.find((agent) => agent.id === 'broken').readinessState, 'smoke_failed');
  assert.equal(result.agents.find((agent) => agent.id === 'manual').readinessState, 'manually_configured');
  assert.equal(result.agents.find((agent) => agent.id === 'disabled').readinessState, 'disabled');
  const saved = loadConfig(dir);
  assert.equal(saved.agents.manual.commandTemplate, 'node scripts/manual.js');
  assert.equal(saved.agents.ready.autoConfigured, true);
});

test('ask answer mode compares fake agents and caches repeat safely', async () => {
  const dir = project('ak-ask-answer-');
  writeAgent(dir, 'a.js', 'console.log("answer from a")');
  writeAgent(dir, 'b.js', 'console.log("answer from b with more useful detail")');
  configureAgents(dir, { a: 'node scripts/a.js', b: 'node scripts/b.js' });
  const first = await runAsk({ root: dir, prompt: 'Explain this project', mode: 'answer', agents: ['a', 'b'] });
  assert.equal(first.ok, true);
  assert.equal(first.scores.length, 2);
  assert.equal(first.servedFromCache, false);
  const second = await runAsk({ root: dir, prompt: 'Explain this project', mode: 'answer', agents: ['a', 'b'] });
  assert.equal(second.ok, true);
  assert.equal(second.servedFromCache, true);
  assert.equal(second.winner, first.winner);
});

test('ask skips not-ready agents and fails when all candidates fail', async () => {
  const dir = project('ak-ask-fail-');
  configureAgents(dir, { missing: 'missing-agentkodex-binary {prompt}' });
  const result = await runAsk({ root: dir, prompt: 'Explain', mode: 'answer', agents: ['missing'] });
  assert.equal(result.ok, false);
  assert.match(result.blockedReason, /No ready/);
});

test('ask degrades sandbox-limited Codex and falls back to metadata', async () => {
  const dir = project('ak-ask-codex-sandbox-');
  writeAgent(dir, 'codex-bwrap.js', 'console.error("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted");process.exit(1);');
  configureAgents(dir, { codex: 'node scripts/codex-bwrap.js {prompt}' });

  const result = await runAsk({ root: dir, prompt: 'Explain this project', mode: 'answer', agents: ['codex'] });
  const text = renderAsk(result);

  assert.equal(result.ok, true);
  assert.equal(result.winner, 'project-metadata');
  assert.equal(result.selection.strategy, 'metadata_fallback');
  assert.match(text, /Codex CLI is installed, but its internal sandbox cannot run here/);
  assert.match(text, /project metadata/i);
  assert.doesNotMatch(text, /RTM_NEWADDR|bwrap|loopback/i);
  const saved = loadConfig(dir);
  assert.equal(saved.agents.codex.readinessState, 'degraded');
});

test('patch mode is isolated by default and apply-winner copies only winner changes', async () => {
  const dir = project('ak-ask-patch-');
  writeAgent(dir, 'win.js', 'const fs=require("fs");fs.writeFileSync("winner.txt","winner");');
  writeAgent(dir, 'lose.js', 'const fs=require("fs");fs.writeFileSync("loser.txt","loser");process.exit(1);');
  configureAgents(dir, { win: 'node scripts/win.js', lose: 'node scripts/lose.js' });
  const isolated = await runAsk({ root: dir, prompt: 'Create winner file', mode: 'patch', agents: ['win', 'lose'], gates: ['none'] });
  assert.equal(isolated.ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'winner.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'loser.txt')), false);
  assert.equal(isolated.scores.find((item) => item.agent === 'win').filesChanged, 1);
  const applied = await runAsk({ root: dir, prompt: 'Create another winner file', mode: 'patch', agents: ['win', 'lose'], gates: ['none'], applyWinner: true, yes: true });
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(path.join(dir, 'winner.txt'), 'utf8'), 'winner');
  assert.equal(fs.existsSync(path.join(dir, 'loser.txt')), false);
});

test('answer and review modes do not mutate the host project', async () => {
  const dir = project('ak-ask-readonly-');
  writeAgent(dir, 'answer.js', 'const fs=require("fs");fs.writeFileSync("answer-host.txt","answer");console.log("answer");');
  writeAgent(dir, 'review.js', 'const fs=require("fs");fs.writeFileSync("review-host.txt","review");console.log("review");');
  configureAgents(dir, { answerer: 'node scripts/answer.js', reviewer: 'node scripts/review.js' });
  const answer = await runAsk({ root: dir, prompt: 'Explain without changing files', mode: 'answer', agents: ['answerer'] });
  const review = await runAsk({ root: dir, prompt: 'Review without changing files', mode: 'review', agents: ['reviewer'] });
  assert.equal(answer.ok, true);
  assert.equal(review.ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'answer-host.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'review-host.txt')), false);
  assert.equal(answer.scores[0].filesChanged, 1);
  assert.equal(review.scores[0].filesChanged, 1);
});

test('chat-first CLI exposes setup agents ask and chat history', () => {
  const dir = project('ak-chat-cli-');
  writeAgent(dir, 'answer.js', 'console.log("cli answer")');
  configureAgents(dir, { helper: 'node scripts/answer.js' });
  const agents = cli(['agents', '--cwd', dir, '--json']);
  assert.equal(agents.status, 0, agents.stderr);
  assert.equal(JSON.parse(agents.stdout).agents.some((agent) => agent.id === 'helper' && agent.ready), true);
  const ask = cli(['ask', '--cwd', dir, '--mode', 'answer', '--agents', 'helper', '--json', 'Explain']);
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(JSON.parse(ask.stdout).winner, 'helper');
  const chat = cli(['chat', '--cwd', dir, '--new', 'Explain through chat']);
  assert.equal(chat.status, 0, chat.stderr);
  const list = cli(['chat', '--cwd', dir, '--list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).chats.length, 1);
});

test('ask help hides judge selection from primary UX', () => {
  const help = cli(['ask', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /agentkodex ask/);
  assert.doesNotMatch(help.stdout, /judge/i);
  assert.doesNotMatch(help.stderr, /Missing prompt/);
});

test('ask can use internal judge while keeping judge details out of primary result', async () => {
  const dir = project('ak-ask-internal-judge-');
  writeAgent(dir, 'a.js', 'console.log("short answer")');
  writeAgent(dir, 'b.js', 'console.log("better answer with useful detail")');
  writeAgent(dir, 'arbiter.js', 'console.log("WINNER:b")');
  configureAgents(dir, { a: 'node scripts/a.js', b: 'node scripts/b.js', arbiter: 'node scripts/arbiter.js' });
  const config = loadConfig(dir);
  config.ask = { internalJudge: 'arbiter' };
  saveConfig(dir, config);

  const result = await runAsk({ root: dir, prompt: 'Explain this project', mode: 'answer', agents: ['a', 'b'], latency: 'max' });

  assert.equal(result.ok, true);
  assert.equal(result.winner, 'b');
  assert.equal(result.selection.review, 'internal_agent');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'judge'), false);
  const reputation = loadReputation(dir);
  assert.equal(reputation.agents.b.general.wins, 1);
  assert.equal(reputation.agents.a.general.losses, 1);
});

test('ask reputation is task-category specific', async () => {
  const dir = project('ak-ask-category-reputation-');
  writeAgent(dir, 'testfix.js', 'console.log("test fix answer with enough detail")');
  writeAgent(dir, 'reviewer.js', 'console.log("architecture review answer with enough detail")');
  configureAgents(dir, { testfix: 'node scripts/testfix.js', reviewer: 'node scripts/reviewer.js' });

  await runAsk({ root: dir, prompt: 'Fix failing tests', mode: 'answer', agents: ['testfix'] });
  await runAsk({ root: dir, prompt: 'Review architecture risks', mode: 'answer', agents: ['reviewer'] });

  const reputation = loadReputation(dir);
  assert.equal(reputation.agents.testfix.validation.wins, 1);
  assert.equal(reputation.agents.reviewer.refactor.wins, 1);
  assert.equal(reputation.agents.testfix.refactor, undefined);
  assert.equal(reputation.agents.reviewer.validation, undefined);
});

test('ask strategy uses task reputation for single-agent confidence and compares when low', async () => {
  const dir = project('ak-ask-strategy-');
  writeAgent(dir, 'tests.js', 'console.log("tests")');
  writeAgent(dir, 'review.js', 'console.log("review")');
  configureAgents(dir, { tests: 'node scripts/tests.js', review: 'node scripts/review.js' });
  const config = loadConfig(dir);
  const candidate = { agent: 'tests', score: 90, metrics: { completion: true, gateFailCount: 0 } };
  recordAskReputation(dir, 'Fix failing tests', [candidate], 'tests');
  recordAskReputation(dir, 'Fix failing tests', [candidate], 'tests');
  recordAskReputation(dir, 'Fix failing tests', [candidate], 'tests');

  const confident = await planAskStrategy(dir, config, { prompt: 'Fix failing tests', mode: 'answer', agents: ['tests', 'review'], latency: 'auto' });
  assert.equal(confident.execution, 'single');
  assert.deepEqual(confident.agents, ['tests']);
  assert.equal(confident.category, 'validation');

  const uncertain = await planAskStrategy(dir, config, { prompt: 'Explain this project', mode: 'answer', agents: ['tests', 'review'], latency: 'auto' });
  assert.equal(uncertain.execution, 'compare_two');
  assert.equal(uncertain.agents.length, 2);
});

test('category reputation beats global win volume for strategy selection', async () => {
  const dir = project('ak-ask-category-routing-');
  writeAgent(dir, 'codex.js', 'console.log("test fix")');
  writeAgent(dir, 'claude.js', 'console.log("architecture review")');
  configureAgents(dir, { codex: 'node scripts/codex.js', 'claude-code': 'node scripts/claude.js' });
  for (let i = 0; i < 100; i += 1) {
    recordAskReputation(dir, 'Fix failing tests', [{ agent: 'codex', score: 90, metrics: { completion: true, gateFailCount: 0 } }], 'codex');
  }
  for (let i = 0; i < 5; i += 1) {
    recordAskReputation(dir, 'Review architecture', [{ agent: 'claude-code', score: 90, metrics: { completion: true, gateFailCount: 0 } }], 'claude-code');
  }

  const strategy = await planAskStrategy(dir, loadConfig(dir), { prompt: 'Review architecture', mode: 'answer', agents: ['codex', 'claude-code'], latency: 'auto' });

  assert.equal(strategy.execution, 'single');
  assert.deepEqual(strategy.agents, ['claude-code']);
  assert.equal(strategy.category, 'refactor');
});

function writeAgent(root, name, source) {
  fs.writeFileSync(path.join(root, 'scripts', name), `${source}\n`);
}

function configureAgents(root, agents) {
  const config = loadConfig(root);
  config.agents = { local: config.agents.local };
  for (const [id, commandTemplate] of Object.entries(agents)) {
    config.agents[id] = { kind: 'custom', commandTemplate, stdin: false };
  }
  saveConfig(root, config);
}

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000 });
}
