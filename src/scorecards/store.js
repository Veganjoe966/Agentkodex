'use strict';

const fs = require('fs');
const path = require('path');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { ensureDir, exists, readJson, writeJson } = require('../utils');
const { collectRunMetrics } = require('../core/scoring/metrics');

function scorecardsPath(root) {
  ensureKodex(root);
  const dir = kodexPath(root, 'agents');
  ensureDir(dir);
  return path.join(dir, 'scorecards.json');
}

function loadScorecards(root) {
  return readJson(scorecardsPath(root), { generatedAt: null, agents: {} });
}

function saveScorecards(root, scorecards) {
  const next = { generatedAt: new Date().toISOString(), agents: scorecards.agents || {} };
  writeJson(scorecardsPath(root), next);
  return next;
}

function recordAgentRun(root, agent, task, metrics) {
  const scorecards = loadScorecards(root);
  const card = scorecards.agents[agent] || emptyCard(agent);
  card.runs += 1;
  if (metrics.completion) card.successes += 1;
  card.totalDurationMs += Number(metrics.durationMs || 0);
  card.durationSamples += metrics.durationMs ? 1 : 0;
  card.totalGatePasses += Number(metrics.gatePassCount || 0);
  card.totalGateFailures += Number(metrics.gateFailCount || 0);
  if (metrics.repairLoops !== null && metrics.repairLoops !== undefined) {
    card.totalRepairLoops += Number(metrics.repairLoops || 0);
    card.repairLoopSamples += 1;
  }
  const category = inferTaskCategory(task);
  card.taskCategories[category] = (card.taskCategories[category] || 0) + 1;
  card.lastMetrics = metrics;
  scorecards.agents[agent] = finalizeCard(card);
  return saveScorecards(root, scorecards);
}

function rebuildScorecards(root) {
  const scorecards = { agents: {} };
  const runsDir = kodexPath(root, 'runs');
  if (exists(runsDir)) {
    for (const id of fs.readdirSync(runsDir)) {
      const dir = path.join(runsDir, id);
      const status = readJson(path.join(dir, 'status.json'), null);
      if (!status?.agent) continue;
      const metrics = collectRunMetrics({ run: { dir, status }, agent: status.agent, task: status.task });
      mergeMetric(scorecards, status.agent, status.task || '', metrics);
    }
  }
  return saveScorecards(root, scorecards);
}

function mergeMetric(scorecards, agent, task, metrics) {
  const card = scorecards.agents[agent] || emptyCard(agent);
  card.runs += 1;
  if (metrics.completion) card.successes += 1;
  card.totalDurationMs += Number(metrics.durationMs || 0);
  card.durationSamples += metrics.durationMs ? 1 : 0;
  card.totalGatePasses += Number(metrics.gatePassCount || 0);
  card.totalGateFailures += Number(metrics.gateFailCount || 0);
  const category = inferTaskCategory(task);
  card.taskCategories[category] = (card.taskCategories[category] || 0) + 1;
  card.lastMetrics = metrics;
  scorecards.agents[agent] = finalizeCard(card);
}

function emptyCard(agent) {
  return {
    agent,
    runs: 0,
    successes: 0,
    successRate: null,
    gatePassRate: null,
    avgDurationMs: null,
    avgRepairLoops: null,
    totalDurationMs: 0,
    durationSamples: 0,
    totalGatePasses: 0,
    totalGateFailures: 0,
    totalRepairLoops: 0,
    repairLoopSamples: 0,
    taskCategories: {},
    cost: { total: null, average: null, samples: 0 },
    lastMetrics: null,
  };
}

function finalizeCard(card) {
  const gateTotal = card.totalGatePasses + card.totalGateFailures;
  return {
    ...card,
    successRate: card.runs ? card.successes / card.runs : null,
    gatePassRate: gateTotal ? card.totalGatePasses / gateTotal : null,
    avgDurationMs: card.durationSamples ? Math.round(card.totalDurationMs / card.durationSamples) : null,
    avgRepairLoops: card.repairLoopSamples ? card.totalRepairLoops / card.repairLoopSamples : null,
    insufficientHistory: card.runs === 0,
    updatedAt: new Date().toISOString(),
  };
}

function inferTaskCategory(task = '') {
  const text = String(task).toLowerCase();
  if (/refactor|migrate|architecture|rewrite/.test(text)) return 'refactor';
  if (/test|lint|build|ci|gate/.test(text)) return 'validation';
  if (/bug|fix|error|failure|debug/.test(text)) return 'debug';
  if (/security|auth|token|secret/.test(text)) return 'security';
  if (/ui|page|component|frontend/.test(text)) return 'frontend';
  return 'general';
}

module.exports = {
  scorecardsPath,
  loadScorecards,
  saveScorecards,
  recordAgentRun,
  rebuildScorecards,
  inferTaskCategory,
};
