'use strict';

const fs = require('fs');
const path = require('path');
const { exists, readJson, readText, uniqueBy } = require('./utils');

function discoverProject(rootDir) {
  const root = path.resolve(rootDir);
  const files = listTopLevelEvidence(root);
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = readJson(packageJsonPath, null);

  const result = {
    root,
    generatedAt: new Date().toISOString(),
    projectName: packageJson?.name || path.basename(root),
    languages: [],
    frameworks: [],
    packageManager: null,
    commands: [],
    env: [],
    services: [],
    evidenceFiles: files,
    notes: [],
  };

  if (packageJson) detectNode(root, packageJson, result);
  detectPython(root, result);
  detectGo(root, result);
  detectRust(root, result);
  detectRuby(root, result);
  detectJava(root, result);
  detectDotnet(root, result);
  detectDocker(root, result);
  detectMakeLike(root, result);
  detectEnv(root, result);
  detectCi(root, result);
  inferFrameworksFromFiles(root, packageJson, result);

  result.languages = [...new Set(result.languages)];
  result.frameworks = [...new Set(result.frameworks)];
  result.services = [...new Set(result.services)];
  result.commands = uniqueBy(result.commands, (cmd) => `${cmd.name}:${cmd.command}`);

  return result;
}

function listTopLevelEvidence(root) {
  const candidates = [
    'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb',
    'pyproject.toml', 'requirements.txt', 'Pipfile', 'poetry.lock', 'uv.lock',
    'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'gradlew', 'Makefile', 'justfile', 'Taskfile.yml', 'Taskfile.yaml',
    'Dockerfile', 'docker-compose.yml', 'compose.yml', '.env.example', 'README.md',
    'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md'
  ];
  return candidates.filter((name) => exists(path.join(root, name)));
}

function addCommand(result, name, command, evidence, confidence = 'medium', category = 'project') {
  if (!command) return;
  result.commands.push({ name, command, evidence, confidence, category });
}

function detectNode(root, packageJson, result) {
  result.languages.push('javascript/typescript');
  const scripts = packageJson.scripts || {};
  const pm = detectPackageManager(root);
  result.packageManager = pm;

  addCommand(result, 'install', installCommand(pm), packageJsonEvidence(root, pm), 'high', 'setup');

  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    addCommand(result, scriptName, `${pm} ${scriptRunVerb(pm)} ${scriptName}`, `package.json scripts.${scriptName}: ${scriptCommand}`, 'high', classifyScript(scriptName));
  }

  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  for (const dep of Object.keys(deps)) {
    if (dep.includes('next')) result.frameworks.push('nextjs');
    if (dep.includes('@remix-run')) result.frameworks.push('remix');
    if (dep.includes('vite')) result.frameworks.push('vite');
    if (dep.includes('react')) result.frameworks.push('react');
    if (dep.includes('vue')) result.frameworks.push('vue');
    if (dep.includes('svelte')) result.frameworks.push('svelte');
    if (dep.includes('express')) result.frameworks.push('express');
    if (dep.includes('fastify')) result.frameworks.push('fastify');
    if (dep.includes('nestjs')) result.frameworks.push('nestjs');
    if (dep.includes('prisma')) result.frameworks.push('prisma');
    if (dep.includes('drizzle')) result.frameworks.push('drizzle');
    if (dep.includes('playwright')) result.frameworks.push('playwright');
    if (dep.includes('cypress')) result.frameworks.push('cypress');
  }
}

function detectPackageManager(root) {
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'bun.lockb'))) return 'bun';
  if (exists(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function installCommand(pm) {
  if (pm === 'yarn') return 'yarn install';
  if (pm === 'bun') return 'bun install';
  if (pm === 'pnpm') return 'pnpm install';
  return 'npm install';
}

function scriptRunVerb(pm) {
  if (pm === 'npm') return 'run';
  if (pm === 'bun') return 'run';
  return 'run';
}

function packageJsonEvidence(root, pm) {
  const lockMap = {
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lockb',
    npm: 'package-lock.json',
  };
  const lock = lockMap[pm];
  return lock && exists(path.join(root, lock)) ? lock : 'package.json';
}

function classifyScript(name) {
  const lower = name.toLowerCase();
  if (lower.includes('e2e') || lower.includes('end-to-end') || lower.includes('playwright') || lower.includes('cypress')) return 'e2e';
  if (lower.includes('test') || lower.includes('spec')) return 'test';
  if (lower.includes('lint')) return 'lint';
  if (lower.includes('typecheck') || lower.includes('type-check')) return 'lint';
  if (lower.includes('build')) return 'build';
  if (lower === 'dev' || lower.includes('start')) return 'runtime';
  if (lower.includes('migrate') || lower.includes('migration')) return 'migration';
  if (lower.includes('db') || lower.includes('database')) return 'database';
  if (lower.includes('deploy')) return 'deploy';
  return 'project';
}

function detectPython(root, result) {
  if (!exists(path.join(root, 'pyproject.toml')) && !exists(path.join(root, 'requirements.txt')) && !exists(path.join(root, 'Pipfile'))) return;
  result.languages.push('python');
  if (exists(path.join(root, 'uv.lock'))) addCommand(result, 'install', 'uv sync', 'uv.lock', 'high', 'setup');
  else if (exists(path.join(root, 'poetry.lock')) || readText(path.join(root, 'pyproject.toml')).includes('[tool.poetry]')) addCommand(result, 'install', 'poetry install', 'pyproject.toml/poetry.lock', 'medium', 'setup');
  else if (exists(path.join(root, 'requirements.txt'))) addCommand(result, 'install', 'python -m pip install -r requirements.txt', 'requirements.txt', 'medium', 'setup');

  const pyproject = readText(path.join(root, 'pyproject.toml'));
  if (pyproject.includes('pytest') || exists(path.join(root, 'pytest.ini'))) addCommand(result, 'test', 'pytest', 'pyproject.toml/pytest.ini', 'medium', 'test');
  if (pyproject.includes('ruff')) addCommand(result, 'lint', 'ruff check .', 'pyproject.toml', 'medium', 'lint');
  if (pyproject.includes('black')) addCommand(result, 'format', 'black .', 'pyproject.toml', 'medium', 'format');
  if (pyproject.includes('django')) result.frameworks.push('django');
  if (pyproject.includes('fastapi')) result.frameworks.push('fastapi');
  if (pyproject.includes('flask')) result.frameworks.push('flask');
}

function detectGo(root, result) {
  if (!exists(path.join(root, 'go.mod'))) return;
  result.languages.push('go');
  addCommand(result, 'install', 'go mod download', 'go.mod', 'high', 'setup');
  addCommand(result, 'test', 'go test ./...', 'go.mod', 'high', 'test');
  addCommand(result, 'build', 'go build ./...', 'go.mod', 'medium', 'build');
}

function detectRust(root, result) {
  if (!exists(path.join(root, 'Cargo.toml'))) return;
  result.languages.push('rust');
  addCommand(result, 'install', 'cargo fetch', 'Cargo.toml', 'high', 'setup');
  addCommand(result, 'test', 'cargo test', 'Cargo.toml', 'high', 'test');
  addCommand(result, 'build', 'cargo build', 'Cargo.toml', 'high', 'build');
  addCommand(result, 'lint', 'cargo clippy --all-targets --all-features', 'Cargo.toml', 'medium', 'lint');
}

function detectRuby(root, result) {
  if (!exists(path.join(root, 'Gemfile'))) return;
  result.languages.push('ruby');
  addCommand(result, 'install', 'bundle install', 'Gemfile', 'high', 'setup');
  if (exists(path.join(root, 'bin/rails'))) {
    result.frameworks.push('rails');
    addCommand(result, 'test', 'bin/rails test', 'bin/rails', 'medium', 'test');
    addCommand(result, 'dev', 'bin/rails server', 'bin/rails', 'medium', 'runtime');
  }
}

function detectJava(root, result) {
  const hasMaven = exists(path.join(root, 'pom.xml'));
  const gradleFile = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].find((name) => exists(path.join(root, name)));
  if (!hasMaven && !gradleFile) return;
  result.languages.push('java');
  if (hasMaven) {
    addCommand(result, 'test', 'mvn test', 'pom.xml', 'high', 'test');
    addCommand(result, 'build', 'mvn package', 'pom.xml', 'high', 'build');
  }
  if (gradleFile) {
    const gradle = exists(path.join(root, 'gradlew')) ? './gradlew' : 'gradle';
    addCommand(result, 'test', `${gradle} test`, gradleFile, 'high', 'test');
    addCommand(result, 'build', `${gradle} build`, gradleFile, 'high', 'build');
  }
}

function detectDotnet(root, result) {
  const files = safeReadDir(root).filter((name) => /\.sln$|\.csproj$|\.fsproj$|\.vbproj$/i.test(name));
  if (!files.length) return;
  result.languages.push('.net');
  const evidence = files.find((name) => /\.sln$/i.test(name)) || files[0];
  addCommand(result, 'install', 'dotnet restore', evidence, 'high', 'setup');
  addCommand(result, 'test', 'dotnet test', evidence, 'high', 'test');
  addCommand(result, 'build', 'dotnet build', evidence, 'high', 'build');
}

function detectDocker(root, result) {
  if (exists(path.join(root, 'docker-compose.yml'))) {
    result.services.push('docker-compose');
    addCommand(result, 'services:start', 'docker compose up -d', 'docker-compose.yml', 'medium', 'services');
    addCommand(result, 'services:stop', 'docker compose down', 'docker-compose.yml', 'medium', 'services');
  }
  if (exists(path.join(root, 'compose.yml'))) {
    result.services.push('docker-compose');
    addCommand(result, 'services:start', 'docker compose -f compose.yml up -d', 'compose.yml', 'medium', 'services');
    addCommand(result, 'services:stop', 'docker compose -f compose.yml down', 'compose.yml', 'medium', 'services');
  }
  if (exists(path.join(root, 'Dockerfile'))) {
    addCommand(result, 'docker:build', 'docker build -t agentkodex-project .', 'Dockerfile', 'low', 'build');
  }
}

function detectMakeLike(root, result) {
  const makefile = path.join(root, 'Makefile');
  if (exists(makefile)) {
    const text = readText(makefile);
    for (const target of parseMakeTargets(text)) addCommand(result, `make:${target}`, `make ${target}`, `Makefile target ${target}`, 'medium', classifyScript(target));
  }

  const justfile = path.join(root, 'justfile');
  if (exists(justfile)) {
    const text = readText(justfile);
    for (const target of parseJustTargets(text)) addCommand(result, `just:${target}`, `just ${target}`, `justfile recipe ${target}`, 'medium', classifyScript(target));
  }

  const taskfileName = ['Taskfile.yml', 'Taskfile.yaml'].find((name) => exists(path.join(root, name)));
  if (taskfileName) {
    const text = readText(path.join(root, taskfileName));
    for (const target of parseTaskfileTasks(text)) addCommand(result, `task:${target}`, `task ${target}`, `${taskfileName} task ${target}`, 'medium', classifyScript(target));
  }
}

function parseMakeTargets(text) {
  const targets = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^[A-Za-z0-9_.-]+:([^=]|$)/.test(line)) {
      const target = line.split(':')[0].trim();
      if (target && !target.startsWith('.')) targets.push(target);
    }
  }
  return targets.slice(0, 40);
}

function parseJustTargets(text) {
  const targets = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+)(?:\s+[^:]*)?:/.exec(line);
    if (match && !line.startsWith(' ') && !line.startsWith('\t')) targets.push(match[1]);
  }
  return targets.slice(0, 40);
}

function parseTaskfileTasks(text) {
  const targets = [];
  let inTasks = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^tasks:\s*$/.test(line)) {
      inTasks = true;
      continue;
    }
    if (!inTasks) continue;
    const match = /^ {2}([A-Za-z0-9_.-]+):\s*(?:$|#)/.exec(line);
    if (match) targets.push(match[1]);
    if (/^\S/.test(line) && !/^tasks:\s*$/.test(line)) inTasks = false;
  }
  return targets.slice(0, 40);
}

function safeReadDir(root) {
  try {
    return fs.readdirSync(root);
  } catch (_) {
    return [];
  }
}

function detectEnv(root, result) {
  for (const envFile of ['.env.example', '.env.sample', '.env.template']) {
    const full = path.join(root, envFile);
    if (!exists(full)) continue;
    const names = [];
    for (const line of readText(full).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
      if (match) names.push(match[1]);
    }
    result.env.push({ file: envFile, variables: names });
  }
}

function detectCi(root, result) {
  const workflows = path.join(root, '.github', 'workflows');
  if (!exists(workflows)) return;
  for (const fileName of fs.readdirSync(workflows).filter((n) => /\.ya?ml$/i.test(n))) {
    const text = readText(path.join(workflows, fileName));
    const runs = [...text.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''));
    for (const run of runs.slice(0, 20)) {
      if (run.length <= 120) addCommand(result, `ci:${fileName}:${run.slice(0, 24)}`, run, `.github/workflows/${fileName}`, 'medium', classifyScript(run));
    }
  }
}

function inferFrameworksFromFiles(root, packageJson, result) {
  if (exists(path.join(root, 'next.config.js')) || exists(path.join(root, 'next.config.mjs')) || exists(path.join(root, 'next.config.ts'))) result.frameworks.push('nextjs');
  if (exists(path.join(root, 'vite.config.js')) || exists(path.join(root, 'vite.config.ts'))) result.frameworks.push('vite');
  if (exists(path.join(root, 'svelte.config.js'))) result.frameworks.push('svelte');
  if (exists(path.join(root, 'astro.config.mjs')) || exists(path.join(root, 'astro.config.ts'))) result.frameworks.push('astro');
  if (exists(path.join(root, 'angular.json'))) result.frameworks.push('angular');
  if (packageJson && packageJson.type === 'module') result.notes.push('package.json uses ESM module type');
}

function selectCommands(discovery, requestedGates = []) {
  const byName = new Map();
  for (const command of discovery.commands) {
    if (!byName.has(command.name)) byName.set(command.name, command);
  }

  const requested = requestedGates.length ? requestedGates : ['lint', 'test', 'build'];
  const selected = [];
  for (const gate of requested) {
    const exact = byName.get(gate);
    if (exact) {
      selected.push({ gate, ...exact });
      continue;
    }
    const category = discovery.commands.find((cmd) => cmd.category === gate || cmd.name.includes(gate));
    if (category) selected.push({ gate, ...category });
    else selected.push({ gate, skipped: true, reason: `No discovered command for ${gate}` });
  }
  return selected;
}

module.exports = {
  discoverProject,
  selectCommands,
  parseMakeTargets,
  parseJustTargets,
  parseTaskfileTasks,
};
