#!/bin/sh
# test-skills-link.sh - skills-link.sh 的单元测试
# 用法: .ai-workspace/scripts/test/test-skills-link.sh
# 独立构造沙盒工作区（AIWS_ROOT 覆盖），不触碰真实仓库与 $HOME。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found; skip test-skills-link.sh"
  exit 0
fi

# ============================================================================
# 沙盒工作区构造
# ============================================================================

new_workspace() {
  local ws
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-skills-test.XXXXXX")"
  mkdir -p "$ws/.ai-workspace/skills/demo-a" \
           "$ws/.ai-workspace/skills/demo-b" \
           "$ws/.ai-workspace/config"
  cat > "$ws/.ai-workspace/skills/demo-a/SKILL.md" <<'SKILL'
---
name: demo-a
description: 测试技能 A
---
demo-a body
SKILL
  cat > "$ws/.ai-workspace/skills/demo-b/SKILL.md" <<'SKILL'
---
name: demo-b
description: 测试技能 B
---
demo-b body
SKILL
  cat > "$ws/.ai-workspace/config/workspace.json" <<'CFG'
{
  "version": "1.0",
  "tools": ["cursor"],
  "default_scope": "project",
  "skills": { "enabled": true }
}
CFG
  echo "$ws"
}

# 读取 JSON 里指定技能在 cursor/project 的状态
read_state() {
  local ws="$1" skill="$2" scope="$3"
  AIWS_ROOT="$ws" AIWS_JSON=1 "$LIB_DIR/../aiws" skills list \
    | jq -r ".skills[] | select(.name==\"$skill\") | .link_status.cursor.$scope"
}

run_aiws() {
  local ws="$1"; shift
  AIWS_ROOT="$ws" "$LIB_DIR/../aiws" "$@"
}

# ============================================================================
# 用例
# ============================================================================

echo "test-skills-link.sh"

# 1) 初始状态为 missing（不再把同名存在当已链接）
WS="$(new_workspace)"
if [ "$(read_state "$WS" demo-a project)" = "missing" ]; then
  t_pass "initial_state_is_missing"
else
  t_fail "initial_state_is_missing"
fi
rm -rf "$WS"

# 2) 单项链接只影响目标技能：demo-a 链接后 managed，demo-b 保持 missing
WS="$(new_workspace)"
run_aiws "$WS" skills link project cursor demo-a >/dev/null 2>&1
ok=1
[ "$(read_state "$WS" demo-a project)" = "managed" ] || ok=0
[ "$(read_state "$WS" demo-b project)" = "missing" ] || ok=0
[ -L "$WS/.cursor/skills/demo-a" ] || ok=0
if [ "$ok" = "1" ]; then
  t_pass "per_skill_link_isolation"
else
  t_fail "per_skill_link_isolation"
fi
rm -rf "$WS"

# 3) 单项卸载只移除目标技能
WS="$(new_workspace)"
run_aiws "$WS" skills link project cursor >/dev/null 2>&1
run_aiws "$WS" skills unlink project cursor demo-b >/dev/null 2>&1
ok=1
[ "$(read_state "$WS" demo-a project)" = "managed" ] || ok=0
[ "$(read_state "$WS" demo-b project)" = "missing" ] || ok=0
if [ "$ok" = "1" ]; then
  t_pass "per_skill_unlink_isolation"
else
  t_fail "per_skill_unlink_isolation"
fi
rm -rf "$WS"

# 4) 冲突态：手工同名目录显示 conflict，unlink 跳过且不删用户内容
WS="$(new_workspace)"
mkdir -p "$WS/.cursor/skills/demo-a"
printf 'manual' > "$WS/.cursor/skills/demo-a/note.txt"
if [ "$(read_state "$WS" demo-a project)" = "conflict" ]; then
  t_pass "unmanaged_dir_reported_conflict"
else
  t_fail "unmanaged_dir_reported_conflict"
fi

run_aiws "$WS" skills unlink project cursor demo-a >/dev/null 2>&1
ok=1
[ "$(read_state "$WS" demo-a project)" = "conflict" ] || ok=0
[ "$(cat "$WS/.cursor/skills/demo-a/note.txt")" = "manual" ] || ok=0
if [ "$ok" = "1" ]; then
  t_pass "unlink_skips_unmanaged_target"
else
  t_fail "unlink_skips_unmanaged_target"
fi

# 5) 对冲突目标重新 link：先备份为 .bak，再建链接并转为 managed
WS="$(new_workspace)"
mkdir -p "$WS/.cursor/skills/demo-a"
printf 'manual' > "$WS/.cursor/skills/demo-a/note.txt"
run_aiws "$WS" skills link project cursor demo-a >/dev/null 2>&1
ok=1
[ "$(read_state "$WS" demo-a project)" = "managed" ] || ok=0
[ -L "$WS/.cursor/skills/demo-a" ] || ok=0
backup="$(ls "$WS/.cursor/skills" | grep -E '^demo-a(\..+)?\.bak$' | head -1)"
[ -n "$backup" ] && [ "$(cat "$WS/.cursor/skills/$backup/note.txt")" = "manual" ] || ok=0
if [ "$ok" = "1" ]; then
  t_pass "relink_over_conflict_backs_up"
else
  t_fail "relink_over_conflict_backs_up"
fi
rm -rf "$WS"

# 6) skills.enabled=false 时 sync 跳过 skills 并输出原因
WS="$(new_workspace)"
cat > "$WS/.ai-workspace/config/workspace.json" <<'CFG'
{
  "version": "1.0",
  "tools": ["cursor"],
  "default_scope": "project",
  "skills": { "enabled": false }
}
CFG
mkdir -p "$WS/.ai-workspace/rules"
out="$(run_aiws "$WS" sync --tool cursor 2>&1)"
if printf '%s' "$out" | grep -q "Skills module disabled"; then
  t_pass "sync_skips_disabled_skills_module"
else
  t_fail "sync_skips_disabled_skills_module (output: $out)"
fi
if printf '%s' "$out" | grep -q "Syncing skills"; then
  t_fail "sync_skips_disabled_skills_module_still_synced"
else
  t_pass "sync_skips_disabled_skills_module_still_synced"
fi
rm -rf "$WS"

# 7) enabled 缺省（无 skills 字段）视为开启：sync 正常执行 skills
WS="$(new_workspace)"
cat > "$WS/.ai-workspace/config/workspace.json" <<'CFG'
{
  "version": "1.0",
  "tools": ["cursor"],
  "default_scope": "project"
}
CFG
out="$(run_aiws "$WS" sync --tool cursor 2>&1)"
if printf '%s' "$out" | grep -q "Syncing skills"; then
  t_pass "sync_defaults_to_enabled_when_field_missing"
else
  t_fail "sync_defaults_to_enabled_when_field_missing (output: $out)"
fi
rm -rf "$WS"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" -eq 0 ]
