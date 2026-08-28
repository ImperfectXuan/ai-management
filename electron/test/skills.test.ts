// electron/test/skills.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert';
import { lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSkills, linkSkills, unlinkSkills } from '../src/core/skills';
import { classifyLinkState, createDirLink, removeDirLink } from '../src/core/links';

const originalHome = process.env.HOME;

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-skills-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'skills', 'ask-matt'), { recursive: true });
  writeFileSync(path.join(aiws, 'skills', 'ask-matt', 'SKILL.md'), '---\nname: ask-matt\ndescription: 提问\n---\n');
  mkdirSync(path.join(aiws, 'skills', 'brainstorm'), { recursive: true });
  writeFileSync(path.join(aiws, 'skills', 'brainstorm', 'SKILL.md'), '---\nname: brainstorm\ndescription: 头脑风暴\n---\n');
  // 隔离 HOME：global 路径派生自 $HOME，避免误读宿主机真实工具目录
  process.env.HOME = root;
  return root;
}

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
});

test('listSkills 返回描述与三态 linkStatus（初始 missing）', async () => {
  const root = makeWorkspace();
  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  assert.strictEqual(skills.length, 2);
  assert.strictEqual(askMatt?.name, 'ask-matt');
  assert.strictEqual(askMatt?.description, '提问');
  assert.strictEqual(askMatt?.linkStatus.cursor.global, 'missing');
  assert.strictEqual(askMatt?.linkStatus.cursor.project, 'missing');
});

test('listSkills 将非管理同名目录标为 conflict', async () => {
  const root = makeWorkspace();
  const conflictPath = path.join(root, '.cursor', 'skills', 'ask-matt');
  mkdirSync(conflictPath, { recursive: true });
  writeFileSync(path.join(conflictPath, 'note.txt'), 'manual');

  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  assert.strictEqual(askMatt?.linkStatus.cursor.project, 'conflict');
});

test('linkSkills 建符号链接并标记 managed', async () => {
  const root = makeWorkspace();
  const res = await linkSkills(root, 'project', 'cursor');
  assert.ok(res.count >= 2);
  const skills = await listSkills(root);
  assert.ok(skills.every((skill) => skill.linkStatus.cursor.project === 'managed'));
  assert.ok(lstatSync(path.join(root, '.cursor', 'skills', 'ask-matt')).isSymbolicLink());
});

test('unlinkSkills 移除链接回到 missing', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'cursor');
  await unlinkSkills(root, 'project', 'cursor');
  const skills = await listSkills(root);
  assert.ok(skills.every((skill) => skill.linkStatus.cursor.project === 'missing'));
});

test('linkSkills 传入 skillName 时只链接当前技能', async () => {
  const root = makeWorkspace();
  const res = await linkSkills(root, 'project', 'cursor', 'ask-matt');
  assert.strictEqual(res.count, 1);

  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  const brainstorm = skills.find((skill) => skill.name === 'brainstorm');

  assert.strictEqual(askMatt?.linkStatus.cursor.project, 'managed');
  assert.strictEqual(brainstorm?.linkStatus.cursor.project, 'missing');
});

test('unlinkSkills 传入 skillName 时只卸载当前技能', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'cursor');
  const res = await unlinkSkills(root, 'project', 'cursor', 'ask-matt');
  assert.strictEqual(res.count, 1);

  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  const brainstorm = skills.find((skill) => skill.name === 'brainstorm');

  assert.strictEqual(askMatt?.linkStatus.cursor.project, 'missing');
  assert.strictEqual(brainstorm?.linkStatus.cursor.project, 'managed');
});

test('linkSkills 按 tool 参数只作用于目标工具', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'trae', 'ask-matt');

  const skills = await listSkills(root);
  const askMatt = skills.find((skill) => skill.name === 'ask-matt');
  assert.strictEqual(askMatt?.linkStatus.trae.project, 'managed');
  assert.strictEqual(askMatt?.linkStatus.cursor.project, 'missing');
  assert.ok(lstatSync(path.join(root, '.trae', 'skills', 'ask-matt')).isSymbolicLink());
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

test('重复 linkSkills 不产生 .bak（受管理目标先移除）', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'cursor');
  await linkSkills(root, 'project', 'cursor');

  const entries = readdirSync(path.join(root, '.cursor', 'skills'));
  assert.ok(!entries.some((entry: string) => entry.includes('.bak')));
  assert.ok(lstatSync(path.join(root, '.cursor', 'skills', 'ask-matt')).isSymbolicLink());
});

test('createDirLink 在 posix 上返回 symlink 且内容可达', async () => {
  const root = makeWorkspace();
  const source = path.join(root, '.ai-workspace', 'skills', 'ask-matt');
  const target = path.join(root, '.cursor', 'skills', 'ask-matt');

  const kind = await createDirLink(source, target);
  assert.strictEqual(kind, 'symlink');
  assert.ok(readFileSync(path.join(target, 'SKILL.md'), 'utf8').includes('ask-matt'));
  assert.strictEqual(await classifyLinkState(target, source), 'managed');
});

test('createDirLink symlink 失败时回退 copy', async () => {
  const root = makeWorkspace();
  const source = path.join(root, '.ai-workspace', 'skills', 'ask-matt');
  const target = path.join(root, '.cursor', 'skills', 'ask-matt');

  // 模拟 Windows 无特权 / 只读文件系统下 symlink 创建失败
  const originalSymlink = fsp.symlink;
  fsp.symlink = (async () => { throw new Error('simulated: EPERM'); }) as typeof fsp.symlink;
  try {
    const kind = await createDirLink(source, target);
    assert.strictEqual(kind, 'copy');
    assert.ok(!lstatSync(target).isSymbolicLink());
    assert.ok(readFileSync(path.join(target, 'SKILL.md'), 'utf8').includes('ask-matt'));
    // copy 与源是两个目录 → conflict（与 CLI verify_link 语义一致）
    assert.strictEqual(await classifyLinkState(target, source), 'conflict');
  } finally {
    fsp.symlink = originalSymlink;
  }
});

test('removeDirLink 移除受管理 copy 且不动源目录', async () => {
  const root = makeWorkspace();
  const source = path.join(root, '.ai-workspace', 'skills', 'ask-matt');
  const target = path.join(root, '.cursor', 'skills', 'ask-matt');
  mkdirSync(path.dirname(target), { recursive: true });
  await fsp.cp(source, target, { recursive: true });

  await removeDirLink(target);
  assert.strictEqual(await classifyLinkState(target, source), 'missing');
  assert.ok(readFileSync(path.join(source, 'SKILL.md'), 'utf8').includes('ask-matt'));
});
