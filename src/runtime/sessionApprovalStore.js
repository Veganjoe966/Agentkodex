'use strict';

const path = require('path');
const { readJson, writeJson, hashString } = require('../utils');
const { sessionDir } = require('./sessionPaths');
const { loadSessionRecord, saveSessionRecord } = require('./sessionRecord');
const { appendEvent } = require('./sessionIo');

function readApprovals(root, sessionId) {
  const session = loadSessionRecord(root, sessionId);
  const file = session?.files?.approvals || path.join(sessionDir(root, sessionId), 'approvals.json');
  const value = readJson(file, { approvals: [] });
  if (Array.isArray(value)) return value;
  return value.approvals || [];
}

function saveApprovals(root, sessionId, approvals) {
  const session = loadSessionRecord(root, sessionId);
  const file = session?.files?.approvals || path.join(sessionDir(root, sessionId), 'approvals.json');
  writeJson(file, { approvals: Array.isArray(approvals) ? approvals : [] });
}

function addApproval(root, record, approval = {}) {
  const current = loadSessionRecord(root, record.id) || record;
  const id = approval.id || `appr_${hashString(`${current.id}:${approval.signature || approval.prompt || approval.command || Date.now()}`, 10)}`;
  const existing = (current.approvals || []).find((item) => item.id === id || (approval.signature && item.signature === approval.signature));
  if (existing && ['pending', 'open'].includes(existing.status)) return existing;
  const item = {
    id,
    status: approval.status || 'pending',
    kind: approval.kind || 'terminal_prompt',
    command: approval.command || null,
    prompt: approval.prompt || '',
    reason: approval.reason || 'Terminal prompt detected.',
    suggestedResponse: approval.suggestedResponse || approval.defaultApproveInput || 'y',
    signature: approval.signature || id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    decidedAt: null,
    decision: null,
  };
  current.approvals = [...(current.approvals || []), item];
  current.openApprovalId = item.id;
  saveSessionRecord(root, current);
  appendEvent(root, current.id, { type: 'approval.created', approval: item });
  return item;
}

function decideApproval(root, record, approvalId, decision) {
  const current = loadSessionRecord(root, record.id) || record;
  const approvals = current.approvals || [];
  const index = approvals.findIndex((item) => item.id === approvalId || item.id.startsWith(approvalId));
  if (index === -1) return null;
  const status = decision === 'approve' || decision === 'approved' ? 'approved' : 'denied';
  approvals[index] = {
    ...approvals[index],
    status,
    decision: status,
    decidedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  current.approvals = approvals;
  const pending = approvals.find((item) => ['pending', 'open'].includes(item.status));
  current.openApprovalId = pending ? pending.id : null;
  saveSessionRecord(root, current);
  appendEvent(root, current.id, { type: 'approval.decided', approval: approvals[index] });
  return approvals[index];
}

module.exports = {
  readApprovals,
  saveApprovals,
  addApproval,
  decideApproval,
};
