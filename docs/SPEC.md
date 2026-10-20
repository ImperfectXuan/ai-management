# AI Workspace — 总体需求规格

> 文档角色：SDD 总体需求基线；整理日期：2026-10-10。
> 来源：既有项目规格、功能盘点与进度记录；本次整理未重新执行功能验收。
> 本文定义预期行为，设计见 [架构](reference/ARCHITECTURE.md)，实现边界见 [能力盘点](FEATURE_BREAKDOWN.md)，任务与验证入口见 [追踪矩阵](TRACEABILITY.md)。

## 1. 定位与目标

AI Workspace 在项目仓库中为规则、技能、MCP 配置、密钥、项目记忆和工作区配置提供统一维护入口，再分发到 Claude Code、Codex、Cursor、Trae 的原生格式。

目标用户是使用多个 AI 编码工具的开发者与项目维护者。要解决的问题是重复维护规则、工具切换丢失上下文，以及原生配置与规范源之间的漂移。

成功标准：维护者能完成“初始化 → 维护规范源 → 同步 → 校验 → 导入存量配置”的闭环，且每个行为都能按本规格的验收条件验证。

## 2. 范围与交付物

| 交付物 | 用户入口 | 预期范围 |
|---|---|---|
| CLI | `.ai-workspace/scripts/aiws` | 规范源管理、同步、导入、校验、记忆、规则追踪与自动化安装 |
| TUI | `tui/` | 仪表盘、规则、MCP、技能、密钥只读审计、生效规则 |
| Desktop | `electron/` | macOS 多仓库管理、同步进度与取消、规则、MCP、技能、密钥只读、差异对比 |

三端共享 `.ai-workspace/` 数据契约；不要求所有端具备相同功能。Desktop 的同步范围与 CLI 存在差异，验收时按设计文档的端差异执行。

暂不纳入当前基线：规则编辑器、GUI 密钥写入、规则集市场、团队密钥共享、跨项目模板与完整配置迁移器。此类候选项见 [路线图](../ROADMAP.md) 和能力盘点；进入实施前需建立功能规格。

## 3. 功能需求与验收条件

以下 ID 是稳定的引用入口，不表示对应能力已在三端完成或已通过本轮验收。

### REQ-SETUP：工作区初始化与配置

适用端：CLI；Desktop 读取工作区配置。

- 维护者能够初始化工作区所需目录和默认配置，选择启用的工具与分发 scope。
- **AC-SETUP-01**：在临时 Git 仓库执行 setup 后，结构与默认配置可被 validate 接受。
- **AC-SETUP-02**：启用工具列表与模块开关影响 CLI 同步范围；关闭模块有明确跳过提示。

### REQ-RULES：规则管理与工具适配

适用端：CLI；TUI / Desktop 提供规则列表与逐文件工具的装载设置。

- 规则存放于规范源，由 adapter mapping 与规则元数据决定生成内容与装载语义。
- **AC-RULES-01**：CLI 同步能为四个工具生成对应原生规则；Cursor / Trae 按条生成，Claude / Codex 为单文件。
- **AC-RULES-02**：`tools` 限定适用工具；缺省适用全部工具；不存在的 mapping 来源不得凭空生成。
- **AC-RULES-03**：Cursor / Trae 的 `required` 映射为 `alwaysApply`；`false` 允许按 glob 装载，不等于删除规则文件。

### REQ-SKILLS：技能安装与分发

适用端：CLI / TUI / Desktop；具体操作选择范围见能力盘点。

- 维护者能够列出、安装、链接与解除链接技能；管理目标与用户自有目标区分处理。
- **AC-SKILLS-01**：可按工具与 scope 操作技能，列表区分 managed / conflict / missing。
- **AC-SKILLS-02**：链接或卸载不得静默破坏非管理目标；跨平台按 symlink / junction / copy 策略处理并验证结果。
- **AC-SKILLS-03**：CLI 从已支持的 GitHub / npm / 本地来源安装，重名与已有管理链接按既有保护策略处理。

### REQ-MCP：MCP 配置管理

适用端：CLI / TUI / Desktop；CLI 是密钥替换验收入口。

- 可维护服务器定义，将主配置与本地覆盖合并，并按 scope 分发为工具原生 JSON 或 TOML。
- **AC-MCP-01**：增删后列表与详情一致；本地同名配置按覆盖规则生效。
- **AC-MCP-02**：project / global 分发只包含适用服务器；生成文件不携带内部 scope 字段。
- **AC-MCP-03**：CLI 同步正确处理 `${secret:XXX}` 引用；缺值或权限不足给出可诊断结果。不能以 Desktop MCP 同步代替此项验收。

### REQ-SECRETS：密钥保护与授权

适用端：CLI 读写；TUI / Desktop 只读列表与审计。

- 敏感值由 age 加密保管库保存，并通过既有 TOTP 与工具授权机制控制访问。
- **AC-SECRETS-01**：具备依赖时可初始化、设置、列出名称、删除及审计；失败返回可诊断结果。
- **AC-SECRETS-02**：可提交的 MCP 规范配置使用占位符；只读界面不展示明文值；验收日志不包含密钥。

### REQ-MEMORY：项目知识与上下文

适用端：CLI；TUI / Desktop 记忆管理不在当前基线内。

- 按 ADR / context / decisions 分类维护记忆，context 随 CLI 规则同步注入工具入口。
- **AC-MEMORY-01**：可 list / new / show；ADR 编号递增，模板和元数据接受校验。
- **AC-MEMORY-02**：CLI 为 Claude / Codex 注入单文件头部，为 Cursor / Trae 生成 `00-context`；上下文变更纳入漂移检测。

### REQ-SYNC：同步范围与生成文件保护

适用端：CLI 完整流程；TUI 经 CLI 发起；Desktop 按当前设计范围同步。

- 同步读取规范源，生成工具文件；CLI 支持单工具、单 scope 与单模块操作。
- **AC-SYNC-01**：CLI `--tool` / `--scope` / `--only` 正确限定操作，重复执行没有非预期变化。
- **AC-SYNC-02**：生成过程按既有备份策略保护非预期文件，用户能区分生成内容与规范源。
- **AC-SYNC-03**：Desktop 显示同步进度，取消后停止后续阶段；当前未实现的阶段明确显示或记录边界，不能宣称等同 CLI 全量同步。

持久化同步状态的拟议扩展见 [功能 002](specs/002-sync-status/spec.md)：以用户已选定的统一内容库和独立应用项目为基础，分别记录工具/模块/scope 的成功来源版本。方案方向已选定，工程细则为草案；不能据本文链接宣称已实现或通过验收。

### REQ-IMPORT：反向收编存量内容

适用端：CLI。

- 支持从工具原生 MCP、技能与规则反向导入规范源，保护已经纳管或同名内容。
- **AC-IMPORT-01**：`--from` 限定来源；`--dry-run` 不修改目标；正式导入按约定备份与去重。
- **AC-IMPORT-02**：Cursor / Trae 逐条转换，Claude / Codex 整文件导入；规则 mapping 登记幂等；global 规则导入明确拒绝。

### REQ-VALIDATE：配置校验与漂移检测

适用端：CLI。

- 校验工作区结构、配置、规则与记忆元数据，以及规范源与生成文件的漂移。
- **AC-VALIDATE-01**：无效配置或元数据给出明确错误；有效工作区返回成功退出码。
- **AC-VALIDATE-02**：生成文件被修改时识别漂移；CLI 重新同步后对应漂移检查恢复通过。

### REQ-AUTOMATION：Git 与 CI 集成

适用端：CLI 安装器、Git hooks、GitHub Actions。

- 提交前可拦截不一致配置；推送触发规则同步；规则变化有可追踪记录。
- **AC-AUTOMATION-01**：hooks / CI 安装与卸载遵循管理标记与目标保护约定；pre-commit 拦截漂移。
- **AC-AUTOMATION-02**：CI 按既有仓库忽略策略提交同步结果，避免自动提交回环。
- **AC-AUTOMATION-03**：`rules status/history` 可查询变化；无变化同步不新增规则日志；manifest 不被当作某个工具已完成验收的证据。

### REQ-TUI：终端交互

适用端：TUI。

- 提供六页导航与业务操作结果展示，密钥保持只读。
- **AC-TUI-01**：页面可导航，列表与操作结果对应规范源或 CLI 输出；装载开关写入所选工具 mapping。
- **AC-TUI-02**：技能 scope 选择有效，CLI 调用失败可被识别；完整表单与规则编辑等延后项不作为首版验收通过条件。

### REQ-DESKTOP：多仓库桌面管理

适用端：Desktop（macOS）。

- 支持仓库注册、切换与持久化，提供八页管理界面、差异对比、托盘和打包交付。
- **AC-DESKTOP-01**：同一 Git 根目录重复添加不重复注册；切换后操作作用于所选仓库。
- **AC-DESKTOP-02**：规则 / MCP / 技能操作结果可回读，diff 展示规范与生成内容的差异；密钥界面只读。
- **AC-DESKTOP-03**：托盘操作与 macOS arm64 打包按桌面验收指南验证；未完成签名、公证与设置持久化不被误报为已支持。

## 4. 非功能要求

| ID | 要求 | 验证方向 |
|---|---|---|
| NFR-SOURCE | `.ai-workspace/` 是规则、技能、MCP、记忆与工作区配置的规范源；生成入口不手工维护 | 修改规范源后同步；检查生成输出与漂移检测 |
| NFR-SECURITY | 敏感值不进入可提交规范配置或验收日志；GUI 只读视图不暴露明文 | 密钥与 MCP 场景验收、人工检查日志 |
| NFR-COMPAT | 共享文件契约须兼容既有内容；端与平台差异明确记录 | CLI / TS 对照测试；Windows 真机验证另行记录 |
| NFR-FAILURE | 系统边界失败可诊断，不把失败或未执行误报为成功 | 无效输入、缺依赖、权限与取消场景 |

## 5. 验证与变更控制

[TRACEABILITY.md](TRACEABILITY.md) 建立需求到设计、任务与验证方法的关系。通过测试说明只能找到验证方法；是否已完成查 [PROGRESS.md](PROGRESS.md) 的版本证据。新功能遵循 [SDD.md](SDD.md)，从 [功能规格模板](specs/TEMPLATE.md) 开始。

本轮仅整理文档，不修改实现、不补写虚构测试结果。存量需求的细粒度任务与验收执行记录尚未全部回填，缺口在追踪矩阵中明确保留。
