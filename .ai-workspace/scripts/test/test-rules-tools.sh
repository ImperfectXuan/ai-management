#!/bin/sh
# test-rules-tools.sh - 规则 tools 字段过滤测试
# 用法: .ai-workspace/scripts/test/test-rules-tools.sh
# 独立构造沙盒工作区，不触碰真实仓库。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

run_aiws() {
  local ws="$1"; shift
  AIWS_ROOT="$ws" "$LIB_DIR/../aiws" "$@"
}

# 建沙盒：三条规则 + cursor/trae 双 mapping（三规则都列 required:true）
# - 00-core   无 tools 字段 → 全工具
# - cursor-only  tools: [cursor] 内联 → 仅 cursor
# - trae-only    tools: 块列表 → 仅 trae
new_workspace() {
  local ws tool
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-rules-tools-test.XXXXXX")"
  mkdir -p "$ws/.ai-workspace/rules/domains" "$ws/.ai-workspace/adapters"

  cat > "$ws/.ai-workspace/rules/00-core.md" <<'EOF'
---
id: 00-core
title: Core
scope: all
---
# CORE_MARKER
EOF
  cat > "$ws/.ai-workspace/rules/cursor-only.md" <<'EOF'
---
id: cursor-only
title: CursorOnly
scope: all
tools: [cursor]
---
# CURSOR_ONLY_MARKER
EOF
  cat > "$ws/.ai-workspace/rules/trae-only.md" <<'EOF'
---
id: trae-only
title: TraeOnly
scope: all
tools:
  - trae
---
# TRAE_ONLY_MARKER
EOF

  for tool in cursor trae; do
    mkdir -p "$ws/.ai-workspace/adapters/$tool"
    {
      printf 'tool: %s\n' "$tool"
      printf 'rules:\n'
      printf '  - source: rules/00-core.md\n'
      printf '    required: true\n'
      printf '  - source: rules/cursor-only.md\n'
      printf '    required: true\n'
      printf '  - source: rules/trae-only.md\n'
      printf '    required: true\n'
    } > "$ws/.ai-workspace/adapters/$tool/mapping.yaml"
  done

  echo "$ws"
}

echo "=== 规则 tools 字段过滤测试 ==="

# 1) 内联 tools:[cursor] → cursor 生成、trae 不生成
WS="$(new_workspace)"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ -f "$WS/.cursor/rules/cursor-only.mdc" ] && [ ! -e "$WS/.trae/rules/cursor-only.md" ]; then
  t_pass "tools_inline_cursor_only_filtered"
else
  t_fail "tools_inline_cursor_only_filtered"
fi
rm -rf "$WS"

# 2) 块列表 tools(- trae) → trae 生成、cursor 不生成
WS="$(new_workspace)"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ -f "$WS/.trae/rules/trae-only.md" ] && [ ! -e "$WS/.cursor/rules/trae-only.mdc" ]; then
  t_pass "tools_block_trae_only_filtered"
else
  t_fail "tools_block_trae_only_filtered"
fi
rm -rf "$WS"

# 3) tools 缺省（00-core）→ 全工具（cursor + trae 都生成）
WS="$(new_workspace)"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ -f "$WS/.cursor/rules/00-core.mdc" ] && [ -f "$WS/.trae/rules/00-core.md" ]; then
  t_pass "tools_absent_applies_to_all"
else
  t_fail "tools_absent_applies_to_all"
fi
rm -rf "$WS"

# 4) claude 单文件拼接：只含全工具与含 claude 的规则，不含 cursor/trae 专属规则
WS="$(new_workspace)"
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if grep -q 'CORE_MARKER' "$WS/CLAUDE.md" \
  && ! grep -q 'CURSOR_ONLY_MARKER' "$WS/CLAUDE.md" \
  && ! grep -q 'TRAE_ONLY_MARKER' "$WS/CLAUDE.md"; then
  t_pass "tools_filter_single_file_claude"
else
  t_fail "tools_filter_single_file_claude"
fi
rm -rf "$WS"

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" -eq 0 ]
