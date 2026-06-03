'use strict';

const fs = require('fs');
const path = require('path');
const { runTask } = require('../run');
const { ensureKodex, kodexPath, loadConfig } = require('../kodexStore');
const { collectRunMetrics, scoreMetrics } = require('../core/scoring/metrics');
const { copyDirFiltered, ensureDir, readJson, timestampId, slugify, writeJson, writeText } = require('../utils');
const { writeAuditEvidence } = require('../audit/evidence');
const { readAskCache, writeAskCache } = require('./internalCache');
const { judgeWinner } = require('./judge');
const { recordAskReputation } = require('./reputation');
const { planAskStrategy } = require('./strategy');

async function runAsk(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('Missing prompt. Example: agentkodex ask "Explain this project"');
  ensureKodex(root);
  const mode = normalizeMode(options.mode || 'auto', prompt);
  const gates = mode === 'patch' ? (options.gates?.length ? options.gates : ['test']) : ['none'];
  const config = loadConfig(root);
  const strategy = await planAskStrategy(root, config, { ...options, prompt, mode });
  const agents = strategy.agents;
  const cacheInput = { prompt, mode, gates, agents };
  if (!options.applyWinner && mode !== 'patch') {
    const cached = readAskCache(root, cacheInput);
    if (cached.hit) return fromCache(cached.value, cached.cacheId);
  }
  if (!agents.length) return failedResult({ prompt, mode, reason: 'No ready coding agents found. Run: agentkodex setup' });

  const id = `${timestampId()}-${slugify(prompt, 48)}`;
  const askDir = kodexPath(root, 'asks', id);
  ensureDir(path.join(askDir, 'workspaces'));
  writeAuditEvidence(root, { type: 'ask_started', allowed: true, askId: id, mode, agents });
  const candidates = [];
  for (const agent of agents) candidates.push(await runCandidate({ root, askDir, id, prompt, mode, gates, agent, config, options }));
  const deterministicWinner = chooseWinner(candidates, mode);
  const judge = await judgeWinner({ root, askDir, id, prompt, candidates: eligibleCandidates(candidates, mode), config, judge: strategy.internalJudge, timeoutMs: options.timeoutMs });
  const winner = judge.winner || deterministicWinner;
  const result = buildResult({ id, askDir, prompt, mode, candidates, winner, judge, strategy, options });
  if (winner && mode === 'patch' && options.applyWinner) applyWinnerPatch(root, winner, result, Boolean(options.yes));
  recordAskReputation(root, prompt, candidates, result.ok ? result.winner : null);
  if (result.ok) result.cacheId = writeAskCache(root, cacheInput, result);
  writeJson(path.join(askDir, 'result.json'), result);
  writeText(path.join(askDir, 'summary.md'), renderAsk(result));
  writeAuditEvidence(root, { type: 'ask_completed', allowed: result.ok, askId: id, winner: result.winner, mode, cacheId: result.cacheId });
  return result;
}

async function runCandidate(input) {
  const workDir = path.join(input.askDir, 'workspaces', input.agent);
  copyDirFiltered(input.root, workDir, { ignore: ['.git', 'node_modules', '.agentkodex', 'dist', 'coverage', '.next', '.turbo', 'vendor'] });
  writeAuditEvidence(input.root, { type: 'isolated_workspace_created', allowed: true, agentId: input.agent, path: workDir });
  writeAuditEvidence(input.root, { type: 'isolated_workspace_config_inherited', allowed: true, agentId: input.agent, classes: ['adapter_templates', 'policy_config', 'quality_config'] });
  const startedAt = new Date().toISOString();
  const run = await runTask({
    root: workDir,
    task: askPrompt(input.prompt, input.mode),
    agent: input.agent,
    config: cloneConfig(input.config),
    mode: 'sandbox_auto',
    gates: input.gates,
    yes: true,
    echo: input.options.echo === true,
    timeoutMs: input.options.timeoutMs,
  });
  const endedAt = new Date().toISOString();
  const metrics = collectRunMetrics({ root: workDir, run, agent: input.agent, task: input.prompt, startedAt, endedAt });
  const response = responseFromRun(run);
  const score = Math.round((scoreMetrics(metrics, 'balanced') + answerScore(response)) * 100) / 100;
  return { agent: input.agent, status: run.status.status, runDir: run.dir, workDir, response, metrics, score };
}

function chooseWinner(candidates, mode) {
  const eligible = eligibleCandidates(candidates, mode)
    .sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent));
  return eligible[0] || null;
}

function eligibleCandidates(candidates, mode) {
  return candidates
    .filter((item) => item.metrics.completion && !item.metrics.completionBlocked && item.metrics.gateFailCount === 0)
    .filter((item) => mode === 'patch' || String(item.response || '').trim());
}

function buildResult(input) {
  const winner = input.winner;
  const ok = Boolean(winner);
  const result = {
    ok,
    winner: winner?.agent || null,
    mode: input.mode,
    response: winner?.response || '',
    scores: input.candidates.map((item) => ({ agent: item.agent, score: item.score, status: item.status, gates: item.metrics.gates, filesChanged: item.metrics.filesChanged, diffBytes: item.metrics.diffSizeBytes })),
    selection: {
      strategy: input.strategy?.execution || 'deterministic',
      confidence: input.strategy?.confidence ?? null,
      category: input.strategy?.category || null,
      reason: input.strategy?.reason || input.judge?.reason || 'Deterministic scoring selected the winner.',
      review: input.judge?.mode === 'agent' ? 'internal_agent' : 'deterministic',
    },
    artifactsPath: input.askDir,
    auditBundlePath: null,
    applied: false,
    servedFromCache: false,
    cacheId: null,
    blockedReason: ok ? null : 'All candidates failed or were blocked.',
  };
  if (input.options?.includeInternalDetails) result.judge = input.judge;
  return result;
}

function applyWinnerPatch(root, winner, result, yes) {
  if (!yes) {
    result.ok = false;
    result.blockedReason = 'Applying the winning patch requires --yes.';
    return;
  }
  const changes = readJson(path.join(winner.runDir, 'changes.json'), null);
  if (!changes || changes.mutationScanOk !== true) {
    result.ok = false;
    result.blockedReason = 'Mutation scan failed; refusing to apply winner.';
    return;
  }
  for (const entry of changes?.entries || []) {
    const target = path.join(root, entry.path);
    if (entry.status === 'deleted') {
      try { fs.rmSync(target, { force: true }); } catch (_) {}
      continue;
    }
    const source = path.join(winner.workDir, entry.path);
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
  }
  result.applied = true;
  writeAuditEvidence(root, { type: 'winning_patch_applied', allowed: true, agentId: winner.agent, changedPaths: (changes?.entries || []).map((item) => item.path) });
}

function responseFromRun(run) {
  const result = run.agentRun?.result || {};
  return String(result.stdoutTail || result.stdout || result.stderrTail || '').trim();
}

function askPrompt(prompt, mode) {
  if (mode === 'patch') return prompt;
  return `Answer this request clearly. Do not modify files unless explicitly asked.\n\n${prompt}`;
}

function normalizeMode(mode, prompt) {
  const value = String(mode || 'auto');
  if (value !== 'auto') return value;
  if (/\b(fix|change|edit|implement|create|write|patch)\b/i.test(prompt)) return 'patch';
  if (/\b(review|risk|security|audit|bugs?)\b/i.test(prompt)) return 'review';
  return 'answer';
}

function answerScore(response) {
  const length = String(response || '').trim().length;
  if (!length) return -20;
  return Math.min(12, length / 120);
}

function fromCache(value, cacheId) {
  const { judge, ...safeValue } = value || {};
  return { ...safeValue, servedFromCache: true, cacheId };
}

function failedResult(input) {
  return {
    ok: false,
    winner: null,
    mode: input.mode,
    response: '',
    scores: [],
    selection: { strategy: 'none', confidence: 0, category: null, reason: input.reason, review: 'none' },
    artifactsPath: null,
    auditBundlePath: null,
    applied: false,
    servedFromCache: false,
    cacheId: null,
    blockedReason: input.reason,
  };
}

function renderAsk(result) {
  const lines = [];
  if (!result.ok) {
    lines.push('Agentkodex could not complete the request.', '');
  } else if (result.scores.length > 1) {
    lines.push(`Agentkodex compared ${result.scores.length} agents.`, '', `Winner: ${result.winner}`, '');
  } else {
    lines.push(`Agentkodex used ${result.winner || 'one agent'}.`, '');
  }
  lines.push('Reason:');
  lines.push(humanAskReason(result));
  lines.push('');
  lines.push('Result:');
  lines.push(result.response || result.blockedReason || '(no response)');
  lines.push('');
  if (result.artifactsPath) lines.push(`Evidence: ${result.artifactsPath}`);
  return lines.join('\n');
}

function humanAskReason(result) {
  if (!result.ok) return result.blockedReason || 'No ready agent produced a usable result.';
  if (result.servedFromCache) return 'Same request and project state were already answered safely.';
  if (result.scores.length > 1) return 'Produced the strongest solution.';
  return 'Best match for this task.';
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

module.exports = {
  runAsk,
  renderAsk,
};
