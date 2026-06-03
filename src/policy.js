'use strict';

const { redactSecrets } = require('./security/redaction');

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//i,
  /\brm\s+-rf\s+~\b/i,
  /\brm\s+-rf\s+\$HOME\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\b:(){\s*:|:&\s*};:/,
  /\bcurl\b.+\|\s*(sh|bash)/i,
  /\bwget\b.+\|\s*(sh|bash)/i,
];

const MANUAL_APPROVAL_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+-[A-Za-z]*[rf][A-Za-z]*\s+/i,
  /\brmdir\s+/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bdocker\s+(system\s+prune|volume\s+rm|container\s+rm|image\s+rm|compose\s+down\b.*\b-v\b)/i,
  /\b(git\s+push|git\s+reset|git\s+clean|git\s+checkout\s+[-\w/]+|git\s+rebase)\b/i,
  /\b(vercel|netlify|fly|railway|wrangler|firebase)\s+(deploy|publish)\b/i,
  /\b(kubectl|helm)\s+(apply|delete|upgrade|rollback)\b/i,
  /\b(prisma|sequelize|rails)\b.*\b(drop|reset|migrate\s+deploy|db:migrate|db:drop|db:reset)\b/i,
  /\b(cat|less|more|head|tail|sed|awk|rg|grep)\b.+(\.env\b|~\/\.ssh|~\/\.aws|id_rsa|id_ed25519|credentials|secrets?\.json)/i,
  /\b(touch|cp|mv|rm|sed|perl|python|node)\b.+(\.env\b|secrets?\.json|credentials)/i,
];

const APPROVAL_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/i,
  /\b(pip|pipx|uv|poetry)\s+(install|add|remove|sync)\b/i,
  /\bbrew\s+(install|upgrade|remove)\b/i,
  /\bdocker\s+(compose\s+)?up\b/i,
  /\bdocker\s+(build|run|pull|push|system)\b/i,
  /\bgit\s+(commit|push|reset|clean|checkout|merge|rebase)\b/i,
  /\bgh\s+pr\s+create\b/i,
  /\b(vercel|netlify|fly|railway|wrangler|firebase)\s+(deploy|publish)\b/i,
  /\bprisma\s+migrate\b/i,
  /\brails\s+db:/i,
  /\bsequelize\s+db:/i,
];

const SAFE_PATTERNS = [
  /^\s*(pwd|ls|find|rg|grep|cat|sed|awk|head|tail|wc|git status|git diff|git log|git branch)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|build|typecheck|check)\b/i,
  /\bgo\s+(test|build)\b/i,
  /\bcargo\s+(test|build|clippy|fmt)\b/i,
  /\bpytest\b/i,
  /\bruff\s+check\b/i,
  /\bmake\s+(test|lint|build|check)\b/i,
];

const READONLY_PATTERNS = [
  /^\s*(pwd|ls|find|rg|grep|cat|sed|awk|head|tail|wc|git status|git diff|git log|git branch)\b/i,
];

function classifyCommand(command) {
  const value = String(command || '').trim();
  if (!value) return { risk: 'safe', reason: 'empty command' };

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(value)) return { risk: 'blocked', reason: `matched blocked pattern ${pattern}` };
  }
  for (const pattern of MANUAL_APPROVAL_PATTERNS) {
    if (pattern.test(value)) return { risk: 'approval_required', category: 'manual', reason: `matched manual approval pattern ${pattern}` };
  }
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(value)) return { risk: 'approval_required', category: 'standard', reason: `matched approval pattern ${pattern}` };
  }
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(value)) return { risk: 'safe', reason: `matched safe pattern ${pattern}` };
  }
  return { risk: 'unknown', reason: 'no matching policy pattern' };
}

function policyAllows(command, options = {}) {
  const mode = normalizeMode(options.mode || 'supervised');
  const yes = Boolean(options.yes || options.autoApprove);
  const agentLaunch = Boolean(options.agentLaunch);
  const classification = classifyCommand(command);

  if (classification.risk === 'blocked') {
    return { allowed: false, requiresApproval: false, classification, reason: 'Blocked by Agentkodex command policy' };
  }

  if (mode === 'observe') {
    if (isReadOnlyCommand(command)) return { allowed: true, requiresApproval: false, classification, reason: 'Allowed read-only command in observe mode' };
    return { allowed: false, requiresApproval: true, classification, reason: 'Observe mode only executes commands classified as safe' };
  }

  if (agentLaunch) {
    return { allowed: true, requiresApproval: false, classification, reason: 'Allowed as coding-agent CLI launch' };
  }

  if (classification.risk === 'approval_required') {
    if (classification.category === 'manual' && !yes) {
      return { allowed: false, requiresApproval: true, classification, reason: 'Manual approval required even in auto modes. Re-run with --yes after reviewing the command.' };
    }
    if (yes) {
      return { allowed: true, requiresApproval: false, classification, reason: 'Approved by mode or --yes' };
    }
    return { allowed: false, requiresApproval: true, classification, reason: 'Command requires explicit approval. Re-run with --yes after reviewing the command.' };
  }

  if (classification.risk === 'unknown') {
    if (mode === 'trusted_auto' || mode === 'sandbox_auto' || yes) {
      return { allowed: true, requiresApproval: false, classification, reason: 'Unknown command allowed by mode or --yes' };
    }
    return { allowed: false, requiresApproval: true, classification, reason: 'Unknown command requires approval. Re-run with --yes or trusted/sandbox mode.' };
  }

  return { allowed: true, requiresApproval: false, classification, reason: 'Allowed by policy' };
}

function normalizeMode(mode) {
  return String(mode || 'supervised').replace(/-/g, '_');
}

function isReadOnlyCommand(command) {
  return READONLY_PATTERNS.some((pattern) => pattern.test(String(command || '').trim()));
}

module.exports = {
  classifyCommand,
  policyAllows,
  redactSecrets,
  BLOCKED_PATTERNS,
  APPROVAL_PATTERNS,
  MANUAL_APPROVAL_PATTERNS,
  SAFE_PATTERNS,
  READONLY_PATTERNS,
  normalizeMode,
  isReadOnlyCommand,
};
