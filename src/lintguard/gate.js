'use strict';

const path = require('path');
const { writeJson } = require('../utils');
const { runLintguardCheck } = require('./runner');

async function runLintguardGate(root, outputDir, options = {}) {
  const outputPath = path.join(outputDir, 'lintguard-check.json');
  const result = await runLintguardCheck({
    root,
    local: !options.url,
    url: options.url,
    mode: options.mode,
    yes: options.yes,
    timeoutMs: options.timeoutMs,
  });
  writeJson(outputPath, result);
  return {
    gate: 'lintguard',
    command: 'agentkodex lintguard check',
    outputPath,
    result: {
      exitCode: result.ok ? 0 : 1,
      skipped: false,
      stdoutTail: JSON.stringify({ ok: result.ok, violations: result.violations, filesChecked: result.filesChecked }),
      stderrTail: (result.errors || []).join('\n'),
      durationMs: 0,
      outputFile: outputPath,
    },
  };
}

module.exports = {
  runLintguardGate,
};
