# 文档索引

本目录收纳 AI Workspace 的全部项目文档。按用途分类如下。

## 总览（从这里开始）

| 文档 | 说明 |
|---|---|
| [SPEC.md](SPEC.md) | **项目总体 spec**——是什么、怎么工作、三个交付物、目录结构 |
| [FEATURE_BREAKDOWN.md](FEATURE_BREAKDOWN.md) | **功能面拆解**——按业务域（规则/技能/MCP/密钥/记忆/配置）+ 横切能力梳理现状、端覆盖、TODO |
| [TESTING.md](TESTING.md) | **逐步验证测试指导**——按 TUI/Desktop 每个 task 给出具体测试用例 |

## 参考（reference/）

| 文档 | 说明 |
|---|---|
| [ARCHITECTURE.md](reference/ARCHITECTURE.md) | 架构设计：三层架构、数据流、文件格式契约、CLI 命令体系 |
| [DESIGN_PHILOSOPHY.md](reference/DESIGN_PHILOSOPHY.md) | 设计哲学：五原则、显式权衡、反模式、与替代方案对比 |
| [FAQ.md](reference/FAQ.md) | 常见问题：安装配置、双向同步、工具兼容、规则、维护 |

## 操作指南（guides/）

| 文档 | 说明 |
|---|---|
| [个人多端-AI-辅助编程-统一管理操作文档.md](guides/个人多端-AI-辅助编程-统一管理操作文档.md) | ⚠️ 历史方案（`~/.ai-rules` 软链接），已被 `.ai-workspace/` 取代，仅供参考 |

## 调研素材（research/）

| 文档 | 说明 |
|---|---|
| [open-source-alternatives.zh-CN.md](research/open-source-alternatives.zh-CN.md) | AI Workspace 开源替代品竞品调研报告（2026-08 核实） |

## 设计与实施（superpowers/）

由 superpowers 工作流产出的设计规格与实施计划，按日期归档。

| 目录 | 说明 |
|---|---|
| [specs/](superpowers/specs/) | 设计规格（canonical-rules / phase1 / tui / desktop-app） |
| [plans/](superpowers/plans/) | 实施计划（tui 12 task / desktop-app 20 task） |
| [reviews/](superpowers/reviews/) | 代码审查报告 + 人工验证指导（按业务域归档） |

## 根目录文档

| 文档 | 说明 |
|---|---|
| [../README.md](../README.md) | 项目主页（快速开始、工作原理、CLI 命令参考） |
| [../ROADMAP.md](../ROADMAP.md) | 路线图（Phase 0-3 与优先级） |
| [../CHANGELOG.md](../CHANGELOG.md) | 变更日志 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献指南 |
