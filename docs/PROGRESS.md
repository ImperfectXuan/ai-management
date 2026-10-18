# 项目进度与目标跟踪

> **本文件用途**：AI Workspace（aiws）项目的唯一进度追踪入口。整合 ROADMAP、域评审报告与实际代码落地状态，后续开发内容在此文档中持续更新。
>
> **更新约定**：每完成一项工作，同步更新对应表格的状态列并文末追加一行变更记录。状态必须以可验证的证据（commit hash 或测试结果）为准，不凭记忆标注。新任务引用 [SPEC](SPEC.md) 的需求 ID、任务定义与对应验收结果，关系登记到 [TRACEABILITY](TRACEABILITY.md)。
>
> **证据范围**：以下完成状态与用例数为原日期的历史记录，本轮（2026-10-10）只整理文档，未重新运行功能回归。阶段交付不代表三端全部能力一致，差异见 [架构](reference/ARCHITECTURE.md)。

---

## 1. 项目定位

把散落在各 AI 编码工具（Claude Code、Codex、Cursor、Trae）中的规则、MCP 配置、技能、密钥统一收编到 `.ai-workspace/` 单一事实源，通过 `aiws sync` 分发到各工具，`aiws validate` 守护一致性，`aiws import` 反向收编存量配置。

**主流程闭环**（2026-08-27 起全部打通）：

```
setup → 维护规范源（rules/mcp/skills/secrets）
      → aiws sync        # 分发到全部启用的工具
      → aiws validate    # 校验 + 生成文件漂移检测
      → pre-commit 钩子   # 提交前自动拦截漂移
      → aiws import      # 反向收编（mcp/skills/rules 三者均已实现）
```

---

## 2. 里程碑总览

详细任务清单见 [ROADMAP.md](../ROADMAP.md)，此处为浓缩视图。

| 阶段 | 范围 | 状态 |
|---|---|---|
| Phase 0 | 基础设施：适配器 ×4、sync/validate、CLI 入口、MCP/Skills 同步引擎、密钥保管库、双向同步 | ✅ 完成 |
| Phase 1 | 增强：ADR 记忆系统、项目上下文摘要、pre-commit 集成等 | ✅ 完成（2026-09-07 最后一项 tools 字段过滤落地） |
| Phase 1.5 | 可视化 TUI（Ink，六页） | ✅ 完成（增强项延后，见 §6） |
| Phase 1.6 | Desktop 独立 macOS 应用（Electron） | ✅ 完成 |
| Phase 2 | 自动化与生态：CI/CD 自动同步、规则版本化、模板与脚手架 | 🟡 部分完成（两项核心已交付；模板提取 / 脚手架未开始） |
| Phase 3 | 生态：精选规则集、社区模板、市场 | ⬜ 未开始 |

---

## 3. 业务域质量状态

### 新增功能 002 · 持久化同步版本状态

2026-10-15：用户选定方案 2，已编写 [规格](specs/002-sync-status/spec.md)、[设计](specs/002-sync-status/design.md)、[任务](specs/002-sync-status/tasks.md) 与 [验证计划](specs/002-sync-status/verification.md)，基于已提交 `81195b4`。规格工程细则为草案，该轮只交付文档；实施状态与验收结果以下表及 [verification](specs/002-sync-status/verification.md) 为准。

同日评审整改：用户确认采用 1A（共享输出等价判定）+ 2A（密钥派生 keyId）。[设计](specs/002-sync-status/design.md) 已补充共享写入的暂时失效与成功后原子恢复、keyId 持久化和替换检测；同步修订验收、任务及验证计划。两项方案选择已确认，其余工程细则仍为草案。

同日实现轮（commit `c95bc73`）：落地共享状态契约、指纹/keyId 与本机 Store 的等价判定协议（design §2.3、§3.1），新增 40 项行为测试、全量 Electron 169/169；AC-002-02、06、10、12、14、18 为存储/指纹层部分通过，其余未执行。CLI 回执、`--describe-inputs`、sync-service、IPC 与界面仍未实现。

| 任务 ID | 交付 | 实施状态 | 完成证据 |
|---|---|---|---|
| TASK-002-01 | 状态契约、本机 Store 与恢复 | ✅ 已完成（2026-10-16） | `shared/sync-status.ts`、`core/sync-status-store.ts`、`core/sync-unit-identity.ts` + store/status/identity 测试；原子持久化、校验降级、running 恢复（含子进程崩溃夹具）、路径 realpath/别名身份、project=$项目根 / global=$HOME 单元键、旧 lastSyncAt 不迁移已落地；Electron 194/194、typecheck+build 通过；AC-002-01、07 通过，02/06/10/12/18 仍部分通过（缺口依赖 02/03/04/06/07，见 [verification](specs/002-sync-status/verification.md) §2） |
| TASK-002-02 | 输入描述、指纹与本机密钥 | ✅ 已完成（2026-10-16） | CLI `aiws sync --describe-inputs`（`lib/sync-describe.sh`，schema v1，复用规则/mcp/skills 同一筛选谓词，`merge_mcp_effective` 与执行同源，Skills 计划含 outputKeys/清单/可执行位）+ `core/sync-inputs.ts`（稳定读取、按解析结构计算 JSON、来源/有效输出指纹）；test-sync-describe 34/34 + sync-inputs 19/19 + Electron 213/213 + 全部 shell 套件回归通过；AC-002-03、04、05 通过，13 部分通过；keyId 派生/只读检查见 sync-fingerprint（c95bc73） |
| TASK-002-03 | CLI 单元回执与跳过/失败语义 | ✅ 已完成（2026-10-16） | CLI `aiws sync --report-file`（`lib/sync-report.sh`：schema v1、printf 构建不依赖 jq、0600 原子写入、一调用一回执）+ 三模块真实完成/跳过点回执（applied 仅带 completedAt；原因码含 module_disabled/tool_unsupported/no_entries/mapping_missing/dependency_missing/secret_unresolved/invalid_config/partial_failure）+ `shared/sync-unit-receipt.ts` 严格校验器 + `sync.ts` 回执参数；test-sync-report 27/27 + sync-unit-receipt 10/10 + Electron 223/223 + 15 个 shell 套件回归通过；AC-002-09 通过、08/11 部分通过 |
| TASK-002-04 | 统一执行服务、持久化与目标锁 | ✅ 已完成（2026-10-16） | `core/sync-service.ts`：身份/密钥→describe/指纹→outputKeys 排序键锁→beginWrite 门控→CLI 回执→结束指纹与 keyId 复核→原子提交含候选恢复；非零退出优先失败、记录不可写不启动 CLI、不可执行不建密钥不写状态；describe 契约扩展顶层 outputKeys。`sync-service.test.ts` 14/14（真实 CLI + 慢包装/chmod/SIGKILL 边界注入）、Electron 237/237、15 个 shell 套件回归通过；AC-002-02、10、11、13、14 通过 |
| TASK-002-05 | 全部 Desktop 写入入口与单项 Skills 接线 | ✅ 已完成（2026-10-16） | `main/ipc.ts`：service 单例 + `executeRepoSync`/`runFullSyncAll`（SyncRun/SyncAll/托盘统一经 `runBatch`，主进程无直接 `syncRun` 调用）；`runSingleSkillWrite` 门控单项 link/unlink（`finishSingleWrite` 不写 lastSuccess、保留 needsResync）；`lastSyncAt` 仅全量成功更新；`SyncStatusChanged` 提示（规则/MCP/收编回退/单元完成）；单实例锁 + 启动恢复。`sync-wiring.test.ts` 6/6 + `sync-service` 18/18 + Electron 247/247 + 15 shell 套件回归；AC-002-17 通过 |
| TASK-002-06 | 状态查询、界面与刷新 | ✅ 已完成（2026-10-16） | `core/sync-status-query.ts`（只读查询：主进程解析路径、密钥只读检查、describe+指纹重算、聚合、storeProblem 与 rebuildLocalSyncStatus）+ `shared/sync-status-view.ts`（视图契约，无哈希/路径）；IPC `SyncStatusGet`/`SyncStatusRebuild`；`use-sync-status.ts`（请求序号+选择身份丢弃过期响应；挂载/切页/切库/SyncStatusChanged/窗口激活重查）；dashboard 接入 `SyncStatusPanel`（聚合+单元状态/原因/上次成功/最近检查；「来源版本已同步」与「目标 diff」独立；重建入口）。`sync-status-query` 6/6 + `sync-status-ui` 4/4 + Electron 257/257 + build 通过 + 5 shell 套件回归；AC-002-15、16 判通过 |
| TASK-002-07 | 集成/原生验收、文档与发布收尾 | 待开始 | 无实现证据 |

### 新增功能 001 · 多项目存量资产收编与复用

2026-10-10 已形成 [需求规格](specs/001-asset-intake/spec.md)、[任务定义](specs/001-asset-intake/tasks.md) 与 [Coding Agent prompts](specs/001-asset-intake/coding-prompts.md)。本轮仅交付文档；规格执行细则为草案，未修改实现代码，功能验收见 [verification](specs/001-asset-intake/verification.md)，均未执行。

| 任务 ID | 交付 | 实施状态 | 完成证据 |
|---|---|---|---|
| TASK-001-01 | 技术设计与契约 | ✅ 已完成（2026-10-10） | [design.md](specs/001-asset-intake/design.md)；两轮审查整改已落地（§21/§22）；文档链接/AC 覆盖检查通过 |
| TASK-001-02 | 多来源只读扫描 | ✅ 已完成（2026-10-10） | `lib/intake/` 扫描引擎 + `aiws intake scan`；两轮审查修复 57/57 + 原有 33/33 + 兼容 194 + 既有 79 全部通过；Desktop 未验证 |
| TASK-001-03 | 去重与增量判断 | ✅ 已完成（2026-10-10，审查整改同日） | `lib/intake/compare.sh` 比较引擎 + `aiws intake compare`；test-intake-compare.sh 47/47；审查整改：资产 ID 从 registry 解析、忽略/暂缓按实际审核来源组生效（见 design §23.2/§23.7）；AC-001-04～07 引擎/CLI 部分通过（见 [verification](specs/001-asset-intake/verification.md) §3.1、§3.2）；Desktop 未验证 |
| TASK-001-04 | 审核计划、入库与恢复 | ✅ 已完成（2026-10-10，审查整改同日） | `lib/intake/{plan,stage,commit,apply,recover}.sh` + `lib/intake/paths.sh` + `aiws intake plan/apply/rollback/status`；test-intake-apply.sh 60/60；审查整改：写入路径边界、目标实际内容复核、提交状态持久化与续跑、回退整批一致性、Rule/Skill 凭据门禁（见 design §23.1/§23.3～§23.6）；AC-001-08、12、13、14、19 引擎/CLI 部分通过，AC-001-20 未判通过（见 [verification](specs/001-asset-intake/verification.md) §3.1、§3.2）；Desktop 未验证 |
| TASK-001-05 | Desktop 人工收编 | ✅ 已完成（2026-10-10，审查整改同日） | `shared/{intake-types,intake-selection}.ts`、`core/intake-bridge.ts`、`main/{intake-ipc,intake-args}.ts`、`renderer/pages/intake.tsx`（「收编」tab）；Desktop 测试 100/100；审查整改：六动作目标选择经 UI→IPC→CLI 生效、动作/目标/总库变化即作废旧计划、历史查询支持只给总库且失败显式报错（见 design §23.8/§23.9）；AC-001-01、02、08 通过，AC-001-12、13、14、19 部分通过（见 [verification](specs/001-asset-intake/verification.md) §3.1、§3.2）；未做 GUI 手工走查与打包验收 |
| TASK-001-06 | 模型服务与建议契约 | ✅ 已完成（2026-10-10，审查整改同日） | `lib/intake/{model,model-io}.sh` + `aiws intake model config/prepare/send/show`；test-intake-model.sh 54/54（本机模拟服务）；审查整改：块标量整段脱敏、校验先判类型再索引、锚点/未覆盖区间逐来源校验、尝试记录跨次接续（见 design §23.10）；AC-001-09、10、11 服务边界部分通过（见 [verification](specs/001-asset-intake/verification.md) §3.1、§3.2）；Desktop 界面属 TASK-001-07 |
| TASK-001-07 | Desktop AI 整理审核 | 待开始 | 无 |
| TASK-001-08 | 复制与更新引擎 | 待开始 | 无 |
| TASK-001-09 | Desktop 复用与更新 | 待开始 | 无 |
| TASK-001-10 | 集成验收与收尾 | 待开始 | 无 |

按「评审 → 修复 → 回归验证」的流程逐域推进（流程定义见 [docs/superpowers/reviews/](superpowers/reviews/)）。

| 业务域 | 代码评审 | 修复落地 | 回归验证 | 后续动作 |
|---|---|---|---|---|
| 规则（rules） | ✅ [评审](superpowers/reviews/2026-08-24-rules-domain-review.md) | ✅ `7396f15` `dc44aab` | ✅ [验证指导](superpowers/reviews/2026-08-24-rules-domain-verification.md) + `0c84320` | 无 |
| 技能（skills） | ✅ [评审](superpowers/reviews/2026-08-24-skills-domain-review.md) | ✅ 阶段 A+B+C 完成（见 §4） | ✅ shell 9/9 + electron 61/61 + tui 19/19 | B3 在真实 Windows 环境的手工验证待做 |
| MCP | ⬜ 未评审 | — | — | 排期评审 |
| 密钥保管库（vault） | ⬜ 未评审 | — | — | 排期评审 |
| 双向导入（import） | — | — | ✅ `54d826b` 新增 25 用例 | MCP/vault 属于其依赖域 |
| 记忆（memory） | ⬜ 未评审 | ✅ Task 1-4 落地 `ed8c4b3`→`6e9cd46` | ✅ 记忆域 shell 15 用例（CLI + context 注入 + validate） | 排期评审；TUI/Desktop 记忆页待规划（见能力盘点，尚未排期） |

---

## 4. Skills 域修复收尾与遗留验证

计划全文见 [2026-08-24-skills-domain-fix-plan.md](superpowers/reviews/2026-08-24-skills-domain-fix-plan.md)。下表整合 2026-08-27 核查与 2026-08-28 收尾记录：

| 项 | 内容 | 状态 | 证据 |
|---|---|---|---|
| A1 | UI 语义收敛：per-skill 单项 link/unlink | ✅ | `8c7abff`，IPC `linkSkills/skillName`（electron/src/main/ipc.ts:77,81） |
| A2 | link/unlink 管理边界 + 备份，不误删非管理目标 | ✅ | `8c7abff`，platform.sh + skills-link.sh |
| A3 | `skills install` source 识别（本地→URL→npm→GitHub） | ✅ | `8c7abff` |
| B1 | TUI 补 `project` scope 切换键 | ✅ | `s` 键切换 global/project，详情页显示当前 scope（tui/src/screens/skills.jsx）；tui/test/skills.test.js 覆盖切换+落盘 |
| B2 | Desktop 补 `tool + scope` 选择 | ✅ | 工具 Tab（codex/claude/cursor/trae）+ global/project 链接与卸载四操作（electron/src/renderer/pages/skills.tsx），复用规则页 tab 交互 |
| B3 | Desktop Windows junction/copy 回退对齐 CLI | ✅ | 新增公共链接层 electron/src/core/links.ts（Windows junction 优先、失败 copy 回退，posix symlink），skills.ts 接入；copy 回退已测（electron 13 用例），真实 Windows 手工验证待做 |
| C1 | `linkStatus` 三态（managed/conflict/missing） | ✅ | shell `classify_skill_target`（skills-link.sh）+ TS `classifyLinkState`（links.ts），JSON 与 UI 均为三态；同名普通目录显示 conflict |
| C2 | `skills.enabled` 模块级开关接通 sync | ✅ | common.sh `is_module_enabled`（规避 jq `//` 把 false 当空值的陷阱）+ aiws sync 门控，关闭时输出 skip 日志；test-skills-link.sh 用例 6/7 覆盖 |
| C3 | TUI skills 回归测试补齐 | ✅ | 新增 tui/test/skills.test.js（2 用例，真实 CLI 沙盒集成）、shell test-skills-link.sh（9 用例）、electron skills.test.ts 扩到 13 用例 |

**进展**：以上各项已于 2026-08-28 按 B2 → B1 → C2 → C1+B3（合并抽公共链接层 links.ts，见原计划风险提示第 4 条）→ C3 顺序完成；回归验证除 Windows 真机手工验证外全部通过。

---

## 5. 近期完成记录

### 2026-10-15 · 002 等价判定与密钥身份实现

- 落地 `shared/sync-status.ts`、`core/sync-fingerprint.ts`、`core/sync-status-store.ts`：keyId 派生与替换检测、来源/有效输出 HMAC 指纹、原子持久化与等价候选“先失效、成功后原子恢复”协议；运行中换密钥拒绝提交，不为未执行工具创建成功基线。
- 新增 40 项行为测试；共享 Skills 永久互斥失效回路有回归守护（重复完整同步双方保持 current、失败不恢复候选）。全量 Electron 169/169，typecheck 与 build 通过。
- 未接 CLI 回执、`--describe-inputs`、sync-service 与界面；AC-002-02、06、10、12、14、18 为存储/指纹层部分通过，其余未执行，见 [verification](specs/002-sync-status/verification.md)。

### 2026-10-15 · 同步版本状态 SDD 文档

- 评审整改：按用户确认的 1A + 2A 修订共享 Skills 状态收敛和指纹密钥替换检测；设计、AC-002-02/11/14/18、任务与验证夹具已关联。仅完成文档修订，功能验收未执行。

- 交付功能 002 的规格、技术设计、七项任务和逐 AC 验证计划，关联九项需求与十八项验收。
- 明确版本状态与最近执行结果分离、来源指纹不代表目标文件一致、退出 0 的跳过不能记成功，以及 global/共享 Skills 路径的覆盖失效。
- 仅完成方案编写与文档检查，未修改实现代码，未执行功能验收；检查结果见 [verification §4](specs/002-sync-status/verification.md#4-文档交付检查)。


### 2026-10-15 · 本机演示收口

- 修复密钥 IPC 未定义解析函数与 JSON 模式缺失、错误被伪装为空状态；补齐类型声明、重复导入与模块兼容问题，`build` 强制先执行 `typecheck`。
- Desktop 同步复用 CLI，覆盖四工具规则、context、MCP 和 Skills，默认仅 project；取消终止进程组，失败/取消不更新成功时间戳。规则页与差异页只同步规则。
- 修复规则开关刷新后待同步状态丢失、规则版本 CHANGELOG 被误列为规则、正常格式转换被误报为漂移、长路径及滚动布局、回退完成状态不可见。计划新增 `write_path`，与暂存共用路径计算。
- 新增隔离演示启动、两轮真实引擎旅程与源码快照/哈希清单；见 [本机演示指南](guides/local-demo.zh-CN.md)。基准 `d086528` + 当前未提交工作区；Desktop 116/116、TUI 19/19、类型检查、构建、CLI validate、Shell apply 60/60、审查回归 163/163 通过。原生 GUI 完成同步/密钥/差异与人工收编回退走查；最后补丁的验证边界见演示指南。
- 按用户确认，TASK-001-07～10 未纳入本轮，不改变这些任务的完成状态。未执行 Git 提交或推送。


| 完成时间 | 内容 | commit |
|---|---|---|
| 2026-09-07 | 规则 `tools` 字段过滤三端落地：common.sh `rule_tools`/`rule_applies_to_tool`、cursor/trae 逐条 + claude/codex 单文件统一过滤、Electron core `parseTools`/`ruleAppliesToTool`、validate 校验非法 tool 值；新增 test-rules-tools.sh（5 用例）+ electron 4 用例，全 shell 88 绿 + electron 65 + TUI 19 | `eae4b6f` `93edfbe` `c2ef7e5` |
| 2026-09-03 | 记忆系统 Task 1-4 落地闭环（[计划](superpowers/plans/2026-09-01-memory-system.md) 5/5）：三套模板 + `aiws memory list/new/show`、sync 注入 `memory/context`（claude/codex 头部 + cursor/trae 00-context，纳入 drift 比对）、validate 记忆域校验；记忆域 shell 15 用例，全 shell 83 绿 + TUI 19 + electron 61 | `ed8c4b3` `3b8a9d5` `bba2293` `319244e` `6e9cd46` |
| 2026-08-28 | Phase 2 两项核心：CI/CD 推送自动同步（`aiws ci` 工作流安装器 + `sync --only`）与规则版本化（sha256 manifest + 自动 CHANGELOG + `rules status/history`） | `02dbe18` `1df1b1e` `85e8d0b` `3cd1d61` |
| 2026-08-27 | `aiws import rules` 反向导入引擎落地（cursor/trae 逐条转换、claude/codex 整文件导入、mapping 幂等登记、25 个测试） | `54d826b` |
| 2026-08-28 | skills 域 B/C 阶段收尾：TUI/Desktop 补 tool+scope 交互、linkStatus 三态、公共链接层 links.ts（Windows junction/copy 回退）、skills.enabled 开关接通 sync、三端回归测试补齐（shell 9 + electron 61 + tui 19） | `5c3c26f` `095298b` `8bfcce4` `f149270` |
| 2026-08-26 | pre-commit 钩子管理与 setup 自动安装 | `5bb98bb` |
| 2026-08-25 | 生成文件漂移检测并集成 validate | `dde2036` |
| 2026-08-24 | skills 域阶段 A 修复（单项操作 + 目标保护 + install 识别） | `8c7abff` |
| 2026-08-24 | 规则域审查后修复（规则页多工具切换、白名单备份精确匹配、核心解析与 IPC 校验） | `0c84320` `dc44aab` `7396f15` |

---

## 6. 待办优先级

### P0 · 当前冲刺
- ~~Skills 修复计划 B2/B1/C2/C3/C1/B3 收尾（§4）~~ ✅ 2026-08-28 完成
- [ ] B3 在真实 Windows 环境完成一轮 junction/copy 手工验证

### P1 · MVP 后尽快
- [ ] MCP 域代码评审（含 JSON/TOML 双引擎与 `${secret:}` 占位替换链路）
- [ ] vault 域代码评审
- [x] ~~ADR 模板和记忆系统~~ ✅ 2026-09-03 完成（记忆系统 Task 1-4，见 §5）
- [x] ~~项目上下文摘要~~ ✅ 2026-09-03 完成（context 注入各工具，见 §5）

### P2 · 带宽允许时
- [x] ~~按 tools 字段过滤规则~~ ✅ 2026-09-07 完成
- [ ] Phase 1.5 TUI 延后项：界面内编辑规则、validate --json 结构化输出、secrets 写操作、MCP 完整表单（REQ-TUI / REQ-VALIDATE / REQ-SECRETS / REQ-MCP；需补功能规格）
- 技能工具 / scope 选择已完成（§4 B1/B2）；进一步交互增强属于候选，尚未排期。
- Desktop 四工具同步对齐已于 2026-10-15 通过共享 CLI 落地（含 context 与 Skills，默认 project scope）；记忆页仍未排期。
- ~~CI/CD 推送时自动同步~~ ✅ 2026-08-28 完成（`aiws ci install`）

### P3 · 锦上添花
- Phase 2/3 其余项（脚手架单命令初始化、精选规则集、社区模板、规则集市场）。跨项目模板提取沿用 ROADMAP 的 P2，尚未排期。

---

## 7. 已知边界与技术债

- **本仓库 CLAUDE.md 的生成标记残留**：头部遗留 `<!-- Generated by AI Workspace -->` 行，导致 `import rules` 将其归为 managed 跳过。如需收编本仓库自身 CLAUDE.md，需先手工删除该标记行。
- **merge-file 导入的 required 语义**：claude/codex 整文件导入一律登记 `required: false`（合并文件没有 alwaysApply 语义），需要常驻装载的工具要手工改 mapping。
- **global scope 导入不做**：各工具全局规则路径未纳入体系，`--scope global` 显式报错拒绝（fail-fast 设计，非遗漏）。
- **跨平台 link 策略漂移风险**：Desktop 已抽取 `core/links.ts` 公共层（§4 B3），CLI（shell）与 Desktop（TS）仍为独立实现；需要对照验证，Windows 真机结果尚待补齐。
- **CI 自动提交在本仓库为部分 no-op**：生成文件被 `.gitignore` 忽略（尊重仓库策略，workflow 不 force-add），CI 提交实际入库的是 manifest/CHANGELOG 等版本化文件；对提交生成文件的仓库才会完整回写生成产物。
- **规则哈希按字节计算**：仓库无 `.gitattributes` 换行归一策略，CRLF/换行符差异会记为一次规则变更。
- **manifest 为规范层语义**：部分同步（`--tool X`）同样推进 manifest 快照——快照与工具无关，特判会引入状态分裂。

---

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-16 | TASK-002-06 落地：状态查询与界面——`core/sync-status-query.ts` 只读查询（主进程解析 library/project/global；密钥只读不创建；describe+指纹重算；disabled/unsupported 不计完成分母；无项目不列 project 单元；损坏状态返回 storeProblem 不伪装空记录；`rebuildLocalSyncStatus` 备份后重置本机元数据）；`shared/sync-status-view.ts` 视图契约；IPC `SyncStatusGet`/`SyncStatusRebuild`；`use-sync-status.ts`（请求序号+完整选择身份丢弃过期响应；进入页面/切选择/SyncStatusChanged/窗口激活/手动刷新触发重查）；dashboard 接入 `SyncStatusPanel`。新增 query 6 例 + UI 4 例；Electron 257/257、build 通过、describe 37/report 27/rules-tools 6/skills-link 9/drift-check 8 回归全绿；AC-002-15、16 判通过；未执行 Git 提交 |
| 2026-10-16 | TASK-002-05 落地：Desktop 写入入口全部接线——SyncRun/SyncAll/托盘统一经 `executeRepoSync`/`runFullSyncAll` 进 `syncService.runBatch`，主进程删除直接 `syncRun` 调用；SkillsLink/Unlink 经 `runSingleSkillWrite`（写前 running/失效门控与输出锁，写后 `finishSingleWrite` 记单项结果，绝不写模块 lastSuccess、needsResync 保持 true）；`isFullSyncCompletion` 收敛旧 `lastSyncAt` 更新为仅全量 project 成功；新增 `SyncStatusChanged` 通道（规则/MCP 修改、收编 apply/rollback、单元完成均发重查提示）；`requestSingleInstanceLock` 单实例 + 启动时 running→interrupted 恢复。新增 `sync-wiring.test.ts` 6 例（源码守护无绕过）与服务单项写入 4 例，Electron 247/247、15 shell 套件全绿；AC-002-17 判通过；未执行 Git 提交 |
| 2026-10-16 | TASK-002-04 落地：新增 `core/sync-service.ts` 统一执行服务——按 design §4 每单元顺序（resolveUnitKey 身份、describe 前置可执行判断、显式同步建密钥、指纹与 outputKeys 解析、outputKeys 排序键锁、锁内重算等价候选当前指纹、beginWrite 门控失败不启动 CLI、CLI 回执模式执行并转发进度、结束指纹与 keyId 复核、applied 原子提交含候选恢复、其余只记 lastAttempt）；批次首版串行、失败/取消即停、global 自动剔除 rules；describe 契约新增顶层 outputKeys（rules/mcp/skills）。新增 `sync-service.test.ts` 14 例（真实 CLI；慢包装脚本、chmod、SIGKILL、临时 HOME 边界注入），Electron 全量 237/237 连续两轮、15 个 shell 套件回归全绿；AC-002-02/10/11/13/14 判通过；未执行 Git 提交 |
| 2026-10-16 | TASK-002-03 落地：CLI 新增 `--report-file` 单元回执（`lib/sync-report.sh`，schema v1，printf 构建使 dependency_missing 回执在无 jq 环境也可写，0600 原子写入，operationId 缺失/相对路径/与 describe 同传显式拒绝）；rules/MCP/Skills 真实完成与跳过点落 applied/skipped/failed，仅 applied 带 UTC completedAt，`${secret:}` 残留检测阻止占位符未解决时记成功；common.sh 提供回执函数无操作兜底+真实实现加载（drift-check 干跑与 `aiws skills` 直调场景）；TS 新增 `shared/sync-unit-receipt.ts` 严格校验（身份匹配、字段语义、applied↔completedAt 双向约束）与 `sync.ts` reportFile/operationId；新增 test-sync-report.sh 27 例、sync-unit-receipt.test.ts 10 例（含 syncRun 真实 CLI 端到端），Electron 223/223，15 个 shell 套件回归全绿；AC-002-09 通过、08/11 部分通过；未执行 Git 提交 |
| 2026-10-16 | TASK-002-02 落地：CLI 新增只读 `aiws sync --describe-inputs --tool --only --scope`（schema v1；rules/mcp/skills 复用既有筛选谓词，MCP 合并抽为 `merge_mcp_effective` 与执行同源，skills 计划含 outputKeys/逐文件清单/可执行位且不含 tool 身份，describe 模式日志改道 stderr 保持 stdout 纯 JSON）；TS 新增 `core/sync-inputs.ts`（describe 消费与校验、读取前后 stat 稳定性检查、jq `*` 合并复刻、JSON 输入按解析结构入载荷、生成器依赖显式清单、来源与有效输出指纹组装）；新增 test-sync-describe.sh 34 例、sync-inputs.test.ts 19 例，Electron 全量 213/213，14 个 shell 套件回归全绿；AC-002-03/04/05 通过、13 部分通过；TASK-002-02 标记完成；未执行 Git 提交 |
| 2026-10-16 | TASK-002-01 收尾：新增 `core/sync-unit-identity.ts`（realpath 别名归并、目标缺失不回退父目录、outputKeys 最近真实父目录+后缀解析、project/global 单元键解析）与 Store 的 `getSyncStatusPaths` 落点、`beginWrite` 规范路径门控；新增 25 项测试（身份 15 + store 10，含 AC-002-07 旧 lastSyncAt 不迁移、别名/搬家身份，AC-002-12 子进程崩溃夹具，AC-002-18 状态文件无凭据正文），Electron 全量 194/194、typecheck+build 通过；AC-002-01、07 判通过，02/06/10/12/18 缺口收窄仍部分通过；TASK-002-01 标记完成；未执行 Git 提交 |
| 2026-10-15 | 002 实现轮（`c95bc73`）：共享输出等价判定 + 密钥派生 keyId 在状态 Store/指纹层落地，新增 40 项行为测试、全量 169/169；AC-002-02/06/10/12/14/18 部分通过，其余未执行；TASK-002-01/02/04 进行中 |
| 2026-10-15 | 修复 intake 相对路径来源死循环：父目录回溯以 `/` 为终点而 `dirname "."` 仍返回 `.`，`--repo . --source .` 会无限挂起且无报错。新增 `intake_abspath`（转绝对路径但保留符号链接），`intake_check_path_scope` 与 `intake_safe_resolve_link` 入口先归一化；后者越界判定补 `root_real` 比对，相对允许根下根内链接不再被误判。`test-intake-scan.sh` 新增 6 个带期限守护的用例（33→39），还原缺陷版本时 6 例全部超时失败；相对与绝对路径扫描结果一致（177 条 occurrence、路径集合相同） |
| 2026-10-15 | 功能 002 评审整改文档：用户确认 1A + 2A，补充共享输出等价恢复、密钥派生 keyId 及对应验收；任务仍待开始，功能验收未执行 |
| 2026-10-15 | 功能 002 SDD 文档交付：REQ-002-01～09 / AC-002-01～18 / TASK-002-01～07 已关联；工程细则草案、实现待开始、功能验收未执行；仅做文档检查 |
| 2026-10-10 | TASK-001-03～06 审查整改（2026-10-10 审查基准 d086528）：逐项闭环 12 条已确认缺陷——新增 `lib/intake/paths.sh`（路径段/相对路径/软链接边界，写入前拒绝）、资产 ID 改由 registry 稳定身份解析、计划记录目标实际内容指纹并在提交前复核、提交状态持久化（`incomplete` + 基线复用 + `skip_backfill`）与四种故障窗口的续跑、回退改为整批可行性判定、Rule/Skill 明文凭据门禁、忽略决定按实际审核来源组生效、Desktop 目标选择经 UI→IPC→CLI 生效且计划自动作废、状态查询支持只给总库、块标量整段脱敏、响应校验先判类型并按锚点各自来源验证、尝试记录跨次接续不覆盖。新增回归套件 `test-intake-review-0306.sh` 163/163（含旧行为失败 → 新行为通过的对照用例），既有 13 个 shell 套件与 Electron 100 个用例全绿 |
| 2026-10-10 | TASK-001-06 落地：模型 API 边界（配置只存凭据引用、凭据经 curl stdin 传入不进 argv）、请求组装与确认（prepare 预览 + body_hash 校验，范围变化必须重新确认，分批每批独立确认）、凭据与可疑字段脱敏、结构化输出契约校验（来源 ID/锚点逐字匹配/类型/分类/理由/覆盖区间）、超时与 4xx/5xx 重试策略、每次尝试单独留存；未覆盖区间自动补齐并告警（记录在 design §20.6）。测试用本机回环模拟服务，不调用真实模型；shell 套件 11 个全绿 |
| 2026-10-10 | TASK-001-05 落地：Desktop 通过类型化 IPC 接入共享收编引擎，新增「收编」向导（总库/来源选择、扫描进度与取消、候选分类与来源详情、差异、六种动作、受约束批量确认、计划预览、入库结果与记录、回退、失败续跑）；总库与来源校验相互独立，来源不要求初始化或 git；AI 入口保持可解释未配置状态。Desktop 测试 65→93，既有 shell 套件回归全绿；AC-001-01、02、08 通过，12、13、14、19 部分通过 |
| 2026-10-10 | TASK-001-04 落地：六动作审核计划与执行引擎（`plan/stage/apply/recover.sh`）、稳定资产 ID 与 registry、初始版本纳管与历史版本、来源关系与规则 mapping 登记、执行前复核、批次幂等、执行锁与并发检测、预备写入与暂存、分阶段记录与 `--resume`、受约束回退；CLI 新增 `intake plan/apply/rollback/status`。顺带修复 `register_mapping_entry` 中 `grep -qF "- source: …"` 缺少 `--` 导致 mapping 幂等判定失效（会重复追加）。AC-001-08、12、13、14、19 引擎/CLI 部分通过，Desktop 未验证；测试 60/60，既有 shell 套件回归全绿 |
| 2026-10-10 | TASK-001-03 落地：确定性比较引擎 `lib/intake/compare.sh`（内容指纹分组、冲突/相似/增量标签、总库既有规范源索引、Skill 相对路径差异、MCP 行为字段与凭据身份差异）、`aiws intake compare` 与本地候选/决定记录；凭据身份改为机器本地随机盐 HMAC（原 vault 主密钥方案需交互认证，降级方案违反 spec 5.4）；AC-001-04～07 引擎/CLI 部分通过，Desktop 未验证；测试 47/47，既有 shell 套件回归全绿 |
| 2026-10-10 | 文档按 SDD 整理：总体需求与验收 ID、追踪矩阵、功能模板、历史范围说明；修正 Phase 2 部分完成与 Skills 已交付能力。本轮未执行功能验收，不改变既有交付证据 |
| 2026-09-07 | Phase 1 收尾：落地最后一项「按 `tools` 字段过滤规则」——common.sh 新增 `rule_tools`/`rule_applies_to_tool`，CLI 与 Electron core 统一过滤（内联/块列表、缺省全工具、与 mapping AND），validate 校验非法 tool 值；新增 test-rules-tools.sh（5 用例）+ electron 4 用例，全 shell 88 绿 + Electron 65 + TUI 19；Phase 1 全部完成 |
| 2026-09-03 | 记忆系统落地闭环（任务计划 5/5）：Task1-2 合并入 main 后，续做 Task3-4 —— sync 将 `memory/context` 注入各工具（claude/codex 单文件头部 + cursor/trae `00-context`）、validate 新增记忆域校验；drift-check 沙盒同源加载 memory.sh 使 00-context 参与漂移比对。记忆域 shell 测试扩至 15 用例，全套 shell 套件 83 用例 + TUI 19 + Electron 61 全绿；PROGRESS/ROADMAP 勾掉记忆与项目上下文摘要 |
| 2026-08-28 | Phase 2 两项核心落地：`aiws ci` 工作流安装器（GitHub Actions push 自动同步）、`sync --only` 模块过滤、规则版本化引擎（manifest/CHANGELOG/status/history）；shell 新增 26 用例全绿，三套既有套件回归通过；顺手修复 mcp-sync 错误函数名 |
| 2026-08-27 | 初版建立：整合 ROADMAP、rules/skills 两域评审结论、近期五次提交与 skills 修复计划实测状态 |
