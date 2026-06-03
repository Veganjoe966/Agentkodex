'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const IGNORED_DIRS = new Set([
  '.agentkodex',
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.turbo',
  'vendor',
]);

function snapshotWorkspace(root) {
  return {
    source: 'snapshot',
    createdAt: new Date().toISOString(),
    files: listFiles(root),
  };
}

function collectChangeArtifacts(root, baseline) {
  const workspaceChanges = baseline ? summarizeWorkspaceChanges(root, baseline) : null;
  return {
    workspaceChanges,
    diffStat: getGitOutput(root, ['diff', '--stat'], 20000) || renderWorkspaceChangeStat(workspaceChanges),
    diff: getGitOutput(root, ['diff', '--'], 300000) || renderWorkspaceChangePatch(workspaceChanges),
  };
}

function summarizeWorkspaceChanges(root, before = {}) {
  try {
    const previous = before.files || {};
    const current = listFiles(root);
    const added = [];
    const modified = [];
    const deleted = [];

    for (const [file, state] of Object.entries(current)) {
      if (!previous[file]) added.push(fileEntry(file, state));
      else if (previous[file].sha256 !== state.sha256) modified.push(fileEntry(file, state, previous[file]));
    }
    for (const [file, state] of Object.entries(previous)) {
      if (!current[file]) deleted.push(fileEntry(file, state));
    }

    const entries = [
      ...added.map((item) => ({ status: 'added', ...item })),
      ...modified.map((item) => ({ status: 'modified', ...item })),
      ...deleted.map((item) => ({ status: 'deleted', ...item })),
    ].sort((a, b) => a.path.localeCompare(b.path));

    return {
      source: 'snapshot',
      createdAt: new Date().toISOString(),
      mutationScanOk: true,
      mutationScanError: null,
      filesChanged: entries.length,
      filesAdded: added.length,
      filesModified: modified.length,
      filesDeleted: deleted.length,
      filesRenamed: 0,
      artifactCount: entries.filter((item) => item.path.startsWith('agent-output/')).length,
      changedPaths: entries.map((item) => item.path),
      changeBytes: entries.reduce((sum, item) => sum + Number(item.bytes || item.previousBytes || 0), 0),
      added,
      modified,
      deleted,
      entries,
    };
  } catch (error) {
    return {
      source: 'snapshot',
      createdAt: new Date().toISOString(),
      mutationScanOk: false,
      mutationScanError: safeError(error),
      filesChanged: null,
      filesAdded: null,
      filesModified: null,
      filesDeleted: null,
      filesRenamed: null,
      artifactCount: null,
      changedPaths: [],
      changeBytes: null,
      entries: [],
    };
  }
}

function renderWorkspaceChangeStat(summary = {}) {
  summary = summary || {};
  const entries = summary.entries || [];
  if (!entries.length) return '';
  const lines = entries.map((item) => `${item.path} | ${item.status} ${item.bytes ?? 0} bytes`);
  lines.push(`${entries.length} ${entries.length === 1 ? 'file' : 'files'} changed (snapshot fallback)`);
  return `${lines.join('\n')}\n`;
}

function renderWorkspaceChangePatch(summary = {}) {
  summary = summary || {};
  const entries = summary.entries || [];
  if (!entries.length) return '';
  return [
    '# Workspace snapshot change summary',
    '# Git diff was unavailable; Agentkodex compared pre/post workspace file hashes.',
    ...entries.map((item) => `${statusLetter(item.status)}\t${item.path}\t${item.bytes ?? 0} bytes`),
    '',
  ].join('\n');
}

function listFiles(root) {
  const files = {};
  walk(root, '', files);
  return files;
}

function walk(root, rel, out) {
  const dir = path.join(root, rel);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const nextRel = rel ? path.join(rel, entry.name) : entry.name;
    const full = path.join(root, nextRel);
    if (entry.isDirectory()) walk(root, nextRel, out);
    else if (entry.isFile()) out[normalize(nextRel)] = fileState(full);
  }
}

function fileState(file) {
  const data = fs.readFileSync(file);
  return {
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

function fileEntry(file, state, previous = null) {
  return {
    path: normalize(file),
    bytes: Number(state.bytes || 0),
    previousBytes: previous ? Number(previous.bytes || 0) : null,
    sha256: state.sha256,
  };
}

function normalize(value) {
  return String(value).replace(/\\/g, '/');
}

function statusLetter(status) {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

function safeError(error) {
  return String(error?.message || error || 'mutation scan failed').replace(/\/[^\s]+/g, '[path]');
}

function getGitOutput(root, args, maxBytes) {
  if (!hasUsableGit(root)) return '';
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: maxBytes + 1024 });
  if (result.status !== 0) return '';
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  return out.length > maxBytes ? `${out.slice(0, maxBytes)}\n[truncated]\n` : out;
}

function hasUsableGit(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return false;
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 });
  return result.status === 0 && String(result.stdout || '').trim() === 'true';
}

module.exports = {
  snapshotWorkspace,
  collectChangeArtifacts,
  summarizeWorkspaceChanges,
  renderWorkspaceChangeStat,
  renderWorkspaceChangePatch,
  hasUsableGit,
};
