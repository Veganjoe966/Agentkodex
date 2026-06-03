'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runSwarm } = require('../src/swarm/run');
const { issueCapability } = require('../src/capabilities/issuer');

test('swarm reuses runtime sessions and skips shell phases without commands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-swarm-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' } }));
  const result = await runSwarm({
    root: dir,
    task: 'swarm test',
    roles: { builder: 'shell', reviewer: 'shell' },
    commands: { builder: 'node -e "console.log(\'builder\')"' },
    mode: 'sandbox_auto',
    gates: ['none'],
    yes: true,
    wait: true,
  });
  assert.ok(fs.existsSync(path.join(result.dir, 'manifest.json')));
  assert.ok(result.manifest.phases.find((phase) => phase.phase === 'builder').sessionId);
  assert.equal(result.manifest.phases.find((phase) => phase.phase === 'reviewer').status, 'skipped');
});

test('swarm agent cannot reuse another agent capability', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-swarm-cap-'));
  const id = 'swarm-cap-test';
  const wrong = issueCapability(dir, { sessionId: `swarm:${id}:builder:shell`, agentId: 'reviewer', phase: 'swarm', allowedActions: ['phase:execute'], allowedPaths: [dir] });
  const result = await runSwarm({
    id,
    root: dir,
    task: 'swarm cap test',
    roles: { builder: 'shell' },
    commands: { builder: 'node -e "console.log(\'blocked\')"' },
    capabilities: { builder: wrong },
    mode: 'sandbox_auto',
    yes: true,
    wait: true,
  });
  const builder = result.manifest.phases.find((phase) => phase.phase === 'builder');
  assert.equal(builder.status, 'denied');
  assert.match(builder.reason, /agent scope/i);
});
