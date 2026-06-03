'use strict';

const { helpText } = require('./help');

const HELP = {
  init: 'agentkodex init [--cwd path]',
  discover: 'agentkodex discover [--json] [--verify-agents] [--cwd path]',
  quickstart: 'agentkodex quickstart [--cwd path]',
  setup: 'agentkodex setup [--json] [--cwd path]',
  agents: 'agentkodex agents [--json] | agents set <id> --cmd "command"',
  ask: 'agentkodex ask "Explain this project"',
  chat: 'agentkodex chat [--new|--resume last|--list]',
  run: 'agentkodex run [--agent id] [--gates test,build] "task"',
  gates: 'agentkodex gates run --gates lint,test,build',
  lintguard: 'agentkodex lintguard check [--local|--json]',
  quality: 'agentkodex quality check [--json]',
  keys: 'agentkodex keys status|list|rotate|retire [--json]',
  governance: 'agentkodex governance summary [last|run-id|root] [--json]',
  'audit-bundle': 'agentkodex audit-bundle [last|run-id] [--out dir]',
  audit: 'agentkodex audit bundle|verify|anchor|verify-anchor ...',
  intelligence: 'agentkodex intelligence show|rebuild',
  route: 'agentkodex route "task"',
  swarm: 'agentkodex swarm --builder shell --command "npm test" "task"',
  tournament: 'agentkodex tournament --agents codex,claude-code --task "task"',
  replay: 'agentkodex replay [last|run-id]',
  status: 'agentkodex status [last|run-id] [--json]',
  report: 'agentkodex report [last|run-id]',
  daemon: 'agentkodex daemon start|stop|status|logs',
  cockpit: 'agentkodex cockpit [--once|--json]',
  session: 'agentkodex session start|list|status|send|attach|interrupt|kill|replay|gates|finalize',
  sessions: 'agentkodex session start|list|status|send|attach|interrupt|kill|replay|gates|finalize',
  attach: 'agentkodex attach [last|session-id]',
  approvals: 'agentkodex approvals list|approve|deny',
  approval: 'agentkodex approvals list|approve|deny',
  approve: 'agentkodex approve <approval-id>',
  deny: 'agentkodex deny <approval-id>',
  policy: 'agentkodex policy check ["command"] [--json]',
  release: 'agentkodex release gate [--json]',
  suggest: 'agentkodex suggest "task"',
  plan: 'agentkodex plan "task"',
  kodex: 'agentkodex kodex show|path',
  doctor: 'agentkodex doctor [--verify-agents]',
  version: 'agentkodex version',
  help: 'agentkodex help [all]',
};

function isHelpRequest(command, rest = []) {
  if (['--help', '-h'].includes(command)) return false;
  return rest.some((item) => ['--help', '-h'].includes(String(item).replace(/^–+/, '--')));
}

function commandHelp(command) {
  const usage = HELP[command] || `agentkodex ${command} [options]`;
  return [
    'Usage:',
    `  ${usage}`,
    '',
    'Help only prints usage and does not run project work.',
    '',
    'More:',
    '  agentkodex help all',
  ].join('\n');
}

module.exports = {
  HELP,
  commandHelp,
  isHelpRequest,
  helpText,
};
