'use strict';

const path = require('path');
const crypto = require('crypto');
const { kodexPath } = require('../kodexStore');
const { readJson, writeJson } = require('../utils');
const { writeAuditEvidence } = require('../audit/evidence');

const WINDOW_MS = 60 * 1000;
const MAX_INVALID = 20;

function createRequestGuard(options = {}) {
  const root = options.root || null;
  const windowMs = Number(options.windowMs || WINDOW_MS);
  const maxInvalid = Number(options.maxInvalid || MAX_INVALID);
  const statePath = options.statePath || (root ? path.join(kodexPath(root, 'runtime'), 'socket-rate-limit.json') : null);
  return {
    validate(request) {
      if (!request || typeof request !== 'object') throw new Error('Invalid daemon request.');
      if (typeof request.type !== 'string' || !request.type.trim()) throw new Error('Invalid daemon request type.');
    },
    record(error, request = {}) {
      if (!/Unauthorized|Unknown daemon request|Invalid daemon request|request too large/i.test(String(error?.message || error))) return;
      const now = Date.now();
      const state = cleanup(loadState(statePath), now, windowMs);
      const key = identity(request);
      const current = state.buckets[key] || { count: 0, firstSeen: now, lastSeen: 0, expiresAt: now + windowMs };
      current.count += 1;
      current.lastSeen = now;
      current.expiresAt = now + windowMs;
      state.buckets[key] = current;
      saveState(statePath, state);
    },
    assert(request = {}) {
      const now = Date.now();
      const state = cleanup(loadState(statePath), now, windowMs);
      saveState(statePath, state);
      const bucket = state.buckets[identity(request)];
      if (bucket && bucket.count >= maxInvalid) {
        if (root) writeAuditEvidence(root, { type: 'daemon_request_rate_limited', allowed: false, bucket: identity(request), count: bucket.count });
        throw new Error('Too many invalid daemon requests.');
      }
    },
    statePath,
  };
}

function identity(request = {}) {
  const method = safePart(request.type || 'unknown');
  if (request.token) return `${method}:token:${hash(request.token)}`;
  return `${method}:local`;
}

function cleanup(state, now, windowMs) {
  const next = { buckets: {} };
  for (const [key, bucket] of Object.entries(state.buckets || {})) {
    if (Number(bucket.expiresAt || 0) > now) next.buckets[key] = bucket;
  }
  next.windowMs = windowMs;
  return next;
}

function loadState(file) {
  return file ? readJson(file, { buckets: {} }) : { buckets: {} };
}

function saveState(file, state) {
  if (!file) return;
  writeJson(file, state);
  try { require('fs').chmodSync(file, 0o600); } catch (_) {}
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function safePart(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || 'unknown';
}

module.exports = {
  createRequestGuard,
  identity,
};
