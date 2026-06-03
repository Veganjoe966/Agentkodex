'use strict';

const WINDOW_MS = 60 * 1000;
const MAX_INVALID = 20;

function createRequestGuard() {
  const invalid = [];
  return {
    validate(request) {
      if (!request || typeof request !== 'object') throw new Error('Invalid daemon request.');
      if (typeof request.type !== 'string' || !request.type.trim()) throw new Error('Invalid daemon request type.');
    },
    record(error) {
      if (!/Unauthorized|Unknown daemon request|Invalid daemon request/i.test(String(error?.message || error))) return;
      const now = Date.now();
      invalid.push(now);
      while (invalid.length && now - invalid[0] > WINDOW_MS) invalid.shift();
    },
    assert() {
      const now = Date.now();
      while (invalid.length && now - invalid[0] > WINDOW_MS) invalid.shift();
      if (invalid.length >= MAX_INVALID) throw new Error('Too many invalid daemon requests.');
    },
  };
}

module.exports = {
  createRequestGuard,
};
