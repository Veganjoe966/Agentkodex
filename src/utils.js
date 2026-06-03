'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath, fallback = '') {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return fallback;
  }
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

function appendText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, value, 'utf8');
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readText(filePath));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function timestampId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function slugify(input, maxLength = 60) {
  const slug = String(input || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'task';
}

function hashString(input, length = 8) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, length);
}

function shellQuote(value) {
  const s = String(value);
  if (s.length === 0) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function findUp(startDir, fileNames) {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (true) {
    for (const name of fileNames) {
      const candidate = path.join(current, name);
      if (exists(candidate)) return candidate;
    }
    if (current === root) return null;
    current = path.dirname(current);
  }
}

function isSubpath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyDirFiltered(source, destination, options = {}) {
  const ignore = new Set(options.ignore || ['.git', 'node_modules', '.agentkodex', 'dist', 'coverage', '.next', '.turbo']);
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirFiltered(src, dst, options);
    else if (entry.isSymbolicLink()) {
      try {
        const link = fs.readlinkSync(src);
        fs.symlinkSync(link, dst);
      } catch (_) {
        // Skip broken symlinks.
      }
    } else if (entry.isFile()) {
      ensureDir(path.dirname(dst));
      fs.copyFileSync(src, dst);
    }
  }
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function tempDir(prefix = 'agentkodex-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = {
  exists,
  ensureDir,
  readText,
  writeText,
  appendText,
  readJson,
  writeJson,
  timestampId,
  slugify,
  hashString,
  shellQuote,
  findUp,
  isSubpath,
  copyDirFiltered,
  uniqueBy,
  tempDir,
};
