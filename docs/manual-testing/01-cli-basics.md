# 01 · CLI 基础 + setup + validate

> **测试对象**：`aiws` 命令入口、全局选项、初始化（`setup`）、校验（`validate`）。
> **前置**：已完成 [00-environment.md](00-environment.md)，定义好 `$AIWS`。
> **写文件**：`setup` 会补建缺失目录/默认文件、自动装 pre-commit 钩子；`validate` 只读。

---

## 1. 目标

1. 确认 `aiws` 入口、版本、帮助、全局选项可用。
2. 会用 `setup` 初始化一套 `.ai-workspace/`。
3. 会用 `validate` 校验工作区并读懂「通过 / 警告 / 失败」。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management      # 项目根目录
AIWS=./.ai-workspace/scripts/aiws             # 命令简写
```

---

## 3. 版本与帮助

### 步骤 3.1 — 版本号

```bash
$AIWS --version
```

**预期**：`aiws v0.1.0`
**判定**：✅ 版本号正确；❌ 无输出或报错。

### 步骤 3.2 — 帮助信息

```bash
$AIWS --help
```

**预期**：打印 `AI Workspace CLI v0.1.0` 标题，及 `COMMANDS` 列表（`setup / sync / validate / import / mcp / skills / secrets / memory / rules / hooks / ci`）。

**判定**：✅ 各子命令名都出现；❌ 缺项说明入口或脚本异常。

### 步骤 3.3 — 子命令帮助

```bash
$AIWS import --help
$AIWS memory --help
```

**预期**：分别打印 import / memory 的用法与选项。
**判定**：✅ 有用法说明。

---

## 4. 全局选项与调试

### 步骤 4.1 — `--debug`

```bash
$AIWS --debug sync --only rules  2>&1 | grep -E '\[DEBUG\]' | head -3
```

**预期**：出现若干 `[DEBUG]` 行（调试日志）。
**判定**：✅ 有 `[DEBUG]` 输出；若为空说明该路径无 debug 日志，可换 `$AIWS --debug --version` 确认无副作用。

> `--debug` 等价于环境变量 `AIWS_DEBUG=1`。它只影响 stderr 的调试日志，不影响结果。

### 步骤 4.2 — `AIWS_JSON=1`（结构化输出）

`AIWS_JSON=1` 让部分只读命令输出机器可读 JSON，供 TUI 消费：

```bash
AIWS_JSON=1 $AIWS mcp list 2>/dev/null
```

**预期**：`{"servers":[{"name":"filesystem","command":"npx"}, ...]}` 形式的合法 JSON。
**判定**：✅ 输出合法 JSON；❌ 输出文本（说明 `AIWS_JSON` 未生效）。

> 注意：`AIWS_JSON` 只对 `mcp list`、`skills list`、`secrets list`、`secrets audit` 生效，其余命令仍为文本输出。且 `2>/dev/null` 是为了把 `[INFO]/[WARN]` 等日志从 stderr 屏蔽，只留 stdout 的 JSON。

---

## 5. `setup`（初始化）

`setup` 是幂等的：已有目录/文件不会覆盖，只补齐缺失项。在**临时仓库**上做更直观（能看到「从零到有」）：

```bash
TMP=$(mktemp -d /tmp/aiws-setup.XXXXXX)
cd "$TMP" && git init -q
AIWS_TMP=./.ai-workspace/scripts/aiws
# 复制带脚本的 .ai-workspace 以便有 CLI 可跑（真实新项目应通过脚手架获得，这里复用本项目脚本演示）
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
```

### 步骤 5.1 — 运行 setup

```bash
cd "$TMP" && $AIWS_TMP setup
```

**预期**：依次输出
- `[OK] Directory structure created`
- （若缺）`[OK] Created default config` / `[OK] Created default MCP config` / `[OK] Created default permissions`
- `Next steps:` 提示四步
- 最后一行提示 `Initialize secrets vault? [y/N]`

**判定**：✅ 出现以上提示；❌ 中途报错。

### 步骤 5.2 — 选择不初始化 vault

在 `Initialize secrets vault? [y/N]` 处输入 `n` 回车。

**预期**：打印 `You can initialize the vault later with: aiws setup`，命令正常结束。
**判定**：✅ 正常退出，无 `[ERROR]`。

> 若想顺带测 vault 初始化，可输入 `y`，但需先装 `age` + `oathtool`（见 [05-secrets.md](05-secrets.md)）。本步骤先 `n`。

### 步骤 5.3 — 检查生成的目录结构

```bash
cd "$TMP" && ls -d .ai-workspace/{rules,rules/domains,adapters,skills,memory,mcp,secrets,config,scripts/lib}
```

**预期**：所有目录都列出。
**判定**：✅ 目录齐全。

### 步骤 5.4 — 检查默认配置

```bash
cat "$TMP/.ai-workspace/config/workspace.json"
```

**预期**：`tools` 为 `["codex","claude","cursor","trae"]`、`default_scope` 为 `"project"`。
**判定**：✅ 内容正确。

### 步骤 5.5 — 收尾

```bash
cd / && rm -rf "$TMP"
```

---

## 6. `validate`（校验）

校验工作区结构与配置，是「上线前最后一道闸门」。回到真实仓库执行（只读，安全）：

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws
```

### 步骤 6.1 — 完整校验

```bash
$AIWS validate
```

**预期**：依次打印各域检查结果（`Checking directory structure... / rules / adapters / mcp / skills / secrets / memory / generated files / rule drift`），末尾摘要为以下三种之一：

```
[OK] Validation PASSED                                  # 无 error 无 warning
[WARN] Validation passed with N warning(s)              # 有 warning 但无 error
[ERROR] Validation FAILED: N error(s), M warning(s)     # 有 error
```

**判定**：
- ✅ 输出 `Validation PASSED` 或 `Validation passed with ... warning(s)`（退出码 0）。
- ❌ 输出 `Validation FAILED`（退出码 1），或某域出现 `[ERROR]`。

> 本仓库首次可能因「生成文件尚未 sync」出现 `drift` 或 `generated files not yet created` 的 `[INFO]`/`[WARN]`，属正常。跑过 [07-sync.md](07-sync.md) 后应消除。

### 步骤 6.2 — 退出码

```bash
$AIWS validate >/dev/null 2>&1; echo "退出码=$?"
```

**预期**：`退出码=0`（通过）或 `1`（有 error）。
**判定**：✅ 与摘要一致。

### 步骤 6.3 — `--strict`（把 warning 当 error）

```bash
$AIWS validate --strict; echo "退出码=$?"
```

**预期**：所有 warning 会额外打印 `Strict mode: warning treated as error`，最终大概率 `Validation FAILED`。
**判定**：✅ 严格模式下 warning 升级为 error（这正是它的语义）。

### 步骤 6.4 — `--drift-strict`（漂移严格）

```bash
$AIWS validate --drift-strict
```

**预期**：若生成文件与规范规则有漂移，会报 `[ERROR] Generated files drifted ...` 而非 `[WARN]`。
**判定**：✅ 漂移被当作 error（pre-commit 钩子即用此模式拦截，见 [09-ci-hooks.md](09-ci-hooks.md)）。

---

## 7. 验收清单

- [ ] `$AIWS --version` / `--help` 正常。
- [ ] `AIWS_JSON=1 $AIWS mcp list` 输出合法 JSON。
- [ ] `setup` 在临时仓库补齐目录 + 默认配置，可选 vault 流程正常。
- [ ] `validate` 无 `[ERROR]`，退出码 0。
- [ ] `--strict` 与 `--drift-strict` 语义正确。
