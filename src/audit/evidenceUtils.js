'use strict';

const path = require('path');
const { appendText, ensureDir } = require('../utils');

function kodexPathFallback(root, name) {
  const base = path.resolve(root || process.cwd());
  const dir = path.join(base, name);
  ensureDir(dir);
  return dir;
}

module.exports = {
  appendText,
  ensureDir,
  kodexPathFallback,
};
