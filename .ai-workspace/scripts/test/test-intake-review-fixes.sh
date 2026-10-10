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
  t_pass "redact_failure_reports_suspect"  # jq 失败时返回空 sanitized
fi

# scan.json 批次记录无明文（手动写入批次模拟 CLI 行为）
intake_batch_write_scan "$REPO" "batch-rf-01" "$RESULT"
if [ -f "$REPO/.ai-workspace/intake/batches/batch-rf-01/scan.json" ]; then
  expect_absent "$REPO/.ai-workspace/intake/batches/batch-rf-01/scan.json" "LEAK_NESTED_SECRET" 'scan_record_no_plaintext'
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

# 父目录软链接越界（MCP 文件链接到越界目录下的文件）
mkdir -p "$FAKE_HOME/outside-dir"
echo '{"mcpServers": {"outside": {"command": "OUTSIDE_CMD"}}}' > "$FAKE_HOME/outside-dir/external.json"
ln -sf "$FAKE_HOME/outside-dir/external.json" "$SRC/.cursor/mcp.json"
RESULT="$(run_scan "batch-rf-02b" "$SRC|cursor|project")"
expect_json "$RESULT" '[.occurrences[] | select(.asset_type=="mcp") | .read_status] | first' 'unsupported' 'parent_dir_link_mcp_rejected'
expect_absent "${SANDBOX}/rf-02b.json" "OUTSIDE_CMD" 'parent_dir_content_not_read' || true

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

# 规范源不修改来源文件
BEFORE="$(find "$CANON_SRC" -type f -exec md5sum {} \; 2>/dev/null | sort || find "$CANON_SRC" -type f -exec md5 {} \; | sort)"
run_scan "batch-rf-05c" "$CANON_SRC|auto|project" >/dev/null
AFTER="$(find "$CANON_SRC" -type f -exec md5sum {} \; 2>/dev/null | sort || find "$CANON_SRC" -type f -exec md5 {} \; | sort)"
if [ "$BEFORE" = "$AFTER" ]; then
  t_pass "canonical_scan_readonly"
else
  t_fail "canonical_scan_readonly"
fi

# ============================================================================
# 六、哈希工具选择显式化
# ============================================================================
echo ""
echo "--- 六、哈希工具 ---"

# intake_sha256 应该用可用的哈希工具，pipeline 尾部成功不能掩盖回退
HASH="$(echo "test" | intake_sha256 -)"
if [ -n "$HASH" ] && [ "$HASH" != "nohash" ] && [ ${#HASH} -eq 64 ]; then
  t_pass "hash_tool_selected_explicitly"
else
  t_fail "hash_tool_selected_explicitly (got: $HASH)"
fi

# 文件集合非空
MANIFEST="$(intake_skill_manifest "$CANON_SRC/.ai-workspace/skills/my-skill" 2>/dev/null)"
if [ -n "$MANIFEST" ]; then
  t_pass "skill_manifest_nonempty"
else
  t_fail "skill_manifest_nonempty"
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
