// electron/test/sync-unit-identity.test.ts
// 功能 002：单元键路径身份（design §2.1）——别名归并、缺失不回退、搬家新身份、输出键规范化。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertSyntacticPath,
  resolveOutputKeys,
  resolveRootPath,
  resolveUnitKey,
} from '../src/core/sync-unit-identity';

function makeFixture(name: string): string {
  // macOS 的 $TMPDIR 经 /var→/private/var 软链接，统一取真实路径避免期望值带别名。
  return realpathSync(mkdtempSync(path.join(tmpdir(), `aiws-identity-${name}-`)));
}

test('resolveRootPath_符号链接别名_解析为同一真实路径', async () => {
  const dir = makeFixture('alias');
  const real = path.join(dir, 'real');
  mkdirSync(real);
  const alias = path.join(dir, 'alias-link');
  symlinkSync(real, alias);

  const viaReal = await resolveRootPath(real);
  const viaAlias = await resolveRootPath(alias);

  assert.ok(viaReal.ok && viaAlias.ok);
  assert.strictEqual(viaAlias.path, viaReal.path);
  assert.strictEqual(viaReal.path, realpathSync(real));
});

test('resolveRootPath_普通子目录_是不同身份', async () => {
  const dir = makeFixture('subdir');
  const parent = path.join(dir, 'project');
  const child = path.join(parent, 'nested');
  mkdirSync(child, { recursive: true });

  const parentResolved = await resolveRootPath(parent);
  const childResolved = await resolveRootPath(child);

  assert.ok(parentResolved.ok && childResolved.ok);
  assert.notStrictEqual(childResolved.path, parentResolved.path);
  assert.ok(childResolved.path.startsWith(parentResolved.path + path.sep));
});

test('resolveRootPath_目标不存在_返回missing不回退父目录', async () => {
  const dir = makeFixture('missing');
  mkdirSync(path.join(dir, 'kept'));

  const result = await resolveRootPath(path.join(dir, 'kept', 'moved-away'));

  assert.deepStrictEqual(result, { ok: false, reason: 'missing' });
});

test('resolveRootPath_软链接断开_返回missing', async () => {
  const dir = makeFixture('broken-link');
  const dangling = path.join(dir, 'dangling');
  symlinkSync(path.join(dir, 'never-existed'), dangling);

  const result = await resolveRootPath(dangling);

  assert.deepStrictEqual(result, { ok: false, reason: 'missing' });
});

test('resolveRootPath_目标是文件_返回not_directory', async () => {
  const dir = makeFixture('file-target');
  const file = path.join(dir, 'config.toml');
  writeFileSync(file, 'x = 1\n');

  const result = await resolveRootPath(file);

  assert.deepStrictEqual(result, { ok: false, reason: 'not_directory' });
});

test('assertSyntacticPath_非绝对或未规范化路径_拒绝', () => {
  assert.throws(() => assertSyntacticPath('relative/path', '字段'));
  assert.throws(() => assertSyntacticPath('/a/b/../c', '字段'));
  assert.throws(() => assertSyntacticPath(42, '字段'));
  assert.doesNotThrow(() => assertSyntacticPath('/a/b/c', '字段'));
});

test('resolveOutputKeys_输出不存在_取最近真实父目录加规范化后缀', async () => {
  const dir = makeFixture('output-missing');
  const aliasRoot = path.join(dir, 'root-link');
  symlinkSync(path.join(dir, 'root'), aliasRoot); // root/ 尚未创建：别名链也不存在
  mkdirSync(path.join(dir, 'root'));

  const resolved = await resolveOutputKeys([path.join(aliasRoot, '.agents', 'skills')]);

  assert.deepStrictEqual(resolved, [path.join(realpathSync(path.join(dir, 'root')), '.agents', 'skills')]);
});

test('resolveOutputKeys_最近父目录经软链接_后缀拼在真实路径上', async () => {
  const dir = makeFixture('output-parent');
  const real = path.join(dir, 'real');
  mkdirSync(path.join(real, '.agents'), { recursive: true });
  symlinkSync(real, path.join(dir, 'link'));

  const resolved = await resolveOutputKeys([path.join(dir, 'link', '.agents', 'skills')]);

  assert.deepStrictEqual(resolved, [path.join(realpathSync(real), '.agents', 'skills')]);
});

test('resolveOutputKeys_别名与真实路径指向同一输出_去重合并', async () => {
  const dir = makeFixture('output-dedupe');
  const real = path.join(dir, 'real');
  mkdirSync(path.join(real, 'skills'), { recursive: true });
  symlinkSync(real, path.join(dir, 'link'));

  const resolved = await resolveOutputKeys([
    path.join(dir, 'link', 'skills'),
    path.join(dir, 'real', 'skills'),
    path.join(dir, 'real', 'skills'),
  ]);

  assert.deepStrictEqual(resolved, [path.join(realpathSync(real), 'skills')]);
});

test('resolveOutputKeys_结果按字节序排序_与输入顺序无关', async () => {
  const dir = makeFixture('output-sort');
  mkdirSync(path.join(dir, 'b'), { recursive: true });
  mkdirSync(path.join(dir, 'a'), { recursive: true });

  const forward = await resolveOutputKeys([path.join(dir, 'a'), path.join(dir, 'b')]);
  const backward = await resolveOutputKeys([path.join(dir, 'b'), path.join(dir, 'a')]);

  assert.deepStrictEqual(forward, backward);
  assert.deepStrictEqual(forward, [path.join(dir, 'a'), path.join(dir, 'b')]);
});

test('resolveUnitKey_project_scope_库与项目均取真实身份', async () => {
  const dir = makeFixture('unit-project');
  const lib = path.join(dir, 'library');
  const project = path.join(dir, 'project');
  mkdirSync(lib);
  mkdirSync(project);
  const projectAlias = path.join(dir, 'project-link');
  symlinkSync(project, projectAlias);

  const viaAlias = await resolveUnitKey({
    libraryPath: lib,
    projectPath: projectAlias,
    tool: 'codex',
    module: 'skills',
    scope: 'project',
  });
  const viaReal = await resolveUnitKey({
    libraryPath: lib,
    projectPath: project,
    tool: 'codex',
    module: 'skills',
    scope: 'project',
  });

  assert.ok(viaAlias.ok && viaReal.ok);
  assert.deepStrictEqual(viaAlias.key, viaReal.key);
  assert.strictEqual(viaAlias.key.targetRoot, realpathSync(project));
  assert.strictEqual(viaAlias.key.libraryRoot, realpathSync(lib));
});

test('resolveUnitKey_project_scope_项目目录已移走_返回target_missing', async () => {
  const dir = makeFixture('unit-moved');
  const lib = path.join(dir, 'library');
  mkdirSync(lib);

  const result = await resolveUnitKey({
    libraryPath: lib,
    projectPath: path.join(dir, 'moved-away'),
    tool: 'cursor',
    module: 'rules',
    scope: 'project',
  });

  assert.deepStrictEqual(result, { ok: false, reason: 'target_missing' });
});

test('resolveUnitKey_内容库不可读_返回library_missing', async () => {
  const dir = makeFixture('unit-lib');
  const project = path.join(dir, 'project');
  mkdirSync(project);

  const result = await resolveUnitKey({
    libraryPath: path.join(dir, 'no-library'),
    projectPath: project,
    tool: 'claude',
    module: 'mcp',
    scope: 'project',
  });

  assert.deepStrictEqual(result, { ok: false, reason: 'library_missing' });
});

test('resolveUnitKey_global_scope_目标根为HOME_与项目维度无关', async () => {
  const dir = makeFixture('unit-global');
  const lib = path.join(dir, 'library');
  const projectA = path.join(dir, 'project-a');
  const projectB = path.join(dir, 'project-b');
  mkdirSync(lib);
  mkdirSync(projectA);
  mkdirSync(projectB);
  const fakeHome = path.join(dir, 'home');
  mkdirSync(fakeHome);

  const savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const viaA = await resolveUnitKey({
      libraryPath: lib,
      projectPath: projectA,
      tool: 'codex',
      module: 'skills',
      scope: 'global',
    });
    const viaB = await resolveUnitKey({
      libraryPath: lib,
      projectPath: projectB,
      tool: 'codex',
      module: 'skills',
      scope: 'global',
    });
    const noProject = await resolveUnitKey({
      libraryPath: lib,
      tool: 'codex',
      module: 'skills',
      scope: 'global',
    });

    assert.ok(viaA.ok && viaB.ok && noProject.ok);
    assert.deepStrictEqual(viaA.key, viaB.key);
    assert.deepStrictEqual(viaA.key, noProject.key);
    assert.strictEqual(viaA.key.targetRoot, realpathSync(fakeHome));
    assert.strictEqual(viaA.key.scope, 'global');
  } finally {
    process.env.HOME = savedHome;
  }
});

test('resolveUnitKey_project_scope_缺项目路径_返回target_missing', async () => {
  const dir = makeFixture('unit-no-project');
  const lib = path.join(dir, 'library');
  mkdirSync(lib);

  const result = await resolveUnitKey({
    libraryPath: lib,
    tool: 'codex',
    module: 'rules',
    scope: 'project',
  });

  assert.deepStrictEqual(result, { ok: false, reason: 'target_missing' });
});
