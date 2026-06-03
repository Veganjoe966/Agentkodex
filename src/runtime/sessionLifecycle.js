'use strict';

const fs = require('fs');
const path = require('path');
const { discoverProject, selectCommands } = require('../discovery');
const { loadConfig, saveDiscovery, createRun, updateRunStatus, kodexPath, loadErrors } = require('../kodexStore');
const { readText, writeJson, writeText } = require('../utils');
const { createTaskBrief, createPlan, createMissionPrompt } = require('../prompts');
const { resolveSessionAdapter } = require('./adapters');
const { createSession, saveSession, appendEvent, writePrompt, loadSession, appendInbox, listSessions, sessionSummary } = require('./sessionStore');
const { startWorkerProcess } = require('./worker');

async function startSession(options) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim();
  if (!task) throw new Error('Missing task. Example: agentkodex session start "Build the auth flow"');

  const config = loadConfig(root);
  const agent = options.agent || config.defaultAgent || 'local';
  const mode = options.mode || config.defaultMode || 'supervised';
  const gates = options.gates || config.requiredGates || ['lint', 'test', 'build'];

  const run = createRun(root, task);
  updateRunStatus(run.dir, { status: 'session_preparing', agent, mode, gates });

  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  writeJson(path.join(run.dir, 'discovery.json'), discovery);

  const selectedCommands = gates.includes('none') ? [] : selectCommands(discovery, gates);
  const taskBrief = createTaskBrief(task, discovery, { gates, agent, mode });
  const plan = createPlan(task, discovery, selectedCommands, { agent, mode });
  const projectKodex = readText(kodexPath(root, 'project.kodex.md'));
  const errorsKodex = JSON.stringify(loadErrors(root), null, 2);
  const missionPrompt = createMissionPrompt({ task, discovery, projectKodex, plan, taskBrief, errorsKodex });

  writeText(path.join(run.dir, 'task-brief.yaml'), taskBrief);
  writeText(path.join(run.dir, 'plan.md'), plan);
  writeText(path.join(run.dir, 'mission.prompt.md'), missionPrompt);

  const session = createSession(root, {
    task,
    agent,
    mode,
    runtime: options.runtime || 'interactive',
    usePty: Boolean(options.pty || options.usePty),
    runId: run.id,
    runDir: run.dir,
    promptFile: path.join(run.dir, 'mission.prompt.md'),
  });

  let prepared = saveSession(session, { status: 'preparing', state: 'starting' });
  const adapter = await resolveSessionAdapter(config, {
    root,
    task,
    agent,
    promptFile: prepared.promptFile,
    promptText: missionPrompt,
    runDir: run.dir,
    sessionDir: prepared.sessionDir,
    explicitCommand: options.command || '',
  });
  writeJson(path.join(prepared.sessionDir, 'adapter.json'), adapter);
  writeJson(path.join(run.dir, 'session-adapter.json'), adapter);

  if (!adapter.installed || !adapter.command) {
    prepared = saveSession(prepared, {
      status: 'failed',
      state: 'failed',
      command: adapter.command || '',
      lastStateReason: adapter.detection?.reason || 'Adapter not installed or no command configured.',
      completedAt: new Date().toISOString(),
    });
    updateRunStatus(run.dir, { status: 'session_failed', sessionId: prepared.id, error: prepared.lastStateReason });
    appendEvent(prepared, { type: 'session.failed', reason: prepared.lastStateReason, adapter });
    return { session: prepared, run, adapter, started: false };
  }

  prepared = saveSession(prepared, {
    status: 'queued',
    state: 'starting',
    command: adapter.command,
    adapterKind: adapter.kind,
    lastStateReason: 'worker queued',
  });
  appendEvent(prepared, { type: 'adapter.resolved', adapter: { id: adapter.id, kind: adapter.kind, command: adapter.command } });

  const workerPid = startWorkerProcess(root, prepared.id);
  prepared = saveSession(prepared, { status: 'starting', workerPid, lastStateReason: 'worker process started' });
  updateRunStatus(run.dir, { status: 'session_running', sessionId: prepared.id, workerPid });
  appendEvent(prepared, { type: 'worker.spawned', workerPid });

  return { session: prepared, run, adapter, started: true };
}

function sendToSession(root, idOrLast, text, options = {}) {
  const session = loadSession(root, idOrLast || 'last');
  if (!session) throw new Error('Session not found.');
  const type = options.keystrokes ? 'keystrokes' : 'send';
  const item = appendInbox(session, type, { text });
  appendEvent(session, { type: 'input.queued', inboxSeq: item.seq, inputType: type, bytes: Buffer.byteLength(String(text || '')) });
  return { session, item };
}

function interruptSession(root, idOrLast) {
  const session = loadSession(root, idOrLast || 'last');
  if (!session) throw new Error('Session not found.');
  const item = appendInbox(session, 'interrupt', {});
  appendEvent(session, { type: 'interrupt.queued', inboxSeq: item.seq });
  return { session, item };
}

function killSession(root, idOrLast, signal = 'SIGTERM') {
  const session = loadSession(root, idOrLast || 'last');
  if (!session) throw new Error('Session not found.');
  const item = appendInbox(session, 'kill', { signal });
  appendEvent(session, { type: 'kill.queued', inboxSeq: item.seq, signal });
  return { session, item };
}

function renderSessionList(root) {
  const sessions = listSessions(root).map(sessionSummary);
  if (!sessions.length) return 'No Agentkodex sessions found.';
  const lines = [];
  lines.push('Agentkodex sessions:');
  for (const s of sessions) {
    lines.push(`- ${s.id}`);
    lines.push(`  status: ${s.status}`);
    lines.push(`  state: ${s.state}`);
    lines.push(`  agent: ${s.agent}`);
    lines.push(`  task: ${s.task}`);
    lines.push(`  dir: ${s.sessionDir}`);
  }
  return lines.join('\n');
}

async function waitForSession(root, idOrLast, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 60000);
  const pollMs = Number(options.pollMs || 200);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = loadSession(root, idOrLast || 'last');
    if (!session) return null;
    if (['completed', 'failed', 'killed'].includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return loadSession(root, idOrLast || 'last');
}

module.exports = {
  startSession,
  sendToSession,
  interruptSession,
  killSession,
  renderSessionList,
  waitForSession,
};
