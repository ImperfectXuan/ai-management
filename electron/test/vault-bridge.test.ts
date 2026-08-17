// electron/test/vault-bridge.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAiwsBridge, assertAiws } from '../src/core/vault-bridge';
import { ErrorCodes } from '../src/core/errors';

test('assertAiws 缺 aiws 脚本抛 AiwsNotInstalled', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-bridge-'));
  await assert.rejects(assertAiws(root), (e: any) => e.code === ErrorCodes.AiwsNotInstalled);
});

test('runAiwsBridge 执行 --version', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-bridge-'));
  mkdirSync(path.join(root, '.ai-workspace', 'scripts'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace', 'scripts', 'aiws'), '#!/bin/sh\necho "bridge ok $*"\n', { mode: 0o755 });
  const res = await runAiwsBridge(root, ['--version']);
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /bridge ok/);
});
