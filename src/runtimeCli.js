'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('./args');
const { ensureKodex } = require('./kodexStore');
const { readText } = require('./utils');
const { daemonLogPath } = require('./runtime/paths');
const { attachSession } = require('./runtime/attach');
const {
  startAgentSession,
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
} = require('./runtime/sessionManager');
const { listApprovals, resolveApproval, markApproval } = require('./runtime/approvalQueue');
const { gateResultsFailed, isFailureStatus, setExitCodeForFailure } = require('./statusContract');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

function hasFlag(flags, name) {
  return Object.prototype.hasOwnProperty.call(flags, name);
}

async function daemonCommand(argv) {
  const [sub = 'status', ...rest] = argv;
  const { flags } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  ensureKodex(root);

  if (sub === 'start') {
    console.log('Agentkodex Runtime v2 is ready. Sessions run under durable per-session supervisors.');
    console.log('Start one with: agentkodex session start --agent shell --command "npm test" "Run tests"');
    return;
  }

  if (sub === 'status') {
    const sessions = listSessionStatuses(root);
    const live = sessions.filter((s) => s.live);
    console.log('Agentkodex Runtime v2: per-session supervisor mode');
    console.log(`sessions: ${sessions.length}`);
    console.log(`live supervisors/processes: ${live.length}`);
    for (const session of live) {
      console.log(`- ${session.id} ${session.status}/${session.state} pid=${session.pid || '-'} supervisor=${session.supervisorPid || '-'} task=${session.task}`);
    }
    return;
  }

  if (sub === 'stop') {
    const sessions = listSessionStatuses(root).filter((s) => s.live);
    if (!sessions.length) {
      console.log('No live Agentkodex sessions to stop.');
      return;
    }
    if (!booleanFlag(flags, 'all')) throw new Error(`There are ${sessions.length} live sessions. Use: agentkodex daemon stop --all`);
    for (const session of sessions) {
      try {
        await killSession(root, session.id);
        console.log(`Stop requested: ${session.id}`);
      } catch (error) {
        console.log(`Could not stop ${session.id}: ${error.message}`);
      }
    }
    return;
  }

  if (sub === 'logs' || sub === 'log') {
    console.log(readText(daemonLogPath(root), '(global daemon log not used in per-session supervisor mode)'));
    return;
  }

  throw new Error(`Unknown daemon subcommand: ${sub}`);
}

async function sessionCommand(argv) {
  const [sub = 'list', ...rest] = argv;
  if (sub === 'start') return sessionStartCommand(rest);
  if (sub === 'list' || sub === 'ls') return sessionListCommand(rest);
  if (sub === 'status') return sessionStatusCommand(rest);
  if (sub === 'send') return sessionSendCommand(rest);
  if (sub === 'interrupt') return sessionInterruptCommand(rest);
  if (sub === 'kill') return sessionKillCommand(rest);
  if (sub === 'close-stdin' || sub === 'close_stdin') return sessionCloseStdinCommand(rest);
  if (sub === 'attach') return sessionAttachCommand(rest);
  if (sub === 'replay') return sessionReplayCommand(rest);
  if (sub === 'gates') return sessionGatesCommand(rest);
  if (sub === 'finalize' || sub === 'finish') return sessionFinalizeCommand(rest);
  throw new Error(`Unknown session subcommand: ${sub}`);
}

async function sessionStartCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', 'Interactive Agentkodex session');
  const gates = hasFlag(flags, 'gates') ? listFlag(flags, 'gates', []) : undefined;
  const session = await startAgentSession({
    root,
    task,
    agent: stringFlag(flags, 'agent', ''),
    mode: stringFlag(flags, 'mode', ''),
    gates,
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    command: stringFlag(flags, 'command', '') || stringFlag(flags, 'shellCommand', stringFlag(flags, 'shell-command', '')) || stringFlag(flags, 'customCommand', stringFlag(flags, 'custom-command', '')),
    stdin: booleanFlag(flags, 'stdin') || booleanFlag(flags, 'sendPrompt') || booleanFlag(flags, 'send-prompt'),
    noInitialPrompt: booleanFlag(flags, 'noInitialPrompt') || booleanFlag(flags, 'no-initial-prompt'),
    closeStdinAfterInitial: booleanFlag(flags, 'closeStdin') || booleanFlag(flags, 'close-stdin'),
    pty: booleanFlag(flags, 'pty'),
  });

  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(session, null, 2));
  else printSessionStarted(session);

  if (booleanFlag(flags, 'wait')) {
    const timeoutMs = Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '1800000')));
    const final = await waitForExit(root, session.id, timeoutMs);
    console.log(`Final status: ${final ? final.status : 'unknown'}/${final ? final.state : 'unknown'} exit=${final ? final.exitCode : 'unknown'}`);
    setExitCodeForFailure(final && final.exitCode !== undefined && Number(final.exitCode) !== 0);
    const shouldFinalize = !booleanFlag(flags, 'noFinalize') && !booleanFlag(flags, 'no-finalize') && !(Array.isArray(gates) && gates.includes('none'));
    if (shouldFinalize) {
      const finalized = await finalizeSession(root, session.id, {
        force: true,
        gates,
        yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
        pty: booleanFlag(flags, 'pty'),
        echo: !booleanFlag(flags, 'quiet'),
        timeoutMs,
      });
      console.log(`Finalized run: ${finalized.status.status}`);
      console.log(`Final report: ${path.join(finalized.runDir, 'final-report.md')}`);
      setExitCodeForFailure(isFailureStatus(finalized.status.status));
    }
  }
}

function printSessionStarted(session) {
  console.log(`Session: ${session.id}`);
  console.log(`Agent: ${session.agent}`);
  console.log(`Status: ${session.status}`);
  console.log(`State: ${session.state}`);
  console.log(`Command: ${session.command}`);
  console.log(`Run directory: ${session.runDir}`);
  console.log(`Attach: agentkodex session attach ${session.id}`);
  console.log(`Send: agentkodex session send ${session.id} "message"`);
  console.log(`Finalize: agentkodex session finalize ${session.id} --gates test,build --yes`);
}

async function waitForExit(root, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = getSessionStatus(root, sessionId);
  while (Date.now() < deadline) {
    last = getSessionStatus(root, sessionId);
    if (last && !['created', 'starting', 'running', 'stopping'].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

async function sessionListCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const sessions = listSessionStatuses(root);
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(sessions, null, 2));
  else console.log(renderSessionList(root));
}

async function sessionStatusCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const id = positionals[0] || 'last';

  if (booleanFlag(flags, 'watch') || booleanFlag(flags, 'w')) {
    const intervalMs = Math.max(250, Number(stringFlag(flags, 'intervalMs', stringFlag(flags, 'interval-ms', '1000'))) || 1000);
    while (true) {
      const current = getSessionStatus(root, id);
      if (!current) throw new Error('No Agentkodex session found.');
      if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ ts: new Date().toISOString(), session: current }));
      else {
        process.stdout.write('\x1Bc');
        renderSessionStatus(current);
        console.log(`\nRefreshing every ${intervalMs}ms. Press Ctrl+C to stop.`);
      }
      await sleep(intervalMs);
    }
  }

  const session = getSessionStatus(root, id);
  if (!session) throw new Error('No Agentkodex session found.');
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(session, null, 2));
  else renderSessionStatus(session);
  setExitCodeForFailure(isFailureStatus(session.status));
}

function renderSessionStatus(session) {
  console.log(`Session: ${session.id}`);
  console.log(`Status: ${session.status}`);
  console.log(`State: ${session.state}`);
  console.log(`Live: ${session.live ? 'yes' : 'no'}`);
  console.log(`Agent: ${session.agent}`);
  console.log(`PID: ${session.pid || '-'}`);
  console.log(`Supervisor PID: ${session.supervisorPid || '-'}`);
  console.log(`Task: ${session.task || ''}`);
  console.log(`Command: ${session.command || ''}`);
  console.log(`Transcript: ${session.files && session.files.transcript}`);
  if (session.openApprovalId) console.log(`Open approval: ${session.openApprovalId}`);
  if (session.pendingApprovals && session.pendingApprovals.length) {
    console.log(`Pending approvals: ${session.pendingApprovals.map((item) => item.id).join(', ')}`);
  }
}

async function sessionSendCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const sessionId = positionals[0] || 'last';
  const text = positionals.slice(1).join(' ') || stringFlag(flags, 'text', stringFlag(flags, 'input', ''));
  if (!text && !booleanFlag(flags, 'empty')) throw new Error('Missing text to send. Example: agentkodex session send last "run tests"');
  const result = await sendToSession(root, sessionId, text, { newline: !booleanFlag(flags, 'raw') });
  console.log(`Sent to ${result.session.id}`);
}

async function sessionInterruptCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const sessionId = positionals[0] || 'last';
  const result = await interruptSession(root, sessionId);
  console.log(`Interrupted ${result.session.id}`);
}

async function sessionKillCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const sessionId = positionals[0] || 'last';
  const result = await killSession(root, sessionId);
  console.log(`Kill requested for ${result.session.id}`);
}

async function sessionCloseStdinCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const sessionId = positionals[0] || 'last';
  const result = await closeSessionStdin(root, sessionId);
  console.log(`Closed stdin for ${result.session.id}`);
}

async function sessionAttachCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  await attachSession(root, positionals[0] || 'last', { fromStart: booleanFlag(flags, 'fromStart') || booleanFlag(flags, 'from-start') });
}

async function sessionReplayCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  console.log(replaySession(root, positionals[0] || 'last', { events: booleanFlag(flags, 'events') }));
}

async function sessionGatesCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const id = positionals[0] || 'last';
  const gates = listFlag(flags, 'gates', []);
  const result = await runSessionGates(root, id, {
    gates: gates.length ? gates : undefined,
    mode: stringFlag(flags, 'mode', 'supervised'),
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '1800000'))),
    echo: !booleanFlag(flags, 'quiet'),
    pty: booleanFlag(flags, 'pty'),
  });

  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('Session gates complete:');
    for (const gate of result) {
      if (gate.skipped) console.log(`- ${gate.gate}: skipped (${gate.reason})`);
      else console.log(`- ${gate.gate}: exit=${gate.result && gate.result.exitCode} command=${gate.command}`);
    }
  }
  setExitCodeForFailure(gateResultsFailed(result));
}

async function sessionFinalizeCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const id = positionals[0] || 'last';
  const gates = listFlag(flags, 'gates', []);
  const result = await finalizeSession(root, id, {
    gates: gates.length ? gates : undefined,
    mode: stringFlag(flags, 'mode', 'supervised'),
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '1800000'))),
    echo: !booleanFlag(flags, 'quiet'),
    pty: booleanFlag(flags, 'pty'),
    force: booleanFlag(flags, 'force') || booleanFlag(flags, 'f'),
  });

  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Finalized session: ${result.session.id}`);
    console.log(`Run status: ${result.status.status}`);
    console.log(`QA pass: ${result.qa.pass ? 'yes' : 'no'}`);
    console.log(`Run directory: ${result.runDir}`);
    console.log(`Final report: ${path.join(result.runDir, 'final-report.md')}`);
  }
  setExitCodeForFailure(isFailureStatus(result.status.status));
}

async function approvalsCommand(argv) {
  const [subMaybe = 'list', ...restMaybe] = argv;
  const sub = ['list', 'ls', 'approve', 'deny', 'status'].includes(subMaybe) ? subMaybe : 'list';
  const rest = (sub === 'list' && !['list', 'ls'].includes(subMaybe)) ? argv : restMaybe;
  if (sub === 'list' || sub === 'ls') return approvalsListCommand(rest);
  if (sub === 'approve') return approvalDecisionCommand(rest, 'approve');
  if (sub === 'deny') return approvalDecisionCommand(rest, 'deny');
  if (sub === 'status') return approvalsStatusCommand(rest);
  throw new Error(`Unknown approvals subcommand: ${sub}`);
}

async function approvalsListCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const openOnly = !booleanFlag(flags, 'all');
  const approvals = listApprovals(root, openOnly ? { status: 'open' } : {});
  const pendingAlso = openOnly ? listApprovals(root, { status: 'pending' }) : [];
  const all = uniqueById([...approvals, ...pendingAlso]);

  if (booleanFlag(flags, 'json')) {
    console.log(JSON.stringify(all, null, 2));
    return;
  }
  if (!all.length) {
    console.log(openOnly ? 'No pending Agentkodex approvals.' : 'No Agentkodex approvals found.');
    return;
  }
  for (const approval of all) {
    console.log(`${approval.id}  ${approval.status}  ${approval.kind}  session=${approval.sessionId || '-'}  risk=${approval.risk || '-'}`);
    if (approval.command) console.log(`  command: ${approval.command}`);
    if (approval.prompt || approval.text) console.log(`  prompt: ${approval.prompt || approval.text}`);
    if (approval.reason) console.log(`  reason: ${approval.reason}`);
  }
}

function uniqueById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

async function approvalsStatusCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const approval = resolveApproval(root, positionals[0] || 'last');
  if (!approval) throw new Error('No Agentkodex approval found.');
  console.log(JSON.stringify(approval, null, 2));
}

async function approvalDecisionCommand(argv, decision) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const id = positionals[0] || 'last';
  const input = stringFlag(flags, 'input', '');
  const approval = resolveApproval(root, id);
  if (!approval) throw new Error('No Agentkodex approval found.');

  let result = null;
  if (approval.sessionId) {
    result = decision === 'approve'
      ? await approveSession(root, approval.sessionId, approval.id, input || undefined)
      : await denySession(root, approval.sessionId, approval.id, input || undefined);
  } else {
    result = { approval: markApproval(root, approval.id, decision === 'approve' ? 'approved' : 'denied') };
  }
  console.log(`${decision === 'approve' ? 'Approved' : 'Denied'}: ${approval.id}`);
  if (result.session) console.log(`Session: ${result.session.id} ${result.session.status}/${result.session.state}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  daemonCommand,
  sessionCommand,
  approvalsCommand,
};
