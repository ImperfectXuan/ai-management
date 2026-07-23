# Phase 1 设计方案：多工具与技能

**状态：** 已确认
**日期：** 2026-07-23
**范围：** `.ai-workspace/adapters/`、`.ai-workspace/skills/`、`.ai-workspace/memory/`、`.ai-workspace/scripts/aiws`、`.ai-workspace/hooks/`

## 问题描述

Phase 0 完成了基础设施：规范规则框架、基本适配器和统一 CLI（`aiws`）。但仍有三个缺口：

1. **适配器是一纸空文。** `aiws sync` 把所有规则粗暴拼接成一个文件，完全忽略 `mapping.yaml` 和适配器模板。Cursor 和 Trae 的适配器只有两行占位符，mapping 文件引用的规则名还是过时的（`01-code-conventions.md` 实际不存在）。
2. **技能没有标准。** 只有一个技能实例（`brainstorm`），没有规范说明如何书写技能、技能如何跨工具翻译。
3. **项目记忆是空的。** ADR、上下文、决策目录只有 `.gitkeep` 占位。没有 git hook 在提交前做质量检查。

## 设计方案

### 工作线 A：适配器改造

**目标：** 让 `aiws sync` 根据 `mapping.yaml` 筛选规则、根据适配器模板格式化输出。

**当前行为：**
```
所有 rules/*.md → 拼接 → 写入目标文件
```

**改造后行为：**
```
rules/*.md → mapping.yaml 筛选 → 模板包裹 → 写入目标文件
```

**mapping.yaml 结构**（四个适配器统一更新）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `tool` | 字符串 | 工具标识（codex、claude、cursor、trae） |
| `version` | 字符串 | 最低工具版本要求 |
| `output` | 字符串 | 输出文件相对于仓库根目录的路径 |
| `includes_support` | 布尔 | 工具是否支持 `@include` 模块化引入 |
| `include_syntax` | 字符串（可选）| 引入语法模式（如 `@{path}`），仅当 `includes_support` 为 true |
| `rules` | 数组 | 要包含的规则条目 |
| `rules[].source` | 字符串 | 规则文件相对于 `.ai-workspace/` 的路径 |
| `rules[].required` | 布尔 | 该规则是否为必选 |

**模板文件**（`{tool}.md`）变为带 `{{RULES}}` 占位符的包裹模板：

```
<!-- 由 AI Workspace 生成 - 请勿手动编辑 -->
{工具特定的前置说明}
{{RULES}}
```

**sync 逻辑改造** — `scripts/aiws` 中的 `generate_tool_file()`：

1. 解析目标工具的 `mapping.yaml`（基于 grep 的简单解析，不依赖 YAML 解析器）
2. 只收集 mapping 中列出的规则文件
3. 读取适配器模板
4. 用收集到的规则内容替换 `{{RULES}}` 占位符
5. 写入 mapping 中指定的输出路径

涉及文件：
- `adapters/cursor/cursor.md` — 重写为带 `{{RULES}}` 的模板
- `adapters/cursor/mapping.yaml` — 更新规则引用为实际存在的文件
- `adapters/trae/trae.md` — 重写为带 `{{RULES}}` 的模板
- `adapters/trae/mapping.yaml` — 更新规则引用为实际存在的文件
- `adapters/codex/codex.md` — 重写为模板，保持一致性
- `adapters/codex/mapping.yaml` — 更新规则引用为实际存在的文件
- `adapters/claude/claude.md` — 重写为模板，保持一致性
- `adapters/claude/mapping.yaml` — 更新规则引用为实际存在的文件
- `scripts/aiws` — 修改 `generate_tool_file()`，消费 mapping + 模板

### 工作线 B：技能 DSL

**目标：** 定义技能文件的标准格式，使每个技能一致、可校验、可跨工具翻译。

**设计原则：** DSL 就是 Markdown + YAML frontmatter，不是新语言。标准化 schema 让技能可预测；已有的符号链接机制（`skills-link.sh`）负责跨工具分发。

**SKILL.md frontmatter 结构：**

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | 字符串（kebab-case）| 唯一技能标识 |
| `description` | 是 | 字符串（≤200 字符）| 一句话概述，工具用于展示和触发匹配 |
| `scope` | 否 | `project` \| `user` | 默认值：`project` |
| `triggers` | 否 | 数组 | 自动触发关键词；纯手动技能省略 |
| `triggers[].keyword` | 是 | 字符串 | 触发词或短语 |

**内容结构**（约定，非强制）：

1. `# <展示名称>` — 一级标题，人类可读的技能名称
2. `## 使用场景` — 什么情况下应该调用这个技能
3. `## 执行指令` — 技能主体；可以平铺也可以分节
4. `## 反模式`（可选）— 应该避免的做法

**跨工具兼容性：**

| Frontmatter 字段 | Claude Code | Cursor | Codex | Trae |
|---|---|---|---|---|
| `name` | 使用 | 使用 | 使用 | 使用 |
| `description` | 使用（展示 + 触发）| 使用（展示）| 使用（展示）| 使用（展示）|
| `scope` | 使用（安装目标）| 使用（安装目标）| 使用（安装目标）| 忽略 |
| `triggers` | 使用（自动调用）| 忽略 | 忽略 | 忽略 |

**校验** — `validate.sh` 已有对 SKILL.md frontmatter 中 `name` 和 `description` 的检查。DSL 规范新增：name 必须匹配 kebab-case、description ≤ 200 字符、文件必须包含 `## 使用场景` 和 `## 执行指令` 章节（非严格模式下仅警告）。

**新增文件：** `skills/SKILL-DSL.md`（约 150 行）— 规范文档。

### 工作线 C：记忆系统与 Pre-commit Hook

**目标：** 提供项目知识的结构化模板，将上下文摘要注入 AI 工具会话，在提交时执行质量检查。

#### C1：ADR 模板

**文件：** `memory/adr/TEMPLATE.md`

标准的架构决策记录格式，供开发者手动使用。复制此模板来记录架构决策。sync 不消费此文件，纯人类参考。

包含章节：标题、状态（proposed/accepted/deprecated/superseded）、日期、决策者、背景、决策、后果。

#### C2：项目上下文摘要

**文件：** `memory/context/project.md`

由 `aiws sync` 自动注入到 AI 工具的上下文文件中。放在生成文件的最顶部（规则内容之前），以注释块形式呈现。

包含章节：项目名称、用途、技术栈、关键决策、约定规范。

**sync 集成：** `generate_tool_file()` 读取 `memory/context/` 下的所有文件，以工具兼容的注释格式（Markdown 工具用 `<!-- -->`，Cursor 的 `.cursorrules` 用 `#`）添加到输出内容的最前面。

#### C3：Pre-commit Hook

**文件：** `hooks/pre-commit`

```sh
#!/bin/sh
exec .ai-workspace/scripts/aiws validate --strict && aiws sync
```

每次提交前执行：严格模式校验工作区完整性，然后同步规则/技能/MCP 到所有工具。校验失败则阻止提交。

**安装方式：** `aiws setup` 创建符号链接：`.git/hooks/pre-commit` → `../../.ai-workspace/hooks/pre-commit`。hook 脚本纳入版本控制；符号链接仅本地存在（`.git/hooks/` 不被 git 追踪，无需额外处理）。

## 文件清单

### 新增文件
| 文件 | 说明 |
|---|---|
| `skills/SKILL-DSL.md` | 技能 DSL 规范文档（约 150 行）|
| `memory/adr/TEMPLATE.md` | 架构决策记录模板 |
| `memory/context/project.md` | 项目上下文摘要（注入 AI 上下文）|
| `hooks/pre-commit` | Git pre-commit hook 脚本 |

### 修改文件
| 文件 | 变更内容 |
|---|---|
| `adapters/cursor/cursor.md` | 重写为带 `{{RULES}}` 占位符的包裹模板 |
| `adapters/cursor/mapping.yaml` | 更新 `rules` 引用为实际存在的规则文件 |
| `adapters/trae/trae.md` | 重写为带 `{{RULES}}` 占位符的包裹模板 |
| `adapters/trae/mapping.yaml` | 更新 `rules` 引用为实际存在的规则文件 |
| `adapters/codex/codex.md` | 重写为带 `{{RULES}}` 占位符的包裹模板 |
| `adapters/codex/mapping.yaml` | 更新 `rules` 引用为实际存在的规则文件 |
| `adapters/claude/claude.md` | 重写为带 `{{RULES}}` 占位符的包裹模板 |
| `adapters/claude/mapping.yaml` | 更新 `rules` 引用为实际存在的规则文件 |
| `scripts/aiws` | `generate_tool_file()`：消费 mapping + 模板 + 上下文注入 |
| `scripts/validate.sh` | 新增 SKILL-DSL 合规检查（缺少标准章节时警告）|

### 不变文件
| 文件 | 原因 |
|---|---|
| `skills/brainstorm/SKILL.md` | 已符合 DSL 规范，作为参考实现 |
| `scripts/lib/common.sh` | Phase 1 不需要修改 |
| `scripts/lib/skills-link.sh` | 现有符号链接机制已足够 |
| `scripts/lib/mcp-sync.sh` | 与 Phase 1 范围无关 |
| `scripts/lib/vault.sh` | 与 Phase 1 范围无关 |
| `scripts/lib/platform.sh` | 与 Phase 1 范围无关 |
| `config/workspace.json` | 不需要结构变更 |

## 实施顺序

1. **适配器模板 + mapping** — 重写 8 个适配器文件（4 个模板 + 4 个 mapping），建立目标格式
2. **sync 逻辑** — 修改 `generate_tool_file()`，消费 mapping + 模板 + 上下文
3. **技能 DSL 规范** — 编写 `skills/SKILL-DSL.md`
4. **校验 DSL 合规** — 在 `validate.sh` 中添加 SKILL-DSL 检查
5. **记忆模板** — 编写 `memory/adr/TEMPLATE.md` 和 `memory/context/project.md`
6. **Pre-commit hook** — 编写 `hooks/pre-commit`，在 `aiws setup` 中添加符号链接逻辑
