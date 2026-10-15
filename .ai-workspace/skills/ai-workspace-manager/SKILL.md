---
name: ai-workspace-manager
description: 通过 aiws CLI 和 .ai-workspace 规范文件管理 AI Workspace。当用户需要初始化、检查、导入、新增、修改、删除、校验或同步共享规则、MCP、Skills 及工具映射时使用。
---

# AI Workspace 管理

将 `.ai-workspace/` 视为单一事实来源。CLI 已支持的操作优先使用 CLI；CLI 没有对应能力时才编辑规范文件。不要把生成的 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`、`.trae/rules/` 或工具原生 MCP 文件作为修改入口。

## 确认工作区

1. 使用 `git rev-parse --show-toplevel` 确定仓库根目录；仅当目标明确不是 Git 仓库时，才回退到当前目录。
2. 优先使用 `<root>/.ai-workspace/scripts/aiws`；若不存在，再尝试 `command -v aiws`。
3. 两者都不存在时，说明当前工作区缺少 AI Workspace 脚手架或 CLI。未经用户明确指定，不要从无关仓库复制 `.ai-workspace/`。只有 CLI 及其依赖库已经存在时，`aiws setup` 才能完成初始化。
4. 写入前执行 `git status --short`，保留无关改动。读取 `.ai-workspace/config/workspace.json`，并只读取与当前请求相关的规范文件。

不要用 `--help` 探测 `sync`、`mcp`、`skills` 或 `secrets`：当前部分子命令会直接执行或拒绝该参数。改用顶层 `aiws --help` 和[命令参考](references/commands.md)。

## 选择操作方式

- 盘点或诊断时，先使用只读命令：`validate`、`rules status`、`rules history`、`mcp list`、`mcp show`、`skills list`、`secrets audit`，或带 `--dry-run` 的导入命令。
- 简单的命令型 MCP 使用 `mcp add` 或 `mcp remove`。需要 URL、环境变量、密钥占位符，或非默认 project scope 时，直接编辑 `mcp/mcp.json`。
- 修改或删除 Rule 时，直接编辑 `.ai-workspace/rules/` 和适配器映射；CLI 暂无 Rule CRUD 命令。
- 收编工具原生配置时，先执行 `import <type> --dry-run`。预览符合请求后，使用相同过滤条件并加 `-y` 完成非交互式导入。
- Skills 操作优先使用 `skills install`、`link` 或 `unlink`。新建工作区 Skill 时放入 `.ai-workspace/skills/<name>/`。

构造写命令或直接修改规范 Schema 前，必须阅读[命令参考](references/commands.md)。

## 修改规范内容

### Rules

通用规范放在 `.ai-workspace/rules/NN-name.md`；语言、框架、工作流或项目专属规范放在 `.ai-workspace/rules/domains/name.md`。保持仓库现有风格。

每条 Rule 的 frontmatter 必须包含 `id`、`title` 和 `scope`。只有确实需要改变加载行为时才添加 `description`、`globs` 或 `tools`。省略 `tools` 或使用空数组表示适用于全部工具。

新增或删除 Rule 时，同步更新每个已启用工具的 `adapters/<tool>/mapping.yaml`。除非用户指定其他加载方式，通用规则默认使用 `required: true`，领域规则默认使用 `required: false`。删除 Rule 时也要移除对应映射。

### MCP

可共享、可提交的定义放在 `.ai-workspace/mcp/mcp.json`。机器专属覆盖按需放入被 Git 忽略的 `.ai-workspace/mcp/mcp.local.json`。凭据使用 `${secret:KEY}` 表示，并通过 `aiws secrets` 管理实际值；不得将密钥明文写入 JSON 或对话输出。

`aiws mcp add <name> <command> [args...]` 会创建 `scope: ["project"]` 的命令型服务。URL 服务或包含更多字段的定义，应在 `servers.<name>` 下进行最小且有效的 JSON 修改。

## 同步并验证

使用能够满足请求的最小同步范围：

- Rule 变更：`sync --only rules`，必要时加 `--tool`。
- MCP 变更：`sync --only mcp --scope project`，必要时加 `--tool`。全局同步会写入用户级工具配置，必须有用户的明确意图。
- Skill 变更：`sync --only skills --scope project`，必要时加 `--tool`。只有用户明确要求时才使用 global scope。

随后运行 `validate`；只有需要将 warning 视为失败时才使用 `--strict`。检查 `git status --short`、`git diff -- .ai-workspace` 以及预期生成的项目文件。报告规范层变更、生成目标、验证结果、警告和任何有意未执行的操作。

完成标准：所有请求的规范变更均已落地，指定目标已同步，校验不存在未解释的错误，并且用户的无关改动保持不变。

## 安全边界

- 导入前必须预览，并保留导入流程生成的备份。
- 删除或解除链接前，确认准确的 server、skill、rule、scope 和 tool。
- 将全局 MCP/Skill 同步、vault 初始化、hook 安装和 CI workflow 安装视为独立副作用；仅在用户要求时执行。
- 如果同步将覆盖未受管理的目标或遇到冲突，停止操作并展示路径及冲突分类，不要静默替换。
