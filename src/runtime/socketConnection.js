'use strict';

const { writeAuditEvidence } = require('../audit/evidence');
const { redactSecrets } = require('../policy');
const { sanitizeError } = require('../security/controlPlane');

const MAX_SOCKET_REQUEST_BYTES = 1024 * 1024;

function attachSocketHandler(socket, context) {
  let raw = '';
  socket.setEncoding('utf8');
  socket.on('data', async (chunk) => {
    raw += chunk;
    if (Buffer.byteLength(raw, 'utf8') > MAX_SOCKET_REQUEST_BYTES) {
      return deny(socket, context, new Error('Daemon request too large.'), { stack: false });
    }
    if (!raw.includes('\n')) return;
    const line = raw.slice(0, raw.indexOf('\n'));
    raw = raw.slice(raw.indexOf('\n') + 1);
    try {
      const request = JSON.parse(line);
      const response = await context.handleRequest(request);
      socket.write(`${JSON.stringify({ ok: true, response })}\n`);
    } catch (error) {
      deny(socket, context, error, { stack: true });
    } finally {
      socket.end();
    }
  });
}

function deny(socket, context, error, options = {}) {
  context.requestGuard.record(error);
  const reason = sanitizeError(error);
  writeAuditEvidence(context.root, { type: 'daemon_request_denied', allowed: false, reason });
  const logValue = options.stack && error?.stack ? redactSecrets(error.stack) : reason;
  context.log(`request error ${logValue}`);
  socket.write(`${JSON.stringify({ ok: false, error: reason })}\n`);
  socket.end();
}

module.exports = {
  attachSocketHandler,
  MAX_SOCKET_REQUEST_BYTES,
};
