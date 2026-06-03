'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTask } = require('../src/run');
const { createAuditBundle } = require('../src/audit/bundle');

test('audit bundle writes manifest, summary, missing list, and redacts copied artifacts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-audit-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' } }));
  const run = await runTask({ root: dir, task: 'audit test', agent: 'local', gates: ['test'], yes: true, echo: false });
  fs.appendFileSync(path.join(run.dir, 'transcript.log'), '\nAPI_KEY=supersecret\n');
  const bundle = createAuditBundle(dir, { target: run.id });
  const manifest = JSON.parse(fs.readFileSync(bundle.manifestPath, 'utf8'));
  assert.ok(fs.existsSync(bundle.summaryPath));
  assert.ok(manifest.artifacts.some((item) => item.role === 'transcript'));
  assert.ok(manifest.missing.some((item) => item.role === 'structured_events'));
  const transcript = fs.readFileSync(path.join(bundle.dir, manifest.artifacts.find((item) => item.role === 'transcript').file), 'utf8');
  assert.doesNotMatch(transcript, /supersecret/);
  assert.match(transcript, /\[REDACTED\]/);
});
