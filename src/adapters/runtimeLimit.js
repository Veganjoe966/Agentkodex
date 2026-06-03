'use strict';

const LABELS = {
  codex: 'Codex CLI',
  'claude-code': 'Claude Code',
  aider: 'Aider',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  cursor: 'Cursor CLI',
  copilot: 'Copilot CLI',
};

function classifyAdapterRuntimeLimit(agentId, text = '') {
  const body = String(text || '');
  if (!body) return null;
  if (isBubblewrapLoopbackFailure(body)) return limit(agentId, 'bubblewrap_loopback');
  if (/operation not permitted/i.test(body) && /(?:bubblewrap|bwrap|user namespace|network namespace|sandbox)/i.test(body)) {
    return limit(agentId, 'sandbox_permission');
  }
  return null;
}

function isBubblewrapLoopbackFailure(text) {
  return /(?:bwrap|bubblewrap).*RTM_NEWADDR/i.test(text)
    || /loopback:\s*Failed RTM_NEWADDR/i.test(text)
    || /RTM_NEWADDR:\s*Operation not permitted/i.test(text);
}

function limit(agentId, code) {
  const label = LABELS[agentId] || agentId || 'Agent';
  return {
    code,
    agentId,
    label,
    readinessState: 'degraded',
    message: `${label} is installed, but its internal sandbox cannot run here.`,
    hint: 'Use a host that supports bubblewrap/user namespaces, configure that CLI sandbox mode differently if supported, or use another ready agent.',
  };
}

function safeAdapterLimitText(limitInfo) {
  if (!limitInfo) return '';
  return `${limitInfo.message} ${limitInfo.hint}`;
}

module.exports = {
  classifyAdapterRuntimeLimit,
  safeAdapterLimitText,
};
