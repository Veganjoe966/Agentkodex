#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');
const { sanitizeError } = require('../src/security/controlPlane');

main(process.argv.slice(2)).catch((error) => {
  console.error(`Error: ${sanitizeError(error)}`);
  process.exitCode = 1;
});
