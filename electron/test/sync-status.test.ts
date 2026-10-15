// electron/test/sync-status.test.ts
// 功能 002：共享输出等价判定生命周期与 keyId 身份优先级（design §2.2、§2.3、§3.1）。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SyncStatusStore } from '../src/core/sync-status-store';
import { KEY_BYTES, computeEffectiveOutputFingerprint, computeSourceFingerprint, deriveKeyId } from '../src/core/sync-fingerprint';
import {
  KeyProblemCode,
  SyncRecord,
  SyncUnitKey,
  keyProblemFor,
  resolveVersionState,
  unitKeyString,
} from '../src/shared/sync-status';

const KEY_BYTES_32 = randomBytes(KEY_BYTES);
const KEY_ID = deriveKeyId(KEY_BYTES_32);
const OTHER_KEY_ID = deriveKeyId(randomBytes(KEY_BYTES));
const STARTED_AT = '2026-10-15T10:00:00.000Z';
const COMPLETED_AT = '2026-10-15T10:00:05.000Z';

interface Fixture {
  dir: string;
  file: string;
  libA: string;
  libB: string;
  target: string;
  skillsDir: string;
  planA: string;
  planB: string;
}

function makeFixture(name: string): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), `aiws-status-${name}-`));
  const target = path.join(dir, 'project');
  const skillsDir = path.join(target, '.agents', 'skills');
  const plan = (linkType: string) =>
    computeEffectiveOutputFingerprint(KEY_BYTES_32, {
      outputKeys: [skillsDir],
      entries: [
        {
          relativePath: 'alpha',
          targetPath: path.join(skillsDir, 'alpha'),
          sourcePath: path.join(dir, 'library', 'skills', 'alpha'),
          sourceVersion: 'sha-alpha',
          strategy: 'symlink' as const,
        },
      ],
      behavior: { linkType },
    });
  return {
    dir,
    file: path.join(dir, 'sync-status.json'),
    libA: path.join(dir, 'library'),
    libB: path.join(dir, 'library-b'),
    target,
    skillsDir,
    planA: plan('auto'),
    planB: plan('copy'),
  };
}

function unitKey(fixture: Fixture, tool: SyncUnitKey['tool'], lib: string = fixture.libA): SyncUnitKey {
  return { libraryRoot: lib, targetRoot: fixture.target, tool, module: 'skills', scope: 'project' };
}

function sourceFp(fixture: Fixture, tool: SyncUnitKey['tool'], lib: string = fixture.libA): string {
  return computeSourceFingerprint(KEY_BYTES_32, {
    unit: { tool, module: 'skills', scope: 'project' },
    inputs: { libraryRoot: lib, skills: [{ name: 'alpha', hash: 'sha-alpha' }] },
    behavior: { linkType: 'auto' },
    generatorDeps: { 'skills-link.sh': 'rev1' },
  });
}

/** 模拟查询期重算：条目存在且等于基线即“当前来源与基线一致”。 */
async function currentMap(store: SyncStatusStore): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const record of await store.list()) {
    if (record.lastSuccess) map[unitKeyString(record.key)] = record.lastSuccess.sourceFingerprint;
  }
  return map;
}

interface SyncAttemptOptions {
  operationId?: string;
  keyId?: string;
  currentSourceFingerprints?: Record<string, string>;
  planFp?: string;
}

async function begin(store: SyncStatusStore, fixture: Fixture, tool: SyncUnitKey['tool'], options: SyncAttemptOptions = {}) {
  return store.beginWrite({
    key: unitKey(fixture, tool),
    outputKeys: [fixture.skillsDir],
    operationId: options.operationId ?? `op-${tool}`,
    keyId: options.keyId ?? KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: options.planFp ?? fixture.planA,
    currentSourceFingerprints: options.currentSourceFingerprints ?? (await currentMap(store)),
  });
}

async function commit(store: SyncStatusStore, fixture: Fixture, tool: SyncUnitKey['tool'], options: SyncAttemptOptions = {}) {
  return store.commitSuccess({
    key: unitKey(fixture, tool),
    operationId: options.operationId ?? `op-${tool}`,
    keyId: options.keyId ?? KEY_ID,
    sourceFingerprint: sourceFp(fixture, tool),
    effectiveOutputFingerprint: options.planFp ?? fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates: await begin(store, fixture, tool, options),
  });
}

async function fail(store: SyncStatusStore, fixture: Fixture, tool: SyncUnitKey['tool'], options: SyncAttemptOptions = {}) {
  await store.failAttempt({
    key: unitKey(fixture, tool),
    operationId: options.operationId ?? `op-${tool}`,
    keyId: options.keyId ?? KEY_ID,
    state: 'failed',
    startedAt: STARTED_AT,
    endedAt: COMPLETED_AT,
    reasonCode: 'cli_failed',
  });
}

function stateOf(record: SyncRecord | undefined, currentFingerprint: string | null = null, keyProblem: KeyProblemCode | null = null) {
  return resolveVersionState({
    record,
    keyProblem,
    currentSourceFingerprint: currentFingerprint,
  });
}

test('共享等价判定_同库两工具依次成功_双方收敛为current', async () => {
  const fixture = makeFixture('converge');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');

  const candidates = await begin(store, fixture, 'claude');
  assert.strictEqual(candidates.length, 1, '写入前须快照可信等价候选');
  assert.strictEqual(candidates[0].recordKey.tool, 'codex');
  assert.strictEqual(candidates[0].lastSuccess.completedAt, COMPLETED_AT);

  // 规则 2：任何写入期间，重叠记录（含候选）必须先失效，不能保留绿色状态
  const transient = await store.get(unitKey(fixture, 'codex'));
  assert.strictEqual(transient?.needsResync, true, '写入期间候选不得保持绿色');

  const restored = await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  assert.strictEqual(restored, 1);

  const codex = await store.get(unitKey(fixture, 'codex'));
  const claude = await store.get(unitKey(fixture, 'claude'));
  assert.strictEqual(codex?.needsResync, false, '等价写入成功后须恢复候选');
  assert.strictEqual(claude?.needsResync, false);
  assert.strictEqual(codex?.lastSuccess?.completedAt, COMPLETED_AT, '恢复不得改动原完成时间');
  assert.deepStrictEqual(codex?.lastAttempt?.state, 'succeeded');
  assert.strictEqual(stateOf(codex, codex?.lastSuccess?.sourceFingerprint ?? null).state, 'current');
  assert.strictEqual(stateOf(claude, claude?.lastSuccess?.sourceFingerprint ?? null).state, 'current');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('共享等价判定_重复完整同步_双方保持current', async () => {
  const fixture = makeFixture('repeat');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');
  await commit(store, fixture, 'claude');

  await commit(store, fixture, 'codex');
  await commit(store, fixture, 'claude');

  const codex = await store.get(unitKey(fixture, 'codex'));
  const claude = await store.get(unitKey(fixture, 'claude'));
  assert.strictEqual(codex?.needsResync, false);
  assert.strictEqual(claude?.needsResync, false, '重复同步不得重新引入永久互斥失效');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价写入失败_候选保持失效_逐步重试后恢复', async () => {
  const fixture = makeFixture('failure');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');

  // Claude 部分写入后失败：候选不恢复，历史成功保留，聚合不得变绿
  const candidates = await begin(store, fixture, 'claude');
  assert.strictEqual(candidates.length, 1);
  await fail(store, fixture, 'claude');
  let codex = await store.get(unitKey(fixture, 'codex'));
  let claude = await store.get(unitKey(fixture, 'claude'));
  assert.strictEqual(codex?.needsResync, true, '失败不恢复任何候选');
  assert.strictEqual(codex?.lastSuccess?.sourceFingerprint, sourceFp(fixture, 'codex'), '历史成功记录保留');
  assert.strictEqual(claude?.lastSuccess, undefined, '失败不得创建成功基线');
  assert.strictEqual(claude?.lastAttempt?.state, 'failed');
  assert.deepStrictEqual(stateOf(codex, sourceFp(fixture, 'codex')), { state: 'pending', reasonCode: 'needs_resync' });

  // 显式成功重试 Claude：先前已失效的 Codex 不在候选快照，保持 pending（逐步恢复）
  await commit(store, fixture, 'claude');
  codex = await store.get(unitKey(fixture, 'codex'));
  claude = await store.get(unitKey(fixture, 'claude'));
  assert.strictEqual(claude?.needsResync, false);
  assert.strictEqual(codex?.needsResync, true, '先前失效的记录不被盲目恢复');

  // 再显式成功同步 Codex：Claude 成为候选并被恢复，双方收敛
  await commit(store, fixture, 'codex');
  codex = await store.get(unitKey(fixture, 'codex'));
  claude = await store.get(unitKey(fixture, 'claude'));
  assert.strictEqual(codex?.needsResync, false);
  assert.strictEqual(claude?.needsResync, false, '逐步重试后收敛为双方 current');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_来源已变或读取不到_不进入快照不恢复', async () => {
  const fixture = makeFixture('source-changed');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');

  const changed = await currentMap(store);
  delete changed[unitKeyString(unitKey(fixture, 'codex'))];
  const candidates = await begin(store, fixture, 'claude', { currentSourceFingerprints: changed });
  assert.strictEqual(candidates.length, 0, '来源已变或未确认 current 的记录不进入候选');
  await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  const codex = await store.get(unitKey(fixture, 'codex'));
  assert.strictEqual(codex?.needsResync, true, '非候选的重叠记录保持失效');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_有效输出指纹不同或输出仅部分重叠_不恢复', async () => {
  const fixture = makeFixture('plan-mismatch');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');

  // 不同有效计划（如不同链接策略）：不是等价候选
  const otherPlan = await begin(store, fixture, 'claude', { planFp: fixture.planB });
  assert.strictEqual(otherPlan.length, 0, '计划指纹不同不得互为候选');
  await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planB,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates: otherPlan,
  });
  assert.strictEqual((await store.get(unitKey(fixture, 'codex')))?.needsResync, true);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_输出集合仅部分重叠_失效但不恢复', async () => {
  const fixture = makeFixture('partial');
  const store = new SyncStatusStore(fixture.file);
  const codexKey = unitKey(fixture, 'codex');
  const claudeKey = unitKey(fixture, 'claude');
  const extraDir = path.join(fixture.target, '.claude', 'skills');

  await store.beginWrite({
    key: codexKey,
    outputKeys: [fixture.skillsDir, extraDir],
    operationId: 'op-codex',
    keyId: KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: fixture.planA,
  });
  await store.commitSuccess({
    key: codexKey,
    operationId: 'op-codex',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'codex'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates: [],
  });

  const map = await currentMap(store);
  const candidates = await store.beginWrite({
    key: claudeKey,
    outputKeys: [fixture.skillsDir],
    operationId: 'op-claude',
    keyId: KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: fixture.planA,
    currentSourceFingerprints: map,
  });
  assert.strictEqual(candidates.length, 0, '只有部分输出重叠不算等价候选');
  assert.strictEqual((await store.get(codexKey))?.needsResync, true, '重叠部分仍触发失效');
  await store.commitSuccess({
    key: claudeKey,
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  assert.strictEqual((await store.get(codexKey))?.needsResync, true, '部分重叠的记录不被恢复');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_不同内容库同目标_失效保持不恢复', async () => {
  const fixture = makeFixture('cross-library');
  const store = new SyncStatusStore(fixture.file);
  const libBKey = unitKey(fixture, 'codex', fixture.libB);

  await store.beginWrite({
    key: libBKey,
    outputKeys: [fixture.skillsDir],
    operationId: 'op-libb',
    keyId: KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: fixture.planA,
  });
  await store.commitSuccess({
    key: libBKey,
    operationId: 'op-libb',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'codex', fixture.libB),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates: [],
  });

  const candidates = await begin(store, fixture, 'claude');
  assert.strictEqual(candidates.length, 0, '不同内容库不互为等价候选');
  assert.strictEqual((await store.get(libBKey))?.needsResync, true, '他库记录被写入前失效');
  await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  assert.strictEqual((await store.get(libBKey))?.needsResync, true, '他库失效不因计划摘要相同而恢复');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_快照后候选被新尝试改动_不恢复', async () => {
  const fixture = makeFixture('intervening');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');

  const candidates = await begin(store, fixture, 'claude');
  assert.strictEqual(candidates.length, 1);

  // 快照之后又对 Codex 发起新写入（如单项链接门控），lastAttempt 已变化
  await store.beginWrite({
    key: unitKey(fixture, 'codex'),
    outputKeys: [fixture.skillsDir],
    operationId: 'op-codex-2',
    keyId: KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: null,
  });
  await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  const codex = await store.get(unitKey(fixture, 'codex'));
  assert.strictEqual(codex?.needsResync, true, '候选状态与快照不符时不得恢复');
  assert.strictEqual(codex?.lastAttempt?.operationId, 'op-codex-2');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('运行中密钥更换_提交被拒绝_候选与执行记录均不更新', async () => {
  const fixture = makeFixture('key-swap');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');
  const codexBefore = await store.get(unitKey(fixture, 'codex'));

  const candidates = await begin(store, fixture, 'claude');
  assert.strictEqual(candidates.length, 1);
  await assert.rejects(
    () =>
      store.commitSuccess({
        key: unitKey(fixture, 'claude'),
        operationId: 'op-claude',
        keyId: OTHER_KEY_ID,
        sourceFingerprint: sourceFp(fixture, 'claude'),
        effectiveOutputFingerprint: fixture.planA,
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        candidates,
      }),
    /key_changed/
  );

  const codex = await store.get(unitKey(fixture, 'codex'));
  const claude = await store.get(unitKey(fixture, 'claude'));
  assert.strictEqual(codex?.needsResync, true, '换密钥不恢复候选');
  assert.deepStrictEqual(codex?.lastSuccess, codexBefore?.lastSuccess, '旧成功记录原样保留');
  assert.strictEqual(claude?.lastAttempt?.state, 'running', '拒绝提交后执行单元仍是运行态');
  assert.strictEqual(claude?.lastSuccess, undefined, '换密钥不得更新成功记录');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('成功提交_不为未执行工具创建成功基线', async () => {
  const fixture = makeFixture('no-fabrication');
  const store = new SyncStatusStore(fixture.file);

  await commit(store, fixture, 'claude');
  const records = await store.list();
  assert.strictEqual(records.length, 1, '不存在的工具记录不得凭空创建');
  assert.strictEqual(records[0].key.tool, 'claude');

  // 已有但从未成功的 Codex 记录：只可能被失效，绝不会被补出 lastSuccess
  await store.beginWrite({
    key: unitKey(fixture, 'codex'),
    outputKeys: [fixture.skillsDir],
    operationId: 'op-codex',
    keyId: KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: null,
  });
  const candidates = await begin(store, fixture, 'claude', { operationId: 'op-claude-2' });
  await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude-2',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  const codex = await store.get(unitKey(fixture, 'codex'));
  assert.strictEqual(codex?.lastSuccess, undefined, '等价恢复不能替未执行工具创建成功');
  assert.strictEqual(codex?.needsResync, true);
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_成功记录缺有效输出指纹_不参与等价恢复', async () => {
  const fixture = makeFixture('legacy-success');
  // 模拟实验性/旧记录：可信成功但没有 effectiveOutputFingerprint
  writeFileSync(
    fixture.file,
    JSON.stringify(
      {
        schemaVersion: 1,
        records: [
          {
            key: {
              libraryRoot: fixture.libA,
              targetRoot: fixture.target,
              tool: 'codex',
              module: 'skills',
              scope: 'project',
            },
            outputKeys: [fixture.skillsDir],
            needsResync: false,
            lastSuccess: {
              fingerprintVersion: 1,
              keyId: KEY_ID,
              sourceFingerprint: sourceFp(fixture, 'codex'),
              completedAt: COMPLETED_AT,
            },
          },
        ],
      },
      null,
      2
    ) + '\n'
  );
  const store = new SyncStatusStore(fixture.file);
  const candidates = await begin(store, fixture, 'claude');
  assert.strictEqual(candidates.length, 0, '缺少有效输出指纹的成功记录不进入等价快照');
  await store.commitSuccess({
    key: unitKey(fixture, 'claude'),
    operationId: 'op-claude',
    keyId: KEY_ID,
    sourceFingerprint: sourceFp(fixture, 'claude'),
    effectiveOutputFingerprint: fixture.planA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates,
  });
  const codex = await store.get(unitKey(fixture, 'codex'));
  assert.strictEqual(codex?.needsResync, true, '不可参与等价的记录保持失效');
  assert.strictEqual(codex?.lastSuccess?.sourceFingerprint, sourceFp(fixture, 'codex'), '历史成功仍保留');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_已有成功记录的单元重试失败_保持pending且历史保留', async () => {
  const fixture = makeFixture('retry-failure');
  const store = new SyncStatusStore(fixture.file);
  await commit(store, fixture, 'codex');
  const before = (await store.get(unitKey(fixture, 'codex')))?.lastSuccess;

  // 同来源版本上重试：先失效再执行，失败后不得继续显示 current
  await begin(store, fixture, 'codex', { operationId: 'op-codex-retry' });
  await fail(store, fixture, 'codex', { operationId: 'op-codex-retry' });
  const record = await store.get(unitKey(fixture, 'codex'));
  assert.strictEqual(record?.needsResync, true, '同版本重试失败必须保持待同步');
  assert.deepStrictEqual(record?.lastSuccess, before, '历史成功记录原样保留');
  assert.strictEqual(record?.lastAttempt?.state, 'failed');
  assert.deepStrictEqual(stateOf(record, sourceFp(fixture, 'codex')), { state: 'pending', reasonCode: 'needs_resync' });
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('等价候选_不重叠输出的记录_写入期间不受影响', async () => {
  const fixture = makeFixture('no-overlap');
  const store = new SyncStatusStore(fixture.file);
  const rulesTarget = path.join(fixture.target, '.cursor', 'rules');
  const rulesKey: SyncUnitKey = {
    libraryRoot: fixture.libA,
    targetRoot: fixture.target,
    tool: 'cursor',
    module: 'rules',
    scope: 'project',
  };
  await store.beginWrite({
    key: rulesKey,
    outputKeys: [rulesTarget],
    operationId: 'op-rules',
    keyId: KEY_ID,
    startedAt: STARTED_AT,
    effectiveOutputFingerprint: null,
  });
  await store.commitSuccess({
    key: rulesKey,
    operationId: 'op-rules',
    keyId: KEY_ID,
    sourceFingerprint: 'fp-rules-baseline',
    effectiveOutputFingerprint: null,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    candidates: [],
  });

  await begin(store, fixture, 'codex');
  const rules = await store.get(rulesKey);
  assert.strictEqual(rules?.needsResync, false, '不重叠输出的既有成功不被共享写入误伤');
  assert.strictEqual(rules?.lastAttempt?.state, 'succeeded');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('resolveVersionState_密钥身份问题_优先于指纹相等判定', () => {
  const fixture = makeFixture('reducer');
  const record: SyncRecord = {
    key: unitKey(fixture, 'codex'),
    outputKeys: [fixture.skillsDir],
    needsResync: false,
    lastSuccess: {
      fingerprintVersion: 1,
      keyId: KEY_ID,
      sourceFingerprint: 'fp-1',
      effectiveOutputFingerprint: fixture.planA,
      completedAt: COMPLETED_AT,
    },
  };

  assert.deepStrictEqual(stateOf(record, 'fp-1'), { state: 'current' });
  assert.deepStrictEqual(stateOf(record, 'fp-1', 'key_changed'), { state: 'unknown', reasonCode: 'key_changed' });
  assert.deepStrictEqual(stateOf(record, 'fp-1', 'key_missing'), { state: 'unknown', reasonCode: 'key_missing' });
  assert.deepStrictEqual(stateOf(record, 'fp-1', 'key_invalid'), { state: 'unknown', reasonCode: 'key_invalid' });

  const pending: SyncRecord = { ...record, needsResync: true };
  assert.deepStrictEqual(stateOf(pending, 'fp-1'), { state: 'pending', reasonCode: 'needs_resync' });
  assert.deepStrictEqual(stateOf(record, 'fp-2'), { state: 'pending', reasonCode: 'source_changed' });
  assert.deepStrictEqual(stateOf(record, null), { state: 'unknown', reasonCode: 'source_unreadable' });
  assert.strictEqual(stateOf(undefined, null).state, 'untracked', '无记录不因密钥缺失误报 unknown');
  assert.deepStrictEqual(stateOf(record, null, 'key_missing').state, 'unknown');

  const noBaseline: SyncRecord = { ...record, lastSuccess: undefined };
  assert.strictEqual(stateOf(noBaseline, null, 'key_missing').state, 'untracked', '没有基线时是未记录，不是密钥故障');

  assert.deepStrictEqual(stateOf(record, 'fp-1'), { state: 'current' });
  const disabled = resolveVersionState({ applicability: 'disabled', record, currentSourceFingerprint: 'fp-1' });
  assert.strictEqual(disabled.state, 'disabled');
  const unsupported = resolveVersionState({ applicability: 'unsupported', record, currentSourceFingerprint: 'fp-1' });
  assert.strictEqual(unsupported.state, 'unsupported');
  rmSync(fixture.dir, { recursive: true, force: true });
});

test('keyProblemFor_密钥一致_无问题；原位换密钥_key_changed', () => {
  assert.strictEqual(keyProblemFor(KEY_ID, KEY_ID, 'ok'), null);
  assert.strictEqual(keyProblemFor(KEY_ID, OTHER_KEY_ID, 'ok'), 'key_changed');
  assert.strictEqual(keyProblemFor(undefined, KEY_ID, 'ok'), null);
  assert.strictEqual(keyProblemFor(KEY_ID, null, 'ok'), 'key_invalid');
  assert.strictEqual(keyProblemFor(undefined, null, 'missing'), 'key_missing');
  assert.strictEqual(keyProblemFor(KEY_ID, KEY_ID, 'invalid'), 'key_invalid');
});
