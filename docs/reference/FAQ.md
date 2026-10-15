# 常见问题

## 概述

### AI Workspace 解决什么问题？

AI Coding 工具（Claude Code、Codex、Cursor、Trae）各自读取自己的指令文件。当项目使用多个工具时，同样的规则必须在 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/*.mdc` 等文件中重复维护。AI Workspace 为所有项目规则提供单一规范来源，通过薄适配器生成每个工具的原生格式。

### 这是要替代工具自身的配置系统吗？

不是。AI Workspace 位于每个工具配置系统之上。它不会取代 `CLAUDE.md` —— 它从规范来源生成它，让你不需要手动维护。

### 必须使用全部模块吗？

不需要。每个模块（规则、技能、记忆、MCP）独立可用。可以从仅使用规则模块开始，稍后逐步采用其他模块。

### 会增加 AI 工具启动延迟吗？

不会。AI Workspace 是基于文件的系统。同步在用户命令、提交检查或 CI 中执行，不在 AI 工具启动时额外运行同步服务；逐条规则生成可能改变文件数量。

## 安装与配置

### 如何将 AI Workspace 添加到已有项目？

将 `.ai-workspace/` 目录和根级桩文件复制到项目根目录，编辑规则，然后运行 `aiws sync`。

### 如果我的项目已有 AGENTS.md 或 CLAUDE.md 怎么办？

将其内容迁移到 `.ai-workspace/rules/00-core.md`，然后用同步脚本重新生成根级文件。sync 将从规范规则重新生成它们。

### 支持 Windows 吗？

CLI 脚本按 POSIX shell 设计，Windows 需 Git Bash、WSL 或 MSYS2 等环境及相应依赖。链接支持 junction / copy 回退，但真实 Windows 环境验证仍待补齐；Desktop 当前交付目标为 macOS。见 [进度](../PROGRESS.md)。

## 双向同步

### 什么是 import？与 sync 有何区别？

- **`aiws sync`**（正向）：将 `.ai-workspace/` 规范层的规则、MCP、Skills **推送**到各工具的原生配置文件
- **`aiws import`**（反向）：从工具原生 MCP、Skills 和未纳管规则 **拉取**到规范层，纳入统一管理

两个方向互补：sync 保证工具间一致，import 让你在建立统一管理前不必手动迁移已有配置。

### 我已在各个工具中安装了 Skills 和 MCP，如何导入？

```bash
# 预览将要导入的内容
aiws import skills --dry-run
aiws import mcp --dry-run

# 正式导入
aiws import skills --from claude --scope global -y
aiws import mcp --from codex --scope global -y

# 导入后同步到所有工具
aiws sync
```

### import 会覆盖已有的配置吗？

不会。import 采用安全去重策略：
- **同名 Skill / MCP Server**：自动跳过，保留规范层已有版本
- **已是 symlink 的 Skill**：自动跳过（已被 AI Workspace 管理）
- 导入前自动备份 `mcp.json`（生成 `.bak` 文件）

### 支持 `aiws import rules`（规则反向导入）吗？

支持。规则反向导入已实现：从 Cursor/Trae 逐条转换（`.mdc`/`.md` → `rules/domains/*.md`）、从 Claude/Codex 整文件导入（合并文件 → 单条规则），并用 `mapping.yaml` 幂等登记。可用 `aiws import rules --dry-run` 预览。

## 工具兼容性

### 如果工具不支持 @include 语法怎么办？

Sync 脚本会回退到生成合并文件，将所有适用规则拼接在一起。`mapping.yaml` 中的 `includes_support` 字段控制此行为。

### Codex 使用 TOML 格式的 MCP 配置，如何处理？

Sync 脚本通过 `jq` 和 `awk` 实现 JSON ↔ TOML 的双向转换，无需额外依赖。`aiws import mcp` 也支持从 TOML 格式解析并合并入规范层的 JSON。

### 如何添加新工具支持？

在 `.ai-workspace/adapters/<工具名>/` 下创建目录，放入 `mapping.yaml` 文件，然后创建工具的预期根级文件。详见 CONTRIBUTING.md。

### 当工具更改配置格式时会发生什么？

更新适配器即可。规范规则不受影响。这就是规范层与适配器层分离的原因。

## 规则

### 应该写多少条规则？

从 `00-core.md` 中的 3-5 条规则开始。仅在重复出现的问题证明有必要时才添加更多。从未被遵守的规则就是噪音。

### 可以编写仅适用于部分工具的规则吗？

可以，在规范规则 frontmatter 中使用 `tools: [codex, claude]` 等字段限定工具，并在对应 mapping 登记来源。`required` 控制装载语义，Cursor / Trae 的 `false` 表示按 glob 装载，不表示排除该工具。见 [架构说明](ARCHITECTURE.md)。

### 如何写好一条规则？

好的规则是具体的、祈使语气的，并在推理不显而易见时包含理由。

## 维护

### 如何保持生成文件的同步？

在每次规则更改后运行 `.ai-workspace/scripts/aiws sync`。pre-commit hook 用于校验与拦截漂移；发现漂移后先手动同步再提交。

### 应该提交生成的文件吗？

按仓库策略决定。提交生成文件可让协作者直接读取；若选择忽略，则在使用前运行 sync。本仓库忽略部分生成产物，CI 尊重 `.gitignore`，不会强制添加；manifest 或规则变更日志入库不能代替生成文件验收。

### 如何管理不同机器上的 MCP 差异？

使用 `mcp.local.json` 存放仅限本机的 MCP 覆盖（如路径差异）。此文件被 `.gitignore` 忽略，不提交到仓库。

## 社区

### 可以为我的语言或框架贡献规则集吗？

可以。欢迎为特定语言或框架贡献规则集。详见 CONTRIBUTING.md。

### 有规则集市场吗？

目前没有。计划在 Phase 3 实现。目前，规则集可以作为 Git 仓库共享，用户以 submodule 形式引入。
