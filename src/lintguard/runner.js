'use strict';

const path = require('path');
const { loadConfig } = require('../kodexStore');
const { checkSidecar } = require('./sidecar');
const { checkLocal } = require('./local');

async function runLintguardCheck(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const config = options.config || loadConfig(root);
  const settings = config.lintguard || {};
  const url = options.url || settings.url || process.env.LINTGUARD_URL || '';
  const useSidecar = Boolean(url) && !options.local;
  const result = useSidecar
    ? await checkSidecar({
      url,
      token: options.token || settings.token || '',
      authRequired: Boolean(options.authRequired ?? settings.authRequired),
      files: options.files || [],
      timeoutMs: options.timeoutMs,
      unsafePublic: Boolean(options.unsafePublic),
    })
    : await checkLocal({
      root,
      gates: options.gates || settings.gates || ['lint', 'typecheck'],
      files: options.files || [],
      mode: options.mode || 'supervised',
      yes: Boolean(options.yes),
      timeoutMs: options.timeoutMs,
      config,
    });
  return { ...result, gate: 'lintguard', mode: useSidecar ? 'sidecar' : 'local' };
}

module.exports = {
  runLintguardCheck,
};
