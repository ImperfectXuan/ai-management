// electron/src/renderer/pages/dashboard.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke, onProgress } from '../api';
import { IPC } from '../../shared/ipc';
import type { Rule } from '../../core/rules';
import type { McpServer } from '../../core/mcp';
import type { Skill } from '../../core/skills';
import { useSyncStatus } from '../use-sync-status';
import { SyncStatusPanel } from './sync-status-panel';

const TOOLS = ['cursor', 'trae', 'claude', 'codex'] as const;
type Tool = typeof TOOLS[number];

const TOOL_LABELS: Record<Tool, string> = {
  cursor: 'Cursor',
  trae: 'Trae',
  claude: 'Claude',
  codex: 'Codex',
};

export function DashboardPage({ repoId, onIntake }: { repoId: string; onIntake?: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [mcp, setMcp] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const syncStatus = useSyncStatus({ repoId, scope: 'project', enabled: Boolean(repoId) });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, m, s] = await Promise.all([
        invoke<Rule[]>(IPC.RulesList, repoId),
        invoke<McpServer[]>(IPC.McpList, repoId),
        invoke<Skill[]>(IPC.SkillsList, repoId),
      ]);
      setRules(r); setMcp(m); setSkills(s); setError('');
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }, [repoId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const offP = onProgress(IPC.SyncProgress, (d) => {
      const { repoId: progressId, line } = d as { repoId: string; line: string };
      if (progressId === repoId) setLog((prev) => [...prev.slice(-200), line]);
    });
    const offD = onProgress(IPC.SyncDone, (d) => {
      const { repoId: doneId } = d as { repoId: string };
      if (doneId === repoId) { setBusy(false); load(); void syncStatus.refresh(); }
    });
    return () => { offP(); offD(); };
  }, [repoId, load, syncStatus.refresh]);

  const sync = async () => {
    setBusy(true); setLog([]); setSyncState('running');
    try { await invoke(IPC.SyncRun, { repoId }); setSyncState('done'); }
    catch (failure) { setSyncState('failed'); setLog((previous) => [...previous, (failure as Error).message]); }
    finally { setBusy(false); void syncStatus.refresh(); }
  };

  const ruleCountFor = (tool: Tool): number => {
    if (tool === 'cursor' || tool === 'trae') return rules.filter((rule) => rule.requiredByTool[tool]).length;
    return rules.filter((rule) => !rule.tools.length || rule.tools.includes(tool)).length;
  };

  const count = (value: number | string) => loading || error ? '—' : value;
  const statusLabel = { idle: '差异尚未检查', running: '正在生成配置', done: '配置已生成', failed: '同步未完成' }[syncState];

  return (
    <div className="dashboard">
      <div className="eyebrow">WORKSPACE / OVERVIEW</div>
      <div className="page-heading">
        <div><h1>配置从这里，分发到每个工具。</h1><p className="muted">在总库维护规则、技能与服务配置。</p></div>
        <button className="primary" onClick={sync} disabled={busy || loading || Boolean(error)}>{busy ? '同步中…' : '同步到四个工具'}</button>
      </div>
      {error && <div className="error" role="alert">读取资产失败：{error}<button onClick={load}>重试</button></div>}
      <section className="distribution" aria-label="工具分发">
        <div className="section-heading"><h2>工具分发</h2><span className={`badge ${syncState === 'done' ? 'success' : syncState === 'failed' ? 'warning' : ''}`}>{statusLabel}</span></div>
        <div className="distribution-routes">
          <div className="distribution-source"><span className="eyebrow">SOURCE</span><strong>AI Workspace 总库</strong><p>规则 · 技能 · MCP<br />统一维护，按工具生成</p></div>
          <div className="distribution-connector" aria-hidden="true" />
          <div className="distribution-tools">
            {TOOLS.map((tool) => <div key={tool} className="tool-card">
              <div className="tool-title">{TOOL_LABELS[tool]}</div>
              <p>{tool === 'cursor' || tool === 'trae' ? '常驻规则' : '适用规则'} {count(ruleCountFor(tool))} · 技能 {count(skills.length)} · MCP {count(mcp.length)}</p>
            </div>)}
          </div>
        </div>
        <p className="section-note">连线表示配置生成关系。配置生成成功不代表差异一致，也不代表 MCP 服务已连接。</p>
        <div className="row section-actions"><button onClick={load} disabled={busy || loading}>刷新资产</button>
          {busy && <button onClick={() => invoke(IPC.SyncCancel, repoId).catch((failure: Error) => setLog((prev) => [...prev, failure.message]))}>取消同步</button>}
        </div>
      </section>
      <SyncStatusPanel
        status={syncStatus.status}
        checking={syncStatus.checking}
        error={syncStatus.error}
        onRefresh={() => { void syncStatus.refresh(); }}
        onRebuild={() => { void syncStatus.rebuild(); }}
        rebuildMessage={syncStatus.rebuildMessage}
      />
      <div className="dashboard-lower">
        <section><h2>总库资产</h2><dl className="asset-list">
          <div><dt>规则</dt><dd>{count(rules.length)} 项</dd></div>
          <div><dt>技能</dt><dd>{count(skills.length)} 项</dd></div>
          <div><dt>MCP 配置</dt><dd>{count(mcp.length)} 项</dd></div>
        </dl></section>
        <section className="next-action"><span className="eyebrow">IMPORT</span><h2>已有项目配置，集中整理。</h2><p className="muted">从项目中扫描候选，逐项审核，再写入总库。</p>
          {onIntake && <button onClick={onIntake}>收编已有配置 →</button>}
        </section>
      </div>
      {log.length > 0 && <section className="sync-output"><h2>同步记录</h2><pre className="log" aria-label="同步记录">{log.join('\n')}</pre></section>}
    </div>
  );
}
