'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, readText, writeText } = require('./utils');
const { getLastRun } = require('./kodexStore');

function renderRunHtml(root, runIdOrLast = 'last') {
  const run = resolveRun(root, runIdOrLast);
  if (!run) throw new Error('No Agentkodex run found.');
  const status = readJson(path.join(run.dir, 'status.json'), {});
  const finalReport = readText(path.join(run.dir, 'final-report.md'), '');
  const qa = readText(path.join(run.dir, 'qa-report.md'), '');
  const security = readText(path.join(run.dir, 'security-report.md'), '');
  const transcript = readText(path.join(run.dir, 'transcript.log'), '');
  const diffStat = readText(path.join(run.dir, 'diff.stat'), '');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agentkodex Run ${escapeHtml(run.id)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; line-height: 1.45; color: #111; }
    h1, h2 { letter-spacing: -0.02em; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; margin: 16px 0; }
    pre { background: #111; color: #f8f8f8; padding: 16px; border-radius: 12px; overflow: auto; max-height: 520px; }
    code { background: #f3f3f3; padding: 2px 4px; border-radius: 4px; }
    .status { font-weight: 700; }
  </style>
</head>
<body>
  <h1>Agentkodex Run</h1>
  <div class="card">
    <div><strong>ID:</strong> ${escapeHtml(run.id)}</div>
    <div><strong>Status:</strong> <span class="status">${escapeHtml(status.status || 'unknown')}</span></div>
    <div><strong>Task:</strong> ${escapeHtml(status.task || '')}</div>
    <div><strong>Agent:</strong> ${escapeHtml(status.agent || '')}</div>
    <div><strong>Mode:</strong> ${escapeHtml(status.mode || '')}</div>
  </div>
  <h2>Final report</h2>
  <pre>${escapeHtml(finalReport)}</pre>
  <h2>QA</h2>
  <pre>${escapeHtml(qa)}</pre>
  <h2>Security</h2>
  <pre>${escapeHtml(security)}</pre>
  <h2>Diff stat</h2>
  <pre>${escapeHtml(diffStat)}</pre>
  <h2>Transcript</h2>
  <pre>${escapeHtml(transcript)}</pre>
</body>
</html>
`;
  const out = path.join(run.dir, 'report.html');
  writeText(out, html);
  return out;
}

function resolveRun(root, runIdOrLast) {
  if (!runIdOrLast || runIdOrLast === 'last') return getLastRun(root);
  const dir = path.join(root, '.agentkodex', 'runs', runIdOrLast);
  if (fs.existsSync(dir)) return { id: runIdOrLast, dir };
  return null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  renderRunHtml,
  resolveRun,
};
