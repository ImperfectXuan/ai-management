# 路线图

> 文档角色：阶段方向与候选优先级。执行状态与完成证据统一查 [PROGRESS](docs/PROGRESS.md)，需求边界查 [SPEC](docs/SPEC.md)。
> 2026-10-10 整理；下列候选项沿用既有规划，不代表已排期或新增交付承诺。开始实施前按 [SDD](docs/SDD.md) 补齐功能规格。

## 1. 阶段与目标

| 阶段 | 目标 | 记录入口 |
|---|---|---|
| Phase 0 | 规范源、四工具适配、CLI、同步 / 校验 / 导入、MCP / 技能 / 密钥 | [PROGRESS §2](docs/PROGRESS.md#2-里程碑总览) |
| Phase 1 | mapping、tools 过滤、记忆模板与 context 注入、pre-commit | [PROGRESS §5](docs/PROGRESS.md#5-近期完成记录) |
| Phase 1.5 | 六页 TUI 与结构化 CLI 列表输出 | [TUI 设计](docs/superpowers/specs/2026-08-04-tui-design.md)；状态查 PROGRESS |
| Phase 1.6 | macOS Desktop、多仓库、管理界面、托盘与打包 | [Desktop 设计](docs/superpowers/specs/2026-08-07-desktop-app-design.md)；状态查 PROGRESS |
| Phase 2 | CI 自动同步、规则版本化，进一步探索跨项目模板与脚手架 | [PROGRESS §2](docs/PROGRESS.md#2-里程碑总览)；两项核心有交付记录，其余仍是候选 |
| Phase 3 | 精选规则集、社区模板与规则集市场 | 需先形成独立需求与设计 |

## 2. 近期质量工作

| 优先级 | 事项 | 关联需求 / 证据入口 |
|---|---|---|
| P0 | Windows 真机 junction / copy 验证收尾 | NFR-COMPAT；[PROGRESS §4](docs/PROGRESS.md#4-skills-域修复收尾与遗留验证) |
| P1 | MCP、vault 与记忆域质量评审 | REQ-MCP / REQ-SECRETS / REQ-MEMORY；[PROGRESS §3](docs/PROGRESS.md#3-业务域质量状态) |

## 3. 首版之后的候选增强

| 优先级 | 候选项 | 范围与约束 |
|---|---|---|
| 已完成（Desktop，2026-10-19） | 界面内编辑规则并保存后同步 | 查看 + 富文本正文 + frontmatter 表单；保存只标记待同步，由用户显式同步；TUI 编辑视图仍待排期 |
| P1（原 TUI 规划） | validate 结构化 JSON 输出 | 配合仪表盘校验展示；尚需功能规格 |
| P2 | TUI 跨项目 / 全局部署 | 当前 TUI 围绕项目仓库运行 |
| P2 | TUI / Desktop 密钥写操作 | 当前 GUI 只读；需独立安全与失败场景设计 |
| P2 | TUI 规则多字段编辑表单、MCP 完整添加表单 | Desktop 规则编辑已完成；TUI 与 MCP 表单仍需定义字段、校验与保存行为 |
| P2 | 技能链接交互进一步完善 | 工具 / scope 选择已有实现；新增需求必须超出现有能力，不能重复开发 |
| P2 | Desktop 与 CLI 同步语义对齐 | 明确单文件规则、context、密钥替换与技能批量同步边界，尚未排期 |
| P2 | 跨项目模板提取 | Phase 2 原规划项 |
| P3 | 单命令项目初始化脚手架 | 区分既有 setup 与可复用模板安装 |
| P3 | 精选规则集、社区贡献模板、规则集市场 | Phase 3 生态方向 |

能力盘点中的其他 TODO 是探索来源，包括 MCP 高级字段、配置迁移、同步报告与回滚等；不自动转化为本路线图中的承诺。实际安排统一进入 [PROGRESS §6](docs/PROGRESS.md#6-待办优先级)。

## 4. 优先级含义

| 优先级 | 含义 |
|---|---|
| P0 | 核心或当前质量阻塞；原阶段 P0 不等于已进入当前冲刺 |
| P1 | 重要，优先于一般增强 |
| P2 | 有价值，按带宽与需求证据安排 |
| P3 | 长期方向或社区贡献候选 |
