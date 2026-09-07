# AI Workspace — 项目总体 Spec

> 本文档是 AI Workspace 的总体规格说明，串联本仓库三个交付物（CLI / TUI / Desktop）。
> 面向新加入的开发者：读完本文应能回答「这是什么、怎么工作、有哪些组成部分、目录长什么样」。
> 详细设计见 [reference/ARCHITECTURE.md](reference/ARCHITECTURE.md) 与 [reference/DESIGN_PHILOSOPHY.md](reference/DESIGN_PHILOSOPHY.md)。

---

## 1. 项目定位

AI Workspace 是嵌入项目仓库的基础设施层，为 **规则、约定、技能、MCP 配置、密钥、项目记忆** 提供**单一事实来源**，再通过**薄适配器**翻译成每个 AI Coding 工具的原生格式。

- **一句话**：一处维护规范，自动同步到你用的每个 AI 编码工具（Claude Code、Codex、Cursor、Trae）。
- **要解决的问题**：多个工具各自读取 `AGENTS.md`、`CLAUDE.md`、`.cursorrules`、`.trae/`，同一套规则要重复维护 N 份；更新一次规则要改 4+ 个文件；切换工具丢失上下文。

## 2. 核心架构：三层

```
┌──────────────────────────────────────────┐
│  根层（工具面向层）                        │
│  AGENTS.md  CLAUDE.md  .cursorrules ...  │  ← 生成的薄桩，绝不手动编辑
├──────────────────────────────────────────┤
│  适配器层                                  │
│  .ai-workspace/adapters/{tool}/           │  ← 格式翻译，每个 < 50 行
├──────────────────────────────────────────┤
│  规范层（单一事实来源）                     │
│  rules/  skills/  mcp/  memory/  secrets/ │  ← 与工具无关，人类编辑
│  config/                                  │
└──────────────────────────────────────────┘
```

- **规范层**：工具无关的项目知识，唯一可编辑的事实来源。
- **适配器层**：机械翻译（include 语法差异、YAML/TOML 转换、`mapping.yaml` 规则选择性包含）。
- **根层**：sync 生成的工具原生文件，含工具原生 MCP 配置与 skills 目录。

## 3. 六大模块

| 模块 | 存储位置 | 职责 |
|---|---|---|
| **规则** | `.ai-workspace/rules/` + `rules/domains/` | 项目约定（7 核心 + 6 领域），YAML frontmatter + Markdown |
| **技能** | `.ai-workspace/skills/<name>/` | 跨工具技能（`SKILL.md` + 资源），symlink 分发 |
| **MCP** | `.ai-workspace/mcp/mcp.json`（+ `mcp.local.json` 本地覆盖） | 服务器配置，`scope` 字段控制 global/project 分发 |
| **密钥** | `.ai-workspace/secrets/` | age 加密 + TOTP 2FA，`permissions.yaml` 按工具授权 |
| **记忆** | `.ai-workspace/memory/`（adr/context/decisions） | 项目知识：ADR、上下文摘要、决策日志 |
| **配置** | `.ai-workspace/config/workspace.json` | 启用工具、默认 scope、模块开关 |

## 4. 支持的工具

| 工具 | 适配器 | 原生输出 |
|---|---|---|
| Codex | `adapters/codex/` | `AGENTS.md` + `.codex/config.toml`（TOML） |
| Claude Code | `adapters/claude/` | `CLAUDE.md` + `.mcp.json` |
| Cursor | `adapters/cursor/` | `.cursor/rules/*.mdc` + `.cursor/mcp.json` |
| Trae | `adapters/trae/` | `.trae/rules/*.md` + `.trae/mcp.json` |

## 5. 数据流

### 正向同步（`aiws sync`）

```
规范层 (.ai-workspace/) ──→ 工具原生文件
```

三阶段：
1. **规则同步**：`rules/*.md` + `rules/domains/*.md` → 按 `mapping.yaml` 生成 `CLAUDE.md` / `.cursor/rules/*.mdc` 等
2. **MCP 同步**：`mcp.json` + `mcp.local.json` → scope 过滤 + `${secret:XXX}` 占位替换 → 各工具原生配置
3. **技能同步**：`skills/*/` → symlink 到各工具 skills 目录

### 反向导入（`aiws import`）

```
工具原生文件 ──→ 规范层 (.ai-workspace/)
```

- `import mcp`：从工具解析 JSON/TOML → 合并进 `mcp.json`（同名去重、备份）
- `import skills`：从工具 skills 目录复制 → 已管理 symlink / 同名跳过
- `import rules`：反向导入未纳管规则（cursor/trae 逐条转换、claude/codex 整文件，自动登记 mapping）

## 6. CLI 命令体系

`aiws` 是唯一用户接口（`.ai-workspace/scripts/aiws`，POSIX sh）：

```
aiws setup                  # 初始化工作区 + 可选 vault
aiws sync [--tool T] [--scope S] [--only rules|mcp|skills]   # 正向同步（--only 限定模块）
aiws validate               # 校验工作区结构与配置
aiws import mcp|skills|rules        # 反向导入

aiws mcp     list|add|remove|show
aiws skills  list|link|unlink|install
aiws secrets set|list|remove|audit
aiws rules  status|history <id>     # 规则版本化：变更状态 / 单条规则 git 历史
aiws ci     install|uninstall       # GitHub Actions 推送自动同步工作流
```

## 7. 三个交付物

本仓库包含三个访问同一份事实来源（`.ai-workspace/`）的界面：

| 交付物 | 技术栈 | 形态 | 定位 | 状态 |
|---|---|---|---|---|
| **CLI** | POSIX sh | 终端命令 | 事实来源的读写引擎（唯一业务逻辑） | ✅ 已实现 |
| **TUI** | Node + Ink/React | 终端交互界面 | 薄壳调用 `aiws`，零业务重复 | ✅ 已实现 |
| **Desktop** | Electron + React + TypeScript | macOS 独立应用 | 多仓库管理器，core 纯 TS 重写 | ✅ 已实现 |

三者关系：

```
Desktop (Electron)   TUI (Ink)           ← 界面层
        └──────────────┬──────────────────┘
                       │ 调用
                 aiws CLI (sh)           ← 引擎层（唯一事实来源的读写）
                       │
              .ai-workspace/ 文件         ← 数据层
```

> 区别：TUI 是「薄壳」——所有读写走 `aiws` 子进程；Desktop 是「TS 重写」——`electron/src/core/` 用纯 TypeScript 重新实现核心模块（规则/MCP/技能/仓库/同步/diff），不依赖 `jq`/`age` 等系统工具，可用 `node:test` 直测。密钥 vault 首版仍通过 shell 桥接（`vault-bridge.ts`），暂未 TS 迁移。

## 8. 目录结构总览

```
.
├── .ai-workspace/            # 核心基础设施（单一事实来源）
│   ├── rules/                #   规范规则（7 核心）+ domains/（6 领域）
│   ├── adapters/{tool}/      #   适配器（mapping.yaml + 模板）
│   ├── skills/               #   技能（25 个）
│   ├── mcp/                  #   mcp.json + mcp.local.json
│   ├── secrets/              #   vault + permissions.yaml
│   ├── memory/               #   adr / context / decisions
│   ├── config/workspace.json #   工作区配置
│   └── scripts/              #   aiws CLI + lib/（同步引擎等）
├── tui/                      # Ink TUI（npm run tui）
│   ├── src/lib/aiws.js       #   aiws 子进程封装
│   └── src/screens/          #   六个页面
├── electron/                 # macOS 桌面应用
│   ├── src/core/             #   纯 TS 业务逻辑（可单测）
│   ├── src/main/             #   主进程（窗口/托盘/IPC）
│   └── src/renderer/         #   React 界面
└── docs/                     # 文档（见 docs/README.md）
```

## 9. 文件格式契约

### 规范规则（`.ai-workspace/rules/*.md`）

```markdown
---
id: "nn-topic"
title: "人类可读标题"
scope: all            # all | csharp | vue | winforms | wpf ...
description: "可选描述"
globs: "**/*.ts"      # 可选，行内；或块列表
---

# 标题

- 以祈使语气表述的规则。
```

### 适配器映射（`adapters/{tool}/mapping.yaml`）

```yaml
tool: cursor
version: ">=0.1"
rules:
  - source: rules/00-core.md        # 相对 .ai-workspace/
    required: true                  # true = 始终装载；false = 领域规则按需
```

### MCP 配置（`mcp/mcp.json`）

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "scope": ["global", "project"]
    }
  }
}
```

### 技能（`skills/<name>/SKILL.md`）

```markdown
---
name: brainstorm
description: 结构化构思和设计探索
---

# 使用场景 / 执行指令 / 反模式
```

### 规则版本化（`rules/.manifest.sha256` 与 `rules/CHANGELOG.md`）

```
<64位sha256>  <相对 .ai-workspace/ 的路径>
```

- `.manifest.sha256`：sha256sum 兼容纯文本快照（零 jq 依赖，可 `shasum -a 256 -c` 校验）。sync 成功消费规则层后原子替换；**无变化零写**（CI auto-sync 不回环的保证）。
- `rules/CHANGELOG.md`：aiws 自动维护的追加式变更日志（`modified/added/removed` + 8 位哈希对）。非规范规则，同步与校验流程均跳过。
- `aiws rules status` 对照 manifest 报告自上次同步以来的变更（rc 0 一致 / 1 有差异 / 2 环境错误）。

## 10. 设计哲学（摘要）

五原则：**规范核心·薄适配器**、**约定优于配置**、**渐进式披露**、**Git 原生**、**通过 Include 实现 DRY**。

反模式（禁止）：规范文件中写工具特定规则、适配器超过 50 行、手动编辑生成文件、混用规则与记忆、过度配置。

完整论述见 [reference/DESIGN_PHILOSOPHY.md](reference/DESIGN_PHILOSOPHY.md)。

---

## 相关文档

- [文档索引](README.md)
- [架构设计](reference/ARCHITECTURE.md)
- [设计哲学](reference/DESIGN_PHILOSOPHY.md)
- [常见问题](reference/FAQ.md)
- [测试指导](TESTING.md)
- [路线图](../ROADMAP.md)
