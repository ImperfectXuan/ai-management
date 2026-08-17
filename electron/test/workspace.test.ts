// electron/test/workspace.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/core/workspace';
import { runGit } from '../src/core/git';
import { ErrorCodes } from '../src/core/errors';

async function makeGitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-repo-'));
  await runGit(['init'], { cwd: dir });
  return dir;
}

test('add 非 git 目录抛 NotAGitRepo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const store = new WorkspaceStore(path.join(dir, 'repos.json'));
  await assert.rejects(store.add(dir), (e: any) => e.code === ErrorCodes.NotAGitRepo);
});

test('add 同一 git 根去重并持久化', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const store = new WorkspaceStore(path.join(dir, 'repos.json'));
  const repoDir = await makeGitRepo();
  const a = await store.add(repoDir);
  const b = await store.add(repoDir); // 同一根，应返回同一 id
  assert.strictEqual(a.id, b.id);
  assert.strictEqual((await store.load()).length, 1);
});

test('assertAiwsInstalled 缺 aiws 脚本抛 AiwsNotInstalled', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const store = new WorkspaceStore(path.join(dir, 'repos.json'));
  const repoDir = await makeGitRepo();
  await assert.rejects(store.assertAiwsInstalled(repoDir), (e: any) => e.code === ErrorCodes.AiwsNotInstalled);
});

test('assertAiwsInstalled 通过', async () => {
  const repoDir = await makeGitRepo();
  mkdirSync(path.join(repoDir, '.ai-workspace', 'scripts'), { recursive: true });
  writeFileSync(path.join(repoDir, '.ai-workspace', 'scripts', 'aiws'), '#!/bin/sh\n');
  const store = new WorkspaceStore(path.join(repoDir, '.repos.json'));
  const aiwsDir = await store.assertAiwsInstalled(repoDir);
  assert.ok(aiwsDir.endsWith('.ai-workspace'));
});
