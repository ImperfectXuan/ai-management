#!/bin/sh
# skills-link.sh - Skills synchronization via symlinks/junctions
# Source this file from sync.sh or aiws CLI
# Requires: common.sh and platform.sh to be sourced first

# ============================================================================
# Skills Sync Main Function
# ============================================================================

sync_skills() {
  local target_scope="${1:-}"  # global, project, or empty for both
  local target_tool="${2:-}"    # specific tool name, or empty for all
  
  local skills_dir="${AIWS_DIR}/skills"
  
  if [ ! -d "$skills_dir" ]; then
    log_info "No skills directory found. Skipping skills sync."
    return 0
  fi
  
  # Check if there are any skills
  local has_skills=0
  for skill_dir in "${skills_dir}"/*/; do
    if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
      has_skills=1
      break
    fi
  done
  
  if [ "$has_skills" = "0" ]; then
    log_info "No skills found. Add skills to skills/<name>/SKILL.md"
    return 0
  fi
  
  log_info "Syncing skills..."
  
  # Get enabled tools (filtered if --tool specified)
  local tools
  if [ -n "$target_tool" ]; then
    tools="$target_tool"
  else
    tools="$(get_enabled_tools)"
  fi
  
  # Process each tool
  for tool in $tools; do
    # Determine scopes for this tool
    local scopes=""
    if [ -n "$target_scope" ]; then
      scopes="$target_scope"
    else
      scopes="global project"
    fi
    
    for scope in $scopes; do
      sync_skills_for_tool "$tool" "$scope"
    done
  done
}

# ============================================================================
# Tool-Specific Skills Sync
# ============================================================================

sync_skills_for_tool() {
  local tool="$1"
  local scope="$2"
  
  local skills_dir="${AIWS_DIR}/skills"
  local target_base
  target_base="$(get_tool_skills_path "$tool" "$scope")"
  
  if [ -z "$target_base" ]; then
    log_debug "Tool $tool does not support $scope skills scope"
    return 0
  fi
  
  # Ensure target directory exists
  ensure_dir "$target_base"
  
  # Link each skill
  local linked_count=0
  
  for skill_dir in "${skills_dir}"/*/; do
    [ -d "$skill_dir" ] || continue
    
    local skill_name
    skill_name="$(basename "$skill_dir")"
    
    # Skip non-skill directories
    if [ ! -f "${skill_dir}/SKILL.md" ]; then
      log_debug "Skipping $skill_name (no SKILL.md)"
      continue
    fi
    
    local target_path="${target_base}/${skill_name}"
    local source_path
    source_path="$(cd "$skill_dir" && pwd)"
    
    # Create link
    if create_link "$source_path" "$target_path"; then
      linked_count=$((linked_count + 1))
    fi
  done
  
  if [ "$linked_count" -gt 0 ]; then
    log_success "Skills synced: $tool ($scope) - $linked_count skill(s)"
  fi
}

# ============================================================================
# Skills Management Functions (for CLI)
# ============================================================================

# Link specific skills
skills_link() {
  local scope="${1:-global}"
  local tool="${2:-}"
  
  local skills_dir="${AIWS_DIR}/skills"
  local tools
  local scopes
  
  if [ -n "$tool" ]; then
    tools="$tool"
  else
    tools="$(get_enabled_tools)"
  fi
  scopes="$scope"
  
  for t in $tools; do
    for s in $scopes; do
      sync_skills_for_tool "$t" "$s"
    done
  done
}

# Unlink skills
skills_unlink() {
  local scope="${1:-global}"
  local tool="${2:-}"
  
  local tools
  if [ -n "$tool" ]; then
    tools="$tool"
  else
    tools="$(get_enabled_tools)"
  fi
  
  for t in $tools; do
    local target_base
    target_base="$(get_tool_skills_path "$t" "$scope")"
    
    if [ -z "$target_base" ] || [ ! -d "$target_base" ]; then
      continue
    fi
    
    # Remove links for our skills
    for skill_dir in "${AIWS_DIR}/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      
      local skill_name
      skill_name="$(basename "$skill_dir")"
      local target_path="${target_base}/${skill_name}"
      
      if [ -e "$target_path" ] || [ -L "$target_path" ]; then
        remove_link "$target_path"
        log_success "Unlinked: $t/$skill_name ($scope)"
      fi
    done
  done
}

# List all skills and their sync status
skills_list() {
  local skills_dir="${AIWS_DIR}/skills"
  local tools
  tools="$(get_enabled_tools)"
  
  echo "Skills in workspace:"
  echo ""
  
  local skill_count=0
  
  for skill_dir in "${skills_dir}"/*/; do
    [ -d "$skill_dir" ] || continue
    [ -f "${skill_dir}/SKILL.md" ] || continue
    
    local skill_name
    skill_name="$(basename "$skill_dir")"
    skill_count=$((skill_count + 1))
    
    # Get skill description from SKILL.md
    local description=""
    if [ -f "${skill_dir}/SKILL.md" ]; then
      description="$(grep -m1 '^description:' "${skill_dir}/SKILL.md" | sed 's/^description:[[:space:]]*//' | head -c 60)"
    fi
    
    printf "  ${BOLD}%s${NC}" "$skill_name"
    if [ -n "$description" ]; then
      printf " - %s" "$description"
    fi
    echo ""
    
    # Show sync status for each tool
    for tool in $tools; do
      local global_path
      global_path="$(get_tool_skills_path "$tool" "global")/${skill_name}"
      local project_path
      project_path="$(get_tool_skills_path "$tool" "project")/${skill_name}"
      
      local global_status="✗"
      local project_status="✗"
      
      if verify_link "$global_path" "$(cd "$skill_dir" && pwd)" 2>/dev/null || [ -e "$global_path" ]; then
        global_status="✓"
      fi
      
      if verify_link "$project_path" "$(cd "$skill_dir" && pwd)" 2>/dev/null || [ -e "$project_path" ]; then
        project_status="✓"
      fi
      
      printf "    %s: global=%s project=%s\n" "$tool" "$global_status" "$project_status"
    done
    echo ""
  done
  
  if [ "$skill_count" = "0" ]; then
    echo "  No skills found. Add skills to:"
    echo "  ${AIWS_DIR}/skills/<name>/SKILL.md"
  fi
}

# Install a skill from external source (GitHub or npm)
skills_install() {
  local source="$1"
  local skills_dir="${AIWS_DIR}/skills"
  
  if [ -z "$source" ]; then
    log_error "Usage: aiws skills install <source>"
    log_info "Source can be: GitHub URL, npm package, or local path"
    return 1
  fi
  
  ensure_dir "$skills_dir"
  
  case "$source" in
    http://*|https://*|git@*)
      # GitHub/Git URL
      install_skill_from_git "$source"
      ;;
    @*|!*)
      # npm package (starts with @ or !)
      install_skill_from_npm "$source"
      ;;
    /*|./*|../*)
      # Local path
      install_skill_from_path "$source"
      ;;
    *)
      # Try as GitHub shorthand (user/repo)
      install_skill_from_git "https://github.com/${source}.git"
      ;;
  esac
}

# Install skill from Git repository
install_skill_from_git() {
  local url="$1"
  local skills_dir="${AIWS_DIR}/skills"
  
  # Extract repo name for directory
  local repo_name
  repo_name="$(basename "$url" .git)"
  
  local temp_dir
  temp_dir="$(mktemp -d)"
  
  log_info "Cloning: $url"
  
  if git clone --depth 1 "$url" "$temp_dir" 2>/dev/null; then
    # Look for SKILL.md in common locations
    local skill_found=0
    
    for candidate in \
      "${temp_dir}/SKILL.md" \
      "${temp_dir}/skills/"*/SKILL.md \
      "${temp_dir}"/*/SKILL.md; do
      
      if [ -f "$candidate" ]; then
        local skill_dir
        skill_dir="$(dirname "$candidate")"
        local skill_name
        skill_name="$(basename "$skill_dir")"
        
        # Copy to our skills directory
        if [ "$skill_name" = "$(basename "$temp_dir")" ]; then
          # SKILL.md is at root
          cp -r "$skill_dir" "${skills_dir}/${repo_name}"
        else
          cp -r "$skill_dir" "${skills_dir}/${skill_name}"
        fi
        
        skill_found=1
        log_success "Installed skill: $skill_name"
      fi
    done
    
    if [ "$skill_found" = "0" ]; then
      log_warn "No SKILL.md found in repository"
    fi
  else
    log_error "Failed to clone: $url"
  fi
  
  rm -rf "$temp_dir"
}

# Install skill from npm package
install_skill_from_npm() {
  local package="$1"
  local skills_dir="${AIWS_DIR}/skills"
  
  log_info "Installing from npm: $package"
  
  local temp_dir
  temp_dir="$(mktemp -d)"
  
  if (cd "$temp_dir" && npm pack "$package" 2>/dev/null); then
    local tarball
    tarball="$(ls "${temp_dir}"/*.tgz 2>/dev/null | head -1)"
    
    if [ -n "$tarball" ]; then
      tar -xzf "$tarball" -C "$temp_dir"
      
      # Look for SKILL.md
      for candidate in "${temp_dir}/package/SKILL.md" "${temp_dir}/package/skills/"*/SKILL.md; do
        if [ -f "$candidate" ]; then
          local skill_dir
          skill_dir="$(dirname "$candidate")"
          local skill_name
          skill_name="$(basename "$skill_dir")"
          
          cp -r "$skill_dir" "${skills_dir}/${skill_name}"
          log_success "Installed skill: $skill_name"
        fi
      done
    fi
  else
    log_error "Failed to install npm package: $package"
  fi
  
  rm -rf "$temp_dir"
}

# Install skill from local path
install_skill_from_path() {
  local source_path="$1"
  local skills_dir="${AIWS_DIR}/skills"
  
  if [ ! -d "$source_path" ]; then
    log_error "Path does not exist: $source_path"
    return 1
  fi
  
  # Find SKILL.md
  if [ -f "${source_path}/SKILL.md" ]; then
    local skill_name
    skill_name="$(basename "$source_path")"
    
    cp -r "$source_path" "${skills_dir}/${skill_name}"
    log_success "Installed skill: $skill_name"
  else
    log_error "No SKILL.md found in: $source_path"
  fi
}
