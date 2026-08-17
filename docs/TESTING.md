# AI Workspace — 逐步验证测试指导

> 本文档是一份**面向验证者**的逐步测试手册。它把两份实施计划（TUI 12 个 task、Desktop 20 个 task）中散落的 TDD 用例与验证命令，沉淀为一份**步骤明晰、通俗易懂、每个 task 点都有具体测试用例**的指南。
>
> 目标读者：想确认「某一步实现是否真的工作」的人。你不需要读懂所有源码，只要会跑命令、会对照「预期结果」判断即可。

---

## 第 0 章 前置准备

### 0.1 环境要求

| 依赖 | 版本 | 检查命令 |
|---|---|---|
| Node.js | ≥ 18（推荐 20+） | `node --version` |
| git | 任意 | `git --version` |
| macOS | — | 桌面应用（electron）仅支持 macOS |

### 0.2 安装依赖

```bash
# TUI（依赖已装，如缺则执行）
cd tui && npm install

# 桌面应用（当前未装，需先安装）
cd electron && npm install
```

> 首次 `npm install` 需联网下载 Electron 二进制，可能较慢。

### 0.3 测试约定：临时仓库

**重要**：部分命令会**真实写文件**（生成规则、覆盖 MCP 配置、建 symlink）。为避免污染真实仓库，验证写操作时请在**临时 git 仓库**上进行：

```bash
TMP=$(mktemp -d)              # 建一个临时目录
cd "$TMP" && git init         # 初始化为 git 仓库
# 复制一份 .ai-workspace 到该仓库（如需真实规则/MCP fixtures）
# cp -r /path/to/project/.ai-workspace "$TMP/"
```

验证完删除 `$TMP` 即可。

---

## 第 1 章 测试层级说明

本项目遵循「测试金字塔」，四个层级：

| 层级 | 测什么 | 怎么跑 | 速度 |
|---|---|---|---|
| **单元测试** | `core/` 单个函数（electron）、`lib/` 纯函数（tui） | `npm test` | 快，无 I/O |
| **集成测试** | 真实临时 git 仓库 + fixtures 的端到端产出 | `npm test` 内 | 中 |
| **UI 冒烟** | renderer/TUI 组件能否渲染 | `npm test` 内 | 中 |
| **手动 E2E** | 真实 GUI/TUI 逐页操作 | `npm start` / `npm run tui` | 慢 |

**一条总命令**：

```bash
cd electron && npm test     # 桌面应用：core 单测 + renderer 冒烟（node:test + tsx）
cd tui && npm test          # TUI：node:test（含 aiws/json/screens）
```

---

## 第 2 章 CLI（aiws）验证

`aiws` 是唯一事实来源的读写引擎，三个界面最终都调它。先单独验证它。

```bash
# 定位 CLI（在项目根目录执行）
.ai-workspace/scripts/aiws --version
# 预期：aiws v0.1.0
```

### 2.1 setup

| 操作 | 预期 |
|---|---|
| `aiws setup` | 初始化 `.ai-workspace/` 目录结构；提示是否初始化 vault |

### 2.2 sync（正向同步）

| 操作 | 预期 |
|---|---|
| `aiws sync` | 依次执行规则/MCP/技能三阶段同步，输出 `已生成 cursor 规则 N 个` 等进度；`AGENTS.md`/`CLAUDE.md`/`.cursor/rules/*.mdc`/`.trae/rules/*.md` 被生成或更新 |
| `aiws sync --tool cursor` | 仅同步 Cursor |
| `aiws sync --scope global` | 仅同步 global scope |

### 2.3 validate

| 操作 | 预期 |
|---|---|
| `aiws validate` | 校验工作区结构与配置；无报错表示通过 |

### 2.4 mcp 管理

| 操作 | 预期 |
|---|---|
| `aiws mcp list` | 列出已配置的 MCP 服务器 |
| `aiws mcp add <name> <command>` | 添加服务器到 `mcp.json` |
| `aiws mcp remove <name>` | 移除服务器 |
| `aiws mcp show <name>` | 查看单个服务器详情 |

### 2.5 skills 管理

| 操作 | 预期 |
|---|---|
| `aiws skills list` | 列出所有技能及同步状态（25 个技能） |
| `aiws skills link [scope]` | 将技能 symlink 到各工具 skills 目录 |
| `aiws skills unlink [scope]` | 解除链接 |
| `aiws skills install <source>` | 从 Git/npm/本地路径安装技能 |

### 2.6 secrets（需先 setup vault）

| 操作 | 预期 |
|---|---|
| `aiws secrets list` | 列出密钥名（不显示值） |
| `aiws secrets audit` | 显示各工具使用哪些密钥 |

### 2.7 import（反向同步）

| 操作 | 预期 |
|---|---|
| `aiws import mcp --dry-run` | 预览可导入的 MCP，不实际写入 |
| `aiws import skills --dry-run` | 预览可导入的技能 |
| `aiws import mcp --from codex -y` | 从 Codex 导入 MCP 到 `mcp.json`（同名去重） |

---

## 第 3 章 TUI 验证

> 对应实施计划 `docs/superpowers/plans/2026-08-04-tui.md`（12 个 task：A1-A3、B1-B2、C1-C7）。
> 所有命令在 `tui/` 目录下执行。

### Task 1 (A1)：`mcp list --json`

- **验证目标**：`aiws mcp list` 支持 `AIWS_JSON=1` 结构化输出。
- **测试用例**：
  ```bash
  AIWS_JSON=1 .ai-workspace/scripts/aiws mcp list 2>/dev/null | jq .
  # 预期：{"servers":[{"name":"filesystem","command":"npx"},...]}
  ```
- **回归用例**（文本输出不受影响）：
  ```bash
  .ai-workspace/scripts/aiws mcp list
  # 预期：与改造前一致（"Configured MCP servers:" + 列表）
  ```
- **通过标准**：JSON 合法、字段含 name/command；无 `AIWS_JSON` 时仍为纯文本。

### Task 2 (A2)：`skills list --json`

- **验证目标**：`aiws skills list` 支持结构化输出（含各工具 link_status）。
- **测试用例**：
  ```bash
  AIWS_JSON=1 .ai-workspace/scripts/aiws skills list 2>/dev/null | jq '.skills[0] | {name, link_status}'
  # 预期：25 个技能，首项 name + link_status 合法 JSON
  ```
- **通过标准**：`.skills` 数组非空，`link_status` 含 codex/claude/cursor/trae 的 global/project 布尔值。

### Task 3 (A3)：`secrets list/audit --json`（只读）

- **验证目标**：secrets 只读结构化输出，**不触发交互式解密**（防子进程挂起）。
- **测试用例**：
  ```bash
  AIWS_JSON=1 .ai-workspace/scripts/aiws secrets list 2>/dev/null
  # 预期：{"secrets":[],"vault_ready":false,...}（未初始化时）
  AIWS_JSON=1 .ai-workspace/scripts/aiws secrets audit 2>/dev/null | jq .
  # 预期：{"tools":[{"tool":"codex","allowed":[]},...]}
  ```
- **通过标准**：命令立即返回（不等待输入）；JSON 含 `vault_ready` / `tools` 字段。

### Task 4 (B1)：脚手架 + 入口 + 导航

- **验证目标**：`runAiws` 能定位 git root 并执行 aiws；App 六个 tab 可切换。
- **自动化用例**：
  ```bash
  cd tui && node --test test/aiws.test.js
  # 预期：runAiws(['--version']) code=0 且 stdout 匹配 /v0\.1\.0/
  ```
- **手动用例**：
  ```bash
  cd tui && npm run tui
  # 预期：顶部标题 + 六个 tab 底栏；按 1-6 切换页面；按 q 退出
  ```
- **通过标准**：单测 PASS；手动能进界面、能切换、能退出。

### Task 5 (B2)：数据获取 hooks（三态错误）

- **验证目标**：`parseResult` 正确解析 `--json` 输出，失败/非 JSON 给 `{error}`。
- **自动化用例**：
  ```bash
  cd tui && node --test test/json.test.js
  # 预期：成功 JSON → {data}；{error,exit_code} → {error}；非 JSON → error 含"解析失败"
  ```
- **通过标准**：三个断言全 PASS。

### Task 6 (C1)：仪表盘页

- **验证目标**：四张工具状态卡 + 技能/MCP 计数 + 一键同步/验证。
- **手动用例**：
  ```bash
  cd tui && npm run tui   # 默认即仪表盘（tab 1）
  # 预期：Cursor/Trae/Claude/Codex 四卡；技能/MCP 计数非 0
  # 按 s：显示同步日志；按 v：显示 validate 输出；按 r：刷新
  ```
- **通过标准**：卡片渲染、计数非 0、`s`/`v`/`r` 均触发对应输出。

### Task 7 (C2)：规则页（列表 + 装载开关）

- **验证目标**：规则列表显示 ☑/☐，Space 切换装载并自动 sync。
- **手动用例**：
  ```bash
  cd tui && npm run tui   # 按 2 进入规则页
  # 预期：列表显示 ☑/☐（☑ = required:true 已装载）
  # 方向键选中一个领域规则，按 Space：切换 ☑/☐，随后自动 sync
  # 按 f 循环过滤（全部/仅领域/已禁用）；按 r 刷新
  ```
- **通过标准**：切换后 `.cursor/rules/` 对应文件增/删（`required` 变更生效）。

### Task 8 (C3)：MCP 页（列表 + 增删）

- **验证目标**：MCP 列表 + 添加 + 删除确认。
- **手动用例**：
  ```bash
  cd tui && npm run tui   # 按 3 进入 MCP 页
  # 预期：列表显示服务器（name + command）
  # 按 a：进入添加（依次输入 name、command，回车提交）
  # 方向键选中 + 按 d + y：删除
  # 按 r：刷新
  ```
- **通过标准**：添加后 `mcp.json` 出现新 server；删除后消失。

### Task 9 (C4)：技能页（列表 + 详情）

- **验证目标**：技能列表 + 详情（link_status）+ 链接/卸载。
- **手动用例**：
  ```bash
  cd tui && npm run tui   # 按 4 进入技能页
  # 预期：技能列表（25 个）；Enter 看详情 + link_status
  # 详情页按 l：链接；按 u：卸载；q/b：返回
  ```
- **通过标准**：详情显示 link_status；链接/卸载后状态表对应变化。

### Task 10 (C5)：密钥页（只读）

- **验证目标**：vault 状态 + 各工具可用密钥审计，未就绪时给安装指引不崩溃。
- **手动用例**：
  ```bash
  cd tui && npm run tui   # 按 5 进入密钥页
  # 预期：显示 vault_ready 状态；vault 未就绪时黄色提示 + brew install 指引
  # 显示各工具 allowed 密钥列表
  ```
- **通过标准**：页面渲染，无崩溃；未就绪时出现安装指引。

### Task 11 (C6)：生效规则页

- **验证目标**：查看 `.cursor/rules/`、`.trae/rules/` 生成文件的 frontmatter。
- **手动用例**：
  ```bash
  cd tui && npm run tui   # 按 6 进入生效规则页
  # 预期：文件列表；按 t 切换 Cursor/Trae；选中文件显示 frontmatter（globs/alwaysApply）
  ```
- **通过标准**：能列出生成文件并展示 frontmatter。

### Task 12 (C7)：集成测试 + README

- **验证目标**：App 渲染六个 tab 的快照测试。
- **自动化用例**：
  ```bash
  cd tui && npm test
  # 预期：全部 PASS（含 aiws.test.js、json.test.js、screens.test.js）
  ```
- **通过标准**：`screens.test.js` 断言六个 tab 名称均出现。

---

## 第 4 章 Desktop（electron）验证

> 对应实施计划 `docs/superpowers/plans/2026-08-07-desktop-app.md`（20 个 task）。
> 自动化命令在 `electron/` 目录执行；手动走查复用 `electron/ACCEPTANCE.zh-CN.md` 的清单。

### 测试文件 ↔ Task 对照表

| Task | 测试文件 | 验证行为 |
|---|---|---|
| Task 2 | `test/git.test.ts` | 非 git 目录抛 `NotAGitRepo`；返回真实仓库根 |
| Task 3 | `test/config.test.ts` | 缺省配置回退；读 workspace.json；MCP/技能路径映射 |
| Task 4 | `test/workspace.test.ts` | 仓库去重持久化；aiws 脚本存在性检测 |
| Task 5 | `test/rules.test.ts` | 规则列表 + required/domain/globs；开关切换；globs 优先级 |
| Task 6 | `test/mcp.test.ts` | 列表/增删；local 覆盖合并；scope 过滤 |
| Task 7 | `test/skills.test.ts` | 描述读取；链接/卸载 symlink |
| Task 8 | `test/sync.test.ts` | 规则生成 frontmatter；幂等清空；进度行 + MCP 同步 |
| Task 9 | `test/diff.test.ts` | identical；单/多 hunk 增删识别 |
| Task 10 | `test/vault-bridge.test.ts` | 缺 aiws 抛错；执行 --version 桥接 |
| Task 11 | `test/sync-cancel.test.ts` | syncRun 中止后停止产出新行 |
| Task 18 | `test/app.test.tsx` | 无仓库渲染管理页；有仓库渲染侧边栏+tab |

### Task 1：electron 脚手架（打包配置 + 最小窗口）

- **验证目标**：工程能编译启动，弹出窗口。
- **测试用例**：
  ```bash
  cd electron && npm install && npm start
  # 预期：弹出 1120×740 空白窗口，标题 "AI Workspace"，无报错
  ```
- **通过标准**：窗口正常打开，控制台无未捕获异常。

### Task 2：core/errors + core/git

- **验证目标**：错误模型 + git 封装。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/git.test.ts
  # 预期：gitRoot 非 git 目录抛 NotAGitRepo；gitRoot 返回仓库根，全部 PASS
  ```
- **通过标准**：`pass / fail 0`。

### Task 3：core/config

- **验证目标**：workspace.json 加载 + 工具路径映射。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/config.test.ts
  # 预期：缺文件给默认（4 工具、scope=project）；读 workspace.json；路径映射正确
  ```
- **通过标准**：全部 PASS。

### Task 4：core/workspace

- **验证目标**：仓库注册/去重/校验。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/workspace.test.ts
  # 预期：add 非 git 抛 NotAGitRepo；同根去重；assertAiwsInstalled 缺脚本抛 AiwsNotInstalled
  ```
- **手动冒烟**（真实写文件，建议临时仓库）：
  ```bash
  cd electron
  node --import tsx -e "
  const { WorkspaceStore } = require('./src/core/workspace');
  (async () => {
    const store = new WorkspaceStore('/tmp/aiws-repos.json');
    const repo = await store.add('/Users/xuanyi/Documents/AI-management');
    console.log('已注册:', repo);
    console.log('列表:', (await store.load()).map(r => r.path));
  })();"
  ```
- **通过标准**：单测 PASS；冒烟输出含真实仓库路径。

### Task 5：core/rules

- **验证目标**：规则列表 + 装载开关。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/rules.test.ts
  # 预期：listRules 读规则 + required/domain/globs；setRuleRequired 切换回读；ruleGlobs 优先级
  ```
- **手动冒烟**：
  ```bash
  node --import tsx -e "
  const { listRules, setRuleRequired } = require('./src/core/rules');
  (async () => {
    const root = '/Users/xuanyi/Documents/AI-management';
    console.log('规则:', (await listRules(root)).map(r => ({id:r.id, required:r.required})));
    await setRuleRequired(root, 'cursor', 'vue3', true, true);   // 打开
    await setRuleRequired(root, 'cursor', 'vue3', true, false);  // 恢复
    console.log('已切换并恢复 vue3 装载开关');
  })();"
  ```
- **通过标准**：单测 PASS；冒烟能读出规则并切换开关。

### Task 6：core/mcp

- **验证目标**：MCP 列表/增删/合并/scope 过滤。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/mcp.test.ts
  # 预期：listMcp 返回 name+command；addMcp 默认 scope=project；removeMcp；scope 过滤；local 覆盖
  ```
- **通过标准**：全部 PASS。

### Task 7：core/skills

- **验证目标**：技能列表/链接/卸载（symlink）。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/skills.test.ts
  # 预期：listSkills 读描述+linkStatus；linkSkills 建 symlink；unlinkSkills 移除
  ```
- **通过标准**：全部 PASS。

### Task 8：core/sync

- **验证目标**：规则生成 + sync 编排。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/sync.test.ts
  # 预期：generateRuleFiles 生成 .mdc 带 frontmatter；幂等清空陈旧文件；syncRun 产出进度+完成 MCP 同步
  ```
- **手动冒烟**（完整链路，会写真实仓库的生成文件）：
  ```bash
  node --import tsx -e "
  const { syncRun } = require('./src/core/sync');
  (async () => {
    for await (const line of syncRun('/Users/xuanyi/Documents/AI-management')) {
      console.log('[sync]', line);
    }
  })();"
  # 预期：输出"已生成 cursor 规则 N 个"、"已生成 trae 规则 N 个"、"同步完成"
  # 且 .cursor/rules/*.mdc 与 .trae/rules/*.md 已生成
  ```
- **通过标准**：单测 PASS；冒烟输出完整同步链路。

### Task 9：core/diff

- **验证目标**：行级 diff。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/diff.test.ts
  # 预期：identical 相同内容；单/多 hunk 增删识别
  ```
- **手动冒烟**：
  ```bash
  node --import tsx -e "
  const { compareRuleToGenerated } = require('./src/core/diff');
  (async () => {
    const r = await compareRuleToGenerated('/Users/xuanyi/Documents/AI-management', 'cursor', '00-core');
    console.log('identical:', r.diff.identical);
    console.log('hunks:', JSON.stringify(r.diff.hunks).slice(0, 300));
  })();"
  ```
- **通过标准**：单测 PASS；冒烟能对比源文件与生成文件（先 sync 再对比，预期 `identical:false` 属正常，因生成文件含 frontmatter）。

### Task 10：main/IPC 接线

- **验证目标**：全部 invoke handlers + 错误包装 + vault 桥接。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/vault-bridge.test.ts
  # 预期：runAiwsBridge 缺脚本抛 AiwsNotInstalled；执行 --version 桥接成功
  ```
- **手动验证**：
  ```bash
  cd electron && npm start
  # 预期：窗口打开，控制台无未捕获异常
  ```
- **通过标准**：单测 PASS；启动无报错。

### Task 11：长任务进度推送（取消语义）

- **验证目标**：sync 可中止，UI 不阻塞。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/sync-cancel.test.ts
  # 预期：syncRun 中止后停止产出新行（最后一行不是"同步完成"）
  ```
- **通过标准**：全部 PASS。

### Task 12：托盘 + 系统通知

- **验证目标**：托盘菜单（显示窗口/快速同步全部/退出）。
- **手动用例**：
  ```bash
  cd electron && npm start
  # 预期：菜单栏出现托盘图标；右键三项；点"快速同步全部"弹系统通知；点"退出"关闭
  ```
- **通过标准**：托盘可用，通知弹出，退出生效。

### Task 13：App 布局骨架 + 仓库管理页

- **验证目标**：侧边栏 + 内容区 + tab；仓库添加/移除。
- **手动用例**：
  ```bash
  cd electron && npm start
  # 预期：无仓库时显示管理页；输入 /Users/xuanyi/Documents/AI-management 添加后出现在列表
  # 移除仓库 → 从列表消失
  ```
- **通过标准**：仓库增删正常，进入主界面。

### Task 14：仪表盘页

- **验证目标**：状态卡 + 一键同步 + 实时日志。
- **手动用例**：
  ```bash
  cd electron && npm start   # 仪表盘 tab
  # 预期：规则/技能/MCP 计数非 0；点"一键同步"日志逐行滚动，完成后计数刷新
  ```
- **通过标准**：计数非 0，同步日志滚动，完成后刷新。

### Task 15：规则页 + MCP 页

- **验证目标**：规则 Switch + MCP 增删。
- **手动用例**：
  ```bash
  cd electron && npm start
  # 规则页：切一个领域规则开关 → "同步 Cursor 规则"可点 → .cursor/rules/ 对应文件增/删
  # MCP 页：添加测试服务器 → 表格出现新行；删除 → 行消失（用后恢复）
  ```
- **通过标准**：开关生效、MCP 增删生效。

### Task 16：技能页 + 密钥页

- **验证目标**：技能主从布局 + 密钥只读。
- **手动用例**：
  ```bash
  cd electron && npm start
  # 技能页：列表 + 详情 + link 状态表；链接/卸载后状态变化
  # 密钥页：vault 就绪状态 + 各工具可用密钥表（只读）
  ```
- **通过标准**：技能链接状态正确；密钥页只读展示。

### Task 17：差异对比页 + 设置页

- **验证目标**：side-by-side diff + 设置占位。
- **手动用例**：
  ```bash
  cd electron && npm start
  # 差异页：选工具+规则看 diff（增绿删红）；"重新同步"后显示无差异
  # 设置页：语言/通知为界面占位
  ```
- **通过标准**：diff 正确显示增删；重新同步后无差异。

### Task 18：UI 冒烟测试 + README

- **验证目标**：App 渲染（jsdom + testing-library）。
- **自动化用例**：
  ```bash
  cd electron && node --import tsx --test test/app.test.tsx
  # 预期：无仓库渲染"管理仓库"；有仓库渲染侧边栏+tab
  ```
- **通过标准**：全部 PASS。

### Task 19：图标 + 打包 dmg（arm64）

- **验证目标**：产出可安装的 dmg。
- **测试用例**：
  ```bash
  cd electron && npm run dist
  # 预期：electron/release/AI Workspace-0.1.0-arm64.dmg 生成
  ```
- **通过标准**：dmg 生成；双击拖入 /Applications 后启动正常（未配开发者账号时签名为关闭状态，属正常）。

### Task 20：端到端验证 + 收尾

- **验证目标**：全量测试 + 真实仓库逐页走查。
- **测试用例**：
  ```bash
  cd electron && npm test
  # 预期：全部 PASS
  cd electron && npm start
  # 在真实仓库上逐页走查（见 ACCEPTANCE.zh-CN.md §3.2 的 13 项清单）
  ```
- **通过标准**：全量测试绿；走查清单全部通过。

---

## 第 5 章 已知限制与跳过项

以下功能首版未实现或为占位，**验证时不应判定为失败**：

| 限制 | 说明 |
|---|---|
| claude/codex 单文件规则生成 | 首版仅 cursor/trae 逐条生成，claude/codex 规则生成跳过 |
| 设置页语言/通知持久化 | 界面占位，未持久化 |
| 仓库文件夹选择器 | 首版用路径输入框，dialog 选择器延后 |
| 应用图标 / 代码签名 / 公证 | 占位图标；签名需 Apple 开发者账号 |
| 密钥 vault 写操作 | 首版只读（桥接 `aiws secrets --json`），解密/写操作不做 |
| 规则编辑多字段表单 | TUI 首版仅列表+装载开关，Enter 多字段编辑延后 |
| MCP 添加完整表单 | TUI 首版逐字符简化输入 |
| `import rules` | 预留未实现（需反向拆分拼接文件） |

---

## 相关文档

- [总体 Spec](SPEC.md)
- [架构设计](reference/ARCHITECTURE.zh-CN.md)
- [桌面应用验收指导](../electron/ACCEPTANCE.zh-CN.md)
- [TUI README](../tui/README.md)
- [实施计划：TUI](superpowers/plans/2026-08-04-tui.md)
- [实施计划：Desktop](superpowers/plans/2026-08-07-desktop-app.md)
