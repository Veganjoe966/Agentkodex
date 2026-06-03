'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { helpText } = require('../help');
const { readJson, readText } = require('../utils');

const DOCUMENTED_COMMANDS = [
  'setup',
  'agents',
  'ask',
  'chat',
  'quickstart',
  'discover',
  'session start',
  'quality check',
  'governance summary',
  'keys status',
  'audit bundle',
  'audit verify',
  'audit anchor',
  'audit verify-anchor',
  'policy check',
  'release gate',
];

const REQUIRED_PACKED_FILES = [
  'README.md',
  'install.sh',
  'bin/agentkodex.js',
  'src/audit/anchor.js',
  'src/ask/command.js',
  'src/ask/internalCache.js',
  'src/ask/runAsk.js',
  'src/chat/command.js',
  'src/setup/agentSetup.js',
  'src/gates/analysisMode.js',
  'src/release/packageConsistency.js',
];

function packageConsistencyCheck(root) {
  const errors = [];
  const warnings = [];
  const pkg = readJson(path.join(root, 'package.json'), {});
  const readme = readText(path.join(root, 'README.md'), '');
  const changelog = readText(path.join(root, 'CHANGELOG.md'), '');
  const install = readText(path.join(root, 'install.sh'), '');
  const help = helpText('all');
  if (pkg.name !== 'agentkodex') errors.push('package.json name must be agentkodex');
  if (!/chat-first control plane for AI coding agents/i.test(`${pkg.description}\n${readme}\n${help}`)) errors.push('package/help/README must use current chat-first positioning');
  if (!changelog.includes(`## ${pkg.version} -`)) errors.push(`CHANGELOG.md is missing version ${pkg.version}`);
  if (!/npm install -g/.test(install) || !/user-local npm prefix/i.test(install)) errors.push('install.sh must be npm-first and include user-local prefix recovery');
  for (const command of DOCUMENTED_COMMANDS) {
    if (!readme.includes(`agentkodex ${command}`) && !readme.includes(`agentkodex ${command.replace(' ', '-')}`)) warnings.push(`README may not document: ${command}`);
    if (!help.includes(`agentkodex ${command}`) && !help.includes(`agentkodex ${command.replace(' ', '-')}`)) errors.push(`help output missing documented command: ${command}`);
  }
  const packed = npmPackFiles(root);
  if (!packed.ok) errors.push(`npm pack failed: ${packed.error}`);
  else {
    for (const file of REQUIRED_PACKED_FILES) if (!packed.files.has(file)) errors.push(`packed artifact missing ${file}`);
    for (const file of packed.files) if (file.startsWith('tests/')) errors.push(`packed artifact includes tests: ${file}`);
  }
  return { name: 'package-docs-consistency', ok: errors.length === 0, errors: errors.length, warnings: warnings.length, details: [...errors, ...warnings] };
}

function npmPackFiles(root) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) return { ok: false, files: new Set(), error: `${result.stderr || result.stdout}`.trim() };
  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: true, files: new Set((parsed[0]?.files || []).map((item) => item.path)), error: '' };
  } catch (error) {
    return { ok: false, files: new Set(), error: error.message };
  }
}

module.exports = {
  DOCUMENTED_COMMANDS,
  packageConsistencyCheck,
};
