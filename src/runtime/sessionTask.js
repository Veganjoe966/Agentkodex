'use strict';

const path = require('path');
const { discoverProject, selectCommands } = require('../discovery');
const { loadConfig, saveDiscovery, createRun, updateRunStatus, kodexPath, loadErrors } = require('../kodexStore');
const { readText, writeJson, writeText } = require('../utils');
const { createTaskBrief, createPlan, createMissionPrompt } = require('../prompts');
const { getAgent, detectAgent, buildAgentCommand } = require('../agents');

async function prepareAgentSessionTask(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim() || 'Interactive Agentkodex session';
  const config = loadConfig(root);
  const agentId = options.agent || config.defaultAgent || 'shell';
  const mode = options.mode || config.defaultMode || 'supervised';
  const gates = options.gates || config.requiredGates || ['lint', 'test', 'build'];

  const run = createRun(root, task);
  updateRunStatus(run.dir, {
    status: 'session_preparing',
    agent: agentId,
    mode,
    gates,
    runtime: 'cockpit',
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
  let detection = null;
  let command = null;

  if (options.command || options.shellCommand || options.customCommand) {
    command = options.command || options.shellCommand || options.customCommand;
    detection = { ...agent, installed: true, reason: 'explicit command provided', explicit: true };
  } else if (agentId === 'local') {
    command = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || 'sh');
    detection = { ...agent, installed: true, reason: 'local shell fallback for cockpit session' };
  } else {
    detection = await detectAgent(config, agentId, { customCommand: options.customCommand || '' });
    command = buildAgentCommand(detection, {
      promptFile,
      promptText: missionPrompt,
      cwd: root,
      runDir: run.dir,
      task,
      customCommand: options.customCommand || '',
    });
  }

  writeJson(path.join(run.dir, 'agent-detection.json'), detection || {});
  if (!command) throw new Error(`No command could be built for agent ${agentId}. Use --command, --shell-command, or configure: agentkodex agents set ${agentId} --cmd "..."`);
  if (detection && detection.ready === false) throw new Error(detection.readiness?.hint || detection.reason || `Agent not ready: ${agentId}`);

  updateRunStatus(run.dir, {
    status: 'session_ready',
    agent: agentId,
    mode,
    gates,
    command,
    runtime: 'cockpit',
  });

  return {
    root,
    run,
    config,
    discovery,
    selectedCommands,
    task,
    taskBrief,
    plan,
    promptFile,
    missionPrompt,
    agent,
    agentId,
    mode,
    gates,
    command,
  };
}

module.exports = {
  prepareAgentSessionTask,
};
