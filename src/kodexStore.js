'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, exists, readJson, readText, writeJson, writeText, timestampId, slugify } = require('./utils');

const KODEX_DIR = '.agentkodex';

function kodexPath(root, ...parts) {
  return path.join(root, KODEX_DIR, ...parts);
}

function ensureKodex(root) {
  const base = kodexPath(root);
  ensureDir(base);
  ensureDir(path.join(base, 'runs'));
  ensureDir(path.join(base, 'prompts'));
  ensureDir(path.join(base, 'tournaments'));
  ensureDir(path.join(base, 'sessions'));
  ensureDir(path.join(base, 'skills'));
  ensureDir(path.join(base, 'approvals'));
  ensureDir(path.join(base, 'audit'));
  ensureDir(path.join(base, 'agents'));
  ensureDir(path.join(base, 'intelligence'));
  ensureDir(path.join(base, 'swarms'));

  const configPath = path.join(base, 'config.json');
  if (!exists(configPath)) writeJson(configPath, defaultConfig());

  const errorsPath = path.join(base, 'errors.kodex.json');
  if (!exists(errorsPath)) writeJson(errorsPath, { knownErrors: [] });

  const ignorePath = path.join(base, '.gitignore');
  if (!exists(ignorePath)) writeText(ignorePath, ['runs/', 'tournaments/', 'sessions/', 'approvals/', 'audit/', 'swarms/', '*.log', 'transcript.cast', 'tmp/'].join('\n') + '\n');

  return base;
}

function defaultConfig() {
  return {
    version: 2,
    defaultAgent: 'local',
    defaultMode: 'supervised',
    requiredGates: ['lint', 'test', 'build'],
    commandTimeoutMs: 1800000,
    sessionStuckAfterMs: 600000,
    runtime: {
      preferred: 'oneshot',
      pty: true,
      stuckAfterMs: 600000,
      sessionDaemon: false,
    },
    policy: {
      approvalQueue: true,
      redactSecrets: true,
      blockDestructiveCommands: true,
    },
    agents: {
      local: {
        kind: 'builtin',
        description: 'Built-in non-AI executor. It creates plans, runs gates, and can execute an explicit --command.',
        commandTemplate: null,
        stdin: false,
        strengths: ['planning', 'quality-gates', 'reports'],
      },
      shell: {
        kind: 'interactive-shell',
        description: 'Plain persistent shell session for validating Runtime v2 without a paid agent CLI.',
        commandTemplate: null,
        stdin: false,
        strengths: ['manual-control', 'runtime-validation'],
      },
      codex: {
        kind: 'interactive-cli',
        description: 'External Codex CLI. Configure commandTemplate if your installed version needs specific flags.',
        commandTemplate: 'codex',
        stdin: true,
        strengths: ['implementation', 'tests', 'new-features'],
      },
      'claude-code': {
        kind: 'interactive-cli',
        description: 'External Claude Code CLI. Configure commandTemplate if your installed version needs specific flags.',
        commandTemplate: 'claude',
        stdin: true,
        strengths: ['repo-understanding', 'debugging', 'refactors'],
      },
      aider: {
        kind: 'terminal-pair-programmer',
        description: 'External Aider CLI. The prompt file is passed with --message-file by default.',
        commandTemplate: 'aider --message-file {promptFile}',
        stdin: false,
        strengths: ['small-patches', 'git-centric-edits'],
      },
      gemini: {
        kind: 'interactive-cli',
        description: 'External Gemini CLI. Configure commandTemplate if your installed version needs specific flags.',
        commandTemplate: 'gemini',
        stdin: true,
        strengths: ['research', 'implementation'],
      },
      opencode: {
        kind: 'interactive-cli',
        description: 'External OpenCode CLI. Configure commandTemplate if your installed version needs specific flags.',
        commandTemplate: 'opencode',
        stdin: true,
        strengths: ['open-source-agent-workflows'],
      },
      cursor: {
        kind: 'interactive-cli',
        description: 'External Cursor CLI. Configure commandTemplate if your installed version needs specific flags.',
        commandTemplate: 'cursor-agent',
        stdin: true,
        strengths: ['cursor-agent-workflows'],
      },
      copilot: {
        kind: 'interactive-cli',
        description: 'External GitHub Copilot CLI through gh. Requires GitHub CLI, Copilot extension, and auth.',
        commandTemplate: 'gh copilot suggest {prompt}',
        stdin: false,
        binaries: ['gh'],
        strengths: ['github-copilot-cli', 'quick-suggestions'],
      },
      custom: {
        kind: 'custom',
        description: 'Custom command template. Set with: agentkodex agents set custom --cmd "your-cli {promptFile}"',
        commandTemplate: null,
        stdin: false,
        strengths: ['bring-your-own-agent'],
      }
    }
  };
}
function loadConfig(root) {
  ensureKodex(root);
  const config = readJson(kodexPath(root, 'config.json'), defaultConfig());
  return mergeDefaults(config, defaultConfig());
}

function saveConfig(root, config) {
  ensureKodex(root);
  writeJson(kodexPath(root, 'config.json'), config);
}

function mergeDefaults(value, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults;
  if (!defaults || typeof defaults !== 'object') return value === undefined ? defaults : value;
  const out = { ...defaults, ...(value || {}) };
  for (const key of Object.keys(defaults)) {
    if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      out[key] = mergeDefaults(out[key], defaults[key]);
    }
  }
  return out;
}

function saveDiscovery(root, discovery) {
  ensureKodex(root);
  writeJson(kodexPath(root, 'commands.kodex.json'), discovery);
  writeText(kodexPath(root, 'project.kodex.md'), renderProjectKodex(discovery));
}

function loadDiscovery(root) {
  return readJson(kodexPath(root, 'commands.kodex.json'), null);
}

function renderProjectKodex(discovery) {
  const lines = [];
  lines.push(`# Agentkodex Project Kodex: ${discovery.projectName}`);
  lines.push('');
  lines.push(`Generated: ${discovery.generatedAt}`);
  lines.push('');
  lines.push('## Project');
  lines.push(`- Root: ${discovery.root}`);
  lines.push(`- Languages: ${(discovery.languages || []).join(', ') || 'unknown'}`);
  lines.push(`- Frameworks: ${(discovery.frameworks || []).join(', ') || 'unknown'}`);
  lines.push(`- Package manager: ${discovery.packageManager || 'unknown'}`);
  lines.push('');
  lines.push('## Commands');
  if (!discovery.commands.length) lines.push('- No commands discovered yet.');
  for (const command of discovery.commands) {
    lines.push(`- **${command.name}**: \`${command.command}\``);
    lines.push(`  - category: ${command.category}`);
    lines.push(`  - confidence: ${command.confidence}`);
    lines.push(`  - evidence: ${command.evidence}`);
  }
  lines.push('');
  lines.push('## Environment variables');
  if (!discovery.env.length) lines.push('- No env example files discovered.');
  for (const env of discovery.env) lines.push(`- ${env.file}: ${(env.variables || []).join(', ') || '(none parsed)'}`);
  lines.push('');
  lines.push('## Services');
  lines.push((discovery.services || []).length ? discovery.services.map((s) => `- ${s}`).join('\n') : '- No services discovered.');
  lines.push('');
  lines.push('## Notes');
  lines.push((discovery.notes || []).length ? discovery.notes.map((s) => `- ${s}`).join('\n') : '- No notes.');
  lines.push('');
  return lines.join('\n');
}

function createRun(root, task) {
  ensureKodex(root);
  const id = `${timestampId()}-${slugify(task, 42)}`;
  const dir = kodexPath(root, 'runs', id);
  ensureDir(dir);
  const status = {
    id,
    root,
    task,
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: {},
  };
  writeJson(path.join(dir, 'status.json'), status);
  writeText(kodexPath(root, 'last-run'), id);
  return { id, dir, status };
}

function updateRunStatus(runDir, patch) {
  const statusPath = path.join(runDir, 'status.json');
  const existing = readJson(statusPath, {});
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeJson(statusPath, next);
  return next;
}

function getLastRun(root) {
  const last = readText(kodexPath(root, 'last-run'), '').trim();
  if (last && exists(kodexPath(root, 'runs', last))) return { id: last, dir: kodexPath(root, 'runs', last) };
  const runsDir = kodexPath(root, 'runs');
  if (!exists(runsDir)) return null;
  const runs = fs.readdirSync(runsDir).filter((name) => exists(path.join(runsDir, name, 'status.json'))).sort();
  if (!runs.length) return null;
  const id = runs[runs.length - 1];
  return { id, dir: path.join(runsDir, id) };
}

function loadErrors(root) {
  ensureKodex(root);
  return readJson(kodexPath(root, 'errors.kodex.json'), { knownErrors: [] });
}

function saveErrors(root, errors) {
  ensureKodex(root);
  writeJson(kodexPath(root, 'errors.kodex.json'), errors);
}

function learnFromGateFailures(root, gateResults) {
  const errors = loadErrors(root);
  const additions = [];
  for (const gate of gateResults || []) {
    if (!gate.result || gate.result.exitCode === 0 || gate.result.skipped) continue;
    const signature = extractErrorSignature(`${gate.result.stderrTail || ''}\n${gate.result.stdoutTail || ''}`);
    if (!signature) continue;
    const existing = errors.knownErrors.find((item) => item.signature === signature && item.command === gate.command);
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      existing.count = (existing.count || 1) + 1;
    } else {
      const entry = {
        signature,
        command: gate.command,
        gate: gate.gate,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        count: 1,
        suggestedFix: 'Review the failing output and rerun the smallest relevant validation command after fixing.',
      };
      errors.knownErrors.push(entry);
      additions.push(entry);
    }
  }
  saveErrors(root, errors);
  return additions;
}

function extractErrorSignature(output) {
  const lines = String(output || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const priority = lines.find((line) => /error|failed|exception|cannot|not found|missing/i.test(line));
  const chosen = priority || lines[0];
  return chosen ? chosen.slice(0, 240) : '';
}

module.exports = {
  KODEX_DIR,
  kodexPath,
  ensureKodex,
  defaultConfig,
  loadConfig,
  saveConfig,
  saveDiscovery,
  loadDiscovery,
  createRun,
  updateRunStatus,
  getLastRun,
  renderProjectKodex,
  loadErrors,
  saveErrors,
  learnFromGateFailures,
};
