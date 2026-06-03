'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function npmPrefix(env = process.env) {
  if (env.npm_config_prefix) return env.npm_config_prefix;
  try {
    return execFileSync('npm', ['config', 'get', 'prefix'], { encoding: 'utf8' }).trim();
  } catch {
    return process.platform === 'win32' ? path.dirname(process.execPath) : '/usr/local';
  }
}

function globalBinDir(prefix, platform = process.platform) {
  return platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

function pathEntries(envPath = process.env.PATH || '') {
  return envPath.split(path.delimiter).filter(Boolean);
}

function normalize(file) {
  return path.resolve(file);
}

function isInPath(dir, entries) {
  const wanted = normalize(dir);
  return entries.some((entry) => normalize(entry) === wanted);
}

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function commandPath(name, envPath = process.env.PATH || '', platform = process.platform) {
  const suffixes = platform === 'win32' ? ['', '.cmd', '.bat', '.ps1'] : [''];
  for (const dir of pathEntries(envPath)) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, `${name}${suffix}`);
      try {
        fs.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep scanning PATH.
      }
    }
  }
  return null;
}

function sameTarget(existing, target) {
  try {
    return normalize(fs.realpathSync(existing)) === normalize(target);
  } catch {
    return false;
  }
}

function ensureExecutable(file, platform = process.platform) {
  if (platform !== 'win32') fs.chmodSync(file, 0o755);
}

function linkLauncher(target, linkPath, platform = process.platform) {
  if (fs.existsSync(linkPath)) {
    if (sameTarget(linkPath, target)) return true;
    try {
      if (fs.lstatSync(linkPath).isSymbolicLink()) fs.unlinkSync(linkPath);
      else return false;
    } catch {
      return false;
    }
  }
  if (platform === 'win32') {
    fs.writeFileSync(linkPath, `@echo off\r\nnode "${target}" %*\r\n`);
    return true;
  }
  fs.symlinkSync(target, linkPath);
  return true;
}

function profilePath(home = os.homedir(), shell = process.env.SHELL || '') {
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (fs.existsSync(path.join(home, '.bashrc'))) return path.join(home, '.bashrc');
  return path.join(home, '.profile');
}

function appendProfilePath(binDir, home = os.homedir(), shell = process.env.SHELL || '') {
  const file = profilePath(home, shell);
  const marker = '# Agentkodex PATH';
  const exportLine = `export PATH="${binDir}:$PATH"`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.includes(marker) || current.includes(exportLine)) return { file, updated: false };
  fs.appendFileSync(file, `${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${marker}\n${exportLine}\n`);
  return { file, updated: true };
}

function candidateDirs({ entries, home, prefix }) {
  const preferred = [globalBinDir(prefix), '/usr/local/bin', path.join(home, '.local', 'bin')];
  return [...new Set([...preferred, ...entries])].filter(Boolean);
}

function repairAgentkodexPath(options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home !== undefined ? options.home : os.homedir();
  const prefix = options.prefix !== undefined ? options.prefix : npmPrefix();
  const envPath = options.envPath !== undefined ? options.envPath : process.env.PATH || '';
  const packageRoot = options.packageRoot || path.resolve(__dirname, '..', '..');
  const binScript = path.join(packageRoot, 'bin', 'agentkodex.js');
  const foundCommand = commandPath('agentkodex', envPath, platform);
  const entries = pathEntries(envPath);
  const result = {
    ok: false,
    commandAvailable: Boolean(foundCommand && sameTarget(foundCommand, binScript)),
    globalBin: globalBinDir(prefix, platform),
    linkPath: null,
    profilePath: null,
    profileUpdated: false,
    needsNewShell: false,
    warnings: [],
  };
  if (result.commandAvailable) return { ...result, ok: true, linkPath: foundCommand };
  if (!fs.existsSync(binScript)) {
    return { ...result, warnings: [`missing Agentkodex bin: ${binScript}`] };
  }
  ensureExecutable(binScript, platform);
  for (const dir of candidateDirs({ entries, home, prefix })) {
    if (!isInPath(dir, entries) || !canWriteDir(dir)) continue;
    const linkPath = path.join(dir, platform === 'win32' ? 'agentkodex.cmd' : 'agentkodex');
    if (linkLauncher(binScript, linkPath, platform)) {
      return { ...result, ok: true, commandAvailable: true, linkPath };
    }
    result.warnings.push(`did not overwrite existing launcher: ${linkPath}`);
  }
  const localBin = path.join(home, '.local', 'bin');
  if (canWriteDir(localBin)) {
    const linkPath = path.join(localBin, platform === 'win32' ? 'agentkodex.cmd' : 'agentkodex');
    if (linkLauncher(binScript, linkPath, platform)) {
      const profile = appendProfilePath(localBin, home);
      return {
        ...result,
        ok: true,
        linkPath,
        profilePath: profile.file,
        profileUpdated: profile.updated,
        needsNewShell: !isInPath(localBin, entries),
      };
    }
  }
  return { ...result, warnings: [...result.warnings, 'no writable PATH repair location found'] };
}

module.exports = {
  appendProfilePath,
  commandPath,
  globalBinDir,
  npmPrefix,
  pathEntries,
  repairAgentkodexPath,
};
