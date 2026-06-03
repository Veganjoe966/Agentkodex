'use strict';

const paths = require('./sessionPaths');
const records = require('./sessionRecord');
const io = require('./sessionIo');
const approvals = require('./sessionApprovalStore');
const processState = require('./sessionProcess');

function createSession(root, data = {}) {
  const record = records.saveSessionRecord(root, records.normalizeRecord(root, data));
  io.appendEvent(root, record.id, {
    type: 'session.created',
    agent: record.agent,
    task: record.task,
    command: record.command,
  });
  return record;
}

function createSessionRecord(root, data = {}) {
  return createSession(root, data);
}

function archiveSession(root, id) {
  return records.loadSessionRecord(root, id);
}

module.exports = {
  ...paths,
  ...records,
  ...io,
  ...approvals,
  createSession,
  createSessionRecord,
  archiveSession,
  isProcessAlive: processState.isProcessAlive,
  isPidAlive: processState.isProcessAlive,
};
