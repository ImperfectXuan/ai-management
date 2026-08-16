// electron/src/renderer/pages/rules.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import type { Rule } from '../../core/rules';

export function RulesPage({ repoId }: { repoId: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setRules(await invoke<Rule[]>(IPC.RulesList, repoId)); setDirty(false); } catch (e) { setMsg((e as Error).message); }
  }, [repoId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r: Rule) => {
    await invoke(IPC.RulesSetRequired, { repoId, tool: 'cursor', id: r.id, domain: r.domain, value: !r.required });
    setDirty(true);
    load();
  };

  const sync = async () => {
    await invoke(IPC.SyncRun, { repoId, tool: 'cursor' });
    setDirty(false);
    setMsg('已同步 Cursor 规则');
    load();
  };

  return (
    <div>
      <h2>规则</h2>
      {msg && <div className="muted">{msg}</div>}
      {rules.map((r) => (
        <div key={r.id} className="rule-row">
          <label className="switch">
            <input type="checkbox" checked={r.required} onChange={() => toggle(r)} />
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
        <button onClick={sync} disabled={!dirty}>同步 Cursor 规则</button>
      </div>
    </div>
  );
}
