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
import { IntakePage } from './pages/intake';

export interface Repo { id: string; path: string; name: string; addedAt: string; lastSyncAt?: string }

const TABS = [
  { key: 'dashboard', label: '工作区概览' },
  { key: 'rules', label: '规则' },
  { key: 'mcp', label: 'MCP 服务' },
  { key: 'skills', label: '技能' },
  { key: 'secrets', label: '密钥' },
  { key: 'intake', label: '配置收编' },
  { key: 'diff', label: '差异对比' },
  { key: 'settings', label: '设置' },
];

export function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState('dashboard');
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [managing, setManaging] = useState(false);

  const reload = async () => {
    try {
      const list = await invoke<Repo[]>(IPC.WorkspaceList);
      setRepos(list);
      if (!list.some((repo) => repo.id === activeId)) setActiveId(list[0]?.id ?? null);
      setLoadError('');
    } catch (error) { setLoadError((error as Error).message); }
  };
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    const off = onProgress(IPC.SyncProgress, (d) => {
      const { repoId, line } = d as { repoId: string; line: string };
      if (repoId === activeId) setStatus(line);
    });
    setStatus('');
    return off;
  }, [activeId]);

  const active = repos.find((r) => r.id === activeId);

  const navigation = (keys: string[]) => TABS.filter((item) => keys.includes(item.key)).map((item) => (
    <button key={item.key} type="button" className={`nav-item ${tab === item.key && !managing ? 'active' : ''}`}
      aria-current={tab === item.key && !managing ? 'page' : undefined}
      onClick={() => { setTab(item.key); setManaging(false); }}>
      {item.label}
    </button>
  ));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AI <span>Workspace</span></div>
        {active && <div className="workspace-picker">
          <label htmlFor="active-workspace" className="sidebar-title">当前仓库</label>
          <select id="active-workspace" value={activeId ?? ''} onChange={(event) => setActiveId(event.target.value)}>
            {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
          </select>
          <div className="repo-path workspace-path" title={active.path}>{active.path}</div>
        </div>}
        {active && <nav className="navigation" aria-label="工作区导航">
          {navigation(['dashboard'])}
          <div className="nav-group">配置资产</div>
          {navigation(['rules', 'mcp', 'skills'])}
          <div className="nav-group">整理与检查</div>
          {navigation(['intake', 'diff'])}
          <div className="nav-bottom">{navigation(['secrets', 'settings'])}</div>
        </nav>}
        <button className="add-repo" onClick={() => setManaging(true)}>管理仓库</button>
        <div className="sidebar-foot">本机工作区</div>
      </aside>
      <main className="content">
        <header className="workspace-header"><span>{active?.name ?? 'AI Workspace'}</span><span className="header-divider">/</span>
          <span>{managing || !active ? '管理仓库' : TABS.find((item) => item.key === tab)?.label}</span>
          <span className="local-label">本机</span>
        </header>
        <div className="page">
          {loadError && <div className="error" role="alert">读取仓库失败：{loadError}<button onClick={reload}>重试</button></div>}
          {managing || !active ? <>
            {active && <button className="back-button" onClick={() => setManaging(false)}>← 返回工作区</button>}
            <WorkspacesPage repos={repos} onReload={reload} />
          </> : <div key={active.id} className="page-body">
            {tab === 'dashboard' && <DashboardPage repoId={active.id} onIntake={() => setTab('intake')} />}
            {tab === 'rules' && <RulesPage repoId={active.id} />}
            {tab === 'mcp' && <McpPage repoId={active.id} />}
            {tab === 'skills' && <SkillsPage repoId={active.id} />}
            {tab === 'secrets' && <SecretsPage repoId={active.id} />}
            {tab === 'intake' && <IntakePage repoPath={active.path} />}
            {tab === 'diff' && <DiffPage repoId={active.id} />}
            {tab === 'settings' && <SettingsPage repoId={active.id} />}
          </div>}
        </div>
      </main>
      <footer className="statusbar"><span title={status}>{status || (active ? `当前仓库：${active.name}` : '添加仓库以开始')}</span><span>AI Workspace · Desktop</span></footer>
    </div>
  );
}

// 浏览器环境挂载；测试环境（jsdom 无 #root）跳过 render，便于组件导入测试
// 用 typeof 守卫：ESM import 提升下，测试的 document 赋值晚于模块加载，裸访问 document 会抛 ReferenceError
if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<App />);
}
