'use strict';

const { sanitizeError } = require('../security/controlPlane');

function controlRequestError(session, error) {
  const raw = sanitizeError(error);
  const transient = /ENOENT|ECONNREFUSED|socket|Timed out|connect/i.test(raw);
  const message = transient
    ? `Session ${session.id} is not live or is not accepting control requests. Cause: the session supervisor has stopped or the session already completed. Suggested action: run "agentkodex session status ${session.id}" or "agentkodex session replay ${session.id}".`
    : `Session ${session.id} control request failed. Cause: ${raw}. Suggested action: run "agentkodex session status ${session.id}".`;
  return new Error(message);
}

module.exports = {
  controlRequestError,
};
