// electron/test/git.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitRoot, runGit } from '../src/core/git';
import { ErrorCodes } from '../src/core/errors';
import { realpathSync } from 'node:fs';

test('gitRoot 在非 git 目录抛 NotAGitRepo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  await assert.rejects(gitRoot(dir), (e: any) => e.code === ErrorCodes.NotAGitRepo);
});

test('gitRoot 返回仓库根目录', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  await runGit(['init'], { cwd: dir });
  assert.strictEqual(await gitRoot(dir), realpathSync(dir));
});
