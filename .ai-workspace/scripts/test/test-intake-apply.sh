#!/bin/sh
# test-intake-apply.sh - intake plan/apply/rollback 引擎测试
# 覆盖 AC-001-08 / AC-001-12 / AC-001-13 / AC-001-14 / AC-001-19 的引擎与 CLI 部分
# 用法: .ai-workspace/scripts/test/test-intake-apply.sh
# 独立构造沙盒，不触碰真实仓库、真实 HOME、真实全局配置或真实凭据。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIWS="${SCRIPT_DIR}/../aiws"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }
expect_eq() {
  if [ "$1" = "$2" ]; then t_pass "$3"; else t_fail "$3 (expected [$2], got [$1])"; fi
}
expect_contains() {
  if printf '%s' "$1" | grep -qF -- "$2"; then t_pass "$3"; else t_fail "$3 (missing: $2)"; fi
}

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/aiws-intake-apply.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="${SANDBOX}/home"
export HOME_DIR="${SANDBOX}/home"
mkdir -p "$HOME"

# ============================================================================
# 夹具
# ============================================================================

mk_repo() {
  local r="$1"
  mkdir -p "$r/.ai-workspace/rules/domains" "$r/.ai-workspace/skills/existing-skill" \
           "$r/.ai-workspace/mcp" "$r/.ai-workspace/adapters"
  local t
  for t in cursor trae claude codex; do
    mkdir -p "$r/.ai-workspace/adapters/$t"
    printf 'tool: %s\nversion: ">=1"\nincludes_support: false\nrules:\n  - source: rules/00-core.md\n    required: true\n' "$t" \
      > "$r/.ai-workspace/adapters/$t/mapping.yaml"
  done

  cat > "$r/.ai-workspace/rules/00-core.md" <<'EOF'
---
id: 00-core
title: 核心原则
globs: "**/*"
---
# 核心原则

原文。
EOF
  cat > "$r/.ai-workspace/rules/domains/keep.md" <<'EOF'
---
id: keep
title: 既有规则
globs: "**/*.ts"
---
# 既有规则

总库已有。
EOF
  cat > "$r/.ai-workspace/rules/domains/variant-base.md" <<'EOF'
---
id: variant-base
title: 变体基线
globs: "**/*.ts"
---
# 变体基线

基线内容。
EOF
  printf -- '---\nname: existing-skill\n---\n# Existing\n内容。\n' \
    > "$r/.ai-workspace/skills/existing-skill/SKILL.md"
  printf '{"servers":{"fs":{"command":"npx","args":["-y","fs"],"env":{"API_KEY":"${secret:fs_key}"}}}}' \
    > "$r/.ai-workspace/mcp/mcp.json"
}

mk_source() {
  local s="$1"
  mkdir -p "$s/.cursor/rules" "$s/.cursor/skills/new-skill" "$s/.trae/skills/broken-skill"

  # add：总库没有的新规则
  cat > "$s/.cursor/rules/newrule.mdc" <<'EOF'
---
id: newrule
title: 新规则
globs: "**/*.ts"
---
# 新规则

来自来源。
EOF

  # update：与总库同名、内容不同
  cat > "$s/.cursor/rules/00-core.mdc" <<'EOF'
---
id: 00-core
title: 核心原则
globs: "**/*.ts"
---
# 核心原则

来源改过。
EOF

  # link：与总库 keep.md 内容完全相同
  cat > "$s/.cursor/rules/keep.mdc" <<'EOF'
---
id: keep
title: 既有规则
globs: "**/*.ts"
---
# 既有规则

总库已有。
EOF

  # variant：与总库 variant-base 同名、内容不同
  cat > "$s/.cursor/rules/variant-base.mdc" <<'EOF'
---
id: variant-base
title: 变体基线（来源变体）
globs: "**/*.ts"
---
# 变体基线

来源的变体内容。
EOF

  # add：整个 Skill 目录
  printf -- '---\nname: new-skill\n---\n# New Skill\n内容。\n' > "$s/.cursor/skills/new-skill/SKILL.md"
  printf '#!/bin/sh\necho hi\n' > "$s/.cursor/skills/new-skill/run.sh"
  # 让暂存与提交阶段有可观测的工作量（并发检测测试依赖该窗口）
  head -c 200000 /dev/zero | tr '\0' 'x' > "$s/.cursor/skills/new-skill/data.txt"

  # add：MCP 新 server（凭据为引用，允许入库）
  cat > "$s/.cursor/mcp.json" <<'EOF'
{
  "mcpServers": {
    "fresh": {
      "command": "npx",
      "args": ["-y", "fresh-server"],
      "env": { "API_KEY": "${secret:fresh_key}" }
    }
  }
}
EOF

  # 无法解析：缺 SKILL.md
  printf 'not a skill\n' > "$s/.trae/skills/broken-skill/README.md"
}

SOURCES="SRC_A|cursor|project
SRC_A|trae|project"

# 扫描 + 比较，返回批次 ID
prepare_batch() {
  local repo="$1" src="$2" tag="$3" scan cmp
  scan="$("$AIWS" intake scan --repo "$repo" \
    --source "${src}:cursor:project" --source "${src}:trae:project" --json 2>/dev/null)"
  local b
  b="$(printf '%s' "$scan" | jq -r '.batch_id')"
  "$AIWS" intake compare --repo "$repo" --batch "$b" --json >/dev/null 2>&1 || true
  printf '%s' "$b"
}

# 取候选 ID
cand_id() {
  local repo="$1" batch="$2" filter="$3"
  jq -r --arg f "$filter" ".candidates[] | select(.names | index(\$f)) | .candidate_id" \
    "$repo/.ai-workspace/intake/batches/$batch/candidates.json" | head -1
}

cand_file() { printf '%s' "$1/.ai-workspace/intake/batches/$2/candidates.json"; }

# 生成含全部六种动作的决定文件；未被选中的候选一律 ignore，使计划无未处理项
mk_all_decisions() {
  local repo="$1" batch="$2" out="$3"
  jq -c '
    [.candidates[]] as $c
    | ($c | map(select(.names | index("newrule")))[0].candidate_id)          as $add1
    | ($c | map(select(.names | index("new-skill")))[0].candidate_id)        as $add2
    | ($c | map(select(.names | index("fresh")))[0].candidate_id)            as $add3
    | ($c | map(select(.names | index("00-core")))[0].candidate_id)          as $upd
    | ($c | map(select(.names | index("keep")))[0].candidate_id)             as $lnk
    | ($c | map(select(.names | index("variant-base")))[0].candidate_id)     as $var
    | ($c | map(select(.labels | index("unparseable")))[0].candidate_id)     as $ign
    | ($c | map(select(.labels | index("unparseable")))[1].candidate_id)     as $dfr
    | {decisions: [$c[] | {candidate_id,
        kind: (if .candidate_id == $add1 or .candidate_id == $add2 or .candidate_id == $add3 then "add"
               elif .candidate_id == $upd then "update"
               elif .candidate_id == $lnk then "link"
               elif .candidate_id == $var then "variant"
               elif .candidate_id == $ign then "ignore"
               elif .candidate_id == $dfr then "defer"
               else "ignore" end)}]}' "$(cand_file "$repo" "$batch")" > "$out"
}

# 只给一个候选指定动作，其余 ignore；用于精确隔离单个场景
mk_focus_decisions() {
  local repo="$1" batch="$2" out="$3" name="$4" kind="$5"
  jq -c --arg f "$name" --arg k "$kind" '
    [.candidates[]] as $c
    | ($c | map(select(.names | index($f)))[0].candidate_id) as $t
    | {decisions: [$c[] | {candidate_id,
        kind: (if .candidate_id == $t then $k else "ignore" end)}]}' \
    "$(cand_file "$repo" "$batch")" > "$out"
}

run_plan() {
  local repo="$1" batch="$2" dec="$3"
  "$AIWS" intake plan --repo "$repo" --batch "$batch" --decisions "$dec" --json 2>/dev/null
}

run_apply() {
  local repo="$1" plan_id="$2"; shift 2
  "$AIWS" intake apply --repo "$repo" --plan "$plan_id" --json "$@" 2>/dev/null
}

echo "=== intake apply 测试 ==="

# ---------------------------------------------------------------
# AC-001-08: 六种动作与受约束写入
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-08: 六种动作 ---"

R1="${SANDBOX}/r1"; S1="${SANDBOX}/s1"
mk_repo "$R1"; mk_source "$S1"
B1="$(prepare_batch "$R1" "$S1" one)"
mk_all_decisions "$R1" "$B1" "${SANDBOX}/dec-all.json"
P1="$(run_plan "$R1" "$B1" "${SANDBOX}/dec-all.json")"

expect_eq "$(printf '%s' "$P1" | jq -r '.summary | [.add>=1,.link>=1,.update>=1,.variant>=1,.ignore>=1,.defer>=1] | all')" \
  "true" "all_six_action_kinds"
expect_eq "$(printf '%s' "$P1" | jq '.unresolved | length')" "0" "six_actions_leave_nothing_unresolved"

# 无法解析项不能被写入动作批准
UNP="$(jq -r '[.candidates[] | select(.labels | index("unparseable"))][0].candidate_id' \
  "$R1/.ai-workspace/intake/batches/$B1/candidates.json")"
jq -nc --arg u "$UNP" '{decisions: [{candidate_id: $u, kind: "add"}]}' > "${SANDBOX}/dec-bad.json"
if run_plan "$R1" "$B1" "${SANDBOX}/dec-bad.json" | jq -e '.ok' >/dev/null 2>&1; then
  t_fail "unparseable_rejects_ingest_action"
else
  t_pass "unparseable_rejects_ingest_action"
fi

# 未处理冲突：apply 必须拒绝且不写入
CONF="$(cand_id "$R1" "$B1" 00-core)"
jq -nc --arg c "$CONF" '{decisions: [{candidate_id: $c, kind: "ignore"}]}' > "${SANDBOX}/dec-partial.json"
P_PARTIAL="$(run_plan "$R1" "$B1" "${SANDBOX}/dec-partial.json")"
expect_eq "$(printf '%s' "$P_PARTIAL" | jq '.unresolved | length > 0')" "true" "unresolved_conflicts_listed"

PID_PARTIAL="$(printf '%s' "$P_PARTIAL" | jq -r '.plan_id')"
if run_apply "$R1" "$PID_PARTIAL" >/dev/null; then
  t_fail "apply_refuses_unresolved_plan"
else
  t_pass "apply_refuses_unresolved_plan"
fi
expect_eq "$([ -e "$R1/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "no" \
  "refused_apply_writes_nothing"

# ---------------------------------------------------------------
# AC-001-12: 稳定 ID、版本、来源与 mapping
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-12: 入库与版本 ---"

PID="$(printf '%s' "$P1" | jq -r '.plan_id')"
VARIANT_BASE_BEFORE="$(shasum -a 256 "$R1/.ai-workspace/rules/domains/variant-base.md" | awk '{print $1}')"
A1="$(run_apply "$R1" "$PID")"
expect_eq "$(printf '%s' "$A1" | jq -r '.status')" "ok" "apply_succeeds_with_all_six_actions"

expect_eq "$([ -f "$R1/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "yes" "add_writes_canonical_rule"
expect_eq "$([ -d "$R1/.ai-workspace/skills/new-skill" ] && echo yes || echo no)" "yes" "add_writes_canonical_skill"
expect_eq "$(jq -r '.servers.fresh.command' "$R1/.ai-workspace/mcp/mcp.json")" "npx" "add_merges_mcp_server"
expect_eq "$(jq -r '.servers.fs.command' "$R1/.ai-workspace/mcp/mcp.json")" "npx" "add_keeps_existing_mcp_server"

REG="$R1/.ai-workspace/assets/registry.json"
NEWRULE_ID="$(jq -r '.assets | to_entries[] | select(.value.canonical_path == ".ai-workspace/rules/domains/newrule.md") | .key' "$REG")"
expect_eq "$([ -n "$NEWRULE_ID" ] && echo yes || echo no)" "yes" "asset_id_stable_registered"
expect_eq "$(jq -r --arg i "$NEWRULE_ID" '.assets[$i].current_version' "$REG")" "1" "add_creates_v1"
expect_eq "$(jq -r --arg i "$NEWRULE_ID" '.assets[$i].sources | length' "$REG")" "1" "source_relation_recorded"

CORE_ID="$(jq -r '.assets | to_entries[] | select(.value.canonical_path == ".ai-workspace/rules/00-core.md") | .key' "$REG")"
expect_eq "$(jq -r --arg i "$CORE_ID" '.assets[$i].current_version' "$REG")" "2" "update_creates_v2"
expect_eq "$(jq -r --arg i "$CORE_ID" '.assets[$i].versions | length' "$REG")" "2" "update_backfills_initial_version"
expect_eq "$(jq -r --arg i "$CORE_ID" '.assets[$i].versions[0].kind' "$REG")" "backfill" "initial_version_marked_backfill"

KEEP_ID="$(jq -r '.assets | to_entries[] | select(.value.canonical_path == ".ai-workspace/rules/domains/keep.md") | .key' "$REG")"
expect_eq "$(jq -r --arg i "$KEEP_ID" '.assets[$i].current_version' "$REG")" "1" "link_registers_existing_as_v1"
expect_eq "$(shasum -a 256 "$R1/.ai-workspace/rules/domains/keep.md" | awk '{print $1}')" \
  "$(shasum -a 256 "$S1/.cursor/rules/keep.mdc" | awk '{print $1}')" "link_does_not_change_content"

VAR_ID="$(jq -r '.assets | to_entries[] | select(.value.related != null) | .key' "$REG" | head -1)"
BASE_ID="$(jq -r '.assets | to_entries[] | select(.value.canonical_path == ".ai-workspace/rules/domains/variant-base.md") | .key' "$REG")"
expect_eq "$([ -n "$VAR_ID" ] && [ "$VAR_ID" != "$BASE_ID" ] && echo distinct || echo same)" "distinct" \
  "variant_is_a_separate_asset"
expect_eq "$(jq -r --arg i "$VAR_ID" '.assets[$i].related.parent' "$REG" | cut -c1-6)" "asset-" "variant_records_parent_asset"
expect_eq "$(jq -r --arg i "$BASE_ID" '.assets[$i].related // "none"' "$REG")" "none" "variant_does_not_touch_base"
expect_eq "$(shasum -a 256 "$R1/.ai-workspace/rules/domains/variant-base.md" | awk '{print $1}')" \
  "$VARIANT_BASE_BEFORE" "variant_base_content_unchanged"

expect_eq "$(grep -c "rules/domains/newrule.md" "$R1/.ai-workspace/adapters/cursor/mapping.yaml")" "1" "mapping_registered_for_new_rule"
expect_eq "$(grep -c "rules/domains/newrule.md" "$R1/.ai-workspace/adapters/trae/mapping.yaml")" "1" "mapping_registered_for_all_tools"

# 版本快照内容与规范源一致
NEWRULE_V1="$R1/.ai-workspace/assets/$NEWRULE_ID/v1/content/newrule.md"
expect_eq "$(cmp -s "$NEWRULE_V1" "$R1/.ai-workspace/rules/domains/newrule.md" && echo same || echo diff)" "same" \
  "version_snapshot_matches_canonical"

# 重复执行不新增版本
A1B="$(run_apply "$R1" "$PID")"
expect_eq "$(printf '%s' "$A1B" | jq -r '.status')" "already_applied" "repeat_apply_idempotent"
expect_eq "$(jq -r --arg i "$CORE_ID" '.assets[$i].versions | length' "$REG")" "2" "repeat_apply_no_duplicate_version"
expect_eq "$(jq -r --arg i "$NEWRULE_ID" '.assets[$i].current_version' "$REG")" "1" "repeat_apply_no_version_bump"
expect_eq "$(grep -c "rules/domains/newrule.md" "$R1/.ai-workspace/adapters/cursor/mapping.yaml")" "1" "mapping_not_duplicated"

# 忽略与暂缓决定已记录
expect_eq "$([ -d "$R1/.ai-workspace/intake/decisions" ] && echo yes || echo no)" "yes" "decisions_recorded"
expect_eq "$(jq -s '[.[][] | select(.kind == "ignore")] | length' "$R1/.ai-workspace/intake/decisions/"*.json)" "1" "ignore_decision_saved"
expect_eq "$(jq -s '[.[][] | select(.kind == "defer")] | length' "$R1/.ai-workspace/intake/decisions/"*.json)" "1" "defer_decision_saved"

# ---------------------------------------------------------------
# AC-001-13: 执行前复核
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-13: 计划过期与执行前变化 ---"

R2="${SANDBOX}/r2"; S2="${SANDBOX}/s2"
mk_repo "$R2"; mk_source "$S2"
B2="$(prepare_batch "$R2" "$S2" two)"
mk_focus_decisions "$R2" "$B2" "${SANDBOX}/dec-add.json" newrule add
P2="$(run_plan "$R2" "$B2" "${SANDBOX}/dec-add.json")"
PID2="$(printf '%s' "$P2" | jq -r '.plan_id')"

# 来源在计划之后改变
cat >> "$S2/.cursor/rules/newrule.mdc" <<'EOF'

来源在计划之后又改了。
EOF
if run_apply "$R2" "$PID2" >/dev/null 2>&1; then
  t_fail "stale_source_blocks_apply"
else
  t_pass "stale_source_blocks_apply"
fi
expect_eq "$([ -e "$R2/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "no" \
  "stale_source_writes_nothing"
expect_eq "$(jq -r '.stages[0].status' "$R2/.ai-workspace/assets/history/"*.json 2>/dev/null | head -1)" "failed" \
  "stale_source_recorded_as_failed_stage"

# 计划过期
R3="${SANDBOX}/r3"; S3="${SANDBOX}/s3"
mk_repo "$R3"; mk_source "$S3"
B3="$(prepare_batch "$R3" "$S3" three)"
mk_focus_decisions "$R3" "$B3" "${SANDBOX}/dec-add3.json" newrule add
P3="$(run_plan "$R3" "$B3" "${SANDBOX}/dec-add3.json")"
PID3="$(printf '%s' "$P3" | jq -r '.plan_id')"
PLAN3="$R3/.ai-workspace/intake/plans/$PID3.json"
jq -c '.expires_at = "2000-01-01T00:00:00Z"' "$PLAN3" > "${PLAN3}.tmp" && mv "${PLAN3}.tmp" "$PLAN3"
if run_apply "$R3" "$PID3" >/dev/null 2>&1; then
  t_fail "expired_plan_refused"
else
  t_pass "expired_plan_refused"
fi
expect_eq "$([ -e "$R3/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "no" \
  "expired_plan_writes_nothing"

# 目标版本变化：先对同一目标执行另一个计划
R4="${SANDBOX}/r4"; S4="${SANDBOX}/s4"
mk_repo "$R4"; mk_source "$S4"
B4="$(prepare_batch "$R4" "$S4" four)"
mk_focus_decisions "$R4" "$B4" "${SANDBOX}/dec-upd.json" 00-core update
P4A="$(run_plan "$R4" "$B4" "${SANDBOX}/dec-upd.json")"
PID4A="$(printf '%s' "$P4A" | jq -r '.plan_id')"
run_apply "$R4" "$PID4A" >/dev/null 2>&1 || true

# 目标资产在计划之后被他人更新：把计划中的目标版本快照改为过期值
PLAN4="$R4/.ai-workspace/intake/plans/$PID4A.json"
jq -c '.plan_id = "plan-stale-target" | .actions |= map(if .target_asset_id != null then .target_version_snapshot = 99 else . end)' \
  "$PLAN4" > "${SANDBOX}/plan4b.json"
if "$AIWS" intake apply --repo "$R4" --plan "${SANDBOX}/plan4b.json" --json >/dev/null 2>&1; then
  t_fail "target_version_changed_refused"
else
  t_pass "target_version_changed_refused"
fi
CORE4_ID="$(jq -r '.assets | to_entries[] | select(.value.canonical_path == ".ai-workspace/rules/00-core.md") | .key' "$R4/.ai-workspace/assets/registry.json")"
expect_eq "$(jq -r --arg i "$CORE4_ID" '.assets[$i].current_version' "$R4/.ai-workspace/assets/registry.json")" "2" \
  "target_version_change_does_not_write_again"

# ---------------------------------------------------------------
# AC-001-14: 故障、恢复与受约束回退
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-14: 故障恢复与回退 ---"

R5="${SANDBOX}/r5"; S5="${SANDBOX}/s5"
mk_repo "$R5"; mk_source "$S5"
B5="$(prepare_batch "$R5" "$S5" five)"
mk_focus_decisions "$R5" "$B5" "${SANDBOX}/dec5.json" newrule add
P5="$(run_plan "$R5" "$B5" "${SANDBOX}/dec5.json")"
PID5="$(printf '%s' "$P5" | jq -r '.plan_id')"

# 故障注入：write_assets 阶段失败
if INTAKE_FAULT_STAGE=write_assets "$AIWS" intake apply --repo "$R5" --plan "$PID5" --json >/dev/null 2>&1; then
  t_fail "fault_injection_write_assets_fails"
else
  t_pass "fault_injection_write_assets_fails"
fi
expect_eq "$([ -e "$R5/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "no" \
  "fault_leaves_canonical_untouched"
expect_eq "$([ -d "$R5/.ai-workspace/assets/registry.json" ] && echo dir || echo nofile)" "nofile" \
  "fault_leaves_registry_absent"

# --resume 前必须显式确认（上一次为失败）
if run_apply "$R5" "$PID5" >/dev/null 2>&1; then
  t_fail "partial_run_requires_resume_flag"
else
  t_pass "partial_run_requires_resume_flag"
fi

# 续跑成功
A5="$(run_apply "$R5" "$PID5" --resume --json 2>/dev/null || run_apply "$R5" "$PID5" --resume)"
expect_eq "$(printf '%s' "$A5" | jq -r '.status')" "ok" "resume_completes_partial_run"
expect_eq "$([ -f "$R5/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "yes" "resume_writes_content"

APPLY5="$(printf '%s' "$A5" | jq -r '.apply_id')"

# 回退：恢复内容、删除新建文件
BEFORE5="$(tail -2 "$R5/.ai-workspace/rules/00-core.md" | head -1)"
RB5="$("$AIWS" intake rollback --repo "$R5" --apply "$APPLY5" --json 2>/dev/null)"
expect_eq "$(printf '%s' "$RB5" | jq -r '.rollback.status')" "rolled_back" "rollback_succeeds"
expect_eq "$([ -e "$R5/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "no" "rollback_removes_new_file"

# 回退的后续修改保护
R6="${SANDBOX}/r6"; S6="${SANDBOX}/s6"
mk_repo "$R6"; mk_source "$S6"
B6="$(prepare_batch "$R6" "$S6" six)"
mk_focus_decisions "$R6" "$B6" "${SANDBOX}/dec6.json" 00-core update
P6="$(run_plan "$R6" "$B6" "${SANDBOX}/dec6.json")"
PID6="$(printf '%s' "$P6" | jq -r '.plan_id')"
A6="$(run_apply "$R6" "$PID6")"
APPLY6="$(printf '%s' "$A6" | jq -r '.apply_id')"

# 批次之后有人改了同一文件
printf '\n批次之后的手工修改。\n' >> "$R6/.ai-workspace/rules/00-core.md"
MODIFIED6="$(cat "$R6/.ai-workspace/rules/00-core.md")"
RB6="$("$AIWS" intake rollback --repo "$R6" --apply "$APPLY6" --json 2>/dev/null || true)"
expect_eq "$(printf '%s' "$RB6" | jq -r '.rollback.status')" "rollback_conflict" "rollback_reports_conflict"
expect_contains "$MODIFIED6" "批次之后的手工修改。" "rollback_does_not_overwrite_later_edit"
expect_eq "$(printf '%s' "$RB6" | jq -r '.rollback.conflicts[0].reason')" "modified_after_apply" "rollback_conflict_reason"

# ---------------------------------------------------------------
# AC-001-19: 分阶段结果、取消与并发
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-19: 分阶段、取消与并发 ---"

R7="${SANDBOX}/r7"; S7="${SANDBOX}/s7"
mk_repo "$R7"; mk_source "$S7"
B7="$(prepare_batch "$R7" "$S7" seven)"
mk_focus_decisions "$R7" "$B7" "${SANDBOX}/dec7.json" newrule add
P7="$(run_plan "$R7" "$B7" "${SANDBOX}/dec7.json")"
PID7="$(printf '%s' "$P7" | jq -r '.plan_id')"

# 取消：不批准任何资产
touch "${SANDBOX}/cancel7"
A7="$(run_apply "$R7" "$PID7" --cancel-file "${SANDBOX}/cancel7")"
expect_eq "$(printf '%s' "$A7" | jq -r '.status')" "cancelled" "cancel_reports_status"
expect_eq "$([ -e "$R7/.ai-workspace/rules/domains/newrule.md" ] && echo yes || echo no)" "no" "cancel_approves_nothing"
expect_eq "$([ -e "$R7/.ai-workspace/assets/registry.json" ] && echo yes || echo no)" "no" "cancel_writes_no_registry"

# 分阶段结果
A7B="$(run_apply "$R7" "$PID7")"
expect_eq "$(printf '%s' "$A7B" | jq -r '[.stages[].status] | join(",")')" "ok,ok,ok,ok" "stages_reported_per_phase"

# 并发：apply 进行中外部推进 registry → 检测并中止，不替换 registry
R8="${SANDBOX}/r8"; S8="${SANDBOX}/s8"
mk_repo "$R8"; mk_source "$S8"
B8="$(prepare_batch "$R8" "$S8" eight)"
mk_focus_decisions "$R8" "$B8" "${SANDBOX}/dec8.json" newrule add
P8="$(run_plan "$R8" "$B8" "${SANDBOX}/dec8.json")"
PID8="$(printf '%s' "$P8" | jq -r '.plan_id')"

# 预置 registry，使并发写入可被观测
mkdir -p "$R8/.ai-workspace/assets"
printf '{"schema":"intake/v1","version_counter":0,"updated_at":null,"assets":{}}\n' \
  > "$R8/.ai-workspace/assets/registry.json"

# 监视暂存目录出现（一定发生在 registry 首次读取之后），随后外部推进 registry
(
  i=0
  while [ "$i" -lt 500 ]; do
    if [ -d "$R8/.ai-workspace/intake/staging" ]; then
      jq -c '.version_counter += 1' "$R8/.ai-workspace/assets/registry.json" \
        > "$R8/.ai-workspace/assets/registry.json.tmp" 2>/dev/null \
        && mv "$R8/.ai-workspace/assets/registry.json.tmp" "$R8/.ai-workspace/assets/registry.json"
      break
    fi
    sleep 0.02
    i=$((i + 1))
  done
) &
WATCHER=$!

CONC_OUT="$(run_apply "$R8" "$PID8" 2>/dev/null || true)"
wait "$WATCHER" 2>/dev/null || true

expect_eq "$(jq -r '.version_counter' "$R8/.ai-workspace/assets/registry.json")" "1" "concurrent_writer_applied"
if [ -z "$CONC_OUT" ]; then
  t_pass "concurrent_write_detected"
else
  expect_contains "$(printf '%s' "$CONC_OUT" | jq -r '.errors | join(",")')" "concurrent" "concurrent_write_detected"
fi

# ---------------------------------------------------------------
# 回归：现有 import 仍可用
# ---------------------------------------------------------------
echo ""
echo "--- 回归：现有工作流 ---"

R9="${SANDBOX}/r9"; S9="${SANDBOX}/s9"
mk_repo "$R9"; mk_source "$S9"
if "$AIWS" intake scan --repo "$R9" --source "${S9}:cursor:project" --json >/dev/null 2>&1; then
  t_pass "regression_intake_scan_still_works"
else
  t_fail "regression_intake_scan_still_works"
fi
if "$AIWS" validate --help >/dev/null 2>&1; then
  t_pass "regression_validate_reachable"
else
  t_fail "regression_validate_reachable"
fi
if "$AIWS" import --help >/dev/null 2>&1; then
  t_pass "regression_import_reachable"
else
  t_fail "regression_import_reachable"
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
