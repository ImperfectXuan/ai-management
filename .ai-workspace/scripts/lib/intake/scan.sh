#!/bin/sh
# intake/scan.sh - 多来源只读扫描引擎
# 供 aiws intake scan 调用；需先 source common.sh 与 intake/identity.sh
#
# 设计约束：
#   1. 只读：绝不写入来源目录或总库资产
#   2. 不执行来源脚本、不启动 MCP
#   3. 形成持久候选前分离已识别凭据；未知敏感字段只提示
#   4. 不用 "managed 标记" 认定总库已拥有
#   5. 断链/循环/越界链接明确报告，不隐式读取

# ============================================================================
# 输出辅助
# ============================================================================

# 进度事件：stderr JSON 行，Desktop 桥接后转 IPC
intake_progress() {
  # $1 = message, $2 = optional pct
  printf '{"event":"progress","message":%s,"pct":%s}\n' \
    "$(printf '%s' "$1" | jq -Rs .)" "${2:-null}" >&2
}

# 取消检查
intake_check_cancel() {
  if [ -n "${INTAKE_CANCEL_FILE:-}" ] && [ -f "${INTAKE_CANCEL_FILE}" ]; then
    return 0  # true = cancelled
  fi
  return 1
}

# ============================================================================
# 路径与链接安全
# ============================================================================

# 判断 path 是否在 root 之下（防越界读取）
intake_path_within() {
  local path="$1" root="$2"
  case "$path" in
    "$root"|"$root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# 解析符号链接真实路径（readlink -f 兼容）
intake_realpath() {
  local target="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$target" 2>/dev/null && return
  fi
  # macOS / 兜底
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$target" 2>/dev/null && return
  fi
  # 最后兜底：手动展开（不够完美但可用）
  printf '%s\n' "$target"
}

# 检查路径（含父目录）的真实路径是否在允许范围内
# 在读取任何内容前调用；任一父目录是越界符号链接即拒绝
# 输出 "0|<real>" 或 "2|link_out_of_scope"
intake_check_path_scope() {
  local target="$1" allowed_roots="$2"

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    printf '0|%s\n' "$target"
    return 0
  fi

  # 逐级检查父目录是否有越界符号链接
  local probe="$target" real root in_scope=0 root_real
  while [ "$probe" != "/" ] && [ -n "$probe" ]; do
    if [ -L "$probe" ]; then
      real="$(intake_realpath "$probe")"
      if [ -n "$real" ]; then
        in_scope=0
        OLD_IFS="$IFS"
        IFS=":"
        for root in $allowed_roots; do
          IFS="$OLD_IFS"
          [ -n "$root" ] || continue
          root_real="$(intake_realpath "$root")"
          # 父目录链接解析后应在允许根内，或是允许根的祖先（如 macOS /tmp → /private/tmp）
          if intake_path_within "$real" "$root" || intake_path_within "$real" "$root_real" \
            || intake_path_within "$root" "$real" || intake_path_within "$root_real" "$real"; then
            in_scope=1
            break
          fi
          IFS=":"
        done
        IFS="$OLD_IFS"
        if [ "$in_scope" = "0" ]; then
          printf '2|link_out_of_scope\n'
          return 0
        fi
      fi
    fi
    probe="$(dirname "$probe")"
  done

  # 目标自身的真实路径
  real="$(intake_realpath "$target")"
  if [ -n "$real" ]; then
    local root in_scope=0 root_real
    OLD_IFS="$IFS"
    IFS=":"
    for root in $allowed_roots; do
      IFS="$OLD_IFS"
      [ -n "$root" ] || continue
      root_real="$(intake_realpath "$root")"
      if intake_path_within "$real" "$root" || intake_path_within "$real" "$root_real"; then
        in_scope=1
        break
      fi
      IFS=":"
    done
    IFS="$OLD_IFS"
    if [ "$in_scope" = "0" ]; then
      printf '2|link_out_of_scope\n'
      return 0
    fi
  fi

  printf '0|%s\n' "${real:-$target}"
  return 0
}

# 安全跟随符号链接：
#  - 断链 → 输出 "1|broken_symlink"
#  - 循环 → 输出 "1|symlink_cycle"
#  - 越界 → 输出 "2|link_out_of_scope"
#  - 成功 → 输出 "0|<realpath>"
# allowed_roots 以冒号分隔
intake_safe_resolve_link() {
  local link="$1" allowed_roots="$2"

  if [ ! -e "$link" ] && [ -L "$link" ]; then
    printf '1|broken_symlink\n'
    return 0
  fi

  # 先检查父目录链接是否越界
  local scope_check
  scope_check="$(intake_check_path_scope "$link" "$allowed_roots")"
  case "${scope_check%%|*}" in
    2) printf '2|link_out_of_scope\n'; return 0 ;;
  esac

  local real
  real="$(intake_realpath "$link")"
  if [ -z "$real" ] || [ ! -e "$real" ]; then
    printf '1|broken_symlink\n'
    return 0
  fi

  # 循环检测：real 等于 link 的某个祖先
  local probe="$real"
  while [ "$probe" != "/" ] && [ -n "$probe" ]; do
    if [ "$probe" = "$link" ]; then
      printf '1|symlink_cycle\n'
      return 0
    fi
    probe="$(dirname "$probe")"
  done

  # 越界检测
  local root
  local in_scope=0
  OLD_IFS="$IFS"
  IFS=":"
  for root in $allowed_roots; do
    IFS="$OLD_IFS"
    [ -n "$root" ] || continue
    if intake_path_within "$real" "$root"; then
      in_scope=1
      break
    fi
    IFS=":"
  done
  IFS="$OLD_IFS"

  if [ "$in_scope" = "0" ]; then
    printf '2|link_out_of_scope\n'
    return 0
  fi

  printf '0|%s\n' "$real"
  return 0
}

# ============================================================================
# 工具适配器：按 (tool, scope, source_root) 得到三类资产路径
# 与 common.sh get_tool_* 一致，但支持任意 source_root（不限 AIWS_ROOT）
# ============================================================================

# rules 路径：cursor/trae 返回目录；claude/codex 返回单文件
intake_tool_rules_path() {
  local tool="$1" root="$2" scope="$3"
  if [ "$scope" = "global" ]; then
    case "$tool" in
      claude) echo "${HOME_DIR}/.claude/CLAUDE.md" ;;
      codex)  echo "${HOME_DIR}/.codex/AGENTS.md" ;;
      cursor) echo "${HOME_DIR}/.cursor/rules" ;;
      trae)   echo "${HOME_DIR}/.trae/rules" ;;
      *)      echo "" ;;
    esac
  else
    case "$tool" in
      claude) echo "${root}/CLAUDE.md" ;;
      codex)  echo "${root}/AGENTS.md" ;;
      cursor) echo "${root}/.cursor/rules" ;;
      trae)   echo "${root}/.trae/rules" ;;
      *)      echo "" ;;
    esac
  fi
}

# skills 路径
intake_tool_skills_path() {
  local tool="$1" root="$2" scope="$3"
  if [ "$scope" = "global" ]; then
    case "$tool" in
      codex|claude) echo "${HOME_DIR}/.agents/skills" ;;
      cursor)       echo "${HOME_DIR}/.cursor/skills" ;;
      trae)         echo "${HOME_DIR}/.trae/skills" ;;
      *)            echo "" ;;
    esac
  else
    case "$tool" in
      codex|claude) echo "${root}/.agents/skills" ;;
      cursor)       echo "${root}/.cursor/skills" ;;
      trae)         echo "${root}/.trae/skills" ;;
      *)            echo "" ;;
    esac
  fi
}

# MCP 路径
intake_tool_mcp_path() {
  local tool="$1" root="$2" scope="$3"
  if [ "$scope" = "global" ]; then
    case "$tool" in
      claude) echo "${HOME_DIR}/.claude.json" ;;
      codex)  echo "${HOME_DIR}/.codex/config.toml" ;;
      cursor) echo "${HOME_DIR}/.cursor/mcp.json" ;;
      trae)   echo "" ;;
      *)      echo "" ;;
    esac
  else
    case "$tool" in
      claude) echo "${root}/.mcp.json" ;;
      codex)  echo "${root}/.codex/config.toml" ;;
      cursor) echo "${root}/.cursor/mcp.json" ;;
      trae)   echo "${root}/.trae/mcp.json" ;;
      *)      echo "" ;;
    esac
  fi
}

# 是否生成副本（带 AIWS 生成标记）
intake_is_generated_copy() {
  local file="$1"
  [ -f "$file" ] || return 1
  head -n 5 "$file" 2>/dev/null | grep -q "Generated by AI Workspace"
}

# ============================================================================
# Rules 扫描
# ============================================================================

# 扫描单个规则文件，输出一行 occurrence JSON
# $1=source_root $2=tool $3=scope $4=filepath $5=allowed_roots
intake_scan_rule_file() {
  local source_root="$1" tool="$2" scope="$3" filepath="$4" allowed_roots="$5"

  local rel_path
  rel_path="${filepath#"${source_root}"/}"
  [ "$rel_path" = "$filepath" ] && rel_path="$filepath"

  local occ_id
  occ_id="$(intake_occurrence_id "$source_root" "$tool" "$scope" "$rel_path")"

  local read_status="ok" read_error="null" is_generated="false" link_target="null"
  local body_hash="missing" original_name

  original_name="$(basename "$filepath")"
  original_name="${original_name%.*}"

  # 范围校验（含父目录软链接）——必须在任何内容读取之前
  local scope_check scope_rc scope_real
  scope_check="$(intake_check_path_scope "$filepath" "$allowed_roots")"
  scope_rc="${scope_check%%|*}"
  scope_real="${scope_check#*|}"
  if [ "$scope_rc" = "2" ]; then
    read_status="unsupported"
    read_error="\"link_out_of_scope\""
    body_hash="missing"
    # 直接返回，不读取内容
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" --arg name "$original_name" \
      --arg status "$read_status" --argjson error "$read_error" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "rule",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: $name,
        content_fingerprint: "sha256:missing",
        read_status: $status, read_error: $error,
        is_generated_copy: false, generated_of: null, link_target: null,
        title: null, description: null, globs: null, always_apply: null,
        suspects: [], last_seen_batch: $batch_id
      }'
    return 0
  fi

  # 生成副本检测（不据此认定总库已拥有）——范围已确认
  if intake_is_generated_copy "$filepath"; then
    is_generated="true"
  fi

  # 符号链接处理（范围已通过，跟随到真实内容）
  if [ -L "$filepath" ]; then
    local link_result link_rc link_real
    link_result="$(intake_safe_resolve_link "$filepath" "$allowed_roots")"
    link_rc="${link_result%%|*}"
    link_real="${link_result#*|}"
    case $link_rc in
      0)
        link_target="$(printf '%s' "$link_real" | jq -Rs .)"
        filepath="$link_real"
        body_hash="$(intake_sha256 "$filepath")"
        ;;
      1)
        read_status="unreadable"
        read_error="\"${link_real:-link_error}\""
        body_hash="missing"
        ;;
      2)
        read_status="unsupported"
        read_error="\"${link_real:-link_out_of_scope}\""
        body_hash="missing"
        ;;
    esac
  else
    if [ ! -f "$filepath" ]; then
      read_status="missing"
    elif [ ! -r "$filepath" ]; then
      read_status="unreadable"
      read_error="\"permission_denied\""
    else
      body_hash="$(intake_sha256 "$filepath")"
    fi
  fi

  # frontmatter 提取（轻量）
  local title="" desc="" globs="" always_apply=""
  if [ "$read_status" = "ok" ] && [ -f "$filepath" ]; then
    title="$(grep -m1 '^title:' "$filepath" 2>/dev/null | sed 's/^title:[[:space:]]*//' | tr -d '"')"
    desc="$(grep -m1 '^description:' "$filepath" 2>/dev/null | sed 's/^description:[[:space:]]*//' | tr -d '"')"
    globs="$(grep -m1 '^globs:' "$filepath" 2>/dev/null | sed 's/^globs:[[:space:]]*//' | tr -d '"')"
    always_apply="$(grep -m1 '^alwaysApply:' "$filepath" 2>/dev/null | sed 's/^alwaysApply:[[:space:]]*//')"
  fi

  # 敏感字段提示（只报告）
  local suspects="[]"
  if [ "$read_status" = "ok" ] && [ -f "$filepath" ]; then
    suspects="$(intake_scan_text_suspects "$filepath")"
  fi

  jq -nc \
    --arg id "$occ_id" \
    --arg source_root "$source_root" \
    --arg tool "$tool" \
    --arg scope "$scope" \
    --arg path "$rel_path" \
    --arg name "$original_name" \
    --arg fp "$body_hash" \
    --arg status "$read_status" \
    --argjson error "$read_error" \
    --argjson generated "$is_generated" \
    --argjson link_target "$link_target" \
    --arg title "$title" \
    --arg desc "$desc" \
    --arg globs "$globs" \
    --arg always "$always_apply" \
    --argjson suspects "$suspects" \
    '{
      occurrence_id: $id,
      asset_type: "rule",
      source_root: $source_root,
      tool: $tool,
      scope: $scope,
      path: $path,
      original_name: $name,
      content_fingerprint: ("sha256:" + $fp),
      read_status: $status,
      read_error: $error,
      is_generated_copy: $generated,
      generated_of: null,
      link_target: $link_target,
      title: (if $title == "" then null else $title end),
      description: (if $desc == "" then null else $desc end),
      globs: (if $globs == "" then null else $globs end),
      always_apply: (if $always == "" then null else ($always == "true") end),
      suspects: $suspects,
      last_seen_batch: $batch_id
    }' --arg batch_id "${INTAKE_BATCH_ID:-}" 2>/dev/null
}

# 扫描某 tool 的 rules 来源
# $1=source_root $2=tool $3=scope $4=allowed_roots
# 输出: occurrence JSON 行
intake_scan_rules() {
  local source_root="$1" tool="$2" scope="$3" allowed_roots="$4"
  local rules_path
  rules_path="$(intake_tool_rules_path "$tool" "$source_root" "$scope")"
  [ -n "$rules_path" ] || return 0

  local f
  case "$tool" in
    cursor|trae)
      if [ ! -d "$rules_path" ]; then
        return 0
      fi
      local ext="mdc"
      [ "$tool" = "trae" ] && ext="md"
      for f in "${rules_path}"/*."${ext}"; do
        [ -e "$f" ] || [ -L "$f" ] || continue
        intake_scan_rule_file "$source_root" "$tool" "$scope" "$f" "$allowed_roots"
      done
      ;;
    claude|codex)
      if [ ! -f "$rules_path" ] && [ ! -L "$rules_path" ]; then
        return 0
      fi
      intake_scan_rule_file "$source_root" "$tool" "$scope" "$rules_path" "$allowed_roots"
      ;;
  esac
}

# ============================================================================
# Skills 扫描
# ============================================================================

# 扫描 skills 目录下的一个 skill
# $1=source_root $2=tool $3=scope $4=skill_dir $5=allowed_roots
intake_scan_skill() {
  local source_root="$1" tool="$2" scope="$3" skill_dir="$4" allowed_roots="$5"

  local skill_name
  skill_name="$(basename "$skill_dir")"

  local rel_path
  rel_path="${skill_dir#"${source_root}"/}"
  [ "$rel_path" = "$skill_dir" ] && rel_path="$skill_dir"

  local occ_id
  occ_id="$(intake_occurrence_id "$source_root" "$tool" "$scope" "$rel_path")"

  local read_status="ok" read_error="null" link_target="null"
  local is_link="false" is_managed_link="false"
  local dir_hash="missing"

  # 范围校验（含父目录软链接）——必须在任何内容读取之前
  local scope_check scope_rc scope_real
  scope_check="$(intake_check_path_scope "$skill_dir" "$allowed_roots")"
  scope_rc="${scope_check%%|*}"
  scope_real="${scope_check#*|}"
  if [ "$scope_rc" = "2" ]; then
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" --arg name "$skill_name" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "skill",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: $name,
        content_fingerprint: "sha256:missing",
        read_status: "unsupported", read_error: "link_out_of_scope",
        is_generated_copy: false, generated_of: null, link_target: null,
        is_symlink: false, is_managed_link: false,
        file_count: 0, has_script: false,
        suspects: [], last_seen_batch: $batch_id
      }'
    return 0
  fi

  # 符号链接：识别真实来源
  if [ -L "$skill_dir" ]; then
    is_link="true"
    local raw_target
    raw_target="$(readlink "$skill_dir" 2>/dev/null || echo '')"

    # managed 判定：链接指向 AIWS_DIR/skills/ 下
    case "$raw_target" in
      *"/.ai-workspace/skills/"*)
        is_managed_link="true"
        ;;
    esac

    local link_result link_rc link_real
    link_result="$(intake_safe_resolve_link "$skill_dir" "$allowed_roots")"
    link_rc="${link_result%%|*}"
    link_real="${link_result#*|}"
    case $link_rc in
      0)
        link_target="$(printf '%s' "$link_real" | jq -Rs .)"
        skill_dir="$link_real"
        dir_hash="$(intake_fingerprint_skill_dir "$skill_dir")"
        ;;
      1)
        read_status="unreadable"
        read_error="\"${link_real:-link_error}\""
        ;;
      2)
        read_status="unsupported"
        read_error="\"${link_real:-link_out_of_scope}\""
        ;;
    esac
  else
    if [ ! -d "$skill_dir" ]; then
      read_status="missing"
    else
      dir_hash="$(intake_fingerprint_skill_dir "$skill_dir")"
    fi
  fi

  # SKILL.md 必须存在
  if [ "$read_status" = "ok" ] && [ ! -f "${skill_dir}/SKILL.md" ]; then
    read_status="parse_error"
    read_error='"missing_SKILL.md"'
  fi

  # 文件清单
  local file_count=0 has_script="false"
  if [ "$read_status" = "ok" ] && [ -d "$skill_dir" ]; then
    file_count="$(find "$skill_dir" -type f 2>/dev/null | wc -l | tr -d ' ')"
    if find "$skill_dir" -type f \( -name '*.sh' -o -name '*.py' -o -name '*.js' \) 2>/dev/null | grep -q .; then
      has_script="true"
    fi
  fi

  # 敏感字段提示
  local suspects="[]"
  if [ "$read_status" = "ok" ] && [ -f "${skill_dir}/SKILL.md" ]; then
    suspects="$(intake_scan_text_suspects "${skill_dir}/SKILL.md")"
  fi

  jq -nc \
    --arg id "$occ_id" \
    --arg source_root "$source_root" \
    --arg tool "$tool" \
    --arg scope "$scope" \
    --arg path "$rel_path" \
    --arg name "$skill_name" \
    --arg fp "$dir_hash" \
    --arg status "$read_status" \
    --argjson error "$read_error" \
    --argjson link_target "$link_target" \
    --argjson is_link "$is_link" \
    --argjson is_managed "$is_managed_link" \
    --argjson file_count "$file_count" \
    --argjson has_script "$has_script" \
    --argjson suspects "$suspects" \
    --arg batch_id "${INTAKE_BATCH_ID:-}" \
    '{
      occurrence_id: $id,
      asset_type: "skill",
      source_root: $source_root,
      tool: $tool,
      scope: $scope,
      path: $path,
      original_name: $name,
      content_fingerprint: ("sha256:" + $fp),
      read_status: $status,
      read_error: $error,
      is_generated_copy: false,
      generated_of: null,
      link_target: $link_target,
      is_symlink: $is_link,
      is_managed_link: $is_managed,
      file_count: $file_count,
      has_script: $has_script,
      suspects: $suspects,
      last_seen_batch: $batch_id
    }'
}

# 扫描 skills 目录
intake_scan_skills() {
  local source_root="$1" tool="$2" scope="$3" allowed_roots="$4"
  local skills_path
  skills_path="$(intake_tool_skills_path "$tool" "$source_root" "$scope")"
  [ -n "$skills_path" ] || return 0
  [ -d "$skills_path" ] || return 0

  local d name
  for d in "${skills_path}"/*; do
    [ -e "$d" ] || [ -L "$d" ] || continue
    name="$(basename "$d")"
    # 只处理目录或符号链接（跳过普通文件）
    [ -d "$d" ] || [ -L "$d" ] || continue
    intake_scan_skill "$source_root" "$tool" "$scope" "$d" "$allowed_roots"
  done
}

# ============================================================================
# MCP 扫描
# ============================================================================

# 扫描单个 MCP 配置文件
# $1=source_root $2=tool $3=scope $4=mcp_file $5=allowed_roots
intake_scan_mcp() {
  local source_root="$1" tool="$2" scope="$3" mcp_file="$4" allowed_roots="$5"

  [ -n "$mcp_file" ] || return 0

  local rel_path
  rel_path="${mcp_file#"${source_root}"/}"
  [ "$rel_path" = "$mcp_file" ] && rel_path="$mcp_file"

  local occ_id
  occ_id="$(intake_occurrence_id "$source_root" "$tool" "$scope" "$rel_path")"

  # 范围校验（含父目录软链接）——必须在任何内容读取之前
  local scope_check scope_rc
  scope_check="$(intake_check_path_scope "$mcp_file" "$allowed_roots")"
  scope_rc="${scope_check%%|*}"
  if [ "$scope_rc" = "2" ]; then
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "mcp",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: null,
        content_fingerprint: "sha256:missing",
        read_status: "unsupported", read_error: "link_out_of_scope",
        is_generated_copy: false, generated_of: null, link_target: null,
        servers: [], credentials: [], suspects: [],
        last_seen_batch: $batch_id
      }'
    return 0
  fi

  # 符号链接：跟随到真实内容
  if [ -L "$mcp_file" ]; then
    local link_result link_rc link_real
    link_result="$(intake_safe_resolve_link "$mcp_file" "$allowed_roots")"
    link_rc="${link_result%%|*}"
    link_real="${link_result#*|}"
    case $link_rc in
      0)
        mcp_file="$link_real"
        ;;
      1)
        jq -nc \
          --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
          --arg scope "$scope" --arg path "$rel_path" \
          --arg err "${link_real:-link_error}" \
          --arg batch_id "${INTAKE_BATCH_ID:-}" \
          '{
            occurrence_id: $id, asset_type: "mcp",
            source_root: $source_root, tool: $tool, scope: $scope,
            path: $path, original_name: null,
            content_fingerprint: "sha256:missing",
            read_status: "unreadable", read_error: $err,
            is_generated_copy: false, generated_of: null, link_target: null,
            servers: [], credentials: [], suspects: [],
            last_seen_batch: $batch_id
          }'
        return 0
        ;;
      2)
        jq -nc \
          --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
          --arg scope "$scope" --arg path "$rel_path" \
          --arg err "${link_real:-link_out_of_scope}" \
          --arg batch_id "${INTAKE_BATCH_ID:-}" \
          '{
            occurrence_id: $id, asset_type: "mcp",
            source_root: $source_root, tool: $tool, scope: $scope,
            path: $path, original_name: null,
            content_fingerprint: "sha256:missing",
            read_status: "unsupported", read_error: $err,
            is_generated_copy: false, generated_of: null, link_target: null,
            servers: [], credentials: [], suspects: [],
            last_seen_batch: $batch_id
          }'
        return 0
        ;;
    esac
  fi

  if [ ! -f "$mcp_file" ]; then
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "mcp",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: null,
        content_fingerprint: "sha256:missing",
        read_status: "missing", read_error: null,
        is_generated_copy: false, generated_of: null, link_target: null,
        servers: [], credentials: [], suspects: [],
        last_seen_batch: $batch_id
      }'
    return 0
  fi

  if [ ! -r "$mcp_file" ]; then
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "mcp",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: null,
        content_fingerprint: "sha256:missing",
        read_status: "unreadable", read_error: "permission_denied",
        is_generated_copy: false, generated_of: null, link_target: null,
        servers: [], credentials: [], suspects: [],
        last_seen_batch: $batch_id
      }'
    return 0
  fi

  # 解析 MCP（复用 import-mcp.sh 的解析器）
  # 区分：合法空配置 / 解析失败 / 结构错误 / 格式不支持 / 无法读取
  local raw_json="" parse_ok="true" parse_error=""
  case "$tool" in
    codex)
      # parse_codex_mcp_json 内部 grep 可能无匹配（set -e 下会提前退出）
      # 临时关闭 set -e 保证解析器完整输出
      set +e
      raw_json="$(parse_codex_mcp_json "$mcp_file" 2>/dev/null)"
      set -e
      if [ -z "$raw_json" ]; then
        parse_ok="false"
        parse_error="toml_parse_failed"
      elif ! printf '%s' "$raw_json" | jq -e . >/dev/null 2>&1; then
        parse_ok="false"
        parse_error="toml_parse_failed"
      fi
      ;;
    canonical)
      # 规范源 mcp.json 使用 .servers 键（区别于工具侧 .mcpServers）
      if ! jq empty "$mcp_file" 2>/dev/null; then
        parse_ok="false"
        parse_error="invalid_json"
      else
        # 验证顶层对象与 servers 结构
        if ! jq -e 'type == "object"' "$mcp_file" >/dev/null 2>&1; then
          parse_ok="false"
          parse_error="invalid_top_level_type"
        elif jq -e '.servers != null and (.servers | type) != "object"' "$mcp_file" >/dev/null 2>&1; then
          parse_ok="false"
          parse_error="invalid_servers_type"
        else
          raw_json="$(jq -c '.servers // {}' "$mcp_file" 2>/dev/null)" || parse_ok="false"
          [ -n "$raw_json" ] || raw_json="{}"
        fi
      fi
      ;;
    claude|cursor|trae|manual)
      # 先检查是否为合法 JSON
      if ! jq empty "$mcp_file" 2>/dev/null; then
        parse_ok="false"
        parse_error="invalid_json"
        raw_json=""
      elif ! jq -e 'type == "object"' "$mcp_file" >/dev/null 2>&1; then
        parse_ok="false"
        parse_error="invalid_top_level_type"
        raw_json=""
      else
        raw_json="$(parse_json_mcp "$mcp_file" 2>/dev/null)" || parse_ok="false"
        # 验证 mcpServers 结构
        if [ "$parse_ok" = "true" ]; then
          if jq -e '.mcpServers == null' "$mcp_file" >/dev/null 2>&1; then
            # 无 mcpServers 键：检查是否为空对象（合法空配置）
            if jq -e 'type == "object" and length == 0' "$mcp_file" >/dev/null 2>&1; then
              raw_json="{}"
            else
              parse_ok="false"
              parse_error="missing_mcpServers_key"
            fi
          elif jq -e '(.mcpServers | type) != "object"' "$mcp_file" >/dev/null 2>&1; then
            parse_ok="false"
            parse_error="invalid_mcpServers_type"
          elif jq -e '.mcpServers | type == "array"' "$mcp_file" >/dev/null 2>&1; then
            parse_ok="false"
            parse_error="invalid_mcpServers_type"
          else
            raw_json="$(jq -c '.mcpServers // {}' "$mcp_file" 2>/dev/null)" || parse_ok="false"
            [ -n "$raw_json" ] || raw_json="{}"
          fi
        fi
      fi
      ;;
    *)
      # 不支持的格式
      jq -nc \
        --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
        --arg scope "$scope" --arg path "$rel_path" \
        --arg batch_id "${INTAKE_BATCH_ID:-}" \
        '{
          occurrence_id: $id, asset_type: "mcp",
          source_root: $source_root, tool: $tool, scope: $scope,
          path: $path, original_name: null,
          content_fingerprint: "sha256:missing",
          read_status: "unsupported", read_error: "unsupported_format",
          is_generated_copy: false, generated_of: null, link_target: null,
          servers: [], credentials: [], suspects: [],
          last_seen_batch: $batch_id
        }'
      return 0
      ;;
  esac

  # 解析失败：不伪装为成功
  if [ "$parse_ok" != "true" ]; then
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" \
      --arg err "${parse_error:-parse_failed}" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "mcp",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: null,
        content_fingerprint: "sha256:missing",
        read_status: "parse_error", read_error: $err,
        is_generated_copy: false, generated_of: null, link_target: null,
        servers: [], credentials: [], suspects: [],
        last_seen_batch: $batch_id
      }'
    return 0
  fi

  if [ -z "$raw_json" ] || [ "$raw_json" = "null" ]; then
    raw_json="{}"
  fi

  # 验证 server 配置结构：每个 server 必须是对象
  local struct_valid="true" struct_error=""
  if ! printf '%s' "$raw_json" | jq -e 'type == "object"' >/dev/null 2>&1; then
    struct_valid="false"
    struct_error="servers_not_object"
  elif printf '%s' "$raw_json" | jq -e '[.[] | select(type != "object")] | length > 0' >/dev/null 2>&1; then
    struct_valid="false"
    struct_error="server_config_not_object"
  fi

  if [ "$struct_valid" != "true" ]; then
    jq -nc \
      --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
      --arg scope "$scope" --arg path "$rel_path" \
      --arg err "$struct_error" \
      --arg batch_id "${INTAKE_BATCH_ID:-}" \
      '{
        occurrence_id: $id, asset_type: "mcp",
        source_root: $source_root, tool: $tool, scope: $scope,
        path: $path, original_name: null,
        content_fingerprint: "sha256:missing",
        read_status: "parse_error", read_error: $err,
        is_generated_copy: false, generated_of: null, link_target: null,
        servers: [], credentials: [], suspects: [],
        last_seen_batch: $batch_id
      }'
    return 0
  fi

  # 逐 server 分离凭据
  local servers_clean="[]" all_creds="[]" all_suspects="[]"
  local server_names
  server_names="$(printf '%s' "$raw_json" | jq -r 'keys[]?' 2>/dev/null)"

  local name
  for name in $server_names; do
    local server_json stripped
    server_json="$(printf '%s' "$raw_json" | jq -c --arg n "$name" '.[$n] // {}')"
    stripped="$(intake_strip_credentials "$server_json")"

    local san creds sus
    san="$(printf '%s' "$stripped" | jq -c '.sanitized // {}')"
    creds="$(printf '%s' "$stripped" | jq -c '.credentials // []')"
    sus="$(printf '%s' "$stripped" | jq -c '.suspects // []')"

    servers_clean="$(printf '%s' "$servers_clean" | jq -c --arg n "$name" --argjson s "$san" '. + [{name: $n, config: $s}]')"
    all_creds="$(printf '%s' "$all_creds" | jq -c --arg n "$name" --argjson c "$creds" '. + ($c | map(. + {server: $n}))')"
    all_suspects="$(printf '%s' "$all_suspects" | jq -c --arg n "$name" --argjson s "$sus" '. + ($s | map(. + {server: $n}))')"
  done

  # 指纹用脱敏 JSON
  local fp
  fp="$(intake_redact_for_fingerprint "$raw_json" | intake_sha256 -)"

  jq -nc \
    --arg id "$occ_id" --arg source_root "$source_root" --arg tool "$tool" \
    --arg scope "$scope" --arg path "$rel_path" --arg fp "$fp" \
    --argjson servers "$servers_clean" \
    --argjson creds "$all_creds" \
    --argjson suspects "$all_suspects" \
    --arg batch_id "${INTAKE_BATCH_ID:-}" \
    '{
      occurrence_id: $id, asset_type: "mcp",
      source_root: $source_root, tool: $tool, scope: $scope,
      path: $path, original_name: null,
      content_fingerprint: ("sha256:" + $fp),
      read_status: "ok", read_error: null,
      is_generated_copy: false, generated_of: null, link_target: null,
      servers: $servers,
      credentials: $creds,
      suspects: $suspects,
      last_seen_batch: $batch_id
    }'
}

# 扫描某 tool 的 MCP
intake_scan_mcp_tool() {
  local source_root="$1" tool="$2" scope="$3" allowed_roots="$4"
  local mcp_path
  mcp_path="$(intake_tool_mcp_path "$tool" "$source_root" "$scope")"
  [ -n "$mcp_path" ] || return 0
  intake_scan_mcp "$source_root" "$tool" "$scope" "$mcp_path" "$allowed_roots"
}

# ============================================================================
# 手动来源
# ============================================================================

# 手动文件 → 规则候选
# $1=filepath $2=allowed_roots
intake_scan_manual_file() {
  local filepath="$1" allowed_roots="$2"
  local source_root
  source_root="$(dirname "$filepath")"
  intake_scan_rule_file "$source_root" "manual" "manual" "$filepath" "$allowed_roots"
}

# 手动 Skill 目录
# $1=skill_dir $2=allowed_roots
intake_scan_manual_skill() {
  local skill_dir="$1" allowed_roots="$2"
  local source_root
  source_root="$(dirname "$skill_dir")"
  intake_scan_skill "$source_root" "manual" "manual" "$skill_dir" "$allowed_roots"
}

# ============================================================================
# 规范源扫描（.ai-workspace/rules、skills、mcp）
# 来源仅有规范源、没有工具生成副本时也应发现已有资产
# 扫描阶段不凭 managed 标记认定总库已拥有
# ============================================================================

# 扫描来源项目的规范源（.ai-workspace/ 下的 rules/skills/mcp）
# $1=source_root $2=allowed_roots
intake_scan_canonical() {
  local source_root="$1" allowed_roots="$2"
  local aiws_dir="${source_root}/.ai-workspace"

  [ -d "$aiws_dir" ] || return 0

  # 规范源规则：rules/*.md + rules/domains/*.md
  local f
  for f in "${aiws_dir}"/rules/*.md "${aiws_dir}"/rules/domains/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "CHANGELOG.md" ] && continue
    intake_scan_rule_file "$source_root" "canonical" "project" "$f" "$allowed_roots"
  done

  # 规范源 Skills：skills/*/
  if [ -d "${aiws_dir}/skills" ]; then
    local d
    for d in "${aiws_dir}"/skills/*; do
      [ -d "$d" ] || [ -L "$d" ] || continue
      intake_scan_skill "$source_root" "canonical" "project" "$d" "$allowed_roots"
    done
  fi

  # 规范源 MCP：mcp/mcp.json
  if [ -f "${aiws_dir}/mcp/mcp.json" ]; then
    intake_scan_mcp "$source_root" "canonical" "project" "${aiws_dir}/mcp/mcp.json" "$allowed_roots"
  fi
}

# ============================================================================
# 主入口
# ============================================================================

# Usage: intake_scan
# 环境/参数由调用方设置：
#   INTAKE_REPO       总库路径
#   INTAKE_SOURCES    来源列表，每行: source_root|tool|scope
#                     tool=auto 表示扫描全部四工具；tool=all-sources 表示项目内四工具
#   INTAKE_MANUAL_FILES  手动文件路径（换行分隔，支持含空格路径）
#   INTAKE_MANUAL_SKILLS 手动 Skill 目录（换行分隔，支持含空格路径）
#   INTAKE_BATCH_ID   批次 ID
#   INTAKE_CANCEL_FILE 取消文件路径（可选）
#   INTAKE_OUT_DIR    输出目录
# 输出: ScanBatch JSON 到 stdout
intake_scan() {
  local repo="${INTAKE_REPO:-}"
  local batch_id="${INTAKE_BATCH_ID:-$(intake_new_batch_id)}"
  INTAKE_BATCH_ID="$batch_id"
  export INTAKE_BATCH_ID

  local started_at
  started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')"

  if [ -z "$repo" ]; then
    die "intake scan: 必须指定 --repo（总库路径）"
  fi

  # allowed_roots = repo + 所有 source_root + 全局来源的实际工具路径（不把整个 HOME 纳入）
  local allowed_roots="${repo}"
  local src_line src_root src_tool src_scope
  while IFS= read -r src_line; do
    [ -n "$src_line" ] || continue
    src_root="${src_line%%|*}"
    local srest
    srest="${src_line#*|}"
    src_tool="${srest%%|*}"
    src_scope="${srest#*|}"
    allowed_roots="${allowed_roots}:${src_root}"
    # 全局来源只授权实际选定的工具路径，不授权整个 HOME
    if [ "$src_scope" = "global" ]; then
      local gtool
      if [ "$src_tool" = "auto" ] || [ "$src_tool" = "all" ]; then
        for gtool in $SUPPORTED_TOOLS; do
          local gp
          gp="$(intake_tool_rules_path "$gtool" "" "global")"
          [ -n "$gp" ] && allowed_roots="${allowed_roots}:${gp}"
          gp="$(intake_tool_skills_path "$gtool" "" "global")"
          [ -n "$gp" ] && allowed_roots="${allowed_roots}:${gp}"
          gp="$(intake_tool_mcp_path "$gtool" "" "global")"
          [ -n "$gp" ] && allowed_roots="${allowed_roots}:${gp}"
        done
      else
        local gp
        gp="$(intake_tool_rules_path "$src_tool" "" "global")"
        [ -n "$gp" ] && allowed_roots="${allowed_roots}:${gp}"
        gp="$(intake_tool_skills_path "$src_tool" "" "global")"
        [ -n "$gp" ] && allowed_roots="${allowed_roots}:${gp}"
        gp="$(intake_tool_mcp_path "$src_tool" "" "global")"
        [ -n "$gp" ] && allowed_roots="${allowed_roots}:${gp}"
      fi
    fi
  done << EOF
${INTAKE_SOURCES:-}
EOF

  # 手动来源显式纳入范围（换行分隔，不按空白拆分）
  local mf_item
  while IFS= read -r mf_item; do
    [ -n "$mf_item" ] || continue
    allowed_roots="${allowed_roots}:$(dirname "$mf_item")"
  done << EOF
${INTAKE_MANUAL_FILES:-}
EOF
  while IFS= read -r mf_item; do
    [ -n "$mf_item" ] || continue
    allowed_roots="${allowed_roots}:${mf_item}"
  done << EOF
${INTAKE_MANUAL_SKILLS:-}
EOF

  intake_progress "开始扫描 batch=${batch_id}" 0

  # 收集来源列表 → sources[]
  local sources_json="[]"
  local occurrences_file
  occurrences_file="$(mktemp "${TMPDIR:-/tmp}/aiws-intake-occ.XXXXXX")"
  errors_file="$(mktemp "${TMPDIR:-/tmp}/aiws-intake-err.XXXXXX")"
  : > "$occurrences_file"
  : > "$errors_file"

  # ---- 扫描来源 ----
  local scanned_count=0
  while IFS= read -r src_line; do
    [ -n "$src_line" ] || continue

    intake_check_cancel && {
      break
    }

    src_root="${src_line%%|*}"
    local rest tool scope
    rest="${src_line#*|}"
    tool="${rest%%|*}"
    scope="${rest#*|}"

    local src_status="ok"
    if [ ! -d "$src_root" ]; then
      src_status="missing"
      printf '{"level":"warn","source":%s,"path":null,"message":"source_root_not_found"}\n' \
        "$(printf '%s' "$src_root" | jq -Rs .)" >> "$errors_file"
    fi

    # 确定要扫的工具列表
    local tools_to_scan=""
    if [ "$tool" = "auto" ] || [ "$tool" = "all" ]; then
      tools_to_scan="$SUPPORTED_TOOLS"
    else
      tools_to_scan="$tool"
    fi

    local t
    for t in $tools_to_scan; do
      is_supported_tool "$t" || continue

      intake_check_cancel && break

      intake_progress "扫描 ${t} (${scope}) @ ${src_root}" 30

      # Rules
      intake_scan_rules "$src_root" "$t" "$scope" "$allowed_roots" >> "$occurrences_file" 2>>"$errors_file"

      # Skills
      intake_scan_skills "$src_root" "$t" "$scope" "$allowed_roots" >> "$occurrences_file" 2>>"$errors_file"

      # MCP
      intake_scan_mcp_tool "$src_root" "$t" "$scope" "$allowed_roots" >> "$occurrences_file" 2>>"$errors_file"
    done

    # 规范源扫描（.ai-workspace/rules、skills、mcp）
    intake_check_cancel || intake_scan_canonical "$src_root" "$allowed_roots" >> "$occurrences_file" 2>>"$errors_file"

    sources_json="$(printf '%s' "$sources_json" | jq -c \
      --arg root "$src_root" --arg tool "$tool" --arg scope "$scope" \
      --arg status "$src_status" \
      '. + [{source_root: $root, tool: $tool, scope: $scope, status: $status}]')"

    scanned_count=$((scanned_count + 1))
  done << EOF
${INTAKE_SOURCES:-}
EOF

  # ---- 手动来源（换行分隔，支持含空格路径）----
  local mf
  while IFS= read -r mf; do
    [ -n "$mf" ] || continue
    intake_check_cancel && break
    intake_progress "扫描手动文件 ${mf}" 70
    intake_scan_manual_file "$mf" "$allowed_roots" >> "$occurrences_file" 2>>"$errors_file"
    sources_json="$(printf '%s' "$sources_json" | jq -c \
      --arg root "$(dirname "$mf")" --arg tool "manual" --arg scope "manual" \
      --arg status "ok" \
      '. + [{source_root: $root, tool: $tool, scope: $scope, status: $status}]')"
  done << EOF
${INTAKE_MANUAL_FILES:-}
EOF

  local ms
  while IFS= read -r ms; do
    [ -n "$ms" ] || continue
    intake_check_cancel && break
    intake_progress "扫描手动 Skill ${ms}" 80
    intake_scan_manual_skill "$ms" "$allowed_roots" >> "$occurrences_file" 2>>"$errors_file"
    sources_json="$(printf '%s' "$sources_json" | jq -c \
      --arg root "$(dirname "$ms")" --arg tool "manual" --arg scope "manual" \
      --arg status "ok" \
      '. + [{source_root: $root, tool: $tool, scope: $scope, status: $status}]')"
  done << EOF
${INTAKE_MANUAL_SKILLS:-}
EOF

  intake_progress "汇总结果" 90

  local cancelled="false"
  intake_check_cancel && cancelled="true"

  local finished_at
  finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')"

  # 组装最终 JSON
  local occurrences_json errors_json
  occurrences_json="$(jq -s '.' "$occurrences_file" 2>/dev/null || echo '[]')"
  errors_json="$(jq -s '.' "$errors_file" 2>/dev/null || echo '[]')"

  rm -f "$occurrences_file" "$errors_file"

  jq -nc \
    --arg schema "intake/v1" \
    --arg batch_id "$batch_id" \
    --arg repo "$repo" \
    --arg started "$started_at" \
    --arg finished "$finished_at" \
    --argjson sources "$sources_json" \
    --argjson occurrences "$occurrences_json" \
    --argjson errors "$errors_json" \
    --argjson cancelled "$cancelled" \
    '{
      schema: $schema,
      batch_id: $batch_id,
      repo: $repo,
      started_at: $started,
      finished_at: $finished,
      sources: $sources,
      occurrences: $occurrences,
      errors: $errors,
      cancelled: $cancelled
    }'

  intake_progress "扫描完成" 100
}
