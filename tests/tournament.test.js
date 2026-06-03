'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTournament } = require('../src/tournament');
const { issueTournamentCapability } = require('../src/capabilities/phases');

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
