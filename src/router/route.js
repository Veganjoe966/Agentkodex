'use strict';

const { loadScorecards, inferTaskCategory } = require('../scorecards/store');

function routeTask(root, task) {
  const scorecards = loadScorecards(root);
  const cards = Object.values(scorecards.agents || {}).filter((card) => card.runs > 0);
  const category = inferTaskCategory(task);
  if (!cards.length) {
    return { task, category, selected: null, reason: 'insufficient history', candidates: [] };
  }
  const candidates = cards.map((card) => ({ agent: card.agent, score: routeScore(card, category), card })).sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent));
  const selected = candidates[0];
  return {
    task,
    category,
    selected: selected.agent,
    reason: renderReason(selected.card, category),
    candidates: candidates.map((item) => ({
      agent: item.agent,
      score: item.score,
      runs: item.card.runs,
      successRate: item.card.successRate,
      gatePassRate: item.card.gatePassRate,
      securityAllowed: item.card.securityAllowed,
      securityDeniedCount: item.card.securityDeniedCount,
      failedCapabilityCount: item.card.failedCapabilityCount,
      qualityGateOk: item.card.qualityGateOk,
      qualityViolationCount: item.card.qualityViolationCount,
      completionBlocked: item.card.completionBlocked,
      approvalRequiredCount: item.card.approvalRequiredCount,
      unsafeActionAttemptCount: item.card.unsafeActionAttemptCount,
      lintErrorCount: item.card.lintErrorCount,
      typeErrorCount: item.card.typeErrorCount,
      testFailureCount: item.card.testFailureCount,
      complexityViolationCount: item.card.complexityViolationCount,
      circularDependencyCount: item.card.circularDependencyCount,
      deadImportCount: item.card.deadImportCount,
      architectureViolationCount: item.card.architectureViolationCount,
    })),
  };
}

function routeScore(card, category) {
  const categoryRuns = card.taskCategories?.[category] || 0;
  const success = card.successRate === null ? 0 : card.successRate * 60;
  const gates = card.gatePassRate === null ? 0 : card.gatePassRate * 25;
  const securityPenalty = Number(card.securityDeniedCount || 0) * 12 +
    Number(card.failedCapabilityCount || 0) * 10 +
    Number(card.unsafeActionAttemptCount || 0) * 8;
  const approvalPenalty = Math.min(12, Number(card.approvalRequiredCount || 0) * 2);
  const qualityPenalty = Number(card.qualityViolationCount || 0) * 2 +
    (card.qualityGateOk === false ? 12 : 0) +
    Number(card.completionBlockedCount || 0) * 8 +
    namedQualityPenalty(card);
  const cleanReward = cleanGovernance(card) ? 8 : 0;
  const duration = card.avgDurationMs ? Math.min(10, 60000 / Math.max(card.avgDurationMs, 1)) : 0;
  return Math.round((success + gates + duration + cleanReward + categoryRuns * 5 - securityPenalty - approvalPenalty - qualityPenalty) * 100) / 100;
}

function namedQualityPenalty(card) {
  return Number(card.lintErrorCount || 0) * 2 +
    Number(card.typeErrorCount || 0) * 3 +
    Number(card.testFailureCount || 0) * 4 +
    Number(card.complexityViolationCount || 0) +
    Number(card.circularDependencyCount || 0) * 2 +
    Number(card.deadImportCount || 0) +
    Number(card.architectureViolationCount || 0) * 3;
}

function cleanGovernance(card) {
  return card.runs > 0 &&
    card.securityAllowed &&
    card.qualityGateOk !== false &&
    Number(card.approvalRequiredCount || 0) === 0 &&
    Number(card.unsafeActionAttemptCount || 0) === 0 &&
    !card.completionBlocked;
}

function renderReason(card, category) {
  const success = card.successRate === null ? 'insufficient success history' : `${Math.round(card.successRate * 100)}% success`;
  const gates = card.gatePassRate === null ? 'insufficient gate history' : `${Math.round(card.gatePassRate * 100)} gate pass rate`;
  const categoryRuns = card.taskCategories?.[category] || 0;
  return `${success}, ${gates}, ${categoryRuns} prior ${category} task(s), avg duration ${card.avgDurationMs ?? 'unknown'}ms`;
}

module.exports = {
  routeTask,
};
