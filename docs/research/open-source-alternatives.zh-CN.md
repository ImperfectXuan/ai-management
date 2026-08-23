# AI Workspace 开源替代品调研报告

> 调研日期：2026-08-20。所有 star 数、最后推送时间均通过 GitHub API / npm registry 实际核实（快照于 2026-08-20），非二手转述。
> 覆盖范围：规则同步、技能管理、MCP 配置、密钥管理、项目记忆、CLI / 桌面 UI、双向同步。

## 1. 调研结论摘要

**部分覆盖，无直接完整竞品。** 2025–2026 年出现了一批专门做"一份规则同步到所有 AI 工具"的开源工具（glooit、agents-sync、agent-rules-sync、sync-rules 等），规则/技能/MCP 这三个子需求已有多方可替代实现；密钥管理可用 SOPS / age / dotenvx 成熟替代。**但没有任何一个开源项目同时覆盖"规则+技能+MCP+密钥+记忆+双向同步+桌面 UI"的完整组合**——绝大多数竞品是单点 CLI 工具，全部缺少 AI Workspace 的桌面/终端界面、加密 secrets vault 与项目记忆（ADR）能力。规则同步子赛道本身拥挤且全部处于极早期（多数 star < 30），说明该需求真实存在但尚无统治性方案。

---

## 2. 逐项目评估表

| 项目 | 链接 | Star 数量级 | 活跃度 | 覆盖 AI Workspace 的需求 | 主要差距 |
|---|---|---|---|---|---|
| **glooit** | [github.com/nikuscs/glooit](https://github.com/nikuscs/glooit) | ~25 | 活跃（2026-05） | 规则/命令/技能/agent/MCP/hooks/settings 跨 7+ 工具同步；CLI；symlink/transform/glob；npm 月下载 ~8.7k（同类最高） | 无 GUI、无 secrets vault、无项目记忆、无 import 拉取 |
| **a-tokyo/aiworkspace** | [github.com/a-tokyo/aiworkspace](https://github.com/a-tokyo/aiworkspace) | ~19 | 活跃（2026-08） | 中央 `workspace/root-config` 仓库 + 多仓库挂载；skills/MCP 配置；40+ 工具；npm install 钩子 | 无 GUI、无密钥、无记忆；star 极少 |
| **agnostic-ai** | [github.com/Chemaclass/agnostic-ai](https://github.com/Chemaclass/agnostic-ai) | ~10 | 活跃（2026-08） | 单一源 transpile 到 18 目标（含 Trae）；规则+agents+skills+hooks+MCP | Go CLI 单点；无 GUI/密钥/记忆 |
| **agents-sync** | [github.com/googlarz/agents-sync](https://github.com/googlarz/agents-sync) | ~5 | 停更（2026-06） | 规则生成到 11 目标 + 项目 scan + drift 检测 | 无技能/MCP/密钥/UI；已停更 |
| **agent-rules-sync**（守护进程） | [github.com/dhruv-anand-aintech/agent-rules-sync](https://github.com/dhruv-anand-aintech/agent-rules-sync) | ~7 | 活跃（2026-08） | 规则+技能+settings+MCP 全局配置**实时双向**同步 | 无 GUI/密钥/记忆；仅全局用户级 |
| **ai-agent-rules** | [github.com/wpfleger96/ai-agent-rules](https://github.com/wpfleger96/ai-agent-rules) | ~9 | 活跃（2026-08） | 用户级配置 symlink + profile 继承 + 共享 MCP + 技能 | 无 GUI、无项目级 import/密钥 |
| **sync-rules** | [github.com/Jercik/sync-rules](https://github.com/Jercik/sync-rules) | ~0 | 活跃（2026-07） | 中央规则库 → 多项目 glob 分发（含否定 glob） | 仅规则同步 |
| **ai-rules-sync** | [github.com/PanisHandsome/ai-rules-sync](https://github.com/PanisHandsome/ai-rules-sync) | ~118 | 停更（2026-06） | 规则格式互转 + 同步 + scaffold | 仅规则 |
| **rule-porter** | [github.com/nedcodes-ok/rule-porter](https://github.com/nedcodes-ok/rule-porter) | ~12 | 停更（2026-03） | 规则格式**双向转换**（.mdc ↔ AGENTS.md ↔ CLAUDE.md ↔ Copilot） | 仅格式转换 |
| **rulesync** | [github.com/juwonllee2024-dotcom/rulesync](https://github.com/juwonllee2024-dotcom/rulesync) | ~1 | 活跃（2026-08） | 规则 lint + 编译 + 同步（"ESLint for agent rules"） | 仅规则 |
| **agentssync** | [github.com/mrtungdev/agentssync](https://github.com/mrtungdev/agentssync) | ~2 | 停更（2026-03） | symlink 统一 15+ agent 规则文件 | 纯 symlink、无其他能力 |
| **openskills** | [github.com/numman-ali/openskills](https://github.com/numman-ali/openskills) | ~10.7k | 活跃（2026-01） | 跨工具技能加载器（生态最成熟） | 仅技能子需求 |
| **n-skills** | [github.com/numman-ali/n-skills](https://github.com/numman-ali/n-skills) | ~1k | 活跃（2026-07） | 技能插件市场（Claude/Codex/openskills） | 仅技能子需求 |
| **MDA Open Spec** | [github.com/sno-ai/mda](https://github.com/sno-ai/mda) | ~615 | 活跃（2026-05） | 一种 `.mda` 源 → SKILL.md/AGENTS.md/MCP-SERVER.md/CLAUDE.md | 标准/编译而非管理器 |
| **AGENTS.md 标准** | [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md) | ~23.7k | 活跃（2026-03） | 跨工具规则文件标准（原 OpenAI，现 AAIF 托管） | 是标准本身，非工具 |
| **GitHub Spec Kit** | [github.com/github/spec-kit](https://github.com/github/spec-kit) | ~130k | 活跃（2026-08） | spec → plan → task → implement 工作流 | **不覆盖**规则/技能/MCP 跨工具同步 |
| **AWS Kiro** | [aws.amazon.com/kiro](https://aws.amazon.com/) | 商业闭源 | — | spec 驱动 IDE（VS Code 扩展） | 不覆盖同步需求，闭源付费 |
| **Tessl** | [tessl.io](https://tessl.io) | 商业闭源 | — | spec-as-source + Spec Registry | 不覆盖同步需求，闭源 |
| **SOPS** | [github.com/getsops/sops](https://github.com/getsops/sops) | ~22.9k | 活跃 | 加密文件编辑（YAML/JSON/ENV/INI），可入 git | 仅密钥子需求 |
| **age** | [github.com/FiloSottile/age](https://github.com/FiloSottile/age) | ~23.3k | 活跃 | 简单现代加密原语（SOPS 推荐后端） | 仅密钥子需求 |
| **dotenvx** | [github.com/dotenvx/dotenvx](https://github.com/dotenvx/dotenvx) | ~5.7k | 活跃 | 安全 .env 管理 | 仅密钥子需求 |
| **chezmoi** | [github.com/twpayne/chezmoi](https://github.com/twpayne/chezmoi) | ~21.2k | 活跃 | 声明式 dotfiles + 模板 + 内置 age 加密 | 不感知 AI 工具格式 |
| **yadm** | [github.com/yadm-dev/yadm](https://github.com/yadm-dev/yadm) | ~6.4k | 活跃（2026-04） | git 包装 dotfiles + 加密 | 不感知 AI 工具格式 |
| **GNU Stow** | [github.com/aspiers/stow](https://github.com/aspiers/stow) | ~1.1k | 维护 | symlink 农场 | 不感知 AI 工具格式 |

---

## 3. 每个候选项目的详细说明

### 3.1 多 AI 工具配置统一同步类（方向 1，竞争最激烈）

这一类在 2025 年底到 2026 年集中涌现，思路高度一致：**以 AGENTS.md（或独立 rules 目录）为单一事实来源，再生成 / 复制 / symlink 到各工具的原生文件**。差异主要在生成 vs symlink、项目级 vs 用户级、是否额外同步技能/MCP。

**glooit（nikuscs/glooit，~25★，npm 月下载 ~8.7k）** —— 同类中功能最全、实际使用最多的工具。以 `.agents/` 为源 + `glooit.config.ts`（TS 类型安全）声明式配置，`glooit sync` 把规则/命令/技能/agents/MCP/hooks/settings 分发到 Claude Code、Cursor、Codex、OpenCode、Factory、Roo Code/Cline。支持 symlink 模式（改动即时生效）、目录同步、glob、占位符 transform、多文件合并、`validate`/`clean`/`backup` 命令。**差距**：纯 CLI，无桌面/终端 UI，无密钥管理，无项目记忆，无 import 拉取（只有 push）。它是 AI Workspace 最直接的借鉴对象。

**a-tokyo/aiworkspace（~19★）** —— 名字与 AI Workspace 撞名，理念也最接近：一个中央 `workspace/root-config/` 仓库（含 `AGENTS.md`、`.agents/mcp.json`、`.agents/skills/`、per-editor 配置）作为规范层，`npm install` 时把配置镜像/symlink 到每个项目与每个 AI 工具，并装 git hooks 保持同步。有 `skills:add/remove/list` 等技能管理命令，"nearest-wins" 覆盖优先级。支持 40+ 工具。**差距**：无 GUI、无密钥 vault、无记忆，star 极少（19），无独立 CLI 二进制（依赖 npm 脚本）。**它是与本项目定位最接近的开源实现，值得持续跟踪。**

**agnostic-ai（Chemaclass/agnostic-ai，~10★）** —— Go 写的单一事实来源 transpiler，覆盖规则/agents/skills/hooks/MCP，支持 **18 个目标**（含 Trae、Kiro、Zed、Warp、Antigravity 等冷门工具），含 `import` 命令（cursor/claude/codex/gemini…）与 CI drift 门禁，round-trip 字节稳定。**差距**：Go CLI，无 GUI/密钥/记忆。

**agents-sync（googlarz/agents-sync，~5★，已停更）** —— 一次 `init` 生成 11 个上下文文件，附带项目 scan（技术栈/结构/TODO 自动生成）与 drift 检测，可无 API key 运行。无技能/MCP 同步。**不足**：停更于 2026-06，star 极少。

**agent-rules-sync 守护进程（dhruv-anand-aintech，~7★）** —— 唯一主打**实时双向**同步的：以守护进程监视 `~/.claude/CLAUDE.md`、`~/.cursor/rules/global.mdc`、`~/.codex/AGENTS.md`、`~/.gemini/GEMINI.md` 等**用户级全局**路径，~3 秒内互相同步；并同步技能（SKILL.md 目录）、settings/hooks、MCP。**差距**：仅用户级全局，无项目级，无 GUI/密钥/记忆。

**sync-rules（Jercik，~0★）** —— 中央规则库到多项目的 POSIX glob 分发（含 `!` 否定），写 `AGENTS.md` + 含 `@AGENTS.md` 的 `CLAUDE.md`，Unix 哲学 CLI（`--dry-run`/`--porcelain`/`--json`），可链式调用。**差距**：仅规则。

**ai-agent-rules（wpfleger96，~9★）** —— 用户级 AI 配置 symlink 管理器，支持 Claude Code/Goose/Gemini CLI/Codex CLI/Amp，含 profile 继承（default → personal → work）、声明式 Claude 插件管理、共享 MCP 转各工具原生格式、共享技能、备份与安全保护（dry-run/excludes/never-deletes）。**差距**：用户级为主，无 GUI/密钥/记忆。

**rulesync（juwonllee2024-dotcom，~1★）** —— "Agent Rules 的 ESLint 与 Babel"：对规范源做 7 条 AST lint（重复/矛盾规则、危险命令、token 膨胀、密钥泄漏），再编译到 10+ 目标，支持 CI `check`。**差距**：仅规则，且极早期。

**agentssync（mrtungdev，~2★）** —— 用 symlink 把 `CLAUDE.md` 同时链接为 `AGENTS.md`/`.cursorrules`/Copilot 等 15+ 目标。**差距**：纯 symlink，能力最薄。

### 3.2 跨工具标准与格式转换（方向 2）

**AGENTS.md 标准（agentsmd/agents.md，~23.7k★）** —— 2025 年由 OpenAI 提出（最初服务于 Codex CLI），现由 Agentic AI Foundation（AAIF，Linux Foundation 下）托管，是当下**唯一被广泛接受的跨工具规则文件标准**。经核实：Cursor 原生读取 AGENTS.md 并已**弃用 `.cursorrules`**；Codex CLI 原生读取；GitHub Copilot 支持；Gemini CLI 默认读 `GEMINI.md` 但可通过 `settings.json` 指向 AGENTS.md；Claude Code 原生只读 `CLAUDE.md`，官方推荐用一行 `@AGENTS.md` import 或 symlink 桥接。AAIF 的 benchmark（2026-07）显示 AGENTS.md 平均省 ~27% 耗时、~24% credits。**对本项目含义**：规范层以 AGENTS.md 为事实来源、CLAUDE.md 作薄覆盖层，正是当前社区共识（nexus-agents issue #3446 详述了 symlink / import+overlay / 生成+CI drift 三种机制）。AI Workspace 的 `AGENTS.md` + `CLAUDE.md` 双文件设计与该共识一致，方向正确。

**格式转换器** —— 已出现专门做 `.mdc ↔ AGENTS.md ↔ CLAUDE.md ↔ Copilot` 双向转换的工具：**rule-porter**（nedcodes-ok，~12★，零依赖、lossy 转换显式警告、`--dry-run`）、**agents-md-migrate**（把 .cursorrules/.mdc/CLAUDE.md 自动合成为 AGENTS.md，幂等）、**MDA Open Spec**（sno-ai/mda，~615★，一种 `.mda` 源编译为 SKILL.md/AGENTS.md/MCP-SERVER.md/CLAUDE.md，JSON Schema 校验）。这些验证了"格式转换"是真实需求，但它们是**转换器而非管理器**——不处理双向 diff、密钥、UI。

### 3.3 规范驱动 / 配置驱动开发（方向 3）—— 非竞品

**GitHub Spec Kit（github/spec-kit，~130k★）** —— 本方向最主流（MIT，2025-09 发布，2026-08 仍活跃），工作流是 `/specify → /plan → /tasks → /implement`，agent-agnostic，跨 30+ agent。**它做的是"spec → 任务生成"，与"规则/技能/MCP 跨工具同步"是两个正交问题**，不覆盖 AI Workspace 的任何同步需求。**AWS Kiro**（2026-05 发布，取代 Amazon Q Developer，闭源付费 IDE）与 **Tessl**（Snyk 创始人创立，闭源，spec-as-source + Spec Registry）同理。三者均非竞品，但说明"规范层作为单一事实来源"的**理念**与本项目一致，可作为方法论借鉴。

### 3.4 密钥管理（方向 4）—— 可成熟替代"secrets vault"子需求

**SOPS（getsops/sops，~22.9k★，MPL-2.0）** —— 最接近"加密密钥 vault"的开源答案：对 YAML/JSON/ENV/INI/二进制只加密叶子值，可安全入 git，支持 KMS/age/PGP 多主密钥。**age（FiloSottile/age，~23.3k★）** —— SOPS 推荐的后端，简单现代，无配置。**dotenvx（dotenvx/dotenvx，~5.7k★）** —— 安全 .env 工作流。**结论**：若 AI Workspace 的 secrets vault 目标只是"加密存储 + 权限 + 入 git"，SOPS+age 组合是成熟、社区验证过的替代；本项目若保留此模块，差异化应在于**与 AI 工具适配层集成**（如 MCP 密钥按工具注入、与 sync 联动），而非重复实现加密原语。

### 3.5 dotfiles / 配置管理通用方案（方向 5）—— 能力边界评估

**chezmoi（twpayne/chezmoi，~21.2k★）** —— 声明式源状态 + Go 模板 + 内置 age/GPG/密码管理器加密 + 跨平台，是通用"规范层 + 模板 + 加密 + 同步"里最成熟的工具。**能力边界**：它管理的是 `$HOME` 下的任意文件，**不感知 AI 工具格式**（不知道 CLAUDE.md/AGENTS.md/.mdc 的语义），因此可作为底层通用机制借鉴（模板、加密、diff 预览），但不能直接替代 AI 工具适配层。**yadm**（yadm-dev/yadm，~6.4k★，git 包装 + 加密）与 **GNU Stow**（aspiers/stow，~1.1k★，symlink 农场）能力更弱。**结论**：方向 5 覆盖"规则文件统一管理"的**通用**部分，但缺 AI 工具语义，不构成直接替代。

### 3.6 其他直接竞品 / 技能生态（方向 6）

**技能管理生态（重要补充）**：openskills（numman-ali/openskills，~10.7k★，"Universal skills loader for AI coding agents"）+ n-skills（numman-ali/n-skills，~1k★，技能市场）是技能子需求上**最成熟的开源生态**，远超前述任何 sync 工具。若 AI Workspace 的 skills 模块要跟社区接轨，兼容 openskills 的 `SKILL.md` 约定是低成本选择。

**直接竞品检索**：除 a-tokyo/aiworkspace 外，未发现名字类似、做"中央规则库 + 多工具挂载"且成熟的开源实现。glooit 是功能上最接近的，a-tokyo/aiworkspace 是定位上最接近的。二者与 AI Workspace 都处于同一早期阶段（star < 30），尚无统治性项目。

---

## 4. 结论与建议

**AI Workspace 仍有存在价值，但需重新定位差异化。** 具体判断：

1. **规则同步子需求已商品化**：glooit / agents-sync / agnostic-ai / sync-rules 已覆盖"一份规则 → 多工具"，且 AGENTS.md 正成为事实标准。仅凭"同步规则"不足以构成护城河。

2. **AI Workspace 目前真正的差异化点**（均无开源竞品覆盖）：
   - **一体化**：规则 + 技能 + MCP + 密钥 + 记忆（ADR/context/decisions）+ 双向同步（import 拉取）在单一工具内闭环——所有竞品都是单点工具。
   - **桌面 / 终端 UI**：glooit、agents-sync 等全部是纯 CLI；本项目的 Electron 桌面管理应用（规则页/技能页/MCP 页/差异对比/一键同步/实时日志）是独有体验。
   - **加密 secrets vault 与 AI 适配层联动**：SOPS 等可替代加密原语，但"为 AI 工具按需注入密钥 + 与 sync 联动"的集成没有现成方案。
   - **项目记忆（ADR/context/decisions）**：整个竞品光谱中无人涉及。
   - **Trae 等中文生态工具适配**：仅 rulesmgr/agnostic-ai 提及 Trae，本项目原生支持。

3. **建议的借鉴方向**：
   - 规范层对齐 **AGENTS.md 标准**（agentsmd/agents.md）的共识做法——AGENTS.md 作事实来源 + CLAUDE.md 薄覆盖，避免自造格式。
   - skills 模块考虑兼容 **openskills / n-skills** 的 `SKILL.md` 约定，借力其 10k+ star 生态，而非另立标准。
   - 密钥存储可直接 **复用 SOPS / age**（成熟、社区验证），把精力放在"按工具注入 + 权限 + 与 sync 联动"的上层集成。
   - 密切关注 **a-tokyo/aiworkspace**（定位最接近）与 **glooit**（功能最接近）的演进，二者可能向"一体化 + UI"方向靠拢，届时是直接竞争。

**一句话结论**：无开源项目覆盖 AI Workspace 的全部需求；规则同步子需求已有成熟可替代品，但"一体化 + 双向同步 + 加密 vault + 桌面 UI + 项目记忆"的组合仍无人做，AI Workspace 应把叙事从"跨工具规则同步"升级为"AI 编码工具的规范层管理平台"。
