'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runReleaseGate } = require('../src/release/gate');

test('release gate fails closed on disallowed artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-release-gate-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { posthog: '^1.0.0' } }));
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret\n');
  const result = runReleaseGate(root, { skipCommands: true, skipPackageInstall: true });
  assert.equal(result.ok, false);
  const details = result.checks.flatMap((check) => check.details || []).join('\n');
  assert.match(details, /disallowed dependency posthog/);
  assert.match(details, /checked-in env file/);
});
