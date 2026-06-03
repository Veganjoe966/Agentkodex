'use strict';

const path = require('path');
const { exists, readText, writeText, appendText } = require('../utils');
const { redactSecrets, redactObject } = require('../security/redaction');
const { normalizeRecord, loadSessionRecord, saveSessionRecord } = require('./sessionRecord');

function appendEvent(arg1, arg2, arg3) {
  const { root, id, event } = normalizeEventArgs(arg1, arg2, arg3);
  const record = loadSessionRecord(root, id) || normalizeRecord(root, { id });
  const payload = redactObject({ ts: new Date().toISOString(), timestamp: new Date().toISOString(), sessionId: id, ...event });
  appendText(record.files.events, `${JSON.stringify(payload)}\n`);
  return payload;
}

function appendSessionEvent(session, event) {
  return appendEvent(session, event);
}

function appendTranscript(arg1, arg2, arg3) {
  const { root, id, text } = normalizeTextArgs(arg1, arg2, arg3);
  const record = loadSessionRecord(root, id) || normalizeRecord(root, { id });
  appendText(record.files.transcript, redactSecrets(String(text || '')));
}

function appendInput(root, id, data) {
  const record = loadSessionRecord(root, id) || normalizeRecord(root, { id });
  appendText(record.files.input, redactSecrets(String(data || '')));
  appendEvent(root, id, { type: 'input.logged', bytes: Buffer.byteLength(String(data || '')) });
}

function writePrompt(session, text) {
  const file = session.promptFile || path.join(session.sessionDir || session.dir, 'prompt.md');
  writeText(file, text);
  return file;
}

function appendInbox(session, type, payload = {}) {
  const current = loadSessionRecord(session.root, session.id) || session;
  const seq = Number(current.lastInboxWrittenSeq || 0) + 1;
  const item = { seq, ts: new Date().toISOString(), type, payload };
  appendText(current.files.inbox, `${JSON.stringify(item)}\n`);
  saveSessionRecord(current.root, { ...current, lastInboxWrittenSeq: seq });
  return item;
}

function readInbox(session, afterSeq = 0) {
  const current = loadSessionRecord(session.root, session.id) || session;
  if (!exists(current.files.inbox)) return [];
  return readText(current.files.inbox)
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseJsonLine)
    .filter((item) => item && Number(item.seq || 0) > Number(afterSeq || 0));
}

function normalizeEventArgs(arg1, arg2, arg3) {
  if (typeof arg1 === 'object' && arg1 && arg1.id) return { root: arg1.root, id: arg1.id, event: arg2 || {} };
  return { root: arg1, id: arg2, event: arg3 || {} };
}

function normalizeTextArgs(arg1, arg2, arg3) {
  if (typeof arg1 === 'object' && arg1 && arg1.id) return { root: arg1.root, id: arg1.id, text: arg2 };
  return { root: arg1, id: arg2, text: arg3 };
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

module.exports = {
  appendEvent,
  appendSessionEvent,
  appendTranscript,
  appendInput,
  appendInbox,
  readInbox,
  writePrompt,
};
