// electron/src/renderer/pages/sync-status-panel.tsx
// 功能 002 TASK-002-06：版本状态只读面板（design §6）。
// 展示聚合、单元状态/原因/历史成功与最近检查；「来源版本已同步」与「目标 diff 一致」独立。
import React from 'react';
import type { SyncStatusQueryResult } from '../../shared/sync-status-view';
import {
  ATTEMPT_STATE_TEXT,
  VERSION_STATE_TEXT,
  reasonText,
} from '../../shared/sync-status-view';

const TOOL_LABELS: Record<string, string> = {
  codex: 'Codex', claude: 'Claude', cursor: 'Cursor', trae: 'Trae',
};
const MODULE_LABELS: Record<string, string> = {
  rules: '规则', skills: '技能', mcp: 'MCP',
};

function stateBadgeClass(state: string): string {
  if (state === 'current') return 'badge success';
  if (state === 'pending' || state === 'unknown' || state === 'untracked') return 'badge warning';
  return 'badge';
}

function formatUtc(iso?: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '—';
  return new Date(parsed).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

export function SyncStatusPanel({
  status,
  checking,
  error,
  onRefresh,
  onRebuild,
  rebuildMessage,
}: {
  status: SyncStatusQueryResult | null;
  checking: boolean;
  error: string;
  onRefresh: () => void;
  onRebuild?: () => void;
  rebuildMessage?: string;
}) {
  const isQueryResult = Boolean(status && typeof status === 'object' && Array.isArray((status as { units?: unknown }).units));
  const aggregate = isQueryResult && status?.aggregate ? status.aggregate : null;
  const units = isQueryResult && Array.isArray(status?.units) ? status.units : [];
  const storeProblem = isQueryResult ? status?.storeProblem : undefined;
  const checkedAt = isQueryResult ? status?.checkedAt : undefined;
  return (
    <section className="sync-status-panel" aria-label="同步版本状态">
      <div className="section-heading">
        <h2>同步版本状态</h2>
        <span className={aggregate ? stateBadgeClass(aggregate.state) : 'badge'}>
          {aggregate?.summaryText ?? (checking ? '检查中…' : '尚未检查')}
        </span>
      </div>
      <p className="section-note">
        版本状态表示内容库来源是否已有成功分发记录，不检查目标文件内容，也不代表 MCP 服务在线。
        与规则差异对比相互独立。
      </p>
      {error && <div className="error" role="alert">状态查询失败：{error}</div>}
      {storeProblem && (
        <div className="notice" role="alert">
          <p>{storeProblem.message}</p>
          {onRebuild && storeProblem.rebuildAvailable && (
            <button type="button" onClick={onRebuild}>重建本机同步记录</button>
          )}
        </div>
      )}
      {rebuildMessage && <p className="muted" role="status">{rebuildMessage}</p>}
      {units.length > 0 && (
        <table className="table sync-status-table">
          <thead>
            <tr><th>工具</th><th>模块</th><th>版本状态</th><th>最近结果</th><th>上次成功</th><th>最近检查</th></tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const reason = reasonText(unit.reasonCode);
              const attempt = ATTEMPT_STATE_TEXT[unit.attemptState] ?? unit.attemptState;
              return (
                <tr key={`${unit.tool}-${unit.module}-${unit.scope}`}>
                  <td>{TOOL_LABELS[unit.tool] ?? unit.tool}</td>
                  <td>{MODULE_LABELS[unit.module] ?? unit.module}</td>
                  <td>
                    <span className={stateBadgeClass(unit.versionState)}>{VERSION_STATE_TEXT[unit.versionState]}</span>
                    {reason && <span className="muted"> {reason}</span>}
                  </td>
                  <td>{attempt}</td>
                  <td>{formatUtc(unit.lastSuccessAt)}</td>
                  <td>{formatUtc(checkedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {checkedAt && units.length === 0 && !storeProblem && (
        <p className="muted">当前选择下没有可展示的分发单元。</p>
      )}
      <div className="row section-actions">
        <button type="button" onClick={onRefresh} disabled={checking}>{checking ? '检查中…' : '刷新状态'}</button>
      </div>
    </section>
  );
}
