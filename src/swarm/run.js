'use strict';

const path = require('path');
const { startAgentSession, waitForSession } = require('../runtime/sessionManager');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { ensureDir, timestampId, slugify, writeJson, writeText } = require('../utils');
const { renderSwarmSummary } = require('./summary');

const PHASES = ['research', 'planner', 'builder', 'reviewer', 'qa', 'security', 'release'];

async function runSwarm(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim();
  if (!task) throw new Error('Missing task. Example: agentkodex swarm --builder codex "Build feature"');
  ensureKodex(root);
  const id = `${timestampId()}-${slugify(task, 40)}`;
  const dir = kodexPath(root, 'swarms', id);
  ensureDir(dir);

  const phases = selectedPhases(options);
  const results = [];
  for (const phase of phases) {
    const agent = options.roles[phase];
    const command = options.commands[phase] || options.command || '';
    if (requiresCommand(agent) && !command) {
      results.push({ phase, agent, status: 'skipped', reason: `${agent} swarm phase requires --${phase}-command or --command` });
      continue;
    }
    const session = await startAgentSession({
      root,
      task: phaseTask(phase, task, results),
      agent,
      command,
      mode: options.mode || 'supervised',
      gates: phase === 'qa' ? options.gates : ['none'],
      yes: Boolean(options.yes),
      noInitialPrompt: false,
      closeStdinAfterInitial: Boolean(options.closeStdin),
      pty: Boolean(options.pty),
    });
    const final = options.wait ? await waitForSession(root, session.id, Number(options.timeoutMs || 300000)).catch(() => null) : null;
    results.push({ phase, agent, status: final?.session?.status || session.status, sessionId: session.id, runId: session.runId, runDir: session.runDir });
  }

  const manifest = { id, task, createdAt: new Date().toISOString(), phases: results };
  writeJson(path.join(dir, 'manifest.json'), manifest);
  writeText(path.join(dir, 'summary.md'), renderSwarmSummary(manifest));
  return { dir, manifest };
}

function selectedPhases(options) {
  const selected = PHASES.filter((phase) => options.roles[phase]);
  return selected.length ? selected : ['builder'];
}

function requiresCommand(agent) {
  return ['shell', 'local'].includes(agent);
}

function phaseTask(phase, task, previous) {
  const context = previous.map((item) => `${item.phase}:${item.status}${item.sessionId ? `:${item.sessionId}` : ''}`).join(', ') || 'none';
  return `Swarm ${phase} phase.\nTask: ${task}\nPrevious phases: ${context}`;
}

module.exports = {
  PHASES,
  runSwarm,
};
