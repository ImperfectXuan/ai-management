// electron/src/renderer/pages/diff.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import type { Rule } from '../../core/rules';
import type { DiffResult } from '../../core/diff';

interface DiffData {
  source: string;
  generated: string;
  diff: DiffResult;
}

export function DiffPage({ repoId }: { repoId: string }) {
  const [tool, setTool] = useState<'cursor' | 'trae'>('cursor');
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [data, setData] = useState<DiffData | null>(null);
  const [msg, setMsg] = useState('');

  const loadRules = useCallback(async () => {
    try {
      const r = await invoke<Rule[]>(IPC.RulesList, repoId);
      setRules(r);
      if (!ruleId && r.length) setRuleId(r[0].id);
    } catch (e) { setMsg((e as Error).message); }
  }, [repoId]);
  useEffect(() => { loadRules(); }, [loadRules]);

  const compare = useCallback(async () => {
    if (!ruleId) return;
    setData(await invoke<DiffData>(IPC.DiffCompare, { repoId, tool, ruleId }));
  }, [repoId, tool, ruleId]);
  useEffect(() => { if (ruleId) compare(); }, [ruleId, tool, compare]);

  const apply = async () => {
    await invoke(IPC.SyncRun, { repoId, tool });
    setMsg(`已同步 ${tool} 规则`);
    compare();
  };

  return (
    <div>
      <h2>差异对比</h2>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <select value={tool} onChange={(e) => setTool(e.target.value as 'cursor' | 'trae')} className="input" style={{ width: 120 }}>
          <option value="cursor">Cursor</option>
          <option value="trae">Trae</option>
        </select>
        <select value={ruleId ?? ''} onChange={(e) => setRuleId(e.target.value)} className="input" style={{ flex: 1 }}>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
        </select>
      </div>
      {msg && <div className="muted">{msg}</div>}
      {data && (
        <>
          {data.diff.identical ? <div className="muted">已同步，无差异</div> : (
            <pre className="diff">
              {data.diff.hunks.map((h, i) => (
                <span key={i}>
                  {h.removed.map((l) => <span key={l} className="removed">- {l}</span>)}
                  {h.added.map((l) => <span key={l} className="added">+ {l}</span>)}
                </span>
              ))}
            </pre>
          )}
          <button onClick={apply}>重新同步（应用）</button>
        </>
      )}
    </div>
  );
}
