'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, exists, readJson, readText, writeJson, writeText } = require('../utils');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { sessionDir, sessionFiles, makeSocketPath, newSessionId, sessionsDir } = require('./sessionPaths');
const { refreshSessionLiveness } = require('./sessionProcess');
const { ensureSessionToken } = require('./controlToken');

function normalizeRecord(root, data = {}) {
  const id = data.id || newSessionId(`${data.agent || ''}:${data.task || ''}:${data.command || ''}`);
  const dir = sessionDir(root, id);
  const runDir = data.runDir || dir;
  const now = new Date().toISOString();
  const files = { ...sessionFiles(root, id, runDir), ...(data.files || {}) };
  return {
    id,
    root: path.resolve(data.root || root),
    dir,
    sessionDir: dir,
    runDir,
    runId: data.runId || null,
    task: data.task || '',
    agent: data.agent || 'custom',
    adapterKind: data.adapterKind || data.runtime || 'template',
    command: data.command || '',
    cwd: path.resolve(data.cwd || root),
    mode: data.mode || 'supervised',
    gates: data.gates || [],
    status: data.status || 'created',
    state: data.state || 'starting',
    pid: data.pid || null,
    childPid: data.childPid || null,
    workerPid: data.workerPid || null,
    supervisorPid: data.supervisorPid || null,
    workerLauncherPid: data.workerLauncherPid || null,
    pty: Boolean(data.pty || data.usePty),
    usePty: Boolean(data.usePty || data.pty),
    terminalKind: data.terminalKind || null,
    capabilities: data.capabilities || {},
    policy: data.policy || null,
    approvals: Array.isArray(data.approvals) ? data.approvals : [],
    openApprovalId: data.openApprovalId || null,
    pendingStart: data.pendingStart || null,
    promptFile: data.promptFile || files.missionPrompt || null,
    socketPath: data.socketPath || makeSocketPath(root, id),
    controlTokenPath: data.controlTokenPath || files.controlToken,
    metadata: data.metadata || {},
    files,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    startedAt: data.startedAt || null,
    endedAt: data.endedAt || data.completedAt || null,
    completedAt: data.completedAt || null,
    heartbeatAt: data.heartbeatAt || null,
    lastOutputAt: data.lastOutputAt || null,
    lastStateReason: data.lastStateReason || '',
    lastInboxSeq: Number(data.lastInboxSeq || 0),
    exitCode: data.exitCode === undefined ? null : data.exitCode,
    signal: data.signal || null,
    error: data.error || null,
  };
}

function saveSessionRecord(root, record) {
  const normalized = normalizeRecord(root, { ...record, id: record.id, createdAt: record.createdAt });
  normalized.updatedAt = new Date().toISOString();
  ensureDir(path.dirname(normalized.files.session));
  ensureSessionToken(normalized);
  writeJson(normalized.files.session, normalized);
  writeJson(normalized.files.metadata, normalized);
  writeText(kodexPath(root, 'last-session'), normalized.id);
  return normalized;
}

function saveSession(session, patch = {}) {
  if (!session) throw new Error('Missing session to save.');
  return saveSessionRecord(session.root, { ...session, ...patch });
}

function resolveSessionId(root, idOrLast = 'last') {
  ensureKodex(root);
  const raw = String(idOrLast || 'last');
  if (raw === 'last') {
    const last = readText(kodexPath(root, 'last-session'), '').trim();
    if (last && exists(path.join(sessionDir(root, last), 'session.json'))) return last;
    const sessions = listSessions(root);
    return sessions.length ? sessions[0].id : null;
  }
  if (exists(path.join(sessionDir(root, raw), 'session.json'))) return raw;
  const matches = listSessions(root).filter((session) => session.id.startsWith(raw));
  return matches.length === 1 ? matches[0].id : null;
}

function loadSessionRecord(root, idOrLast = 'last') {
  const id = resolveSessionId(root, idOrLast);
  if (!id) return null;
  const record = readJson(path.join(sessionDir(root, id), 'session.json'), null);
  return record ? refreshSessionLiveness(record) : null;
}

const getSession = loadSessionRecord;
const loadSession = loadSessionRecord;
const readSession = loadSessionRecord;

function writeSession(root, session) {
  return saveSessionRecord(root, session);
}

function updateSession(root, idOrLast, patch = {}) {
  const existing = loadSessionRecord(root, idOrLast);
  if (!existing) throw new Error(`Unknown session: ${idOrLast}`);
  return saveSessionRecord(root, { ...existing, ...patch });
}

const patchSession = updateSession;
const resolveSession = loadSessionRecord;

function listSessions(root, options = {}) {
  const dir = sessionsDir(root);
  if (!exists(dir)) return [];
  const rows = fs.readdirSync(dir)
    .map((id) => readJson(path.join(dir, id, 'session.json'), null))
    .filter(Boolean)
    .map(refreshSessionLiveness)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (options.status) return rows.filter((row) => row.status === options.status || row.state === options.status);
  return rows;
}

const listSessionRecords = listSessions;

function sessionSummary(session) {
  return {
    id: session.id,
    status: session.status,
    state: session.state,
    agent: session.agent,
    task: session.task,
    pid: session.pid,
    childPid: session.childPid,
    workerPid: session.workerPid,
    runId: session.runId,
    runDir: session.runDir,
    sessionDir: session.sessionDir || session.dir,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function publicSession(record) {
  if (!record) return null;
  return {
    ...record,
    approvals: record.approvals || [],
    pendingApprovals: (record.approvals || []).filter((item) => ['pending', 'open'].includes(item.status)).length,
  };
}

module.exports = {
  normalizeRecord,
  saveSession,
  saveSessionRecord,
  loadSession,
  loadSessionRecord,
  getSession,
  readSession,
  writeSession,
  updateSession,
  patchSession,
  resolveSession,
  resolveSessionId,
  listSessions,
  listSessionRecords,
  sessionSummary,
  publicSession,
};
