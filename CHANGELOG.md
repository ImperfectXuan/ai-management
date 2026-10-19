# 更新日志

本文件记录 AI Workspace 项目的所有显著变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### Added

- **Desktop 规则查看与编辑（desktop-rule-editor）** — 规则页升级为主从视图：选中规则后可查看全文，并以 Milkdown 富文本编辑 Markdown 正文，以表单编辑 `title` / `description` / `scope` / `globs` / `tools`（`id` 只读）。保存由主进程执行路径校验、版本冲突检测与原子写入，未知 frontmatter 键保持不变；保存后只标记待同步，不自动分发。含原始 HTML 的规则自动降级为源码编辑。TUI 未包含本次改动。

- **持久化同步版本状态（功能 002，Desktop）** — 按内容库 × 应用项目 × 工具 × 模块 × scope 记录来源版本是否已成功分发。CLI 新增 `aiws sync --describe-inputs`（只读输入描述）与 `--report-file`（单元结构化回执）；Desktop 统一经 `sync-service` 写入（含目标锁、共享 Skills 等价收敛、密钥派生 keyId）；概览页「同步版本状态」只读面板支持刷新/切页重查与本机记录重建。版本记录不证明目标文件一致，也不证明 MCP 在线。AC-002-01～05、07～11、13～18 通过；原生两次启动与 dmg 安装验收未执行。

- 本机隔离演示入口、两轮真实引擎演示验证与带 SHA-256 清单的源码快照，便于冻结当前未提交实现。

- 个人用户操作手册：首次安装、已有配置收编、项目级同步、规则 / MCP / 技能 / 记忆维护、TUI 与 Desktop 操作、密钥边界与故障恢复。

- 初始仓库结构，包含 `.ai-workspace/` 核心目录。
- 规范规则框架（`rules/`），包含领域子目录。
- Codex、Claude Code、Cursor、Trae 的适配器模板（`mapping.yaml`）。
- 项目文档：README、AGENTS.md、CLAUDE.md、CONTRIBUTING.md、CHANGELOG.md、ROADMAP.md、FAQ、架构设计、设计哲学。
- skills、memory、MCP、secrets 的占位目录。
- 空目录的 `.gitkeep` 约定。
- **`aiws` CLI** — 统一命令行接口，替代 `sync.sh`。
- **规则同步引擎** — 将 `rules/*.md` + `rules/domains/*.md` 全量拼接为工具原生文件（CLAUDE.md、AGENTS.md、.cursorrules、.trae/rules.md）。
- **MCP 同步引擎** — JSON ↔ TOML 双向转换；`scope` 字段驱动分发；`mcp.local.json` 本地覆盖；`${secret:XXX}` 占位符替换。
- **Skills 同步引擎** — 跨平台 symlink（macOS/Linux symlink、Windows junction、复制回退）；从 Git/npm/本地路径安装。
- **加密密钥保管库** — age 加密 + TOTP 2FA；按工具的权限控制（`permissions.yaml`）。
- **双向同步** — `aiws import mcp` 从各工具反向导入 MCP 配置（含 TOML 解析）；`aiws import skills` 从各工具 Skills 目录导入技能；`aiws import rules` 从工具文件反向导入未纳管规则（cursor/trae 逐条转换、claude/codex 整文件导入，自动登记 adapter mapping，managed/conflict 保护不覆盖 canonical）。
- **工作区配置** — `workspace.json` 控制启用的工具、scope 默认值和模块开关。
- **7 条规范核心规则** — 覆盖通用开发约定的 `00-core` 至 `06-error-handling`。
- **6 条领域规则** — 从 `~/.ai-rules/*.mdc` 转换的 ASP.NET、Vue 3、WinForms、WPF、Karpathy 行为准则、全局工作流。
- **设计文档** — Phase 1 多工具、Skills DSL 和记忆系统的设计规格（中文）。
- **可视化 TUI（`tui/`）** — Ink + React 终端界面，六页（仪表盘 / 规则 / MCP / 技能 / 密钥 / 生效规则），薄壳调用 `aiws` CLI；`aiws --json` 结构化输出支撑各页。
- **Desktop 独立 macOS 应用（`electron/`）** — Electron + React + TypeScript 管理应用。core 层纯 TS 重写（规则 / MCP / 技能 / 同步 / 行级 diff / 仓库 / 配置 / 错误模型），renderer → main（IPC）→ core 三层架构，core 可脱离 GUI 直测（32 用例）。多仓库管理、仪表盘一键同步（可取消 + 进度 + 系统通知）、规则装载开关、MCP 增删、技能链接/卸载、密钥只读审计、规范 vs 生成差异对比、托盘快捷操作、dmg 打包（arm64）。
- **CI/CD 推送自动同步** — `aiws ci install` 生成 GitHub Actions 工作流（`.github/workflows/aiws-sync.yml`）：push 变更 `.ai-workspace/**` 时 validate → `sync --only rules` → 自动提交（bot 身份 + `[skip ci]` 防回环 + concurrency 串行）。
- **规则版本化与变更追踪** — sync 维护 sha256 快照（`rules/.manifest.sha256`，sha256sum 兼容纯文本）与追加式变更日志（`rules/CHANGELOG.md`），无变化零写；`aiws rules status` 报告自上次同步以来的规则变更（补齐 claude/codex 单文件模式的规则级追踪），`aiws rules history <id>` 封装 `git log --follow`。

### Changed

- Desktop 采用浅色配置工作台：左侧分组导航、总库到四工具的分发概览、统一控件和键盘焦点；收编按来源、审核、计划、结果分步展示，变更来源后旧审核与计划自动失效。

- 按 SDD 整理文档：总体需求与验收条件、需求追踪矩阵、功能规格模板与维护约定；区分历史设计、当前能力和执行证据，修正三端架构边界与重复待办。

- CLI 从分散的 `sync.sh` / `validate.sh` 升级为统一 `aiws` 命令，包含 sync / validate / mcp / skills / secrets / import 子命令。
- `aiws sync` 新增 `--only rules|mcp|skills` 模块过滤（CI 仅同步规则：mcp 需要 vault、skills 有链接副作用）。
- 模块开关 `is_module_enabled` 支持点号嵌套键（如 `rules.versioning.enabled`），顶层键行为不变。

### Fixed

- 修复 Desktop 密钥 JSON 桥接与错误反馈，构建前强制执行类型检查。
- Desktop 批量同步复用 CLI，补齐四工具规则、context 和 Skills；默认项目范围，取消与失败不再报告成功。
- 修复规则待同步状态、规则版本记录误计数、差异页格式转换误报、长路径滚动布局、入库写入路径预览和回退状态展示。

- `mcp.json` 非法时的错误函数名（`error` 不存在，set -e 下会崩溃）改为 `log_error`。

### Deprecated

- `sync.sh`、`scaffold.sh` — 请使用 `aiws sync` 和 `aiws setup`。
