# 002 · 验证计划与记录

规格：[spec.md](spec.md)；设计：[design.md](design.md)；任务：[tasks.md](tasks.md)。

## 1. 当前证据边界

- 2026-10-15 文档轮：仅编写 SDD 文档，静态核对实现基线 `81195b47728bd5d99fe6609db83e793c7f1d0fe4`；同日按用户确认的 1A+2A 完成设计修订（见 §4）。
- 2026-10-15 实现轮（commit `c95bc73`）：落地共享状态契约、指纹/keyId 与状态 Store 的等价判定协议，40 项新增行为测试通过、全量 169/169。AC-002-02、06、10、12、14、18 为存储/指纹层部分通过，其余仍为未执行；CLI 回执、`--describe-inputs`、sync-service、IPC 与界面均未实现。
- 2026-10-16 TASK-002-01 收尾轮（未提交工作区）：新增路径身份模块 `sync-unit-identity.ts`（realpath 别名归并、缺失不回退父目录、outputKeys 最近真实父目录解析、project/global 单元键解析）、userData 落点 `getSyncStatusPaths` 与 `beginWrite` 规范路径门控；新增 25 项测试，AC-002-01、07 判定为通过，02/06/10/12/18 缺口收窄后仍为部分通过。
- 2026-10-16 TASK-002-02 轮（未提交工作区）：CLI 新增 `aiws sync --describe-inputs`（`lib/sync-describe.sh`，schema v1，复用各模块同一筛选谓词，MCP 合并与执行同源 `merge_mcp_effective`，Skills 计划含 outputKeys/清单/可执行位且不含 tool 身份）；TS 新增 `core/sync-inputs.ts`（describe 消费、稳定读取与读取期间变化诊断、jq `*` 合并复刻、按解析结构计算 JSON 输入、来源/有效输出指纹组装）；新增 shell 契约 34 例 + TS 19 例。AC-002-03、04、05 判定为通过，AC-002-13 部分通过，02/18 缺口收窄仍部分通过。
- 2026-10-16 TASK-002-03 轮（未提交工作区）：CLI 新增 `aiws sync --report-file`（`lib/sync-report.sh`，schema v1，printf 构建不依赖 jq，0600 原子写入，operationId 缺失/相对路径/describe 同传显式拒绝）；在规则/MCP/Skills 的真实完成与跳过点落 applied/skipped/failed 回执（仅 applied 带 completedAt），原因码覆盖 module_disabled/tool_unsupported/no_entries/mapping_missing/dependency_missing/secret_unresolved/invalid_config/partial_failure；`shared/sync-unit-receipt.ts` 严格校验器 + `sync.ts` 回执参数。新增 shell 27 例 + TS 10 例。AC-002-09 通过、AC-002-08 部分通过、AC-002-11 部分通过。
- 2026-10-16 TASK-002-04 轮（未提交工作区）：新增 `core/sync-service.ts` 统一执行服务（身份/密钥 → describe/指纹 → outputKeys 排序键锁 → beginWrite 门控 → CLI 回执 → 结束指纹与 keyId 复核 → 原子提交含候选恢复；非零退出优先失败；不可执行跳过不建密钥不写状态；记录不可写不启动 CLI）；describe 契约扩展顶层 `outputKeys`（rules/mcp/skills 三模块）。新增 `sync-service.test.ts` 14 例（真实 CLI + 包装脚本/chmod 边界注入）。AC-002-02、10、11、13、14 判定为通过，AC-002-06、08、12、18 仍部分通过。
- 2026-10-16 TASK-002-05 轮（未提交工作区）：Desktop 全部写入入口接线——SyncRun/SyncAll/托盘统一经 `executeRepoSync`/`runFullSyncAll` 进 `syncService.runBatch`（主进程不再直接调用 `syncRun`）；SkillsLink/Unlink 经 `runSingleSkillWrite` 门控（Store 新增 `finishSingleWrite`：attempt=succeeded、保留 needsResync、不写 lastSuccess）；`lastSyncAt` 仅在全量成功路径更新（`isFullSyncCompletion`）；`SyncStatusChanged` 提示通道（规则/MCP 修改、收编入库/回退、单元完成）；单实例锁 + 启动 running→interrupted 恢复。新增 `sync-wiring.test.ts` 6 例 + 服务单项写入 4 例。AC-002-17 判定为通过。
- 2026-10-16 TASK-002-06 轮（未提交工作区）：只读状态查询与界面——`core/sync-status-query.ts`（密钥只读检查、describe+指纹重算、聚合、storeProblem、`rebuildLocalSyncStatus` 备份后重置）；`shared/sync-status-view.ts` 视图契约；IPC `SyncStatusGet`/`SyncStatusRebuild`；`use-sync-status.ts`（请求序号+选择身份丢弃过期响应；挂载/切选择/SyncStatusChanged/窗口激活/手动刷新）；dashboard `SyncStatusPanel`。新增 query 6 例 + UI 4 例。AC-002-15、16 判定为通过。
- 基线既有的 129 项桌面测试属于内容库分离变更，不能证明本功能已实现；部分通过不等于功能验收通过。
- 实施状态仅见 [PROGRESS](../../PROGRESS.md)。

## 2. 逐项验收计划

以下测试文件名称为拟新增落点；实际实现时可就近合并，但不得丢失 AC 追踪。

| 验收 ID | 方法 / 预期测试落点 | 预期覆盖 | 实际结果 | 判定 |
|---|---|---|---|---|
| AC-002-01 | `electron/test/sync-status.test.ts` | 两项目/两工具/三模块隔离 | `sync-status-store.test.ts` 1 例通过：四单元（两项目 × rules/skills/mcp × cursor/trae/codex）成功基线互相隔离，仅重跑项目 A 的 Cursor 规则不触碰其余基线，且不同 filter 查询前后状态文件字节一致；真实引擎回执隔离随 AC-002-08/11 | 通过 |
| AC-002-02 | `sync-status.test.ts`、`sync-service.test.ts` | 换库历史、global 独立；同库 Codex/Claude 完整及重复同步均 current，无凭空生成成功 | store 层 6 例（切库隔离、global 无项目维度、等价收敛 4 例）+ `sync-inputs.test.ts` 计划等价 1 例 + `sync-service.test.ts` 4 例（codex→claude 依次成功双方 current 且候选保留原完成时间、重复同步稳定、claude 失败不伪造 codex 绿色、claude 成功不凭空复活先前失效的 codex）通过；global 批次经临时 HOME 验证 | 通过 |
| AC-002-03 | `electron/test/sync-fingerprint.test.ts` | 正文/required/context/附属文件/MCP 覆盖与删除 | `sync-inputs.test.ts` 7 例通过（真实 CLI describe + 指纹）：规则正文、cursor mapping required（codex 不受影响）、memory context、Skill 附属文件与可执行位、MCP 本地覆盖修改与删除、删除规则文件均被识别；坏覆盖 JSON 读取时显式失败不降级 | 通过 |
| AC-002-04 | `sync-fingerprint.test.ts` | 确定性、对象键序、数组顺序与排除清单 | `sync-inputs.test.ts` 3 例通过：重复描述与不同写入顺序指纹一致；MCP 对象键重排不变、参数数组换序变化（JSON 按解析结构计算，主/覆盖文件字节不直接入载荷）；CHANGELOG/manifest/ADR/不适用工具规则不影响。CLI 契约侧 selector 与排除项由 `test-sync-describe.sh` 覆盖 | 通过 |
| AC-002-05 | `sync-fingerprint.test.ts` | 实际生成器依赖与算法版本变化 | `sync-inputs.test.ts` 1 例通过：修改 `lib/rules-generate.sh` 仅使 cursor 规则失效，codex 规则与 skills 不受影响（依赖按工具/模块显式清单、哈希实际脚本内容而非版本号）；算法版本进入 HMAC 载荷由 `sync-fingerprint.test.ts` 结构断言守护 | 通过 |
| AC-002-06 | `sync-status-store.test.ts` + 两次原生应用启动 | 状态持久化及关闭期间外部修改 | 写入前落盘与 running→interrupted 恢复 2 例 + 新增重启实例恢复成功记录、关闭期间来源改变后首查 pending/source_changed 1 例通过（来源重算以不同指纹代指，真实输入枚举属 TASK-002-02）；两次原生应用启动未执行 | 部分通过 |
| AC-002-07 | `sync-status-store.test.ts`、`workspace.test.ts` | 旧字段迁移、真实路径/别名/搬家规则 | 新增 2 例通过：仅含旧 `lastSyncAt` 的 repos.json 不补造成功记录、只读查询不创建状态文件且归约为 untracked；符号链接别名解析为同一键、目录移走解析为 target_missing 且旧记录原样保留、换新路径登记为新身份查不到旧记录。`sync-unit-identity.test.ts` 15 例覆盖别名归并、普通子目录、缺失不回退、outputKeys 最近真实父目录与排序去重 | 通过 |
| AC-002-08 | `sync-service.test.ts` + CLI 回执集成 | applied、输入稳定、持久化后才成功 | 回执层（03 轮 37 例）+ 服务编排层证据：`sync-service.test.ts` 中止于复核任一环节即不提交（来源变化→source_changed、换密钥→key_changed、回执缺失/失败→failed、记录写失败→record_failed 且磁盘保持 running），仅 applied 在回执、结束指纹与 keyId 全部稳定后原子落盘并恢复候选；同内容重复同步不误标其他单元（batch 隔离例）。06 后界面经 `SyncStatusGet`+`SyncStatusPanel` 在持久化成功且指纹一致时显示「已同步当前版本（未检查目标文件）」（`sync-status-query` current 例 + UI 文案断言） | 通过 |
| AC-002-09 | `.ai-workspace/scripts/test/test-sync-report.sh` | 退出 0 的各类跳过、空输入与凭据边界 | `test-sync-report.sh` 27 例通过：模块禁用、工具不支持（rules global / trae global MCP）、缺 mapping、缺 jq（符号链接沙盒 PATH，dependency_missing 回执可写）、无内容（空规则库/无技能/无 mcp.json）、`${secret:}` 无 vault 为 failed/secret_unresolved、坏 mcp.json 为 failed/invalid_config 且退出非零；上述非 applied 场景均允许退出 0 但不得带 completedAt；skipped 语义不宣称清理。界面展示层由 06 承接 | 通过 |
| AC-002-10 | `sync-service.test.ts` | 同版本重试失败/取消不继续 current | store 层 3 例（失败/取消保持 pending、needs_resync 优先于指纹相等、历史保留）+ 服务层 3 例通过：取消（进程组终止、attempt=cancelled、无成功基线、未启动单元不写）、等价写入失败后原时间保留且 resolveVersionState 非绿、失败单元后的批次即停。原生界面读数随 07 走查 | 通过 |
| AC-002-11 | `sync-service.test.ts` | 批次部分成功、失败后停止；共享目标失败后的失效与非重叠保留 | `sync-service.test.ts` 3 例通过：批次首单元成功后第二单元 describe 失败即停且成功记录保留、另一项目基线字节不变；claude 失败使共享 `.agents/skills` 的 codex 保持 pending 且历史保留、不重叠记录不受影响（store 层例守护）；skipped 单元不中断批次 | 通过 |
| AC-002-12 | `sync-status-store.test.ts` + 子进程中断夹具 | running 恢复、坏文件、未知 schema、写入失败 | 坏 JSON/未知 schema/目录不可写保留原文件、running 恢复共 5 例 + 新增子进程崩溃夹具 1 例（子进程 beginWrite 落 running 后以 137 退出，父进程新实例恢复为 interrupted 且无成功基线）通过；原生重启显示未执行 | 部分通过 |
| AC-002-13 | `sync-service.test.ts` | 运行中编辑来源、取消与目标锁 | `sync-service.test.ts` 3 例通过（真实 CLI + 慢包装注入）：运行中编辑来源→结束指纹不等→source_changed 且不提交；取消→CLI 进程组终止（pgrep 断言）→cancelled 且后续单元不启动；共享输出（含路径别名归并）并发执行严格串行、事件无交错。`sync-inputs.test.ts` 指纹原语 2 例留存 | 通过 |
| AC-002-14 | `sync-service.test.ts` | 等价共享写入先失效后原子恢复、保留原时间；跨库/不同计划/部分重叠和失败不恢复 | store 层 8 例（跨库/不同计划/部分重叠/写失败原子性/不重叠不受影响）+ `sync-service.test.ts` 真实分发目标 3 例：claude 成功原子恢复 codex（restored=1、原 completedAt 不变）、重复同步双方仍 current、claude 失败不恢复任何候选且先前失效记录不被凭空复活；回执目录读取后清理 | 通过 |
| AC-002-15 | `electron/test/sync-status-ui.test.tsx` + 原生走查 | 切换/刷新/激活、晚到响应、入库与回退 | `sync-status-ui.test.tsx` 4 例通过：挂载查询、SyncStatusChanged 触发重查、晚到响应丢弃不覆盖新选择、损坏状态展示重建入口并调用 SyncStatusRebuild；入库/回退重查提示由 05 的 intake-ipc 接线守护；原生窗口激活走查未执行 | 通过 |
| AC-002-16 | `sync-status-query.test.ts` + 查询前后文件树比较 | 只读查询、不解密、不联网、状态与 diff 分开 | `sync-status-query.test.ts` 6 例通过：查询前后库/目标树字节级路径集合一致、不创建密钥与状态文件、单元视图无 sha256/路径；密钥更换/缺失有基线时 unknown 优先；损坏状态 storeProblem 且不伪装 0 项/current；global 剔除 rules；重启恢复 current；界面文案固定「已同步当前版本（未检查目标文件）」且与规则 diff 页独立 | 通过 |
| AC-002-17 | `skills.test.ts`、`sync-service.test.ts` | 单项链接/卸载、global/project 隔离 | `sync-service.test.ts` 4 例通过（单项写入门控）：link/unlink 后模块 lastSuccess 与完成时间不变、needsResync=true、attempt=succeeded 且 reasonCode=skill_link/skill_unlink；global 单项写入不触碰 project 记录且不产生成功基线；共享 .agents/skills 单项写使另一工具模块失效但历史保留；write 失败记录 failed/single_write_failed 并原样抛出。链接层本体由既有 `skills.test.ts` 13 例守护；接线无绕过由 `sync-wiring.test.ts` 源码守护 | 通过 |
| AC-002-18 | `sync-fingerprint.test.ts`、回执集成与本机文件审计 | 合成凭据无泄露、派生 keyId；重启前合法密钥原位替换/缺失/长度错误/缺 keyId/运行中替换；同 key 来源变化对照 | 既有 12 例 + store 状态文件审计 1 例 + `sync-inputs.test.ts` 5 例 + `sync-status-query` 密钥更换/缺失例通过：describe 全程不创建密钥、描述输出不含规则正文/MCP 命令/vault 密文（仅路径）、`${secret:}` 引用不解密、同 key 来源变化与换 key 可区分；回执字段仅 schemaVersion/operationId/tool/module/scope/outcome/reasonCode/completedAt，静态审计无凭据/配置正文；07 轮再次扫描 `lib/sync-report.sh` 无 password/token/secret 等 | 通过 |

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

### 2026-10-16 · TASK-002-01 收尾轮（路径身份与 workspace 集成）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-01 完成条件，不含 CLI 回执、`--describe-inputs`、sync-service、IPC/UI）。
- 被测 commit / 改动范围：基于 `e105f54` 的未提交工作区；新增 `src/core/sync-unit-identity.ts`、`test/sync-unit-identity.test.ts`，修改 `src/core/sync-status-store.ts`（`getSyncStatusPaths`、`beginWrite` 规范路径门控）、`test/sync-status-store.test.ts`（10 项新增用例）。源码环境，未打包。
- 环境：macOS 27.0.1 arm64；Node v24.16.0；`node --import tsx --test` 源码直跑。
- 隔离与合成值：全部用 `mkdtemp` 临时目录、symlink 别名与随机 32 字节合成密钥；global 用例以临时目录覆盖 `process.env.HOME` 并在 finally 还原，未读写真实 userData、全局工具目录或 vault，不记录任何凭据值。
- 覆盖 AC 与命令：`node --import tsx --test test/sync-fingerprint.test.ts test/sync-status-store.test.ts test/sync-status.test.ts test/sync-unit-identity.test.ts`（65/65）；`npm test`（194/194）；`npm run build`（含 typecheck）通过。AC-002-01、07 判定为通过；AC-002-02、06、10、12、18 缺口收窄后仍为部分通过；其余 AC 未执行。
- 实际结果：TASK-002-01 完成条件全项有证据（重启读取、原子写失败保留旧数据、坏 JSON/未知 schema、running→interrupted 含子进程崩溃夹具、旧 lastSyncAt 不补造、归约同版本失败 pending、keyId 缺失/不匹配优先 unknown、状态文件无敏感正文、符号链接别名与普通子目录路径身份）。
- 跳过项与遗留边界：`--describe-inputs` 与生成器依赖清单（02）、CLI 回执（03）、sync-service 编排与目标锁（04）、IPC/界面（05/06）、两次原生应用启动与 GUI 走查（07）均未实现或未执行；AC-002-06 的来源重算以不同指纹代指，真实输入枚举属 02；未改 CLI，未跑 shell 套件回归；部分通过不得计为功能验收通过。

### 2026-10-16 · TASK-002-02 轮（输入描述契约与三模块指纹）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-02 完成条件，不含 CLI 回执、sync-service 编排、IPC/UI）。
- 被测 commit / 改动范围：基于 `e105f54` 加本轮未提交工作区；新增 `.ai-workspace/scripts/lib/sync-describe.sh`、`.ai-workspace/scripts/test/test-sync-describe.sh`、`electron/src/core/sync-inputs.ts`、`electron/test/sync-inputs.test.ts`；修改 `aiws`（describe 早退分支）、`lib/common.sh`（describe 日志走 stderr）、`lib/mcp-sync.sh`（抽取 `merge_mcp_effective` 供执行与 describe 共用）。源码环境，未打包。
- 环境：macOS 27.0.1 arm64；Node v24.16.0；`node --import tsx --test` 与 `sh` 直跑。
- 隔离与合成值：全部 `mkdtemp` 沙盒、复制真实 scripts、合成密钥与假 vault.enc/`${secret:}` 占位符；未读写真实全局目录、真实 vault 或 userData。
- 覆盖 AC 与命令：`sh .ai-workspace/scripts/test/test-sync-describe.sh`（34/34）；`node --import tsx --test test/sync-inputs.test.ts`（19/19）；`npm test`（213/213）；`npm run build` 通过；14 个既有 shell 套件全部回归通过（含 rules-tools 6、skills-link 9、drift-check 8、memory 15、rules-versioning 16、intake 全系）。AC-002-03、04、05 通过；AC-002-13 部分通过；AC-002-02、18 缺口收窄仍部分通过。
- 实际结果：TASK-002-02 完成条件全项有证据（三模块夹具覆盖正文/required/context/附属脚本/MCP 覆盖与删除、无关产物与不适用规则不影响、对象键序稳定数组序敏感、软链接边界显式失败、坏配置与读取中变化可诊断、同 key 来源变化与换 key 可区分、查询不创建密钥不解密 vault、合成值无泄漏）。
- 跳过项与遗留边界：CLI `--report-file` 回执（03）、sync-service 编排与目标锁（04）、IPC/界面（05/06）、原生验收（07）未实现；真实 Windows junction/copy 策略未在真机验证（describe 的 linkType 由 `get_link_type` 决定）；部分通过不得计为功能验收通过。

### 2026-10-16 · TASK-002-03 轮（CLI 单元回执）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-03 完成条件，不含 sync-service 批次编排与 IPC/UI）。
- 被测 commit / 改动范围：基于 `e105f54` 加本轮未提交工作区；新增 `.ai-workspace/scripts/lib/sync-report.sh`、`.ai-workspace/scripts/test/test-sync-report.sh`、`electron/src/shared/sync-unit-receipt.ts`、`electron/test/sync-unit-receipt.test.ts`；修改 `aiws`（`--report-file` 解析、报告模式单单元参数校验、mcp/skills 门控在报告模式下进入落回执、rules global 报 tool_unsupported）、`lib/common.sh`（回执函数无操作兜底 + 加载真实实现，供给 drift-check 干跑与 `aiws skills` 等非 cmd_sync 调用方）、`lib/rules-generate.sh`、`lib/mcp-sync.sh`（含替换后残留 `${secret:}` 检测）、`lib/skills-link.sh`（完成/部分失败计数）、`electron/src/core/sync.ts`（reportFile/operationId 参数与校验）。源码环境，未打包。
- 环境：macOS 27.0.1 arm64；Node v24.16.0；`node --import tsx --test` 与 `sh` 直跑。
- 隔离与合成值：全部 `mkdtemp` 沙盒与合成 operationId；缺 jq 用符号链接沙盒 PATH 模拟（回执以 printf 构建，不依赖 jq）；未读写真实全局目录或 vault。
- 覆盖 AC 与命令：`sh .ai-workspace/scripts/test/test-sync-report.sh`（27/27）；`node --import tsx --test test/sync-unit-receipt.test.ts`（10/10）；`npm test`（223/223）；`npm run build` 通过；15 个 shell 套件全部回归通过（drift-check 8、import-rules 25、skills-link 9 等）。AC-002-09 通过；AC-002-08、11 部分通过。
- 实际结果：TASK-002-03 完成条件全项有证据（无参数兼容、原因码覆盖、退出 0 不冒充完成、缺 mapping/缺 jq/无内容/凭据未解决/坏配置均有真实引擎回执测试、校验器拒绝不完整或不匹配回执、回执不含正文/密钥）。
- 跳过项与遗留边界：sync-service 批次编排与"持久化后才显示已同步"（04）、IPC/界面（05/06）、Windows junction 部分失败真机复现（07）未实现；`partial_failure` 原因码为 design 关键原因码之外的显式扩展（Skills 部分链接失败）；部分通过不得计为功能验收通过。

### 2026-10-16 · TASK-002-04 轮（统一执行服务与输出锁）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-04 完成条件；不含 ipc/tray/renderer 接线与原生验收）。
- 被测 commit / 改动范围：基于 `e105f54` 加本轮未提交工作区；新增 `electron/src/core/sync-service.ts`、`electron/test/sync-service.test.ts`；修改 `lib/sync-describe.sh` 与 `shared/sync-inputs` 类型（describe 契约新增顶层 `outputKeys`，供写入锁与 Store 记录）、`test-sync-describe.sh`（3 例 outputKeys 断言）。源码环境，未打包。
- 环境：macOS 27.0.1 arm64；Node v24.16.0；`node --import tsx --test` 源码直跑。
- 隔离与合成值：全部 `mkdtemp` 沙盒、临时 HOME（global 批次）、合成密钥与包装 CLI（慢执行/伪回执，describe 透传真实引擎）；错误注入在进程与文件系统边界（chmod、SIGKILL）；未读写真实全局目录或 userData。
- 覆盖 AC 与命令：`node --import tsx --test test/sync-service.test.ts`（14/14）；`npm test`（237/237，连续两轮稳定）；`npm run build` 通过；15 个 shell 套件全绿（describe 37/37 含新增 outputKeys 断言）。AC-002-02、10、11、13、14 通过；AC-002-06、08、12、18 仍部分通过；其余未变。
- 实际结果：TASK-002-04 完成条件全项有证据（两项目单元独立、失败即停不污染无重叠单元、取消终止进程组且未启动单元不改变、运行中来源变化/换密钥阻止提交、记录写失败显示 record_failed 且重启恢复 interrupted、服务进程被杀后 running→interrupted、共享 Skills 与路径别名并发串行、等价收敛保留原时间、失败不复活先前失效记录）。
- 跳过项与遗留边界：ipc/tray/renderer 全部写入入口接线（05）、状态查询界面（06）、原生重启/GUI/打包验收（07）未执行；批次跨单元为设计要求的首版串行，未做并行批次优化；部分通过不得计为功能验收通过。

### 2026-10-16 · TASK-002-05 轮（写入入口接线）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-05 完成条件；不含状态查询界面与原生验收）。
- 被测 commit / 改动范围：基于 `d07247f`/`98d8b76` 加本轮未提交工作区；修改 `main/ipc.ts`（service 单例、`executeRepoSync`/`runFullSyncAll`、`runSingleSkillOp`、SyncStatusChanged 提示）、`main/tray.ts`、`main/index.ts`（单实例 + 启动恢复）、`main/intake-ipc.ts`（apply/rollback 提示）、`shared/ipc.ts`（新通道）、`core/sync.ts`（`isFullSyncCompletion`）、`core/sync-status-store.ts`（`finishSingleWrite`）、`core/sync-service.ts`（`runSingleSkillWrite`）；新增 `test/sync-wiring.test.ts`。源码环境，未打包。
- 环境：macOS 27.0.1 arm64；Node v24.16.0；`node --import tsx --test` 与 `npx tsc --noEmit`。
- 隔离与合成值：服务层测试沿用 `mkdtemp` 沙盒与临时 HOME；单项写入的 `write` 回调为受控假写入（链接层本体由既有 `skills.test.ts` 守护）；源码守护测试只读文件文本。
- 覆盖 AC 与命令：`node --import tsx --test test/sync-wiring.test.ts`（6/6）；`test/sync-service.test.ts`（18/18，含单项写入 4 例）；`npm test`（247/247）；`npm run build` 通过；15 个 shell 套件全绿。AC-002-17 通过；AC-002-14 维持通过；AC-002-15、16 未执行（界面类，属 06）。
- 实际结果：TASK-002-05 完成条件全项有证据（无绕过 service 的同步与单项 Skill 路径、单项链接不更新模块 lastSuccess、卸载使 needsResync、global 不污染 project、旧 lastSyncAt 不再由单模块推导全量完成、备份与错误反馈保留、单实例与启动恢复接线）。
- 跳过项与遗留边界：状态查询/界面与过期响应处理（06）、原生双实例/托盘/GUI 走查与打包验收（07）未执行；`runSingleSkillWrite` 的 `write` 回调为注入式（真实链接由既有链接层测试与人工走查覆盖）；部分通过不得计为功能验收通过。

### 2026-10-16 · TASK-002-06 轮（状态查询与界面）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-06 完成条件；不含原生 GUI/打包验收）。
- 被测 commit / 改动范围：基于 `b90a8f9` 加本轮未提交工作区；新增 `shared/sync-status-view.ts`、`core/sync-status-query.ts`、`renderer/use-sync-status.ts`、`renderer/pages/sync-status-panel.tsx`、`test/sync-status-query.test.ts`、`test/sync-status-ui.test.tsx`；修改 `shared/ipc.ts`（SyncStatusGet/SyncStatusRebuild）、`main/ipc.ts`（查询与重建 handler）、`renderer/pages/dashboard.tsx`（接入状态面板）、`renderer/styles.css`。源码环境，未打包。
- 环境：macOS 27.0.1 arm64；Node v24.16.0；`node --import tsx --test` 与 `npx tsc --noEmit`。
- 隔离与合成值：查询测试沿用 `mkdtemp` 沙盒与真实 CLI describe；不读写真实 userData/全局目录/vault；UI 测试用 jsdom + 假 window.api。
- 覆盖 AC 与命令：`node --import tsx --test test/sync-status-query.test.ts`（6/6）；`test/sync-status-ui.test.tsx`（4/4）；`npm test`（257/257）；`npm run build` 通过；5 个 shell 套件（describe 37、report 27、rules-tools 6、skills-link 9、drift-check 8）回归全绿。AC-002-15、16 通过；AC-002-14 维持通过。
- 实际结果：TASK-002-06 完成条件全项有证据（重启后新 Store 实例恢复 current；切页/切库/切项目由 hook 重查且过期响应丢弃；外部编辑在刷新/激活时重算；读取失败展示错误或 storeProblem；无项目不列 project 单元；「已同步当前版本（未检查目标文件）」与规则 diff 独立；UI 不展示哈希/路径/实现字段；重建入口备份后重置本机元数据）。
- 跳过项与遗留边界：原生窗口激活/双实例/托盘交叉走查与打包验收（07）未执行；入库/回退的原生走查未做（提示通道由 05 源码守护）；部分通过不得计为功能验收通过。

### 2026-10-16 · TASK-002-07 轮（集成验收与发布收尾）

- 日期 / 执行者：2026-10-16 / MiMoCode（范围：tasks.md TASK-002-07 完成条件；原生 GUI/真实 dmg 安装不执行）。
- 被测 commit / 改动范围：基于 `7a419b6` 加本轮未提交文档改动；实现代码无变更。修改 PROGRESS/TRACEABILITY/verification/ACCEPTANCE/能力盘点/个人手册/CHANGELOG。
- 环境：macOS 27.0.1 arm64；Node v24.16.0。
- 隔离与合成值：本轮为全量回归与静态审计，无新增夹具。
- 覆盖 AC 与命令：`sh .ai-workspace/scripts/test/test-*.sh` 15 套全绿（ci 10、drift 8、import-rules 25、intake 系 60/47/54/163/57/39、memory 15、rules-tools 6、rules-versioning 16、skills-link 9、describe 37、report 27）；`npm test`（257/257）；`npm run build` 通过；`git diff --check` 通过。AC-002-08、18 升为通过；AC-002-06、12 维持部分通过（原生两次启动未执行）；其余通过项不变。
- 实际结果：AC-002-01～05、07～11、13～18 均有结果与覆盖端；打包 `extraResources` 静态核对确认收录 `aiws-scripts` 下 `lib/sync-report.sh`/`sync-describe.sh`/`common.sh`/`aiws`（filter 排除 test）；回执字段审计无凭据/配置正文。
- 跳过项与遗留边界：两次原生应用启动（AC-002-06/12）、GUI 手工走查、真实 dmg 打包与安装验收、Windows junction 真机验证未执行；不得仅凭源码构建宣称安装包验收通过；部分通过不等于功能整包验收。

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
