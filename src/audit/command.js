'use strict';

const path = require('path');
const { parseArgs, stringFlag } = require('../args');
const { ensureKodex } = require('../kodexStore');
const { createAuditBundle } = require('./bundle');
const { verifyAuditBundle } = require('./verify');
const { anchorBundle, verifyAnchor } = require('./anchor');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function auditBundleCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  const result = createAuditBundle(root, {
    target: stringFlag(flags, 'run', positionals[0] || 'last'),
    runId: stringFlag(flags, 'run', ''),
    sessionId: rawFlagValue(argv, 'session') || '',
    out: stringFlag(flags, 'out', ''),
    format: stringFlag(flags, 'format', 'dir'),
  });
  console.log(`Audit bundle directory: ${result.dir}`);
  if (result.zip) console.log(`Audit bundle zip: ${result.zip}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Summary: ${result.summaryPath}`);
}

async function auditCommand(argv) {
  const [sub = 'bundle', ...rest] = argv;
  if (sub === '--help' || sub === '-h' || sub === 'help') return console.log(auditHelp());
  if (sub === 'bundle') return auditBundleCommand(rest);
  if (sub === 'verify') return auditVerifyCommand(rest);
  if (sub === 'anchor') return auditAnchorCommand(rest);
  if (sub === 'verify-anchor') return auditVerifyAnchorCommand(rest);
  throw new Error(`Unknown audit subcommand: ${sub}`);
}

async function auditVerifyCommand(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return console.log('Usage: agentkodex audit verify <bundle-dir> [--json]');
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const bundleDir = positionals[0] || stringFlag(flags, 'bundle', stringFlag(flags, 'dir', ''));
  if (!bundleDir) throw new Error('Missing bundle directory. Example: agentkodex audit verify .agentkodex/audit/<id>');
  const result = verifyAuditBundle(bundleDir, { projectRoot: root });
  if (flags.json !== undefined) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.summary);
    for (const error of result.errors) console.log(`- error: ${error}`);
    for (const warning of result.warnings) console.log(`- warning: ${warning}`);
  }
  if (!result.ok) process.exitCode = 1;
}

async function auditAnchorCommand(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return console.log('Usage: agentkodex audit anchor <bundle-dir> [--json] [--anchor-path path]');
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const bundleDir = positionals[0] || stringFlag(flags, 'bundle', stringFlag(flags, 'dir', ''));
  if (!bundleDir) throw new Error('Missing bundle directory. Example: agentkodex audit anchor .agentkodex/audit/<id>');
  const result = anchorBundle(bundleDir, { projectRoot: root, anchorPath: stringFlag(flags, 'anchorPath', '') });
  if (flags.json !== undefined) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.summary);
    console.log(`Anchor log: ${result.anchorPath}`);
    console.log(`Anchor hash: ${result.anchor.currentAnchorHash}`);
  }
}

async function auditVerifyAnchorCommand(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return console.log('Usage: agentkodex audit verify-anchor <bundle-dir> [--json] [--anchor-path path]');
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const bundleDir = positionals[0] || stringFlag(flags, 'bundle', stringFlag(flags, 'dir', ''));
  if (!bundleDir) throw new Error('Missing bundle directory. Example: agentkodex audit verify-anchor .agentkodex/audit/<id>');
  const result = verifyAnchor(bundleDir, { projectRoot: root, anchorPath: stringFlag(flags, 'anchorPath', '') });
  if (flags.json !== undefined) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.summary);
    for (const error of result.errors) console.log(`- error: ${error}`);
    for (const warning of result.warnings) console.log(`- warning: ${warning}`);
  }
  if (!result.ok) process.exitCode = 1;
}

function auditHelp() {
  return [
    'Agentkodex audit commands:',
    '  agentkodex audit bundle [last|run-id]',
    '  agentkodex audit verify <bundle-dir> [--json]',
    '  agentkodex audit anchor <bundle-dir> [--json] [--anchor-path path]',
    '  agentkodex audit verify-anchor <bundle-dir> [--json] [--anchor-path path]',
  ].join('\n');
}

function rawFlagValue(argv, name) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}`) return argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : '';
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return '';
}

module.exports = {
  auditCommand,
  auditBundleCommand,
};
