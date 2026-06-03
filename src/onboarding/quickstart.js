'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { discoverProject, selectCommands } = require('../discovery');
const { ensureKodex, saveDiscovery, loadConfig, kodexPath } = require('../kodexStore');
const { detectAgent } = require('../agents');
const { rebuildIntelligence } = require('../intelligence/store');
const { routeTask } = require('../router/route');
const { writeText } = require('../utils');
const { GOALS, ONBOARDING_STEPS, renderTryCommand, withOnboardingProgress } = require('./flow');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function quickstartCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', 'Verify this project');
  const json = booleanFlag(flags, 'json');
  const result = await withOnboardingProgress(ONBOARDING_STEPS, () => buildQuickstart(root, task), {
    json,
    skip: booleanFlag(flags, 'noAnimation') || booleanFlag(flags, 'no-animation'),
  });
  if (json) console.log(JSON.stringify(result, null, 2));
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
    nextSteps: nextSteps(),
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

function nextSteps() {
  return [
    'agentkodex ask "Explain this project"',
    'agentkodex ask "Find bugs"',
    'agentkodex ask "Review architecture"',
    'agentkodex ask "Fix failing tests"',
    'agentkodex chat',
  ];
}

function renderQuickstart(result) {
  const lines = ['Welcome to Agentkodex.', ''];
  lines.push(`I found ${article(projectKind(result))} ${projectKind(result)} project.`);
  lines.push('', 'Ready agents:');
  const ready = result.agents.filter((agent) => agent.ready);
  if (ready.length) for (const agent of ready) lines.push(`✓ ${agent.id}`);
  else lines.push('○ No ready coding agents yet');
  lines.push('', 'Agentkodex can help you:');
  GOALS.forEach((goal, index) => lines.push(`${index + 1}. ${goal}`));
  lines.push('', 'Try:', renderTryCommand(), '', 'Or start a conversation:', 'agentkodex chat');
  lines.push('', 'Advanced Information', '');
  lines.push(`Project: ${result.projectName}`);
  lines.push(`Root: ${result.root}`);
  lines.push(`Languages: ${result.languages.join(', ') || 'unknown'}`);
  lines.push(`Frameworks: ${result.frameworks.join(', ') || 'unknown'}`);
  lines.push(`Package manager: ${result.packageManager}`);
  lines.push('');
  lines.push('Discovered commands:');
  if (!result.commands.length) lines.push('- No project commands discovered yet.');
  for (const cmd of result.commands) lines.push(`- ${cmd.name}: \`${cmd.command}\` (${cmd.confidence}; ${cmd.evidence})`);
  lines.push('');
  lines.push('Suggested validation:');
  for (const gate of result.gates) {
    if (gate.skipped) lines.push(`- ${gate.gate}: skipped (${gate.reason})`);
    else lines.push(`- ${gate.gate}: \`${gate.command}\``);
  }
  lines.push('');
  lines.push('Agent readiness details:');
  for (const agent of result.agents) lines.push(`- ${agent.id}: ${agent.ready ? 'ready' : agent.installed ? agent.readinessState || 'degraded' : 'missing'}${agent.binary ? ` (${agent.binary})` : ''} - ${agent.reason || ''}`);
  lines.push('');
  lines.push('Routing details:');
  if (result.route.selected) {
    lines.push(`Recommended agent: ${result.route.selected}`);
    lines.push(`Reason: ${result.route.reason}`);
  } else {
    lines.push('Recommended agent: insufficient history');
    lines.push('Run tasks or tournaments first to build scorecards.');
  }
  lines.push('');
  lines.push('Useful commands:');
  for (const step of result.nextSteps) lines.push(`- \`${step}\``);
  lines.push('- `agentkodex doctor`');
  lines.push('- `agentkodex help all`');
  lines.push('');
  lines.push(`Saved: ${result.quickstartPath}`);
  lines.push('');
  return lines.join('\n');
}

function projectKind(result) {
  const languages = new Set((result.languages || []).map((item) => String(item).toLowerCase()));
  const frameworks = new Set((result.frameworks || []).map((item) => String(item).toLowerCase()));
  if (languages.has('javascript') || languages.has('typescript') || result.packageManager !== 'unknown') return 'JavaScript';
  if (languages.has('python')) return 'Python';
  if (frameworks.size) return [...frameworks][0];
  return 'software';
}

function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

module.exports = {
  quickstartCommand,
  buildQuickstart,
  renderQuickstart,
};
