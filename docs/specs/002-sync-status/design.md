# 002 · 技术设计

依据：[spec.md](spec.md)。基线：`81195b47728bd5d99fe6609db83e793c7f1d0fe4`。本文描述拟实现方案，不是现有能力声明。2026-10-15 用户确认采用“1A 共享输出等价判定 + 2A 密钥派生 keyId”；本次修订落实两项评审意见，不代表整包工程细则或功能验收已通过。

## 1. 现有实现与接入点

- [content-library.ts](../../../electron/src/core/content-library.ts) 持久化统一内容库；[workspace.ts](../../../electron/src/core/workspace.ts) 注册实际目标目录，项目级 `lastSyncAt` 只表达历史时间。
- [sync.ts](../../../electron/src/core/sync.ts) 调用 CLI，使用 `AIWS_SOURCE_DIR` 与 `AIWS_ROOT` 分别传入来源和目标，支持取消、超时、非零退出报错；当前只返回文本行。
- [ipc.ts](../../../electron/src/main/ipc.ts) 的 SyncRun/SyncAll 与 [tray.ts](../../../electron/src/main/tray.ts) 各自组织执行；SkillsLink/Unlink 直接调用 core。
- [dashboard.tsx](../../../electron/src/renderer/pages/dashboard.tsx) 状态在内存；[rules.tsx](../../../electron/src/renderer/pages/rules.tsx) 已无 dirty，不能以按钮状态代替成功记录。
- [CLI](../../../.ai-workspace/scripts/aiws)、[MCP](../../../.ai-workspace/scripts/lib/mcp-sync.sh)、[规则生成器](../../../.ai-workspace/scripts/lib/rules-generate.sh) 存在返回 0 的跳过分支；必须增加真实回执，不能解析“Sync complete”或依赖退出码为每个单元记成功。
- 现有规则 manifest 只描述规则快照；001 的资产 registry 记录收编版本。两者均不能充当某个目标的同步基线。

## 2. 分发单元与状态语义

覆盖 REQ-002-01、03、05、06、07、08。

### 2.1 身份

一个单元由 `libraryRoot + targetRoot + tool + module + scope` 标识。此处 scope 只表示 project/global 分发位置，与规则元数据的领域 scope 不同。路径由主进程从已选内容库/已登记项目解析并 `realpath`，不接受 renderer 自报路径作为身份。

- project：targetRoot 为应用项目真实路径；不以可移除重建的 repoId 或项目显示名作为身份。
- global：targetRoot 为本机实际用户配置根，附加本机用户配置归属；无 repoId 维度。同一用户在项目 A/B 查看 global 时看到同一记录。
- Rules 仅 project；Trae global MCP 不支持。工具未启用或模块关闭在当前配置下显示禁用，不删除历史记录。
- 路径别名与软链接去重；复制/搬家后的新真实路径是新身份，不自动迁移。目标不存在时为不可读取，不回退到父目录。
- 另计算实际输出集合 `outputKeys`：例如 Codex/Claude 的 Skills 都写入同一个 `.agents/skills`。尚不存在的输出路径以最近的真实父目录加规范化后缀解析。记录键独立，输出冲突必须共享锁；失效与等价恢复按 §2.3 执行，不能因 tool 不同视为两个磁盘目标。

### 2.2 两个状态维度

版本状态 `versionState`：

- `untracked`：没有可信成功基线。
- `pending`：指纹不同，或上次开始写入后未确认完成，或被其他写入/单项卸载失效。
- `current`：当前指纹与可信基线相同，且没有未完成或覆盖失效标记。文案固定为“已同步当前版本（未检查目标文件）”。
- `disabled` / `unsupported`：当前设置不执行或工具不支持；不伪造成功。
- `unknown`：来源/状态文件不可读取、格式不兼容、指纹密钥丢失、格式无效或 keyId 不匹配等。密钥身份检查先于来源指纹比较，错误优先于 current。

执行结果 `attemptState`：`never | running | succeeded | failed | cancelled | interrupted | source_changed | skipped | record_failed`。运行期间显示同步中，终态同时显示版本状态及原因。不能用一个枚举混淆“来源变更”和“最近操作结果”。

保留 `lastSuccess` 与 `lastAttempt`。`needsResync=true` 优先于指纹相等：重试失败可能已经部分改写目标，必须由显式成功重试清除；唯一例外是 §2.3 中已有可信成功记录在等价共享写入成功后的恢复，不能据此创建未执行工具的成功基线。只有尚未开始写入的输入校验失败不使先前基线失效。

聚合：有 running 显示运行中；否则有 unknown 显示部分状态未知；有 pending/untracked 显示待同步并给出数量；所有适用单元均 current 才显示已同步当前版本。disabled/unsupported 不计入完成分母；适用单元数为 0 时显示无可同步单元，不能显示全部成功。

### 2.3 共享输出等价判定（已选 1A）

保留每个工具独立的记录及执行结果。首版对 Codex/Claude 的共享 Skills 目标支持等价判定，不合并记录主键，不把同步一个工具自动记为另一个工具执行成功。

除每单元 `sourceFingerprint` 外，计算 `effectiveOutputFingerprint`：对 CLI 描述器给出的**实际分发计划**使用同一本机密钥与规范化编码计算 HMAC。首版 Skills 计划包含完整 outputKeys、每项实际目标和技能源真实路径、技能内容版本、链接/复制策略及影响结果的行为配置；不包含工具显示名、operationId、时间戳等与实际输出无关的字段。不能直接复用含 tool 的 sourceFingerprint。该摘要描述预期分发效果，不读取或比较目标文件内容。

两个记录仅在以下条件全部满足时可作为等价候选：同一真实内容库、同一实际目标和 scope、同为 Skills、完整 outputKeys 集合相同（只有部分重叠不算）、指纹算法版本与 keyId 相同、effectiveOutputFingerprint 相同。其他模块或无法完整描述计划的情况不启用等价例外。

执行规则：

1. 在持有共享输出锁时重算候选来源与计划。只有写入前本来为 current、needsResync=false 且已有可信 lastSuccess 的记录才进入本次等价候选快照；历史失效、来源已变或未记录的工具不进入候选。
2. 任何实际写入开始前，执行单元和所有重叠输出的其他记录先持久化 needsResync=true。等价候选也暂时失效，查询显示共享目标正在同步；不能在另一个工具部分写入或失败期间保留绿色状态。
3. 本单元 applied、输入及 keyId 稳定、成功记录可落盘时，再核对候选的完整身份、来源指纹与计划未变。与候选快照仍匹配且没有其他失效原因的候选可恢复 needsResync=false；保留其原 lastSuccess、完成时间及 lastAttempt，不伪造新执行结果。执行单元与候选恢复在同一次原子状态写入中提交。
4. 失败、取消、中断、来源/密钥变化或记录写入失败，不恢复任何候选。不同库、不同有效计划、部分输出重叠继续失效；查询不能仅凭两个计划摘要相同就清除既有失效标记。

收敛示例：同库同项目先完成 Codex Skills，再完成等价的 Claude Skills；后者成功提交时恢复前者的原成功状态，两者均 current。重复完整同步仍均 current。若 Claude 部分写入后失败，两者都 pending，Codex 的历史成功记录仍保留；随后显式成功重试可逐步恢复，不能让聚合状态提前变绿。

## 3. 指纹契约与输入边界

覆盖 REQ-002-02、06、09。

### 3.1 算法

本机首次显式同步创建 32 字节随机密钥 `sync-fingerprint.key`（0600），状态查询不生成密钥。以 HMAC-SHA-256 计算指纹，避免 MCP 本地配置等低熵敏感字段的裸 SHA-256 被离线猜测。密钥不写入内容库、项目或日志；备份和跨机器迁移不复用成功证据。

密钥身份为 `keyId = "sha256:" + SHA-256(keyBytes)`（64 位小写十六进制摘要，输入为原始 32 字节随机密钥）。这是高熵随机密钥的身份摘要，不是配置或凭据摘要；不可使用文件名、mtime 或单独随机 ID 代替，否则原位替换密钥可能无法被识别。每份 lastSuccess 和每次 lastAttempt 都保存当时的 keyId。

查询先检查密钥是否存在且长度正确，再派生当前 keyId 与记录比较；不一致返回 unknown/key_changed，不进入 sourceFingerprint 比较。相同 keyId 下来源指纹变化才属于 pending/source_changed。运行开始、结束及提交前也校验 keyId；运行中替换密钥时不更新成功记录、不恢复等价候选。keyId 不匹配的旧成功记录仅保留历史，不可改写为新 keyId 后继续使用。

算法版本 `fingerprintVersion=1`。使用规范化结构序列化：对象键按字节序排列，数组保留顺序；文件清单按 POSIX 相对路径排序，每项包含类型、相对路径、内容摘要及影响执行的可执行位；分段编码使用规范 JSON，禁止无分隔字符串拼接。文本按实际字节计算，不擅自 trim 或归一换行。

指纹载荷包含选定 tool/module/scope、有效行为配置、实际输入清单以及相关生成器依赖摘要。对 JSON 配置按解析后的结构计算，坏 JSON 直接 unknown，不能用空对象替代。

### 3.2 各模块输入

| 模块 | 纳入输入 | 排除或约束 |
|---|---|---|
| rules | CLI 实际会消费的规则文件及元数据；Cursor/Trae 当前工具的有效 mapping 项；非模板 context；相关工具行为配置 | 排除 rules/CHANGELOG.md、manifest、ADR、decisions；Codex/Claude 当前不消费 mapping，不能因此误判其版本变化；tools 不适用项不纳入 |
| skills | 具有 SKILL.md 的目录及全部附属文件、相对路径、可执行位；当前工具/scope 的分发配置与链接策略 | 不只哈希 SKILL.md；不遍历目标链接；源目录内软链接记录链接值及可读取的有效内容，循环/断链或越界到库外时 unknown，不静默忽略 |
| mcp | 合并主配置与 mcp.local.json 后，针对当前 tool/scope 的有效定义；参数数组顺序；权限文件；vault 加密文件及与替换有关的非敏感开关 | 不解密 vault，不持久化明文或配置摘要输入；环境占位符按现有生成器是否解析决定：若解析，纳入实际依赖的环境值，仅在进程内参与 HMAC |

模块依赖摘要必须来自实际执行的 CLI 及相关库文件，不能只取 package.json 的版本。维护显式依赖清单：common/aiws 的共享行为变化可使多模块失效，rules-generate/memory 只影响规则，skills-link/platform/TS links 影响技能，mcp-sync/vault 影响 MCP；开发测试和文档不纳入。

输入筛选复用 CLI 执行计划/枚举契约，不在 renderer 或 TS 再实现一套 tools、mapping、scope 解析。指纹变化意味着需要再同步，允许对共享依赖保守失效，但不得漏掉实际消费输入。

### 3.3 输入枚举接口

拟新增只读 `aiws sync --describe-inputs --tool <tool> --only <module> --scope <scope>`，返回 schema v1 描述：单元身份、是否可执行、原因码、文件相对路径、输入类型及选择器、相关运行时依赖清单；Skills 额外给出可用于等价判定的实际分发计划（目标项、源路径及链接/复制策略），不返回工具无关的空泛“技能数量”作为计划。该模式不执行分发、不解密、不创建 manifest 或成功记录；与 `--report-file` 执行模式互斥，参数冲突显式失败。

描述器由 CLI 同步计划使用相同筛选函数产出。普通文件按描述路径读取；MCP 描述给出主/覆盖源路径、覆盖顺序和已筛选的 server 名称，TS 只做通用 JSON 合并/按键投影与 HMAC，不再判断 scope 或适用工具。不返回配置正文和凭据；遇到不可表达的实际依赖先扩展契约，禁止漏项记成功。Desktop 把描述与读取内容保留在进程内，不写成调试快照。

### 3.4 执行期间变化

开始前计算 `startFingerprint`，该单元退出后重新计算 `endFingerprint`，不一致则记录 source_changed，不更新 lastSuccess，并使该单元 pending。收到的变更通知只能主动失效，不作为唯一检测依据；不增加后台 watcher。

这不是文件系统快照隔离：前后读到相同字节、期间发生 A→B→A 的外部瞬时变化无法仅靠前后指纹证明未发生。本包承诺来源版本记录，不承诺生成文件在任意并发编辑下逐字节一致；严格快照及目标一致性属于后续增强。界面不能把本记录显示成“已检查文件一致”。若读取期间发现清单/元数据变化或无法稳定读取，按 source_changed/unknown 处理，不重试至无限循环。

Skills 使用真实库链接，来源内容以后变化可能已通过链接生效；版本状态仍保守显示待同步，表示该版本尚无已确认的分发记录，不声称链接断开。

## 4. CLI 回执与执行顺序

覆盖 REQ-002-04、05、06。

新增可选 `aiws sync --report-file <absolute-path>`，只向调用方提供的本机临时文件写入 schema v1 回执；默认文本输出及既有 CLI 命令保持兼容。Desktop 不从 stdout 推导完成状态。operationId 由主进程生成，通过 `AIWS_SYNC_OPERATION_ID` 传入；报告模式缺少此值时显式拒绝。报告文件由主进程在 userData 下创建专用临时目录（0700），CLI 以 0600 原子写入，每单元使用新路径，读取后清理，不复用上轮回执。建议单元结果字段：

```typescript
interface SyncUnitReceipt {
  schemaVersion: 1;
  operationId: string;
  tool: 'codex' | 'claude' | 'cursor' | 'trae';
  module: 'rules' | 'skills' | 'mcp';
  scope: 'project' | 'global';
  outcome: 'applied' | 'skipped' | 'failed';
  reasonCode?: string;
  completedAt?: string; // UTC ISO 8601，仅 applied
}
```

回执不包含配置正文、密钥、完整 stdout 或服务器响应。回执 ID、工具、模块与 scope 必须匹配本次请求；缺失、坏格式、报告 skipped 而退出 0 均不算完成。非零退出优先失败，即使有 applied 回执也不能替此失败单元提交成功。

为控制失败边界，Desktop 编排按“工具 × 模块 × 有效 scope”逐单元执行 CLI `--tool ... --only ... --scope ...`，首版串行、失败/取消即停止后续单元。成功单元立即落盘，后续失败不撤销其历史证据；若后续失败单元写同一物理输出，先前记录必须依 §2.3 保持 pending，不能把“保留历史证据”解读为“保留 current”；不解析一个全量 CLI 的日志推测部分成功。规则版本化现有语义保留，仍不承担目标回执职责。

关键跳过原因包括 `module_disabled`、`tool_unsupported`、`no_entries`、`mapping_missing`、`dependency_missing`、`secret_unresolved`。可执行模块内部有未解决凭据、部分失败或跳过资产时，整体不能报告 applied。缺 jq 等依赖不能继续伪装成功。

空规则、空 Skills、最后一个 MCP server 删除时，当前引擎可能不删除遗留产物。本包返回 skipped/no_entries；没有历史记录时显示未记录、无可分发内容；有旧成功基线且输入已变时保留 pending，并提示“无可分发内容，旧目标未执行清理”。不自动删除用户文件。正确清理属于独立工作，不以虚假成功隐藏缺口。

每单元顺序：

1. 主进程解析真实来源/目标和输入，检查 keyId，计算单元指纹与适用的有效输出指纹；输入无效时不接触目标。
2. 获取实际输出集合的写入锁，复核计划和等价候选；在本机状态中持久化 running、needsResync，并暂时失效所有重叠输出记录，等价候选也不例外。记录不可写时不启动 CLI。
3. 调用 CLI，逐行转发进度；所有状态事件携带 operationId 和完整单元身份。
4. 校验退出状态、回执、取消信号、执行后指纹及 keyId；密钥不匹配优先判 unknown/key_changed。
5. applied、指纹和 keyId 稳定时，原子提交该单元 lastSuccess、清除本单元 needsResync，并按 §2.3 恢复仍可信的等价候选；其他结果只更新 lastAttempt，不覆盖 lastSuccess，也不恢复候选。
6. 成功落盘后才发布单元完成。CLI 已生成但记录写入失败时显示 record_failed；磁盘上仍是 running，重启按 interrupted 处理。释放锁。

## 5. 本机记录与恢复

覆盖 REQ-002-03、05、09。

记录存放在 Electron userData 的 `sync-status.json`，与 repos.json、content-library.json 并列；schemaVersion=1。示意类型：

```typescript
interface SyncRecord {
  key: { libraryRoot: string; targetRoot: string; tool: string; module: string; scope: string };
  outputKeys: string[];
  needsResync: boolean;
  lastSuccess?: {
    fingerprintVersion: 1;
    keyId: string;
    sourceFingerprint: string;
    effectiveOutputFingerprint?: string; // 首版 Skills 必填，其他模块不用于等价
    completedAt: string;
  };
  lastAttempt?: { operationId: string; keyId: string; state: string; startedAt: string; endedAt?: string; reasonCode?: string };
}
interface SyncStatusFile { schemaVersion: 1; records: SyncRecord[] }
```

落地代码将 tool/module/scope/state 收窄为共享字面量类型，时间戳必须验证，key 必须唯一；示意不授权在生产使用任意 string。校验 keyId 格式及 Skills 成功记录的有效输出指纹；缺少 keyId 的既有/实验性记录不作为可信成功，缺少有效输出指纹时也不能参与等价恢复。本包尚未实现，schemaVersion 仍为拟议 v1，不为未发布草案预设迁移后的成功证据。

- 写入由主进程单一 Store 排队，采用同目录临时文件 + 原子 rename，文件 0600。状态中只保留最近一次成功与最近一次尝试，不做无限历史日志。
- running 在目标写入前落盘；启动时将残留 running 改为 interrupted/needsResync。ENOENT 表示首次使用；损坏 JSON、未知 schema、权限错误必须显式报错并保留原文件，不能 catch 后返回空数组。
- 首次显式同步创建本机密钥；已有记录但密钥缺失、长度无效或派生 keyId 不匹配时为 unknown，分别给出 key_missing/key_invalid/key_changed。允许用户明确重建本机状态并重同步，不能自动生成新密钥后沿用旧基线；重建不回写旧 lastSuccess 的 keyId。
- 旧 lastSyncAt 保留兼容与历史展示，不迁移为 lastSuccess；新增记录以后“最近同步时间”仅从可信成功记录聚合，不以单模块同步修改整个项目的完成结论。
- 同一主进程串行写记录；应用采用单实例约束避免两进程同时改同一 userData。目标锁以 outputKeys 排序获得，覆盖 project/global 与 Codex/Claude 技能路径别名。独立 CLI/TUI 或用户外部修改不受此锁约束，也不产生 Desktop 成功记录。
- 同一 outputKey 的写入开始前先令所有重叠记录 needsResync=true；完成后仅按 §2.3 恢复本次可信的等价候选。不同库/不同计划覆盖、部分重叠以及任何未确认成功的写入均保持失效，禁止无条件恢复或无条件让等价工具永久互相失效。

## 6. 主进程接口与界面

覆盖 REQ-002-07、08；所有调用通过现有 IPC 错误封装。

拟新增 `SyncStatusGet`，入参 `{ repoId?, scope, tool?, module? }`。libraryRoot、project targetRoot 与 global 根由主进程解析；无项目不能查询 project 为 current，但仍可管理内容库。返回单元列表、聚合结果、UTC 时间和不含敏感内容的 reasonCode。

拟新增 `SyncStatusChanged`：`{ operationId, libraryRoot, targetRoot, tool, module, scope }`，只提示重查，不把 renderer 推送当权威状态。SyncProgress/SyncDone 补充同样身份；SyncDone 可保留为批次终结通知，但不能让整张概览自动标绿。

新增 `sync-service.ts` 作为唯一执行入口，组合 fingerprint、status-store 和现有 syncRun；SyncRun、SyncAll、托盘都调用它，不继续各自更新 lastSyncAt。状态存储不写入 WorkspaceStore，避免与 repos.json 全量保存互相覆盖。

规则/MCP 修改、入库/回退后只发变更提示，实际状态按文件重算；外部编辑通过进入页面、切换选择、窗口重新激活与手动刷新发现。无后台 watcher，界面显示最近检查时间；旧查询以请求序号和完整选择身份丢弃，未知/失败不能显示为 0 项或 current。本机状态损坏或密钥丢失时提供显式“重建本机同步记录”操作，确认后先备份损坏记录，仅重置本机元数据并提示重同步，不触碰内容库和工具文件。

SkillsLink/Unlink 在目标写入前执行同样的 running/失效门控；操作完成记录单项结果，但不更新模块 lastSuccess，保持 pending。再次执行模块同步才能恢复模块成功证据。global 与 project 分开处理，已有 linkStatus 三态仍是链接检查结果，不是本模块版本状态。

现有规则 diff 入口保持独立，不为 MCP/Skills 新建实时比较器；手动修改目标文件不改变来源指纹，因此可能仍显示已同步当前版本，这是方案 2 的明确边界。

## 7. 文件落点与风险

拟新增：`electron/src/shared/sync-status.ts`、`core/sync-fingerprint.ts`、`core/sync-status-store.ts`、`core/sync-service.ts`；CLI 拟新增 `scripts/lib/sync-report.sh`，在真实完成/跳过/失败分支填写回执。

拟修改：CLI aiws 与各同步库；main/ipc.ts、tray.ts、index.ts（单实例）、shared/ipc.ts；renderer 概览、规则、Skills、MCP、收编事件接线；现有 sync.ts 仅补报告参数与结果解析，不承担状态判定。新建对应行为测试，不写逐函数镜像测试。

主要成本：分单元启动 CLI 增加进程次数；指纹查询读取完整 Skill 文件树；无 watcher 需要刷新触发。首版不提前增加缓存，测量后再优化；不以 mtime 单独替代内容摘要。

执行前评审核对：共享 Skills 完整同步和重复同步后能全部收敛 current，等价写入失败后重叠记录保持 pending；keyId 原位替换与正常来源变更可区分。所有真实写入入口均经过 service；报告 applied 覆盖部分跳过/凭据失败；物理输出别名及完整输入依赖经过夹具验证。不存在需要改动生成的 AGENTS.md/CLAUDE.md 的步骤。
