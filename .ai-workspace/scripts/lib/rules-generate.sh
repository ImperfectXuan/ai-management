#!/bin/sh
# rules-generate.sh - Per-rule .mdc/.md generation for Cursor/Trae
# Emits one rule file per canonical rule with tool-appropriate YAML frontmatter,
# restoring the "on-demand glob loading" behavior that single-file concat lost.
# Requires: common.sh to be sourced first

# ============================================================================
# YAML helpers (grep-based, no external parsers)
# ============================================================================

# Read a scalar key from a YAML file, stripped of quotes and trailing space
get_yaml_val() {
  local key="$1" file="$2"
  local val
  val="$(grep -m1 "^${key}:" "$file" | sed "s/^${key}:[[:space:]]*//" | sed 's/[[:space:]]*$//')"
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
  esac
  echo "$val"
}

# Look up the `required` value for a rule source path in a mapping.yaml
get_mapping_required() {
  local mapping="$1" source="$2"
  awk -v target="$source" '
    /- source:/ {
      src = $0
      sub(/^[[:space:]]*- source:[[:space:]]*/, "", src)
      if (src == target) found = 1
    }
    found && /required:/ {
      req = $0
      sub(/^[[:space:]]*required:[[:space:]]*/, "", req)
      print req
      exit
    }
  ' "$mapping"
}

# ============================================================================
# Rule frontmatter parsing
# ============================================================================

is_domain_rule() {
  case "$1" in
    *"/domains/"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Collapse "**/*.EXT" lines on stdin into "**/*.{EXT,EXT,...}"
collapse_block_globs() {
  local result="" line ext
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ext="${line##*\*.}"
    if [ -z "$result" ]; then
      result="$ext"
    else
      result="${result},${ext}"
    fi
  done
  echo "**/*.{${result}}"
}

# Determine the globs for a rule: own frontmatter globs (inline or block)
# first, else map from scope, else apply to everything
rule_globs() {
  local file="$1" scope="$2"
  local globs block

  globs="$(get_yaml_val globs "$file")"
  if [ -n "$globs" ]; then
    echo "$globs"
    return
  fi

  block="$(awk '/^globs:/{g=1; next} g && /^  - /{line=$0; sub(/^[[:space:]]*-[[:space:]]*"?/, "", line); sub(/"?$/, "", line); print line}' "$file")"
  if [ -n "$block" ]; then
    echo "$block" | collapse_block_globs
    return
  fi

  case "$scope" in
    csharp) echo '**/*.{cs,csproj,sln}' ;;
    vue)    echo '**/*.{vue,ts,js,css,scss}' ;;
    *)      echo '**/*' ;;
  esac
}

# Read a rule's frontmatter into RULE_ID/RULE_TITLE/RULE_DESC/RULE_SCOPE/RULE_GLOBS
read_rule_meta() {
  local file="$1"
  RULE_ID="$(get_yaml_val id "$file")"
  RULE_TITLE="$(get_yaml_val title "$file")"
  RULE_DESC="$(get_yaml_val description "$file")"
  RULE_SCOPE="$(get_yaml_val scope "$file")"

  [ -z "$RULE_ID" ] && RULE_ID="$(basename "$file" .md)"
  [ -z "$RULE_DESC" ] && RULE_DESC="$RULE_TITLE"
  RULE_GLOBS="$(rule_globs "$file" "$RULE_SCOPE")"
}

# ============================================================================
# Per-rule generation
# ============================================================================

generate_rule_files() {
  local tool="$1" target_scope="$2"
  local ext=".mdc" out_dir="" mapping rel required
  local count=0 backed_up=""

  case "$tool" in
    cursor) out_dir="${AIWS_ROOT}/.cursor/rules" ;;
    trae)   out_dir="${AIWS_ROOT}/.trae/rules"; ext=".md" ;;
    *)      die "Unknown rule-file tool: $tool" ;;
  esac

  ensure_dir "$out_dir"

  mapping="${AIWS_DIR}/adapters/${tool}/mapping.yaml"
  if [ ! -f "$mapping" ]; then
    log_warn "No mapping.yaml for ${tool}; skipping per-rule generation"
    return 0
  fi

  # 第一遍：算出本次会生成的文件名集合，作为白名单
  local expected=""
  for rule_file in "${AIWS_DIR}"/rules/*.md "${AIWS_DIR}"/rules/domains/*.md; do
    [ -f "$rule_file" ] || continue
    is_rule_file "$rule_file" || continue
    if [ "$target_scope" = "global" ] && is_domain_rule "$rule_file"; then
      continue
    fi
    if [ "$target_scope" = "project" ] && ! is_domain_rule "$rule_file"; then
      continue
    fi
    if is_domain_rule "$rule_file"; then
      rel="rules/domains/$(basename "$rule_file")"
    else
      rel="rules/$(basename "$rule_file")"
    fi
    required="$(get_mapping_required "$mapping" "$rel")"
    [ -z "$required" ] && continue
    rule_applies_to_tool "$rule_file" "$tool" || continue
    local rid
    rid="$(basename "$rule_file" .md)"
    expected="${expected}${rid}${ext}"$'\n'
  done

  # 若存在可注入 context，把 00-context 纳入白名单，避免被当非预期文件备份
  if memory_has_context; then
    expected="${expected}00-context${ext}"$'\n'
  fi

  # 用白名单 + .bak 备份替代无差别 `rm -f out_dir/*`
  # 对 out_dir 中每一个存在的项：
  #   - 已是 .bak：跳过（不重复处理）
  #   - 在白名单内：跳过（writeFile 会覆盖）
  #   - 其它：重命名为 *.bak；若同名 .bak 已存在则附加时间戳
  if [ -d "$out_dir" ]; then
    for f in "$out_dir"/*; do
      [ -e "$f" ] || continue
      local fname
      fname="$(basename "$f")"
      case "$fname" in
        *.bak) continue ;;
      esac
      # 白名单命中：跳过
      if [ -n "$expected" ] && printf '%s\n' "$expected" | grep -qxF "$fname"; then
        continue
      fi
      local bak="$f.bak"
      if [ -e "$bak" ]; then
        bak="$f.$(date +%Y%m%d-%H%M%S).bak"
      fi
      if mv "$f" "$bak" 2>/dev/null; then
        backed_up="${backed_up} $(basename "$bak")"
        if [ -d "$bak" ]; then
          log_warn "已备份非预期目录: ${fname}/ -> $(basename "$bak")"
        else
          log_warn "已备份非预期文件: ${fname} -> $(basename "$bak")"
        fi
      fi
    done
  fi

  # 第二遍：生成
  for rule_file in "${AIWS_DIR}"/rules/*.md "${AIWS_DIR}"/rules/domains/*.md; do
    [ -f "$rule_file" ] || continue
    is_rule_file "$rule_file" || continue

    # Scope filter: global = canonical rules only, project = domain rules only
    if [ "$target_scope" = "global" ] && is_domain_rule "$rule_file"; then
      continue
    fi
    if [ "$target_scope" = "project" ] && ! is_domain_rule "$rule_file"; then
      continue
    fi

    if is_domain_rule "$rule_file"; then
      rel="rules/domains/$(basename "$rule_file")"
    else
      rel="rules/$(basename "$rule_file")"
    fi

    required="$(get_mapping_required "$mapping" "$rel")"
    if [ -z "$required" ]; then
      log_warn "Skipping ${rel} (not listed in ${tool} mapping)"
      continue
    fi
    rule_applies_to_tool "$rule_file" "$tool" || continue

    read_rule_meta "$rule_file"
    if [ "$required" = "true" ]; then
      RULE_ALWAYS="true"
    else
      RULE_ALWAYS="false"
    fi

    {
      echo "---"
      echo "# Generated by AI Workspace - DO NOT EDIT MANUALLY"
      echo "description: ${RULE_DESC}"
      echo "globs: \"${RULE_GLOBS}\""
      echo "alwaysApply: ${RULE_ALWAYS}"
      if [ "$tool" = "cursor" ]; then
        case "$RULE_ID" in
          05-version-control|global-workflow) echo "scene: git_message" ;;
        esac
      fi
      echo "---"
      # Body: strip the canonical YAML frontmatter, keep from the H1 onward
      awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$rule_file"
    } > "${out_dir}/${RULE_ID}${ext}"

    count=$((count + 1))
  done

  # 项目上下文注入：per-rule 工具用 alwaysApply 载体文件承载 context
  if memory_has_context; then
    {
      echo "---"
      echo "# Generated by AI Workspace - DO NOT EDIT MANUALLY"
      echo "description: 项目上下文"
      echo "globs: \"**/*\""
      echo "alwaysApply: true"
      echo "---"
      memory_context_body
    } > "${out_dir}/00-context${ext}"
    log_success "Generated: ${tool} context - 00-context${ext}"
  fi

  if [ -n "$backed_up" ]; then
    log_warn "本轮 sync 备份了非预期文件:${backed_up}"
  fi

  if [ "$count" -gt 0 ]; then
    log_success "Generated: ${tool} rules - ${count} file(s) in $(basename "$out_dir")"
  else
    log_info "No rules generated for ${tool} in scope '${target_scope:-all}'"
  fi
}
