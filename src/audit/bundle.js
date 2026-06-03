'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { resolveRun } = require('../report');
const { getLastRun, kodexPath } = require('../kodexStore');
const { resolveSession } = require('../runtime/sessionStore');
const { ensureDir, exists, readJson, readText, timestampId, slugify, writeText } = require('../utils');
const { MAX_TEXT_BYTES, mayCopyAuditPath, redactAuditText } = require('./redact');
const { createManifest, recordArtifact, recordMissing, recordSkipped, writeManifest } = require('./manifest');

function createAuditBundle(root, options = {}) {
  const target = resolveTarget(root, options);
  const format = options.format || 'dir';
  const output = resolveOutput(root, target, options);
  ensureDir(output.bundleDir);

  const manifest = createManifest({ root, run: target.run, session: target.session, format });
  copyKnownArtifacts(manifest, output.bundleDir, target);
  addGitArtifacts(manifest, output.bundleDir, root);
  const manifestPath = writeManifest(output.bundleDir, manifest);
  const zipPath = format === 'zip' ? zipBundle(output.bundleDir, output.zipPath) : null;

  return {
    dir: output.bundleDir,
    zip: zipPath,
    manifestPath,
    summaryPath: path.join(output.bundleDir, 'summary.md'),
    manifest,
  };
}

function resolveTarget(root, options = {}) {
  const session = options.sessionId ? resolveSession(root, options.sessionId) : null;
  const runId = options.runId || options.target || (session?.runId || null);
  let run = runId && runId !== 'last' ? resolveRun(root, runId) : null;
  if (!run && !options.sessionId) run = resolveRun(root, options.target || 'last') || getLastRun(root);
  const inferredSession = session || (run ? resolveSessionFromRun(root, run) : resolveSession(root, 'last'));
  if (!run && inferredSession?.runDir && exists(inferredSession.runDir)) run = { id: inferredSession.runId || path.basename(inferredSession.runDir), dir: inferredSession.runDir };
  if (!run && !inferredSession) throw new Error('No Agentkodex run or session found to bundle.');
  return { run, session: inferredSession };
}

function resolveSessionFromRun(root, run) {
  const status = readJson(path.join(run.dir, 'status.json'), {});
  if (!status.sessionId) return null;
  return resolveSession(root, status.sessionId);
}

function resolveOutput(root, target, options) {
  const idSeed = target.run?.id || target.session?.id || 'last';
  const id = `${timestampId()}-${slugify(idSeed, 60)}`;
  const out = options.out ? path.resolve(options.out) : kodexPath(root, 'audit', id);
  if (options.format === 'zip') {
    const zipPath = out.endsWith('.zip') ? out : `${out}.zip`;
    return { bundleDir: out.endsWith('.zip') ? kodexPath(root, 'audit', `${id}-dir`) : out, zipPath };
  }
  return { bundleDir: out, zipPath: null };
}

function copyKnownArtifacts(manifest, bundleDir, target) {
  const runDir = target.run?.dir;
  const session = target.session;
  const files = [
    ['run_metadata', runDir && path.join(runDir, 'status.json')],
    ['session_metadata', session?.files?.session || (session?.dir && path.join(session.dir, 'session.json'))],
    ['session_runtime_metadata', session?.files?.metadata || (session?.dir && path.join(session.dir, 'metadata.json'))],
    ['transcript', runDir && path.join(runDir, 'transcript.log')],
    ['structured_events', runDir && path.join(runDir, 'session-events.ndjson')],
    ['gate_results', runDir && path.join(runDir, 'gate-results.json')],
    ['gate_report', runDir && path.join(runDir, 'gate-report.md')],
    ['approval_records', session?.files?.approvals],
    ['policy_notes', runDir && path.join(runDir, 'policy.log')],
    ['security_report', runDir && path.join(runDir, 'security-report.md')],
    ['final_report', runDir && path.join(runDir, 'final-report.md')],
    ['changed_files_summary', runDir && path.join(runDir, 'diff.stat')],
    ['git_diff_patch', runDir && path.join(runDir, 'diff.patch')],
  ];
  for (const [role, source] of files) copyArtifact(manifest, bundleDir, role, source);
}

function copyArtifact(manifest, bundleDir, role, source) {
  if (!source || !exists(source)) return recordMissing(manifest, role, source || null);
  if (!mayCopyAuditPath(source)) return recordSkipped(manifest, role, source, 'blocked path');
  const stat = fs.statSync(source);
  const raw = fs.readFileSync(source, 'utf8').slice(0, MAX_TEXT_BYTES);
  const redacted = redactAuditText(raw + (stat.size > MAX_TEXT_BYTES ? '\n[truncated by audit-bundle]\n' : ''));
  const name = `${role}-${path.basename(source).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  const destination = path.join(bundleDir, name);
  writeText(destination, redacted.text);
  recordArtifact(manifest, {
    role,
    source,
    file: name,
    bytes: Buffer.byteLength(redacted.text),
    sha256: crypto.createHash('sha256').update(redacted.text).digest('hex'),
    redacted: redacted.changed,
    redactionMarkers: redacted.markerCount,
    truncated: stat.size > MAX_TEXT_BYTES,
  });
}

function addGitArtifacts(manifest, bundleDir, root) {
  if (!exists(path.join(root, '.git'))) {
    recordMissing(manifest, 'current_changed_files', null, 'not a git repository');
    recordMissing(manifest, 'current_git_diff_patch', null, 'not a git repository');
    return;
  }
  addGenerated(manifest, bundleDir, 'current_changed_files', git(root, ['diff', '--name-status']));
  addGenerated(manifest, bundleDir, 'current_git_diff_patch', git(root, ['diff', '--']));
}

function addGenerated(manifest, bundleDir, role, text) {
  if (!text) return recordMissing(manifest, role, null, 'no git output');
  const redacted = redactAuditText(text);
  const file = `${role}.txt`;
  writeText(path.join(bundleDir, file), redacted.text);
  recordArtifact(manifest, { role, source: 'generated', file, bytes: Buffer.byteLength(redacted.text), sha256: crypto.createHash('sha256').update(redacted.text).digest('hex'), redacted: redacted.changed, redactionMarkers: redacted.markerCount });
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_TEXT_BYTES });
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function zipBundle(bundleDir, zipPath) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? ['zip'] : ['-lc', 'command -v zip >/dev/null 2>&1']);
  if (probe.status !== 0) throw new Error('zip command is not available; use --format dir.');
  ensureDir(path.dirname(zipPath));
  const result = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: bundleDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`zip failed: ${result.stderr || result.stdout || result.status}`);
  return zipPath;
}

module.exports = {
  createAuditBundle,
  resolveTarget,
};
