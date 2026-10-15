// electron/src/renderer/pages/rules.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import { PER_FILE_TOOLS, type PerFileTool } from '../../shared/tools';
import type { Rule } from '../../core/rules';

const TOOL_LABELS: Record<PerFileTool, string> = {
  cursor: 'Cursor',
  trae: 'Trae',
};

export function RulesPage({ repoId, canSync = true }: { repoId: string; canSync?: boolean }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [tool, setTool] = useState<PerFileTool>('cursor');

  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setRules(await invoke<Rule[]>(IPC.RulesList, repoId)); } catch (e) { setMsg((e as Error).message); }
  }, [repoId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r: Rule) => {
    try {
      const newValue = !r.requiredByTool[tool];
      await invoke(IPC.RulesSetRequired, { repoId, tool, id: r.id, domain: r.domain, value: newValue });
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const sync = async () => {
    try {
      await invoke(IPC.SyncRun, { repoId, tool, only: 'rules' });
      setMsg(`已同步 ${TOOL_LABELS[tool]} 规则`);
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <h2>规则</h2>
      <div className="row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
        <span className="muted">工具:</span>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {PER_FILE_TOOLS.map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={t === tool ? 'tab tab-active' : 'tab'}
              type="button"
            >
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="muted">{msg}</div>}
      {rules.map((r) => (
        <div key={r.id} className="rule-row">
          <label className="switch">
            <input
              type="checkbox"
              aria-label={`常驻加载 ${r.id}`}
              checked={r.requiredByTool[tool] ?? false}
              onChange={() => toggle(r)}
            />
            <span className="slider" />
          </label>
          <div>
            <div className="repo-name">{r.id}</div>
            <div className="repo-path">scope: {r.scope} · globs: {r.globs} {r.domain ? '· 领域' : ''}</div>
          </div>
        </div>
      ))}
      {rules.length === 0 && <div className="muted">未找到规则（先确认仓库已初始化 AI Workspace）。</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={sync} disabled={!canSync}>同步 {TOOL_LABELS[tool]} 规则</button>
      </div>
    </div>
  );
}
