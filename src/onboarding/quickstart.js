'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { discoverProject, selectCommands } = require('../discovery');
const { ensureKodex, saveDiscovery, loadConfig, kodexPath } = require('../kodexStore');
const { detectAgent } = require('../agents');
const { rebuildIntelligence } = require('../intelligence/store');
const { routeTask } = require('../router/route');
const { writeText } = require('../utils');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function quickstartCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', 'Verify this project');
  const result = await buildQuickstart(root, task);
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result, null, 2));
  else console.log(renderQuickstart(result));
}

async function buildQuickstart(root, task) {
  const base = ensureKodex(root);
  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  const intelligence = rebuildIntelligence(root);
  const config = loadConfig(root);
  const agents = await detectConfiguredAgents(config);
  const gates = selectCommands(discovery, ['lint', 'test', 'build', 'e2e']);
  const route = routeTask(root, task);
  const result = {
    root,
    kodex: base,
    task,
    projectName: discovery.projectName,
    languages: discovery.languages,
    frameworks: discovery.frameworks,
    packageManager: discovery.packageManager || 'unknown',
    commands: discovery.commands,
    gates,
    agents,
    route,
    intelligenceDir: kodexPath(root, 'intelligence'),
    quickstartPath: kodexPath(root, 'QUICKSTART.md'),
    nextSteps: nextSteps(gates, route, agents),
    intelligenceReady: Boolean(intelligence.project),
  };
  writeText(result.quickstartPath, renderQuickstart(result));
  return result;
}

async function detectConfiguredAgents(config) {
  const ids = Object.keys(config.agents || {});
  const rows = [];
  for (const id of ids) {
    const detection = await detectAgent(config, id);
    rows.push({ id, installed: detection.installed, ready: detection.ready, readinessState: detection.readinessState, reason: detection.readiness?.hint || detection.reason, binary: detection.binary || null });
  }
  return rows;
}

function nextSteps(gates, route, agents = []) {
  const runnable = gates.filter((gate) => !gate.skipped).map((gate) => gate.gate);
  const gateList = runnable.length ? runnable.join(',') : 'test';
  const agent = sessionAgent(route, agents);
  return [
    `agentkodex gates run --gates ${gateList}`,
    `agentkodex session start --agent ${agent} "Describe the task here"`,
    'agentkodex cockpit',
    'agentkodex audit-bundle last',
  ];
}

function sessionAgent(route, agents) {
  const ready = new Set(agents.filter((agent) => agent.ready).map((agent) => agent.id));
  if (route.selected && route.selected !== 'local' && ready.has(route.selected)) return route.selected;
  const preferred = ['codex', 'claude-code', 'aider', 'gemini', 'opencode', 'cursor', 'custom'];
  return preferred.find((id) => ready.has(id)) || 'shell';
}

function renderQuickstart(result) {
  const lines = ['# Agentkodex Quickstart', ''];
  lines.push(`Project: ${result.projectName}`);
  lines.push(`Root: ${result.root}`);
  lines.push(`Languages: ${result.languages.join(', ') || 'unknown'}`);
  lines.push(`Frameworks: ${result.frameworks.join(', ') || 'unknown'}`);
  lines.push(`Package manager: ${result.packageManager}`);
  lines.push('');
  lines.push('## What Agentkodex Found');
  if (!result.commands.length) lines.push('- No project commands discovered yet.');
  for (const cmd of result.commands) lines.push(`- ${cmd.name}: \`${cmd.command}\` (${cmd.confidence}; ${cmd.evidence})`);
  lines.push('');
  lines.push('## Suggested Gates');
  for (const gate of result.gates) {
    if (gate.skipped) lines.push(`- ${gate.gate}: skipped (${gate.reason})`);
    else lines.push(`- ${gate.gate}: \`${gate.command}\``);
  }
  lines.push('');
  lines.push('## Agent Availability');
  for (const agent of result.agents) lines.push(`- ${agent.id}: ${agent.ready ? 'ready' : agent.installed ? agent.readinessState || 'degraded' : 'missing'}${agent.binary ? ` (${agent.binary})` : ''} - ${agent.reason || ''}`);
  lines.push('');
  lines.push('## Router');
  if (result.route.selected) {
    lines.push(`Recommended agent: ${result.route.selected}`);
    lines.push(`Reason: ${result.route.reason}`);
  } else {
    lines.push('Recommended agent: insufficient history');
    lines.push('Run tasks or tournaments first to build scorecards.');
  }
  lines.push('');
  lines.push('## Next Commands');
  for (const step of result.nextSteps) lines.push(`- \`${step}\``);
  lines.push('');
  lines.push(`Saved: ${result.quickstartPath}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  quickstartCommand,
  buildQuickstart,
  renderQuickstart,
};
