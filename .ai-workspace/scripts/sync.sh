#!/bin/sh
# sync.sh - Compatibility entry point
# Delegates to `aiws sync` for actual synchronization.
# Usage: .ai-workspace/scripts/sync.sh [--tool <name>] [--scope <global|project>]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "${SCRIPT_DIR}/aiws" sync "$@"
