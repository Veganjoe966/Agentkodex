'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { createRun } = require('../src/kodexStore');
const { createAuditBundle } = require('../src/audit/bundle');
const { anchorBundle, verifyAnchor } = require('../src/audit/anchor');

test('audit anchor is created and verifies unchanged bundle', () => {
  const { root, bundle, anchorPath } = fixture();
  const anchored = anchorBundle(bundle.dir, { projectRoot: root, anchorPath });
  assert.equal(anchored.ok, true);
  assert.ok(fs.existsSync(path.join(bundle.dir, 'anchor.json')));
  const verified = verifyAnchor(bundle.dir, { projectRoot: root, anchorPath });
  assert.equal(verified.ok, true, verified.errors.join('\n'));
});

test('audit anchor verification fails when manifest changes', () => {
  const { root, bundle, anchorPath } = fixture();
  anchorBundle(bundle.dir, { projectRoot: root, anchorPath });
  const manifestPath = path.join(bundle.dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.runId = 'tampered';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const verified = verifyAnchor(bundle.dir, { projectRoot: root, anchorPath });
  assert.equal(verified.ok, false);
  assert.match(verified.errors.join('\n'), /bundleHash|bundle:/);
});

test('audit anchor verification fails when evidence hash changes', () => {
  const { root, bundle, anchorPath } = fixture();
  anchorBundle(bundle.dir, { projectRoot: root, anchorPath });
  const manifest = JSON.parse(fs.readFileSync(bundle.manifestPath, 'utf8'));
  const evidence = manifest.artifacts.find((item) => item.role === 'audit_evidence');
  fs.appendFileSync(path.join(bundle.dir, evidence.file), 'tamper\n');
  const verified = verifyAnchor(bundle.dir, { projectRoot: root, anchorPath });
  assert.equal(verified.ok, false);
  assert.match(verified.errors.join('\n'), /evidenceHash|hash mismatch/);
});

test('audit anchor chain detects removed or reordered entries', () => {
  const first = fixture();
  const second = fixture({ root: first.root, anchorPath: first.anchorPath });
  anchorBundle(first.bundle.dir, { projectRoot: first.root, anchorPath: first.anchorPath });
  anchorBundle(second.bundle.dir, { projectRoot: first.root, anchorPath: first.anchorPath });
  const lines = fs.readFileSync(first.anchorPath, 'utf8').trim().split(/\r?\n/);
  fs.writeFileSync(first.anchorPath, `${lines[1]}\n`);
  assert.equal(verifyAnchor(second.bundle.dir, { projectRoot: first.root, anchorPath: first.anchorPath }).ok, false);
  fs.writeFileSync(first.anchorPath, `${lines[1]}\n${lines[0]}\n`);
  assert.equal(verifyAnchor(second.bundle.dir, { projectRoot: first.root, anchorPath: first.anchorPath }).ok, false);
});

test('audit anchor json output is machine readable shape', () => {
  const { root, bundle, anchorPath } = fixture();
  const anchored = JSON.parse(JSON.stringify(anchorBundle(bundle.dir, { projectRoot: root, anchorPath })));
  const verified = JSON.parse(JSON.stringify(verifyAnchor(bundle.dir, { projectRoot: root, anchorPath })));
  assert.equal(typeof anchored.ok, 'boolean');
  assert.equal(typeof anchored.anchor.currentAnchorHash, 'string');
  assert.equal(typeof verified.ok, 'boolean');
  assert.equal(Array.isArray(verified.errors), true);
});

test('audit anchor cli honors custom anchor path', () => {
  const { root, bundle, anchorPath } = fixture();
  const bin = path.join(__dirname, '..', 'bin', 'agentkodex.js');
  const output = execFileSync(process.execPath, [bin, 'audit', 'anchor', bundle.dir, '--anchor-path', anchorPath, '--cwd', root, '--json'], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.anchorPath, anchorPath);
  assert.ok(fs.existsSync(anchorPath));
});

function fixture(options = {}) {
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'ak-anchor-'));
  const run = createRun(root, `anchor ${Date.now()} ${Math.random()}`);
  fs.writeFileSync(path.join(run.dir, 'status.json'), JSON.stringify({ status: 'ok' }));
  fs.writeFileSync(path.join(run.dir, 'audit-evidence.jsonl'), JSON.stringify({ type: 'quality_gate_result', ok: true }) + '\n');
  fs.writeFileSync(path.join(run.dir, 'final-report.md'), '# final\n');
  const bundle = createAuditBundle(root, { target: run.id, out: path.join(root, `.bundle-${path.basename(run.dir)}`) });
  return { root, run, bundle, anchorPath: options.anchorPath || path.join(root, 'anchors.jsonl') };
}
