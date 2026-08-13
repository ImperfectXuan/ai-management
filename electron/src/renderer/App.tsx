// electron/src/renderer/App.tsx
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, onProgress } from './api';
import { IPC } from '../shared/ipc';
import { WorkspacesPage } from './pages/workspaces';
import { DashboardPage } from './pages/dashboard';
import { RulesPage } from './pages/rules';
import { McpPage } from './pages/mcp';
import { SkillsPage } from './pages/skills';
import { SecretsPage } from './pages/secrets';
import { DiffPage } from './pages/diff';
import { SettingsPage } from './pages/settings';

export interface Repo { id: string; path: string; name: string; addedAt: string; lastSyncAt?: string }

const TABS = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'rules', label: '规则' },
  { key: 'mcp', label: 'MCP' },
  { key: 'skills', label: '技能' },
  { key: 'secrets', label: '密钥' },
  { key: 'diff', label: '差异对比' },
  { key: 'settings', label: '设置' },
];

export function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState('dashboard');
  const [status, setStatus] = useState('');

  const reload = async () => {
    const list = await invoke<Repo[]>(IPC.WorkspaceList);
    setRepos(list);
    if (!activeId && list.length) setActiveId(list[0].id);
  };
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    const off = onProgress(IPC.SyncProgress, (d) => {
      const { line } = d as { repoId: string; line: string };
      setStatus(line);
    });
    return off;
  }, []);

  const active = repos.find((r) => r.id === activeId);

  if (!active) {
    return <WorkspacesPage repos={repos} onReload={reload} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-title">仓库</div>
        {repos.map((r) => (
          <button
            key={r.id}
            className={`repo-item ${r.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(r.id)}
          >
            <div className="repo-name">{r.name}</div>
            <div className="repo-path">{r.path}</div>
          </button>
        ))}
        <button className="add-repo" onClick={() => { setActiveId(null); }}>＋ 管理仓库</button>
      </aside>
      <main className="content">
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="page">
          {tab === 'dashboard' && <DashboardPage repoId={active.id} />}
          {tab === 'rules' && <RulesPage repoId={active.id} />}
          {tab === 'mcp' && <McpPage repoId={active.id} />}
          {tab === 'skills' && <SkillsPage repoId={active.id} />}
          {tab === 'secrets' && <SecretsPage repoId={active.id} />}
          {tab === 'diff' && <DiffPage repoId={active.id} />}
          {tab === 'settings' && <SettingsPage repoId={active.id} />}
        </div>
      </main>
      <footer className="statusbar">{status || `当前仓库: ${active.name}`}</footer>
    </div>
  );
}

// 浏览器环境挂载；测试环境（jsdom 无 #root）跳过 render，便于组件导入测试
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
