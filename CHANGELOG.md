English | 简体中文

# 更新日志

本文件记录 AI Workspace 项目的所有显著变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### Added

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
- **双向同步** — `aiws import mcp` 从各工具反向导入 MCP 配置（含 TOML 解析）；`aiws import skills` 从各工具 Skills 目录导入技能。
- **工作区配置** — `workspace.json` 控制启用的工具、scope 默认值和模块开关。
- **7 条规范核心规则** — 覆盖通用开发约定的 `00-core` 至 `06-error-handling`。
- **6 条领域规则** — 从 `~/.ai-rules/*.mdc` 转换的 ASP.NET、Vue 3、WinForms、WPF、Karpathy 行为准则、全局工作流。
- **设计文档** — Phase 1 多工具、Skills DSL 和记忆系统的设计规格（中文）。

### Changed

- CLI 从分散的 `sync.sh` / `validate.sh` 升级为统一 `aiws` 命令，包含 sync / validate / mcp / skills / secrets / import 子命令。

### Deprecated

- `sync.sh`、`scaffold.sh` — 请使用 `aiws sync` 和 `aiws setup`。
