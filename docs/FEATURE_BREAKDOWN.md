# AI Workspace — 功能面拆解（按业务域）

> 目的：把当前实现按业务域组织，**不区分 CLI / TUI / Desktop 三端**（每域用"端覆盖"小列标注）。
> 阅读对象：维护者、贡献者、规划下一阶段功能时快速对照边界。
>
> 与现有文档的关系：
> - 总体定位 → [SPEC.md](./SPEC.md)
> - 系统分层与数据流 → [reference/ARCHITECTURE.md](./reference/ARCHITECTURE.md)
> - 设计权衡 → [reference/DESIGN_PHILOSOPHY.md](./reference/DESIGN_PHILOSOPHY.md)
> - 阶段计划 → [../ROADMAP.md](../ROADMAP.md)
> - 变更记录 → [../CHANGELOG.md](../CHANGELOG.md)

---

## 0. 状态图例

- ✅ **已实现** — 三端中至少一端可跑通且具备测试
- 🟡 **部分实现** — 有最小可用版本，但有明确未完成项
- ❌ **未实现** — 文档/Roadmap 提及但当前未交付

端覆盖列：`C` = CLI（`aiws`）· `T` = TUI（Ink）· `D` = Desktop（Electron）

---

## 1. 业务域：规则（Rules）

**职责**：维护工具无关的 Markdown 规范规则，YAML frontmatter + 主体内容；按 `mapping.yaml` 选择性包含，按 `scope` 字段按需装载。

**事实来源**：`rules/00-core.md` ~ `07-conversation-style.md`（8 条核心）+ `rules/domains/*.md`（6 条领域：aspnet / vue3 / winforms / wpf / karpathy-behavioral / global-workflow）。

**端覆盖**：C ✅ · T ✅ · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 规则解析（YAML frontmatter + body） | ✅ | core 层 `rules.ts`、CLI `rules-generate.sh` |
| 列表 / 装载开关 | ✅ | TUI rules 屏、Desktop rules 页面；`setRuleRequired` 写入 `mapping.yaml` |
| mapping 驱动的选择性包含 | ✅ | Phase 1 已完成；`required: true/false` 驱动 |
| 按 `scope` 字段过滤（all / csharp / vue …） | ✅ | 工具原生文件生成阶段生效 |
| 按 `tools` 字段过滤 | ✅ | 2026-09-07 三端落地（内联/块列表，缺省全工具，与 mapping AND） |
| 规则编辑视图（多字段表单） | ❌ | TUI/Desktop 延后项 |
| 规则反向导入（`aiws import rules`） | ✅ | cursor/trae 逐条转换、claude/codex 整文件导入 |
| 规则版本化 / 变更追踪 | ✅ | sha256 manifest + 自动 CHANGELOG + `rules status/history` |

**边界与契约**：
- 输入：`rules/*.md`、`rules/domains/*.md`、`adapters/{tool}/mapping.yaml`
- 输出：各工具根层文件（`CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `.trae/rules.md`）
- 禁止：规范层写工具特定规则；手动编辑生成文件

**TODO**
- [ ] 规则编辑视图（TUI 多字段表单 + Desktop 详情面板）

---

## 2. 业务域：技能（Skills）

**职责**：跨工具技能定义（`SKILL.md` + 资源文件）；通过 symlink / junction / 复制 三种模式分发到各工具。

**事实来源**：`.ai-workspace/skills/<name>/`，当前 25 个技能。

**端覆盖**：C ✅ · T ✅ · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 技能列表 + 同步状态展示 | ✅ | `skills list --json`、TUI skills 屏、Desktop skills 页面 |
| 全量链接（global / project） | ✅ | `aiws skills link [scope]`、Desktop 链接按钮 |
| 跨平台 symlink（macOS/Linux symlink、Windows junction、复制回退） | ✅ | `skills-link.sh` |
| 从 GitHub / npm / 本地路径安装 | ✅ | `aiws skills install <source>` |
| 按 scope 解除链接 | ✅ | `skills unlink`、Desktop 解链 |
| 逐工具逐 scope 细粒度链接 / 卸载 | 🟡 | Roadmap P2 延后项；首版仅 global 快捷 |
| 技能编辑器（写 SKILL.md / frontmatter） | ❌ | 未规划 |
| 技能市场 / 远程仓库浏览 | ❌ | Phase 3 P3 |

**边界与契约**：
- 单一事实来源：`skills/<name>/SKILL.md` + 资源
- 分发不复制（首选 symlink），工具目录仅持有链接
- 已管理的 symlink / 同名技能导入时跳过

**TODO**
- [ ] 实现逐工具 × 逐 scope 细粒度链接面板（TUI + Desktop）
- [ ] 技能 frontmatter 校验（name 唯一、description 必填）
- [ ] 安装源支持 `git+https` / 私有仓库鉴权
- [ ] 技能市场骨架（Phase 3 预留）

---

## 3. 业务域：MCP

**职责**：维护 MCP 服务器配置（`mcp.json` + `mcp.local.json` 本地覆盖）；按 `scope` 字段过滤分发；将 `${secret:XXX}` 占位符替换为实际值；生成各工具原生 JSON / TOML。

**端覆盖**：C ✅ · T ✅ · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 列表 / 详情 / 新增 / 删除 | ✅ | `mcp list/add/remove/show`；TUI mcp 屏；Desktop mcp 页面 |
| `scope` 字段驱动分发 | ✅ | `mcp-sync.sh` 过滤 + 生成 |
| `${secret:XXX}` 占位符替换 | ✅ | 同步阶段与 vault 联调 |
| JSON ↔ TOML 双向转换 | ✅ | Codex 输出 TOML，其余 JSON |
| `mcp.local.json` 本地覆盖（gitignore） | ✅ | 文件机制已建 |
| MCP 添加完整表单（Tab 切换字段） | 🟡 | Roadmap P2 延后；TUI 首版为逐字符输入简化版 |
| MCP 高级字段（env / headers / timeout） | 🟡 | 当前 CLI 仅支持 `command + args`；Desktop IPC 同 |
| MCP 健康检查 / 启动探测 | ❌ | 未规划 |
| 远程 MCP（SSE / Streamable HTTP） | ❌ | 未规划 |

**边界与契约**：
- 主配置 `mcp.json`（可提交）+ `mcp.local.json`（本地覆盖，gitignore）
- `scope: ["global", "project"]` 控制是否分发到对应工具目录
- 密钥绝不写入 `mcp.json`，必须用 `${secret:XXX}` 引用

**TODO**
- [ ] 扩展 schema：`env` / `headers` / `timeout` / `transport`（stdio / sse / streamable-http）
- [ ] TUI 添加完整表单（Tab 字段切换 + 校验）
- [ ] MCP 启动健康检查（`--doctor` 模式）
- [ ] 与配置域的 `mcp.enabled` 开关联动校验

---

## 4. 业务域：密钥（Secrets）

**职责**：以 age 加密 + TOTP 2FA 保护敏感值；按工具粒度授权（`permissions.yaml`）；同步阶段把 `${secret:XXX}` 占位符替换为实际值。

**端覆盖**：C ✅ · T ✅（只读）· D ✅（只读）

| 能力 | 状态 | 备注 |
|---|---|---|
| age 加密 / 解密 | ✅ | `vault.sh` |
| TOTP 2FA | ✅ | `setup` 初始化；`--reset-2fa` 重置 |
| `secrets set / list / remove` | ✅ | CLI 写入能力已具备 |
| 按工具授权（`permissions.yaml`） | ✅ | 同步阶段校验 |
| 审计（哪些工具用了哪些密钥） | ✅ | `secrets audit --json`，TUI / Desktop 只读展示 |
| Desktop / TUI 写入（增删改） | ❌ | Roadmap P2 延后；当前只读 |
| 密钥轮换（rotate） | ❌ | 未规划 |
| 多用户 / 团队共享 vault | ❌ | 未规划 |
| 密钥导入 / 导出（与 1Password 等对接） | ❌ | 未规划 |

**边界与契约**：
- Vault 文件：`secrets/vault.enc`（加密态）
- 权限文件：`secrets/permissions.yaml`
- 任何 CLI / TUI 操作均需 TOTP；同步阶段按工具权限决定是否解密
- Desktop 当前通过 `vault-bridge.ts` 调 shell 桥接，未 TS 化

**TODO**
- [ ] Desktop / TUI 写入界面（增删改，强制 TOTP）
- [ ] vault 核心逻辑从 sh 迁移到 TS（消除 `vault-bridge`）
- [ ] 密钥轮换命令（`secrets rotate <key>`）
- [ ] 审计报告结构化（JSON / Markdown 输出）

---

## 5. 业务域：记忆（Memory）

**职责**：持久化项目知识，分三类 —— ADR（架构决策记录）/ context（项目上下文摘要）/ decisions（技术决策日志）。

**事实来源**：`.ai-workspace/memory/{adr,context,decisions}/`。

**端覆盖**：C ✅ · T ❌ · D ❌

| 能力 | 状态 | 备注 |
|---|---|---|
| 目录约定 + 三套模板初始化 | ✅ | `ensure_workspace_structure` 建目录 + TEMPLATE.md（`ed8c4b3`） |
| `aiws memory` 子命令（list / new / show） | ✅ | `memory.sh`；ADR 编号自增、decisions 追加、标题 `&`/`\` 逐字保留（`3b8a9d5` `bba2293`） |
| context 注入 sync（claude/codex 头部 + cursor/trae 00-context） | ✅ | CLI sync 贯通；00-context 纳入漂移白名单（`319244e`） |
| validate 记忆域校验（模板 / frontmatter / ADR status / decisions 格式） | ✅ | `validate_memory`（`6e9cd46`） |
| Desktop core 规则生成接入 context 注入 | 🟡 | electron `sync.ts` 仅 cursor/trae 逐条生成，未注入 |
| TUI / Desktop 记忆页 | ❌ | 未规划 |

**边界与契约**：
- 文件即事实来源（Markdown + YAML frontmatter）
- 与规则分离：**规则 = 行为约束**；**记忆 = 上下文 / 决策**
- 跨工具上下文保留（任何 AI 工具读取时都能看到）

**TODO**
- [ ] 记忆域代码评审
- [ ] Desktop core 接入 context 注入 + 记忆页（时间线 + 标签筛选）

---

## 6. 业务域：配置（Workspace Config）

**职责**：`config/workspace.json` 控制启用的工具、scope 默认值、各模块开关、密钥 vault 文件名等。

**端覆盖**：C ✅ · T ❌ · D 🟡

| 能力 | 状态 | 备注 |
|---|---|---|
| 配置文件加载 + 合并默认 | ✅ | `common.sh` 加载；core `config.ts` 同样 |
| 工具启用列表（`tools: [...]`） | ✅ | sync 时按列表过滤 |
| `default_scope` 控制 | ✅ | sync 默认分发粒度 |
| `mcp.enabled` / `skills.enabled` / `secrets.enabled` 模块开关 | ✅ | sync 阶段校验 |
| TUI 编辑 workspace.json | ❌ | 未规划 |
| Desktop 设置页可改 | 🟡 | Desktop `settings.tsx` 存在，但具体读写范围需确认 |
| 配置迁移（版本升级） | ❌ | `version: "1.0"` 字段已留，但无迁移器 |

**边界与契约**：
- JSON schema 演进时必须向后兼容
- 任何模块开关被关闭时，sync 应跳过该模块并显式提示

**TODO**
- [ ] 明确 Desktop `settings.tsx` 的读写范围
- [ ] 配置版本迁移器（`migrate-config v1 → v2`）
- [ ] TUI 顶层配置开关面板
- [ ] 校验 `tools` 字段值必须在已知适配器集合内

---

## 7. 横切能力：同步引擎（Sync）

**职责**：把规范层正向同步到各工具原生文件，分三阶段 —— 规则生成 → MCP 同步 → 技能链接。

**端覆盖**：C ✅ · T 🟡 · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 规则生成（按 mapping.yaml） | ✅ | `rules-generate.sh` |
| MCP 同步（scope 过滤 + 占位符替换） | ✅ | `mcp-sync.sh` |
| 技能链接（symlink / junction / 复制） | ✅ | `skills-link.sh` |
| 单工具同步（`--tool T`） | ✅ | CLI + Desktop |
| 单 scope 同步（`--scope S`） | ✅ | CLI |
| 批量同步 + 进度 + 取消 | ✅ | Desktop `syncRun` + AbortController + 系统通知 |
| TUI 一键同步 | 🟡 | Dashboard 屏是否有此能力需复核 |
| 并行同步（多工具并发） | 🟡 | 当前为串行；可优化 |
| 同步前快照 / 回滚 | ❌ | 未规划 |

**TODO**
- [ ] 并行同步（多工具并发，按 `--parallel N` 控制）
- [ ] 同步前备份（生成文件 `.bak`）与回滚命令
- [ ] 同步报告（JSON / Markdown：改了哪些文件、跳过原因）
- [ ] TUI 同步进度条（已用 Desktop IPC 事件，复用到 TUI）

---

## 8. 横切能力：反向导入（Import）

**职责**：从各工具原生文件反向导入到规范层。

**端覆盖**：C ✅（mcp/skills/rules）· T ❌ · D ❌

| 能力 | 状态 | 备注 |
|---|---|---|
| `aiws import mcp`（含 TOML 解析） | ✅ | Codex TOML 支持已实现 |
| `aiws import skills` | ✅ | 已管理 symlink 跳过、同名去重 |
| `aiws import rules` | ✅ | cursor/trae 逐条转换、claude/codex 整文件导入 |
| `--from <tool>` 限定来源 | ✅ | CLI |
| `--dry-run` 预览 | ✅ | CLI |
| 自动备份 | ✅ | 导入前备份现有规范层文件 |
| TUI / Desktop 引导式导入 | ❌ | 未规划 |

**TODO**
- [ ] TUI 导入向导（选工具 → 预览 → 确认）
- [ ] Desktop 导入页面（diff 预览 + 一键应用）

---

## 9. 横切能力：校验（Validate）

**职责**：`aiws validate` 校验工作区结构、配置一致性、YAML frontmatter、必填字段。

**端覆盖**：C ✅ · T 🟡 · D 🟡

| 能力 | 状态 | 备注 |
|---|---|---|
| 工作区结构校验 | ✅ | `validate.sh` |
| 配置一致性（adapter 与 tools 列表） | ✅ | |
| YAML frontmatter 校验 | ✅ | |
| `validate --json` 结构化输出 | 🟡 | Roadmap P1 延后；TUI 仪表盘需要时实现 |
| TUI 仪表盘展示校验结果 | 🟡 | 当前是否展示需复核 |
| Desktop 仪表盘展示校验结果 | 🟡 | 同上 |
| 规则 / 技能死链检测（引用了不存在的 glob / skill） | ❌ | 未规划 |

**TODO**
- [ ] `validate --json` 落地
- [ ] TUI / Desktop 仪表盘接入校验结果
- [ ] 死链检测（rules 引用的 glob 无文件 / skills 互相引用缺失）

---

## 10. 横切能力：适配器（Adapters）

**职责**：把规范层机械翻译为各工具原生格式。每个适配器 ≤ 50 行。

**端覆盖**：所有端均依赖

| 工具 | 状态 | 适配器路径 | 原生输出 |
|---|---|---|---|
| Codex | ✅ | `adapters/codex/` | `AGENTS.md` + `.codex/config.toml`（TOML） |
| Claude Code | ✅ | `adapters/claude/` | `CLAUDE.md` + `.mcp.json` |
| Cursor | ✅ | `adapters/cursor/` | `.cursor/rules/*.mdc` + `.cursor/mcp.json` |
| Trae | ✅ | `adapters/trae/` | `.trae/rules/*.md` + `.trae/mcp.json` |

**TODO**
- [ ] 适配器一致性 CI（自动校验每适配器 ≤ 50 行 / mapping 必填字段齐全）
- [ ] 适配器模板的单元测试（mapping → 预期输出 fixture）

---

## 11. 横切能力：工作区管理（Workspace / 多仓库）

**职责**：管理多个启用 AI Workspace 的仓库（Desktop 端特有），持久化路径列表。

**端覆盖**：C ❌ · T ❌ · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 仓库列表 / 新增 / 删除 | ✅ | `WorkspaceStore`（`core/workspace.ts`） |
| userData 持久化（`repos.json`） | ✅ | Electron `app.getPath('userData')` |
| 当前仓库切换 | ✅ | Desktop 顶部下拉 |
| 仓库健康检查（仍是 git 仓库 / 仍是有效 .ai-workspace） | 🟡 | 待确认 |
| CLI 端仓库列表 | ❌ | 当前 CLI 仅在单仓库 git root 跑 |
| TUI 多仓库视图 | ❌ | 未规划 |

**TODO**
- [ ] 健康检查（路径存在、git 仓库、`.ai-workspace/` 完整）
- [ ] 仓库分组 / 标签
- [ ] CLI 多仓库模式（`aiws --repo <name> sync`）

---

## 12. 横切能力：差异对比（Diff）

**职责**：展示规范层 vs 工具原生生成文件的差异（side-by-side / 行级）。

**端覆盖**：C ❌ · T ❌ · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 行级 diff（规范 vs 生成） | ✅ | `core/diff.ts` |
| Desktop diff 页面 | ✅ | `diff.tsx` |
| TUI diff 视图 | ❌ | 未规划 |
| 多工具对比（一规则 vs 4 工具输出） | ❌ | 未规划 |
| 一键应用建议（"重新 sync 以修复"） | 🟡 | 需确认是否存在 |

**TODO**
- [ ] 多工具 diff 矩阵（1 规则 × N 工具）
- [ ] TUI 嵌入式 diff（关键文件）
- [ ] 差异可导出 Markdown 报告

---

## 13. 横切能力：仪表盘（Dashboard）

**职责**：跨域状态总览 —— 已启用工具数 / 规则数 / MCP 数 / 技能数 / 同步状态 / 校验结果。

**端覆盖**：C ❌ · T ✅ · D ✅

| 能力 | 状态 | 备注 |
|---|---|---|
| 跨域计数 | ✅ | TUI + Desktop |
| 一键同步（可取消 + 进度） | ✅ | Desktop 端完整；TUI 待确认 |
| 同步状态灯（黄/绿） | ✅ | 用户偏好（user_profile.md 提到） |
| 配置行默认展开 | ✅ | 用户偏好（user_profile.md 提到） |
| 校验结果嵌入 | 🟡 | 待确认 |

**TODO**
- [ ] 校验结果内嵌
- [ ] 最近变更时间线（规则 / 技能 / MCP 改动）

---

## 14. 横切能力：错误模型（Errors）

**职责**：统一错误类型 + IPC 序列化 + 错误码 + 用户可读消息。

**端覆盖**：D ✅（`core/errors.ts`）

| 能力 | 状态 | 备注 |
|---|---|---|
| `WorkspaceError` 基类 | ✅ | |
| 错误码（`code`） | ✅ | IPC 返回 `{ ok, code, message }` |
| 错误消息（含上下文） | ✅ | |
| TUI / CLI 错误展示 | 🟡 | CLI exit code + log；TUI 屏内展示待确认 |
| 错误聚合（多步骤同步时收集所有错误再上报） | ❌ | 未规划 |

**TODO**
- [ ] 错误聚合（sync 阶段收集 N 个错误，最后统一报告）
- [ ] 错误码枚举文档（`docs/reference/ERROR_CODES.md`）
- [ ] TUI 错误 Toast / 状态栏展示

---

## 15. 交付与运维

| 项 | 状态 | 备注 |
|---|---|---|
| CLI（`aiws` POSIX sh） | ✅ | 唯一业务逻辑引擎 |
| TUI（Ink + React） | ✅ | 6 页（dashboard / effective / mcp / rules / secrets / skills） |
| Desktop（Electron + React + TS） | ✅ | 8 页（dashboard / diff / mcp / rules / secrets / settings / skills / workspaces） |
| 核心层 TS 重写（`electron/src/core/`） | ✅ | 11 模块 + 12 测试文件 |
| TUI 单元测试（`tui/test/`） | ✅ | 3 文件 |
| CI/CD（推送自动 sync） | ✅ | Phase 2；`aiws ci install` 安装 GitHub Actions 工作流 |
| 跨项目模板提取 | ❌ | Phase 2 P2 |
| 单命令项目初始化脚手架 | ❌ | Phase 2 P3 |
| 精选规则集（语言 / 领域包） | ❌ | Phase 3 P3 |
| 社区贡献模板 | ❌ | Phase 3 P3 |
| 规则集市场 | ❌ | Phase 3 P3 |

---

## 16. 跨域 TODO 汇总（按优先级）

### P0 — 核心完善
- [ ] `mcp.enabled` / `skills.enabled` / `secrets.enabled` 关闭时 sync 的明确提示
- [ ] 错误聚合（sync 多步骤场景）

### P1 — 重要但未达 MVP 后
- [x] ~~ADR / context / decisions 模板落地（记忆域）~~ ✅ 2026-09-03（含 `aiws memory` CLI、sync 注入、validate）
- [ ] `validate --json` 结构化输出
- [ ] MCP schema 扩展（env / headers / timeout / transport）
- [ ] Desktop / TUI 校验结果嵌入仪表盘
- [ ] 死链检测（rules / skills）

### P2 — 有价值、带宽允许时
- [x] ~~规则 `tools` 字段过滤~~ ✅ 2026-09-07
- [ ] TUI / Desktop 逐工具 × 逐 scope 技能链接
- [ ] Desktop / TUI 密钥写入界面
- [ ] TUI 编辑规则（多字段表单）
- [ ] TUI MCP 完整表单
- [ ] 并行同步
- [ ] 同步前快照 / 回滚
- [ ] 同步报告
- [ ] 配置迁移器
- [ ] 适配器一致性 CI

### P3 — 锦上添花
- [ ] 密钥轮换 / 团队共享
- [ ] 技能市场 / 远程仓库
- [ ] 跨项目模板提取
- [ ] 单命令项目脚手架
- [ ] 精选规则集 / 社区模板

---

## 17. 端覆盖矩阵（汇总）

| 业务域 | CLI | TUI | Desktop |
|---|---|---|---|
| 规则 | ✅ | ✅ | ✅ |
| 技能 | ✅ | ✅ | ✅ |
| MCP | ✅ | ✅ | ✅ |
| 密钥 | ✅ 读写 | ✅ 只读 | ✅ 只读 |
| 记忆 | ✅ | ❌ | ❌ |
| 配置 | ✅ | ❌ | 🟡 |
| 同步引擎 | ✅ | 🟡 | ✅ |
| 反向导入 | ✅ mcp/skills/rules | ❌ | ❌ |
| 校验 | ✅ | 🟡 | 🟡 |
| 适配器 | ✅ | 间接 | ✅ |
| 工作区 | ❌ | ❌ | ✅ |
| 差异对比 | ❌ | ❌ | ✅ |
| 仪表盘 | ❌ | ✅ | ✅ |
| 错误模型 | 🟡 | 🟡 | ✅ |

> 矩阵中的"🟡"项需逐项确认实际行为，必要时回填到本表。
