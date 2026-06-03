'use strict';

const path = require('path');
const { discoverProject, selectCommands } = require('./discovery');
const { saveDiscovery, learnFromGateFailures } = require('./kodexStore');
const { runCommand, formatDuration } = require('./sessionRunner');
const { ensureDir, hashString, slugify, writeJson, writeText } = require('./utils');
const { summarizeCommandResult } = require('./commandResult');

async function runGateCommands(options) {
  const root = path.resolve(options.root || process.cwd());
  const gates = normalizeGates(options.gates);
  const discovery = options.discovery || discoverProject(root);
  if (options.saveDiscovery !== false) saveDiscovery(root, discovery);
  const selected = gates.includes('none') ? [] : selectCommands(discovery, gates);
  const runDir = path.resolve(options.runDir || root);
  const outputDir = path.join(runDir, 'gate-outputs');
  ensureDir(outputDir);

  const results = [];
  for (let index = 0; index < selected.length; index += 1) {
    const gateCommand = selected[index];
    if (gateCommand.skipped) {
      results.push({ gate: gateCommand.gate, skipped: true, reason: gateCommand.reason });
      continue;
    }
    const outputPath = gateOutputPath(outputDir, gateCommand, index);
    const result = await runCommand(gateCommand.command, {
      cwd: root,
      logDir: runDir,
      mode: options.mode || 'supervised',
      yes: Boolean(options.yes),
      timeoutMs: Number(options.timeoutMs || 1800000),
      echo: options.echo !== false,
      pty: Boolean(options.pty),
      outputFile: outputPath,
      transcriptFile: options.transcriptFile,
      commandsFile: options.commandsFile,
      policyFile: options.policyFile,
    });
    results.push({
      gate: gateCommand.gate,
      name: gateCommand.name,
      command: gateCommand.command,
      evidence: gateCommand.evidence,
      confidence: gateCommand.confidence,
      outputPath,
      result: summarizeCommandResult(result),
    });
  }

  if (options.writeReports) {
    writeJson(path.join(runDir, 'gate-results.json'), results);
    writeText(path.join(runDir, 'gate-report.md'), renderGateReport(results));
    writeJson(path.join(runDir, 'learned-errors.json'), learnFromGateFailures(root, results));
  }
  return results;
}

function normalizeGates(gates) {
  if (Array.isArray(gates) && gates.length) return gates;
  return ['lint', 'test', 'build'];
}

function gateOutputPath(outputDir, gateCommand, index) {
  const base = `${String(index + 1).padStart(2, '0')}-${slugify(gateCommand.gate || gateCommand.name || 'gate', 36)}`;
  return path.join(outputDir, `${base}-${hashString(gateCommand.command, 8)}.log`);
}

function renderGateReport(results) {
  const lines = ['# Agentkodex Gate Report', ''];
  if (!results.length) lines.push('No gates were selected.');
  for (const item of results) {
    lines.push(`## ${item.gate}`);
    if (item.skipped) {
      lines.push(`- Status: skipped`);
      lines.push(`- Reason: ${item.reason}`);
    } else {
      lines.push(`- Command: \`${item.command}\``);
      lines.push(`- Exit code: ${item.result ? item.result.exitCode : 'unknown'}`);
      lines.push(`- Duration: ${item.result ? formatDuration(item.result.durationMs || 0) : 'unknown'}`);
      lines.push(`- Output: ${item.outputPath || item.result?.outputFile || '(not captured)'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  runGateCommands,
  renderGateReport,
};
