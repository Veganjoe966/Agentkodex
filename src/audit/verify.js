'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson } = require('../utils');
const { computeBundleHash, renderSummary } = require('./manifest');
const { writeAuditEvidence } = require('./evidence');
const { canonical } = require('../capabilities/issuer');
const { verificationKeys } = require('../capabilities/keys');

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
  verifyGeneratedFile(dir, 'summary.md', renderSummary(manifest), errors);
  verifyGeneratedFile(dir, 'redaction-report.json', `${JSON.stringify(manifest.redaction || {}, null, 2)}\n`, errors);
  const expectedHash = computeBundleHash({ ...manifest, bundleHash: '' });
  if (manifest.bundleHash && manifest.bundleHash !== expectedHash) errors.push('bundleHash mismatch');
  verifyBundleSignature(manifest, options.projectRoot, errors, warnings);
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

function verifyBundleSignature(manifest, projectRoot, errors, warnings) {
  if (!projectRoot) {
    warnings.push('bundle signature was not checked because projectRoot was not provided');
    return;
  }
  const item = manifest.bundleSignature;
  if (!item?.signature || item.algorithm !== 'ed25519' || !item.keyId) {
    errors.push('bundle signature is missing');
    return;
  }
  const key = verificationKeys(projectRoot).find((candidate) => candidate.keyId === item.keyId);
  if (!key) {
    errors.push('bundle signature key is unavailable');
    return;
  }
  const payload = { kind: 'audit_bundle', algorithm: 'ed25519', keyId: item.keyId, bundleHash: manifest.bundleHash };
  try {
    const ok = crypto.verify(null, Buffer.from(canonical(payload)), key.publicKeyPem, Buffer.from(item.signature, 'base64url'));
    if (!ok) errors.push('bundle signature is invalid');
  } catch (_) {
    errors.push('bundle signature is invalid');
  }
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

function verifyGeneratedFile(dir, name, expected, errors) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    errors.push(`${name} is missing`);
    return;
  }
  const actual = fs.readFileSync(file, 'utf8');
  if (actual !== expected) errors.push(`${name} mismatch`);
}

module.exports = {
  verifyAuditBundle,
};
