#!/bin/sh
# ci.sh - Install/remove the AI Workspace GitHub Actions auto-sync workflow
# Requires: common.sh sourced first (AIWS_ROOT / AIWS_SCRIPTS_DIR)
#
# Workflow 是 aiws 的升级通道：install 对已托管文件覆盖再生成（与 hooks 的
# already-installed no-op 不同）；未托管的文件仍然绝不覆盖，只提示手工合并。

CI_MARKER="# aiws-managed"
CI_WORKFLOW_REL=".github/workflows/aiws-sync.yml"

ci_workflow_path() {
  git -C "$AIWS_ROOT" rev-parse --git-dir >/dev/null 2>&1 || {
    log_error "Not a git repository: ${AIWS_ROOT}"
    return 1
  }
  echo "${AIWS_ROOT}/${CI_WORKFLOW_REL}"
}

is_aiws_workflow() {
  grep -q "^${CI_MARKER}$" "$1" 2>/dev/null
}

# ============================================================================
# Install / Remove
# ============================================================================

install_ci_workflow() {
  local workflow
  workflow="$(ci_workflow_path)" || return 1

  if [ -f "$workflow" ]; then
    if is_aiws_workflow "$workflow"; then
      cp "${AIWS_SCRIPTS_DIR}/lib/ci-workflow.template" "$workflow"
      log_success "Regenerated aiws workflow: ${workflow}"
      return 0
    fi
    # 已存在非 aiws 管理的 workflow：绝不覆盖，让用户自己合并
    log_error "A workflow already exists and is not managed by aiws: ${workflow}"
    log_error "Merge the following content into it manually:"
    printf '%s\n' "----------" >&2
    cat "${AIWS_SCRIPTS_DIR}/lib/ci-workflow.template" >&2 || true
    printf '%s\n' "----------" >&2
    return 1
  fi

  mkdir -p "$(dirname "$workflow")"
  cp "${AIWS_SCRIPTS_DIR}/lib/ci-workflow.template" "$workflow"
  log_success "Installed aiws workflow: ${workflow}"
  # 私有仓库默认 GITHUB_TOKEN 只读，写回需要显式放行
  log_info "确保仓库设置允许 GITHUB_TOKEN 写入：Settings → Actions → General → Workflow permissions → Read and write"
}

uninstall_ci_workflow() {
  local workflow
  workflow="$(ci_workflow_path)" || return 1

  if [ ! -f "$workflow" ]; then
    log_info "No aiws workflow installed"
    return 0
  fi

  if ! is_aiws_workflow "$workflow"; then
    log_error "Refusing to remove workflow not managed by aiws: ${workflow}"
    return 1
  fi

  rm "$workflow"
  log_success "Removed aiws workflow: ${workflow}"
}
