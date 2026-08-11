// electron/test/diff.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { diffLines } from '../src/core/diff';

test('diffLines 相同内容 identical', () => {
  const d = diffLines('a\nb\n', 'a\nb\n');
  assert.strictEqual(d.identical, true);
  assert.strictEqual(d.hunks.length, 0);
});

test('diffLines 识别增删 hunk', () => {
  const d = diffLines('a\nb\n', 'a\nX\nb\n');
  assert.strictEqual(d.identical, false);
  assert.strictEqual(d.hunks.length, 1);
  assert.deepStrictEqual(d.hunks[0].added, ['X']);
});

test('diffLines 多 hunk', () => {
  const d = diffLines('a\nb\nc\n', 'a\nX\nc\nY\n');
  assert.ok(d.hunks.length >= 2);
});
