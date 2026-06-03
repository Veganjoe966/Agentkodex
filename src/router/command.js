'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { routeTask } = require('./route');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function routeCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', '');
  if (!task) throw new Error('Missing task. Example: agentkodex route "large refactor"');
  const route = routeTask(root, task);
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(route, null, 2));
  else if (!route.selected) console.log(`Route: insufficient history\nTask category: ${route.category}`);
  else {
    console.log(`Route: ${route.selected}`);
    console.log(`Reason: ${route.reason}`);
  }
}

module.exports = {
  routeCommand,
};
