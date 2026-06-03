'use strict';

const path = require('path');
const crypto = require('crypto');
const { writeJson, writeText } = require('../utils');

function createManifest(input) {
  const governance = input.governance || defaultGovernance();
  return {
    product: 'Agentkodex',
    kind: 'audit_bundle',
    version: 1,
    createdAt: new Date().toISOString(),
    root: input.root,
    runId: input.run?.id || null,
    runDir: input.run?.dir || null,
    sessionId: input.session?.id || null,
    sessionDir: input.session?.dir || input.session?.sessionDir || null,
    outputFormat: input.format || 'dir',
    securityAllowed: governance.securityAllowed,
    securityDeniedCount: governance.securityDeniedCount,
    failedCapabilityCount: governance.failedCapabilityCount,
    qualityGateOk: governance.qualityGateOk,
    qualityViolationCount: governance.qualityViolationCount,
    completionBlocked: governance.completionBlocked,
    approvalRequiredCount: governance.approvalRequiredCount,
    unsafeActionAttemptCount: governance.unsafeActionAttemptCount,
    redactionApplied: true,
    bundleHash: '',
    governance,
    artifacts: [],
    missing: [],
    skipped: [],
    redaction: {
      filesRedacted: 0,
      markerCount: 0,
      notes: ['Artifact text is passed through Agentkodex secret redaction before writing.'],
    },
  };
}

function defaultGovernance() {
  return {
    securityAllowed: true,
    securityDeniedCount: 0,
    failedCapabilityCount: 0,
    qualityGateOk: null,
    qualityViolationCount: 0,
    completionBlocked: false,
    approvalRequiredCount: 0,
    unsafeActionAttemptCount: 0,
  };
}

function recordArtifact(manifest, item) {
  manifest.artifacts.push(item);
  if (item.redacted) manifest.redaction.filesRedacted += 1;
  manifest.redaction.markerCount += Number(item.redactionMarkers || 0);
}

function recordMissing(manifest, role, source, reason = 'missing') {
  manifest.missing.push({ role, source, reason });
}

function recordSkipped(manifest, role, source, reason) {
  manifest.skipped.push({ role, source, reason });
}

function writeManifest(bundleDir, manifest) {
  manifest.bundleHash = computeBundleHash(manifest);
  const manifestPath = path.join(bundleDir, 'manifest.json');
  writeJson(manifestPath, manifest);
  writeText(path.join(bundleDir, 'summary.md'), renderSummary(manifest));
  writeJson(path.join(bundleDir, 'redaction-report.json'), manifest.redaction);
  return manifestPath;
}

function computeBundleHash(manifest) {
  const payload = {
    version: manifest.version,
    runId: manifest.runId,
    sessionId: manifest.sessionId,
    governance: manifest.governance,
    artifacts: manifest.artifacts.map((item) => ({ role: item.role, file: item.file, sha256: item.sha256, bytes: item.bytes })),
    missing: manifest.missing,
    skipped: manifest.skipped,
    redaction: manifest.redaction,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function renderSummary(manifest) {
  const lines = ['# Agentkodex Audit Bundle', ''];
  lines.push(`Created: ${manifest.createdAt}`);
  lines.push(`Run: ${manifest.runId || 'none'}`);
  lines.push(`Session: ${manifest.sessionId || 'none'}`);
  lines.push(`Artifacts: ${manifest.artifacts.length}`);
  lines.push(`Missing: ${manifest.missing.length}`);
  lines.push(`Skipped: ${manifest.skipped.length}`);
  lines.push(`Redacted files: ${manifest.redaction.filesRedacted}`);
  lines.push(`Security allowed: ${manifest.governance.securityAllowed}`);
  lines.push(`Quality gate: ${manifest.governance.qualityGateOk}`);
  lines.push(`Completion blocked: ${manifest.governance.completionBlocked}`);
  lines.push('');
  lines.push('## Contents');
  if (!manifest.artifacts.length) lines.push('- none');
  for (const item of manifest.artifacts) lines.push(`- ${item.role}: ${item.file}`);
  if (manifest.missing.length) {
    lines.push('');
    lines.push('## Missing');
    for (const item of manifest.missing) lines.push(`- ${item.role}: ${item.reason}`);
  }
  if (manifest.skipped.length) {
    lines.push('');
    lines.push('## Skipped');
    for (const item of manifest.skipped) lines.push(`- ${item.role}: ${item.reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  createManifest,
  recordArtifact,
  recordMissing,
  recordSkipped,
  writeManifest,
  renderSummary,
  computeBundleHash,
};
