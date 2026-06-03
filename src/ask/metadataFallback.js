'use strict';

const { discoverProject, selectCommands } = require('../discovery');

function buildMetadataFallback(root, prompt, mode, context = {}) {
  const discovery = discoverProject(root);
  const gates = selectCommands(discovery, ['lint', 'test', 'build']).filter((gate) => !gate.skipped);
  const response = renderMetadataAnswer(discovery, gates, prompt, context);
  return {
    ok: true,
    winner: 'project-metadata',
    mode,
    response,
    scores: [],
    selection: {
      strategy: 'metadata_fallback',
      confidence: 20,
      category: 'metadata',
      reason: 'Using project metadata because no external coding agent was runnable.',
      review: 'none',
    },
    artifactsPath: null,
    auditBundlePath: null,
    applied: false,
    servedFromCache: false,
    cacheId: null,
    blockedReason: null,
    adapterWarnings: context.adapterWarnings || [],
  };
}

function renderMetadataAnswer(discovery, gates, prompt, context) {
  const lines = [];
  lines.push('I can answer from Agentkodex project metadata, but I did not inspect source through an external coding agent.');
  if (context.reason) lines.push(context.reason);
  lines.push('');
  lines.push(`Project: ${discovery.projectName}`);
  lines.push(`Languages: ${(discovery.languages || []).join(', ') || 'unknown'}`);
  lines.push(`Frameworks: ${(discovery.frameworks || []).join(', ') || 'unknown'}`);
  lines.push(`Package manager: ${discovery.packageManager || 'unknown'}`);
  lines.push('');
  if ((discovery.commands || []).length) {
    lines.push('Useful discovered commands:');
    for (const command of discovery.commands.slice(0, 6)) lines.push(`- ${command.name}: ${command.command}`);
    lines.push('');
  }
  if (gates.length) {
    lines.push('Suggested validation commands:');
    for (const gate of gates) lines.push(`- ${gate.gate}: ${gate.command}`);
    lines.push('');
  }
  lines.push(`For a deeper answer, run setup after fixing the adapter environment, then retry: agentkodex ask "${escapePrompt(prompt)}"`);
  return lines.join('\n');
}

function escapePrompt(prompt) {
  return String(prompt || 'Explain this project').replace(/"/g, '\\"');
}

module.exports = {
  buildMetadataFallback,
};
