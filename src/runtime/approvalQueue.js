'use strict';

const { ensureKodex, kodexPath } = require('../kodexStore');
const { readJson, writeJson, hashString } = require('../utils');
const { resolveSession, readApprovals: readSessionApprovals, saveApprovals: saveSessionApprovals } = require('./sessionStore');

function approvalsPath(root) {
  ensureKodex(root);
  return kodexPath(root, 'approvals.json');
}

function loadApprovals(root) {
  return readJson(approvalsPath(root), { approvals: [] });
}

function saveApprovals(root, queue) {
  writeJson(approvalsPath(root), queue && Array.isArray(queue.approvals) ? queue : { approvals: [] });
}

function createApproval(root, input = {}) {
  const queue = loadApprovals(root);
  const prompt = input.prompt || input.text || input.excerpt || '';
  const fingerprint = input.fingerprint || hashString(`${input.kind || 'approval'}:${input.sessionId || ''}:${input.command || ''}:${prompt}`, 16);
  const existing = (queue.approvals || []).find((item) => ['open', 'pending'].includes(item.status) && item.fingerprint === fingerprint);
  if (existing) return existing;
  const now = new Date().toISOString();
  const approval = {
    id: input.id || `appr_${hashString(`${fingerprint}:${now}:${Math.random()}`, 10)}`,
    fingerprint,
    status: 'open',
    kind: input.kind || 'terminal_prompt',
    sessionId: input.sessionId || null,
    runId: input.runId || null,
    agent: input.agent || null,
    command: input.command || null,
    prompt,
    text: prompt,
    reason: input.reason || 'Agent requested confirmation in the terminal.',
    risk: input.risk || 'approval_required',
    defaultApproveInput: input.defaultApproveInput === undefined ? 'y\n' : input.defaultApproveInput,
    defaultDenyInput: input.defaultDenyInput === undefined ? 'n\n' : input.defaultDenyInput,
    approveInput: input.defaultApproveInput === undefined ? 'y\n' : input.defaultApproveInput,
    denyInput: input.defaultDenyInput === undefined ? 'n\n' : input.defaultDenyInput,
    confidence: input.confidence || null,
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    decision: null,
  };
  queue.approvals.push(approval);
  saveApprovals(root, queue);
  syncSessionApproval(root, approval);
  return approval;
}

function syncSessionApproval(root, approval) {
  if (!approval.sessionId) return;
  const session = resolveSession(root, approval.sessionId);
  if (!session) return;
  const local = readSessionApprovals(root, session.id).filter((item) => item.id !== approval.id);
  local.push(approval);
  saveSessionApprovals(root, session.id, local);
}

function listApprovals(root, options = {}) {
  const queue = loadApprovals(root);
  let items = queue.approvals || [];
  if (options.status) items = items.filter((item) => item.status === options.status);
  if (options.sessionId) items = items.filter((item) => item.sessionId === options.sessionId);
  return items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function getApproval(root, id) {
  return (loadApprovals(root).approvals || []).find((item) => item.id === id || item.id.startsWith(id)) || null;
}

function updateApproval(root, id, patch = {}) {
  const queue = loadApprovals(root);
  const index = (queue.approvals || []).findIndex((item) => item.id === id || item.id.startsWith(id));
  if (index === -1) throw new Error(`Unknown approval: ${id}`);
  queue.approvals[index] = { ...queue.approvals[index], ...patch, updatedAt: new Date().toISOString() };
  saveApprovals(root, queue);
  syncSessionApproval(root, queue.approvals[index]);
  return queue.approvals[index];
}

function resolveApproval(root, idOrLast = 'last') {
  if (!idOrLast || idOrLast === 'last' || idOrLast === 'first') {
    const pending = listApprovals(root).filter((item) => item.status === 'pending' || item.status === 'open');
    if (!pending.length) return null;
    return idOrLast === 'first' ? pending[0] : pending[pending.length - 1];
  }
  return getApproval(root, idOrLast);
}

function markApproval(root, idOrLast, decision = 'approved') {
  const approval = resolveApproval(root, idOrLast || 'last');
  if (!approval) return null;
  return updateApproval(root, approval.id, {
    status: decision === 'approved' ? 'approved' : 'denied',
    decision,
    decidedAt: new Date().toISOString(),
  });
}

module.exports = {
  approvalsPath,
  loadApprovals,
  saveApprovals,
  createApproval,
  listApprovals,
  getApproval,
  updateApproval,
  resolveApproval,
  markApproval,
};
