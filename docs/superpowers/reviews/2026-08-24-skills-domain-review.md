# Code Review — 技能业务域

**日期**：2026-08-24
**范围**：技能（Skills）业务域全链路
**审查者**：TRAE（静态审查 + 代码走查）
**关联**：[FEATURE_BREAKDOWN.md §2](./../FEATURE_BREAKDOWN.md) · [SPEC.md §技能](./../SPEC.md) · [2026-08-04-tui-design.md](./../specs/2026-08-04-tui-design.md)

---

## 0. 审查范围

按 `FEATURE_BREAKDOWN.md` 中的 Skills 业务域定义，覆盖以下实现：

| 层 | 文件 | 状态 |
|---|---|---|
| CLI | `.ai-workspace/scripts/lib/skills-link.sh` | ✅ |
| CLI | `.ai-workspace/scripts/lib/import-skills.sh` | ✅（辅助阅读） |
| CLI | `.ai-workspace/scripts/aiws` | ✅（节选） |
| CLI 公共 | `.ai-workspace/scripts/lib/common.sh` | ✅（节选） |
| CLI 跨平台 | `.ai-workspace/scripts/lib/platform.sh` | ✅ |
| Desktop core | `electron/src/core/skills.ts` | ✅ |
| Desktop IPC | `electron/src/main/ipc.ts` | ✅ |
| Desktop renderer | `electron/src/renderer/pages/skills.tsx` | ✅ |
| TUI | `tui/src/screens/skills.jsx` | ✅ |
| TUI lib | `tui/src/lib/aiws.js` | ✅（节选） |
| 测试 | `electron/test/skills.test.ts` | ✅ |
| 测试文档 | `docs/TESTING.md` | ✅（节选） |

**未审查**：
- 各技能正文内容（`.ai-workspace/skills/*/SKILL.md`）本身的写作质量
- 市场 / 编辑器等 `FEATURE_BREAKDOWN` 已标记为未实现的能力

---

## 1. 作者意图推断

Skills 域当前的设计目标很清晰：

1. `.ai-workspace/skills/<name>/SKILL.md` 作为单一事实来源
2. CLI 提供 `list / link / unlink / install / import`
3. TUI / Desktop 展示技能列表与 link 状态，并触发链接 / 解除链接
4. 分发时优先使用 symlink，Windows 退化到 junction / copy
5. 允许从 GitHub、npm、本地路径安装技能

其中，`FEATURE_BREAKDOWN.md` 已明确把以下能力标为 **已实现**：

- 技能列表 + 同步状态展示
- 全量链接（global / project）
- 跨平台 symlink（macOS/Linux symlink、Windows junction、复制回退）
- 从 GitHub / npm / 本地路径安装
- 按 scope 解除链接

因此本次 review 的重点不是“有没有最小实现”，而是“代码是否真的支撑这些已宣称能力”。

---

## 2. 验证方法

- 静态阅读 CLI / TUI / Desktop / core 全链路实现
- 对照 `FEATURE_BREAKDOWN.md`、`SPEC.md`、TUI/Desktop 设计文档核对能力边界
- 运行现有自动化测试：`electron/test/skills.test.ts`

**测试结果**

- ✅ `electron/test/skills.test.ts`：3/3 通过
- ⚠️ 未发现 TUI `skills` 专项自动化测试

这说明当前有基础回归保护，但覆盖面主要集中在 Desktop core 的“最小 happy path”。

---

## 3. 审查结果（按严重度排序）

### Major（6 项，建议优先修复）

| No. | 类别 | Issue | 建议 | 代码位置 |
|---|---|---|---|---|
| 1 | 正确性 / UX | **TUI / Desktop 在“单个技能详情页”里执行的其实是“全量技能链接/卸载”**。TUI 在选中某个技能后按 `l/u`，实际调用 `aiws skills link/unlink global`，会影响全部技能；Desktop 也是在某个技能详情页点击按钮，但实际调用的是 bulk API。用户看到的是“操作当前技能”，系统执行的是“操作所有技能”。 | 二选一：A. 把 UI 明确改成“全部技能链接/全部技能卸载”；B. 新增按技能名的 link/unlink API，详情页只操作当前技能。就当前界面语义，推荐 B。 | `tui/src/screens/skills.jsx:21-27`，`electron/src/renderer/pages/skills.tsx:16-24`，`electron/src/core/skills.ts:42-83` |
| 2 | 规格不符 | **TUI / Desktop 的已交付能力低于文档宣称。** TUI 只支持 `global`，没有 `project`；Desktop 只支持 Cursor，且只提供 `project` 卸载，没有 `global` 卸载，也没有其它工具切换。`FEATURE_BREAKDOWN.md` 把 Skills 域在 TUI / Desktop 标为 ✅，并把 `global / project link` 与 `scope unlink` 标为 ✅，当前实现达不到这个结论。 | 统一端能力矩阵：至少补齐 `tool + scope` 选择；如果不打算补齐，必须先回调文档状态到 🟡。 | `tui/src/screens/skills.jsx:21-27,49`，`electron/src/renderer/pages/skills.tsx:18,23,53-55` |
| 3 | 数据安全 | **链接/卸载会无条件删除目标路径，未校验是否为 AI Workspace 管理对象，也无 `.bak` 备份。** CLI 的 `create_link()` 先 `remove_link()`，Desktop core 直接 `fs.rm(..., force: true)`。如果工具目录里已有同名但非 AIWS 管理的技能，会被直接删掉。 | 建立“只处理已管理目标”的白名单规则：先校验 link target 是否指回 workspace；不匹配时重命名为 `.bak`（带时间戳）并显式告警。 | `.ai-workspace/scripts/lib/platform.sh:57-71,131-165`，`.ai-workspace/scripts/lib/skills-link.sh:96-103,166-168`，`electron/src/core/skills.ts:55-58,76-79` |
| 4 | 跨平台 | **Desktop core 没有实现文档宣称的 Windows junction / copy 回退。** CLI 有 `platform.sh` 兜底，但 Electron 直接 `fs.symlink(..., 'dir')`。这意味着 Desktop 的 Skills 链接能力在 Windows 上并不等价于 CLI。 | 把 Desktop core 的链接策略与 CLI 对齐，抽一层跨平台 link helper，至少覆盖 `symlink / junction / copy`。 | `electron/src/core/skills.ts:52-58` |
| 5 | 正确性 | **`aiws skills install <source>` 不能正确识别大多数 npm 包名。** 当前只有 `@*|!*` 才走 npm 分支；像 `openskills`、`n-skills` 这类普通包名会被当作 GitHub shorthand，变成 `https://github.com/openskills.git`。这与“支持 npm 安装”的宣称不符。 | 调整 source 识别顺序：先判断本地路径 / URL / git，再尝试 `npm view` 或 `npm pack --dry-run` 检测 npm 包；最后才回退到 GitHub shorthand。 | `.ai-workspace/scripts/lib/skills-link.sh:276-292` |
| 6 | 正确性 / 原子性 | **`skills install` 对同名目标没有冲突处理，直接 `cp -r` 会导致覆盖语义不清甚至目录嵌套。** 已存在同名技能时，安装结果依赖底层 `cp` 行为，不可预测。 | 安装前显式检测目标目录：存在则报错或先备份；复制使用临时目录 + `mv` 原子替换。 | `.ai-workspace/scripts/lib/skills-link.sh:325-330,373-374,396-401` |

### Minor（3 项，建议纳入下个迭代）

| No. | 类别 | Issue | 建议 | 代码位置 |
|---|---|---|---|---|
| 7 | 状态准确性 | `skills list` 和 Desktop `listSkills()` 对 link 状态基本只做“路径存在”判断，不验证目标是否真的指回 workspace skill。目录里放了同名普通文件夹，也会被显示为“已链接”。 | 统一用 `verify_link` / `readlink + realpath` 校验真实来源；把“存在但不归 AIWS 管理”显示成冲突态。 | `.ai-workspace/scripts/lib/skills-link.sh:195-201,244-249`，`electron/src/core/skills.ts:30-35` |
| 8 | 配置一致性 | `FEATURE_BREAKDOWN.md` 把 `skills.enabled` 写成“sync 阶段校验已完成”，但 CLI `sync` 这里只判断 `skills` 目录是否存在，没有读取模块开关。 | 在 `load_workspace_config()` 基础上补 `skills.enabled` 判断；关闭时输出明确 skip 原因。 | `.ai-workspace/scripts/aiws:192-197`，`.ai-workspace/scripts/lib/common.sh:276-308` |
| 9 | 测试覆盖 | TUI 没有 `skills` 专项测试，当前风险点（详情页 bulk 操作、scope 能力缺口、消息文案）都没有自动化保护。 | 增加 TUI `skills` 交互测试；Desktop 也应补“不会误删未管理目标”的回归用例。 | `tui/test/`（缺失），`electron/test/skills.test.ts`（覆盖不足） |

---

## 4. 优点（建议保留）

- ✅ CLI 的 `platform.sh` 已经把跨平台 link 抽象出来了，修 Desktop 可以直接复用同一套策略
- ✅ `import-skills.sh` 对“已管理 symlink / 已存在技能”的处理思路是对的，说明项目里已经有“不要覆盖用户内容”的设计意识
- ✅ `skills list --json` / `Desktop listSkills()` 的数据形态已经足够稳定，后续加工具 / scope 选择器不用推翻模型

---

## 5. 修复优先级建议

### P0 — 先止血

1. 修复“详情页操作实际影响全部技能”的误导行为
2. 给 link / unlink / install 加目标冲突保护和 `.bak` 备份
3. 修正 npm source 识别，避免 `skills install` 误走 GitHub

### P1 — 补齐已宣称能力

1. TUI 补 `project` scope
2. Desktop 补 `tool + scope` 选择，支持 global/project link 与 unlink
3. Desktop 接入 Windows junction / copy 回退

### P2 — 提升可观测性和回归质量

1. 真实校验 linkStatus，不再用“存在即已链接”
2. 接通 `skills.enabled` 配置开关
3. 增加 TUI / Desktop 回归测试

---

## 6. 结论

**结论：Skills 域的 CLI 基础能力是有的，但当前 TUI / Desktop 与文档声明之间存在明显落差；同时 link/install 的目标冲突保护不足，已经触及“可能误删用户内容”的级别。**

如果按 `FEATURE_BREAKDOWN.md` 的口径评估，我会给出：

- CLI：🟡（接近可用，但 install 和安全性还有硬伤）
- TUI：🟡（能看、能触发，但行为与界面语义不一致，且 scope 能力不足）
- Desktop：🟡（基础页面已成型，但跨平台与能力覆盖未达到 ✅）

也就是说，**当前更接近“部分实现”，还不适合把 Skills 域整体标成三端全绿。**
