#!/bin/sh
# test-intake-review-0306.sh - TASK-001-03～06 审查缺陷回归测试
#
# 每个用例对应一条已确认缺陷，先证明旧行为不满足要求、修好后必须通过：
#   一  写入路径边界（路径穿越 / 绝对路径 / 父目录软链接）
#   二  稳定资产 ID 与连续版本（add→update×3、首次纳管、变体）
#   三  目标实际内容变化复核（规则 / Skill 附属文件 / MCP）
#   四  提交中断、幂等与续跑（各阶段故障 + 真实持久状态）
#   五  回退一致性（冲突时不回退 registry、重复回退、后续批次推进）
#   六  共享资产的凭据门禁（Rule / Skill，含版本、备份、记录无明文）
#   七  忽略决定的来源边界（A 忽略不吞掉 B 的首次审核机会）
#   十  多行敏感值过滤（含块标量，模拟服务收到的请求体无秘密）
#   十一 响应结构及逐来源锚点校验（错误类型不崩、越界/非法来源逐条拒绝）
#   十二 跨次重试记录保留（再次发送不覆盖既有尝试）
#
# 模型相关用例只用 127.0.0.1 上的模拟服务，不调用真实模型服务、不产生费用。
# 沙盒：临时总库（含真实 CLI 引擎副本）、临时来源、临时 HOME。
# 刻意不用 set -e：单项失败要逐条记录，而不是在第一个空输入处整体中断。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIWS_SRC="${SCRIPT_DIR}/../aiws"

PASS=0
FAIL=0
t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }
expect_eq() { if [ "$1" = "$2" ]; then t_pass "$3"; else t_fail "$3 (expected [$2], got [$1])"; fi; }
expect_contains() { case "$1" in *"$2"*) t_pass "$3" ;; *) t_fail "$3 (missing [$2] in [$1])" ;; esac; }
expect_absent() { if printf '%s' "$1" | grep -qF -- "$2"; then t_fail "$3 (unexpected [$2])"; else t_pass "$3"; fi; }
expect_file_absent() { if [ -e "$1" ]; then t_fail "$2 (unexpected file $1)"; else t_pass "$2"; fi; }
expect_json() {
  local actual
  actual="$(printf '%s' "$1" | jq -r "$2" 2>/dev/null)"
  if [ "$actual" = "$3" ]; then t_pass "$4"; else t_fail "$4 (expected $3, got $actual)"; fi
}

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/aiws-intake-review.XXXXXX")"
MOCK_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && wait "$MOCK_PID" 2>/dev/null || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

# 每个来源都预置空的 .cursor/mcp.json：缺失的 MCP 路径会变成 unparseable 候选并阻断整批写入，
# 这里让来源只包含真正要测的资产。
prep_source() {
  mkdir -p "$1/.cursor/rules"
  [ -f "$1/.cursor/mcp.json" ] || echo '{"mcpServers":{}}' > "$1/.cursor/mcp.json"
}

export HOME="${SANDBOX}/home"
export HOME_DIR="$HOME"
mkdir -p "$HOME"

REPO="${SANDBOX}/repo"
SRC="${SANDBOX}/src"
AIWS="${REPO}/.ai-workspace/scripts/aiws"

mkdir -p "$REPO/.ai-workspace/rules/domains" "$REPO/.ai-workspace/skills" \
         "$REPO/.ai-workspace/mcp" "$REPO/.ai-workspace/adapters"
prep_source "$SRC"
cp -R "${SCRIPT_DIR}/.." "$REPO/.ai-workspace/scripts"
chmod +x "$AIWS"
for t in cursor trae claude codex; do
  mkdir -p "$REPO/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$REPO/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$REPO/.ai-workspace/mcp/mcp.json"

run_cli() {
  local out
  out="$("$AIWS" "$@" 2>/dev/null)" || true
  [ -n "$out" ] || out='{}'
  printf '%s' "$out"
}
scan_src() { run_cli intake scan --repo "$REPO" --source "$1:cursor:project" --json; }
compare_batch() { run_cli intake compare --repo "$REPO" --batch "$1" --json; }

# 写决定文件并生成计划；$1=批次 $2=决定 JSON 数组
make_plan() {
  printf '{"decisions": %s}\n' "$2" > "${SANDBOX}/decisions.json"
  run_cli intake plan --repo "$REPO" --batch "$1" --decisions "${SANDBOX}/decisions.json" --json
}
apply_plan() { run_cli intake apply --repo "$REPO" --plan "$1" --json; }
# 计划被拒绝时 CLI 返回非零且不输出计划（错误原因在 stderr）
plan_refused() {
  printf '{"decisions": %s}\n' "$2" > "${SANDBOX}/decisions.json"
  if "$AIWS" intake plan --repo "$REPO" --batch "$1" --decisions "${SANDBOX}/decisions.json" --json >/dev/null 2>&1; then
    printf 'no'
  else
    printf 'yes'
  fi
}
registry() { cat "$REPO/.ai-workspace/assets/registry.json" 2>/dev/null || echo '{}'; }
cand_id() { printf '%s' "$1" | jq -r --arg n "$2" '[.candidates[] | select((.names | index($n)) != null)][0].candidate_id // ""'; }


echo "=== TASK-001-03～06 审查缺陷回归测试 ==="

# ============================================================================
# 一、写入路径边界
# ============================================================================
echo ""
echo "--- 一、写入路径边界 ---"

# 规则 frontmatter id 为路径穿越串：绝不能写到总库之外
printf -- '---\nid: ../../../../escaped\ntitle: Escape\n---\n# Escape\n\nSOURCE_MARKER\n' \
  > "${SRC}/.cursor/rules/escape.mdc"
B="$(scan_src "$SRC" | jq -r '.batch_id')"
C="$(compare_batch "$B")"
PC="$(cand_id "$C" "escape")"
PLAN="$(make_plan "$B" "[{\"candidate_id\":\"${PC}\",\"kind\":\"add\"}]")"
RES="$(apply_plan "$(printf '%s' "$PLAN" | jq -r '.plan_id // ""')")"
expect_eq "$(printf '%s' "$RES" | jq -r '.status // "none"')" "failed" "traversal_apply_failed"
expect_contains "$(printf '%s' "$RES" | jq -r '.errors | join(",")')" "unsafe_asset_name" "traversal_reported_unsafe_asset_name"
expect_file_absent "${SANDBOX}/escaped.md" "traversal_no_write_outside_repo"
expect_file_absent "${REPO}/.ai-workspace/rules/domains/../../../../escaped.md" "traversal_no_relative_escape"

# 绝对路径形式的 id 同样不能落到总库之外
printf -- '---\nid: /%s/abs-escaped\ntitle: Abs\n---\n# Abs\n\nABS\n' "$SANDBOX" \
  > "${SRC}/.cursor/rules/abs.mdc"
B="$(scan_src "$SRC" | jq -r '.batch_id')"
C="$(compare_batch "$B")"
PC="$(cand_id "$C" "abs")"
PLAN="$(make_plan "$B" "[{\"candidate_id\":\"${PC}\",\"kind\":\"add\"}]")"
RES="$(apply_plan "$(printf '%s' "$PLAN" | jq -r '.plan_id // ""')")"
expect_eq "$(printf '%s' "$RES" | jq -r '.status // "none"')" "failed" "absolute_id_apply_failed"
expect_file_absent "${SANDBOX}/abs-escaped.md" "absolute_id_no_escape"

# 父目录软链接指向总库之外：仍必须拒绝
REPO2="${SANDBOX}/repo-link"
OUTSIDE="${SANDBOX}/outside"
mkdir -p "$OUTSIDE" "$REPO2/.ai-workspace/rules" "$REPO2/.ai-workspace/mcp" \
         "$REPO2/.ai-workspace/skills" "$REPO2/.ai-workspace/adapters"
cp -R "${SCRIPT_DIR}/.." "$REPO2/.ai-workspace/scripts"
chmod +x "${REPO2}/.ai-workspace/scripts/aiws"
ln -s "$OUTSIDE" "${REPO2}/.ai-workspace/rules/domains"
for t in cursor trae claude codex; do
  mkdir -p "$REPO2/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$REPO2/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$REPO2/.ai-workspace/mcp/mcp.json"
printf -- '---\nid: linked\ntitle: Linked\n---\n# Linked\n\nLINKED\n' \
  > "${SRC}/.cursor/rules/linked.mdc"
B2="$(run_cli intake scan --repo "$REPO2" --source "$SRC:cursor:project" --json | jq -r '.batch_id')"
C2="$(run_cli intake compare --repo "$REPO2" --batch "$B2" --json)"
PC2="$(cand_id "$C2" "linked")"
printf '{"decisions": [{"candidate_id":"%s","kind":"add"}]}\n' "$PC2" > "${SANDBOX}/d2.json"
PLAN2="$(run_cli intake plan --repo "$REPO2" --batch "$B2" --decisions "${SANDBOX}/d2.json" --json)"
RES2="$(run_cli intake apply --repo "$REPO2" --plan "$(printf '%s' "$PLAN2" | jq -r '.plan_id // ""')" --json)"
expect_eq "$(printf '%s' "$RES2" | jq -r '.status // "none"')" "failed" "symlinked_parent_apply_failed"
expect_file_absent "${OUTSIDE}/linked.md" "symlinked_parent_no_write_outside"

# 合法名称与路径行为保留
printf -- '---\nid: legal-name.v2\ntitle: Legal\n---\n# Legal\n\nLEGAL\n' \
  > "${SRC}/.cursor/rules/legal.mdc"
B="$(scan_src "$SRC" | jq -r '.batch_id')"
C="$(compare_batch "$B")"
PC="$(cand_id "$C" "legal")"
PLAN="$(make_plan "$B" "[{\"candidate_id\":\"${PC}\",\"kind\":\"add\"}]")"
RES="$(apply_plan "$(printf '%s' "$PLAN" | jq -r '.plan_id // ""')")"
expect_eq "$(printf '%s' "$RES" | jq -r '.status // "none"')" "ok" "legal_name_still_ingests"
if [ -f "${REPO}/.ai-workspace/rules/domains/legal-name.v2.md" ]; then
  t_pass "legal_name_written_to_canonical"
else
  t_fail "legal_name_written_to_canonical"
fi

# 路径穿越用例失败的批次仍写入执行记录（失败可诊断）
expect_eq "$(printf '%s' "$RES" | jq -r '.files | length')" "1" "legal_apply_files_recorded"

# ============================================================================
# 二、稳定资产 ID 与连续版本
# ============================================================================
echo ""
echo "--- 二、稳定资产 ID 与连续版本 ---"

SRC_S="${SANDBOX}/src-stable"
prep_source "$SRC_S"
write_stable() {
  printf -- '---\nid: stable\ntitle: Stable\n---\n# Stable\n\n%s\n' "$1" \
    > "${SRC_S}/.cursor/rules/stable.mdc"
}

# add → update ×3
write_stable "BODY-V1"
SB="$(scan_src "$SRC_S" | jq -r '.batch_id')"
SC="$(compare_batch "$SB")"
SPC="$(cand_id "$SC" "stable")"
SPLAN="$(make_plan "$SB" "[{\"candidate_id\":\"${SPC}\",\"kind\":\"add\"}]")"
SAP="$(apply_plan "$(printf '%s' "$SPLAN" | jq -r '.plan_id')")"
AID1="$(registry | jq -r '[.assets | to_entries[] | select(.value.canonical_path | endswith("stable.md"))][0].key // ""')"
expect_eq "$(printf '%s' "$SAP" | jq -r '.status')" "ok" "stable_add_ok"
expect_eq "$(registry | jq -r '[.assets[] | select(.canonical_path | endswith("stable.md"))] | length')" "1" "stable_one_asset_after_add"

V=2
for body in BODY-V2 BODY-V3 BODY-V4; do
  write_stable "$body"
  SB="$(scan_src "$SRC_S" | jq -r '.batch_id')"
  SC="$(compare_batch "$SB")"
  SPC="$(cand_id "$SC" "stable")"
  SPLAN="$(make_plan "$SB" "[{\"candidate_id\":\"${SPC}\",\"kind\":\"update\"}]")"
  SAP="$(apply_plan "$(printf '%s' "$SPLAN" | jq -r '.plan_id')")"
  expect_eq "$(printf '%s' "$SAP" | jq -r '.status')" "ok" "stable_update_v${V}_ok"
  V=$((V + 1))
done

expect_eq "$(registry | jq -r '[.assets[] | select(.canonical_path | endswith("stable.md"))] | length')" "1" "stable_single_registry_entry_after_3_updates"
expect_eq "$(registry | jq -r --arg a "$AID1" '(.assets[$a] // null) != null')" "true" "stable_asset_id_unchanged"
expect_eq "$(registry | jq -r --arg a "$AID1" '.assets[$a].current_version')" "4" "stable_current_version_4"
expect_eq "$(registry | jq -r --arg a "$AID1" '[.assets[$a].versions[].version] | join(",")')" "1,2,3,4" "stable_versions_contiguous"
expect_eq "$(registry | jq -r --arg a "$AID1" '[.assets[$a].versions[].kind] | join(",")')" "new,new,new,new" "stable_version_kinds"

# 每版内容正确
ok_versions=1
for n in 1 2 3 4; do
  want="BODY-V${n}"
  got="$(cat "$REPO/.ai-workspace/assets/${AID1}/v${n}/content/stable.md" 2>/dev/null || echo MISSING)"
  case "$got" in *"$want"*) ;; *) ok_versions=0 ;; esac
done
expect_eq "$ok_versions" "1" "stable_each_version_content_correct"

# 规范源只被同一文件占用（没有第二份重复登记）
expect_eq "$(registry | jq -r --arg a "$AID1" '[.assets[$a].canonical_path] | unique | length')" "1" "stable_single_canonical_entry"
expect_eq "$(registry | jq -r '[.assets[].canonical_path] | length == (unique | length)')" "true" "stable_single_asset_dir"

# 首次纳管：总库既有规范源（未登记）+ 同内容来源 → link，登记初始版本
printf -- '---\nid: legacy\ntitle: Legacy\n---\n# Legacy\n\nLEGACY-BODY\n' \
  > "${REPO}/.ai-workspace/rules/domains/legacy.md"
SRC_L="${SANDBOX}/src-legacy"
prep_source "$SRC_L"
printf -- '---\nid: legacy\ntitle: Legacy\n---\n# Legacy\n\nLEGACY-BODY\n' \
  > "${SRC_L}/.cursor/rules/legacy.mdc"
LB="$(scan_src "$SRC_L" | jq -r '.batch_id')"
LC="$(compare_batch "$LB")"
LPC="$(cand_id "$LC" "legacy")"
LPLAN="$(make_plan "$LB" "[{\"candidate_id\":\"${LPC}\",\"kind\":\"link\"}]")"
LAP="$(apply_plan "$(printf '%s' "$LPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$LAP" | jq -r '.status')" "ok" "legacy_link_ok"
LID="$(registry | jq -r --arg p ".ai-workspace/rules/domains/legacy.md" \
  '[.assets | to_entries[] | select(.value.canonical_path == $p)][0].key // ""')"
if [ -n "$LID" ]; then t_pass "legacy_registered"; else t_fail "legacy_registered"; fi
expect_eq "$(registry | jq -r --arg a "$LID" '.assets[$a].current_version')" "1" "legacy_backfilled_initial_version"
expect_eq "$(registry | jq -r --arg a "$LID" '.assets[$a].versions[0].kind')" "backfill" "legacy_initial_version_is_backfill"

# 首次纳管后的更新必须沿用同一 ID
printf -- '---\nid: legacy\ntitle: Legacy\n---\n# Legacy\n\nLEGACY-BODY-2\n' \
  > "${SRC_L}/.cursor/rules/legacy.mdc"
LB="$(scan_src "$SRC_L" | jq -r '.batch_id')"
LC="$(compare_batch "$LB")"
LPC="$(cand_id "$LC" "legacy")"
LPLAN="$(make_plan "$LB" "[{\"candidate_id\":\"${LPC}\",\"kind\":\"update\"}]")"
LAP="$(apply_plan "$(printf '%s' "$LPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$LAP" | jq -r '.status')" "ok" "legacy_update_ok"
expect_eq "$(registry | jq -r '[.assets[] | select(.canonical_path | endswith("legacy.md"))] | length')" "1" "legacy_no_duplicate_registration"
expect_eq "$(registry | jq -r --arg a "$LID" '.assets[$a].current_version')" "2" "legacy_version_2_same_id"

# 变体：独立资产 + 关联原资产
write_stable "BODY-VARIANT"
VB="$(scan_src "$SRC_S" | jq -r '.batch_id')"
VC="$(compare_batch "$VB")"
VPC="$(cand_id "$VC" "stable")"
VPLAN="$(make_plan "$VB" "[{\"candidate_id\":\"${VPC}\",\"kind\":\"variant\",\"target_asset_id\":\"${AID1}\"}]")"
VAP="$(apply_plan "$(printf '%s' "$VPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$VAP" | jq -r '.status')" "ok" "variant_ok"
VID="$(printf '%s' "$VAP" | jq -r '.created_assets[] | select(. != "'"$AID1"'")' | head -n 1)"
if [ -n "$VID" ] && [ "$VID" != "$AID1" ]; then t_pass "variant_independent_asset"; else t_fail "variant_independent_asset (got [$VID])"; fi
expect_eq "$(registry | jq -r --arg a "$VID" '.assets[$a].related.parent // ""')" "$AID1" "variant_parent_linked"
expect_eq "$(registry | jq -r --arg a "$AID1" '.assets[$a].current_version')" "4" "variant_does_not_touch_base_version"

# 显式目标必须真实存在且类型一致（Desktop 目标选择的引擎侧约束）
expect_eq "$(plan_refused "$VB" "[{\"candidate_id\":\"${VPC}\",\"kind\":\"update\",\"target_asset_id\":\"asset-does-not-exist\"}]")" "yes" "explicit_target_must_exist"
expect_eq "$(plan_refused "$VB" "[{\"candidate_id\":\"${VPC}\",\"kind\":\"variant\",\"target_asset_id\":\"${KID}\"}]")" "yes" "explicit_target_type_checked"
# 合法目标仍然可用
expect_eq "$(plan_refused "$VB" "[{\"candidate_id\":\"${VPC}\",\"kind\":\"variant\",\"target_asset_id\":\"${AID1}\"}]")" "no" "explicit_target_valid_accepted"

# ============================================================================
# 三、目标实际内容变化复核
# ============================================================================
echo ""
echo "--- 三、目标实际内容变化复核 ---"

STABLE_CANON="${REPO}/.ai-workspace/rules/domains/stable.md"

# 规则：计划后人工修改目标文件（registry 版本未变）必须阻断
write_stable "BODY-V6"
B="$(scan_src "$SRC_S" | jq -r '.batch_id')"
C="$(compare_batch "$B")"
PC="$(cand_id "$C" "stable")"
PLAN="$(make_plan "$B" "[{\"candidate_id\":\"${PC}\",\"kind\":\"update\"}]")"
PID="$(printf '%s' "$PLAN" | jq -r '.plan_id')"
printf '\nMANUAL-EDIT-RULE\n' >> "$STABLE_CANON"
MANUAL_RULE_HASH="$(shasum -a 256 "$STABLE_CANON" | awk '{print $1}')"
RES="$(apply_plan "$PID")"
expect_eq "$(printf '%s' "$RES" | jq -r '.status // "none"')" "failed" "rule_manual_edit_blocked"
expect_contains "$(printf '%s' "$RES" | jq -r '[.failed_actions[].reason] | join(",")')" "target_content_changed" "rule_manual_edit_reason"
expect_eq "$(shasum -a 256 "$STABLE_CANON" | awk '{print $1}')" "$MANUAL_RULE_HASH" "rule_manual_edit_preserved"
expect_eq "$(registry | jq -r --arg a "$AID1" '.assets[$a].current_version')" "4" "rule_manual_edit_registry_untouched"
# 之后的正常计划不再受影响
PLAN="$(make_plan "$B" "[{\"candidate_id\":\"${PC}\",\"kind\":\"update\"}]")"
expect_eq "$(printf '%s' "$PLAN" | jq -r '.actions | length')" "1" "rule_replan_after_manual_edit_ok"

# Skill 附属文件：计划后修改总库副本中的一个附件必须阻断
SRC_K="${SANDBOX}/src-skill"
prep_source "$SRC_K"
mkdir -p "${SRC_K}/.cursor/skills/k-skill/scripts"
printf -- '---\nname: k-skill\ndescription: K\n---\n# K\n\nK-BODY\n' > "${SRC_K}/.cursor/skills/k-skill/SKILL.md"
printf '#!/bin/sh\necho v1\n' > "${SRC_K}/.cursor/skills/k-skill/scripts/run.sh"
KB="$(run_cli intake scan --repo "$REPO" --source "${SRC_K}:cursor:project" --json | jq -r '.batch_id')"
KC="$(compare_batch "$KB")"
KPC="$(cand_id "$KC" "k-skill")"
KPLAN="$(make_plan "$KB" "[{\"candidate_id\":\"${KPC}\",\"kind\":\"add\"}]")"
KAP="$(apply_plan "$(printf '%s' "$KPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$KAP" | jq -r '.status')" "ok" "skill_add_ok"
KID="$(registry | jq -r '[.assets | to_entries[] | select(.value.type == "skill")][0].key // ""')"

printf '#!/bin/sh\necho v2\n' > "${SRC_K}/.cursor/skills/k-skill/scripts/run.sh"
KB="$(run_cli intake scan --repo "$REPO" --source "${SRC_K}:cursor:project" --json | jq -r '.batch_id')"
KC="$(compare_batch "$KB")"
KPC="$(cand_id "$KC" "k-skill")"
KPLAN="$(make_plan "$KB" "[{\"candidate_id\":\"${KPC}\",\"kind\":\"update\"}]")"
printf '#!/bin/sh\necho MANUAL\n' > "${REPO}/.ai-workspace/skills/k-skill/scripts/run.sh"
KRES="$(apply_plan "$(printf '%s' "$KPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$KRES" | jq -r '.status // "none"')" "failed" "skill_attachment_edit_blocked"
expect_contains "$(printf '%s' "$KRES" | jq -r '[.failed_actions[].reason] | join(",")')" "target_content_changed" "skill_attachment_edit_reason"
expect_eq "$(cat "${REPO}/.ai-workspace/skills/k-skill/scripts/run.sh")" "#!/bin/sh
echo MANUAL" "skill_attachment_edit_preserved"
expect_eq "$(registry | jq -r --arg a "$KID" '.assets[$a].current_version')" "1" "skill_attachment_registry_untouched"

# MCP：计划后修改总库 server 配置必须阻断
SRC_M="${SANDBOX}/src-mcp"
prep_source "$SRC_M"
printf '{"mcpServers":{"srv":{"command":"node","args":["a.js"],"env":{"REGION":"us"}}}}\n' \
  > "${SRC_M}/.cursor/mcp.json"
MB="$(run_cli intake scan --repo "$REPO" --source "${SRC_M}:cursor:project" --json | jq -r '.batch_id')"
MC="$(compare_batch "$MB")"
MPC="$(cand_id "$MC" "srv")"
MPLAN="$(make_plan "$MB" "[{\"candidate_id\":\"${MPC}\",\"kind\":\"add\"}]")"
MAP="$(apply_plan "$(printf '%s' "$MPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$MAP" | jq -r '.status')" "ok" "mcp_add_ok"
MID="$(registry | jq -r '[.assets | to_entries[] | select(.value.type == "mcp")][0].key // ""')"

printf '{"mcpServers":{"srv":{"command":"node","args":["a.js"],"env":{"REGION":"eu"}}}}\n' \
  > "${SRC_M}/.cursor/mcp.json"
MB="$(run_cli intake scan --repo "$REPO" --source "${SRC_M}:cursor:project" --json | jq -r '.batch_id')"
MC="$(compare_batch "$MB")"
MPC="$(cand_id "$MC" "srv")"
MPLAN="$(make_plan "$MB" "[{\"candidate_id\":\"${MPC}\",\"kind\":\"update\"}]")"
"$AIWS" intake >/dev/null 2>&1 || true
jq -c '.servers.srv.env.REGION = "MANUAL"' "$REPO/.ai-workspace/mcp/mcp.json" > "${SANDBOX}/mcp.tmp" \
  && mv "${SANDBOX}/mcp.tmp" "$REPO/.ai-workspace/mcp/mcp.json"
MRES="$(apply_plan "$(printf '%s' "$MPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$MRES" | jq -r '.status // "none"')" "failed" "mcp_manual_edit_blocked"
expect_contains "$(printf '%s' "$MRES" | jq -r '[.failed_actions[].reason] | join(",")')" "target_content_changed" "mcp_manual_edit_reason"
expect_eq "$(jq -r '.servers.srv.env.REGION' "$REPO/.ai-workspace/mcp/mcp.json")" "MANUAL" "mcp_manual_edit_preserved"

# ============================================================================
# 四、提交中断、幂等与续跑
# ============================================================================
echo ""
echo "--- 四、提交中断、幂等与续跑 ---"

REPO_F="${SANDBOX}/repo-fault"
SRC_F="${SANDBOX}/src-fault"
mkdir -p "$REPO_F/.ai-workspace/rules/domains" "$REPO_F/.ai-workspace/skills" \
         "$REPO_F/.ai-workspace/mcp" "$REPO_F/.ai-workspace/adapters"
prep_source "$SRC_F"
cp -R "${SCRIPT_DIR}/.." "$REPO_F/.ai-workspace/scripts"
chmod +x "${REPO_F}/.ai-workspace/scripts/aiws"
for t in cursor trae claude codex; do
  mkdir -p "$REPO_F/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$REPO_F/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$REPO_F/.ai-workspace/mcp/mcp.json"
printf -- '---\nid: fa\ntitle: FA\n---\n# FA\n\nFA-BODY\n' > "${SRC_F}/.cursor/rules/fa.mdc"
printf -- '---\nid: fb\ntitle: FB\n---\n# FB\n\nFB-BODY\n' > "${SRC_F}/.cursor/rules/fb.mdc"

FCLI="${REPO_F}/.ai-workspace/scripts/aiws"
freg() { cat "$REPO_F/.ai-workspace/assets/registry.json" 2>/dev/null || echo '{}'; }
fhist() {
  local d="$REPO_F/.ai-workspace/assets/history"
  if [ -d "$d" ]; then for f in "$d"/*.json; do [ -f "$f" ] && cat "$f"; done | jq -s -c '.'; else echo '[]'; fi
}
fscan() { "$FCLI" intake scan --repo "$REPO_F" --source "${SRC_F}:cursor:project" --json 2>/dev/null | jq -r '.batch_id'; }
fcand() { "$FCLI" intake compare --repo "$REPO_F" --batch "$1" --json 2>/dev/null; }
fplan() {
  printf '{"decisions": %s}\n' "$2" > "${SANDBOX}/fd.json"
  "$FCLI" intake plan --repo "$REPO_F" --batch "$1" --decisions "${SANDBOX}/fd.json" --json 2>/dev/null
}
fapply() {
  local pid="$1"; shift
  local out
  out="$(env "$@" "$FCLI" intake apply --repo "$REPO_F" --plan "$pid" --json 2>/dev/null)" || true
  [ -n "$out" ] || out='{}'
  printf '%s' "$out"
}
# 续跑入口是显式 --resume 参数（不确定来源的自动续跑会掩盖未完成状态）
fapply_resume() {
  local pid="$1"; shift
  local out
  out="$(env "$@" "$FCLI" intake apply --repo "$REPO_F" --plan "$pid" --resume --json 2>/dev/null)" || true
  [ -n "$out" ] || out='{}'
  printf '%s' "$out"
}

FB1="$(fscan)"
FC1="$(fcand "$FB1")"
P_A="$(cand_id "$FC1" "fa")"
P_B="$(cand_id "$FC1" "fb")"
DEC_BOTH="[{\"candidate_id\":\"${P_A}\",\"kind\":\"add\"},{\"candidate_id\":\"${P_B}\",\"kind\":\"add\"}]"
FP1="$(fplan "$FB1" "$DEC_BOTH")"
PID1="$(printf '%s' "$FP1" | jq -r '.plan_id')"
expect_eq "$(printf '%s' "$FP1" | jq -r '.actions | length')" "2" "fault_plan_ok"

# (a) write_assets 提交前故障：总库零改动
R="$(fapply "$PID1" INTAKE_FAULT_STAGE=write_assets)"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "failed" "fault_write_assets_status"
expect_file_absent "${REPO_F}/.ai-workspace/rules/domains/fa.md" "fault_write_assets_no_content"
expect_eq "$(fhist | jq -r '[.[] | select(.status == "failed")] | length >= 1')" "true" "fault_write_assets_recorded"

# (b) write_assets 部分提交后故障
# 上一轮已留下 failed 记录，续跑入口是显式 --resume
R="$(fapply_resume "$PID1" INTAKE_FAULT_STAGE=write_assets_partial)"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "incomplete" "fault_partial_status"
# 按 plan_id 取记录：多个记录的 started_at 同秒时，按时间排序是不确定的
FILES="$(fhist | jq -c --arg p "$PID1" '[.[] | select(.plan_id == $p and .status == "incomplete")] | last | .files // []')"
if [ "$(printf '%s' "$FILES" | jq 'length')" -ge 1 ]; then t_pass "fault_partial_state_persisted"; else t_fail "fault_partial_state_persisted"; fi
expect_eq "$(printf '%s' "$FILES" | jq -r '[.[] | select(.before_fingerprint == null)] | length >= 1')" "true" "fault_partial_records_new_file_baseline"

# 续跑：不得把首次新增当成既有文件备份
R="$(fapply_resume "$PID1")"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "ok" "fault_partial_resume_ok"
expect_eq "$(freg | jq -r '.assets | length')" "2" "fault_partial_resume_assets"
expect_eq "$(freg | jq -r '[.assets[].versions | length] | add')" "2" "fault_partial_resume_no_duplicate_versions"
expect_eq "$(fhist | jq -r --arg p "$PID1" '[.[] | select(.plan_id == $p and .status == "ok")] | last | .files | map(select(.before_fingerprint == null)) | length')" "2" "fault_partial_baseline_still_null"
expect_eq "$(find "$REPO_F/.ai-workspace/assets" -maxdepth 2 -type d -name 'v*' | wc -l | tr -d ' ')" "2" "fault_partial_no_duplicate_version_dirs"

# 回退基准正确：首次新增的文件在回退时被删除，而不是"还原"成新增内容
OK_APPLY="$(fhist | jq -r --arg p "$PID1" '[.[] | select(.plan_id == $p and .status == "ok")] | last | .apply_id')"
RB="$("$FCLI" intake rollback --repo "$REPO_F" --apply "$OK_APPLY" --json 2>/dev/null || true)"
expect_eq "$(printf '%s' "$RB" | jq -r '.rollback.status // "none"')" "rolled_back" "fault_partial_rollback_clean"
expect_file_absent "${REPO_F}/.ai-workspace/rules/domains/fa.md" "fault_partial_rollback_removes_new_file"
expect_file_absent "${REPO_F}/.ai-workspace/rules/domains/fb.md" "fault_partial_rollback_removes_new_file_b"

# (c) write_registry 故障：内容已落盘、registry 未更新，续跑补齐
FB2="$(fscan)"
FC2="$(fcand "$FB2")"
P_A2="$(cand_id "$FC2" "fa")"
P_B2="$(cand_id "$FC2" "fb")"
FP2="$(fplan "$FB2" "[{\"candidate_id\":\"${P_A2}\",\"kind\":\"add\"},{\"candidate_id\":\"${P_B2}\",\"kind\":\"add\"}]")"
PID2="$(printf '%s' "$FP2" | jq -r '.plan_id')"
R="$(fapply "$PID2" INTAKE_FAULT_STAGE=write_registry)"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "incomplete" "fault_write_registry_status"
expect_contains "$(printf '%s' "$R" | jq -r '.errors | join(",")')" "content_written_registry_missing" "fault_write_registry_flagged"
expect_file_absent "${REPO_F}/.ai-workspace/assets/registry.json" "fault_write_registry_registry_absent"
R="$(fapply_resume "$PID2")"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "ok" "fault_write_registry_resume_ok"
expect_eq "$(freg | jq -r '.assets | length')" "2" "fault_write_registry_resume_assets"
expect_eq "$(freg | jq -r '[.assets[].versions | length] | add')" "2" "fault_write_registry_no_duplicate_versions"

# (d) write_history 故障：终态记录未落盘，续跑补齐且不重复建版本
OK2="$(fhist | jq -r --arg p "$PID2" '[.[] | select(.plan_id == $p and .status == "ok")] | last | .apply_id')"
"$FCLI" intake rollback --repo "$REPO_F" --apply "$OK2" --json >/dev/null 2>&1 || true
FB3="$(fscan)"
FC3="$(fcand "$FB3")"
P_A3="$(cand_id "$FC3" "fa")"
P_B3="$(cand_id "$FC3" "fb")"
FP3="$(fplan "$FB3" "[{\"candidate_id\":\"${P_A3}\",\"kind\":\"add\"},{\"candidate_id\":\"${P_B3}\",\"kind\":\"add\"}]")"
PID3="$(printf '%s' "$FP3" | jq -r '.plan_id')"
R="$(fapply "$PID3" INTAKE_FAULT_STAGE=write_history)"
expect_eq "$(printf '%s' "$R" | jq -r '.status // "none"')" "incomplete" "fault_write_history_status"
expect_eq "$(fhist | jq -r --arg p "$PID3" '[.[] | select(.status == "ok" and .plan_id == $p)] | length')" "0" "fault_write_history_terminal_missing"
expect_eq "$(fhist | jq -r --arg p "$PID3" '[.[] | select(.plan_id == $p and .status == "incomplete")] | length')" "1" "fault_write_history_incomplete_recorded"
VERS_BEFORE="$(find "$REPO_F/.ai-workspace/assets" -maxdepth 2 -type d -name 'v*' | wc -l | tr -d ' ')"
R="$(fapply_resume "$PID3")"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "ok" "fault_write_history_resume_ok"
expect_eq "$(find "$REPO_F/.ai-workspace/assets" -maxdepth 2 -type d -name 'v*' | wc -l | tr -d ' ')" "$VERS_BEFORE" "fault_write_history_no_new_version_dirs"
expect_eq "$(freg | jq -r '.assets | length')" "2" "fault_write_history_registry_stable"

# (e) update 的部分提交 + 续跑：版本连续、回退基准是更新前内容
printf -- '---\nid: fa\ntitle: FA\n---\n# FA\n\nFA-BODY-2\n' > "${SRC_F}/.cursor/rules/fa.mdc"
FB4="$(fscan)"
FC4="$(fcand "$FB4")"
P_A4="$(cand_id "$FC4" "fa")"
FP4="$(fplan "$FB4" "[{\"candidate_id\":\"${P_A4}\",\"kind\":\"update\"}]")"
PID4="$(printf '%s' "$FP4" | jq -r '.plan_id')"
AID_FA="$(freg | jq -r '[.assets | to_entries[] | select(.value.canonical_path | endswith("fa.md"))][0].key')"
BEFORE_CONTENT="$(cat "${REPO_F}/.ai-workspace/rules/domains/fa.md")"
R="$(fapply "$PID4" INTAKE_FAULT_STAGE=write_registry)"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "incomplete" "fault_update_status"
R="$(fapply_resume "$PID4")"
expect_eq "$(printf '%s' "$R" | jq -r '.status')" "ok" "fault_update_resume_ok"
expect_eq "$(freg | jq -r --arg a "$AID_FA" '.assets[$a].current_version')" "2" "fault_update_version_2"
expect_eq "$(freg | jq -r --arg a "$AID_FA" '[.assets[$a].versions[].version] | join(",")')" "1,2" "fault_update_versions_contiguous"
expect_eq "$(freg | jq -r --arg a "$AID_FA" '(.assets[$a].versions[0].identity != .assets[$a].versions[1].identity)')" "true" "fault_update_versions_distinct"
OUT="$(fhist | jq -r --arg p "$PID4" '[.[] | select(.plan_id == $p and .status == "ok")] | last | .apply_id')"
"$FCLI" intake rollback --repo "$REPO_F" --apply "$OUT" --json >/dev/null 2>&1 || true
expect_eq "$(cat "${REPO_F}/.ai-workspace/rules/domains/fa.md")" "$BEFORE_CONTENT" "fault_update_rollback_restores_previous_content"

# ============================================================================
# 五、回退一致性
# ============================================================================
echo ""
echo "--- 五、回退一致性 ---"

REPO_R="${SANDBOX}/repo-rb"
SRC_R="${SANDBOX}/src-rb"
mkdir -p "$REPO_R/.ai-workspace/rules/domains" "$REPO_R/.ai-workspace/skills" \
         "$REPO_R/.ai-workspace/mcp" "$REPO_R/.ai-workspace/adapters"
prep_source "$SRC_R"
cp -R "${SCRIPT_DIR}/.." "$REPO_R/.ai-workspace/scripts"
chmod +x "${REPO_R}/.ai-workspace/scripts/aiws"
for t in cursor trae claude codex; do
  mkdir -p "$REPO_R/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$REPO_R/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$REPO_R/.ai-workspace/mcp/mcp.json"
RCLI="${REPO_R}/.ai-workspace/scripts/aiws"
rreg() { cat "$REPO_R/.ai-workspace/assets/registry.json" 2>/dev/null || echo '{}'; }
rscan() { "$RCLI" intake scan --repo "$REPO_R" --source "${SRC_R}:cursor:project" --json 2>/dev/null | jq -r '.batch_id'; }
rplan() {
  printf '{"decisions": %s}\n' "$2" > "${SANDBOX}/rd.json"
  "$RCLI" intake plan --repo "$REPO_R" --batch "$1" --decisions "${SANDBOX}/rd.json" --json 2>/dev/null
}
rapply() { "$RCLI" intake apply --repo "$REPO_R" --plan "$1" --json 2>/dev/null || true; }
rrollback() { "$RCLI" intake rollback --repo "$REPO_R" --apply "$1" --json 2>/dev/null || true; }

printf -- '---\nid: r1\ntitle: R1\n---\n# R1\n\nR1-BODY\n' > "${SRC_R}/.cursor/rules/r1.mdc"
RB1="$(rscan)"
RC1="$("$RCLI" intake compare --repo "$REPO_R" --batch "$RB1" --json 2>/dev/null)"
RP1="$(rplan "$RB1" "[{\"candidate_id\":\"$(cand_id "$RC1" "r1")\",\"kind\":\"add\"}]")"
RA1="$(rapply "$(printf '%s' "$RP1" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$RA1" | jq -r '.status')" "ok" "rollback_add_ok"
APPLY1="$(printf '%s' "$RA1" | jq -r '.apply_id')"
CANON_R1="${REPO_R}/.ai-workspace/rules/domains/r1.md"
cp "$CANON_R1" "${SANDBOX}/r1.applied"
RID="$(rreg | jq -r '.assets | keys[0] // ""')"
REG_BEFORE_HASH="$(shasum -a 256 "$REPO_R/.ai-workspace/assets/registry.json" | awk '{print $1}')"

# 冲突：文件被后续修改 → 不回退 registry，也不覆盖文件
printf '\nLATER-EDIT\n' >> "$CANON_R1"
LATER_HASH="$(shasum -a 256 "$CANON_R1" | awk '{print $1}')"
RB="$(rrollback "$APPLY1")"
expect_eq "$(printf '%s' "$RB" | jq -r '.rollback.status')" "rollback_conflict" "rollback_conflict_status"
expect_eq "$(printf '%s' "$RB" | jq -r '[.rollback.conflicts[] | select(.reason == "modified_after_apply")] | length >= 1')" "true" "rollback_conflict_modified_recorded"
expect_eq "$(shasum -a 256 "$CANON_R1" | awk '{print $1}')" "$LATER_HASH" "rollback_conflict_file_kept"
expect_eq "$(rreg | jq -r --arg a "$RID" '.assets[$a].current_version')" "1" "rollback_conflict_registry_not_reverted"
expect_eq "$(shasum -a 256 "$REPO_R/.ai-workspace/assets/registry.json" | awk '{print $1}')" "$REG_BEFORE_HASH" "rollback_conflict_registry_file_unchanged"

# 恢复被改动文件后，回退成功且内容与登记一致
cp "${SANDBOX}/r1.applied" "$CANON_R1"
RB="$(rrollback "$APPLY1")"
expect_eq "$(printf '%s' "$RB" | jq -r '.rollback.status')" "rolled_back" "rollback_after_restore_ok"
expect_file_absent "$CANON_R1" "rollback_removes_created_file"
expect_eq "$(rreg | jq -r --arg a "$RID" '(.assets[$a] // null) == null')" "true" "rollback_removes_registry_asset"

# 重复回退：幂等，不产生新的冲突
RB="$(rrollback "$APPLY1")"
expect_eq "$(printf '%s' "$RB" | jq -r '.rollback.status')" "rolled_back" "rollback_repeat_idempotent"
expect_eq "$(printf '%s' "$RB" | jq -r '.rollback.conflicts | length')" "0" "rollback_repeat_no_conflict"

# 后续批次推进 registry 时，不得破坏其仍引用的文件
printf -- '---\nid: r2\ntitle: R2\n---\n# R2\n\nR2-BODY\n' > "${SRC_R}/.cursor/rules/r2.mdc"
printf -- '---\nid: r1\ntitle: R1\n---\n# R1\n\nR1-BODY\n' > "${SRC_R}/.cursor/rules/r1.mdc"
RB2="$(rscan)"
RC2="$("$RCLI" intake compare --repo "$REPO_R" --batch "$RB2" --json 2>/dev/null)"
RP2="$(rplan "$RB2" "[{\"candidate_id\":\"$(cand_id "$RC2" "r1")\",\"kind\":\"add\"},{\"candidate_id\":\"$(cand_id "$RC2" "r2")\",\"kind\":\"add\"}]")"
RA2="$(rapply "$(printf '%s' "$RP2" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$RA2" | jq -r '.status')" "ok" "rollback_second_batch_ok"
APPLY2="$(printf '%s' "$RA2" | jq -r '.apply_id')"
R2_HASH="$(shasum -a 256 "${REPO_R}/.ai-workspace/rules/domains/r2.md" | awk '{print $1}')"
RB="$(rrollback "$APPLY2")"
expect_eq "$(printf '%s' "$RB" | jq -r '.rollback.status')" "rolled_back" "rollback_second_batch_clean"

# ============================================================================
# 六、共享资产的凭据门禁
# ============================================================================
echo ""
echo "--- 六、共享资产的凭据门禁 ---"

REPO_C="${SANDBOX}/repo-cred"
SRC_C="${SANDBOX}/src-cred"
mkdir -p "$REPO_C/.ai-workspace/rules/domains" "$REPO_C/.ai-workspace/skills" \
         "$REPO_C/.ai-workspace/mcp" "$REPO_C/.ai-workspace/adapters"
prep_source "$SRC_C"
cp -R "${SCRIPT_DIR}/.." "$REPO_C/.ai-workspace/scripts"
chmod +x "${REPO_C}/.ai-workspace/scripts/aiws"
for t in cursor trae claude codex; do
  mkdir -p "$REPO_C/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$REPO_C/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$REPO_C/.ai-workspace/mcp/mcp.json"
CCLI="${REPO_C}/.ai-workspace/scripts/aiws"
cscan() { "$CCLI" intake scan --repo "$REPO_C" --source "${SRC_C}:cursor:project" --json 2>/dev/null | jq -r '.batch_id'; }
cplan() {
  printf '{"decisions": %s}\n' "$2" > "${SANDBOX}/cd.json"
  "$CCLI" intake plan --repo "$REPO_C" --batch "$1" --decisions "${SANDBOX}/cd.json" --json 2>/dev/null
}
capply() { "$CCLI" intake apply --repo "$REPO_C" --plan "$1" --json 2>/dev/null || true; }

SECRET_RULE="SYNTHETIC-RULE-SECRET-0306"
printf -- '---\nid: leaky\ntitle: Leaky\n---\n# Leaky\n\n正常说明文字。\nAPI_KEY: %s\n' "$SECRET_RULE" \
  > "${SRC_C}/.cursor/rules/leaky.mdc"
CB="$(cscan)"
CC="$( "$CCLI" intake compare --repo "$REPO_C" --batch "$CB" --json 2>/dev/null)"
CPLAN="$(cplan "$CB" "[{\"candidate_id\":\"$(cand_id "$CC" "leaky")\",\"kind\":\"add\"}]")"
CRES="$(capply "$(printf '%s' "$CPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$CRES" | jq -r '.status // "none"')" "failed" "rule_plaintext_secret_rejected"
expect_contains "$(printf '%s' "$CRES" | jq -r '.errors | join(",")')" "credential_not_reference" "rule_plaintext_secret_reason"
expect_file_absent "${REPO_C}/.ai-workspace/rules/domains/leaky.md" "rule_plaintext_secret_no_canonical"
expect_absent "$(cat "$REPO_C/.ai-workspace/assets/history/"*.json 2>/dev/null)" "$SECRET_RULE" "rule_plaintext_secret_absent_from_history"
expect_absent "$(grep -rIl "$SECRET_RULE" "$REPO_C/.ai-workspace" 2>/dev/null || true)" "$SECRET_RULE" "rule_plaintext_secret_absent_from_repo"
expect_absent "$(grep -rIl "$SECRET_RULE" "${REPO_C}/.ai-workspace/intake" 2>/dev/null || true)" "$SECRET_RULE" "rule_plaintext_secret_absent_from_records"

# Skill 附属文件中的明文秘密同样拒绝
SECRET_SKILL="SYNTHETIC-SKILL-SECRET-0306"
mkdir -p "${SRC_C}/.cursor/skills/leaky-skill"
printf -- '---\nname: leaky-skill\ndescription: L\n---\n# L\n\nL-BODY\n' \
  > "${SRC_C}/.cursor/skills/leaky-skill/SKILL.md"
printf '#!/bin/sh\nPASSWORD=%s\necho ok\n' "$SECRET_SKILL" \
  > "${SRC_C}/.cursor/skills/leaky-skill/run.sh"
CB="$(cscan)"
CC="$("$CCLI" intake compare --repo "$REPO_C" --batch "$CB" --json 2>/dev/null)"
CPLAN="$(cplan "$CB" "[{\"candidate_id\":\"$(cand_id "$CC" "leaky-skill")\",\"kind\":\"add\"}]")"
CRES="$(capply "$(printf '%s' "$CPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$CRES" | jq -r '.status // "none"')" "failed" "skill_plaintext_secret_rejected"
expect_contains "$(printf '%s' "$CRES" | jq -r '.errors | join(",")')" "credential_not_reference" "skill_plaintext_secret_reason"
expect_file_absent "${REPO_C}/.ai-workspace/skills/leaky-skill" "skill_plaintext_secret_no_canonical"
expect_absent "$(grep -rIl "$SECRET_SKILL" "$REPO_C/.ai-workspace" 2>/dev/null || true)" "$SECRET_SKILL" "skill_plaintext_secret_absent_from_repo"

# 合法引用与非敏感内容正常入库
printf -- '---\nid: safe\ntitle: Safe\n---\n# Safe\n\n正常说明。\nAPI_KEY: ${secret:MY_KEY}\nnote: 普通字段\n' \
  > "${SRC_C}/.cursor/rules/safe.mdc"
CB="$(cscan)"
CC="$("$CCLI" intake compare --repo "$REPO_C" --batch "$CB" --json 2>/dev/null)"
CPLAN="$(cplan "$CB" "[{\"candidate_id\":\"$(cand_id "$CC" "safe")\",\"kind\":\"add\"}]")"
CRES="$(capply "$(printf '%s' "$CPLAN" | jq -r '.plan_id')")"
expect_eq "$(printf '%s' "$CRES" | jq -r '.status // "none"')" "ok" "secret_reference_allowed"
expect_contains "$(cat "${REPO_C}/.ai-workspace/rules/domains/safe.md" 2>/dev/null)" '${secret:MY_KEY}' "secret_reference_content_preserved"
expect_contains "$(cat "${REPO_C}/.ai-workspace/rules/domains/safe.md" 2>/dev/null)" "note: 普通字段" "nonsensitive_content_preserved"

# ============================================================================
# 七、忽略决定的来源边界
# ============================================================================
echo ""
echo "--- 七、忽略决定的来源边界 ---"

SRC_A="${SANDBOX}/src-ign-a"
SRC_B2="${SANDBOX}/src-ign-b"
prep_source "$SRC_A"
prep_source "$SRC_B2"
DUPDIR="${SANDBOX}/repo-ign"
mkdir -p "$DUPDIR/.ai-workspace/rules/domains" "$DUPDIR/.ai-workspace/skills" \
         "$DUPDIR/.ai-workspace/mcp" "$DUPDIR/.ai-workspace/adapters"
cp -R "${SCRIPT_DIR}/.." "$DUPDIR/.ai-workspace/scripts"
chmod +x "${DUPDIR}/.ai-workspace/scripts/aiws"
for t in cursor trae claude codex; do
  mkdir -p "$DUPDIR/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$DUPDIR/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$DUPDIR/.ai-workspace/mcp/mcp.json"
ICLI="${DUPDIR}/.ai-workspace/scripts/aiws"

write_dup() { printf -- '---\nid: dup\ntitle: Dup\n---\n# Dup\n\n%s\n' "$2" > "$1/.cursor/rules/dup.mdc"; }
write_dup "$SRC_A" "DUP-BODY-V1"
write_dup "$SRC_B2" "DUP-BODY-V1"

iscan() {
  local args=""
  for s in "$@"; do args="$args --source $s:cursor:project"; done
  # shellcheck disable=SC2086
  "$ICLI" intake scan --repo "$DUPDIR" $args --json 2>/dev/null | jq -r '.batch_id'
}
icompare() { "$ICLI" intake compare --repo "$DUPDIR" --batch "$1" --json 2>/dev/null; }
iignore() {
  printf '{"decisions": [{"candidate_id": "%s", "kind": "ignore"}]}\n' "$2" > "${SANDBOX}/id.json"
  local P
  P="$("$ICLI" intake plan --repo "$DUPDIR" --batch "$1" --decisions "${SANDBOX}/id.json" --json 2>/dev/null)"
  "$ICLI" intake apply --repo "$DUPDIR" --plan "$(printf '%s' "$P" | jq -r '.plan_id')" --json >/dev/null 2>&1 || true
}

IB="$(iscan "$SRC_A")"
IC="$(icompare "$IB")"
iignore "$IB" "$(cand_id "$IC" "dup")"

# A 未变化：不再重复提醒
IB="$(iscan "$SRC_A")"
IC="$(icompare "$IB")"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates | length')" "0" "ignore_same_source_not_reported"
expect_eq "$(printf '%s' "$IC" | jq -r '.suppressed | length')" "1" "ignore_same_source_suppressed"

# 首次扫描 B：同内容但从未审核过，必须进入审核
IB="$(iscan "$SRC_B2")"
IC="$(icompare "$IB")"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates | length')" "1" "ignore_new_source_still_reviewed"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates[0].suppressed')" "false" "ignore_new_source_not_suppressed"

# A + B 联合扫描：B 的来源未被审核过，不能被 A 的忽略吞掉
IB="$(iscan "$SRC_A" "$SRC_B2")"
IC="$(icompare "$IB")"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates | length')" "1" "ignore_joint_scan_still_reviewed"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates[0].suppressed')" "false" "ignore_joint_scan_not_suppressed"

# 原来源内容变化：重新进入审核
write_dup "$SRC_A" "DUP-BODY-V2"
IB="$(iscan "$SRC_A")"
IC="$(icompare "$IB")"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates[0].suppressed')" "false" "ignore_changed_source_not_suppressed"
expect_eq "$(printf '%s' "$IC" | jq -r '(.candidates[0].labels | index("changed")) != null')" "true" "ignore_changed_source_labeled"

# 暂缓与忽略语义不同：暂缓项始终留在待审核队列
printf '{"decisions": [{"candidate_id": "%s", "kind": "defer"}]}\n' \
  "$(printf '%s' "$IC" | jq -r '.candidates[0].candidate_id')" > "${SANDBOX}/idef.json"
IP="$("$ICLI" intake plan --repo "$DUPDIR" --batch "$IB" --decisions "${SANDBOX}/idef.json" --json 2>/dev/null)"
"$ICLI" intake apply --repo "$DUPDIR" --plan "$(printf '%s' "$IP" | jq -r '.plan_id')" --json >/dev/null 2>&1 || true
IB="$(iscan "$SRC_A")"
IC="$(icompare "$IB")"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates[0].deferred')" "true" "defer_stays_in_queue"
expect_eq "$(printf '%s' "$IC" | jq -r '.candidates | length')" "1" "defer_not_moved_to_suppressed"

# ============================================================================
# 十、多行敏感值过滤
# ============================================================================
echo ""
echo "--- 十、多行敏感值过滤 ---"

cat > "${SANDBOX}/mock-model.js" <<'MOCK'
const http = require('http');
const fs = require('fs');
const mode = process.env.MOCK_MODE || 'ok';
const logFile = process.env.MOCK_LOG;
const bodyDir = process.env.MOCK_BODYDIR;
const portFile = process.env.MOCK_PORTFILE;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (logFile) fs.appendFileSync(logFile, JSON.stringify({ url: req.url, bytes: body.length }) + '\n');
    if (bodyDir) {
      const n = fs.readdirSync(bodyDir).filter((f) => f.startsWith('body-')).length;
      fs.writeFileSync(`${bodyDir}/body-${n}.json`, body);
    }
    if (mode === 'timeout') { setTimeout(() => { res.writeHead(200); res.end('{}'); }, 8000); return; }

    let payload = { items: [] };
    try { payload = JSON.parse(JSON.parse(body).messages[1].content); } catch (e) { /* 容错 */ }
    const items = payload.items || [];
    const first = items[0] || { occurrence_id: 'none', content: '' };
    const lines = (s) => String(s).split('\n');
    const anchor = (occ, content, sl, el) => ({
      source_occurrence_id: occ, start_line: sl, end_line: el,
      quote: lines(content).slice(sl - 1, el).join('\n') });
    const sug = (id, occ, content, sl, el) => ({
      suggestion_id: id, kind: 'split', source_occurrence_id: occ,
      source_anchors: [anchor(occ, content, sl, el)],
      proposed_content: `c-${id}`, category: 'general', rationale: 'r', related_asset_ids: [] });

    let out;
    switch (mode) {
      case 'badtype_srcoid':
        out = { suggestions: [Object.assign(sug('ai-1', first.occurrence_id, first.content, 1, 1),
                 { source_occurrence_id: [] })], uncovered_ranges: [] };
        break;
      case 'badtype_uncovered':
        out = { suggestions: items.map((it, i) => sug(`ai-${i + 1}`, it.occurrence_id, it.content, 1, 1)),
                uncovered_ranges: 'oops' };
        break;
      case 'frac_lines':
        out = { suggestions: [sug('ai-1', first.occurrence_id, first.content, 1, 1)].map((s) => {
          s.source_anchors[0].start_line = 1.5; s.source_anchors[0].end_line = 1.5; return s; }),
          uncovered_ranges: [] };
        break;
      case 'oob_lines':
        out = { suggestions: [sug('ai-1', first.occurrence_id, first.content, 900, 901)], uncovered_ranges: [] };
        break;
      case 'foreign_source':
        out = { suggestions: [sug('ai-1', first.occurrence_id, first.content, 1, 1)].map((s) => {
          s.source_anchors[0].source_occurrence_id = 'OUTSIDE_REQUEST'; return s; }),
          uncovered_ranges: [{ source_occurrence_id: 'OUTSIDE_REQUEST', start_line: 1, end_line: 1 }] };
        break;
      case 'multi_source':
        out = { suggestions: items.map((it, i) => sug(`ai-${i + 1}`, it.occurrence_id, it.content, 1, 1)),
                uncovered_ranges: items.map((it) => ({
                  source_occurrence_id: it.occurrence_id, start_line: 2,
                  end_line: Math.max(2, lines(it.content).length) })) };
        break;
      case 'partial':
        out = { suggestions: [
            sug('ai-1', first.occurrence_id, first.content, 1, 1),
            Object.assign(sug('ai-2', first.occurrence_id, first.content, 1, 1),
              { source_anchors: [anchor('OUTSIDE_REQUEST', first.content, 1, 1)] })],
          uncovered_ranges: [] };
        break;
      default:
        out = { suggestions: items.map((it, i) => sug(`ai-${i + 1}`, it.occurrence_id, it.content, 1, 1)),
                uncovered_ranges: items.map((it) => ({
                  source_occurrence_id: it.occurrence_id, start_line: 2,
                  end_line: Math.max(2, lines(it.content).length) })) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
});
server.listen(0, '127.0.0.1', () => { if (portFile) fs.writeFileSync(portFile, String(server.address().port)); });
MOCK

REPO_M="${SANDBOX}/repo-model"
SRC_M2="${SANDBOX}/src-model"
mkdir -p "$REPO_M/.ai-workspace/rules/domains" "$REPO_M/.ai-workspace/skills" \
         "$REPO_M/.ai-workspace/mcp" "$REPO_M/.ai-workspace/adapters"
prep_source "$SRC_M2"
cp -R "${SCRIPT_DIR}/.." "$REPO_M/.ai-workspace/scripts"
chmod +x "${REPO_M}/.ai-workspace/scripts/aiws"
for t in cursor trae claude codex; do
  mkdir -p "$REPO_M/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n' "$t" > "$REPO_M/.ai-workspace/adapters/$t/mapping.yaml"
done
echo '{"servers":{}}' > "$REPO_M/.ai-workspace/mcp/mcp.json"
MCLI="${REPO_M}/.ai-workspace/scripts/aiws"

MOCK_LOG="${SANDBOX}/mock.log"
MOCK_BODYDIR="${SANDBOX}/bodies"
mkdir -p "$MOCK_BODYDIR"
start_mock() {
  stop_mock
  rm -f "${SANDBOX}/port"
  : > "$MOCK_LOG"
  rm -f "${MOCK_BODYDIR}"/body-*.json
  MOCK_MODE="$1" MOCK_LOG="$MOCK_LOG" MOCK_BODYDIR="$MOCK_BODYDIR" MOCK_PORTFILE="${SANDBOX}/port" \
    node "${SANDBOX}/mock-model.js" >/dev/null 2>&1 &
  MOCK_PID=$!
  local i=0
  while [ "$i" -lt 80 ]; do [ -s "${SANDBOX}/port" ] && break; sleep 0.05; i=$((i + 1)); done
  MOCK_PORT="$(cat "${SANDBOX}/port" 2>/dev/null || echo '')"
  if [ -n "$MOCK_PORT" ]; then
    "$MCLI" intake model config --repo "$REPO_M" --base-url "http://127.0.0.1:${MOCK_PORT}/v1" \
      --model mock-model --no-credential --timeout-ms 1500 --json >/dev/null 2>&1 || true
  fi
}
stop_mock() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=""
  fi
}

SECRET_ML="SYNTHETIC-MULTILINE-SECRET-0306"
printf -- '---\nid: msecret\ntitle: M\n---\n# M\n\n正常第一段。\nAPI_KEY: |\n  %s\n结尾段落。\n' \
  "$SECRET_ML" > "${SRC_M2}/.cursor/rules/msecret.mdc"
printf -- '---\nid: mplain\ntitle: P\n---\n# P\n\n普通规则正文。\nnote: 非敏感值保留\n' \
  > "${SRC_M2}/.cursor/rules/mplain.mdc"

MB="$("$MCLI" intake scan --repo "$REPO_M" --source "${SRC_M2}:cursor:project" --json 2>/dev/null | jq -r '.batch_id')"
"$MCLI" intake compare --repo "$REPO_M" --batch "$MB" --json >/dev/null 2>&1 || true
MCAND="$("$MCLI" intake compare --repo "$REPO_M" --batch "$MB" --json 2>/dev/null \
  | jq -r '[.candidates[] | select(.names | index("msecret"))][0].candidate_id')"

start_mock ok
PREP="$("$MCLI" intake model prepare --repo "$REPO_M" --batch "$MB" --candidate "$MCAND" --json 2>/dev/null)"
RID="$(printf '%s' "$PREP" | jq -r '.request_id')"
expect_eq "$(printf '%s' "$PREP" | jq -r '.batches | length')" "1" "multiline_prepare_ok"
REQFILE="$REPO_M/.ai-workspace/intake/ai/requests/${RID}.json"
expect_absent "$(cat "$REQFILE" 2>/dev/null)" "$SECRET_ML" "multiline_secret_absent_from_request_file"
expect_contains "$(cat "$REQFILE" 2>/dev/null)" "正常第一段" "multiline_nonsensitive_kept_in_request"

SENT="$("$MCLI" intake model send --repo "$REPO_M" --request "$RID" --json 2>/dev/null || true)"
expect_eq "$(printf '%s' "$SENT" | jq -r '.summary.sent')" "1" "multiline_send_performed"
BODIES="$(cat "${MOCK_BODYDIR}"/body-*.json 2>/dev/null || echo '')"
expect_absent "$BODIES" "$SECRET_ML" "multiline_secret_absent_from_sent_body"
expect_contains "$BODIES" "正常第一段" "multiline_nonsensitive_present_in_sent_body"
RESULTS="$(cat "$REPO_M/.ai-workspace/intake/ai/results/${RID}"/batch-*.json 2>/dev/null || echo '')"
expect_absent "$RESULTS" "$SECRET_ML" "multiline_secret_absent_from_attempt_records"
expect_eq "$(printf '%s' "$SENT" | jq -r '[.batches[0].suggestions[] | select(.source_occurrence_id != null)] | length')" "1" "multiline_valid_suggestion_kept"

# ============================================================================
# 十一、响应结构及逐来源锚点校验
# ============================================================================
echo ""
echo "--- 十一、响应结构及逐来源锚点校验 ---"

ALL_CANDS="$("$MCLI" intake compare --repo "$REPO_M" --batch "$MB" --json 2>/dev/null \
  | jq -r '[.candidates[].candidate_id] | join(",")')"
prep_all() {
  local args=""
  local IFS=','
  for c in $ALL_CANDS; do args="$args --candidate $c"; done
  unset IFS
  # shellcheck disable=SC2086
  "$MCLI" intake model prepare --repo "$REPO_M" --batch "$MB" $args --json 2>/dev/null
}
send_req() { local rid="$1"; shift; "$MCLI" intake model send --repo "$REPO_M" --request "$rid" "$@" --json 2>/dev/null || true; }

for mode in badtype_srcoid badtype_uncovered frac_lines oob_lines foreign_source; do
  start_mock "$mode"
  P="$(prep_all)"
  R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
  B0="$(printf '%s' "$R" | jq -c '.batches[0]')"
  if [ "$(printf '%s' "$B0" | jq -r 'has("status")')" = "true" ]; then
    t_pass "${mode}_structured_result"
  else
    t_fail "${mode}_structured_result (got [$B0])"
  fi
  expect_eq "$(printf '%s' "$B0" | jq -r '(.suggestions | type) == "array"')" "true" "${mode}_suggestions_is_array"
done

start_mock badtype_srcoid
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length')" "0" "badtype_srcoid_rejected"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].rejected | length >= 1')" "true" "badtype_srcoid_reason_recorded"

start_mock badtype_uncovered
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length >= 1')" "true" "badtype_uncovered_keeps_valid"
expect_eq "$(printf '%s' "$R" | jq -r '(.batches[0].uncovered_ranges | type) == "array"')" "true" "badtype_uncovered_normalized"

start_mock frac_lines
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length')" "0" "fractional_lines_rejected"

start_mock oob_lines
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length')" "0" "out_of_range_lines_rejected"

start_mock foreign_source
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length')" "0" "foreign_source_anchor_rejected"
expect_eq "$(printf '%s' "$R" | jq -r '[.batches[0].uncovered_ranges[] | select(.source_occurrence_id == "OUTSIDE_REQUEST")] | length')" "0" "foreign_source_uncovered_dropped"

start_mock multi_source
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length')" "2" "multi_source_all_kept"
expect_eq "$(printf '%s' "$R" | jq -r '([.batches[0].uncovered_ranges[] | .source_occurrence_id] - .batches[0].occurrence_ids) | length')" "0" "multi_source_uncovered_carry_source"

start_mock partial
P="$(prep_all)"; R="$(send_req "$(printf '%s' "$P" | jq -r '.request_id')")"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].suggestions | length')" "1" "partial_keeps_valid"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].rejected | length')" "1" "partial_rejects_invalid"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].status')" "partial" "partial_status"

# ============================================================================
# 十二、跨次重试记录保留
# ============================================================================
echo ""
echo "--- 十二、跨次重试记录保留 ---"

start_mock timeout
P="$(prep_all)"
RID2="$(printf '%s' "$P" | jq -r '.request_id')"
R="$(send_req "$RID2" --retry 1)"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].status')" "timeout" "attempt_first_send_timeout"
RDIR="$REPO_M/.ai-workspace/intake/ai/results/${RID2}"
expect_eq "$(ls "$RDIR"/batch-1.attempt-*.json 2>/dev/null | wc -l | tr -d ' ')" "2" "attempt_first_send_two_attempts"
A1_HASH="$(shasum -a 256 "$RDIR/batch-1.attempt-1.json" 2>/dev/null | awk '{print $1}')"
A1_BODY="$(cat "$RDIR/batch-1.attempt-1.json" 2>/dev/null)"

R="$(send_req "$RID2" --retry 1)"
expect_eq "$(printf '%s' "$R" | jq -r '.batches[0].status')" "timeout" "attempt_second_send_timeout"
expect_eq "$(ls "$RDIR"/batch-1.attempt-*.json 2>/dev/null | wc -l | tr -d ' ')" "4" "attempt_second_send_appends"
expect_eq "$(shasum -a 256 "$RDIR/batch-1.attempt-1.json" 2>/dev/null | awk '{print $1}')" "$A1_HASH" "attempt_first_record_unchanged"
expect_eq "$(cat "$RDIR/batch-1.attempt-1.json" 2>/dev/null)" "$A1_BODY" "attempt_first_record_content_unchanged"
expect_eq "$(jq -s -r 'map(.attempt) | join(",")' "$RDIR"/batch-1.attempt-*.json 2>/dev/null)" "1,2,3,4" "attempt_numbers_contiguous"
expect_eq "$(jq -s -r '[.[] | .send_seq] | unique | length' "$RDIR"/batch-1.attempt-*.json 2>/dev/null)" "2" "attempt_send_sequence_distinct"
expect_eq "$(jq -s -r '[.[] | .body_hash] | unique | length' "$RDIR"/batch-1.attempt-*.json 2>/dev/null)" "1" "attempt_body_hash_consistent"

# 成功后再次发送同样追加，不覆盖
start_mock ok
P="$(prep_all)"
RID3="$(printf '%s' "$P" | jq -r '.request_id')"
send_req "$RID3" >/dev/null
BEFORE_ONE="$(cat "$REPO_M/.ai-workspace/intake/ai/results/${RID3}/batch-1.attempt-1.json")"
send_req "$RID3" >/dev/null
expect_eq "$(ls "$REPO_M/.ai-workspace/intake/ai/results/${RID3}"/batch-1.attempt-*.json | wc -l | tr -d ' ')" "2" "attempt_success_resend_appends"
expect_eq "$(cat "$REPO_M/.ai-workspace/intake/ai/results/${RID3}/batch-1.attempt-1.json")" "$BEFORE_ONE" "attempt_success_resend_keeps_first"

# ============================================================================
# 汇总
# ============================================================================
echo ""
echo "=== 结果: ${PASS} ok, ${FAIL} not ok ==="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
