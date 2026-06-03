'use strict';

const path = require('path');
const { runTask } = require('../run');
const { copyDirFiltered, ensureDir } = require('../utils');
const { detectAgent } = require('../agents');
const { writeAuditEvidence } = require('../audit/evidence');

async function judgeWinner(input = {}) {
  const judge = String(input.judge || '').trim();
  if (!judge || judge === 'none') return { mode: 'deterministic', warning: 'No judge agent was used; deterministic scoring selected the winner.' };
  const detection = await detectAgent(input.config, judge);
  if (!detection.ready) return { mode: 'deterministic', judge, warning: `Judge ${judge} is not ready; deterministic scoring selected the winner.` };
  const workDir = path.join(input.askDir, 'judge', judge);
  copyDirFiltered(input.root, workDir, { ignore: ['.git', 'node_modules', '.agentkodex', 'dist', 'coverage', '.next', '.turbo', 'vendor'] });
  ensureDir(workDir);
  writeAuditEvidence(input.root, { type: 'judge_started', allowed: true, judge, askId: input.id });
  const run = await runTask({
    root: workDir,
    task: judgePrompt(input.prompt, input.candidates),
    agent: judge,
    config: cloneConfig(input.config),
    mode: 'sandbox_auto',
    gates: ['none'],
    yes: true,
    echo: false,
    timeoutMs: input.timeoutMs,
  });
  const output = String(run.agentRun?.result?.stdoutTail || '').trim();
  const selected = parseWinner(output, input.candidates);
  if (!selected) {
    writeAuditEvidence(input.root, { type: 'judge_failed', allowed: false, judge, askId: input.id, reason: 'no valid winner in output' });
    return { mode: 'deterministic', judge, warning: `Judge ${judge} did not return a valid winner; deterministic scoring selected the winner.`, runDir: run.dir };
  }
  writeAuditEvidence(input.root, { type: 'judge_selected', allowed: true, judge, askId: input.id, winner: selected.agent, runDir: run.dir });
  return { mode: 'agent', judge, winner: selected, runDir: run.dir, reason: `Judge ${judge} selected ${selected.agent}.` };
}

function judgePrompt(prompt, candidates = []) {
  const lines = [
    'Choose the best Agentkodex candidate.',
    'Return exactly one line in this format: WINNER:<agent-id>',
    '',
    `Request: ${prompt}`,
    '',
    'Candidates:',
  ];
  for (const item of candidates) {
    lines.push(`- ${item.agent}: status=${item.status} score=${item.score}`);
    lines.push(`  response=${String(item.response || '').slice(0, 1200)}`);
  }
  return lines.join('\n');
}

function parseWinner(output, candidates = []) {
  const match = /WINNER\s*:\s*([A-Za-z0-9_.-]+)/i.exec(output);
  if (!match) return null;
  return candidates.find((item) => item.agent === match[1]) || null;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

module.exports = {
  judgeWinner,
  parseWinner,
};
