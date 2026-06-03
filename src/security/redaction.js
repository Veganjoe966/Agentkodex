'use strict';

const STRING_REDACTIONS = [
  { pattern: /sk-[A-Za-z0-9_-]{12,}/g, replacement: '[REDACTED_OPENAI_STYLE_KEY]' },
  { pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /npm_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_NPM_TOKEN]' },
  { pattern: /anthropic_[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  { pattern: /AIza[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_GOOGLE_KEY]' },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_ACCESS_KEY]' },
  { pattern: /ASIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_SESSION_KEY]' },
  { pattern: /(?:eyJ[A-Za-z0-9_-]{10,})\.(?:eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED_JWT]' },
  { pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s"'<>]+/gi, replacement: '[REDACTED_CREDENTIAL_URL]' },
  { pattern: /\b(?:pk|sk)_(?:live|test)_[A-Za-z0-9]{16,}/g, replacement: '[REDACTED_STRIPE_KEY]' },
  { pattern: /(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /((?:api[_-]?key|secret|token|password|private[_-]?key)["']?\s*[:=]\s*["'])[^\s"']+(["'])/gi, replacement: '$1[REDACTED]$2' },
  { pattern: /((?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|DATABASE_URL|API_KEY|SECRET|TOKEN|PASSWORD)=)[^\s]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  { pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g, replacement: '[REDACTED_SSH_PRIVATE_KEY]' },
];

function redactSecrets(text) {
  if (!text) return '';
  let value = String(text);
  for (const item of STRING_REDACTIONS) value = value.replace(item.pattern, item.replacement);
  return value;
}

function redactObject(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSecrets(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[REDACTED_CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = redactObject(item, seen);
  return out;
}

module.exports = {
  redactSecrets,
  redactObject,
};
