'use strict';

const path = require('path');
const { ensureDir, readJson, writeJson } = require('../utils');
const { kodexPath } = require('../kodexStore');
const { inferTaskCategory } = require('../scorecards/store');

function reputationPath(root) {
  const dir = kodexPath(root, 'agents');
  ensureDir(dir);
  return path.join(dir, 'reputation.json');
}

function loadReputation(root) {
  return readJson(reputationPath(root), { generatedAt: null, agents: {} });
}

function saveReputation(root, data) {
  const next = { generatedAt: new Date().toISOString(), agents: data.agents || {} };
  writeJson(reputationPath(root), next);
  return next;
}

function recordAskReputation(root, prompt, candidates = [], winnerAgent = null) {
  const data = loadReputation(root);
  const category = inferTaskCategory(prompt);
  for (const candidate of candidates) {
    const card = bucket(data, candidate.agent, category);
    card.attempts += 1;
    card.totalScore += Number(candidate.score || 0);
    if (candidate.metrics?.completion) card.passes += 1;
    if (candidate.metrics?.gateFailCount === 0) card.gatePasses += 1;
    if (candidate.agent === winnerAgent) card.wins += 1;
    else card.losses += 1;
    finalize(card);
  }
  return saveReputation(root, data);
}

function reputationScore(root, agent, category) {
  const card = loadReputation(root).agents?.[agent]?.[category];
  if (!card || card.attempts < 1) return { confidence: 0, attempts: 0, wins: 0 };
  return { confidence: Number(card.confidence || 0), attempts: card.attempts, wins: card.wins };
}

function bucket(data, agent, category) {
  if (!data.agents[agent]) data.agents[agent] = {};
  if (!data.agents[agent][category]) {
    data.agents[agent][category] = { attempts: 0, wins: 0, losses: 0, passes: 0, gatePasses: 0, totalScore: 0, confidence: 0 };
  }
  return data.agents[agent][category];
}

function finalize(card) {
  const winRate = card.attempts ? card.wins / card.attempts : 0;
  const passRate = card.attempts ? card.passes / card.attempts : 0;
  const gateRate = card.attempts ? card.gatePasses / card.attempts : 0;
  card.avgScore = card.attempts ? Math.round((card.totalScore / card.attempts) * 100) / 100 : 0;
  card.confidence = Math.round((winRate * 0.55 + passRate * 0.3 + gateRate * 0.15) * 100) / 100;
  card.updatedAt = new Date().toISOString();
}

module.exports = {
  loadReputation,
  recordAskReputation,
  reputationPath,
  reputationScore,
  saveReputation,
};
