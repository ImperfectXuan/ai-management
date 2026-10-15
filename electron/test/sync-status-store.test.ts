// electron/test/sync-status-store.test.ts
// 功能 002：本机状态持久化、校验、恢复与原子性（design §5）。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SyncStatusStore } from '../src/core/sync-status-store';
import { deriveKeyId, KEY_BYTES } from '../src/core/sync-fingerprint';
import { SyncRecord, SyncUnitKey, unitKeyString } from '../src/shared/sync-status';

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
