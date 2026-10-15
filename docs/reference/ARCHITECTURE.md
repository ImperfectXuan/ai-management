---
id: 07-architecture
title: Architecture Design
scope: all
---

# 架构设计

> 文档角色：SDD 系统设计；整理日期：2026-10-10。需求见 [SPEC](../SPEC.md)，任务与验收关联见 [追踪矩阵](../TRACEABILITY.md)。
> 当前范围依据核心源码与既有进度记录核对；本次未执行功能验收。

## 概述

AI Workspace 采用**三层架构**，将项目知识与工具特定格式解耦。

```
┌──────────────────────────────────────────┐
│           根层（工具面向层）               │
│  AGENTS.md  CLAUDE.md  工具规则目录 ...  │
│         ↑ 生成的薄桩文件                  │
├──────────────────────────────────────────┤
│           适配器层                         │
│  .ai-workspace/adapters/{tool}/           │
│         ↑ 格式翻译                        │
├──────────────────────────────────────────┤
│           规范层                           │
│  .ai-workspace/rules/                     │
│  .ai-workspace/skills/                    │
│  .ai-workspace/mcp/                       │
│  .ai-workspace/memory/                    │
│  .ai-workspace/secrets/                   │
│  .ai-workspace/config/                    │
│         ↑ 单一事实来源                    │
└──────────────────────────────────────────┘
```

## 各层职责

### 规范层

不变的核心。包含所有项目规则、约定、技能、MCP 配置、密钥和记忆，格式与任何特定工具无关。此层对 AI Coding 工具的存在一无所知。

**核心原则**：仅阅读此层的新开发者应能理解所有项目约定，无需知道将使用哪种 AI 工具。

### 适配器层

薄翻译模块。每个适配器（不超过 50 行）将规范规则映射到特定工具的期望格式。适配器处理：

- Include/import 语法差异
- 格式偏好（YAML frontmatter vs. HTML 注释 vs. 纯文本）
- MCP 配置格式转换（JSON ↔ TOML）
- 基于 `mapping.yaml` 的规则选择性包含

### 根层

工具原生入口点。这些是 AI Coding 工具实际读取的文件（`AGENTS.md`、`CLAUDE.md`、`.cursor/rules/*.mdc`、`.trae/rules/*.md`）。它们由 sync 脚本生成，**绝不**应手动编辑以更改内容。

此外还包括工具原生 MCP 配置（`.mcp.json`、`.codex/config.toml` 等）和 Skills 目录。

## 数据流

### 正向同步（sync）

```mermaid
graph TD
    A[开发者编辑规范内容] --> B[aiws sync 读取 .ai-workspace/]
    B --> C{对每个工具适配器}
    C --> D[Codex: 生成 AGENTS.md + config.toml]
    C --> E[Claude: 生成 CLAUDE.md + .mcp.json]
    C --> F[Cursor: 生成 .cursor/rules/*.mdc + mcp.json]
    C --> G[Trae: 生成 .trae/rules/*.md + mcp.json]
    D --> H[AI Coding 工具读取原生文件]
    E --> H
    F --> H
    G --> H
```

### 反向导入（import）

```mermaid
graph TD
    A[aiws import] --> B{扫描所有工具}
    B --> C[读取工具原生 MCP 配置]
    B --> D[扫描工具 Skills 目录]
    B --> M[读取工具原生规则]
    M --> N[跳过已管理内容与冲突]
    N --> O[逐条转换或整文件导入并登记 mapping]
    C --> E[解析 JSON / TOML 格式]
    E --> F[jq 合并进 mcp.json]
    F --> G[去重：跳过同名 server]
    D --> H{检测 symlink?}
    H -->|是| I[跳过：已被管理]
    H -->|否| J[检测同名?]
    J -->|是| K[跳过：已在 workspace]
    J -->|否| L[复制到 .ai-workspace/skills/]
```

### 全量同步（sync）

CLI `aiws sync` 的完整流程包含三个阶段（工具 / scope / 模块选项会限定范围，Desktop 范围见后文）：

| 阶段 | 内容 | 源 → 目标 |
|---|---|---|
| **规则同步** | 核心规则 + 领域规则（数量以规范源为准） | `.ai-workspace/rules/*.md` → `CLAUDE.md` 等 |
| **MCP 同步** | MCP 服务器配置 | `.ai-workspace/mcp/mcp.json + mcp.local.json` → 各工具原生配置 |
| **Skills 同步** | 跨工具技能定义 | `.ai-workspace/skills/*/` → symlink 到各工具 skills 目录 |

## 核心抽象

| 抽象 | 表示形式 | 位置 |
|---|---|---|
| **规则** | 带 YAML frontmatter 的 Markdown 文件 | `.ai-workspace/rules/` |
| **规则集** | 相关规则的目录 | `.ai-workspace/rules/domains/` |
| **适配器** | mapping.yaml + 模板 | `.ai-workspace/adapters/<tool>/` |
| **技能** | SKILL.md + 资源 | `.ai-workspace/skills/<name>/` |
| **记忆** | ADR + 上下文 + 决策日志 | `.ai-workspace/memory/` |
| **MCP 配置** | JSON（`mcp.json`）+ 本地覆盖（`mcp.local.json`） | `.ai-workspace/mcp/` |
| **密钥** | age 加密的 JSON + TOTP 2FA | `.ai-workspace/secrets/` |
| **工作区配置** | JSON | `.ai-workspace/config/workspace.json` |

## 文件格式契约

### 规范规则

```markdown
---
id: "nn-topic"
title: "人类可读的标题"
scope: all
description: "可选的描述信息"
globs:
  - "**/*.cs"
---

# 标题

## 章节

- 以祈使语气表述的规则。
```

### 适配器映射

```yaml
tool: codex
version: ">=0.1"
includes_support: true          # 工具是否支持 @include 语法？
include_syntax: "@{path}"       # Include 语法模式
rules:
  - source: rules/00-core.md
    required: true              # true = 始终包含，false = 领域规则（可选加载）
  - source: rules/domains/aspnet.md
    required: false
```

### MCP 配置

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "scope": ["global", "project"]
    },
    "browser-use": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-browseruse"],
      "scope": ["project"]
    }
  }
}
```

`scope` 字段控制 server 分发到哪些工具 scope（`global` = 全局安装，`project` = 项目级安装）。

### SKILL.md

```markdown
---
name: brainstorm
description: 结构化构思和设计探索
disable-model-invocation: true
---

# Brainstorm

技能的使用说明和规则...
```

## 脚本架构

```
.ai-workspace/scripts/
├── aiws                    # CLI 入口（唯一用户接口）
├── validate.sh             # 校验脚本
└── lib/                    # 脚本库
    ├── common.sh           #   共享工具（日志、路径、配置、文件操作）
    ├── mcp-sync.sh         #   MCP 同步引擎（合并、scope 过滤、密钥替换、格式生成）
    ├── skills-link.sh      #   Skills 链接引擎（发现、symlink、安装）
    ├── import-mcp.sh       #   MCP 反向导入引擎（JSON/TOML 解析、去重、合并）
    ├── import-skills.sh    #   Skills 反向导入引擎（扫描、symlink 检测、去重、复制）
    ├── platform.sh         #   跨平台链接抽象（symlink、junction、复制回退）
    └── vault.sh            #   加密密钥管理（age + TOTP 2FA + 权限控制）
```

## CLI 命令体系

```
aiws
├── setup              # 初始化工作区目录结构 + 可选 vault 初始化
├── sync               # 正向同步：规范层 → 工具原生文件（规则 + MCP + Skills）
├── validate           # 校验工作区结构和配置
├── import             # 反向导入：工具原生文件 → 规范层
│   ├── mcp            #   从工具导入 MCP 配置
│   ├── skills         #   从工具导入 Skills
│   └── rules          #   从工具导入未纳管规则（已实现）
├── mcp                # MCP 管理
│   ├── list           #   列出所有 MCP 服务器
│   ├── add            #   添加新 MCP 服务器
│   ├── remove         #   移除 MCP 服务器
│   └── show           #   查看服务器详情
├── skills             # Skills 管理
│   ├── list           #   列出所有技能及同步状态
│   ├── link           #   链接技能到工具
│   ├── unlink         #   解除链接
│   └── install        #   从 Git/npm/本地路径安装技能
└── secrets            # 密钥管理
    ├── set            #   设置加密密钥
    ├── list           #   列出密钥名称
    ├── remove         #   移除密钥
    └── audit          #   查看密钥使用情况
```

## 设计权衡

| 决策 | 原因 |
|---|---|
| MCP 配置存储为 JSON（非 YAML） | `jq` 生态成熟，解析可靠；mapping.yaml 用 YAML 是因为需要人类编辑注释 |
| mapping 驱动生成 | 只处理 mapping 中的来源；逐文件工具将 `required` 映射为 `alwaysApply`，`false` 不表示停止生成 |
| Skills 用 symlink（非复制） | 修改源文件所有工具立即可见，节省磁盘空间 |
| Codex MCP 输出 TOML（非 JSON） | Codex 原生格式就是 TOML，需要 awk 解析而不引入额外依赖 |
| CLI 使用 POSIX shell | 依赖 Git、jq 等系统工具；密钥读写另需 age / TOTP 工具，不是零依赖；Desktop 核心使用 TypeScript |

## 目录命名理由

### 为什么是 `.ai-workspace/`？

点前缀在 Unix 系统上隐藏目录，但在编辑器中仍然可见。名称描述性强但不绑定任何特定工具。已考虑但放弃的替代：

- `.ai/` — 太短，存在命名空间冲突风险
- `.ai-infra/` — 过于技术化
- `ai-workspace/` — 对 `ls` 可见，产生噪音

### 为什么 `rules/` 和 `adapters/` 分离？

规则是稳定的项目知识。适配器是机械翻译。混合它们会产生不必要的变更：工具格式变更不应触及规则文件，规则变更也不应要求理解工具特定格式。

### 为什么 `memory/` 不是 `rules/` 的子目录？

规则是规定性的（"这样做"）。记忆是描述性的（"我们决定了这个"）。它们有不同的更新频率、不同的作者和不同的审查要求。

## 三个交付物的实现边界

共享规范源不等于共享执行引擎。原先“CLI 唯一业务逻辑”的描述不适用于当前仓库。

| 端 | 调用与读写方式 | 当前边界 |
|---|---|---|
| CLI | `scripts/aiws` → `scripts/lib/` → `.ai-workspace/` 与工具原生文件 | 完整规则 / MCP / 技能同步、导入、validate、memory、hooks / CI 与规则版本化 |
| TUI | CLI 子进程 + `tui/src/lib/rules.js` 本地读写 mapping | 六页交互；规则列表与装载设置有本地实现，不是所有读写都走 CLI |
| Desktop | renderer → IPC → core；sync / intake / vault 经 CLI 桥接 | `syncRun` 复用共享 CLI，包含四工具规则、context、MCP 与 Skills；默认仅 project scope，规则单独操作传 `--only rules` |

Desktop 同步与收编使用共享 CLI 引擎；规则开关、MCP CRUD 和独立技能操作仍有 TS 文件操作。取消终止 CLI 进程组，已写文件不自动回滚。差异页在临时目录用 CLI 生成预期产物后对比实际文件，避免将格式转换误报为漂移。GUI、IPC 与 CLI 各层仍需各自验收；测试不解密真实 vault。

源码依据：`tui/src/lib/aiws.js`、`tui/src/lib/rules.js`、`electron/src/core/sync.ts`、`electron/src/core/vault-bridge.ts`。详细能力见 [FEATURE_BREAKDOWN](../FEATURE_BREAKDOWN.md)，未完成项查 [PROGRESS](../PROGRESS.md)。

## 规则元数据与 scope 语义

- 规则 `scope` 表示语言 / 领域，`globs` 表示装载匹配，`tools` 表示适用工具；`tools` 支持内联或块列表，缺省适用所有工具。
- CLI `--scope global|project` 是 MCP / 技能的分发位置，不是规则领域筛选器。规则仍在项目仓库生成。
- Cursor / Trae：mapping 中登记的来源与 `tools` 共同决定是否生成；`required` 决定 `alwaysApply`，`false` 不等于禁用或删除。
- Claude / Codex：单文件模式的筛选由 CLI 执行，不能套用逐文件工具的 `alwaysApply` 语义。

## 记忆、自动化与规则追踪

- `aiws memory list|new|show` 管理 `.ai-workspace/memory/{adr,context,decisions}/`；CLI 同步把 context 注入 Claude / Codex 头部与 Cursor / Trae 的 `00-context`，validate 检查元数据与漂移。
- `aiws hooks install|uninstall|status` 管理 pre-commit；`aiws ci install|uninstall` 管理 GitHub Actions 自动同步工作流。
- `aiws rules status|history <id>` 使用 `rules/.manifest.sha256` 与 Git 历史追踪规则；同步成功消费规则层后更新 manifest 与自动维护的 `rules/CHANGELOG.md`，无变化不写入。
- manifest 是规范源字节快照，与工具无关。单工具同步也推进快照，不代表其他工具已同步或全部验收通过。
- MCP 主配置与本地覆盖的路径、工具授权配置和 vault 均属于文件契约；真实凭据不写入产品规格或提交日志。


## 拟议扩展：持久化同步版本状态（002）

基线 `81195b4` 的 Desktop 已将统一内容库与应用项目分离：来源经 `AIWS_SOURCE_DIR` 传入，输出经 `AIWS_ROOT` 指定，运行时可使用应用自带 CLI。当前项目级 lastSyncAt 与组件内状态不构成工具/模块级成功证据。

拟增加独立的本机同步状态 Store、来源指纹和统一执行 service，由 main 负责实际目标身份、串行执行和恢复；CLI 为实际消费输入和单元执行结果提供结构化契约，renderer 只查询和展示。记录保存在 Electron userData，不加入共享规范源，不复用规则 manifest 或收编 registry。

这是方案草案，尚未实现。字段、失败边界与输入依赖以 [002 设计](../specs/002-sync-status/design.md) 为准；[任务](../specs/002-sync-status/tasks.md) 与 [验证](../specs/002-sync-status/verification.md) 追踪实施，当前状态见 [PROGRESS](../PROGRESS.md)。
