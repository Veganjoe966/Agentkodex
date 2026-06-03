'use strict';

const path = require('path');
const { kodexPath } = require('../kodexStore');
const { ensureTokenFile, constantTimeMatch } = require('../security/controlPlane');

function daemonTokenPath(root) {
  return path.join(kodexPath(root, 'runtime'), 'daemon.token');
}

function ensureDaemonToken(root) {
  return ensureTokenFile(daemonTokenPath(root));
}

function withDaemonToken(root, payload = {}) {
  return { ...payload, token: ensureDaemonToken(root) };
}

function assertDaemonToken(root, request = {}) {
  if (constantTimeMatch(request.token, ensureDaemonToken(root))) return;
  throw new Error('Unauthorized daemon request.');
}

module.exports = {
  daemonTokenPath,
  ensureDaemonToken,
  withDaemonToken,
  assertDaemonToken,
};
