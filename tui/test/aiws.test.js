const { test } = require('node:test');
const assert = require('node:assert');
const { runAiws } = require('../src/lib/aiws.js');

test('runAiws 定位到 git root 并执行 aiws', async () => {
  const res = await runAiws(['--version']);
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /v0\.1\.0/);
});
