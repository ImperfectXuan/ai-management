# AI Workspace Desktop — 验收指导文档

> **适用范围**：`electron/` 子目录开发的独立 macOS 应用（Electron + React + TypeScript）。
> **配套文档**：设计 spec `docs/superpowers/specs/2026-08-07-desktop-app-design.md`；实施计划 `docs/superpowers/plans/2026-08-07-desktop-app.md`。
> **本文件是验收标准**，随开发阶段推进逐步解锁，最终以 Task 20 的完整走查为结项依据。

---

## 0. 验收总览

| 阶段 | 状态 | 可验收内容 |
|---|---|---|
| Phase 1 core 层（Task 2-9） | ✅ 已完成 | 自动化测试全绿 + 模块级 CLI 冒烟 |
| Phase 2 main 进程（Task 10-12） | ✅ 已完成 | IPC 接线、托盘、通知 |
| Phase 3 renderer 界面（Task 13-18） | ✅ 已完成 | GUI 各页面功能走查 |
| Phase 4 打包（Task 19-20） | ✅ 已完成 | dmg 打包 + 端到端验收 |

**当前状态**：四阶段全部交付。§1 自动化验收 + §2 模块级冒烟（core 层）+ §3 GUI 逐页走查 + §4 打包验收，均可按本文件执行。

---

## 1. 自动化验收（贯穿始终）

### 1.1 测试命令

```bash
cd /Users/xuanyi/Documents/AI-management/electron
npm test            # 全量测试（当前 61 个用例）
npm test 2>&1 | grep -E "✖|✔"    # 只看用例名与失败
```

### 1.2 当前测试覆盖

| 模块 | 文件 | 验证的行为 |
|---|---|---|
| git | `test/git.test.ts` | 非 git 目录抛 `NotAGitRepo`；返回真实仓库根 |
| config | `test/config.test.ts` | 缺省配置回退；读取 workspace.json；MCP/技能路径映射 |
| workspace | `test/workspace.test.ts` | 仓库去重持久化；aiws 脚本存在性检测 |
| rules | `test/rules.test.ts` | 规则列表 + required/domain/globs；开关切换；globs 优先级 |
| mcp | `test/mcp.test.ts` | 列表/增删；local 覆盖合并；scope 过滤 |
| skills | `test/skills.test.ts` | 描述读取 + 三态 linkStatus；链接/卸载；Windows junction/copy 回退 |
| sync | `test/sync.test.ts` | 规则生成 frontmatter；幂等清空；进度行 + MCP 同步 |
| diff | `test/diff.test.ts` | identical；单/多 hunk 增删识别 |
| ipc 校验 | `test/ipc-rules-validate.test.ts` | setRuleRequired 入参边界校验（null/原始类型/非法 tool） |
| vault 桥接 | `test/vault-bridge.test.ts` | 缺 aiws 抛 `AiwsNotInstalled`；`--version` 桥接 |
| sync 取消 | `test/sync-cancel.test.ts` | `syncRun` 中止后停止产出新行 |
| renderer 冒烟 | `test/app.test.tsx` | 无仓库渲染管理页；有仓库渲染侧边栏 + tab |

**验收标准**：`npm test` 输出 `pass 61 / fail 0`。

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
> 先跑 2.3 的 sync 再跑本命令，预期 `identical: false`（因为生成文件含 frontmatter，源文件不含，diff 展示的是"规范化前后"的差异，属正常）。

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

---

## 3. GUI 验收（Phase 3 完成后）

### 3.1 启动

```bash
cd electron && npm start
```
窗口标题 "AI Workspace"，左侧仓库列表、右侧内容区、顶部 tab、底部状态栏。

### 3.2 逐页走查清单（来自计划 Task 20）

| # | 页面 | 操作 | 预期 |
|---|---|---|---|
| 1 | 仓库 | 输入 `/Users/xuanyi/Documents/AI-management` 添加 | 出现在列表，进入主界面 |
| 2 | 仓库 | 移除某仓库 | 从列表消失，切到仓库管理页 |
| 3 | 仪表盘 | 查看计数 | 规则/技能/MCP 计数非 0 |
| 4 | 仪表盘 | 点"一键同步" | 日志逐行滚动，完成后计数刷新 |
| 5 | 规则 | 切一个领域规则开关 | `.cursor/rules/` 对应文件增/删 |
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
| 无效仓库 | 添加非 git 目录路径 | 提示"不是 git 仓库" |
| 未初始化仓库 | 添加无 `.ai-workspace/` 的 git 仓库 | 仪表盘提示未初始化 |
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

- claude/codex 的规则生成（单文件模式）首版跳过，仅 cursor/trae 逐条生成
- 设置页语言/通知为界面占位，未持久化
- 添加仓库用路径输入框；文件夹选择器（dialog）延后
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
