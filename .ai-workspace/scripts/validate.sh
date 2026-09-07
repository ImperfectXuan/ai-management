#!/bin/sh
# validate.sh - Validate AI Workspace configuration and structure
# Usage: .ai-workspace/scripts/validate.sh [--strict]
#
# Checks:
# - Directory structure integrity
# - Rule file format (frontmatter)
# - Adapter file size (< 50 lines)
# - Adapter mapping.yaml validity
# - MCP config format
# - Skills structure

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/lib/common.sh"

# ============================================================================
# Parse Arguments
# ============================================================================

STRICT_MODE=0
# --drift-strict: 把生成文件漂移视为 error（pre-commit hook 用）。
# 默认漂移只记 warning，避免未跑过 sync 的新环境被 validate 直接判死。
DRIFT_STRICT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT_MODE=1; shift ;;
    --drift-strict) DRIFT_STRICT=1; shift ;;
    --help|-h)
      echo "Usage: validate.sh [--strict] [--drift-strict]"
      echo ""
      echo "Options:"
      echo "  --strict        Treat warnings as errors"
      echo "  --drift-strict  Treat generated-file drift as errors"
      echo "  --help          Show this help message"
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ============================================================================
# Validation Counters
# ============================================================================

ERRORS=0
WARNINGS=0

error() {
  log_error "$@"
  ERRORS=$((ERRORS + 1))
}

warn() {
  log_warn "$@"
  WARNINGS=$((WARNINGS + 1))
  if [ "$STRICT_MODE" = "1" ]; then
    error "Strict mode: warning treated as error"
  fi
}

pass() {
  log_success "$@"
}

# ============================================================================
# Directory Structure Validation
# ============================================================================

validate_directory_structure() {
  log_info "Checking directory structure..."
  
  local required_dirs="
    rules
    adapters
    skills
    memory
    mcp
    secrets
    config
    scripts
    scripts/lib
  "
  
  for dir in $required_dirs; do
    local full_path="${AIWS_DIR}/${dir}"
    if [ -d "$full_path" ]; then
      pass "Directory exists: ${dir}/"
    else
      warn "Missing directory: ${dir}/"
    fi
  done
  
  echo ""
}

# ============================================================================
# Rules Validation
# ============================================================================

validate_rules() {
  log_info "Checking rules..."
  
  local rule_count=0
  
  for rule_file in "${AIWS_DIR}"/rules/*.md; do
    [ -f "$rule_file" ] || continue
    is_rule_file "$rule_file" || continue
    rule_count=$((rule_count + 1))
    
    local filename
    filename="$(basename "$rule_file")"
    
    # Check file naming convention (nn-topic.md)
    if ! echo "$filename" | grep -qE '^[0-9]{2}-[a-z0-9-]+\.md$'; then
      warn "Rule file naming: $filename (expected: nn-topic.md)"
    fi
    
    # Check frontmatter
    local first_line
    first_line="$(head -1 "$rule_file")"
    if [ "$first_line" != "---" ]; then
      warn "Missing YAML frontmatter in: $filename"
    else
      # Check required frontmatter fields
      local has_id has_title has_scope
      has_id="$(grep -c '^id:' "$rule_file" || true)"
      has_title="$(grep -c '^title:' "$rule_file" || true)"
      has_scope="$(grep -c '^scope:' "$rule_file" || true)"
      
      if [ "$has_id" = "0" ]; then
        warn "Missing 'id' in frontmatter: $filename"
      fi
      if [ "$has_title" = "0" ]; then
        warn "Missing 'title' in frontmatter: $filename"
      fi
      if [ "$has_scope" = "0" ]; then
        warn "Missing 'scope' in frontmatter: $filename"
      fi
    fi
    
    # Check file length (<= 200 lines)
    local line_count
    line_count="$(wc -l < "$rule_file")"
    if [ "$line_count" -gt 200 ]; then
      warn "Rule file exceeds 200 lines: $filename ($line_count lines)"
    fi
    
    # Check for tool-specific references (anti-pattern)
    if grep -qiE '(tell codex|tell claude|for cursor|for trae)' "$rule_file"; then
      warn "Tool-specific reference in canonical rule: $filename"
    fi

    # tools 字段值必须 ∈ SUPPORTED_TOOLS，非法值 fail-fast 告警
    local tools_val t
    tools_val="$(rule_tools "$rule_file")"
    for t in $tools_val; do
      case " $SUPPORTED_TOOLS " in
        *" $t "*) ;;
        *) warn "Invalid tool '$t' in tools field: $filename (expected: $SUPPORTED_TOOLS)" ;;
      esac
    done

    pass "Rule checked: $filename"
  done
  
  if [ "$rule_count" = "0" ]; then
    warn "No rule files found in rules/"
  else
    pass "Found $rule_count rule file(s)"
  fi
  
  # Check domain rules
  if [ -d "${AIWS_DIR}/rules/domains" ]; then
    for rule_file in "${AIWS_DIR}"/rules/domains/*.md; do
      [ -f "$rule_file" ] || continue
      pass "Domain rule: $(basename "$rule_file")"
    done
  fi
  
  echo ""
}

# ============================================================================
# Adapter Validation
# ============================================================================

validate_adapters() {
  log_info "Checking adapters..."
  
  for tool in $SUPPORTED_TOOLS; do
    local adapter_dir="${AIWS_DIR}/adapters/${tool}"
    
    if [ ! -d "$adapter_dir" ]; then
      warn "Adapter directory missing: adapters/${tool}/"
      continue
    fi
    
    # Check adapter template file size (< 50 lines)
    for template_file in "${adapter_dir}"/*.md; do
      [ -f "$template_file" ] || continue
      
      local filename
      filename="$(basename "$template_file")"
      local line_count
      line_count="$(wc -l < "$template_file")"
      
      if [ "$line_count" -gt 50 ]; then
        error "Adapter exceeds 50 lines: ${tool}/${filename} ($line_count lines)"
      else
        pass "Adapter size OK: ${tool}/${filename} ($line_count lines)"
      fi
    done
    
    # Check mapping.yaml if exists
    local mapping_file="${adapter_dir}/mapping.yaml"
    if [ -f "$mapping_file" ]; then
      # Basic YAML structure check
      if ! grep -q 'tool:' "$mapping_file"; then
        warn "mapping.yaml missing 'tool' field: ${tool}"
      fi
      
      pass "Mapping found: ${tool}/mapping.yaml"
    else
      # Not all adapters need mapping files
      log_debug "No mapping.yaml for: ${tool}"
    fi
  done
  
  echo ""
}

# ============================================================================
# MCP Configuration Validation
# ============================================================================

validate_mcp() {
  log_info "Checking MCP configuration..."
  
  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  
  if [ ! -f "$mcp_file" ]; then
    warn "No MCP configuration found: mcp/mcp.json"
    echo ""
    return
  fi
  
  # Check JSON validity
  if has_jq; then
    if ! jq empty "$mcp_file" 2>/dev/null; then
      error "Invalid JSON in mcp/mcp.json"
    else
      pass "MCP config is valid JSON"
    fi
    
    # Check required structure
    local has_servers
    has_servers="$(jq 'has("servers")' "$mcp_file" 2>/dev/null)"
    if [ "$has_servers" != "true" ]; then
      error "MCP config missing 'servers' key"
    fi
    
    # Check each server has required fields
    local server_names
    server_names="$(jq -r '.servers | keys[]' "$mcp_file" 2>/dev/null)"
    
    for server in $server_names; do
      local has_command
      has_command="$(jq -r ".servers[\"$server\"] | has(\"command\")" "$mcp_file")"
      
      if [ "$has_command" != "true" ]; then
        warn "MCP server '$server' missing 'command' field"
      else
        pass "MCP server OK: $server"
      fi
    done
  else
    warn "jq not available - skipping MCP JSON validation"
  fi
  
  echo ""
}

# ============================================================================
# Skills Validation
# ============================================================================

validate_skills() {
  log_info "Checking skills..."
  
  local skill_count=0
  
  for skill_dir in "${AIWS_DIR}"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    
    local skill_name
    skill_name="$(basename "$skill_dir")"
    
    # Skip .gitkeep
    [ "$skill_name" = ".gitkeep" ] && continue
    
    skill_count=$((skill_count + 1))
    
    # Check for SKILL.md
    if [ ! -f "${skill_dir}/SKILL.md" ]; then
      error "Missing SKILL.md in skill: $skill_name"
    else
      pass "Skill found: $skill_name"
      
      # Check SKILL.md frontmatter
      local first_line
      first_line="$(head -1 "${skill_dir}/SKILL.md")"
      if [ "$first_line" != "---" ]; then
        warn "Missing YAML frontmatter in skill: $skill_name/SKILL.md"
      else
        local has_name has_description
        has_name="$(grep -c '^name:' "${skill_dir}/SKILL.md" || true)"
        has_description="$(grep -c '^description:' "${skill_dir}/SKILL.md" || true)"
        
        if [ "$has_name" = "0" ]; then
          warn "Missing 'name' in skill frontmatter: $skill_name"
        fi
        if [ "$has_description" = "0" ]; then
          warn "Missing 'description' in skill frontmatter: $skill_name"
        fi
      fi
    fi
  done
  
  if [ "$skill_count" = "0" ]; then
    log_info "No skills found yet. Add skills to skills/<name>/SKILL.md"
  else
    pass "Found $skill_count skill(s)"
  fi
  
  echo ""
}

# ============================================================================
# Secrets Validation
# ============================================================================

validate_secrets() {
  log_info "Checking secrets configuration..."
  
  local permissions_file="${AIWS_DIR}/secrets/permissions.yaml"
  
  if [ ! -f "$permissions_file" ]; then
    warn "No permissions file: secrets/permissions.yaml"
  else
    pass "Permissions file exists"
    
    # Basic YAML check
    if ! grep -q 'policies:' "$permissions_file"; then
      warn "permissions.yaml missing 'policies' key"
    fi
  fi
  
  # Check vault status
  local vault_file="${AIWS_DIR}/secrets/vault.enc"
  if [ -f "$vault_file" ]; then
    pass "Vault file exists (encrypted)"
  else
    log_info "Vault not initialized. Run: aiws setup"
  fi
  
  echo ""
}

# ============================================================================
# Memory Validation
# ============================================================================

validate_memory() {
  log_info "Checking memory..."

  local t
  for t in adr context decisions; do
    if [ -f "${AIWS_DIR}/memory/${t}/TEMPLATE.md" ]; then
      pass "Memory template exists: ${t}/TEMPLATE.md"
    else
      warn "Missing memory template: memory/${t}/TEMPLATE.md"
    fi
  done

  # context 文件 frontmatter（id / title）
  for f in "${AIWS_DIR}"/memory/context/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    local ctx_filename
    ctx_filename="$(basename "$f")"
    if [ "$(grep -c '^id:' "$f" || true)" = "0" ]; then warn "Missing 'id' in context: $ctx_filename"; fi
    if [ "$(grep -c '^title:' "$f" || true)" = "0" ]; then warn "Missing 'title' in context: $ctx_filename"; fi
  done

  # ADR 文件 frontmatter（id / title / date / status）+ status 枚举
  for f in "${AIWS_DIR}"/memory/adr/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    local adr_filename status_val
    adr_filename="$(basename "$f")"
    if [ "$(grep -c '^id:' "$f" || true)" = "0" ]; then warn "Missing 'id' in ADR: $adr_filename"; fi
    if [ "$(grep -c '^title:' "$f" || true)" = "0" ]; then warn "Missing 'title' in ADR: $adr_filename"; fi
    if [ "$(grep -c '^date:' "$f" || true)" = "0" ]; then warn "Missing 'date' in ADR: $adr_filename"; fi
    status_val="$(grep -m1 '^status:' "$f" | sed 's/^status:[[:space:]]*//; s/[[:space:]]*$//')"
    case "$status_val" in
      proposed|accepted|deprecated|superseded) pass "ADR status valid: $adr_filename" ;;
      *) warn "Invalid ADR status '$status_val' in: $adr_filename (expected proposed|accepted|deprecated|superseded)" ;;
    esac
  done

  # decisions.md 条目须以 ## YYYY-MM-DD 开头
  if [ -f "${AIWS_DIR}/memory/decisions/decisions.md" ]; then
    if awk '
      /^## / { if ($0 !~ /^## [0-9]{4}-[0-9]{2}-[0-9]{2} /) bad = 1 }
      END { exit bad ? 1 : 0 }
    ' "${AIWS_DIR}/memory/decisions/decisions.md"; then
      pass "Decision entries format valid"
    else
      warn "decisions.md 存在不以 '## YYYY-MM-DD ' 开头的条目"
    fi
  fi

  echo ""
}

# ============================================================================
# Generated Files Validation
# ============================================================================

validate_generated_files() {
  log_info "Checking generated files..."

  # Single-file outputs (Codex / Claude Code)
  for entry in \
    "${AIWS_ROOT}/AGENTS.md:Codex" \
    "${AIWS_ROOT}/CLAUDE.md:Claude Code"; do

    local file="${entry%%:*}"
    local tool="${entry#*:}"

    if [ -f "$file" ]; then
      # Check for generation marker
      if grep -q "Generated by AI Workspace" "$file"; then
        pass "Generated file OK: $(basename "$file") ($tool)"
      else
        warn "File exists but not marked as generated: $(basename "$file")"
      fi
    else
      log_info "Generated file not yet created: $(basename "$file") ($tool)"
    fi
  done

  # Per-rule outputs (Cursor / Trae)
  for entry in \
    "${AIWS_ROOT}/.cursor/rules:*.mdc:Cursor" \
    "${AIWS_ROOT}/.trae/rules:*.md:Trae"; do

    local dir="${entry%%:*}"
    local rest="${entry#*:}"
    local pattern="${rest%%:*}"
    local tool="${rest#*:}"

    local file_count=0
    for rule_file in "${dir}"/${pattern}; do
      [ -f "$rule_file" ] || continue
      file_count=$((file_count + 1))
    done

    if [ "$file_count" -gt 0 ]; then
      pass "Generated rule files OK: $(basename "$dir") ($tool) - $file_count file(s)"
    else
      log_info "Rule files not yet generated: $(basename "$dir") ($tool)"
    fi
  done

  # Stale single-file outputs that the per-rule scheme replaced
  for stale in \
    "${AIWS_ROOT}/.cursorrules" \
    "${AIWS_ROOT}/.trae/rules.md"; do
    if [ -f "$stale" ]; then
      warn "Stale generated file found (superseded by per-rule output): $stale"
    fi
  done

  echo ""
}

# ============================================================================
# Drift Validation (canonical rules vs generated files)
# ============================================================================

validate_drift() {
  log_info "Checking rule drift..."

  . "${SCRIPT_DIR}/lib/drift-check.sh"

  # check_drift 返回码: 0 一致 | 1 漂移 | 2 环境错误
  local rc=0
  check_drift "" || rc=$?

  if [ "$rc" -eq 0 ]; then
    return 0
  elif [ "$rc" -eq 2 ]; then
    warn "Drift check could not run (missing rules or sandbox error)"
    return 0
  fi

  if [ "$DRIFT_STRICT" = "1" ]; then
    error "Generated files drifted from canonical rules (run: aiws sync)"
  else
    warn "Generated files drifted from canonical rules (run: aiws sync)"
  fi
}

# ============================================================================
# Main
# ============================================================================

main() {
  log_info "AI Workspace validate v${AIWS_VERSION}"
  log_info "Root: ${AIWS_ROOT}"
  
  if [ "$STRICT_MODE" = "1" ]; then
    log_info "Mode: STRICT (warnings = errors)"
  fi
  
  echo ""
  
  validate_directory_structure
  validate_rules
  validate_adapters
  validate_mcp
  validate_skills
  validate_secrets
  validate_memory
  validate_generated_files
  validate_drift
  
  # Summary
  echo "============================================"
  if [ "$ERRORS" -gt 0 ]; then
    log_error "Validation FAILED: $ERRORS error(s), $WARNINGS warning(s)"
    exit 1
  elif [ "$WARNINGS" -gt 0 ]; then
    log_warn "Validation passed with $WARNINGS warning(s)"
    exit 0
  else
    log_success "Validation PASSED"
    exit 0
  fi
}

main
