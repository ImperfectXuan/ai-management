const { test } = require('node:test');
const assert = require('node:assert');
const { parseResult } = require('../src/lib/json.js');

test('parseResult 解析成功 JSON', () => {
  assert.deepStrictEqual(parseResult({ stdout: '{"servers":[]}', code: 0 }), { data: { servers: [] } });
});
test('parseResult 解析失败约定', () => {
  assert.deepStrictEqual(parseResult({ stdout: '{"error":"boom","exit_code":1}', code: 1 }), { error: 'boom' });
});
test('parseResult 处理非 JSON 输出', () => {
  assert.match(parseResult({ stdout: '[OK] hi', code: 0 }).error, /解析失败/);
});
