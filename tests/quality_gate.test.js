'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runQualityGate } = require('../src/gates/qualityGate');
const { runGateCommands } = require('../src/gates');

test('quality gate fails on lint failure', async () => {
  const root = mockProject({ lint: 'process.exit(2)' });
  const result = await runQualityGate({ projectRoot: root, mode: 'sandbox_auto' });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name === 'eslint').ok, false);
});

test('quality gate fails on typecheck and test failures', async () => {
  const typeRoot = mockProject({ typecheck: 'process.exit(3)' });
  const typeResult = await runQualityGate({ projectRoot: typeRoot, mode: 'sandbox_auto' });
  assert.equal(typeResult.checks.find((check) => check.name === 'typecheck').ok, false);

  const testRoot = mockProject({ test: 'process.exit(4)' });
  const testResult = await runQualityGate({ projectRoot: testRoot, mode: 'sandbox_auto' });
  assert.equal(testResult.checks.find((check) => check.name === 'tests').ok, false);
});

test('quality gate passes on clean mock project', async () => {
  const root = mockProject({});
  const result = await runQualityGate({ projectRoot: root, mode: 'sandbox_auto' });
  assert.equal(result.ok, true);
  assert.equal(result.blockedReason, null);
});

test('quality gate blocks oversized files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-quality-loc-'));
  const file = path.join(root, 'big.js');
  fs.writeFileSync(file, `${Array.from({ length: 401 }, () => 'const x = 1;').join('\n')}\n`);
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['big.js'], maxFileLines: 400 });
  const loc = result.checks.find((check) => check.name === 'loc');
  assert.equal(result.ok, false);
  assert.equal(loc.ok, false);
  assert.match(loc.details[0], /big\.js/);
});

test('quality gate blocks forbidden imports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-quality-arch-'));
  const blocked = "const posthog = require('posthog" + "-js');\n";
  fs.writeFileSync(path.join(root, 'bad.js'), blocked);
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['bad.js'] });
  const architecture = result.checks.find((check) => check.name === 'architecture');
  assert.equal(result.ok, false);
  assert.equal(architecture.ok, false);
  assert.match(architecture.details[0], /forbidden package/);
});

test('quality gate blocks completion through gate runner', async () => {
  const root = mockProject({ lint: 'process.exit(9)' });
  const results = await runGateCommands({ root, runDir: root, gates: ['quality'], mode: 'sandbox_auto', echo: false });
  assert.equal(results[0].gate, 'quality');
  assert.equal(results[0].result.exitCode, 1);
  const evidence = fs.readFileSync(path.join(root, 'audit-evidence.jsonl'), 'utf8');
  assert.match(evidence, /quality_gate_result/);
});

test('quality gate output is machine-readable json', async () => {
  const root = mockProject({});
  const result = await runQualityGate({ projectRoot: root, mode: 'sandbox_auto' });
  const parsed = JSON.parse(JSON.stringify(result));
  assert.equal(typeof parsed.ok, 'boolean');
  assert.equal(Array.isArray(parsed.checks), true);
  assert.equal(Array.isArray(parsed.filesChecked), true);
});

function mockProject(overrides) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-quality-'));
  const scripts = {
    lint: 'node lint.js',
    typecheck: 'node typecheck.js',
    test: 'node test.js',
  };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }, null, 2));
  fs.writeFileSync(path.join(root, 'lint.js'), body(overrides.lint));
  fs.writeFileSync(path.join(root, 'typecheck.js'), body(overrides.typecheck));
  fs.writeFileSync(path.join(root, 'test.js'), body(overrides.test));
  return root;
}

function body(source) {
  return `${source || 'console.log("ok")'}\n`;
}
