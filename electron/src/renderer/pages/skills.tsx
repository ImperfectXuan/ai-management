// electron/src/renderer/pages/skills.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import type { Skill } from '../../core/skills';

export function SkillsPage({ repoId }: { repoId: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSkills(await invoke<Skill[]>(IPC.SkillsList, repoId));
  }, [repoId]);
  useEffect(() => { load(); }, [load]);

  const link = async (scope: 'global' | 'project') => {
    if (!sel) return;
    await invoke(IPC.SkillsLink, { repoId, scope, tool: 'cursor' });
    load();
  };
  const unlink = async () => {
    if (!sel) return;
    await invoke(IPC.SkillsUnlink, { repoId, scope: 'project', tool: 'cursor' });
    load();
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
        {detail ? (
          <>
            <h2>{detail.name}</h2>
            <p className="muted">{detail.description}</p>
            <table className="table">
              <thead><tr><th>工具</th><th>global</th><th>project</th></tr></thead>
              <tbody>
                {Object.entries(detail.linkStatus).map(([tool, st]) => (
                  <tr key={tool}><td>{tool}</td><td>{st.global ? '✓' : '–'}</td><td>{st.project ? '✓' : '–'}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => link('global')}>链接到 Cursor (global)</button>
              <button onClick={() => link('project')}>链接到 Cursor (project)</button>
              <button className="danger" onClick={unlink}>从 Cursor 卸载 (project)</button>
            </div>
          </>
        ) : (
          <div className="muted">选择左侧技能查看详情</div>
        )}
      </div>
    </div>
  );
}
