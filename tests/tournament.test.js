'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTournament } = require('../src/tournament');

test('tournament writes required artifacts and configurable scorecard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-tournament-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' } }));
  const result = await runTournament({ root: dir, task: 'validate', agents: ['local'], gates: ['test'], winnerStrategy: 'gates', echo: false });
  const tournamentDir = path.join(dir, '.agentkodex', 'tournaments', result.id);
  assert.equal(result.winner, 'local');
  for (const name of ['manifest.json', 'results.json', 'scorecard.json', 'summary.md']) assert.ok(fs.existsSync(path.join(tournamentDir, name)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tournamentDir, 'scorecard.json'), 'utf8')).winnerStrategy, 'gates');
});
