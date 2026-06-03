'use strict';

const path = require('path');
const { getAgent, detectAgent, buildAgentCommand } = require('../agents');
const { shellQuote } = require('../utils');

async function resolveSessionAdapter(config, input) {
  const agentId = input.agent || config.defaultAgent || 'local';
  const promptFile = input.promptFile;
  const context = {
    promptFile,
    promptText: input.promptText || '',
    cwd: input.root,
    runDir: input.runDir || input.sessionDir,
    task: input.task || '',
  };

  if (input.explicitCommand) {
    return {
      id: agentId,
      kind: 'explicit',
      installed: true,
      command: input.explicitCommand,
      stdin: false,
      detection: { installed: true, binary: null, reason: 'explicit command' },
    };
  }

  const agent = getAgent(config, agentId);
  if (agent.id === 'local') {
    return {
      id: 'local',
      kind: 'local-shell',
      installed: true,
      command: localShellCommand(promptFile),
      stdin: false,
      detection: { installed: true, reason: 'built-in local shell adapter' },
    };
  }

  if (agent.id === 'shell') {
    return {
      id: 'shell',
      kind: 'interactive-shell',
      installed: true,
      command: process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'sh'),
      stdin: false,
      detection: { installed: true, reason: 'system shell' },
    };
  }

  const detection = await detectAgent(config, agentId);
  if (!detection.ready) {
    return {
      id: agentId,
      kind: detection.adapterKind || 'template',
      installed: false,
      command: '',
      stdin: Boolean(detection.stdin),
      detection,
    };
  }

  const command = buildAgentCommand(detection, context);
  return {
    id: agentId,
    kind: detection.adapterKind || inferAdapterKind(agentId),
    installed: Boolean(command),
    command,
    stdin: Boolean(detection.stdin),
    detection,
  };
}

function localShellCommand(promptFile) {
  const file = shellQuote(promptFile);
  return `node -e ${shellQuote(`const fs=require('fs'); const prompt=fs.readFileSync(${JSON.stringify(promptFile)}, 'utf8'); console.log('Agentkodex local runtime session. This adapter does not edit code. Mission prompt saved at: ${promptFile}'); console.log(prompt.split(/\\n/).slice(0,16).join('\\n'));`)}`;
}

function inferAdapterKind(agentId) {
  if (['codex', 'claude-code', 'gemini', 'opencode', 'cursor'].includes(agentId)) return 'interactive';
  if (agentId === 'aider') return 'headless';
  if (agentId === 'custom') return 'custom';
  return 'template';
}

module.exports = {
  resolveSessionAdapter,
  inferAdapterKind,
};
