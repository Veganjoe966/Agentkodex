'use strict';

const path = require('path');
const { discoverProject, selectCommands } = require('../discovery');
const { loadConfig, saveDiscovery, createRun, updateRunStatus, kodexPath, loadErrors } = require('../kodexStore');
const { readText, writeJson, writeText } = require('../utils');
const { createTaskBrief, createPlan, createMissionPrompt } = require('../prompts');
const { getAgent, detectAgent, buildAgentCommand } = require('../agents');
const { classifyCommand } = require('../policy');
const { ensureDaemon, request } = require('./daemon');

async function buildRuntimeSessionStart(options) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim();
  if (!task) throw new Error('Missing task. Example: agentkodex session start "Fix failing tests"');

  const config = loadConfig(root);
  const agentId = options.agent || config.defaultAgent || 'local';
  const mode = options.mode || config.defaultMode || 'supervised';
  const gates = options.gates || config.requiredGates || ['lint', 'test', 'build'];
  const run = createRun(root, task);

  updateRunStatus(run.dir, {
    status: 'runtime_session_preparing',
    runtime: 'cockpit',
    agent: agentId,
    mode,
    gates,
  });

  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  writeJson(path.join(run.dir, 'discovery.json'), discovery);
  const selectedCommands = gates.includes('none') ? [] : selectCommands(discovery, gates);
  const taskBrief = createTaskBrief(task, discovery, { gates, agent: agentId, mode });
  const plan = createPlan(task, discovery, selectedCommands, { agent: agentId, mode });
  const projectKodex = readText(kodexPath(root, 'project.kodex.md'));
  const errorsKodex = JSON.stringify(loadErrors(root), null, 2);
  const missionPrompt = createMissionPrompt({ task, discovery, projectKodex, plan, taskBrief, errorsKodex });
  const promptFile = path.join(run.dir, 'mission.prompt.md');

  writeText(path.join(run.dir, 'task-brief.yaml'), taskBrief);
  writeText(path.join(run.dir, 'plan.md'), plan);
  writeText(promptFile, missionPrompt);

  const agent = getAgent(config, agentId);
  let command = options.command || '';
  let stdin = null;
  let adapterKind = 'template';

  if (!command) {
    if (agent.id === 'local') {
      command = process.platform === 'win32' ? 'cmd /c more' : 'sh';
      stdin = `cat ${JSON.stringify(promptFile)}\n`;
      adapterKind = 'local-shell';
    } else {
      const detection = await detectAgent(config, agentId);
      writeJson(path.join(run.dir, 'agent-detection.json'), detection);
      if (!detection.ready) throw new Error(detection.readiness?.hint || detection.reason || `Agent ${agentId} is not ready.`);
      command = buildAgentCommand(detection, { promptFile, promptText: missionPrompt, cwd: root, runDir: run.dir, task });
      stdin = detection.stdin ? missionPrompt : null;
      adapterKind = detection.kind || 'template';
    }
  } else {
    adapterKind = 'explicit-command';
    stdin = options.stdin ? missionPrompt : null;
  }

  if (!command) throw new Error('No command could be built for this runtime session.');
  const classification = classifyCommand(command);
  if (classification.risk === 'blocked') throw new Error(`Blocked launcher command: ${classification.reason}`);

  updateRunStatus(run.dir, {
    status: 'runtime_session_starting',
    command,
    commandClassification: classification,
  });

  return {
    root,
    task,
    run,
    command,
    mode,
    agentId,
    promptFile,
    missionPrompt,
    stdin,
    adapterKind,
    selectedCommands,
    discovery,
  };
}

async function startRuntimeSession(options) {
  const prepared = await buildRuntimeSessionStart(options);
  await ensureDaemon(prepared.root);
  const response = await request(prepared.root, {
    type: 'start',
    agent: prepared.agentId,
    adapterKind: prepared.adapterKind,
    command: prepared.command,
    cwd: prepared.root,
    mode: prepared.mode,
    runId: prepared.run.id,
    runDir: prepared.run.dir,
    promptFile: prepared.promptFile,
    initialInput: prepared.stdin,
    initialInputDelayMs: Number(options.initialInputDelayMs || 500),
    metadata: {
      task: prepared.task,
      gates: prepared.selectedCommands.map((g) => ({ gate: g.gate, command: g.command, skipped: g.skipped })),
    },
  });
  const session = response.session;
  updateRunStatus(prepared.run.dir, {
    status: 'runtime_session_running',
    sessionId: session.id,
    sessionDir: path.join(prepared.root, '.agentkodex', 'sessions', session.id),
  });
  return { ...prepared, session };
}

module.exports = {
  buildRuntimeSessionStart,
  startRuntimeSession,
};
