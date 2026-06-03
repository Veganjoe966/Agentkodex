'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, readText, exists } = require('../../utils');
const { collectRunGovernance, readEvidence } = require('../../governance/summary');

const PASS_STATUSES = new Set(['passed', 'completed_no_gates', 'completed_no_gates_discovered']);
const GATES = ['lint', 'test', 'build', 'e2e', 'quality'];

function collectRunMetrics(input = {}) {
  const run = input.run || {};
  const status = run.status || readJson(path.join(run.dir || '', 'status.json'), {});
  const gateResults = run.gateResults || readJson(path.join(run.dir || '', 'gate-results.json'), []);
  const startedAt = input.startedAt || status.createdAt || run.startedAt || null;
  const endedAt = input.endedAt || status.completedAt || run.endedAt || null;
  const gates = gateSummary(gateResults);
  const governance = run.governance || collectRunGovernance(input.root || process.cwd(), run.dir, { gateResults, status });
  const qualitySignals = collectQualitySignals(input.root || process.cwd(), run.dir, gateResults);
  const completion = PASS_STATUSES.has(status.status || run.status?.status);
  const diffPatch = readText(path.join(run.dir || '', 'diff.patch'), '');
  const diffStat = readText(path.join(run.dir || '', 'diff.stat'), '');
  const changes = readJson(path.join(run.dir || '', 'changes.json'), null);
  const agentResult = readJson(path.join(run.dir || '', 'agent-result.json'), {});
  return {
    agent: input.agent || status.agent || run.agent || null,
    task: input.task || status.task || run.task || '',
    status: status.status || run.status?.status || 'unknown',
    completion,
    gates,
    gatePassCount: Object.values(gates).filter((gate) => gate && gate.passed).length,
    gateFailCount: Object.values(gates).filter((gate) => gate && gate.failed).length,
    durationMs: durationMs(startedAt, endedAt) || sumGateDurations(gateResults),
    approvalCount: countApprovals(run.dir),
    filesChanged: filesChanged(diffStat, changes),
    filesAdded: changeNumber(changes, 'filesAdded'),
    filesModified: changeNumber(changes, 'filesModified'),
    filesDeleted: changeNumber(changes, 'filesDeleted'),
    filesRenamed: changeNumber(changes, 'filesRenamed'),
    artifactCount: changeNumber(changes, 'artifactCount'),
    changedPaths: Array.isArray(changes?.changedPaths) ? changes.changedPaths : [],
    mutationScanOk: changes?.mutationScanOk ?? true,
    mutationScanError: changes?.mutationScanError || null,
    diffSizeBytes: diffSizeBytes(diffPatch, changes),
    changeSource: changes?.source || (diffStat || diffPatch ? 'git' : 'none'),
    tokenUsage: agentResult.tokenUsage || status.tokenUsage || null,
    cost: agentResult.cost || status.cost || null,
    repairLoops: status.repairLoops ?? null,
    securityAllowed: governance.securityAllowed,
    securityDeniedCount: governance.securityDeniedCount,
    failedCapabilityCount: governance.failedCapabilityCount,
    qualityGateOk: governance.qualityGateOk,
    qualityViolationCount: governance.qualityViolationCount,
    completionBlocked: governance.completionBlocked || (!completion && (governance.securityDeniedCount > 0 || governance.qualityGateOk === false)),
    approvalRequiredCount: governance.approvalRequiredCount,
    unsafeActionAttemptCount: governance.unsafeActionAttemptCount,
    ...qualitySignals,
  };
}

function gateSummary(gateResults = []) {
  const out = {};
  for (const name of GATES) out[name] = null;
  for (const gate of gateResults || []) {
    const key = GATES.includes(gate.gate) ? gate.gate : null;
    if (!key) continue;
    const skipped = gate.skipped || gate.result?.skipped;
    const exitCode = gate.result?.exitCode;
    out[key] = { skipped: Boolean(skipped), passed: !skipped && exitCode === 0, failed: !skipped && exitCode !== 0, exitCode };
  }
  return out;
}

function scoreMetrics(metrics, strategy = 'balanced') {
  const gateScore = metrics.gatePassCount * 12 - metrics.gateFailCount * 18;
  const completionScore = metrics.completion ? 45 : 0;
  const speedPenalty = metrics.durationMs ? Math.min(15, metrics.durationMs / 60000) : 0;
  const diffPenalty = metrics.diffSizeBytes ? Math.min(10, metrics.diffSizeBytes / 100000) : 0;
  const approvalPenalty = Number(metrics.approvalCount || 0) * 2;
  const governancePenalty = Number(metrics.securityDeniedCount || 0) * 12 +
    Number(metrics.failedCapabilityCount || 0) * 10 +
    Number(metrics.unsafeActionAttemptCount || 0) * 8 +
    Number(metrics.qualityViolationCount || 0) * 2 +
    (metrics.qualityGateOk === false ? 12 : 0) +
    (metrics.completionBlocked ? 15 : 0);
  const balanced = completionScore + gateScore - speedPenalty - diffPenalty - approvalPenalty - governancePenalty;
  if (strategy === 'completion') return completionScore + gateScore;
  if (strategy === 'gates') return gateScore + (metrics.completion ? 10 : 0);
  if (strategy === 'speed') return (metrics.completion ? 50 : 0) - speedPenalty;
  return Math.round(balanced * 100) / 100;
}

function selectWinner(results, strategy = 'balanced') {
  const scored = results.map((item) => ({ ...item, score: { ...(item.score || {}), total: scoreMetrics(item.metrics || item, strategy) } }));
  scored.sort((a, b) => b.score.total - a.score.total || String(a.agent).localeCompare(String(b.agent)));
  const eligible = scored.find((item) => isEligibleWinner(item.metrics || item));
  return { winner: eligible?.agent || null, results: scored };
}

function isEligibleWinner(metrics = {}) {
  return Boolean(metrics.completion) &&
    !metrics.completionBlocked &&
    Number(metrics.securityDeniedCount || 0) === 0 &&
    Number(metrics.failedCapabilityCount || 0) === 0 &&
    metrics.qualityGateOk !== false;
}

function durationMs(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  const value = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function sumGateDurations(gates = []) {
  const sum = (gates || []).reduce((total, gate) => total + Number(gate.result?.durationMs || 0), 0);
  return sum || null;
}

function countApprovals(runDir) {
  const session = readJson(path.join(runDir || '', 'session.json'), {});
  const approvalsFile = session.files?.approvals;
  if (!approvalsFile || !exists(approvalsFile)) return 0;
  const value = readJson(approvalsFile, { approvals: [] });
  return Array.isArray(value) ? value.length : (value.approvals || []).length;
}

function parseChangedFiles(diffStat) {
  const text = String(diffStat || '');
  const match = /(\d+)\s+files?\s+changed/.exec(text);
  if (match) return Number(match[1]);
  return text.trim() ? null : 0;
}

function filesChanged(diffStat, changes) {
  if (changes && Number.isFinite(Number(changes.filesChanged))) return Number(changes.filesChanged);
  return parseChangedFiles(diffStat);
}

function diffSizeBytes(diffPatch, changes) {
  if (changes && Number.isFinite(Number(changes.changeBytes))) return Number(changes.changeBytes);
  return Buffer.byteLength(diffPatch || '');
}

function changeNumber(changes, key) {
  return Number.isFinite(Number(changes?.[key])) ? Number(changes[key]) : null;
}

function collectQualitySignals(root, runDir, gateResults = []) {
  const checks = qualityChecksFromGates(gateResults) || qualityChecksFromEvidence(root, runDir) || [];
  return {
    lintErrorCount: errorsFor(checks, ['eslint', 'lint']),
    typeErrorCount: errorsFor(checks, ['typecheck', 'typescript']),
    testFailureCount: errorsFor(checks, ['tests', 'test']),
    complexityViolationCount: errorsFor(checks, ['complexity']),
    circularDependencyCount: errorsFor(checks, ['circular-deps']),
    deadImportCount: errorsFor(checks, ['dead-imports']),
    architectureViolationCount: errorsFor(checks, ['architecture', 'architecture-boundaries']),
  };
}

function qualityChecksFromGates(gateResults = []) {
  const quality = (gateResults || []).find((item) => item.gate === 'quality');
  if (!quality?.outputPath) return null;
  const data = readJson(quality.outputPath, null);
  return Array.isArray(data?.checks) ? data.checks : null;
}

function qualityChecksFromEvidence(root, runDir) {
  const latest = [...readEvidence(root, runDir)].reverse().find((event) => event.type === 'quality_gate_result');
  return Array.isArray(latest?.checks) ? latest.checks : null;
}

function errorsFor(checks, names) {
  return checks
    .filter((check) => names.includes(check.name))
    .reduce((sum, check) => sum + Number(check.errors || 0), 0);
}

module.exports = {
  GATES,
  collectRunMetrics,
  scoreMetrics,
  selectWinner,
  collectQualitySignals,
};
