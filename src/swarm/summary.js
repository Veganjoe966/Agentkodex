'use strict';

function renderSwarmSummary(swarm) {
  const lines = ['# Agentkodex Swarm Execution', ''];
  lines.push(`Task: ${swarm.task}`);
  lines.push(`Swarm: ${swarm.id}`);
  lines.push('');
  lines.push('| Phase | Agent | Status | Session | Run | Reason |');
  lines.push('|---|---|---|---|---|---|');
  for (const phase of swarm.phases) {
    lines.push(`| ${phase.phase} | ${phase.agent} | ${phase.status} | ${phase.sessionId || ''} | ${phase.runId || ''} | ${phase.reason || ''} |`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  renderSwarmSummary,
};
