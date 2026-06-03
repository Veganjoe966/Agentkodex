'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson } = require('../utils');
const { computeBundleHash } = require('./manifest');
const { writeAuditEvidence } = require('./evidence');

function verifyAuditBundle(bundleDir, options = {}) {
  const dir = path.resolve(bundleDir || '');
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = readJson(manifestPath, null);
  const errors = [];
  const warnings = [];
  if (!manifest) return result(false, ['manifest.json is missing or invalid'], warnings, null);
  for (const artifact of manifest.artifacts || []) {
    const file = path.join(dir, artifact.file || '');
    if (!artifact.file || !fs.existsSync(file)) {
      errors.push(`missing artifact ${artifact.role || artifact.file}`);
      continue;
    }
    const hash = sha256(fs.readFileSync(file));
    if (artifact.sha256 && hash !== artifact.sha256) errors.push(`hash mismatch for ${artifact.file}`);
  }
  const expectedHash = computeBundleHash({ ...manifest, bundleHash: '' });
  if (manifest.bundleHash && manifest.bundleHash !== expectedHash) errors.push('bundleHash mismatch');
  if (!manifest.redactionApplied) warnings.push('manifest does not mark redactionApplied=true');
  const out = result(errors.length === 0, errors, warnings, manifest);
  if (options.projectRoot) {
    writeAuditEvidence(options.projectRoot, {
      type: 'audit_bundle_verified',
      allowed: out.ok,
      bundleDir: dir,
      errors,
      warnings,
    }, { runDir: options.runDir });
  }
  return out;
}

function result(ok, errors, warnings, manifest) {
  return {
    ok,
    summary: ok ? 'Audit bundle verification passed.' : 'Audit bundle verification failed.',
    errors,
    warnings,
    manifest: manifest ? {
      runId: manifest.runId || null,
      sessionId: manifest.sessionId || null,
      artifactCount: (manifest.artifacts || []).length,
      bundleHash: manifest.bundleHash || '',
    } : null,
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  verifyAuditBundle,
};
