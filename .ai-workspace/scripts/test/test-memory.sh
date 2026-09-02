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
