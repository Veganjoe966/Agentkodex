#!/usr/bin/env node
'use strict';

const path = require('path');
const { repairAgentkodexPath } = require('../src/install/pathRepair');

function isGlobalInstall(env = process.env) {
  return env.npm_config_global === 'true' || env.npm_config_location === 'global';
}

function main() {
  if (process.env.AGENTKODEX_SKIP_PATH_REPAIR === '1') return;
  if (!isGlobalInstall()) return;
  const result = repairAgentkodexPath({ packageRoot: path.resolve(__dirname, '..') });
  if (result.commandAvailable) {
    const where = result.linkPath || result.globalBin;
    console.log(`[agentkodex] command is available${where ? `: ${where}` : ''}`);
    return;
  }
  if (result.needsNewShell) {
    console.log(`[agentkodex] added PATH setup to ${result.profilePath}`);
    console.log(`[agentkodex] open a new terminal or run: export PATH="${path.dirname(result.linkPath)}:$PATH"`);
    return;
  }
  if (!result.ok) {
    console.warn('[agentkodex] installed, but PATH repair could not be completed automatically.');
    for (const warning of result.warnings) console.warn(`[agentkodex] ${warning}`);
    console.warn(`[agentkodex] try: "${path.join(result.globalBin, 'agentkodex')}" --help`);
  }
}

main();
