'use strict';

const path = require('path');
const { parseArgs, stringFlag } = require('../args');
const { ensureKodex } = require('../kodexStore');
const { createAuditBundle } = require('./bundle');

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

function rawFlagValue(argv, name) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}`) return argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : '';
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return '';
}

module.exports = {
  auditBundleCommand,
};
