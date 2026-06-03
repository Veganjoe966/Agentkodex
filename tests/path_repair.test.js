'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { repairAgentkodexPath } = require('../src/install/pathRepair');

function fakePackageRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-package-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'agentkodex.js'), '#!/usr/bin/env node\nconsole.log("ok")\n');
  return root;
}

test('PATH repair creates a launcher in an existing PATH directory', () => {
  if (process.platform === 'win32') return;
  const packageRoot = fakePackageRoot();
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-bin-'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-prefix-'));
  const result = repairAgentkodexPath({
    packageRoot,
    prefix,
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-home-')),
    envPath: pathDir,
  });
  assert.equal(result.ok, true);
  assert.equal(result.commandAvailable, true);
  assert.equal(result.linkPath, path.join(pathDir, 'agentkodex'));
  assert.equal(fs.realpathSync(result.linkPath), path.join(packageRoot, 'bin', 'agentkodex.js'));
});

test('PATH repair adds user local bin to shell profile when no PATH dir is writable', () => {
  if (process.platform === 'win32') return;
  const packageRoot = fakePackageRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-home-'));
  const result = repairAgentkodexPath({
    packageRoot,
    prefix: fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-prefix-')),
    home,
    envPath: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.needsNewShell, true);
  assert.equal(result.linkPath, path.join(home, '.local', 'bin', 'agentkodex'));
  assert.equal(fs.existsSync(result.profilePath), true);
  assert.match(fs.readFileSync(result.profilePath, 'utf8'), /Agentkodex PATH/);
});

test('PATH repair replaces stale Agentkodex symlink on PATH', () => {
  if (process.platform === 'win32') return;
  const packageRoot = fakePackageRoot();
  const oldRoot = fakePackageRoot();
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-stale-'));
  fs.symlinkSync(path.join(oldRoot, 'bin', 'agentkodex.js'), path.join(pathDir, 'agentkodex'));
  const result = repairAgentkodexPath({
    packageRoot,
    prefix: fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-prefix-')),
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'ak-path-home-')),
    envPath: pathDir,
  });
  assert.equal(result.ok, true);
  assert.equal(result.linkPath, path.join(pathDir, 'agentkodex'));
  assert.equal(fs.realpathSync(result.linkPath), path.join(packageRoot, 'bin', 'agentkodex.js'));
});
