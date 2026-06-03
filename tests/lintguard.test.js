'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { runLintguardCheck } = require('../src/lintguard/runner');
const { runGateCommands } = require('../src/gates');

test('lintguard sidecar rejects missing or invalid token when auth is enabled', async () => {
  const server = await fakeLintguardServer('secret', { allowed: true, files_checked: 1, violations: [] });
  try {
    const missing = await runLintguardCheck({ url: server.url, authRequired: true });
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join('\n'), /no token/i);

    const invalid = await runLintguardCheck({ url: server.url, authRequired: true, token: 'wrong' });
    assert.equal(invalid.ok, false);
    assert.match(invalid.errors.join('\n'), /HTTP 401/);
  } finally {
    await server.close();
  }
});

test('lintguard sidecar accepts valid token and returns normalized json', async () => {
  const server = await fakeLintguardServer('secret', { allowed: true, files_checked: 2, violations: [] });
  try {
    const result = await runLintguardCheck({ url: server.url, authRequired: true, token: 'secret' });
    assert.equal(result.ok, true);
    assert.equal(result.violations, 0);
    assert.equal(result.filesChecked, 2);
  } finally {
    await server.close();
  }
});

test('lintguard gate blocks bad lint and passes clean lint', async () => {
  const bad = sampleProject('process.exit(1)');
  const badResults = await runGateCommands({ root: bad, runDir: bad, gates: ['lintguard'], mode: 'sandbox_auto', yes: true, echo: false });
  assert.equal(badResults[0].result.exitCode, 1);

  const clean = sampleProject('console.log("clean")');
  const cleanResult = await runLintguardCheck({ root: clean, local: true, mode: 'sandbox_auto', yes: true });
  assert.equal(cleanResult.ok, true);
});

test('agentkodex repo does not vendor disallowed lintguard artifacts', () => {
  const root = path.resolve(__dirname, '..');
  const files = walk(root).filter((file) => !file.includes(`${path.sep}.agentkodex${path.sep}`) && !file.includes(`${path.sep}node_modules${path.sep}`));
  assert.equal(files.some((file) => path.basename(file) === '.env'), false);
  const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /@emergentbase|posthog/i);
  assert.equal(files.some((file) => file.includes(`${path.sep}.emergent${path.sep}`)), false);
});

function sampleProject(lintBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-lintguard-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    scripts: { lint: `node lint.js`, typecheck: `node typecheck.js` },
  }));
  fs.writeFileSync(path.join(dir, 'lint.js'), lintBody);
  fs.writeFileSync(path.join(dir, 'typecheck.js'), 'console.log("types ok")');
  return dir;
}

function fakeLintguardServer(token, responseBody) {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Unauthorized' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(responseBody));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
