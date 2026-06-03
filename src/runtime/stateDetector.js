'use strict';

function normalizeBuffer(buffer, max = 12000) {
  const text = String(buffer || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function trimBuffer(buffer, max = 12000) {
  return normalizeBuffer(buffer, max);
}

function stripAnsi(input) {
  return String(input || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function detectState(buffer, previousState = 'starting') {
  const raw = normalizeBuffer(buffer);
  const text = stripAnsi(raw).toLowerCase();
  if (!text.trim()) return previousState || 'starting';

  if (/\b(approve|allow|permission|confirm|continue\?|proceed\?|y\/n|yes\/no|press enter|select an option)\b/i.test(text)) return 'awaiting_approval';
  if (/\b(test|tests|jest|vitest|playwright|cypress|pytest|cargo test|go test|npm run test|pnpm test)\b.*\b(running|started|watch|pass|fail)?\b/i.test(text)) return 'tests_running';
  if (/\b(building|compiling|bundling|transpiling|typechecking|npm run build|pnpm build|cargo build|go build)\b/i.test(text)) return 'command_running';
  if (/\b(dev server|localhost:\d+|listening on|ready in|compiled successfully|started server)\b/i.test(text)) return 'dev_server_running';
  if (/\b(error|failed|exception|traceback|panic|cannot find|not found|eacces|enoent|syntaxerror|typeerror)\b/i.test(text)) return 'error_present';
  if (/\b(done|completed|success|all tests passed|finished|exiting)\b/i.test(text)) return 'completed_signal';
  return previousState && previousState !== 'starting' ? previousState : 'agent_running';
}

function detectApprovalRequest(buffer) {
  const text = stripAnsi(normalizeBuffer(buffer, 6000));
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interesting = [...lines].reverse().find((line) => /approve|allow|permission|confirm|continue\?|proceed\?|y\/n|yes\/no|press enter/i.test(line));
  if (!interesting) return null;
  return {
    kind: 'terminal_prompt',
    prompt: interesting.slice(0, 800),
    text: interesting.slice(0, 800),
    confidence: 'medium',
    reason: 'Terminal output appears to be asking for confirmation or approval.',
    defaultApproveInput: inferApproveInput(interesting),
    defaultDenyInput: inferDenyInput(interesting),
  };
}

function detectApproval(buffer) {
  return detectApprovalRequest(buffer);
}

function inferApproveInput(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/press enter/.test(p)) return '\n';
  if (/\[y\/n\]|\(y\/n\)|yes\/no|approve|allow|continue|proceed/.test(p)) return 'y\n';
  return 'y\n';
}

function inferDenyInput(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/\[y\/n\]|\(y\/n\)|yes\/no|approve|allow|continue|proceed/.test(p)) return 'n\n';
  return '\u0003';
}

function parseEventsFromOutput(chunk) {
  const text = stripAnsi(String(chunk || ''));
  const events = [];
  if (/\b(error|failed|exception|traceback|panic)\b/i.test(text)) events.push({ type: 'error_seen', text: text.slice(0, 1200) });
  if (/\b(test|tests)\b/i.test(text)) events.push({ type: 'test_output', text: text.slice(0, 1200) });
  if (/\b(approve|allow|permission|confirm|continue\?|proceed\?|y\/n|yes\/no)\b/i.test(text)) events.push({ type: 'approval_prompt_seen', text: text.slice(0, 1200) });
  return events;
}

function deriveIdleState(metadata = {}) {
  const status = metadata.status || 'created';
  const state = metadata.state || status;
  if (!['running', 'starting', 'awaiting_approval'].includes(status)) return state;
  const last = metadata.lastOutputAt ? Date.parse(metadata.lastOutputAt) : Date.parse(metadata.startedAt || metadata.updatedAt || new Date().toISOString());
  const age = Number.isFinite(last) ? Date.now() - last : 0;
  if (status === 'running' && age > 10 * 60 * 1000 && !['awaiting_approval', 'awaiting_user_input'].includes(state)) return 'idle_or_stuck';
  return state;
}

module.exports = {
  stripAnsi,
  normalizeBuffer,
  trimBuffer,
  detectState,
  detectApprovalRequest,
  detectApproval,
  parseEventsFromOutput,
  deriveIdleState,
};
