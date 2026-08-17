// electron/test/sync-cancel.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncRun } from '../src/core/sync';

test('syncRun 中止后停止产出新行', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-cancel-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\nscope: all\n---\n# C\n');
  writeFileSync(path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'), 'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n');
  const controller = new AbortController();
  controller.abort();
  const lines: string[] = [];
  for await (const line of syncRun(root, {}, controller.signal)) lines.push(line);
  assert.ok(lines.length === 0 || lines[lines.length - 1] !== '同步完成');
});
