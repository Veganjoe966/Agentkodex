'use strict';

const { readJson, writeJson } = require('../utils');
const { sessionApprovalsPath } = require('./paths');
const { appendEvent } = require('./store');

function loadApprovals(root, sessionId) {
  return readJson(sessionApprovalsPath(root, sessionId), { approvals: [] });
}

function saveApprovals(root, sessionId, value) {
  writeJson(sessionApprovalsPath(root, sessionId), value);
}

function listApprovals(root, sessionId = null) {
  if (sessionId) return loadApprovals(root, sessionId).approvals || [];
  const { listSessionRecords } = require('./store');
  const output = [];
  for (const session of listSessionRecords(root)) {
    for (const approval of loadApprovals(root, session.id).approvals || []) output.push(approval);
  }
  return output.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function createApproval(root, sessionId, request) {
  const queue = loadApprovals(root, sessionId);
  const approvals = queue.approvals || [];
  const existing = approvals.find((item) => item.fingerprint === request.fingerprint && item.status === 'pending');
  if (existing) return { approval: existing, created: false };
  const now = new Date().toISOString();
  const approval = {
    id: request.id,
    sessionId,
    runId: request.runId || null,
    agent: request.agent || null,
    cwd: request.cwd || null,
    command: request.command || null,
    excerpt: request.excerpt || '',
    risk: request.risk || 'approval_required',
    reason: request.reason || 'Approval required.',
    fingerprint: request.fingerprint || request.id,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    decision: null,
  };
  approvals.push(approval);
  saveApprovals(root, sessionId, { approvals });
  appendEvent(root, sessionId, { type: 'approval', approval, message: 'approval_created' });
  return { approval, created: true };
}

function decideApproval(root, approvalId, decision, note = '') {
  const { listSessionRecords } = require('./store');
  for (const session of listSessionRecords(root)) {
    const queue = loadApprovals(root, session.id);
    const approval = (queue.approvals || []).find((item) => item.id === approvalId || item.id.startsWith(approvalId));
    if (!approval) continue;
    approval.status = decision === 'approved' ? 'approved' : 'denied';
    approval.decision = decision;
    approval.note = note;
    approval.decidedAt = new Date().toISOString();
    approval.updatedAt = approval.decidedAt;
    saveApprovals(root, session.id, queue);
    appendEvent(root, session.id, { type: 'approval', approval, message: `approval_${approval.status}` });
    return approval;
  }
  return null;
}

function pendingApprovals(root) {
  return listApprovals(root).filter((item) => item.status === 'pending');
}

module.exports = {
  loadApprovals,
  saveApprovals,
  listApprovals,
  createApproval,
  decideApproval,
  pendingApprovals,
};
