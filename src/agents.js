'use strict';

const { spawn } = require('child_process');
const { shellQuote } = require('./utils');
const { commandExists, firstCommandToken } = require('./sessionRunner');

const TRUSTED_AGENT_BINARIES = {
  codex: ['codex'],
  'claude-code': ['claude'],
  aider: ['aider'],
  gemini: ['gemini'],
  opencode: ['opencode'],
  cursor: ['cursor-agent'],
  copilot: ['gh'],
};

function listAgents(config) {
  return Object.entries(config.agents || {}).map(([id, agent]) => ({
    id,
    kind: agent.kind || 'template',
    description: agent.description || '',
    commandTemplate: defaultTemplateForAgent(id, agent.commandTemplate),
    stdin: Boolean(agent.stdin),
    binaries: agent.binaries || null,
    capabilities: agent.capabilities || inferCapabilities(id, agent),
    strengths: agent.strengths || [],
  }));
}

function getAgent(config, agentId) {
  const id = agentId || config.defaultAgent || 'local';
  const agent = (config.agents || {})[id];
  if (!agent) throw new Error(`Unknown agent "${id}". Run: agentkodex agents list`);
  return { id, ...agent, commandTemplate: defaultTemplateForAgent(id, agent.commandTemplate) };
}

async function detectAgent(config, agentId) {
  const agent = getAgent(config, agentId);
  if (agent.id === 'local') return { ...agent, installed: true, binary: null, reason: 'built-in' };

  const commandTemplate = resolveTemplateFromEnv(agent.id, agent.commandTemplate);
  if (agent.id === 'shell') {
    const shellCommand = commandTemplate || process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'sh');
    const token = firstCommandToken(shellCommand);
    return { ...agent, commandTemplate: shellCommand, installed: true, binary: token, reason: 'system shell' };
  }

  if (!commandTemplate) return { ...agent, commandTemplate, installed: false, binary: null, reason: 'No command template configured.' };
  if (agent.id === 'copilot') return detectCopilot(agent, commandTemplate);

  const candidates = agent.binaries && agent.binaries.length ? agent.binaries : [firstCommandToken(commandTemplate)];
  for (const candidate of candidates.filter(Boolean)) {
    if (await commandExists(candidate)) {
      const resolvedTemplate = candidate === firstCommandToken(commandTemplate)
        ? commandTemplate
        : commandTemplate.replace(firstCommandToken(commandTemplate), candidate);
      return withTrust({ ...agent, commandTemplate: resolvedTemplate, installed: true, binary: candidate, reason: 'installed' });
    }
  }
  return withTrust({ ...agent, commandTemplate, installed: false, binary: candidates[0] || null, reason: `Binary not found: ${candidates.join(' or ')}` });
}

async function detectCopilot(agent, commandTemplate) {
  if (!(await commandExists('gh'))) return { ...agent, commandTemplate, installed: false, binary: 'gh', reason: 'Binary not found: gh' };
  const hasCopilot = await commandSucceeds('gh copilot --help');
  return withTrust({ ...agent, commandTemplate, installed: hasCopilot, binary: 'gh', reason: hasCopilot ? 'installed' : 'GitHub CLI found, but gh copilot is unavailable or not authenticated.' });
}

function commandSucceeds(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function inferCapabilities(id, agent = {}) {
  if (id === 'shell') return ['persistent-session', 'follow-up-input', 'project-commands'];
  if (id === 'local') return ['discovery', 'gates', 'reports'];
  if (agent.stdin) return ['mission-stdin', 'follow-up-input', 'persistent-session'];
  if (agent.commandTemplate) return ['mission-command-template', 'persistent-session'];
  return [];
}

function resolveTemplateFromEnv(agentId, configured) {
  const envName = `AGENTKODEX_${agentId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_CMD`;
  return process.env[envName] || configured || null;
}

function defaultTemplateForAgent(agentId, configured) {
  if (configured) return configured;
  if (agentId === 'shell') return process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'sh');
  return configured || null;
}

function buildAgentCommand(agent, context) {
  const template = resolveTemplateFromEnv(agent.id, agent.commandTemplate || defaultTemplateForAgent(agent.id, null));
  if (!template) return null;
  const replacements = {
    promptFile: shellQuote(context.promptFile),
    prompt: shellQuote(context.promptText),
    cwd: shellQuote(context.cwd),
    runDir: shellQuote(context.runDir),
    task: shellQuote(context.task),
  };
  return template.replace(/\{(promptFile|prompt|cwd|runDir|task)\}/g, (_, key) => replacements[key]);
}

function withTrust(agent) {
  const allowed = TRUSTED_AGENT_BINARIES[agent.id] || [];
  const template = String(agent.commandTemplate || '');
  const binary = agent.binary || firstCommandToken(template);
  const hasShellControl = /(?:&&|\|\||[;\n`]|[$]\()/g.test(template);
  return {
    ...agent,
    trustedLaunch: Boolean(agent.installed && allowed.includes(binary) && !hasShellControl && agent.kind !== 'custom'),
  };
}

function setAgentCommand(config, agentId, commandTemplate, stdin = null) {
  if (!config.agents) config.agents = {};
  if (!config.agents[agentId]) config.agents[agentId] = { description: 'Custom Agentkodex adapter', kind: 'custom' };
  config.agents[agentId].commandTemplate = commandTemplate;
  if (stdin !== null) config.agents[agentId].stdin = Boolean(stdin);
  return config;
}

function recommendAgents(task = '', discovery = {}) {
  const text = String(task || '').toLowerCase();
  const frameworks = (discovery.frameworks || []).join(', ').toLowerCase();
  const languages = (discovery.languages || []).join(', ').toLowerCase();
  const recommendations = [];
  const add = (agent, reason, score) => recommendations.push({ agent, reason, score });

  if (/debug|bug|failing|failure|traceback|exception|error|fix/.test(text)) {
    add('claude-code', 'Strong fit for debugging, multi-file reasoning, and reading failing terminal output.', 95);
    add('codex', 'Good fit for iterative code/test repair through the CLI.', 88);
    add('aider', 'Good for smaller patch-style fixes once the failing files are known.', 76);
  } else if (/refactor|migrate|architecture|large|monorepo|rewrite/.test(text)) {
    add('claude-code', 'Best default for broad repo understanding and careful multi-file refactors.', 94);
    add('codex', 'Useful when the refactor can be validated by strong test/build gates.', 84);
    add('opencode', 'Useful open-source workflow option for agentic repository edits.', 72);
  } else if (/new app|from scratch|bootstrap|build.*app|end[- ]?to[- ]?end|e2e|feature|implement/.test(text)) {
    add('codex', 'Strong default for implementation-heavy app work with CLI validation gates.', 92);
    add('claude-code', 'Strong alternative when requirements or project architecture are complex.', 90);
    add('gemini', 'Useful when the task includes research-heavy implementation.', 76);
  } else if (/test|lint|build|typecheck|ci/.test(text)) {
    add('codex', 'Good fit for command-driven validation and repair loops.', 90);
    add('claude-code', 'Good fit for understanding why project quality gates fail.', 86);
    add('shell', 'Use shell when you only want Agentkodex to run deterministic gates/scripts.', 70);
  } else {
    add('claude-code', 'Balanced default for repo understanding and implementation.', 86);
    add('codex', 'Balanced default for CLI-native implementation and validation.', 84);
    add('custom', 'Use when your team has a preferred coding CLI command template.', 70);
  }

  if (/next|react|vite|node|typescript|javascript/.test(`${frameworks} ${languages}`)) {
    for (const item of recommendations) if (['codex', 'claude-code'].includes(item.agent)) item.score += 2;
  }

  return recommendations
    .sort((a, b) => b.score - a.score)
    .map(({ agent, reason, score }) => ({ agent, reason, score }));
}

function renderAgentTable(config) {
  const rows = listAgents(config);
  const lines = [];
  lines.push('Agentkodex agents:');
  for (const row of rows) {
    lines.push(`- ${row.id}`);
    lines.push(`  kind: ${row.kind}`);
    lines.push(`  description: ${row.description}`);
    lines.push(`  command: ${row.commandTemplate || '(none)'}`);
    lines.push(`  stdin: ${row.stdin ? 'yes' : 'no'}`);
    if (row.capabilities.length) lines.push(`  capabilities: ${row.capabilities.join(', ')}`);
    if (row.strengths.length) lines.push(`  strengths: ${row.strengths.join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  listAgents,
  getAgent,
  detectAgent,
  buildAgentCommand,
  setAgentCommand,
  recommendAgents,
  renderAgentTable,
  withTrust,
};
