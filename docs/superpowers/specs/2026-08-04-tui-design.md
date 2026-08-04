# TUI 设计：AI Workspace 可视化管理界面

**状态：** 已确认
**日期：** 2026-08-04
**范围：** `aiws --json` 输出模式、Ink TUI、界面内编辑与自动同步

## 背景与动机

`.ai-workspace` 目前所有管理操作都通过终端命令（`aiws sync / validate / mcp / skills`）完成：手动、无可视化、需记忆命令语法。用户希望获得**可视化交互**降低使用门槛。

已确认的决策：
- **技术形态**：终端 TUI（非 Web / IDE 插件）
- **技术栈**：Node + Ink（React 终端渲染；环境已有 Node v24，系统 Python 3.9.6 过旧不适合 Textual）
- **集成方式**：薄壳型——TUI 只做界面编排，所有读写调用现有 `aiws` CLI
- **运行方式**：项目内命令（`npm run tui`）
- **secrets 范围**：首版只读展示 + 审计
- **写操作**：界面内编辑 + 保存后自动 `aiws sync`

**覆盖功能**：状态总览+验证 / 规则管理 / 一键同步验证 / MCP 管理 / 技能管理 / 生效规则查看。

## 架构

```
┌─────────────────────────────────────────────────────┐
│                Ink TUI (React 组件)                  │
│   Dashboard / Rules / MCP / Skills / Secrets / 生效规则 │
└───────────────┬─────────────────────────────────────┘
                │ 调用子进程（薄壳）
┌───────────────▼─────────────────────────────────────┐
│           aiws CLI（现有，业务逻辑零改动）            │
│   sync / validate / mcp list-add-remove /            │
│   skills list-link-unlink / secrets list-audit        │
└───────────────┬─────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────┐
│        .ai-workspace/（单一事实来源）                 │
│   rules/  adapters/  mcp.json  skills/  secrets/      │
└─────────────────────────────────────────────────────┘
```

**核心原则**
- TUI 是薄壳：数据读取与写操作都通过 `aiws` 命令的 stdout，不直接触碰 `.ai-workspace` 文件。
- 零业务逻辑重复：TUI 不实现任何规则/同步/MCP 逻辑。
- 单向数据流：界面 → `aiws` → 文件；文件变化 → 重跑 `aiws` 命令刷新。

## `aiws --json` 输出规范

**原则**：`--json` 是全局开关，只在输出层起作用，不改业务逻辑。未加 `--json` 时行为与现在完全一致。

**首版覆盖命令（只读四命令）**：

```
aiws mcp list --json
→ { "servers": [ {"name":"filesystem","command":"npx"}, ... ] }

aiws skills list --json
→ { "skills": [ {"name":"ask-matt","description":"...","link_status":{
    "codex":{"global":true,"project":true}, ... } } ] }

aiws secrets list --json
→ { "secrets": [ {"key":"GITHUB_TOKEN"} ], "vault_ready": false }

aiws secrets audit --json
→ { "tools": [ {"tool":"cursor","uses":["GITHUB_TOKEN"]} ] }
```

**实现位置**：各 `lib/*.sh` 的 list 函数检测 `AIWS_JSON=1` 环境变量后走 JSON 分支，复用现有数据收集逻辑。失败时输出 `{ "error": "<信息>", "exit_code": N }` 到 stdout（便于 TUI 读取），stderr 保持人类可读。

**`sync` 不需要 `--json`**：sync 是写操作，TUI 只需知道成功/失败并展示原始输出文本。

**延后项（记入 ROADMAP Phase 1.5）**：
- `validate --json`：TUI 需要仪表盘校验结果时再实现，避免首版 validate 全量结构化工作量过大。
- TUI 全局工具化、secrets 写入操作：首版不做。

## 模块交互设计

**全局导航**：底部 Tab 栏，`←/→` 或 `1-6` 切换六个页面：`仪表盘 | 规则 | MCP | 技能 | 密钥 | 生效规则`。`q` 退出，`r` 刷新当前页，`?` 帮助。

### ① 仪表盘（Dashboard）
- 各工具状态卡片：Cursor/Trae（规则数 + 技能数）、Claude/Codex（单文件状态 + MCP 数）。
- 数据来源：扫描生成文件存在性 + `mcp list --json`、`skills list --json` 计数。
- `[一键 validate]` 触发 `validate`，暂未结构化，显示原始文本输出。
- `[同步]` 触发全量 `aiws sync`。

### ② 规则（Rules）
- 列表遍历 `.ai-workspace/rules/**`；`☑` 表示已生成到 `.cursor/rules/`（mapping 中 `required:true`）。
- 过滤：`[全部应用][仅领域][已禁用]`。
- `Space` 切换装载：改对应 `mapping.yaml` 的 `required` → 保存触发 `aiws sync --tool cursor`。
- `Enter` 进入编辑视图。

### ③ MCP
- 列表来自 `mcp list --json`；展示 name + command + 各工具同步状态。
- `[添加]` 弹表单填 name + command + args；`[删除]` 确认后调 `aiws mcp remove`；`[同步]` 触发 `aiws sync`。

### ④ 技能（Skills）
- 列表来自 `skills list --json`（含各工具 link_status）。
- `Enter` 显示详情 + `[链接/卸载]` 调 `aiws skills link/unlink`。

### ⑤ 密钥（Secrets）— 只读
- 列表来自 `secrets list --json` / `audit --json`。
- vault 未就绪时显示黄色提示条 + 安装指引，不崩溃。
- 无写入操作。

### ⑥ 生效规则
- 读取 `.cursor/rules/`、`.trae/rules/` 下的生成文件，展示 frontmatter（globs / alwaysApply）。
- 用于验证按需装载是否正确。顶部 `[Cursor][Trae]` 切换。

### 规则编辑视图
- `Enter` 进入：字段表单（标题/作用域/描述/Globs）+ 内容文本区。
- 编辑的是 canonical 规则文件（`.ai-workspace/rules/**`），**不改生成文件**。
- `Tab` 切换字段，`Ctrl+S` 保存并同步，保存后顶部显示"已同步 ✓ / ✗ 失败原因"。

## 错误处理

- **统一三态**：每次 aiws 子进程调用结果为成功 / 失败（stderr + exit code 展示）/ 超时（Spinner 超 30s 提示可中断）。
- **vault 未就绪**：secrets 页黄色提示条，给 `brew install age oath-toolkit` 指引。
- **aiws 不可用**：启动时检测，不在 git 仓库 / aiws 缺失时直接提示，不进入界面。
- **写失败**：规则保存失败、MCP 添加失败——右下角 toast 显示原始错误文本。

## 测试策略

- 核心逻辑（`--json` 解析、映射表、同步触发）放与 UI 解耦的纯函数（`src/lib/aiws.js` 封装子进程调用），用 Node 内置 `node:test` 单测。
- Ink 组件用 `ink-testing-library` 渲染快照测试。
- 手动端到端：`npm run tui` 逐 tab 走一遍增删改查 + 真实 sync。

## 目录结构

```
tui/                          # 项目内 TUI（随仓库提交）
  package.json                # npm run tui
  src/
    index.jsx                 # 入口，渲染 App
    app.jsx                   # 底部 Tab 导航 + 页面切换
    lib/
      aiws.js                 # 子进程调用封装（--json 解析、同步触发）
      validate-parse.js       # validate 原始文本展示（延后结构化）
    screens/
      dashboard.jsx           # 仪表盘
      rules.jsx               # 规则列表 + 编辑视图
      mcp.jsx                 # MCP 列表 + 增删表单
      skills.jsx              # 技能列表 + 详情
      secrets.jsx             # 密钥只读 + 审计
      effective.jsx           # 生效规则查看
  test/
    aiws.test.js              # node:test 单测
    screens.test.jsx          # ink-testing-library 快照
```

## 关键依赖

- `ink`、`react`（运行时）
- `ink-testing-library`（dev，测试）
- Node 内置 `node:test`、`child_process`（无需额外依赖）

## 边界与权衡

- **薄壳的代价**：每个操作是子进程，交互略重；换来单一事实来源与零业务重复。
- **编辑 canonical 文件而非生成文件**：避免绕过 sync 的同步逻辑，防止界面改了但生成文件漂移。
- **validate 未结构化**：首版仪表盘"一键 validate"展示原始文本，结构化延后（ROADMAP 已记）。
