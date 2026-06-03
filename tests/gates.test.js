'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureKodex, createRun } = require('../src/kodexStore');
const { runGateCommands } = require('../src/gates');

test('gate runner captures per-gate output paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gates-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(123)"' } }));
  ensureKodex(dir);
  const run = createRun(dir, 'gate test');
  const results = await runGateCommands({ root: dir, runDir: run.dir, gates: ['test'], mode: 'sandbox_auto', echo: false, writeReports: true });
  assert.equal(results[0].result.exitCode, 0);
  assert.ok(fs.existsSync(results[0].outputPath));
  assert.ok(fs.existsSync(path.join(run.dir, 'gate-report.md')));
});
