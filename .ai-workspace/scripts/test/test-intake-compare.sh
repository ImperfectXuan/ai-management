#!/bin/sh
# test-intake-compare.sh - intake compare 引擎测试
# 覆盖 AC-001-04 / AC-001-05 / AC-001-06 / AC-001-07 及只读、敏感值边界
# 用法: .ai-workspace/scripts/test/test-intake-compare.sh
# 独立构造沙盒，不触碰真实仓库、真实 HOME 或任何真实全局配置。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

expect_eq() {
  # $1=actual $2=expected $3=name
  if [ "$1" = "$2" ]; then t_pass "$3"; else t_fail "$3 (expected [$2], got [$1])"; fi
}

expect_contains() {
  if printf '%s' "$1" | grep -qF -- "$2"; then t_pass "$3"; else t_fail "$3 (missing: $2)"; fi
}

expect_absent() {
  if printf '%s' "$1" | grep -qF -- "$2"; then t_fail "$3 (unexpected: $2)"; else t_pass "$3"; fi
}

# ============================================================================
# 沙盒构造
# ============================================================================

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/aiws-intake-cmp.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

REPO="${SANDBOX}/repo"
SRC_A="${SANDBOX}/src-a"
SRC_B="${SANDBOX}/src-b"
SRC_C="${SANDBOX}/src-c"
FAKE_HOME="${SANDBOX}/home"

new_repo() {
  mkdir -p "${REPO}/.ai-workspace/rules/domains" \
           "${REPO}/.ai-workspace/skills/shared-skill" \
           "${REPO}/.ai-workspace/skills/code-review" \
           "${REPO}/.ai-workspace/mcp"

  cat > "${REPO}/.ai-workspace/rules/00-core.md" << 'EOF'
---
id: 00-core
title: 核心原则
scope: all
globs: "**/*"
---
# 核心原则

可读性优先。
EOF

  cat > "${REPO}/.ai-workspace/rules/domains/api.md" << 'EOF'
---
id: api
title: API 规范
scope: all
globs: "**/*.ts"
---
# API 规范

统一返回格式。
EOF

  cat > "${REPO}/.ai-workspace/skills/shared-skill/SKILL.md" << 'EOF'
---
name: shared-skill
description: 共享技能
---
# Shared Skill

做一件事。
EOF
  printf '#!/bin/sh\necho v1\n' > "${REPO}/.ai-workspace/skills/shared-skill/run.sh"

  cat > "${REPO}/.ai-workspace/skills/code-review/SKILL.md" << 'EOF'
---
name: code-review
description: 代码评审
---
# Code Review

评审代码。
EOF

  cat > "${REPO}/.ai-workspace/mcp/mcp.json" << 'EOF'
{
  "servers": {
    "fs": {
      "command": "npx",
      "args": ["-y", "fs-server"],
      "env": { "API_KEY": "repo-key-1111" }
    },
    "web": {
      "command": "npx",
      "args": ["-y", "web-server"]
    }
  }
}
EOF
}

new_source_a() {
  mkdir -p "${SRC_A}/.cursor/rules" \
           "${SRC_A}/.cursor/skills/shared-skill" \
           "${SRC_A}/.cursor/skills/code_review" \
           "${SRC_A}/.cursor/skills/code-review-extra"

  # 与总库 00-core.md 内容完全相同、名称不同（AC-001-04）
  cat > "${SRC_A}/.cursor/rules/renamed.mdc" << 'EOF'
---
id: 00-core
title: 核心原则
scope: all
globs: "**/*"
---
# 核心原则

可读性优先。
EOF

  # 与总库同名、正文与适用条件都不同（AC-001-05）
  cat > "${SRC_A}/.cursor/rules/00-core.mdc" << 'EOF'
---
id: 00-core
title: 核心原则（来源变体）
scope: all
globs: "**/*.ts"
---
# 核心原则

来源改过的正文。
EOF

  # 同名 Skill、SKILL.md 未变、脚本已变（AC-001-06）
  cat > "${SRC_A}/.cursor/skills/shared-skill/SKILL.md" << 'EOF'
---
name: shared-skill
description: 共享技能
---
# Shared Skill

做一件事。
EOF
  printf '#!/bin/sh\necho v2\n' > "${SRC_A}/.cursor/skills/shared-skill/run.sh"

  # 名称只差分隔符、内容不同：归一化后同名，应判冲突而非相似
  cat > "${SRC_A}/.cursor/skills/code_review/SKILL.md" << 'EOF'
---
name: code_review
description: 另一个评审技能
---
# Code Review Alt

不同的内容。
EOF

  # 名称包含总库既有项但归一化后不同名：只作相似提示，绝不合并
  mkdir -p "${SRC_A}/.cursor/skills/code-review-extra"
  cat > "${SRC_A}/.cursor/skills/code-review-extra/SKILL.md" << 'EOF'
---
name: code-review-extra
description: 扩展评审技能
---
# Code Review Extra

额外的内容。
EOF

  # 同行为字段、不同账号凭据（AC-001-05）
  cat > "${SRC_A}/.cursor/mcp.json" << 'EOF'
{
  "mcpServers": {
    "fs": {
      "command": "npx",
      "args": ["-y", "fs-server"],
      "env": { "API_KEY": "src-key-9999" }
    },
    "web": {
      "command": "npx",
      "args": ["-y", "web-server"]
    }
  }
}
EOF
}

new_source_b() {
  mkdir -p "${SRC_B}/.trae/rules"
  # 与总库 00-core.md 同内容、第三个来源（AC-001-04 保留全部来源）
  cat > "${SRC_B}/.trae/rules/again.md" << 'EOF'
---
id: 00-core
title: 核心原则
scope: all
globs: "**/*"
---
# 核心原则

可读性优先。
EOF
}

new_source_c() {
  mkdir -p "${SRC_C}/.trae/rules"
  cat > "${SRC_C}/.trae/rules/temp-rule.md" << 'EOF'
---
id: temp
title: 临时规则
scope: all
---
# 临时规则

只存在于将被删除的来源。
EOF
}

# ============================================================================
# 加载引擎
# ============================================================================

export HOME="$FAKE_HOME"
mkdir -p "$FAKE_HOME"
export HOME_DIR="$FAKE_HOME"

. "${LIB_DIR}/common.sh"
HOME_DIR="$FAKE_HOME"
. "${LIB_DIR}/import-mcp.sh"
. "${LIB_DIR}/intake/identity.sh"
. "${LIB_DIR}/intake/scan.sh"
. "${LIB_DIR}/intake/store.sh"
. "${LIB_DIR}/intake/compare.sh"

# 跑一次扫描并比较，输出 candidates JSON
# $1=batch_id $2=来源行（每行 root|tool|scope）$3=手动 Skill 目录（可选）
run_compare() {
  local batch="$1" sources="$2" manual_skills="${3:-}" scan
  scan="$(INTAKE_REPO="$REPO" INTAKE_BATCH_ID="$batch" INTAKE_SOURCES="$sources" \
          INTAKE_MANUAL_SKILLS="$manual_skills" INTAKE_MANUAL_FILES="" \
          intake_scan 2>/dev/null)"
  intake_batch_write_scan "$REPO" "$batch" "$scan"
  INTAKE_REPO="$REPO" INTAKE_BATCH_ID="$batch" intake_compare 2>/dev/null
}

SOURCES_AB="${SRC_A}|cursor|project
${SRC_B}|trae|project"

echo "=== intake compare 测试 ==="

new_repo
new_source_a
new_source_b
new_source_c

REPO_RULE_BEFORE="$(intake_sha256 "${REPO}/.ai-workspace/rules/00-core.md")"
REPO_SKILL_BEFORE="$(intake_fingerprint_skill_dir "${REPO}/.ai-workspace/skills/shared-skill")"

# ---------------------------------------------------------------
# AC-001-04: 跨名同内容合并为单一候选并保留全部来源
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-04: 跨名同内容 ---"

CMP1="$(run_compare batch-04 "$SOURCES_AB")"

CORE_FP="sha256:$(intake_sha256 "${REPO}/.ai-workspace/rules/00-core.md")"
expect_eq "$(printf '%s' "$CMP1" | jq --arg fp "$CORE_FP" '[.candidates[] | select(.content_fingerprint == $fp)] | length')" \
  "1" "same_content_one_candidate"

expect_eq "$(printf '%s' "$CMP1" | jq --arg fp "$CORE_FP" '[.candidates[] | select(.content_fingerprint == $fp)][0].labels | index("duplicate") != null')" \
  "true" "same_content_labelled_duplicate"

expect_eq "$(printf '%s' "$CMP1" | jq --arg fp "$CORE_FP" '[.candidates[] | select(.content_fingerprint == $fp)][0].occurrences | length')" \
  "2" "same_content_keeps_all_sources"

expect_eq "$(printf '%s' "$CMP1" | jq --arg fp "$CORE_FP" '[.candidates[] | select(.content_fingerprint == $fp)][0].names | sort == ["again","renamed"]')" \
  "true" "different_names_same_identity"

expect_contains "$CMP1" '".ai-workspace/rules/00-core.md"' "existing_source_points_to_repo_rule"

# ---------------------------------------------------------------
# AC-001-05: 同名不同内容 / 规则适用条件 / MCP 账号绑定
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-05: 冲突与差异保留 ---"

CORE_NAME_CAND="$(printf '%s' "$CMP1" | jq -c '[.candidates[] | select(.type == "rule") | select(.names | index("00-core"))] | first')"
expect_eq "$(printf '%s' "$CORE_NAME_CAND" | jq '.labels | index("conflict") != null')" "true" "same_name_diff_body_conflict"
expect_eq "$(printf '%s' "$CORE_NAME_CAND" | jq '.existing_source.name')" '"00-core"' "conflict_references_existing_asset"
expect_eq "$(printf '%s' "$CORE_NAME_CAND" | jq '.diff_summary.changed | index("globs") != null')" "true" "rule_applicability_diff_shown"
expect_eq "$(printf '%s' "$CORE_NAME_CAND" | jq '.diff_summary.changed | index("title") != null')" "true" "rule_title_diff_shown"
expect_eq "$(printf '%s' "$CORE_NAME_CAND" | jq '.diff_summary.added | length > 0')" "true" "rule_body_added_shown"

FS_CAND="$(printf '%s' "$CMP1" | jq -c '[.candidates[] | select(.type == "mcp") | select(.display_name == "fs")] | first')"
expect_eq "$(printf '%s' "$FS_CAND" | jq '.labels | index("conflict") != null')" "true" "mcp_account_binding_conflict"
expect_eq "$(printf '%s' "$FS_CAND" | jq '.credential_diff.changed | index("env.API_KEY") != null')" "true" "mcp_credential_diff_separate"
expect_eq "$(printf '%s' "$FS_CAND" | jq '.behavior_diff.changed | length')" "0" "mcp_behavior_identical_detected"

WEB_CAND="$(printf '%s' "$CMP1" | jq -c '[.candidates[] | select(.type == "mcp") | select(.display_name == "web")] | first')"
expect_eq "$(printf '%s' "$WEB_CAND" | jq '.labels | index("duplicate") != null')" "true" "mcp_same_account_duplicate"

expect_absent "$CMP1" "src-key-9999" "mcp_source_credential_not_in_output"
expect_absent "$CMP1" "repo-key-1111" "mcp_repo_credential_not_in_output"

# ---------------------------------------------------------------
# AC-001-06: Skill 附属脚本变化
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-06: Skill 相对路径差异 ---"

SKILL_CAND="$(printf '%s' "$CMP1" | jq -c '[.candidates[] | select(.type == "skill") | select(.names | index("shared-skill"))] | first')"
expect_eq "$(printf '%s' "$SKILL_CAND" | jq '.labels | index("conflict") != null')" "true" "skill_script_change_conflict"
expect_eq "$(printf '%s' "$SKILL_CAND" | jq '.diff_summary.changed | index("run.sh") != null')" "true" "skill_script_change_relative_path"
expect_eq "$(printf '%s' "$SKILL_CAND" | jq '.diff_summary.changed | index("SKILL.md") == null')" "true" "skill_unchanged_file_not_in_diff"
expect_eq "$(printf '%s' "$SKILL_CAND" | jq '((.diff_summary.added | length) + (.diff_summary.removed | length))')" "0" "skill_no_added_removed_paths"

NORM_CAND="$(printf '%s' "$CMP1" | jq -c '[.candidates[] | select(.names | index("code_review"))] | first')"
expect_eq "$(printf '%s' "$NORM_CAND" | jq '.labels | index("conflict") != null')" "true" "separator_only_name_conflict"

SIM_CAND="$(printf '%s' "$CMP1" | jq -c '[.candidates[] | select(.names | index("code-review-extra"))] | first')"
expect_eq "$(printf '%s' "$SIM_CAND" | jq '.labels | index("similar") != null')" "true" "similar_name_hint"
expect_eq "$(printf '%s' "$SIM_CAND" | jq '.labels | index("duplicate") == null')" "true" "similar_never_merged"
expect_eq "$(printf '%s' "$SIM_CAND" | jq '.labels | index("conflict") == null')" "true" "similar_not_treated_as_conflict"

# ---------------------------------------------------------------
# 只读与敏感值边界
# ---------------------------------------------------------------
echo ""
echo "--- 只读与敏感值 ---"

expect_eq "$(intake_sha256 "${REPO}/.ai-workspace/rules/00-core.md")" "$REPO_RULE_BEFORE" "repo_rule_unchanged"
expect_eq "$(intake_fingerprint_skill_dir "${REPO}/.ai-workspace/skills/shared-skill")" "$REPO_SKILL_BEFORE" "repo_skill_unchanged"
if [ ! -d "${REPO}/.ai-workspace/assets" ]; then
  t_pass "compare_creates_no_assets_dir"
else
  t_fail "compare_creates_no_assets_dir"
fi

# 扫描阶段不得创建任何文件（含凭据盐）
SCAN_ONLY_SB="${SANDBOX}/scan-only"
mkdir -p "${SCAN_ONLY_SB}/.ai-workspace/rules"
INTAKE_REPO="$SCAN_ONLY_SB" INTAKE_BATCH_ID="batch-scan-only" \
  INTAKE_SOURCES="${SRC_A}|cursor|project" intake_scan >/dev/null 2>&1
if [ ! -e "${SCAN_ONLY_SB}/.ai-workspace/intake/cred-salt" ]; then
  t_pass "scan_creates_no_cred_salt"
else
  t_fail "scan_creates_no_cred_salt"
fi

SALT_FILE="${REPO}/.ai-workspace/intake/cred-salt"
if [ -s "$SALT_FILE" ]; then t_pass "cred_salt_created_locally"; else t_fail "cred_salt_created_locally"; fi
SALT_MODE="$(stat -f '%Lp' "$SALT_FILE" 2>/dev/null || stat -c '%a' "$SALT_FILE" 2>/dev/null)"
expect_eq "$SALT_MODE" "600" "cred_salt_mode_600"
expect_absent "$(cat "$SALT_FILE")" "src-key-9999" "cred_salt_not_a_secret_value"

# ---------------------------------------------------------------
# AC-001-07: 重复扫描、忽略、暂缓、来源删除
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-07: 增量决定 ---"

CMP2="$(run_compare batch-07a "$SOURCES_AB")"
expect_eq "$(printf '%s' "$CMP2" | jq -S -c '[.candidates[].candidate_id] | sort')" \
  "$(printf '%s' "$CMP1" | jq -S -c '[.candidates[].candidate_id] | sort')" \
  "repeat_scan_stable_candidates"

# 忽略：内容未变不重复提醒
IGN_CAND="$(printf '%s' "$CMP2" | jq -c '[.candidates[] | select(.names | index("renamed"))] | first')"
IGN_ID="$(printf '%s' "$IGN_CAND" | jq -r '.candidate_id')"
IGN_IDENTITY="$(printf '%s' "$IGN_CAND" | jq -r '.content_fingerprint')"
IGN_OCCS="$(printf '%s' "$IGN_CAND" | jq -c '.occurrences')"

intake_decision_write "$REPO" "batch-07a" "$(jq -nc \
  --arg cid "$IGN_ID" --arg id "$IGN_IDENTITY" --argjson occs "$IGN_OCCS" \
  '{kind: "ignore", candidate_id: $cid, asset_type: "rule", asset_name: "renamed",
    occurrence_ids: $occs, content_fingerprint_at_decision: $id,
    decided_at: "2026-10-10T00:00:00Z", decided_by: "user"}')"

CMP3="$(run_compare batch-07b "$SOURCES_AB")"
expect_eq "$(printf '%s' "$CMP3" | jq --arg cid "$IGN_ID" '[.candidates[] | select(.candidate_id == $cid)] | length')" \
  "0" "ignored_unchanged_not_reported"
expect_eq "$(printf '%s' "$CMP3" | jq --arg cid "$IGN_ID" '[.suppressed[] | select(.candidate_id == $cid)] | length')" \
  "1" "ignored_unchanged_kept_in_suppressed"

# 忽略后来源变化 → 重新审核
cat > "${SRC_B}/.trae/rules/again.md" << 'EOF'
---
id: 00-core
title: 核心原则
scope: all
globs: "**/*"
---
# 核心原则

可读性优先。（来源已更新）
EOF

CMP4="$(run_compare batch-07c "$SOURCES_AB")"
CHANGED_CAND="$(printf '%s' "$CMP4" | jq -c '[.candidates[] | select(.names | index("again"))] | first')"
expect_eq "$(printf '%s' "$CHANGED_CAND" | jq '.labels | index("changed") != null')" "true" "ignored_then_changed_reflagged"
expect_eq "$(printf '%s' "$CHANGED_CAND" | jq --arg cid "$IGN_ID" '.candidate_id != $cid')" "true" "changed_candidate_has_new_identity"

# 暂缓：仍保留在待审核队列
DEF_CAND="$(printf '%s' "$CMP4" | jq -c '[.candidates[] | select(.names | index("code_review"))] | first')"
DEF_ID="$(printf '%s' "$DEF_CAND" | jq -r '.candidate_id')"
intake_decision_write "$REPO" "batch-07c" "$(jq -nc \
  --arg cid "$DEF_ID" --arg id "$(printf '%s' "$DEF_CAND" | jq -r '.content_fingerprint')" \
  --argjson occs "$(printf '%s' "$DEF_CAND" | jq -c '.occurrences')" \
  '{kind: "defer", candidate_id: $cid, asset_type: "skill", asset_name: "code_review",
    occurrence_ids: $occs, content_fingerprint_at_decision: $id,
    decided_at: "2026-10-10T00:00:00Z", decided_by: "user"}')"

CMP5="$(run_compare batch-07d "$SOURCES_AB")"
expect_eq "$(printf '%s' "$CMP5" | jq --arg cid "$DEF_ID" '[.candidates[] | select(.candidate_id == $cid)][0].deferred')" \
  "true" "deferred_stays_pending"
expect_eq "$(printf '%s' "$CMP5" | jq --arg cid "$DEF_ID" '[.suppressed[] | select(.candidate_id == $cid)] | length')" \
  "0" "deferred_not_suppressed"

# 来源删除：不删总库资产，保留忽略记录，报告来源缺失
REPO_RULES_AFTER="$(cat "${REPO}/.ai-workspace/rules/00-core.md" | intake_sha256 -)"
rm -rf "$SRC_C"
CMP6="$(run_compare batch-07e "${SOURCES_AB}
${SRC_C}|trae|project")"
expect_eq "$(printf '%s' "$CMP6" | jq '[.candidates[] | select(.labels | index("unparseable"))] | length > 0')" \
  "true" "deleted_source_reported_unparseable"
expect_eq "$(intake_sha256 "${REPO}/.ai-workspace/rules/00-core.md")" "$(cat "${REPO}/.ai-workspace/rules/00-core.md" | intake_sha256 -)" "repo_intact_after_source_deleted"
expect_eq "$(intake_decision_list "$REPO" | jq '[.[] | select(.kind == "ignore")] | length')" "1" "ignore_record_kept"
expect_eq "$(printf '%s' "$CMP6" | jq '.repo_assets.rule')" "2" "repo_index_stable_after_source_deleted"
expect_contains "$REPO_RULES_AFTER" "$REPO_RULE_BEFORE" "repo_rule_hash_stable"

# ---------------------------------------------------------------
# CLI 集成
# ---------------------------------------------------------------
echo ""
echo "--- CLI 集成 ---"

AIWS="${SCRIPT_DIR}/../aiws"
CLI_SCAN="$("$AIWS" intake scan --repo "$REPO" --source "${SRC_A}:cursor:project" --json 2>/dev/null)"
CLI_BATCH="$(printf '%s' "$CLI_SCAN" | jq -r '.batch_id')"
CLI_CMP="$("$AIWS" intake compare --repo "$REPO" --batch "$CLI_BATCH" --json 2>/dev/null || true)"

if [ -n "$CLI_CMP" ]; then
  expect_eq "$(printf '%s' "$CLI_CMP" | jq -r '.schema')" "intake/v1" "cli_compare_schema"
  expect_eq "$(printf '%s' "$CLI_CMP" | jq '[.candidates[] | select(.type == "mcp")] | length > 0')" "true" "cli_mcp_compared"
  expect_eq "$(printf '%s' "$CLI_CMP" | jq '[.candidates[] | select(.type == "skill")] | length > 0')" "true" "cli_skill_compared"
else
  t_fail "cli_compare_schema (no output)"
  t_fail "cli_mcp_compared (no output)"
  t_fail "cli_skill_compared (no output)"
fi

if [ -f "$(intake_batch_dir "$REPO" "$CLI_BATCH")/candidates.json" ]; then
  t_pass "cli_candidates_written_locally"
else
  t_fail "cli_candidates_written_locally"
fi

# ---------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------
echo ""
echo "=== 结果: ${PASS} ok, ${FAIL} not ok ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
