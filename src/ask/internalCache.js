'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir, readJson, writeJson, hashString, readText } = require('../utils');
const { kodexPath } = require('../kodexStore');
const { redactSecrets } = require('../security/redaction');
const { writeAuditEvidence } = require('../audit/evidence');

const IGNORED = new Set(['.agentkodex', '.git', 'node_modules', 'dist', 'coverage', '.next', '.turbo', 'vendor']);

function readAskCache(root, input) {
  const key = cacheKey(root, input);
  const file = cacheFile(root, key);
  const entry = readJson(file, null);
  if (!entry) {
    const semantic = semanticHit(root, input);
    if (semantic) {
      writeAuditEvidence(root, { type: 'cache_hit', allowed: true, cacheId: semantic.cacheId, reason: 'semantic prompt match', confidence: semantic.confidence });
      return { hit: true, cacheId: semantic.cacheId, value: { ...semantic.entry, cacheReason: 'semantic prompt match', cacheConfidence: semantic.confidence } };
    }
    writeAuditEvidence(root, { type: 'cache_miss', allowed: true, cacheId: key, reason: 'no exact or semantic safe entry' });
    return { hit: false, cacheId: key };
  }
  if (!entry.ok || entry.blocked || containsSecret(entry.response)) {
    writeAuditEvidence(root, { type: 'cache_rejected', allowed: false, cacheId: key, reason: 'unsafe cached entry' });
    return { hit: false, cacheId: key };
  }
  writeAuditEvidence(root, { type: 'cache_hit', allowed: true, cacheId: key, mode: input.mode });
  return { hit: true, cacheId: key, value: entry };
}

function writeAskCache(root, input, result) {
  if (!result.ok || result.mode === 'patch' || containsSecret(result.response)) {
    writeAuditEvidence(root, { type: containsSecret(result.response) ? 'cache_secret_blocked' : 'cache_rejected', allowed: false, reason: 'result not cacheable' });
    return null;
  }
  const key = cacheKey(root, input);
  const meta = cacheMeta(root, input);
  const entry = {
    ok: true,
    cacheId: key,
    createdAt: new Date().toISOString(),
    ...meta,
    mode: result.mode,
    winner: result.winner,
    response: redactSecrets(result.response || ''),
    scores: result.scores || [],
    artifactsPath: result.artifactsPath,
  };
  writeJson(cacheFile(root, key), entry);
  writeAuditEvidence(root, { type: 'cache_written', allowed: true, cacheId: key, mode: result.mode });
  return key;
}

function cacheKey(root, input) {
  return hashString(JSON.stringify(cacheMeta(root, input)), 32);
}

function cacheMeta(root, input) {
  return {
    prompt: normalize(input.prompt),
    fingerprint: fingerprint(input.prompt),
    mode: input.mode,
    gates: input.gates || [],
    agents: input.agents || [],
    repo: repoState(root),
    packageVersion: require('../../package.json').version,
  };
}

function cacheFile(root, key) {
  const dir = kodexPath(root, 'cache');
  ensureDir(dir);
  return path.join(dir, `${key}.json`);
}

function repoState(root) {
  const hash = crypto.createHash('sha256');
  for (const rel of listFiles(root)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readText(path.join(root, rel), ''));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function listFiles(root) {
  const out = [];
  walk(root, '', out);
  return out.sort();
}

function walk(root, rel, out) {
  const dir = path.join(root, rel);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) walk(root, next, out);
    else if (entry.isFile()) out.push(next.replace(/\\/g, '/'));
  }
}

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function containsSecret(value) {
  const text = String(value || '');
  return redactSecrets(text) !== text;
}

function semanticHit(root, input) {
  const dir = kodexPath(root, 'cache');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (_) {
    return null;
  }
  const meta = cacheMeta(root, input);
  let best = null;
  for (const name of names) {
    const entry = readJson(path.join(dir, name), null);
    if (!cacheCompatible(entry, meta)) continue;
    const confidence = similarity(meta.fingerprint, entry.fingerprint || []);
    if (confidence >= 0.82 && (!best || confidence > best.confidence)) best = { entry, cacheId: entry.cacheId, confidence };
  }
  return best;
}

function cacheCompatible(entry, meta) {
  return Boolean(entry?.ok) &&
    !entry.blocked &&
    !containsSecret(entry.response) &&
    entry.mode === meta.mode &&
    entry.repo === meta.repo &&
    entry.packageVersion === meta.packageVersion &&
    sameList(entry.gates, meta.gates) &&
    sameList(entry.agents, meta.agents);
}

function fingerprint(value) {
  const stop = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'please', 'project', 'repo', 'the', 'this', 'to']);
  return [...new Set(normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !stop.has(token)))].sort();
}

function similarity(a = [], b = []) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return Math.round((overlap / union.size) * 100) / 100;
}

function sameList(a = [], b = []) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

module.exports = {
  readAskCache,
  writeAskCache,
  cacheKey,
  fingerprint,
};
