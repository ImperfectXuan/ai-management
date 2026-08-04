English | 简体中文

# 路线图

## Phase 0：基础设施 — ✅ 已完成

| 任务 | 状态 |
|---|---|
| 仓库结构和目录树 | ✅ 完成 |
| 规范规则框架（`rules/`） | ✅ 完成 |
| Codex 适配器 | ✅ 完成 |
| Claude Code 适配器 | ✅ 完成 |
| Cursor 适配器 | ✅ 完成 |
| Trae 适配器 | ✅ 完成 |
| 文档套件 | ✅ 完成 |
| sync 脚本（`aiws sync`） | ✅ 完成 |
| validate 脚本（`aiws validate`） | ✅ 完成 |
| aiws CLI 入口 | ✅ 完成 |
| MCP 同步引擎（JSON + TOML） | ✅ 完成 |
| Skills 同步引擎（symlink） | ✅ 完成 |
| 加密密钥保管库（age + TOTP 2FA） | ✅ 完成 |
| 双向同步（`aiws import`） | ✅ 完成 |

## Phase 1：增强 — 进行中

| 任务 | 优先级 |
|---|---|
| ADR 模板和记忆系统 | P1 |
| 项目上下文摘要 | P1 |
| Git pre-commit hook 集成 | P1 |
| mapping.yaml 驱动的规则选择性包含 | P1 |
| 规则反向导入（`aiws import rules`） | P2 |
| GitHub Copilot 适配器 | P2 |
| 按 tools 字段过滤规则 | P2 |

## Phase 1.5：可视化 TUI（进行中，设计阶段）

| 任务 | 优先级 | 状态 |
|---|---|---|
| aiws `--json` 输出：`mcp list` / `skills list` / `secrets list` / `secrets audit` | P0 | 设计中 |
| Ink TUI：Dashboard / Rules / MCP / Skills / Secrets / 生效规则 | P0 | 设计中 |
| 界面内编辑规则 + 保存自动 sync | P0 | 设计中 |
| **延后：`validate --json` 结构化输出** | P1 | 待设计。TUI 需要仪表盘校验结果时再实现，避免首版 validate 全量结构化工作量过大 |
| 延后：TUI 部署为全局工具（跨项目管理） | P2 | 首版仅项目内命令 |
| 延后：secrets 写入操作（增删改） | P2 | 首版仅只读展示 + 审计 |
| 延后：规则编辑视图（Enter 多字段表单：title/desc/globs） | P2 | 首版规则页仅列表 + 装载开关（Space） |
| 延后：MCP 添加完整表单（Tab 切换字段） | P2 | 首版为逐字符输入简化版 |
| 延后：技能逐工具逐 scope 细粒度链接/卸载 | P2 | 首版仅 global scope 快捷操作 |

## Phase 2：自动化与生态

| 任务 | 优先级 |
|---|---|
| CI/CD：推送时自动同步 | P2 |
| 规则版本化和变更追踪 | P2 |
| 跨项目模板提取 | P2 |
| 脚手架脚本：单命令项目初始化 | P3 |

## Phase 3：生态

| 任务 | 优先级 |
|---|---|
| 精选规则集（语言 / 领域包） | P3 |
| 社区贡献模板 | P3 |
| 规则集市场 | P3 |

## 图例

| 优先级 | 含义 |
|---|---|
| P0 | 核心。MVP 必须完成。 |
| P1 | 重要。MVP 后尽快发布。 |
| P2 | 有价值。带宽允许时发布。 |
| P3 | 锦上添花。欢迎社区贡献。 |
