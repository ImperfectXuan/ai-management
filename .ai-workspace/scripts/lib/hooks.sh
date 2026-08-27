#!/bin/sh
# hooks.sh - Install/remove the AI Workspace pre-commit hook
# Requires: common.sh sourced first (AIWS_ROOT / AIWS_SCRIPTS_DIR)

HOOK_MARKER="# aiws-managed"

# Path of the hook we manage. Returns non-zero when not inside a git repo.
git_hooks_path() {
  local hooks_dir
  hooks_dir="$(git -C "$AIWS_ROOT" rev-parse --git-path hooks 2>/dev/null)" || {
    log_error "Not a git repository: ${AIWS_ROOT}"
    return 1
  }
  # git-path may be relative to cwd; normalize against AIWS_ROOT
  case "$hooks_dir" in
    /*) ;;
    *) hooks_dir="${AIWS_ROOT}/${hooks_dir}" ;;
  esac
  echo "${hooks_dir}/pre-commit"
}

is_aiws_hook() {
  grep -q "^${HOOK_MARKER}$" "$1" 2>/dev/null
}

# ============================================================================
# Install / Remove
# ============================================================================

install_pre_commit_hook() {
  local hook
  hook="$(git_hooks_path)" || return 1

  if [ -f "$hook" ]; then
    if is_aiws_hook "$hook"; then
      log_success "Pre-commit hook already installed (managed by aiws)"
      return 0
    fi
    # 已存在非 aiws 管理的钩子：绝不覆盖，让用户自己合并
    log_error "A pre-commit hook already exists and is not managed by aiws: ${hook}"
    log_error "Merge the following snippet into it manually:"
    printf '%s\n' "----------" >&2
    cat "${AIWS_SCRIPTS_DIR}/lib/hook-pre-commit.template" >&2 || true
    printf '%s\n' "----------" >&2
    return 1
  fi

  mkdir -p "$(dirname "$hook")"
  cp "${AIWS_SCRIPTS_DIR}/lib/hook-pre-commit.template" "$hook"
  chmod +x "$hook"
  log_success "Installed pre-commit hook: ${hook}"
}

uninstall_pre_commit_hook() {
  local hook
  hook="$(git_hooks_path)" || return 1

  if [ ! -f "$hook" ]; then
    log_info "No pre-commit hook installed"
    return 0
  fi

  if ! is_aiws_hook "$hook"; then
    log_error "Refusing to remove pre-commit hook not managed by aiws: ${hook}"
    return 1
  fi

  rm "$hook"
  log_success "Removed pre-commit hook: ${hook}"
}
