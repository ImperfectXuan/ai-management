# AI Workspace Desktop — 验收指导文档

> **适用范围**：`electron/` 子目录开发的独立 macOS 应用（Electron + React + TypeScript）。
> **配套文档**：设计 spec `docs/superpowers/specs/2026-08-07-desktop-app-design.md`；实施计划 `docs/superpowers/plans/2026-08-07-desktop-app.md`。
> **文档角色**：Desktop 验证方法与首版验收口径，关联 [总体需求](../docs/SPEC.md) 的 REQ-DESKTOP / REQ-SYNC 及 [追踪矩阵](../docs/TRACEABILITY.md)。历史阶段状态不代表当次版本已通过验收；执行结果须记录 commit、环境、日期与验收 ID。

---

## 0. 验收总览

| 阶段 | 状态 | 可验收内容 |
|---|---|---|
| Phase 1 core 层（Task 2-9） | ✅ 已完成 | 自动化测试全绿 + 模块级 CLI 冒烟 |
| Phase 2 main 进程（Task 10-12） | ✅ 已完成 | IPC 接线、托盘、通知 |
| Phase 3 renderer 界面（Task 13-18） | ✅ 已完成 | GUI 各页面功能走查 |
| Phase 4 打包（Task 19-20） | ✅ 已完成 | dmg 打包 + 端到端验收 |

**历史交付记录**：四阶段已记录交付（实际证据查 [PROGRESS](../docs/PROGRESS.md)）。本轮仅整理文档，未重新验证。§1 自动化验收 + §2 模块级冒烟（core 层）+ §3 GUI 逐页走查 + §4 打包验收，均可按本文件执行。

---

本机演示入口、隔离说明与源码冻结步骤见 [本机演示指南](../docs/guides/local-demo.zh-CN.md)。

## 1. 自动化验收（贯穿始终）

### 1.1 测试命令

```bash
cd /Users/xuanyi/Documents/AI-management/electron
npm test            # 全量测试；用例数以当次执行为准
npm test 2>&1 | grep -E "✖|✔"    # 只看用例名与失败
```

### 1.2 当前测试覆盖

| 模块 | 文件 | 验证的行为 |
|---|---|---|
| git | `test/git.test.ts` | 非 git 目录抛 `NotAGitRepo`；返回真实仓库根 |
| config | `test/config.test.ts` | 缺省配置回退；读取 workspace.json；MCP/技能路径映射 |
| workspace | `test/workspace.test.ts` | 应用项目去重持久化；支持普通文件夹；保留选定子目录；aiws 脚本存在性检测 |
| rules | `test/rules.test.ts` | 规则列表 + required/domain/globs；开关切换；globs 优先级 |
| mcp | `test/mcp.test.ts` | 列表/增删；local 覆盖合并；scope 过滤 |
| skills | `test/skills.test.ts` | 描述读取 + 三态 linkStatus；链接/卸载；Windows junction/copy 回退 |
| sync | `test/sync.test.ts` | 规则生成 frontmatter；幂等清空；进度行 + MCP 同步 |
| diff | `test/diff.test.ts` | identical；单/多 hunk 增删识别 |
| ipc 校验 | `test/ipc-rules-validate.test.ts` | setRuleRequired 入参边界校验（null/原始类型/非法 tool） |
| vault 桥接 | `test/vault-bridge.test.ts` | 缺 aiws 抛 `AiwsNotInstalled`；`--version` 桥接 |
| sync 取消 | `test/sync-cancel.test.ts` | `syncRun` 中止后停止产出新行 |
| renderer 冒烟 | `test/app.test.tsx` | 未选择内容库显示引导；已有项目不自动成为内容库；无项目可管理资产但禁止同步 |
| 收编入参 | `test/intake-args.test.ts` | IPC 收编通道入参边界（来源/工具/scope/动作枚举/目标资产字段/状态查询过滤条件可选） |
| 收编桥接 | `test/intake-bridge.test.ts` | 真实 CLI 引擎端到端：多来源扫描与只读、候选分类、计划与入库、计划过期、取消、记录与回退 |
| 收编 IPC | `test/intake-ipc.test.ts` | 通道校验、总库/来源校验独立、进度广播、取消、scan→compare→plan→apply→status→rollback 全链路；目标经 IPC→CLI 生效与登记后 ID 稳定 |
| 收编向导 | `test/intake-ui.test.tsx` | 候选分类与来源详情、六种动作、目标资产选择、动作/目标变化使旧计划失效、批量不绕过冲突、未处理项阻断入库、失败续跑、取消通道、记录读取失败提示、AI 未配置说明 |

**验收标准**：当次完整测试套件无失败，并记录实际用例数与输出；历史用例数不能作为固定验收门槛。

### 1.3 测试追加规则

每个 Task 完成后新增的用例，其名称遵循 `<subject>_<scenario>_<expected outcome>`；
测试独立性（不依赖执行顺序、不共享状态）为强制项。

---

## 2. 模块级冒烟（Phase 1，无需 GUI）

core 层不依赖 Electron，可用 `node --import tsx -e` 直接驱动，模拟对任意仓库执行真实操作。

> ⚠️ **重要**：以下命令会**真实写文件**（生成规则、覆盖 MCP 配置）。
> 验收前请在**临时 git 仓库**上操作，或用 `--dry` 思路先阅读再执行，避免污染真实仓库。

### 2.1 仓库注册（Task 4）

```bash
cd electron
node --import tsx -e "
const { WorkspaceStore } = require('./src/core/workspace');
(async () => {
  const store = new WorkspaceStore('/tmp/aiws-repos.json');
  const repo = await store.add('/Users/xuanyi/Documents/AI-management');
  console.log('已注册仓库:', repo);
  console.log('列表:', (await store.load()).map(r => r.path));
})();
"
```

### 2.2 规则装载开关（Task 5）

```bash
node --import tsx -e "
const { listRules, setRuleRequired } = require('./src/core/rules');
(async () => {
  const root = '/Users/xuanyi/Documents/AI-management';
  console.log('规则列表:', (await listRules(root)).map(r => ({id: r.id, required: r.required})));
  // 打开一个领域规则的装载
  await setRuleRequired(root, 'cursor', 'vue3', true, true);
  console.log('切换后:', (await listRules(root)).find(r => r.id === 'vue3').required);
})();
"
```
> 验证后请恢复：`setRuleRequired(root, 'cursor', 'vue3', true, false)`。

### 2.3 同步（Task 8）—— 完整链路

```bash
node --import tsx -e "
const { syncRun } = require('./src/core/sync');
(async () => {
  for await (const line of syncRun('/Users/xuanyi/Documents/AI-management')) {
    console.log('[sync]', line);
  }
})();
"
```
**验证点**：
- 输出含 `已生成 cursor 规则 N 个`、`已生成 trae 规则 N 个`、`同步完成`
- `.cursor/rules/*.mdc` 与 `.trae/rules/*.md` 已生成（数量与 mapping 一致）
- `.cursor/mcp.json` 含 `mcpServers`

### 2.4 差异对比（Task 9）

```bash
node --import tsx -e "
const { compareRuleToGenerated } = require('./src/core/diff');
(async () => {
  const r = await compareRuleToGenerated('/Users/xuanyi/Documents/AI-management', 'cursor', '00-core');
  console.log('源文件与生成文件是否一致:', r.diff.identical);
  console.log('hunks:', JSON.stringify(r.diff.hunks, null, 2).slice(0, 300));
})();
"
```
> 先跑 2.3 的 sync 再跑本命令，预期 `identical: true`（对比临时目录内 CLI 生成的预期产物与实际文件，不再将 frontmatter 格式转换视为漂移）。

### 2.5 取消语义（Task 11 预留）

```bash
node --import tsx -e "
const { syncRun } = require('./src/core/sync');
(async () => {
  const ctrl = new AbortController();
  ctrl.abort();  // 立即取消
  for await (const line of syncRun('/Users/xuanyi/Documents/AI-management', {}, ctrl.signal)) {
    console.log(line);
  }
  console.log('已取消，无后续进度');
})();
"
```

### 2.6 收编（intake，TASK-001-05）

```bash
cd electron
npm test -- --test-name-pattern "收编|intake"   # 收编相关用例
npm test                                        # 完整套件（当前 93 用例）
```

模块级行为（不需要 GUI）：

- `test/intake-bridge.test.ts`：在临时总库（复制真实 CLI 引擎）+ 两个无 `.ai-workspace` 的来源上走完整闭环；断言来源目录内容哈希前后不变、规范源与 registry 落盘、新规则已登记 mapping、重复执行返回 `already_applied`、回退删除本批次新建项。
- `test/intake-ipc.test.ts`：直接驱动 IPC 处理器（不经 Electron）；断言来源目录当总库被拒绝（源/目标校验独立）、进度广播、取消不产生 `assets/`。
- `test/intake-ui.test.tsx`：组件级；断言候选分类展示、六种动作入口、需要目标的动作给出实际资产下拉且选定值随决定送交 IPC、改变动作后旧计划立即消失、批量「全选新增」跳过冲突与无法解析、`unresolved` 非空时禁用「执行入库」、失败后提供续跑与重审、入库记录读取失败显式报错、AI 区显示未配置。

手工走查（启动 GUI 后）：在左侧导航打开「配置收编」 → 填总库路径（已初始化的 AI Workspace）→ 添加来源（可为任意目录）→ 开始扫描 → 逐个候选选择动作（冲突项必须显式选择；「关联已有项 / 更新原项 / 另存变体」还需选定目标资产）→ 生成计划 → 执行入库 → 展开「入库记录」后回退。

注意：`react-dom` 必须在 jsdom 全局之后加载才能让受控输入的 `onChange` 生效，组件测试用 `await import('@testing-library/react')` 懒加载，新增组件测试请沿用同一写法。

---

## 3. GUI 验收（Phase 3 完成后）

### 3.1 启动

```bash
cd electron && npm start
```
窗口标题 "AI Workspace"。首次使用先显式选择统一内容库；侧边栏分别展示内容库路径与应用项目，右侧为内容区，底部为状态栏。

### 3.2 逐页走查清单（来自计划 Task 20）

| # | 页面 | 操作 | 预期 |
|---|---|---|---|
| 1 | 内容库 | 选择临时普通文件夹，创建空内容库 | 规则、Skills、MCP 为空，不含开发项目资产；重启恢复选定位置 |
| 1a | 应用项目 | 添加另一个临时文件夹，选为应用项目 | 不要求 Git 或 `.ai-workspace/`；同步输出仅写入此目录 |
| 1b | 内容库 | 切换到另一已初始化内容库 | 资产来源改变，旧内容与应用项目产物保持不变，直到主动同步 |
| 2 | 应用项目 | 移除某项目 | 从列表消失，内容库仍可管理；无项目时禁用同步 |
| 3 | 工作区概览 | 查看计数 | 规则/技能/MCP 计数与选定内容库一致（空库为 0） |
| 4 | 工作区概览 | 点"同步到四个工具" | 日志逐行滚动，完成后计数刷新 |
| 5 | 规则 | 切一个领域规则开关 | 内容库 mapping 的 required 改变；点同步后目标项目的 alwaysApply 改变，规则文件仍保留 |
| 6 | MCP | 添加测试服务器 | 表格出现新行 |
| 7 | MCP | 删除该服务器 | 表格行消失（用后删除恢复） |
| 8 | 技能 | 查看列表 + 详情 | 主-从布局，link 状态表正确 |
| 9 | 技能 | 链接/卸载 | 状态表对应变化 |
| 10 | 密钥 | 查看 | vault 就绪状态 + 各工具可用密钥表（只读） |
| 11 | 差异对比 | 选工具+规则看 diff | 增绿删红；"重新同步"后显示无差异 |
| 12 | 托盘 | 快速同步全部 | 系统通知弹出"已同步 N 个仓库" |
| 13 | 托盘 | 退出 | 应用完全退出 |

### 3.3 错误场景验收

| 场景 | 操作 | 预期 |
|---|---|---|
| 无效应用项目 | 添加不存在或非文件夹路径 | 明确报错，不登记项目 |
| 未选内容库 | 已有应用项目但尚未选内容库 | 显示内容库引导，不隐式读取项目资产 |
| 内容库冲突 | 对已有 `.ai-workspace/` 点击创建空内容库 | 拒绝覆盖，提示使用已有内容库 |
| vault 未就绪 | 进入密钥页 | 黄色提示条 + 安装指引 |

---

## 4. 打包验收（Phase 4 完成后）

```bash
cd electron && npm run dist
```
- 产出 `electron/release/AI Workspace-0.1.0-arm64.dmg`
- 双击 dmg → 拖 "AI Workspace" 到 /Applications → 启动正常
- 若未配置 Apple 开发者账号，签名/公证为关闭状态（可本地安装）

---

## 5. 已知限制与后续项（不属于本期验收）

- 四工具规则、context、MCP 与 Skills 批量同步已通过共享 CLI 接入（2026-10-15），默认 project scope
- 设置页语言/通知为界面占位，未持久化
- 内容库和应用项目均支持系统文件夹选择器，也可输入绝对路径
- 应用图标为占位，正式图标与代码签名/公证留待有 Apple 开发者账号后配置
- 密钥 vault 首版只读（桥接现有 `aiws secrets --json`），解密与写操作不做

---

## 6. 常见问题

**Q: `npm start` 后窗口是空白？**
A: Phase 3 renderer 完成前，窗口只渲染占位 `AI Workspace` 文本，属正常。

**Q: 想验证 core 逻辑但怕污染真实仓库？**
A: 用 `mkdtempSync` 建临时 git 仓库（如 `/tmp/aiws-test-*`），先 `git init`，再运行模块命令。

**Q: 测试挂某个用例怎么办？**
A: `npm test 2>&1 | grep -A 20 "✖"` 看断言细节；core 层错误均为 `WorkspaceError`（带 `code`），可用 `e.code` 精确断言。

**Q: 推送需要代理？**
A: GitHub 直连失败时用 `git -c http.proxy=socks5h://127.0.0.1:10808 push ...`（10808 为本地 SOCKS5 代理）。
