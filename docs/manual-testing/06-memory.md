# 06 · 记忆（Memory）

> **测试对象**：项目记忆的 `list/new/show`、ADR 编号自增、context 注入 sync。
> **前置**：[01-cli-basics.md](01-cli-basics.md)。
> **写文件**：`memory new` 在 `.ai-workspace/memory/` 下建文件；sync 注入 context。建议临时仓库。

---

## 1. 目标

记忆是「上下文与决策」，分三类：**ADR**（架构决策记录）/ **context**（项目上下文摘要）/ **decisions**（技术决策日志）。本域验证：

1. `memory list` 列出三类条目。
2. `memory new` 按类型建文件（ADR 编号自增、decisions 追加、context 独立成文）。
3. `memory show` 打印条目。
4. `sync` 把 context 注入各工具（claude/codex 头部 + cursor/trae 的 `00-context` 文件）。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws
```

---

## 3. `memory list`（只读）

### 步骤 3.1 — 列出全部

```bash
$AIWS memory list
```

**预期**：三个区块：

```
ADR（架构决策记录）：
  （或列出 [编号] (status) (date) 标题）
Context（项目上下文摘要）：
  <id> | <title>
Decisions（技术决策日志）：
  （或列出 ## YYYY-MM-DD 条目 / 暂无）
```

**判定**：✅ 三个区块都出现。

### 步骤 3.2 — 按类型过滤

```bash
$AIWS memory list --type adr
$AIWS memory list --type context
```

**预期**：只显示对应类型。
**判定**：✅ 过滤生效。

---

## 4. `memory new`（写文件，临时仓库）

```bash
TMP=$(mktemp -d /tmp/aiws-memory.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws
```

### 步骤 4.1 — 新建 ADR（编号自增）

```bash
$AIWS_TMP memory new --type adr --title "Use age encryption"
$AIWS_TMP memory new --type adr --title "Adopt per-rule sync"
```

**预期**：
- 第一条：`已创建 ADR：adr/0001.md`
- 第二条：`已创建 ADR：adr/0002.md`

```bash
ls .ai-workspace/memory/adr/
```

**预期**：出现 `0001.md`、`0002.md`（外加 `TEMPLATE.md`）。
**判定**：✅ ADR 编号自动递增（4 位零填充）。

### 步骤 4.2 — 新建 context

```bash
$AIWS_TMP memory new --type context --title "部署环境"
```

**预期**：`已创建 Context：context/部署环境.md`。

```bash
ls .ai-workspace/memory/context/
```

**预期**：出现 `部署环境.md`。
**判定**：✅ context 独立成文（文件名 = 标题，空格转 `-`）。

### 步骤 4.3 — 新建 decisions（追加）

```bash
$AIWS_TMP memory new --type decisions --title "选用 shasum 做规则哈希"
```

**预期**：`已追加决策：decisions/decisions.md`。

```bash
tail -6 .ai-workspace/memory/decisions/decisions.md
```

**预期**：末尾追加 `## YYYY-MM-DD 选用 shasum 做规则哈希` + `背景/决策/影响` 三行占位。
**判定**：✅ decisions 为追加式日志，条目以 `## YYYY-MM-DD ` 开头。

### 步骤 4.4 — `memory show`

```bash
$AIWS_TMP memory show adr/0001.md
```

**预期**：打印该 ADR 文件全文（含 frontmatter + 标题占位替换后的内容）。
**判定**：✅ 能按 `memory/` 相对路径查看。

---

## 5. context 注入 sync（联动）

记忆的 context 会在 sync 时注入各工具，让 AI 工具始终「看到」项目上下文。

### 步骤 5.1 — 同步规则

```bash
$AIWS_TMP sync --only rules
```

**预期**：除规则生成外，出现 `Generated: cursor context - 00-context.mdc` 与 `Generated: trae context - 00-context.md`。

### 步骤 5.2 — 验证 Cursor/Trae 的 context 载体文件

```bash
ls .cursor/rules/00-context.mdc .trae/rules/00-context.md
grep -c "部署环境" .cursor/rules/00-context.mdc
```

**预期**：两个 `00-context` 文件存在，且包含刚建的 context 正文（`部署环境` 计数 ≥1）。
**判定**：✅ context 注入 per-rule 工具的 `00-context` 载体。

### 步骤 5.3 — 验证 Claude/Codex 头部注入

```bash
grep -n "项目上下文（来自 .ai-workspace/memory/context" CLAUDE.md AGENTS.md
```

**预期**：`CLAUDE.md`、`AGENTS.md` 头部有 `<!-- ===== 项目上下文（来自 .ai-workspace/memory/context/ ...）===== -->` 注释块。
**判定**：✅ context 注入单文件工具的头部。

### 步骤 5.4 — 收尾

```bash
cd / && rm -rf "$TMP"
```

---

## 6. validate 记忆域校验（联动）

记忆文件格式错误会被 `validate` 捕获：

```bash
cd /Users/xuanyi/Documents/AI-management
$AIWS validate 2>&1 | grep -A5 "Checking memory"
```

**预期**：显示 `Checking memory...` + 三个模板存在 +（如有条目）`ADR status valid` / `Decision entries format valid`。
**判定**：✅ 记忆域校验通过；若改坏 `decisions.md` 的日期格式，会出现 `warn`。

---

## 7. 验收清单

- [ ] `memory list` 列出三类条目，`--type` 过滤生效。
- [ ] `memory new --type adr` 编号自增（0001 → 0002）。
- [ ] `memory new --type context/decisions` 行为正确（独立成文 / 追加日志）。
- [ ] `memory show <相对路径>` 打印条目。
- [ ] `sync` 注入 context：cursor/trae 生成 `00-context`，claude/codex 头部注释块。
- [ ] `validate` 记忆域校验通过。
