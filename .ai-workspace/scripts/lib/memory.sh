#!/bin/sh
# memory.sh - 记忆系统：ADR / context / decisions 的 list/new/show 与 context 注入辅助
# 依赖 common.sh 先被 source（提供 AIWS_DIR、log_*、die）

MEMORY_DIR="${AIWS_DIR}/memory"

# ============================================================================
# frontmatter 读取
# ============================================================================

# 读单个标量字段，去引号与首尾空白
memory_field() {
  local file="$1" key="$2"
  grep -m1 "^${key}:" "$file" \
    | sed "s/^${key}:[[:space:]]*//; s/[[:space:]]*$//" \
    | sed -e 's/^"//' -e 's/"$//'
}

# ============================================================================
# context 注入内容（Task 3 使用）
# ============================================================================

# 拼接 context/ 下所有非模板 .md 的正文（剥离 frontmatter），文件间空一行
# 直接流式输出（不经命令替换），保留换行
memory_context_body() {
  local f first=1
  for f in "${MEMORY_DIR}"/context/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    [ "$first" = "1" ] || printf '\n'
    first=0
    awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$f"
  done
}

# 是否存在可注入的 context 内容（非空）
memory_has_context() {
  [ -n "$(memory_context_body)" ]
}

# ============================================================================
# list
# ============================================================================

memory_list_adr() {
  local f n title status date
  echo "ADR（架构决策记录）："
  for f in "${MEMORY_DIR}"/adr/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    n="$(basename "$f" .md)"
    title="$(memory_field "$f" title)"
    status="$(memory_field "$f" status)"
    date="$(memory_field "$f" date)"
    printf '  [%s] %s (%s) %s\n' "$n" "$status" "$date" "$title"
  done
}

memory_list_context() {
  local f id title
  echo "Context（项目上下文摘要）："
  for f in "${MEMORY_DIR}"/context/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TEMPLATE.md" ] && continue
    id="$(memory_field "$f" id)"
    title="$(memory_field "$f" title)"
    printf '  %s | %s\n' "$id" "$title"
  done
}

memory_list_decisions() {
  local log="${MEMORY_DIR}/decisions/decisions.md"
  echo "Decisions（技术决策日志）："
  if [ -f "$log" ]; then
    grep -E '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' "$log" || echo "  （暂无条目）"
  else
    echo "  （暂无日志文件）"
  fi
}

memory_list() {
  local type="${1:-all}"
  case "$type" in
    all)      memory_list_adr; echo ""; memory_list_context; echo ""; memory_list_decisions ;;
    adr)      memory_list_adr ;;
    context)  memory_list_context ;;
    decisions) memory_list_decisions ;;
    *) log_error "Unknown memory type: $type (expected adr|context|decisions)"; exit 1 ;;
  esac
}

# ============================================================================
# new
# ============================================================================

# 下一个 ADR 编号（4 位零填充），仅匹配纯数字文件名
memory_next_adr_number() {
  local max=0 n
  for f in "${MEMORY_DIR}"/adr/*.md; do
    [ -f "$f" ] || continue
    n="$(basename "$f" .md)"
    case "$n" in
      [0-9][0-9][0-9][0-9]) [ "$n" -gt "$max" ] && max="$n" ;;
    esac
  done
  printf '%04d' "$((max + 1))"
}

memory_new_adr() {
  local title="$1" n date out
  n="$(memory_next_adr_number)"
  date="$(date +%Y-%m-%d)"
  out="${MEMORY_DIR}/adr/${n}.md"
  awk -v id="$n" -v title="$title" -v date="$date" '
    { gsub(/\{\{ID\}\}/, id); gsub(/\{\{TITLE\}\}/, title); gsub(/\{\{DATE\}\}/, date); print }
  ' "${MEMORY_DIR}/adr/TEMPLATE.md" > "$out"
  log_success "已创建 ADR：adr/${n}.md"
}

memory_new_context() {
  local title="$1" id out
  id="$(printf '%s' "$title" | tr ' ' '-')"
  out="${MEMORY_DIR}/context/${id}.md"
  awk -v id="$id" -v title="$title" '
    { gsub(/\{\{ID\}\}/, id); gsub(/\{\{TITLE\}\}/, title); print }
  ' "${MEMORY_DIR}/context/TEMPLATE.md" > "$out"
  log_success "已创建 Context：context/${id}.md"
}

memory_new_decisions() {
  local title="$1" date log
  date="$(date +%Y-%m-%d)"
  log="${MEMORY_DIR}/decisions/decisions.md"
  if [ ! -f "$log" ]; then
    printf '# 技术决策日志\n\n' > "$log"
  fi
  {
    printf '\n## %s %s\n\n' "$date" "$title"
    printf -- '- 背景：\n- 决策：\n- 影响：\n'
  } >> "$log"
  log_success "已追加决策：decisions/decisions.md"
}

memory_new() {
  local type="$1" title="$2"
  case "$type" in
    adr)       memory_new_adr "$title" ;;
    context)   memory_new_context "$title" ;;
    decisions) memory_new_decisions "$title" ;;
    *) log_error "Unknown memory type: $type (expected adr|context|decisions)"; exit 1 ;;
  esac
}

# ============================================================================
# show
# ============================================================================

memory_show() {
  local rel="$1" f
  f="${MEMORY_DIR}/${rel}"
  if [ ! -f "$f" ]; then
    log_error "No such memory file: ${rel}"
    log_info "可用路径相对 memory/，如 adr/0001.md、context/project.md"
    exit 1
  fi
  cat "$f"
}
