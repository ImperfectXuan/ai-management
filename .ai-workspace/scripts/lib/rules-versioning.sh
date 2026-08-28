#!/bin/sh
# rules-versioning.sh - 规则版本化：sha256 快照 manifest + 变更日志 + git 历史查询
# Requires: common.sh sourced first (AIWS_ROOT / AIWS_DIR)
#
# manifest（.ai-workspace/rules/.manifest.sha256）为 sha256sum 兼容纯文本，
# 格式: "<64位hash>  <相对 .ai-workspace/ 的路径>"（两空格分隔）。
# 选纯文本而非 JSON：零 jq 依赖，且可直接 `shasum -a 256 -c` 校验。
#
# 返回码约定（与 drift-check.sh 一致）：0 成功/一致 | 1 有差异/失败 | 2 环境错误
#
# 硬性契约：规则内容无变化时零写 —— manifest 与 CHANGELOG 的任何一个字节
# 都不改动。这是 CI auto-sync 不回环的第二道保险（第一道是提交信息 [skip ci]）。

# ============================================================================
# Hash Helpers
# ============================================================================

# 跨平台 sha256：Linux/CI 用 sha256sum，macOS 用 shasum，两者皆缺时失败
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    return 1
  fi
}

# 环境自检：rules 目录与哈希工具任一缺失时降级（不 die），由调用方决定跳过语义
is_rule_env_ok() {
  if [ ! -d "${AIWS_DIR}/rules" ]; then
    log_warn "Rules versioning skipped: no ${AIWS_DIR}/rules"
    return 1
  fi
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    log_warn "Rules versioning skipped: need sha256sum or shasum"
    return 1
  fi
  return 0
}

# ============================================================================
# Manifest
# ============================================================================

RULES_MANIFEST=".manifest.sha256"

# 列出待登记规则（相对 .ai-workspace/ 的路径），排除版本化自身产物
rules_manifest_paths() (
  cd "$AIWS_DIR" || exit 1
  for rule_file in rules/*.md rules/domains/*.md; do
    [ -f "$rule_file" ] || continue
    is_rule_file "$rule_file" || continue
    printf '%s\n' "$rule_file"
  done
)

# 计算新 manifest 内容（stdout），按 LC_ALL=C 排序保证跨平台字节稳定
rules_manifest_compute() {
  rules_manifest_paths | while IFS= read -r rel; do
    h="$(hash_file "${AIWS_DIR}/${rel}")" || continue
    printf '%s  %s\n' "$h" "$rel"
  done | LC_ALL=C sort
}

# 对比新旧 manifest，stdout 输出机器可读差异行：
#   modified <rel> <old8> <new8> | added <rel> - <new8> | removed <rel> <old8> -
# 用 FILENAME 而非 NR==FNR 判断：旧 manifest 可能为空文件，NR==FNR 会误判
rules_manifest_diff() {
  awk '
    FILENAME == ARGV[1] { old[$2] = $1; next }
    !($2 in old)        { printf "added %s - %s\n", $2, substr($1, 1, 8); next }
    old[$2] != $1       { printf "modified %s %s %s\n", $2, substr(old[$2], 1, 8), substr($1, 1, 8); delete old[$2]; next }
                        { delete old[$2] }
    END { for (p in old) printf "removed %s %s -\n", p, substr(old[p], 1, 8) }
  ' "$1" "$2"
}

# ============================================================================
# Record (sync 后落检查点)
# ============================================================================

# 首跑基线：CHANGELOG 建头 + 记录规则数，manifest 原子落盘
rules_versioning_baseline() {
  local manifest="$1" changelog="$2" tmp_new="$3"
  local count
  count="$(wc -l < "$tmp_new" | tr -d ' ')"

  if [ ! -f "$changelog" ]; then
    cat > "$changelog" <<'EOF'
# 规则变更日志

由 aiws 自动维护（rules.versioning）。sync 检测到规范规则变化时追加；
哈希为 SHA-256 前 8 位，完整清单见 .manifest.sha256。

EOF
  fi
  printf '## %s — 基线\n\n- 基线: %s 条规则\n\n' "$(date '+%Y-%m-%d')" "$count" >> "$changelog"
  mv "$tmp_new" "$manifest"
  log_success "规则版本化基线建立：${count} 条规则"
}

# 有变化：CHANGELOG 追加 diff 渲染行，manifest 原子替换为新快照
rules_versioning_append_log() {
  local manifest="$1" changelog="$2" tmp_new="$3"
  local diff_out
  diff_out="$(rules_manifest_diff "$manifest" "$tmp_new" | LC_ALL=C sort)"

  printf '## %s — sync\n\n' "$(date '+%Y-%m-%d')" >> "$changelog"
  printf '%s\n' "$diff_out" | awk '{ printf "- %s: %s (%s → %s)\n", $1, $2, $3, $4 }' >> "$changelog"
  printf '\n' >> "$changelog"
  mv "$tmp_new" "$manifest"
  log_success "记录规则变更 $(printf '%s\n' "$diff_out" | grep -c . || true) 条 → rules/CHANGELOG.md"
}

# sync 后落检查点。环境问题只 warn 不阻断 sync 主职（版本化是附属品）
rules_versioning_record() {
  is_rule_env_ok || return 0

  local manifest="${AIWS_DIR}/rules/${RULES_MANIFEST}"
  local changelog="${AIWS_DIR}/rules/CHANGELOG.md"
  local tmp_new
  tmp_new="$(mktemp "${TMPDIR:-/tmp}/aiws-manifest.XXXXXX")" || {
    log_warn "Rules versioning skipped: cannot create temp file"
    return 0
  }
  rules_manifest_compute > "$tmp_new"

  if [ ! -f "$manifest" ]; then
    rules_versioning_baseline "$manifest" "$changelog" "$tmp_new"
    return 0
  fi

  # 无变化零写：重复 sync 不产生脏 diff，CI 二次运行不产生新提交
  if cmp -s "$manifest" "$tmp_new"; then
    rm -f "$tmp_new"
    return 0
  fi

  rules_versioning_append_log "$manifest" "$changelog" "$tmp_new"
}

# ============================================================================
# Status / History
# ============================================================================

# 规范层 vs manifest：rc 0 一致 | 1 有差异 | 2 环境错误（无 manifest 等）
rules_status() {
  if ! is_rule_env_ok; then
    return 2
  fi

  local manifest="${AIWS_DIR}/rules/${RULES_MANIFEST}"
  if [ ! -f "$manifest" ]; then
    log_info "尚未生成 manifest，先运行 aiws sync 生成基线"
    return 2
  fi

  local tmp_new
  tmp_new="$(mktemp "${TMPDIR:-/tmp}/aiws-status.XXXXXX")" || return 2
  rules_manifest_compute > "$tmp_new"

  local diff_out count
  diff_out="$(rules_manifest_diff "$manifest" "$tmp_new" | LC_ALL=C sort)"
  # grep -c 在计数为 0 时以 rc 1 退出，set -e 下会中断脚本（validate.sh 同款防御）
  count="$(printf '%s\n' "$diff_out" | grep -c . || true)"
  rm -f "$tmp_new"

  if [ "$count" -eq 0 ]; then
    local total
    total="$(wc -l < "$manifest" | tr -d ' ')"
    log_success "规则与 manifest 一致（${total} 条）"
    return 0
  fi

  log_info "规则状态 vs manifest（相对上次同步）："
  printf '%s\n' "$diff_out" | awk '{ printf "%s: %s (%s → %s)\n", $1, $2, $3, $4 }'
  log_error "共 ${count} 条差异，运行 aiws sync 以更新生成文件并记录"
  return 1
}

# frontmatter id 兜底解析：扫描 rules 树中 id 与目标一致的文件（首个命中），
# stdout 输出相对 .ai-workspace/ 的路径；找不到返回非零
resolve_rule_id_by_frontmatter() {
  local rule_id="$1" rule_file id_line
  for rule_file in "${AIWS_DIR}"/rules/*.md "${AIWS_DIR}"/rules/domains/*.md; do
    [ -f "$rule_file" ] || continue
    is_rule_file "$rule_file" || continue
    id_line="$(head -n 5 "$rule_file" | grep -m1 '^id:' || true)"
    case "$id_line" in
      "id: ${rule_id}"|"id: \"${rule_id}\""|"id: '${rule_id}'")
        printf '%s\n' "${rule_file#"${AIWS_DIR}/"}"
        return 0
        ;;
    esac
  done
  return 1
}

# 用法: rules_history <id|path>
# id 解析顺序：含 / 直接当相对路径 → rules/<id>.md → rules/domains/<id>.md → frontmatter id
rules_history() {
  local rule_id="$1"
  if [ -z "$rule_id" ]; then
    log_error "Usage: aiws rules history <id|path>"
    return 1
  fi

  local rel=""
  case "$rule_id" in
    */*) [ -f "${AIWS_DIR}/${rule_id}" ] && rel="$rule_id" ;;
  esac
  if [ -z "$rel" ] && [ -f "${AIWS_DIR}/rules/${rule_id}.md" ]; then
    rel="rules/${rule_id}.md"
  fi
  if [ -z "$rel" ] && [ -f "${AIWS_DIR}/rules/domains/${rule_id}.md" ]; then
    rel="rules/domains/${rule_id}.md"
  fi
  if [ -z "$rel" ]; then
    rel="$(resolve_rule_id_by_frontmatter "$rule_id" || true)"
  fi

  if [ -z "$rel" ]; then
    log_error "Rule not found: ${rule_id}"
    return 1
  fi

  if ! git -C "$AIWS_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    log_error "Not a git repository: ${AIWS_ROOT}"
    return 1
  fi

  log_info "规则 ${rule_id} → ${rel}"
  local history
  history="$(git -C "$AIWS_ROOT" log --follow --date=short \
    --pretty=format:'%h %ad %s (%an)' -- "${AIWS_DIR}/${rel}" 2>/dev/null)" || history=""
  if [ -z "$history" ]; then
    log_info "该规则尚未提交到 git"
    return 0
  fi
  printf '%s\n' "$history"
}
