'use strict';

function shellSyntaxRisk(command) {
  const text = String(command || '');
  const token = controlToken(text);
  if (!token && !dangerousFind(text)) return null;
  return {
    risk: 'approval_required',
    category: 'shell_control',
    reason: token ? `contains shell control syntax ${token}` : 'find command can execute or delete files',
  };
}

function hasShellControlSyntax(command) {
  return Boolean(controlToken(command));
}

function controlToken(command) {
  const text = String(command || '');
  let single = false;
  let double = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1] || '';
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === "'" && !double) {
      single = !single;
      continue;
    }
    if (ch === '"' && !single) {
      double = !double;
      continue;
    }
    if (single) continue;
    if (double) {
      if (ch === '`') return printable(ch);
      if (ch === '$' && next === '(') return '$(';
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '`') return printable(ch);
    if (ch === '$' && next === '(') return '$(';
    if (ch === '>' || ch === '<') return ch;
    if (ch === '&') return next === '&' ? '&&' : '&';
    if (ch === '|') return next === '|' ? '||' : '|';
  }
  return null;
}

function dangerousFind(command) {
  return /^\s*find\b/i.test(String(command || '')) && /\s-(?:exec|delete|ok)\b/i.test(command);
}

function printable(token) {
  return token === '\n' ? 'newline' : token;
}

module.exports = {
  hasShellControlSyntax,
  shellSyntaxRisk,
};
