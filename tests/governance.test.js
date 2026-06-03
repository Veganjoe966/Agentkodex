'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRun, updateRunStatus } = require('../src/kodexStore');
const { writeText } = require('../src/utils');
const { writeAuditEvidence } = require('../src/audit/evidence');
const { createAuditBundle } = require('../src/audit/bundle');
const { collectRunGovernance } = require('../src/governance/summary');
const { recordAgentRun, loadScorecards } = require('../src/scorecards/store');
const { routeTask } = require('../src/router/route');
const { decideFinalStatus, createQaReport } = require('../src/run');

test('audit bundle manifest contains security and quality governance evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gov-bundle-'));
  const run = createRun(dir, 'governance audit');
  updateRunStatus(run.dir, { agent: 'shell', status: 'failed_security' });
  writeText(path.join(run.dir, 'transcript.log'), 'hello\n');
  writeAuditEvidence(dir, { type: 'denied_action', allowed: false, reason: 'blocked', command: 'rm -rf .' }, { runDir: run.dir });
  writeAuditEvidence(dir, { type: 'quality_gate_result', ok: false, checks: [{ name: 'loc', errors: 1 }] }, { runDir: run.dir });
  const bundle = createAuditBundle(dir, { target: run.id });
  const manifest = JSON.parse(fs.readFileSync(bundle.manifestPath, 'utf8'));
  assert.equal(manifest.securityAllowed, false);
  assert.equal(manifest.securityDeniedCount, 1);
  assert.equal(manifest.qualityGateOk, false);
  assert.equal(manifest.qualityViolationCount, 1);
  assert.equal(manifest.completionBlocked, true);
  const auditArtifact = manifest.artifacts.find((item) => item.role === 'audit_evidence');
  assert.ok(auditArtifact);
  const copied = fs.readFileSync(path.join(bundle.dir, auditArtifact.file), 'utf8');
  assert.match(copied, /denied_action/);
  assert.match(copied, /quality_gate_result/);
});

test('governance summary derives required fields from run evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gov-summary-'));
  const run = createRun(dir, 'summary');
  writeAuditEvidence(dir, { type: 'capability_validation', allowed: false, reason: 'expired', capability: { capabilityId: 'cap1' } }, { runDir: run.dir });
  writeAuditEvidence(dir, { type: 'capability_verification_failure', allowed: false, reason: 'expired', capability: { capabilityId: 'cap1' } }, { runDir: run.dir });
  writeAuditEvidence(dir, { type: 'security_gate_decision', allowed: false, requiredApproval: true }, { runDir: run.dir });
  const governance = collectRunGovernance(dir, run.dir);
  assert.equal(governance.failedCapabilityCount, 1);
  assert.equal(governance.securityDeniedCount, 1);
  assert.equal(governance.approvalRequiredCount, 1);
  assert.equal(governance.unsafeActionAttemptCount, 1);
  assert.equal(governance.completionBlocked, true);
});

test('scorecards and routing include and use governance fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gov-route-'));
  recordAgentRun(dir, 'clean', 'large refactor', metrics({ completion: true, qualityGateOk: true }));
  recordAgentRun(dir, 'security-risk', 'large refactor', metrics({ completion: true, securityDeniedCount: 2, failedCapabilityCount: 1, unsafeActionAttemptCount: 2 }));
  recordAgentRun(dir, 'quality-risk', 'large refactor', metrics({
    completion: true,
    qualityGateOk: false,
    qualityViolationCount: 8,
    completionBlocked: true,
    lintErrorCount: 2,
    typeErrorCount: 1,
    testFailureCount: 1,
    complexityViolationCount: 3,
    circularDependencyCount: 1,
    deadImportCount: 1,
    architectureViolationCount: 1,
  }));
  const cards = loadScorecards(dir).agents;
  assert.equal(cards['security-risk'].failedCapabilityCount, 1);
  assert.equal(cards['quality-risk'].completionBlocked, true);
  assert.equal(cards['quality-risk'].lintErrorCount, 2);
  assert.equal(cards['quality-risk'].architectureViolationCount, 1);
  const route = routeTask(dir, 'large refactor');
  assert.equal(route.selected, 'clean');
  assert.ok(route.candidates.find((item) => item.agent === 'clean').score > route.candidates.find((item) => item.agent === 'security-risk').score);
  assert.ok(Object.prototype.hasOwnProperty.call(route.candidates[0], 'unsafeActionAttemptCount'));
  assert.ok(Object.prototype.hasOwnProperty.call(route.candidates[0], 'lintErrorCount'));
});

test('completion is blocked by quality or capability governance', () => {
  const agentRun = { result: { exitCode: 0, skipped: false } };
  const gateResults = [];
  const security = { findings: [] };
  assert.equal(decideFinalStatus({ agentRun, gateResults, security, gates: ['quality'], governance: { qualityGateOk: false } }), 'failed_gates');
  assert.equal(decideFinalStatus({ agentRun, gateResults, security, gates: ['test'], governance: { failedCapabilityCount: 1 } }), 'failed_security');
  assert.equal(decideFinalStatus({ agentRun, gateResults, security, gates: ['test'], governance: { approvalRequiredCount: 1 } }), 'failed_security');
  const qa = createQaReport({ task: 'blocked', gateResults, agentRun, security, governance: { qualityGateOk: false } });
  assert.equal(qa.pass, false);
  assert.match(qa.blockingIssues.join('\n'), /Governance evidence/);
});

function metrics(overrides = {}) {
  return {
    completion: true,
    gatePassCount: 2,
    gateFailCount: 0,
    durationMs: 100,
    securityAllowed: true,
    securityDeniedCount: 0,
    failedCapabilityCount: 0,
    approvalRequiredCount: 0,
    unsafeActionAttemptCount: 0,
    qualityGateOk: null,
    qualityViolationCount: 0,
    completionBlocked: false,
    ...overrides,
  };
}
