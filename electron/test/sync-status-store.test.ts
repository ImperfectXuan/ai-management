// electron/test/sync-status-store.test.ts
// 功能 002：本机状态持久化、校验、恢复与原子性（design §5）。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, statSync, mkdirSync, renameSync, symlinkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  SyncStatusStore,
  getSyncStatusPaths,
} from '../src/core/sync-status-store';
import { deriveKeyId, hmacSha256, KEY_BYTES } from '../src/core/sync-fingerprint';
import { resolveUnitKey } from '../src/core/sync-unit-identity';
import { SyncRecord, SyncUnitKey, resolveVersionState, unitKeyString } from '../src/shared/sync-status';

const KEY_ID = deriveKeyId(randomBytes(KEY_BYTES));

function makeFixture(name: string): { dir: string; file: string; lib: string; target: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `aiws-store-${name}-`));
  return {
    dir,
    file: path.join(dir, 'sync-status.json'),
    lib: path.join(dir, 'library'),
    target: path.join(dir, 'project'),
  };
}

function unitKey(lib: string, target: string, tool: SyncUnitKey['tool'] = 'codex'): SyncUnitKey {
  return { libraryRoot: lib, targetRoot: target, tool, module: 'skills', scope: 'project' };
}

function seedRecord(key: SyncUnitKey, outputKeys: string[], extra: Partial<SyncRecord> = {}): Record<string, unknown> {
  return {
    key: {
      libraryRoot: key.libraryRoot,
      targetRoot: key.targetRoot,
      tool: key.tool,
      module: key.module,
      scope: key.scope,
    },
    outputKeys,
    needsResync: false,
    lastSuccess: {
      fingerprintVersion: 1,
      keyId: KEY_ID,
      sourceFingerprint: 'fp-codex',
      effectiveOutputFingerprint: 'out-fp',
      completedAt: '2026-10-15T10:00:00.000Z',
    },
    lastAttempt: {
      operationId: 'op-1',
      keyId: KEY_ID,
      state: 'succeeded',
      startedAt: '2026-10-15T09:59:00.000Z',
      endedAt: '2026-10-15T10:00:00.000Z',
    },
    ...extra,
  };
}

function writeStatus(file: string, records: unknown[], schemaVersion = 1): void {
  writeFileSync(file, JSON.stringify({ schemaVersion, records }, null, 2) + '\n');
}

test('load_状态文件不存在_返回空状态', async () => {
  const fixture = makeFixture('missing');
  const store = new SyncStatusStore(fixture.file);
  const status = await store.load();
  assert.strictEqual(status.schemaVersion, 1);
  assert.deepStrictEqual(status.records, []);
  assert.strictEqual(existsSync(fixture.file), false, '读取不得创建状态文件');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('beginWrite与get_写入前门控_先落running与失效再返回', async () => {
  const fixture = makeFixture('gate');
  const store = new SyncStatusStore(fixture.file);
  const key = unitKey(fixture.lib, fixture.target);
  const outputKeys = [path.join(fixture.target, '.agents', 'skills')];
  const candidates = await store.beginWrite({
    key,
    outputKeys,
    operationId: 'op-1',
    keyId: KEY_ID,
    startedAt: '2026-10-15T11:00:00.000Z',
    effectiveOutputFingerprint: 'out-fp',
  });
  assert.deepStrictEqual(candidates, []);
  const record = await store.get(key);
  assert.strictEqual(record?.needsResync, true);
  assert.strictEqual(record?.lastAttempt?.state, 'running');
  // 门控必须已在磁盘上，而不是内存态
  const onDisk = JSON.parse(readFileSync(fixture.file, 'utf8'));
  assert.strictEqual(onDisk.records[0].needsResync, true);
  assert.strictEqual(onDisk.records[0].lastAttempt.state, 'running');
  assert.strictEqual(statSync(fixture.file).mode & 0o777, 0o600);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('load_文件损坏或未知schema_显式报错且保留原文件', async () => {
  const fixture = makeFixture('corrupt');
  writeFileSync(fixture.file, 'not-json{{{');
  const store = new SyncStatusStore(fixture.file);
  await assert.rejects(() => store.load(), /不是有效 JSON/);
  assert.strictEqual(readFileSync(fixture.file, 'utf8'), 'not-json{{{', '损坏文件必须原样保留');

  writeStatus(fixture.file, [], 2);
  await assert.rejects(() => store.load(), /不支持的同步状态版本/);
  assert.strictEqual(JSON.parse(readFileSync(fixture.file, 'utf8')).schemaVersion, 2, '未知版本文件必须原样保留');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('load_结构性无效记录_显式报错', async () => {
  const fixture = makeFixture('invalid');
  const key = unitKey(fixture.lib, fixture.target);
  writeStatus(fixture.file, [{ ...seedRecord(key, ['/a']), needsResync: 'yes' }]);
  await assert.rejects(() => new SyncStatusStore(fixture.file).load(), /needsResync 无效/);

  writeStatus(fixture.file, [seedRecord(key, ['/a']), seedRecord(key, ['/b'])]);
  await assert.rejects(() => new SyncStatusStore(fixture.file).load(), /记录重复/);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('load_lastSuccess缺keyId或时间戳无效_降级为无可信成功但保留记录', async () => {
  const fixture = makeFixture('demote');
  const key = unitKey(fixture.lib, fixture.target);
  const noKeyId = seedRecord(key, ['/a']);
  (noKeyId.lastSuccess as Record<string, unknown>).keyId = undefined;
  writeStatus(fixture.file, [noKeyId]);
  let record = (await new SyncStatusStore(fixture.file).get(key)) as SyncRecord;
  assert.ok(record, '记录本身保留');
  assert.strictEqual(record.lastSuccess, undefined, '缺 keyId 不作为可信成功');

  const badTime = seedRecord(key, ['/a']);
  (badTime.lastSuccess as Record<string, unknown>).completedAt = 'not-a-timestamp';
  writeStatus(fixture.file, [badTime]);
  record = (await new SyncStatusStore(fixture.file).get(key)) as SyncRecord;
  assert.strictEqual(record.lastSuccess, undefined, '无效时间戳不作为可信成功');
  assert.strictEqual(record.needsResync, false);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('load_lastAttempt缺keyId_显式报错', async () => {
  const fixture = makeFixture('attempt-key');
  const key = unitKey(fixture.lib, fixture.target);
  const seeded = seedRecord(key, ['/a']);
  (seeded.lastAttempt as Record<string, unknown>).keyId = 'missing-key-id';
  writeStatus(fixture.file, [seeded]);
  await assert.rejects(() => new SyncStatusStore(fixture.file).load(), /最近尝试无效/);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('recoverInterrupted_重启遇残留running_改为interrupted并标记失效', async () => {
  const fixture = makeFixture('interrupt');
  const key = unitKey(fixture.lib, fixture.target);
  const store = new SyncStatusStore(fixture.file);
  await store.beginWrite({
    key,
    outputKeys: ['/a/.agents/skills'],
    operationId: 'op-1',
    keyId: KEY_ID,
    startedAt: '2026-10-15T12:00:00.000Z',
  });

  const restarted = new SyncStatusStore(fixture.file);
  const recovered = await restarted.recoverInterrupted('2026-10-15T12:05:00.000Z');
  assert.strictEqual(recovered, 1);
  const record = await restarted.get(key);
  assert.strictEqual(record?.lastAttempt?.state, 'interrupted');
  assert.strictEqual(record?.lastAttempt?.endedAt, '2026-10-15T12:05:00.000Z');
  assert.strictEqual(record?.needsResync, true);
  assert.strictEqual(await restarted.recoverInterrupted('2026-10-15T12:06:00.000Z'), 0, '幂等：再次恢复不重复计数');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('commitSuccess_状态目录不可写_失败且原文件保持原状', async () => {
  const fixture = makeFixture('atomic');
  mkdirSync(path.join(fixture.dir, 'data'), { recursive: true });
  const file = path.join(fixture.dir, 'data', 'sync-status.json');
  const store = new SyncStatusStore(file);
  const key = unitKey(fixture.lib, fixture.target);
  const outputKeys = [path.join(fixture.target, '.agents', 'skills')];
  await store.beginWrite({
    key,
    outputKeys,
    operationId: 'op-1',
    keyId: KEY_ID,
    startedAt: '2026-10-15T13:00:00.000Z',
    effectiveOutputFingerprint: 'out-fp',
  });
  const before = readFileSync(file, 'utf8');

  chmodSync(path.dirname(file), 0o555);
  try {
    await assert.rejects(
      () =>
        store.commitSuccess({
          key,
          operationId: 'op-1',
          keyId: KEY_ID,
          sourceFingerprint: 'fp-1',
          effectiveOutputFingerprint: 'out-fp',
          startedAt: '2026-10-15T13:00:00.000Z',
          completedAt: '2026-10-15T13:00:10.000Z',
          candidates: [],
        }),
      /EACCES|EISDIR|EPERM|EROFS/
    );
    assert.strictEqual(readFileSync(file, 'utf8'), before, '写入失败必须保留原状态文件');
  } finally {
    chmodSync(path.dirname(file), 0o700);
  }
  // 队列未被写入失败破坏，后续操作可用
  const record = await store.get(key);
  assert.strictEqual(record?.lastAttempt?.state, 'running');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('commitSuccess_找不到写入尝试或状态非running_拒绝提交', async () => {
  const fixture = makeFixture('guards');
  const key = unitKey(fixture.lib, fixture.target);
  const store = new SyncStatusStore(fixture.file);
  await store.beginWrite({
    key,
    outputKeys: ['/a'],
    operationId: 'op-1',
    keyId: KEY_ID,
    startedAt: '2026-10-15T14:00:00.000Z',
  });
  const base = {
    key,
    keyId: KEY_ID,
    sourceFingerprint: 'fp',
    startedAt: '2026-10-15T14:00:00.000Z',
    completedAt: '2026-10-15T14:00:05.000Z',
    candidates: [],
  };
  await assert.rejects(
    () => store.commitSuccess({ ...base, operationId: 'op-other' }),
    /找不到对应的写入尝试记录/
  );
  await assert.rejects(
    () => store.commitSuccess({ ...base, operationId: 'op-1', keyId: deriveKeyId(randomBytes(KEY_BYTES)) }),
    /key_changed/
  );
  const record = await store.get(key);
  assert.strictEqual(record?.lastSuccess, undefined, '拒绝提交时不得写入成功基线');
  assert.strictEqual(record?.needsResync, true);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('list_按库目标与工具过滤_返回匹配记录', async () => {
  const fixture = makeFixture('filter');
  const store = new SyncStatusStore(fixture.file);
  const codexKey = unitKey(fixture.lib, fixture.target, 'codex');
  const claudeKey = unitKey(fixture.lib, fixture.target, 'claude');
  for (const key of [codexKey, claudeKey]) {
    await store.beginWrite({
      key,
      outputKeys: [path.join(fixture.target, '.agents', 'skills')],
      operationId: `op-${key.tool}`,
      keyId: KEY_ID,
      startedAt: '2026-10-15T15:00:00.000Z',
    });
  }
  const all = await store.list({ libraryRoot: fixture.lib, targetRoot: fixture.target, module: 'skills' });
  assert.deepStrictEqual(all.map((record) => record.key.tool).sort(), ['claude', 'codex']);
  const onlyClaude = await store.list({ tool: 'claude' });
  assert.strictEqual(onlyClaude.length, 1);
  assert.strictEqual(unitKeyString(onlyClaude[0].key), unitKeyString(claudeKey));
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('getSyncStatusPaths与beginWrite_落点固定_非规范路径在触碰文件前拒绝', async () => {
  const fixture = makeFixture('paths');
  const paths = getSyncStatusPaths(fixture.dir);
  assert.strictEqual(paths.statusFile, path.join(fixture.dir, 'sync-status.json'));
  assert.strictEqual(paths.keyFile, path.join(fixture.dir, 'sync-fingerprint.key'));

  const store = new SyncStatusStore(paths.statusFile);
  const key = unitKey(fixture.lib, fixture.target);
  await assert.rejects(
    () => store.beginWrite({
      key: { ...key, targetRoot: `${fixture.target}/../${path.basename(fixture.target)}` },
      outputKeys: [path.join(fixture.target, 'out')],
      operationId: 'op-1',
      keyId: KEY_ID,
      startedAt: '2026-10-15T16:00:00.000Z',
    }),
    /规范绝对路径/
  );
  await assert.rejects(
    () => store.beginWrite({
      key,
      outputKeys: [`${fixture.target}/./out`],
      operationId: 'op-2',
      keyId: KEY_ID,
      startedAt: '2026-10-15T16:00:00.000Z',
    }),
    /规范绝对路径/
  );
  assert.strictEqual(existsSync(paths.statusFile), false, '输入校验失败不得创建状态文件');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-01_两项目两工具三模块_成功基线互相隔离_查询只读不改文件', async () => {
  const fixture = makeFixture('isolation');
  const store = new SyncStatusStore(fixture.file);
  const projA = path.join(fixture.dir, 'project-a');
  const projB = path.join(fixture.dir, 'project-b');
  mkdirSync(projA);
  mkdirSync(projB);
  const units: SyncUnitKey[] = [
    { libraryRoot: fixture.lib, targetRoot: projA, tool: 'cursor', module: 'rules', scope: 'project' },
    { libraryRoot: fixture.lib, targetRoot: projB, tool: 'cursor', module: 'rules', scope: 'project' },
    { libraryRoot: fixture.lib, targetRoot: projA, tool: 'trae', module: 'skills', scope: 'project' },
    { libraryRoot: fixture.lib, targetRoot: projA, tool: 'codex', module: 'mcp', scope: 'project' },
  ];
  for (const [index, key] of units.entries()) {
    const outputKeys = [path.join(key.targetRoot, `out-${index}`)];
    await store.beginWrite({
      key, outputKeys, operationId: `op-${index}`, keyId: KEY_ID,
      startedAt: '2026-10-15T17:00:00.000Z', effectiveOutputFingerprint: 'out-fp',
    });
    await store.commitSuccess({
      key, operationId: `op-${index}`, keyId: KEY_ID, sourceFingerprint: `fp-${index}`,
      effectiveOutputFingerprint: 'out-fp',
      startedAt: '2026-10-15T17:00:00.000Z', completedAt: '2026-10-15T17:00:01.000Z', candidates: [],
    });
  }

  // 仅重新同步项目 A 的 Cursor 规则单元
  const only = units[0];
  await store.beginWrite({
    key: only, outputKeys: [path.join(only.targetRoot, 'out-0')], operationId: 'op-rerun', keyId: KEY_ID,
    startedAt: '2026-10-15T18:00:00.000Z', effectiveOutputFingerprint: 'out-fp',
  });
  await store.commitSuccess({
    key: only, operationId: 'op-rerun', keyId: KEY_ID, sourceFingerprint: 'fp-0',
    effectiveOutputFingerprint: 'out-fp',
    startedAt: '2026-10-15T18:00:00.000Z', completedAt: '2026-10-15T18:00:01.000Z', candidates: [],
  });

  // 项目 B、Trae、MCP 的成功基线与最近尝试均不改变
  for (const key of units.slice(1)) {
    const record = await store.get(key);
    assert.strictEqual(record?.lastAttempt?.state, 'succeeded');
    assert.strictEqual(record?.needsResync, false);
    assert.match(record?.lastSuccess?.sourceFingerprint ?? '', /^fp-[123]$/);
  }

  // 只切换视图（不同 filter 组合）不得改写状态文件
  const beforeQuery = readFileSync(fixture.file, 'utf8');
  await store.list({ scope: 'project', tool: 'cursor' });
  await store.list({ targetRoot: projB });
  await store.list({ module: 'skills' });
  await store.get(units[0]);
  assert.strictEqual(readFileSync(fixture.file, 'utf8'), beforeQuery, '查询只读，不改写状态文件');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-02_切换内容库_记录按库隔离_切回仍可查看原库历史', async () => {
  const fixture = makeFixture('switch-lib');
  const libA = path.join(fixture.dir, 'library-a');
  const libB = path.join(fixture.dir, 'library-b');
  const target = path.join(fixture.dir, 'project');
  mkdirSync(libA);
  mkdirSync(libB);
  mkdirSync(target);
  const store = new SyncStatusStore(fixture.file);
  const keyA = unitKey(libA, target);
  await store.beginWrite({
    key: keyA, outputKeys: [path.join(target, '.agents', 'skills')], operationId: 'op-a', keyId: KEY_ID,
    startedAt: '2026-10-15T17:00:00.000Z', effectiveOutputFingerprint: 'out-fp',
  });
  await store.commitSuccess({
    key: keyA, operationId: 'op-a', keyId: KEY_ID, sourceFingerprint: 'fp-a',
    effectiveOutputFingerprint: 'out-fp',
    startedAt: '2026-10-15T17:00:00.000Z', completedAt: '2026-10-15T17:00:01.000Z', candidates: [],
  });

  assert.deepStrictEqual(await store.list({ libraryRoot: libB }), [], '库 B 不得复用库 A 的成功记录');
  const backInA = await store.list({ libraryRoot: libA });
  assert.strictEqual(backInA.length, 1);
  const state = resolveVersionState({ record: backInA[0], currentSourceFingerprint: 'fp-a' });
  assert.strictEqual(state.state, 'current');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-02_global记录_不含项目维度_项目视图不命中', async () => {
  const fixture = makeFixture('global-scope');
  const home = path.join(fixture.dir, 'home');
  const projA = path.join(fixture.dir, 'project-a');
  const projB = path.join(fixture.dir, 'project-b');
  mkdirSync(fixture.lib);
  mkdirSync(home);
  mkdirSync(projA);
  mkdirSync(projB);
  const store = new SyncStatusStore(fixture.file);
  // global 键由 resolveUnitKey 产出：targetRoot 为 $HOME，与项目无关
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  let globalKey: SyncUnitKey;
  try {
    const resolved = await resolveUnitKey({
      libraryPath: fixture.lib, projectPath: projA, tool: 'codex', module: 'skills', scope: 'global',
    });
    assert.ok(resolved.ok);
    globalKey = resolved.key;
    const viaOtherProject = await resolveUnitKey({
      libraryPath: fixture.lib, projectPath: projB, tool: 'codex', module: 'skills', scope: 'global',
    });
    assert.ok(viaOtherProject.ok);
    assert.strictEqual(unitKeyString(viaOtherProject.key), unitKeyString(globalKey), '两个项目解析出同一条 global 键');
  } finally {
    process.env.HOME = savedHome;
  }

  await store.beginWrite({
    key: globalKey, outputKeys: [path.join(home, '.agents', 'skills')], operationId: 'op-g', keyId: KEY_ID,
    startedAt: '2026-10-15T17:00:00.000Z', effectiveOutputFingerprint: 'out-fp',
  });
  assert.strictEqual((await store.list({ scope: 'global', targetRoot: realpathFixture(home) })).length, 1);
  assert.deepStrictEqual(await store.list({ targetRoot: realpathFixture(projA) }), [], 'global 记录不归属项目');
  assert.deepStrictEqual(await store.list({ scope: 'global', targetRoot: realpathFixture(projB) }), []);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-06_重启后状态可恢复_关闭期间来源改变则首查待同步', async () => {
  const fixture = makeFixture('restart');
  const key = unitKey(fixture.lib, fixture.target);
  const first = new SyncStatusStore(fixture.file);
  await first.beginWrite({
    key, outputKeys: [path.join(fixture.target, 'out')], operationId: 'op-1', keyId: KEY_ID,
    startedAt: '2026-10-15T17:00:00.000Z',
  });
  await first.commitSuccess({
    key, operationId: 'op-1', keyId: KEY_ID, sourceFingerprint: 'fp-before-close',
    startedAt: '2026-10-15T17:00:00.000Z', completedAt: '2026-10-15T17:00:01.000Z', candidates: [],
  });

  // 模拟应用重启：独立实例只读同一文件
  const restarted = new SyncStatusStore(fixture.file);
  const restored = await restarted.get(key);
  assert.ok(restored, '重启后成功记录可恢复');
  assert.strictEqual(restored.lastAttempt?.state, 'succeeded');
  assert.strictEqual(
    resolveVersionState({ record: restored, currentSourceFingerprint: 'fp-before-close' }).state,
    'current'
  );
  // 关闭期间来源文件被修改 → 首次查询即待同步。
  // 真实来源重算依赖输入枚举（TASK-002-02），此处以不同指纹代表关闭期间已变化的来源。
  const afterEdit = resolveVersionState({ record: restored, currentSourceFingerprint: 'fp-after-close' });
  assert.strictEqual(afterEdit.state, 'pending');
  assert.strictEqual(afterEdit.reasonCode, 'source_changed');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-07_仅有旧lastSyncAt_不补造成功记录', async () => {
  const fixture = makeFixture('legacy-sync-at');
  const reposFile = path.join(fixture.dir, 'repos.json');
  writeFileSync(reposFile, JSON.stringify({
    repos: [{
      id: 'repo-1', path: fixture.target, name: 'project',
      addedAt: '2026-01-01T00:00:00.000Z', lastSyncAt: '2026-08-01T00:00:00.000Z',
    }],
  }, null, 2));
  const paths = getSyncStatusPaths(fixture.dir);
  const store = new SyncStatusStore(paths.statusFile);

  const status = await store.load();
  assert.deepStrictEqual(status.records, [], '旧 lastSyncAt 不得迁移为成功基线');
  assert.strictEqual(existsSync(paths.statusFile), false, '只读查询不创建状态文件');
  assert.strictEqual(resolveVersionState({ record: null }).state, 'untracked');
  // 旧时间字段仅为 workspace 兼容展示而保留
  const legacy = JSON.parse(readFileSync(reposFile, 'utf8'));
  assert.strictEqual(legacy.repos[0].lastSyncAt, '2026-08-01T00:00:00.000Z');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-07_别名与真实路径同键_移走目录旧记录保留_新路径是新身份', async () => {
  const fixture = makeFixture('moved');
  const lib = path.join(fixture.dir, 'library');
  const project = path.join(fixture.dir, 'project');
  const alias = path.join(fixture.dir, 'project-link');
  mkdirSync(lib);
  mkdirSync(project);
  symlinkSync(project, alias);
  const store = new SyncStatusStore(fixture.file);

  const viaAlias = await resolveUnitKey({
    libraryPath: lib, projectPath: alias, tool: 'codex', module: 'skills', scope: 'project',
  });
  const viaReal = await resolveUnitKey({
    libraryPath: lib, projectPath: project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.ok(viaAlias.ok && viaReal.ok);
  assert.strictEqual(unitKeyString(viaAlias.key), unitKeyString(viaReal.key), '符号链接别名归并为同一身份');

  await store.beginWrite({
    key: viaAlias.key, outputKeys: [path.join(realpathFixture(project), '.agents', 'skills')],
    operationId: 'op-1', keyId: KEY_ID, startedAt: '2026-10-15T17:00:00.000Z',
  });
  await store.commitSuccess({
    key: viaAlias.key, operationId: 'op-1', keyId: KEY_ID, sourceFingerprint: 'fp-moved',
    startedAt: '2026-10-15T17:00:00.000Z', completedAt: '2026-10-15T17:00:01.000Z', candidates: [],
  });
  assert.strictEqual((await store.get(viaReal.key))?.lastSuccess?.sourceFingerprint, 'fp-moved');

  // 目录移走：身份解析为缺失（不回退父目录），旧记录原样保留、不自动迁移
  renameSync(project, path.join(fixture.dir, 'project-relocated'));
  const afterMove = await resolveUnitKey({
    libraryPath: lib, projectPath: project, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.deepStrictEqual(afterMove, { ok: false, reason: 'target_missing' });
  assert.strictEqual((await store.get(viaReal.key))?.lastSuccess?.sourceFingerprint, 'fp-moved');

  // 换到新路径登记：新身份查不到旧记录（untracked），旧记录仍在文件里
  const relocated = path.join(fixture.dir, 'project-relocated');
  const newIdentity = await resolveUnitKey({
    libraryPath: lib, projectPath: relocated, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.ok(newIdentity.ok);
  assert.notStrictEqual(unitKeyString(newIdentity.key), unitKeyString(viaReal.key));
  assert.strictEqual(await store.get(newIdentity.key), undefined);
  assert.strictEqual((await store.list({})).length, 1, '旧记录不被删除也不被迁移');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-10_同版本重试取消_历史成功保留但不显当前', async () => {
  const fixture = makeFixture('cancelled');
  const key = unitKey(fixture.lib, fixture.target);
  const seeded = seedRecord(key, [path.join(fixture.target, 'out')]);
  writeStatus(fixture.file, [seeded]);
  const store = new SyncStatusStore(fixture.file);

  await store.beginWrite({
    key, outputKeys: [path.join(fixture.target, 'out')], operationId: 'op-retry', keyId: KEY_ID,
    startedAt: '2026-10-15T17:30:00.000Z',
  });
  await store.failAttempt({
    key, operationId: 'op-retry', keyId: KEY_ID, state: 'cancelled',
    startedAt: '2026-10-15T17:30:00.000Z', endedAt: '2026-10-15T17:30:05.000Z', reasonCode: 'cancelled_by_user',
  });

  const record = await store.get(key);
  assert.strictEqual(record?.lastAttempt?.state, 'cancelled');
  assert.strictEqual(record?.lastSuccess?.sourceFingerprint, 'fp-codex', '取消不覆盖历史成功记录');
  assert.strictEqual(record?.lastSuccess?.completedAt, '2026-10-15T10:00:00.000Z');
  // 即便指纹仍相等，needsResync 也优先：不出现绿色已同步
  const state = resolveVersionState({ record: record as SyncRecord, currentSourceFingerprint: 'fp-codex' });
  assert.strictEqual(state.state, 'pending');
  assert.strictEqual(state.reasonCode, 'needs_resync');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-12_子进程持久化running后崩溃_重启恢复为中断', async () => {
  const fixture = makeFixture('child-crash');
  const storeModule = path.resolve(__dirname, '../src/core/sync-status-store.ts');
  const childFile = path.join(fixture.dir, 'crash-child.mts'); // .mts：tsx 按 ESM 处理，支持顶层 await
  writeFileSync(childFile, `
import { SyncStatusStore } from ${JSON.stringify(storeModule)};
const [file, lib, target] = process.argv.slice(2);
const store = new SyncStatusStore(file);
await store.beginWrite({
  key: { libraryRoot: lib, targetRoot: target, tool: 'codex', module: 'skills', scope: 'project' },
  outputKeys: [target + '/.agents/skills'],
  operationId: 'op-crash',
  keyId: process.env.AIWS_TEST_KEY_ID,
  startedAt: '2026-10-15T19:00:00.000Z',
  effectiveOutputFingerprint: 'out-fp',
});
process.exit(137);
`);
  const crashed = spawnSync(process.execPath, ['--import', 'tsx', childFile, fixture.file, fixture.lib, fixture.target], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, AIWS_TEST_KEY_ID: KEY_ID },
  });
  assert.strictEqual(crashed.status, 137, `子进程应以 137 退出：${crashed.stderr}`);

  // 磁盘上仍是 running，随后“重启”读取
  const onDisk = JSON.parse(readFileSync(fixture.file, 'utf8'));
  assert.strictEqual(onDisk.records[0].lastAttempt.state, 'running');
  const restarted = new SyncStatusStore(fixture.file);
  assert.strictEqual(await restarted.recoverInterrupted('2026-10-15T19:05:00.000Z'), 1);
  const record = await restarted.get({
    libraryRoot: fixture.lib, targetRoot: fixture.target, tool: 'codex', module: 'skills', scope: 'project',
  });
  assert.strictEqual(record?.lastAttempt?.state, 'interrupted');
  assert.strictEqual(record?.needsResync, true);
  assert.strictEqual(record?.lastSuccess, undefined, '中断不得产生成功基线');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('AC-002-18_状态文件不含配置正文或凭据_只保留指纹与keyId', async () => {
  const fixture = makeFixture('sensitive');
  const SYNTH_CREDENTIAL = 'sk-synthetic-must-not-leak-0001';
  const SYNTH_ENDPOINT = 'https://synthetic.invalid/mcp';
  const key = unitKey(fixture.lib, fixture.target);
  const secretBytes = randomBytes(KEY_BYTES);
  const keyId = deriveKeyId(secretBytes);
  const sourceFingerprint = hmacSha256(secretBytes, {
    servers: { demo: { apiKey: SYNTH_CREDENTIAL, url: SYNTH_ENDPOINT } },
  });

  const store = new SyncStatusStore(fixture.file);
  await store.beginWrite({
    key, outputKeys: [path.join(fixture.target, '.mcp.json')], operationId: 'op-1', keyId,
    startedAt: '2026-10-15T17:00:00.000Z',
  });
  await store.commitSuccess({
    key, operationId: 'op-1', keyId, sourceFingerprint,
    startedAt: '2026-10-15T17:00:00.000Z', completedAt: '2026-10-15T17:00:01.000Z', candidates: [],
  });

  const raw = readFileSync(fixture.file, 'utf8');
  assert.ok(!raw.includes(SYNTH_CREDENTIAL), '状态文件不得出现凭据');
  assert.ok(!raw.includes(SYNTH_ENDPOINT), '状态文件不得出现配置正文');
  assert.ok(raw.includes(keyId), 'keyId 按设计持久化');
  assert.ok(raw.includes(sourceFingerprint), '指纹为 HMAC 摘要而非原文');
  rmSync(fixture.dir, { recursive: true, force: true });
});

function realpathFixture(target: string): string {
  // fixture 基目录可能经 /var→/private/var 别名，断言统一用真实路径比较
  return realpathSync(target);
}
