# 需求、设计、任务与验证追踪矩阵

> 文档角色：SDD 追踪入口；整理日期：2026-10-10。
> 本表从现有文档建立关联，不代表本轮已执行功能验证。需求定义见 [SPEC.md](SPEC.md)，状态与历史成绩见 [PROGRESS.md](PROGRESS.md)。

## 1. 总体需求追踪

“既有任务入口”可能是历史计划或已完成记录，不是新的开发指令。没有独立计划的需求明确标为缺口，不虚构任务完成状态。验收 ID 的详细判定条件以 SPEC 为准。

| 需求 ID | 设计入口 | 既有任务入口 / 缺口 | 验收入口 |
|---|---|---|---|
| REQ-SETUP | [系统架构](reference/ARCHITECTURE.md) | [进度 §2](PROGRESS.md#2-里程碑总览)；无独立任务包 | AC-SETUP-01 / AC-SETUP-02：[环境](manual-testing/00-environment.md)、[CLI 基础](manual-testing/01-cli-basics.md) |
| REQ-RULES | [规则初始设计](superpowers/specs/2026-07-23-canonical-rules-design.md)、[Phase 1](superpowers/specs/2026-07-23-phase1-design.md) | [规则评审](superpowers/reviews/2026-08-24-rules-domain-review.md)、[进度 §5](PROGRESS.md#5-近期完成记录)；初始任务未独立归档 | AC-RULES-01 / AC-RULES-02 / AC-RULES-03：[规则手册](manual-testing/02-rules.md)、[规则验证指导](superpowers/reviews/2026-08-24-rules-domain-verification.md) |
| REQ-SKILLS | [Phase 1](superpowers/specs/2026-07-23-phase1-design.md)、[架构](reference/ARCHITECTURE.md) | [Skills 修复 A/B/C](superpowers/reviews/2026-08-24-skills-domain-fix-plan.md)、[进度 §4](PROGRESS.md#4-skills-域修复收尾与遗留验证) | AC-SKILLS-01 / AC-SKILLS-02 / AC-SKILLS-03：[技能手册](manual-testing/03-skills.md)；Windows 真机结果待补 |
| REQ-MCP | [架构](reference/ARCHITECTURE.md)、[Desktop 设计](superpowers/specs/2026-08-07-desktop-app-design.md) | [Desktop Task 6/15](superpowers/plans/2026-08-07-desktop-app.md)；CLI 独立任务包缺失，域评审待做 | AC-MCP-01 / AC-MCP-02 / AC-MCP-03：[MCP 手册](manual-testing/04-mcp.md)、[测试指导](TESTING.md) |
| REQ-SECRETS | [架构](reference/ARCHITECTURE.md)、[TUI 设计](superpowers/specs/2026-08-04-tui-design.md) | [Desktop Task 10/16](superpowers/plans/2026-08-07-desktop-app.md)；CLI 独立任务包缺失，vault 评审待做 | AC-SECRETS-01 / AC-SECRETS-02：[密钥手册](manual-testing/05-secrets.md) |
| REQ-MEMORY | [记忆系统设计](superpowers/specs/2026-09-01-memory-system-design.md) | [记忆计划 Task 1–4](superpowers/plans/2026-09-01-memory-system.md)、[进度 §5](PROGRESS.md#5-近期完成记录) | AC-MEMORY-01 / AC-MEMORY-02：[记忆手册](manual-testing/06-memory.md)、[shell 测试](../.ai-workspace/scripts/test/test-memory.sh) |
| REQ-SYNC | [架构与端差异](reference/ARCHITECTURE.md) | [Desktop Task 8/11](superpowers/plans/2026-08-07-desktop-app.md)；CLI 按模块任务未统一归档 | AC-SYNC-01 / AC-SYNC-02 / AC-SYNC-03：[同步手册](manual-testing/07-sync.md)、[桌面验收](../electron/ACCEPTANCE.zh-CN.md) |
| REQ-IMPORT | [架构](reference/ARCHITECTURE.md) | [进度 §5 的规则导入记录](PROGRESS.md#5-近期完成记录)；MCP / Skills 原始任务包缺失 | AC-IMPORT-01 / AC-IMPORT-02：[导入手册](manual-testing/08-import.md)、[导入规则测试](../.ai-workspace/scripts/test/test-import-rules.sh) |
| REQ-VALIDATE | [架构](reference/ARCHITECTURE.md)、[记忆校验设计](superpowers/specs/2026-09-01-memory-system-design.md) | [记忆 Task 4](superpowers/plans/2026-09-01-memory-system.md)、[进度 §5](PROGRESS.md#5-近期完成记录)；通用校验原始任务包缺失 | AC-VALIDATE-01 / AC-VALIDATE-02：[CLI 基础](manual-testing/01-cli-basics.md)、[漂移检测测试](../.ai-workspace/scripts/test/test-drift-check.sh) |
| REQ-AUTOMATION | [架构](reference/ARCHITECTURE.md)、[Phase 1 hooks 设计](superpowers/specs/2026-07-23-phase1-design.md) | [进度 §5](PROGRESS.md#5-近期完成记录)；CI / 版本化独立任务包缺失 | AC-AUTOMATION-01 / AC-AUTOMATION-02 / AC-AUTOMATION-03：[CI 与 hooks 手册](manual-testing/09-ci-hooks.md)、[CI 测试](../.ai-workspace/scripts/test/test-ci.sh)、[规则版本化测试](../.ai-workspace/scripts/test/test-rules-versioning.sh) |
| REQ-TUI | [TUI 设计](superpowers/specs/2026-08-04-tui-design.md) | [TUI Task 1–12](superpowers/plans/2026-08-04-tui.md) | AC-TUI-01 / AC-TUI-02：[TUI 手册](manual-testing/10-tui.md)、[测试指导](TESTING.md) |
| REQ-DESKTOP | [Desktop 设计](superpowers/specs/2026-08-07-desktop-app-design.md) | [Desktop Task 1–20](superpowers/plans/2026-08-07-desktop-app.md) | AC-DESKTOP-01 / AC-DESKTOP-02 / AC-DESKTOP-03：[Desktop 手册](manual-testing/11-desktop.md)、[桌面验收](../electron/ACCEPTANCE.zh-CN.md) |

## 2. 非功能要求追踪

新增功能：**REQ-001-01～12** 见 [001 规格](specs/001-asset-intake/spec.md)，对应 **AC-001-01～20**；[TASK-001-01～10](specs/001-asset-intake/tasks.md) 与 [交接 prompts](specs/001-asset-intake/coding-prompts.md) 建立细粒度关联，[验证记录](specs/001-asset-intake/verification.md) 当前全部未执行。`design.md` 由 TASK-001-01 交付。本条扩展 REQ-IMPORT / REQ-SYNC / REQ-SECRETS / REQ-DESKTOP，不宣称现有基线已经具备跨项目收编能力。

| 需求 ID | 设计与验证入口 | 证据边界 |
|---|---|---|
| NFR-SOURCE | [架构](reference/ARCHITECTURE.md)、[同步](manual-testing/07-sync.md)、[漂移测试](../.ai-workspace/scripts/test/test-drift-check.sh) | 共享规范源与生成文件分开检查 |
| NFR-SECURITY | [密钥](manual-testing/05-secrets.md)、[MCP](manual-testing/04-mcp.md) | 明文与日志检查仍需实际执行，不能只看界面截图 |
| NFR-COMPAT | [技能](manual-testing/03-skills.md)、[进度 §4](PROGRESS.md#4-skills-域修复收尾与遗留验证) | Windows 真机 junction / copy 验证尚未完成 |
| NFR-FAILURE | [测试指导](TESTING.md)、[桌面验收](../electron/ACCEPTANCE.zh-CN.md) | 缺依赖、无效输入、冲突与取消需按受影响端分别执行 |

## 3. 历史材料与缺口

| 材料 | 归属 | 使用方式 |
|---|---|---|
| 2026-07-23 canonical-rules / Phase 1 | 规则与多工具适配设计演进 | 原阶段设计依据；当前生成行为以架构说明为准 |
| 2026-08-04 TUI / 2026-08-07 Desktop | 界面设计与原始任务分解 | 任务号保留；延后功能以 PROGRESS / 能力盘点为准 |
| 2026-08-24 rules / skills reviews | 域评审、修复与验证方法 | 评审发现不是当前未修复清单，需关联进度中的修复证据 |
| 2026-09-01 memory | 记忆系统设计与任务 | 关联 2026-09-03 交付记录；计划勾选不作为当前验收结果 |

目前已建立总体需求级追踪；尚缺部分 CLI 原始任务包、统一的逐 AC 执行报告与 Windows 真机结果。后续触及相应功能时，在功能规格包补齐细粒度 TASK 与 verification；本次不倒填虚构历史任务或测试成绩。
