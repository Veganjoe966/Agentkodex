'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTask } = require('../src/run');

test('runTask creates reports and runs discovered gates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-task-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'demo-run',
    scripts: {
      lint: 'node scripts/pass.js lint',
      test: 'node scripts/pass.js test',
      build: 'node scripts/pass.js build'
    }
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'scripts', 'pass.js'), 'console.log(process.argv[2] + " passed")\n');
  const result = await runTask({
    root: dir,
    task: 'Verify demo project',
    agent: 'local',
    gates: ['lint', 'test', 'build'],
    yes: true,
    echo: false,
  });
  assert.equal(result.status.status, 'passed');
  assert.ok(fs.existsSync(path.join(result.dir, 'final-report.md')));
  assert.equal(result.gateResults.length, 3);
});
