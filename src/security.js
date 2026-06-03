'use strict';

function scanDiff(diff) {
  const findings = [];
  const text = String(diff || '');
  const checks = [
    { severity: 'critical', pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/, message: 'Private key material appears in the diff.' },
    { severity: 'high', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, message: 'OpenAI-style API key appears in the diff.' },
    { severity: 'high', pattern: /\bghp_[A-Za-z0-9_]{20,}\b/, message: 'GitHub token appears in the diff.' },
    { severity: 'high', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, message: 'Slack token appears in the diff.' },
    { severity: 'medium', pattern: /^\+.*(PASSWORD|SECRET|TOKEN|API_KEY)=.+/gim, message: 'A secret-like environment assignment was added.' },
    { severity: 'medium', pattern: /^\+.*\.env$/gim, message: 'A .env path appears to have been added or referenced.' },
    { severity: 'medium', pattern: /^\+.*dangerouslySetInnerHTML/gim, message: 'dangerouslySetInnerHTML was added; verify sanitization.' },
    { severity: 'medium', pattern: /^\+.*eval\(/gim, message: 'eval() was added; verify this is safe and necessary.' },
  ];

  for (const check of checks) {
    if (check.pattern.test(text)) findings.push({ severity: check.severity, message: check.message });
  }

  return { findings };
}

function renderSecurityReport(security) {
  const lines = [];
  lines.push('# Agentkodex Security Report');
  lines.push('');
  if (!security.findings || security.findings.length === 0) {
    lines.push('No high-confidence secret leaks or dangerous diff patterns were detected.');
  } else {
    for (const finding of security.findings) lines.push(`- [${finding.severity}] ${finding.message}`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  scanDiff,
  renderSecurityReport,
};
