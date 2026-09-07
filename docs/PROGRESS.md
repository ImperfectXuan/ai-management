# 项目进度与目标跟踪

> **本文件用途**：AI Workspace（aiws）项目的唯一进度追踪入口。整合 ROADMAP、域评审报告与实际代码落地状态，后续开发内容在此文档中持续更新。
>
> **更新约定**：每完成一项工作，同步更新对应表格的状态列并文末追加一行变更记录。状态必须以可验证的证据（commit hash 或测试结果）为准，不凭记忆标注。

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
| Phase 1 | 增强：ADR 记忆系统、项目上下文摘要、pre-commit 集成等 | 🔶 进行中 |
| Phase 1.5 | 可视化 TUI（Ink，六页） | ✅ 完成（增强项延后，见 §6） |
| Phase 1.6 | Desktop 独立 macOS 应用（Electron） | ✅ 完成 |
| Phase 2 | 自动化与生态：CI/CD 自动同步、规则版本化 | ✅ 完成（两项核心；模板提取/脚手架见 §6 P3） |
| Phase 3 | 生态：精选规则集、社区模板、市场 | ⬜ 未开始 |

---

## 3. 业务域质量状态

按「评审 → 修复 → 回归验证」的流程逐域推进（流程定义见 [docs/superpowers/reviews/](superpowers/reviews/)）。

| 业务域 | 代码评审 | 修复落地 | 回归验证 | 后续动作 |
|---|---|---|---|---|
| 规则（rules） | ✅ [评审](superpowers/reviews/2026-08-24-rules-domain-review.md) | ✅ `7396f15` `dc44aab` | ✅ [验证指导](superpowers/reviews/2026-08-24-rules-domain-verification.md) + `0c84320` | 无 |
| 技能（skills） | ✅ [评审](superpowers/reviews/2026-08-24-skills-domain-review.md) | ✅ 阶段 A+B+C 完成（见 §4） | ✅ shell 9/9 + electron 61/61 + tui 19/19 | B3 在真实 Windows 环境的手工验证待做 |
| MCP | ⬜ 未评审 | — | — | 排期评审 |
| 密钥保管库（vault） | ⬜ 未评审 | — | — | 排期评审 |
| 双向导入（import） | — | — | ✅ `54d826b` 新增 25 用例 | MCP/vault 属于其依赖域 |
| 记忆（memory） | ⬜ 未评审 | ✅ Task 1-4 落地 `ed8c4b3`→`6e9cd46` | ✅ 记忆域 shell 15 用例（CLI + context 注入 + validate） | 排期评审；TUI/Desktop 记忆页待规划（见 §6 P2） |

---

## 4. 进行中：Skills 域修复计划收尾

计划全文见 [2026-08-24-skills-domain-fix-plan.md](superpowers/reviews/2026-08-24-skills-domain-fix-plan.md)。下表为 2026-08-27 对代码的实际核查结果：

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

| 完成时间 | 内容 | commit |
|---|---|---|
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
- [ ] 按 tools 字段过滤规则
- [ ] Phase 1.5 TUI 延后项：界面内编辑规则、validate --json 结构化输出、secrets 写操作、MCP 完整表单、细粒度 skill 链接
- ~~CI/CD 推送时自动同步~~ ✅ 2026-08-28 完成（`aiws ci install`）

### P3 · 锦上添花
- Phase 2/3 其余项（跨项目模板提取、脚手架单命令初始化、精选规则集、社区模板）

---

## 7. 已知边界与技术债

- **本仓库 CLAUDE.md 的生成标记残留**：头部遗留 `<!-- Generated by AI Workspace -->` 行，导致 `import rules` 将其归为 managed 跳过。如需收编本仓库自身 CLAUDE.md，需先手工删除该标记行。
- **merge-file 导入的 required 语义**：claude/codex 整文件导入一律登记 `required: false`（合并文件没有 alwaysApply 语义），需要常驻装载的工具要手工改 mapping。
- **global scope 导入不做**：各工具全局规则路径未纳入体系，`--scope global` 显式报错拒绝（fail-fast 设计，非遗漏）。
- **跨平台 link 策略漂移风险**：CLI（shell）与 Desktop（TS）各自实现了 symlink/junction 逻辑，未经公共层约束（对应 §4 的 B3 项）。
- **CI 自动提交在本仓库为部分 no-op**：生成文件被 `.gitignore` 忽略（尊重仓库策略，workflow 不 force-add），CI 提交实际入库的是 manifest/CHANGELOG 等版本化文件；对提交生成文件的仓库才会完整回写生成产物。
- **规则哈希按字节计算**：仓库无 `.gitattributes` 换行归一策略，CRLF/换行符差异会记为一次规则变更。
- **manifest 为规范层语义**：部分同步（`--tool X`）同样推进 manifest 快照——快照与工具无关，特判会引入状态分裂。

---

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-03 | 记忆系统落地闭环（任务计划 5/5）：Task1-2 合并入 main 后，续做 Task3-4 —— sync 将 `memory/context` 注入各工具（claude/codex 单文件头部 + cursor/trae `00-context`）、validate 新增记忆域校验；drift-check 沙盒同源加载 memory.sh 使 00-context 参与漂移比对。记忆域 shell 测试扩至 15 用例，全套 shell 套件 83 用例 + TUI 19 + Electron 61 全绿；PROGRESS/ROADMAP 勾掉记忆与项目上下文摘要 |
| 2026-08-28 | Phase 2 两项核心落地：`aiws ci` 工作流安装器（GitHub Actions push 自动同步）、`sync --only` 模块过滤、规则版本化引擎（manifest/CHANGELOG/status/history）；shell 新增 26 用例全绿，三套既有套件回归通过；顺手修复 mcp-sync 错误函数名 |
| 2026-08-27 | 初版建立：整合 ROADMAP、rules/skills 两域评审结论、近期五次提交与 skills 修复计划实测状态 |
