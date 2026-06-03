#!/usr/bin/env node
'use strict';

const path = require('path');
const { startDaemon } = require('./daemonServer');
const client = require('./client');
const { appendText } = require('../utils');
const { daemonLogPath } = require('./sessionStore');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const root = path.resolve(flags.root || flags.cwd || process.cwd());
  const daemon = await startDaemon(root, { foreground: Boolean(flags.foreground) });
  if (flags.foreground) console.log(`Agentkodex daemon listening at ${daemon.socketPath}`);
  // Keep the daemon process alive. The server closes itself on stop.
  await new Promise(() => {});
}

if (require.main === module) {
  main().catch((error) => {
    try {
      const root = path.resolve(parseArgs(process.argv.slice(2)).root || process.cwd());
      appendText(daemonLogPath(root), `${new Date().toISOString()} daemon fatal ${error.stack || error.message}\n`);
    } catch (_) {}
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  startDaemon,
  request: client.request,
  pingDaemon: client.pingDaemon,
  ensureDaemon: client.ensureDaemon,
  startDaemonProcess: client.startDaemonProcess,
  stopDaemon: client.stopDaemon,
  waitForSession: client.waitForSession,
};
