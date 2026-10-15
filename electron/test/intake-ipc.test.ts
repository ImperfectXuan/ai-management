// electron/test/intake-ipc.test.ts
// IPC 处理器层的集成验证：入参校验、总库/来源校验相互独立、进度广播、取消通道，
// 以及 scan→compare→plan→apply→status→rollback 的完整链路（真实 CLI 引擎 + 临时夹具）。
import { test, after, before } from 'node:test';
import assert from 'node:assert';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { IPC } from '../src/shared/ipc';
import { ErrorCodes } from '../src/core/errors';
import { registerIntakeIpc, type Broadcaster, type IpcRegistrar } from '../src/main/intake-ipc';
import type { CandidateSet, ReviewPlan, ScanBatch } from '../src/shared/intake-types';
import { cleanupSandbox, isolateHome, makeRepo, makeSource, sourcesOf } from './intake-fixtures';

const originalHome = process.env.HOME;
isolateHome();

after(async () => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  await cleanupSandbox();
});

const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
const events: Array<{ channel: string; payload: unknown }> = [];

before(() => {
  const register: IpcRegistrar = {
    handle<TArgs, TResult>(channel: string, fn: (args: TArgs) => Promise<TResult>) {
      handlers.set(channel, fn as unknown as (a: unknown) => Promise<unknown>);
    },
  };
  const broadcast: Broadcaster = (channel, payload) => { events.push({ channel, payload }); };
  registerIntakeIpc(register, broadcast);
});

const call = <T>(channel: string, args: unknown): Promise<T> =>
  handlers.get(channel)!(args) as Promise<T>;

test('IPC 边界校验入参：非法 tool / 缺少来源 / 缺 planId', async () => {
  await assert.rejects(
    call(IPC.IntakeScan, { repoPath: '/repo', sources: [{ path: '/s', tool: 'vscode' }] }),
    (e: any) => e.code === ErrorCodes.UnsupportedTool
  );
  await assert.rejects(
    call(IPC.IntakeScan, { repoPath: '/repo', sources: [] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
  await assert.rejects(
    call(IPC.IntakeApply, { repoPath: '/repo' }),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
  await assert.rejects(
    call(IPC.IntakePlan, { repoPath: '/repo', batchId: 'b', decisions: [{ candidate_id: 'c', kind: 'replace' }] }),
    (e: any) => /kind 必须是/.test(e.message)
  );
});

test('总库与来源校验相互独立：来源目录不能当总库，但来源无需初始化', async () => {
  const srcOnly = await makeSource('ipc-src-');
  // 源目录没有 .ai-workspace，作为总库应被拒绝
  await assert.rejects(
    call(IPC.IntakeScan, { repoPath: srcOnly, sources: [{ path: srcOnly }] }),
    (e: any) => e.code === ErrorCodes.AiwsNotInstalled
  );
  await assert.rejects(fsp.access(path.join(srcOnly, '.ai-workspace')));
});

test('AC-001-01：工具全局来源与手动来源经 IPC 一并扫描', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('ipc-global-');
  const home = process.env.HOME ?? '';

  // 工具全局配置（HOME 已隔离到临时目录，不触碰真实 ~/.cursor）
  await fsp.mkdir(path.join(home, '.cursor', 'rules'), { recursive: true });
  await fsp.writeFile(
    path.join(home, '.cursor', 'rules', 'global-rule.mdc'),
    '---\ndescription: Global rule\nglobs: "**/*"\nalwaysApply: true\n---\n# Global Rule\n'
  );

  const batch = await call<ScanBatch>(IPC.IntakeScan, {
    repoPath: repo,
    sources: [
      { path: srcA, tool: 'cursor', scope: 'project' },
      { path: home, tool: 'cursor', scope: 'global' },
    ],
    manualFiles: [],
    manualSkills: [path.join(srcA, '.cursor', 'skills', 'new-skill')],
  });

  assert.ok(batch.occurrences.some((o) => o.scope === 'global' && o.original_name === 'global-rule'),
    '应扫描到工具全局规则');
  assert.ok(batch.occurrences.some((o) => o.tool === 'manual'), '应扫描到手动补充的 Skill');
  assert.ok(batch.sources.some((s) => s.scope === 'global'), '来源清单应区分 scope');
});

test('完整链路：scan → compare → plan → apply → status → rollback', async () => {
  events.length = 0; // 只观测本次链路产生的广播
  const repo = await makeRepo();
  const srcA = await makeSource('ipc-a-');
  const srcB = await makeSource('ipc-b-');
  const missing = path.join(path.dirname(srcA), 'nope');

  const batch = await call<ScanBatch>(IPC.IntakeScan, {
    repoPath: repo,
    sources: sourcesOf(srcA, srcB, [missing]),
  });
  assert.strictEqual(batch.sources.length, 3);
  assert.strictEqual(batch.sources.find((s) => s.source_root === missing)?.status, 'missing');
  // 进度通过 IntakeProgress 广播给渲染进程
  assert.ok(events.some((e) => e.channel === IPC.IntakeProgress));
  assert.ok(events.every((e) => (e.payload as { repoPath: string }).repoPath === repo));

  const set = await call<CandidateSet>(IPC.IntakeCompare, { repoPath: repo, batchId: batch.batch_id });
  assert.ok(set.candidates.length >= 4);

  const decisions = set.candidates.map((c) => ({
    candidate_id: c.candidate_id,
    kind: (c.labels.includes('conflict') || c.labels.includes('unparseable') ? 'ignore' : 'add') as 'add' | 'ignore',
  }));
  const plan = await call<ReviewPlan>(IPC.IntakePlan, { repoPath: repo, batchId: batch.batch_id, decisions });
  assert.strictEqual(plan.unresolved.length, 0);

  const applied = await call<{ status: string; created_assets: string[] }>(IPC.IntakeApply, { repoPath: repo, planId: plan.plan_id });
  assert.strictEqual(applied.status, 'ok');
  assert.ok(applied.created_assets.length >= 2);
  assert.ok((await fsp.stat(path.join(repo, '.ai-workspace', 'rules', 'domains', 'newrule.md'))).isFile());

  // 批次记录与执行记录可回读（UI 的来源详情 / 入库记录）
  const stored = await call<{ scan: ScanBatch; candidates: CandidateSet | null }>(IPC.IntakeGetBatch, {
    repoPath: repo,
    batchId: batch.batch_id,
  });
  assert.strictEqual(stored.scan.batch_id, batch.batch_id);
  assert.ok(stored.candidates);

  const status = await call<{ apply_history: Array<{ apply_id: string; status: string }> }>(IPC.IntakeStatus, {
    repoPath: repo,
    batchId: batch.batch_id,
  });
  assert.strictEqual(status.apply_history[0].status, 'ok');

  const batches = await call<string[]>(IPC.IntakeListBatches, { repoPath: repo });
  assert.ok(batches.includes(batch.batch_id));

  const rolled = await call<{ rollback: { status: string } }>(IPC.IntakeRollback, {
    repoPath: repo,
    applyId: status.apply_history[0].apply_id,
  });
  assert.strictEqual(rolled.rollback.status, 'rolled_back');
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'rules', 'domains', 'newrule.md')));
});

test('取消：空闲时报告未取消；运行中可中断且不批准资产', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('ipc-c-');

  const idle = await call<{ cancelled: boolean }>(IPC.IntakeCancel, { repoPath: repo });
  assert.strictEqual(idle.cancelled, false);

  // 扫描挂起时取消：不产生任何入库副作用
  let cancelled: { cancelled: boolean } | null = null;
  const scanPromise = call<ScanBatch>(IPC.IntakeScan, { repoPath: repo, sources: [{ path: srcA, tool: 'cursor', scope: 'project' }] })
    .then((b) => b)
    .catch(() => null);
  await new Promise((r) => setTimeout(r, 150));
  cancelled = await call<{ cancelled: boolean }>(IPC.IntakeCancel, { repoPath: repo });
  await scanPromise;
  assert.strictEqual(cancelled.cancelled, true);
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'assets')));
});

test('AC-001-12：目标选择经 IPC→CLI 生效，登记后资产 ID 稳定', async () => {
  const repo = await makeRepo();
  const src = await makeSource('ipc-target-');
  const sources = [{ path: src, tool: 'cursor' as const, scope: 'project' as const }];

  const batch = await call<ScanBatch>(IPC.IntakeScan, { repoPath: repo, sources });
  const set = await call<CandidateSet>(IPC.IntakeCompare, { repoPath: repo, batchId: batch.batch_id });
  assert.ok(set.repo_asset_list.length > 0, 'compare 必须给出可选目标清单');

  const core = set.candidates.find((c) => c.names.includes('00-core'));
  assert.ok(core, '应扫到 00-core 候选');
  const target = set.repo_asset_list.find((a) => a.type === 'rule' && a.name === '00-core');
  assert.ok(target, '总库既有 00-core 应出现在目标清单里');

  // 不存在的目标：计划被拒绝，不生成任何动作
  await assert.rejects(
    call(IPC.IntakePlan, {
      repoPath: repo, batchId: batch.batch_id,
      decisions: [{ candidate_id: core.candidate_id, kind: 'update', target_asset_id: 'asset-does-not-exist' }],
    })
  );

  // 显式目标：动作里带上真实目标
  const decisions = set.candidates.map((c) =>
    c.candidate_id === core.candidate_id
      ? { candidate_id: c.candidate_id, kind: 'update' as const, target_asset_id: target.asset_id }
      : { candidate_id: c.candidate_id, kind: 'add' as const }
  );
  const plan = await call<ReviewPlan>(IPC.IntakePlan, { repoPath: repo, batchId: batch.batch_id, decisions });
  const act = plan.actions.find((a) => a.candidate_id === core.candidate_id);
  assert.strictEqual(act?.target_asset_id, target.asset_id, 'UI 选定的目标必须出现在计划动作里');

  const applied = await call<{ status: string; created_assets: string[] }>(IPC.IntakeApply, {
    repoPath: repo, planId: plan.plan_id,
  });
  assert.strictEqual(applied.status, 'ok');
  assert.ok(applied.created_assets.includes(target.asset_id), '首次纳管应沿用所选目标的 ID');

  // 只给总库即可查询历史（Desktops 的入库记录与回退入口依赖这一点）
  const status = await call<{ apply_history: Array<{ apply_id: string; status: string }> }>(
    IPC.IntakeStatus, { repoPath: repo }
  );
  assert.strictEqual(status.apply_history.length, 1);
  assert.strictEqual(status.apply_history[0].status, 'ok');

  // 来源再变一次：候选仍指向同一个资产 ID（内容指纹不参与重新生成 ID）
  await fsp.writeFile(path.join(src, '.cursor', 'rules', '00-core.mdc'),
    '---\nid: 00-core\ntitle: 核心原则\nglobs: "**/*.ts"\n---\n# 核心原则\n\n第二次改动。\n');
  const batch2 = await call<ScanBatch>(IPC.IntakeScan, { repoPath: repo, sources });
  const set2 = await call<CandidateSet>(IPC.IntakeCompare, { repoPath: repo, batchId: batch2.batch_id });
  const core2 = set2.candidates.find((c) => c.names.includes('00-core'));
  assert.strictEqual(core2?.existing_asset_id, target.asset_id, '登记后的目标必须是 registry 里的稳定 ID');

  const plan2 = await call<ReviewPlan>(IPC.IntakePlan, {
    repoPath: repo, batchId: batch2.batch_id,
    decisions: set2.candidates.map((c) =>
      c.candidate_id === core2?.candidate_id
        ? { candidate_id: c.candidate_id, kind: 'update' as const, target_asset_id: target.asset_id }
        : { candidate_id: c.candidate_id, kind: 'add' as const }
    ),
  });
  const applied2 = await call<{ status: string }>(IPC.IntakeApply, { repoPath: repo, planId: plan2.plan_id });
  assert.strictEqual(applied2.status, 'ok');

  const reg = JSON.parse(await fsp.readFile(path.join(repo, '.ai-workspace', 'assets', 'registry.json'), 'utf8'));
  assert.strictEqual(Object.keys(reg.assets).filter((k) => reg.assets[k].type === 'rule' && reg.assets[k].name === '00-core').length, 1);
  // 首次纳管补 v1（既有规范源），两次更新各加一版：版本连续且只有一个资产
  assert.strictEqual(reg.assets[target.asset_id].current_version, 3, '重复更新应产生连续版本而不是新资产');
  assert.deepStrictEqual(
    reg.assets[target.asset_id].versions.map((v: { version: number }) => v.version),
    [1, 2, 3]
  );
  assert.strictEqual(
    Object.values(reg.assets).filter((a: any) => a.canonical_path === '.ai-workspace/rules/00-core.md').length,
    1,
    '同一规范源不能被登记成两个资产'
  );
});
