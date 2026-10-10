# 001 · 验证记录

规格：[spec.md](spec.md)；任务：[tasks.md](tasks.md)。

## 1. 当前证据边界

- 2026-10-10：创建规格、任务和交接文档，未实现本功能，未执行功能验收。
- 2026-10-10：TASK-001-01 交付 [design.md](design.md)；完成文档链接、REQ/AC/契约覆盖检查。这不是功能验收证据。
- 2026-10-10：TASK-001-03 交付比较引擎（`lib/intake/compare.sh`、`aiws intake compare`）。运行记录见 §3.1；AC-001-04～07 结论为**部分通过**（仅引擎与 CLI，Desktop 未执行）。
- 2026-10-10：TASK-001-06 交付模型 API 边界与结构化建议校验（`lib/intake/{model,model-io}.sh`、`aiws intake model`）。运行记录见 §3.1 运行 6；AC-001-09、10、11 的服务边界部分通过（Desktop 审核界面属 TASK-001-07）。
- 2026-10-10：TASK-001-05 交付 Desktop 人工收编闭环（类型化 IPC + 共享引擎桥接 + 「收编」向导）。运行记录见 §3.1 运行 4/5；AC-001-01、02、08 判定通过，AC-001-12、13、14、19 部分通过。
- 2026-10-10：TASK-001-04 交付审核计划与执行引擎（`lib/intake/{plan,stage,apply,recover}.sh`、`aiws intake plan/apply/rollback/status`）。运行记录见 §3.1；AC-001-08、12、13、14、19 结论为**部分通过**（仅引擎与 CLI，Desktop 未执行）。
- 文档检查记录由本轮交付补充；不能作为功能通过证据。
- 实施阶段每次验证追加独立运行记录，包含被测 commit；若为未提交内容，额外记录基准 commit 和实际改动范围，不虚构 commit。
- 功能状态只在 [PROGRESS](../../PROGRESS.md) 维护。

## 2. 运行记录模板

- 日期 / 执行者：待填写
- 被测 commit / 未提交改动标识：待填写
- OS、运行时与依赖版本：待填写
- 覆盖端：待填写
- 模型边界：模拟 / 经授权的真实服务 / 未执行
- 测试目录及隔离方式：待填写，不记录真实凭据
- 命令 / 人工步骤及预期结果：待填写
- 实际结果、日志位置及覆盖边界：待填写
- 失败 / 未执行项、原因及影响：待填写

### 2.1 TASK-001-02 扫描引擎验证（2026-10-10）

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：未提交改动（基准 `4472767`）；改动范围 `.ai-workspace/scripts/lib/intake/`、`aiws`、`test-intake-scan.sh`
- OS、运行时与依赖版本：macOS（darwin）、POSIX sh、jq（Homebrew）
- 覆盖端：CLI（`aiws intake scan`）；Desktop 未执行
- 模型边界：未执行（扫描不涉及模型）
- 测试目录及隔离方式：`mktemp -d` 沙盒；`HOME` 重定向至沙盒；不触碰真实全局配置
- 命令 / 人工步骤及预期结果：
  - `.ai-workspace/scripts/test/test-intake-scan.sh` → 33 用例
  - 回归 `test-import-rules.sh`（25）、`test-skills-link.sh`（9）、`test-rules-tools.sh`（6）、`test-memory.sh`（15）、`test-drift-check.sh`（8）、`test-rules-versioning.sh`（16）
- 实际结果、日志位置及覆盖边界：
  - intake scan：33/33 通过（AC-001-01 多来源 10 用例、AC-001-02 只读 4 用例、AC-001-03 链接与生成副本 8 用例、AC-001-11 凭据分离 5 用例、零写入 2 用例、取消 1 用例、CLI 集成 3 用例）
  - 回归：25+9+6+15+8+16 = 79 用例全部通过
  - 扫描前后源目录 md5 一致；总库 `assets/` 未创建；输出无明文密钥
- 失败 / 未执行项、原因及影响：
  - Desktop 端扫描入口未实现（属 TASK-001-05）
  - 比较/增量（TASK-001-03）及后续阶段未执行
  - 真实工具全局路径（非沙盒）未验证

### 2.2 TASK-001-01/02 审查问题修复验证（2026-10-10）

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：未提交改动（同上基准）；改动范围 `identity.sh`（递归脱敏）、`scan.sh`（范围/错误/路径/规范源）、`aiws`（手动路径换行分隔）、`design.md`（契约修正）
- OS、运行时与依赖版本：同上
- 覆盖端：CLI；Desktop 未执行
- 模型边界：未执行
- 测试目录及隔离方式：`mktemp -d` 沙盒；`HOME` 重定向；不触碰真实全局配置
- 命令 / 人工步骤及预期结果：
  - `test-intake-review-fixes.sh` → 40 用例（审查问题回归）
  - `test-intake-scan.sh` → 33 用例（原有）
  - `test-intake-compare.sh` → 47、`test-intake-apply.sh` → 60、`test-intake-model.sh` → 54（兼容）
  - 既有 shell 套件 79 用例
- 实际结果、日志位置及覆盖边界：
  - 审查修复：40/40 通过
  - 嵌套凭据（headers.Authorization、X-Api-Key）→ REDACTED；`${secret:}` 引用保留；scan.json 无明文
  - 读取范围：HOME 链接/父目录链接拒绝；全局来源只授权选定工具路径；断链/循环报告
  - 损坏 MCP：parse_error 区分 invalid_json / missing_mcpServers_key；合法空配置 ok；TOML 成功/空配置 ok
  - 手动路径：含空格、中文路径正确处理；换行分隔不拆分
  - 规范源扫描：rules/skills/mcp 发现；与生成副本共存；来源文件不变
  - 兼容测试：234 + 79 = 313 用例全部通过
- 失败 / 未执行项、原因及影响：
  - Desktop 端未验证
  - 真实工具全局路径未验证
  - 已有的 `import-mcp.sh` TOML 解析器在 `set -e` 下 grep 无匹配会截断输出（调用处 `set +e` 规避，未改共享模块）

## 3. 验收结果

局部单元测试只能作为对应 AC 的部分证据；含 Desktop 或真实文件流程的 AC 需补齐其余路径才能判通过。

| 验收 ID | 对应任务 | 实际结果 / 证据 | 判定 |
|---|---|---|---|
| AC-001-01 | 02、05 | Desktop+CLI：IPC 层验证工具全局来源 + 手动 Skill 目录 + 未初始化来源统一扫描，且来源目录当总库被拒绝（校验独立）；CLI 侧多来源测试见运行 3。审查修复后：全局来源只授权选定工具路径、手动路径含空格/中文正确处理。GUI 未手工走查 | 通过 |
| AC-001-02 | 02、05 | Desktop+CLI：Desktop 侧返回缺失来源提示与错误清单，且来源目录内容哈希前后不变；四工具三类资产由 CLI 侧测试覆盖（共享同一引擎）。审查修复后：规范源（.ai-workspace/rules、skills、mcp）也被扫描。GUI 未手工走查 | 通过 |
| AC-001-03 | 02 | 2026-10-10 生成副本标记、断链报告、越界链接拒绝、有效内容收编通过。审查修复后：父目录软链接越界拒绝、HOME 未选子目录不读取 | 部分通过（CLI） |
| AC-001-04 | 03 | 引擎+CLI：跨名同内容合并为单一候选、保留全部来源、名称不决定内容相同（5 项断言通过）。Desktop 未执行 | 部分通过 |
| AC-001-05 | 03 | 引擎+CLI：同名不同正文与不同适用条件判冲突并展示 frontmatter 差异；MCP 同行为字段、不同账号绑定判冲突并单独表达 credential_diff；无明文泄漏（11 项断言通过）。Desktop 未执行 | 部分通过 |
| AC-001-06 | 03 | 引擎+CLI：SKILL.md 未变而 run.sh 变化 → 相对路径差异 changed=[run.sh]，未变文件不出现在差异中（4 项断言通过）。Desktop 未执行 | 部分通过 |
| AC-001-07 | 03 | 引擎+CLI：重复扫描候选稳定；已忽略且未变不重复提醒并保留可查；忽略后来源变化重新标记 changed；暂缓保留待审核；来源删除不删总库资产、保留决定记录（11 项断言通过）。Desktop 未执行 | 部分通过 |
| AC-001-08 | 04、05、07 | Desktop+CLI：IPC/组件层覆盖六动作入口、受约束批量确认（跳过冲突与无法解析）、未处理冲突阻断入库；六动作实际落盘由引擎测试覆盖。GUI 未手工走查 | 通过 |
| AC-001-09 | 06、07 | 服务边界：建议必须携带 `source_occurrence_id` 与逐字匹配的原文锚点，锚点不符即丢弃；未覆盖区间自动补齐，原文不因模型漏账而消失；模型路径不写任何资产（无直接入库通道）。人工编辑与最终入库采用人工结果属 TASK-001-07，未执行 | 部分通过 |
| AC-001-10 | 06、07 | 服务边界：未确认不发送（prepare 零请求）、预览后被改动拒绝发送、超时/非法 JSON/部分失败逐项记录且失败不入库、重试每次尝试单独留存不覆盖；无模型配置时 prepare 拒绝且人工闭环不受影响（TASK-001-04 已验证）。Desktop 上的编辑保留属 TASK-001-07，未执行 | 部分通过 |
| AC-001-11 | 02、06、08 | 请求模型侧：已识别敏感值在组装前脱敏为凭据身份占位符，明文不入请求体、不入请求文件/清单/尝试记录；凭据仅经 curl 标准输入进入 Authorization 头；可疑行以 `suspects` 提示人工检查。扫描侧：嵌套敏感字段（headers.Authorization 等）递归脱敏为 REDACTED，`${secret:}` 引用保留，scan.json 无明文（审查修复 2026-10-10）。入库与复用侧的绑定检查属 TASK-001-08，未执行 | 部分通过 |
| AC-001-12 | 04、05 | Desktop 侧实际入库覆盖新增/忽略/更新（registry、版本、来源、mapping 一致，重复执行不新增版本）；关联与变体由引擎测试覆盖。GUI 未手工走查 | 部分通过 |
| AC-001-13 | 04、05 | Desktop 侧覆盖未处理项阻断与失败后保留动作并引导重审；计划过期、来源变化、并发检测由引擎测试覆盖。GUI 未手工走查 | 部分通过 |
| AC-001-14 | 04 | Desktop 侧回退端到端（IPC 测试）与失败后续跑入口（组件测试）已覆盖；真实进程中断后的恢复未在 Desktop 手工复现。GUI 未手工走查 | 部分通过 |
| AC-001-15 | 08、09 | 未执行 | 未执行 |
| AC-001-16 | 08、09 | 未执行 | 未执行 |
| AC-001-17 | 08、09 | 未执行 | 未执行 |
| AC-001-18 | 08、09 | 未执行 | 未执行 |
| AC-001-19 | 04、05、08、09 | Desktop 侧覆盖扫描取消（空置时报告未取消、运行中可中断且不批准资产）与逐阶段结果展示；多目标复制/同步失败属 TASK-001-08，未执行。GUI 未手工走查 | 部分通过 |
| AC-001-20 | 04、08、10 | 未执行 | 未执行 |

TASK-001-10 汇总以上所有验收的最终证据。未执行不等于失败，也不等于通过。

## 3.1 实际运行记录

### 运行 1 · TASK-001-03 引擎测试

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：基准 `4472767` + **未提交**工作区改动（新增 `.ai-workspace/scripts/lib/intake/compare.sh`；修改 `identity.sh`、`store.sh`、`scripts/aiws`）
- OS、运行时与依赖版本：macOS 27.0.1 (arm64)、`/bin/sh` = bash 3.2.57、jq 1.7.1
- 覆盖端：共享引擎 + CLI；**Desktop 未执行**
- 模型边界：未涉及（本任务不含模型调用）
- 测试目录及隔离方式：`mktemp -d` 沙盒 + `trap rm -rf`；`HOME` 指向沙盒；来源、总库全部为临时夹具；不使用真实全局配置与真实凭据
- 命令及预期结果：`sh .ai-workspace/scripts/test/test-intake-compare.sh` → 全部断言通过
- 实际结果：`=== 结果: 47 ok, 0 not ok ===`，退出码 0
- 覆盖边界：验证共享引擎与 CLI 路径；`assets/registry.json` 未建立，`existing_asset_id` 为 `null`（属 TASK-001-04）；Desktop 未执行

### 运行 2 · TASK-001-04 plan/apply/rollback 测试

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：基准 `4472767` + **未提交**工作区改动（新增 `lib/intake/{plan,stage,apply,recover}.sh`、`test-intake-apply.sh`；修改 `store.sh`、`identity.sh`、`compare.sh`、`scripts/aiws`、`lib/import-rules.sh`）
- OS、运行时与依赖版本：macOS 27.0.1 (arm64)、`/bin/sh` = bash 3.2.57、jq 1.7.1
- 覆盖端：共享引擎 + CLI；**Desktop 未执行**
- 模型边界：未涉及（本任务不含模型调用）
- 测试目录及隔离方式：`mktemp -d` 沙盒 + `trap rm -rf`；`HOME` 指向沙盒；总库、来源、计划、决定全部为临时夹具；凭据一律使用 `${secret:}` 引用，不涉及真实密钥
- 命令及预期结果：`sh .ai-workspace/scripts/test/test-intake-apply.sh` → 全部断言通过
- 实际结果：`=== 结果: 60 ok, 0 not ok ===`，退出码 0；连续 3 次运行结果一致
- 覆盖边界：故障注入覆盖 `INTAKE_FAULT_STAGE=write_assets`；并发检测用真实交错（外部进程在暂存阶段推进 registry）；Desktop 端未执行；MCP 本机依赖绑定未覆盖（属 TASK-001-08）

### 运行 4 · Desktop 组件 / IPC / 桥接测试

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：基准 `4472767` + **未提交**工作区改动（新增 `electron/src/{shared/intake-types.ts,shared/intake-selection.ts,core/intake-bridge.ts,main/intake-ipc.ts,main/intake-args.ts,renderer/pages/intake.tsx}` 与对应测试；修改 `shared/ipc.ts`、`main/ipc.ts`、`renderer/App.tsx`、`renderer/styles.css`、`core/errors.ts`）
- OS、运行时与依赖版本：macOS 27.0.1 (arm64)、Node v24.16.0、jsdom 25、React 18.3.1；未启动 Electron GUI
- 覆盖端：Desktop（Renderer 组件 + IPC 处理器 + 桥接）；**未做 GUI 手工走查**
- 模型边界：未涉及（本任务无模型调用；AI 入口显示未配置）
- 测试目录及隔离方式：`mktempSync` 沙盒；总库为临时目录并复制真实 CLI 引擎副本；来源为临时目录且无 `.ai-workspace`；`process.env.HOME` 指向临时目录（global scope 不读真实 `~/.cursor` 等）
- 命令及预期结果：`npm test`（在 `electron/`）→ 全部用例通过
- 实际结果：`tests 93 / pass 93 / fail 0`（TASK-001-04 时为 65，本次新增 28：`intake-args` 7、`intake-bridge` 6、`intake-ipc` 5、`intake-ui` 9、fixtures 共享）；`npm run build` 通过
- 失败 / 未执行项：无失败。未执行 `npm run dist`（打包验收）、未在真实 GUI 中手工走查

### 运行 5 · Desktop 非 AI 闭环观测（临时夹具实走一次）

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：同运行 4
- OS、运行时：同运行 4
- 覆盖端：共享引擎 + 桥接（Desktop 实际调用的同一条链路）
- 测试目录及隔离方式：同运行 4（临时总库 + 两个无 `.ai-workspace` 的来源 + 临时 HOME）
- 命令 / 步骤：一次性脚本按 Desktop 顺序调用 `intakeScan → intakeCompare → intakePlan → intakeApply`，并在前后对来源与总库目录做内容哈希
- 实际观察：
  1. 扫描批次记录 6 条、来源 2 个、错误 0
  2. 候选分类：`mcp fresh [new]`、`rule 00-core [conflict]`、`rule newrule [new]`、`skill new-skill [new]`、`skill broken-skill [unparseable]`、`mcp .trae/mcp.json [unparseable]`
  3. 计划 6 个动作、未处理 0；风险项按显式选择记为 `ignore`
  4. 入库 `status=ok`，阶段 `preflight=ok write_assets=ok write_registry=ok write_history=ok`；变更 `.ai-workspace/rules/domains/newrule.md`、`.ai-workspace/skills/new-skill`、`.ai-workspace/mcp/mcp.json`；新资产 3、新版本 3
  5. registry：三个资产各 `v1`、`sources=1`
  6. 新规则内容末行为 `来自来源。`（来源内容确实写入规范源）
  7. `adapters/cursor/mapping.yaml` 已登记 `rules/domains/newrule.md`
  8. 两个来源目录内容哈希前后**未变**（只读成立）
  9. 总库 `rules/` 目录哈希已按计划变化
  10. 同一计划重复执行返回 `already_applied`
- 覆盖边界：观测只走确定性非 AI 路径；`conflict` 项在该脚本中被显式忽略，未演示 `update` 的 Desktop 落盘（由运行 2/4 覆盖）
- 失败 / 未执行项：无

### 运行 6 · TASK-001-06 模型边界测试（本机模拟服务）

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：基准 `4472767` + **未提交**工作区改动（新增 `lib/intake/{model.sh,model-io.sh}`、`test-intake-model.sh`；修改 `lib/intake/store.sh`、`scripts/aiws`）
- OS、运行时与依赖版本：macOS 27.0.1 (arm64)、`/bin/sh` = bash 3.2.57、jq 1.7.1、curl、Node v24.16.0（仅用于模拟模型服务）
- 覆盖端：共享引擎 + CLI；**未接 Desktop 界面**（属 TASK-001-07）
- 模型边界：**模拟**（本机 127.0.0.1 回环上的 Node `http` 服务，随机端口，按模式返回 ok/非法 JSON/非法引用/锚点不符/非法类型/未覆盖/超时/500/401 等）；**未调用任何真实模型服务，未产生费用**
- 测试目录及隔离方式：`mktemp -d` 沙盒 + `trap` 清理；总库含真实 CLI 引擎副本；来源为临时目录；`HOME` 指向沙盒；凭据用测试值经 `AIWS_MODEL_CREDENTIAL` 注入，不涉及真实密钥
- 命令及预期结果：`sh .ai-workspace/scripts/test/test-intake-model.sh` → 全部断言通过
- 实际结果：`=== 结果: 54 ok, 0 not ok ===`，退出码 0；连续 3 次运行结果一致
- 覆盖的具体事实：`prepare` 后模拟服务**零请求**；`send` 恰好一次请求且 URL 为 `/v1/chat/completions`；发送载荷中不含明文凭据（`redactions` 记录了脱敏行）；预览后改动载荷 → `request_tampered` 且零请求；非法 JSON → `invalid_output` 零建议；非法来源引用/锚点不符/非法类型 → 建议被丢弃并记录原因；未覆盖区间自动补齐并告警；超时与 500 可重试且每次尝试单独留存（2 次尝试）；4xx 只尝试 1 次；取消时零请求；凭据仅出现在 `Authorization` 头，请求文件、清单与全部尝试记录中均无凭据值；凭据解析失败时拒绝发送且零请求；扫描与候选状态哈希不变；模型路径从不创建 `assets/` 或规范源文件
- 失败 / 未执行项：无失败。未对真实模型服务验证（按要求只用模拟服务）；Desktop 模型配置与审核界面未实现

### 运行 3 · 既有 shell 套件回归

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：同上
- OS、运行时与依赖版本：同上
- 覆盖端：CLI shell 引擎层
- 模型边界：未涉及
- 测试目录及隔离方式：**显式把 `HOME` 指向临时目录**执行，避免各测试的 global-scope 路径写入真实 `~/.cursor`、`~/.agents` 等；其余隔离由测试自身沙盒提供
- 命令及预期结果：逐个执行 `.ai-workspace/scripts/test/test-*.sh`（10 个）→ 全部退出码 0
- 实际结果：`test-ci`、`test-drift-check`、`test-import-rules`、`test-intake-apply`(60 ok)、`test-intake-compare`(47 ok)、`test-intake-scan`(33 ok)、`test-memory`、`test-rules-tools`、`test-rules-versioning`、`test-skills-link` 均 rc=0（共 10 个套件）
- 覆盖边界：本轮回归在**隔离 HOME** 下运行，环境与历史运行不同，不能与历史用例数逐条对齐；仅证明本轮改动未破坏既有套件
- 失败 / 未执行项、原因及影响：无失败。Desktop / TUI 套件未执行（本轮未改动其代码路径），AC-001-20 不能据此判通过

## 4. 文档交付检查

2026-10-10 文档交付检查：

- 4 份新增文档的相对文件链接与格式检查通过。
- 12 项 REQ、20 项 AC、10 项 TASK 的引用覆盖检查通过；列表及范围简写纳入检查。
- 10 个步骤 prompt 与任务对应，均附有共同交接约束。
- `git diff --check` 通过；本轮写入限定为该功能文档与 docs/README、TRACEABILITY、PROGRESS 的入口关联，既有未提交改动未回退。
- 全部功能验收仍为未执行。未运行 aiws sync 或任何导入、模型、分发操作；未修改代码、commit 或 push。

2026-10-10 TASK-001-01 设计交付检查：

- `design.md` 创建完成，含 spec §6 六项设计落点、字段级数据契约、CLI/IPC 接口、目录/Git 边界、凭据方案、事务与恢复状态机、四工具能力矩阵。
- AC-001-01～20 全部映射到设计章节；REQ-001-01～12 全部映射。
- 文档相对链接全部可解析（spec / tasks / verification / coding-prompts / PROGRESS / FEATURE_BREAKDOWN / ARCHITECTURE / CLI 入口 / Desktop 核心）。
- tasks.md 工程粒度微调 3 处（TASK-001-02 零写入预览、TASK-001-05 Desktop 单文件桥接、TASK-001-08 原生内容保护细化），产品范围与验收标准未改。
- 无阻塞项；3 项实施中核实事项已记录（global 规则路径、openssl 可用性、TOML 解析复用）。
- 未运行功能写入、未修改实现代码、未 commit。
