'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDir, readText } = require('../utils');
const { redactSecrets } = require('./redaction');

function secureDir(dirPath) {
  ensureDir(dirPath);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dirPath, 0o700); } catch (_) {}
  }
  return dirPath;
}

function ensureTokenFile(filePath, provided = '') {
  secureDir(path.dirname(filePath));
  if (provided) writeSecret(filePath, provided);
  const existing = readText(filePath, '').trim();
  if (existing) {
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    }
    return existing;
  }
  const token = randomToken();
  writeSecret(filePath, token);
  return token;
}

function writeSecret(filePath, value) {
  secureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${String(value).trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  }
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64').replace(/[+/=]/g, '');
}

function constantTimeMatch(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenFromHttpRequest(req, url) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return (bearer && bearer[1]) || req.headers['x-agentkodex-token'] || '';
}

function requireHttpToken(req, url, expected) {
  if (constantTimeMatch(tokenFromHttpRequest(req, url), expected)) return null;
  return { status: 401, body: { ok: false, error: 'unauthorized' } };
}

function rejectBadOrigin(req, expectedHost) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const requestHost = String(req.headers.host || expectedHost || '').split(':')[0];
    if (parsed.hostname !== requestHost && !sameLoopback(parsed.hostname, requestHost)) {
      return { status: 403, body: { ok: false, error: 'invalid request origin' } };
    }
  } catch (_) {
    return { status: 403, body: { ok: false, error: 'invalid request origin' } };
  }
  if (isMutating(req.method) && req.headers['x-agentkodex-csrf'] !== '1') return { status: 403, body: { ok: false, error: 'missing csrf header' } };
  return null;
}

function assertSafeBind(host, unsafePublic = false) {
  if (unsafePublic || isLoopbackHost(host)) return;
  throw new Error(`Refusing to bind Cockpit to non-loopback host ${host}. Use --unsafe-public only on a protected network.`);
}

function isLoopbackHost(host) {
  const value = String(host || '').toLowerCase();
  return ['127.0.0.1', 'localhost', '::1', ''].includes(value) || value.startsWith('127.');
}

function sameLoopback(left, right) {
  return isLoopbackHost(left) && isLoopbackHost(right);
}

function isMutating(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
}

function hardenSocket(socketPath) {
  if (!socketPath || process.platform === 'win32') return;
  try { fs.chmodSync(socketPath, 0o600); } catch (_) {}
}

function sanitizeError(error) {
  const message = error && error.message ? error.message : String(error || 'unknown error');
  return redactSecrets(message)
    .replace(/\s+at\s+.+/g, '')
    .replace(/\/[^\s"'<>]+\.sock\b/g, '[socket]')
    .replace(/\/[^\s"'<>]+\/(?:src|bin|tests)\/[^\s"'<>]+/g, '[internal-path]')
    .replace(/("signature"\s*:\s*")[^"]+"/gi, '$1[redacted]"')
    .replace(/\bsignature[:=][A-Za-z0-9+/=_-]+/gi, 'signature=[redacted]');
}

module.exports = {
  secureDir,
  ensureTokenFile,
  constantTimeMatch,
  tokenFromHttpRequest,
  requireHttpToken,
  rejectBadOrigin,
  assertSafeBind,
  isLoopbackHost,
  hardenSocket,
  sanitizeError,
};
