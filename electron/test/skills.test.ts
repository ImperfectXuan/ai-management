// electron/test/skills.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSkills, linkSkills, unlinkSkills } from '../src/core/skills';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-skills-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'skills', 'ask-matt'), { recursive: true });
  writeFileSync(path.join(aiws, 'skills', 'ask-matt', 'SKILL.md'), '---\nname: ask-matt\ndescription: 提问\n---\n');
  return root;
}

test('listSkills 返回描述与 linkStatus', async () => {
  const root = makeWorkspace();
  const skills = await listSkills(root);
  assert.strictEqual(skills.length, 1);
  assert.strictEqual(skills[0].name, 'ask-matt');
  assert.strictEqual(skills[0].description, '提问');
  assert.strictEqual(typeof skills[0].linkStatus.cursor.global, 'boolean');
});

test('linkSkills 建符号链接到工具 skills 目录', async () => {
  const root = makeWorkspace();
  const res = await linkSkills(root, 'project', 'cursor');
  assert.ok(res.count >= 1);
  const skills = await listSkills(root);
  assert.strictEqual(skills[0].linkStatus.cursor.project, true);
});

test('unlinkSkills 移除链接', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'cursor');
  await unlinkSkills(root, 'project', 'cursor');
  const skills = await listSkills(root);
  assert.strictEqual(skills[0].linkStatus.cursor.project, false);
});
