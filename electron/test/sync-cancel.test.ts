// electron/test/sync-cancel.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
  await assert.rejects(async () => {
    for await (const line of syncRun(root, {}, controller.signal)) lines.push(line);
  }, /同步已取消/);
  assert.ok(lines.length === 0 || lines[lines.length - 1] !== '同步完成');
});

test('syncRun_abortWhileRunning_stopsChildWritesAndRejects', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-cancel-running-'));
  mkdirSync(path.join(root, '.ai-workspace/scripts'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace/scripts/aiws'), '#!/bin/sh\necho ready\nsleep 2\necho late > late-write\n', { mode: 0o755 });
  const controller = new AbortController();
  try {
    await assert.rejects(async () => {
      for await (const line of syncRun(root, {}, controller.signal)) {
        if (line === 'ready') controller.abort();
      }
    }, /同步已取消/);
    assert.equal(existsSync(path.join(root, 'late-write')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
