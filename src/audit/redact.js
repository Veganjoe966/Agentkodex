'use strict';

const path = require('path');
const { redactSecrets } = require('../policy');

const BLOCKED_PATH_PARTS = new Set(['node_modules', 'vendor', 'dist', 'build', '.next', 'coverage']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function mayCopyAuditPath(filePath) {
  const parts = path.normalize(filePath).split(path.sep);
  if (parts.some((part) => BLOCKED_PATH_PARTS.has(part))) return false;
  const base = path.basename(filePath).toLowerCase();
  if (base === '.env' || base.startsWith('.env.')) return false;
  return true;
}

function redactAuditText(text) {
  const before = String(text || '');
  const after = redactSecrets(before);
  return {
    text: after,
    changed: before !== after,
    markerCount: (after.match(/\[REDACTED/g) || []).length,
  };
}

module.exports = {
  MAX_TEXT_BYTES,
  mayCopyAuditPath,
  redactAuditText,
};
