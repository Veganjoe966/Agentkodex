'use strict';

const { runLintguardCheck } = require('../../lintguard/runner');
const { runQualityGate } = require('../../gates/qualityGate');

module.exports = {
  runLintguardCheck,
  runQualityGate,
};
