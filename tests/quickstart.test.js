'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildQuickstart } = require('../src/onboarding/quickstart');

test('quickstart writes friendly project setup summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-quickstart-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'friendly',
    scripts: { test: 'node -e "console.log(1)"' },
  }));
  const result = await buildQuickstart(dir, 'verify project');
  assert.equal(result.projectName, 'friendly');
  assert.ok(fs.existsSync(result.quickstartPath));
  const text = fs.readFileSync(result.quickstartPath, 'utf8');
  assert.match(text, /Welcome to Agentkodex/);
  assert.match(text, /Agentkodex can help you/);
  assert.match(text, /Explain this project/);
  assert.match(text, /agentkodex ask "Explain this project"/);
  assert.match(text, /agentkodex chat/);
  const primary = text.split('Advanced Information')[0];
  assert.doesNotMatch(primary, /gates|routing|scorecards|sessions|tournaments|cockpit|audit|capabilities/i);
});
