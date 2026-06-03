'use strict';

const path = require('path');
const { kodexPath } = require('./kodexStore');
const {
  ensureTokenFile,
  requireHttpToken,
  rejectBadOrigin,
  assertSafeBind,
} = require('./security/controlPlane');

function cockpitTokenPath(root) {
  return path.join(kodexPath(root, 'runtime'), 'cockpit.token');
}

function createCockpitAuth(root, options = {}) {
  return {
    token: ensureTokenFile(cockpitTokenPath(root), options.token || process.env.AGENTKODEX_COCKPIT_TOKEN || ''),
    tokenPath: cockpitTokenPath(root),
  };
}

function rejectUnauthorized(req, url, auth, host) {
  const tokenError = requireHttpToken(req, url, auth.token);
  if (tokenError) return tokenError;
  return rejectBadOrigin(req, host);
}

module.exports = {
  assertSafeBind,
  cockpitTokenPath,
  createCockpitAuth,
  rejectUnauthorized,
};
