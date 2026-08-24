#!/bin/sh
# platform.sh - Cross-platform link abstraction
# Provides unified interface for creating symlinks/junctions across platforms
# Source this file from other scripts: . "$(dirname "$0")/lib/platform.sh"

# Requires: common.sh to be sourced first

# ============================================================================
# Link Type Detection
# ============================================================================

# Get the best link type for current platform
get_link_type() {
  case "$OS" in
    macos|linux)
      echo "symlink"
      ;;
    windows)
      # Check if we can use symlinks (requires admin or developer mode)
      if can_create_symlink; then
        echo "symlink"
      else
        echo "junction"
      fi
      ;;
    *)
      echo "copy"  # Fallback
      ;;
  esac
}

# Check if we can create symlinks on Windows
can_create_symlink() {
  if ! is_windows; then
    return 0  # Not Windows, always true
  fi
  
  # Try to detect if symlink creation works
  local test_link="/tmp/aiws_test_symlink_$$"
  local test_target="/tmp/aiws_test_target_$$"
  
  mkdir -p "$test_target"
  ln -sf "$test_target" "$test_link" 2>/dev/null
  
  if [ -L "$test_link" ] || [ -d "$test_link" ]; then
    rm -f "$test_link"
    rmdir "$test_target"
    return 0
  fi
  
  rm -f "$test_link" 2>/dev/null
  rmdir "$test_target" 2>/dev/null
  return 1
}

# ============================================================================
# Link Creation
# ============================================================================

# Create a link (symlink, junction, or copy) based on platform
# Usage: create_link <source> <target>
#   source: the actual file/directory (canonical)
#   target: where the link should be created
create_link() {
  local source="$1"
  local target="$2"
  
  if [ ! -e "$source" ]; then
    log_error "Link source does not exist: $source"
    return 1
  fi
  
  if ! prepare_link_target "$source" "$target"; then
    return 1
  fi
  
  local link_type
  link_type="$(get_link_type)"
  
  case "$link_type" in
    symlink)
      create_symlink "$source" "$target"
      ;;
    junction)
      create_junction "$source" "$target"
      ;;
    copy)
      create_copy "$source" "$target"
      ;;
  esac
}

canonicalize_dir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    return 1
  fi
  (
    cd "$dir" 2>/dev/null && pwd -P
  )
}

next_backup_path() {
  local target="$1"
  local bak="${target}.bak"

  if [ ! -e "$bak" ] && [ ! -L "$bak" ]; then
    printf '%s\n' "$bak"
    return 0
  fi

  printf '%s.%s.bak\n' "$target" "$(date +%Y%m%d-%H%M%S)"
}

backup_existing_path() {
  local target="$1"

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 0
  fi

  local bak
  bak="$(next_backup_path "$target")"
  mv "$target" "$bak"
  log_warn "Backed up unmanaged path: $target -> $bak"
}

prepare_link_target() {
  local source="$1"
  local target="$2"

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 0
  fi

  if verify_link "$target" "$source"; then
    remove_link "$target"
    return 0
  fi

  backup_existing_path "$target"
}

# Create symbolic link
create_symlink() {
  local source="$1"
  local target="$2"
  
  # Ensure parent directory exists
  ensure_dir "$(dirname "$target")"
  
  if ln -sf "$source" "$target" 2>/dev/null; then
    log_debug "Created symlink: $target -> $source"
    return 0
  else
    log_error "Failed to create symlink: $target"
    return 1
  fi
}

# Create Windows junction (for directories, no admin required)
create_junction() {
  local source="$1"
  local target="$2"
  
  # Junctions only work on directories
  if [ ! -d "$source" ]; then
    log_error "Junction source must be a directory: $source"
    return 1
  fi
  
  # Ensure parent directory exists
  ensure_dir "$(dirname "$target")"
  
  # Convert paths to Windows format if needed
  local win_source
  local win_target
  win_source="$(to_windows_path "$source")"
  win_target="$(to_windows_path "$target")"
  
  # Create junction using cmd
  if cmd //c "mklink /J \"${win_target}\" \"${win_source}\"" >/dev/null 2>&1; then
    log_debug "Created junction: $target -> $source"
    return 0
  else
    log_error "Failed to create junction: $target"
    return 1
  fi
}

# Create copy (fallback)
create_copy() {
  local source="$1"
  local target="$2"
  
  # Ensure parent directory exists
  ensure_dir "$(dirname "$target")"
  
  if [ -d "$source" ]; then
    cp -r "$source" "$target"
  else
    cp "$source" "$target"
  fi
  
  log_debug "Created copy: $target (from $source)"
}

# ============================================================================
# Link Removal
# ============================================================================

# Remove a link (handles symlink, junction, or copy)
remove_link() {
  local target="$1"
  
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 0  # Already gone
  fi
  
  local link_type
  link_type="$(get_link_type)"
  
  case "$link_type" in
    symlink)
      # Remove symlink (not the target)
      if [ -L "$target" ]; then
        rm -f "$target"
        log_debug "Removed symlink: $target"
      elif [ -d "$target" ]; then
        rmdir "$target" 2>/dev/null || rm -rf "$target"
        log_debug "Removed directory: $target"
      else
        rm -f "$target"
        log_debug "Removed file: $target"
      fi
      ;;
    junction)
      # Remove junction (rmdir, not rm)
      local win_target
      win_target="$(to_windows_path "$target")"
      cmd //c "rmdir \"${win_target}\"" >/dev/null 2>&1
      log_debug "Removed junction: $target"
      ;;
    copy)
      if [ -d "$target" ]; then
        rm -rf "$target"
      else
        rm -f "$target"
      fi
      log_debug "Removed copy: $target"
      ;;
  esac
}

# ============================================================================
# Path Conversion
# ============================================================================

# Convert Unix path to Windows path (for junction creation)
to_windows_path() {
  local path="$1"
  
  if is_windows; then
    # Convert /c/Users/... to C:\Users\...
    echo "$path" | sed -E 's|^/([a-zA-Z])/|\U\1:E|; s|/|\\|g'
  else
    echo "$path"
  fi
}

# Convert Windows path to Unix path
to_unix_path() {
  local path="$1"
  
  if is_windows; then
    # Convert C:\Users\... to /c/Users/...
    echo "$path" | sed -E 's|^([A-Za-z]):|/\L\1|; s|\\|/|g'
  else
    echo "$path"
  fi
}

# ============================================================================
# Link Verification
# ============================================================================

# Check if a link is valid and points to the correct source
verify_link() {
  local target="$1"
  local expected_source="$2"
  
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return 1  # Link doesn't exist
  fi
  
  local link_type
  link_type="$(get_link_type)"
  
  case "$link_type" in
    symlink)
      if [ -L "$target" ]; then
        local actual_source
        actual_source="$(readlink "$target")"
        if [ "$actual_source" = "$expected_source" ]; then
          return 0
        fi
      fi
      return 1
      ;;
    junction|copy)
      if [ -d "$target" ] && [ -d "$expected_source" ]; then
        local actual_dir expected_dir
        actual_dir="$(canonicalize_dir "$target" 2>/dev/null || true)"
        expected_dir="$(canonicalize_dir "$expected_source" 2>/dev/null || true)"
        if [ -n "$actual_dir" ] && [ "$actual_dir" = "$expected_dir" ]; then
          return 0
        fi
      fi
      return 1
      ;;
  esac
  
  return 1
}

# ============================================================================
# Batch Operations
# ============================================================================

# Create links for multiple tools
# Usage: create_links_for_tools <source> <base_target_dir> <tools_list>
create_links_for_tools() {
  local source="$1"
  local base_target_dir="$2"
  local tools="$3"
  
  for tool in $tools; do
    local target_dir
    target_dir="$(get_tool_skills_path "$tool" "global")"
    
    local target="${target_dir}/$(basename "$source")"
    create_link "$source" "$target"
  done
}

# List all links in a directory
list_links() {
  local dir="$1"
  
  if [ ! -d "$dir" ]; then
    return 0
  fi
  
  local link_type
  link_type="$(get_link_type)"
  
  case "$link_type" in
    symlink)
      find "$dir" -maxdepth 1 -type l 2>/dev/null
      ;;
    junction|copy)
      find "$dir" -maxdepth 1 -type d 2>/dev/null
      ;;
  esac
}
