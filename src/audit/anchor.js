'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ensureDir, readJson, readText, writeJson } = require('../utils');
const { computeBundleHash } = require('./manifest');
const { verifyAuditBundle } = require('./verify');
const { writeAuditEvidence } = require('./evidence');
const { activeSigningKey, verificationKeys } = require('../capabilities/keys');
const { sign, canonical } = require('../capabilities/issuer');

function anchorBundle(bundleDir, options = {}) {
  const root = path.resolve(options.projectRoot || options.root || process.cwd());
  const dir = path.resolve(bundleDir);
  const anchorPath = resolveAnchorPath(root, options);
  const previous = lastAnchor(anchorPath);
  const base = bundleFacts(dir);
  const key = activeSigningKey(root);
  const entry = {
    product: 'Agentkodex',
    kind: 'audit_anchor',
    version: 1,
    createdAt: new Date().toISOString(),
    bundleDir: dir,
    projectRootHash: sha256(root),
    bundleHash: base.bundleHash,
    evidenceHash: base.evidenceHash,
    previousAnchorHash: previous?.currentAnchorHash || '',
    algorithm: 'ed25519',
    keyId: key.keyId,
  };
  entry.currentAnchorHash = anchorHash(entry);
  entry.signature = sign(root, entry);
  appendAnchor(anchorPath, entry);
  writeJson(path.join(dir, 'anchor.json'), { ...entry, anchorPath: maskPath(anchorPath) });
  writeAuditEvidence(root, { type: 'audit_anchor_created', allowed: true, bundleDir: dir, anchorHash: entry.currentAnchorHash });
  return { ok: true, summary: 'Audit anchor created.', anchorPath, anchor: entry };
}

function verifyAnchor(bundleDir, options = {}) {
  const root = path.resolve(options.projectRoot || options.root || process.cwd());
  const dir = path.resolve(bundleDir);
  const anchorPath = resolveAnchorPath(root, options);
  const errors = [];
  const warnings = [];
  const anchor = readJson(path.join(dir, 'anchor.json'), null);
  if (!anchor) errors.push('anchor.json is missing or invalid');
  const bundle = bundleFacts(dir, errors);
  const bundleVerification = verifyAuditBundle(dir, { projectRoot: root });
  errors.push(...bundleVerification.errors.map((item) => `bundle: ${item}`));
  warnings.push(...bundleVerification.warnings.map((item) => `bundle: ${item}`));
  if (anchor) {
    if (anchor.bundleHash !== bundle.bundleHash) errors.push('anchor bundleHash mismatch');
    if (anchor.evidenceHash !== bundle.evidenceHash) errors.push('anchor evidenceHash mismatch');
    verifyAnchorSignature(root, anchor, errors);
    verifyChain(anchorPath, anchor.currentAnchorHash, errors);
  }
  const ok = errors.length === 0;
  writeAuditEvidence(root, { type: 'audit_anchor_verified', allowed: ok, bundleDir: dir, errors, warnings });
  return {
    ok,
    summary: ok ? 'Audit anchor verification passed.' : 'Audit anchor verification failed.',
    errors,
    warnings,
    anchor: anchor ? publicAnchor(anchor, anchorPath) : null,
  };
}

function bundleFacts(dir, errors = []) {
  const manifest = readJson(path.join(dir, 'manifest.json'), null);
  if (!manifest) {
    errors.push('manifest.json is missing or invalid');
    return { bundleHash: '', evidenceHash: '' };
  }
  const computed = computeBundleHash({ ...manifest, bundleHash: '' });
  const evidence = (manifest.artifacts || []).find((item) => item.role === 'audit_evidence');
  return {
    bundleHash: computed,
    evidenceHash: evidence ? artifactHash(dir, evidence, errors) : sha256(''),
  };
}

function artifactHash(dir, artifact, errors) {
  const file = path.join(dir, artifact.file || '');
  if (!artifact.file || !fs.existsSync(file)) {
    errors.push(`missing evidence artifact ${artifact.file || artifact.role}`);
    return '';
  }
  return sha256(fs.readFileSync(file));
}

function verifyAnchorSignature(root, anchor, errors) {
  const key = verificationKeys(root).find((item) => item.keyId === anchor.keyId);
  if (!key) return errors.push('anchor signature key is unavailable');
  const signed = { ...anchor };
  delete signed.anchorPath;
  try {
    const ok = crypto.verify(null, Buffer.from(canonical(signed)), key.publicKeyPem, Buffer.from(anchor.signature || '', 'base64url'));
    if (!ok) errors.push('anchor signature is invalid');
  } catch (_) {
    errors.push('anchor signature is invalid');
  }
}

function verifyChain(anchorPath, targetHash, errors) {
  const entries = readAnchors(anchorPath);
  let previous = '';
  let found = false;
  for (const entry of entries) {
    if (entry.previousAnchorHash !== previous) errors.push(`anchor chain break at ${entry.currentAnchorHash || 'unknown'}`);
    if (anchorHash(entry) !== entry.currentAnchorHash) errors.push(`anchor hash mismatch at ${entry.currentAnchorHash || 'unknown'}`);
    previous = entry.currentAnchorHash || '';
    if (entry.currentAnchorHash === targetHash) found = true;
  }
  if (!found) errors.push('anchor entry is missing from anchor log');
}

function appendAnchor(anchorPath, entry) {
  ensureDir(path.dirname(anchorPath));
  try { fs.chmodSync(path.dirname(anchorPath), 0o700); } catch (_) {}
  fs.appendFileSync(anchorPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(anchorPath, 0o600); } catch (_) {}
}

function readAnchors(anchorPath) {
  return readText(anchorPath, '').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return { currentAnchorHash: '', previousAnchorHash: '' }; }
  });
}

function lastAnchor(anchorPath) {
  const entries = readAnchors(anchorPath);
  return entries[entries.length - 1] || null;
}

function resolveAnchorPath(root, options = {}) {
  if (options.anchorPath) return path.resolve(options.anchorPath);
  if (process.env.AGENTKODEX_AUDIT_ANCHOR_PATH) return path.resolve(process.env.AGENTKODEX_AUDIT_ANCHOR_PATH);
  return path.join(os.homedir(), '.agentkodex', 'audit-anchors.jsonl');
}

function anchorHash(anchor) {
  const clean = { ...anchor };
  delete clean.currentAnchorHash;
  delete clean.signature;
  delete clean.anchorPath;
  return sha256(JSON.stringify(Object.keys(clean).sort().reduce((out, key) => {
    out[key] = clean[key];
    return out;
  }, {})));
}

function publicAnchor(anchor, anchorPath) {
  return {
    currentAnchorHash: anchor.currentAnchorHash,
    previousAnchorHash: anchor.previousAnchorHash,
    bundleHash: anchor.bundleHash,
    evidenceHash: anchor.evidenceHash,
    createdAt: anchor.createdAt,
    keyId: anchor.keyId || null,
    anchorPath: maskPath(anchorPath),
  };
}

function maskPath(value) {
  return path.basename(value || '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  anchorBundle,
  verifyAnchor,
  resolveAnchorPath,
  anchorHash,
};
