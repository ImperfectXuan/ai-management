<p align="center">
  <h1 align="center">AI Workspace</h1>
  <p align="center">
    面向 AI Coding 工具的共享基础设施 — 单一事实来源，全工具同步。
  </p>
</p>

---

## AI Workspace 是什么？

AI Workspace 是位于仓库内的项目级基础设施层。它为规则、约定、技能和项目记忆提供**单一事实来源**，然后将它们分发到你使用的每个 AI Coding 工具 — Claude Code、Codex、Cursor、Trae 等。

你不用再维护内容重叠的 `AGENTS.md`、`CLAUDE.md`、`.cursorrules` 和 `.trae/` 文件，而是维护**一套规范规则**。薄适配器将那些规则翻译为每个工具的原生格式。

## 为什么需要它？

| 没有 AI Workspace | 有 AI Workspace |
|---|---|
| N 个工具 = N 份相同规则的副本 | 1 套规范 → N 个自动生成的适配器 |
| 更新规则意味着编辑 4 个以上文件 | 一次编辑，全工具同步 |
| 切换工具丢失所有上下文 | 项目记忆跨工具保留 |
| 使用不同工具的团队成员看到不同规则 | 整个团队获得一致的 AI 行为 |
| 为一个工具编写的技能被隔离 | 技能定义一次，翻译给所有工具 |

## 支持的工具

| 工具 | 状态 | 适配器 |
|---|---|---|
| Codex | ✅ 已实现 | `adapters/codex/` |
| Claude Code | ✅ 已实现 | `adapters/claude/` |
| Cursor | ✅ 已实现 | `adapters/cursor/` |
| Trae | ✅ 已实现 | `adapters/trae/` |

## 快速开始

```bash
# 1. 进入项目根目录
cd your-project

# 2. 运行 setup 初始化目录结构
.ai-workspace/scripts/aiws setup

# 3. 从已有工具安装中导入 MCP 和 Skills（双向同步）
.ai-workspace/scripts/aiws import skills --dry-run   # 预览
.ai-workspace/scripts/aiws import skills -y           # 正式导入
.ai-workspace/scripts/aiws import mcp --dry-run       # 预览 MCP

# 4. 编辑规范规则
vim .ai-workspace/rules/00-core.md

# 5. 同步到所有工具
.ai-workspace/scripts/aiws sync
```

## 工作原理

```
   你编辑一次
        │
        ▼
  ┌─────────────────────────────────────┐
  │  .ai-workspace/                     │  ← 规范层（单一事实来源）
  │  ├── rules/      规则               │
  │  ├── skills/     技能               │
  │  ├── mcp/        MCP 配置           │
  │  ├── memory/     项目记忆           │
  │  └── secrets/    加密密钥           │
  └───────────┬─────────────────────────┘
              │
     ┌────────┼────────┬────────┐
     ▼        ▼        ▼        ▼
  Codex    Claude   Cursor    Trae      ← 薄适配器
  适配器    适配器    适配器    适配器
     │        │        │        │
     ▼        ▼        ▼        ▼
 AGENTS.md CLAUDE.md .cursor-  .trae/   ← 工具原生文件
                     rules     rules.md
```

### 双向同步

AI Workspace 支持**双向**操作：

```
                   aiws sync
  规范层 (.ai-workspace/) ──────────→ 工具原生文件
  规范层 (.ai-workspace/) ←────────── 工具原生文件
                   aiws import
```

- **`aiws sync`**：将规范层内容同步到所有工具
- **`aiws import`**：将各工具中已安装的 MCP / Skills 反向导入规范层统一管理

## 目录结构

```
.
├── .ai-workspace/               # 核心基础设施
│   ├── rules/                   # 规范规则（事实来源）
│   │   └── domains/             # 领域特定规则子集
│   ├── adapters/                # 工具特定翻译模板
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
│   │   ├── mcp.json             #   主配置（可提交）
│   │   └── mcp.local.json       #   本地覆盖（gitignore）
│   ├── secrets/                 # 加密密钥管理
│   ├── config/                  # 工作区配置
│   └── scripts/                 # 自动化脚本
│       ├── aiws                 #   CLI 入口
│       └── lib/                 #   脚本库
├── docs/                        # 文档
├── AGENTS.md                    # Codex 入口（自动生成）
├── CLAUDE.md                    # Claude Code 入口（自动生成）
├── .cursorrules                 # Cursor 入口（自动生成）
├── .trae/rules.md               # Trae 入口（自动生成）
├── CONTRIBUTING.md
├── CHANGELOG.md
└── ROADMAP.md
```

## AIWS CLI 命令参考

```bash
aiws setup                        # 初始化工作区
aiws sync                         # 同步所有配置到工具
aiws sync --tool claude           # 仅同步到 Claude
aiws sync --only rules            # 仅同步规则（CI 自动同步所用）
aiws validate                     # 校验工作区结构

# 规则管理
#   （直接编辑 .ai-workspace/rules/*.md，然后 sync）
aiws rules status                 # 自上次同步以来变更的规则
aiws rules history <id>           # 单条规则的 git 历史
aiws ci install                   # 安装 GitHub Actions 推送自动同步

# MCP 管理
aiws mcp list                     # 列出 MCP 服务器
aiws mcp add <name> <command>     # 添加 MCP 服务器
aiws mcp remove <name>            # 移除 MCP 服务器
aiws mcp show <name>              # 查看服务器详情

# Skills 管理
aiws skills list                  # 列出所有技能及同步状态
aiws skills link [scope]          # 链接技能到工具
aiws skills install <source>      # 从 GitHub/npm/本地安装技能

# Secrets 管理
aiws secrets set <key>            # 设置加密密钥
aiws secrets list                 # 列出密钥名称
aiws secrets audit                # 查看各工具的密钥使用情况

# 导入（反向同步）
aiws import skills --dry-run      # 预览可导入的技能
aiws import skills --from claude  # 从指定工具导入技能
aiws import mcp --dry-run         # 预览可导入的 MCP
aiws import mcp --from codex      # 从 Codex 导入 MCP
```

## 文档

| 文档 | 说明 |
|---|---|
| [总体 Spec](docs/SPEC.md) | 项目定位、架构、三交付物、目录结构 |
| [测试指导](docs/TESTING.md) | 按 task 逐步验证的测试用例 |
| [人工测试手册](docs/manual-testing/README.md) | 面向测试者的按功能切面逐步验收（上线验收标准） |
| [文档索引](docs/README.md) | 全部文档的导航 |
| [架构设计](docs/reference/ARCHITECTURE.md) | 系统设计、分层与数据流 |
| [设计哲学](docs/reference/DESIGN_PHILOSOPHY.md) | 原则、权衡与理由 |
| [FAQ](docs/reference/FAQ.md) | 常见问题 |
| [Roadmap](ROADMAP.md) | 计划的功能与里程碑 |
| [贡献指南](CONTRIBUTING.md) | 如何贡献 |
| [Changelog](CHANGELOG.md) | 版本历史 |

## 贡献

欢迎贡献。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解添加新工具适配器、编写规则和提交更改的指南。

## License

MIT
