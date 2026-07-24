#!/bin/sh
# import-skills.sh - Reverse import skills from tool directories into AI Workspace
# Source this file from aiws: . "${SCRIPT_DIR}/lib/import-skills.sh"

set -e

# ============================================================================
# Skills Import Engine
# ============================================================================

# Discover skills in a tool directory that can be imported.
# Returns newline-separated list: skill_name|source_path|reason
# reason is "symlink" (skip, already managed) or "exists" (skip, in workspace) or "new" (importable)
discover_importable_skills() {
  local skills_dir="$1"

  if [ ! -d "$skills_dir" ]; then
    return 0
  fi

  local workspace_skills_dir="${AIWS_DIR}/skills"

  for skill_dir in "${skills_dir}"/*/; do
    [ -d "$skill_dir" ] || continue

    local skill_name
    skill_name="$(basename "$skill_dir")"

    # Must have SKILL.md
    if [ ! -f "${skill_dir}/SKILL.md" ]; then
      log_debug "Skipping ${skill_name}: no SKILL.md"
      continue
    fi

    # Skip if source is a symlink (already managed by AIWS or similar)
    if [ -L "$skill_dir" ]; then
      local link_target
      link_target="$(readlink "$skill_dir")"
      printf '%s|%s|symlink|%s\n' "$skill_name" "$skill_dir" "$link_target"
      continue
    fi

    # Skip if already exists in workspace
    if [ -d "${workspace_skills_dir}/${skill_name}" ]; then
      printf '%s|%s|exists|\n' "$skill_name" "$skill_dir"
      continue
    fi

    # Importable
    printf '%s|%s|new|\n' "$skill_name" "$skill_dir"
  done
}

# Copy a single skill to the workspace
copy_skill() {
  local skill_name="$1"
  local source_path="$2"
  local dry_run="$3"

  local target_path="${AIWS_DIR}/skills/${skill_name}"

  if [ "$dry_run" = "1" ]; then
    log_info "  [DRY-RUN] Would copy: ${skill_name} -> ${target_path}"
    return 0
  fi

  ensure_dir "$(dirname "$target_path")"

  if cp -r "$source_path" "$target_path"; then
    log_success "  Imported: ${skill_name}"
    return 0
  else
    log_error "  Failed to copy: ${skill_name}"
    return 1
  fi
}

# Import skills from a specific tool + scope
import_skills_from_tool() {
  local tool="$1"
  local scope="$2"
  local dry_run="$3"

  local skills_dir
  skills_dir="$(get_tool_skills_path "$tool" "$scope")"

  if [ -z "$skills_dir" ]; then
    log_debug "No skills path for ${tool}/${scope}"
    return 0
  fi

  if [ ! -d "$skills_dir" ]; then
    log_debug "Skills directory not found: ${skills_dir}"
    return 0
  fi

  log_info "Scanning ${tool} (${scope}): ${skills_dir}"

  local imported_count=0
  local skipped_symlink=0
  local skipped_exists=0

  while IFS='|' read -r name path reason extra; do
    [ -n "$name" ] || continue

    case "$reason" in
      symlink)
        skipped_symlink=$((skipped_symlink + 1))
        log_debug "  SKIP ${name}: symlink (already managed)"
        ;;
      exists)
        skipped_exists=$((skipped_exists + 1))
        log_debug "  SKIP ${name}: already in workspace"
        ;;
      new)
        imported_count=$((imported_count + 1))
        copy_skill "$name" "$path" "$dry_run"
        ;;
    esac
  done << EOF
$(discover_importable_skills "$skills_dir")
EOF

  echo ""
  log_info "${tool}/${scope}: ${GREEN}${imported_count} imported${NC}, ${YELLOW}${skipped_symlink} symlink (managed)${NC}, ${CYAN}${skipped_exists} already in workspace${NC}"

  return 0
}

# Main import function
# Usage: import_skills [from_tool] [scope] [dry_run] [auto_yes]
import_skills() {
  local from_tool="${1:-}"
  local scope_filter="${2:-}"
  local dry_run="${3:-0}"
  local auto_yes="${4:-0}"

  echo ""

  if [ "$dry_run" = "1" ]; then
    log_info "=== Skills Import (DRY RUN) ==="
    echo ""
  else
    log_info "=== Skills Import ==="
    echo ""
  fi

  # Determine which tools to scan
  local tools
  if [ -n "$from_tool" ]; then
    tools="$from_tool"
  else
    tools="$(get_enabled_tools)"
  fi

  # Determine scopes
  local scopes
  if [ -n "$scope_filter" ]; then
    scopes="$scope_filter"
  else
    scopes="global project"
  fi

  # First pass: discover and preview (cross-tool dedup via tmp file)
  local seen_names
  seen_names="$(mktemp)"
  trap "rm -f '$seen_names'" EXIT

  local total_new=0
  local total_managed=0
  local total_existing=0

  for tool in $tools; do
    for scope in $scopes; do
      local skills_dir
      skills_dir="$(get_tool_skills_path "$tool" "$scope")"

      if [ -z "$skills_dir" ] || [ ! -d "$skills_dir" ]; then
        continue
      fi

      while IFS='|' read -r name path reason extra; do
        [ -n "$name" ] || continue
        case "$reason" in
          symlink)
            if ! grep -qxF "$name" "$seen_names" 2>/dev/null; then
              echo "$name" >> "$seen_names"
              total_managed=$((total_managed + 1))
            fi
            ;;
          exists)
            if ! grep -qxF "$name" "$seen_names" 2>/dev/null; then
              echo "$name" >> "$seen_names"
              total_existing=$((total_existing + 1))
            fi
            ;;
          new)
            if ! grep -qxF "$name" "$seen_names" 2>/dev/null; then
              echo "$name" >> "$seen_names"
              total_new=$((total_new + 1))
            fi
            ;;
        esac
      done << EOF
$(discover_importable_skills "$skills_dir")
EOF
    done
  done

  # Summary
  log_info "Import summary:"
  log_info "  ${GREEN}New (will import):${NC}  ${total_new}"
  log_info "  ${YELLOW}Symlink (managed):${NC} ${total_managed}"
  log_info "  ${CYAN}Already in workspace:${NC} ${total_existing}"
  echo ""

  if [ "$total_new" -eq 0 ]; then
    log_info "Nothing to import."
    return 0
  fi

  # Confirm
  if [ "$dry_run" = "1" ]; then
    log_info "Dry run complete. Run without --dry-run to import."
    return 0
  fi

  if [ "$auto_yes" != "1" ]; then
    printf "Import ${total_new} skill(s)? [y/N] "
    read -r confirm
    case "$confirm" in
      [yY]|[yY][eE][sS]) ;;
      *) log_info "Aborted."; return 0 ;;
    esac
  fi

  echo ""

  # Second pass: execute
  local imported_ok=0
  local imported_fail=0

  for tool in $tools; do
    for scope in $scopes; do
      import_skills_from_tool "$tool" "$scope" "$dry_run"
    done
  done

  echo ""
  log_success "Skills import complete."
  log_info "Run 'aiws sync' to link imported skills to all tools."
}
