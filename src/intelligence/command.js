'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { readText } = require('../utils');
const { intelligenceDir, rebuildIntelligence, loadIntelligence, renderIntelligence } = require('./store');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function intelligenceCommand(argv) {
  const [sub = 'show', ...rest] = argv;
  const { flags } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  if (sub === 'rebuild') {
    const profile = rebuildIntelligence(root);
    if (booleanFlag(flags, 'json')) console.log(JSON.stringify(profile, null, 2));
    else {
      console.log(`Rebuilt intelligence: ${intelligenceDir(root)}`);
      console.log(renderIntelligence(profile));
    }
    return;
  }
  if (sub === 'show') {
    const loaded = loadIntelligence(root);
    if (booleanFlag(flags, 'json')) console.log(JSON.stringify(loaded, null, 2));
    else console.log(readText(path.join(intelligenceDir(root), 'profile.md'), 'insufficient history; run agentkodex intelligence rebuild'));
    return;
  }
  throw new Error(`Unknown intelligence subcommand: ${sub}`);
}

module.exports = {
  intelligenceCommand,
};
