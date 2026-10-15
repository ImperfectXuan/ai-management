#!/bin/sh
# intake/credentials.sh - 文本中的明文凭据识别与共享资产门禁
# 需先 source common.sh / import-mcp.sh / intake/identity.sh
#
# 设计约束（spec 5.4、design 23.6）：
#   1. 入库内容里出现"已识别的明文凭据"即拒绝该项，人工确认不能绕过
#   2. 只报告文件与行号，绝不在错误信息、记录或备份里带出敏感原文
#   3. 不为规避错误改写用户内容：命中即拒绝并提示改为 ${secret:...} 引用
#   4. 无法可靠判断的内容以 suspects 提示人工检查，不宣称已全部识别

# ============================================================================
# 文本中的明文凭据（共享资产入库门禁）
# ============================================================================

# 扫描一个文本文件里的明文凭据赋值，只报告行号与字段名，绝不回显值
# 覆盖：key: value / key=value / 块标量（key: | 后缩进的整段）
# 不视为违规：${secret:...} 引用、空值、非敏感键
# 输出: JSON 数组 [{line, field}]
intake_text_credential_lines() {
  local file="$1"
  [ -f "$file" ] || { printf '[]\n'; return 0; }

  LC_ALL=C awk '
    function mask(s,   out, pos, span, filler, k) {
      out = s
      while (match(out, /\$\{[a-z0-9_]+:[a-z0-9_]*\}/)) {
        span = RLENGTH
        filler = ""
        for (k = 0; k < span; k++) filler = filler "#"
        out = substr(out, 1, RSTART - 1) filler substr(out, RSTART + span)
      }
      return out
    }
    function indentof(s,   i) {
      i = 0
      while (i < length(s) && substr(s, i + 1, 1) == " ") i++
      return i
    }
    function emit(n, f) { printf "%s\t%s\n", n, f }
    BEGIN { inblock = 0; keyindent = -1; keyname = "" }
    {
      line = $0
      probe = mask(tolower(line))

      if (inblock) {
        if (line ~ /^[[:space:]]*$/) next          # 空行属于块内容
        if (indentof(line) > keyindent) { emit(NR, keyname); next }
        inblock = 0
      }

      if (match(probe, /(api[_-]?key|token|password|passwd|secret|credential|authorization|private[_-]?key|access[_-]?key)/)) {
        kw_end = RSTART + RLENGTH
        sep = 0
        for (i = kw_end; i <= length(probe); i++) {
          c = substr(probe, i, 1)
          if (c == ":" || c == "=") { sep = i; break }
        }
        if (sep == 0) next
        keyname = substr(probe, RSTART, RLENGTH)

        vline = substr(line, sep + 1)
        vprobe = substr(probe, sep + 1)
        sub(/^[[:space:]]+/, "", vline)
        sub(/^[[:space:]]+/, "", vprobe)
        if (vprobe ~ /^#+/) next                    # ${secret:...} 引用本身不是秘密

        if (vline ~ /^[|>][-+]?[0-9]?[[:space:]]*$/) {
          inblock = 1
          keyindent = indentof(line)
          emit(NR, keyname)
          next
        }

        v = vprobe
        sub(/[[:space:]]+$/, "", v)
        sub(/,$/, "", v)
        sub(/[[:space:]]*#.*$/, "", v)
        gsub(/^["'"'"']/, "", v)
        gsub(/["'"'"']$/, "", v)
        if (v != "") emit(NR, keyname)
      }
    }
  ' "$file" 2>/dev/null \
    | LC_ALL=C awk -F'\t' 'NF >= 2 { printf "{\"line\": %d, \"field\": \"%s\"}\n", $1, $2 }' \
    | jq -s -c '.' 2>/dev/null || printf '[]\n'
}

# Skill 目录内所有文件的明文凭据；输出 [{file, line, field}]（file 为目录内相对路径）
intake_dir_credential_lines() {
  local dir="$1"
  [ -d "$dir" ] || { printf '[]\n'; return 0; }

  local tmp f rel
  tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-credlines.XXXXXX")"
  : > "$tmp"
  find "$dir" -type f 2>/dev/null | sort | while IFS= read -r f; do
    [ -n "$f" ] || continue
    rel="${f#"${dir}/"}"
    intake_text_credential_lines "$f" \
      | jq -c --arg f "$rel" '.[] | {file: $f, line, field}' >> "$tmp"
  done
  jq -s -c '.' "$tmp" 2>/dev/null || printf '[]\n'
  rm -f "$tmp"
}

# 共享资产凭据门禁：入库内容里出现明文凭据即拒绝该动作
# 只报告文件与行号，绝不在错误信息里回显值
intake_credential_gate_findings() {
  local type="$1" resolved="$2"
  case "$type" in
    skill)
      intake_dir_credential_lines "$resolved"
      ;;
    rule)
      intake_text_credential_lines "$resolved" \
        | jq -c --arg f "$(basename "$resolved")" 'map(. + {file: $f})' 2>/dev/null
      ;;
    *)
      printf '[]\n'
      ;;
  esac
}

# 把 findings 折叠成不含量值的错误串：credential_not_reference:<file>:<line>,...
intake_credential_gate_error() {
  local findings="$1"
  printf '%s' "$findings" | jq -r '
    [.[] | "credential_not_reference:\(.file):\(.line)"] | join(",")' 2>/dev/null
}
