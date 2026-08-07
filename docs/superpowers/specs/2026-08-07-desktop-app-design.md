# macOS 独立应用设计：AI Workspace Desktop

**状态：** 已确认
**日期：** 2026-08-07
**范围：** Electron + React 独立 macOS 应用，多仓库管理器，TS 重写核心业务模块

## 背景与动机

AI Workspace 目前的管理操作入口是终端（`aiws` CLI）和 TUI（`tui/`，Ink/React 薄壳）。用户希望把"管理 AI 编程工具配置"这件事从终端解放出来，变成**独立运行的 macOS 应用**——用途不变（单一事实来源，同步规则/MCP/技能/密钥到 Cursor/Trae/Claude/Codex），呈现形式从终端变为原生 GUI。

已确认的决策：
- **技术形态**：独立 macOS 应用（非 TUI 升级、非 Web）
- **技术栈**：Electron + React（与现有 TUI 同语言生态；electron-builder 打包 .app/.dmg）
- **仓库定位**：**多仓库管理器**——应用维护仓库列表，点选管理某个仓库的 workspace
- **功能范围**：**全新完整应用**——仓库管理、差异对比、批量同步、系统通知、托盘
- **底层逻辑**：**TypeScript 重写核心**（非 spawn shell 薄壳）
- **重写范围**：核心模块优先（规则/MCP/技能/仓库注册/同步/diff）；密钥 vault 保留 shell 桥接，标注待迁移
- **代码位置**：本仓库 `electron/` 子目录，与应用规则/文档同仓
- **仓库列表**：应用级配置（`app.getPath('userData')/repos.json`），不写进被管理的仓库
- **分发**：本地 .app/.dmg，arm64；签名/公证默认关闭，`SIGN=1` 开启

**覆盖功能**：仓库管理 / 仪表盘状态卡 / 规则装载开关 / MCP 增删 / 技能链接 / 密钥只读审计 / 差异对比 / 批量同步 / 通知与托盘 / 设置。

## 架构

```
renderer (React, 无业务逻辑)   ← 界面层，IPC 调 main
        │  window.api.invoke / on
        ▼
   main (Electron 主进程)      ← 窗口/托盘/生命周期/IPC 转发，薄
        │  调用
    core (纯 TS 业务逻辑)      ← 规则/MCP/技能/同步/diff/仓库，无 electron 依赖
        │
        ▼
 文件系统 + git                ← 数据边界（.ai-workspace/ 单一事实来源）
```

**核心原则**
- `core/` 不依赖 electron，只操作文件系统与 git → 可用 `node:test` 直接单测，不启动 GUI。
- `main` 是薄转发层，不做业务逻辑；错误在此统一包装成 `{code, message, details}` 跨 IPC。
- 写操作全部落在 canonical 源（`.ai-workspace/`），不直接改生成文件，避免绕过 sync 产生漂移。
- 单向数据流：UI 触发 → core 读/写文件系统 → 返回结构化 JSON → renderer 渲染。

## 目录结构

```
electron/                          # 独立 macOS 应用（随仓库提交）
  package.json                     # electron + react + electron-builder
  tsconfig.json
  electron-builder.yml             # dmg/arm64 打包配置
  src/
    main/
      index.ts                     # 窗口创建、生命周期
      ipc.ts                       # IPC handlers（薄，转发给 core）
      tray.ts                      # 托盘 + 系统通知
    core/                          # 纯 TS 业务逻辑（可单测）
      errors.ts                    # WorkspaceError 层级 + code
      workspace.ts                 # 仓库注册/列表/校验（git rev-parse）
      rules.ts                     # 规则列表 + 装载开关 + diff
      mcp.ts                       # MCP 列表/添加/删除/JSON 合并
      skills.ts                    # 技能列表/链接/卸载
      sync.ts                      # 规则同步 + 批量同步
      diff.ts                      # 差异对比
      vault-bridge.ts              # 密钥桥接（暂调 shell，标注待迁移）
    renderer/
      App.tsx                      # 布局：侧边栏仓库列表 + 内容区
      pages/                       # Workspaces/Dashboard/Rules/Mcp/Skills/Secrets/Diff/Settings
      components/                  # 通用控件（Switch/Table/DiffView/Toast）
    shared/
      ipc.ts                       # IPC 通道名常量
      types.ts                     # 请求/响应类型（main 与 renderer 共享，无 any）
  test/                            # core 的 node:test 单测
  build/icon.icns                  # 应用图标
```

## IPC 与数据流

**通道约定**：`ipcMain.handle`（invoke/handle 模式），命名 `<domain>:<action>`。`shared/types.ts` 定义全部请求/响应类型，杜绝 `any`。

**单仓库操作流**：

```
renderer 组件 → window.api.invoke('rules:list', {repoId})
                     │  preload 暴露的 IPC
                     ▼
main/ipc.ts handler（转发 + 错误包装）
                     ▼
core/workspace.getContext(repoId) → 仓库路径 → core/rules.list(path)
                     ▼
        读文件系统 + git（不碰 electron）
                     ▼
        返回结构化 JSON → renderer setState 渲染
```

**长任务流**（sync / 批量同步 / diff）：

- renderer `invoke('sync:run', {repoId})` 发起 → 立即返回（不阻塞 UI）
- main 起 `core/sync.run()`，`webContents.send('sync:progress', {repoId, line, pct?})` 实时推送进度
- renderer 监听进度事件，追加到对应仓库的日志面板
- 完成时 send `sync:done` → renderer 刷新状态 + `new Notification()` 系统通知

**批量同步**：单仓库同步的 for 循环，遍历仓库列表逐个 `sync.run()`，进度按仓库分组。可中途取消——IPC 层维护 `AbortController` 集合。

**错误跨 IPC**：core 抛带 `code` 的 `WorkspaceError` → main 捕获 → 序列化 `{code, message, details}` → renderer 按 code 渲染中文提示 + 可操作按钮（重试/移除仓库）。

## 页面设计

顶部：窗口标题栏 + 当前仓库下拉。左侧：**仓库列表侧边栏**（含"添加仓库"按钮）。右侧：内容区。底部：全局状态栏。

| 页面 | 内容 | 相对 TUI 的升级 |
|---|---|---|
| **仓库管理** | 仓库列表、添加（文件夹选择器 + `git rev-parse` 校验）、移除、最近同步时间 | 新增 |
| **仪表盘** | 每个工具的规则/技能/MCP 状态卡、一键同步/验证按钮、同步日志面板 | 升级（卡片可点击、日志实时滚动） |
| **规则** | 规则列表 + 每项 Switch 开关，改动标记待同步，提供"同步"按钮 | 升级（checkbox → Switch） |
| **MCP** | 服务器表格（名称/命令/来源/状态）、添加弹窗、删除确认 | 升级（表格 + 弹窗） |
| **技能** | 技能列表、详情面板（frontmatter + 来源）、链接/卸载按钮 | 升级（主-从布局） |
| **密钥** | vault 就绪状态、各工具可用密钥审计表 | 基本一致（只读） |
| **差异对比** | 选择规范规则 vs 已生成文件，side-by-side diff + "应用"按钮 | 新增 |
| **设置** | 语言（中/英，默认中文）、默认同步范围、通知开关 | 新增 |

**差异处理**
- 仪表盘工具卡片从实际配置读取（`.ai-workspace/config/` 的 `SUPPORTED_TOOLS`），不硬编码四个工具。
- 生效规则页（frontmatter 查看）并入差异对比页——本质都是"看生成的文件"。
- 密钥页维持只读：`--json` 不解密，解密操作留到 vault 桥接完成。

**托盘**：菜单栏图标，点击开主窗；右键菜单含"快速同步全部 / 显示窗口 / 退出"。

## 错误处理

`core/errors.ts` 定义带 `code` 的 `WorkspaceError` 层级：

| code | 含义 | 用户提示 |
|---|---|---|
| `WorkspaceNotFound` | 仓库已移除/路径失效 | "仓库路径不存在，请重新添加" + 移除按钮 |
| `NotAGitRepo` | 目录不是 git 仓库 | "不是 git 仓库" |
| `AiwsNotInstalled` | `.ai-workspace/scripts/aiws` 不存在 | "该仓库未初始化 AI Workspace，运行 scaffold" |
| `GitNotInstalled` | 系统缺 git | "未检测到 git，请安装 Command Line Tools" |
| `JqMissing` | 系统缺 jq（仅 diff/import） | "jq 未安装"（后期重写可消除） |
| `UnsupportedTool` | 配置了不支持的 AI 工具 | "未知工具" |

- core 在**系统边界**校验（仓库路径、git、jq 存在性），内层不重复校验。
- 每层错误带上下文：`SyncError(repo, step)`。
- 跨 IPC 时 main 捕获 → 序列化 → renderer 按 code 渲染提示 + 可操作按钮。

## 测试策略

分层（遵循项目测试金字塔）：

- **单测（主体）**：`node:test`，只测 `core/`，不启动 Electron。
  - `workspace.test.ts`：注册/校验/移除仓库（mock git）
  - `rules.test.ts`：列表排序、开关切换、diff 计算
  - `mcp.test.ts`：增删/JSON 合并（临时目录）
  - `sync.test.ts`：同步产物断言（写临时仓库 fixtures）
  - `diff.test.ts`：差异计算
- **集成（少量）**：真实临时 git 仓库 + fixtures，验证 `sync.run()` 端到端产出文件。
- **UI（最少）**：React Testing Library 冒烟测 renderer 渲染；E2E（Playwright）只在关键路径。

## 打包与分发

- **electron-builder**，target `dmg`（含 .app），arch `arm64`。
- 图标：`build/icon.icns`（应用内生成占位图标）。
- **签名/公证**：默认关闭（无需 Apple 开发者账号即可本地安装）；`SIGN=1` 环境变量走 codesign + notarytool 路径。
- 输出 `electron/release/`。

## 关键依赖

- 运行时：`electron`、`react`、`react-dom`
- 打包：`electron-builder`
- 测试：`node:test`（内置）、`@testing-library/react`（dev）
- 数据边界：Node 内置 `fs`、`child_process`（git）、`crypto`（后期 vault 迁移）

## 边界与权衡

- **TS 重写核心 vs 薄壳**：选 TS 重写，换来 GUI 无系统依赖（jq/age）与可单测性；代价是工程量约 2-3 倍于薄壳。vault 加密暂留 shell 桥接，二期再迁移。
- **多仓库管理器 vs 单仓库**：应用维护仓库列表（userData），不自动扫描文件系统，兼顾隐私与性能。
- **仓库列表存 userData**：不写进被管理仓库，保持被管理仓库纯净。
- **写 canonical 而非生成文件**：避免绕过 sync 产生漂移（与 TUI 设计一致）。
- **签名默认关闭**：本地分发优先；公证是可插拔的后期项。
