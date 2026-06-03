'use strict';

const path = require('path');
const { parseArgs, booleanFlag, stringFlag, listFlag } = require('./args');
const { ensureKodex, createRun, updateRunStatus } = require('./kodexStore');
const { discoverProject } = require('./discovery');
const { runGateCommands, renderGateReport } = require('./gates');
const { createQaReport, renderQaReport } = require('./run');
const { scanDiff, renderSecurityReport } = require('./security');
const { writeJson, writeText } = require('./utils');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', process.cwd())));
}

async function gatesCommand(argv) {
  const [sub = 'run', ...rest] = argv;
  if (sub !== 'run') throw new Error(`Unknown gates subcommand: ${sub}`);
  const { flags } = parseArgs(rest);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  const gates = listFlag(flags, 'gates', ['lint', 'test', 'build']);
  const run = createRun(root, `Run gates: ${gates.join(',')}`);
  updateRunStatus(run.dir, { status: 'gates_running', runtime: 'gates', gates });

  const discovery = discoverProject(root);
  const gateResults = await runGateCommands({
    root,
    runDir: run.dir,
    discovery,
    gates,
    mode: stringFlag(flags, 'mode', 'supervised'),
    yes: booleanFlag(flags, 'yes') || booleanFlag(flags, 'y'),
    timeoutMs: Number(stringFlag(flags, 'timeoutMs', stringFlag(flags, 'timeout-ms', '1800000'))),
    lintguardUrl: stringFlag(flags, 'lintguardUrl', ''),
    echo: !booleanFlag(flags, 'quiet'),
    pty: booleanFlag(flags, 'pty'),
    writeReports: true,
  });

  const security = scanDiff('');
  const qa = createQaReport({ task: 'Run gates', gateResults, agentRun: { result: null }, security, diffStat: '' });
  writeJson(path.join(run.dir, 'qa-report.json'), qa);
  writeText(path.join(run.dir, 'qa-report.md'), renderQaReport(qa));
  writeJson(path.join(run.dir, 'security-report.json'), security);
  writeText(path.join(run.dir, 'security-report.md'), renderSecurityReport(security));
  updateRunStatus(run.dir, { status: qa.pass ? 'passed' : 'failed_gates', gates: gateResults, qa, security });

  if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ run, gateResults, qa }, null, 2));
  else {
    console.log(renderGateReport(gateResults));
    console.log(`Run directory: ${run.dir}`);
  }
}

module.exports = {
  gatesCommand,
};
