#!/bin/sh
# test-sync-describe.sh - `aiws sync --describe-inputs` 契约测试（功能 002 TASK-002-02）
# 用法: .ai-workspace/scripts/test/test-sync-describe.sh
# 独立构造沙盒工作区；验证 schema v1 契约、原因码、与执行同源的筛选、只读无副作用。

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

describe() {
  local ws="$1" tool="$2" module="$3" scope="$4"
  AIWS_ROOT="$ws" AIWS_SOURCE_DIR="$ws/.ai-workspace" \
    "${ws}/.ai-workspace/scripts/aiws" sync --describe-inputs \
    --tool "$tool" --only "$module" --scope "$scope"
}

new_workspace() {
  local ws
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-describe-test.XXXXXX")"
  mkdir -p "$ws/.ai-workspace/rules/domains" "$ws/.ai-workspace/memory/context" \
    "$ws/.ai-workspace/config" "$ws/.ai-workspace/adapters/cursor" "$ws/.ai-workspace/adapters/trae" \
    "$ws/.ai-workspace/skills/alpha" "$ws/.ai-workspace/mcp"
  cp -R "$REPO_SCRIPTS" "$ws/.ai-workspace/scripts"

  cat > "$ws/.ai-workspace/rules/00-core.md" <<'EOF'
---
id: 00-core
title: Core
scope: all
---
# CORE_MARKER
EOF
  cat > "$ws/.ai-workspace/rules/only-cursor.md" <<'EOF'
---
id: only-cursor
title: OnlyCursor
scope: all
tools: [cursor]
---
# CURSOR_ONLY_MARKER
EOF
  {
    printf 'tool: cursor\nrules:\n'
    printf '  - source: rules/00-core.md\n    required: true\n'
    printf '  - source: rules/only-cursor.md\n    required: true\n'
  } > "$ws/.ai-workspace/adapters/cursor/mapping.yaml"
  {
    printf 'tool: trae\nrules:\n'
    printf '  - source: rules/00-core.md\n    required: true\n'
  } > "$ws/.ai-workspace/adapters/trae/mapping.yaml"

  printf -- '---\nname: project\n---\nCTX_MARKER\n' > "$ws/.ai-workspace/memory/context/project.md"
  printf '# TEMPLATE\n' > "$ws/.ai-workspace/memory/context/TEMPLATE.md"
  printf '{"version":"1.0","tools":["codex","claude","cursor","trae"],"default_scope":"project"}\n' \
    > "$ws/.ai-workspace/config/workspace.json"
  printf '# SKILL A\n' > "$ws/.ai-workspace/skills/alpha/SKILL.md"
  printf '#!/bin/sh\necho hi\n' > "$ws/.ai-workspace/skills/alpha/helper.sh"
  chmod +x "$ws/.ai-workspace/skills/alpha/helper.sh"
  cat > "$ws/.ai-workspace/mcp/mcp.json" <<'EOF'
{"servers":{
  "filesystem":{"command":"npx","args":["fs"],"scope":["project","global"]},
  "browser-use":{"command":"npx","args":["bu"],"scope":["project"]},
  "node_repl":{"command":"npx","args":["nr"],"scope":["global"]}
}}
EOF

  echo "$ws"
}

echo "=== sync --describe-inputs 契约测试 ==="

# 1) rules：codex 只消费适用规则 + context + 配置；不看 mapping；stdout 纯 JSON
WS="$(new_workspace)"
OUT="$(describe "$WS" codex rules project 2>/dev/null)"
CODE=$?
t_assert "$([ "$CODE" = "0" ] && echo 1 || echo 0)" "rules codex 退出 0"
t_assert "$(printf '%s' "$OUT" | jq -e '.schemaVersion == 1 and .executable == true' >/dev/null && echo 1 || echo 0)" "rules codex schema v1 且 executable"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("rules/00-core.md") != null' >/dev/null && echo 1 || echo 0)" "rules codex 包含适用规则"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("rules/only-cursor.md") == null' >/dev/null && echo 1 || echo 0)" "rules codex 排除 tools:[cursor] 规则"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("adapters/cursor/mapping.yaml") == null' >/dev/null && echo 1 || echo 0)" "rules codex 不消费 mapping"
t_assert "$(printf '%s' "$OUT" | jq -e '([.inputs[].path] | index("memory/context/project.md") != null) and ([.inputs[].path] | index("memory/context/TEMPLATE.md") == null)' >/dev/null && echo 1 || echo 0)" "rules codex 纳入 context 排除 TEMPLATE"
t_assert "$(printf '%s' "$OUT" | jq -e '[.deps[]] | index("lib/rules-generate.sh") == null' >/dev/null && echo 1 || echo 0)" "rules codex 依赖不含 rules-generate.sh"
t_assert "$(printf '%s' "$OUT" | jq -e '(.outputKeys | length == 1) and (.outputKeys[0] | endswith("/AGENTS.md"))' >/dev/null && echo 1 || echo 0)" "rules codex outputKeys 指向 AGENTS.md"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("rules/CHANGELOG.md") == null' >/dev/null && echo 1 || echo 0)" "CHANGELOG 不作为输入"

# 2) rules：cursor 消费 mapping + required 过滤；依赖含 rules-generate.sh
OUT="$(describe "$WS" cursor rules project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("adapters/cursor/mapping.yaml") != null' >/dev/null && echo 1 || echo 0)" "rules cursor 消费 mapping"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("rules/only-cursor.md") != null' >/dev/null && echo 1 || echo 0)" "rules cursor 纳入仅适用规则"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[] | select(.path=="rules/only-cursor.md") | .selector] | index("tools:cursor") != null' >/dev/null && echo 1 || echo 0)" "selector 记录 tools 字段"
t_assert "$(printf '%s' "$OUT" | jq -e '[.deps[]] | index("lib/rules-generate.sh") != null' >/dev/null && echo 1 || echo 0)" "rules cursor 依赖含 rules-generate.sh"

# 3) rules global：unsupported（不伪造成功）
OUT="$(describe "$WS" claude rules global 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.executable == false and .reasonCode == "tool_unsupported"' >/dev/null && echo 1 || echo 0)" "rules global 为 tool_unsupported"

# 4) rules cursor 缺 mapping：mapping_missing
WS2="$(new_workspace)"
rm -f "$WS2/.ai-workspace/adapters/cursor/mapping.yaml"
OUT="$(describe "$WS2" cursor rules project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.executable == false and .reasonCode == "mapping_missing"' >/dev/null && echo 1 || echo 0)" "缺 mapping 为 mapping_missing"
rm -rf "$WS2"

# 5) mcp：按 scope 过滤 server；无覆盖
OUT="$(describe "$WS" codex mcp project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.mcp.servers == ["browser-use","filesystem"]' >/dev/null && echo 1 || echo 0)" "mcp project 过滤出两 server 且排序稳定"
t_assert "$(printf '%s' "$OUT" | jq -e '(.outputKeys | length == 1) and (.outputKeys[0] | endswith("/.codex/config.toml"))' >/dev/null && echo 1 || echo 0)" "mcp codex project outputKeys 指向 config.toml"
t_assert "$(printf '%s' "$OUT" | jq -e '.mcp.override == null and .mcp.overrideOrder == ["mcp/mcp.json"]' >/dev/null && echo 1 || echo 0)" "无 local 覆盖时 override 为空"
OUT="$(describe "$WS" codex mcp global 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.mcp.servers == ["filesystem","node_repl"]' >/dev/null && echo 1 || echo 0)" "mcp global 过滤出两 server"

# 6) mcp trae global：unsupported
OUT="$(describe "$WS" trae mcp global 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.executable == false and .reasonCode == "tool_unsupported"' >/dev/null && echo 1 || echo 0)" "trae global mcp 为 tool_unsupported"

# 7) mcp 覆盖：有效 local 纳入覆盖顺序；坏 local 静默回退（与执行同源）
printf '{"servers":{"browser-use":{"command":"npx","args":["bu2"],"scope":["project"]}}}\n' \
  > "$WS/.ai-workspace/mcp/mcp.local.json"
OUT="$(describe "$WS" codex mcp project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.mcp.override == "mcp/mcp.local.json" and .mcp.overrideOrder == ["mcp/mcp.json","mcp/mcp.local.json"]' >/dev/null && echo 1 || echo 0)" "有效 local 纳入覆盖顺序"
t_assert "$(printf '%s' "$OUT" | jq -e '[.inputs[].path] | index("mcp/mcp.local.json") != null' >/dev/null && echo 1 || echo 0)" "有效 local 计入输入"
printf 'not-json{{{\n' > "$WS/.ai-workspace/mcp/mcp.local.json"
OUT="$(describe "$WS" codex mcp project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.mcp.override == null and ([.inputs[].path] | index("mcp/mcp.local.json") == null)' >/dev/null && echo 1 || echo 0)" "坏 local 回退主文件且不计入输入"
rm -f "$WS/.ai-workspace/mcp/mcp.local.json"

# 8) skills：计划含 outputKeys/manifest/执行位；不含 tool 身份
OUT="$(describe "$WS" codex skills project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.skillsPlan.outputKeys[0] | endswith("/.agents/skills")' >/dev/null && echo 1 || echo 0)" "skills plan outputKeys 指向 .agents/skills"
t_assert "$(printf '%s' "$OUT" | jq -e '.outputKeys == .skillsPlan.outputKeys' >/dev/null && echo 1 || echo 0)" "skills 顶层 outputKeys 与 plan 一致"
t_assert "$(printf '%s' "$OUT" | jq -e '.skillsPlan.entries[0].relativePath == "alpha" and .skillsPlan.entries[0].strategy == "symlink"' >/dev/null && echo 1 || echo 0)" "skills plan 条目与策略"
t_assert "$(printf '%s' "$OUT" | jq -e '.skillsPlan.entries[0].manifest | map(select(startswith("helper.sh|file|") and endswith("|x"))) | length == 1' >/dev/null && echo 1 || echo 0)" "manifest 记录可执行位"
t_assert "$(printf '%s' "$OUT" | jq -e '(.skillsPlan | tostring) | contains("codex") | not' >/dev/null && echo 1 || echo 0)" "skills 计划不含 tool 身份（等价判定前提）"
OUT="$(describe "$WS" claude skills project 2>/dev/null)"
COD_OUT="$(describe "$WS" codex skills project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -S '.skillsPlan' > /tmp/aiws-desc-sp-claude.json && printf '%s' "$COD_OUT" | jq -S '.skillsPlan' > /tmp/aiws-desc-sp-codex.json && cmp -s /tmp/aiws-desc-sp-claude.json /tmp/aiws-desc-sp-codex.json && echo 1 || echo 0)" "codex 与 claude 的 skills 计划逐字节一致"

# 9) skills.enabled=false：module_disabled
printf '{"version":"1.0","tools":["codex","claude","cursor","trae"],"default_scope":"project","skills":{"enabled":false}}\n' \
  > "$WS/.ai-workspace/config/workspace.json"
OUT="$(describe "$WS" codex skills project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.executable == false and .reasonCode == "module_disabled"' >/dev/null && echo 1 || echo 0)" "skills.enabled=false 为 module_disabled"
printf '{"version":"1.0","tools":["codex","claude","cursor","trae"],"default_scope":"project"}\n' \
  > "$WS/.ai-workspace/config/workspace.json"

# 10) 无技能目录：no_entries
WS3="$(new_workspace)"
rm -rf "$WS3/.ai-workspace/skills/alpha"
OUT="$(describe "$WS3" codex skills project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.executable == false and .reasonCode == "no_entries"' >/dev/null && echo 1 || echo 0)" "无技能为 no_entries"
rm -rf "$WS3"

# 11) 只读：不创建目标目录、不产生密钥/状态文件
WS4="$(new_workspace)"
BEFORE="$(cd "$WS4" && find . ! -path './.ai-workspace/scripts/*' | sort)"
describe "$WS4" codex skills project >/dev/null 2>&1
describe "$WS4" codex rules project >/dev/null 2>&1
describe "$WS4" codex mcp project >/dev/null 2>&1
AFTER="$(cd "$WS4" && find . ! -path './.ai-workspace/scripts/*' | sort)"
t_assert "$([ "$BEFORE" = "$AFTER" ] && echo 1 || echo 0)" "describe 前后工作区文件树逐字节一致"
t_assert "$([ ! -e "$WS4/.agents" ] && echo 1 || echo 0)" "不创建项目 skills 目标目录"
t_assert "$([ ! -e "$WS4/.codex" ] && echo 1 || echo 0)" "不创建项目 mcp 目标文件"
rm -rf "$WS4"

# 12) 参数缺失：显式失败
CODE=0
AIWS_ROOT="$WS" AIWS_SOURCE_DIR="$WS/.ai-workspace" \
  "$WS/.ai-workspace/scripts/aiws" sync --describe-inputs --tool codex >/dev/null 2>&1 || CODE=$?
t_assert "$([ "$CODE" != "0" ] && echo 1 || echo 0)" "缺 --only/--scope 时退出非零"

# 13) 技能内软链接越界：显式失败（调用方记 unknown）
WS5="$(new_workspace)"
OUTSIDE="$(mktemp -d "${TMPDIR:-/tmp}/aiws-desc-outside.XXXXXX")"
printf 'outside\n' > "$OUTSIDE/secret.txt"
ln -s "$OUTSIDE/secret.txt" "$WS5/.ai-workspace/skills/alpha/escape.md"
CODE=0
describe "$WS5" codex skills project >/dev/null 2>&1 || CODE=$?
t_assert "$([ "$CODE" != "0" ] && echo 1 || echo 0)" "技能内越界软链接使 describe 失败"
rm -rf "$WS5" "$OUTSIDE"

# 14) 无 mcp.json：no_entries
WS6="$(new_workspace)"
rm -f "$WS6/.ai-workspace/mcp/mcp.json"
OUT="$(describe "$WS6" codex mcp project 2>/dev/null)"
t_assert "$(printf '%s' "$OUT" | jq -e '.executable == false and .reasonCode == "no_entries"' >/dev/null && echo 1 || echo 0)" "无 mcp.json 为 no_entries"
rm -rf "$WS6"

rm -rf "$WS" /tmp/aiws-desc-sp-claude.json /tmp/aiws-desc-sp-codex.json

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" = "0" ]
