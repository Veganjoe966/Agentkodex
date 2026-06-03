'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseArgs, booleanFlag, stringFlag } = require('../args');
const { ensureKodex, kodexPath } = require('../kodexStore');
const { ensureDir, readJson, timestampId, writeJson } = require('../utils');
const { runAsk } = require('../ask/runAsk');

async function chatCommand(argv) {
  const { flags, positionals } = parseArgs(argv);
  const root = path.resolve(stringFlag(flags, 'cwd', stringFlag(flags, 'repo', process.cwd())));
  ensureKodex(root);
  if (booleanFlag(flags, 'help')) return printChatHelp();
  if (booleanFlag(flags, 'list') || positionals[0] === 'list') return listChats(root, flags);
  const id = resolveChatId(root, flags);
  const prompt = positionals.join(' ').trim();
  if (prompt) return runChatTurn(root, id, prompt, flags);
  if (!process.stdin.isTTY) {
    console.log(startupText(id));
    return;
  }
  await interactiveChat(root, id, flags);
}

async function runChatTurn(root, id, prompt, flags) {
  const result = await runAsk({
    root,
    prompt,
    mode: stringFlag(flags, 'mode', 'auto'),
    latency: 'auto',
    compare: booleanFlag(flags, 'compare'),
    yes: booleanFlag(flags, 'yes'),
  });
  appendTurn(root, id, { prompt, result });
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ ok: result.ok, conversationId: id, result }, null, 2));
  else console.log(result.response || result.blockedReason || '(no response)');
  if (!result.ok) process.exitCode = 1;
}

async function interactiveChat(root, id, flags) {
  console.log(startupText(id));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'agentkodex> ' });
  rl.prompt();
  for await (const line of rl) {
    const prompt = String(line || '').trim();
    if (!prompt || ['exit', 'quit'].includes(prompt.toLowerCase())) break;
    await runChatTurn(root, id, prompt, flags);
    rl.prompt();
  }
}

function appendTurn(root, id, turn) {
  const file = chatFile(root, id);
  const current = readJson(file, { id, createdAt: new Date().toISOString(), turns: [] });
  current.updatedAt = new Date().toISOString();
  current.turns.push({
    createdAt: new Date().toISOString(),
    prompt: turn.prompt,
    winner: turn.result.winner,
    mode: turn.result.mode,
    response: turn.result.response,
    artifactsPath: turn.result.artifactsPath,
    cacheId: turn.result.cacheId,
    servedFromCache: turn.result.servedFromCache,
  });
  writeJson(file, current);
  fs.writeFileSync(path.join(kodexPath(root, 'chats'), 'last-chat'), id);
}

function listChats(root, flags) {
  const dir = kodexPath(root, 'chats');
  ensureDir(dir);
  const chats = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(dir, name), null)).filter(Boolean);
  if (booleanFlag(flags, 'json')) console.log(JSON.stringify({ ok: true, chats }, null, 2));
  else if (!chats.length) console.log('No Agentkodex chats yet.');
  else for (const chat of chats) console.log(`${chat.id} turns=${chat.turns?.length || 0} updated=${chat.updatedAt || chat.createdAt}`);
}

function resolveChatId(root, flags) {
  if (booleanFlag(flags, 'new')) return timestampId();
  const resume = stringFlag(flags, 'resume', '');
  if (resume && resume !== 'last') return resume;
  if (resume === 'last') {
    try {
      return fs.readFileSync(path.join(kodexPath(root, 'chats'), 'last-chat'), 'utf8').trim() || timestampId();
    } catch (_) {
      return timestampId();
    }
  }
  return timestampId();
}

function chatFile(root, id) {
  const dir = kodexPath(root, 'chats');
  ensureDir(dir);
  return path.join(dir, `${id}.json`);
}

function startupText(id) {
  return [
    'Agentkodex',
    'The chat-first control plane for AI coding agents.',
    '',
    `Conversation: ${id}`,
    '',
    'Type what you want help with.',
    'Examples: Explain this project | Find bugs | Review architecture | Fix failing tests',
  ].join('\n');
}

function printChatHelp() {
  console.log([
    'Usage:',
    '  agentkodex chat',
    '  agentkodex chat --new "Explain this project"',
    '  agentkodex chat --resume last "Find bugs"',
    '  agentkodex chat --list',
  ].join('\n'));
}

module.exports = {
  chatCommand,
};
