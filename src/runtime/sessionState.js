'use strict';

const crypto = require('crypto');

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(value) {
  return String(value || '').replace(ANSI_RE, '');
}

function tailLines(value, maxLines = 40) {
  const lines = stripAnsi(value).split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

function hashText(value, length = 12) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function analyzeTerminalBuffer(buffer, options = {}) {
  const clean = stripAnsi(String(buffer || ''));
  const tail = tailLines(clean, 60);
  const compact = tail.replace(/\s+/g, ' ').trim();
  const now = Number(options.now || Date.now());
  const lastOutputAt = options.lastOutputAt ? Date.parse(options.lastOutputAt) : now;
  const idleMs = Number.isFinite(lastOutputAt) ? now - lastOutputAt : 0;

  let state = 'agent_thinking';
  let confidence = 'low';
  let reason = 'default running state';

  if (!compact) {
    state = 'idle';
    confidence = 'medium';
    reason = 'no terminal output yet';
  }

  const approval = detectApprovalRequest(tail);
  if (approval) {
    return { state: 'awaiting_approval', confidence: 'high', reason: approval.reason, approval, cleanTail: tail };
  }

  if (/\b(PASS|FAIL|passed|failed)\b.*\b(test|tests|spec|suite)\b/i.test(compact)
    || /\b(npm|pnpm|yarn|bun|pytest|go test|cargo test|rspec|mvn test|gradle test)\b/i.test(compact)
    || /\bRunning\s+(unit\s+)?tests?\b/i.test(compact)) {
    state = 'tests_running';
    confidence = 'medium';
    reason = 'test runner output detected';
  }

  if (/\b(error|exception|traceback|failed|cannot|not found|enoent|eacces|syntaxerror|typeerror|referenceerror)\b/i.test(compact)) {
    state = 'error_observed';
    confidence = 'medium';
    reason = 'error-like terminal output detected';
  }

  if (/\b(enter|input|select|choose|press any key|password:|username:|login:)\b/i.test(compact)
    || /[:?]\s*$/.test(compact)) {
    state = 'awaiting_user_input';
    confidence = confidence === 'low' ? 'medium' : confidence;
    reason = 'interactive input prompt detected';
  }

  if (/\b(done|completed|finished|all checks passed|build succeeded|tests? passed)\b/i.test(compact)) {
    state = 'completed_signal';
    confidence = 'medium';
    reason = 'completion-like output detected';
  }

  if (idleMs > Number(options.stuckAfterMs || 10 * 60 * 1000)) {
    state = 'stuck';
    confidence = 'medium';
    reason = `no output for ${idleMs}ms`;
  }

  return { state, confidence, reason, approval: null, cleanTail: tail };
}


function classifyTerminalState(buffer, previousState = 'agent_thinking', options = {}) {
  const analysis = analyzeTerminalBuffer(buffer, options);
  if (!analysis || !analysis.state) return previousState || 'agent_thinking';
  return analysis.state;
}

function detectApprovalRequest(buffer) {
  const tail = tailLines(buffer, 30);
  const compact = tail.replace(/\s+/g, ' ').trim();
  if (!compact) return null;

  const patterns = [
    { pattern: /\b(approve|approval|permission|allow)\b/i, reason: 'approval/permission keyword detected' },
    { pattern: /\b(do you want to|would you like to|shall i|continue|proceed)\b.*\b(y\/n|yes\/no|\[y\/?n\]|\[yes\/?no\])\b/i, reason: 'yes/no continuation prompt detected' },
    { pattern: /\b(accept|reject|deny)\b.*\b(command|change|edit|operation)\b/i, reason: 'accept/reject operation prompt detected' },
    { pattern: /\b(run command|execute command|shell command)\b.*\?\s*$/i, reason: 'command execution prompt detected' },
    { pattern: /\b(install|add dependency|migrate|deploy|push|commit)\b.*\b(confirm|continue|proceed)\b/i, reason: 'risky operation confirmation prompt detected' },
  ];

  const matched = patterns.find((item) => item.pattern.test(compact));
  if (!matched) return null;

  const promptLines = tail.split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
  return {
    id: `appr_${hashText(promptLines, 10)}`,
    signature: hashText(promptLines, 20),
    prompt: promptLines,
    reason: matched.reason,
    suggestedResponse: inferApprovalResponse(compact),
    createdAt: new Date().toISOString(),
  };
}

function inferApprovalResponse(compactPrompt) {
  if (/\[y\/?n\]|yes\/no|y\/n/i.test(compactPrompt)) return 'y';
  if (/\bapprove\b/i.test(compactPrompt)) return 'approve';
  if (/\ballow\b/i.test(compactPrompt)) return 'allow';
  if (/\bcontinue\b/i.test(compactPrompt)) return 'continue';
  return 'y';
}

module.exports = {
  stripAnsi,
  tailLines,
  analyzeTerminalBuffer,
  classifyTerminalState,
  detectApprovalRequest,
};
