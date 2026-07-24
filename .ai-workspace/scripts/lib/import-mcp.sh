#!/bin/sh
# import-mcp.sh - Reverse import MCP servers from tool configs into AI Workspace
# Source this file from aiws: . "${SCRIPT_DIR}/lib/import-mcp.sh"

set -e

# ============================================================================
# MCP Import Engine
# ============================================================================

# Path to the canonical MCP config
MCP_JSON="${AIWS_DIR}/mcp/mcp.json"

# Parse JSON-format MCP config (claude/cursor/trae output format)
# Input: file path
# Output: JSON object { "server_name": { command, args, env, url, ... } }
parse_json_mcp() {
  local file="$1"

  if [ ! -f "$file" ]; then
    return 0
  fi

  # Extract .mcpServers key — the standard MCP format
  jq -r '.mcpServers // {}' "$file" 2>/dev/null
}

# Parse Codex TOML-format MCP config
# Extracts [mcp_servers.<name>] sections and converts to JSON
# Input: file path
# Output: JSON object { "server_name": { command, args, ... } }
parse_codex_mcp_toml() {
  local file="$1"

  if [ ! -f "$file" ]; then
    return 0
  fi

  # Use awk to extract [mcp_servers.XXX] sections with their key=value pairs
  # macOS-compatible: avoids 3-argument match() which is GNU-only
  awk '
    BEGIN { in_mcp=0; server=""; section="" }
    /^\[mcp_servers\./ {
      line=$0
      gsub(/^\[mcp_servers\./, "", line)
      gsub(/\]$/, "", line)
      if (line ~ /\.env$/) {
        in_mcp=1
        server=line
        sub(/\.env$/, "", server)
        section="env"
      } else {
        in_mcp=1
        server=line
        section="main"
      }
      next
    }
    /^\[/ { in_mcp=0; server=""; section=""; next }
    in_mcp && server != "" {
      # Extract key = "value" or key = value
      # Only process lines with = sign
      if ($0 !~ /=/) next
      if (section == "env") {
        # ENV: KEY = "VALUE"
        key=$1
        $1=""
        sub(/^[[:space:]]*=?[[:space:]]*/, "")
        val=$0
        gsub(/^"/, "", val)
        gsub(/"$/, "", val)
        printf "ENV|%s|%s|%s\n", server, key, val
      } else if (section == "main") {
        # MAIN: key = "value" or key = value or args = [...]
        key=$1
        $1=""
        sub(/^[[:space:]]*=?[[:space:]]*/, "")
        val=$0
        # Trim quotes if present
        if (val ~ /^"/ && val ~ /"$/) {
          gsub(/^"/, "", val)
          gsub(/"$/, "", val)
        }
        printf "MAIN|%s|%s|%s\n", server, key, val
      }
    }
  ' "$file"
}

# Convert parsed Codex TOML entries to JSON
# Input: pipe of MAIN|server|key|value and ENV|server|key|value lines
# Output: JSON object { "server_name": { key: value, env: { KEY: VALUE } } }
codex_entries_to_json() {
  local entries="$1"
  if [ -z "$entries" ]; then
    echo "{}"
    return
  fi

  # Build JSON with jq from scratch
  # First, collect all unique server names
  local servers
  servers="$(echo "$entries" | cut -d'|' -f2 | sort -u)"

  if [ -z "$servers" ]; then
    echo "{}"
    return
  fi

  printf '{'
  local first_server=1
  for server in $servers; do
    [ "$first_server" = "1" ] || printf ','
    first_server=0
    printf '"%s":{' "$server"

    # Main keys
    local main_entries
    main_entries="$(echo "$entries" | grep "^MAIN|${server}|")"
    local first_key=1
    if [ -n "$main_entries" ]; then
      while IFS='|' read -r type srv key val; do
        [ "$first_key" = "1" ] || printf ','
        first_key=0
        # Handle array values (args)
        if [ "$key" = "args" ]; then
          # args in TOML: args = ["-y", "pkg"] or args = []
          printf '"args":['
          # Try to parse the array-like value
          local clean_val
          clean_val="$(echo "$val" | sed 's/^\[//;s/\]$//')"
          if [ -n "$clean_val" ]; then
            # Split by comma — note: simplistic, won't handle quoted commas
            printf '%s' "$clean_val"
          fi
          printf ']'
        else
          # Simple string value
          printf '"%s":"%s"' "$key" "$val"
        fi
      done << EOF
$main_entries
EOF
    fi

    # Env keys
    local env_entries
    env_entries="$(echo "$entries" | grep "^ENV|${server}|")"
    if [ -n "$env_entries" ]; then
      [ "$first_key" = "1" ] || printf ','
      printf '"env":{'
      local first_env=1
      while IFS='|' read -r type srv key val; do
        [ "$first_env" = "1" ] || printf ','
        first_env=0
        printf '"%s":"%s"' "$key" "$val"
      done << EOF
$env_entries
EOF
      printf '}'
    fi

    printf '}'
  done
  printf '}'
}

# Parse Codex MCP config to JSON (public interface)
# Output: JSON object
parse_codex_mcp_json() {
  local file="$1"

  if [ ! -f "$file" ]; then
    echo "{}"
    return 0
  fi

  local entries
  entries="$(parse_codex_mcp_toml "$file")"

  if [ -z "$entries" ]; then
    echo "{}"
    return 0
  fi

  codex_entries_to_json "$entries"
}

# Parse MCP servers from a tool's config file
# Usage: parse_tool_mcp <tool> <file_path>
# Returns JSON object of servers (without scope field)
parse_tool_mcp() {
  local tool="$1"
  local file="$2"

  case "$tool" in
    codex)
      parse_codex_mcp_json "$file"
      ;;
    claude|cursor|trae)
      parse_json_mcp "$file"
      ;;
    *)
      log_debug "Unknown tool: $tool"
      echo "{}"
      ;;
  esac
}

# Infer scope from source path
# global paths contain $HOME, project paths are under $AIWS_ROOT
infer_scope() {
  local file="$1"

  # If the file is under home directory, it's global scope
  case "$file" in
    "${HOME_DIR}"/*) echo "global" ;;
    *)               echo "project" ;;
  esac
}

# Check if a server name already exists in mcp.json
server_exists() {
  local name="$1"
  local mcp_file="$2"

  jq -e --arg name "$name" '.servers[$name]' "$mcp_file" > /dev/null 2>&1
}

# Merge imported servers into mcp.json
# Usage: merge_into_mcp <new_servers_json> <scope> <dry_run>
merge_into_mcp() {
  local new_servers_json="$1"
  local scope="$2"
  local dry_run="$3"

  local mcp_file="${MCP_JSON}"

  if [ ! -f "$mcp_file" ]; then
    echo '{ "servers": {} }' > "$mcp_file"
  fi

  # Extract server names from the new JSON
  local new_names
  new_names="$(echo "$new_servers_json" | jq -r 'keys[]' 2>/dev/null)"

  if [ -z "$new_names" ]; then
    return 0
  fi

  local added=0
  local skipped=0

  # Process each server
  for name in $new_names; do
    # Check if already exists in mcp.json
    if server_exists "$name" "$mcp_file"; then
      skipped=$((skipped + 1))
      log_debug "  SKIP ${name}: already in mcp.json"
      continue
    fi

    # Get server config from new JSON
    local server_config
    server_config="$(echo "$new_servers_json" | jq -c --arg name "$name" '.[$name]' 2>/dev/null)"

    # Add scope field based on inferred scope + explicit scope
    local scope_array
    if [ "$scope" = "global" ]; then
      scope_array='["global"]'
    elif [ "$scope" = "project" ]; then
      scope_array='["project"]'
    else
      scope_array='["global","project"]'
    fi

    # Merge the scope into the server config
    server_config="$(echo "$server_config" | jq -c --argjson scopes "$scope_array" '. + { scope: $scopes }')"

    if [ "$dry_run" = "1" ]; then
      log_info "  [DRY-RUN] Would add: ${name} (scope: ${scope})"
      added=$((added + 1))
    else
      # Add to mcp.json using jq merge
      local temp_file="${mcp_file}.tmp.$$"
      jq --arg name "$name" --argjson config "$server_config" \
        '.servers[$name] = $config' "$mcp_file" > "$temp_file" 2>/dev/null

      if [ $? -eq 0 ] && [ -s "$temp_file" ]; then
        mv "$temp_file" "$mcp_file"
        log_success "  Added: ${name} (scope: ${scope})"
        added=$((added + 1))
      else
        log_error "  Failed to add: ${name}"
        rm -f "$temp_file"
      fi
    fi
  done

  echo "${added}|${skipped}"
}

# Import MCP servers from a specific tool + scope
import_mcp_from_tool() {
  local tool="$1"
  local scope="$2"
  local dry_run="$3"

  local mcp_file
  mcp_file="$(get_tool_mcp_path "$tool" "$scope")"

  if [ -z "$mcp_file" ]; then
    log_debug "No MCP path for ${tool}/${scope}"
    return 0
  fi

  if [ ! -f "$mcp_file" ]; then
    log_debug "MCP config not found: ${mcp_file}"
    return 0
  fi

  log_info "Scanning ${tool} (${scope}): ${mcp_file}"

  # Parse servers from this tool
  local servers_json
  servers_json="$(parse_tool_mcp "$tool" "$mcp_file")"

  # Count servers
  local server_count
  server_count="$(echo "$servers_json" | jq 'length' 2>/dev/null || echo 0)"

  if [ "$server_count" = "0" ] || [ "$servers_json" = "{}" ]; then
    log_debug "  No MCP servers found"
    return 0
  fi

  # Merge into mcp.json
  local result
  result="$(merge_into_mcp "$servers_json" "$scope" "$dry_run")"

  local added
  added="${result%%|*}"
  local skipped
  skipped="${result##*|}"

  echo ""
  log_info "${tool}/${scope}: ${GREEN}${added} added${NC}, ${YELLOW}${skipped} already in mcp.json${NC}"

  return 0
}

# Main import function
# Usage: import_mcp [from_tool] [scope] [dry_run] [auto_yes]
import_mcp() {
  local from_tool="${1:-}"
  local scope_filter="${2:-}"
  local dry_run="${3:-0}"
  local auto_yes="${4:-0}"

  echo ""

  if [ "$dry_run" = "1" ]; then
    log_info "=== MCP Import (DRY RUN) ==="
    echo ""
  else
    log_info "=== MCP Import ==="
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

  # Check jq dependency
  if ! has_jq; then
    die "jq is required for MCP import. Install with: brew install jq"
  fi

  # Ensure mcp.json exists
  if [ ! -f "${MCP_JSON}" ]; then
    ensure_dir "$(dirname "${MCP_JSON}")"
    echo '{ "servers": {} }' > "${MCP_JSON}"
    log_debug "Created empty mcp.json"
  fi

  # Backup
  if [ "$dry_run" != "1" ]; then
    backup_file "${MCP_JSON}"
  fi

  # First pass: discover and count
  local total_new=0

  for tool in $tools; do
    for scope in $scopes; do
      local mcp_file
      mcp_file="$(get_tool_mcp_path "$tool" "$scope")"

      if [ -z "$mcp_file" ] || [ ! -f "$mcp_file" ]; then
        continue
      fi

      local servers_json
      servers_json="$(parse_tool_mcp "$tool" "$mcp_file")"

      if [ -z "$servers_json" ] || [ "$servers_json" = "{}" ]; then
        continue
      fi

      # Count which are new
      local names
      names="$(echo "$servers_json" | jq -r 'keys[]' 2>/dev/null)"
      for name in $names; do
        if ! server_exists "$name" "${MCP_JSON}"; then
          total_new=$((total_new + 1))
        fi
      done
    done
  done

  # Summary
  if [ "$total_new" -eq 0 ]; then
    log_info "No new MCP servers to import — all already managed."
    return 0
  fi

  log_info "Import summary: ${GREEN}${total_new} new server(s)${NC} will be added to mcp.json"
  echo ""

  # Confirm
  if [ "$dry_run" = "1" ]; then
    log_info "Dry run complete. Run without --dry-run to import."
    return 0
  fi

  if [ "$auto_yes" != "1" ]; then
    printf "Import ${total_new} MCP server(s)? [y/N] "
    read -r confirm
    case "$confirm" in
      [yY]|[yY][eE][sS]) ;;
      *) log_info "Aborted."; return 0 ;;
    esac
  fi

  echo ""

  # Second pass: execute
  for tool in $tools; do
    for scope in $scopes; do
      import_mcp_from_tool "$tool" "$scope" "$dry_run"
    done
  done

  echo ""
  log_success "MCP import complete."
  log_info "Run 'aiws sync' to propagate changes to all tools."
}
