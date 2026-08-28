// electron/src/renderer/pages/skills.tsx
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import { SUPPORTED_TOOLS } from '../../core/config';
import type { Skill, SkillLinkState } from '../../core/skills';

const TOOL_LABELS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  cursor: 'Cursor',
  trae: 'Trae',
};

const STATE_LABELS: Record<SkillLinkState, string> = {
  managed: '✓ 已链接',
  conflict: '⚠ 冲突',
  missing: '–',
};

type Scope = 'global' | 'project';

export function SkillsPage({ repoId }: { repoId: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tool, setTool] = useState<string>('cursor');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setSkills(await invoke<Skill[]>(IPC.SkillsList, repoId));
  }, [repoId]);
  useEffect(() => { load(); }, [load]);

  const toolLabel = TOOL_LABELS[tool] ?? tool;

  const link = async (scope: Scope) => {
    if (!sel) return;
    await invoke(IPC.SkillsLink, { repoId, scope, tool, skillName: sel });
    setMsg(`已链接 ${sel} 到 ${toolLabel}（${scope}）`);
    await load();
  };

  const unlink = async (scope: Scope) => {
    if (!sel) return;
    await invoke(IPC.SkillsUnlink, { repoId, scope, tool, skillName: sel });
    setMsg(`已从 ${toolLabel} 卸载 ${sel}（${scope}）`);
    await load();
  };

  const detail = skills.find((s) => s.name === sel);
  return (
    <div className="master-detail">
      <ul className="master">
        {skills.map((s) => (
          <li key={s.name} className={s.name === sel ? 'repo-item active' : 'repo-item'} onClick={() => setSel(s.name)}>
            <div className="repo-name">{s.name}</div>
            <div className="repo-path">{(s.description || '').slice(0, 40)}</div>
          </li>
        ))}
        {skills.length === 0 && <li className="muted">无技能</li>}
      </ul>
      <div className="detail">
        <div className="row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
          <span className="muted">工具:</span>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            {SUPPORTED_TOOLS.map((t) => (
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
        {detail ? (
          <>
            <h2>{detail.name}</h2>
            <p className="muted">{detail.description}</p>
            {msg ? <p className="muted">{msg}</p> : null}
            <table className="table">
              <thead><tr><th>工具</th><th>global</th><th>project</th></tr></thead>
              <tbody>
                {Object.entries(detail.linkStatus).map(([stTool, st]) => (
                  <tr key={stTool}>
                    <td>{TOOL_LABELS[stTool] ?? stTool}</td>
                    <td>{STATE_LABELS[st.global]}</td>
                    <td>{STATE_LABELS[st.project]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => link('global')}>链接到 {toolLabel} (global)</button>
              <button onClick={() => link('project')}>链接到 {toolLabel} (project)</button>
              <button className="danger" onClick={() => unlink('global')}>从 {toolLabel} 卸载 (global)</button>
              <button className="danger" onClick={() => unlink('project')}>从 {toolLabel} 卸载 (project)</button>
            </div>
          </>
        ) : (
          <div className="muted">选择左侧技能查看详情</div>
        )}
      </div>
    </div>
  );
}
