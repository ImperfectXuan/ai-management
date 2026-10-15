import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { ContentLibraryStore } from '../src/core/content-library';
import { syncRun } from '../src/core/sync';
import { listRules } from '../src/core/rules';
import { addMcp, listMcp } from '../src/core/mcp';
import { listSkills, linkSkills, unlinkSkills } from '../src/core/skills';
import { intakeScan, intakeCompare, intakePlan, intakeApply } from '../src/core/intake-bridge';
import { compareRuleToGenerated } from '../src/core/diff';

const runtimeScripts = path.resolve('../.ai-workspace/scripts');

async function fixture(t: import('node:test').TestContext) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aiws-library-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, '统一内容库');
  const target = path.join(base, '应用项目');
  await fs.mkdir(root);
  await fs.mkdir(target);
  const settings = path.join(base, 'profile/content-library.json');
  const store = new ContentLibraryStore(settings, runtimeScripts);
  return { base, root, target, settings, store };
}

async function put(root: string, relative: string, content: string) {
  const file = path.join(root, '.ai-workspace', relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test('内容库_未选择时_不回退到当前工作区', async (t) => {
  const { store } = await fixture(t);

  assert.equal(await store.load(), null);
  await assert.rejects(store.get(), /请先选择统一内容库/);
});

test('内容库_普通文件夹初始化_空资产并持久化选择', async (t) => {
  const { root, store, settings } = await fixture(t);

  await store.select(root, true);
  const restored = new ContentLibraryStore(settings, runtimeScripts);

  assert.equal(await restored.get(), root);
  assert.deepEqual(await listRules(root), []);
  assert.deepEqual(await listMcp(root), []);
  assert.deepEqual(await listSkills(root, null), []);
  await assert.rejects(fs.access(path.join(root, 'AGENTS.md')));
});

test('内容库_重复创建或接入失败_保留已有资产与选择', async (t) => {
  const { root, target, store } = await fixture(t);
  await store.select(root, true);
  await addMcp(root, 'user-server', 'node');

  await assert.rejects(store.select(root, true), /使用已有内容库/);
  await assert.rejects(store.select(target, false), /内容库缺少/);
  await store.select(root, false);

  assert.equal(await store.get(), root);
  assert.equal((await listMcp(root))[0].name, 'user-server');
});

test('同步_内容库与应用项目分离_三类资产来自内容库且仅写选定项目', async (t) => {
  const { root, target, store } = await fixture(t);
  await store.select(root, true);
  const rule = '---\nid: shared\ntitle: Shared\nscope: all\n---\n# 统一内容库规则\n';
  await put(root, 'rules/shared.md', rule);
  for (const tool of ['cursor', 'trae']) {
    await put(root, `adapters/${tool}/mapping.yaml`, `tool: ${tool}\nrules:\n  - source: rules/shared.md\n    required: true\n`);
  }
  await put(root, 'skills/library-skill/SKILL.md', '---\nname: library-skill\ndescription: 内容库技能\n---\n# Skill\n');
  await addMcp(root, 'library-server', 'node');
  await put(target, 'rules/decoy.md', '目标项目自有规范，不应作为分发来源');
  const logs: string[] = [];

  for await (const line of syncRun(target, { libraryRoot: root, cliPath: path.join(runtimeScripts, 'aiws') })) logs.push(line);

  assert.equal(logs.at(-1), '同步完成');
  for (const relative of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/shared.mdc', '.trae/rules/shared.md']) {
    const content = await fs.readFile(path.join(target, relative), 'utf8');
    assert.match(content, /统一内容库规则/);
    assert.doesNotMatch(content, /目标项目自有规范/);
  }
  assert.match(await fs.readFile(path.join(target, '.cursor/mcp.json'), 'utf8'), /library-server/);
  assert.equal(await fs.realpath(path.join(target, '.cursor/skills/library-skill')), path.join(root, '.ai-workspace/skills/library-skill'));
  assert.equal(await fs.readFile(path.join(root, '.ai-workspace/rules/shared.md'), 'utf8'), rule);
  await assert.rejects(fs.access(path.join(root, 'AGENTS.md')));
  const validation = await promisify(execFile)(path.join(runtimeScripts, 'aiws'), ['validate'], {
    cwd: target, env: { ...process.env, AIWS_ROOT: target, AIWS_SOURCE_DIR: path.join(root, '.ai-workspace'), AIWS_RUNTIME_DIR: runtimeScripts },
  });
  assert.match(validation.stdout, /Drift check PASSED/);
  assert.equal((await compareRuleToGenerated(target, 'cursor', 'shared', root)).diff.identical, true);
  const skill = (await listSkills(root, target))[0];
  assert.equal(skill.linkStatus.cursor.project, 'managed');
  await unlinkSkills(root, 'project', 'cursor', 'library-skill', target);
  await assert.rejects(fs.access(path.join(target, '.cursor/skills/library-skill')));
  await linkSkills(root, 'project', 'cursor', 'library-skill', target);
  assert.equal((await listSkills(root, target))[0].linkStatus.cursor.project, 'managed');
});


test('新建空内容库_收编首条规则_登记映射后可分发', async (t) => {
  const { root, target, store } = await fixture(t);
  await store.select(root, true);
  const source = path.join(target, '.cursor/rules/imported.mdc');
  await fs.mkdir(path.dirname(source), { recursive: true });
  const content = '---\nid: imported\ntitle: Imported\nscope: all\n---\n# 导入的规则\n';
  await fs.writeFile(source, content);
  const batch = await intakeScan({ repoPath: root, sources: [{ path: target, tool: 'cursor', scope: 'project' }] });
  const candidates = await intakeCompare(root, batch.batch_id);
  const plan = await intakePlan({ repoPath: root, batchId: batch.batch_id,
    decisions: candidates.candidates.map((candidate) => ({ candidate_id: candidate.candidate_id, kind: candidate.labels.includes('unparseable') ? 'ignore' : 'add' })),
  });

  const result = await intakeApply({ repoPath: root, planId: plan.plan_id });

  assert.equal(result.status, 'ok');
  assert.equal((await listRules(root)).length, 1);
  for await (const _line of syncRun(target, { libraryRoot: root, tool: 'trae', only: 'rules' })) { /* 真实分发 */ }
  const generated = await fs.readdir(path.join(target, '.trae/rules'));
  assert.ok(generated.some((file) => file.endsWith('.md')));
  assert.equal(await fs.readFile(source, 'utf8'), content);
});
