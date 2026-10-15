# 文档索引

AI Workspace 文档按规格驱动开发（SDD）组织：需求 → 设计 → 任务 → 验证 → 追踪。完整约定见 [SDD.md](SDD.md)。

## 1. 阅读入口

| 目的 | 阅读路径 |
|---|---|
| 安装与使用 | [个人用户操作手册](guides/personal-user-manual.zh-CN.md) → [项目 README](../README.md) / [FAQ](reference/FAQ.md) → [各端说明](../electron/README.md) |
| 理解项目边界 | [总体需求 SPEC](SPEC.md) → [能力盘点](FEATURE_BREAKDOWN.md) → [系统架构](reference/ARCHITECTURE.md) |
| 开始功能开发 | [SDD 约定](SDD.md) → [功能模板](specs/TEMPLATE.md) → [追踪矩阵](TRACEABILITY.md) → [贡献指南](../CONTRIBUTING.md) |
| 判断进度与下一步 | [PROGRESS](PROGRESS.md) → [路线图](../ROADMAP.md) |
| 验证交付 | [追踪矩阵](TRACEABILITY.md) → [测试指导](TESTING.md) / [人工手册](manual-testing/README.md) → [最终验收](manual-testing/12-acceptance.md) |

## 2. SDD 核心文档

| 环节 | 文档 | 职责 |
|---|---|---|
| 组织约定 | [SDD.md](SDD.md) | 文档归属、ID、状态、变更工作流与检查清单 |
| 需求 | [SPEC.md](SPEC.md) | 目标、范围、需求 ID 与验收条件 |
| 需求细化 | [specs/TEMPLATE.md](specs/TEMPLATE.md) | 新功能 spec / design / tasks / verification 模板 |
| 能力盘点 | [FEATURE_BREAKDOWN.md](FEATURE_BREAKDOWN.md) | 既有能力、端覆盖与候选增强，不作为排期承诺 |
| 设计 | [ARCHITECTURE.md](reference/ARCHITECTURE.md) | 系统分层、契约与当前端差异 |
| 设计原则 | [DESIGN_PHILOSOPHY.md](reference/DESIGN_PHILOSOPHY.md) | 原则与权衡 |
| 追踪 | [TRACEABILITY.md](TRACEABILITY.md) | 总体需求关联设计、既有任务与验收方法；标明缺口 |
| 执行状态 | [PROGRESS.md](PROGRESS.md) | 唯一实施状态入口与历史证据 |
| 规划 | [ROADMAP.md](../ROADMAP.md) | 阶段方向与候选优先级，完成记录引用 PROGRESS |
| 发布 | [CHANGELOG.md](../CHANGELOG.md) | 用户可感知的实际变更 |

## 3. 验证文档

[TESTING.md](TESTING.md) 保留 TUI / Desktop 的历史 task 验证方法；[Desktop 验收](../electron/ACCEPTANCE.zh-CN.md) 覆盖模块、GUI 和打包。验证方法不是已经通过的报告。

| 人工手册 | 切面 |
|---|---|
| [总纲](manual-testing/README.md) | 对象、执行顺序、验收规则 |
| [00 环境](manual-testing/00-environment.md) | 依赖与临时仓库 |
| [01 CLI](manual-testing/01-cli-basics.md) | setup / validate |
| [02 规则](manual-testing/02-rules.md) | mapping、装载、版本化与 tools |
| [03 技能](manual-testing/03-skills.md) | 安装、链接、卸载 |
| [04 MCP](manual-testing/04-mcp.md) | 配置、scope 与格式转换 |
| [05 密钥](manual-testing/05-secrets.md) | vault、授权与审计 |
| [06 记忆](manual-testing/06-memory.md) | ADR / context / decisions |
| [07 同步](manual-testing/07-sync.md) | 生成与漂移闭环 |
| [08 导入](manual-testing/08-import.md) | 存量收编与保护 |
| [09 CI 与 hooks](manual-testing/09-ci-hooks.md) | 自动化安装与提交校验 |
| [10 TUI](manual-testing/10-tui.md) | 终端交互 |
| [11 Desktop](manual-testing/11-desktop.md) | 桌面界面 |
| [12 最终验收](manual-testing/12-acceptance.md) | 回归、验收清单与结果模板 |

## 4. 历史设计与评审

当前新增功能规格：[001 · 多项目存量资产收编与复用](specs/001-asset-intake/spec.md)；[任务拆分](specs/001-asset-intake/tasks.md)；[Coding Agent prompts](specs/001-asset-intake/coding-prompts.md)；[验证记录](specs/001-asset-intake/verification.md)。产品方向已确认，执行细则为草案，功能尚未实现。

`superpowers/` 保留原路径与原始内容，作为阶段资料。具体文件关联见 [追踪矩阵](TRACEABILITY.md)。历史计划中的未勾选项不能直接当作当前待办。

| 类型 | 文档 |
|---|---|
| 设计 | [初始规则](superpowers/specs/2026-07-23-canonical-rules-design.md)、[Phase 1](superpowers/specs/2026-07-23-phase1-design.md)、[TUI](superpowers/specs/2026-08-04-tui-design.md)、[Desktop](superpowers/specs/2026-08-07-desktop-app-design.md)、[Memory](superpowers/specs/2026-09-01-memory-system-design.md) |
| 原始任务 | [TUI](superpowers/plans/2026-08-04-tui.md)、[Desktop](superpowers/plans/2026-08-07-desktop-app.md)、[Memory](superpowers/plans/2026-09-01-memory-system.md) |
| 域评审 | [Rules 评审](superpowers/reviews/2026-08-24-rules-domain-review.md)、[Rules 验证方法](superpowers/reviews/2026-08-24-rules-domain-verification.md)、[Skills 评审](superpowers/reviews/2026-08-24-skills-domain-review.md)、[Skills 修复计划](superpowers/reviews/2026-08-24-skills-domain-fix-plan.md) |

## 5. 使用说明与资料

- [个人用户操作手册](guides/personal-user-manual.zh-CN.md)：面向本地个人使用的完整流程，以 CLI + TUI 为主。

- [TUI README](../tui/README.md)、[Desktop README](../electron/README.md)：各端开发与使用。
- [贡献指南](../CONTRIBUTING.md)：开发、规则编写与 PR 流程。
- [开源替代品调研](research/open-source-alternatives.zh-CN.md)：2026-08 调研快照，不是当前产品承诺。
- [早期多端操作方案](guides/个人多端-AI-辅助编程-统一管理操作文档.md)：已被 `.ai-workspace/` 方案取代，不再用于安装指导。

`.ai-workspace/rules/` 管理工具行为约束，`.ai-workspace/memory/` 管理工作区上下文与决策，均不与 `docs/` 产品规格重复维护。
