// electron/test/intake-ui.test.tsx
// 收编向导的 UI 路径：候选分类展示、六种动作、批量确认不绕过冲突、未处理项阻断入库、
// 取消通道，以及 AI 入口保持可解释的未配置状态（不出现假模型结果）。
//
// 注意加载顺序：react-dom 必须在 jsdom 全局就绪之后再加载，否则 React 的事件系统
// 拿不到 jsdom 的 window，受控输入的 onChange 不会触发。因此 testing-library 与页面
// 组件都用懒加载获取（app.test.tsx 只断言渲染文本，未覆盖该问题）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type TL = typeof import('@testing-library/react');
type PageModule = typeof import('../src/renderer/pages/intake');

let tlCache: TL | null = null;
let pageCache: PageModule | null = null;

async function libs(): Promise<TL> {
  if (!tlCache) tlCache = await import('@testing-library/react');
  return tlCache;
}
async function pageModule(): Promise<PageModule> {
  if (!pageCache) pageCache = await import('../src/renderer/pages/intake');
  return pageCache;
}

import type { Candidate, CandidateSet, ReviewPlan, ScanBatch } from '../src/shared/intake-types';

const scanBatch: ScanBatch = {
  schema: 'intake/v1', batch_id: 'batch-1', repo: '/repo',
  started_at: 't0', finished_at: 't1',
  sources: [
    { source_root: '/src-a', tool: 'cursor', scope: 'project', status: 'ok' },
    { source_root: '/gone', tool: 'cursor', scope: 'project', status: 'missing' },
  ],
  occurrences: [], errors: [{ level: 'warn', source: '/gone', path: null, message: 'source_root_not_found' }],
  cancelled: false,
};

function candidate(over: Partial<Candidate> & { candidate_id: string; display_name: string }): Candidate {
  return {
    type: 'rule', names: [over.display_name], content_fingerprint: 'sha256:x',
    cred_fingerprint: null, cred_refs: [], labels: ['new'], occurrences: ['o1'],
    sources: [{
      occurrence_id: 'o1', name: over.display_name, read_status: 'ok', managed: false,
      source: { source_root: '/src-a', tool: 'cursor', scope: 'project', path: `.cursor/rules/${over.display_name}.mdc` },
    }],
    existing_asset_id: null, existing_version: null, existing_source: null,
    diff_summary: { added: [], removed: [], changed: [] },
    behavior_diff: null, credential_diff: null, deferred: false, suppressed: false,
    ...over,
  };
}

const candidateSet: CandidateSet = {
  schema: 'intake/v1', batch_id: 'batch-1', repo: '/repo', compared_at: 't2',
  repo_assets: { rule: 2, skill: 0, mcp: 0 },
  repo_asset_list: [
    { asset_id: 'asset-core', type: 'rule', name: '00-core', path: '.ai-workspace/rules/00-core.md', version: 2, registered: true },
    { asset_id: 'asset-legacy', type: 'rule', name: 'legacy', path: '.ai-workspace/rules/domains/legacy.md', version: null, registered: false },
  ],
  candidates: [
    candidate({ candidate_id: 'c-new', display_name: 'newrule', labels: ['new'] }),
    candidate({
      candidate_id: 'c-conflict', display_name: '00-core', labels: ['conflict'],
      existing_asset_id: 'asset-core', existing_version: 2,
      existing_source: { name: '00-core', path: '.ai-workspace/rules/00-core.md', fingerprint: 'sha256:y' },
      diff_summary: { added: ['来源改过。'], removed: ['原文。'], changed: ['globs'] },
    }),
    candidate({ candidate_id: 'c-broken', display_name: 'broken-skill', labels: ['unparseable'], type: 'skill' }),
  ],
  suppressed: [],
  summary: { new: 1, conflict: 1, unparseable: 1, total: 3 },
  errors: [],
};

let handlers: Record<string, (p?: any) => unknown>;
let invoked: Array<{ channel: string; payload: any }>;

beforeEach(() => {
  invoked = [];
  handlers = {
    'intake:status': () => ({ schema: 'intake/v1', plans: [], apply_history: [] }),
    'intake:scan': () => scanBatch,
    'intake:compare': () => candidateSet,
    'intake:cancel': () => ({ cancelled: true }),
  };
  (globalThis as any).window.api = {
    invoke: async (channel: string, payload?: unknown) => {
      invoked.push({ channel, payload });
      const fn = handlers[channel];
      if (!fn) return { ok: false, code: 'NoHandler', message: `未处理的通道 ${channel}` };
      return { ok: true, data: fn(payload) };
    },
    on: () => () => {},
  };
});

/** 添加一个来源并把扫描按钮变成可点（受控输入需要等待一次 React 刷新） */
async function addSource(q: ReturnType<TL['within']>, dir = '/src-a') {
  const { fireEvent, waitFor } = await libs();
  fireEvent.change(q.getByPlaceholderText('来源目录，如 /Users/me/project'), { target: { value: dir } });
  fireEvent.click(q.getByText('添加来源'));
  await waitFor(() => assert.strictEqual((q.getByText('开始扫描') as HTMLButtonElement).disabled, false));
}

/** 点击详情面板里的动作按钮：按角色定位，避免与列表/摘要里的同名文本混淆 */
async function pickAction(q: ReturnType<TL['within']>, label: string) {
  const { fireEvent } = await libs();
  const btn = q.getAllByRole('button').find((b: HTMLElement) => (b.textContent ?? '').trim() === label);
  assert.ok(btn, `找不到动作按钮 ${label}`);
  fireEvent.click(btn as HTMLElement);
}

async function scanned(): Promise<ReturnType<TL['within']>> {
  const { render, within, fireEvent } = await libs();
  const { IntakePage } = await pageModule();
  const { container } = render(<IntakePage repoPath="/repo" />);
  const q = within(container);
  await addSource(q);
  fireEvent.click(q.getByText('开始扫描'));
  await q.findByText('候选审核');
  return q;
}

test('未扫描时展示总库、来源与 AI 未配置说明', async () => {
  const { render, within } = await libs();
  const { IntakePage } = await pageModule();
  const { container } = render(<IntakePage repoPath="/repo" />);
  const q = within(container);
  assert.ok(q.getByText('总库路径（必须是已初始化的 AI Workspace）'));
  assert.ok(q.getByText('来源项目不需要安装 AI Workspace，也不要求是 git 仓库。'));
  assert.ok(q.getByText(/AI 辅助整理暂未开放/));
});

test('AC-001-01/02：来源可为未初始化目录，扫描结果展示来源与缺失提示', async () => {
  const q = await scanned();
  assert.ok(q.getByText('/src-a'));
  assert.ok(q.getByText(/来源 2 个，记录 0 条，错误 1 条/));
  assert.ok(q.getByText(/source_root_not_found/));
});

test('AC-001-08：候选按标签分类展示，详情含来源表、差异与六种动作', async () => {
  const q = await scanned();
  const { fireEvent } = await libs();

  // 候选名同时出现在列表与详情标题，取列表项（第一个）
  assert.ok(q.getAllByText('newrule').length > 0);
  assert.ok(q.getAllByText('00-core').length > 0);
  assert.ok(q.getAllByText('broken-skill').length > 0);
  assert.ok(q.getAllByText(/冲突/).length > 0);

  // 详情默认是第一个候选；切到冲突项查看差异与来源
  fireEvent.click(q.getAllByText('00-core')[0]);
  await q.findByText('.cursor/rules/00-core.mdc');
  assert.ok(q.getByText(/总库既有：\.ai-workspace\/rules\/00-core\.md/), '应展示总库既有项');
  assert.ok(q.getByText('内容差异'));
  assert.ok(q.getByText(/\+ 来源改过。/));
  assert.ok(q.getByText(/- 原文。/));

  for (const label of ['新增', '关联已有项', '更新原项', '另存变体', '忽略', '暂缓']) {
    assert.ok(q.getAllByText(label).length > 0, `缺少动作按钮 ${label}`);
  }
  assert.ok(q.getByText(/需要你明确选择动作/));
});

test('AC-001-08：批量「全选新增」跳过冲突与无法解析项', async () => {
  const q = await scanned();
  const { fireEvent, waitFor } = await libs();
  fireEvent.click(q.getByText('全选新增（跳过冲突/无法解析）'));
  await waitFor(() => assert.ok(q.getByText(/2 项冲突\/无法解析需要逐项明确选择/)));
  await waitFor(() => assert.ok(q.getByText(/已选：新增/)));
});

test('AC-001-08/13：未处理项存在时禁用「执行入库」；处理后可执行', async () => {
  const q = await scanned();
  const { fireEvent, waitFor } = await libs();

  const base: ReviewPlan = {
    schema: 'intake/v1', plan_id: 'plan-1', batch_id: 'batch-1', repo: '/repo',
    created_at: 't3', expires_at: 't4',
    actions: [{ action_id: 'a1', kind: 'add', candidate_id: 'c-new', asset_type: 'rule', asset_name: 'newrule', target_asset_id: null, source_fingerprint: null, target_version_snapshot: null, write_path: '.ai-workspace/rules/domains/newrule.md', resolved: true }],
    unresolved: ['c-conflict', 'c-broken'], skipped: [], summary: { add: 1, unresolved: 2 },
  };
  handlers['intake:plan'] = () => base;
  fireEvent.click(q.getByText('生成计划'));
  await waitFor(() => assert.ok(q.getByText(/仍有 2 项冲突或无法解析未给出动作/)));
  assert.strictEqual((q.getByText('执行入库') as HTMLButtonElement).disabled, true);
  assert.ok(q.getByText('.ai-workspace/rules/domains/newrule.md'), '新增动作执行前显示共享引擎计算的写入路径');

  handlers['intake:plan'] = () => ({ ...base, unresolved: [], summary: { add: 1 } });
  fireEvent.click(q.getByRole('button', { name: '重新生成计划' }));
  await waitFor(() => assert.strictEqual((q.getByText('执行入库') as HTMLButtonElement).disabled, false));
});

test('入库记录可回退，回退走 IntakeRollback 通道', async () => {
  let hasRolledBack = false;
  handlers['intake:status'] = () => ({
    schema: 'intake/v1', plans: [],
    apply_history: [{ apply_id: 'apply-1', plan_id: 'p', batch_id: 'b', status: 'ok', started_at: 's', finished_at: 'f', applied_actions: 2, failed_actions: 0, rollback: hasRolledBack ? { status: 'rolled_back' } : null }],
  });
  handlers['intake:rollback'] = () => { hasRolledBack = true; return ({
    schema: 'intake/v1', apply_id: 'apply-1', plan_id: 'p', batch_id: 'b', status: 'ok',
    stages: [{ stage: 'preflight', status: 'ok', detail: '' }],
    applied_actions: [], failed_actions: [], files: [], created_assets: [], created_versions: [],
    errors: [], rollback: { status: 'rolled_back', at: 't', restored: ['x'], conflicts: [] },
  }); };

  const q = await scanned();
  const { fireEvent, waitFor } = await libs();
  await waitFor(() => { assert.ok(q.getByText('apply-1'), '挂载时应读取入库记录'); });

  fireEvent.click(q.getByText('回退'));
  await waitFor(() => assert.ok(invoked.some((c) => c.channel === 'intake:rollback')));
  assert.deepStrictEqual(invoked.find((c) => c.channel === 'intake:rollback')?.payload, { repoPath: '/repo', applyId: 'apply-1' });
  await waitFor(() => assert.ok(q.getByText(/执行 apply-1/)));
  await waitFor(() => assert.ok(q.getByText('回退状态：已回退')));
  await waitFor(() => assert.strictEqual((q.getByText('回退') as HTMLButtonElement).disabled, true));
});

test('入库失败后可续跑（--resume）或重新生成计划，动作选择保留', async () => {
  const q = await scanned();
  const { fireEvent, waitFor } = await libs();

  handlers['intake:plan'] = () => ({
    schema: 'intake/v1', plan_id: 'plan-r', batch_id: 'batch-1', repo: '/repo',
    created_at: 't', expires_at: 't2',
    actions: [], unresolved: [], skipped: [], summary: {},
  });
  handlers['intake:apply'] = () => ({
    schema: 'intake/v1', apply_id: 'apply-r', plan_id: 'plan-r', batch_id: 'batch-1',
    status: 'failed',
    stages: [{ stage: 'preflight', status: 'ok', detail: '' }, { stage: 'write_assets', status: 'failed', detail: '' }],
    applied_actions: [], failed_actions: [{ action_id: null, error: 'fault_injected_write_assets' }],
    files: [], created_assets: [], created_versions: [],
    errors: ['fault_injected_write_assets'],
  });

  fireEvent.click(q.getByText('生成计划'));
  await waitFor(() => assert.ok(q.getByText('执行入库')));
  fireEvent.click(q.getByText('执行入库'));
  await waitFor(() => assert.ok(q.getByText(/入库未完成/)));
  assert.ok(q.getByRole('button', { name: '重新生成计划' }), '失败后应引导重审');

  handlers['intake:apply'] = () => ({
    schema: 'intake/v1', apply_id: 'apply-r2', plan_id: 'plan-r', batch_id: 'batch-1',
    status: 'ok', stages: [{ stage: 'preflight', status: 'ok', detail: '' }],
    applied_actions: [], failed_actions: [], files: [], created_assets: [], created_versions: [],
    errors: [], rollback: null,
  });
  fireEvent.click(q.getByText('继续未完成项'));
  await waitFor(() => {
    const call = invoked.filter((c) => c.channel === 'intake:apply').pop();
    assert.deepStrictEqual(call?.payload, { repoPath: '/repo', planId: 'plan-r', resume: true });
  });
});

test('AC-001-19：扫描进行中可取消，取消走 IntakeCancel 通道', async () => {
  const { render, within, fireEvent, waitFor } = await libs();
  handlers['intake:scan'] = () => new Promise(() => undefined);
  const { IntakePage } = await pageModule();
  const { container } = render(<IntakePage repoPath="/repo" />);
  const q = within(container);

  assert.strictEqual(q.queryByRole('button', { name: '取消' }), null, '空闲时不显示取消');
  await addSource(q);
  fireEvent.click(q.getByText('开始扫描'));
  await waitFor(() => assert.strictEqual((q.getByText('取消') as HTMLButtonElement).disabled, false));

  fireEvent.click(q.getByText('取消'));
  await waitFor(() => assert.ok(invoked.some((c) => c.channel === 'intake:cancel')));
  assert.deepStrictEqual(invoked.find((c) => c.channel === 'intake:cancel')?.payload, { repoPath: '/repo' });
});

test('扫描一次即串联 scan + compare', async () => {
  await scanned();
  assert.deepStrictEqual(
    invoked.filter((c) => c.channel.startsWith('intake:')).map((c) => c.channel),
    ['intake:status', 'intake:scan', 'intake:compare']
  );
});

test('需要目标的动作提供实际资产选择，并把 target_asset_id 一路送到计划', async () => {
  const q = await scanned();
  const { fireEvent, waitFor } = await libs();

  // 默认候选没有自动匹配的目标：需要目标时给不出可执行的计划
  await pickAction(q, '新增');
  assert.ok(q.queryByText(/目标资产/) === null, '「新增」不需要目标');

  fireEvent.click(q.getAllByText('00-core')[0]);
  await pickAction(q, '更新原项');
  const picker = await q.findByText(/目标资产/);
  assert.ok(picker, '选择需要目标的动作后应出现目标选择');
  // 页面上还有来源的 tool/scope 下拉，这里按选项内容定位目标下拉
  const select = q.getAllByRole('combobox')
    .find((el: HTMLElement) => Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'asset-core')) as HTMLSelectElement;
  assert.ok(select, '应存在目标下拉');
  const options = Array.from(select.options).map((o) => o.value);
  assert.ok(options.includes('asset-core'), '应能选到已登记的目标');
  assert.ok(options.includes('asset-legacy'), '应能选到总库既有的未纳管项');
  await waitFor(() => assert.ok(q.getByText(/写入目标：\.ai-workspace\/rules\/00-core\.md/)));

  select.value = 'asset-legacy';
  fireEvent.change(select, { target: { value: 'asset-legacy' } });
  await waitFor(() => assert.ok(q.getByText(/首次纳管，登记为初始版本/)));

  handlers['intake:plan'] = () => ({
    schema: 'intake/v1', plan_id: 'plan-t', batch_id: 'batch-1', repo: '/repo',
    created_at: 't', expires_at: 't2',
    actions: [{ action_id: 'a1', kind: 'update', candidate_id: 'c-conflict', asset_type: 'rule', asset_name: '00-core', target_asset_id: 'asset-legacy', target_path: '.ai-workspace/rules/domains/legacy.md', source_fingerprint: null, target_version_snapshot: null, resolved: true }],
    unresolved: [], skipped: [], summary: { update: 1 },
  });
  fireEvent.click(q.getByText('生成计划'));
  await waitFor(() => assert.ok(q.getByText(/legacy → \.ai-workspace\/rules\/domains\/legacy\.md/)));

  const sent = invoked.filter((c) => c.channel === 'intake:plan').pop()?.payload as any;
  assert.deepStrictEqual(
    sent.decisions.find((d: any) => d.candidate_id === 'c-conflict'),
    { candidate_id: 'c-conflict', kind: 'update', target_asset_id: 'asset-legacy' },
    '选定的目标必须完整经过 UI→IPC，不被校验层丢弃'
  );
});

test('AC-001-13：改变动作或目标后旧计划立即失效，不再可执行', async () => {
  const q = await scanned();
  const { fireEvent, waitFor } = await libs();

  handlers['intake:plan'] = () => ({
    schema: 'intake/v1', plan_id: 'plan-x', batch_id: 'batch-1', repo: '/repo',
    created_at: 't', expires_at: 't2',
    actions: [{ action_id: 'a1', kind: 'add', candidate_id: 'c-new', asset_type: 'rule', asset_name: 'newrule', target_asset_id: null, source_fingerprint: null, target_version_snapshot: null, resolved: true }],
    unresolved: [], skipped: [], summary: { add: 1 },
  });
  await pickAction(q, '新增');
  fireEvent.click(q.getByText('生成计划'));
  await waitFor(() => assert.ok(q.getByText(/计划 plan-x/)));

  // 返回审核修改动作，旧计划必须作废
  fireEvent.click(q.getByRole('button', { name: '返回审核' }));
  fireEvent.click(q.getAllByText('00-core')[0]);
  await pickAction(q, '忽略');
  await waitFor(() => assert.ok(q.queryByText(/计划 plan-x/) === null, '改动作后旧计划必须失效'));
});

test('入库记录读取失败时显式报错，不伪装成没有记录', async () => {
  handlers['intake:status'] = () => { throw new Error('jq 执行失败'); };
  const { render, within, waitFor } = await libs();
  const { IntakePage } = await pageModule();
  const { container } = render(<IntakePage repoPath="/repo" />);
  const q = within(container);

  await waitFor(() => assert.ok(q.getByText(/读取入库记录失败/)));
  assert.ok(q.queryByText('暂无入库记录') === null, '失败不能显示成空历史');
});


test('分步收编仅展示当前阶段，变更来源后旧审核与计划失效', async () => {
  const q = await scanned();
  const { fireEvent, waitFor } = await libs();
  const steps = q.getByRole('navigation', { name: '收编步骤' });
  assert.equal(steps.querySelector('[aria-current="step"]')?.textContent, '2审核候选');
  assert.equal(q.queryByRole('button', { name: '开始扫描' }), null);

  fireEvent.click(q.getByRole('button', { name: '1 选择来源' }));
  assert.ok(q.getByRole('button', { name: '开始扫描' }));
  assert.equal(q.queryByRole('button', { name: '生成计划' }), null);
  fireEvent.click(q.getByRole('button', { name: '清空', exact: true }));

  await waitFor(() => assert.equal((q.getByRole('button', { name: '2 审核候选' }) as HTMLButtonElement).disabled, true));
  assert.equal(q.queryByText('newrule'), null);
});
