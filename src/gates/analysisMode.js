'use strict';

function resolveAnalysisMode(config = {}, options = {}) {
  const requested = normalize(options.analysisMode || config.analysisMode || 'auto');
  const parser = parserAvailability();
  if (requested === 'heuristic') return { analysisMode: 'heuristic', requested, parserAvailable: parser.available, error: null };
  if (requested === 'parser') {
    return parser.available
      ? { analysisMode: 'parser', requested, parserAvailable: true, parserName: parser.name, error: null }
      : { analysisMode: 'parser', requested, parserAvailable: false, parserName: null, error: 'Parser analysis requested but no supported parser dependency is installed.' };
  }
  return parser.available
    ? { analysisMode: 'parser', requested: 'auto', parserAvailable: true, parserName: parser.name, error: null }
    : { analysisMode: 'heuristic', requested: 'auto', parserAvailable: false, parserName: null, error: null };
}

function parserAvailability() {
  for (const name of ['acorn', '@babel/parser']) {
    try {
      require.resolve(name);
      return { available: true, name };
    } catch (_) {}
  }
  return { available: false, name: null };
}

function normalize(value) {
  const mode = String(value || 'auto').toLowerCase();
  return ['auto', 'heuristic', 'parser'].includes(mode) ? mode : 'auto';
}

function analysisModeCheck(analysis) {
  return {
    name: 'analysis-mode',
    ok: !analysis.error,
    errors: analysis.error ? 1 : 0,
    warnings: 0,
    analysisMode: analysis.analysisMode,
    details: analysis.error ? [analysis.error] : [`analysisMode=${analysis.analysisMode}`],
  };
}

module.exports = {
  resolveAnalysisMode,
  analysisModeCheck,
};
