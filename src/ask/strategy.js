'use strict';

const { detectAgent } = require('../agents');
const { routeTask } = require('../router/route');
const { inferTaskCategory } = require('../scorecards/store');
const { reputationScore } = require('./reputation');

async function planAskStrategy(root, config, options = {}) {
  const mode = options.mode || 'answer';
  const ready = await readyAgents(config, options.agents || []);
  const category = inferTaskCategory(options.prompt || '');
  const route = routeTask(root, options.prompt || '');
  const ranked = rankAgents(root, ready, category, route);
  const risk = taskRisk(options.prompt || '', mode);
  const confidence = estimateConfidence(ranked[0], route, risk);
  const execution = executionMode(options, confidence, risk, ranked.length);
  const agents = pickAgents(ranked, execution);
  const judge = await internalJudge(config, execution);
  return {
    category,
    confidence,
    execution,
    agents,
    internalJudge: judge,
    reason: reason(agents[0], execution, confidence, category, risk),
  };
}

async function readyAgents(config, requested) {
  const ids = requested.length ? requested : Object.keys(config.agents || {}).filter((id) => !['local', 'shell'].includes(id));
  const ready = [];
  for (const id of ids) {
    const detection = await detectAgent(config, id);
    if (detection.ready && id !== 'local') ready.push(id);
  }
  return ready;
}

function rankAgents(root, agents, category, route) {
  return agents.map((agent) => {
    const rep = reputationScore(root, agent, category);
    const routed = route.candidates?.find((item) => item.agent === agent);
    const score = rep.confidence * 100 + Number(routed?.score || 0) * 0.25 + rep.attempts;
    return { agent, score, reputation: rep, routeScore: routed?.score || 0 };
  }).sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent));
}

function estimateConfidence(best, route, risk) {
  if (!best) return 0;
  const reputation = best.reputation.attempts >= 3 ? best.reputation.confidence * 100 : 0;
  const routed = route.selected === best.agent ? Math.min(95, Number(best.routeScore || 0)) : 0;
  const base = Math.max(reputation, routed);
  return Math.max(20, Math.round(base - risk));
}

function executionMode(options, confidence, risk, count) {
  if (options.latency === 'max') return 'compare_all';
  if (options.latency === 'compare' || options.compare) return count > 2 ? 'compare_all' : 'compare_two';
  if (options.latency === 'fast') return 'single';
  if (confidence >= 85) return 'single';
  if (risk >= 25 && count > 2) return 'compare_all';
  return count > 1 ? 'compare_two' : 'single';
}

function pickAgents(ranked, execution) {
  const ids = ranked.map((item) => item.agent);
  if (execution === 'single') return ids.slice(0, 1);
  if (execution === 'compare_two') return ids.slice(0, 2);
  return ids;
}

async function internalJudge(config, execution) {
  if (execution !== 'compare_all') return '';
  const id = config.ask?.internalJudge || config.ask?.judgeAgent || config.routing?.judgeAgent || '';
  if (!id || !config.agents?.[id]) return '';
  const detection = await detectAgent(config, id);
  return detection.ready ? id : '';
}

function taskRisk(prompt, mode) {
  let risk = mode === 'patch' ? 35 : 0;
  if (/\b(auth|security|token|secret|payment|migration|delete|production)\b/i.test(prompt)) risk += 20;
  if (/\b(refactor|rewrite|architecture|large)\b/i.test(prompt)) risk += 10;
  return risk;
}

function reason(agent, execution, confidence, category, risk) {
  if (!agent) return 'No ready coding agents were found.';
  if (execution === 'single') return `Using ${agent} because confidence is ${confidence}% for ${category} work in this repo.`;
  if (risk >= 25) return `Comparing agents because this ${category} request has elevated risk.`;
  return `Comparing agents because confidence is ${confidence}% for ${category} work in this repo.`;
}

module.exports = {
  planAskStrategy,
};
