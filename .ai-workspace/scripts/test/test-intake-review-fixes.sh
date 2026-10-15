#!/bin/sh
# test-intake-review-fixes.sh - TASK-001-01/02 审查问题回归测试
# 覆盖：凭据泄漏、读取范围、MCP 解析错误、手动路径、规范源扫描
# 用法: .ai-workspace/scripts/test/test-intake-review-fixes.sh
# 独立沙盒，不触碰真实仓库或真实全局配置。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

expect_json() {
  local actual
  actual="$(printf '%s' "$1" | jq -r "$2" 2>/dev/null)"
  if [ "$actual" = "$3" ]; then
    t_pass "$4"
  else
    t_fail "$4 (expected $3, got $actual)"
  fi
}

expect_absent() {
  if grep -qF -- "$2" "$1" 2>/dev/null; then
    t_fail "$3 (unexpected: $2)"
  else
    t_pass "$3"
  fi
}

expect_present() {
  if grep -qF -- "$2" "$1" 2>/dev/null; then
    t_pass "$3"
  else
    t_fail "$3 (missing: $2)"
  fi
}

# ============================================================================
# 沙盒
# ============================================================================

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/aiws-review-fix.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

REPO="${SANDBOX}/repo"
SRC="${SANDBOX}/src"
FAKE_HOME="${SANDBOX}/home"

export HOME="$FAKE_HOME"
mkdir -p "$FAKE_HOME" "$REPO/.ai-workspace/rules" "$REPO/.ai-workspace/mcp" "$SRC/.cursor/rules" "$SRC/.cursor/skills"
echo '{"servers":{}}' > "$REPO/.ai-workspace/mcp/mcp.json"

. "${LIB_DIR}/common.sh"
HOME_DIR="$FAKE_HOME"
. "${LIB_DIR}/import-mcp.sh"
. "${LIB_DIR}/intake/identity.sh"
. "${LIB_DIR}/intake/scan.sh"
. "${LIB_DIR}/intake/store.sh"

run_scan() {
  INTAKE_REPO="$REPO" INTAKE_BATCH_ID="${1}" \
  INTAKE_SOURCES="${2}" \
  INTAKE_MANUAL_FILES="${3:-}" \
  INTAKE_MANUAL_SKILLS="${4:-}" \
  INTAKE_CANCEL_FILE="" \
  intake_scan 2>/dev/null
}

# ============================================================================
# 一、凭据泄漏（嵌套敏感字段）
# ============================================================================
echo ""
echo "--- 一、嵌套凭据脱敏 ---"

cat > "$SRC/.cursor/mcp.json" << 'EOF'
{
  "mcpServers": {
    "demo": {
      "url": "https://example.invalid/mcp",
      "headers": {
        "Authorization": "Bearer LEAK_NESTED_SECRET",
        "X-Api-Key": "sk-LEAK_NESTED_KEY"
      },
      "env": {
        "TOKEN": "tok-LEAK_ENV_TOKEN",
        "NORMAL": "hello"
      }
    }
  }
}
EOF

RESULT="$(run_scan "batch-rf-01" "$SRC|cursor|project")"
echo "$RESULT" > "${SANDBOX}/rf-01.json"

expect_absent "${SANDBOX}/rf-01.json" "LEAK_NESTED_SECRET" 'nested_Authorization_redacted'
expect_absent "${SANDBOX}/rf-01.json" "LEAK_NESTED_KEY" 'nested_ApiKey_redacted'
expect_absent "${SANDBOX}/rf-01.json" "LEAK_ENV_TOKEN" 'env_TOKEN_redacted'
expect_present "${SANDBOX}/rf-01.json" '"hello"' 'normal_field_preserved'
expect_present "${SANDBOX}/rf-01.json" "REDACTED" 'redacted_placeholder_present'

# 凭据路径被记录
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .credentials[] | select(.field | contains("Authorization"))] | length' '1' 'nested_credential_path_recorded'

# ${secret:} 引用保留
cat > "$SRC/.cursor/mcp.json" << 'EOF'
{"mcpServers": {"ref": {"command": "node", "env": {"API_KEY": "${secret:my_key}", "OTHER": "val"}}}}
EOF
RESULT="$(run_scan "batch-rf-01b" "$SRC|cursor|project")"
echo "$RESULT" > "${SANDBOX}/rf-01b.json"
expect_present "${SANDBOX}/rf-01b.json" '${secret:my_key}' 'secret_ref_preserved'
expect_present "${SANDBOX}/rf-01b.json" '"val"' 'non_sensitive_field_kept'

# 脱敏失败不回退为原始对象
STRIPPED="$(intake_strip_credentials '{broken' 2>/dev/null || true)"
if echo "$STRIPPED" | jq -e '.suspects | length > 0' >/dev/null 2>&1; then
  t_pass "redact_failure_reports_suspect"
else
  t_fail "redact_failure_reports_suspect (expected suspects on bad input)"
fi

# scan.json 批次记录无明文（使用 batch-rf-01 的结果，不用被覆盖的 RESULT）
RESULT_01="$(run_scan "batch-rf-01-persist" "$SRC|cursor|project")"
echo "$RESULT_01" > "${SANDBOX}/rf-01-persist.json"
intake_batch_write_scan "$REPO" "batch-rf-01-persist" "$RESULT_01"
if [ -f "$REPO/.ai-workspace/intake/batches/batch-rf-01-persist/scan.json" ]; then
  expect_absent "$REPO/.ai-workspace/intake/batches/batch-rf-01-persist/scan.json" "LEAK_NESTED_SECRET" 'scan_record_no_plaintext'
else
  t_fail "scan_record_no_plaintext (record not found)"
fi

# ============================================================================
# 二、读取范围
# ============================================================================
echo ""
echo "--- 二、读取范围 ---"

# 越界链接到 HOME 未选子目录
mkdir -p "$FAKE_HOME/unselected-private"
echo 'title: secret-rule' > "$FAKE_HOME/unselected-private/secret-rule.mdc"
ln -sf "$FAKE_HOME/unselected-private/secret-rule.mdc" "$SRC/.cursor/rules/linked.mdc"

RESULT="$(run_scan "batch-rf-02" "$SRC|cursor|project")"
echo "$RESULT" > "${SANDBOX}/rf-02.json"

expect_json "$RESULT" '[.occurrences[] | select(.path | contains("linked")) | .read_status] | first' 'unsupported' 'home_link_rejected'
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("linked")) | .read_error] | first' 'link_out_of_scope' 'home_link_error_msg'
expect_absent "${SANDBOX}/rf-02.json" "secret-rule" 'home_content_not_read'

# 父目录软链接越界（.cursor 目录本身是指向越界的链接）
mkdir -p "$FAKE_HOME/outside-dir/rules"
echo 'title: outside-rule' > "$FAKE_HOME/outside-dir/rules/outside.mdc"
echo '{"mcpServers": {"outside": {"command": "OUTSIDE_CMD"}}}' > "$FAKE_HOME/outside-dir/mcp.json"
# 替换 .cursor 为符号链接（必须先删除原目录）
mv "$SRC/.cursor" "$SRC/.cursor.bak"
ln -sf "$FAKE_HOME/outside-dir" "$SRC/.cursor"
RESULT="$(run_scan "batch-rf-02b" "$SRC|cursor|project")"
echo "$RESULT" > "${SANDBOX}/rf-02b.json"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("outside")) | .read_status] | first' 'unsupported' 'parent_dir_link_rejected'
expect_absent "${SANDBOX}/rf-02b.json" "OUTSIDE_CMD" 'parent_dir_content_not_read'
expect_absent "${SANDBOX}/rf-02b.json" "outside-rule" 'parent_dir_rule_not_read'
# 恢复
rm -f "$SRC/.cursor"
mv "$SRC/.cursor.bak" "$SRC/.cursor"

# 合法链接（范围内）
ln -sf "$SRC/.cursor/rules/linked.mdc" "$SRC/.cursor/rules/valid-link.mdc"
RESULT="$(run_scan "batch-rf-02c" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("linked")) | .read_status] | first' 'unsupported' 'out_of_scope_still_rejected'

# 断链
ln -sf "$SRC/.cursor/rules/nonexistent-target" "$SRC/.cursor/rules/broken.mdc"
RESULT="$(run_scan "batch-rf-02d" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("broken")) | .read_status] | first' 'unreadable' 'broken_link_reported'

rm -f "$SRC/.cursor/rules/linked.mdc" "$SRC/.cursor/rules/broken.mdc"
rm -f "$SRC/.cursor/mcp.json"
echo '{"mcpServers": {}}' > "$SRC/.cursor/mcp.json"

# 全局来源只授权选定工具
mkdir -p "$FAKE_HOME/.cursor/rules" "$FAKE_HOME/.agents/skills"
printf '%s\n' '---' 'description: Global' '---' '# G' > "$FAKE_HOME/.cursor/rules/global-rule.mdc"
RESULT="$(run_scan "batch-rf-02e" "$FAKE_HOME|cursor|global")"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("global-rule")) | .read_status] | first' 'ok' 'selected_global_tool_scanned'

# ============================================================================
# 三、损坏 MCP 不伪装成功
# ============================================================================
echo ""
echo "--- 三、损坏 MCP ---"

# 损坏 JSON
echo '{broken-json' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-03a" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'malformed_json_parse_error'
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_error] | first' 'invalid_json' 'malformed_json_error_msg'

# 无效结构（无 mcpServers 键）
echo '{"wrong_key": {}}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-03b" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'missing_mcpServers_error'
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_error] | first' 'missing_mcpServers_key' 'missing_mcpServers_error_msg'

# 合法空配置
echo '{}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-03c" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'ok' 'empty_config_ok'

# 合法空 mcpServers
echo '{"mcpServers": {}}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-03d" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'ok' 'empty_servers_ok'

# TOML 成功路径
mkdir -p "$SRC/.codex"
cat > "$SRC/.codex/config.toml" << 'EOF'
[mcp_servers.test]
command = "node"
args = ["server.js"]
EOF
RESULT="$(run_scan "batch-rf-03e" "$SRC|codex|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'ok' 'toml_success_ok'

# TOML 无 mcp_servers 段：合法空配置（awk 解析器不报错）
echo '# just a comment' > "$SRC/.codex/config.toml"
RESULT="$(run_scan "batch-rf-03f" "$SRC|codex|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'ok' 'toml_empty_ok'

rm -rf "$SRC/.codex"
echo '{"mcpServers": {}}' > "$SRC/.cursor/mcp.json"

# 单个来源失败不丢弃其他结果
printf '%s\n' '---' 'description: Keep' '---' '# Keep' > "$SRC/.cursor/rules/keep.mdc"
echo '{broken' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-03g" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("keep"))] | length' '1' 'other_results_preserved'
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'mcp_error_still_reported'

# ============================================================================
# 四、手动路径含空格
# ============================================================================
echo ""
echo "--- 四、手动路径 ---"

mkdir -p "$SANDBOX/manual folder"
echo '# Manual rule with spaces' > "$SANDBOX/manual folder/my rule.md"
mkdir -p "$SANDBOX/skill dir/my skill"
printf '%s\n' '---' 'name: space-skill' '---' '# S' > "$SANDBOX/skill dir/my skill/SKILL.md"

RESULT="$(run_scan "batch-rf-04" "" "$SANDBOX/manual folder/my rule.md" "$SANDBOX/skill dir/my skill")"
echo "$RESULT" > "${SANDBOX}/rf-04.json"

expect_json "$RESULT" '[.occurrences[] | select(.path | contains("my rule")) | .read_status] | first' 'ok' 'manual_file_spaces_ok'
expect_json "$RESULT" '[.occurrences[] | select(.original_name == "my skill") | .read_status] | first' 'ok' 'manual_skill_spaces_ok'
expect_json "$RESULT" '.sources | length' '2' 'manual_sources_count'

# 多来源（含中文）
mkdir -p "$SANDBOX/中文目录"
echo '# 中文规则' > "$SANDBOX/中文目录/规则.md"
RESULT="$(run_scan "batch-rf-04b" "" "$SANDBOX/中文目录/规则.md")"
expect_json "$RESULT" '[.occurrences[] | select(.read_status == "ok")] | length' '1' 'chinese_path_ok'

# ============================================================================
# 五、规范源扫描
# ============================================================================
echo ""
echo "--- 五、规范源扫描 ---"

# 只有规范源，没有工具生成副本
CANON_SRC="${SANDBOX}/canon-src"
mkdir -p "$CANON_SRC/.ai-workspace/rules/domains" "$CANON_SRC/.ai-workspace/skills/my-skill" "$CANON_SRC/.ai-workspace/mcp"
printf '%s\n' '---' 'id: canon-rule' 'description: Test' '---' '# Canonical Rule' > "$CANON_SRC/.ai-workspace/rules/domains/canon-rule.md"
printf '%s\n' '---' 'name: canon-skill' '---' '# S' > "$CANON_SRC/.ai-workspace/skills/my-skill/SKILL.md"
echo '{"servers": {"canon-srv": {"command": "node"}}}' > "$CANON_SRC/.ai-workspace/mcp/mcp.json"

RESULT="$(run_scan "batch-rf-05" "$CANON_SRC|auto|project")"
echo "$RESULT" > "${SANDBOX}/rf-05.json"

expect_json "$RESULT" '[.occurrences[] | select(.tool == "canonical" and .asset_type == "rule") | .original_name] | first' 'canon-rule' 'canonical_rule_scanned'
expect_json "$RESULT" '[.occurrences[] | select(.tool == "canonical" and .asset_type == "skill") | .original_name] | first' 'my-skill' 'canonical_skill_scanned'
expect_json "$RESULT" '[.occurrences[] | select(.tool == "canonical" and .asset_type == "mcp") | .read_status] | first' 'ok' 'canonical_mcp_scanned'

# 规范源与生成副本共存
mkdir -p "$CANON_SRC/.cursor/rules"
printf '%s\n' '---' '# Generated by AI Workspace - DO NOT EDIT MANUALLY' '---' '# Gen' > "$CANON_SRC/.cursor/rules/gen.mdc"
RESULT="$(run_scan "batch-rf-05b" "$CANON_SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.tool == "canonical")] | length' '3' 'canonical_with_generated_coexist'
expect_json "$RESULT" '[.occurrences[] | select(.is_generated_copy == true)] | length' '1' 'generated_copy_flagged'

# 规范源不修改来源文件（显式选择哈希工具，不依赖 pipeline 尾部成功）
HASH_TOOL=""
if command -v sha256sum >/dev/null 2>&1; then HASH_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then HASH_TOOL="shasum -a 256"
elif command -v md5sum >/dev/null 2>&1; then HASH_TOOL="md5sum"
elif command -v md5 >/dev/null 2>&1; then HASH_TOOL="md5"
fi
if [ -n "$HASH_TOOL" ]; then
  t_pass "hash_tool_available"
else
  t_fail "hash_tool_available (no hash tool found)"
fi

BEFORE="$(find "$CANON_SRC" -type f | sort | while IFS= read -r f; do printf '%s %s\n' "$($HASH_TOOL < "$f" | awk '{print $1}')" "$f"; done)"
run_scan "batch-rf-05c" "$CANON_SRC|auto|project" >/dev/null
AFTER="$(find "$CANON_SRC" -type f | sort | while IFS= read -r f; do printf '%s %s\n' "$($HASH_TOOL < "$f" | awk '{print $1}')" "$f"; done)"
if [ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ]; then
  t_pass "canonical_scan_readonly"
else
  t_fail "canonical_scan_readonly (before=[$BEFORE] after=[$AFTER])"
fi

# 文件集合非空且包含预期文件
MANIFEST="$(intake_skill_manifest "$CANON_SRC/.ai-workspace/skills/my-skill" 2>/dev/null)"
if [ -n "$MANIFEST" ] && echo "$MANIFEST" | grep -q "SKILL.md"; then
  t_pass "skill_manifest_nonempty"
else
  t_fail "skill_manifest_nonempty (manifest=[$MANIFEST])"
fi

# ============================================================================
# 七、非字符串敏感值脱敏
# ============================================================================
echo ""
echo "--- 七、非字符串敏感值 ---"

cat > "$SRC/.cursor/mcp.json" << 'EOF'
{
  "mcpServers": {
    "nonstr": {
      "TOKEN": ["SYNTHETIC_SECRET_ARRAY"],
      "API_KEY": {"value": "SYNTHETIC_SECRET_OBJ"},
      "authorization": {"value": "SYNTHETIC_SECRET_AUTH"},
      "COUNT": 42,
      "ENABLED": true,
      "NORMAL": "keep-me"
    }
  }
}
EOF
RESULT="$(run_scan "batch-rf-07" "$SRC|cursor|project")"
echo "$RESULT" > "${SANDBOX}/rf-07.json"

expect_absent "${SANDBOX}/rf-07.json" "SYNTHETIC_SECRET_ARRAY" 'nonstring_array_redacted'
expect_absent "${SANDBOX}/rf-07.json" "SYNTHETIC_SECRET_OBJ" 'nonstring_object_redacted'
expect_absent "${SANDBOX}/rf-07.json" "SYNTHETIC_SECRET_AUTH" 'nonstring_auth_redacted'
expect_present "${SANDBOX}/rf-07.json" '"keep-me"' 'nonstring_normal_preserved'

# 持久化结果也无明文
intake_batch_write_scan "$REPO" "batch-rf-07" "$RESULT"
if [ -f "$REPO/.ai-workspace/intake/batches/batch-rf-07/scan.json" ]; then
  expect_absent "$REPO/.ai-workspace/intake/batches/batch-rf-07/scan.json" "SYNTHETIC_SECRET" 'nonstring_persist_no_plaintext'
else
  t_fail "nonstring_persist_no_plaintext (record not found)"
fi

# ============================================================================
# 八、MCP 结构验证
# ============================================================================
echo ""
echo "--- 八、MCP 结构验证 ---"

# mcpServers 为字符串
echo '{"mcpServers": "abc"}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-08a" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'mcpServers_string_error'

# mcpServers 为数组
echo '{"mcpServers": []}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-08b" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'mcpServers_array_error'

# server 配置为字符串
echo '{"mcpServers": {"bad": "not-an-object"}}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-08c" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'server_config_string_error'

# 合法空配置
echo '{"mcpServers": {}}' > "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-08d" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'ok' 'empty_servers_ok'

# 坏来源与好来源同时扫描
echo '{broken' > "$SRC/.cursor/mcp.json"
printf '%s\n' '---' 'description: Keep' '---' '# Keep' > "$SRC/.cursor/rules/keep.mdc"
RESULT="$(run_scan "batch-rf-08e" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("keep")) | .read_status] | first' 'ok' 'good_source_survives_bad_mcp'
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'parse_error' 'bad_mcp_still_reported'

# ============================================================================
# 九、手动路径授权范围
# ============================================================================
echo ""
echo "--- 九、手动路径授权 ---"

# 含空格路径：兄弟目录不应被授权
mkdir -p "$SANDBOX/manual folder" "$SANDBOX/outside"
echo '# Manual rule' > "$SANDBOX/manual folder/my rule.md"
echo 'title: outside-secret' > "$SANDBOX/outside/secret.mdc"
ln -sf "$SANDBOX/outside/secret.mdc" "$SANDBOX/manual folder/link.mdc"
RESULT="$(run_scan "batch-rf-09" "" "$SANDBOX/manual folder/my rule.md")"
echo "$RESULT" > "${SANDBOX}/rf-09.json"
expect_json "$RESULT" '[.occurrences[] | select(.path | contains("my rule")) | .read_status] | first' 'ok' 'manual_file_spaces_ok'
expect_absent "${SANDBOX}/rf-09.json" "outside-secret" 'sibling_not_authorized'

# ============================================================================
# 十、--preview 纯预览
# ============================================================================
echo ""
echo "--- 十、--preview ---"

PREVIEW_REPO="${SANDBOX}/preview-repo"
mkdir -p "$PREVIEW_REPO/.ai-workspace/rules" "$PREVIEW_REPO/.ai-workspace/mcp"
echo '{"servers":{}}' > "$PREVIEW_REPO/.ai-workspace/mcp/mcp.json"
printf '%s\n' '---' 'description: Preview' '---' '# P' > "$SRC/.cursor/rules/preview.mdc"

# 纯预览：输出 JSON，不写批次
PREVIEW_OUT="$("${SCRIPT_DIR}/../aiws" intake scan --repo "$PREVIEW_REPO" --source "$SRC:cursor:project" --preview --json 2>/dev/null)"
if [ -n "$PREVIEW_OUT" ] && printf '%s' "$PREVIEW_OUT" | jq -e '.schema' >/dev/null 2>&1; then
  t_pass "preview_outputs_json"
else
  t_fail "preview_outputs_json"
fi

# 预览后无批次目录
if [ ! -d "$PREVIEW_REPO/.ai-workspace/intake/batches" ]; then
  t_pass "preview_no_batch_persisted"
else
  t_fail "preview_no_batch_persisted"
fi

# 来源文件不变
PREVIEW_BEFORE="$(find "$SRC" -type f | sort | while IFS= read -r f; do printf '%s %s\n' "$($HASH_TOOL < "$f" | awk '{print $1}')" "$f"; done)"
"${SCRIPT_DIR}/../aiws" intake scan --repo "$PREVIEW_REPO" --source "$SRC:cursor:project" --preview --json >/dev/null 2>&1
PREVIEW_AFTER="$(find "$SRC" -type f | sort | while IFS= read -r f; do printf '%s %s\n' "$($HASH_TOOL < "$f" | awk '{print $1}')" "$f"; done)"
if [ "$PREVIEW_BEFORE" = "$PREVIEW_AFTER" ]; then
  t_pass "preview_no_source_change"
else
  t_fail "preview_no_source_change"
fi

# ============================================================================
# 汇总
# ============================================================================
echo ""
echo "=== 结果: ${PASS} ok, ${FAIL} not ok ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
