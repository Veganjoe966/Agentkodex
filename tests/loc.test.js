'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('source files stay under hard LOC cap', () => {
  const root = path.resolve(__dirname, '..');
  const files = walk(path.join(root, 'src')).filter((file) => file.endsWith('.js'));
  const over = files
    .map((file) => ({ file, lines: fs.readFileSync(file, 'utf8').split(/\r?\n/).length }))
    .filter((item) => item.lines > 400);
  assert.deepEqual(over, []);
});

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
