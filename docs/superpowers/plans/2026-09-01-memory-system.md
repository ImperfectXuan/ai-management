# 记忆系统（ADR / context / decisions）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `.ai-workspace/memory/` 记忆系统 —— 三套模板、`aiws memory` 子命令、context 注入 sync、validate 校验。

**Architecture:** 纯 POSIX sh 实现。新增 `scripts/lib/memory.sh` 承载 CLI 逻辑与 context 读取辅助；`aiws` 接入 `memory` 子命令并在规则同步里注入 context（Claude/Codex 拼进单文件头部，Cursor/Trae 生成 `00-context` 文件）；`validate.sh` 新增 `validate_memory`。

**Tech Stack:** POSIX sh + grep/sed/awk/date/tr（无新增外部依赖）。

**Spec:** [docs/superpowers/specs/2026-09-01-memory-system-design.md](../specs/2026-09-01-memory-system-design.md)

## Global Constraints

- POSIX sh（`#!/bin/sh`），禁用 bash 专有语法（数组、`[[ ]]`、`local` 赋值并排等）。
- 不新增 sync `--only` 值、不新增配置开关；context 注入挂在规则同步内，`memory/context/` 为空自动 no-op。
- 只有 `memory/context/` 被注入；ADR / decisions 是档案不进会话。
- ADR 文件名 `NNNN.md`（编号主键，标题存 frontmatter `title`）；decisions 单文件追加 `decisions.md`。
- 模板用 `{{ID}}` / `{{TITLE}}` / `{{DATE}}` 占位符，`memory new` 用 awk `gsub` 替换（不用 sed，避免标题含 `/`、`&` 时报错）。
- 面向用户文案（help / 日志 / list 输出）用**简体中文**（符合项目文档语言偏好）。
- 日期统一 `date +%Y-%m-%d`（GNU 与 BSD 均兼容）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `.ai-workspace/memory/adr/TEMPLATE.md` | Create | ADR 模板（占位符 `{{ID}}/{{TITLE}}/{{DATE}}`） |
| `.ai-workspace/memory/context/TEMPLATE.md` | Create | context 模板（`{{ID}}/{{TITLE}}`） |
| `.ai-workspace/memory/context/project.md` | Create | 默认项目上下文摘要（已填充真实内容） |
| `.ai-workspace/memory/decisions/TEMPLATE.md` | Create | 决策日志条目格式说明 |
| `.ai-workspace/memory/decisions/decisions.md` | Create | 决策日志（初始含标题 + 用法注释） |
| `.ai-workspace/scripts/lib/memory.sh` | Create | `memory list/new/show` + `memory_context_body`/`memory_has_context` |
| `.ai-workspace/scripts/lib/common.sh` | Modify | `ensure_workspace_structure` 补 memory 三个子目录 |
| `.ai-workspace/scripts/aiws` | Modify | `cmd_memory` + 分发 + `show_help` + `generate_tool_file` 注入 |
| `.ai-workspace/scripts/lib/rules-generate.sh` | Modify | 白名单纳入 `00-context` + 生成 `00-context` 文件 |
| `.ai-workspace/scripts/validate.sh` | Modify | `validate_memory` + main 调用 |
| `.ai-workspace/scripts/test/test-memory.sh` | Create | 记忆域 shell 测试 |

---

### Task 1: 记忆模板与目录初始化

**Files:**
- Create: `.ai-workspace/memory/adr/TEMPLATE.md`
- Create: `.ai-workspace/memory/context/TEMPLATE.md`
- Create: `.ai-workspace/memory/context/project.md`
- Create: `.ai-workspace/memory/decisions/TEMPLATE.md`
- Create: `.ai-workspace/memory/decisions/decisions.md`
- Modify: `.ai-workspace/scripts/lib/common.sh:366-377`

**Interfaces:**
- Produces: 五份 `memory/` 文件；`ensure_workspace_structure` 保证 `memory/{adr,context,decisions}/` 三目录存在。

- [ ] **Step 1: 创建 ADR 模板**

写入 `.ai-workspace/memory/adr/TEMPLATE.md`：

```markdown
---
id: {{ID}}
title: {{TITLE}}
date: {{DATE}}
status: proposed
deciders:
  - 
---

# {{TITLE}}

## 背景

<!-- 要解决什么问题？有哪些约束？ -->

## 决策

<!-- 选了哪个方案，为什么 -->

## 后果

<!-- 正面 / 负面 trade-off -->
```

- [ ] **Step 2: 创建 context 模板**

写入 `.ai-workspace/memory/context/TEMPLATE.md`：

```markdown
---
id: {{ID}}
title: {{TITLE}}
---

# {{TITLE}}

## 用途

<!-- 一句话 + 一段话 -->

## 技术栈

<!-- 语言 / 框架 / 关键依赖 -->

## 关键决策

<!-- 链接到相关 ADR -->

## 约定规范

<!-- 指向 rules/ 的约定 -->
```

- [ ] **Step 3: 创建默认项目上下文摘要**

写入 `.ai-workspace/memory/context/project.md`：

```markdown
---
id: project
title: 项目上下文
---

# AI Workspace

## 用途

统一收编各 AI 编码工具（Claude Code / Codex / Cursor / Trae）的规则、MCP、技能与密钥到单一事实源 `.ai-workspace/`，通过 `aiws sync` 分发、`aiws validate` 守护一致性、`aiws import` 反向收编。

## 技术栈

- CLI：POSIX sh + jq + age
- TUI：Ink + React
- Desktop：Electron + React + TypeScript

## 关键决策

<!-- 见 memory/adr/ -->

## 约定规范

见 `.ai-workspace/rules/`
```

- [ ] **Step 4: 创建决策日志条目模板**

写入 `.ai-workspace/memory/decisions/TEMPLATE.md`：

```markdown
# 决策日志条目格式

每条决策追加到同目录 `decisions.md`，格式如下：

## YYYY-MM-DD <标题>

- 背景：为什么需要做这个决策
- 决策：选了哪个方案，为什么
- 影响：带来的后果 / 权衡
```

- [ ] **Step 5: 创建决策日志初始文件**

写入 `.ai-workspace/memory/decisions/decisions.md`：

```markdown
# 技术决策日志

<!-- 用 `aiws memory new --type decisions --title "..."` 追加条目 -->
```

- [ ] **Step 6: ensure_workspace_structure 补子目录**

修改 `.ai-workspace/scripts/lib/common.sh`，在 `ensure_dir "${AIWS_DIR}/memory"` 之后插入：

```sh
  ensure_dir "${AIWS_DIR}/memory/adr"
  ensure_dir "${AIWS_DIR}/memory/context"
  ensure_dir "${AIWS_DIR}/memory/decisions"
```

- [ ] **Step 7: 验证文件存在**

Run: `ls .ai-workspace/memory/{adr,context,decisions}/`
Expected: 每个目录下有对应文件（adr/TEMPLATE.md、context/{TEMPLATE.md,project.md}、decisions/{TEMPLATE.md,decisions.md}）

- [ ] **Step 8: Commit**

```bash
git add .ai-workspace/memory .ai-workspace/scripts/lib/common.sh
git commit -m "feat: 新增记忆系统模板与目录初始化"
```

---

### Task 2: `aiws memory` CLI（list / new / show）

**Files:**
- Create: `.ai-workspace/scripts/lib/memory.sh`
- Modify: `.ai-workspace/scripts/aiws`（`cmd_memory` 函数 + `show_help` + main 分发）
- Test: `.ai-workspace/scripts/test/test-memory.sh`（本任务创建，含 list/new/show 用例）

**Interfaces:**
- Consumes: `common.sh` 的 `AIWS_DIR`/`log_*`/`die`/`ensure_dir`；Task 1 的模板文件。
- Produces（后续任务依赖）:
  - `memory_context_body()` → 输出 `context/` 下所有非模板 `.md` 的正文（剥离 frontmatter）；无内容输出空串。
  - `memory_has_context()` → 有可注入内容返回 0，否则 1。
  - `memory_list [type]`、`memory_new <type> <title>`、`memory_show <path>`。

- [ ] **Step 1: 写 memory.sh**

创建 `.ai-workspace/scripts/lib/memory.sh`：

```sh
#!/bin/sh
# memory.sh - 记忆系统：ADR / context / decisions 的 list/new/show 与 context 注入辅助
# 依赖 common.sh 先被 source（提供 AIWS_DIR、log_*、die）

MEMORY_DIR="${AIWS_DIR}/memory"

# ============================================================================
# frontmatter 读取
# ============================================================================

# 读单个标量字段，去引号与首尾空白
memory_field() {
  local file="$1" key="$2"
  grep -m1 "^${key}:" "$file" \
    | sed "s/^${key}:[[:space:]]*//; s/[[:space:]]*$//" \
    | sed -e 's/^"//' -e 's/"$//'
}

# ============================================================================
# context 注入内容（Task 3 使用）
# ============================================================================

# 拼接 context/ 下所有非模板 .md 的正文（剥离 frontmatter），文件间空一行
# 直接流式输出（不经命令替换），保留换行
memory_context_body() {
  local f first=1
  for f in "${MEMORY_DIR}"/context/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    [ "$first" = "1" ] || printf '\n'
    first=0
    awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$f"
  done
}

# 是否存在可注入的 context 内容（非空）
memory_has_context() {
  [ -n "$(memory_context_body)" ]
}

# ============================================================================
# list
# ============================================================================

memory_list_adr() {
  local f n title status date
  echo "ADR（架构决策记录）："
  for f in "${MEMORY_DIR}"/adr/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    n="$(basename "$f" .md)"
    title="$(memory_field "$f" title)"
    status="$(memory_field "$f" status)"
    date="$(memory_field "$f" date)"
    printf '  [%s] %s (%s) %s\n' "$n" "$status" "$date" "$title"
  done
}

memory_list_context() {
  local f id title
  echo "Context（项目上下文摘要）："
  for f in "${MEMORY_DIR}"/context/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    id="$(memory_field "$f" id)"
    title="$(memory_field "$f" title)"
    printf '  %s | %s\n' "$id" "$title"
  done
}

memory_list_decisions() {
  local log="${MEMORY_DIR}/decisions/decisions.md"
  echo "Decisions（技术决策日志）："
  if [ -f "$log" ]; then
    grep -E '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' "$log" || echo "  （暂无条目）"
  else
    echo "  （暂无日志文件）"
  fi
}

memory_list() {
  local type="${1:-all}"
  case "$type" in
    all)      memory_list_adr; echo ""; memory_list_context; echo ""; memory_list_decisions ;;
    adr)      memory_list_adr ;;
    context)  memory_list_context ;;
    decisions) memory_list_decisions ;;
    *) log_error "Unknown memory type: $type (expected adr|context|decisions)"; exit 1 ;;
  esac
}

# ============================================================================
# new
# ============================================================================

# 下一个 ADR 编号（4 位零填充），仅匹配纯数字文件名
memory_next_adr_number() {
  local max=0 n
  for f in "${MEMORY_DIR}"/adr/*.md; do
    [ -f "$f" ] || continue
    n="$(basename "$f" .md)"
    case "$n" in
      [0-9][0-9][0-9][0-9]) [ "$n" -gt "$max" ] && max="$n" ;;
    esac
  done
  printf '%04d' "$((max + 1))"
}

memory_new_adr() {
  local title="$1" n date out
  n="$(memory_next_adr_number)"
  date="$(date +%Y-%m-%d)"
  out="${MEMORY_DIR}/adr/${n}.md"
  awk -v id="$n" -v title="$title" -v date="$date" '
    { gsub(/\{\{ID\}\}/, id); gsub(/\{\{TITLE\}\}/, title); gsub(/\{\{DATE\}\}/, date); print }
  ' "${MEMORY_DIR}/adr/TEMPLATE.md" > "$out"
  log_success "已创建 ADR：adr/${n}.md"
}

memory_new_context() {
  local title="$1" id out
  id="$(printf '%s' "$title" | tr ' ' '-')"
  out="${MEMORY_DIR}/context/${id}.md"
  awk -v id="$id" -v title="$title" '
    { gsub(/\{\{ID\}\}/, id); gsub(/\{\{TITLE\}\}/, title); print }
  ' "${MEMORY_DIR}/context/TEMPLATE.md" > "$out"
  log_success "已创建 Context：context/${id}.md"
}

memory_new_decisions() {
  local title="$1" date log
  date="$(date +%Y-%m-%d)"
  log="${MEMORY_DIR}/decisions/decisions.md"
  if [ ! -f "$log" ]; then
    printf '# 技术决策日志\n\n' > "$log"
  fi
  {
    printf '\n## %s %s\n\n' "$date" "$title"
    printf -- '- 背景：\n- 决策：\n- 影响：\n'
  } >> "$log"
  log_success "已追加决策：decisions/decisions.md"
}

memory_new() {
  local type="$1" title="$2"
  case "$type" in
    adr)       memory_new_adr "$title" ;;
    context)   memory_new_context "$title" ;;
    decisions) memory_new_decisions "$title" ;;
    *) log_error "Unknown memory type: $type (expected adr|context|decisions)"; exit 1 ;;
  esac
}

# ============================================================================
# show
# ============================================================================

memory_show() {
  local rel="$1" f
  f="${MEMORY_DIR}/${rel}"
  if [ ! -f "$f" ]; then
    log_error "No such memory file: ${rel}"
    log_info "可用路径相对 memory/，如 adr/0001.md、context/project.md"
    exit 1
  fi
  cat "$f"
}
```

- [ ] **Step 2: 写 CLI 用例测试**

创建 `.ai-workspace/scripts/test/test-memory.sh`（先含 list/new/show 用例，Task 3/4 追加）：

```sh
#!/bin/sh
# test-memory.sh - 记忆系统（memory.sh + 注入 + validate）测试
# 独立构造沙盒工作区，不触碰真实仓库。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"
MEMORY_REAL="${SCRIPT_DIR}/../../memory"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

# 在干净子 shell 运行 memory.sh 函数
run_mem() {
  local ws="$1"; shift
  (
    export AIWS_ROOT="$ws"
    . "${LIB_DIR}/common.sh" >/dev/null 2>&1
    export AIWS_LIB_DIR="${LIB_DIR}"
    . "${LIB_DIR}/memory.sh"
    "$@"
  )
}

run_aiws() {
  local ws="$1"; shift
  AIWS_ROOT="$ws" "$LIB_DIR/../aiws" "$@"
}

# 建沙盒工作区并复制真实模板
new_memory_ws() {
  local ws
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-memory-test.XXXXXX")"
  mkdir -p "$ws/.ai-workspace/memory/adr" "$ws/.ai-workspace/memory/context" "$ws/.ai-workspace/memory/decisions"
  cp "$MEMORY_REAL/adr/TEMPLATE.md" "$ws/.ai-workspace/memory/adr/TEMPLATE.md"
  cp "$MEMORY_REAL/context/TEMPLATE.md" "$ws/.ai-workspace/memory/context/TEMPLATE.md"
  cp "$MEMORY_REAL/decisions/TEMPLATE.md" "$ws/.ai-workspace/memory/decisions/TEMPLATE.md"
  cp "$MEMORY_REAL/decisions/decisions.md" "$ws/.ai-workspace/memory/decisions/decisions.md"
  echo "$ws"
}

echo "=== memory CLI 测试 ==="

# 1) new adr 生成编号文件且占位符已替换
WS="$(new_memory_ws)"
run_mem "$WS" memory_new adr "使用 age 加密" >/dev/null 2>&1
if [ -f "$WS/.ai-workspace/memory/adr/0001.md" ] \
  && grep -q '^id: 0001' "$WS/.ai-workspace/memory/adr/0001.md" \
  && grep -q '^title: 使用 age 加密' "$WS/.ai-workspace/memory/adr/0001.md" \
  && ! grep -q '{{' "$WS/.ai-workspace/memory/adr/0001.md"; then
  t_pass "memory_new_adr_creates_numbered_file"
else
  t_fail "memory_new_adr_creates_numbered_file"
fi
rm -rf "$WS"

# 2) 连续两条 adr 编号自增
WS="$(new_memory_ws)"
run_mem "$WS" memory_new adr "第一条" >/dev/null 2>&1
run_mem "$WS" memory_new adr "第二条" >/dev/null 2>&1
if [ -f "$WS/.ai-workspace/memory/adr/0001.md" ] && [ -f "$WS/.ai-workspace/memory/adr/0002.md" ]; then
  t_pass "memory_new_adr_increments_number"
else
  t_fail "memory_new_adr_increments_number"
fi
rm -rf "$WS"

# 3) new context 文件名空格转连字符
WS="$(new_memory_ws)"
run_mem "$WS" memory_new context "部署架构" >/dev/null 2>&1
if [ -f "$WS/.ai-workspace/memory/context/部署架构.md" ] \
  && grep -q '^id: 部署架构' "$WS/.ai-workspace/memory/context/部署架构.md"; then
  t_pass "memory_new_context_creates_file"
else
  t_fail "memory_new_context_creates_file"
fi
rm -rf "$WS"

# 4) new decisions 追加条目
WS="$(new_memory_ws)"
run_mem "$WS" memory_new decisions "引入 memory 子命令" >/dev/null 2>&1
if grep -qE '^## [0-9]{4}-[0-9]{2}-[0-9]{2} 引入 memory 子命令' \
  "$WS/.ai-workspace/memory/decisions/decisions.md"; then
  t_pass "memory_new_decisions_appends_entry"
else
  t_fail "memory_new_decisions_appends_entry"
fi
rm -rf "$WS"

# 5) 非法 type 报错（rc 1）
WS="$(new_memory_ws)"
rc=0; run_mem "$WS" memory_new foo "x" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 1 ]; then t_pass "memory_new_unknown_type_fails_loud"; else t_fail "memory_new_unknown_type_fails_loud (rc=$rc)"; fi
rm -rf "$WS"

# 6) show 打印已存在文件
WS="$(new_memory_ws)"
run_mem "$WS" memory_new adr "可展示的" >/dev/null 2>&1
OUT="$(run_mem "$WS" memory_show adr/0001.md)"
if printf '%s\n' "$OUT" | grep -q '可展示的'; then t_pass "memory_show_existing_prints_content"; else t_fail "memory_show_existing_prints_content"; fi
rm -rf "$WS"

# 7) show 不存在文件报错（rc 1）
WS="$(new_memory_ws)"
rc=0; run_mem "$WS" memory_show adr/nope.md >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 1 ]; then t_pass "memory_show_missing_fails_loud"; else t_fail "memory_show_missing_fails_loud (rc=$rc)"; fi
rm -rf "$WS"

# 8) 真实 CLI 端到端：aiws memory new adr
WS="$(new_memory_ws)"
run_aiws "$WS" memory new --type adr --title "端到端决策" >/dev/null 2>&1 || true
if [ -f "$WS/.ai-workspace/memory/adr/0001.md" ]; then t_pass "aiws_memory_new_end_to_end"; else t_fail "aiws_memory_new_end_to_end"; fi
rm -rf "$WS"

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 3: 运行测试确认失败（CLI 未接入）**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: 用例 1-7 通过（直接调 memory.sh），用例 8 `aiws_memory_new_end_to_end` 失败（`aiws` 尚无 `memory` 命令）。

- [ ] **Step 4: 接入 `cmd_memory` 与分发**

修改 `.ai-workspace/scripts/aiws`：

在 `cmd_rules` 之后新增：

```sh
# ============================================================================
# Memory Commands
# ============================================================================

cmd_memory() {
  . "${SCRIPT_DIR}/lib/memory.sh"

  local subcmd="${1:-list}"
  shift || true

  local type=""
  local title=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --type)  type="$2"; shift 2 ;;
      --title) title="$2"; shift 2 ;;
      *) break ;;
    esac
  done

  case "$subcmd" in
    list)
      memory_list "$type"
      ;;
    new)
      if [ -z "$type" ] || [ -z "$title" ]; then
        log_error "Usage: aiws memory new --type adr|context|decisions --title \"...\""
        exit 1
      fi
      memory_new "$type" "$title"
      ;;
    show)
      memory_show "$1"
      ;;
    --help|-h|help)
      echo "Usage: aiws memory <list|new|show>"
      echo ""
      echo "管理项目记忆（ADR / context / decisions）。"
      echo ""
      echo "Commands:"
      echo "  list [--type adr|context|decisions]   列出记忆条目"
      echo "  new --type <t> --title \"...\"          从模板新建（adr 编号自增、decisions 追加）"
      echo "  show <path>                          打印记忆文件（相对 memory/，如 adr/0001.md）"
      ;;
    *)
      log_error "Unknown memory subcommand: $subcmd"
      log_info "Available: list, new, show"
      exit 1
      ;;
  esac
}
```

在 main 分发的 `rules)` 分支之后新增：

```sh
    memory)
      cmd_memory "$@"
      ;;
```

- [ ] **Step 5: show_help 补 memory 段**

修改 `.ai-workspace/scripts/aiws` 的 `show_help()`，在 `secrets` 段之后插入：

```sh
    ${GREEN}memory${NC}     Manage project memory (ADR / context / decisions)
        list [--type <t>]  List memory entries
        new --type <t> --title "..."  Create from template
        show <path>        Show a memory file
```

并在 `EXAMPLES` 段加一行：

```sh
    aiws memory new --type adr --title "Use age encryption"   # 新建 ADR
```

- [ ] **Step 6: 运行测试确认通过**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: `pass 8 / fail 0`。

- [ ] **Step 7: Commit**

```bash
git add .ai-workspace/scripts/lib/memory.sh .ai-workspace/scripts/aiws .ai-workspace/scripts/test/test-memory.sh
git commit -m "feat: 新增 aiws memory 子命令（list/new/show）"
```

---

### Task 3: context 注入 sync

**Files:**
- Modify: `.ai-workspace/scripts/aiws:280-336`（`generate_tool_file` 顶部 source + claude/codex 注入）
- Modify: `.ai-workspace/scripts/lib/rules-generate.sh:127-148,182-242`（白名单 + 生成 `00-context`）
- Test: `.ai-workspace/scripts/test/test-memory.sh`（追加注入用例）

**Interfaces:**
- Consumes: Task 2 的 `memory_context_body` / `memory_has_context`。
- Produces: sync 时 Claude/Codex 的 `CLAUDE.md`/`AGENTS.md` 头部含上下文块；Cursor/Trae 生成 `00-context.mdc`/`00-context.md`。

- [ ] **Step 1: 写注入用例（先失败）**

向 `test-memory.sh` 的 summary 前追加：

```sh
echo "=== context 注入测试 ==="

add_rules_and_mappings() {
  local ws="$1" tool
  mkdir -p "$ws/.ai-workspace/rules/domains"
  cat > "$ws/.ai-workspace/rules/00-core.md" <<'EOF'
---
id: "00-core"
title: Core
scope: all
---
# Core
- Be explicit.
EOF
  for tool in cursor trae; do
    mkdir -p "$ws/.ai-workspace/adapters/$tool"
    {
      printf 'tool: %s\n' "$tool"
      printf 'rules:\n'
      printf '  - source: rules/00-core.md\n'
      printf '    required: true\n'
    } > "$ws/.ai-workspace/adapters/$tool/mapping.yaml"
  done
}

add_context() {
  local ws="$1"
  cat > "$ws/.ai-workspace/memory/context/project.md" <<'EOF'
---
id: project
title: 项目上下文
---
# 沙盒项目
## 用途
测试注入。
EOF
}

# 9) claude sync 注入 context 到 CLAUDE.md 头部
WS="$(new_memory_ws)"
add_rules_and_mappings "$WS"
add_context "$WS"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if grep -q '沙盒项目' "$WS/CLAUDE.md" && grep -q '项目上下文' "$WS/CLAUDE.md"; then
  t_pass "sync_injects_context_into_claude"
else
  t_fail "sync_injects_context_into_claude"
fi
rm -rf "$WS"

# 10) cursor sync 生成 00-context.mdc（alwaysApply + globs **/*）
WS="$(new_memory_ws)"
add_rules_and_mappings "$WS"
add_context "$WS"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ -f "$WS/.cursor/rules/00-context.mdc" ] \
  && grep -q 'alwaysApply: true' "$WS/.cursor/rules/00-context.mdc" \
  && grep -q '沙盒项目' "$WS/.cursor/rules/00-context.mdc"; then
  t_pass "sync_generates_00_context_for_cursor"
else
  t_fail "sync_generates_00_context_for_cursor"
fi
rm -rf "$WS"

# 11) context 为空时 no-op：不生成 00-context、CLAUDE.md 无上下文块
WS="$(new_memory_ws)"
add_rules_and_mappings "$WS"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ ! -e "$WS/.cursor/rules/00-context.mdc" ] && ! grep -q '项目上下文' "$WS/CLAUDE.md"; then
  t_pass "sync_no_context_is_noop"
else
  t_fail "sync_no_context_is_noop"
fi
rm -rf "$WS"

# 12) 重复 sync 不把 00-context 备份成 .bak
WS="$(new_memory_ws)"
add_rules_and_mappings "$WS"
add_context "$WS"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ -f "$WS/.cursor/rules/00-context.mdc" ] && [ ! -e "$WS/.cursor/rules/00-context.mdc.bak" ]; then
  t_pass "sync_does_not_backup_00_context"
else
  t_fail "sync_does_not_backup_00_context"
fi
rm -rf "$WS"
```

- [ ] **Step 2: 运行测试确认注入用例失败**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: 用例 9-12 失败（`CLAUDE.md` 无上下文、无 `00-context.mdc`）。

- [ ] **Step 3: generate_tool_file 顶部 source + claude/codex 注入**

修改 `.ai-workspace/scripts/aiws` 的 `generate_tool_file`：

在函数开头（`local target_scope="$2"` 之后）加：

```sh
  . "${SCRIPT_DIR}/lib/memory.sh"
```

将末尾写入块（当前 `echo "$rules_content"` 那段）替换为：

```sh
  local context_body
  context_body="$(memory_context_body)"

  {
    echo "$header"
    if [ -n "$context_body" ]; then
      echo ""
      echo "<!-- ===== 项目上下文（来自 .ai-workspace/memory/context/，由 aiws sync 注入）===== -->"
      echo ""
      echo "$context_body"
      echo "<!-- ===== /项目上下文 ===== -->"
    fi
    echo ""
    echo "$rules_content"
  } > "$output_file"
```

- [ ] **Step 4: rules-generate.sh 白名单纳入 00-context**

修改 `.ai-workspace/scripts/lib/rules-generate.sh`，在第一遍白名单循环结束（`done` 之后、`# 用白名单...` 注释之前）插入：

```sh
  # 若存在可注入 context，把 00-context 纳入白名单，避免被当非预期文件备份
  if memory_has_context; then
    expected="${expected}00-context${ext}"$'\n'
  fi
```

- [ ] **Step 5: rules-generate.sh 生成 00-context 文件**

修改 `.ai-workspace/scripts/lib/rules-generate.sh`，在第二遍规则生成循环的 `done` 之后、`if [ -n "$backed_up" ]` 之前插入：

```sh
  # 项目上下文注入：per-rule 工具用 alwaysApply 载体文件承载 context
  if memory_has_context; then
    {
      echo "---"
      echo "# Generated by AI Workspace - DO NOT EDIT MANUALLY"
      echo "description: 项目上下文"
      echo "globs: \"**/*\""
      echo "alwaysApply: true"
      echo "---"
      memory_context_body
    } > "${out_dir}/00-context${ext}"
    log_info "Generated: ${tool} context - 00-context${ext}"
  fi
```

- [ ] **Step 6: 运行测试确认注入用例通过**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: `pass 12 / fail 0`。

- [ ] **Step 7: Commit**

```bash
git add .ai-workspace/scripts/aiws .ai-workspace/scripts/lib/rules-generate.sh .ai-workspace/scripts/test/test-memory.sh
git commit -m "feat: sync 注入 memory/context 到各工具（claude/codex 头部 + cursor/trae 00-context）"
```

---

### Task 4: validate 记忆域校验

**Files:**
- Modify: `.ai-workspace/scripts/validate.sh`（新增 `validate_memory` + main 调用）
- Test: `.ai-workspace/scripts/test/test-memory.sh`（追加 validate 用例）

**Interfaces:**
- Consumes: `common.sh` 的 `AIWS_DIR`、validate.sh 的 `error`/`warn`/`pass`。
- Produces: `validate_memory` 在 `aiws validate` 时执行记忆域检查。

- [ ] **Step 1: 写 validate 用例（先失败）**

向 `test-memory.sh` 的 summary 前追加：

```sh
echo "=== validate 记忆域测试 ==="

# 13) 合法记忆域 validate 识别三套模板（输出含 "Memory template exists"）
WS="$(new_memory_ws)"
add_rules_and_mappings "$WS"
OUT="$(run_aiws "$WS" validate 2>&1 || true)"
if printf '%s\n' "$OUT" | grep -q 'Memory template exists: adr/TEMPLATE.md'; then
  t_pass "validate_passes_valid_memory"
else
  t_fail "validate_passes_valid_memory"
fi
rm -rf "$WS"

# 14) ADR 非法 status 触发 "Invalid ADR status" 告警
WS="$(new_memory_ws)"
add_rules_and_mappings "$WS"
cat > "$WS/.ai-workspace/memory/adr/0001.md" <<'EOF'
---
id: 0001
title: 坏状态
date: 2026-09-01
status: bogus
---
# 坏状态
EOF
OUT="$(run_aiws "$WS" validate 2>&1 || true)"
if printf '%s\n' "$OUT" | grep -q 'Invalid ADR status'; then
  t_pass "validate_flags_invalid_adr_status"
else
  t_fail "validate_flags_invalid_adr_status"
fi
rm -rf "$WS"
```

- [ ] **Step 2: 运行测试确认 validate 用例失败**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: 用例 13 可能通过（validate 不查 memory，rc 0）、用例 14 失败（`--strict` 下无告警 → rc 0，与期望 rc 1 不符）。

- [ ] **Step 3: 实现 validate_memory**

在 `.ai-workspace/scripts/validate.sh` 的 `validate_secrets` 之后新增：

```sh
# ============================================================================
# Memory Validation
# ============================================================================

validate_memory() {
  log_info "Checking memory..."

  local t
  for t in adr context decisions; do
    if [ -f "${AIWS_DIR}/memory/${t}/TEMPLATE.md" ]; then
      pass "Memory template exists: ${t}/TEMPLATE.md"
    else
      warn "Missing memory template: memory/${t}/TEMPLATE.md"
    fi
  done

  # context 文件 frontmatter（id / title）
  for f in "${AIWS_DIR}"/memory/context/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    local filename
    filename="$(basename "$f")"
    if [ "$(grep -c '^id:' "$f" || true)" = "0" ]; then warn "Missing 'id' in context: $filename"; fi
    if [ "$(grep -c '^title:' "$f" || true)" = "0" ]; then warn "Missing 'title' in context: $filename"; fi
  done

  # ADR 文件 frontmatter（id / title / date / status）+ status 枚举
  for f in "${AIWS_DIR}"/memory/adr/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    local filename status_val
    filename="$(basename "$f")"
    if [ "$(grep -c '^id:' "$f" || true)" = "0" ]; then warn "Missing 'id' in ADR: $filename"; fi
    if [ "$(grep -c '^title:' "$f" || true)" = "0" ]; then warn "Missing 'title' in ADR: $filename"; fi
    if [ "$(grep -c '^date:' "$f" || true)" = "0" ]; then warn "Missing 'date' in ADR: $filename"; fi
    status_val="$(grep -m1 '^status:' "$f" | sed 's/^status:[[:space:]]*//; s/[[:space:]]*$//')"
    case "$status_val" in
      proposed|accepted|deprecated|superseded) pass "ADR status valid: $filename" ;;
      *) warn "Invalid ADR status '$status_val' in: $filename (expected proposed|accepted|deprecated|superseded)" ;;
    esac
  done

  # decisions.md 条目须以 ## YYYY-MM-DD 开头
  if [ -f "${AIWS_DIR}/memory/decisions/decisions.md" ]; then
    if awk '
      /^## / { if ($0 !~ /^## [0-9]{4}-[0-9]{2}-[0-9]{2} /) bad = 1 }
      END { exit bad ? 1 : 0 }
    ' "${AIWS_DIR}/memory/decisions/decisions.md"; then
      pass "Decision entries format valid"
    else
      warn "decisions.md 存在不以 '## YYYY-MM-DD ' 开头的条目"
    fi
  fi

  echo ""
}
```

- [ ] **Step 4: main 调用 validate_memory**

修改 `.ai-workspace/scripts/validate.sh` 的 `main()`，在 `validate_secrets` 之后、`validate_generated_files` 之前加一行：

```sh
  validate_memory
```

- [ ] **Step 5: 运行测试确认通过**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: `pass 14 / fail 0`。

- [ ] **Step 6: Commit**

```bash
git add .ai-workspace/scripts/validate.sh .ai-workspace/scripts/test/test-memory.sh
git commit -m "feat: validate 新增记忆域校验"
```

---

### Task 5: 全量回归

**Files:** 无（验证）。

- [ ] **Step 1: 记忆域测试全绿**

Run: `sh .ai-workspace/scripts/test/test-memory.sh`
Expected: `pass 14 / fail 0`。

- [ ] **Step 2: 既有 shell 套件回归**

Run:
```bash
for f in .ai-workspace/scripts/test/test-*.sh; do
  [ "$f" = ".ai-workspace/scripts/test/test-memory.sh" ] && continue
  echo "=== $f ==="
  sh "$f" | tail -1
done
```
Expected: 每个脚本 `pass N / fail 0`（尤其 `test-rules-versioning.sh` 的 sync 用例不因注入改动而破）。

- [ ] **Step 3: TUI + Electron 回归**

Run: `cd tui && npm test 2>&1 | tail -4`、`cd electron && npm test 2>&1 | tail -6`
Expected: TUI `19 pass / 0 fail`；Electron `61 pass / 0 fail`。

- [ ] **Step 4: 真实仓库冒烟（可选，需谨慎）**

Run: `.ai-workspace/scripts/aiws memory list`、`.ai-workspace/scripts/aiws validate`
Expected: `list` 显示 `context/project.md`；`validate` 无 memory 相关告警（因为 `memory/context/project.md` 已提交且合法）。

- [ ] **Step 5: 更新进度文档**

修改 `docs/PROGRESS.md`：§6 待办勾掉「ADR 模板和记忆系统」「项目上下文摘要」；§5 近期完成记录追加一行；§8 变更记录追加一行。修改 `ROADMAP.md` Phase 1 两项标 ✅。

- [ ] **Step 6: Commit**

```bash
git add docs/PROGRESS.md ROADMAP.md
git commit -m "docs: 标记记忆系统与项目上下文摘要已完成"
```
