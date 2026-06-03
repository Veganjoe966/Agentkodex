'use strict';

const path = require('path');
const { writeJson, writeText } = require('../utils');

function createManifest(input) {
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
  const manifestPath = path.join(bundleDir, 'manifest.json');
  writeJson(manifestPath, manifest);
  writeText(path.join(bundleDir, 'summary.md'), renderSummary(manifest));
  writeJson(path.join(bundleDir, 'redaction-report.json'), manifest.redaction);
  return manifestPath;
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
};
