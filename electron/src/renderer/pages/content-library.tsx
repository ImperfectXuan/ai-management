import { useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';
import type { ContentLibrary } from '../../core/content-library';

export function ContentLibraryPage({ library, onSelected }: {
  library: ContentLibrary | null;
  onSelected: (library: ContentLibrary) => void;
}) {
  const [directory, setDirectory] = useState(library?.path ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const browse = async () => {
    try {
      const selected = await invoke<string | null>(IPC.DirectoryChoose);
      if (selected) setDirectory(selected);
    } catch (failure) { setError((failure as Error).message); }
  };

  const select = async (initialize: boolean) => {
    setBusy(true); setError('');
    try {
      onSelected(await invoke<ContentLibrary>(IPC.LibrarySelect, { path: directory, initialize }));
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };

  return <section style={{ maxWidth: 720 }}>
    <h1>统一内容库</h1>
    <p className="muted">选择一个文件夹，集中存放规则、Skills 和 MCP。应用项目在侧边栏单独选择。</p>
    {library && <p>当前内容库：<strong>{library.path}</strong></p>}
    <label htmlFor="library-directory">内容库存放文件夹</label>
    <div className="row">
      <input id="library-directory" className="input" placeholder="例如 /Users/me/AI-Library" value={directory}
        onChange={(event) => setDirectory(event.target.value)} disabled={busy} />
      <button onClick={browse} disabled={busy}>选择文件夹</button>
    </div>
    <p className="muted">内容保存在所选文件夹的 .ai-workspace/ 中。创建空库不会导入本项目的规则或配置；接入已有库保留其中的内容。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row">
      <button onClick={() => select(false)} disabled={busy || !directory}>使用已有内容库</button>
      <button onClick={() => select(true)} disabled={busy || !directory}>{busy ? '处理中…' : '在此创建空内容库'}</button>
    </div>
    <p className="muted">切换内容库只改变管理来源。已有文件和项目配置保留，直到你主动同步到选定项目。</p>
  </section>;
}
