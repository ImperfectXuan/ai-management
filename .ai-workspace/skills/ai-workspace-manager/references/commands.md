# AI Workspace 命令与 Schema 参考

先将 `AIWS` 解析为 `<root>/.ai-workspace/scripts/aiws` 或已安装的 `aiws` 可执行文件，再使用本参考。所有命令都从目标仓库根目录运行。

## 只读检查

```sh
"$AIWS" --version
"$AIWS" --help
"$AIWS" validate
"$AIWS" validate --strict
"$AIWS" validate --drift-strict
"$AIWS" rules status
"$AIWS" rules history <id-or-rules-relative-path>
"$AIWS" mcp list
"$AIWS" mcp show <name>
"$AIWS" skills list
"$AIWS" secrets audit
AIWS_JSON=1 "$AIWS" mcp list
AIWS_JSON=1 "$AIWS" skills list
```

`rules status` 在状态干净时返回 0，Rule 相对 manifest 有变更时返回 1，环境错误时返回 2。返回 1 表示发现变更，不应当作命令执行失败处理。

## 初始化与同步

```sh
"$AIWS" setup
"$AIWS" sync [--tool codex|claude|cursor|trae] [--scope global|project]
"$AIWS" sync --only rules|mcp|skills [--tool <tool>] [--scope <scope>]
```

`setup` 是交互式命令，可能初始化 secrets vault；在 Git 仓库中运行时还会安装受管理的 pre-commit hook。它不能凭空创建缺失的内嵌 CLI。

Rules 只生成项目级产物。MCP 和 Skills 支持 global 与 project scope。未指定 scope 的全量同步会处理两种范围，因此可能写入用户级文件；除非用户要求全局分发，否则优先使用 project scope。

## 导入

```sh
"$AIWS" import mcp|skills|rules [--from <tool>] [--scope global|project] [--dry-run]
"$AIWS" import mcp|skills|rules [--from <tool>] [--scope global|project] -y
"$AIWS" import rules --from claude|codex --as <name> --dry-run
```

安全顺序是：先使用目标过滤条件和 `--dry-run`，检查 `new / managed / identical / conflict` 分类，再使用完全相同的过滤条件并加 `-y`。导入的 Rules 会进入 `rules/domains/` 并登记到 mappings；完成后执行对应同步。

## MCP 管理

```sh
"$AIWS" mcp add <name> <command> [args...]
"$AIWS" mcp remove <name>
"$AIWS" mcp show <name>
```

`add` 命令始终创建 project scope 的命令型定义。更完整的规范 Schema 如下：

```json
{
  "servers": {
    "server-name": {
      "command": "executable",
      "args": ["arg-1"],
      "env": { "TOKEN": "${secret:TOKEN}" },
      "scope": ["project"]
    },
    "remote-server": {
      "url": "https://example.invalid/mcp",
      "scope": ["project", "global"]
    }
  }
}
```

有效 scope 为 `project` 和 `global`。未声明 `scope` 的定义适用于两者。同步时，`mcp.local.json` 中的本地覆盖会替换同名共享配置。

## Skills 管理

```sh
"$AIWS" skills install <git-url|github-shorthand|npm-package|local-path>
"$AIWS" skills link [global|project] [tool] [skill-name]
"$AIWS" skills unlink [global|project] [tool] [skill-name]
```

参数示例：

```sh
"$AIWS" skills link project codex my-skill
"$AIWS" skills link project codex
"$AIWS" skills link project my-skill
"$AIWS" skills unlink project codex my-skill
```

链接状态分为 `managed`、`missing` 和 `conflict`。解除链接时，只会删除已验证为 AI Workspace 管理的链接。

## Rule Schema

```markdown
---
id: example-rule
title: 示例规则
scope: all
description: 可选的加载说明
globs: "**/*.ts"
tools: [codex, cursor]
---

# 示例规则

- 在此编写可执行的规则。
```

顶层 rules 目录中的文件名遵循 `NN-kebab-case.md`。`globs` 可以是单值，也可以是块列表。支持的工具名为 `codex`、`claude`、`cursor` 和 `trae`。

Mapping 条目：

```yaml
  - source: rules/domains/example-rule.md
    required: false
```

Cursor 和 Trae 只生成 mapping 中列出的 Rules。Codex 和 Claude 会将适用的规范 Rules 合并到根级生成文件中；仍应保持所有 mappings 一致，以保证盘点信息和跨工具行为一致。

## 其他需要明确授权的副作用

```sh
"$AIWS" secrets set <key>
"$AIWS" secrets list
"$AIWS" secrets remove <key>
"$AIWS" hooks install|uninstall
"$AIWS" ci install|uninstall
```

密钥值必须通过 vault 流程输入，不得回显。Hook 和 CI 命令会修改 Git 集成，普通的 Rule 或 MCP 维护请求不包含这些操作。
