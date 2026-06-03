'use strict';

const path = require('path');
const { runTask } = require('../run');
const { ensureKodex, kodexPath, loadConfig } = require('../kodexStore');
const { copyDirFiltered, ensureDir, timestampId, slugify, writeJson, writeText } = require('../utils');
const { collectRunMetrics, selectWinner } = require('../core/scoring/metrics');
const { recordAgentRun } = require('../scorecards/store');
const { renderTournamentSummary } = require('./report');
const { issueTournamentCapability, verifyCapability } = require('../capabilities/phases');

async function runTournament(options) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim();
  const agents = options.agents || [];
  if (!task) throw new Error('Missing task. Example: agentkodex tournament --agents codex,claude-code --task "Fix failing tests"');
  if (!agents.length) throw new Error('Missing agents. Example: --agents codex,claude-code');

  ensureKodex(root);
  const parentConfig = loadConfig(root);
  const id = options.id || `${timestampId()}-${slugify(task, 40)}`;
  const tournamentDir = kodexPath(root, 'tournaments', id);
  ensureDir(path.join(tournamentDir, 'workspaces'));

  const results = [];
  for (const agent of agents) {
    const startedAt = new Date().toISOString();
    const workDir = path.join(tournamentDir, 'workspaces', agent);
    const capability = options.capabilities?.[agent] || issueTournamentCapability(root, { tournamentId: id, agentId: agent, cwd: workDir, runDir: tournamentDir });
    const decision = verifyCapability(root, capability, { sessionId: `tournament:${id}:1:${agent}`, agentId: agent, phase: 'tournament', action: 'contestant:run', path: workDir, runDir: tournamentDir });
    if (!decision.allowed) {
      const metrics = { agent, task, status: 'denied', completion: false, securityAllowed: false, securityDeniedCount: 1, failedCapabilityCount: 1, approvalRequiredCount: 0, unsafeActionAttemptCount: 1, qualityGateOk: null, qualityViolationCount: 0, completionBlocked: true };
      recordAgentRun(root, agent, task, metrics);
      results.push({ agent, runDir: null, status: 'denied', reason: decision.reason, capabilityId: capability?.capabilityId || null, metrics });
      continue;
    }
    copyDirFiltered(root, workDir, { ignore: ['.git', 'node_modules', '.agentkodex', 'dist', 'coverage', '.next', '.turbo', 'vendor'] });
    const run = await runTask({
      root: workDir,
      task,
      agent,
      config: cloneConfig(parentConfig),
      mode: options.mode || 'sandbox_auto',
      gates: options.gates || ['lint', 'test', 'build'],
      yes: true,
      timeoutMs: options.timeoutMs,
      echo: options.echo,
      pty: options.pty,
    });
    const endedAt = new Date().toISOString();
    const metrics = collectRunMetrics({ root: workDir, run, agent, task, startedAt, endedAt });
    recordAgentRun(root, agent, task, metrics);
    results.push({ agent, runDir: run.dir, status: run.status.status, capability, metrics });
  }

  const scored = selectWinner(results, options.winnerStrategy || 'balanced');
  const summary = { id, task, createdAt: new Date().toISOString(), winnerStrategy: options.winnerStrategy || 'balanced', winner: scored.winner, results: scored.results };
  writeArtifacts(tournamentDir, summary);
  if (options.echo !== false) {
    console.log(renderTournamentSummary(summary));
    console.log(`Tournament directory: ${tournamentDir}`);
  }
  return summary;
}

function writeArtifacts(tournamentDir, summary) {
  const manifest = {
    id: summary.id,
    task: summary.task,
    createdAt: summary.createdAt,
    winnerStrategy: summary.winnerStrategy,
    artifacts: ['manifest.json', 'results.json', 'scorecard.json', 'summary.md'],
  };
  writeJson(path.join(tournamentDir, 'manifest.json'), manifest);
  writeJson(path.join(tournamentDir, 'results.json'), summary.results);
  writeJson(path.join(tournamentDir, 'scorecard.json'), { winner: summary.winner, winnerStrategy: summary.winnerStrategy, results: summary.results.map(({ agent, score, metrics }) => ({ agent, score, metrics })) });
  writeText(path.join(tournamentDir, 'summary.md'), renderTournamentSummary(summary));
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

module.exports = {
  runTournament,
};
