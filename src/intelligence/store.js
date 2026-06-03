'use strict';

const path = require('path');
const { discoverProject } = require('../discovery');
const { ensureKodex, kodexPath, loadErrors, saveDiscovery } = require('../kodexStore');
const { readJson, writeJson, writeText } = require('../utils');
const { rebuildScorecards, loadScorecards } = require('../scorecards/store');

function intelligenceDir(root) {
  ensureKodex(root);
  return kodexPath(root, 'intelligence');
}

function rebuildIntelligence(root) {
  const dir = intelligenceDir(root);
  const discovery = discoverProject(root);
  saveDiscovery(root, discovery);
  const scorecards = rebuildScorecards(root);
  const errors = loadErrors(root);
  const profiles = {
    project: projectProfile(discovery),
    stack: stackProfile(discovery),
    commands: commandProfile(discovery),
    dependencies: dependencyProfile(root),
    failures: { knownErrors: errors.knownErrors || [] },
    fixes: historicalFixes(errors),
    agentPerformance: scorecards,
  };
  writeJson(path.join(dir, 'project-profile.json'), profiles.project);
  writeJson(path.join(dir, 'stack-profile.json'), profiles.stack);
  writeJson(path.join(dir, 'command-profile.json'), profiles.commands);
  writeJson(path.join(dir, 'dependency-profile.json'), profiles.dependencies);
  writeJson(path.join(dir, 'historical-failures.json'), profiles.failures);
  writeJson(path.join(dir, 'historical-fixes.json'), profiles.fixes);
  writeJson(path.join(dir, 'agent-performance.json'), profiles.agentPerformance);
  writeText(path.join(dir, 'profile.md'), renderIntelligence(profiles));
  return profiles;
}

function loadIntelligence(root) {
  const dir = intelligenceDir(root);
  return {
    project: readJson(path.join(dir, 'project-profile.json'), null),
    stack: readJson(path.join(dir, 'stack-profile.json'), null),
    commands: readJson(path.join(dir, 'command-profile.json'), null),
    dependencies: readJson(path.join(dir, 'dependency-profile.json'), null),
    failures: readJson(path.join(dir, 'historical-failures.json'), null),
    fixes: readJson(path.join(dir, 'historical-fixes.json'), null),
    agentPerformance: readJson(path.join(dir, 'agent-performance.json'), loadScorecards(root)),
  };
}

function projectProfile(discovery) {
  return {
    generatedAt: discovery.generatedAt,
    root: discovery.root,
    projectName: discovery.projectName,
    languages: discovery.languages,
    frameworks: discovery.frameworks,
    packageManager: discovery.packageManager || 'unknown',
    evidenceFiles: discovery.evidenceFiles,
  };
}

function stackProfile(discovery) {
  return {
    languages: discovery.languages,
    frameworks: discovery.frameworks,
    services: discovery.services,
    envExamples: discovery.env,
    notes: discovery.notes,
  };
}

function commandProfile(discovery) {
  return {
    commands: discovery.commands,
    gates: discovery.commands.filter((cmd) => ['lint', 'test', 'build', 'e2e'].includes(cmd.category)),
    database: discovery.commands.filter((cmd) => ['database', 'migration'].includes(cmd.category)),
  };
}

function dependencyProfile(root) {
  const pkg = readJson(path.join(root, 'package.json'), null);
  if (!pkg) return { packageJson: null, dependencies: {}, devDependencies: {} };
  return {
    packageJson: 'package.json',
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    scripts: pkg.scripts || {},
  };
}

function historicalFixes(errors) {
  return {
    fixes: (errors.knownErrors || []).map((item) => ({
      signature: item.signature,
      command: item.command,
      suggestedFix: item.suggestedFix || null,
      count: item.count || 1,
      lastSeenAt: item.lastSeenAt || null,
    })),
  };
}

function renderIntelligence(profiles) {
  const lines = ['# Agentkodex Intelligence Profile', ''];
  lines.push(`Project: ${profiles.project.projectName}`);
  lines.push(`Languages: ${profiles.project.languages.join(', ') || 'unknown'}`);
  lines.push(`Frameworks: ${profiles.project.frameworks.join(', ') || 'unknown'}`);
  lines.push(`Package manager: ${profiles.project.packageManager}`);
  lines.push('');
  lines.push('## Commands');
  for (const cmd of profiles.commands.commands || []) lines.push(`- ${cmd.name}: ${cmd.command} (${cmd.confidence}; ${cmd.evidence})`);
  lines.push('');
  lines.push('## Historical Failures');
  if (!(profiles.failures.knownErrors || []).length) lines.push('- insufficient history');
  for (const error of profiles.failures.knownErrors || []) lines.push(`- ${error.signature} (${error.command || 'unknown command'})`);
  lines.push('');
  lines.push('## Agent Performance');
  const cards = Object.values(profiles.agentPerformance.agents || {});
  if (!cards.length) lines.push('- insufficient history');
  for (const card of cards) lines.push(`- ${card.agent}: runs=${card.runs} successRate=${card.successRate === null ? 'insufficient history' : Math.round(card.successRate * 100) + '%'}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  intelligenceDir,
  rebuildIntelligence,
  loadIntelligence,
  renderIntelligence,
};
