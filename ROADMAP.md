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
| mapping.yaml 驱动的规则选择性包含 | P1 · ✅ 已完成 |
| 规则反向导入（`aiws import rules`） | P2 |
| GitHub Copilot 适配器 | P2 |
| 按 tools 字段过滤规则 | P2 |

## Phase 1.5：可视化 TUI — ✅ 已完成

首版 TUI（Ink + React）已交付：`aiws --json` 输出，以及 Dashboard / Rules / MCP / Skills / Secrets / 生效规则 六页全部实现。下方「延后」项为明确留待后续的增强。

| 任务 | 优先级 | 状态 |
|---|---|---|
| aiws `--json` 输出：`mcp list` / `skills list` / `secrets list` / `secrets audit` | P0 | ✅ 已完成 |
| Ink TUI：Dashboard / Rules / MCP / Skills / Secrets / 生效规则 | P0 | ✅ 已完成 |
| 界面内编辑规则 + 保存自动 sync | P0 | ⏸ 延后（首版规则页仅列表 + 装载开关） |
| validate `--json` 结构化输出 | P1 | ⏸ 延后（TUI 需要仪表盘校验结果时再实现） |
| TUI 部署为全局工具（跨项目管理） | P2 | ⏸ 延后（首版仅项目内命令） |
| secrets 写入操作（增删改） | P2 | ⏸ 延后（首版仅只读展示 + 审计） |
| 规则编辑视图（Enter 多字段表单：title/desc/globs） | P2 | ⏸ 延后 |
| MCP 添加完整表单（Tab 切换字段） | P2 | ⏸ 延后（首版为逐字符输入简化版） |
| 技能逐工具逐 scope 细粒度链接/卸载 | P2 | ⏸ 延后（首版仅 global scope 快捷操作） |

## Phase 1.6：Desktop 独立 macOS 应用 — ✅ 已完成

Electron + React + TypeScript 实现的独立管理应用（`electron/`），core 层为纯 TS 重写、可脱离 GUI 直测。

| 任务 | 状态 |
|---|---|
| 多仓库管理器（userData 持久化） | ✅ 已完成 |
| core 层 TS 重写（规则 / MCP / 技能 / 同步 / diff / 仓库 / 配置 / 错误模型） | ✅ 已完成 |
| IPC 接线 + 错误序列化 + vault 只读桥接 | ✅ 已完成 |
| 批量同步（可取消 + 进度 + 系统通知） | ✅ 已完成 |
| 托盘（显示窗口 / 快速同步全部 / 退出） | ✅ 已完成 |
| renderer 各页（仓库 / 仪表盘 / 规则 / MCP / 技能 / 密钥 / 差异对比 / 设置） | ✅ 已完成 |
| 差异对比（规范规则 vs 生成文件 side-by-side diff） | ✅ 已完成 |
| dmg 打包（arm64，签名默认关） | ✅ 已完成 |

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
