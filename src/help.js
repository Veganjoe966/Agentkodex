'use strict';

const { primaryOnboardingText } = require('./onboarding/flow');

function helpText(scope = 'short') {
  return scope === 'all' ? fullHelp() : shortHelp();
}

function shortHelp() {
  return `${primaryOnboardingText()}\n`;
}

function fullHelp() {
  return `Agentkodex — The chat-first control plane for AI coding agents.

Primary flow:
  agentkodex setup
  agentkodex ask "Explain this project"
  agentkodex ask --mode review "Review security risks"
  agentkodex ask --mode patch "Fix failing tests"
  agentkodex ask --mode patch --apply-winner --yes "Fix failing tests"
  agentkodex chat --new

Advanced commands:
  agentkodex init [--cwd path]
  agentkodex quickstart [--cwd path]
  agentkodex discover [--json] [--verify-agents] [--cwd path]
  agentkodex intelligence show|rebuild
  agentkodex route "task"
  agentkodex plan "task"
  agentkodex suggest "task"
  agentkodex run [options] "task"
  agentkodex gates run --gates lint,test,build
  agentkodex quality check [--json] [--max-file-lines 400]
  agentkodex governance summary [last|run-id|root] [--json]
  agentkodex keys status|list|rotate|retire [--json]
  agentkodex lintguard check [--local|--url http://127.0.0.1:8001] [--json]
  agentkodex swarm --builder shell --reviewer shell --qa shell --command "npm test" "task"
  agentkodex daemon start|stop|status|logs
  agentkodex cockpit [--port 3919] [--host 127.0.0.1] [--once|--json] [--show-token]
  agentkodex session start|list|status|send|attach|interrupt|kill|replay|gates|finalize
  agentkodex approvals list|approve|deny
  agentkodex approve <approval-id> / deny <approval-id>
  agentkodex tournament --agents codex,claude-code,aider --task "task"
  agentkodex replay [last|run-id]
  agentkodex status [last|run-id] [--json]
  agentkodex report [last|run-id]
  agentkodex audit-bundle [last|run-id] [--run id] [--session id] [--out dir] [--format dir|zip]
  agentkodex audit bundle [last|run-id]
  agentkodex audit verify <bundle-dir> [--json]
  agentkodex audit anchor <bundle-dir> [--json] [--anchor-path path]
  agentkodex audit verify-anchor <bundle-dir> [--json] [--anchor-path path]
  agentkodex agents list|detect|set|scorecards
  agentkodex policy check ["command to classify"] [--json]
  agentkodex release gate [--json]
  agentkodex kodex show

Ask options:
  --agents <list>      ready agents to compare
  --mode <mode>        answer, review, patch, or auto
  --fast              use best historical ready agent
  --compare           compare multiple ready agents
  --max               compare all ready agents
  --apply-winner      patch mode: apply only the winning patch
  --yes               confirm applying the winner
  --json              machine-readable output

Run options:
  --agent <id>          local, shell, codex, claude-code, aider, gemini, opencode, cursor, copilot, custom
  --mode <mode>         observe, supervised, sandbox_auto, trusted_auto
  --gates <list>        comma list such as lint,test,build,e2e or none
  --command <cmd>       run an explicit implementation command instead of agent template
  --runtime cockpit     start a persistent Runtime v2 agent cockpit session
  --yes                 approve reviewed risky commands; blocked commands still fail
  --cwd, --repo <path>  project root
`;
}

module.exports = { helpText };
