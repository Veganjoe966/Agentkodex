'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { loadScorecards, rebuildScorecards } = require('./store');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function scorecardsCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const scorecards = booleanFlag(flags, 'rebuild') ? rebuildScorecards(root) : loadScorecards(root);
  if (booleanFlag(flags, 'json')) {
    console.log(JSON.stringify(scorecards, null, 2));
    return;
  }
  const cards = Object.values(scorecards.agents || {});
  if (!cards.length) {
    console.log('insufficient history');
    return;
  }
  console.log('Agentkodex agent scorecards:');
  for (const card of cards.sort((a, b) => (b.successRate || 0) - (a.successRate || 0))) {
    console.log(`- ${card.agent}: runs=${card.runs} successRate=${percent(card.successRate)} gatePassRate=${percent(card.gatePassRate)} avgDurationMs=${card.avgDurationMs ?? 'unknown'}`);
  }
}

function percent(value) {
  return value === null || value === undefined ? 'insufficient history' : `${Math.round(value * 100)}%`;
}

module.exports = {
  scorecardsCommand,
};
