# 002 · 验证计划与记录

规格：[spec.md](spec.md)；设计：[design.md](design.md)；任务：[tasks.md](tasks.md)。

## 1. 当前证据边界

- 2026-10-15 文档轮：仅编写 SDD 文档，静态核对实现基线 `81195b47728bd5d99fe6609db83e793c7f1d0fe4`；同日按用户确认的 1A+2A 完成设计修订（见 §4）。
- 2026-10-15 实现轮（commit `c95bc73`）：落地共享状态契约、指纹/keyId 与状态 Store 的等价判定协议，40 项新增行为测试通过、全量 169/169。AC-002-02、06、10、12、14、18 为存储/指纹层部分通过，其余仍为未执行；CLI 回执、`--describe-inputs`、sync-service、IPC 与界面均未实现。
- 基线既有的 129 项桌面测试属于内容库分离变更，不能证明本功能已实现；部分通过不等于功能验收通过。
- 实施状态仅见 [PROGRESS](../../PROGRESS.md)。

## 2. 逐项验收计划

以下测试文件名称为拟新增落点；实际实现时可就近合并，但不得丢失 AC 追踪。

| 验收 ID | 方法 / 预期测试落点 | 预期覆盖 | 实际结果 | 判定 |
|---|---|---|---|---|
| AC-002-01 | `electron/test/sync-status.test.ts` | 两项目/两工具/三模块隔离 | 未执行 | 未执行 |
| AC-002-02 | `sync-status.test.ts`、`sync-service.test.ts` | 换库历史、global 独立；同库 Codex/Claude 完整及重复同步均 current，无凭空生成成功 | `sync-status.test.ts` 4 例通过（收敛、重复同步、跨库不恢复、不伪造成功）；切库视图恢复与 global 独立未验证 | 部分通过 |
| AC-002-03 | `electron/test/sync-fingerprint.test.ts` | 正文/required/context/附属文件/MCP 覆盖与删除 | 未执行 | 未执行 |
| AC-002-04 | `sync-fingerprint.test.ts` | 确定性、对象键序、数组顺序与排除清单 | 未执行 | 未执行 |
| AC-002-05 | `sync-fingerprint.test.ts` | 实际生成器依赖与算法版本变化 | 未执行 | 未执行 |
| AC-002-06 | `sync-status-store.test.ts` + 两次原生应用启动 | 状态持久化及关闭期间外部修改 | 写入前落盘与 running→interrupted 恢复 2 例通过；两次原生启动与关闭期间外部修改未执行 | 部分通过 |
| AC-002-07 | `sync-status-store.test.ts`、`workspace.test.ts` | 旧字段迁移、真实路径/别名/搬家规则 | 未执行 | 未执行 |
| AC-002-08 | `sync-service.test.ts` + CLI 回执集成 | applied、输入稳定、持久化后才成功 | 未执行 | 未执行 |
| AC-002-09 | `.ai-workspace/scripts/test/test-sync-report.sh` | 退出 0 的各类跳过、空输入与凭据边界 | 未执行 | 未执行 |
| AC-002-10 | `sync-service.test.ts` | 同版本重试失败/取消不继续 current | `sync-status.test.ts` 2 例通过（同版本重试失败保持 pending、等价写入失败不恢复候选且历史保留）；取消态与界面绿色判定未验证 | 部分通过 |
| AC-002-11 | `sync-service.test.ts` | 批次部分成功、失败后停止；共享目标失败后的失效与非重叠保留 | 未执行 | 未执行 |
| AC-002-12 | `sync-status-store.test.ts` + 子进程中断夹具 | running 恢复、坏文件、未知 schema、写入失败 | 坏 JSON/未知 schema/目录不可写保留原文件、running 恢复共 5 例通过；原生重启显示与子进程中断夹具未执行 | 部分通过 |
| AC-002-13 | `sync-service.test.ts` | 运行中编辑来源、取消与目标锁 | 未执行 | 未执行 |
| AC-002-14 | `sync-service.test.ts` | 等价共享写入先失效后原子恢复、保留原时间；跨库/不同计划/部分重叠和失败不恢复 | `sync-status.test.ts`/`sync-status-store.test.ts` 8 例通过（含写失败不提交原子性、不重叠输出不受影响）；真实分发目标未验证 | 部分通过 |
| AC-002-15 | `electron/test/sync-status-ui.test.tsx` + 原生走查 | 切换/刷新/激活、晚到响应、入库与回退 | 未执行 | 未执行 |
| AC-002-16 | `sync-status.test.ts` + diff/查询前后文件树比较 | 只读查询、不解密、不联网、状态与 diff 分开 | 未执行 | 未执行 |
| AC-002-17 | `skills.test.ts`、`sync-service.test.ts` | 单项链接/卸载、global/project 隔离 | 未执行 | 未执行 |
| AC-002-18 | `sync-fingerprint.test.ts`、回执集成与本机文件审计 | 合成凭据无泄露、派生 keyId；重启前合法密钥原位替换/缺失/长度错误/缺 keyId/运行中替换；同 key 来源变化对照 | `sync-fingerprint.test.ts`/`sync-status.test.ts`/store 共 12 例通过（keyId 生命周期、key_changed 优先、运行中换密钥拒绝提交、缺 keyId 降级）；回执/日志扫描与凭据审计待 CLI 回执实现后执行 | 部分通过 |

### 隔离与故障注入

使用独立临时 HOME、Electron userData、普通文件夹内容库与至少两个应用项目；不得读写维护者真实全局工具目录、vault 或配置。CLI/文件系统集成使用真实引擎，错误注入放在进程/文件系统边界；不 mock 自有内部模块来替代真实成功路径。

先记录规范层与目标文件树摘要，状态查询后逐字节比较；故障点覆盖开始记录之前、CLI 部分写入、CLI 成功后记录替换之前、重启恢复。敏感测试仅使用合成值，并扫描状态/报告/日志确认未泄漏。

### 两项整改的必测用例（尚未执行）

- 共享输出：同库同项目 Codex→Claude Skills 全部 applied 后，两记录均 current；重复同一批次仍收敛。仅执行 Codex 时未记录的 Claude 仍 untracked，不能据等价计划创造执行证据。
- 失效恢复：等价写入期间重叠记录不显示绿色；后续失败、取消、中断、keyId 变化或记录落盘失败不恢复候选。不同库、不同内容/链接策略、完整输出集合不等、先前已失效的记录仍失效；正常恢复不改旧完成时间和 lastAttempt。
- 密钥身份：在成功记录后关闭应用，仅把原密钥替换为另一合法 32 字节随机密钥，源内容保持不变；重启查询必须 unknown/key_changed。对照保留原密钥、仅改来源，应为 pending/source_changed。
- 密钥边界：缺失、长度错误、缺少持久化 keyId 与执行中换 key 分别覆盖；不得更新旧成功记录的 keyId 来绕过重新同步。显式重建只重置本机元数据，旧成功证据不复用。

### 实现后命令

这些是未来执行入口，不是本轮结果；当前缺少新增实现与测试，不应直接运行它们冒充验收。

```sh
cd electron
node --import tsx --test test/sync-status.test.ts test/sync-status-store.test.ts test/sync-fingerprint.test.ts test/sync-service.test.ts test/sync-status-ui.test.tsx
npm test
npm run build
```

```sh
sh .ai-workspace/scripts/test/test-sync-report.sh
sh .ai-workspace/scripts/test/test-rules-tools.sh
sh .ai-workspace/scripts/test/test-drift-check.sh
sh .ai-workspace/scripts/test/test-skills-link.sh
git diff --check
```

原生人工检查：重启应用、切换库/项目、规则与 Skills 单项操作、全量同步中途取消、托盘与主窗口交叉执行、只读查询与现有 diff 的状态区分。源码/自动化通过不替代原生 GUI 与打包检查。

## 3. 实施运行记录

### 模板

每次追加一条，不能覆盖失败历史：

- 日期 / 执行者：待执行。
- 被测 commit / 未提交改动范围：待填写；不得用上面的设计基线代替后续实现版本。
- OS、Node/Electron/CLI 版本及打包/源码环境：待填写。
- 临时目录隔离与合成凭据说明：待填写，不记录凭据值。
- 覆盖 AC、命令或步骤：待填写。
- 实际结果、日志位置与判定：未执行。
- 跳过项、失败处理与遗留边界：待填写；不可据其他端测试推导通过。

### 2026-10-15 · 共享输出等价判定与密钥派生 keyId 实现轮

- 日期 / 执行者：2026-10-15 / MiMoCode（用户确认范围：design §2.3 与 §3.1 两块及其直接载体，不含 CLI 回执/IPC/UI）。
- 被测 commit：`c95bc73`（feat(sync-status): 实现共享输出等价判定与密钥派生 keyId），源码环境，无相关未提交改动。
- 环境：macOS Darwin 27.0.0 arm64；Node v24.16.0；`node --import tsx --test` 源码直跑；未打包。
- 隔离与合成值：测试全部使用 `mkdtemp` 临时目录与随机 32 字节合成密钥；未读写真实 userData、全局工具目录或 vault，不记录任何凭据值。
- 覆盖 AC 与命令：`node --import tsx --test test/sync-fingerprint.test.ts test/sync-status-store.test.ts test/sync-status.test.ts`（40/40）；`npm test`（169/169）；`npx tsc --noEmit` 与 `npm run build` 通过。AC-002-02、06、10、12、14、18 判定为部分通过（见 §2 表），其余 12 项未执行。
- 实际结果：仅存储/指纹层行为有证据；共享 Skills 永久互斥失效回路有回归守护（重复完整同步双方保持 current、失败不恢复候选）。
- 跳过项与遗留边界：CLI `--report-file`/`--describe-inputs`、生成器依赖清单、sync-service 编排与目标锁、`SyncStatusGet`/`SyncStatusChanged`、界面与 SkillsLink/Unlink 接线、realpath/别名路径身份、两次原生应用重启与 GUI 走查均未实现或未执行；未改 CLI，未跑 shell 套件回归；部分通过不得计为功能验收通过。

## 4. 文档交付检查

2026-10-15 / Codex，基准 commit `81195b47728bd5d99fe6609db83e793c7f1d0fe4` 加本轮未提交文档改动：

- 核对 10 份文档（四份功能文档与六份关联入口）；新增功能相关的 52 个相对文件链接及章节锚点均可解析。
- REQ-002-01～09 均关联设计与任务；AC-002-01～18 均关联任务和独立验证项；TASK-002-01～07 均在 PROGRESS 登记为待开始。检查支持逗号省略与范围简写，不将其误判为漏项。
- 所有功能验收保持未执行；规格工程细则为草案，没有填入虚构通过结果。
- `git diff --check` 通过；本轮改动仅为 docs 下的 Markdown，未改规范源、生成入口、配置或实现代码。
- 未执行构建、功能测试、aiws sync、模型请求、分发、提交或推送。文档检查不替代功能验收。

检查汇总临时保存于 `/tmp/aiws-sync-status-sdd-check.json`，不属于持久交付证据；本节保留检查方法、数量和结果。


### 2026-10-15 · 两项评审整改

基准提交 `83499c6f236ad69b170bda600d6dd8705e5bc5e8`，本轮仅修订文档。用户确认采用 1A + 2A；P1 对应共享输出等价判定、原子恢复与 AC-002-02/11/14，P2 对应派生 keyId、持久化/读取/执行期核对与 AC-002-18。原有 AC 编号不重用、不删除，功能验收仍全部未执行。

本轮文档检查结果：

- 6 份修改文档的 44 个功能相关相对文件链接与章节锚点可解析；9 项 REQ、18 项 AC、7 项 TASK 覆盖和状态一致，原验收编号均保留。
- 8 项整改契约检查通过：独立有效输出指纹、先失效后原子恢复、不替未执行工具创建成功、失败不恢复、派生 keyId、身份先于来源核对、合法密钥替换对照、共享批次状态收敛。
- `git diff --check` 通过；变更仅涉及四份功能文档、PROGRESS 与 TRACEABILITY。此处“通过”仅指文档一致性检查，两个问题对应的运行时验收仍未执行。
- 未修改实现代码，未执行功能测试、构建、分发、提交或推送。

### 2026-10-15 · 实现轮登记

在实现轮 commit `c95bc73` 之后登记：更新本文件 §1 证据边界、§2 中 AC-002-02/06/10/12/14/18 的实际结果与部分通过判定、§3 运行记录，并同步 PROGRESS 任务状态（TASK-002-01/02/04 进行中）与 TRACEABILITY 的 AC 状态指向。

登记后检查：6 份关联文档的 140 个相对文件链接与章节锚点可解析；18 项 AC 行完整（6 项部分通过、12 项未执行），7 项 TASK 行与 PROGRESS 一致；`git diff --check` 通过。本轮改动为四份功能文档、PROGRESS、TRACEABILITY 的 Markdown，不含规范源与生成入口；部分通过判定不构成整包验收。
