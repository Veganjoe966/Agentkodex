'use strict';

const path = require('path');
const { readJson } = require('../utils');

const DEFAULT_QUALITY = {
  maxFileLoc: 400,
  maxFunctionComplexity: 60,
  maxTotalViolations: null,
  forbiddenImports: ['posthog', '@emergentbase'],
  bannedPackages: ['posthog', 'posthog-js', '@emergentbase', 'emergent'],
  optionalImports: ['node-pty'],
  architectureBoundaries: {},
  failOnDeadImports: true,
  failOnCircularDeps: true,
  failOnMissingDeps: true,
  lintCommand: '',
  typecheckCommand: '',
  ruffCommand: '',
  testCommand: '',
};

function loadQualityConfig(root, overrides = {}) {
  const fileConfig = readJson(path.join(root, 'agentkodex.quality.json'), {});
  const nested = overrides.quality || overrides.config?.qualityGate || {};
  const merged = { ...DEFAULT_QUALITY, ...fileConfig, ...nested };
  if (overrides.maxFileLines !== undefined) merged.maxFileLoc = Number(overrides.maxFileLines);
  if (overrides.maxFileLoc !== undefined) merged.maxFileLoc = Number(overrides.maxFileLoc);
  if (overrides.maxComplexity !== undefined) merged.maxFunctionComplexity = Number(overrides.maxComplexity);
  if (overrides.maxFunctionComplexity !== undefined) merged.maxFunctionComplexity = Number(overrides.maxFunctionComplexity);
  if (overrides.bannedPackages !== undefined) merged.bannedPackages = overrides.bannedPackages;
  if (overrides.forbiddenImports !== undefined) merged.forbiddenImports = overrides.forbiddenImports;
  if (overrides.forbiddenImportMap !== undefined) merged.architectureBoundaries = overrides.forbiddenImportMap;
  if (overrides.architectureBoundaries !== undefined) merged.architectureBoundaries = overrides.architectureBoundaries;
  if (overrides.unusedImportsMode !== undefined) merged.failOnDeadImports = overrides.unusedImportsMode === 'fail';
  return normalizeQualityConfig(merged);
}

function normalizeQualityConfig(config = {}) {
  return {
    maxFileLoc: numberOr(config.maxFileLoc, DEFAULT_QUALITY.maxFileLoc),
    maxFunctionComplexity: numberOr(config.maxFunctionComplexity, DEFAULT_QUALITY.maxFunctionComplexity),
    maxTotalViolations: config.maxTotalViolations === null || config.maxTotalViolations === undefined ? null : Number(config.maxTotalViolations),
    forbiddenImports: stringList(config.forbiddenImports),
    bannedPackages: stringList(config.bannedPackages),
    optionalImports: stringList(config.optionalImports),
    architectureBoundaries: objectMap(config.architectureBoundaries),
    failOnDeadImports: Boolean(config.failOnDeadImports),
    failOnCircularDeps: config.failOnCircularDeps !== false,
    failOnMissingDeps: Boolean(config.failOnMissingDeps),
    lintCommand: stringValue(config.lintCommand),
    typecheckCommand: stringValue(config.typecheckCommand),
    ruffCommand: stringValue(config.ruffCommand),
    testCommand: stringValue(config.testCommand),
  };
}

function forbiddenImportRules(config) {
  return stringList(config.forbiddenImports).map((name) => ({
    name,
    pattern: new RegExp(`\\b(?:import\\s+.*from\\s+['"]${packagePattern(name)}['"]|require\\(['"]${packagePattern(name)}['"]\\))`, 'i'),
  }));
}

function packagePattern(name) {
  const escaped = escapeRegExp(name);
  return name.startsWith('@') ? `${escaped}(?:/[^'"]*)?` : `${escaped}(?:[-/][^'"]*)?`;
}

function commandOverrides(config) {
  return [
    config.lintCommand && { name: 'eslint', command: { name: 'lint', command: config.lintCommand, evidence: 'agentkodex.quality.json', confidence: 'high' } },
    config.typecheckCommand && { name: 'typecheck', command: { name: 'typecheck', command: config.typecheckCommand, evidence: 'agentkodex.quality.json', confidence: 'high' } },
    config.ruffCommand && { name: 'ruff', command: { name: 'ruff', command: config.ruffCommand, evidence: 'agentkodex.quality.json', confidence: 'high' } },
    config.testCommand && { name: 'tests', command: { name: 'test', command: config.testCommand, evidence: 'agentkodex.quality.json', confidence: 'high' } },
  ].filter(Boolean);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value) {
  return value ? String(value) : '';
}

function stringList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function objectMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  DEFAULT_QUALITY,
  commandOverrides,
  forbiddenImportRules,
  loadQualityConfig,
};
