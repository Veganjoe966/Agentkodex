'use strict';

const fs = require('fs');
const path = require('path');
const { isSubpath } = require('../utils');

const SKIP_DIRS = new Set([
  '.git', '.agentkodex', 'node_modules', 'vendor', 'dist', 'build',
  'coverage', '.next', '.turbo', '.cache', '__pycache__',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.rs',
  '.rb', '.java', '.cs', '.php', '.sh', '.json', '.yaml', '.yml',
]);

function scopedFiles(projectRoot, files = []) {
  const root = path.resolve(projectRoot || process.cwd());
  const selected = Array.isArray(files) ? files.filter(Boolean) : [];
  if (selected.length) return selected.map((file) => path.resolve(root, file)).filter((file) => isSafeFile(root, file));
  return walk(root).filter((file) => isSafeFile(root, file));
}

function isSafeFile(root, file) {
  if (!isSubpath(root, file)) return false;
  const rel = path.relative(root, file);
  if (!rel || rel.split(path.sep).some((part) => SKIP_DIRS.has(part))) return false;
  if (isEnvFile(path.basename(file))) return true;
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function isEnvFile(name) {
  return /^\.env(?:$|\.)/.test(name) && !/\.(example|sample|template)$/i.test(name);
}

function walk(dir) {
  let out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

module.exports = {
  scopedFiles,
  isEnvFile,
};
