'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { GOALS, ONBOARDING_STEPS, renderTryCommand, withOnboardingProgress } = require('../onboarding/flow');
const { ensureKodex, loadConfig, saveConfig } = require('../kodexStore');
const { commandExists, firstCommandToken } = require('../sessionRunner');
const { writeAuditEvidence } = require('../audit/evidence');
const { redactSecrets } = require('../security/redaction');
const { classifyAdapterRuntimeLimit } = require('../adapters/runtimeLimit');

const READY_STATES = new Set(['ready', 'manually_configured']);

const DEFAULT_TEMPLATES = {
  codex: 'codex',
  'claude-code': 'claude',
  aider: 'aider --message-file {promptFile}',
  gemini: 'gemini',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  copilot: 'gh copilot suggest {prompt}',
};

const ADAPTERS = [
  {
    id: 'codex',
    label: 'Codex CLI',
    commandTemplate: 'codex exec --sandbox workspace-write --skip-git-repo-check --cd {cwd} {prompt}',
    smokeCommand: 'codex exec --sandbox read-only --skip-git-repo-check "Reply with exactly: AGENTKODEX_SMOKE"',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    commandTemplate: 'claude --bare --print --permission-mode acceptEdits --output-format text {prompt}',
    smokeCommand: 'claude --bare --print --permission-mode acceptEdits --output-format text "Reply with exactly: AGENTKODEX_SMOKE"',
  },
  { id: 'aider', label: 'Aider', commandTemplate: 'aider --message-file {promptFile}', smokeCommand: 'aider --version' },
  { id: 'gemini', label: 'Gemini CLI', commandTemplate: 'gemini {prompt}', smokeCommand: 'gemini --version' },
  { id: 'opencode', label: 'OpenCode', commandTemplate: 'opencode {prompt}', smokeCommand: 'opencode --version' },
  { id: 'cursor', label: 'Cursor CLI', commandTemplate: 'cursor-agent {prompt}', smokeCommand: 'cursor-agent --version' },
  { id: 'copilot', label: 'Copilot CLI', commandTemplate: 'gh copilot suggest {prompt}', smokeCommand: 'gh copilot --help' },
];

async function setupCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = path.resolve(stringFlag(flags, 'cwd', stringFlag(flags, 'repo', process.cwd())));
  const json = booleanFlag(flags, 'json');
  const result = await withOnboardingProgress(ONBOARDING_STEPS, () => runSetup(root), {
    json,
    skip: booleanFlag(flags, 'noAnimation') || booleanFlag(flags, 'no-animation'),
  });
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result, null, 2));
  else console.log(renderSetup(result));
}

async function runSetup(root, options = {}) {
  ensureKodex(root);
  const config = loadConfig(root);
  const adapters = options.adapters || ADAPTERS;
  const detections = [];
  for (const adapter of adapters) {
    const current = config.agents?.[adapter.id] || {};
    if (current.disabled) {
      const detected = row(adapter, 'disabled', false, firstCommandToken(current.commandTemplate || adapter.commandTemplate), 'Disabled by config.');
      detections.push(detected);
      writeAuditEvidence(root, { type: 'adapter_detected', allowed: true, agentId: adapter.id, readinessState: 'disabled' });
      continue;
    }
    const manual = hasManualTemplate(adapter.id, current);
    const detected = await probeAdapter(adapter, { manual });
    detections.push(detected);
    auditDetection(root, detected);
    if (manual) {
      writeAuditEvidence(root, { type: 'adapter_manual_config_preserved', allowed: true, agentId: adapter.id, readinessState: detected.readinessState });
      continue;
    }
    if (detected.ready) {
      config.agents[adapter.id] = {
        ...(config.agents[adapter.id] || {}),
        kind: config.agents[adapter.id]?.kind || 'interactive-cli',
        description: config.agents[adapter.id]?.description || `External ${adapter.label}.`,
        commandTemplate: adapter.commandTemplate,
        stdin: false,
        autoConfigured: true,
        readinessState: 'ready',
        lastReadyAt: new Date().toISOString(),
      };
      writeAuditEvidence(root, { type: 'adapter_auto_configured', allowed: true, agentId: adapter.id, binary: detected.binary });
    } else if (config.agents[adapter.id]?.autoConfigured) {
      config.agents[adapter.id].readinessState = 'degraded';
      config.agents[adapter.id].readinessReason = detected.reason;
      config.agents[adapter.id].lastDegradedAt = new Date().toISOString();
      writeAuditEvidence(root, { type: 'adapter_degraded', allowed: true, agentId: adapter.id, reason: detected.reason });
    }
  }
  saveConfig(root, config);
  const readyAgents = detections.filter((item) => READY_STATES.has(item.readinessState)).map((item) => item.id);
  return {
    ok: true,
    root,
    readyAgents,
    agents: detections,
    next: readyAgents.length ? 'agentkodex ask "Explain this project"' : 'Configure or authenticate a coding CLI, then run agentkodex setup again.',
  };
}

async function probeAdapter(adapter, context = {}) {
  const binary = firstCommandToken(adapter.commandTemplate);
  if (!(await commandExists(binary))) return row(adapter, 'missing', false, binary, `Install ${adapter.label}.`);
  if (context.manual) return row(adapter, 'manually_configured', true, binary, 'Manual command template preserved.');
  const smoke = runSmoke(adapter.smokeCommand);
  if (smoke.ok) return row(adapter, 'ready', true, binary, 'Ready for Agentkodex.');
  const text = `${smoke.stdout}\n${smoke.stderr}`.toLowerCase();
  const limit = classifyAdapterRuntimeLimit(adapter.id, text);
  if (limit) return row(adapter, limit.readinessState, false, binary, limit.message, limit.hint);
  const state = /auth|login|log in|token|credential/.test(text) ? 'installed_not_authenticated' : 'smoke_failed';
  return row(adapter, state, false, binary, smoke.summary || 'Smoke check failed.');
}

function runSmoke(command) {
  if (!command) return { ok: false, summary: 'No smoke command configured.' };
  const result = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 45000, maxBuffer: 64 * 1024 });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    summary: result.status === 0 ? 'Smoke check passed.' : safeSummary(result),
  };
}

function row(adapter, readinessState, ready, binary, reason, hint = '') {
  return {
    id: adapter.id,
    label: adapter.label,
    binary: binary || null,
    ready,
    installed: readinessState !== 'missing',
    readinessState,
    reason,
    hint,
  };
}

function hasManualTemplate(id, agent = {}) {
  if (!agent.commandTemplate) return false;
  if (agent.autoConfigured) return false;
  return agent.commandTemplate !== DEFAULT_TEMPLATES[id];
}

function auditDetection(root, detected) {
  const type = detected.ready ? 'adapter_smoke_passed' : detected.installed ? 'adapter_smoke_failed' : 'adapter_missing';
  writeAuditEvidence(root, { type: 'adapter_detected', allowed: true, agentId: detected.id, readinessState: detected.readinessState, binary: detected.binary });
  writeAuditEvidence(root, { type, allowed: detected.ready, agentId: detected.id, readinessState: detected.readinessState, reason: detected.reason });
}

function safeSummary(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').slice(-2).join(' ');
  return redactSecrets(text.slice(0, 240) || `Smoke exited ${result.status}`);
}

function renderSetup(result) {
  const ready = result.agents.filter((agent) => agent.ready);
  const notReady = result.agents.filter((agent) => !agent.ready);
  const lines = ['Welcome to Agentkodex.', '', 'Ready to use:'];
  if (ready.length) for (const agent of ready) lines.push(`✓ ${agent.label}`);
  else lines.push('○ No coding agents are ready yet');
  lines.push('', 'Not ready:');
  if (notReady.length) for (const agent of notReady) lines.push(`○ ${agent.label}${statusHint(agent)}`);
  else lines.push('✓ All detected agents are ready');
  lines.push('', ready.length ? 'You can start now:' : 'Before you start:');
  lines.push(result.next);
  lines.push('', 'Agentkodex can help you:');
  GOALS.forEach((goal, index) => lines.push(`${index + 1}. ${goal}`));
  lines.push('', 'Try:', renderTryCommand(), '', 'Advanced Information:', 'Use:', 'agentkodex doctor --verify-agents', 'agentkodex help all');
  return lines.join('\n');
}

function statusHint(agent) {
  const status = friendlyStatus(agent);
  return status ? `: ${status}` : '';
}

function friendlyStatus(agent) {
  switch (agent.readinessState) {
    case 'missing':
      return 'missing';
    case 'installed_not_authenticated':
      return 'not authenticated';
    case 'installed_not_noninteractive_ready':
      return 'not ready for non-interactive use';
    case 'disabled':
      return 'disabled';
    case 'degraded':
      return agent.reason || 'needs a fresh setup check';
    case 'smoke_failed':
      return 'check failed';
    default:
      return agent.reason || '';
  }
}

module.exports = {
  setupCommand,
  runSetup,
  probeAdapter,
  renderSetup,
};
