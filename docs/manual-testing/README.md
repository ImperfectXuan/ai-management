# AI Workspace — 人工系统测试手册

> 这是一套**面向人工测试者**的逐步验收手册。读者只需具备基础的软件工程概念（会开终端、会跑命令、能看懂「预期结果」），无需读懂源码。
>
> 目标：照着本手册，**从零把项目跑起来**，再**按功能切面逐项测试**，最终达到**上线验收标准**。

---

## 1. 这套手册测什么

AI Workspace（`aiws`）是一个嵌在 git 仓库里的「单一事实来源」基础设施：你在 `.ai-workspace/` 里维护一次规则、技能、MCP、密钥、项目记忆，再由 `aiws sync` 自动分发到 4 个 AI 编码工具（Claude Code / Codex / Cursor / Trae）。

本项目有**三个交付物**，共享同一份事实来源：

| 交付物 | 形态 | 入口 | 定位 |
|---|---|---|---|
| **CLI** | 终端命令 | `.ai-workspace/scripts/aiws` | 唯一业务逻辑引擎（本手册核心） |
| **TUI** | 终端交互界面 | `cd tui && npm run tui` | 薄壳调用 CLI 的 6 页界面 |
| **Desktop** | macOS 桌面应用 | `cd electron && npm start` | 独立多仓库管理应用（8 页） |

**测试顺序**：先测 CLI（引擎正确了，界面才有意义），再测 TUI、Desktop，最后跑自动化回归做最终确认。

---

## 2. 如何阅读本系列

按编号顺序执行即可，每篇是独立的「功能切面」：

| 篇 | 切面 | 内容 | 是否写文件 |
|---|---|---|---|
| [00-environment.md](00-environment.md) | 环境准备 | 装依赖、定位 CLI、临时仓库约定 | 否 |
| [01-cli-basics.md](01-cli-basics.md) | CLI 基础 + setup + validate | 版本/帮助/全局选项、初始化、校验 | setup 会建目录 |
| [02-rules.md](02-rules.md) | 规则 | 列表/装载开关/tools 过滤/版本化 | 开关会写 mapping |
| [03-skills.md](03-skills.md) | 技能 | list/link/unlink/install | link/install 写文件 |
| [04-mcp.md](04-mcp.md) | MCP | list/add/remove/show/scope | add/remove 写 mcp.json |
| [05-secrets.md](05-secrets.md) | 密钥 | vault 初始化/set/list/remove/audit | init/set 写 vault |
| [06-memory.md](06-memory.md) | 记忆 | list/new/show + context 注入 | new 写 memory |
| [07-sync.md](07-sync.md) | 正向同步 | 三阶段 + --tool/--scope/--only + 漂移 | 生成工具原生文件 |
| [08-import.md](08-import.md) | 反向导入 | import mcp/skills/rules | 写规范层 |
| [09-ci-hooks.md](09-ci-hooks.md) | CI + 钩子 | ci install、pre-commit 钩子 | 写 .github/ 与 .git/hooks |
| [10-tui.md](10-tui.md) | TUI 界面 | 6 页逐页走查 | 部分操作写文件 |
| [11-desktop.md](11-desktop.md) | Desktop 界面 | 8 页走查 + dmg 打包 | 部分操作写文件 |
| [12-acceptance.md](12-acceptance.md) | 回归 + 验收 | 自动化套件 + 上线验收清单 | 否 |

---

## 3. 环境要求速览

| 依赖 | 版本 | 用途 |
|---|---|---|
| macOS | — | Desktop 应用仅支持 macOS |
| Node.js | ≥ 18（推荐 20+） | TUI / Desktop |
| git | 任意 | CLI 定位仓库根、版本化 |
| jq | 任意 | 解析 JSON / YAML（**必需**） |
| shasum 或 sha256sum | macOS 自带 `shasum` | 规则版本化哈希 |
| age + oathtool | 仅测密钥时 | vault 加密 + 2FA |

详细安装步骤见 [00-environment.md](00-environment.md)。

---

## 4. 通用判定约定

每个测试步骤都给出**命令 → 预期结果 → 判定**。判定统一用以下符号：

- ✅ **通过**：输出与「预期」一致，退出码符合约定。
- ⚠️ **警告**：命令成功但输出里出现 `[WARN]`（通常是漂移/未初始化等非阻断问题）。
- ❌ **失败**：输出 `[ERROR]`、或退出码非 0、或与预期不符。

**退出码约定**（写脚本/自动化时有用）：

| 命令 | 0 | 1 | 2 |
|---|---|---|---|
| `aiws validate` | 通过（可能有 warning） | 有 error | — |
| `aiws rules status` | 规则与 manifest 一致 | 有差异 | 环境错误（如无 manifest） |
| `aiws sync` / 其他命令 | 成功 | 失败 | — |

---

## 5. 重要：写操作的测试位置

本手册**大量命令会真实写文件**（生成工具原生文件、改 `mcp.json`、建 vault、建 symlink）。按风险分两档：

| 风险 | 命令示例 | 建议位置 |
|---|---|---|
| **只读**（安全） | `--version`、`--help`、`validate`、`mcp list`、`skills list`、`rules status`、`secrets audit` | 直接在本仓库跑 |
| **写文件** | `sync`、`mcp add/remove`、`skills link/install`、`secrets set`、`memory new` | 优先临时仓库；或在本仓库跑后用 `git checkout` 回滚 |

临时仓库搭建方法（详见 [00-environment.md §4](00-environment.md)）：

```bash
TMP=$(mktemp -d /tmp/aiws-test.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
```

> 本仓库本身就是 git 仓库，`aiws sync` 生成的 `AGENTS.md`/`CLAUDE.md`/`.cursor/`/`.trae/` 等都是它**本来的日常产物**。在本仓库上跑 `sync` 属于正常使用，测完用 `git status` 查看改动、`git checkout -- .` 回滚即可。只有 `secrets`（vault）、`skills install`、`mcp add/remove` 这类「改规范层」的操作，才强烈建议在临时仓库做。

---

## 6. 上线验收标准速查

全部功能测试完成后，对照 [12-acceptance.md](12-acceptance.md) 的清单逐项打勾。核心门槛：

1. ✅ 环境依赖齐备（node / jq / git / shasum），`$AIWS --version` 正常。
2. ✅ `aiws setup` + `aiws validate` 通过（无 `[ERROR]`）。
3. ✅ 规则 / 技能 / MCP / 密钥 / 记忆 五个业务域命令全部按预期工作。
4. ✅ `aiws sync` 三阶段生成正确的工具原生文件，重复 sync 幂等。
5. ✅ `aiws import`（mcp/skills/rules）反向导入 + 去重 + 备份正常。
6. ✅ CI 工作流与 pre-commit 钩子安装成功、拦截漂移生效。
7. ✅ TUI 六页、Desktop 八页逐页走查通过。
8. ✅ 自动化回归套件全绿（`tui` 19 用例 + `electron` 65 用例 + shell 套件）。

---

## 7. 相关文档

- [项目总体 Spec](../SPEC.md)
- [功能面拆解](../FEATURE_BREAKDOWN.md)
- [按 task 的自动化测试指导](../TESTING.md)（本手册的互补：偏自动化用例）
- [文档索引](../README.md)
