# AI Workspace 个人用户操作手册

> 适用范围：本地个人使用，优先 CLI + TUI，Desktop 为辅助界面。依据当前 v0.1.0 源码整理，更新日期：2026-10-10。
> 验证范围：2026-10-10 在临时仓库完成 20 项操作检查（首次复制、setup、备份、规则导入、记忆创建、MCP 同步、技能安装 / 链接 / 解链和 TUI 项目定位）；未验证 GUI 交互与真实 vault 加解密。
> 本手册介绍日常操作；测试验收请阅读 [人工测试手册](../manual-testing/README.md)，产品边界请阅读 [总体需求规格](../SPEC.md)。

## 1. 先理解两个目录

- **应用源码目录**：本项目所在位置，包含 CLI、TUI、Desktop 的代码，用来安装和启动界面。
- **目标项目目录**：你实际写代码的 Git 仓库。在其中维护 `.ai-workspace/`，同步影响这个项目及你明确选择的全局工具目录。

如果你只是管理本项目自身，两者可以相同；管理其他项目时必须区分。命令中的工具名使用 `codex` / `claude` / `cursor` / `trae`。

日常修改 `.ai-workspace/` 中的规范源，再运行同步。`AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`、`.trae/rules/` 是生成内容，不在其中直接维护规则。

## 2. 首次准备

### 2.1 确认环境

在终端检查：

```bash
git --version
jq --version
command -v shasum
node --version
npm --version
```

CLI 需要 Git、Shell、jq；规则追踪需要哈希工具（macOS 有 shasum）。TUI / Desktop 还需要 Node.js 与 npm。2026-10-10 的本机验证使用 Node.js 24.16.0；项目尚未声明 Node engines，其他版本应先确认构建与测试可运行。

macOS 如果缺少 jq，已有 Homebrew 时可运行 `brew install jq`。只使用规则、技能和不含密钥引用的 MCP 配置时，可以暂不配置 vault。密钥功能另需 age 与 oathtool，见第 7 节。Desktop 当前交付目标是 macOS。

### 2.2 设定目录

以下示例假定本项目已下载到本机。把 `AIWS_PROJECT` 换成你的业务项目绝对路径；源码移动后也要更新 `AIWS_SOURCE`。

```bash
AIWS_SOURCE="/Users/xuanyi/Documents/AI-management"
AIWS_PROJECT="/绝对路径/你的项目"

# 进入目标项目，检查它确实是你要管理的仓库
cd "$AIWS_PROJECT"
git rev-parse --show-toplevel
git status --short
```

如果不是 Git 仓库，先在确认的项目根目录运行 `git init`。输出的 Git 根目录应当等于目标项目；如果指向上级仓库，请先确定实际纳管范围。

后续 CLI 命令都在目标项目根目录运行，不能在源码目录中代替执行。变量仅在当前终端会话有效。

### 2.3 首次安装规范源

目标项目已有 `.ai-workspace/` 时，跳过本节复制步骤，直接检查它的 CLI 版本并继续配置。以下复制脚本遇到已有目录会停止，避免覆盖原有内容。

```bash
(
  set -e
  cd "$AIWS_PROJECT"
  if [ -e .ai-workspace ]; then
    printf '%s\n' '目标项目已有 .ai-workspace，请跳过复制步骤。'
    exit 1
  fi

  mkdir -p .ai-workspace/rules/domains
  cp -R "$AIWS_SOURCE/.ai-workspace/scripts" \
        "$AIWS_SOURCE/.ai-workspace/adapters" .ai-workspace/
  cp "$AIWS_SOURCE"/.ai-workspace/rules/[0-9][0-9]-*.md .ai-workspace/rules/
  cp "$AIWS_SOURCE"/.ai-workspace/rules/domains/*.md .ai-workspace/rules/domains/

  for category in adr context decisions; do
    mkdir -p ".ai-workspace/memory/$category"
    cp "$AIWS_SOURCE/.ai-workspace/memory/$category/TEMPLATE.md" \
       ".ai-workspace/memory/$category/TEMPLATE.md"
  done
)
```

这里只复制程序、适配器、规则和记忆模板。MCP 配置、vault、技能与项目上下文在目标项目中自行建立，不把源码仓库的个人配置整份搬过去。复制的规则也需按自己的语言、项目约定和偏好调整。

复制完成后：

```bash
cd "$AIWS_PROJECT"
AIWS="$AIWS_PROJECT/.ai-workspace/scripts/aiws"
"$AIWS" --version
"$AIWS" setup
```

出现 `Initialize secrets vault? [y/N]` 时，初次上手输入 `n`。setup 补齐目录与默认配置，也会尝试安装 pre-commit 校验钩子；已有其他钩子时不会覆盖，应按提示自行合并。

### 2.4 选择工具并设置忽略项

用编辑器打开 `.ai-workspace/config/workspace.json`。首次建议保留默认四工具，先验证完整流程：

```json
{
  "version": "1.0",
  "tools": ["codex", "claude", "cursor", "trae"],
  "default_scope": "project"
}
```

熟悉流程后可将 `tools` 缩减为自己使用的工具。但当前漂移检查仍可能检查未启用的 Cursor / Trae；出现缺失告警时按第 9 节处理，不将它误判为已启用工具同步失败。

**仍需在同步命令中明确写 `--scope project`。** 当前完整 sync 未指定 scope 时会尝试 project 与 global，不要依赖 `default_scope` 阻止全局写入。规则领域的 `scope: csharp` 等不是此处的分发位置。

把以下模式合并到目标项目的 `.gitignore`，保留已有内容：

```gitignore
.ai-workspace/mcp/mcp.local.json
.ai-workspace/secrets/.vault-key.age
.ai-workspace/secrets/.vault-salt
.ai-workspace/secrets/.vault-totp
*.bak
```

如果选择本地重新生成工具配置，也将实际生成的规则、MCP 配置和技能链接路径加入忽略项。Codex 使用 `.codex/config.toml`，Claude 使用 `.mcp.json`，Cursor / Trae 使用各自目录内的 MCP 文件。含真实密钥的生成配置必须排除提交。

## 3. 收编已有配置，再做首次同步

### 3.1 备份工具原生文件

首次 sync 可能覆盖原有规则或 MCP 内容。先备份目标项目的现有入口；示例备份存于临时目录，长期保存时转移到你自己的备份位置。

```bash
cd "$AIWS_PROJECT"
AIWS_BACKUP="$(mktemp -d /tmp/aiws-before-sync.XXXXXX)"
for entry in AGENTS.md CLAUDE.md .mcp.json .codex .cursor .trae .agents; do
  if [ -e "$entry" ]; then
    cp -R "$entry" "$AIWS_BACKUP/"
  fi
done
printf '备份位置：%s\n' "$AIWS_BACKUP"
```

备份可能包含敏感配置，不提交或分享。只使用 project scope 时，此备份覆盖项目内容；需要修改 global 时，另行备份对应全局工具目录。

### 3.2 预览与导入

以下以 Cursor 的项目配置为例；没有相应内容时显示未发现可导入项是正常的。

```bash
"$AIWS" import rules --from cursor --scope project --dry-run
"$AIWS" import skills --from cursor --scope project --dry-run
"$AIWS" import mcp --from cursor --scope project --dry-run
```

核对来源与冲突信息后，执行需要的正式导入：

```bash
"$AIWS" import rules --from cursor --scope project
"$AIWS" import skills --from cursor --scope project
"$AIWS" import mcp --from cursor --scope project
```

按命令提示确认。Claude / Codex 的单文件规则导入可以用 `--as` 命名，例如：

```bash
"$AIWS" import rules --from claude --scope project --as project-rules
```

规则导入只支持 project scope；Skills / MCP 可以明确选择 global。已纳管生成文件、已管理链接或同名内容可能被跳过，导入不等于覆盖更新。同名规范内容需自行核对；不要为了导入而直接删除生成标记。

导入 MCP 后检查 `.ai-workspace/mcp/mcp.json`：原生配置可能含明文凭据，提交前应迁移为密钥引用或留在本地覆盖中。

### 3.3 第一次只同步规则

```bash
"$AIWS" sync --only rules
"$AIWS" validate --drift-strict
```

规则生成到项目内，启用的 Codex / Claude 会得到 `AGENTS.md` / `CLAUDE.md`，Cursor / Trae 得到逐条规则文件。有 context 时，CLI 也会把它写入对应入口。

通过校验后，继续需要的模块：

```bash
"$AIWS" sync --only mcp --scope project
"$AIWS" sync --only skills --scope project
"$AIWS" validate --drift-strict
```

MCP 同步负责写配置，不负责安装或启动服务器；技能链接成功也不代表 AI 工具已经加载。重新打开或刷新对应工具，检查配置与技能是否被识别，并做一次实际调用。

## 4. 日常维护规则与项目记忆

### 4.1 修改规则

用编辑器修改 `.ai-workspace/rules/*.md` 或 `rules/domains/*.md`，保留 frontmatter。新增规则需在要使用的 `adapters/<tool>/mapping.yaml` 中登记来源。

```yaml
- source: rules/domains/my-project.md
  required: false
```

Cursor / Trae 的 `required: true` 表示始终装载，`false` 表示按 glob 装载，**不是删除或禁用**。只让某些工具生成该规则时，在规则 frontmatter 增加 `tools: [codex, cursor]`。详细语义见 [架构说明](../reference/ARCHITECTURE.md)。

修改后：

```bash
"$AIWS" rules status
"$AIWS" sync --only rules
"$AIWS" validate --drift-strict
```

`rules status` 返回 1 表示有未同步变化，通常是刚修改规则后的正常状态；返回 2 才表示环境错误。只有提交过规则，`rules history <规则ID>` 才能查询 Git 历史。单工具同步也会更新规范源快照，因此 status 变干净不能证明其他工具已同步。

### 4.2 维护项目记忆

```bash
"$AIWS" memory new --type context --title "项目概况"
"$AIWS" memory new --type adr --title "选择文件作为配置存储"
"$AIWS" memory new --type decisions --title "优先使用项目级技能"
"$AIWS" memory list
```

按命令输出的路径编辑新建文件：context 写项目背景，ADR 写真实架构决策，decisions 写决策日志。模板不会代你填写业务内容。

context 编辑完成后执行规则同步与校验即可分发；ADR 和 decisions 不会自动作为 context 注入。新项目没有模板时，从安装章节复制对应 TEMPLATE.md。Desktop 尚未接入 context 同步，使用 CLI。

## 5. 管理 MCP 与技能

### 5.1 MCP 配置

```bash
"$AIWS" mcp list
"$AIWS" mcp show <服务器名称>
"$AIWS" mcp add <服务器名称> <可执行命令> [参数...]
```

后两条是命令格式，执行前替换尖括号参数；不要把占位文字直接粘贴到终端。CLI 添加的服务器默认使用 project scope。

如需修改现有服务器的 args、env 或 scope，用编辑器维护 `.ai-workspace/mcp/mcp.json`。同名服务器的本机路径等差异写入 `mcp.local.json`，结构同样包含 `servers`，本地同名内容覆盖主配置。

修改后执行 `"$AIWS" sync --only mcp --scope project`。删除服务器使用 `"$AIWS" mcp remove <服务器名称>`，再同步，并检查工具端配置是否仍残留；当前实现不能把“同步完成”直接等同于所有旧条目都已删除。服务器启动失败时，应检查可执行命令、参数、依赖和工具日志。

### 5.2 技能安装、链接与卸载

```bash
# 选择你实际已有的技能目录（包含 SKILL.md）
"$AIWS" skills install /绝对路径/技能目录
"$AIWS" skills list

# 替换 my-skill 为安装后的目录名，只操作 Cursor 项目目录
"$AIWS" skills link project cursor my-skill
"$AIWS" skills unlink project cursor my-skill
```

`install` 把技能纳入规范源，`link` 让工具访问该源，`unlink` 解除工具侧链接，不删除规范源技能。也可用 `skills link project` 为启用工具批量链接；省略 scope 的 link 默认 global，应明确指定。

列表状态：managed 表示已管理；missing 表示未链接；conflict 表示同名非管理内容。遇到 conflict 先核对原内容和备份，再决定是否替换，不要直接删除原目录。

TUI 支持选中单个技能、切换 scope，但链接操作面向启用工具集合；需要只操作一个工具时使用上述 CLI，或 Desktop 的工具 Tab。

## 6. 使用 TUI 管理目标项目

先在源码目录安装依赖并构建一次：

```bash
cd "$AIWS_SOURCE/tui"
npm ci
npm run build
```

然后**回到目标项目**，运行源码目录中的已构建入口：

```bash
cd "$AIWS_PROJECT"
node "$AIWS_SOURCE/tui/dist/index.js"
```

TUI 按当前工作目录寻找 Git 根目录。若在源码 `tui/` 中运行 `npm run tui`，管理的是源码仓库自身。重新开终端时先重新设置路径变量；更新 TUI 源码后需重新构建。

- `1` 仪表盘：`s` 完整同步，`v` 校验，结束后显示日志。
- `2` 规则：方向键选中，`t` 切换 Cursor / Trae，Space 切换装载并自动同步。建议在全部规则列表操作；切换动作可能连带执行所选工具的 MCP / 技能同步。
- `3` MCP：`a` 添加，`d` 后按 `y` 确认删除，`r` 刷新；复杂字段用编辑器维护。
- `4` 技能：方向键选择，Enter 查看详情，`s` 切换 global / project，`l` 链接，`u` 卸载，Esc 返回列表。
- `5` 密钥：查看状态与权限审计，不支持写入明文值。
- `6` 生效规则：`t` 切换 Cursor / Trae，查看生成文件元数据。
- `q` 退出应用；页内操作参考实际提示。底栏虽显示 `? 帮助`，当前尚未实现独立帮助界面。

首次进入技能详情默认 global，项目操作先按 `s` 切到 project。仪表盘 `s` 和规则页自动同步没有限制 scope，可能涉及全局配置；只想修改项目时，用 CLI 的 `--scope project`，规则文本修改用 `--only rules`。

## 7. 可选：管理密钥

本项目的真实 vault 链路仍需单独验证。先在临时项目按 [密钥操作与验证步骤](../manual-testing/05-secrets.md) 走通，不直接把未验证流程用于唯一的真实凭据副本。

macOS 已有 Homebrew 时可安装依赖：

```bash
brew install age oath-toolkit
```

随后在已确认的目标项目运行 setup，选择 `y`，按提示设置主口令与认证器 TOTP，再使用交互输入保存值：

```bash
"$AIWS" setup
"$AIWS" secrets set MY_SERVICE_TOKEN
"$AIWS" secrets list
"$AIWS" secrets audit
```

在 MCP 配置中使用 `${secret:MY_SERVICE_TOKEN}`，按 `.ai-workspace/secrets/permissions.yaml` 现有格式授权需要的工具，再用 CLI 同步。不要把真实值作为命令行参数或粘贴进可提交的主配置。

`.vault-key.age`、`.vault-salt`、`.vault-totp` 是本地恢复材料，应排除提交并妥善备份；仅备份 `vault.enc` 不足以保证恢复。同步后的工具原生 MCP 配置可能包含明文值，也须排除提交。TUI / Desktop 只读页面不能代替解密与密钥写操作。

## 8. 可选：使用 Desktop

在源码目录运行：

```bash
cd "$AIWS_SOURCE/electron"
npm ci
npm start
```

在“管理仓库”添加已经安装 `.ai-workspace/` 的目标项目，切换到它后再操作规则、MCP、技能或 diff。移除仓库只是取消注册，不会删除项目文件。

当前 Desktop：可管理多个仓库，支持 Cursor / Trae 规则、MCP 和独立技能链接；批量同步尚未包含 Claude / Codex 单文件规则、memory context、技能全量链接和 CLI 密钥替换。取消是停止后续阶段，不回滚已经写入的内容；同步结果仍需 CLI 校验。

2026-10-10 的检查发现类型检查未通过、打包资源缺少托盘图标且 DMG 未生成，安装版还需验证。个人使用可从源码启动试用；完整同步继续用 CLI。详见 [Desktop README](../../electron/README.md)。

## 9. 故障处理与恢复

### 找不到 aiws 或目标项目错了

回到目标项目，检查 Git 根目录，再重设 CLI 路径：

```bash
cd "$AIWS_PROJECT"
git rev-parse --show-toplevel
AIWS="$AIWS_PROJECT/.ai-workspace/scripts/aiws"
"$AIWS" --version
```

Permission denied 时检查文件执行权限；确认是自己的 CLI 文件后可运行 `chmod +x "$AIWS"`。缺 jq 时先补依赖。Node / Electron 启动失败先看终端输出，不把构建成功当作 GUI 已可用。

### 校验失败或提交被钩子拦截

先检查错误对应的规范源；JSON 错误修复 JSON，mapping 缺来源修复登记。只有生成文件漂移时，运行规则同步再校验：

```bash
"$AIWS" sync --only rules
"$AIWS" validate --drift-strict
```

如果只启用部分工具，却收到未启用 Cursor / Trae 的 `DRIFT (missing)`，这是当前校验范围的限制。可单独为提示的工具执行 `"$AIWS" sync --only rules --tool trae`（或 cursor），再校验；此操作只在项目内生成该工具的规则，不会链接技能或同步 MCP。若不希望生成未用工具的文件，保留这项已知告警，普通 validate 会按警告处理，不能宣称严格漂移检查已通过。

若你在生成文件中写了需要保留的新规则，先备份并迁移到规范源，再同步。validate 不启动 MCP，也不证明 AI 工具已经加载配置。`--strict` 会把警告也当失败，`--drift-strict` 只强化漂移判定。

### 同步后内容不符合预期

1. 暂停继续同步，确认项目、工具与 scope，查看刚才的日志。
2. 从 Git 或首次备份中恢复出错的规范文件，保留其他未提交改动。
3. 规则重新生成；MCP 核对本地覆盖，并检查工具端旧配置；技能核对实际链接位置。
4. 重新执行对应模块同步与校验，再刷新 AI 工具验证。

`.bak` 是局部保护，不是完整项目快照；当前没有通用回滚命令。需要恢复原生文件时从已核对的备份中选择性恢复，不做整仓库重置。

### 移动项目、更新程序或停止使用

移动项目之前解除原项目的 global 技能链接，移动后从新路径重新链接；否则旧链接可能指向失效位置。TUI 重新设置目录变量，Desktop 更新仓库注册路径。

升级前备份 `.ai-workspace/` 与原生配置。只替换程序所需文件，适配器变化单独比较合并，保留自己的规则、技能、记忆、配置与 vault；当前没有自动升级或配置迁移命令。

停止使用时先解除该项目管理的技能链接，再运行 `"$AIWS" hooks uninstall` 移除管理钩子；只有此前装过 CI 自动同步时才需要 `"$AIWS" ci uninstall`。确认链接不再依赖规范源后，自行决定保留或删除规范目录，删除前保留备份。

## 10. 每次修改后的最小检查

1. 确认当前是目标项目，修改的是规范源。
2. 规则执行 `sync --only rules`；MCP / 技能明确指定 `--scope project`，只有确实要全局安装时使用 global。
3. 执行 `validate --drift-strict`，检查日志中的失败、跳过和警告。
4. 在实际 AI 工具中确认规则、服务器或技能可用。
5. 提交前检查 Git diff 与忽略项，确认没有凭据、备份或不应提交的生成配置。

更多资料：[文档索引](../README.md)、[FAQ](../reference/FAQ.md)、[TUI README](../../tui/README.md)、[人工验收手册](../manual-testing/README.md)。
