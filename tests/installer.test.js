'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('installer is npm-first with GitHub fallback and no sudo path', () => {
  const root = path.resolve(__dirname, '..');
  const scriptPath = path.join(root, 'install.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(script.indexOf('install_from_npm') < script.indexOf('install_from_github'));
  assert.match(script, /npm install -g "\$package_spec"/);
  assert.match(script, /github:\$GITHUB_REPO#\$GITHUB_REF/);
  assert.match(script, /The chat-first control plane for AI coding agents/);
  assert.match(script, /run_with_animation/);
  assert.match(script, /AGENTKODEX_NO_ANIMATION/);
  assert.match(script, /AGENTKODEX_NO_PATH_REPAIR/);
  assert.match(script, /last_failure_was_eacces/);
  assert.match(script, /user-local npm prefix/);
  assert.match(script, /npm config get prefix/);
  assert.match(script, /append_profile_path/);
  assert.doesNotMatch(script, /npm bin -g/);
  assert.doesNotMatch(script, /\bsudo\s+(?:npm|sh|node|curl)\b/);
  const syntax = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const help = spawnSync('sh', [scriptPath, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--source npm\|github/);
});

test('installer recovers from global npm EACCES with user-local prefix', () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-install-eacces-'));
  const fakeBin = path.join(temp, 'bin');
  const userPrefix = path.join(temp, 'user-prefix');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'node'), '#!/bin/sh\necho 20\n');
  fs.writeFileSync(path.join(fakeBin, 'npm'), `#!/bin/sh
echo "$NPM_CONFIG_PREFIX $*" >> "${temp}/npm.log"
if [ "$1 $2 $3" = "config get prefix" ]; then echo "${temp}/global-prefix"; exit 0; fi
if [ "$1 $2" = "install -g" ]; then
  if [ -z "$NPM_CONFIG_PREFIX" ]; then echo "npm ERR! code EACCES" >&2; exit 243; fi
  mkdir -p "$NPM_CONFIG_PREFIX/bin"
  printf '#!/bin/sh\\necho 1.0.3\\n' > "$NPM_CONFIG_PREFIX/bin/agentkodex"
  chmod +x "$NPM_CONFIG_PREFIX/bin/agentkodex"
  exit 0
fi
exit 1
`);
  fs.chmodSync(path.join(fakeBin, 'node'), 0o755);
  fs.chmodSync(path.join(fakeBin, 'npm'), 0o755);
  const result = spawnSync('sh', [path.join(root, 'install.sh')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      HOME: temp,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      AGENTKODEX_NO_ANIMATION: '1',
      AGENTKODEX_USER_PREFIX: userPrefix,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(`${result.stdout}\n${result.stderr}`, /user-local npm prefix/);
  const log = fs.readFileSync(path.join(temp, 'npm.log'), 'utf8');
  assert.match(log, new RegExp(`${escapeRegExp(userPrefix)} install -g agentkodex`));
  assert.doesNotMatch(log, /github:/);
  assert.ok(fs.existsSync(path.join(userPrefix, 'bin', 'agentkodex')));
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
