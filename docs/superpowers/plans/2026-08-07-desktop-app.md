# AI Workspace Desktop 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `electron/` 子目录构建一个独立的 macOS Electron 应用（arm64 .app/.dmg），多仓库管理 AI Workspace，TypeScript 重写核心业务模块，覆盖仓库管理/仪表盘/规则/MCP/技能/密钥/差异对比/设置。

**Architecture:** 三层——`renderer`（React，无业务逻辑）→ `main`（Electron 主进程，IPC 薄转发）→ `core`（纯 TS 业务逻辑，只操作文件系统与 git，不依赖 electron，可 `node:test` 直测）。数据边界是各仓库的 `.ai-workspace/`（单一事实来源）；仓库列表存应用级 userData。长任务（sync/批量同步）用 AsyncGenerator 产出进度行，main 经 IPC 实时推送，renderer 渲染日志 + 系统通知。

**Tech Stack:** Node ≥ 20、Electron 33 + React 18 + TypeScript 5 + esbuild（统一打包 main/preload/renderer）、electron-builder（dmg/arm64）、`node:test` + `tsx`（core 单测）、`jsdom` + `@testing-library/react`（renderer 冒烟）。

**Spec:** `docs/superpowers/specs/2026-08-07-desktop-app-design.md`

## Global Constraints

- 所有 UI 文案、commit message 描述使用简体中文。
- `core/` 不得 `import` electron——只依赖 `node:fs`、`node:path`、`node:child_process`、`node:crypto`，保证可单测。
- 写操作只落 canonical 源（`.ai-workspace/`），不直接改生成文件（避免绕过 sync 漂移）。
- 仓库列表存 `app.getPath('userData')/repos.json`，不写进被管理的仓库。
- 工具路径映射与 `common.sh` 一致（claude/codex/cursor/trae 的 global/project MCP 与 skills 路径）。
- 密钥 vault 首版只读桥接（调现有 `aiws secrets list/audit --json`），不解密、不做写操作。
- TypeScript `strict: true`，禁止 `any`（renderer 的 `window.api` 用 `declare global` 类型化）。
- 遵循 CLAUDE.md 分层/命名/错误规范；错误统一 `WorkspaceError` + code。

---
---

# Phase 0：工程脚手架

## Task 1: electron/ 脚手架（打包配置 + 最小窗口）

**Files:**
- Create: `electron/package.json`
- Create: `electron/tsconfig.json`
- Create: `electron/electron-builder.yml`
- Create: `electron/src/main/index.ts`
- Create: `electron/src/main/preload.ts`
- Create: `electron/src/shared/ipc.ts`
- Create: `electron/src/renderer/index.html`
- Create: `electron/src/renderer/styles.css`
- Create: `electron/.gitignore`

**Interfaces:**
- Consumes: 无（Phase 0 自足）
- Produces:
  - `npm run start` → 编译 + `electron .` 打开窗口；`npm test` → 跑 `test/*.test.ts`
  - `IPC` 通道常量对象（`src/shared/ipc.ts`），供后续 Task 10-11 与 renderer 引用
  - preload 暴露 `window.api.invoke(channel, payload?)` 与 `window.api.on(channel, cb)`（contextIsolation）

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "ai-workspace-desktop",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "build": "npm run build:main && npm run build:preload && npm run build:renderer",
    "build:main": "esbuild src/main/index.ts --bundle --platform=node --external:electron --outfile=dist/main/index.js",
    "build:preload": "esbuild src/main/preload.ts --bundle --platform=node --external:electron --outfile=dist/main/preload.js",
    "build:renderer": "esbuild src/renderer/App.tsx --bundle --platform=browser --jsx=automatic --outfile=dist/renderer/app.js && cp src/renderer/index.html src/renderer/styles.css dist/renderer/",
    "start": "npm run build && electron .",
    "test": "node --import tsx --test test/*.test.ts",
    "dist": "npm run build && electron-builder --mac --arm64"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "esbuild": "^0.25.0",
    "jsdom": "^25.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 `electron-builder.yml`**

```yaml
appId: com.aiworkspace.desktop
productName: AI Workspace
directories:
  output: release
  buildResources: build
files:
  - dist/**/*
  - package.json
mac:
  target:
    - target: dmg
      arch: [arm64]
  category: public.app-category.developer-tools
  icon: build/icon.icns
dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
```

- [ ] **Step 4: 创建 `src/shared/ipc.ts`**

```ts
export const IPC = {
  WorkspaceList: 'workspace:list',
  WorkspaceAdd: 'workspace:add',
  WorkspaceRemove: 'workspace:remove',
  RulesList: 'rules:list',
  RulesSetRequired: 'rules:setRequired',
  McpList: 'mcp:list',
  McpAdd: 'mcp:add',
  McpRemove: 'mcp:remove',
  SkillsList: 'skills:list',
  SkillsLink: 'skills:link',
  SkillsUnlink: 'skills:unlink',
  SyncRun: 'sync:run',
  SyncCancel: 'sync:cancel',
  SyncProgress: 'sync:progress',
  SyncDone: 'sync:done',
  SyncAll: 'sync:all',
  DiffCompare: 'diff:compare',
  SecretsList: 'secrets:list',
  SecretsAudit: 'secrets:audit',
} as const;
export type IpcChannel = (typeof IPC)[keyof typeof IPC];
```

- [ ] **Step 5: 创建 `src/main/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  on: (channel: string, callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
```

- [ ] **Step 6: 创建 `src/main/index.ts`（最小窗口）**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    title: 'AI Workspace',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: 创建 `src/renderer/index.html` + `styles.css`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
  <title>AI Workspace</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div id="root"></div>
  <script src="app.js"></script>
</body>
</html>
```

```css
/* src/renderer/styles.css —— 占位，后续 Task 13-17 逐步补样式 */
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; background: #1e1f24; color: #e8e8ea; }
```

- [ ] **Step 8: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
release/
```

- [ ] **Step 9: 安装依赖并启动验证**

```bash
cd electron && npm install && npm start
```

Expected: 弹出 1120×740 空白窗口，标题 "AI Workspace"，无报错。关闭窗口退出（macOS 下 dock 图标保留）。

- [ ] **Step 10: 提交**

```bash
git add electron/ && git commit -m "feat(desktop): electron 脚手架、最小窗口、preload 与 IPC 通道定义"
```

---
---

# Phase 1：core 层（纯 TS，TDD）

## Task 2: core/errors + core/git

**Files:**
- Create: `electron/src/core/errors.ts`
- Create: `electron/src/core/git.ts`
- Test: `electron/test/git.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `ErrorCodes`（`WorkspaceNotFound | NotAGitRepo | AiwsNotInstalled | GitNotInstalled | UnsupportedTool`）与 `WorkspaceError`（`new WorkspaceError(code, message, details?)`）
  - `isGitInstalled(): Promise<boolean>`
  - `runGit(args: string[], opts?: {cwd?: string}): Promise<{stdout; stderr; code}>`
  - `gitRoot(dir: string): Promise<string>`（非 git 仓库抛 `NotAGitRepo`）

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/git.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitRoot, runGit } from '../src/core/git';
import { WorkspaceError, ErrorCodes } from '../src/core/errors';

test('gitRoot 在非 git 目录抛 NotAGitRepo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  await assert.rejects(gitRoot(dir), (e: any) => e.code === ErrorCodes.NotAGitRepo);
});

test('gitRoot 返回仓库根目录', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  await runGit(['init'], { cwd: dir });
  assert.strictEqual(await gitRoot(dir), path.resolve(dir));
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd electron && npm test 2>&1 | tail -5
```
Expected: FAIL（`Cannot find module`）

- [ ] **Step 3: 实现 `core/errors.ts` + `core/git.ts`**

```ts
// electron/src/core/errors.ts
export const ErrorCodes = {
  WorkspaceNotFound: 'WorkspaceNotFound',
  NotAGitRepo: 'NotAGitRepo',
  AiwsNotInstalled: 'AiwsNotInstalled',
  GitNotInstalled: 'GitNotInstalled',
  UnsupportedTool: 'UnsupportedTool',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class WorkspaceError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.details = details;
  }
}
```

```ts
// electron/src/core/git.ts
import { execFile } from 'node:child_process';
import { WorkspaceError, ErrorCodes } from './errors';

export async function isGitInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['--version'], (err) => resolve(!err));
  });
}

export async function runGit(
  args: string[],
  opts: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1;
        resolve({ stdout: String(stdout), stderr: String(stderr || err.message), code });
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
    });
  });
}

export async function gitRoot(dir: string): Promise<string> {
  const res = await runGit(['rev-parse', '--show-toplevel'], { cwd: dir });
  if (res.code !== 0) {
    throw new WorkspaceError(ErrorCodes.NotAGitRepo, `'${dir}' 不是 git 仓库`);
  }
  return res.stdout.trim();
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd electron && npm test 2>&1 | tail -5
```
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/errors.ts electron/src/core/git.ts electron/test/git.test.ts
git commit -m "feat(core): 错误模型与 git 封装（isGitInstalled/runGit/gitRoot）"
```

## Task 3: core/config（workspace.json + 工具路径映射）

**Files:**
- Create: `electron/src/core/config.ts`
- Test: `electron/test/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SUPPORTED_TOOLS: readonly string[]`（`['codex','claude','cursor','trae']`）
  - `loadConfig(aiwsDir): Promise<WorkspaceConfig>`（`{version, tools, default_scope}`，缺文件给默认）
  - `getToolMcpPath(root, tool, scope: 'global'|'project'): string | null`
  - `getToolSkillsPath(root, tool, scope): string | null`

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/config.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, getToolMcpPath, getToolSkillsPath } from '../src/core/config';

test('loadConfig 缺文件时返回默认', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const cfg = await loadConfig(dir);
  assert.deepStrictEqual(cfg.tools, ['codex', 'claude', 'cursor', 'trae']);
  assert.strictEqual(cfg.default_scope, 'project');
});

test('loadConfig 读取 workspace.json', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  mkdirSync(path.join(dir, 'config'), { recursive: true });
  writeFileSync(path.join(dir, 'config', 'workspace.json'), JSON.stringify({ version: '1.0', tools: ['cursor'], default_scope: 'global' }));
  const cfg = await loadConfig(dir);
  assert.deepStrictEqual(cfg.tools, ['cursor']);
  assert.strictEqual(cfg.default_scope, 'global');
});

test('getToolMcpPath project cursor 指向仓库 .cursor/mcp.json', () => {
  assert.strictEqual(getToolMcpPath('/repo', 'cursor', 'project'), path.join('/repo', '.cursor', 'mcp.json'));
});

test('getToolSkillsPath global trae 指向 ~/.trae/skills', () => {
  const home = process.env.HOME ?? '';
  assert.strictEqual(getToolSkillsPath('/repo', 'trae', 'global'), path.join(home, '.trae', 'skills'));
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/config.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SUPPORTED_TOOLS = ['codex', 'claude', 'cursor', 'trae'] as const;

export interface WorkspaceConfig {
  version: string;
  tools: string[];
  default_scope: string;
}

export async function loadConfig(aiwsDir: string): Promise<WorkspaceConfig> {
  const file = path.join(aiwsDir, 'config', 'workspace.json');
  try {
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    return {
      version: cfg.version ?? '1.0',
      tools: cfg.tools ?? [...SUPPORTED_TOOLS],
      default_scope: cfg.default_scope ?? 'project',
    };
  } catch {
    return { version: '1.0', tools: [...SUPPORTED_TOOLS], default_scope: 'project' };
  }
}

function home(): string {
  return process.env.HOME ?? '';
}

export function getToolMcpPath(root: string, tool: string, scope: 'global' | 'project'): string | null {
  if (scope === 'global') {
    switch (tool) {
      case 'claude': return path.join(home(), '.claude.json');
      case 'codex': return path.join(home(), '.codex', 'config.toml');
      case 'cursor': return path.join(home(), '.cursor', 'mcp.json');
      default: return null; // trae 无 global MCP
    }
  }
  switch (tool) {
    case 'claude': return path.join(root, '.mcp.json');
    case 'codex': return path.join(root, '.codex', 'config.toml');
    case 'cursor': return path.join(root, '.cursor', 'mcp.json');
    case 'trae': return path.join(root, '.trae', 'mcp.json');
    default: return null;
  }
}

export function getToolSkillsPath(root: string, tool: string, scope: 'global' | 'project'): string | null {
  if (scope === 'global') {
    switch (tool) {
      case 'codex':
      case 'claude': return path.join(home(), '.agents', 'skills');
      case 'cursor': return path.join(home(), '.cursor', 'skills');
      case 'trae': return path.join(home(), '.trae', 'skills');
      default: return null;
    }
  }
  switch (tool) {
    case 'codex':
    case 'claude': return path.join(root, '.agents', 'skills');
    case 'cursor': return path.join(root, '.cursor', 'skills');
    case 'trae': return path.join(root, '.trae', 'skills');
    default: return null;
  }
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/config.ts electron/test/config.test.ts
git commit -m "feat(core): workspace 配置加载与工具路径映射"
```

## Task 4: core/workspace（仓库注册/列表/校验）

**Files:**
- Create: `electron/src/core/workspace.ts`
- Test: `electron/test/workspace.test.ts`

**Interfaces:**
- Consumes: `WorkspaceError`/`ErrorCodes`（Task 2）、`gitRoot`/`isGitInstalled`（Task 2）
- Produces:
  - `interface Repo { id; path; name; addedAt; lastSyncAt? }`
  - `class WorkspaceStore { constructor(file: string); load(); add(dir); remove(id); get(id); update(repo); assertAiwsInstalled(root) }`
    - `add` 验证 git + 去重（按真实 git root），返回已存在或新建的 `Repo`
    - `assertAiwsInstalled(root)` 检查 `.ai-workspace/scripts/aiws` 存在，缺则抛 `AiwsNotInstalled`

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/workspace.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/core/workspace';
import { runGit } from '../src/core/git';
import { WorkspaceError, ErrorCodes } from '../src/core/errors';

async function makeGitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-repo-'));
  await runGit(['init'], { cwd: dir });
  return dir;
}

test('add 非 git 目录抛 NotAGitRepo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const store = new WorkspaceStore(path.join(dir, 'repos.json'));
  await assert.rejects(store.add(dir), (e: any) => e.code === ErrorCodes.NotAGitRepo);
});

test('add 同一 git 根去重并持久化', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const store = new WorkspaceStore(path.join(dir, 'repos.json'));
  const repoDir = await makeGitRepo();
  const a = await store.add(repoDir);
  const b = await store.add(repoDir); // 同一根，应返回同一 id
  assert.strictEqual(a.id, b.id);
  assert.strictEqual((await store.load()).length, 1);
});

test('assertAiwsInstalled 缺 aiws 脚本抛 AiwsNotInstalled', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aiws-'));
  const store = new WorkspaceStore(path.join(dir, 'repos.json'));
  const repoDir = await makeGitRepo();
  await assert.rejects(store.assertAiwsInstalled(repoDir), (e: any) => e.code === ErrorCodes.AiwsNotInstalled);
});

test('assertAiwsInstalled 通过', async () => {
  const repoDir = await makeGitRepo();
  mkdirSync(path.join(repoDir, '.ai-workspace', 'scripts'), { recursive: true });
  writeFileSync(path.join(repoDir, '.ai-workspace', 'scripts', 'aiws'), '#!/bin/sh\n');
  const store = new WorkspaceStore(path.join(repoDir, '.repos.json'));
  const aiwsDir = await store.assertAiwsInstalled(repoDir);
  assert.ok(aiwsDir.endsWith('.ai-workspace'));
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/workspace.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceError, ErrorCodes } from './errors';
import { gitRoot, isGitInstalled } from './git';

export interface Repo {
  id: string;
  path: string;
  name: string;
  addedAt: string;
  lastSyncAt?: string;
}

interface ReposFile {
  repos: Repo[];
}

export class WorkspaceStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Repo[]> {
    try {
      const raw: ReposFile = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return Array.isArray(raw.repos) ? raw.repos : [];
    } catch {
      return [];
    }
  }

  private async save(repos: Repo[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ repos }, null, 2), 'utf8');
  }

  async add(dir: string): Promise<Repo> {
    if (!(await isGitInstalled())) {
      throw new WorkspaceError(ErrorCodes.GitNotInstalled, '未检测到 git，请安装 Command Line Tools');
    }
    const root = await gitRoot(dir);
    const repos = await this.load();
    const existing = repos.find((r) => r.path === root);
    if (existing) return existing;
    const repo: Repo = {
      id: randomUUID(),
      path: root,
      name: path.basename(root),
      addedAt: new Date().toISOString(),
    };
    repos.push(repo);
    await this.save(repos);
    return repo;
  }

  async remove(id: string): Promise<void> {
    const repos = await this.load();
    await this.save(repos.filter((r) => r.id !== id));
  }

  async get(id: string): Promise<Repo> {
    const repos = await this.load();
    const repo = repos.find((r) => r.id === id);
    if (!repo) throw new WorkspaceError(ErrorCodes.WorkspaceNotFound, '仓库不存在或已被移除');
    return repo;
  }

  async update(repo: Repo): Promise<void> {
    const repos = await this.load();
    const i = repos.findIndex((r) => r.id === repo.id);
    if (i < 0) throw new WorkspaceError(ErrorCodes.WorkspaceNotFound, '仓库不存在或已被移除');
    repos[i] = repo;
    await this.save(repos);
  }

  async assertAiwsInstalled(root: string): Promise<string> {
    const aiwsDir = path.join(root, '.ai-workspace');
    try {
      await fs.access(path.join(aiwsDir, 'scripts', 'aiws'));
      return aiwsDir;
    } catch {
      throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, `'${root}' 未初始化 AI Workspace（缺 ${path.join(aiwsDir, 'scripts', 'aiws')}）`);
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/workspace.ts electron/test/workspace.test.ts
git commit -m "feat(core): 仓库注册/列表/校验（WorkspaceStore）"
```

## Task 5: core/rules（规则列表 + 装载开关）

**Files:**
- Create: `electron/src/core/rules.ts`
- Test: `electron/test/rules.test.ts`

**Interfaces:**
- Consumes: `listRules` 需要的 `.ai-workspace/rules/**` 与 `adapters/cursor/mapping.yaml`
- Produces:
  - `interface Rule { id; scope; globs; required; domain }`
  - `listRules(root): Promise<Rule[]>`（读 canonical 规则 + cursor mapping 的 required）
  - `setRuleRequired(root, tool, id, domain, value): Promise<void>`
  - `ruleGlobs(fileContent, scope): string`（frontmatter globs 行/块 → scope 默认，与 `rules-generate.sh` 一致）

- [ ] **Step 1: 写失败测试**（构造临时 workspace fixtures）

```ts
// electron/test/rules.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listRules, setRuleRequired, ruleGlobs } from '../src/core/rules';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-rules-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# Core\n');
  writeFileSync(
    path.join(aiws, 'rules', 'domains', 'vue3.md'),
    '---\nid: vue3\ntitle: Vue3\nscope: vue\n---\n# Vue3\n'
  );
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n  - source: rules/domains/vue3.md\n    required: false\n'
  );
  return root;
}

test('listRules 读取规则 + required 与 domain 标志', async () => {
  const root = makeWorkspace();
  const rules = await listRules(root);
  assert.strictEqual(rules.length, 2);
  const core = rules.find((r) => r.id === '00-core')!;
  assert.strictEqual(core.required, true);
  assert.strictEqual(core.domain, false);
  assert.strictEqual(core.scope, 'all');
  const vue = rules.find((r) => r.id === 'vue3')!;
  assert.strictEqual(vue.required, false);
  assert.strictEqual(vue.domain, true);
  assert.strictEqual(vue.globs, '**/*.{vue,ts,js,css,scss}');
});

test('setRuleRequired 切换 required 并回读', async () => {
  const root = makeWorkspace();
  await setRuleRequired(root, 'cursor', 'vue3', true, true);
  const rules = await listRules(root);
  assert.strictEqual(rules.find((r) => r.id === 'vue3')!.required, true);
});

test('ruleGlobs 优先级：frontmatter 行 > scope 默认', () => {
  assert.strictEqual(ruleGlobs('---\nglobs: "**/*.ts"\n---\n', 'all'), '**/*.ts');
  assert.strictEqual(ruleGlobs('---\nscope: csharp\n---\n', 'csharp'), '**/*.{cs,csproj,sln}');
  assert.strictEqual(ruleGlobs('---\n---\n', 'all'), '**/*');
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/rules.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Rule {
  id: string;
  scope: string;
  globs: string;
  required: boolean;
  domain: boolean;
}

export function ruleGlobs(fileContent: string, scope: string): string {
  const inline = fileContent.match(/^globs:\s*(.+)$/m)?.[1]?.trim();
  if (inline) return inline;
  const lines = fileContent.split('\n');
  const blockIdx = lines.findIndex((l) => /^globs:\s*$/.test(l));
  if (blockIdx >= 0) {
    const exts: string[] = [];
    for (let i = blockIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s*-\s*["']?(.+?)["']?\s*$/);
      if (!m) break;
      exts.push(m[1].replace(/^\*\*\/\*\./, ''));
    }
    if (exts.length) return `**/*.{${exts.join(',')}}`;
  }
  switch (scope) {
    case 'csharp': return '**/*.{cs,csproj,sln}';
    case 'vue': return '**/*.{vue,ts,js,css,scss}';
    default: return '**/*';
  }
}

function mappingRequired(mapping: string, rel: string): boolean {
  const lines = mapping.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`source: ${rel}`)) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*- source:/.test(lines[j])) break;
        const m = lines[j].match(/^\s*required:\s*(true|false)/);
        if (m) return m[1] === 'true';
      }
      return false;
    }
  }
  return false;
}

export async function listRules(root: string): Promise<Rule[]> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const rulesDir = path.join(aiwsDir, 'rules');
  const mapping = await fs.readFile(path.join(aiwsDir, 'adapters', 'cursor', 'mapping.yaml'), 'utf8').catch(() => '');
  const out: Rule[] = [];
  for (const sub of ['', 'domains']) {
    const dir = path.join(rulesDir, sub);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files.filter((f) => f.endsWith('.md')).sort()) {
      const content = await fs.readFile(path.join(dir, f), 'utf8');
      const domain = sub === 'domains';
      const rel = domain ? `rules/domains/${f}` : `rules/${f}`;
      const scope = (content.match(/^scope:\s*(.+)$/m)?.[1] || 'all').trim();
      out.push({
        id: f.replace(/\.md$/, ''),
        scope,
        globs: ruleGlobs(content, scope),
        required: mappingRequired(mapping, rel),
        domain,
      });
    }
  }
  return out;
}

export async function setRuleRequired(root: string, tool: string, id: string, domain: boolean, value: boolean): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const rel = domain ? `rules/domains/${id}.md` : `rules/${id}.md`;
  const file = path.join(aiwsDir, 'adapters', tool, 'mapping.yaml');
  const mapping = await fs.readFile(file, 'utf8');
  const lines = mapping.split('\n');
  const idx = lines.findIndex((l) => l.includes(`source: ${rel}`));
  if (idx < 0) throw new Error(`规则 ${rel} 不在 ${tool} 的 mapping 中`);
  let j = idx;
  while (j < lines.length && !lines[j].match(/^\s*required:\s*(true|false)/)) j++;
  if (j >= lines.length) throw new Error(`规则 ${rel} 缺少 required 字段`);
  lines[j] = lines[j].replace(/required:\s*(true|false)/, `required: ${value}`);
  await fs.writeFile(file, lines.join('\n'), 'utf8');
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/rules.ts electron/test/rules.test.ts
git commit -m "feat(core): 规则列表与装载开关（mapping.yaml 读写）"
```

## Task 6: core/mcp（列表/增删/合并/scope 过滤）

**Files:**
- Create: `electron/src/core/mcp.ts`
- Test: `electron/test/mcp.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface McpServer { name; command?; url?; args?; scope?; [key]: unknown }`
  - `listMcp(root): Promise<McpServer[]>`
  - `addMcp(root, name, command, args?)`（scope 默认 `['project']`，与 `mcp_add` 一致）
  - `removeMcp(root, name)`
  - `mergeLocalMcp(base, local)`、`getServersForScope(servers, scope)`

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/mcp.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listMcp, addMcp, removeMcp, mergeLocalMcp, getServersForScope } from '../src/core/mcp';

function makeWorkspace(servers: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-mcp-'));
  mkdirSync(path.join(root, '.ai-workspace', 'mcp'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace', 'mcp', 'mcp.json'), JSON.stringify({ servers }, null, 2));
  return root;
}

test('listMcp 返回 name + command', async () => {
  const root = makeWorkspace({ filesystem: { command: 'npx', args: ['-y', 'x'] } });
  const list = await listMcp(root);
  assert.deepStrictEqual(list, [{ name: 'filesystem', command: 'npx', args: ['-y', 'x'] }]);
});

test('addMcp 写入 scope 默认 project', async () => {
  const root = makeWorkspace({});
  await addMcp(root, 'server-a', 'npx', ['-y', 'b']);
  const list = await listMcp(root);
  assert.deepStrictEqual(list, [{ name: 'server-a', command: 'npx', args: ['-y', 'b'], scope: ['project'] }]);
});

test('removeMcp 删除', async () => {
  const root = makeWorkspace({ a: { command: 'x' }, b: { command: 'y' } });
  await removeMcp(root, 'a');
  assert.deepStrictEqual((await listMcp(root)).map((s) => s.name), ['b']);
});

test('getServersForScope 过滤', () => {
  const servers = {
    g: { command: 'x', scope: ['global'] },
    b: { command: 'y', scope: ['global', 'project'] },
    n: { command: 'z' },
  };
  const project = getServersForScope(servers, 'project');
  assert.deepStrictEqual(Object.keys(project).sort(), ['b', 'n']);
});

test('mergeLocalMcp 本地覆盖', () => {
  const merged = mergeLocalMcp({ a: { command: 'x' } }, { a: { command: 'y' } });
  assert.strictEqual(merged.a.command, 'y');
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/mcp.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface McpServer {
  name: string;
  command?: string;
  url?: string;
  args?: string[];
  scope?: string[];
  [key: string]: unknown;
}

export type McpServersMap = Record<string, Omit<McpServer, 'name'>>;

async function readServers(aiwsDir: string): Promise<McpServersMap> {
  const file = path.join(aiwsDir, 'mcp', 'mcp.json');
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    return raw.servers ?? {};
  } catch {
    return {};
  }
}

async function writeServers(aiwsDir: string, servers: McpServersMap): Promise<void> {
  const file = path.join(aiwsDir, 'mcp', 'mcp.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ servers }, null, 2), 'utf8');
}

export async function listMcp(root: string): Promise<McpServer[]> {
  const servers = await readServers(path.join(root, '.ai-workspace'));
  return Object.entries(servers).map(([name, s]) => ({
    name,
    command: (s.command as string | undefined) ?? (s.url as string | undefined) ?? '',
    ...s,
  }));
}

export async function addMcp(root: string, name: string, command: string, args?: string[]): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const servers = await readServers(aiwsDir);
  servers[name] = args?.length
    ? { command, args, scope: ['project'] }
    : { command, scope: ['project'] };
  await writeServers(aiwsDir, servers);
}

export async function removeMcp(root: string, name: string): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const servers = await readServers(aiwsDir);
  delete servers[name];
  await writeServers(aiwsDir, servers);
}

export function mergeLocalMcp(base: McpServersMap, local: McpServersMap): McpServersMap {
  return { ...base, ...local };
}

export function getServersForScope(servers: McpServersMap, scope: string): McpServersMap {
  const out: McpServersMap = {};
  for (const [name, s] of Object.entries(servers)) {
    if (!s.scope || s.scope.includes(scope)) out[name] = s;
  }
  return out;
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/mcp.ts electron/test/mcp.test.ts
git commit -m "feat(core): MCP 列表/增删/合并/scope 过滤"
```

## Task 7: core/skills（列表/链接/卸载）

**Files:**
- Create: `electron/src/core/skills.ts`
- Test: `electron/test/skills.test.ts`

**Interfaces:**
- Consumes: `loadConfig`、`getToolSkillsPath`（Task 3）
- Produces:
  - `interface Skill { name; description; linkStatus: Record<tool, {global; project}> }`
  - `listSkills(root): Promise<Skill[]>`
  - `linkSkills(root, scope, tool?): Promise<{count}>`（symlink 到工具 skills 目录）
  - `unlinkSkills(root, scope, tool?): Promise<{count}>`

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/skills.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSkills, linkSkills, unlinkSkills } from '../src/core/skills';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-skills-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'skills', 'ask-matt'), { recursive: true });
  writeFileSync(path.join(aiws, 'skills', 'ask-matt', 'SKILL.md'), '---\nname: ask-matt\ndescription: 提问\n---\n');
  return root;
}

test('listSkills 返回描述与 linkStatus', async () => {
  const root = makeWorkspace();
  const skills = await listSkills(root);
  assert.strictEqual(skills.length, 1);
  assert.strictEqual(skills[0].name, 'ask-matt');
  assert.strictEqual(skills[0].description, '提问');
  assert.strictEqual(typeof skills[0].linkStatus.cursor.global, 'boolean');
});

test('linkSkills 建符号链接到工具 skills 目录', async () => {
  const root = makeWorkspace();
  const res = await linkSkills(root, 'project', 'cursor');
  assert.ok(res.count >= 1);
  const target = path.join(root, '.cursor', 'skills', 'ask-matt');
  assert.ok(res.count >= 1, '至少链接一个');
  const skills = await listSkills(root);
  assert.strictEqual(skills[0].linkStatus.cursor.project, true);
});

test('unlinkSkills 移除链接', async () => {
  const root = makeWorkspace();
  await linkSkills(root, 'project', 'cursor');
  await unlinkSkills(root, 'project', 'cursor');
  const skills = await listSkills(root);
  assert.strictEqual(skills[0].linkStatus.cursor.project, false);
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/skills.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig, getToolSkillsPath } from './config';

export interface Skill {
  name: string;
  description: string;
  linkStatus: Record<string, { global: boolean; project: boolean }>;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

export async function listSkills(root: string): Promise<Skill[]> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const out: Skill[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const skillMd = path.join(skillsDir, d.name, 'SKILL.md');
    if (!(await exists(skillMd))) continue;
    const content = await fs.readFile(skillMd, 'utf8');
    const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const linkStatus: Record<string, { global: boolean; project: boolean }> = {};
    for (const tool of cfg.tools) {
      const g = getToolSkillsPath(root, tool, 'global');
      const p = getToolSkillsPath(root, tool, 'project');
      linkStatus[tool] = {
        global: g ? await exists(path.join(g, d.name)) : false,
        project: p ? await exists(path.join(p, d.name)) : false,
      };
    }
    out.push({ name: d.name, description, linkStatus });
  }
  return out;
}

export async function linkSkills(root: string, scope: 'global' | 'project', tool?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const tools = tool ? [tool] : cfg.tools;
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  let count = 0;
  for (const t of tools) {
    const base = getToolSkillsPath(root, t, scope);
    if (!base) continue;
    await fs.mkdir(base, { recursive: true });
    for (const d of dirs) {
      if (!d.isDirectory() || !(await exists(path.join(skillsDir, d.name, 'SKILL.md')))) continue;
      const target = path.join(base, d.name);
      await fs.rm(target, { recursive: true, force: true });
      await fs.symlink(path.join(skillsDir, d.name), target, 'dir');
      count++;
    }
  }
  return { count };
}

export async function unlinkSkills(root: string, scope: 'global' | 'project', tool?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const skillsDir = path.join(aiwsDir, 'skills');
  const cfg = await loadConfig(aiwsDir);
  const tools = tool ? [tool] : cfg.tools;
  const dirs = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const skillNames = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
  let count = 0;
  for (const t of tools) {
    const base = getToolSkillsPath(root, t, scope);
    if (!base) continue;
    for (const name of skillNames) {
      const target = path.join(base, name);
      if (await exists(target)) {
        await fs.rm(target, { recursive: true, force: true });
        count++;
      }
    }
  }
  return { count };
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/skills.ts electron/test/skills.test.ts
git commit -m "feat(core): 技能列表/链接/卸载（symlink）"
```

## Task 8: core/sync（规则生成 + sync 编排）

**Files:**
- Create: `electron/src/core/sync.ts`
- Test: `electron/test/sync.test.ts`

**Interfaces:**
- Consumes: `listRules`/`ruleGlobs`（Task 5）、`listMcp`/`mergeLocalMcp`/`getServersForScope`（Task 6）、`loadConfig`/`getToolMcpPath`（Task 3）
- Produces:
  - `generateRuleFiles(root, tool: 'cursor'|'trae', targetScope?): Promise<{count}>`（清空 out_dir 后按 mapping/scope 生成，frontmatter 与 `rules-generate.sh` 一致）
  - `syncRun(root, opts?: {scope?; tool?}, signal?): AsyncGenerator<string>`（逐行产出进度，main 实时推送；yield 前检查 `signal.aborted`）
  - `syncMcpForTool(root, tool, scope)`（写 JSON/TOML 到目标路径，scope 过滤 + 去内部字段）

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/sync.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { generateRuleFiles, syncRun } from '../src/core/sync';

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-sync-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules', 'domains'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'trae'), { recursive: true });
  mkdirSync(path.join(aiws, 'mcp'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\ntitle: Core\nscope: all\n---\n# Core Body\n');
  writeFileSync(
    path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'),
    'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n'
  );
  writeFileSync(
    path.join(aiws, 'adapters', 'trae', 'mapping.yaml'),
    'tool: trae\nrules:\n  - source: rules/00-core.md\n    required: true\n'
  );
  writeFileSync(
    path.join(aiws, 'mcp', 'mcp.json'),
    JSON.stringify({ servers: { fs: { command: 'npx', scope: ['project'] } } })
  );
  return root;
}

test('generateRuleFiles 生成 cursor .mdc 带 frontmatter 与正文', async () => {
  const root = makeWorkspace();
  const { count } = await generateRuleFiles(root, 'cursor');
  assert.strictEqual(count, 1);
  const out = await fs.readFile(path.join(root, '.cursor', 'rules', '00-core.mdc'), 'utf8');
  assert.match(out, /alwaysApply: true/);
  assert.match(out, /globs: "\*\*\/\*"/);
  assert.match(out, /# Core Body/);
});

test('generateRuleFiles 清空陈旧文件（幂等）', async () => {
  const root = makeWorkspace();
  mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true });
  writeFileSync(path.join(root, '.cursor', 'rules', 'stale.mdc'), 'old');
  await generateRuleFiles(root, 'cursor');
  const files = await fs.readdir(path.join(root, '.cursor', 'rules'));
  assert.deepStrictEqual(files, ['00-core.mdc']);
});

test('syncRun 产出进度行并完成 MCP 同步', async () => {
  const root = makeWorkspace();
  const lines: string[] = [];
  for await (const line of syncRun(root)) lines.push(line);
  assert.ok(lines.some((l) => l.includes('已生成')));
  const mcpOut = await fs.readFile(path.join(root, '.cursor', 'mcp.json'), 'utf8');
  assert.ok(mcpOut.includes('mcpServers'));
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/sync.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listRules } from './rules';
import { loadConfig, getToolMcpPath } from './config';
import { listMcp, mergeLocalMcp, getServersForScope, McpServersMap } from './mcp';

export interface SyncOptions {
  scope?: 'global' | 'project';
  tool?: string;
}

function stripFrontmatter(content: string): string {
  const lines = content.split('\n');
  let c = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^---$/.test(lines[i])) {
      c++;
      if (c === 2) { i++; break; }
    }
  }
  return lines.slice(i).join('\n');
}

export async function generateRuleFiles(root: string, tool: 'cursor' | 'trae', targetScope?: string): Promise<{ count: number }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const ext = tool === 'cursor' ? '.mdc' : '.md';
  const outDir = tool === 'cursor' ? path.join(root, '.cursor', 'rules') : path.join(root, '.trae', 'rules');
  const mappingFile = path.join(aiwsDir, 'adapters', tool, 'mapping.yaml');
  const mapping = await fs.readFile(mappingFile, 'utf8').catch(() => '');

  await fs.mkdir(outDir, { recursive: true });
  for (const f of await fs.readdir(outDir).catch(() => [] as string[])) {
    await fs.rm(path.join(outDir, f), { force: true });
  }

  const rules = await listRules(root);
  let count = 0;
  for (const rule of rules) {
    if (targetScope === 'global' && rule.domain) continue;
    if (targetScope === 'project' && !rule.domain) continue;
    const rel = rule.domain ? `rules/domains/${rule.id}.md` : `rules/${rule.id}.md`;
    if (!mapping.includes(`source: ${rel}`)) continue;

    const srcFile = path.join(aiwsDir, 'rules', rule.domain ? 'domains' : '', `${rule.id}.md`);
    const content = await fs.readFile(srcFile, 'utf8');
    const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim()
      ?? content.match(/^title:\s*(.+)$/m)?.[1]?.trim()
      ?? rule.id;
    const scene = tool === 'cursor' && (rule.id === '05-version-control' || rule.id === 'global-workflow')
      ? 'scene: git_message'
      : '';

    const front = [
      '---',
      '# Generated by AI Workspace - DO NOT EDIT MANUALLY',
      `description: ${description}`,
      `globs: "${rule.globs}"`,
      `alwaysApply: ${rule.required}`,
      scene,
      '---',
    ].filter((l) => l !== '').join('\n');

    const body = stripFrontmatter(content);
    await fs.writeFile(path.join(outDir, `${rule.id}${ext}`), `${front}\n${body}\n`, 'utf8');
    count++;
  }
  return { count };
}

function jsonToToml(servers: McpServersMap): string {
  const out: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    out.push(`[mcp_servers.${name}]`);
    if (s.command) out.push(`command = "${s.command}"`);
    if (s.args?.length) out.push(`args = [${s.args.map((a) => `"${a}"`).join(', ')}]`);
    if (s.url) out.push(`url = "${s.url}"`);
    out.push('');
  }
  return out.join('\n');
}

export async function syncMcpForTool(root: string, tool: string, scope: 'global' | 'project'): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const targetPath = getToolMcpPath(root, tool, scope);
  if (!targetPath) return;
  const base = await listMcp(root).then((list) => {
    const m: McpServersMap = {};
    for (const s of list) { const { name, ...rest } = s; m[name] = rest; }
    return m;
  });
  const local = await fs.readFile(path.join(aiwsDir, 'mcp', 'mcp.local.json'), 'utf8')
    .then((raw) => (JSON.parse(raw).servers ?? {}) as McpServersMap)
    .catch(() => ({} as McpServersMap));
  const merged = mergeLocalMcp(base, local);
  const servers = getServersForScope(merged, scope);
  const clean: McpServersMap = {};
  for (const [name, s] of Object.entries(servers)) {
    const { scope: _scope, ...rest } = s;
    clean[name] = rest;
  }
  if (!Object.keys(clean).length) return;
  const output = tool === 'codex' ? jsonToToml(clean) : JSON.stringify({ mcpServers: clean }, null, 2);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, output + '\n', 'utf8');
}

export async function* syncRun(root: string, opts: SyncOptions = {}, signal?: AbortSignal): AsyncGenerator<string> {
  yield '开始同步';
  const aiwsDir = path.join(root, '.ai-workspace');
  const cfg = await loadConfig(aiwsDir);
  const tools = opts.tool ? [opts.tool] : cfg.tools;
  const scopes: Array<'global' | 'project'> = opts.scope ? [opts.scope] : ['global', 'project'];

  if (signal?.aborted) return;
  yield '同步规则...';
  for (const tool of tools) {
    if (tool === 'cursor' || tool === 'trae') {
      const { count } = await generateRuleFiles(root, tool, opts.scope);
      yield `已生成 ${tool} 规则 ${count} 个`;
    } else {
      yield `跳过 ${tool} 规则生成（单文件模式，暂不支持）`;
    }
  }

  if (signal?.aborted) return;
  yield '同步 MCP...';
  for (const tool of tools) {
    for (const scope of scopes) {
      await syncMcpForTool(root, tool, scope);
    }
  }
  yield '同步完成';
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/sync.ts electron/test/sync.test.ts
git commit -m "feat(core): 规则生成与 sync 编排（AsyncGenerator 进度）"
```

## Task 9: core/diff（行级 diff + 规则对比）

**Files:**
- Create: `electron/src/core/diff.ts`
- Test: `electron/test/diff.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface DiffHunk { removed: string[]; added: string[] }`
  - `interface DiffResult { identical: boolean; hunks: DiffHunk[] }`
  - `diffLines(a, b): DiffResult`（LCS 行 diff）
  - `compareRuleToGenerated(root, tool, ruleId): Promise<{source; generated; diff}>`

- [ ] **Step 1: 写失败测试**

```ts
// electron/test/diff.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { diffLines } from '../src/core/diff';

test('diffLines 相同内容 identical', () => {
  const d = diffLines('a\nb\n', 'a\nb\n');
  assert.strictEqual(d.identical, true);
  assert.strictEqual(d.hunks.length, 0);
});

test('diffLines 识别增删 hunk', () => {
  const d = diffLines('a\nb\n', 'a\nX\nb\n');
  assert.strictEqual(d.identical, false);
  assert.strictEqual(d.hunks.length, 1);
  assert.deepStrictEqual(d.hunks[0].added, ['X']);
});

test('diffLines 多 hunk', () => {
  const d = diffLines('a\nb\nc\n', 'a\nX\nc\nY\n');
  assert.ok(d.hunks.length >= 2);
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/diff.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DiffHunk {
  removed: string[];
  added: string[];
}

export interface DiffResult {
  identical: boolean;
  hunks: DiffHunk[];
}

export function diffLines(a: string, b: string): DiffResult {
  const A = a.replace(/\n$/, '').split('\n');
  const B = b.replace(/\n$/, '').split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; continue; }
    const h: DiffHunk = { removed: [], added: [] };
    while (i < n && !(j < m && A[i] === B[j])) h.removed.push(A[i++]);
    while (j < m && !(i < n && A[i] === B[j])) h.added.push(B[j++]);
    hunks.push(h);
  }
  return { identical: hunks.length === 0, hunks };
}

export async function compareRuleToGenerated(
  root: string,
  tool: 'cursor' | 'trae',
  ruleId: string
): Promise<{ source: string; generated: string; diff: DiffResult }> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const domain = await fs.access(path.join(aiwsDir, 'rules', 'domains', `${ruleId}.md`))
    .then(() => true)
    .catch(() => false);
  const sourceFile = path.join(aiwsDir, 'rules', domain ? 'domains' : '', `${ruleId}.md`);
  const ext = tool === 'cursor' ? '.mdc' : '.md';
  const generatedFile = path.join(root, tool === 'cursor' ? '.cursor' : '.trae', 'rules', `${ruleId}${ext}`);
  const source = await fs.readFile(sourceFile, 'utf8');
  const generated = await fs.readFile(generatedFile, 'utf8').catch(() => '');
  return { source, generated, diff: diffLines(source, generated) };
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add electron/src/core/diff.ts electron/test/diff.test.ts
git commit -m "feat(core): 行级 diff 与规则对比"
```

---
---

# Phase 2：main 进程

## Task 10: main/IPC 接线（invoke handlers + 错误序列化 + vault 桥接）

**Files:**
- Create: `electron/src/core/vault-bridge.ts`
- Create: `electron/src/main/ipc.ts`
- Modify: `electron/src/main/index.ts`（`whenReady` 调 `registerIpc()`）
- Test: `electron/test/vault-bridge.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStore`（Task 4）、`rules`（Task 5）、`mcp`（Task 6）、`skills`（Task 7）、`sync`（Task 8）、`diff`（Task 9）、`IPC` 常量（Task 1）
- Produces:
  - `registerIpc()` 注册全部 invoke handlers（`workspace:*`、`rules:*`、`mcp:*`、`skills:*`、`secrets:*`、`sync:run`、`sync:all`、`sync:cancel`、`diff:compare`）
  - 错误统一包装：`handle(channel, fn)` 捕获 `WorkspaceError`/`Error` → 返回 `{ok:false, code, message}`；成功返回 `{ok:true, data}`
  - `runAiwsBridge(args): Promise<{stdout; stderr; code}>`（spawn `.ai-workspace/scripts/aiws`，密钥只读用）

- [ ] **Step 1: 写失败测试**（vault-bridge 的 spawn 逻辑）

```ts
// electron/test/vault-bridge.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAiwsBridge } from '../src/core/vault-bridge';
import { WorkspaceError, ErrorCodes } from '../src/core/errors';

test('runAiwsBridge 缺 aiws 脚本抛 AiwsNotInstalled', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-bridge-'));
  await assert.rejects(runAiwsBridge(root, ['secrets', 'list']), (e: any) => e.code === ErrorCodes.AiwsNotInstalled);
});

test('runAiwsBridge 执行 --version', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-bridge-'));
  mkdirSync(path.join(root, '.ai-workspace', 'scripts'), { recursive: true });
  writeFileSync(path.join(root, '.ai-workspace', 'scripts', 'aiws'), '#!/bin/sh\necho "bridge ok $*"\n', { mode: 0o755 });
  const res = await runAiwsBridge(root, ['--version']);
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /bridge ok/);
});
```

- [ ] **Step 2: 运行测试验证失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `core/vault-bridge.ts`**

```ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import { WorkspaceError, ErrorCodes } from './errors';

export async function runAiwsBridge(
  root: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const aiws = path.join(root, '.ai-workspace', 'scripts', 'aiws');
  return new Promise((resolve) => {
    execFile(aiws, args, { cwd: root, timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        if (typeof (err as { code?: unknown }).code === 'number') {
          resolve({ stdout: String(stdout), stderr: String(stderr), code: (err as { code: number }).code });
          return;
        }
        if (String((err as { message?: string }).message ?? '').includes('ENOENT')) {
          resolve({ stdout: '', stderr: '', code: 127 });
          return;
        }
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
    });
  });
}

export async function assertAiws(root: string): Promise<void> {
  const aiws = path.join(root, '.ai-workspace', 'scripts', 'aiws');
  const res = await runAiwsBridge(root, ['--version']);
  if (res.code === 127 || res.code === 126) {
    throw new WorkspaceError(ErrorCodes.AiwsNotInstalled, `'${root}' 未初始化 AI Workspace（缺 ${aiws}）`);
  }
}
```

- [ ] **Step 4: 运行测试验证通过** → 全部 PASS

- [ ] **Step 5: 实现 `main/ipc.ts`**

```ts
import { ipcMain, app } from 'electron';
import path from 'node:path';
import { WorkspaceStore, Repo } from '../core/workspace';
import { WorkspaceError, ErrorCodes } from '../core/errors';
import { IPC } from '../shared/ipc';
import * as rulesApi from '../core/rules';
import * as mcpApi from '../core/mcp';
import * as skillsApi from '../core/skills';
import { syncRun } from '../core/sync';
import { compareRuleToGenerated } from '../core/diff';
import { runAiwsBridge } from '../core/vault-bridge';

const store = new WorkspaceStore(path.join(app.getPath('userData'), 'repos.json'));

type Handler<TArgs, TResult> = (args: TArgs) => Promise<TResult>;

function handle<TArgs, TResult>(channel: string, fn: Handler<TArgs, TResult>) {
  ipcMain.handle(channel, async (_event, args: TArgs) => {
    try {
      const data = await fn(args);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, code: 'InternalError', message: err instanceof Error ? err.message : String(err) };
    }
  });
}

interface SyncState {
  controller: AbortController;
}
const syncStates = new Map<string, SyncState>();

export function registerIpc() {
  handle(IPC.WorkspaceList, () => store.load());
  handle(IPC.WorkspaceAdd, (dir: string) => store.add(dir));
  handle(IPC.WorkspaceRemove, (id: string) => store.remove(id));

  handle(IPC.RulesList, async (repoId: string) => {
    const repo = await store.get(repoId);
    return rulesApi.listRules(repo.path);
  });
  handle(IPC.RulesSetRequired, async (args: { repoId: string; tool: string; id: string; domain: boolean; value: boolean }) => {
    const repo = await store.get(args.repoId);
    await rulesApi.setRuleRequired(repo.path, args.tool, args.id, args.domain, args.value);
  });

  handle(IPC.McpList, async (repoId: string) => {
    const repo = await store.get(repoId);
    return mcpApi.listMcp(repo.path);
  });
  handle(IPC.McpAdd, async (args: { repoId: string; name: string; command: string; args?: string[] }) => {
    const repo = await store.get(args.repoId);
    await mcpApi.addMcp(repo.path, args.name, args.command, args.args);
  });
  handle(IPC.McpRemove, async (args: { repoId: string; name: string }) => {
    const repo = await store.get(args.repoId);
    await mcpApi.removeMcp(repo.path, args.name);
  });

  handle(IPC.SkillsList, async (repoId: string) => {
    const repo = await store.get(repoId);
    return skillsApi.listSkills(repo.path);
  });
  handle(IPC.SkillsLink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string }) => {
    const repo = await store.get(args.repoId);
    return skillsApi.linkSkills(repo.path, args.scope, args.tool);
  });
  handle(IPC.SkillsUnlink, async (args: { repoId: string; scope: 'global' | 'project'; tool?: string }) => {
    const repo = await store.get(args.repoId);
    return skillsApi.unlinkSkills(repo.path, args.scope, args.tool);
  });

  handle(IPC.SecretsList, async (repoId: string) => {
    const repo = await store.get(repoId);
    const res = await runAiwsBridge(repo.path, ['secrets', 'list', '--json']);
    return safeParse(res.stdout);
  });
  handle(IPC.SecretsAudit, async (repoId: string) => {
    const repo = await store.get(repoId);
    const res = await runAiwsBridge(repo.path, ['secrets', 'audit', '--json']);
    return safeParse(res.stdout);
  });

  handle(IPC.SyncRun, async (args: { repoId: string; tool?: string }) => {
    const repo = await store.get(args.repoId);
    const controller = new AbortController();
    syncStates.set(repo.id, { controller });
    try {
      for await (const line of syncRun(repo.path, { tool: args.tool }, controller.signal)) {
        BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.SyncProgress, { repoId: repo.id, line }));
      }
      await store.update({ ...repo, lastSyncAt: new Date().toISOString() });
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.SyncDone, { repoId: repo.id }));
      return { count: repo.id.length > 0 ? 1 : 1 }; // 成功信号
    } finally {
      syncStates.delete(repo.id);
    }
  });
  handle(IPC.SyncCancel, async (repoId: string) => {
    const state = syncStates.get(repoId);
    if (state) state.controller.abort();
  });

  handle(IPC.SyncAll, async () => {
    const repos = await store.load();
    for (const repo of repos) {
      const controller = new AbortController();
      syncStates.set(repo.id, { controller });
      try {
        for await (const line of syncRun(repo.path, {}, controller.signal)) {
          BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.SyncProgress, { repoId: repo.id, line }));
        }
        await store.update({ ...repo, lastSyncAt: new Date().toISOString() });
        BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.SyncDone, { repoId: repo.id }));
      } finally {
        syncStates.delete(repo.id);
      }
    }
    return { ok: true };
  });

  handle(IPC.DiffCompare, async (args: { repoId: string; tool: 'cursor' | 'trae'; ruleId: string }) => {
    const repo = await store.get(args.repoId);
    return compareRuleToGenerated(repo.path, args.tool, args.ruleId);
  });
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 300) }; }
}
```

> 注意：`ipc.ts` 顶部需 `import { BrowserWindow } from 'electron';`（上面 sync handler 用到）。

- [ ] **Step 6: 修改 `main/index.ts` 接线**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { createTray } from './tray';

// ... createWindow 同 Task 1 ...

app.whenReady().then(() => {
  registerIpc();
  createTray();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **Step 7: 启动验证（无报错）**

```bash
cd electron && npm start
```
Expected: 窗口打开，控制台无未捕获异常。`tray.ts` 尚未实现会报错——先创建一个占位（Step 8 会补），或在 Task 12 前先注释 `createTray()`。

> 说明：Task 12 实现 `tray.ts` 前，可临时注释 `createTray()` 调用让 `npm start` 可跑。

- [ ] **Step 8: 提交**

```bash
git add electron/src/core/vault-bridge.ts electron/src/main/ipc.ts electron/src/main/index.ts electron/test/vault-bridge.test.ts
git commit -m "feat(main): IPC 接线（全模块 handlers、错误包装、vault 只读桥接）"
```

## Task 11: 长任务进度推送（批量化，已含在 Task 10）

**说明：** `sync:run`/`sync:all` 的 AsyncGenerator 进度推送与取消已在 Task 10 的 `ipc.ts` 中实现。本任务为验证——确保 sync 长任务期间 UI 不被阻塞、取消生效。

**Files:**
- Test: `electron/test/sync-cancel.test.ts`（用 `syncRun` + AbortSignal 验证取消）

- [ ] **Step 1: 写取消测试**

```ts
// electron/test/sync-cancel.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncRun } from '../src/core/sync';

test('syncRun 中止后停止产出新行', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aiws-cancel-'));
  const aiws = path.join(root, '.ai-workspace');
  mkdirSync(path.join(aiws, 'rules'), { recursive: true });
  mkdirSync(path.join(aiws, 'adapters', 'cursor'), { recursive: true });
  writeFileSync(path.join(aiws, 'rules', '00-core.md'), '---\nid: 00-core\nscope: all\n---\n# C\n');
  writeFileSync(path.join(aiws, 'adapters', 'cursor', 'mapping.yaml'), 'tool: cursor\nrules:\n  - source: rules/00-core.md\n    required: true\n');
  const controller = new AbortController();
  controller.abort();
  const lines: string[] = [];
  for await (const line of syncRun(root, {}, controller.signal)) lines.push(line);
  assert.ok(lines.length === 0 || lines[lines.length - 1] !== '同步完成');
});
```

- [ ] **Step 2: 运行测试验证通过** → PASS

- [ ] **Step 3: 提交**

```bash
git add electron/test/sync-cancel.test.ts
git commit -m "test(core): sync 取消语义验证"
```

## Task 12: 托盘 + 系统通知

**Files:**
- Create: `electron/src/main/tray.ts`
- Modify: `electron/src/main/index.ts`（已接线）
- Create: `electron/build/tray.png`（占位 16×16 图标）

**Interfaces:**
- Consumes: `store`（从 ipc.ts 导出，或 tray 内建 store）、`syncRun`、`IPC`
- Produces: `createTray()`——托盘菜单：显示窗口 / 快速同步全部 / 退出；sync 完成发系统 `Notification`

- [ ] **Step 1: 导出 store 供 tray 复用**

在 `electron/src/main/ipc.ts` 加 `export { store };`

- [ ] **Step 2: 实现 `main/tray.ts`**

```ts
import { Tray, Menu, app, nativeImage, Notification, BrowserWindow } from 'electron';
import path from 'node:path';
import { store } from './ipc';
import { syncRun } from '../core/sync';
import { IPC } from '../shared/ipc';

export function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'tray.png'))
    .resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip('AI Workspace');

  const showWindow = () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { win.show(); win.focus(); }
  };

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: showWindow },
    {
      label: '快速同步全部',
      click: async () => {
        const repos = await store.load();
        let done = 0;
        for (const repo of repos) {
          for await (const _line of syncRun(repo.path, {})) { /* 静默 */ }
          await store.update({ ...repo, lastSyncAt: new Date().toISOString() });
          done++;
        }
        new Notification({ title: 'AI Workspace', body: `已同步 ${done} 个仓库` }).show();
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  return tray;
}
```

- [ ] **Step 3: 生成占位托盘图标**

```bash
cd electron && mkdir -p build && node -e "const fs=require('fs');fs.writeFileSync('build/tray.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVR42mP8z8Dwn4EIwDiqkL4KAM+OAgdqV8qUAAAAAElFTkSuQmCC','base64'))"
```
> 说明：这是一个 16×16 的纯色占位 PNG，后期替换为正式图标（Task 19）。

- [ ] **Step 4: 启动验证**

```bash
cd electron && npm start
```
Expected: 菜单栏出现托盘图标；右键菜单三项；点击"退出"关闭。

- [ ] **Step 5: 提交**

```bash
git add electron/src/main/tray.ts electron/src/main/ipc.ts electron/build/tray.png
git commit -m "feat(main): 托盘菜单与同步完成通知"
```

---
---

# Phase 3：renderer（React UI）

> UI 冒烟测试集中在 Task 18；各页在实现后手动 `npm start` 验证。样式用 `styles.css` 的类，保持深色简洁（正式视觉打磨可后续用 frontend-design skill）。

## Task 13: App 布局骨架 + 仓库管理页

**Files:**
- Create: `electron/src/renderer/api.ts`（`window.api` 类型化封装）
- Create: `electron/src/renderer/App.tsx`
- Create: `electron/src/renderer/pages/workspaces.tsx`
- Modify: `electron/src/renderer/styles.css`

**Interfaces:**
- Consumes: `IPC` 常量（Task 1）与 preload 的 `window.api`
- Produces:
  - `api.ts` 导出 `invoke<T>(channel, payload?): Promise<ApiResult<T>>`（解包 `{ok, data, code, message}`）与 `onProgress(channel, cb)`
  - `App`：左侧仓库列表 + 右侧内容区 + 顶部 tab 导航 + 底部状态栏；无仓库时显示仓库管理页
  - `WorkspacesPage`：仓库列表 + 添加（文件夹选择经 `dialog` IPC？——renderer 无 dialog 权限，改由 main 提供 `workspace:pick`）——首版用输入路径框

- [ ] **Step 1: 实现 `renderer/api.ts`**

```ts
import { IPC } from '../shared/ipc';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

declare global {
  interface Window {
    api: {
      invoke(channel: string, payload?: unknown): Promise<ApiResult<unknown>>;
      on(channel: string, callback: (data: unknown) => void): () => void;
    };
  }
}

export async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await window.api.invoke(channel, payload)) as ApiResult<T>;
  if (!res.ok) {
    const err = new Error(res.message ?? '操作失败') as Error & { code?: string };
    err.code = res.code;
    throw err;
  }
  return res.data as T;
}

export function onProgress(channel: string, cb: (data: unknown) => void): () => void {
  return window.api.on(channel, cb);
}
```

- [ ] **Step 2: 实现 `App.tsx`**

```tsx
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

function App() {
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

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 3: 实现 `pages/workspaces.tsx`**

```tsx
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
```

- [ ] **Step 4: 补 `styles.css`（布局类）**

```css
.shell { display: flex; height: 100vh; }
.sidebar { width: 240px; border-right: 1px solid #333; padding: 12px; overflow-y: auto; }
.content { flex: 1; display: flex; flex-direction: column; }
.tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid #333; }
.tab { background: transparent; border: none; color: #aaa; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
.tab.active { background: #2f3542; color: #fff; }
.page { flex: 1; padding: 16px 20px; overflow-y: auto; }
.statusbar { border-top: 1px solid #333; padding: 6px 12px; color: #888; font-size: 12px; }
.repo-item { display: block; width: 100%; text-align: left; background: transparent; border: none; color: #ccc; padding: 8px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; }
.repo-item.active { background: #2f3542; }
.repo-name { font-weight: 600; }
.repo-path { font-size: 11px; color: #777; }
.add-repo { margin-top: 12px; width: 100%; padding: 8px; background: #2f3542; border: none; color: #fff; border-radius: 6px; cursor: pointer; }
.input { background: #2a2b30; border: 1px solid #444; color: #eee; padding: 8px 10px; border-radius: 6px; flex: 1; }
.row { display: flex; gap: 8px; }
.error { color: #ff6b6b; margin-top: 8px; }
.muted { color: #777; }
.danger { background: #3a1d1d; color: #ff8080; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
```

- [ ] **Step 5: 手动验证**

```bash
cd electron && npm start
```
Expected: 无仓库时显示管理页；添加本仓库路径 `/Users/xuanyi/Documents/AI-management` 后出现在列表；点仓库进入主界面（其余 tab 暂显示空/报错，后续任务补齐）。

- [ ] **Step 6: 提交**

```bash
git add electron/src/renderer/api.ts electron/src/renderer/App.tsx electron/src/renderer/pages/workspaces.tsx electron/src/renderer/styles.css
git commit -m "feat(renderer): App 布局骨架与仓库管理页"
```

## Task 14: 仪表盘页（状态卡 + 同步日志 + 通知）

**Files:**
- Create: `electron/src/renderer/pages/dashboard.tsx`
- Modify: `electron/src/renderer/App.tsx`（挂载）

**Interfaces:**
- Consumes: `invoke(IPC.RulesList)`、`invoke(IPC.McpList)`、`invoke(IPC.SkillsList)`、`invoke(IPC.SyncRun)`、`onProgress(IPC.SyncProgress)`、`onProgress(IPC.SyncDone)`
- Produces: `<DashboardPage repoId>`——每工具状态卡（规则数/技能数/MCP 数）、一键同步/验证按钮、实时日志面板

- [ ] **Step 1: 实现 `pages/dashboard.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke, onProgress } from '../api';
import { IPC } from '../../shared/ipc';

const TOOLS = ['cursor', 'trae', 'claude', 'codex'];

export function DashboardPage({ repoId }: { repoId: string }) {
  const [rules, setRules] = useState<any[]>([]);
  const [mcp, setMcp] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [r, m, s] = await Promise.all([
        invoke<any[]>(IPC.RulesList, repoId),
        invoke<any[]>(IPC.McpList, repoId),
        invoke<any[]>(IPC.SkillsList, repoId),
      ]);
      setRules(r); setMcp(m); setSkills(s);
    } catch { /* 仓库未初始化等，由各卡降级显示 */ }
  }, [repoId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const offP = onProgress(IPC.SyncProgress, (d) => {
      const { line } = d as { line: string };
      setLog((prev) => [...prev.slice(-200), line]);
    });
    const offD = onProgress(IPC.SyncDone, (d) => {
      const { repoId: doneId } = d as { repoId: string };
      if (doneId === repoId) { setBusy(false); load(); }
    });
    return () => { offP(); offD(); };
  }, [repoId, load]);

  const sync = async () => {
    setBusy(true); setLog([]);
    try { await invoke(IPC.SyncRun, { repoId }); } catch { setBusy(false); }
  };

  return (
    <div>
      <h2>仪表盘</h2>
      <div className="cards">
        {TOOLS.map((t) => (
          <div key={t} className="card">
            <div className="card-title">{t}</div>
            <div className="card-stat">规则: {rules.filter((r) => r.required).length}</div>
            <div className="card-stat">技能: {skills.length}</div>
            <div className="card-stat">MCP: {mcp.length}</div>
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <button onClick={sync} disabled={busy}>{busy ? '同步中…' : '一键同步'}</button>
        <button onClick={load} disabled={busy}>刷新</button>
      </div>
      {log.length > 0 && (
        <pre className="log">{log.join('\n')}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 补样式 + 手动验证**

```css
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.card { background: #26272d; border-radius: 8px; padding: 14px; }
.card-title { font-weight: 700; margin-bottom: 8px; text-transform: capitalize; }
.card-stat { color: #aaa; font-size: 13px; }
.log { background: #141519; border-radius: 8px; padding: 12px; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; }
```
Expected: 四个工具卡显示计数；点"一键同步"日志逐行滚动、完成后刷新计数。

- [ ] **Step 3: 提交**

```bash
git add electron/src/renderer/pages/dashboard.tsx electron/src/renderer/App.tsx electron/src/renderer/styles.css
git commit -m "feat(renderer): 仪表盘页（状态卡、一键同步、实时日志）"
```

## Task 15: 规则页 + MCP 页

**Files:**
- Create: `electron/src/renderer/pages/rules.tsx`
- Create: `electron/src/renderer/pages/mcp.tsx`
- Modify: `electron/src/renderer/App.tsx`、`styles.css`

**Interfaces:**
- Consumes: `invoke(IPC.RulesList)`、`invoke(IPC.RulesSetRequired)`、`invoke(IPC.SyncRun)`；`invoke(IPC.McpList/McpAdd/McpRemove)`
- Produces: `<RulesPage>`（Switch 列表 + 同步按钮）；`<McpPage>`（表格 + 添加表单 + 删除确认）

- [ ] **Step 1: 实现 `pages/rules.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';

interface Rule { id: string; scope: string; globs: string; required: boolean; domain: boolean }

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
```

- [ ] **Step 2: 实现 `pages/mcp.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';

interface Server { name: string; command: string; scope?: string[] }

export function McpPage({ repoId }: { repoId: string }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setServers(await invoke<Server[]>(IPC.McpList, repoId)); } catch (e) { setMsg((e as Error).message); }
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
```

- [ ] **Step 3: 补样式 + 手动验证**

```css
.rule-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #2a2b30; }
.switch { position: relative; width: 40px; height: 22px; display: inline-block; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: #444; border-radius: 22px; cursor: pointer; transition: 0.2s; }
.slider::before { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: #4cd964; }
.switch input:checked + .slider::before { transform: translateX(18px); }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 8px; border-bottom: 1px solid #2a2b30; }
.form { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; max-width: 480px; }
```
Expected: 规则页 Switch 切换后"同步 Cursor 规则"可点；MCP 页表格增删。

- [ ] **Step 4: 提交**

```bash
git add electron/src/renderer/pages/rules.tsx electron/src/renderer/pages/mcp.tsx electron/src/renderer/App.tsx electron/src/renderer/styles.css
git commit -m "feat(renderer): 规则页与 MCP 页"
```

## Task 16: 技能页 + 密钥页

**Files:**
- Create: `electron/src/renderer/pages/skills.tsx`
- Create: `electron/src/renderer/pages/secrets.tsx`
- Modify: `electron/src/renderer/App.tsx`、`styles.css`

**Interfaces:**
- Consumes: `invoke(IPC.SkillsList/SkillsLink/SkillsUnlink)`、`invoke(IPC.SecretsList/SecretsAudit)`
- Produces: `<SkillsPage>`（主-从布局）；`<SecretsPage>`（只读审计表）

- [ ] **Step 1: 实现 `pages/skills.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';

interface Skill { name: string; description: string; linkStatus: Record<string, { global: boolean; project: boolean }> }

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
```

- [ ] **Step 2: 实现 `pages/secrets.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';

export function SecretsPage({ repoId }: { repoId: string }) {
  const [list, setList] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  useEffect(() => {
    invoke(IPC.SecretsList, repoId).then(setList).catch(() => setList({ error: '无法读取' }));
    invoke(IPC.SecretsAudit, repoId).then(setAudit).catch(() => setAudit({ tools: [] }));
  }, [repoId]);

  return (
    <div>
      <h2>密钥（只读）</h2>
      {list?.vault_ready === false && (
        <div className="error">vault 未初始化。安装依赖: brew install age oath-toolkit，然后 aiws setup</div>
      )}
      <p className="muted">vault_ready: {String(list?.vault_ready)}</p>
      <table className="table">
        <thead><tr><th>工具</th><th>可用密钥</th></tr></thead>
        <tbody>
          {(audit?.tools ?? []).map((t: any) => (
            <tr key={t.tool}><td>{t.tool}</td><td>{t.allowed?.length ? t.allowed.join(', ') : '(无)'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 补样式 + 手动验证**

```css
.master-detail { display: flex; gap: 16px; height: 100%; }
.master { list-style: none; margin: 0; padding: 0; width: 260px; border-right: 1px solid #2a2b30; overflow-y: auto; }
.detail { flex: 1; padding-left: 16px; }
```
Expected: 技能主-从布局，链接/卸载更新状态表；密钥页显示 vault 就绪 + 审计表。

- [ ] **Step 4: 提交**

```bash
git add electron/src/renderer/pages/skills.tsx electron/src/renderer/pages/secrets.tsx electron/src/renderer/App.tsx electron/src/renderer/styles.css
git commit -m "feat(renderer): 技能页与密钥只读页"
```

## Task 17: 差异对比页 + 设置页

**Files:**
- Create: `electron/src/renderer/pages/diff.tsx`
- Create: `electron/src/renderer/pages/settings.tsx`
- Modify: `electron/src/renderer/App.tsx`、`styles.css`

**Interfaces:**
- Consumes: `invoke(IPC.DiffCompare)`、`invoke(IPC.SyncRun)`
- Produces: `<DiffPage>`（工具+规则选择 → side-by-side diff → 应用=同步）；`<SettingsPage>`（语言/通知开关占位）

- [ ] **Step 1: 实现 `pages/diff.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../api';
import { IPC } from '../../shared/ipc';

interface DiffData { source: string; generated: string; diff: { identical: boolean; hunks: { removed: string[]; added: string[] }[] } }

export function DiffPage({ repoId }: { repoId: string }) {
  const [tool, setTool] = useState<'cursor' | 'trae'>('cursor');
  const [rules, setRules] = useState<{ id: string; required: boolean }[]>([]);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [data, setData] = useState<DiffData | null>(null);
  const [msg, setMsg] = useState('');

  const loadRules = useCallback(async () => {
    try {
      const r = await invoke<any[]>(IPC.RulesList, repoId);
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
```

- [ ] **Step 2: 实现 `pages/settings.tsx`**

```tsx
import React, { useState } from 'react';

export function SettingsPage(_props: { repoId: string }) {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [notify, setNotify] = useState(true);
  return (
    <div style={{ maxWidth: 480 }}>
      <h2>设置</h2>
      <div className="rule-row">
        <label>语言</label>
        <select value={lang} onChange={(e) => setLang(e.target.value as 'zh' | 'en')} className="input">
          <option value="zh">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="rule-row">
        <label>同步完成通知</label>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      </div>
      <p className="muted">语言与通知的持久化在后续版本实现；当前为界面占位。</p>
    </div>
  );
}
```

- [ ] **Step 3: 补样式 + 手动验证**

```css
.diff { background: #141519; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: pre; }
.diff .added { display: block; color: #4cd964; }
.diff .removed { display: block; color: #ff6b6b; }
select.input { width: auto; }
```
Expected: diff 页选工具+规则显示差异（增绿删红），"重新同步"后显示无差异；设置页渲染。

- [ ] **Step 4: 提交**

```bash
git add electron/src/renderer/pages/diff.tsx electron/src/renderer/pages/settings.tsx electron/src/renderer/App.tsx electron/src/renderer/styles.css
git commit -m "feat(renderer): 差异对比页与设置页"
```

## Task 18: UI 冒烟测试 + electron/README

**Files:**
- Create: `electron/test/app.test.tsx`（jsdom + @testing-library/react）
- Create: `electron/README.md`
- Modify: `electron/package.json`（test 脚本含 jsx 已由 tsx 覆盖；确认 jsdom 依赖在）

**Interfaces:**
- Consumes: `App`（Task 13）、mock `window.api`
- Produces: renderer 冒烟测试——渲染 App（mock 空仓库），断言仓库管理页出现；渲染含仓库的 App，断言侧边栏与 tab 出现

- [ ] **Step 1: 写冒烟测试**

```tsx
// electron/test/app.test.tsx
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;

import { App } from '../src/renderer/App';

let handlers: Record<string, (p?: unknown) => unknown> = {};
let listeners: Array<[string, (d: unknown) => void]> = [];

beforeEach(() => {
  handlers = {
    'workspace:list': () => [],
  };
  listeners = [];
  (globalThis as any).window.api = {
    invoke: async (channel: string, payload?: unknown) => ({ ok: true, data: handlers[channel](payload) }),
    on: (channel: string, cb: (d: unknown) => void) => { listeners.push([channel, cb]); return () => {}; },
  };
  cleanup();
});

test('无仓库时渲染仓库管理页', async () => {
  render(<App />);
  assert.ok(await screen.findByText('管理仓库'));
});

test('有仓库时渲染侧边栏与 tab', async () => {
  handlers['workspace:list'] = () => [{ id: '1', path: '/repo', name: 'repo', addedAt: 'x' }];
  render(<App />);
  assert.ok(await screen.findByText('repo'));
  assert.ok(await screen.findByText('仪表盘'));
  assert.ok(await screen.findByText('差异对比'));
});
```

- [ ] **Step 2: 运行测试**

```bash
cd electron && npm test 2>&1 | tail -10
```
Expected: 全部 PASS（含 core 各模块 + app 冒烟）

- [ ] **Step 3: 写 `electron/README.md`**

```markdown
# AI Workspace Desktop

AI Workspace 的独立 macOS 管理应用（Electron + React）。

## 开发

```bash
cd electron
npm install
npm start          # 编译并启动
npm test           # core 单测 + renderer 冒烟（node:test + tsx）
npm run dist       # 打包 dmg（arm64）
```

## 功能

- 多仓库管理：添加/移除 git 仓库，管理各自的 AI Workspace
- 仪表盘：各工具规则/技能/MCP 状态 + 一键同步 + 实时日志
- 规则：装载开关（改 mapping.yaml）+ 同步
- MCP：增删服务器
- 技能：列表/详情/链接/卸载
- 密钥：只读状态与权限审计
- 差异对比：规范规则 vs 生成文件 side-by-side diff
- 托盘：显示窗口 / 快速同步全部 / 退出

## 架构

renderer (React) → main (IPC) → core (纯 TS，无 electron 依赖)。
核心逻辑可 `node:test` 直测，不启动 GUI。
```

- [ ] **Step 4: 提交**

```bash
git add electron/test/app.test.tsx electron/README.md
git commit -m "feat(renderer): UI 冒烟测试与 README"
```

---
---

# Phase 4：打包与收尾

## Task 19: 图标 + 打包 dmg（arm64）

**Files:**
- Create: `electron/build/icon.icns`（占位）
- Modify: `electron/electron-builder.yml`（确认配置）

**Interfaces:**
- Consumes: 全部代码
- Produces: `electron/release/*.dmg`

- [ ] **Step 1: 生成占位 icns**

macOS 用 `sips` + `iconutil` 从 PNG 生成 icns：

```bash
cd electron/build
node -e "const fs=require('fs');fs.writeFileSync('icon_512.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAACXBIWXMAAA7EAAAOxAGVKw4bAAADwElEQVR4nO3dQW7kMBAAweT/P5osIA/ICZKUqpn2BUy0mVivf39/t3///gQAAAAAAADA/5cAAMQ2n3/zP2ARi6ABi2gBYBEtACyiBYBFtACwiBYAFtECwCJaAFhECwCLaAFgES0ALKL/XwAT3g3sAAACCUlEQVR4nO3dQQkAIBDEMPCo/2MUSfBiMLuBW1fXtH7/5vf3HwAAAAAAAIgHmQAAAK3lSURBVFhcaMKAgwAAACB9W2v2uQp3bu2dPwAAAABJRU5ErkJggg==','base64'))"
sips -z 512 512 icon_512.png
mkdir -p icon.iconset
sips -z 16 16 icon_512.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon_512.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon_512.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon_512.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon_512.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon_512.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon_512.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon_512.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon_512.png --out icon.iconset/icon_512x512.png
iconutil -c icns icon.iconset -o icon.icns
```
> 说明：占位图标为纯色块，后续替换正式设计。`electron-builder.yml` 已指向 `build/icon.icns`。

- [ ] **Step 2: 打包**

```bash
cd electron && npm run dist
```
Expected: `electron/release/AI Workspace-0.1.0-arm64.dmg` 生成。若提示签名相关，属于未配置开发者账号的正常现象（默认不签名可本地安装）。

- [ ] **Step 3: 安装验证**

双击 dmg，把 "AI Workspace" 拖进 /Applications，启动。Expected: 应用正常打开，功能可用。

- [ ] **Step 4: 提交**

```bash
git add electron/build/icon_512.png electron/build/icon.icns electron/build/icon.iconset/
git commit -m "feat(desktop): 应用图标与 dmg 打包"
```

> 注意：`icon.iconset/` 与 `icon.icns` 为二进制，.gitignore 不排除（应提交）。`release/` 已忽略。

## Task 20: 端到端验证 + 收尾

**Files:**
- Modify: `electron/README.md`（若有偏差）

**Interfaces:**
- Consumes: 全部
- Produces: 可发布的应用

- [ ] **Step 1: 全量测试**

```bash
cd electron && npm test
```
Expected: 全部 PASS

- [ ] **Step 2: 手动端到端走查**

```bash
cd electron && npm start
```
在真实仓库 `/Users/xuanyi/Documents/AI-management` 上逐页验证：
- 仓库页：添加真实仓库、出现列表
- 仪表盘：计数非 0、一键同步成功、日志滚动
- 规则页：切一个领域规则开关 → 同步 → `.cursor/rules/` 文件对应变化
- MCP：添加/删除一个测试服务器（用后删除恢复）
- 技能：列表 + 详情 + link 状态
- 密钥：只读展示
- 差异对比：选一个规则看 diff，重新同步后无差异
- 托盘：快速同步全部、通知弹出

- [ ] **Step 3: 记录偏差到 README / 结项**

如发现与 spec 不符的行为，在 README 或 commit message 中记录。确认无阻断问题后结束。

---
---

## 自审结果

**Spec 覆盖：**
- 分层架构（renderer/main/core）→ Phase 0/2/3
- 多仓库管理器（userData 持久化）→ Task 4 + Task 13
- TS 重写核心（规则/MCP/技能/同步/diff/仓库）→ Task 3-9
- vault 保留 shell 桥接 → Task 10（vault-bridge，`secrets --json` 只读）
- 差异对比 → Task 9 + Task 17
- 批量同步（可取消 + 进度 + 通知）→ Task 10/11/12 + Task 14
- 托盘 → Task 12
- 错误模型（WorkspaceError + code）→ Task 2 + Task 10 序列化
- 测试（core 单测为主 / 集成 / UI 冒烟）→ Task 2-9 TDD、Task 11 取消、Task 18 冒烟
- 打包 dmg arm64、签名默认关 → Task 19

**占位符扫描：** 无 TBD/TODO。占位图标与设置持久化明确标注为"后续替换/后续版本"，非模糊占位。

**类型一致性：**
- `WorkspaceStore`（add/remove/get/update/assertAiwsInstalled）在 Task 4 定义，Task 10 全量使用一致。
- `listRules`/`setRuleRequired`/`ruleGlobs` 在 Task 5 定义，Task 8（sync）与 Task 17（diff 页）使用一致。
- `listMcp`/`addMcp`/`removeMcp`/`mergeLocalMcp`/`getServersForScope` 在 Task 6 定义，Task 8 的 `syncMcpForTool` 使用一致。
- `syncRun(root, opts, signal)` 在 Task 8 定义，Task 10/11/12/14 引用一致。
- `diffLines`/`compareRuleToGenerated` 在 Task 9 定义，Task 17 使用一致。
- IPC 通道名全部来自 Task 1 的 `IPC` 常量，Task 10/13-17 引用一致（`sync:all` 在 ipc.ts 与 IPC 常量都有）。

**已知简化（记入 ROADMAP）：**
- claude/codex 的规则生成（单文件模式）首版跳过，仅 cursor/trae 逐条生成。
- 设置页语言/通知为界面占位，未持久化。
- 添加仓库用路径输入框；文件夹选择器（dialog）需额外 IPC，延后。
- 应用图标为占位；正式图标与代码签名/公证留待有 Apple 开发者账号后配置。
