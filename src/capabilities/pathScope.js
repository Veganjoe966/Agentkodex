'use strict';

const fs = require('fs');
const path = require('path');
const { isSubpath } = require('../utils');

function pathAllowed(allowedPaths, target) {
  if (!target) return true;
  const realTarget = realScopePath(target);
  return allowedPaths.some((allowed) => isSubpath(realScopePath(allowed), realTarget));
}

function normalizeCapabilityPath(filePath) {
  return realScopePath(filePath);
}

function realScopePath(filePath) {
  const resolved = path.resolve(filePath);
  const parts = resolved.split(path.sep);
  const prefix = resolved.startsWith(path.sep) ? path.sep : '';
  let cursor = prefix || parts.shift() || '.';
  const rest = [];
  const iterable = prefix ? parts.filter(Boolean) : parts;
  for (const part of iterable) {
    const next = path.join(cursor, part);
    if (exists(next)) cursor = next;
    else rest.push(part);
  }
  const realBase = safeRealpath(cursor);
  return rest.length ? path.join(realBase, ...rest) : realBase;
}

function exists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function safeRealpath(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch (_) {
    return path.resolve(filePath);
  }
}

module.exports = {
  normalizeCapabilityPath,
  pathAllowed,
  realScopePath,
};
