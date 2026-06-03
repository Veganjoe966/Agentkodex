'use strict';

const fs = require('fs');
const path = require('path');
const { discoverProject } = require('../discovery');
const { runCommand } = require('../sessionRunner');
const { ensureDir, writeJson } = require('../utils');
const { scopedFiles, isEnvFile } = require('./fileScope');
const { issueQualityCapability } = require('../capabilities/phases');
const { writeAuditEvidence } = require('../audit/evidence');
const { runAdvancedChecks } = require('./advancedChecks');
const { redactSecrets } = require('../security/redaction');
const { commandOverrides, forbiddenImportRules, loadQualityConfig } = require('./qualityConfig');
const { analysisModeCheck, resolveAnalysisMode } = require('./analysisMode');
const BANNED_ABSOLUTE_PROJECT_PATH = new RegExp(`${escapeRegExp('/app')}/${escapeRegExp('test_project')}\\b`);

async function runQualityGate(options = {}) {
  const root = path.resolve(options.projectRoot || options.root || process.cwd());
  const discovery = options.discovery || discoverProject(root);
  const files = scopedFiles(root, options.changedFiles || options.files || []);
  const logDir = options.logDir || path.join(root, '.agentkodex', 'quality-gate');
  ensureDir(logDir);
  const qualityConfig = loadQualityConfig(root, options);
  const analysis = resolveAnalysisMode(qualityConfig, options);
  const capability = options.capability || issueQualityCapability(root, { sessionId: options.sessionId, runId: options.runId, cwd: root, runDir: options.runDir });

  const checks = [];
  checks.push(analysisModeCheck(analysis));
  for (const spec of commandSpecs(discovery, qualityConfig)) {
    checks.push(await runCommandCheck(root, spec, { ...options, logDir, capability }));
  }
  checks.push(runLocCheck(root, files, qualityConfig.maxFileLoc));
  checks.push(runArchitectureCheck(root, files, forbiddenImportRules(qualityConfig)));
  checks.push(...runAdvancedChecks(root, files, { ...options, quality: qualityConfig }));
  checks.push(runSecretLogCheck(logDir));
  checks.push(runTotalViolationCheck(checks, qualityConfig.maxTotalViolations));

  const failed = checks.find((check) => !check.ok);
  const totals = totalsFor(checks, files);
  const result = {
    ok: !failed,
    summary: failed ? `Quality gate failed: ${failed.name}` : 'Quality gate passed.',
    analysisMode: analysis.analysisMode,
    checks,
    filesChecked: files.map((file) => path.relative(root, file)).sort(),
    blockedReason: failed ? failed.details[0] || `${failed.name} failed` : null,
    totals,
  };
  writeAuditEvidence(root, {
    type: 'quality_gate_result',
    ok: result.ok,
    blockedReason: result.blockedReason,
    analysisMode: result.analysisMode,
    checks: result.checks,
  }, { runDir: options.runDir });
  return result;
}

async function runQualityGateAsGate(root, outputDir, options = {}) {
  const outputPath = path.join(outputDir, 'quality-gate.json');
  const started = Date.now();
  const result = await runQualityGate({ ...options, projectRoot: root, logDir: outputDir, runDir: options.runDir || path.dirname(outputDir) });
  writeJson(outputPath, result);
  return {
    gate: 'quality',
    command: 'agentkodex quality check',
    outputPath,
    result: {
      exitCode: result.ok ? 0 : 1,
      skipped: false,
      stdoutTail: JSON.stringify({ ok: result.ok, summary: result.summary }),
      stderrTail: result.blockedReason || '',
      durationMs: Date.now() - started,
      outputFile: outputPath,
    },
  };
}

function commandSpecs(discovery, qualityConfig = {}) {
  const commands = discovery.commands || [];
  const overrides = commandOverrides(qualityConfig);
  const discovered = [
    findSpec(commands, 'eslint', (cmd) => cmd.name === 'lint' || /(^|\s)eslint(\s|$)/i.test(cmd.evidence || cmd.command || '')),
    findSpec(commands, 'typecheck', (cmd) => /type-?check/i.test(cmd.name) || /\btsc\b.*--noEmit/i.test(`${cmd.evidence} ${cmd.command}`)),
    findSpec(commands, 'ruff', (cmd) => /\bruff\s+check\b/i.test(cmd.command || '')),
    findSpec(commands, 'tests', (cmd) => cmd.name === 'test' || cmd.category === 'test'),
  ].filter(Boolean);
  const overridden = new Set(overrides.map((item) => item.name));
  return overrides.concat(discovered.filter((item) => !overridden.has(item.name)));
}

function findSpec(commands, name, predicate) {
  const command = commands.find(predicate);
  return command ? { name, command } : null;
}

async function runCommandCheck(root, spec, options) {
  const outputFile = path.join(options.logDir, `${spec.name}.log`);
  const result = await runCommand(spec.command.command, {
    cwd: root,
    logDir: options.logDir,
    outputFile,
    mode: options.mode || 'sandbox_auto',
    yes: Boolean(options.yes ?? true),
    echo: false,
    timeoutMs: Number(options.timeoutMs || 600000),
    intent: `Agentkodex quality ${spec.name}`,
    holder: options.holder || 'quality-gate',
    config: options.config,
    capability: options.capability,
    capabilityPhase: 'quality',
    capabilityAction: 'quality:command',
    sessionId: options.capability?.sessionId,
    agent: options.capability?.agentId || 'lintguard',
    requireCapability: true,
  });
  const ok = result.exitCode === 0 && !result.skipped;
  return check(spec.name, ok, ok ? 0 : 1, 0, [
    `${spec.command.command}`,
    `exit=${result.exitCode === null ? 'blocked' : result.exitCode}`,
    `output=${outputFile}`,
  ]);
}

function runLocCheck(root, files, maxLines) {
  const offenders = [];
  for (const file of files) {
    if (!/\.(?:js|jsx|mjs|cjs|ts|tsx|py|go|rs|rb|java|cs|php|sh)$/i.test(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
    if (lines > maxLines) offenders.push(`${path.relative(root, file)} has ${lines} lines (max ${maxLines})`);
  }
  return check('loc', offenders.length === 0, offenders.length, 0, offenders);
}

function runArchitectureCheck(root, files, forbiddenImports) {
  const details = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    if (isEnvFile(path.basename(file))) {
      details.push(`${rel} is a checked-in env file`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    if (BANNED_ABSOLUTE_PROJECT_PATH.test(text)) details.push(`${rel} contains hardcoded banned project path`);
    for (const item of forbiddenImports) {
      if (item.pattern.test(text)) details.push(`${rel} imports forbidden package ${item.name}`);
    }
  }
  return check('architecture', details.length === 0, details.length, 0, details);
}

function runSecretLogCheck(logDir) {
  const details = [];
  for (const file of safeLogFiles(logDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (redactSecrets(text) !== text) details.push(`${path.relative(logDir, file)} contains unredacted secret-looking output`);
  }
  return check('secret-output', details.length === 0, details.length, 0, details);
}

function safeLogFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((name) => /\.(?:log|txt|json)$/i.test(name))
      .map((name) => path.join(dir, name))
      .filter((file) => fs.statSync(file).isFile());
  } catch (_) {
    return [];
  }
}

function runTotalViolationCheck(checks, max) {
  if (max === null || max === undefined || !Number.isFinite(Number(max))) return check('total-violations', true, 0, 0, []);
  const totals = totalsFor(checks, []);
  const ok = totals.errors + totals.warnings <= Number(max);
  return check('total-violations', ok, ok ? 0 : 1, 0, ok ? [] : [`total violations ${totals.errors + totals.warnings} exceeds ${max}`]);
}

function totalsFor(checks, files) {
  return {
    errors: checks.reduce((sum, item) => sum + Number(item.errors || 0), 0),
    warnings: checks.reduce((sum, item) => sum + Number(item.warnings || 0), 0),
    filesChecked: files.length,
  };
}

function check(name, ok, errors, warnings, details) {
  return { name, ok, errors, warnings, details };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  runQualityGate,
  runQualityGateAsGate,
  commandSpecs,
};
