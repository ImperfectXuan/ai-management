<p align="center">
  <h1 align="center">AI Workspace</h1>
  <p align="center">
    AI Coding 工具的共享基础设施 —— 单一事实来源，所有工具同步更新。
  </p>
</p>

[English](README.md) | 简体中文

---

## 这是什么？

AI Workspace 是一套嵌入项目仓库的基础设施层。它为规则、约定、技能和项目记忆提供**单一事实来源**，然后分发给每一个你使用的 AI Coding 工具 —— Claude Code、Codex、Cursor、Trae 等。

你不再需要维护内容重复的 `AGENTS.md`、`CLAUDE.md`、`.cursorrules` 和 `.trae/` 文件，只需维护**一套规范规则**。薄适配器会将这些规则翻译成每个工具的原生格式。

## 为什么需要？

| 不用 AI Workspace | 用了 AI Workspace |
|---|---|
| N 个工具 = N 份相同规则 | 1 套规范 → N 个自动生成的适配器 |
| 更新规则要改 4+ 个文件 | 改一次，同步全部 |
| 切换工具丢失所有上下文 | 项目记忆跨工具保留 |
| 团队成员用不同工具看到不同规则 | 全团队 AI 行为一致 |
| 为一个工具写的技能无法复用 | 技能定义一次，全工具翻译 |

## 支持的工具

| 工具 | 状态 | 适配器 |
|---|---|---|
| Codex | 已设计 | `adapters/codex/` |
| Claude Code | 已设计 | `adapters/claude/` |
| Cursor | 计划中 | `adapters/cursor/` |
| Trae | 计划中 | `adapters/trae/` |
| GitHub Copilot | 待排期 | — |

## 快速开始

```bash
# 1. 在项目根目录初始化或克隆本仓库
git init  # 如果还不是 Git 仓库

# 2. 运行脚手架脚本建立目录结构
.ai-workspace/scripts/scaffold.sh

# 3. 编辑规范规则
vim .ai-workspace/rules/00-core.md

# 4. 同步到所有工具
.ai-workspace/scripts/sync.sh
```

## 工作原理

```
     你只需改一次
          │
          ▼
  ┌─────────────────────────┐
  │  .ai-workspace/rules/   │  ← 规范规则（单一事实来源）
  └───────────┬─────────────┘
              │
     ┌────────┼────────┬────────┐
     ▼        ▼        ▼        ▼
  Codex    Claude   Cursor   Trae      ← 薄适配器
  适配器   适配器    适配器    适配器
     │        │        │        │
     ▼        ▼        ▼        ▼
 AGENTS.md CLAUDE.md .cursor-  .trae/   ← 工具原生文件
                     rules
```

## 目录结构

```
.
├── .ai-workspace/               # 核心基础设施
│   ├── rules/                   # 规范规则（事实来源）
│   │   └── domains/             # 领域特定规则子集
│   ├── adapters/                # 工具特定的翻译模板
│   │   ├── codex/
│   │   ├── claude/
│   │   ├── cursor/
│   │   └── trae/
│   ├── skills/                  # 跨工具技能定义
│   ├── memory/                  # 持久化项目知识
│   │   ├── adr/                 # 架构决策记录
│   │   ├── context/             # 项目上下文摘要
│   │   └── decisions/           # 技术决策日志
│   ├── mcp/                     # 共享 MCP 服务器配置
│   ├── scripts/                 # 自动化脚本
│   └── templates/               # 项目模板
├── docs/                        # 文档
├── AGENTS.md                    # Codex 入口
├── CLAUDE.md                    # Claude Code 入口
├── CONTRIBUTING.md
├── CHANGELOG.md
└── ROADMAP.md
```

## 文档

| 文档 | 说明 |
|---|---|
| [总体 Spec](docs/SPEC.md) | 项目定位、架构、三交付物、目录结构 |
| [测试指导](docs/TESTING.md) | 按 task 逐步验证的测试用例 |
| [文档索引](docs/README.md) | 全部文档的导航 |
| [架构设计](docs/reference/ARCHITECTURE.zh-CN.md) | 系统设计、分层与数据流 |
| [设计哲学](docs/reference/DESIGN_PHILOSOPHY.zh-CN.md) | 原则、权衡与设计理由 |
| [常见问题](docs/reference/FAQ.zh-CN.md) | 常见问题解答 |
| [路线图](ROADMAP.zh-CN.md) | 计划功能与里程碑 |
| [贡献指南](CONTRIBUTING.zh-CN.md) | 如何参与贡献 |
| [变更日志](CHANGELOG.zh-CN.md) | 版本历史 |

## 参与贡献

欢迎贡献。请先阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) 了解如何添加新工具适配器、编写规则和提交变更。

## 许可证

MIT
