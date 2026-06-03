'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

test('installer is npm-first with GitHub fallback and no sudo path', () => {
  const root = path.resolve(__dirname, '..');
  const scriptPath = path.join(root, 'install.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(script.indexOf('install_from_npm') < script.indexOf('install_from_github'));
  assert.match(script, /npm install -g "\$package_spec"/);
  assert.match(script, /github:\$GITHUB_REPO#\$GITHUB_REF/);
  assert.doesNotMatch(script, /\bsudo\b/);
  const syntax = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const help = spawnSync('sh', [scriptPath, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--source npm\|github/);
});
