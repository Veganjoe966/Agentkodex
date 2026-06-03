'use strict';

function normalizeLintguardResult(input = {}, fallback = {}) {
  const rawViolations = Array.isArray(input.violations) ? input.violations : [];
  const errors = collectMessages(input.errors, rawViolations, 'error');
  const warnings = collectMessages(input.warnings, rawViolations, 'warning');
  let violations = Number(input.violationsCount ?? input.violations_count ?? rawViolations.length ?? errors.length);
  const ok = Boolean(input.ok ?? input.allowed ?? (violations === 0 && errors.length === 0));
  if (!ok && violations === 0) violations = Math.max(1, errors.length);
  const filesChecked = Number(input.filesChecked ?? input.files_checked ?? fallback.filesChecked ?? 0);
  return {
    ok,
    allowed: ok,
    violations,
    errors,
    warnings,
    filesChecked,
    files_checked: filesChecked,
    commandOutputs: input.commandOutputs || input.command_outputs || fallback.commandOutputs || [],
    source: fallback.source || input.source || 'lintguard',
  };
}

function collectMessages(value, violations, severity) {
  const direct = Array.isArray(value) ? value.map(String) : [];
  const fromViolations = violations
    .filter((item) => String(item.severity || item.level || '').toLowerCase() === severity)
    .map((item) => item.message || item.rule || JSON.stringify(item));
  return [...direct, ...fromViolations].filter(Boolean);
}

module.exports = {
  normalizeLintguardResult,
};
