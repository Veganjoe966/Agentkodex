'use strict';

const { readText } = require('./utils');

function createTaskBrief(task, discovery, options = {}) {
  const gates = options.gates && options.gates.length ? options.gates : ['lint', 'test', 'build'];
  const lines = [];
  lines.push(`goal: ${yamlString(task)}`);
  lines.push(`project_name: ${yamlString(discovery.projectName || 'unknown')}`);
  lines.push(`languages: [${(discovery.languages || []).map(yamlString).join(', ')}]`);
  lines.push(`frameworks: [${(discovery.frameworks || []).map(yamlString).join(', ')}]`);
  lines.push(`package_manager: ${yamlString(discovery.packageManager || 'unknown')}`);
  lines.push(`agent: ${yamlString(options.agent || 'local')}`);
  lines.push(`mode: ${yamlString(options.mode || 'supervised')}`);
  lines.push(`required_gates: [${gates.map(yamlString).join(', ')}]`);
  lines.push('acceptance_criteria:');
  for (const item of inferAcceptanceCriteria(task, gates)) lines.push(`  - ${yamlString(item)}`);
  lines.push('risk_notes:');
  lines.push('  - Agentkodex will not mark the task complete unless required gates pass or failures are explicitly reported.');
  lines.push('  - Destructive, production, credential, and dependency-changing commands are guarded by policy.');
  return `${lines.join('\n')}\n`;
}

function inferAcceptanceCriteria(task, gates) {
  const criteria = [
    'Implementation directly satisfies the requested task.',
    'Changes follow existing project conventions and minimize unrelated edits.',
    'The final diff is reviewable by a human.',
  ];
  for (const gate of gates) criteria.push(`The ${gate} validation gate passes, or the failure is documented with evidence.`);
  if (/auth|login|password|token|session/i.test(task)) criteria.push('Authentication/security-sensitive changes avoid leaking secrets and use safe defaults.');
  if (/api|endpoint|route/i.test(task)) criteria.push('API behavior is covered by tests or documented manual verification.');
  if (/ui|page|component|frontend|screen/i.test(task)) criteria.push('User-facing behavior is verified through build, tests, screenshot, or manual preview notes.');
  return criteria;
}

function createPlan(task, discovery, selectedCommands, options = {}) {
  const lines = [];
  lines.push(`# Agentkodex Plan`);
  lines.push('');
  lines.push(`Task: ${task}`);
  lines.push(`Agent: ${options.agent || 'local'}`);
  lines.push(`Mode: ${options.mode || 'supervised'}`);
  lines.push('');
  lines.push('## Project understanding');
  lines.push(`- Name: ${discovery.projectName || 'unknown'}`);
  lines.push(`- Languages: ${(discovery.languages || []).join(', ') || 'unknown'}`);
  lines.push(`- Frameworks: ${(discovery.frameworks || []).join(', ') || 'unknown'}`);
  lines.push(`- Package manager: ${discovery.packageManager || 'unknown'}`);
  lines.push('');
  lines.push('## Execution phases');
  lines.push('1. Verify repository state and read project conventions.');
  lines.push('2. Implement the smallest change that satisfies the task.');
  lines.push('3. Run the smallest relevant validation command after each meaningful change.');
  lines.push('4. Run required quality gates.');
  lines.push('5. Produce a final diff, QA report, security report, and release notes.');
  lines.push('');
  lines.push('## Required gates');
  for (const command of selectedCommands) {
    if (command.skipped) lines.push(`- ${command.gate}: skipped initially — ${command.reason}`);
    else lines.push(`- ${command.gate}: \`${command.command}\` (${command.evidence})`);
  }
  lines.push('');
  lines.push('## Definition of done');
  lines.push('- Task requirements are implemented.');
  lines.push('- Required gates pass or any failures are documented with exact command output.');
  lines.push('- No secrets are leaked in the diff or logs.');
  lines.push('- Final report contains changed files, commands, test status, and risks.');
  lines.push('');
  return lines.join('\n');
}

function createMissionPrompt({ task, discovery, projectKodex, plan, taskBrief, errorsKodex }) {
  return `You are Agentkodex CLI Builder Agent.\n\nYou live inside a real terminal session. The terminal and project CLI are your primary operating environment. Use the existing repository commands, tests, package manager, git workflow, and framework conventions.\n\nMISSION\n${task}\n\nTASK BRIEF\n${taskBrief}\n\nPROJECT KODEX\n${projectKodex || '(no project kodex available)'}\n\nPLAN\n${plan}\n\nKNOWN ERROR MEMORY\n${errorsKodex || '(no known errors)'}\n\nOPERATING RULES\n1. Start by checking repository state with safe read-only commands.\n2. Prefer discovered project commands over generic guesses.\n3. Make changes incrementally and avoid unrelated edits.\n4. After a meaningful change, run the smallest relevant validation command.\n5. If a command fails, inspect the exact stdout/stderr, fix root cause, and rerun the relevant command.\n6. Do not expose secrets. Do not run destructive commands.\n7. Do not mark work complete until the quality gates pass or failures are clearly documented.\n8. Keep final output structured: summary, files changed, commands run, tests passed/failed, remaining risks.\n`;
}

function createReleaseNotes({ task, status, gateResults, security, diffStat }) {
  const passed = gateResults.filter((g) => g.result && g.result.exitCode === 0).map((g) => g.gate);
  const failed = gateResults.filter((g) => g.result && g.result.exitCode !== 0 && !g.result.skipped).map((g) => g.gate);
  const skipped = gateResults.filter((g) => g.skipped || (g.result && g.result.skipped)).map((g) => g.gate);
  const lines = [];
  lines.push(`# Agentkodex Final Report`);
  lines.push('');
  lines.push(`Task: ${task}`);
  lines.push(`Status: ${status}`);
  lines.push('');
  lines.push('## Validation');
  lines.push(`- Passed: ${passed.length ? passed.join(', ') : 'none'}`);
  lines.push(`- Failed: ${failed.length ? failed.join(', ') : 'none'}`);
  lines.push(`- Skipped: ${skipped.length ? skipped.join(', ') : 'none'}`);
  lines.push('');
  lines.push('| Gate | Command | Exit | Duration ms | Output |');
  lines.push('|---|---|---:|---:|---|');
  for (const gate of gateResults) {
    if (gate.skipped) lines.push(`| ${gate.gate} | skipped |  |  | ${gate.reason || ''} |`);
    else lines.push(`| ${gate.gate} | \`${gate.command || ''}\` | ${gate.result?.exitCode ?? ''} | ${gate.result?.durationMs ?? ''} | ${gate.outputPath || gate.result?.outputFile || ''} |`);
  }
  lines.push('');
  lines.push('## Diff stat');
  lines.push('```');
  lines.push(diffStat || '(no git diff stat available)');
  lines.push('```');
  lines.push('');
  lines.push('## Security');
  if (!security.findings.length) lines.push('- No high-confidence secret leaks or blocked patterns detected in diff.');
  for (const finding of security.findings) lines.push(`- [${finding.severity}] ${finding.message}`);
  lines.push('');
  lines.push('## Next action');
  lines.push(status === 'passed' ? '- Review the diff and commit or open a PR.' : '- Fix blocking validation failures, then rerun Agentkodex gates.');
  lines.push('');
  return lines.join('\n');
}

function yamlString(value) {
  const s = String(value || '');
  if (/^[A-Za-z0-9_.:/-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

module.exports = {
  createTaskBrief,
  createPlan,
  createMissionPrompt,
  createReleaseNotes,
  inferAcceptanceCriteria,
};
