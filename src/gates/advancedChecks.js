'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { readJson, isSubpath } = require('../utils');

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const DEFAULT_BANNED = ['posthog', 'posthog-js', '@emergentbase', 'emergent'];
const BUILTINS = new Set(Module.builtinModules.concat(Module.builtinModules.map((name) => name.replace(/^node:/, ''))));

function runAdvancedChecks(root, files, options = {}) {
  const jsFiles = files.filter((file) => JS_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const config = options.quality || options.config?.qualityGate || {};
  return [
    complexityCheck(root, jsFiles, Number(options.maxComplexity || config.maxComplexity || 60)),
    circularDepsCheck(root, jsFiles),
    deadImportsCheck(root, jsFiles, options.unusedImportsMode || config.unusedImports || 'warn'),
    dependencyHygieneCheck(root, jsFiles, options.bannedPackages || config.bannedPackages || DEFAULT_BANNED),
    architectureBoundariesCheck(root, jsFiles, options.forbiddenImportMap || config.forbiddenImportMap || {}),
  ];
}

function complexityCheck(root, files, max) {
  const details = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    for (const item of functionsIn(read(file))) {
      const score = complexityScore(item.body);
      if (score > max) details.push(`${rel}:${item.name} complexity ${score} exceeds ${max}`);
    }
  }
  return check('complexity', details.length === 0, details.length, 0, details);
}

function circularDepsCheck(root, files) {
  const graph = dependencyGraph(root, files);
  const cycles = [];
  for (const node of graph.keys()) visit(node, [], new Set());
  function visit(node, stack, seen) {
    if (stack.includes(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node);
      const rendered = cycle.join(' -> ');
      if (!cycles.includes(rendered)) cycles.push(rendered);
      return;
    }
    if (seen.has(node) || cycles.length >= 20) return;
    seen.add(node);
    for (const next of graph.get(node) || []) visit(next, stack.concat(node), seen);
  }
  return check('circular-deps', cycles.length === 0, cycles.length, 0, cycles);
}

function deadImportsCheck(root, files, mode) {
  const details = [];
  for (const file of files) {
    const text = read(file);
    const body = text.replace(IMPORT_RE, '');
    for (const imported of esImports(text)) {
      if (imported.local && !new RegExp(`\\b${escapeRegExp(imported.local)}\\b`).test(body)) {
        details.push(`${path.relative(root, file)} unused import ${imported.local}`);
      }
    }
  }
  const fail = mode === 'fail' && details.length > 0;
  return check('dead-imports', !fail, fail ? details.length : 0, fail ? 0 : details.length, details);
}

function dependencyHygieneCheck(root, files, banned) {
  const packageJson = readJson(path.join(root, 'package.json'), {});
  const declared = new Set(Object.keys({
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  }));
  const bannedList = Array.isArray(banned) ? banned : DEFAULT_BANNED;
  const errors = [];
  const warnings = [];
  for (const file of files) {
    for (const spec of importSpecs(read(file))) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      const pkg = packageName(spec);
      if (spec.startsWith('node:') || BUILTINS.has(pkg) || BUILTINS.has(spec)) continue;
      if (bannedList.some((item) => pkg === item || spec.startsWith(`${item}/`))) errors.push(`${path.relative(root, file)} imports banned package ${pkg}`);
      else if (!declared.has(pkg)) warnings.push(`${path.relative(root, file)} imports missing dependency ${pkg}`);
    }
  }
  return check('dependency-hygiene', errors.length === 0, errors.length, warnings.length, errors.concat(warnings));
}

function architectureBoundariesCheck(root, files, map) {
  const details = [];
  for (const file of files) {
    const rel = slash(path.relative(root, file));
    const forbidden = Object.entries(map).find(([source]) => rel.startsWith(slash(source).replace(/\/$/, '')));
    if (!forbidden) continue;
    for (const spec of importSpecs(read(file)).filter((item) => item.startsWith('.'))) {
      const target = resolveImport(root, file, spec);
      if (!target) continue;
      const targetRel = slash(path.relative(root, target));
      for (const blocked of forbidden[1] || []) {
        if (targetRel.startsWith(slash(blocked).replace(/\/$/, ''))) details.push(`${rel} imports forbidden boundary ${targetRel}`);
      }
    }
  }
  return check('architecture-boundaries', details.length === 0, details.length, 0, details);
}

const IMPORT_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?|import\s+['"]([^'"]+)['"];?/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function importSpecs(text) {
  const out = [];
  for (const match of text.matchAll(IMPORT_RE)) out.push(match[2] || match[3]);
  for (const match of text.matchAll(REQUIRE_RE)) out.push(match[1]);
  return out.filter(Boolean);
}

function esImports(text) {
  const out = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const clause = String(match[1] || '').trim();
    if (!clause || clause.startsWith('{') && !clause.endsWith('}')) continue;
    if (clause.startsWith('* as ')) out.push({ local: clause.replace('* as ', '').trim() });
    else if (clause.startsWith('{')) {
      for (const part of clause.slice(1, -1).split(',')) {
        const local = part.split(/\s+as\s+/).pop().trim();
        if (local) out.push({ local });
      }
    } else out.push({ local: clause.split(',')[0].trim() });
  }
  return out.filter((item) => /^[A-Za-z_$][\w$]*$/.test(item.local));
}

function dependencyGraph(root, files) {
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  for (const file of files) {
    const rel = slash(path.relative(root, file));
    const deps = [];
    for (const spec of importSpecs(read(file)).filter((item) => item.startsWith('.'))) {
      const resolved = resolveImport(root, file, spec);
      if (resolved && fileSet.has(resolved)) deps.push(slash(path.relative(root, resolved)));
    }
    graph.set(rel, deps);
  }
  return graph;
}

function resolveImport(root, fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = ['', ...JS_EXTENSIONS].map((ext) => `${base}${ext}`).concat([...JS_EXTENSIONS].map((ext) => path.join(base, `index${ext}`)));
  return candidates.find((candidate) => isSubpath(root, candidate) && fs.existsSync(candidate)) || null;
}

function functionsIn(text) {
  const out = [];
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;
  for (const match of text.matchAll(re)) {
    const start = match.index + match[0].length - 1;
    const end = matchingBrace(text, start);
    out.push({ name: match[1] || match[2] || '(anonymous)', body: text.slice(start, end + 1) });
  }
  return out.length ? out : [{ name: '(file)', body: text }];
}

function matchingBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length - 1;
}

function complexityScore(text) {
  const matches = text.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g);
  return 1 + (matches ? matches.length : 0);
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function check(name, ok, errors, warnings, details) {
  return { name, ok, errors, warnings, details };
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  runAdvancedChecks,
};
