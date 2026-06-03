'use strict';

const path = require('path');
const { discoverProject, selectCommands } = require('../discovery');
const { runCommand } = require('../sessionRunner');
const { summarizeCommandResult } = require('../commandResult');
const { safeProjectFiles } = require('./projectFiles');

async function checkLocal(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const gates = options.gates && options.gates.length ? options.gates : ['lint', 'typecheck'];
  const discovery = options.discovery || discoverProject(root);
  const selected = selectCommands(discovery, gates);
  const commandOutputs = [];
  const errors = [];
  const warnings = [];

  for (const item of selected) {
    if (item.skipped) {
      warnings.push(item.reason);
      commandOutputs.push({ gate: item.gate, skipped: true, reason: item.reason });
      continue;
    }
    const result = await runCommand(item.command, {
      cwd: root,
      logDir: options.logDir || path.join(root, '.agentkodex', 'lintguard'),
      mode: options.mode || 'supervised',
      yes: Boolean(options.yes),
      echo: false,
      timeoutMs: Number(options.timeoutMs || 300000),
      intent: `Lintguard ${item.gate}`,
      holder: options.holder || 'lintguard-local',
      config: options.config,
    });
    const summary = { gate: item.gate, evidence: item.evidence, result: summarizeCommandResult(result) };
    commandOutputs.push(summary);
    if (result.exitCode !== 0) errors.push(`${item.gate} failed with exit code ${result.exitCode}`);
  }

  const filesChecked = safeProjectFiles(root, options.files).length;
  return {
    ok: errors.length === 0,
    allowed: errors.length === 0,
    violations: errors.length,
    errors,
    warnings,
    filesChecked,
    files_checked: filesChecked,
    commandOutputs,
    source: 'local',
  };
}

module.exports = {
  checkLocal,
};
