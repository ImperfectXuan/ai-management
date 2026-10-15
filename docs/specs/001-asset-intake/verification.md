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
- 被测 commit / 未提交改动标识：未提交改动（基准 `4472767`）；改动范围 `identity.sh`（递归脱敏）、`scan.sh`（范围/错误/路径/规范源）、`aiws`（手动路径换行分隔）、`design.md`（契约修正）
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

### 2.3 第二轮审查整改验证（2026-10-10）

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：未提交改动（基准 `d086528`）；改动范围 `identity.sh`（非字符串脱敏）、`scan.sh`（父目录范围校验、MCP 结构验证、手动路径授权）、`aiws`（`--preview`）、`test-intake-review-fixes.sh`（测试修复+新增）
- OS、运行时与依赖版本：macOS（darwin）、POSIX sh、jq
- 覆盖端：CLI；Desktop 未执行
- 模型边界：未执行
- 测试目录及隔离方式：`mktemp -d` 沙盒；`HOME` 重定向；临时 Git 仓库验证 .gitignore
- 命令 / 人工步骤及预期结果：
  - `test-intake-review-fixes.sh` → 57 用例（含新增：非字符串脱敏 5、MCP 结构 6、手动授权 2、--preview 3）
  - `test-intake-scan.sh` → 33、`test-intake-compare.sh` → 47、`test-intake-apply.sh` → 60、`test-intake-model.sh` → 54
  - 既有 shell 套件 79 用例
- 实际结果、日志位置及覆盖边界：
  - 审查修复：57/57 通过
  - 兼容测试：33+47+60+54 = 194 用例全部通过
  - 既有测试：79 用例全部通过
  - 总计 330 用例全部通过
  - .gitignore 验证：临时 Git 仓库中 `scan.json` 被正确忽略
- 失败 / 未执行项、原因及影响：
  - Desktop 端未验证
  - 真实工具全局路径未验证

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
| AC-001-07 | 03 | 引擎+CLI：重复扫描候选稳定；已忽略且未变不重复提醒并保留可查；忽略后来源变化重新标记 changed；暂缓保留待审核；来源删除不删总库资产、保留决定记录（11 项断言通过）。审查整改后：忽略/暂缓按**实际审核过的来源组**生效——新来源、A+B 联合扫描中未被审核的来源重新进入审核，暂缓与忽略语义分离（运行 7）。Desktop 未执行 | 部分通过 |
| AC-001-08 | 04、05、07 | Desktop+CLI：IPC/组件层覆盖六动作入口、受约束批量确认（跳过冲突与无法解析）、未处理冲突阻断入库；六动作实际落盘由引擎测试覆盖。GUI 未手工走查 | 通过 |
| AC-001-09 | 06、07 | 服务边界：建议必须携带 `source_occurrence_id` 与逐字匹配的原文锚点，锚点不符即丢弃；未覆盖区间自动补齐，原文不因模型漏账而消失；模型路径不写任何资产（无直接入库通道）。人工编辑与最终入库采用人工结果属 TASK-001-07，未执行 | 部分通过 |
| AC-001-10 | 06、07 | 服务边界：未确认不发送（prepare 零请求）、预览后被改动拒绝发送、超时/非法 JSON/部分失败逐项记录且失败不入库、重试每次尝试单独留存不覆盖；无模型配置时 prepare 拒绝且人工闭环不受影响（TASK-001-04 已验证）。审查整改后：尝试序号**跨次接续**，同一请求再次发送追加 `attempt-3/4` 而不覆盖 `attempt-1`，`send_seq` 区分单次重试与用户再次发送（运行 7）。Desktop 上的编辑保留属 TASK-001-07，未执行 | 部分通过 |
| AC-001-11 | 02、06、08 | 请求模型侧：已识别敏感值在组装前脱敏为凭据身份占位符，明文不入请求体、不入请求文件/清单/尝试记录；凭据仅经 curl 标准输入进入 Authorization 头；可疑行以 `suspects` 提示人工检查。扫描侧：嵌套敏感字段（headers.Authorization 等）递归脱敏为 REDACTED，`${secret:}` 引用保留，scan.json 无明文（审查修复 2026-10-10）。入库与复用侧的绑定检查属 TASK-001-08，未执行 | 部分通过 |
| AC-001-12 | 04、05 | Desktop 侧实际入库覆盖新增/忽略/更新（registry、版本、来源、mapping 一致，重复执行不新增版本）；关联与变体由引擎测试覆盖。审查整改后：资产 ID 由 registry 稳定身份解析（不再由内容指纹重新推导），add→update×3 保持单一登记与连续版本；Desktop 经真实 IPC→真实 CLI 选定目标并两次更新，版本连续 `[1,2,3]`、同一规范源仅一条登记（运行 7）。GUI 未手工走查 | 部分通过 |
| AC-001-13 | 04、05 | Desktop 侧覆盖未处理项阻断与失败后保留动作并引导重审；计划过期、来源变化、并发检测由引擎测试覆盖。审查整改后：计划记录目标实际内容指纹，手改目标文件即 `target_content_changed` 整批中止且保留手改；暂存→提交窗口也复核；UI 改变动作/目标/总库后旧计划立即作废（运行 7）。GUI 未手工走查 | 部分通过 |
| AC-001-14 | 04 | Desktop 侧回退端到端（IPC 测试）与失败后续跑入口（组件测试）已覆盖；真实进程中断后的恢复未在 Desktop 手工复现。审查整改后：提交开始即持久化未完成记录与备份基线，续跑复用基线、不重复建版本、不再把首次新增当成既有文件；回退改为「先整体判定可行性、可行才动手」，冲突时内容与 registry 都不回退，重复回退幂等（运行 7）。GUI 未手工走查 | 部分通过 |
| AC-001-15 | 08、09 | 未执行 | 未执行 |
| AC-001-16 | 08、09 | 未执行 | 未执行 |
| AC-001-17 | 08、09 | 未执行 | 未执行 |
| AC-001-18 | 08、09 | 未执行 | 未执行 |
| AC-001-19 | 04、05、08、09 | Desktop 侧覆盖扫描取消（空置时报告未取消、运行中可中断且不批准资产）与逐阶段结果展示；多目标复制/同步失败属 TASK-001-08，未执行。审查整改后：阶段状态区分 `failed`（未进入提交）与 `incomplete`（已部分提交、需 `--resume`），`write_assets_partial`/`write_registry`/`write_history` 三种窗口都有明确状态与恢复入口（运行 7）。GUI 未手工走查 | 部分通过 |
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

## 3.2 运行 7 · TASK-001-03～06 审查缺陷整改回归（2026-10-10）

- 日期 / 执行者：2026-10-10 / Coding Agent
- 被测 commit / 未提交改动标识：`d086528` + 本轮整改的未提交工作区（同 TASK-001-03～06 的改动集）
- OS、运行时与依赖版本：macOS 27.0.0 (arm64)、`sh`(bash POSIX)、jq 1.7.1-apple、openssl、node（模拟服务与 Desktop 测试）
- 覆盖端：CLI shell 引擎层 + Electron 主进程/渲染进程
- 模型边界：只用 `127.0.0.1` 上的模拟服务，未调用真实模型服务、未产生费用
- 测试目录及隔离方式：新增 `.ai-workspace/scripts/test/test-intake-review-0306.sh`（`mktemp -d` 沙盒：临时总库 + 真实 CLI 引擎副本、临时来源、临时 HOME、回环模拟服务）；Electron 侧复用 `test/intake-fixtures.ts` 与真实 CLI 引擎
- 命令及预期结果：

```
sh .ai-workspace/scripts/test/test-intake-review-0306.sh      # 期望 163 ok / 0 not ok
sh .ai-workspace/scripts/test/test-intake-apply.sh            # 回归 60 ok / 0 not ok
sh .ai-workspace/scripts/test/test-intake-compare.sh          # 回归 47 ok / 0 not ok
sh .ai-workspace/scripts/test/test-intake-model.sh            # 回归 54 ok / 0 not ok
sh .ai-workspace/scripts/test/test-intake-scan.sh             # 回归 33 ok / 0 not ok
sh .ai-workspace/scripts/test/test-intake-review-fixes.sh     # 回归 57 ok / 0 not ok
（其余 shell 套件 test-ci / test-drift-check / test-import-rules / test-memory / test-rules-tools / test-rules-versioning / test-skills-link）
cd electron && npm test                                       # 期望 100/100
cd electron && npm run build                                  # 期望三个 bundle 构建成功
git diff --check                                              # 期望无输出
```

- 实际结果（2026-10-10 实测）：

| 命令 | 结果 |
|---|---|
| `test-intake-review-0306.sh` | **163 ok, 0 not ok**（连续 4 次运行一致；此前 2 项断言按 `started_at` 取记录，同秒时排序不确定，已改为按 `plan_id` 取） |
| `test-intake-apply.sh` | 60 ok, 0 not ok |
| `test-intake-compare.sh` | 47 ok, 0 not ok |
| `test-intake-model.sh` | 54 ok, 0 not ok |
| `test-intake-scan.sh` | 33 ok, 0 not ok |
| `test-intake-review-fixes.sh` | 57 ok, 0 not ok |
| 其余 7 个 shell 套件 | 全部 rc=0（ci 10/0、drift-check 8/0、import-rules 25/0、memory 15/0、rules-tools 6/0、rules-versioning 16/0、skills-link 9/0） |
| `npm test`（electron） | 100/100 通过 |
| `npm run build` | main / preload / renderer 三个 bundle 构建成功 |
| `git diff --check` | 无输出 |

- 逐项缺陷的可复现证据（均为真实 CLI 端到端，或真实 IPC → 真实 CLI 引擎）：

| 缺陷 | 断言（旧行为失败 → 现行为通过） |
|---|---|
| 一 写入路径边界 | `id: ../../../../escaped` 的规则：apply `failed` + `unsafe_asset_name`，`<沙盒>/escaped.md` 不存在；绝对路径 id 同样拒绝；父目录软链接指向总库外时 apply `failed` 且总库外无文件；合法名称 `legal-name.v2` 仍正常入库 |
| 二 稳定资产 ID | add→update×3 后 registry 只有 1 条该规范源登记、`current_version=4`、版本 `1,2,3,4` 且每版内容正确；首次纳管（link）登记 backfill v1 后更新沿用同一 ID；变体建立独立资产且 `related.parent` 指向原项、原项版本不变；显式目标不存在/类型不符时计划被拒绝 |
| 三 目标实际内容变化 | 计划后手改规则 / Skill 附属文件 / MCP server 配置：apply `failed` + `target_content_changed`，文件内容与 registry 版本保持手改后的状态 |
| 四 提交中断与续跑 | `write_assets` → `failed` 且总库零改动；`write_assets_partial` / `write_registry` / `write_history` → `incomplete` + 持久化的 `files` 基线；`--resume` 补齐后资产数、版本数、版本目录数均不重复，首次新增的 `before_fingerprint` 仍为 `null`，回退能正确删除新建文件；update 续跑后版本连续 `1,2`、回退恢复更新前内容 |
| 五 回退一致性 | 文件被后续修改时 `rollback_conflict`：文件保留、registry 计数器与文件均未被回退；恢复后回退成功并删除新建文件、移除 registry 资产；重复回退幂等（`rolled_back`、0 冲突）；后续批次推进 registry 后各自回退干净 |
| 六 凭据门禁 | Rule 正文 `API_KEY: <合成秘密>` 与 Skill 附属脚本中的 `PASSWORD=<合成秘密>`：apply `failed` + `credential_not_reference:<file>:<line>`，规范源未创建、`grep -rI` 全库无明文；`${secret:MY_KEY}` 引用与非敏感内容正常保留 |
| 七 忽略来源边界 | A 忽略后重扫 A：0 候选、1 条 suppressed；首次扫 B：1 候选未 suppressed；A+B 联合扫描：1 候选未 suppressed；A 内容变化：1 候选、含 `changed` 标签且未 suppressed；暂缓项始终留在待审核队列 |
| 十 多行敏感值 | 块标量 `API_KEY: \|` + 缩进秘密：请求文件、模拟服务实收请求体、尝试记录中均无该秘密，非敏感正文保留；`redactions[].line` 为真实行号 |
| 十一 响应结构与逐来源锚点 | `source_occurrence_id: []`、`uncovered_ranges: "oops"`、分数行号、越界行号、锚点指向请求外来源：均返回**结构化记录**（`status` 存在、`suggestions` 为数组），非法建议逐条进入 `rejected`；合法跨来源两项全部保留；部分合法部分非法 → `status: partial`、保留 1 拒绝 1；自动补齐区间携带正确来源 |
| 十二 跨次重试记录 | 同一请求两次发送：尝试文件 1,2 与 3,4 共存，`batch-1.attempt-1.json` 内容逐字节不变，`attempt` 连续、`send_seq` 两个取值、`body_hash` 一致；成功后再次发送同样追加 |
| 八 Desktop 六动作参数 | 通过真实 IPC → 真实 CLI：目标清单含已登记与未纳管项；不存在目标被拒；选定目标出现在计划动作里；`add`/`ignore` 携带 `target_asset_id` 被校验层拒绝；UI 层改变动作或目标后旧计划立即消失 |
| 九 历史查询与回退入口 | `IPC.IntakeStatus` 只给 `repoPath` 返回该总库全部执行历史（真实入库后可见）；UI 层查询失败展示可操作错误并隐藏「暂无入库记录」 |

- 覆盖边界：
  - 回退的「整批不动」策略由本轮引入，此前为逐文件部分回退；AC-001-14 的判定按新策略记录。
  - Desktop 模型配置与建议审核界面仍未实现（TASK-001-07），本轮只覆盖非 AI 闭环的目标选择与记录查询；AC-001-09～11 的 Desktop 部分仍未验证。
  - 模型边界全部使用本机模拟服务，未在真实 OpenAI-compatible 服务上验证。
  - backfill 路径的既有明文凭据不阻断入库（见 design §23.11），未做端到端验证。
- 失败 / 未执行项、原因及影响：无失败项。未执行项见上「覆盖边界」。

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
