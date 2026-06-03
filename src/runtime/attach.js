'use strict';

const fs = require('fs');
const readline = require('readline');
const { getSession } = require('./sessionStore');
const { sendToSession, interruptSession, approveSession, denySession } = require('./sessionManager');

async function attachSession(root, idOrLast = 'last', options = {}) {
  const session = getSession(root, idOrLast);
  if (!session) throw new Error(`Session not found: ${idOrLast}`);
  const transcript = session.files && session.files.transcript;
  if (!transcript) throw new Error(`Session ${session.id} has no transcript file.`);

  const startAtEnd = options.fromStart !== true;
  let offset = 0;
  if (fs.existsSync(transcript) && startAtEnd) offset = fs.statSync(transcript).size;
  else if (fs.existsSync(transcript)) {
    const text = fs.readFileSync(transcript, 'utf8');
    if (text) process.stdout.write(text);
    offset = Buffer.byteLength(text);
  }

  process.stdout.write(`\n[Agentkodex attach] session=${session.id} state=${session.state || session.status}\n`);
  process.stdout.write('[Agentkodex attach] type :detach to exit, :status, :interrupt, :approve, :deny, or send normal text to the agent.\n\n');

  const interval = setInterval(() => {
    try {
      if (!fs.existsSync(transcript)) return;
      const stat = fs.statSync(transcript);
      if (stat.size <= offset) return;
      const stream = fs.createReadStream(transcript, { start: offset, end: stat.size - 1, encoding: 'utf8' });
      offset = stat.size;
      stream.on('data', (chunk) => process.stdout.write(chunk));
    } catch (_) {}
  }, Number(options.pollMs || 300));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
  return new Promise((resolve) => {
    async function close() {
      clearInterval(interval);
      rl.close();
      resolve();
    }
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      try {
        if (trimmed === ':detach' || trimmed === ':q' || trimmed === ':quit') return close();
        if (trimmed === ':status') {
          const current = getSession(root, session.id);
          process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
          return;
        }
        if (trimmed === ':interrupt') {
          const result = await interruptSession(root, session.id);
          process.stdout.write(`${JSON.stringify(result.response || result, null, 2)}\n`);
          return;
        }
        if (trimmed.startsWith(':approve')) {
          const input = trimmed.slice(':approve'.length).trim() || undefined;
          const result = await approveSession(root, session.id, null, input ? `${input}\n` : undefined);
          process.stdout.write(`${JSON.stringify(result.response || result, null, 2)}\n`);
          return;
        }
        if (trimmed.startsWith(':deny')) {
          const input = trimmed.slice(':deny'.length).trim() || undefined;
          const result = await denySession(root, session.id, null, input ? `${input}\n` : undefined);
          process.stdout.write(`${JSON.stringify(result.response || result, null, 2)}\n`);
          return;
        }
        await sendToSession(root, session.id, line, { newline: true });
      } catch (error) {
        process.stderr.write(`[attach error] ${error.message}\n`);
      }
    });
    rl.on('close', () => {
      clearInterval(interval);
      resolve();
    });
  });
}

module.exports = {
  attachSession,
};
