# 贡献指南

[English](CONTRIBUTING.md) | 简体中文

感谢你关注 AI Workspace。AI Workspace 旨在随 AI Coding 工具生态共同成长，来自不同工具用户的贡献至关重要。

## 行为准则

保持尊重。假定善意。专注于工作本身。

## 贡献方式

| 贡献类型 | 影响 | 适合新手？ |
|---|---|---|
| 添加新工具适配器 | 扩展生态 | 是 |
| 为特定领域编写规范规则 | 帮助特定项目类型 | 是 |
| 改进 sync/validate 脚本 | 核心可靠性 | 否 |
| 报告工具兼容性问题 | 早期发现 | 是 |
| 改进文档 | 降低入门门槛 | 是 |

## 开发环境

无需构建步骤。AI Workspace 是基于文件的基础设施层。

```bash
git clone <仓库地址>
cd ai-workspace
```

本地测试适配器输出：

```bash
.ai-workspace/scripts/sync.sh
.ai-workspace/scripts/validate.sh
```

## 添加新工具适配器

1. 创建目录：`.ai-workspace/adapters/<工具名>/`
2. 创建指令模板：`.ai-workspace/adapters/<工具名>/<工具>.md`
3. 创建映射文件：`.ai-workspace/adapters/<工具名>/mapping.yaml`
4. 添加工具的根级入口文件（如 `.github/copilot-instructions.md`）
5. 更新 `README.md` 中的支持工具表
6. 运行 `sync.sh` 和 `validate.sh`

**适配器模板准则：**

- 适配器保持在 50 行以内。如果需要更多，应先改进规范表示。
- 优先使用工具原生的 include/import 机制。
- 不支持 include 时，回退到内联合并内容。
- 记录测试时使用的工具版本。

### mapping.yaml 格式

```yaml
tool: codex
version: ">=1.0"
includes_support: true
include_syntax: "@{path}"
rules:
  - source: rules/00-core.md
    required: true
  - source: rules/01-code-conventions.md
    required: true
  - source: rules/domains/frontend.md
    required: false
```

## 编写规范规则

规则存放在 `.ai-workspace/rules/` 中。遵循以下格式：

```markdown
---
id: nn-topic
title: 人类可读的标题
priority: 1-5
scope: [always, domain, context]
---

# 标题

## 章节

- 以祈使语气写规则
- 不显而易见的规则在括号中补充理由
```

**编写准则：**

- 一个文件一个主题。超过 200 行时拆分。
- 使用祈使语气（"文件名使用 kebab-case"，而非"我们应该使用 kebab-case"）。
- 规则不显而易见时补充简要理由。
- 使用 `scope` 字段：`always` 通用，`domain` 领域特定，`context` 情境。
- 规范规则中绝不引用具体的 AI Coding 工具。

## Pull Request 流程

1. Fork 并创建分支。
2. 按上述准则进行修改。
3. 运行 `sync.sh` 和 `validate.sh`。
4. 在 `CHANGELOG.md` 的 `[Unreleased]` 下更新记录。
5. 提交 PR，附带清晰描述。

维护者将在一周内审核。

## 风格指南

- 中文文档统一使用简体中文。
- 英文文档行长建议不超过 100 字符，中文建议不超过 80 字符。
- 目录和非工具文件使用 kebab-case。
- YAML 使用 2 空格缩进。
- Markdown 使用 ATX 标题（`#`），代码块带语言标签。

## 致谢

所有贡献者均在仓库中致谢。重大贡献（新工具适配器、大型规则集）会在 `CHANGELOG.md` 中单独标注。
