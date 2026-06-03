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
  return { ...payload, token: ensureSessionToken(session) };
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
