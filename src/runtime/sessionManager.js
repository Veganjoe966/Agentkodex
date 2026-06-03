'use strict';
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const { discoverProject, selectCommands } = require('../discovery');
const { loadConfig, saveDiscovery, createRun, updateRunStatus, kodexPath, loadErrors, learnFromGateFailures } = require('../kodexStore');
const { getAgent, detectAgent, buildAgentCommand } = require('../agents');
const { createTaskBrief, createPlan, createMissionPrompt, createReleaseNotes } = require('../prompts');
const { createSession, getSession, listSessions, patchSession, resolveSessionId, readApprovals, isPidAlive, newSessionId } = require('./sessionStore');
const { readText, writeJson, writeText, exists, ensureDir, hashString, slugify } = require('../utils');
const { runCommand } = require('../sessionRunner');
const { scanDiff, renderSecurityReport } = require('../security');
const { createQaReport, renderQaReport, decideFinalStatus } = require('../run');
const { summarizeCommandResult, tail } = require('../commandResult');
const { withSessionToken } = require('./controlToken');
const { runLintguardGate } = require('../lintguard/gate');
const { runQualityGateAsGate } = require('../gates/qualityGate');
const { prepareRuntimeSecurity } = require('./sessionSecurity');
const { collectRunGovernance } = require('../governance/summary');
const { controlRequestError } = require('./controlErrors');
async function startAgentSession(options) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim();
  if (!task) throw new Error('Missing task. Example: agentkodex session start "Fix failing tests"');

  const config = loadConfig(root);
  const agentId = options.agent || config.defaultAgent || 'local';
  const mode = options.mode || config.defaultMode || 'supervised';
  const gates = options.gates || config.requiredGates || ['lint', 'test', 'build'];
  const yes = Boolean(options.yes);
  const pty = Boolean(options.pty);
  const closeStdinAfterInitial = Boolean(options.closeStdinAfterInitial);
  const run = createRun(root, task);
  updateRunStatus(run.dir, { status: 'session_preparing', agent: agentId, mode, gates, runtime: 'cockpit' });

  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  writeJson(path.join(run.dir, 'discovery.json'), discovery);
  const selectedCommands = gates.includes('none') ? [] : selectCommands(discovery, gates);
  const taskBrief = createTaskBrief(task, discovery, { gates, agent: agentId, mode });
  const plan = createPlan(task, discovery, selectedCommands, { agent: agentId, mode });
  const projectKodex = readText(kodexPath(root, 'project.kodex.md'));
  const errorsKodex = JSON.stringify(loadErrors(root), null, 2);
  const missionPrompt = createMissionPrompt({ task, discovery, projectKodex, plan, taskBrief, errorsKodex });

  const promptFile = path.join(run.dir, 'mission.prompt.md');
  writeText(path.join(run.dir, 'task-brief.yaml'), taskBrief);
  writeText(path.join(run.dir, 'plan.md'), plan);
  writeText(promptFile, missionPrompt);
  writeJson(path.join(run.dir, 'selected-gates.json'), selectedCommands);

  const { command, detection, stdin } = await resolveSessionCommand({ root, runDir: run.dir, config, agentId, task, missionPrompt, promptFile, options });
  const trustedAgentLaunch = Boolean(detection.trustedLaunch && !options.command);
  const sessionId = options.sessionId || newSessionId(`${agentId}:${task}`);
  const security = prepareRuntimeSecurity({
    root,
    runDir: run.dir,
    sessionId,
    agentId,
    command,
    mode,
    yes,
    task,
    trustedAgentLaunch,
    adapterKind: detection.kind || detection.adapterKind,
    config,
    cwd: root,
  });
  const { policy, securityDecision, capability } = security;
  writeJson(path.join(run.dir, 'session-command.json'), { agent: agentId, command, detection, stdin, policy, securityDecision, capability });
  if (!policy.allowed) {
    updateRunStatus(run.dir, { status: policy.requiresApproval ? 'session_blocked_approval' : 'session_blocked_policy', policy, securityDecision });
    if (!policy.requiresApproval) throw new Error(`Blocked by policy: ${policy.reason}`);
    throw new Error(`Command requires approval before session start: ${policy.reason}. Re-run with --yes, --mode sandbox_auto, or configure a safer command.`);
  }

  const session = createSession(root, {
    id: sessionId,
    runId: run.id,
    runDir: run.dir,
    task,
    agent: agentId,
    mode,
    gates,
    cwd: root,
    command,
    policy,
    securityDecision,
    capabilities: { runtime: capability },
    pty,
    initialInputFile: stdin && options.noInitialPrompt !== true ? promptFile : null,
    closeStdinAfterInitial,
    status: 'starting',
    state: 'starting',
    files: {
      runStatus: path.join(run.dir, 'status.json'),
      missionPrompt: promptFile,
    },
  });
  writeJson(path.join(run.dir, 'session.json'), session);

  const supervisorPath = path.join(__dirname, 'supervisor.js');
  const supervisor = spawn(process.execPath, [supervisorPath, '--metadata', path.join(session.dir, 'metadata.json')], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  });
  supervisor.unref();

  patchSession(root, session.id, { supervisorPid: supervisor.pid, status: 'starting', state: 'starting' });
  updateRunStatus(run.dir, { status: 'session_running', runtime: 'cockpit', sessionId: session.id, sessionDir: session.dir });

  const live = await waitForSession(root, session.id, 3000).catch(() => null);
  return live ? live.session : getSession(root, session.id);
}

async function resolveSessionCommand({ root, runDir, config, agentId, task, missionPrompt, promptFile, options }) {
  if (options.command) {
    return { command: options.command, detection: { explicit: true, installed: true }, stdin: Boolean(options.stdin || options.sendPrompt) };
  }

  const agent = getAgent(config, agentId);
  if (agent.id === 'local') {
    const command = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'sh');
    return { command, detection: { installed: true, localShell: true }, stdin: false };
  }

  const detection = await detectAgent(config, agentId);
  writeJson(path.join(runDir, 'agent-detection.json'), detection);
  if (!detection.ready) throw new Error(detection.readiness?.hint || detection.reason || `Agent is not ready: ${agentId}`);

  const command = buildAgentCommand(detection, {
    promptFile,
    promptText: missionPrompt,
    cwd: root,
    runDir,
    task,
  });
  if (!command) throw new Error(`No command template configured for agent: ${agentId}`);
  return { command, detection, stdin: Boolean(detection.stdin) };
}

function requestSession(root, idOrLast, payload, options = {}) {
  const session = getSession(root, idOrLast || 'last');
  if (!session) return Promise.reject(new Error(`Session not found: ${idOrLast || 'last'}`));
  const socketPath = session.socketPath;
  if (!socketPath) return Promise.reject(new Error(`Session ${session.id} does not have a control socket. It may have been created by an older Agentkodex runtime.`));
  const timeoutMs = Number(options.timeoutMs || 5000);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch (_) {}
      reject(controlRequestError(session, new Error('Timed out waiting for session control response.')));
    }, timeoutMs);
    timer.unref();
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(withSessionToken(session, payload))}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      clearTimeout(timer);
      const line = buffer.slice(0, buffer.indexOf('\n'));
      try {
        const parsed = JSON.parse(line);
        if (!parsed.ok) reject(new Error(parsed.error || 'Session request failed'));
        else resolve(parsed);
      } catch (error) {
        reject(error);
      } finally {
        try { socket.end(); } catch (_) {}
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(controlRequestError(session, error));
    });
  });
}

async function waitForSession(root, id, timeoutMs = 3000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await requestSession(root, id, { action: 'status' }, { timeoutMs: 350 });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error('Session did not become available.');
}

async function sendToSession(root, id, message, options = {}) {
  return requestSession(root, id || 'last', { action: 'send', message, newline: options.newline !== false });
}

async function interruptSession(root, id) {
  return requestSession(root, id || 'last', { action: 'interrupt' });
}

async function killSession(root, id) {
  return requestSession(root, id || 'last', { action: 'kill' });
}

async function approveSession(root, id, approvalId, input) {
  return requestSession(root, id || 'last', { action: 'approve', approvalId, input });
}

async function denySession(root, id, approvalId, input) {
  return requestSession(root, id || 'last', { action: 'deny', approvalId, input });
}

async function finalizeSession(root, idOrLast = 'last', options = {}) {
  const session = getSession(root, idOrLast);
  if (!session) throw new Error(`Session not found: ${idOrLast}`);
  if (['running', 'starting'].includes(session.status) && !options.force) {
    throw new Error(`Session ${session.id} is still ${session.status}. Use --force to finalize anyway.`);
  }
  const runDir = session.runDir;
  if (!runDir) throw new Error(`Session ${session.id} is not linked to a run directory.`);
  const config = loadConfig(root);
  const mode = options.mode || session.mode || config.defaultMode || 'supervised';
  const gates = options.gates || session.gates || config.requiredGates || ['lint', 'test', 'build'];
  const timeoutMs = Number(options.timeoutMs || config.commandTimeoutMs || 1800000);
  const yes = Boolean(options.yes);
  const echo = options.echo !== false;
  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  const selectedCommands = gates.includes('none') ? [] : selectCommands(discovery, gates);

  updateRunStatus(runDir, { status: 'session_gates_running', gates });
  const logPaths = {
    transcriptFile: path.join(runDir, 'transcript.log'),
    commandsFile: path.join(runDir, 'commands.log'),
    policyFile: path.join(runDir, 'policy.log'),
  };
  const gateResults = [];
  const gateOutputDir = path.join(runDir, 'gate-outputs');
  ensureDir(gateOutputDir);
  for (let index = 0; index < selectedCommands.length; index += 1) {
    const gateCommand = selectedCommands[index];
    if (gateCommand.gate === 'lintguard') {
      gateResults.push(await runLintguardGate(root, gateOutputDir, { mode, yes, timeoutMs }));
      continue;
    }
    if (gateCommand.gate === 'quality') {
      gateResults.push(await runQualityGateAsGate(root, gateOutputDir, { mode, yes, timeoutMs, runDir }));
      continue;
    }
    if (gateCommand.skipped) {
      gateResults.push({ gate: gateCommand.gate, skipped: true, reason: gateCommand.reason });
      continue;
    }
    const outputPath = gateOutputFile(gateOutputDir, gateCommand, index);
    const result = await runCommand(gateCommand.command, {
      cwd: root,
      logDir: runDir,
      mode,
      yes,
      timeoutMs,
      echo,
      pty: Boolean(options.pty),
      outputFile: outputPath,
      ...logPaths,
    });
    gateResults.push({ gate: gateCommand.gate, name: gateCommand.name, command: gateCommand.command, outputPath, result: summarizeCommandResult(result) });
  }
  writeJson(path.join(runDir, 'gate-results.json'), gateResults);
  const learned = learnFromGateFailures(root, gateResults);
  writeJson(path.join(runDir, 'learned-errors.json'), learned);

  const diffStat = getGitOutput(root, ['diff', '--stat'], 20000);
  const diff = getGitOutput(root, ['diff', '--'], 300000);
  writeText(path.join(runDir, 'diff.stat'), diffStat || '');
  writeText(path.join(runDir, 'diff.patch'), diff || '');
  const security = scanDiff(diff || '');
  writeJson(path.join(runDir, 'security-report.json'), security);
  writeText(path.join(runDir, 'security-report.md'), renderSecurityReport(security));
  const agentRun = {
    agent: session.agent,
    command: session.command,
    result: {
      command: session.command,
      cwd: session.cwd,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      exitCode: session.exitCode,
      signal: session.signal,
      skipped: false,
      stdoutTail: tail(readText(session.files?.transcript || '', ''), 4000),
      stderrTail: '',
      durationMs: session.startedAt && session.endedAt ? Date.parse(session.endedAt) - Date.parse(session.startedAt) : undefined,
    },
  };
  const governance = collectRunGovernance(root, runDir, { gateResults });
  const qa = createQaReport({ task: session.task, gateResults, agentRun, security, diffStat, governance });
  writeJson(path.join(runDir, 'qa-report.json'), qa);
  writeText(path.join(runDir, 'qa-report.md'), renderQaReport(qa));
  const finalStatus = decideFinalStatus({ agentRun, gateResults, security, gates, governance });
  const finalReport = createReleaseNotes({ task: session.task, status: finalStatus, gateResults, security, diffStat });
  writeText(path.join(runDir, 'final-report.md'), finalReport);
  const status = updateRunStatus(runDir, {
    status: finalStatus,
    runtime: 'cockpit',
    completedAt: new Date().toISOString(),
    sessionId: session.id,
    qa,
    governance,
    security,
    gates: gateResults,
  });
  patchSession(root, session.id, { finalizedAt: new Date().toISOString(), finalStatus });
  return { session, status, qa, security, gateResults, runDir };
}

function getGitOutput(root, args, maxBytes) {
  if (!exists(path.join(root, '.git'))) return '';
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: maxBytes + 1024 });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  return out.length > maxBytes ? `${out.slice(0, maxBytes)}\n[truncated]\n` : out;
}

function gateOutputFile(outputDir, gateCommand, index) {
  const name = slugify(gateCommand.gate || gateCommand.name || 'gate', 36);
  return path.join(outputDir, `${String(index + 1).padStart(2, '0')}-${name}-${hashString(gateCommand.command, 8)}.log`);
}

async function startInteractiveSession(options) {
  const session = await startAgentSession(options);
  return { session, command: session.command };
}

async function closeSessionStdin(root, id) {
  return requestSession(root, id || 'last', { action: 'close_stdin' });
}

function getSessionStatus(root, idOrLast = 'last') {
  const session = getSession(root, idOrLast);
  if (!session) return null;
  const approvals = readApprovals(root, session.id);
  const pendingApprovals = approvals.filter((item) => item.status === 'pending' || item.status === 'open');
  const maybeLive = ['created', 'starting', 'running', 'stopping', 'awaiting_approval'].includes(session.status);
  return {
    ...session,
    live: maybeLive && (isPidAlive(session.pid) || isPidAlive(session.supervisorPid)),
    pendingApprovals,
  };
}

function listSessionStatuses(root) {
  return listSessions(root).map((session) => getSessionStatus(root, session.id)).filter(Boolean);
}

function replaySession(root, idOrLast = 'last', options = {}) {
  const session = getSession(root, idOrLast);
  if (!session) throw new Error(`Session not found: ${idOrLast}`);
  if (options.events) return readText(session.files.events, '(no session events)');
  return readText(session.files.transcript, '(no transcript)');
}

async function runSessionGates(root, idOrLast = 'last', options = {}) {
  const result = await finalizeSession(root, idOrLast, { ...options, force: true });
  return result.gateResults;
}

function renderSessionList(root) {
  const rows = listSessions(root);
  if (!rows.length) return 'No Agentkodex sessions found.';
  const lines = ['Agentkodex sessions:'];
  for (const item of rows) {
    lines.push(`- ${item.id}`);
    lines.push(`  state: ${item.state || item.status}`);
    lines.push(`  agent: ${item.agent || ''}`);
    lines.push(`  task: ${item.task || ''}`);
    lines.push(`  pid: ${item.pid || '(none)'}`);
    lines.push(`  dir: ${item.dir}`);
  }
  return lines.join('\n');
}

module.exports = {
  startAgentSession,
  startInteractiveSession,
  waitForSession,
  sendToSession,
  interruptSession,
  killSession,
  closeSessionStdin,
  approveSession,
  denySession,
  finalizeSession,
  getSessionStatus,
  listSessionStatuses,
  replaySession,
  runSessionGates,
  renderSessionList,
};
