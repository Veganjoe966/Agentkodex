'use strict';

const crypto = require('crypto');

const STATE = Object.freeze({
  STARTING: 'starting',
  IDLE: 'idle',
  AGENT_THINKING: 'agent_thinking',
  COMMAND_RUNNING: 'command_running',
  AWAITING_USER_INPUT: 'awaiting_user_input',
  AWAITING_APPROVAL: 'awaiting_approval',
  TESTS_RUNNING: 'tests_running',
  DEV_SERVER_RUNNING: 'dev_server_running',
  STUCK: 'stuck',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXITED: 'exited',
});

const APPROVAL_PATTERNS = [
  /(?:approve|allow|confirm|grant)\s+(?:this\s+)?(?:command|action|change|operation)/i,
  /(?:do you want to|would you like to|continue\?|proceed\?)/i,
  /(?:\[y\/n\]|\(y\/n\)|yes\/no|press enter to continue)/i,
  /requires?\s+(?:your\s+)?(?:approval|permission|confirmation)/i,
  /permission\s+(?:needed|required|request)/i,
];

const USER_INPUT_PATTERNS = [
  /enter\s+(?:a|your|the)?\s*(?:value|choice|option|token|key|password|username|email)/i,
  /select\s+(?:an?\s+)?(?:option|choice)/i,
  /waiting\s+for\s+(?:input|response)/i,
];

const TEST_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|build|typecheck)\b/i,
  /\b(pytest|go test|cargo test|mvn test|gradle test)\b/i,
  /\b(running|executing)\s+(tests?|lint|build)/i,
];

const COMMAND_PATTERNS = [
  /^\s*[$❯>]\s+\S+/m,
  /\bRunning command\b/i,
  /\bExecuting\b.+\bcommand\b/i,
  /\bspawn(?:ed|ing)?\b/i,
];

const DEV_SERVER_PATTERNS = [
  /\b(local|dev)\s*:\s*https?:\/\//i,
  /\bserver\s+(?:ready|listening|started)\b/i,
  /\bcompiled successfully\b/i,
  /\bready in \d+(?:\.\d+)?\s*(?:ms|s)\b/i,
];

const FAILURE_PATTERNS = [
  /\b(error|failed|exception|traceback|cannot find module|command not found)\b/i,
  /\b(exit code|exited with code)\s+[1-9]\d*\b/i,
];

const COMPLETION_PATTERNS = [
  /\b(done|completed|finished|successfully|all tests passed)\b/i,
  /\bsummary\b[\s\S]{0,200}\b(files changed|tests|validation)\b/i,
];

function detectState(buffer, previousState = STATE.STARTING, context = {}) {
  const text = tail(buffer, 12000);
  if (!text.trim()) return previousState || STATE.STARTING;
  if (context.exited) return context.exitCode === 0 ? STATE.EXITED : STATE.FAILED;
  if (APPROVAL_PATTERNS.some((p) => p.test(text))) return STATE.AWAITING_APPROVAL;
  if (USER_INPUT_PATTERNS.some((p) => p.test(text))) return STATE.AWAITING_USER_INPUT;
  if (TEST_PATTERNS.some((p) => p.test(text))) return STATE.TESTS_RUNNING;
  if (DEV_SERVER_PATTERNS.some((p) => p.test(text))) return STATE.DEV_SERVER_RUNNING;
  if (FAILURE_PATTERNS.some((p) => p.test(text))) return STATE.FAILED;
  if (COMPLETION_PATTERNS.some((p) => p.test(text))) return STATE.COMPLETED;
  if (COMMAND_PATTERNS.some((p) => p.test(text))) return STATE.COMMAND_RUNNING;
  if (/\b(thinking|analyzing|planning|reading|editing)\b/i.test(text)) return STATE.AGENT_THINKING;
  return previousState || STATE.IDLE;
}

function extractApprovalRequest(buffer, session = {}) {
  const text = tail(buffer, 5000);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => APPROVAL_PATTERNS.some((pattern) => pattern.test(line)));
  if (index === -1) return null;
  const excerpt = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4)).join('\n');
  const commandLine = findLikelyCommand(excerpt) || findLikelyCommand(text) || null;
  const fingerprint = hash(`${session.id || ''}\n${commandLine || ''}\n${excerpt}`);
  return {
    id: `appr_${fingerprint.slice(0, 12)}`,
    sessionId: session.id,
    runId: session.runId,
    agent: session.agent,
    cwd: session.cwd,
    command: commandLine,
    excerpt,
    risk: commandLine ? 'agent_requested_command' : 'agent_requested_confirmation',
    reason: 'Detected approval-style terminal prompt.',
    fingerprint,
  };
}

function findLikelyCommand(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const shellMatch = line.match(/^(?:[$❯>]\s+)(.+)$/);
    if (shellMatch) return shellMatch[1].trim();
    const quoted = line.match(/(?:command|run|execute)[:\s]+[`"']([^`"']+)[`"']/i);
    if (quoted) return quoted[1].trim();
  }
  return null;
}

function eventFromOutput(stream, text, session = {}) {
  return {
    type: stream,
    sessionId: session.id,
    runId: session.runId,
    timestamp: new Date().toISOString(),
    text,
  };
}

function tail(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  STATE,
  detectState,
  extractApprovalRequest,
  eventFromOutput,
  findLikelyCommand,
};
