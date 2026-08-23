# 变更日志

本文件记录 AI Workspace 项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。

[English](CHANGELOG.md) | 简体中文

## [未发布]

### 新增

- 初始仓库结构，含 `.ai-workspace/` 核心目录。
- 规范规则框架（`rules/`），含领域子目录。
- Codex、Claude Code、Cursor、Trae 适配器模板。
- 项目文档：README、AGENTS.md、CLAUDE.md、CONTRIBUTING、CHANGELOG、ROADMAP、FAQ、架构设计、设计哲学。
- skills、memory、MCP、templates 占位目录。
- 空目录 `.gitkeep` 约定。
- **`aiws` CLI** — 统一命令行接口，替代分散脚本。
- **规则同步引擎** — `rules/*.md` + `rules/domains/*.md` 拼接为工具原生文件（CLAUDE.md、AGENTS.md、.cursorrules、.trae/rules.md）。
- **MCP 同步引擎** — JSON ↔ TOML 双向转换；`scope` 字段驱动分发；`mcp.local.json` 本地覆盖；`${secret:XXX}` 占位符替换。
- **Skills 同步引擎** — 跨平台 symlink；从 Git/npm/本地安装。
- **加密密钥保管库** — age 加密 + TOTP 2FA；按工具的权限控制。
- **双向同步** — `aiws import mcp` / `aiws import skills` 从各工具反向导入。
- **可视化 TUI（`tui/`）** — Ink + React 终端界面，六页（仪表盘 / 规则 / MCP / 技能 / 密钥 / 生效规则），薄壳调用 `aiws` CLI。
- **Desktop 独立 macOS 应用（`electron/`）** — Electron + React + TypeScript。core 层纯 TS 重写，renderer → main（IPC）→ core 三层架构；多仓库管理、仪表盘一键同步、规则装载开关、MCP 增删、技能链接/卸载、密钥只读审计、差异对比、托盘、dmg 打包（arm64）。

### 变更

- CLI 从分散的 `sync.sh` / `validate.sh` 升级为统一 `aiws` 命令。
- 文档目录重组为 `docs/guides` / `reference` / `research` / `superpowers`。

### 弃用

- `sync.sh`、`scaffold.sh` — 请使用 `aiws sync` 和 `aiws setup`。
