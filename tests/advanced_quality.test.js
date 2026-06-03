'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runQualityGate } = require('../src/gates/qualityGate');

test('complexity threshold blocks complex file', async () => {
  const root = tempRoot();
  write(root, 'complex.js', 'function big(x){ if(x){} if(x>1){} for(;;){break} while(false){} return x ? 1 : 0 }\n');
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['complex.js'], maxComplexity: 3 });
  const check = byName(result, 'complexity');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /big complexity/);
});

test('circular dependency is detected', async () => {
  const root = tempRoot();
  write(root, 'a.js', "import './b.js';\n");
  write(root, 'b.js', "import './a.js';\n");
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['a.js', 'b.js'] });
  const check = byName(result, 'circular-deps');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /a\.js.*b\.js.*a\.js/);
});

test('obvious unused import is detected and can fail', async () => {
  const root = tempRoot();
  write(root, 'dep.js', 'export default 1;\n');
  write(root, 'main.js', "import dep from './dep.js';\nconsole.log('unused');\n");
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['main.js', 'dep.js'], unusedImportsMode: 'fail' });
  const check = byName(result, 'dead-imports');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /unused import dep/);
});

test('banned package is blocked and missing dependency is reported', async () => {
  const root = tempRoot();
  write(root, 'package.json', JSON.stringify({ dependencies: {} }));
  write(root, 'bad.js', requireLine('posthog' + '-js') + requireLine('left' + '-pad'));
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['bad.js'] });
  const check = byName(result, 'dependency-hygiene');
  assert.equal(check.ok, false);
  assert.match(check.details.join('\n'), /banned package posthog-js/);
  assert.match(check.details.join('\n'), /missing dependency left-pad/);
});

test('quality config fails missing and duplicate dependencies', async () => {
  const root = tempRoot();
  write(root, 'agentkodex.quality.json', JSON.stringify({ failOnMissingDeps: true }));
  write(root, 'package.json', JSON.stringify({ dependencies: { react: '^1.0.0' }, devDependencies: { react: '^1.0.0' } }));
  write(root, 'bad.js', requireLine('left' + '-pad'));
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['bad.js', 'package.json'] });
  const check = byName(result, 'dependency-hygiene');
  assert.equal(check.ok, false);
  assert.match(check.details.join('\n'), /missing dependency left-pad/);
  assert.match(check.details.join('\n'), /duplicate dependency react/);
});

test('architecture boundary violation is blocked', async () => {
  const root = tempRoot();
  write(root, 'src/runtime/a.js', "import '../cockpit/b.js';\n");
  write(root, 'src/cockpit/b.js', 'export const b = 1;\n');
  const result = await runQualityGate({
    projectRoot: root,
    changedFiles: ['src/runtime/a.js', 'src/cockpit/b.js'],
    forbiddenImportMap: { 'src/runtime': ['src/cockpit'] },
  });
  const check = byName(result, 'architecture-boundaries');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /forbidden boundary/);
});

test('quality gate advanced output remains JSON and rejects Emergent artifacts', async () => {
  const root = tempRoot();
  write(root, 'bad.js', requireLine('@emergent' + 'base/runtime'));
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['bad.js'] });
  assert.equal(typeof JSON.parse(JSON.stringify(result)).ok, 'boolean');
  assert.equal(Array.isArray(result.checks), true);
  assert.match(result.checks.flatMap((check) => check.details).join('\n'), /banned package @emergentbase\/runtime|forbidden package/);
  assert.equal(result.ok, false);
});

test('quality gate blocks checked-in env and hardcoded project path', async () => {
  const root = tempRoot();
  write(root, '.env', 'TOKEN=secret\n');
  write(root, 'path.js', `const p = '${'/app' + '/test_project'}';\n`);
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['.env', 'path.js'] });
  assert.equal(result.ok, false);
  assert.match(result.checks.flatMap((check) => check.details).join('\n'), /checked-in env file|\/app\/test_project/);
  assert.equal(typeof result.totals.errors, 'number');
  assert.equal(result.totals.filesChecked, 2);
});

function byName(result, name) {
  const check = result.checks.find((item) => item.name === name);
  assert.ok(check, `missing ${name}`);
  return check;
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-advanced-quality-'));
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function requireLine(pkg) {
  return 'require' + "('" + pkg + "');\n";
}
