// electron/src/renderer/pages/mcp.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import type { McpServer } from '../../core/mcp';

export function McpPage({ repoId }: { repoId: string }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setServers(await invoke<McpServer[]>(IPC.McpList, repoId)); } catch (e) { setMsg((e as Error).message); }
  }, [repoId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name || !cmd) return;
    await invoke(IPC.McpAdd, { repoId, name, command: cmd, args: args ? args.split(' ') : [] });
    setAdding(false); setName(''); setCmd(''); setArgs('');
    load();
  };

  const remove = async (n: string) => {
    if (!window.confirm(`删除 MCP 服务器 ${n}？`)) return;
    await invoke(IPC.McpRemove, { repoId, name: n });
    load();
  };

  return (
    <div>
      <h2>MCP 服务器</h2>
      {msg && <div className="muted">{msg}</div>}
      <table className="table">
        <thead><tr><th>名称</th><th>命令</th><th>Scope</th><th></th></tr></thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.command}</td>
              <td>{(s.scope ?? []).join(', ') || '-'}</td>
              <td><button className="danger" onClick={() => remove(s.name)}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding ? (
        <div className="form">
          <div className="row"><input className="input" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="row"><input className="input" placeholder="命令，如 npx" value={cmd} onChange={(e) => setCmd(e.target.value)} /></div>
          <div className="row"><input className="input" placeholder="参数，空格分隔（可选）" value={args} onChange={(e) => setArgs(e.target.value)} /></div>
          <div className="row"><button onClick={add}>添加</button><button onClick={() => setAdding(false)}>取消</button></div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}>＋ 添加 MCP</button>
      )}
    </div>
  );
}
