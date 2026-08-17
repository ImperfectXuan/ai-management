// electron/src/renderer/pages/workspaces.tsx
import React, { useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import { Repo } from '../App';

export function WorkspacesPage({ repos, onReload }: { repos: Repo[]; onReload: () => void }) {
  const [path, setPath] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!path) return;
    setBusy(true); setErr('');
    try {
      await invoke(IPC.WorkspaceAdd, path);
      setPath('');
      onReload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await invoke(IPC.WorkspaceRemove, id);
    onReload();
  };

  return (
    <div className="workspaces">
      <h2>管理仓库</h2>
      <div className="row">
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="输入 git 仓库路径，如 /Users/me/project" className="input" />
        <button onClick={add} disabled={busy}>{busy ? '验证中…' : '添加'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      <ul className="repo-list">
        {repos.map((r) => (
          <li key={r.id} className="repo-row">
            <div>
              <div className="repo-name">{r.name}</div>
              <div className="repo-path">{r.path}</div>
            </div>
            <button className="danger" onClick={() => remove(r.id)}>移除</button>
          </li>
        ))}
        {repos.length === 0 && <li className="muted">还没有仓库。输入一个 git 仓库路径添加。</li>}
      </ul>
    </div>
  );
}
