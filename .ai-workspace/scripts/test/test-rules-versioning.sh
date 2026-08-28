#!/bin/sh
# test-rules-versioning.sh - rules-versioning.sh 与 sync --only 的单元/集成测试
# 用法: .ai-workspace/scripts/test/test-rules-versioning.sh
# 独立构造沙盒工作区（含临时 git 仓库），不触碰真实仓库。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

# 断言：返回码精确等于期望值
# 不用宽松的"非零即失败"，否则环境错误(rc=2)会洗白检出用例(rc=1)
assert_rc() {
  local desc="$1" expected="$2"; shift 2
  local rc=0
  "$@" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq "$expected" ]; then
    t_pass "$desc"
  else
    t_fail "$desc (expected rc=$expected, got rc=$rc)"
  fi
}

# 用例 15/16 依赖 jq 门控语义（is_module_enabled）
if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found; skip test-rules-versioning.sh"
  exit 0
fi

# ============================================================================
# 沙盒工作区构造
# ============================================================================

new_workspace() {
  local ws
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-versioning-test.XXXXXX")"
  mkdir -p "$ws/.ai-workspace/rules/domains"

  cat > "$ws/.ai-workspace/rules/00-core.md" <<'EOF'
---
id: "00-core"
title: Core
scope: all
description: core rules
---

# Core

- Be explicit.
EOF
  cat > "$ws/.ai-workspace/rules/domains/vue.md" <<'EOF'
---
id: vue
title: Vue
scope: vue
description: vue rules
---

# Vue

- Use Composition API.
EOF

  echo "$ws"
}

# git 沙盒：提交一律内联身份，绝不依赖（也不污染）全局 git 配置
git_init_ws() {
  local ws="$1"
  git -C "$ws" init -q -b main 2>/dev/null || git -C "$ws" init -q
  git -C "$ws" add -A
  git -C "$ws" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "init"
}

# 在干净子 shell 中运行 rules-versioning 函数；AIWS_ROOT 必须指向被测工作区
run_ws() {
  local ws="$1"; shift
  (
    export AIWS_ROOT="$ws"
    . "${LIB_DIR}/common.sh" >/dev/null 2>&1
    # common.sh 会把 AIWS_LIB_DIR 推导到沙盒内不存在的路径，
    # 而沙盒工作区不含 scripts/，必须显式改指真实 lib 目录
    export AIWS_LIB_DIR="${LIB_DIR}"
    . "${LIB_DIR}/rules-versioning.sh"
    "$@"
  )
}

# 通过真实 CLI 运行（集成用例）
run_aiws() {
  local ws="$1"; shift
  AIWS_ROOT="$ws" "$LIB_DIR/../aiws" "$@"
}

# 为集成用例补齐 cursor/trae mapping（与 test-drift-check.sh 同款）
add_mappings() {
  local ws="$1" tool
  for tool in cursor trae; do
    mkdir -p "$ws/.ai-workspace/adapters/$tool"
    {
      printf 'tool: %s\n' "$tool"
      printf 'version: ">=0.1"\n'
      printf 'rules:\n'
      printf '  - source: rules/00-core.md\n'
      printf '    required: true\n'
      printf '  - source: rules/domains/vue.md\n'
      printf '    required: true\n'
    } > "$ws/.ai-workspace/adapters/$tool/mapping.yaml"
  done
}

# ============================================================================
# 用例
# ============================================================================

echo "=== rules-versioning 测试 ==="

# 1) 首跑建基线：manifest 行数 == 规则数，CHANGELOG 记录基线条数
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
if [ -f "$WS/.ai-workspace/rules/.manifest.sha256" ] \
  && [ "$(wc -l < "$WS/.ai-workspace/rules/.manifest.sha256" | tr -d ' ')" = "2" ] \
  && grep -q '基线: 2 条规则' "$WS/.ai-workspace/rules/CHANGELOG.md"; then
  t_pass "rules_versioning_record_first_run_creates_baseline"
else
  t_fail "rules_versioning_record_first_run_creates_baseline"
fi
rm -rf "$WS"

# 2) 无变化零写：重复 record 后 manifest 与 CHANGELOG 字节一致
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
cp "$WS/.ai-workspace/rules/.manifest.sha256" "$WS/m1"
cp "$WS/.ai-workspace/rules/CHANGELOG.md" "$WS/c1"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
if cmp -s "$WS/m1" "$WS/.ai-workspace/rules/.manifest.sha256" \
  && cmp -s "$WS/c1" "$WS/.ai-workspace/rules/CHANGELOG.md"; then
  t_pass "rules_versioning_record_no_change_writes_nothing"
else
  t_fail "rules_versioning_record_no_change_writes_nothing"
fi
rm -rf "$WS"

# 3) 修改规则 → CHANGELOG 追加 modified 行，含新旧 8 位哈希对
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
printf '\n- edit\n' >> "$WS/.ai-workspace/rules/domains/vue.md"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
if grep -Eq -- '- modified: rules/domains/vue\.md \([0-9a-f]{8} → [0-9a-f]{8}\)' \
  "$WS/.ai-workspace/rules/CHANGELOG.md"; then
  t_pass "rules_versioning_record_modified_rule_appends_changelog_entry"
else
  t_fail "rules_versioning_record_modified_rule_appends_changelog_entry"
fi
rm -rf "$WS"

# 4) 新增规则 → added 行，old 侧为 -
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
cat > "$WS/.ai-workspace/rules/domains/extra.md" <<'EOF'
---
id: extra
title: Extra
scope: all
---
# Extra
EOF
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
if grep -q -- '- added: rules/domains/extra.md (- → ' "$WS/.ai-workspace/rules/CHANGELOG.md"; then
  t_pass "rules_versioning_record_added_rule_reports_added"
else
  t_fail "rules_versioning_record_added_rule_reports_added"
fi
rm -rf "$WS"

# 5) 删除规则 → removed 行，new 侧为 -
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
rm "$WS/.ai-workspace/rules/domains/vue.md"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
if grep -Eq -- '- removed: rules/domains/vue\.md \([0-9a-f]{8} → -\)' \
  "$WS/.ai-workspace/rules/CHANGELOG.md"; then
  t_pass "rules_versioning_record_removed_rule_reports_removed"
else
  t_fail "rules_versioning_record_removed_rule_reports_removed"
fi
rm -rf "$WS"

# 6) compute 排除 CHANGELOG.md：手工预置后 manifest 仍只有 2 行
WS="$(new_workspace)"
printf '# 手工日志\n' > "$WS/.ai-workspace/rules/CHANGELOG.md"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
if [ "$(wc -l < "$WS/.ai-workspace/rules/.manifest.sha256" | tr -d ' ')" = "2" ] \
  && ! grep -q 'CHANGELOG' "$WS/.ai-workspace/rules/.manifest.sha256"; then
  t_pass "rules_manifest_compute_excludes_changelog"
else
  t_fail "rules_manifest_compute_excludes_changelog"
fi
rm -rf "$WS"

# 7) manifest 与 sha256sum 校验工具兼容（按平台取其一）
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
verify_ok=0
if command -v shasum >/dev/null 2>&1; then
  (cd "$WS/.ai-workspace" && shasum -a 256 -c rules/.manifest.sha256) >/dev/null 2>&1 && verify_ok=1
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$WS/.ai-workspace" && sha256sum -c rules/.manifest.sha256) >/dev/null 2>&1 && verify_ok=1
fi
if [ "$verify_ok" = "1" ]; then
  t_pass "rules_manifest_is_sha256sum_compatible"
else
  t_fail "rules_manifest_is_sha256sum_compatible"
fi
rm -rf "$WS"

# 8) diff 直接调用：modified 带新旧哈希对，另报 added / removed
WS="$(new_workspace)"
OLD="$(mktemp)"
NEW="$(mktemp)"
{
  printf '1111111111111111  rules/a.md\n'
  printf '2222222222222222  rules/domains/b.md\n'
} > "$OLD"
{
  printf '3333333333333333  rules/a.md\n'
  printf '4444444444444444  rules/domains/c.md\n'
} > "$NEW"
DIFF_OUT="$(run_ws "$WS" rules_manifest_diff "$OLD" "$NEW")"
if printf '%s\n' "$DIFF_OUT" | grep -q 'modified rules/a.md 11111111 33333333' \
  && printf '%s\n' "$DIFF_OUT" | grep -q 'added rules/domains/c.md - 44444444' \
  && printf '%s\n' "$DIFF_OUT" | grep -q 'removed rules/domains/b.md 22222222 -'; then
  t_pass "rules_manifest_diff_reports_modified_with_hash_pair"
else
  t_fail "rules_manifest_diff_reports_modified_with_hash_pair"
fi
rm -rf "$WS" "$OLD" "$NEW"

# 9) 一致 → rc 0
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
assert_rc "rules_status_clean_returns_zero" 0 run_ws "$WS" rules_status
rm -rf "$WS"

# 10) 有变更 → rc 1
WS="$(new_workspace)"
run_ws "$WS" rules_versioning_record >/dev/null 2>&1
printf '\n- drift\n' >> "$WS/.ai-workspace/rules/domains/vue.md"
assert_rc "rules_status_drifted_returns_one" 1 run_ws "$WS" rules_status
rm -rf "$WS"

# 11) 无 manifest → rc 2（环境错误，与"有变更"严格区分）
WS="$(new_workspace)"
assert_rc "rules_status_missing_manifest_returns_two" 2 run_ws "$WS" rules_status
rm -rf "$WS"

# 12) history 按 id 解析并输出两次提交的短哈希
WS="$(new_workspace)"
git_init_ws "$WS"
printf '\n- v2\n' >> "$WS/.ai-workspace/rules/domains/vue.md"
git -C "$WS" add -A
git -C "$WS" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m "update vue"
HIST_OUT="$(run_ws "$WS" rules_history vue)"
if printf '%s\n' "$HIST_OUT" | grep -Ec '^[0-9a-f]{7,} ' | grep -q '^2$'; then
  t_pass "rules_history_resolves_id_and_prints_git_log"
else
  t_fail "rules_history_resolves_id_and_prints_git_log"
fi
rm -rf "$WS"

# 13) 未知 id → rc 1
WS="$(new_workspace)"
git_init_ws "$WS"
assert_rc "rules_history_unknown_id_fails_loud" 1 run_ws "$WS" rules_history nope
rm -rf "$WS"

# 14) 非 git 仓库 → rc 1
WS="$(new_workspace)"
assert_rc "rules_history_outside_git_repo_fails_loud" 1 run_ws "$WS" rules_history vue
rm -rf "$WS"

# 15) sync --only rules：规则产物与 manifest 落盘，mcp/skills 产物不产生
WS="$(new_workspace)"
add_mappings "$WS"
mkdir -p "$WS/.ai-workspace/mcp" "$WS/.ai-workspace/skills/demo"
printf '{"servers":{}}' > "$WS/.ai-workspace/mcp/mcp.json"
cat > "$WS/.ai-workspace/skills/demo/SKILL.md" <<'SKILL'
---
name: demo
description: 测试技能
---
demo body
SKILL
if run_aiws "$WS" sync --only rules >/dev/null 2>&1 \
  && [ -f "$WS/.cursor/rules/00-core.mdc" ] \
  && [ -f "$WS/.ai-workspace/rules/.manifest.sha256" ] \
  && [ ! -e "$WS/.mcp.json" ] \
  && [ ! -d "$WS/.agents" ] \
  && [ ! -d "$WS/.cursor/skills" ]; then
  t_pass "sync_only_rules_skips_mcp_and_skills"
else
  t_fail "sync_only_rules_skips_mcp_and_skills"
fi
rm -rf "$WS"

# 16) rules.versioning.enabled=false 时不落 manifest；
#     同时回归点号路径、顶层键与缺省放行三种 is_module_enabled 语义
WS="$(new_workspace)"
add_mappings "$WS"
mkdir -p "$WS/.ai-workspace/config"
cat > "$WS/.ai-workspace/config/workspace.json" <<'CFG'
{
  "version": "1.0",
  "tools": ["cursor"],
  "default_scope": "project",
  "rules": { "versioning": { "enabled": false } },
  "skills": { "enabled": false }
}
CFG
run_aiws "$WS" sync --only rules >/dev/null 2>&1 || true
if [ ! -f "$WS/.ai-workspace/rules/.manifest.sha256" ] \
  && ! run_ws "$WS" is_module_enabled "skills" >/dev/null 2>&1 \
  && ! run_ws "$WS" is_module_enabled "rules.versioning" >/dev/null 2>&1 \
  && run_ws "$WS" is_module_enabled "mcp" >/dev/null 2>&1; then
  t_pass "sync_rules_respects_versioning_module_disable"
else
  t_fail "sync_rules_respects_versioning_module_disable"
fi
rm -rf "$WS"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" -eq 0 ]
