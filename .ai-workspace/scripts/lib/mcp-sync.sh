#!/bin/sh
# mcp-sync.sh - MCP configuration synchronization
# Source this file from sync.sh or aiws CLI
# Requires: common.sh to be sourced first

# ============================================================================
# MCP Sync Main Function
# ============================================================================

sync_mcp() {
  local target_scope="${1:-}"  # global, project, or empty for both
  local target_tool="${2:-}"    # specific tool name, or empty for all
  
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  
  if [ ! -f "$mcp_file" ]; then
    log_info "No MCP configuration found. Skipping MCP sync."
    return 0
  fi
  
  if ! has_jq; then
    log_warn "jq not available - skipping MCP sync"
    return 0
  fi
  
  log_info "Syncing MCP configurations..."
  
  # Validate JSON
  if ! jq empty "$mcp_file" 2>/dev/null; then
    log_error "Invalid JSON in mcp/mcp.json"
    return 1
  fi
  
  # Merge local overrides if mcp.local.json exists
  local local_file="${AIWS_DIR}/mcp/mcp.local.json"
  local effective_mcp="$mcp_file"
  if [ -f "$local_file" ]; then
    local merged
    merged="$(jq -s '.[0].servers * .[1].servers | { servers: . }' "$mcp_file" "$local_file" 2>/dev/null)"
    if [ -n "$merged" ]; then
      effective_mcp="$(mktemp)"
      echo "$merged" > "$effective_mcp"
      trap "rm -f '$effective_mcp'" EXIT
      log_debug "Merged local overrides from mcp.local.json"
    fi
  fi
  
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
      scopes="project global"
    fi
    
    for scope in $scopes; do
      sync_mcp_for_tool "$tool" "$scope" "$effective_mcp"
    done
  done
  
  # Cleanup temp file if created
  if [ "$effective_mcp" != "$mcp_file" ] && [ -f "$effective_mcp" ]; then
    rm -f "$effective_mcp"
  fi
}

# ============================================================================
# Tool-Specific MCP Sync
# ============================================================================

sync_mcp_for_tool() {
  local tool="$1"
  local scope="$2"
  local mcp_file="$3"
  
  # Get target path
  local target_path
  target_path="$(get_tool_mcp_path "$tool" "$scope")"
  
  if [ -z "$target_path" ]; then
    log_debug "Tool $tool does not support $scope MCP scope"
    return 0
  fi
  
  # Get servers for this scope
  local servers_json
  servers_json="$(get_servers_for_scope "$mcp_file" "$scope")"
  
  if [ -z "$servers_json" ] || [ "$servers_json" = "{}" ]; then
    log_debug "No servers for $tool ($scope)"
    return 0
  fi
  
  # Replace secret references if vault is enabled (with permission check)
  servers_json="$(replace_secrets "$servers_json" "$tool")"
  
  # Generate tool-specific format
  local output_content
  case "$tool" in
    codex)
      output_content="$(generate_codex_mcp "$servers_json" "$target_path")"
      ;;
    claude|cursor|trae)
      output_content="$(generate_json_mcp "$servers_json")"
      ;;
    *)
      log_warn "Unknown tool for MCP sync: $tool"
      return 0
      ;;
  esac
  
  # Ensure target directory exists
  local target_dir
  target_dir="$(dirname "$target_path")"
  ensure_dir "$target_dir"
  
  # Backup existing file
  if [ -f "$target_path" ]; then
    backup_file "$target_path"
  fi
  
  # Write output
  printf '%s\n' "$output_content" > "$target_path"
  log_success "MCP synced: $tool ($scope) -> $target_path"
}

# ============================================================================
# Server Filtering
# ============================================================================

# Get servers that should be synced to a specific scope
get_servers_for_scope() {
  local mcp_file="$1"
  local scope="$2"
  
  # Extract servers that include this scope in their scope array
  jq -r --arg scope "$scope" '
    .servers | to_entries | 
    map(select(.value.scope == null or (.value.scope | index($scope)))) |
    from_entries
  ' "$mcp_file" 2>/dev/null
}

# ============================================================================
# Secret Replacement
# ============================================================================

# Replace ${secret:xxx} references with actual values from vault
# Usage: replace_secrets <json> [tool_name]
# If tool_name is provided, checks permissions before replacing
replace_secrets() {
  local json="$1"
  local tool="${2:-}"
  
  # Check if vault is enabled and initialized
  local vault_file="${AIWS_DIR}/secrets/vault.enc"
  if [ ! -f "$vault_file" ]; then
    # No vault - check for unresolved references
    if echo "$json" | grep -q '\${secret:'; then
      log_warn "Unresolved secret references found. Run 'aiws setup' to initialize vault."
    fi
    echo "$json"
    return
  fi
  
  # If vault exists, decrypt and replace
  # This requires vault.sh to be loaded
  if type decrypt_vault >/dev/null 2>&1; then
    local secrets_json
    secrets_json="$(decrypt_vault)"
    
    if [ -n "$secrets_json" ]; then
      # Find all ${secret:xxx} references in the json
      local referenced_keys
      referenced_keys="$(echo "$json" | grep -oE '\$\{secret:[a-zA-Z0-9_]+\}' | sed 's/\${secret://;s/}//' | sort -u)"
      
      for key in $referenced_keys; do
        # Check permission if tool is specified
        if [ -n "$tool" ] && type check_permission >/dev/null 2>&1; then
          if ! check_permission "$tool" "$key"; then
            log_warn "Permission denied: tool '$tool' is not allowed to access secret '$key'. Skipping."
            continue
          fi
        fi
        
        local value
        value="$(echo "$secrets_json" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null)"
        
        if [ -n "$value" ]; then
          json="$(echo "$json" | sed "s|\${secret:${key}}|${value}|g")"
        else
          log_warn "Secret '$key' referenced but not found in vault"
        fi
      done
    fi
  fi
  
  echo "$json"
}

# ============================================================================
# Format Generators
# ============================================================================

# Generate JSON format MCP config (for Claude, Cursor, Trae)
generate_json_mcp() {
  local servers_json="$1"
  
  # Wrap in mcpServers key (standard MCP format)
  # Strip internal fields like 'scope' that shouldn't be in output
  jq -n --argjson servers "$servers_json" '
    { mcpServers: ($servers | to_entries | map({
      key: .key,
      value: (.value | del(.scope))
    }) | from_entries) }
  ' 2>/dev/null
}

# Generate TOML format MCP Config (for Codex)
# Handles merging with existing config if present
generate_codex_mcp() {
  local servers_json="$1"
  local target_path="$2"
  
  # If target exists and is TOML, we need to merge
  if [ -f "$target_path" ]; then
    # For simplicity, we'll append/replace the [mcp_servers] section
    # A full TOML parser would be complex; we handle the common case
    local existing_content
    existing_content="$(cat "$target_path")"
    
    # Remove existing [mcp_servers] section if present
    existing_content="$(echo "$existing_content" | awk '
      /^\[mcp_servers/ { in_section=1; next }
      /^\[/ { in_section=0 }
      !in_section { print }
    ')"
    
    # Generate new [mcp_servers] section
    local toml_section
    toml_section="$(json_to_toml "$servers_json")"
    
    printf '%s\n%s' "$existing_content" "$toml_section"
  else
    # New file - just generate the mcp_servers section
    json_to_toml "$servers_json"
  fi
}

# Convert JSON servers config to TOML format
json_to_toml() {
  local json="$1"
  
  # Use jq to generate TOML output
  echo "$json" | jq -r '
    to_entries[] |
    "[mcp_servers.\(.key)]",
    (if .value.command then "command = \"\(.value.command)\"" else empty end),
    (if .value.args then "args = [" + (.value.args | map("\"" + . + "\"") | join(", ")) + "]" else empty end),
    (if .value.env then
      "env = { " + (.value.env | to_entries | map("\(.key) = \"\(.value)\"") | join(", ")) + " }"
    else empty end),
    (if .value.url then "url = \"\(.value.url)\"" else empty end),
    ""
  ' 2>/dev/null
}

# ============================================================================
# MCP Management Functions (for CLI)
# ============================================================================

# Add a new MCP server
mcp_add() {
  local name="$1"
  local command="$2"
  shift 2
  local args="$*"
  
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  
  if [ ! -f "$mcp_file" ]; then
    # Create new file
    cat > "$mcp_file" << EOF
{
  "servers": {}
}
EOF
  fi
  
  # Build server JSON
  local server_json
  if [ -n "$args" ]; then
    server_json="$(jq -n \
      --arg cmd "$command" \
      --argjson args "$(printf '%s\n' "$@" | jq -R . | jq -s .)" \
      '{ command: $cmd, args: $args, scope: ["project"] }')"
  else
    server_json="$(jq -n \
      --arg cmd "$command" \
      '{ command: $cmd, scope: ["project"] }')"
  fi
  
  # Update mcp.json
  local updated
  updated="$(jq --arg name "$name" --argjson server "$server_json" \
    '.servers[$name] = $server' "$mcp_file")"
  
  echo "$updated" > "$mcp_file"
  log_success "Added MCP server: $name"
}

# Remove an MCP server
mcp_remove() {
  local name="$1"
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  
  if [ ! -f "$mcp_file" ]; then
    log_error "No MCP configuration found"
    return 1
  fi
  
  local updated
  updated="$(jq --arg name "$name" 'del(.servers[$name])' "$mcp_file")"
  echo "$updated" > "$mcp_file"
  
  log_success "Removed MCP server: $name"
}

# List MCP servers
mcp_list() {
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"

  if [ "${AIWS_JSON:-0}" = "1" ]; then
    if [ ! -f "$mcp_file" ]; then
      echo '{"servers":[],"error":"no mcp.json"}'
      return 0
    fi
    if ! has_jq; then
      echo '{"servers":[],"error":"jq not available"}'
      return 0
    fi
    jq -n --slurpfile servers "$mcp_file" '
      { servers: ( $servers[0].servers | to_entries | map({
          name: .key,
          command: (.value.command // .value.url // "")
        }) ) }
    '
    return 0
  fi

  if [ ! -f "$mcp_file" ]; then
    log_info "No MCP servers configured"
    return 0
  fi
  
  if has_jq; then
    echo "Configured MCP servers:"
    jq -r '.servers | to_entries[] | "  \(.key): \(.value.command // .value.url // "N/A")"' "$mcp_file"
  fi
}

# Show MCP server details
mcp_show() {
  local name="$1"
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  
  if [ ! -f "$mcp_file" ]; then
    log_error "No MCP configuration found"
    return 1
  fi
  
  if has_jq; then
    jq --arg name "$name" '.servers[$name]' "$mcp_file"
  fi
}
