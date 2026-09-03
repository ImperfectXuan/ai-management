#!/bin/sh
# drift-check.sh - Detect drift between canonical rules and generated files
# "干跑" generation into a sandbox and byte-compare with the files on disk.
# Requires: common.sh sourced first (AIWS_ROOT / AIWS_LIB_DIR), rules-generate.sh
# will be sourced lazily by check_drift.
#
# 用法: check_drift [scope]   scope 为空 = 全部；global = 仅 canonical；project = 仅 domain
#
# 返回码: 0 无漂移 | 1 有漂移 | 2 环境错误
#
# 实现说明：
#   - 只读承诺：磁盘上的生成文件绝不被本函数修改；干跑只写临时沙盒。
#   - 沙盒子 shell 里干跑 generate_rule_files，输出目录指向沙盒
#     （AIWS_ROOT 重导），而规则/mapping 输入来自 source 时绑定的
#     AIWS_DIR（真实规范层）——与真实 sync 完全同源，保证字节级可比。

# ============================================================================
# Per-tool Drift Detection
# ============================================================================

# 对单个工具做 missing / stale / extra 三类检查。
# 用法: detect_tool_drift <ext> <disk_dir> <sandbox_dir> <tool>
# 日志走 stderr（log_warn），漂移计数走 stdout 供调用方捕获。
detect_tool_drift() {
  local ext="$1" disk_dir="$2" sandbox_dir="$3" tool="$4"
  local drifted=0
  local expected_file name actual_file

  # missing | stale：沙盒里期望存在的每个文件
  for expected_file in "${sandbox_dir}"/*"${ext}"; do
    [ -f "$expected_file" ] || continue
    name="$(basename "$expected_file")"
    actual_file="${disk_dir}/${name}"
    if [ ! -f "$actual_file" ]; then
      log_warn "DRIFT (missing): ${tool}/rules/${name} — 规范层包含该规则但未同步。运行: aiws sync --tool ${tool}"
      drifted=$((drifted + 1))
    elif ! cmp -s "$expected_file" "$actual_file"; then
      log_warn "DRIFT (stale): ${tool}/rules/${name} — 生成文件落后于规范层。运行: aiws sync --tool ${tool}"
      drifted=$((drifted + 1))
    fi
  done

  # extra：磁盘上有、且不在本次期望集合内的非 .bak 文件
  if [ -d "$disk_dir" ]; then
    for actual_file in "${disk_dir}"/*"${ext}"; do
      [ -f "$actual_file" ] || continue
      name="$(basename "$actual_file")"
      case "$name" in *.bak) continue ;; esac
      if [ ! -f "${sandbox_dir}/${name}" ]; then
        log_warn "DRIFT (extra): ${tool}/rules/${name} — 不在当前 mapping 白名单内，sync 时会备份为 .bak"
        drifted=$((drifted + 1))
      fi
    done
  fi

  echo "$drifted"
}

# ============================================================================
# Drift Detection
# ============================================================================

check_drift() {
  local target_scope="${1:-}"
  local real_root="$AIWS_ROOT"

  # fail-fast：非法 scope 静默当"全部"处理会掩盖调用方 bug，按环境错误降级
  case "$target_scope" in
    ""|global|project) ;;
    *)
      log_warn "Drift check skipped: invalid scope '${target_scope}'"
      return 2
      ;;
  esac

  if [ ! -d "${real_root}/.ai-workspace/rules" ]; then
    log_warn "Drift check skipped: no .ai-workspace/rules under ${real_root}"
    return 2
  fi

  # 沙盒会重导 AIWS_ROOT；生成器路径必须在此之前捕获为绝对值，
  # 否则 AIWS_LIB_DIR 可能指向没有 scripts/ 的被测工作区（曾致干跑产空）
  local gen_lib="${AIWS_LIB_DIR}/rules-generate.sh"
  if [ ! -f "$gen_lib" ]; then
    log_warn "Drift check skipped: rules-generate.sh not found at ${gen_lib}"
    return 2
  fi

  local sandbox
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/aiws-drift.XXXXXX")" || return 2

  (
    export AIWS_ROOT="$sandbox"
    set +e
    mkdir -p "${sandbox}/.cursor/rules" "${sandbox}/.trae/rules"
    # 与 aiws sync 同源加载 memory 辅助：00-context 属生成文件，需纳入漂移比对
    if [ -f "${AIWS_LIB_DIR}/memory.sh" ]; then
      . "${AIWS_LIB_DIR}/memory.sh"
    fi
    . "$gen_lib"
    generate_rule_files cursor "$target_scope" >/dev/null 2>&1
    generate_rule_files trae "$target_scope" >/dev/null 2>&1
  )

  local drifted=0 count
  count="$(detect_tool_drift ".mdc" "${real_root}/.cursor/rules" "${sandbox}/.cursor/rules" cursor)"
  drifted=$((drifted + count))
  count="$(detect_tool_drift ".md" "${real_root}/.trae/rules" "${sandbox}/.trae/rules" trae)"
  drifted=$((drifted + count))

  rm -rf "$sandbox"

  if [ "$drifted" -eq 0 ]; then
    log_success "Drift check PASSED: 规范层与生成文件一致"
    return 0
  fi
  log_error "Drift check FAILED: ${drifted} file(s) drifted. Run: aiws sync"
  return 1
}
