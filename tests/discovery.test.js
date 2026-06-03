'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { discoverProject, selectCommands, parseMakeTargets, parseTaskfileTasks } = require('../src/discovery');

test('discovers package scripts and npm package manager', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-discovery-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'demo',
    scripts: { test: 'node --test', build: 'node build.js', lint: 'eslint .' },
    dependencies: { react: '^18.0.0', vite: '^5.0.0' }
  }, null, 2));
  const discovery = discoverProject(dir);
  assert.equal(discovery.projectName, 'demo');
  assert.equal(discovery.packageManager, 'npm');
  assert.ok(discovery.commands.some((cmd) => cmd.name === 'test' && cmd.command === 'npm run test'));
  assert.ok(discovery.frameworks.includes('react'));
  assert.ok(discovery.frameworks.includes('vite'));
  const gates = selectCommands(discovery, ['lint', 'test', 'build']);
  assert.deepEqual(gates.map((g) => g.gate), ['lint', 'test', 'build']);
});

test('parses Makefile targets', () => {
  const targets = parseMakeTargets('test:\n\tnode --test\n.PHONY: test\nbuild:\n\tnode build.js\n');
  assert.deepEqual(targets, ['test', 'build']);
});

test('discovers Java, .NET, e2e, and Taskfile commands with evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-discovery-more-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { e2e: 'playwright test', typecheck: 'tsc --noEmit' } }));
  fs.writeFileSync(path.join(dir, 'pom.xml'), '<project></project>');
  fs.writeFileSync(path.join(dir, 'Demo.csproj'), '<Project />');
  fs.writeFileSync(path.join(dir, 'Taskfile.yml'), 'version: "3"\ntasks:\n  lint:\n    cmds: ["echo lint"]\n');
  const discovery = discoverProject(dir);
  assert.ok(discovery.languages.includes('java'));
  assert.ok(discovery.languages.includes('.net'));
  assert.ok(discovery.commands.some((cmd) => cmd.category === 'e2e' && cmd.evidence.includes('package.json')));
  assert.ok(discovery.commands.some((cmd) => cmd.command === 'mvn test' && cmd.evidence === 'pom.xml'));
  assert.ok(discovery.commands.some((cmd) => cmd.command === 'dotnet test' && cmd.evidence === 'Demo.csproj'));
  assert.deepEqual(parseTaskfileTasks('tasks:\n  test:\n    cmds: []\n'), ['test']);
});
