// electron/test/sync-status-ui.test.tsx
// 功能 002 TASK-002-06：状态界面路径（AC-002-15）。
// 覆盖：挂载查询、SyncStatusChanged 重查、晚到响应丢弃、切身份后旧结果不覆盖、
// 只展示视图字段（无哈希/路径）、状态与文案独立、重建入口。
//
// 注意加载顺序：react-dom 必须在 jsdom 全局就绪之后再加载（见 intake-ui.test.tsx）。
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
type PanelModule = typeof import('../src/renderer/pages/sync-status-panel');
type HookModule = typeof import('../src/renderer/use-sync-status');

let tlCache: TL | null = null;
let panelCache: PanelModule | null = null;
let hookCache: HookModule | null = null;

async function libs(): Promise<TL> {
  if (!tlCache) tlCache = await import('@testing-library/react');
  return tlCache;
}
async function panelModule(): Promise<PanelModule> {
  if (!panelCache) panelCache = await import('../src/renderer/pages/sync-status-panel');
  return panelCache;
}
async function hookModule(): Promise<HookModule> {
  if (!hookCache) hookCache = await import('../src/renderer/use-sync-status');
  return hookCache;
}

import type { SyncStatusQueryResult } from '../src/shared/sync-status-view';

interface MockApi {
  invocations: Array<{ channel: string; payload: unknown }>;
  listeners: Array<[string, (d: unknown) => void]>;
  setHandler: (channel: string, handler: (payload?: unknown) => unknown | Promise<unknown>) => void;
  emit: (channel: string, data: unknown) => void;
}

function installApi(): MockApi {
  const handlers = new Map<string, (payload?: unknown) => unknown | Promise<unknown>>();
  const invocations: Array<{ channel: string; payload: unknown }> = [];
  const listeners: Array<[string, (d: unknown) => void]> = [];
  (globalThis as any).window.api = {
    invoke: async (channel: string, payload?: unknown) => {
      invocations.push({ channel, payload });
      const handler = handlers.get(channel);
      try {
        const data = handler ? await handler(payload) : [];
        return { ok: true, data };
      } catch (error) {
        return { ok: false, code: 'Error', message: (error as Error).message };
      }
    },
    on: (channel: string, cb: (d: unknown) => void) => {
      listeners.push([channel, cb]);
      return () => {
        const i = listeners.findIndex(([c, fn]) => c === channel && fn === cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return {
    invocations,
    listeners,
    setHandler: (channel, handler) => { handlers.set(channel, handler); },
    emit: (channel, data) => {
      for (const [c, fn] of [...listeners]) if (c === channel) fn(data);
    },
  };
}

function makeStatus(over: Partial<SyncStatusQueryResult> = {}): SyncStatusQueryResult {
  return {
    checkedAt: '2026-10-16T12:00:00.000Z',
    aggregate: {
      state: 'current',
      pendingCount: 0,
      applicableCount: 2,
      summaryText: '已同步当前版本（未检查目标文件）',
    },
    units: [
      {
        tool: 'cursor', module: 'rules', scope: 'project',
        versionState: 'current', attemptState: 'succeeded',
        lastSuccessAt: '2026-10-16T11:00:00.000Z',
      },
      {
        tool: 'codex', module: 'skills', scope: 'project',
        versionState: 'pending', attemptState: 'failed', reasonCode: 'needs_resync',
        lastSuccessAt: '2026-10-16T10:00:00.000Z',
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  installApi();
});

test('面板_展示聚合与单元状态_不含哈希路径_文案固定', async () => {
  const { render, cleanup, within } = await libs();
  const { SyncStatusPanel } = await panelModule();
  const status = makeStatus();
  const { container } = render(
    <SyncStatusPanel status={status} checking={false} error="" onRefresh={() => {}} />,
  );
  const panel = within(container).getByLabelText('同步版本状态');
  assert.ok(within(panel).getAllByText('已同步当前版本（未检查目标文件）').length >= 1);
  assert.ok(within(panel).getByText('Cursor'));
  assert.ok(within(panel).getByText('规则'));
  assert.ok(within(panel).getByText('待同步'));
  assert.ok(within(panel).getByText('需要重新同步'));
  const text = container.textContent ?? '';
  assert.ok(!text.includes('sha256:'), '不展示哈希');
  assert.ok(!text.includes('sourceFingerprint'), '不展示实现字段');
  assert.ok(!text.includes('/tmp/'), '不展示路径');
  cleanup();
});

test('hook_挂载查询_SyncStatusChanged触发重查', async () => {
  const api = installApi();
  const { renderHook, act, cleanup } = await libs();
  const { useSyncStatus } = await hookModule();

  let calls = 0;
  api.setHandler('sync:status-get', () => {
    calls += 1;
    return makeStatus({ checkedAt: `2026-10-16T12:00:0${calls}.000Z` });
  });

  const { result } = await act(async () => renderHook(() => useSyncStatus({ repoId: 'r1', scope: 'project' })));
  await act(async () => { await Promise.resolve(); });
  assert.strictEqual(calls, 1);
  assert.ok(result.current.status);
  assert.strictEqual(result.current.status?.checkedAt, '2026-10-16T12:00:01.000Z');

  await act(async () => {
    api.emit('sync:status-changed', { libraryRoot: '/lib', changedBy: 'rules' });
    await Promise.resolve();
  });
  // 事件回调是 fire-and-forget；等待 microtask 链
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.strictEqual(calls, 2, 'SyncStatusChanged 应触发重查');
  assert.strictEqual(result.current.status?.checkedAt, '2026-10-16T12:00:02.000Z');
  cleanup();
});

test('hook_晚到响应被丢弃_不覆盖新选择', async () => {
  const api = installApi();
  const { renderHook, act, cleanup } = await libs();
  const { useSyncStatus } = await hookModule();

  let resolveFirst: ((value: SyncStatusQueryResult) => void) | null = null;
  let call = 0;
  api.setHandler('sync:status-get', () => {
    call += 1;
    if (call === 1) {
      return new Promise<SyncStatusQueryResult>((resolve) => { resolveFirst = resolve; });
    }
    return makeStatus({ checkedAt: '2026-10-16T12:00:09.000Z', aggregate: {
      state: 'pending', pendingCount: 1, applicableCount: 2, summaryText: '待同步（1 项）',
    }});
  });

  const { result, rerender } = await act(async () => renderHook(
    (props: { repoId: string }) => useSyncStatus({ repoId: props.repoId, scope: 'project' }),
    { initialProps: { repoId: 'repo-a' } },
  ));
  assert.strictEqual(call, 1);

  // 切换身份，发出第二次查询
  await act(async () => {
    rerender({ repoId: 'repo-b' });
    await Promise.resolve();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.strictEqual(call, 2);
  assert.strictEqual(result.current.status?.checkedAt, '2026-10-16T12:00:09.000Z');

  // 旧请求此刻才返回；不得覆盖新选择的结果
  await act(async () => {
    resolveFirst?.(makeStatus({ checkedAt: '2026-10-16T12:00:01.000Z' }));
    await Promise.resolve();
  });
  assert.strictEqual(result.current.status?.checkedAt, '2026-10-16T12:00:09.000Z', '过期响应不得覆盖');
  cleanup();
});

test('hook_查询失败展示错误_状态文件损坏展示重建入口', async () => {
  const api = installApi();
  const { renderHook, act, cleanup } = await libs();
  const { useSyncStatus } = await hookModule();
  const { render, within } = await libs();
  const { SyncStatusPanel } = await panelModule();

  api.setHandler('sync:status-get', () => makeStatus({
    units: [],
    storeProblem: {
      reasonCode: 'status_invalid',
      message: '同步状态文件不是有效 JSON',
      rebuildAvailable: true,
    },
    aggregate: { state: 'partial_unknown', pendingCount: 0, applicableCount: 0, summaryText: '本机同步记录不可用' },
  }));

  const { result } = await act(async () => renderHook(() => useSyncStatus({ repoId: 'r1', scope: 'project' })));
  await act(async () => { await Promise.resolve(); });
  assert.ok(result.current.status?.storeProblem);

  let rebuilt = false;
  api.setHandler('sync:status-rebuild', () => { rebuilt = true; return { statusBackup: '/b' }; });

  const { container } = render(
    <SyncStatusPanel
      status={result.current.status}
      checking={false}
      error=""
      onRefresh={() => {}}
      onRebuild={() => { void result.current.rebuild(); }}
      rebuildMessage={result.current.rebuildMessage}
    />,
  );
  const panel = within(container).getByLabelText('同步版本状态');
  const button = within(panel).getByRole('button', { name: '重建本机同步记录' });
  button.click();
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.strictEqual(rebuilt, true);
  cleanup();
});
