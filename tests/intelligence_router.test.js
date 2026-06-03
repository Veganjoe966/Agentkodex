'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTask } = require('../src/run');
const { rebuildIntelligence } = require('../src/intelligence/store');
const { routeTask } = require('../src/router/route');
const { rebuildScorecards } = require('../src/scorecards/store');

test('intelligence rebuild persists profiles and router uses real scorecards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-intel-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'intel', scripts: { test: 'node -e "console.log(1)"' } }));
  await runTask({ root: dir, task: 'validation task', agent: 'local', gates: ['test'], yes: true, echo: false });
  const profile = rebuildIntelligence(dir);
  assert.equal(profile.project.projectName, 'intel');
  assert.ok(fs.existsSync(path.join(dir, '.agentkodex', 'intelligence', 'project-profile.json')));
  const scorecards = rebuildScorecards(dir);
  assert.ok(scorecards.agents.local.runs >= 1);
  const route = routeTask(dir, 'run validation checks');
  assert.equal(route.selected, 'local');
});
