'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRun } = require('../kodexStore');
const { createAuditBundle } = require('../audit/bundle');
const { verifyAuditBundle } = require('../audit/verify');
const { redactSecrets } = require('../security/redaction');
const { readJson, writeText } = require('../utils');
const { packageConsistencyCheck } = require('./packageConsistency');
const BANNED_PATH_RE = new RegExp(`${escapeRegExp('/app')}/${escapeRegExp('test_project')}\\b|${escapeRegExp('/root')}/${escapeRegExp('agentguard')}\\b`, 'i');

function runReleaseGate(root, options = {}) {
  if (!isAgentkodexPackage(root) && !options.allowNonPackageRoot) return nonPackageRootResult(root);
  const checks = [];
  if (!options.skipCommands) {
    checks.push(run('npm test', root, 'npm', ['test']));
    if (hasScript(root, 'lint')) checks.push(run('npm run lint', root, 'npm', ['run', 'lint']));
    if (hasScript(root, 'typecheck')) checks.push(run('npm run typecheck', root, 'npm', ['run', 'typecheck']));
    if (hasScript(root, 'quality:gate')) checks.push(run('npm run quality:gate', root, 'npm', ['run', 'quality:gate']));
    checks.push(run('policy check', root, process.execPath, [path.join(root, 'bin', 'agentkodex.js'), 'policy', 'check', '--json']));
  }
  checks.push(packageConsistencyCheck(root));
  checks.push(scanRepo(root));
  checks.push(auditBundleCheck(root));
  if (!options.skipPackageInstall) checks.push(packageInstallCheck(root));
  if (!options.skipCommands) checks.push(cliSmokeCheck(root));
  const ok = checks.every((check) => check.ok);
  return {
    ok,
    summary: ok ? 'Release gate passed.' : 'Release gate failed.',
    checks,
  };
}

function run(name, cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
    env: options.env || process.env,
  });
  return {
    name,
    ok: result.status === 0,
    exitCode: result.status,
    errors: result.status === 0 ? 0 : 1,
    warnings: 0,
    details: commandDetails(`${result.stdout || ''}${result.stderr || ''}`, result.status),
  };
}

function scanRepo(root) {
  const errors = [];
  const packageJson = readJson(path.join(root, 'package.json'), {});
  const deps = Object.keys({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) });
  for (const dep of deps) if (/posthog|emergent/i.test(dep)) errors.push(`disallowed dependency ${dep}`);
  for (const file of packagedFiles(root)) {
    const rel = path.relative(root, file);
    if (/(^|[/\\])\.env(?:$|\.)/i.test(rel) && !/\.(example|sample|template)$/i.test(rel)) errors.push(`checked-in env file ${rel}`);
    if (/posthog|emergent/i.test(rel)) errors.push(`disallowed artifact path ${rel}`);
    const text = safeText(file);
    if (BANNED_PATH_RE.test(text)) errors.push(`hardcoded absolute project path in ${rel}`);
    if (!isSecretScannerSource(rel) && containsObviousSecret(text)) errors.push(`secret-looking value in ${rel}`);
  }
  return { name: 'repo-hygiene', ok: errors.length === 0, errors: errors.length, warnings: 0, details: errors };
}

function auditBundleCheck(root) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-release-audit-'));
  const run = createRun(temp, 'release gate audit verification');
  writeText(path.join(run.dir, 'transcript.log'), 'release gate\n');
  const bundle = createAuditBundle(temp, { target: run.id });
  const verified = verifyAuditBundle(bundle.dir, { projectRoot: temp });
  return { name: 'audit-bundle-verify', ok: verified.ok, errors: verified.errors.length, warnings: verified.warnings.length, details: verified.errors.concat(verified.warnings) };
}

function packageInstallCheck(root) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-release-install-'));
  const env = { ...process.env, AGENTKODEX_SKIP_PATH_REPAIR: '1', PATH: `${path.join(temp, 'bin')}${path.delimiter}${process.env.PATH || ''}` };
  const install = run('package install', root, 'npm', ['install', '-g', '--prefix', temp, '.'], { env });
  if (!install.ok) return install;
  const bin = path.join(temp, 'bin', process.platform === 'win32' ? 'agentkodex.cmd' : 'agentkodex');
  return run('installed CLI version', root, bin, ['--version']);
}

function cliSmokeCheck(root) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-release-cli-'));
  const bin = path.join(root, 'bin', 'agentkodex.js');
  const help = run('CLI help', root, process.execPath, [bin, '--help']);
  const quality = run('quality JSON smoke', root, process.execPath, [bin, 'quality', 'check', '--cwd', temp, '--json']);
  const policy = run('policy JSON smoke', root, process.execPath, [bin, 'policy', 'check', '--json']);
  const setup = run('setup JSON smoke', root, process.execPath, [bin, 'setup', '--cwd', temp, '--json'], { env: safeSmokeEnv() });
  const askRoot = prepareAskSmokeProject(temp);
  const agents = run('agents JSON smoke', root, process.execPath, [bin, 'agents', '--cwd', askRoot, '--json']);
  const ask = run('ask JSON smoke', root, process.execPath, [bin, 'ask', '--cwd', askRoot, '--agents', 'helper', '--json', 'Explain']);
  const chat = run('chat help smoke', root, process.execPath, [bin, 'chat', '--help']);
  const checks = [help, quality, policy, setup, agents, ask, chat];
  const ok = checks.every((item) => item.ok);
  return { name: 'cli-smoke', ok, errors: ok ? 0 : 1, warnings: 0, details: checks.filter((item) => !item.ok).map((item) => `${item.name}: ${item.details}`) };
}

function prepareAskSmokeProject(parent) {
  const dir = path.join(parent, 'ask-smoke');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agentkodex'), { recursive: true });
  writeText(path.join(dir, 'package.json'), JSON.stringify({ name: 'ask-smoke', private: true }, null, 2));
  writeText(path.join(dir, 'scripts', 'helper.js'), 'console.log("release gate answer")\n');
  writeText(path.join(dir, '.agentkodex', 'config.json'), JSON.stringify({
    version: 2,
    agents: {
      helper: { kind: 'custom', commandTemplate: 'node scripts/helper.js', stdin: false },
    },
  }, null, 2));
  return dir;
}

function safeSmokeEnv() {
  return { ...process.env, PATH: ['/bin', '/usr/bin'].join(path.delimiter) };
}

function isAgentkodexPackage(root) {
  return readJson(path.join(root, 'package.json'), {}).name === 'agentkodex' && fs.existsSync(path.join(root, 'bin', 'agentkodex.js'));
}

function nonPackageRootResult(root) {
  return {
    ok: false,
    summary: 'Release gate failed.',
    checks: [{
      name: 'release-root',
      ok: false,
      errors: 1,
      warnings: 0,
      details: [`${root} is not the Agentkodex package root. Run project quality checks with "agentkodex quality check" or "agentkodex gates run".`],
    }],
  };
}

function packagedFiles(root) {
  const out = [];
  walk(root, out);
  return out.filter((file) => !/[/\\](?:node_modules|\.git|\.agentkodex|tests|coverage|dist|build)[/\\]/.test(file));
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.agentkodex', 'tests', 'coverage', 'dist', 'build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function safeText(file) {
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function isSecretScannerSource(rel) {
  return ['src/security/redaction.js', 'src/release/gate.js'].includes(String(rel).replace(/\\/g, '/'));
}

function containsObviousSecret(text) {
  const value = String(text || '');
  const patterns = [
    /npm_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /gh[pousr]_[A-Za-z0-9_]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /anthropic_[A-Za-z0-9_-]{20,}/,
    /AIza[A-Za-z0-9_-]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /ASIA[0-9A-Z]{16}/,
    /\b(?:eyJ[A-Za-z0-9_-]{10,})\.(?:eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/,
    /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s"'<>]+/i,
    /-----BEGIN (?:OPENSSH |[A-Z ]+)?PRIVATE KEY-----/,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function hasScript(root, name) {
  return Boolean(readJson(path.join(root, 'package.json'), {}).scripts?.[name]);
}

function tail(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function commandDetails(output, status) {
  const text = redactSecrets(output);
  if (status === 0) return tail(text, 1200);
  const lines = text.split(/\r?\n/);
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (!/(?:^not ok\b|AssertionError|ERR_|Error:|# fail [1-9]|# failed)/.test(lines[i])) continue;
    for (let j = Math.max(0, i - 6); j <= Math.min(lines.length - 1, i + 18); j += 1) {
      if (seen.has(j)) continue;
      seen.add(j);
      picked.push(lines[j]);
    }
  }
  const summary = picked.length ? `${picked.join('\n')}\n\n--- output tail ---\n` : '';
  return tail(`${summary}${tail(text, 5000)}`, 8000);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  runReleaseGate,
};
