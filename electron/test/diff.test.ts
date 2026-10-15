// electron/test/diff.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { diffLines, compareRuleToGenerated } from '../src/core/diff';
import { prepareDemo } from '../demo/workspace.mjs';
import { syncRun } from '../src/core/sync';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

test('compareRuleToGenerated_syncedThenEdited_reportsOnlyRealDrift', async () => {
  const demo = await prepareDemo();
  try {
    for await (const _line of syncRun(demo.repo, { only: 'rules' })) { /* 生成真实产物 */ }
    const canonical = await fs.readFile(path.join(demo.repo, '.ai-workspace/rules/00-core.md'), 'utf8');
    assert.equal((await compareRuleToGenerated(demo.repo, 'cursor', '00-core')).diff.identical, true);

    await fs.appendFile(path.join(demo.repo, '.cursor/rules/00-core.mdc'), '\n手动漂移\n');

    const result = await compareRuleToGenerated(demo.repo, 'cursor', '00-core');
    assert.equal(result.diff.identical, false);
    assert.ok(result.diff.hunks.some((hunk) => hunk.added.includes('手动漂移')));
    assert.equal(await fs.readFile(path.join(demo.repo, '.ai-workspace/rules/00-core.md'), 'utf8'), canonical);
  } finally {
    await fs.rm(demo.base, { recursive: true, force: true });
  }
});
