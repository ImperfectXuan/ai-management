English | 简体中文

# 为 AI Workspace 贡献

感谢你的贡献兴趣。AI Workspace 旨在随 AI Coding 工具生态一同成长，来自不同工具用户的贡献至关重要。

## 行为准则

保持尊重。假定善意。专注于工作本身。

## 贡献方式

| 贡献 | 影响 | 适合首次贡献？ |
|---|---|---|
| 添加新工具适配器 | 扩展生态 | 是 |
| 为特定领域编写规范规则 | 帮助特定项目类型 | 是 |
| 改进同步 / 校验 / 导入脚本 | 核心可靠性 | 否 |
| 报告工具兼容性问题 | 早期发现 | 是 |
| 改进文档 | 降低入门门槛 | 是 |

## 开发环境

无需构建步骤。AI Workspace 是基于文件的基础设施层。

```bash
git clone <repo-url>
cd ai-workspace
```

测试适配器输出：

```bash
.ai-workspace/scripts/aiws sync
.ai-workspace/scripts/aiws validate
```

## 添加新工具适配器

1. 创建目录：`.ai-workspace/adapters/<工具名>/`
2. 创建适配器模板：`.ai-workspace/adapters/<工具名>/<工具名>.md`（可选）
3. 创建映射文件：`.ai-workspace/adapters/<工具名>/mapping.yaml`
4. 如需生成原生文件，在 `aiws` 的 `generate_tool_file()` 中添加 `case` 分支
5. 在 `common.sh` 的 `get_tool_mcp_path()` 和 `get_tool_skills_path()` 中添加路径映射
6. 更新 `workspace.json` 的 `tools` 列表
7. 更新 `README.md` 支持的工具表
8. 运行 `aiws sync` 和 `aiws validate`

**适配器模板指南：**

- 适配器保持在 50 行以内。如果需要更多，说明应先改进规范表示。
- 可用时使用工具原生的 include/import 机制。
- 不支持 include 时回退为内联内容。
- 记录测试的工具版本。

### mapping.yaml 格式

```yaml
tool: codex
version: ">=0.1"
includes_support: true          # 工具是否支持 @include 语法？
include_syntax: "@{path}"       # Include 语法模式
rules:
  - source: rules/00-core.md
    required: true
  - source: rules/01-code-style.md
    required: true
  - source: rules/domains/aspnet.md
    required: false              # 仅在特定项目上下文中加载
```

## 编写规范规则

规则存放在 `.ai-workspace/rules/` 中。遵循以下格式：

```markdown
---
id: nn-topic
title: 人类可读的标题
scope: all
---

# 标题

## 章节

- 规则以祈使语气表述（"对文件名使用 kebab-case"）。
- 推理不显而易见时在括号中附加理由。
```

**指南：**

- 每个文件一个主题。超过 200 行时拆分。
- 规则用**祈使语气**书写（"对文件名使用 kebab-case"，而非"我们应该使用 kebab-case"）。
- 规则不显而易见时包含简短理由。
- 核心规则放在 `rules/`，领域特定规则放在 `rules/domains/`。
- 永远不要在规范规则中引用特定的 AI Coding 工具。

## 贡献脚本

脚本使用 POSIX shell（`#!/bin/sh`），依赖 `jq` 处理 JSON。新增脚本遵循以下约定：

- 使用 `common.sh` 中的日志函数（`log_info`、`log_success`、`log_warn`、`log_error`、`log_debug`）
- 通过 `has_jq` 检查依赖，通过 `require_cmd` 要求必需工具
- 修改操作前调用 `backup_file`，写入使用 `write_atomic`
- 支持 `--dry-run` 模式用于非破坏性预览
- Shell 脚本不依赖 GNU 扩展——测试 macOS 兼容性

## Pull Request 流程

1. Fork 并分支。
2. 遵循上述指南进行修改。
3. 运行 `aiws sync` 和 `aiws validate`。
4. 更新 `CHANGELOG.md` 的 `[Unreleased]` 部分。
5. 提交清晰的 PR 描述。

维护者将在一周内审查。

## 风格指南

- **语言**：英文（国际通用，非美式习语）。文档和面向用户内容使用简体中文。
- **行长度**：无硬性限制，但建议 100 字符。
- **文件名**：目录和非工具文件使用 kebab-case。
- **YAML**：2 空格缩进。
- **Markdown**：ATX 标题（`#`），带语言标记的围栏代码块。

## 致谢

所有贡献者均在仓库中致谢。重要贡献（新工具适配器、主要规则集）在 `CHANGELOG.md` 中特别标注。
