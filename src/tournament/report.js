'use strict';

function renderTournamentSummary(summary) {
  const lines = [];
  lines.push('# Agentkodex Tournament Scorecard');
  lines.push('');
  lines.push(`Task: ${summary.task}`);
  lines.push(`Winner strategy: ${summary.winnerStrategy}`);
  lines.push(`Winner: ${summary.winner || 'none'}`);
  lines.push('');
  lines.push('| Rank | Agent | Score | Status | Lint | Test | Build | E2E | Duration ms | Approvals | Files | Diff bytes | Run |');
  lines.push('|---:|---|---:|---|---|---|---|---|---:|---:|---:|---:|---|');
  summary.results.forEach((item, index) => {
    const m = item.metrics || {};
    lines.push([
      `| ${index + 1}`,
      item.agent,
      item.score?.total ?? '',
      item.status,
      gate(m, 'lint'),
      gate(m, 'test'),
      gate(m, 'build'),
      gate(m, 'e2e'),
      m.durationMs ?? '',
      m.approvalCount ?? 0,
      m.filesChanged ?? '',
      m.diffSizeBytes ?? '',
      `${item.runDir} |`,
    ].join(' | '));
  });
  lines.push('');
  return lines.join('\n');
}

function gate(metrics, name) {
  const item = metrics.gates?.[name];
  if (!item) return 'n/a';
  if (item.skipped) return 'skipped';
  return item.passed ? 'pass' : 'fail';
}

module.exports = {
  renderTournamentSummary,
};
