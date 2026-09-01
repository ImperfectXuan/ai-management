# 记忆系统设计方案：ADR / context / decisions

**状态：** 已确认
**日期：** 2026-09-01
**范围：** `.ai-workspace/memory/`、`.ai-workspace/scripts/aiws`、`.ai-workspace/scripts/lib/rules-generate.sh`、`.ai-workspace/scripts/validate.sh`

## 问题描述

AI Workspace 目前已管理 AI 工具的「能力层 + 行为层」（rules / skills / MCP / secrets），但缺失「知识 / 记忆层」：项目为什么这样设计、这个项目是做什么的、做过哪些技术决策，都没有被持久化，也没有随 sync 进入 AI 会话。

具体缺口：

1. **记忆目录是空的。** `.ai-workspace/memory/{adr,context,decisions}/` 只有 `.gitkeep` 占位，没有模板、没有内容。
2. **没有 CLI 入口。** `aiws` 没有 `memory` 子命令，记忆无法通过命令行创建 / 查看。
3. **上下文不注入。** 每次新会话或切换工具（Claude Code / Codex / Cursor / Trae），AI 都要从零读代码猜「这项目是干嘛的、定过什么规矩、为什么这么定」。

## 设计方案

记忆系统补齐「知识层」，定位：**rules/skills/MCP/secrets = 给 AI 装能力；memory = 给 AI 装长期记忆。** 其中只有 `context/` 会被 sync 注入会话，ADR / decisions 是档案，仅作持久化参考。

### 1. 目录结构与三套模板

```
.ai-workspace/memory/
├── adr/TEMPLATE.md          # ADR 模板（一份一文件）
├── context/project.md       # 项目上下文摘要（默认一份，可多份）
├── context/TEMPLATE.md      # context 模板
├── decisions/TEMPLATE.md    # 决策日志条目模板
└── decisions/decisions.md   # 单文件追加日志（按日期累计）
```

三类职责明确分离：

- **ADR（架构决策记录）**：正式、重、一条一文件 `NNNN.md`（4 位零填充自增编号，标题只存 frontmatter `title` 字段，规避中文 slug 化歧义），一经接受不再修改（要改就写新决策 supersede 旧的）。字段：标题、状态（proposed / accepted / deprecated / superseded）、日期、决策者、背景、决策、后果。回答「为什么当年选 A 而不是 B」。
- **context（项目上下文摘要）**：项目名 / 用途 / 技术栈 / 关键决策 / 约定规范。**唯一被 sync 注入的类型**，默认一份 `project.md`，可多份（注入时全部拼接）。
- **decisions（技术决策日志）**：轻量、单文件追加 `decisions.md`，承接「不值得写正式 ADR、但不记就会忘」的小决策。比 ADR 轻，无编号、无状态生命周期。

frontmatter 按类型约定：ADR 为 `id` / `title` / `date` / `status` / `deciders`；context 为 `id` / `title`；decisions 是单文件日志，条目用 `## YYYY-MM-DD <标题>` 标题而非 frontmatter。均供 `memory list` 展示与 `validate` 校验。

### 2. `aiws memory` CLI 子命令

```
aiws memory list [--type adr|context|decisions]   # 按 frontmatter 列表
aiws memory new --type adr|context|decisions --title "..."  # 从模板脚手架
aiws memory show <相对路径>                        # 打印文件内容
```

- **`list`**：扫描对应目录，按 frontmatter 输出 `id / title / status / date` 表。`--type` 缺省列出三类。`decisions` 类型通过解析 `decisions.md` 中的 `## YYYY-MM-DD <标题>` 标题列出条目。
- **`new`**：只生成脚手架文件（复制模板 + 填充 title / date / id），不拉起 `$EDITOR`（保持跨平台简单）。行为随类型不同：
  - `adr`：取目录内最大编号 +1，生成 `NNNN.md`，`status` 默认 `proposed`。
  - `context`：生成 `context/<文件名>.md`，文件名 = `--title` 原样（空格转 `-`，中文保留），`id` = 文件名。
  - `decisions`：向 `decisions.md` 追加一条 `## <date> <title>` 空条目。
  - 缺 `--title` 或 `--type` 非法 → 明确报错。
- **`show`**：`<相对路径>` 相对 `memory/`（如 `adr/0001-use-age-encryption.md`），`cat` 打印。文件不存在 → 报错并列出候选。

### 3. context 注入 sync（覆盖「项目上下文摘要」任务）

注入内容 = `memory/context/` 下所有非模板 `.md` 文件的正文（剥离 YAML frontmatter），按工具原生机制注入：

| 工具 | 注入方式 |
|---|---|
| Claude | `CLAUDE.md` 头部（`<!-- Generated -->` 之后、规则正文之前） |
| Codex | `AGENTS.md` 头部，同上 |
| Cursor | 生成 `00-context.mdc`（`alwaysApply: true` + `globs: "**/*"`） |
| Trae | 生成 `00-context.md`（同上） |

具体规则：

- **只有 `context/` 被注入**；ADR / decisions 是档案，不进会话上下文。
- **注入挂在规则同步里**（扩展 `generate_tool_file` 与 `generate_rule_files`），不新增第 4 个 sync 模块、不新增 `--only` 值、不新增配置开关。`memory/context/` 为空（只有模板）时自动 no-op。
- **Cursor / Trae 的 `00-context.*` 须纳入 `generate_rule_files` 的白名单**，避免被当作「非预期文件」备份为 `.bak`。其生成在规则文件生成之后、count 统计之内。
- Claude / Codex 的注入以注释标记分隔，确保「DO NOT EDIT」头、上下文块、规则正文三段清晰。

### 4. 校验（validate）

`validate.sh` 新增记忆域检查：

- 三套模板存在（`adr/TEMPLATE.md`、`context/TEMPLATE.md`、`decisions/TEMPLATE.md`）。
- `context/*.md`（非模板）frontmatter 必填 `id` / `title`。
- `adr/*.md`（非模板）frontmatter 必填 `id` / `title` / `date` / `status`，且 `status` ∈ `{proposed, accepted, deprecated, superseded}`。
- `decisions.md` 若存在，每条决策须以 `## YYYY-MM-DD` 标题开头。

校验失败在 sync 前显式报错（快速失败），不静默跳过。

## 文件清单

### 新增文件

| 文件 | 说明 |
|---|---|
| `memory/adr/TEMPLATE.md` | ADR 模板 |
| `memory/context/project.md` | 默认项目上下文摘要 |
| `memory/context/TEMPLATE.md` | context 模板 |
| `memory/decisions/TEMPLATE.md` | 决策日志条目模板 |
| `memory/decisions/decisions.md` | 决策日志（初始含标题） |
| `scripts/lib/memory.sh` | `memory` CLI 逻辑 + context 读取 / 注入辅助 |
| `scripts/test/test-memory.sh` | 记忆域 shell 测试 |

### 修改文件

| 文件 | 变更内容 |
|---|---|
| `scripts/aiws` | 新增 `memory` 子命令分发与 help；`generate_tool_file` 注入 context（claude / codex） |
| `scripts/lib/rules-generate.sh` | 白名单纳入 `00-context.*`；为 cursor / trae 生成 `00-context` 文件 |
| `scripts/validate.sh` | 新增记忆域校验 |

### 不变文件

| 文件 | 原因 |
|---|---|
| `scripts/lib/mcp-sync.sh` / `skills-link.sh` / `vault.sh` | 与记忆域无关 |
| `config/workspace.json` | 不新增模块开关，无需结构变更 |
| `electron/` / `tui/` | 本次不涉及 Desktop / TUI 记忆页 |

## 实施顺序

1. **模板与初始内容** — 编写五份 `memory/` 文件。
2. **memory.sh** — `list` / `new` / `show` 逻辑。
3. **CLI 分发** — `aiws` 接入 `memory` 子命令与 help。
4. **注入 sync** — `generate_tool_file`（claude / codex）+ `rules-generate.sh`（cursor / trae 白名单与 `00-context`）。
5. **validate** — 记忆域校验。
6. **测试** — `test-memory.sh` + 三端既有套件回归。

## 测试策略

`test-memory.sh`（沙盒，临时 git 仓库）覆盖：

- `memory list`：三类各自列出、缺省列出全部。
- `memory new`：`adr` 编号自增、`context` 生成、`decisions` 追加；缺 `--title` / 非法 `--type` 报错。
- `memory show`：存在打印、不存在报错。
- 注入：`memory/context/` 有内容时，`sync` 生成 `00-context.mdc`（cursor）且不备份它；Claude / Codex 的 `CLAUDE.md` / `AGENTS.md` 头部含上下文块。context 为空时 no-op、不生成 `00-context`。
- 回归：`test-rules-generate`（若存在）等既有套件不破。
