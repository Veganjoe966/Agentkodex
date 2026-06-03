'use strict';

function helpText() {
  return `Agentkodex — CLI-native agent harness for autonomous software delivery.

Usage:
  agentkodex init [--cwd path]
  agentkodex quickstart [--cwd path]
  agentkodex discover [--json] [--cwd path]
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
  agentkodex run --runtime cockpit [options] "task"
  agentkodex swarm --builder shell --reviewer shell --qa shell "task"
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
  agentkodex agents list|detect|set|scorecards
  agentkodex policy check ["command to classify"] [--json]
  agentkodex release gate [--json]
  agentkodex kodex show
  agentkodex doctor

Run options:
  --agent <id>          local, shell, codex, claude-code, aider, gemini, opencode, cursor, copilot, custom
  --mode <mode>         observe, supervised, sandbox_auto, trusted_auto
  --gates <list>        comma list such as lint,test,build,e2e or none
  --command <cmd>       run an explicit implementation command instead of agent template
  --custom-command      one-off custom agent command/template
  --shell-command       one-off shell adapter command
  --runtime cockpit     start a persistent Runtime v2 agent cockpit session
  --cockpit             alias for --runtime cockpit
  --skip-agent          skip implementation phase and run only discovery/gates/reports
  --yes                 approve reviewed risky commands; blocked commands still fail
  --max-complexity      quality gate complexity threshold, default 60
  --unused-imports      quality gate dead-import mode: warn or fail
  --pty                 wrap command with script(1) pseudo-terminal when available
  --wait                with session start, wait for exit and auto-finalize
  --no-finalize         with session start --wait, skip automatic gate finalization
  --show-token          print Cockpit bearer token when starting the local UI
  --unsafe-public       allow Cockpit to bind to a non-loopback host
  --quiet               reduce live output
  --cwd, --repo <path>  project root

Command template variables:
  {promptFile} {prompt} {cwd} {runDir} {task}

Examples:
  agentkodex init
  agentkodex quickstart
  agentkodex route "large refactor"
  agentkodex agents scorecards
  agentkodex quality check
  agentkodex lintguard check --local
  agentkodex intelligence rebuild
  agentkodex tournament --agents shell,custom --task "Verify current repo" --gates test
  agentkodex swarm --builder shell --reviewer shell --qa shell "Review validation"
  agentkodex agents set custom --cmd "my-agent --file {promptFile}"
  agentkodex audit-bundle last
`;
}

module.exports = { helpText };
