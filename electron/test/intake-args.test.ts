// electron/test/intake-args.test.ts
// IPC 收编通道的入参校验：系统边界必须快速失败。
import { test } from 'node:test';
import assert from 'node:assert';
import {
  validateIntakeApplyArgs,
  validateIntakePlanArgs,
  validateIntakeRollbackArgs,
  validateIntakeScanArgs,
  validateIntakeStatusArgs,
} from '../src/main/intake-args';
import { ErrorCodes } from '../src/core/errors';

const scanValid = { repoPath: '/repo', sources: [{ path: '/src', tool: 'cursor', scope: 'project' }] };

test('IntakeScan 合法入参归一化（缺省 tool/scope 补默认）', () => {
  const out = validateIntakeScanArgs({ repoPath: '/repo', sources: [{ path: '/src' }] });
  assert.strictEqual(out.repoPath, '/repo');
  assert.deepStrictEqual(out.sources, [{ path: '/src', tool: 'auto', scope: 'project' }]);
  assert.deepStrictEqual(out.manualFiles, []);
  assert.deepStrictEqual(out.manualSkills, []);
});

test('IntakeScan 允许只有手动来源', () => {
  const out = validateIntakeScanArgs({ repoPath: '/repo', manualFiles: ['/f.md'] });
  assert.deepStrictEqual(out.manualFiles, ['/f.md']);
});

test('IntakeScan 无任何来源抛 InvalidArgument', () => {
  assert.throws(
    () => validateIntakeScanArgs({ repoPath: '/repo', sources: [] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /至少需要一个来源/.test(e.message)
  );
});

test('IntakeScan 非法 tool / scope / 路径类型被拒绝', () => {
  assert.throws(
    () => validateIntakeScanArgs({ ...scanValid, sources: [{ path: '/s', tool: 'vscode' }] }),
    (e: any) => e.code === ErrorCodes.UnsupportedTool
  );
  assert.throws(
    () => validateIntakeScanArgs({ ...scanValid, sources: [{ path: '/s', scope: 'machine' }] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
  assert.throws(
    () => validateIntakeScanArgs({ ...scanValid, sources: [{ path: 42 }] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
});

test('IntakeScan 非对象 / 缺 repoPath 抛 InvalidArgument', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.throws(() => validateIntakeScanArgs(bad), (e: any) => e.code === ErrorCodes.InvalidArgument);
  }
  assert.throws(() => validateIntakeScanArgs({ sources: [] }), (e: any) => /repoPath/.test(e.message));
});

test('IntakePlan 校验动作枚举与必填字段', () => {
  const ok = validateIntakePlanArgs({
    repoPath: '/repo', batchId: 'b1',
    decisions: [{ candidate_id: 'c1', kind: 'variant' }],
  });
  assert.strictEqual(ok.decisions[0].kind, 'variant');

  assert.throws(
    () => validateIntakePlanArgs({ repoPath: '/repo', batchId: 'b1', decisions: [{ candidate_id: 'c1', kind: 'replace' }] }),
    (e: any) => /kind 必须是/.test(e.message)
  );
  assert.throws(
    () => validateIntakePlanArgs({ repoPath: '/repo', batchId: 'b1', decisions: [{ kind: 'add' }] }),
    (e: any) => /candidate_id/.test(e.message)
  );
  assert.throws(
    () => validateIntakePlanArgs({ repoPath: '/repo', batchId: 'b1', decisions: 'all' }),
    (e: any) => /decisions 必须是数组/.test(e.message)
  );
});

test('IntakeApply / Rollback / Status 的必填校验', () => {
  assert.deepStrictEqual(validateIntakeApplyArgs({ repoPath: '/r', planId: 'p1' }), { repoPath: '/r', planId: 'p1', resume: false });
  assert.strictEqual(validateIntakeApplyArgs({ repoPath: '/r', planId: 'p1', resume: true }).resume, true);
  assert.throws(() => validateIntakeApplyArgs({ repoPath: '/r', planId: 'p1', resume: 'yes' }), (e: any) => e.code === ErrorCodes.InvalidArgument);
  assert.throws(() => validateIntakeApplyArgs({ repoPath: '/r' }), (e: any) => /planId/.test(e.message));

  assert.deepStrictEqual(validateIntakeRollbackArgs({ repoPath: '/r', applyId: 'a1' }), { repoPath: '/r', applyId: 'a1' });
  assert.throws(() => validateIntakeRollbackArgs({ repoPath: '/r' }), (e: any) => /applyId/.test(e.message));

  assert.deepStrictEqual(validateIntakeStatusArgs({ repoPath: '/r', planId: 'p1' }), { repoPath: '/r', planId: 'p1', batchId: undefined });
  // planId/batchId 是可选的过滤条件：只给总库即「查询全部历史」，见下一个用例
  assert.deepStrictEqual(validateIntakeStatusArgs({ repoPath: '/r' }), { repoPath: '/r', planId: undefined, batchId: undefined });
});

test('IntakeStatus：planId/batchId 是可选的过滤条件，只给 repoPath 表示查询总库全部历史', () => {
  const out = validateIntakeStatusArgs({ repoPath: '/repo' });
  assert.deepStrictEqual(out, { repoPath: '/repo', planId: undefined, batchId: undefined });
  assert.deepStrictEqual(validateIntakeStatusArgs({ repoPath: '/repo', planId: 'p1' }).planId, 'p1');
  assert.throws(
    () => validateIntakeStatusArgs({ repoPath: '/repo', planId: 42 }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /planId/.test(e.message)
  );
  assert.throws(() => validateIntakeStatusArgs({}), (e: any) => e.code === ErrorCodes.InvalidArgument);
});

test('IntakePlan：需要目标的动作必须携带非空 target_asset_id，且参数不被校验层丢弃', () => {
  const out = validateIntakePlanArgs({
    repoPath: '/repo', batchId: 'b1',
    decisions: [
      { candidate_id: 'c1', kind: 'update', target_asset_id: 'asset-abc' },
      { candidate_id: 'c2', kind: 'add' },
    ],
  });
  assert.deepStrictEqual(out.decisions, [
    { candidate_id: 'c1', kind: 'update', target_asset_id: 'asset-abc' },
    { candidate_id: 'c2', kind: 'add' },
  ]);
});

test('IntakePlan：非法 target_asset_id 与不接收目标的动作被拒绝', () => {
  assert.throws(
    () => validateIntakePlanArgs({ repoPath: '/repo', batchId: 'b1', decisions: [{ candidate_id: 'c1', kind: 'link', target_asset_id: '' }] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /target_asset_id/.test(e.message)
  );
  assert.throws(
    () => validateIntakePlanArgs({ repoPath: '/repo', batchId: 'b1', decisions: [{ candidate_id: 'c1', kind: 'link', target_asset_id: 7 }] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument
  );
  assert.throws(
    () => validateIntakePlanArgs({ repoPath: '/repo', batchId: 'b1', decisions: [{ candidate_id: 'c1', kind: 'add', target_asset_id: 'asset-abc' }] }),
    (e: any) => e.code === ErrorCodes.InvalidArgument && /不接受 target_asset_id/.test(e.message)
  );
});
