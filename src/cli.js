'use strict';

const path = require('path');
const { parseArgs, stringFlag, listFlag, booleanFlag } = require('./args');
const { discoverProject, selectCommands } = require('./discovery');
const { ensureKodex, loadConfig, saveConfig, saveDiscovery, kodexPath } = require('./kodexStore');
const { renderAgentTable, setAgentCommand, detectAgent, recommendAgents } = require('./agents');
const { runTask } = require('./run');
const { runTournament } = require('./tournament');
const { renderRunHtml, resolveRun } = require('./report');
const { readText, readJson, exists } = require('./utils');
const { createTaskBrief, createPlan } = require('./prompts');
const { daemonCommand, sessionCommand, approvalsCommand } = require('./runtimeCli');
const { cockpitCommand } = require('./cockpit');
const { gatesCommand } = require('./gatesCli');
const { auditBundleCommand, auditCommand } = require('./audit/command');
const { helpText } = require('./help');
const { intelligenceCommand } = require('./intelligence/command');
const { routeCommand } = require('./router/command');
const { scorecardsCommand } = require('./scorecards/command');
const { swarmCommand } = require('./swarm/command');
const { quickstartCommand } = require('./onboarding/quickstart');
const { findAgentguardSource } = require('./agentguard/bridge');
const { lintguardCommand } = require('./lintguard/command');
const { qualityCommand } = require('./gates/qualityCommand');
const { governanceCommand } = require('./governance/command');
const { keysCommand } = require('./keys/command');
const { policyCommand } = require('./policy/command');
const { releaseCommand } = require('./release/command');
const { setupCommand } = require('./setup/agentSetup');
const { askCommand } = require('./ask/command');
const { chatCommand } = require('./chat/command');
const { isFailureStatus, setExitCodeForFailure } = require('./statusContract');
const { reconcileRunStatus } = require('./runtime/lifecycle');

async function main(argv) {
  const [command = 'help', ...rest] = argv;
  switch (command) {
    case 'init':
      return initCommand(rest);
    case 'discover':
      return discoverCommand(rest);
    case 'quickstart':
      return quickstartCommand(rest);
    case 'setup':
      return setupCommand(rest);
    case 'ask':
      return askCommand(rest);
    case 'chat':
      return chatCommand(rest);
    case 'run':
      return runCommand(rest);
    case 'gates':
      return gatesCommand(rest);
    case 'lintguard':
      return lintguardCommand(rest);
    case 'quality':
      return qualityCommand(rest);
    case 'keys':
      return keysCommand(rest);
    case 'governance':
      return governanceCommand(rest);
    case 'audit-bundle':
      return auditBundleCommand(rest);
    case 'audit':
      return auditCommand(rest);
    case 'intelligence':
      return intelligenceCommand(rest);
    case 'route':
      return routeCommand(rest);
    case 'swarm':
      return swarmCommand(rest);
    case 'tournament':
      return tournamentCommand(rest);
    case 'replay':
      return replayCommand(rest);
    case 'status':
      return statusCommand(rest);
    case 'report':
      return reportCommand(rest);
    case 'daemon':
      return daemonCommand(rest);
    case 'cockpit':
      return cockpitCommand(rest);
    case 'session':
    case 'sessions':
      return sessionCommand(rest);
    case 'attach':
      return sessionCommand(['attach', ...rest]);
    case 'approvals':
    case 'approval':
      return approvalsCommand(rest);
    case 'approve':
      return approvalsCommand(['approve', ...rest]);
    case 'deny':
      return approvalsCommand(['deny', ...rest]);
    case 'agents':
      return agentsCommand(rest);
    case 'policy':
      return policyCommand(rest);
    case 'release':
      return releaseCommand(rest);
    case 'suggest':
      return suggestCommand(rest);
    case 'plan':
      return planCommand(rest);
    case 'kodex':
      return kodexCommand(rest);
    case 'doctor':
      return doctorCommand(rest);
    case 'help':
    case '--help':
    case '-h':
      console.log(helpText(rest[0] === 'all' ? 'all' : 'short'));
      return;
    case 'version':
    case '--version':
    case '-v':
      console.log(require('../package.json').version);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(helpText());
      process.exitCode = 1;
  }
}

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'cwd', stringFlag(flags, 'repo', process.cwd())));
}

function hasFlag(flags, name) {
  return Object.prototype.hasOwnProperty.call(flags, name);
}

async function initCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const base = ensureKodex(root);
  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  console.log(`Initialized Agentkodex at ${base}`);
  console.log(`Discovered ${discovery.commands.length} commands.`);
}

async function discoverCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  const agents = booleanFlag(flags, 'verifyAgents') || booleanFlag(flags, 'verify-agents')
    ? await detectConfiguredAgents(loadConfig(root))
    : null;
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ ...discovery, agents }, null, 2));
  else {
    console.log(`Project: ${discovery.projectName}`);
    console.log(`Languages: ${discovery.languages.join(', ') || 'unknown'}`);
    console.log(`Frameworks: ${discovery.frameworks.join(', ') || 'unknown'}`);
    console.log(`Package manager: ${discovery.packageManager || 'unknown'}`);
    console.log('Commands:');
    for (const command of discovery.commands) console.log(`- ${command.name}: ${command.command} (${command.evidence})`);
    if (agents) {
      console.log('Agents:');
      for (const agent of agents) console.log(`- ${agent.id}: ${agent.ready ? 'ready' : agent.readinessState || 'missing'}`);
    }
    console.log(`Saved: ${kodexPath(root, 'project.kodex.md')}`);
  }
}

async function runCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', '');
  const runtime = stringFlag(flags, 'runtime', 'oneshot');
  const cockpit = booleanFlag(flags, 'cockpit') || booleanFlag(flags, 'session') || ['session', 'interactive', 'cockpit', 'runtime-v2'].includes(runtime);

  if (cockpit) {
    return sessionCommand(['start', ...argv.filter((x) => x !== '--cockpit' && x !== '--session')]);
  }

  const result = await runTask({
    root,
    task,
    agent: stringFlag(flags, 'agent', ''),
    mode: stringFlag(flags, 'mode', ''),
    gates: hasFlag(flags, 'gates') ? listFlag(flags, 'gates', []) : undefined,
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    command: stringFlag(flags, 'command', '') || stringFlag(flags, 'shellCommand', stringFlag(flags, 'shell-command', '')) || stringFlag(flags, 'customCommand', stringFlag(flags, 'custom-command', '')),
    skipAgent: booleanFlag(flags, 'skipAgent') || booleanFlag(flags, 'skip-agent'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '0')) || 0) || undefined,
    winnerStrategy: stringFlag(flags, 'winner', stringFlag(flags, 'winnerStrategy', stringFlag(flags, 'winner-strategy', 'balanced'))),
    echo: !booleanFlag(flags, 'quiet'),
    pty: booleanFlag(flags, 'pty'),
  });
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(result.status, null, 2));
  setExitCodeForFailure(isFailureStatus(result.status.status));
}

async function tournamentCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', '');
  const result = await runTournament({
    root,
    task,
    agents: listFlag(flags, 'agents', []),
    mode: stringFlag(flags, 'mode', 'sandbox_auto'),
    gates: hasFlag(flags, 'gates') ? listFlag(flags, 'gates', []) : undefined,
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '0')) || 0) || undefined,
    echo: !booleanFlag(flags, 'quiet'),
    pty: booleanFlag(flags, 'pty'),
  });
  setExitCodeForFailure(!result.results?.length || result.results.some((item) => isFailureStatus(item.status) || item.status === 'skipped'));
}

async function replayCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const run = resolveRun(root, positionals[0] || 'last');
  if (!run) throw new Error('No Agentkodex run found.');
  const file = path.join(run.dir, 'transcript.log');
  console.log(readText(file, '(no transcript)'));
}

async function statusCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const run = resolveRun(root, positionals[0] || 'last');
  if (!run) throw new Error('No Agentkodex run found.');
  const status = reconcileRunStatus(root, readJson(path.join(run.dir, 'status.json'), {}));
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify(status, null, 2));
  else {
    console.log(`Run: ${run.id}`);
    console.log(`Status: ${status.status || 'unknown'}`);
    console.log(`Task: ${status.task || ''}`);
    console.log(`Agent: ${status.agent || ''}`);
    console.log(`Mode: ${status.mode || ''}`);
    console.log(`Runtime: ${status.runtime || 'oneshot'}`);
    console.log(`Directory: ${run.dir}`);
  }
  setExitCodeForFailure(isFailureStatus(status.status));
}

async function reportCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const out = renderRunHtml(root, positionals[0] || 'last');
  console.log(`Report: ${out}`);
}

async function agentsCommand(argv) {
  const first = argv[0] && !String(argv[0]).startsWith('-') ? argv[0] : 'list';
  const rest = first === 'list' ? argv.slice(argv[0] && !String(argv[0]).startsWith('-') ? 1 : 0) : argv.slice(1);
  const sub = first;
  const { flags, positionals } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  const config = loadConfig(root);

  if (sub === 'scorecards') return scorecardsCommand(rest);

  if (sub === 'list') {
    if (booleanFlag(flags, 'json')) {
      const agents = [];
      for (const id of Object.keys(config.agents || {})) agents.push(await detectAgent(config, id));
      console.log(JSON.stringify({ ok: true, agents }, null, 2));
      return;
    }
    console.log(renderAgentTable(config));
    return;
  }

  if (sub === 'detect') {
    const id = positionals[0] || stringFlag(flags, 'agent', config.defaultAgent || 'local');
    const detection = await detectAgent(config, id, { customCommand: stringFlag(flags, 'customCommand', stringFlag(flags, 'custom-command', '')) });
    console.log(JSON.stringify(detection, null, 2));
    return;
  }

  if (sub === 'set') {
    const id = positionals[0] || stringFlag(flags, 'agent', 'custom');
    const cmd = stringFlag(flags, 'cmd', stringFlag(flags, 'command', ''));
    if (!cmd) throw new Error('Missing --cmd. Example: agentkodex agents set custom --cmd "your-cli {promptFile}"');
    const stdin = flags.stdin === undefined ? null : booleanFlag(flags, 'stdin');
    setAgentCommand(config, id, cmd, stdin);
    saveConfig(root, config);
    console.log(`Saved agent ${id}: ${cmd}`);
    return;
  }

  throw new Error(`Unknown agents subcommand: ${sub}`);
}

async function suggestCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', '');
  const discovery = discoverProject(root);
  const recommendations = recommendAgents(task, discovery);
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ task, recommendations }, null, 2));
  else {
    console.log(`Recommended Agentkodex agents for: ${task || '(no task provided)'}`);
    recommendations.forEach((item, index) => console.log(`${index + 1}. ${item.agent} — ${item.reason}`));
  }
}

async function planCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  const task = positionals.join(' ').trim() || stringFlag(flags, 'task', '');
  if (!task) throw new Error('Missing task. Example: agentkodex plan "Add password reset"');
  const discovery = discoverProject(root);
  const gates = listFlag(flags, 'gates', ['lint', 'test', 'build']);
  const selected = gates.includes('none') ? [] : selectCommands(discovery, gates);
  const brief = createTaskBrief(task, discovery, { gates, agent: stringFlag(flags, 'agent', 'local'), mode: stringFlag(flags, 'mode', 'supervised') });
  const plan = createPlan(task, discovery, selected, { agent: stringFlag(flags, 'agent', 'local'), mode: stringFlag(flags, 'mode', 'supervised') });
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ taskBrief: brief, plan }, null, 2));
  else console.log(`${brief}\n${plan}`);
}

async function kodexCommand(argv) {
  const [sub = 'show', ...rest] = argv;
  const { flags } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  if (sub === 'show') {
    console.log(readText(kodexPath(root, 'project.kodex.md'), '(no project Kodex yet; run agentkodex discover)'));
    return;
  }
  if (sub === 'path') {
    console.log(kodexPath(root));
    return;
  }
  throw new Error(`Unknown kodex subcommand: ${sub}`);
}

async function doctorCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  const config = loadConfig(root);
  const { pingDaemon } = require('./runtime/client');
  const { listSessionStatuses } = require('./runtime/sessionManager');
  console.log('Agentkodex doctor');
  console.log(`root: ${root}`);
  console.log(`node: ${process.version}`);
  console.log(`package: ${require('../package.json').version}`);
  console.log(`kodex: ${kodexPath(root)}`);
  const sessions = listSessionStatuses(root);
  const live = sessions.filter((session) => session.live);
  console.log(`runtime: Runtime v2 per-session supervisors`);
  console.log(`sessions: ${sessions.length} total, ${live.length} live`);
  const daemon = await pingDaemon(root);
  console.log(`compat daemon: ${daemon ? `running pid=${daemon.pid}` : 'not running/not required'}`);
  const agSource = findAgentguardSource(root, config.agentguard || {});
  console.log(`agentguard: ${agSource ? `available (${agSource})` : config.agentguard?.required ? 'required but missing' : 'not available; JS policy fallback'}`);
  console.log('agents:');
  for (const id of Object.keys(config.agents || {})) {
    const detection = await detectAgent(config, id);
    const state = detection.ready ? 'ready' : detection.installed ? detection.readinessState || 'degraded' : 'missing';
    console.log(`- ${id}: ${state}${detection.binary ? ` (${detection.binary})` : ''} - ${detection.readiness?.hint || detection.reason || ''}`);
  }
  if (!exists(kodexPath(root, 'commands.kodex.json'))) console.log('hint: run agentkodex discover to populate project command memory.');
}

async function detectConfiguredAgents(config) {
  const rows = [];
  for (const id of Object.keys(config.agents || {})) {
    const detection = await detectAgent(config, id);
    rows.push({ id, ready: detection.ready, installed: detection.installed, readinessState: detection.readinessState, binary: detection.binary || null });
  }
  return rows;
}

module.exports = { main, helpText };
