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
  applyGovernance(card, metrics);
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
      const metrics = collectRunMetrics({ root, run: { dir, status }, agent: status.agent, task: status.task });
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
  applyGovernance(card, metrics);
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
    securityAllowed: true,
    securityDeniedCount: 0,
    failedCapabilityCount: 0,
    approvalRequiredCount: 0,
    unsafeActionAttemptCount: 0,
    qualityGateOk: null,
    qualityPasses: 0,
    qualitySamples: 0,
    qualityViolationCount: 0,
    lintErrorCount: 0,
    typeErrorCount: 0,
    testFailureCount: 0,
    complexityViolationCount: 0,
    circularDependencyCount: 0,
    deadImportCount: 0,
    architectureViolationCount: 0,
    completionBlocked: false,
    completionBlockedCount: 0,
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
    securityAllowed: card.securityDeniedCount === 0 && card.failedCapabilityCount === 0,
    qualityGateOk: card.qualitySamples ? card.qualityPasses === card.qualitySamples : null,
    completionBlocked: card.completionBlockedCount > 0,
    insufficientHistory: card.runs === 0,
    updatedAt: new Date().toISOString(),
  };
}

function applyGovernance(card, metrics = {}) {
  card.securityDeniedCount += Number(metrics.securityDeniedCount || 0);
  card.failedCapabilityCount += Number(metrics.failedCapabilityCount || 0);
  card.approvalRequiredCount += Number(metrics.approvalRequiredCount || 0);
  card.unsafeActionAttemptCount += Number(metrics.unsafeActionAttemptCount || 0);
  if (metrics.qualityGateOk !== null && metrics.qualityGateOk !== undefined) {
    card.qualitySamples += 1;
    if (metrics.qualityGateOk) card.qualityPasses += 1;
  }
  card.qualityViolationCount += Number(metrics.qualityViolationCount || 0);
  card.lintErrorCount += Number(metrics.lintErrorCount || 0);
  card.typeErrorCount += Number(metrics.typeErrorCount || 0);
  card.testFailureCount += Number(metrics.testFailureCount || 0);
  card.complexityViolationCount += Number(metrics.complexityViolationCount || 0);
  card.circularDependencyCount += Number(metrics.circularDependencyCount || 0);
  card.deadImportCount += Number(metrics.deadImportCount || 0);
  card.architectureViolationCount += Number(metrics.architectureViolationCount || 0);
  if (metrics.completionBlocked) card.completionBlockedCount += 1;
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
