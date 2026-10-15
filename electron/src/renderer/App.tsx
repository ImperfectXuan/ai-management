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
import { ContentLibraryPage } from './pages/content-library';
import type { ContentLibrary } from '../core/content-library';
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
  { key: 'library', label: '内容库存放位置' },
  { key: 'settings', label: '设置' },
];

export function App() {
  const [library, setLibrary] = useState<ContentLibrary | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
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
  useEffect(() => {
    reload();
    invoke<ContentLibrary | null>(IPC.LibraryGet).then(setLibrary)
      .catch((error: Error) => setLoadError(error.message)).finally(() => setLibraryLoading(false));
  }, []);

  useEffect(() => {
    const off = onProgress(IPC.SyncProgress, (d) => {
      const { repoId, line } = d as { repoId: string; line: string };
      if (repoId === activeId) setStatus(line);
    });
    setStatus('');
    return off;
  }, [activeId]);

  const libraryReady = Boolean(library?.path);
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
          <label htmlFor="active-workspace" className="sidebar-title">应用项目</label>
          <select id="active-workspace" value={activeId ?? ''} onChange={(event) => setActiveId(event.target.value)}>
            {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
          </select>
          <div className="repo-path workspace-path" title={active.path}>{active.path}</div>
        </div>}
        {libraryReady && <div className="workspace-picker"><span className="sidebar-title">统一内容库</span><div className="repo-path workspace-path" title={library?.path}>{library?.path}</div></div>}
        {(active || libraryReady) && <nav className="navigation" aria-label="工作区导航">
          {navigation(['dashboard'])}
          <div className="nav-group">配置资产</div>
          {navigation(['rules', 'mcp', 'skills'])}
          <div className="nav-group">整理与检查</div>
          {navigation(['intake', 'diff'])}
          <div className="nav-bottom">{navigation(['library', 'secrets', 'settings'])}</div>
        </nav>}
        <button className="add-repo" onClick={() => setManaging(true)}>管理应用项目</button>
        <div className="sidebar-foot">本机工作区</div>
      </aside>
      <main className="content">
        <header className="workspace-header"><span>{active?.name ?? 'AI Workspace'}</span><span className="header-divider">/</span>
          <span>{!libraryReady || tab === 'library' ? '统一内容库' : managing ? '管理应用项目' : TABS.find((item) => item.key === tab)?.label}</span>
          <span className="local-label">本机</span>
        </header>
        <div className="page">
          {loadError && <div className="error" role="alert">读取仓库失败：{loadError}<button onClick={reload}>重试</button></div>}
          {libraryLoading ? <p className="muted">正在读取内容库设置…</p> : !libraryReady || tab === 'library' ?
            <ContentLibraryPage library={library} onSelected={(selected) => { setLibrary(selected); setTab('rules'); setManaging(false); }} />
          : managing ? <>
            {libraryReady && <button className="back-button" onClick={() => setManaging(false)}>← 返回工作区</button>}
            <WorkspacesPage repos={repos} onReload={reload} />
          </> : <div key={`${library?.path}:${active?.id ?? "no-project"}`} className="page-body">
            {!active && <p className="muted">尚未选择应用项目。可先管理内容库，添加应用项目后再同步。</p>}
            {tab === 'dashboard' && active && <DashboardPage repoId={active?.id ?? 'content-library'} onIntake={() => setTab('intake')} />}
            {tab === 'rules' && <RulesPage repoId={active?.id ?? 'content-library'} canSync={Boolean(active)} />}
            {tab === 'mcp' && <McpPage repoId={active?.id ?? 'content-library'} />}
            {tab === 'skills' && <SkillsPage repoId={active?.id ?? 'content-library'} canSync={Boolean(active)} />}
            {tab === 'secrets' && <SecretsPage repoId={active?.id ?? 'content-library'} />}
            {tab === 'intake' && <IntakePage repoPath={library!.path} lockedLibrary />}
            {tab === 'diff' && active && <DiffPage repoId={active?.id ?? 'content-library'} />}
            {tab === 'settings' && <SettingsPage repoId={active?.id ?? 'content-library'} />}
          </div>}
        </div>
      </main>
      <footer className="statusbar"><span title={status}>{status || (active ? `应用项目：${active.name}` : '请选择内容库与应用项目')}</span><span>AI Workspace · Desktop</span></footer>
    </div>
  );
}

// 浏览器环境挂载；测试环境（jsdom 无 #root）跳过 render，便于组件导入测试
// 用 typeof 守卫：ESM import 提升下，测试的 document 赋值晚于模块加载，裸访问 document 会抛 ReferenceError
if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<App />);
}
