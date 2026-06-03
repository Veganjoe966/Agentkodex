#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');
const { sanitizeError } = require('../src/security/controlPlane');

main(process.argv.slice(2)).catch((error) => {
  const message = sanitizeError(error);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, errorCode: 'agentkodex_error', message, hint: hintFor(message) }, null, 2));
  else console.error(`Error: ${message}`);
  process.exitCode = 1;
});

function hintFor(message) {
  if (/not live|control request/i.test(message)) return 'Run agentkodex session status last or agentkodex session replay last.';
  if (/not the Agentkodex package root/i.test(message)) return 'Run agentkodex quality check for customer project validation.';
  return 'Run with --help for usage or agentkodex doctor for setup diagnostics.';
}
