'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runQualityGate } = require('../src/gates/qualityGate');

test('quality gate auto analysis mode falls back to heuristic when parser is missing', async () => {
  const root = tempRoot();
  write(root, 'main.js', 'function ok(){ return 1; }\n');
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['main.js'], analysisMode: 'auto' });
  assert.equal(result.ok, true);
  assert.equal(result.analysisMode, parserAvailable() ? 'parser' : 'heuristic');
  assert.equal(byName(result, 'analysis-mode').ok, true);
});

test('quality gate parser mode fails clearly when parser dependency is missing', async () => {
  const root = tempRoot();
  write(root, 'main.js', 'function ok(){ return 1; }\n');
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['main.js'], analysisMode: 'parser' });
  if (parserAvailable()) {
    assert.equal(result.analysisMode, 'parser');
    assert.equal(byName(result, 'analysis-mode').ok, true);
  } else {
    assert.equal(result.ok, false);
    assert.equal(result.analysisMode, 'parser');
    assert.match(result.blockedReason, /Parser analysis requested/);
  }
});

test('quality gate heuristic mode remains available and machine-readable', async () => {
  const root = tempRoot();
  write(root, 'main.js', 'function ok(){ return 1; }\n');
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['main.js'], analysisMode: 'heuristic' });
  const json = JSON.parse(JSON.stringify(result));
  assert.equal(json.analysisMode, 'heuristic');
  assert.equal(typeof json.ok, 'boolean');
  assert.equal(byName(result, 'analysis-mode').analysisMode, 'heuristic');
});

function byName(result, name) {
  const check = result.checks.find((item) => item.name === name);
  assert.ok(check, `missing ${name}`);
  return check;
}

function parserAvailable() {
  for (const name of ['acorn', '@babel/parser']) {
    try { require.resolve(name); return true; } catch (_) {}
  }
  return false;
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-analysis-'));
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
