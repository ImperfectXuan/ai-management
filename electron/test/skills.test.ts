// electron/test/skills.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSkills, linkSkills, unlinkSkills } from '../src/core/skills';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-skills-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'skills', 'ask-matt'), { recursive: true });
  writeFileSync(path.join(aiws, 'skills', 'ask-matt', 'SKILL.md'), '---\nname: ask-matt\ndescription: 提问\n---\n');
  mkdirSync(path.join(aiws, 'skills', 'brainstorm'), { recursive: true });
  writeFileSync(path.join(aiws, 'skills', 'brainstorm', 'SKILL.md'), '---\nname: brainstorm\ndescription: 头脑风暴\n---\n');
  return root;
}

test('listSkills 返回描述与 linkStatus', async () => {
  const root = makeWorkspace();
  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  assert.strictEqual(skills.length, 2);
  assert.strictEqual(askMatt?.name, 'ask-matt');
  assert.strictEqual(askMatt?.description, '提问');
  assert.strictEqual(typeof askMatt?.linkStatus.cursor.global, 'boolean');
});

test('linkSkills 建符号链接到工具 skills 目录', async () => {
  const root = makeWorkspace();
  const res = await linkSkills(root, 'project', 'cursor');
  assert.ok(res.count >= 2);
  const skills = await listSkills(root);
  assert.ok(skills.every((skill) => skill.linkStatus.cursor.project));
});

test('unlinkSkills 移除链接', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'cursor');
  await unlinkSkills(root, 'project', 'cursor');
  const skills = await listSkills(root);
  assert.ok(skills.every((skill) => !skill.linkStatus.cursor.project));
});

test('linkSkills 传入 skillName 时只链接当前技能', async () => {
  const root = makeWorkspace();
  const res = await linkSkills(root, 'project', 'cursor', 'ask-matt');
  assert.strictEqual(res.count, 1);

  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  const brainstorm = skills.find((skill) => skill.name === 'brainstorm');

  assert.strictEqual(askMatt?.linkStatus.cursor.project, true);
  assert.strictEqual(brainstorm?.linkStatus.cursor.project, false);
});

test('linkSkills 遇到未管理同名目录时先备份再链接', async () => {
  const root = makeWorkspace();
  const targetBase = path.join(root, '.cursor', 'skills');
  const conflictPath = path.join(targetBase, 'ask-matt');

  mkdirSync(conflictPath, { recursive: true });
  writeFileSync(path.join(conflictPath, 'note.txt'), 'manual');

  await linkSkills(root, 'project', 'cursor', 'ask-matt');

  const entries = readdirSync(targetBase);
  const backupName = entries.find((entry: string) => /^ask-matt(\..+)?\.bak$/.test(entry));
  assert.ok(backupName);
  assert.strictEqual(readFileSync(path.join(targetBase, backupName!, 'note.txt'), 'utf8'), 'manual');
  assert.ok(lstatSync(path.join(targetBase, 'ask-matt')).isSymbolicLink());
});

test('unlinkSkills 跳过未管理同名目录', async () => {
  const root = makeWorkspace();
  const targetBase = path.join(root, '.cursor', 'skills');
  const conflictPath = path.join(targetBase, 'ask-matt');

  mkdirSync(conflictPath, { recursive: true });
  writeFileSync(path.join(conflictPath, 'note.txt'), 'manual');

  const res = await unlinkSkills(root, 'project', 'cursor', 'ask-matt');
  assert.strictEqual(res.count, 0);
  assert.strictEqual(readFileSync(path.join(conflictPath, 'note.txt'), 'utf8'), 'manual');
});
