#!/bin/sh
# test-ci.sh - ci.sh（GitHub Actions workflow 安装器）的单元测试
# 用法: .ai-workspace/scripts/test/test-ci.sh
# 独立构造沙盒 git 仓库（带完整 scripts 树），不触碰真实仓库。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"

PASS=0
FAIL=0

t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }

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

# ============================================================================
# 沙盒仓库构造
# ============================================================================

# 沙盒带完整 scripts 树：ci.sh 从 ${AIWS_SCRIPTS_DIR}/lib 读模板，
# 因此 AIWS_SCRIPTS_DIR 必须指向沙盒内（install_requires_git_repo 用例除外）
new_git_workspace() {
  local ws
  ws="$(mktemp -d "${TMPDIR:-/tmp}/aiws-ci-test.XXXXXX")"
  git -C "$ws" init -q -b main 2>/dev/null || git -C "$ws" init -q
  mkdir -p "$ws/.ai-workspace"
  cp -R "${SCRIPT_DIR}/.." "$ws/.ai-workspace/scripts"
  echo "$ws"
}

run_ci() {
  local ws="$1"; shift
  (
    export AIWS_ROOT="$ws"
    . "${LIB_DIR}/common.sh" >/dev/null 2>&1
    export AIWS_SCRIPTS_DIR="$ws/.ai-workspace/scripts"
    export AIWS_LIB_DIR="${LIB_DIR}"
    . "${LIB_DIR}/ci.sh"
    "$@"
  )
}

# ============================================================================
# 用例
# ============================================================================

echo "=== ci 测试 ==="

# 1) 安装生成带 aiws-managed 标记的 workflow
WS="$(new_git_workspace)"
run_ci "$WS" install_ci_workflow >/dev/null 2>&1
if [ -f "$WS/.github/workflows/aiws-sync.yml" ] \
  && [ "$(head -1 "$WS/.github/workflows/aiws-sync.yml")" = "# aiws-managed" ]; then
  t_pass "ci_install_creates_managed_workflow"
else
  t_fail "ci_install_creates_managed_workflow"
fi

# 2) 幂等：重复安装字节一致（覆盖再生成语义）
cp "$WS/.github/workflows/aiws-sync.yml" "$WS/before.yml"
run_ci "$WS" install_ci_workflow >/dev/null 2>&1
if cmp -s "$WS/before.yml" "$WS/.github/workflows/aiws-sync.yml"; then
  t_pass "ci_install_is_idempotent_byte_identical"
else
  t_fail "ci_install_is_idempotent_byte_identical"
fi
rm -rf "$WS"

# 3) 已存在非托管 workflow → 拒绝且文件不动，stderr 给出模板片段
WS="$(new_git_workspace)"
CUSTOM="$WS/.github/workflows/aiws-sync.yml"
mkdir -p "$(dirname "$CUSTOM")"
printf '# my own\nname: custom\n' > "$CUSTOM"
cp "$CUSTOM" "$WS/custom.expected"
ERR_OUT=""
rc=0
ERR_OUT="$(run_ci "$WS" install_ci_workflow 2>&1 >/dev/null)" || rc=$?
if [ "$rc" -eq 1 ] \
  && cmp -s "$CUSTOM" "$WS/custom.expected" \
  && printf '%s\n' "$ERR_OUT" | grep -q 'name: aiws-sync'; then
  t_pass "ci_install_refuses_non_managed_workflow"
else
  t_fail "ci_install_refuses_non_managed_workflow (rc=$rc)"
fi
rm -rf "$WS"

# 4) 卸载托管 workflow
WS="$(new_git_workspace)"
run_ci "$WS" install_ci_workflow >/dev/null 2>&1
assert_rc "ci_uninstall_removes_managed_workflow" 0 run_ci "$WS" uninstall_ci_workflow
if [ ! -f "$WS/.github/workflows/aiws-sync.yml" ]; then
  t_pass "ci_uninstall_removes_managed_workflow_file_gone"
else
  t_fail "ci_uninstall_removes_managed_workflow_file_gone"
fi
rm -rf "$WS"

# 5) 拒绝卸载非托管 workflow，文件保留
WS="$(new_git_workspace)"
CUSTOM="$WS/.github/workflows/aiws-sync.yml"
mkdir -p "$(dirname "$CUSTOM")"
printf '# my own\nname: custom\n' > "$CUSTOM"
assert_rc "ci_uninstall_refuses_non_managed_workflow" 1 run_ci "$WS" uninstall_ci_workflow
if [ -f "$CUSTOM" ]; then
  t_pass "ci_uninstall_refuses_non_managed_workflow_file_kept"
else
  t_fail "ci_uninstall_refuses_non_managed_workflow_file_kept"
fi
rm -rf "$WS"

# 6) 非 git 仓库 → rc 1
WS="$(mktemp -d "${TMPDIR:-/tmp}/aiws-ci-nogit.XXXXXX")"
assert_rc "ci_install_requires_git_repo" 1 run_ci "$WS" install_ci_workflow
rm -rf "$WS"

# 7) workflow 关键内容：rules-only 同步 + [skip ci] + 串行 + 写权限 + 触发路径
WS="$(new_git_workspace)"
run_ci "$WS" install_ci_workflow >/dev/null 2>&1
YML="$WS/.github/workflows/aiws-sync.yml"
if grep -q -- '--only rules' "$YML" \
  && grep -q '\[skip ci\]' "$YML" \
  && grep -q 'concurrency:' "$YML" \
  && grep -q 'permissions:' "$YML" \
  && grep -q -- '.ai-workspace/\*\*' "$YML"; then
  t_pass "ci_workflow_syncs_rules_only_with_skip_ci"
else
  t_fail "ci_workflow_syncs_rules_only_with_skip_ci"
fi

# 8) validate 按"生成文件是否被 git 跟踪"分流
if grep -q 'git ls-files CLAUDE.md' "$YML"; then
  t_pass "ci_workflow_validate_branches_on_tracked_generated_files"
else
  t_fail "ci_workflow_validate_branches_on_tracked_generated_files"
fi
rm -rf "$WS"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "pass $PASS / fail $FAIL"
[ "$FAIL" -eq 0 ]
