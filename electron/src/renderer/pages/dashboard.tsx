// electron/src/renderer/pages/dashboard.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke, onProgress } from '../api';
import { IPC } from '../../shared/ipc';
import type { Rule } from '../../core/rules';
import type { McpServer } from '../../core/mcp';
import type { Skill } from '../../core/skills';

const TOOLS = ['cursor', 'trae', 'claude', 'codex'] as const;
type Tool = typeof TOOLS[number];

const TOOL_LABELS: Record<Tool, string> = {
  cursor: 'Cursor',
  trae: 'Trae',
  claude: 'Claude',
  codex: 'Codex',
};

export function DashboardPage({ repoId }: { repoId: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [mcp, setMcp] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [r, m, s] = await Promise.all([
        invoke<Rule[]>(IPC.RulesList, repoId),
        invoke<McpServer[]>(IPC.McpList, repoId),
        invoke<Skill[]>(IPC.SkillsList, repoId),
      ]);
      setRules(r); setMcp(m); setSkills(s);
    } catch { /* 仓库未初始化等，由各卡降级显示 */ }
  }, [repoId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const offP = onProgress(IPC.SyncProgress, (d) => {
      const { line } = d as { line: string };
      setLog((prev) => [...prev.slice(-200), line]);
    });
    const offD = onProgress(IPC.SyncDone, (d) => {
      const { repoId: doneId } = d as { repoId: string };
      if (doneId === repoId) { setBusy(false); load(); }
    });
    return () => { offP(); offD(); };
  }, [repoId, load]);

  const sync = async () => {
    setBusy(true); setLog([]);
    try { await invoke(IPC.SyncRun, { repoId }); } catch { setBusy(false); }
  };

  // per-file 工具(cursor/trae)按各自 mapping 的 required 计数;单文件工具(claude/codex)显示"-"
  const ruleCountFor = (t: Tool): number | string => {
    if (t === 'cursor' || t === 'trae') {
      return rules.filter((r) => r.requiredByTool[t]).length;
    }
    return '-';
  };

  return (
    <div>
      <h2>仪表盘</h2>
      <div className="cards">
        {TOOLS.map((t) => (
          <div key={t} className="card">
            <div className="card-title">{TOOL_LABELS[t]}</div>
            <div className="card-stat">规则: {ruleCountFor(t)}</div>
            <div className="card-stat">技能: {skills.length}</div>
            <div className="card-stat">MCP: {mcp.length}</div>
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <button onClick={sync} disabled={busy}>{busy ? '同步中…' : '一键同步'}</button>
        <button onClick={load} disabled={busy}>刷新</button>
      </div>
      {log.length > 0 && (
        <pre className="log">{log.join('\n')}</pre>
      )}
    </div>
  );
}
