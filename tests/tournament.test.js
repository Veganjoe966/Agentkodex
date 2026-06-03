'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTournament } = require('../src/tournament');
const { issueTournamentCapability } = require('../src/capabilities/phases');
const { loadConfig, saveConfig } = require('../src/kodexStore');

test('tournament writes required artifacts and configurable scorecard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-tournament-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' } }));
  const result = await runTournament({ root: dir, task: 'validate', agents: ['local'], gates: ['test'], winnerStrategy: 'gates', echo: false });
  const tournamentDir = path.join(dir, '.agentkodex', 'tournaments', result.id);
  assert.equal(result.winner, 'local');
  for (const name of ['manifest.json', 'results.json', 'scorecard.json', 'summary.md']) assert.ok(fs.existsSync(path.join(tournamentDir, name)));
  const scorecard = JSON.parse(fs.readFileSync(path.join(tournamentDir, 'scorecard.json'), 'utf8'));
  assert.equal(scorecard.winnerStrategy, 'gates');
  assert.equal(typeof scorecard.results[0].metrics.securityAllowed, 'boolean');
  assert.equal(typeof scorecard.results[0].metrics.securityDeniedCount, 'number');
  assert.equal(typeof scorecard.results[0].metrics.failedCapabilityCount, 'number');
  assert.equal(typeof scorecard.results[0].metrics.approvalRequiredCount, 'number');
  assert.equal(typeof scorecard.results[0].metrics.unsafeActionAttemptCount, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(scorecard.results[0].metrics, 'qualityGateOk'), true);
  assert.equal(typeof scorecard.results[0].metrics.qualityViolationCount, 'number');
  assert.equal(typeof scorecard.results[0].metrics.completionBlocked, 'boolean');
});

test('tournament contestant cannot reuse another contestant capability', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-tournament-cap-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' } }));
  const id = 'tournament-cap-test';
  const wrong = issueTournamentCapability(dir, { tournamentId: id, agentId: 'other', cwd: path.join(dir, '.agentkodex', 'tournaments', id, 'workspaces', 'local') });
  const result = await runTournament({ id, root: dir, task: 'validate', agents: ['local'], gates: ['test'], capabilities: { local: wrong }, echo: false });
  assert.equal(result.results[0].status, 'denied');
  assert.equal(result.results[0].metrics.securityAllowed, false);
  assert.equal(result.results[0].metrics.completionBlocked, true);
});

test('tournament inherits parent adapter config and scores isolated workspace changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-tournament-isolated-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'isolated-tournament',
    scripts: { test: 'node test/check.js' },
  }));
  fs.writeFileSync(path.join(dir, 'scripts', 'custom-agent.js'), [
    'const fs = require("fs");',
    'fs.mkdirSync("agent-output", { recursive: true });',
    'fs.writeFileSync("agent-output/tournament.txt", "tournament-ok");',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'test', 'check.js'), [
    'const fs = require("fs");',
    'const value = fs.readFileSync("agent-output/tournament.txt", "utf8");',
    'if (value !== "tournament-ok") process.exit(2);',
    '',
  ].join('\n'));

  const config = loadConfig(dir);
  config.agents.custom.commandTemplate = 'node scripts/custom-agent.js';
  config.agents.custom.stdin = false;
  saveConfig(dir, config);

  const result = await runTournament({
    root: dir,
    task: 'create tournament output',
    agents: ['custom'],
    gates: ['test'],
    echo: false,
  });

  const item = result.results[0];
  assert.equal(item.status, 'passed');
  assert.equal(item.metrics.filesChanged, 1);
  assert.equal(item.metrics.filesAdded, 1);
  assert.equal(item.metrics.mutationScanOk, true);
  assert.equal(item.metrics.changeSource, 'snapshot');
  assert.deepEqual(item.metrics.changedPaths, ['agent-output/tournament.txt']);
  assert.ok(item.metrics.diffSizeBytes > 0);

  const tournamentDir = path.join(dir, '.agentkodex', 'tournaments', result.id);
  const scorecard = JSON.parse(fs.readFileSync(path.join(tournamentDir, 'scorecard.json'), 'utf8'));
  assert.equal(scorecard.results[0].metrics.filesChanged, 1);
  assert.equal(scorecard.results[0].metrics.filesAdded, 1);
  assert.equal(scorecard.results[0].metrics.changeSource, 'snapshot');
  assert.deepEqual(scorecard.results[0].metrics.changedPaths, ['agent-output/tournament.txt']);
  assert.ok(fs.existsSync(path.join(tournamentDir, 'workspaces', 'custom', 'agent-output', 'tournament.txt')));
});
