#!/bin/sh
# sync-describe.sh - `aiws sync --describe-inputs` 只读输入枚举引擎
# Source from aiws cmd_sync（AIWS_DESCRIBE=1）。依据 docs/specs/002-sync-status/design.md §3.2/§3.3：
# 复用各模块同一筛选谓词，不执行分发、不解密 vault、不创建 manifest 或成功记录；
# stdout 只输出一份 schema v1 JSON（日志已改道 stderr）。

# ============================================================================
# Helpers
# ============================================================================

describe_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "describe-inputs: 缺少 sha256sum/shasum"
  fi
}

describe_sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    die "describe-inputs: 缺少 sha256sum/shasum"
  fi
}

# jq 不可用时仍返回合法 JSON（固定字面量，无动态内容），退出码 0。
describe_emit_dependency_missing() {
  printf '{"schemaVersion":1,"unit":{"tool":"%s","module":"%s","scope":"%s"},"executable":false,"reasonCode":"dependency_missing","inputs":[],"deps":[]}\n' \
    "$1" "$2" "$3"
}

# 绝对路径必须位于 AIWS_DIR 之内；返回相对 AIWS_DIR 的路径。
# 两侧都经 realpath：/tmp→/private/tmp 一类别名不误判越界。
describe_rel_to_aiws() {
  local abs_real base_real
  abs_real="$(realpath "$1")" || die "describe-inputs: 路径不可读：$1"
  base_real="$(realpath "${AIWS_DIR}")" || die "describe-inputs: 内容库不可读：${AIWS_DIR}"
  case "$abs_real" in
    "${base_real}"/*) printf '%s\n' "${abs_real#"${base_real}"/}" ;;
    *) die "describe-inputs: 路径越出内容库：$1" ;;
  esac
}

# 输出 JSON 主体：inputs 行（path|type|selector）、deps 行、outputs 行（绝对输出路径）、
# 可选 mcp/skills 片段。inputs/deps/outputs 为行缓冲文件路径。
describe_emit_doc() {
  local tool="$1" module="$2" scope="$3" executable="$4" reason="$5"
  local inputs_file="$6" deps_file="$7"
  local mcp_json="${8:-null}" skills_json="${9:-null}"
  local outputs_file="${10:-}"

  local inputs_json deps_json outputs_json
  inputs_json="$(jq -R -s 'split("\n") | map(select(length>0) | split("\t") |
    {path: .[0], type: .[1], selector: (if (.[2] // "") == "" then null else .[2] end)})' "$inputs_file")"
  deps_json="$(jq -R -s 'split("\n") | map(select(length>0))' "$deps_file")"
  if [ -n "$outputs_file" ] && [ -f "$outputs_file" ]; then
    outputs_json="$(jq -R -s 'split("\n") | map(select(length>0))' "$outputs_file")"
  else
    outputs_json="[]"
  fi

  jq -nc \
    --arg tool "$tool" --arg module "$module" --arg scope "$scope" \
    --argjson executable "$executable" --arg reason "$reason" \
    --argjson inputs "$inputs_json" --argjson deps "$deps_json" --argjson outputs "$outputs_json" \
    --argjson mcp "$mcp_json" --argjson skills "$skills_json" \
    '{schemaVersion: 1,
      unit: {tool: $tool, module: $module, scope: $scope},
      executable: $executable,
      reasonCode: (if $reason == "" then null else $reason end),
      inputs: $inputs,
      deps: $deps,
      outputKeys: $outputs}
     + (if $mcp == null then {} else {mcp: $mcp} end)
     + (if $skills == null then {} else {skillsPlan: $skills} end)'
}

# ============================================================================
# Rules
# ============================================================================

# 与 generate_tool_file / generate_rule_files 相同的筛选谓词链：
# is_rule_file → rule_applies_to_tool →（cursor/trae）mapping required 非空。
describe_rules_deps() {
  local tool="$1"
  printf '%s\n' "aiws" "lib/common.sh" "lib/memory.sh" "lib/sync-describe.sh"
  case "$tool" in
    cursor|trae) printf '%s\n' "lib/rules-generate.sh" ;;
  esac
}

describe_rules_unit() {
  local tool="$1" scope="$2"
  local inputs_file deps_file
  inputs_file="$(mktemp)"
  deps_file="$(mktemp)"

  # design §2.1：Rules 仅 project；global 不伪造成功。
  if [ "$scope" != "project" ]; then
    describe_emit_doc "$tool" rules "$scope" false "tool_unsupported" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  local rule_file rel required tools_selector mapping rel_out
  if [ "$tool" = "cursor" ] || [ "$tool" = "trae" ]; then
    mapping="${AIWS_DIR}/adapters/${tool}/mapping.yaml"
    if [ ! -f "$mapping" ]; then
      describe_emit_doc "$tool" rules "$scope" false "mapping_missing" "$inputs_file" "$deps_file"
      rm -f "$inputs_file" "$deps_file"
      return 0
    fi
    # 赋值后显式失败：命令替换若嵌在 printf 参数里，die 的非零状态会被吞掉
    rel_out="$(describe_rel_to_aiws "$mapping")" || exit 1
    printf '%s\tmapping\n' "$rel_out" >> "$inputs_file"
  fi

  for rule_file in "${AIWS_DIR}"/rules/*.md "${AIWS_DIR}"/rules/domains/*.md; do
    [ -f "$rule_file" ] || continue
    is_rule_file "$rule_file" || continue
    rule_applies_to_tool "$rule_file" "$tool" || continue
    if is_domain_rule "$rule_file"; then
      rel="rules/domains/$(basename "$rule_file")"
    else
      rel="rules/$(basename "$rule_file")"
    fi
    if [ "$tool" = "cursor" ] || [ "$tool" = "trae" ]; then
      required="$(get_mapping_required "$mapping" "$rel")"
      [ -z "$required" ] && continue
    fi
    tools_selector="$(rule_tools "$rule_file" | tr ' ' ',')"
    printf '%s\trule\t%s\n' "$rel" "tools:${tools_selector:-all}" >> "$inputs_file"
  done

  # memory/context 注入（排除 TEMPLATE.md），与 memory_context_body 同源规则
  local ctx
  if [ -d "${AIWS_DIR}/memory/context" ]; then
    for ctx in "${AIWS_DIR}"/memory/context/*.md; do
      [ -f "$ctx" ] || continue
      [ "$(basename "$ctx")" = "TEMPLATE.md" ] && continue
      rel_out="$(describe_rel_to_aiws "$ctx")" || exit 1
      printf '%s\tmemory_context\n' "$rel_out" >> "$inputs_file"
    done
  fi

  # 有效行为配置（tools/default_scope/skills.enabled 等）保守纳入
  if [ -f "${AIWS_DIR}/config/workspace.json" ]; then
    printf '%s\tworkspace_config\n' "config/workspace.json" >> "$inputs_file"
  fi

  describe_rules_deps "$tool" > "$deps_file"

  local executable=true reason=""
  # mapping 行不算条目：只有规则/上下文存在才算有可分发内容
  if ! awk -F'\t' '$2 == "rule" || $2 == "memory_context" { found=1 } END { exit(found ? 0 : 1) }' "$inputs_file"; then
    executable=false
    reason="no_entries"
  fi

  local outputs_file
  outputs_file="$(mktemp)"
  if [ "$executable" = "true" ]; then
    get_tool_rules_path "$tool" > "$outputs_file"
  fi

  describe_emit_doc "$tool" rules "$scope" "$executable" "$reason" "$inputs_file" "$deps_file" "null" "null" "$outputs_file"
  rm -f "$inputs_file" "$deps_file" "$outputs_file"
}

# ============================================================================
# MCP
# ============================================================================

describe_mcp_unit() {
  local tool="$1" scope="$2"
  local inputs_file deps_file
  inputs_file="$(mktemp)"
  deps_file="$(mktemp)"

  if [ "$scope" = "global" ] && [ "$tool" = "trae" ]; then
    describe_emit_doc "$tool" mcp "$scope" false "tool_unsupported" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  local mcp_file="${AIWS_DIR}/mcp/mcp.json"
  if [ ! -f "$mcp_file" ]; then
    describe_emit_doc "$tool" mcp "$scope" false "no_entries" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  if ! jq empty "$mcp_file" 2>/dev/null; then
    rm -f "$inputs_file" "$deps_file"
    die "describe-inputs: Invalid JSON in mcp/mcp.json"
  fi

  printf '%s\tmcp_main\n' "mcp/mcp.json" >> "$inputs_file"

  # 合并与执行同源：merge_mcp_effective（mcp-sync.sh）——坏 local 静默回退主文件
  local local_file="${AIWS_DIR}/mcp/mcp.local.json"
  local override_order="mcp/mcp.json"
  local merged=""
  if [ -f "$local_file" ]; then
    merged="$(merge_mcp_effective "$mcp_file" "$local_file" || true)"
    if [ -n "$merged" ]; then
      printf '%s\tmcp_override\n' "mcp/mcp.local.json" >> "$inputs_file"
      override_order="mcp/mcp.json mcp/mcp.local.json"
    fi
  fi

  # 与替换相关的非敏感输入（不解密、不读正文）
  if [ -f "${AIWS_DIR}/secrets/permissions.yaml" ]; then
    printf '%s\tmcp_permissions\n' "secrets/permissions.yaml" >> "$inputs_file"
  fi
  if [ -f "${AIWS_DIR}/secrets/vault.enc" ]; then
    printf '%s\tmcp_vault\n' "secrets/vault.enc" >> "$inputs_file"
  fi
  if [ -f "${AIWS_DIR}/config/workspace.json" ]; then
    printf '%s\tworkspace_config\n' "config/workspace.json" >> "$inputs_file"
  fi

  # 已筛选 server 名称：与 sync 相同的 effective JSON + get_servers_for_scope
  local effective_file servers_json
  effective_file="$(mktemp)"
  if [ -n "$merged" ]; then
    printf '%s\n' "$merged" > "$effective_file"
  else
    cp "$mcp_file" "$effective_file"
  fi
  servers_json="$(get_servers_for_scope "$effective_file" "$scope" | jq -c 'keys | sort')"
  rm -f "$effective_file"

  local server_count
  server_count="$(printf '%s' "$servers_json" | jq 'length')"
  if [ "$server_count" = "0" ]; then
    describe_emit_doc "$tool" mcp "$scope" false "no_entries" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  {
    printf '%s\n' "aiws" "lib/common.sh" "lib/mcp-sync.sh" "lib/sync-describe.sh"
    [ -f "${AIWS_SCRIPTS_DIR}/lib/vault.sh" ] && printf '%s\n' "lib/vault.sh"
  } > "$deps_file"

  local main_json override_json mcp_json
  main_json="$(jq -nc --arg p "mcp/mcp.json" '$p')"
  override_json="$(jq -nc --arg p "$( [ -n "$merged" ] && echo "mcp/mcp.local.json" || echo "" )" \
    'if $p == "" then null else $p end')"
  mcp_json="$(jq -nc \
    --argjson main "$main_json" --argjson override "$override_json" \
    --arg order "$override_order" --argjson servers "$servers_json" \
    '{main: $main,
      override: $override,
      overrideOrder: ($order | split(" ")),
      servers: $servers}')"

  local executable=true reason=""
  local outputs_file
  outputs_file="$(mktemp)"
  get_tool_mcp_path "$tool" "$scope" > "$outputs_file"
  describe_emit_doc "$tool" mcp "$scope" "$executable" "$reason" "$inputs_file" "$deps_file" "$mcp_json" "null" "$outputs_file"
  rm -f "$inputs_file" "$deps_file" "$outputs_file"
}

# ============================================================================
# Skills
# ============================================================================

# 技能目录清单：每行 "<相对路径>|file|<sha256>|<x|->" 或 "<相对路径>|link|<链接值>|<sha256|->"。
# 链接按其有效内容哈希；断链记 "-"；越出内容库的链接视为不可表达，显式失败。
describe_skill_manifest() {
  local dir="$1" dir_real library_real rel abs target resolved list_file exec_flag
  dir_real="$(cd "$dir" && pwd -P)" || die "describe-inputs: 技能源不可读：${dir}"
  library_real="$(cd "${AIWS_DIR}" && pwd -P)"

  # find 结果先落盘再循环：管道子 shell 里的 die 无法终止主进程
  list_file="$(mktemp)"
  find "$dir_real" \( -type f -o -type l \) 2>/dev/null \
    | sed "s|^${dir_real}/||" \
    | sort > "$list_file"

  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    abs="${dir_real}/${rel}"
    if [ -L "$abs" ]; then
      target="$(readlink "$abs" 2>/dev/null || echo '?')"
      resolved="$(realpath "$abs" 2>/dev/null || true)"
      if [ -n "$resolved" ]; then
        case "$resolved" in
          "${library_real}"/*) ;;
          *) rm -f "$list_file"; die "describe-inputs: 技能内软链接越出内容库：${dir_real}/${rel} -> ${target}" ;;
        esac
        if [ -f "$resolved" ]; then
          printf '%s|link|%s|%s\n' "$rel" "$target" "$(describe_sha256_file "$resolved")"
        else
          printf '%s|link|%s|-\n' "$rel" "$target"
        fi
      else
        printf '%s|link|%s|-\n' "$rel" "$target"
      fi
    else
      exec_flag="-"
      [ -x "$abs" ] && exec_flag="x"
      printf '%s|file|%s|%s\n' "$rel" "$(describe_sha256_file "$abs")" "$exec_flag"
    fi
  done < "$list_file"
  rm -f "$list_file"
}

describe_skills_unit() {
  local tool="$1" scope="$2"
  local inputs_file deps_file
  inputs_file="$(mktemp)"
  deps_file="$(mktemp)"

  if ! is_module_enabled "skills"; then
    describe_emit_doc "$tool" skills "$scope" false "module_disabled" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  local skills_dir="${AIWS_DIR}/skills"
  local has_skills=0 skill_dir
  if [ -d "$skills_dir" ]; then
    for skill_dir in "${skills_dir}"/*/; do
      if [ -d "$skill_dir" ] && [ -f "${skill_dir}/SKILL.md" ]; then
        has_skills=1
        break
      fi
    done
  fi
  if [ "$has_skills" = "0" ]; then
    describe_emit_doc "$tool" skills "$scope" false "no_entries" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  local target_base
  target_base="$(get_tool_skills_path "$tool" "$scope")"
  if [ -z "$target_base" ]; then
    describe_emit_doc "$tool" skills "$scope" false "tool_unsupported" "$inputs_file" "$deps_file"
    rm -f "$inputs_file" "$deps_file"
    return 0
  fi

  local strategy
  strategy="$(get_link_type)"

  local entries_file entry manifest source_version skill_name target_path source_path
  entries_file="$(mktemp)"
  for skill_dir in "${skills_dir}"/*/; do
    [ -d "$skill_dir" ] || continue
    [ -f "${skill_dir}/SKILL.md" ] || continue
    skill_name="$(basename "$skill_dir")"
    source_path="$(cd "$skill_dir" && pwd -P)"
    target_path="${target_base}/${skill_name}"
    manifest="$(describe_skill_manifest "$skill_dir")"
    source_version="$(printf '%s' "$manifest" | describe_sha256_stdin)"
    jq -nc \
      --arg rel "$skill_name" \
      --arg target "$target_path" \
      --arg source "$source_path" \
      --arg sv "$source_version" \
      --arg strategy "$strategy" \
      --arg manifest "$manifest" \
      '{relativePath: $rel,
        targetPath: $target,
        sourcePath: $source,
        sourceVersion: $sv,
        strategy: $strategy,
        manifest: ($manifest | split("\n") | map(select(length>0)))}' >> "$entries_file"
  done

  if [ -f "${AIWS_DIR}/config/workspace.json" ]; then
    printf '%s\tworkspace_config\n' "config/workspace.json" >> "$inputs_file"
  fi

  {
    printf '%s\n' "aiws" "lib/common.sh" "lib/platform.sh" "lib/skills-link.sh" "lib/sync-describe.sh"
  } > "$deps_file"

  local skills_json entries_combined outputs_file
  entries_combined="$(jq -s '.' "$entries_file")"
  skills_json="$(jq -nc \
    --arg target_base "$target_base" --arg strategy "$strategy" \
    --argjson entries "$entries_combined" \
    '{outputKeys: [$target_base], entries: $entries, behavior: {linkType: $strategy}}')"
  outputs_file="$(mktemp)"
  printf '%s\n' "$target_base" > "$outputs_file"

  local executable=true reason=""
  describe_emit_doc "$tool" skills "$scope" "$executable" "$reason" "$inputs_file" "$deps_file" "null" "$skills_json" "$outputs_file"
  rm -f "$inputs_file" "$deps_file" "$entries_file" "$outputs_file"
}

# ============================================================================
# Entry
# ============================================================================

describe_inputs_main() {
  local tool="$1" module="$2" scope="$3"

  case "$tool" in
    codex|claude|cursor|trae) ;;
    *) die "describe-inputs: 不支持的工具：${tool}" ;;
  esac
  case "$module" in
    rules|mcp|skills) ;;
    *) die "describe-inputs: 不支持的模块：${module}" ;;
  esac
  case "$scope" in
    project|global) ;;
    *) die "describe-inputs: 不支持的 scope：${scope}" ;;
  esac

  if ! has_jq; then
    describe_emit_dependency_missing "$tool" "$module" "$scope"
    return 0
  fi

  case "$module" in
    rules)  describe_rules_unit "$tool" "$scope" ;;
    mcp)    describe_mcp_unit "$tool" "$scope" ;;
    skills) describe_skills_unit "$tool" "$scope" ;;
  esac
}
