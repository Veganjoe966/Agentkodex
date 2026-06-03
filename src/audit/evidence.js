'use strict';

const path = require('path');
const { appendText, ensureDir, kodexPathFallback } = require('./evidenceUtils');
const { redactObject } = require('../security/redaction');

function writeAuditEvidence(root, event = {}, options = {}) {
  const record = redactObject({
    createdAt: new Date().toISOString(),
    source: 'agentkodex',
    ...event,
  });
  const line = `${JSON.stringify(record)}\n`;
  const files = [rootEvidencePath(root)];
  if (options.runDir) files.push(path.join(options.runDir, 'audit-evidence.jsonl'));
  for (const file of files) appendText(file, line);
  return record;
}

function rootEvidencePath(root) {
  return path.join(kodexPathFallback(root, '.agentkodex'), 'audit', 'evidence.jsonl');
}

module.exports = {
  writeAuditEvidence,
  rootEvidencePath,
};
