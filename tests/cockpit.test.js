'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { ensureKodex } = require('../src/kodexStore');
const { startCockpit } = require('../src/cockpit');

test('cockpit exposes health and session APIs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-cockpit-'));
  ensureKodex(root);
  const server = await startCockpit(root, { host: '127.0.0.1', port: 0 });
  try {
    const { port } = server.address();
    const health = await getJson(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.root, root);
    const sessions = await getJson(`http://127.0.0.1:${port}/api/sessions`);
    assert.deepEqual(sessions.sessions, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}
