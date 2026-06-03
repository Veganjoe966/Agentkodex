'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { authorizeCommand } = require('../src/authorization');
const { policyAllows } = require('../src/policy');
const { createAuditBundle } = require('../src/audit/bundle');
const { verifyAuditBundle } = require('../src/audit/verify');
const { writeAuditEvidence } = require('../src/audit/evidence');
const { collectRunGovernance } = require('../src/governance/summary');
const { issueRuntimeCapability, issueTournamentCapability } = require('../src/capabilities/phases');
const { createRun, ensureKodex } = require('../src/kodexStore');
const { runQualityGate } = require('../src/gates/qualityGate');
const { scoreMetrics } = require('../src/core/scoring/metrics');
const { AgentkodexDaemon } = require('../src/runtime/daemonServer');
const { ensureDaemonToken } = require('../src/runtime/daemonAuth');
const { runCommand } = require('../src/sessionRunner');
const { routeTask } = require('../src/router/route');
const { saveScorecards } = require('../src/scorecards/store');
const { decideFinalStatus } = require('../src/run');
const { runTournament } = require('../src/tournament');

test('runtime safe-command shell-control bypass is denied before execution', async () => {
  const root = temp('ak-adv-policy-');
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  const capability = issueRuntimeCapability(root, { sessionId: 's1', agentId: 'shell', cwd: root });
  const policy = policyAllows('cat README.md > PWNED', { mode: 'observe' });
  assert.equal(policy.allowed, false);
  const result = await runCommand('cat README.md > PWNED', {
    cwd: root,
    projectRoot: root,
    logDir: path.join(root, '.logs'),
    mode: 'observe',
    agent: 'shell',
    sessionId: 's1',
    capability,
    requireCapability: true,
    echo: false,
  });
  assert.equal(result.skipped, true);
  assert.equal(fs.existsSync(path.join(root, 'PWNED')), false);
});

test('sensitive Agentkodex runtime key and token files cannot be read by safe command policy', async () => {
  const root = temp('ak-adv-secret-read-');
  ensureKodex(root);
  issueRuntimeCapability(root, { sessionId: 's1', agentId: 'shell', cwd: root });
  ensureDaemonToken(root);
  for (const target of ['.agentkodex/runtime/capability-keys.json', '.agentkodex/runtime/daemon.token']) {
    const command = `cat ${target}`;
    const policy = policyAllows(command, { root, mode: 'observe' });
    assert.equal(policy.allowed, false);
    assert.equal(policy.classification.risk, 'blocked');
    const result = await runCommand(command, {
      cwd: root,
      projectRoot: root,
      logDir: path.join(root, `.logs-${path.basename(target)}`),
      mode: 'observe',
      echo: false,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.stdout, '');
  }
});

test('agentLaunch cannot bypass destructive command policy when bridge is unavailable', () => {
  const root = temp('ak-adv-agentlaunch-');
  const decision = authorizeCommand('rm -rf ./safe-target', {
    root,
    mode: 'supervised',
    agentLaunch: true,
    agentguard: false,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /approval|required/i);
});

test('capability path scope rejects symlink escape in daemon execution path', () => {
  const root = temp('ak-adv-scope-');
  const outside = temp('ak-adv-outside-');
  fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  const daemon = new AgentkodexDaemon(root);
  const capability = issueRuntimeCapability(root, { sessionId: 's1', agentId: 'custom', cwd: root });
  assert.throws(() => daemon.startSession({
    sessionId: 's1',
    agent: 'custom',
    command: 'pwd > escaped.txt',
    cwd: path.join(root, 'link'),
    mode: 'observe',
    capability,
  }), /path is not allowed/i);
  assert.equal(fs.existsSync(path.join(outside, 'escaped.txt')), false);
});

test('daemon live mutation denies token-only send without presented capability', async () => {
  const root = temp('ak-adv-daemon-send-');
  const daemon = new AgentkodexDaemon(root);
  const sessionId = 's-send';
  const capability = issueRuntimeCapability(root, { sessionId, agentId: 'custom', cwd: root });
  daemon.startSession({
    sessionId,
    agent: 'custom',
    command: 'node -e "process.stdin.on(\'data\',d=>require(\'fs\').appendFileSync(\'input.txt\',d))"',
    cwd: root,
    mode: 'sandbox_auto',
    yes: true,
    capability,
  });
  await sleep(250);
  const token = ensureDaemonToken(root);
  await assert.rejects(
    () => daemon.handleRequest({ type: 'send', token, sessionId, input: 'hello\n' }),
    /Missing Agentguard capability/i
  );
  await daemon.handleRequest({ type: 'kill', token, sessionId, capability });
  assert.equal(fs.existsSync(path.join(root, 'input.txt')), false);
});

test('daemon rejects oversized socket payload before parsing', async () => {
  const root = temp('ak-adv-daemon-large-');
  const daemon = new AgentkodexDaemon(root);
  await daemon.start();
  try {
    const response = await rawSocket(daemon.socketPath, `${'x'.repeat(1024 * 1024 + 1)}\n`);
    assert.match(response, /Daemon request too large/);
    assert.doesNotMatch(response, /\.js:\d+:\d+/);
  } finally {
    if (daemon.server) await new Promise((resolve) => daemon.server.close(resolve));
  }
});

test('audit bundle verification catches generated-file tampering', () => {
  const root = temp('ak-adv-bundle-');
  const run = createRun(root, 'tamper');
  fs.writeFileSync(path.join(run.dir, 'transcript.log'), 'ok\n');
  const bundle = createAuditBundle(root, { runId: run.id, out: path.join(root, 'bundle') });
  assert.equal(verifyAuditBundle(bundle.dir, { projectRoot: root }).ok, true);
  fs.appendFileSync(path.join(bundle.dir, 'summary.md'), '\nTAMPERED\n');
  assert.equal(verifyAuditBundle(bundle.dir, { projectRoot: root }).ok, false);
});

test('fake quality pass evidence does not hide earlier quality failure', () => {
  const root = temp('ak-adv-audit-fake-pass-');
  const run = createRun(root, 'fake pass');
  writeAuditEvidence(root, { type: 'quality_gate_result', ok: false, checks: [{ name: 'loc', errors: 1 }] }, { runDir: run.dir });
  fs.writeFileSync(path.join(run.dir, 'audit-evidence.jsonl'), '');
  writeAuditEvidence(root, { type: 'quality_gate_result', ok: true, checks: [] }, { runDir: run.dir });
  const governance = collectRunGovernance(root, run.dir);
  assert.equal(governance.qualityGateOk, false);
  assert.equal(governance.completionBlocked, true);
  assert.ok(governance.qualityViolationCount >= 1);
});

test('direct command attempts to mutate Agentkodex evidence are blocked', async () => {
  const root = temp('ak-adv-audit-mutate-');
  const run = createRun(root, 'mutate');
  const rel = path.relative(root, path.join(run.dir, 'audit-evidence.jsonl'));
  const commands = [
    `node -e "require('fs').writeFileSync('${rel}','{}')"`,
    `echo "{}" > ${rel}`,
    `rm ${rel}`,
  ];
  for (const command of commands) {
    const policy = policyAllows(command, { root, mode: 'trusted_auto', yes: true });
    assert.equal(policy.allowed, false);
    assert.equal(policy.classification.risk, 'blocked');
    const result = await runCommand(command, {
      cwd: root,
      projectRoot: root,
      logDir: path.join(root, `.logs-${commands.indexOf(command)}`),
      mode: 'trusted_auto',
      yes: true,
      echo: false,
    });
    assert.equal(result.skipped, true);
  }
});

test('quality gate blocks dynamic banned imports and missing deps without complexity string false positive', async () => {
  const root = temp('ak-adv-quality-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'q', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'dyn.js'), "async function x(){ return import('posthog-js'); }\n");
  assert.equal((await runQualityGate({ projectRoot: root, changedFiles: ['dyn.js'] })).ok, false);
  fs.writeFileSync(path.join(root, 'missing.js'), "const leftPad=require('left-pad'); module.exports=leftPad;\n");
  assert.equal((await runQualityGate({ projectRoot: root, changedFiles: ['missing.js'] })).ok, false);
  fs.writeFileSync(path.join(root, 'harmless.js'), "function harmless(){ return 'if if if if if if'; }\n");
  assert.equal((await runQualityGate({ projectRoot: root, changedFiles: ['harmless.js'], maxFunctionComplexity: 3 })).ok, true);
});

test('quality gate blocks nested and renamed env-looking files', async () => {
  const root = temp('ak-adv-env-files-');
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', '.env'), 'TOKEN=value\n');
  fs.writeFileSync(path.join(root, '.envrc'), 'export TOKEN=value\n');
  fs.writeFileSync(path.join(root, 'prod.env'), 'TOKEN=value\n');
  const result = await runQualityGate({ projectRoot: root, changedFiles: ['config/.env', '.envrc', 'prod.env'] });
  assert.equal(result.ok, false);
  const details = result.checks.flatMap((check) => check.details || []).join('\n');
  assert.match(details, /config[/\\]\.env/);
  assert.match(details, /\.envrc/);
  assert.match(details, /prod\.env/);
});

test('completion, routing, and tournament reject untrusted or denied evidence', async () => {
  assert.equal(decideFinalStatus({
    agentRun: { result: { exitCode: 0 } },
    gateResults: [],
    security: { findings: [] },
    gates: [],
    governance: { auditEvidenceMissing: true },
  }), 'failed_audit');

  const clean = { completion: true, gatePassCount: 1, gateFailCount: 0, durationMs: 1000 };
  const unsafe = { ...clean, securityDeniedCount: 5, failedCapabilityCount: 2, qualityViolationCount: 4, completionBlocked: true };
  assert.ok(scoreMetrics(unsafe) < scoreMetrics(clean));

  const routeRoot = temp('ak-adv-route-');
  saveScorecards(routeRoot, { agents: { evil: { agent: 'evil', runs: 99, successRate: 1, gatePassRate: 1, taskCategories: { security: 99 } } } });
  assert.equal(routeTask(routeRoot, 'security hardening').selected, null);

  const tourRoot = temp('ak-adv-tour-');
  fs.writeFileSync(path.join(tourRoot, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  const id = 'denied-tour';
  const wrong = issueTournamentCapability(tourRoot, {
    tournamentId: id,
    agentId: 'other',
    cwd: path.join(tourRoot, '.agentkodex', 'tournaments', id, 'workspaces', 'local'),
  });
  const result = await runTournament({ root: tourRoot, id, task: 'x', agents: ['local'], capabilities: { local: wrong }, echo: false });
  assert.equal(result.winner, null);
});

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rawSocket(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      try { client.destroy(); } catch (_) {}
      resolve(buffer);
    }, 2000);
    client.on('connect', () => client.write(payload));
    client.on('data', (chunk) => { buffer += chunk.toString(); });
    client.on('end', () => {
      clearTimeout(timer);
      resolve(buffer);
    });
    client.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
