#!/bin/sh
# test-sync-report.sh - `aiws sync --report-file` 单元回执测试（功能 002 TASK-002-03 / AC-002-09）
# 用法: .ai-workspace/scripts/test/test-sync-report.sh
# 验证：无参数兼容、applied/skipped/failed 语义、原因码、0600 权限、参数显式拒绝、无正文泄漏。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_SCRIPTS="$(cd "${SCRIPT_DIR}/../" && pwd)"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

t_assert() {
  if [ "$1" = "1" ] || [ "$1" = "true" ]; then t_pass "$2"; else t_fail "$2"; fi
}

# usage: run_sync <ws> <opid> <report-file-or-empty> <args...>
run_sync() {
  local ws="$1" opid="$2" report="$3"
  shift 3
  # shellcheck disable=SC2086
  AIWS_ROOT="$ws" AIWS_SOURCE_DIR="$ws/.ai-workspace" \
    AIWS_SYNC_OPERATION_ID="$opid" \
    "${ws}/.ai-workspace/scripts/aiws" sync "$@" ${report:+--report-file "$report"} \
    >/dev/null 2>&1
}

receipt_field() { jq -r "$2" "$1"; }

new_workspace() {
  local ws
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-report-test.XXXXXX")"
  mkdir -p "$ws/.ai-workspace/rules" "$ws/.ai-workspace/config" "$ws/.ai-workspace/skills/alpha" "$ws/.ai-workspace/mcp"
  cp -R "$REPO_SCRIPTS" "$ws/.ai-workspace/scripts"
  cat > "$ws/.ai-workspace/rules/00-core.md" <<'EOF'
---
id: 00-core
title: Core
scope: all
---
# CORE_REPORT_MARKER
EOF
  printf '{"version":"1.0","tools":["codex","claude","cursor","trae"],"default_scope":"project"}\n' \
    > "$ws/.ai-workspace/config/workspace.json"
  printf '# SKILL ALPHA\n' > "$ws/.ai-workspace/skills/alpha/SKILL.md"
  echo "$ws"
}

echo "=== sync --report-file 单元回执测试 ==="

# 1) 无报告参数：行为兼容，不产生回执文件
WS="$(new_workspace)"
run_sync "$WS" "" "" --only rules --tool codex --scope project
t_assert "$([ ! -e "$WS/report.json" ] && [ -f "$WS/AGENTS.md" ] && echo 1 || echo 0)" "无 --report-file 时正常生成且无回执"

# 2) 首条规则 → applied + completedAt（UTC ISO）+ 0600 + 字段匹配 + 无正文泄漏
REPORT="$WS/report.json"
run_sync "$WS" "op-applied-1" "$REPORT" --only rules --tool codex --scope project
t_assert "$([ "$?" = "0" ] && echo 1 || echo 0)" "applied 场景退出 0"
t_assert "$(jq -e '.outcome == "applied" and .schemaVersion == 1 and .tool == "codex" and .module == "rules" and .scope == "project" and .operationId == "op-applied-1"' "$REPORT" >/dev/null && echo 1 || echo 0)" "applied 回执字段与请求身份匹配"
t_assert "$(jq -e '.completedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' "$REPORT" >/dev/null && echo 1 || echo 0)" "applied 带 UTC ISO completedAt"
t_assert "$(jq -e 'has("reasonCode") | not' "$REPORT" >/dev/null && echo 1 || echo 0)" "applied 不带 reasonCode"
t_assert "$([ "$(stat -f "%Lp" "$REPORT" 2>/dev/null || stat -c "%a" "$REPORT")" = "600" ] && echo 1 || echo 0)" "回执文件权限 0600"
t_assert "$(! grep -q CORE_REPORT_MARKER "$REPORT" && echo 1 || echo 0)" "回执不含规则正文"

# 3) 空库（无适用规则）→ skipped/no_entries，不冒充清理
WS2="$(new_workspace)"
rm -f "$WS2/.ai-workspace/rules/00-core.md"
REPORT2="$WS2/report.json"
run_sync "$WS2" "op-empty" "$REPORT2" --only rules --tool codex --scope project
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "no_entries"' "$REPORT2" >/dev/null && echo 1 || echo 0)" "空库为 skipped/no_entries"
t_assert "$(jq -e 'has("completedAt") | not' "$REPORT2" >/dev/null && echo 1 || echo 0)" "skipped 不带 completedAt"
rm -rf "$WS2"

# 4) rules global → skipped/tool_unsupported，不生成
WS3="$(new_workspace)"
REPORT3="$WS3/report.json"
run_sync "$WS3" "op-global" "$REPORT3" --only rules --tool codex --scope global
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "tool_unsupported"' "$REPORT3" >/dev/null && echo 1 || echo 0)" "rules global 为 skipped/tool_unsupported"
rm -rf "$WS3"

# 5) skills 禁用 → skipped/module_disabled；启用 → applied
WS4="$(new_workspace)"
REPORT4="$WS4/report.json"
printf '{"version":"1.0","tools":["codex"],"default_scope":"project","skills":{"enabled":false}}\n' \
  > "$WS4/.ai-workspace/config/workspace.json"
run_sync "$WS4" "op-disabled" "$REPORT4" --only skills --tool codex --scope project
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "module_disabled"' "$REPORT4" >/dev/null && echo 1 || echo 0)" "skills.enabled=false 为 skipped/module_disabled"
printf '{"version":"1.0","tools":["codex"],"default_scope":"project"}\n' > "$WS4/.ai-workspace/config/workspace.json"
run_sync "$WS4" "op-skills-ok" "$REPORT4" --only skills --tool codex --scope project
t_assert "$(jq -e '.outcome == "applied" and .operationId == "op-skills-ok"' "$REPORT4" >/dev/null && echo 1 || echo 0)" "skills 全部链接成功为 applied"
rm -rf "$WS4"

# 6) 无技能目录 → skipped/no_entries
WS5="$(new_workspace)"
rm -rf "$WS5/.ai-workspace/skills"
REPORT5="$WS5/report.json"
run_sync "$WS5" "op-no-skills" "$REPORT5" --only skills --tool codex --scope project
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "no_entries"' "$REPORT5" >/dev/null && echo 1 || echo 0)" "无技能目录为 skipped/no_entries"
rm -rf "$WS5"

# 7) 无 mcp.json → skipped/no_entries（报告模式进入 sync_mcp 落回执）
WS6="$(new_workspace)"
REPORT6="$WS6/report.json"
run_sync "$WS6" "op-no-mcp" "$REPORT6" --only mcp --tool codex --scope project
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "no_entries"' "$REPORT6" >/dev/null && echo 1 || echo 0)" "无 mcp.json 为 skipped/no_entries"
rm -rf "$WS6"

# 8) MCP 正常应用 → applied；trae global → tool_unsupported
WS7="$(new_workspace)"
cat > "$WS7/.ai-workspace/mcp/mcp.json" <<'EOF'
{"servers":{"filesystem":{"command":"npx","args":["fs"],"scope":["project"]}}}
EOF
REPORT7="$WS7/report.json"
run_sync "$WS7" "op-mcp-ok" "$REPORT7" --only mcp --tool codex --scope project
t_assert "$(jq -e '.outcome == "applied" and .module == "mcp"' "$REPORT7" >/dev/null && echo 1 || echo 0)" "MCP 正常应用为 applied"
run_sync "$WS7" "op-mcp-trae" "$REPORT7" --only mcp --tool trae --scope global
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "tool_unsupported"' "$REPORT7" >/dev/null && echo 1 || echo 0)" "trae global MCP 为 skipped/tool_unsupported"
rm -rf "$WS7"

# 9) ${secret:} 无 vault → failed/secret_unresolved（占位符未解决不得 applied）
WS8="$(new_workspace)"
cat > "$WS8/.ai-workspace/mcp/mcp.json" <<'EOF'
{"servers":{"filesystem":{"command":"npx","args":["fs"],"scope":["project"],"env":{"TOKEN":"${secret:FS_TOKEN}"}}}}
EOF
REPORT8="$WS8/report.json"
run_sync "$WS8" "op-secret" "$REPORT8" --only mcp --tool codex --scope project || true
t_assert "$(jq -e '.outcome == "failed" and .reasonCode == "secret_unresolved"' "$REPORT8" >/dev/null && echo 1 || echo 0)" "未解决凭据为 failed/secret_unresolved"
t_assert "$(jq -e 'has("completedAt") | not' "$REPORT8" >/dev/null && echo 1 || echo 0)" "failed 不带 completedAt"
rm -rf "$WS8"

# 10) 坏 mcp.json → failed/invalid_config 且退出非零
WS9="$(new_workspace)"
printf 'not-json{{{\n' > "$WS9/.ai-workspace/mcp/mcp.json"
REPORT9="$WS9/report.json"
CODE=0
run_sync "$WS9" "op-bad-json" "$REPORT9" --only mcp --tool codex --scope project || CODE=$?
t_assert "$([ "$CODE" != "0" ] && echo 1 || echo 0)" "坏 mcp.json 退出非零"
t_assert "$(jq -e '.outcome == "failed" and .reasonCode == "invalid_config"' "$REPORT9" >/dev/null && echo 1 || echo 0)" "坏 mcp.json 为 failed/invalid_config"
rm -rf "$WS9"

# 11) cursor 缺 mapping → skipped/mapping_missing
WS10="$(new_workspace)"
CODE=0
run_sync "$WS10" "op-mapping" "$WS10/report.json" --only rules --tool cursor --scope project || CODE=$?
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "mapping_missing"' "$WS10/report.json" >/dev/null && echo 1 || echo 0)" "cursor 缺 mapping 为 skipped/mapping_missing"
rm -rf "$WS10"

# 12) 参数显式拒绝：缺 operationId、相对路径、describe+report 同传、缺单元参数
WS11="$(new_workspace)"
CODE=0
AIWS_ROOT="$WS11" AIWS_SOURCE_DIR="$WS11/.ai-workspace" \
  "$WS11/.ai-workspace/scripts/aiws" sync --only rules --tool codex --scope project \
  --report-file "$WS11/x.json" >/dev/null 2>&1 || CODE=$?
t_assert "$([ "$CODE" != "0" ] && echo 1 || echo 0)" "缺 AIWS_SYNC_OPERATION_ID 显式拒绝"
CODE=0
AIWS_ROOT="$WS11" AIWS_SOURCE_DIR="$WS11/.ai-workspace" AIWS_SYNC_OPERATION_ID=op \
  "$WS11/.ai-workspace/scripts/aiws" sync --only rules --tool codex --scope project \
  --report-file "rel.json" >/dev/null 2>&1 || CODE=$?
t_assert "$([ "$CODE" != "0" ] && [ ! -e "$WS11/rel.json" ] && echo 1 || echo 0)" "相对回执路径显式拒绝"
CODE=0
AIWS_ROOT="$WS11" AIWS_SOURCE_DIR="$WS11/.ai-workspace" AIWS_SYNC_OPERATION_ID=op \
  "$WS11/.ai-workspace/scripts/aiws" sync --only rules --tool codex --scope project \
  --report-file "$WS11/x.json" --describe-inputs >/dev/null 2>&1 || CODE=$?
t_assert "$([ "$CODE" != "0" ] && echo 1 || echo 0)" "describe 与 report 同传显式拒绝"
CODE=0
AIWS_ROOT="$WS11" AIWS_SOURCE_DIR="$WS11/.ai-workspace" AIWS_SYNC_OPERATION_ID=op \
  "$WS11/.ai-workspace/scripts/aiws" sync --only rules --tool codex \
  --report-file "$WS11/x.json" >/dev/null 2>&1 || CODE=$?
t_assert "$([ "$CODE" != "0" ] && echo 1 || echo 0)" "缺 --scope 显式拒绝"
rm -rf "$WS11"

# 13) 重复执行同一报告路径：新回执覆盖旧回执（每单元使用新路径由调用方保证）
WS12="$(new_workspace)"
REPORT12="$WS12/report.json"
run_sync "$WS12" "op-run-1" "$REPORT12" --only rules --tool codex --scope project
run_sync "$WS12" "op-run-2" "$REPORT12" --only rules --tool codex --scope project
t_assert "$(jq -e '.operationId == "op-run-2"' "$REPORT12" >/dev/null && echo 1 || echo 0)" "同路径重跑覆盖为新 operationId"
rm -rf "$WS12"

# 14) 缺 jq 环境：MCP 报 dependency_missing（符号链接沙盒 PATH 排除 jq；回执不依赖 jq 自身可写）
WS13="$(new_workspace)"
cat > "$WS13/.ai-workspace/mcp/mcp.json" <<'EOF'
{"servers":{"filesystem":{"command":"npx","args":["fs"],"scope":["project"]}}}
EOF
REPORT13="$WS13/report.json"
NOJQ_BIN="$(mktemp -d "${TMPDIR:-/tmp}/aiws-nojq-bin.XXXXXX")"
for _cmd in dirname basename mv rm mkdir cat cp grep sed awk date sort find mktemp chmod ln uniq head tail wc tr cut paste env sleep; do
  _src="$(command -v "$_cmd" 2>/dev/null || true)"
  [ -n "$_src" ] && ln -sf "$_src" "$NOJQ_BIN/$_cmd"
done
AIWS_ROOT="$WS13" AIWS_SOURCE_DIR="$WS13/.ai-workspace" AIWS_SYNC_OPERATION_ID=op-nojq \
  PATH="$NOJQ_BIN" \
  "$WS13/.ai-workspace/scripts/aiws" sync --only mcp --tool codex --scope project \
  --report-file "$REPORT13" >/dev/null 2>&1 || true
t_assert "$(jq -e '.outcome == "skipped" and .reasonCode == "dependency_missing"' "$REPORT13" >/dev/null && echo 1 || echo 0)" "缺 jq 为 skipped/dependency_missing（回执可写）"
rm -rf "$WS13" "$NOJQ_BIN"

rm -rf "$WS"

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" = "0" ]
