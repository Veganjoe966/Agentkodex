'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, booleanFlag, stringFlag } = require('../src/args');

test('boolean flags do not swallow trailing task text', () => {
  const parsed = parseArgs(['--cwd', '/tmp/app', '--yes', 'build auth flow']);
  assert.equal(stringFlag(parsed.flags, 'cwd'), '/tmp/app');
  assert.equal(booleanFlag(parsed.flags, 'yes'), true);
  assert.deepEqual(parsed.positionals, ['build auth flow']);
});

test('repo alias can still be parsed as a string flag', () => {
  const parsed = parseArgs(['--repo', '/tmp/app', '--json']);
  assert.equal(stringFlag(parsed.flags, 'repo'), '/tmp/app');
  assert.equal(booleanFlag(parsed.flags, 'json'), true);
});

test('leading en dash flags are normalized', () => {
  const parsed = parseArgs(['–json', 'task']);
  assert.equal(booleanFlag(parsed.flags, 'json'), true);
  assert.deepEqual(parsed.positionals, ['task']);
});
