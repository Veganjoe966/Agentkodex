'use strict';

const http = require('http');
const https = require('https');
const { isLoopbackHost } = require('../security/controlPlane');
const { normalizeLintguardResult } = require('./normalize');

function checkSidecar(options = {}) {
  const url = new URL(options.url || process.env.LINTGUARD_URL || 'http://127.0.0.1:8001');
  if (!options.unsafePublic && !isLoopbackHost(url.hostname)) {
    return Promise.resolve(errorResult(`Refusing non-loopback Lintguard URL ${url.hostname}; use --unsafe-public to override.`, 'sidecar'));
  }
  const token = options.token || process.env.LINTGUARD_API_TOKEN || '';
  if (options.authRequired && !token) return Promise.resolve(errorResult('Lintguard auth is enabled but no token was provided.', 'sidecar'));
  const body = JSON.stringify({ files: options.files && options.files.length ? options.files : null });
  const client = url.protocol === 'https:' ? https : http;
  const requestOptions = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname.replace(/\/$/, '') || ''}/api/check`,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: Number(options.timeoutMs || 120000),
  };
  if (token) requestOptions.headers.authorization = `Bearer ${token}`;

  return new Promise((resolve) => {
    const req = client.request(requestOptions, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve(parseResponse(raw, res.statusCode, url)));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(errorResult('Lintguard sidecar timed out.', 'sidecar'));
    });
    req.on('error', (error) => resolve(errorResult(error.message, 'sidecar')));
    req.write(body);
    req.end();
  });
}

function parseResponse(raw, statusCode, url) {
  if (statusCode < 200 || statusCode >= 300) return errorResult(`Lintguard sidecar rejected request with HTTP ${statusCode}.`, 'sidecar', statusCode);
  try {
    return normalizeLintguardResult(JSON.parse(raw), { source: `sidecar:${url.origin}` });
  } catch (error) {
    return errorResult(`Lintguard sidecar returned invalid JSON: ${error.message}`, 'sidecar', statusCode);
  }
}

function errorResult(message, source, statusCode = null) {
  return {
    ok: false,
    allowed: false,
    violations: 1,
    errors: [message],
    warnings: [],
    filesChecked: 0,
    files_checked: 0,
    commandOutputs: [],
    source,
    statusCode,
  };
}

module.exports = {
  checkSidecar,
  errorResult,
};
