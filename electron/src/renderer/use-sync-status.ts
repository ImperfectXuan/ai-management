// electron/src/renderer/use-sync-status.ts
// 功能 002 TASK-002-06：渲染层只读状态查询与刷新（design §6）。
// 进入页面、切库/项目/工具、SyncStatusChanged、窗口激活与手动刷新触发重查；
// 以请求序号 + 完整选择身份丢弃过期响应；不展示哈希/路径等实现字段。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, onProgress } from './api';
import { IPC } from '../shared/ipc';
import type { SyncModule, SyncScope, SyncTool } from '../shared/sync-status';
import type { SyncStatusQueryResult } from '../shared/sync-status-view';

export interface UseSyncStatusOptions {
  repoId: string;
  scope: SyncScope;
  tool?: SyncTool;
  module?: SyncModule;
  /** 关闭自动查询（例如无项目且仅管理内容库时）。 */
  enabled?: boolean;
}

export interface UseSyncStatusResult {
  status: SyncStatusQueryResult | null;
  error: string;
  checking: boolean;
  refresh: () => Promise<void>;
  rebuild: () => Promise<void>;
  rebuildMessage: string;
}

export function useSyncStatus(options: UseSyncStatusOptions): UseSyncStatusResult {
  const { repoId, scope, tool, module, enabled = true } = options;
  const [status, setStatus] = useState<SyncStatusQueryResult | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState('');
  const seqRef = useRef(0);
  const identity = useMemo(
    () => JSON.stringify([repoId, scope, tool ?? null, module ?? null]),
    [repoId, scope, tool, module],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const seq = ++seqRef.current;
    setChecking(true);
    try {
      const result = await invoke<SyncStatusQueryResult>(IPC.SyncStatusGet, { repoId, scope, tool, module });
      if (seq !== seqRef.current) return; // 过期响应
      setStatus(result);
      setError('');
      setRebuildMessage('');
    } catch (failure) {
      if (seq !== seqRef.current) return;
      setError((failure as Error).message);
    } finally {
      if (seq === seqRef.current) setChecking(false);
    }
  }, [repoId, scope, tool, module, enabled]);

  const rebuild = useCallback(async () => {
    await invoke(IPC.SyncStatusRebuild);
    setRebuildMessage('本机同步记录已重置，请重新同步以建立新基线');
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    void refresh();
  }, [identity, enabled, refresh]);

  // 来源修改、入库/回退、单元完成只提示重查；实际状态按文件重算
  useEffect(() => {
    if (!enabled) return;
    return onProgress(IPC.SyncStatusChanged, () => { void refresh(); });
  }, [enabled, refresh]);

  // 窗口重新激活：外部编辑在刷新/激活时被识别（无后台 watcher）
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onFocus = () => { void refresh(); };
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  return { status, error, checking, refresh, rebuild, rebuildMessage };
}
