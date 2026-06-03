'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { discoverProject, selectCommands } = require('./discovery');
const { loadConfig, saveDiscovery, createRun, updateRunStatus, kodexPath, loadErrors, learnFromGateFailures } = require('./kodexStore');
const { readText, writeJson, writeText, exists, ensureDir, hashString, slugify } = require('./utils');
const { createTaskBrief, createPlan, createMissionPrompt, createReleaseNotes } = require('./prompts');
const { getAgent, detectAgent, buildAgentCommand } = require('./agents');
const { runCommand } = require('./sessionRunner');
const { scanDiff, renderSecurityReport } = require('./security');
const { summarizeCommandResult } = require('./commandResult');
const { runLintguardGate } = require('./lintguard/gate');
const { runQualityGateAsGate } = require('./gates/qualityGate');
const { issueRuntimeCapability } = require('./capabilities/phases');
const { collectRunGovernance, blocksCompletion } = require('./governance/summary');
const { writeAuditEvidence } = require('./audit/evidence');

async function runTask(options) {
  const root = path.resolve(options.root || process.cwd());
  const task = String(options.task || '').trim();
  if (!task) throw new Error('Missing task. Example: agentkodex run "Fix failing tests"');

  const config = loadConfig(root);
  const agentId = options.agent || config.defaultAgent || 'local';
  const mode = options.mode || config.defaultMode || 'supervised';
  const gates = options.gates || config.requiredGates || ['lint', 'test', 'build'];
  const timeoutMs = Number(options.timeoutMs || config.commandTimeoutMs || 1800000);
  const yes = Boolean(options.yes);
  const echo = options.echo !== false;

  const run = createRun(root, task);
  writeAuditEvidence(root, { type: 'run_started', allowed: true, runId: run.id, agent: agentId, mode }, { runDir: run.dir });
  const logPaths = {
    transcriptFile: path.join(run.dir, 'transcript.log'),
    commandsFile: path.join(run.dir, 'commands.log'),
    policyFile: path.join(run.dir, 'policy.log'),
  };

  updateRunStatus(run.dir, {
    status: 'discovering',
    agent: agentId,
    mode,
    gates,
    files: relFiles(run.dir),
  });

  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  writeJson(path.join(run.dir, 'discovery.json'), discovery);

  const selectedCommands = gates.includes('none') ? [] : selectCommands(discovery, gates);
  const taskBrief = createTaskBrief(task, discovery, { gates, agent: agentId, mode });
  const plan = createPlan(task, discovery, selectedCommands, { agent: agentId, mode });
  const projectKodex = readText(kodexPath(root, 'project.kodex.md'));
  const errorsKodex = JSON.stringify(loadErrors(root), null, 2);
  const missionPrompt = createMissionPrompt({ task, discovery, projectKodex, plan, taskBrief, errorsKodex });

  writeText(path.join(run.dir, 'task-brief.yaml'), taskBrief);
  writeText(path.join(run.dir, 'plan.md'), plan);
  writeText(path.join(run.dir, 'mission.prompt.md'), missionPrompt);

  updateRunStatus(run.dir, { status: 'agent_running', files: relFiles(run.dir) });

  const agentRun = await executeAgentPhase({
    root,
    runDir: run.dir,
    config,
    agentId,
    task,
    missionPrompt,
    mode,
    yes,
    timeoutMs,
    echo,
    explicitCommand: options.command,
    skipAgent: Boolean(options.skipAgent),
    pty: Boolean(options.pty),
    logPaths,
  });
  writeJson(path.join(run.dir, 'agent-result.json'), agentRun);

  updateRunStatus(run.dir, { status: 'gates_running', agentResult: summarizeCommandResult(agentRun.result), files: relFiles(run.dir) });

  const gateResults = [];
  const gateOutputDir = path.join(run.dir, 'gate-outputs');
  ensureDir(gateOutputDir);
  for (let index = 0; index < selectedCommands.length; index += 1) {
    const gateCommand = selectedCommands[index];
    if (gateCommand.gate === 'lintguard') {
      gateResults.push(await runLintguardGate(root, gateOutputDir, { mode, yes, timeoutMs }));
      continue;
    }
    if (gateCommand.gate === 'quality') {
      gateResults.push(await runQualityGateAsGate(root, gateOutputDir, { mode, yes, timeoutMs, runDir: run.dir }));
      continue;
    }
    if (gateCommand.skipped) {
      const item = { gate: gateCommand.gate, skipped: true, reason: gateCommand.reason };
      gateResults.push(item);
      continue;
    }
    const outputPath = gateOutputFile(gateOutputDir, gateCommand, index);
    const result = await runCommand(gateCommand.command, {
      cwd: root,
      logDir: run.dir,
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
  writeJson(path.join(run.dir, 'gate-results.json'), gateResults);
  const learned = learnFromGateFailures(root, gateResults);
  writeJson(path.join(run.dir, 'learned-errors.json'), learned);

  const diffStat = getGitOutput(root, ['diff', '--stat'], 20000);
  const diff = getGitOutput(root, ['diff', '--'], 300000);
  writeText(path.join(run.dir, 'diff.stat'), diffStat || '');
  writeText(path.join(run.dir, 'diff.patch'), diff || '');

  const security = scanDiff(diff || '');
  writeJson(path.join(run.dir, 'security-report.json'), security);
  writeText(path.join(run.dir, 'security-report.md'), renderSecurityReport(security));

  const governance = collectRunGovernance(root, run.dir, { gateResults });
  const qa = createQaReport({ task, gateResults, agentRun, security, diffStat, governance });
  writeJson(path.join(run.dir, 'qa-report.json'), qa);
  writeText(path.join(run.dir, 'qa-report.md'), renderQaReport(qa));

  const finalStatus = decideFinalStatus({ agentRun, gateResults, security, gates, governance });
  const finalReport = createReleaseNotes({ task, status: finalStatus, gateResults, security, diffStat });
  writeText(path.join(run.dir, 'final-report.md'), finalReport);

  const status = updateRunStatus(run.dir, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    agentResult: summarizeCommandResult(agentRun.result),
    qa,
    governance,
    security,
    gates: gateResults,
    files: relFiles(run.dir),
  });

  if (echo) {
    console.log('');
    console.log(`Agentkodex run ${run.id}: ${finalStatus}`);
    console.log(`Run directory: ${run.dir}`);
    console.log(`Final report: ${path.join(run.dir, 'final-report.md')}`);
  }

  return { id: run.id, dir: run.dir, status, qa, governance, security, gateResults, agentRun };
}

async function executeAgentPhase(context) {
  if (context.skipAgent) {
    return { skipped: true, reason: '--skip-agent was set', result: null };
  }

  const agent = getAgent(context.config, context.agentId);
  const promptFile = path.join(context.runDir, 'mission.prompt.md');
  const sessionId = path.basename(context.runDir);

  if (context.explicitCommand) {
    const capability = issueRuntimeCapability(context.root, { sessionId, agentId: context.agentId, cwd: context.root, runDir: context.runDir });
    const result = await runCommand(context.explicitCommand, {
      cwd: context.root,
      logDir: context.runDir,
      stdin: agent.stdin ? context.missionPrompt : null,
      closeStdin: true,
      mode: context.mode,
      yes: context.yes,
      timeoutMs: context.timeoutMs,
      echo: context.echo,
      pty: context.pty,
      capability,
      capabilityPhase: 'runtime',
      capabilityAction: 'command:start',
      sessionId,
      agent: context.agentId,
      requireCapability: true,
      ...context.logPaths,
    });
    return { agent: context.agentId, command: context.explicitCommand, explicitCommand: true, result: summarizeCommandResult(result) };
  }

  if (agent.id === 'local') {
    writeText(path.join(context.runDir, 'local-agent-note.md'), [
      '# Local Agent Note',
      '',
      'The built-in local agent does not call an LLM. It generated the task brief, plan, Kodex memory, policy logs, QA/security reports, and validation gates.',
      '',
      'To perform autonomous code edits, choose an installed coding CLI adapter, for example:',
      '',
      '```bash',
      'agentkodex run --agent codex "your task"',
      'agentkodex agents set custom --cmd "your-cli {promptFile}"',
      'agentkodex run --agent custom "your task"',
      '```',
      '',
    ].join('\n'));
    return { agent: 'local', skipped: true, reason: 'local agent does not edit code without --command', result: null };
  }

  const detection = await detectAgent(context.config, context.agentId);
  writeJson(path.join(context.runDir, 'agent-detection.json'), detection);
  if (!detection.installed) {
    return {
      agent: context.agentId,
      skipped: false,
      error: detection.reason,
      result: {
        exitCode: 127,
        skipped: true,
        stderrTail: detection.reason,
        stdoutTail: '',
        command: detection.commandTemplate || '',
      },
    };
  }

  const command = buildAgentCommand(detection, {
    promptFile,
    promptText: context.missionPrompt,
    cwd: context.root,
    runDir: context.runDir,
    task: context.task,
  });

  if (!command) {
    return {
      agent: context.agentId,
      error: 'No command template configured for this agent.',
      result: { exitCode: 127, skipped: true, stderrTail: 'No command template configured.', stdoutTail: '' },
    };
  }

  const capability = issueRuntimeCapability(context.root, { sessionId, agentId: context.agentId, cwd: context.root, runDir: context.runDir });
  const result = await runCommand(command, {
    cwd: context.root,
    logDir: context.runDir,
    stdin: detection.stdin ? context.missionPrompt : null,
    closeStdin: true,
    mode: context.mode,
    yes: context.yes,
    agentLaunch: Boolean(detection.trustedLaunch),
    agent: context.agentId,
    adapterKind: detection.kind || detection.adapterKind,
    intent: context.task,
    holder: path.basename(context.runDir),
    config: context.config,
    timeoutMs: context.timeoutMs,
    echo: context.echo,
    pty: context.pty,
    capability,
    capabilityPhase: 'runtime',
    capabilityAction: 'command:start',
    sessionId,
    requireCapability: true,
    ...context.logPaths,
  });

  return { agent: context.agentId, command, result: summarizeCommandResult(result) };
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

function createQaReport({ task, gateResults, agentRun, security, diffStat, governance = {} }) {
  const passed = [];
  const failed = [];
  const skipped = [];
  for (const gate of gateResults) {
    if (gate.skipped || (gate.result && gate.result.skipped)) skipped.push({ gate: gate.gate, reason: gate.reason || gate.result?.stderrTail || 'skipped' });
    else if (gate.result && gate.result.exitCode === 0) passed.push(gate.gate);
    else failed.push({ gate: gate.gate, command: gate.command, exitCode: gate.result?.exitCode, stderrTail: gate.result?.stderrTail });
  }
  const blockingIssues = [];
  if (agentRun.result?.capability?.allowed === false) blockingIssues.push(`Capability denied: ${agentRun.result.capability.reason}`);
  if (blocksCompletion(governance)) blockingIssues.push('Governance evidence blocked completion.');
  if (agentRun.result && agentRun.result.exitCode && agentRun.result.exitCode !== 0 && !agentRun.result.skipped) blockingIssues.push(`Agent command failed with exit code ${agentRun.result.exitCode}.`);
  for (const item of failed) blockingIssues.push(`Gate failed: ${item.gate} (${item.command || 'unknown command'}).`);
  for (const finding of security.findings || []) {
    if (['critical', 'high'].includes(finding.severity)) blockingIssues.push(`Security ${finding.severity}: ${finding.message}`);
  }
  return {
    task,
    pass: blockingIssues.length === 0,
    passedGates: passed,
    failedGates: failed,
    skippedGates: skipped,
    blockingIssues,
    nonBlockingIssues: skipped.map((item) => `Gate skipped: ${item.gate} (${item.reason})`),
    governance,
    diffStat: diffStat || '',
  };
}

function renderQaReport(qa) {
  const lines = [];
  lines.push('# Agentkodex QA Report');
  lines.push('');
  lines.push(`Pass: ${qa.pass ? 'true' : 'false'}`);
  lines.push('');
  lines.push('## Passed gates');
  lines.push(qa.passedGates.length ? qa.passedGates.map((x) => `- ${x}`).join('\n') : '- none');
  lines.push('');
  lines.push('## Failed gates');
  lines.push(qa.failedGates.length ? qa.failedGates.map((x) => `- ${x.gate}: ${x.command || 'unknown command'} exit=${x.exitCode}`).join('\n') : '- none');
  lines.push('');
  lines.push('## Skipped gates');
  lines.push(qa.skippedGates.length ? qa.skippedGates.map((x) => `- ${x.gate}: ${x.reason}`).join('\n') : '- none');
  lines.push('');
  lines.push('## Blocking issues');
  lines.push(qa.blockingIssues.length ? qa.blockingIssues.map((x) => `- ${x}`).join('\n') : '- none');
  lines.push('');
  return lines.join('\n');
}

function decideFinalStatus({ agentRun, gateResults, security, gates, governance = {} }) {
  if (agentRun.error) return 'failed_agent';
  if (governance.auditEvidenceMissing) return 'failed_audit';
  if (Number(governance.failedCapabilityCount || 0) > 0 || Number(governance.securityDeniedCount || 0) > 0 || Number(governance.approvalRequiredCount || 0) > 0) return 'failed_security';
  if (governance.qualityGateOk === false || governance.completionBlocked) return 'failed_gates';
  if (agentRun.result?.capability?.allowed === false) return 'failed_security';
  if (agentRun.result && agentRun.result.policy && agentRun.result.skipped && agentRun.result.policy.allowed === false) return 'failed_agent_policy';
  if (agentRun.result && agentRun.result.exitCode && agentRun.result.exitCode !== 0 && !agentRun.result.skipped) return 'failed';
  if ((security.findings || []).some((f) => ['critical', 'high'].includes(f.severity))) return 'failed_security';
  const executable = gateResults.filter((g) => !g.skipped && !(g.result && g.result.skipped));
  if (executable.some((g) => g.result && g.result.exitCode !== 0)) return 'failed_gates';
  if (gates.includes('none')) return 'completed_no_gates';
  if (executable.length === 0) return 'completed_no_gates_discovered';
  return 'passed';
}

function relFiles(runDir) {
  const names = ['task-brief.yaml', 'plan.md', 'mission.prompt.md', 'transcript.log', 'commands.log', 'policy.log', 'gate-results.json', 'qa-report.md', 'security-report.md', 'final-report.md', 'diff.patch'];
  const out = {};
  for (const name of names) out[name.replace(/[^A-Za-z0-9]/g, '_')] = path.join(runDir, name);
  return out;
}

module.exports = {
  runTask,
  summarizeCommandResult,
  createQaReport,
  renderQaReport,
  decideFinalStatus,
};
