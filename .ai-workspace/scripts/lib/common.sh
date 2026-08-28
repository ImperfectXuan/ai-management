#!/bin/sh
# common.sh - Shared utilities for AI Workspace scripts
# Source this file from other scripts: . "$(dirname "$0")/lib/common.sh"

set -e

# ============================================================================
# Constants
# ============================================================================

AIWS_VERSION="0.1.0"
AIWS_ROOT="${AIWS_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
AIWS_DIR="${AIWS_ROOT}/.ai-workspace"
AIWS_SCRIPTS_DIR="${AIWS_DIR}/scripts"
AIWS_LIB_DIR="${AIWS_SCRIPTS_DIR}/lib"

# Tool names
SUPPORTED_TOOLS="codex claude cursor trae"

is_supported_tool() {
  local tool="$1"
  case " ${SUPPORTED_TOOLS} " in
    *" ${tool} "*) return 0 ;;
    *) return 1 ;;
  esac
}

# ============================================================================
# Color Output
# ============================================================================

if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  BOLD=''
  NC=''
fi

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
  printf "${BLUE}[INFO]${NC} %s\n" "$*"
}

log_success() {
  printf "${GREEN}[OK]${NC} %s\n" "$*"
}

log_warn() {
  printf "${YELLOW}[WARN]${NC} %s\n" "$*" >&2
}

log_error() {
  printf "${RED}[ERROR]${NC} %s\n" "$*" >&2
}

log_debug() {
  if [ "${AIWS_DEBUG:-0}" = "1" ]; then
    printf "${CYAN}[DEBUG]${NC} %s\n" "$*" >&2
  fi
}

# ============================================================================
# Error Handling
# ============================================================================

die() {
  log_error "$@"
  exit 1
}

require_file() {
  if [ ! -f "$1" ]; then
    die "Required file not found: $1"
  fi
}

require_dir() {
  if [ ! -d "$1" ]; then
    die "Required directory not found: $1"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Required command not found: $1"
  fi
}

# ============================================================================
# Platform Detection
# ============================================================================

detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "macos" ;;
    Linux*)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)        echo "unknown" ;;
  esac
}

OS="$(detect_os)"

is_windows() {
  [ "$OS" = "windows" ]
}

is_macos() {
  [ "$OS" = "macos" ]
}

is_linux() {
  [ "$OS" = "linux" ]
}

# ============================================================================
# Path Helpers
# ============================================================================

# Get home directory (cross-platform)
get_home() {
  if is_windows; then
    echo "${USERPROFILE:-${HOME}}"
  else
    echo "${HOME}"
  fi
}

HOME_DIR="$(get_home)"

# Get tool-specific paths
# Usage: get_tool_mcp_path <tool> <scope: global|project>
get_tool_mcp_path() {
  local tool="$1"
  local scope="$2"
  
  if [ "$scope" = "global" ]; then
    case "$tool" in
      claude)  echo "${HOME_DIR}/.claude.json" ;;
      codex)   echo "${HOME_DIR}/.codex/config.toml" ;;
      cursor)  echo "${HOME_DIR}/.cursor/mcp.json" ;;
      trae)    echo "" ;;  # Trae has no global MCP
      *)       die "Unknown tool: $tool" ;;
    esac
  else
    case "$tool" in
      claude)  echo "${AIWS_ROOT}/.mcp.json" ;;
      codex)   echo "${AIWS_ROOT}/.codex/config.toml" ;;
      cursor)  echo "${AIWS_ROOT}/.cursor/mcp.json" ;;
      trae)    echo "${AIWS_ROOT}/.trae/mcp.json" ;;
      *)       die "Unknown tool: $tool" ;;
    esac
  fi
}

# Usage: get_tool_skills_path <tool> <scope: global|project>
get_tool_skills_path() {
  local tool="$1"
  local scope="$2"
  
  if [ "$scope" = "global" ]; then
    case "$tool" in
      codex)   echo "${HOME_DIR}/.agents/skills" ;;
      claude)  echo "${HOME_DIR}/.agents/skills" ;;
      cursor)  echo "${HOME_DIR}/.cursor/skills" ;;
      trae)    echo "${HOME_DIR}/.trae/skills" ;;
      *)       die "Unknown tool: $tool" ;;
    esac
  else
    case "$tool" in
      codex)   echo "${AIWS_ROOT}/.agents/skills" ;;
      claude)  echo "${AIWS_ROOT}/.agents/skills" ;;
      cursor)  echo "${AIWS_ROOT}/.cursor/skills" ;;
      trae)    echo "${AIWS_ROOT}/.trae/skills" ;;
      *)       die "Unknown tool: $tool" ;;
    esac
  fi
}

# Get tool-specific rules location
# cursor/trae 返回目录（per-rule 文件），claude/codex 返回单个拼接文件路径
# 本项目只管理 project scope（global 规则路径未纳入体系）
# Usage: get_tool_rules_path <tool>
get_tool_rules_path() {
  local tool="$1"

  case "$tool" in
    claude)  echo "${AIWS_ROOT}/CLAUDE.md" ;;
    codex)   echo "${AIWS_ROOT}/AGENTS.md" ;;
    cursor)  echo "${AIWS_ROOT}/.cursor/rules" ;;
    trae)    echo "${AIWS_ROOT}/.trae/rules" ;;
    *)       die "Unknown tool: $tool" ;;
  esac
}

# ============================================================================
# JSON Helpers (minimal, for shell-based parsing)
# ============================================================================

# Check if jq is available, provide fallback
has_jq() {
  command -v jq >/dev/null 2>&1
}

# Simple JSON value extraction (requires jq)
json_get() {
  local file="$1"
  local path="$2"
  
  if has_jq; then
    jq -r "$path" "$file" 2>/dev/null
  else
    die "jq is required for JSON parsing. Install with: brew install jq"
  fi
}

# ============================================================================
# File Operations
# ============================================================================

# Ensure directory exists
ensure_dir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    log_debug "Created directory: $dir"
  fi
}

# Backup file before modification
backup_file() {
  local file="$1"
  if [ -f "$file" ]; then
    cp "$file" "${file}.bak"
    log_debug "Backed up: $file -> ${file}.bak"
  fi
}

# Write content to file atomically
write_atomic() {
  local file="$1"
  local content="$2"
  local tmp="${file}.tmp.$$"
  
  printf '%s\n' "$content" > "$tmp"
  mv "$tmp" "$file"
  log_debug "Wrote: $file"
}

# ============================================================================
# Dependency Checking
# ============================================================================

# Check for optional dependency and provide install hint
check_optional_dep() {
  local cmd="$1"
  local install_hint="$2"
  
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_warn "$cmd not found. Install with: $install_hint"
    return 1
  fi
  return 0
}

# Check all required dependencies
check_deps() {
  local missing=0
  
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      log_error "Missing dependency: $cmd"
      missing=1
    fi
  done
  
  if [ "$missing" = "1" ]; then
    die "Missing required dependencies. See above for details."
  fi
}

# ============================================================================
# Workspace Configuration
# ============================================================================

# Load workspace config
load_workspace_config() {
  local config_file="${AIWS_DIR}/config/workspace.json"
  
  if [ -f "$config_file" ]; then
    if has_jq; then
      cat "$config_file"
    else
      die "jq required to load workspace config"
    fi
  else
    # Return default config
    cat <<'EOF'
{
  "version": "1.0",
  "tools": ["codex", "claude", "cursor", "trae"],
  "default_scope": "project"
}
EOF
  fi
}

# Get enabled tools from config
get_enabled_tools() {
  local config
  config="$(load_workspace_config)"
  
  if has_jq; then
    echo "$config" | jq -r '.tools[]' 2>/dev/null || echo "$SUPPORTED_TOOLS"
  else
    echo "$SUPPORTED_TOOLS"
  fi
}

# ============================================================================
# Module Switches (workspace.json 顶层模块键，如 skills.enabled)
# ============================================================================

# 判断模块是否启用。约定字段为 workspace.json 中 <module>.enabled；
# 配置缺失或无 jq 环境时默认启用，保持向后兼容。
is_module_enabled() {
  local module="$1"

  has_jq || return 0

  # 注意：不能用 "${module}.enabled // true" —— jq 的 // 会把 false 视为空值，
  # 导致 enabled=false 也返回 true。改用 getpath 并只对 null（字段缺失）取默认开启。
  local enabled
  enabled="$(load_workspace_config | jq -r --arg m "$module" \
    'if getpath([$m, "enabled"]) == null then "true" else (getpath([$m, "enabled"]) | tostring) end' \
    2>/dev/null || echo true)"
  [ "$enabled" = "true" ]
}

# ============================================================================
# Initialization
# ============================================================================

# Ensure AI Workspace structure exists
ensure_workspace_structure() {
  ensure_dir "${AIWS_DIR}/rules"
  ensure_dir "${AIWS_DIR}/rules/domains"
  ensure_dir "${AIWS_DIR}/adapters"
  ensure_dir "${AIWS_DIR}/skills"
  ensure_dir "${AIWS_DIR}/memory"
  ensure_dir "${AIWS_DIR}/mcp"
  ensure_dir "${AIWS_DIR}/secrets"
  ensure_dir "${AIWS_DIR}/config"
  ensure_dir "${AIWS_DIR}/scripts/lib"
}
