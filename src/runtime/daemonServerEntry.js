#!/usr/bin/env node
'use strict';

const path = require('path');
const { startDaemon } = require('./daemonServer');

function parseRoot(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === '--root' || token === '--cwd' || token === '--repo') && argv[i + 1]) return path.resolve(argv[i + 1]);
    if (token.startsWith('--root=')) return path.resolve(token.slice('--root='.length));
    if (token.startsWith('--cwd=')) return path.resolve(token.slice('--cwd='.length));
    if (token.startsWith('--repo=')) return path.resolve(token.slice('--repo='.length));
  }
  return process.cwd();
}

async function main() {
  const root = parseRoot(process.argv.slice(2));
  const daemon = await startDaemon(root, { foreground: process.env.AGENTKODEX_DAEMON_FOREGROUND === '1' });
  process.on('SIGTERM', async () => { try { await daemon.stop(); } catch (_) { process.exit(0); } });
  process.on('SIGINT', async () => { try { await daemon.stop(); } catch (_) { process.exit(0); } });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { main, parseRoot };
