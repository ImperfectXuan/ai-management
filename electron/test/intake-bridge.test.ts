// electron/test/intake-bridge.test.ts
// Desktop 桥接层的端到端验证：用真实 CLI 引擎在临时夹具上走完整收编闭环。
// 覆盖 AC-001-01、AC-001-02、AC-001-08、AC-001-12、AC-001-13、AC-001-19 的 UI 侧路径。
import { test, after } from 'node:test';
import assert from 'node:assert';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  intakeApply,
  intakeCompare,
  intakeListBatches,
  intakePlan,
  intakeReadBatch,
  intakeRollback,
  intakeScan,
} from '../src/core/intake-bridge';
import { ACTION_LABELS, type Candidate, type CandidateSet } from '../src/shared/intake-types';
import { cleanupSandbox, isolateHome, makeRepo, makeSource, sandbox, sha256Tree, sourcesOf } from './intake-fixtures';

const originalHome = process.env.HOME;
isolateHome();

after(async () => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  await cleanupSandbox();
});

const pick = (set: CandidateSet, name: string): Candidate => {
  const found = set.candidates.find((c) => c.names.includes(name) || c.display_name === name);
  assert.ok(found, `未找到候选 ${name}`);
  return found;
};

/** 为所有候选给出动作：指定项用给定动作，风险项用 ignore，其余 add */
function decisionsForAll(set: CandidateSet, overrides: Record<string, 'add' | 'update' | 'link' | 'variant' | 'ignore' | 'defer'>) {
  return set.candidates.map((c) => ({
    candidate_id: c.candidate_id,
    kind: overrides[c.candidate_id]
      ?? (c.labels.includes('conflict') || c.labels.includes('unparseable') ? 'ignore' as const : 'add' as const),
  }));
}

test('AC-001-01/02：多来源（含未初始化与不存在路径）扫描，源目录保持不变', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('a-');
  const srcB = await makeSource('b-');
  const missing = path.join(sandbox, 'does-not-exist');

  const beforeA = await sha256Tree(srcA);
  const beforeB = await sha256Tree(srcB);

  const batch = await intakeScan({ repoPath: repo, sources: sourcesOf(srcA, srcB, [missing]) });

  assert.strictEqual(batch.cancelled, false);
  assert.strictEqual(batch.sources.length, 3);
  const missingSource = batch.sources.find((s) => s.source_root === missing);
  assert.ok(missingSource, '应记录不存在的来源');
  assert.strictEqual(missingSource?.status, 'missing');
  assert.ok(batch.errors.some((e) => e.message === 'source_root_not_found'), '应报告来源缺失');

  assert.ok(batch.occurrences.some((o) => o.asset_type === 'rule' && o.original_name === 'newrule'));
  assert.ok(batch.occurrences.some((o) => o.asset_type === 'skill' && o.original_name === 'new-skill'));
  assert.ok(batch.occurrences.some((o) => o.asset_type === 'mcp'));

  // 只读：来源内容与结构未变
  assert.strictEqual(await sha256Tree(srcA), beforeA);
  assert.strictEqual(await sha256Tree(srcB), beforeB);
  // 来源无需初始化 AI Workspace
  await assert.rejects(fsp.access(path.join(srcA, '.ai-workspace')));
});

test('AC-001-08/12：比较→人工计划→入库，未处理冲突被阻断', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('c-');
  const srcB = await makeSource('d-');
  const batch = await intakeScan({ repoPath: repo, sources: sourcesOf(srcA, srcB) });
  const set = await intakeCompare(repo, batch.batch_id);

  // 分类：总库已有的 00-core 被改成不同内容 → 冲突；新规则 → 新增；缺 SKILL.md → 无法解析
  assert.ok(set.candidates.length >= 4, `候选数量应 >=4，实际 ${set.candidates.length}`);
  assert.ok(pick(set, 'newrule').labels.includes('new'));
  assert.ok(pick(set, '00-core').labels.includes('conflict'));
  assert.ok(pick(set, 'broken-skill').labels.includes('unparseable'));

  // 未处理冲突：只给非风险项动作 → 计划里 unresolved 非空，且 apply 被拒绝
  const partial = set.candidates
    .filter((c) => !c.labels.includes('conflict') && !c.labels.includes('unparseable'))
    .map((c) => ({ candidate_id: c.candidate_id, kind: 'add' as const }));
  const partialPlan = await intakePlan({ repoPath: repo, batchId: batch.batch_id, decisions: partial });
  assert.ok(partialPlan.unresolved.length >= 2, '冲突与无法解析项应进入 unresolved');

  // 引擎在 unresolved 非空时拒绝执行（无任何写入）；桥接把拒绝原因带回 UI
  await assert.rejects(
    intakeApply({ repoPath: repo, planId: partialPlan.plan_id }),
    (e: Error) => /未处理/.test(e.message)
  );
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'assets', 'registry.json')));

  // 无法解析项不能被写动作批准
  await assert.rejects(
    intakePlan({
      repoPath: repo,
      batchId: batch.batch_id,
      decisions: [{ candidate_id: pick(set, 'broken-skill').candidate_id, kind: 'add' }],
    }),
    /unparseable|无法/
  );

  // 全部候选都给出明确动作 → 计划无未处理项，入库成功
  const plan = await intakePlan({
    repoPath: repo,
    batchId: batch.batch_id,
    decisions: decisionsForAll(set, { [pick(set, '00-core').candidate_id]: 'update' }),
  });
  assert.strictEqual(plan.unresolved.length, 0);
  assert.ok(plan.actions.some((a) => a.kind === 'update'));
  assert.ok(plan.actions.some((a) => a.kind === 'add'));
  assert.ok(plan.actions.some((a) => a.kind === 'ignore'));

  const applied = await intakeApply({ repoPath: repo, planId: plan.plan_id });
  assert.strictEqual(applied.status, 'ok');
  assert.deepStrictEqual(applied.stages.map((s) => s.status), ['ok', 'ok', 'ok', 'ok']);

  // 入库落盘：规范源、版本、来源、mapping
  const newRule = path.join(repo, '.ai-workspace', 'rules', 'domains', 'newrule.md');
  assert.ok((await fsp.stat(newRule)).isFile());
  assert.ok((await fsp.stat(path.join(repo, '.ai-workspace', 'skills', 'new-skill', 'SKILL.md'))).isFile());
  const registry = JSON.parse(await fsp.readFile(path.join(repo, '.ai-workspace', 'assets', 'registry.json'), 'utf8'));
  assert.ok(Object.keys(registry.assets).length >= 3);
  const coreAsset = Object.values(registry.assets).find((a: any) => a.canonical_path.endsWith('rules/00-core.md')) as any;
  assert.strictEqual(coreAsset.current_version, 2, '更新应先补初始版本再建新版本');
  assert.strictEqual(coreAsset.versions[0].kind, 'backfill');
  assert.strictEqual(coreAsset.sources.length, 1);
  const mapping = await fsp.readFile(path.join(repo, '.ai-workspace', 'adapters', 'cursor', 'mapping.yaml'), 'utf8');
  assert.ok(mapping.includes('rules/domains/newrule.md'), '新规则必须登记 mapping，否则 sync 会丢弃');

  // 重复执行不新增内容
  const again = await intakeApply({ repoPath: repo, planId: plan.plan_id });
  assert.strictEqual(again.status, 'already_applied');
  const registry2 = JSON.parse(await fsp.readFile(path.join(repo, '.ai-workspace', 'assets', 'registry.json'), 'utf8'));
  assert.strictEqual(registry2.assets[coreAsset.asset_id].versions.length, 2);
});

test('AC-001-13：计划过期后拒绝入库，且不写入任何内容', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('e-');
  const srcB = await makeSource('f-');
  const batch = await intakeScan({ repoPath: repo, sources: sourcesOf(srcA, srcB) });
  const set = await intakeCompare(repo, batch.batch_id);
  const plan = await intakePlan({
    repoPath: repo,
    batchId: batch.batch_id,
    decisions: decisionsForAll(set, {}),
  });

  // 外部把计划改成已过期（计划文件是引擎读取的唯一依据）
  const planFile = path.join(repo, '.ai-workspace', 'intake', 'plans', `${plan.plan_id}.json`);
  const raw = JSON.parse(await fsp.readFile(planFile, 'utf8'));
  raw.expires_at = '2000-01-01T00:00:00Z';
  await fsp.writeFile(planFile, JSON.stringify(raw));

  await assert.rejects(
    intakeApply({ repoPath: repo, planId: plan.plan_id }),
    (e: Error) => /过期/.test(e.message)
  );
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'rules', 'domains', 'newrule.md')));
});

test('AC-001-19：取消不批准任何资产；执行结果分阶段汇报', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('g-');
  const srcB = await makeSource('h-');

  // 调用前已取消：明确抛取消错误
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    intakeScan({ repoPath: repo, sources: sourcesOf(srcA, srcB), signal: pre.signal }),
    (e: Error & { code?: string }) => e.code === 'IntakeCancelled' || /取消/.test(e.message)
  );

  // 扫描中途取消：无论走哪条路径，都不得批准任何资产
  const mid = new AbortController();
  await intakeScan({
    repoPath: repo,
    sources: sourcesOf(srcA, srcB),
    signal: mid.signal,
    onProgress: () => { if (!mid.signal.aborted) mid.abort(); },
  }).catch(() => undefined);
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'assets')));
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'rules', 'domains', 'newrule.md')));
});

test('记录与回退：批次可回读，回退只作用于本批次', async () => {
  const repo = await makeRepo();
  const srcA = await makeSource('i-');
  const srcB = await makeSource('j-');
  const batch = await intakeScan({ repoPath: repo, sources: sourcesOf(srcA, srcB) });
  const set = await intakeCompare(repo, batch.batch_id);

  // 本地记录可回读（UI 的「来源详情」与批次历史都依赖它）
  const stored = await intakeReadBatch(repo, batch.batch_id);
  assert.strictEqual(stored.scan.batch_id, batch.batch_id);
  assert.strictEqual(stored.candidates?.candidates.length, set.candidates.length);
  assert.ok((await intakeListBatches(repo)).includes(batch.batch_id));

  const plan = await intakePlan({
    repoPath: repo,
    batchId: batch.batch_id,
    decisions: decisionsForAll(set, { [pick(set, '00-core').candidate_id]: 'update' }),
  });
  const applied = await intakeApply({ repoPath: repo, planId: plan.plan_id });
  assert.ok(applied.files.some((f) => f.rel.endsWith('rules/domains/newrule.md')));

  const rolled = await intakeRollback(repo, applied.apply_id);
  assert.strictEqual(rolled.rollback?.status, 'rolled_back');
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'rules', 'domains', 'newrule.md')));
  const core = await fsp.readFile(path.join(repo, '.ai-workspace', 'rules', '00-core.md'), 'utf8');
  assert.ok(core.includes('原文。'), '回退应还原被覆盖的既有规则');
  await assert.rejects(fsp.access(path.join(repo, '.ai-workspace', 'assets', 'registry.json')));
});

test('动作标签与共享契约一致（Desktop 与 CLI 不各写一套）', () => {
  assert.deepStrictEqual(Object.keys(ACTION_LABELS).sort(), ['add', 'defer', 'ignore', 'link', 'update', 'variant']);
});
