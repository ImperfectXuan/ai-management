#!/bin/sh
# sync-report.sh - `aiws sync --report-file` 单元回执（功能 002 design §4）
# 一份回执文件对应一次调用的一个单元（工具×模块×scope）；schema v1。
# 用 printf 构建而非 jq：dependency_missing 回执必须在没有 jq 的环境里也能落盘。
# 无 --report-file 时所有函数为无操作，既有命令行为完全不变。

AIWS_REPORT_WRITTEN=0

sync_report_active() {
  [ -n "${AIWS_REPORT_FILE:-}" ]
}

# JSON 字符串转义：回执字段均来自受控输入（校验过的单元身份/原因码、env operationId、date）。
sync_report_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# 用法: sync_report_init <绝对回执路径> <tool> <module> <scope>
# 显式拒绝：相对路径、缺失或空的 AIWS_SYNC_OPERATION_ID（design §4）。
sync_report_init() {
  local file="$1" tool="$2" module="$3" scope="$4"

  case "$file" in
    /*) ;;
    *)  die "--report-file 必须是绝对路径：${file}" ;;
  esac
  [ -n "${AIWS_SYNC_OPERATION_ID:-}" ] || die "--report-file 需要通过 AIWS_SYNC_OPERATION_ID 提供操作 ID"
  case "$tool" in
    codex|claude|cursor|trae) ;;
    *) die "--report-file 不支持的工具：${tool}" ;;
  esac
  case "$module" in
    rules|mcp|skills) ;;
    *) die "--report-file 不支持的模块：${module}" ;;
  esac
  case "$scope" in
    project|global) ;;
    *) die "--report-file 不支持的 scope：${scope}" ;;
  esac

  AIWS_REPORT_FILE="$file"
  AIWS_REPORT_OPID="$AIWS_SYNC_OPERATION_ID"
  AIWS_REPORT_TOOL="$tool"
  AIWS_REPORT_MODULE="$module"
  AIWS_REPORT_SCOPE="$scope"
  AIWS_REPORT_WRITTEN=0
}

# 底层写入：同目录临时文件（umask 077 → 0600）+ 原子 rename；重复写入直接失败（一调用一回执）。
sync_report_write() {
  sync_report_active || return 0
  if [ "$AIWS_REPORT_WRITTEN" = "1" ]; then
    die "回执已写入，拒绝重复写入单元结果：${AIWS_REPORT_FILE}"
  fi

  local outcome="$1" reason="$2" completed_at="$3" tmp
  case "$outcome" in
    applied|skipped|failed) ;;
    *) die "非法回执结果：${outcome}" ;;
  esac

  tmp="${AIWS_REPORT_FILE}.tmp.$$"
  (umask 077 && printf '%s\n' \
      "{\"schemaVersion\":1,\"operationId\":\"$(sync_report_escape "$AIWS_REPORT_OPID")\",\"tool\":\"$(sync_report_escape "$AIWS_REPORT_TOOL")\",\"module\":\"$(sync_report_escape "$AIWS_REPORT_MODULE")\",\"scope\":\"$(sync_report_escape "$AIWS_REPORT_SCOPE")\",\"outcome\":\"${outcome}\"$( [ -n "$reason" ] && printf ',"reasonCode":"%s"' "$(sync_report_escape "$reason")" )$( [ -n "$completed_at" ] && printf ',"completedAt":"%s"' "$(sync_report_escape "$completed_at")" )}" \
      > "$tmp") || die "无法写入回执（目录不可写？）：${AIWS_REPORT_FILE}"
  mv "$tmp" "$AIWS_REPORT_FILE" || { rm -f "$tmp"; die "无法落盘回执：${AIWS_REPORT_FILE}"; }
  AIWS_REPORT_WRITTEN=1
}

# applied：仅实际完成时调用，completedAt 取当前 UTC（design §4：只有 applied 带时间）。
sync_report_apply() {
  sync_report_write "applied" "" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

sync_report_skip() {
  sync_report_write "skipped" "$1" ""
}

sync_report_fail() {
  sync_report_write "failed" "$1" ""
}
