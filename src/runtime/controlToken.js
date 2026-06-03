'use strict';

const path = require('path');
const { ensureTokenFile, constantTimeMatch } = require('../security/controlPlane');

function controlTokenPath(session) {
  return session.controlTokenPath || path.join(session.sessionDir || session.dir, 'control.token');
}

function ensureSessionToken(session) {
  return ensureTokenFile(controlTokenPath(session));
}

function withSessionToken(session, payload = {}) {
  const out = { ...payload, token: ensureSessionToken(session) };
  if (requiresCapability(payload.action || payload.type)) out.capability = session.capabilities?.runtime || null;
  return out;
}

function assertSessionToken(session, request = {}) {
  if (constantTimeMatch(request.token, ensureSessionToken(session))) return;
  throw new Error('Unauthorized session request.');
}

module.exports = {
  controlTokenPath,
  ensureSessionToken,
  withSessionToken,
  assertSessionToken,
};

function requiresCapability(action) {
  return ['send', 'approve', 'deny', 'close_stdin', 'close-stdin', 'interrupt', 'kill'].includes(String(action || ''));
}
