'use strict';

const fs = require('fs');
const path = require('path');

const CHECK_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py']);
const EXCLUDED = new Set(['.git', '.agentkodex', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv']);

function safeProjectFiles(root, requested = []) {
  const base = path.resolve(root || process.cwd());
  if (requested && requested.length) return requested.map((file) => path.resolve(base, file)).filter((file) => isInside(base, file));
  const out = [];
  walk(base, out);
  return out;
}

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && CHECK_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
}

function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  safeProjectFiles,
};
