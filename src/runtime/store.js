'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, readJson, writeJson, appendText, readText, timestampId, slugify, hashString } = require('../utils');
const { sessionsDir, sessionDir, sessionRecordPath, sessionEventsPath, sessionTranscriptPath } = require('./paths');

function createSessionRecord(root, input) {
  const id = input.id || `${timestampId()}-${slugify(input.agent || 'agent', 18)}-${hashString(`${Date.now()}-${Math.random()}`, 6)}`;
  const dir = sessionDir(root, id);
  const now = new Date().toISOString();
  const record = {
    id,
    root,
    runId: input.runId || null,
    runDir: input.runDir || null,
    agent: input.agent || 'custom',
    adapterKind: input.adapterKind || 'template',
    command: input.command,
    cwd: input.cwd || root,
    mode: input.mode || 'supervised',
    status: 'created',
    state: 'starting',
    pid: null,
    exitCode: null,
    signal: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
    lastOutputAt: null,
    promptFile: input.promptFile || null,
    transcriptFile: sessionTranscriptPath(root, id),
    eventsFile: sessionEventsPath(root, id),
    metadata: input.metadata || {},
  };
  writeJson(sessionRecordPath(root, id), record);
  appendEvent(root, id, { type: 'system', sessionId: id, timestamp: now, message: 'session_created', record });
  return record;
}

function loadSessionRecord(root, sessionId) {
  return readJson(sessionRecordPath(root, sessionId), null);
}

function updateSessionRecord(root, sessionId, patch) {
  const existing = loadSessionRecord(root, sessionId) || {};
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeJson(sessionRecordPath(root, sessionId), next);
  return next;
}

function listSessionRecords(root) {
  const dir = sessionsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => loadSessionRecord(root, name))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function resolveSessionId(root, idOrLast) {
  if (!idOrLast || idOrLast === 'last') {
    const sessions = listSessionRecords(root);
    return sessions.length ? sessions[sessions.length - 1].id : null;
  }
  if (loadSessionRecord(root, idOrLast)) return idOrLast;
  const matches = listSessionRecords(root).filter((session) => session.id.startsWith(idOrLast));
  if (matches.length === 1) return matches[0].id;
  return null;
}

function appendEvent(root, sessionId, event) {
  const normalized = { timestamp: new Date().toISOString(), sessionId, ...event };
  appendText(sessionEventsPath(root, sessionId), `${JSON.stringify(normalized)}\n`);
  if (normalized.type === 'stdout' || normalized.type === 'stderr') {
    appendText(sessionTranscriptPath(root, sessionId), normalized.text || '');
  } else if (normalized.type === 'stdin') {
    appendText(sessionTranscriptPath(root, sessionId), `\n[agentkodex input] ${normalized.text || ''}`);
  } else if (normalized.type === 'state') {
    appendText(sessionTranscriptPath(root, sessionId), `\n[state] ${normalized.from || 'unknown'} -> ${normalized.to || 'unknown'}\n`);
  } else if (normalized.type === 'approval') {
    appendText(sessionTranscriptPath(root, sessionId), `\n[approval] ${normalized.approval?.id || ''} ${normalized.approval?.status || 'pending'}\n`);
  } else if (normalized.message) {
    appendText(sessionTranscriptPath(root, sessionId), `\n[system] ${normalized.message}\n`);
  }
  return normalized;
}

function readEvents(root, sessionId, limit = 0) {
  const file = sessionEventsPath(root, sessionId);
  if (!fs.existsSync(file)) return [];
  const lines = readText(file).split(/\r?\n/).filter(Boolean);
  const chosen = limit > 0 ? lines.slice(Math.max(0, lines.length - limit)) : lines;
  return chosen.map((line) => {
    try { return JSON.parse(line); } catch (_) { return { type: 'raw', text: line }; }
  });
}

module.exports = {
  createSessionRecord,
  loadSessionRecord,
  updateSessionRecord,
  listSessionRecords,
  resolveSessionId,
  appendEvent,
  readEvents,
};
