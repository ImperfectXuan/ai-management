#!/bin/sh
# intake/stage.sh - 审核计划的内容暂存、版本差异与 registry 更新计算
# 需先 source common.sh / import-mcp.sh / intake/identity.sh / intake/store.sh
#
# 本模块只做「预备写入」的计算与暂存，绝不直接修改总库规范源；
# 真正的提交由 apply.sh 的 commit 阶段完成（design 8.3）。
# 设计约束：
#   1. 凭据值绝不写入共享资产：MCP 入库要求凭据已是 ${secret:} 引用
#   2. add / variant 不得覆盖既有规范源文件
#   3. 总库既有资产在首次入库时登记为初始版本（spec 5.5）

# 目标既有资产的规范源路径：优先 registry，其次计划时的既有来源
intake_apply_target_path() {
  local action="$1" repo="$2" tid p
  tid="$(printf '%s' "$action" | jq -r '.target_asset_id // ""')"
  p="$(intake_registry_read "$repo" | jq -r --arg t "$tid" '.assets[$t].canonical_path // ""')"
  if [ -z "$p" ]; then
    p="$(printf '%s' "$action" | jq -r '.target_existing_source.path // ""')"
  fi
  # 来自 registry / 计划的目标路径同样不可信：越界一律视为无法解析目标
  if [ -n "$p" ] && ! intake_is_safe_rel_path "$p"; then
    printf ''
    return 0
  fi
  printf '%s' "$p"
}


# 把既有规范源内容快照到暂存区，用于「总库已有资产登记为初始版本」
# 输出备份内容指纹；无可备份内容时输出空
intake_apply_backfill_stage() {
  local type="$1" repo="$2" rel="$3" asset_id="$4" staging="$5" server_name="${6:-}"
  local src dest
  [ -n "$rel" ] || return 0
  src="$(intake_repo_abs_path "$repo" "$rel")" || return 0
  dest="${staging}/backfill/${asset_id}/content"
  rm -rf "${staging}/backfill/${asset_id}"

  case "$type" in
    rule)
      if [ ! -f "$src" ]; then return 0; fi
      mkdir -p "$dest"
      cp "$src" "$dest/$(basename "$rel")"
      ;;
    skill)
      if [ ! -d "$src" ]; then return 0; fi
      mkdir -p "$dest"
      cp -R "${src}/." "$dest/"
      ;;
    mcp)
      local one
      [ -n "$server_name" ] || return 0
      one="$(intake_mcp_read_servers canonical "${repo}/.ai-workspace/mcp/mcp.json" \
        | jq -c --arg n "$server_name" '.[$n] // null' 2>/dev/null)"
      if [ -z "$one" ] || [ "$one" = "null" ]; then return 0; fi
      mkdir -p "$dest"
      printf '%s\n' "$one" > "$dest/server.json"
      ;;
    *)
      return 0
      ;;
  esac

  mkdir -p "${staging}/backfill/${asset_id}"
  printf '%s' "$dest"
}

# 变体规范源后缀：由新资产 ID 派生，保证确定性且不与基线冲突
intake_apply_variant_suffix() {
  local action="$1"
  intake_asset_id "$(printf '%s' "$action" | jq -r '.asset_type')" \
    "$(printf '%s' "$action" | jq -r '.source_identity')" | sed 's/^asset-//' | cut -c1-6
}

# 预览与暂存共用的写入路径计算；ignore/defer 不写规范源。
intake_apply_write_path() {
  local action="$1" repo="$2" kind type name source
  kind="$(printf '%s' "$action" | jq -r '.kind')"
  type="$(printf '%s' "$action" | jq -r '.asset_type')"
  name="$(printf '%s' "$action" | jq -r '.asset_name')"
  case "$kind" in ignore|defer) return 0 ;; esac
  if [ "$type" = "mcp" ]; then
    printf '.ai-workspace/mcp/mcp.json'
    return 0
  fi
  case "$kind" in
    update|link) intake_apply_target_path "$action" "$repo"; return 0 ;;
  esac
  if [ "$type" = "rule" ]; then
    source="$(printf '%s' "$action" | jq -r '.source_paths[0].resolved_path // ""')"
    if [ -f "$source" ]; then
      local rule_id
      rule_id="$(intake_rule_frontmatter_id "$source")"
      [ -z "$rule_id" ] || name="$rule_id"
    fi
  fi
  intake_is_safe_segment "$name" || return 0
  if [ "$kind" = "variant" ]; then name="${name}-$(intake_apply_variant_suffix "$action")"; fi
  case "$type" in
    rule) printf '.ai-workspace/rules/domains/%s.md' "$name" ;;
    skill) printf '.ai-workspace/skills/%s' "$name" ;;
  esac
}

# 暂存规则内容
intake_apply_stage_rule() {
  local action="$1" repo="$2" staging="$3"
  local resolved kind rel rule_id abs before_fp
  resolved="$(printf '%s' "$action" | jq -r '.source_paths[0].resolved_path // ""')"
  kind="$(printf '%s' "$action" | jq -r '.kind')"

  if [ ! -f "$resolved" ]; then
    jq -nc '{error: "source_unreadable"}'
    return 0
  fi

  rule_id="$(intake_rule_frontmatter_id "$resolved")"
  [ -n "$rule_id" ] || rule_id="$(printf '%s' "$action" | jq -r '.asset_name')"
  # 规则 id 直接决定规范源文件名：含路径分隔符或 .. 段一律拒绝，防止写到总库之外
  if ! intake_is_safe_segment "$rule_id"; then
    jq -nc --arg r "$rule_id" '{error: ("unsafe_asset_name:" + $r)}'
    return 0
  fi

  # 已识别凭据不得进入共享资产（spec 5.4）：人工确认不能绕过
  local findings
  findings="$(intake_credential_gate_findings rule "$resolved")"
  if [ "$(printf '%s' "$findings" | jq 'length' 2>/dev/null || echo 0)" != "0" ]; then
    jq -nc --arg e "$(intake_credential_gate_error "$findings")" '{error: $e}'
    return 0
  fi

  rel="$(intake_apply_write_path "$action" "$repo")"

  if [ -z "$rel" ]; then
    jq -nc '{error: "target_unresolved"}'
    return 0
  fi

  abs="$(intake_repo_abs_path "$repo" "$rel")" || {
    jq -nc --arg r "$rel" '{error: ("unsafe_target_path:" + $r)}'
    return 0
  }
  before_fp="$(intake_fingerprint_path "$abs")"
  if [ "$kind" != "update" ] && [ -e "$abs" ]; then
    # 同名同内容视为已写入（续跑或重复执行），内容不同才拒绝覆盖
    if [ "$(intake_sha256 "$abs")" != "$(intake_sha256 "$resolved")" ]; then
      jq -nc --arg r "$rel" '{error: ("canonical_path_exists:" + $r)}'
      return 0
    fi
  fi

  mkdir -p "$(dirname "${staging}/${rel}")"
  cp "$resolved" "${staging}/${rel}"

  jq -nc --arg rel "$rel" --arg aid "$(printf '%s' "$action" | jq -r '.action_id')" \
    --arg fp "$(intake_sha256 "$resolved")" --arg rid "$rule_id" --arg before "$before_fp" \
    --argjson a "$action" \
    '{op: "write_file", rel: $rel, action_id: $aid, after_fingerprint: $fp,
      target_before_fingerprint: (if $before == "" then null else $before end),
      rule_id: $rid, asset_type: $a.asset_type, asset_name: $a.asset_name}'
}

# 暂存 Skill 目录（整目录为单位）
intake_apply_stage_skill() {
  local action="$1" repo="$2" staging="$3"
  local resolved kind name rel abs before_fp
  resolved="$(printf '%s' "$action" | jq -r '.source_paths[0].resolved_path // ""')"
  kind="$(printf '%s' "$action" | jq -r '.kind')"
  name="$(printf '%s' "$action" | jq -r '.asset_name')"

  if [ ! -d "$resolved" ]; then
    jq -nc '{error: "source_unreadable"}'
    return 0
  fi

  # Skill 名称决定规范源目录名：含路径分隔符或 .. 段一律拒绝
  if ! intake_is_safe_segment "$name"; then
    jq -nc --arg n "$name" '{error: ("unsafe_asset_name:" + $n)}'
    return 0
  fi

  # 附属文件（脚本等）里的明文凭据同样不得进入共享资产
  local findings
  findings="$(intake_credential_gate_findings skill "$resolved")"
  if [ "$(printf '%s' "$findings" | jq 'length' 2>/dev/null || echo 0)" != "0" ]; then
    jq -nc --arg e "$(intake_credential_gate_error "$findings")" '{error: $e}'
    return 0
  fi

  rel="$(intake_apply_write_path "$action" "$repo")"

  if [ -z "$rel" ]; then
    jq -nc '{error: "target_unresolved"}'
    return 0
  fi

  abs="$(intake_repo_abs_path "$repo" "$rel")" || {
    jq -nc --arg r "$rel" '{error: ("unsafe_target_path:" + $r)}'
    return 0
  }
  before_fp="$(intake_fingerprint_path "$abs")"
  if [ -L "$abs" ]; then
    jq -nc --arg r "$rel" '{error: ("canonical_is_symlink:" + $r)}'
    return 0
  fi
  if [ "$kind" != "update" ] && [ -e "$abs" ]; then
    if [ "$(intake_fingerprint_skill_dir "$abs")" != "$(intake_fingerprint_skill_dir "$resolved")" ]; then
      jq -nc --arg r "$rel" '{error: ("canonical_path_exists:" + $r)}'
      return 0
    fi
  fi

  mkdir -p "${staging}/${rel}"
  cp -R "${resolved}/." "${staging}/${rel}/"

  jq -nc --arg rel "$rel" --arg aid "$(printf '%s' "$action" | jq -r '.action_id')" \
    --arg fp "$(intake_fingerprint_skill_dir "${staging}/${rel}")" --arg before "$before_fp" \
    --argjson a "$action" \
    '{op: "replace_dir", rel: $rel, action_id: $aid, after_fingerprint: $fp,
      target_before_fingerprint: (if $before == "" then null else $before end),
      asset_type: $a.asset_type, asset_name: $a.asset_name}'
}

intake_apply_stage_action() {
  local action="$1" repo="$2" staging="$3"
  case "$(printf '%s' "$action" | jq -r '.asset_type')" in
    rule)  intake_apply_stage_rule "$action" "$repo" "$staging" ;;
    skill) intake_apply_stage_skill "$action" "$repo" "$staging" ;;
    *)     jq -nc --arg e "unsupported_asset_type" '{error: $e}' ;;
  esac
}

# MCP 动作统一合并为一次 mcp.json 写入（spec 4：以单服务器配置为单位）
# 输出 {"op": {...}} 或 {"errors": [...]}
intake_apply_stage_mcp_all() {
  local plan="$1" repo="$2" staging="$3"
  local repo_mcp="${repo}/.ai-workspace/mcp/mcp.json"
  local servers="{}" errors="[]" action_ids="[]" names="[]"
  local n i

  n="$(printf '%s' "$plan" | jq '[.actions[] | select(.asset_type == "mcp")] | length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local a name resolved tool kind one bad
    a="$(printf '%s' "$plan" | jq -c --argjson i "$i" '[.actions[] | select(.asset_type == "mcp")][$i]')"
    kind="$(printf '%s' "$a" | jq -r '.kind')"
    name="$(printf '%s' "$a" | jq -r '.asset_name')"
    tool="$(printf '%s' "$a" | jq -r '.source_paths[0].tool // ""')"

    resolved="$(printf '%s' "$a" | jq -r '.source_paths[0].resolved_path // ""')"

    if [ "$kind" != "ignore" ] && [ "$kind" != "defer" ]; then
      if [ ! -f "$resolved" ]; then
        errors="$(printf '%s' "$errors" | jq -c --arg a "$(printf '%s' "$a" | jq -r '.action_id')" \
          '. + [{action_id: $a, error: "source_unreadable"}]')"
      elif ! intake_is_safe_segment "$name"; then
        # server 名会进入 staging 文件名与 mcp.json 键：含路径分隔符一律拒绝
        errors="$(printf '%s' "$errors" | jq -c --arg a "$(printf '%s' "$a" | jq -r '.action_id')" --arg n "$name" \
          '. + [{action_id: $a, error: ("unsafe_asset_name:" + $n)}]')"
      else
        one="$(intake_mcp_read_servers "$tool" "$resolved" | jq -c --arg n "$name" '.[$n] // null' 2>/dev/null)"
        if [ -z "$one" ] || [ "$one" = "null" ]; then
          errors="$(printf '%s' "$errors" | jq -c --arg a "$(printf '%s' "$a" | jq -r '.action_id')" \
            '. + [{action_id: $a, error: "server_not_found"}]')"
        else
          # 凭据值绝不写入共享资产（spec 5.4）：必须是 ${secret:} 引用
          bad="$(intake_mcp_split_server "$one" \
            | jq -r '[.cred_fields[] | select(.value != "" and ((.value | test("^\\$\\{secret:")) | not)) | .field] | join(",")')"
          if [ -n "$bad" ]; then
            errors="$(printf '%s' "$errors" | jq -c --arg a "$(printf '%s' "$a" | jq -r '.action_id')" \
              --arg b "$bad" '. + [{action_id: $a, error: ("credential_not_reference:" + $b)}]')"
          else
            servers="$(printf '%s' "$servers" | jq -c --arg n "$name" --argjson v "$one" '. + {($n): $v}')"
            names="$(printf '%s' "$names" | jq -c --arg n "$name" '. + [$n] | unique')"
            mkdir -p "${staging}/mcp-servers"
            printf '%s\n' "$one" > "${staging}/mcp-servers/${name}.json"
          fi
        fi
      fi
      action_ids="$(printf '%s' "$action_ids" | jq -c --arg a "$(printf '%s' "$a" | jq -r '.action_id')" '. + [$a]')"
    fi
    i=$((i + 1))
  done

  if [ "$(printf '%s' "$names" | jq 'length')" = "0" ]; then
    jq -nc --argjson e "$errors" '{ops: [], errors: $e}'
    return 0
  fi

  local current merged rel abs
  current="$(intake_mcp_read_servers canonical "$repo_mcp")"
  merged="$(jq -nc --argjson cur "$current" --argjson new "$servers" '$cur * $new')"
  rel=".ai-workspace/mcp/mcp.json"
  intake_repo_abs_path "$repo" "$rel" >/dev/null || {
    jq -nc --argjson e "$errors" '{ops: [], errors: ($e + [{action_id: null, error: "unsafe_target_path"}])}'
    return 0
  }

  mkdir -p "$(dirname "${staging}/${rel}")"
  printf '%s\n' "$(jq -nc --argjson s "$merged" '{servers: $s}')" > "${staging}/${rel}"

  local mcp_before
  mcp_before="$(intake_fingerprint_path "${repo}/${rel}")"
  jq -nc --arg rel "$rel" --argjson ids "$action_ids" --argjson names "$names" \
    --arg fp "$(intake_sha256 "${staging}/${rel}")" --arg before "$mcp_before" \
    '{ops: [{op: "write_file", rel: $rel, action_ids: $ids, names: $names,
             after_fingerprint: $fp,
             target_before_fingerprint: (if $before == "" then null else $before end),
             asset_type: "mcp"}], errors: []}'
}

# 备份内容（回退用）的身份：规则/技能 = 内容指纹；mcp = "行为|凭据"
intake_apply_content_identity() {
  local type="$1" content_dir="$2" name="$3"

  case "$type" in
    mcp)
      local one ident
      one="$(jq -c '.' "${content_dir}/server.json" 2>/dev/null)"
      if [ -z "$one" ]; then printf ''; return 0; fi
      ident="$(intake_mcp_server_identity "$one")"
      printf '%s|%s' "$(printf '%s' "$ident" | jq -r '.behavior_fingerprint')" \
                     "$(printf '%s' "$ident" | jq -r '.cred_fingerprint')"
      ;;
    skill)
      printf 'sha256:%s' "$(intake_fingerprint_skill_dir "$content_dir")"
      ;;
    *)
      # 单文件规则：content/ 下取唯一文件的内容哈希
      local f
      f="$(find "$content_dir" -maxdepth 1 -type f 2>/dev/null | head -n 1)"
      if [ -z "$f" ]; then printf ''; return 0; fi
      printf 'sha256:%s' "$(intake_sha256 "$f")"
      ;;
  esac
}

# 准备版本内容目录（布局与 backfill 一致：content/ 下放真实内容）
# $1=type $2=staging $3=action_id $4=源（rule/skill 为暂存规范源，mcp 为 server JSON）
# 输出版本内容目录路径
intake_apply_version_content() {
  local type="$1" staging="$2" action_id="$3" src="$4"
  local dest="${staging}/versions/${action_id}/content"
  rm -rf "${staging}/versions/${action_id}"
  mkdir -p "$dest"

  case "$type" in
    skill) cp -R "${src}/." "$dest/" ;;
    mcp)   cp "$src" "${dest}/server.json" ;;
    *)     cp "$src" "$dest/$(basename "$src")" ;;
  esac
  printf '%s' "$dest"
}

# 为单个写入动作计算 registry 更新与版本写入
# 输出 {"update": {...}|null, "version_writes": [...], "errors": [...]}
intake_apply_registry_update() {
  local action="$1" repo="$2" staging="$3" registry="$4" apply_id="$5" ops="$6"
  # $7 = 本批次上一轮已经写过的总库相对路径：这些路径是我们自己写的，
  # 续跑时不能再当成"总库既有资产"补初始版本，否则会凭空多出一个版本
  local committed="${7:-[]}"
  local skip_backfill="false"
  local kind type aid name identity asset_id canonical at
  kind="$(printf '%s' "$action" | jq -r '.kind')"
  type="$(printf '%s' "$action" | jq -r '.asset_type')"
  aid="$(printf '%s' "$action" | jq -r '.action_id')"
  name="$(printf '%s' "$action" | jq -r '.asset_name')"
  identity="$(printf '%s' "$action" | jq -r '.source_identity')"
  at="$(intake_now)"

  case "$kind" in
    add|variant) asset_id="$(intake_asset_id "$type" "$identity")" ;;
    *)           asset_id="$(printf '%s' "$action" | jq -r '.target_asset_id // ""')" ;;
  esac
  if [ -z "$asset_id" ]; then
    jq -nc '{update: null, version_writes: [], errors: ["asset_id_unresolved"]}'
    return 0
  fi

  canonical="$(printf '%s' "$ops" | jq -r --arg a "$aid" \
    '[.[] | select((.action_id // "") == $a or (((.action_ids // []) | index($a)) != null))][0].rel // ""')"
  [ -n "$canonical" ] || canonical="$(intake_apply_target_path "$action" "$repo")"
  if [ -z "$canonical" ] || ! intake_is_safe_rel_path "$canonical"; then
    jq -nc '{update: null, version_writes: [], errors: ["canonical_unresolved"]}'
    return 0
  fi

  local reg_asset cur cur_identity
  reg_asset="$(printf '%s' "$registry" | jq -c --arg t "$asset_id" '.assets[$t] // null')"
  cur="$(printf '%s' "$reg_asset" | jq -r 'if . == null then 0 else .current_version end')"
  cur_identity="$(printf '%s' "$reg_asset" | jq -r 'if . == null then "" else ((.versions // [])[-1].identity // "") end')"

  local vwrites="[]" backfill_count=0
  if [ "$(printf '%s' "$committed" | jq --arg r "$canonical" 'index($r) != null' 2>/dev/null)" = "true" ]; then
    skip_backfill="true"
  fi
  if [ "$cur" = "0" ] && [ "$skip_backfill" = "false" ]; then
    local bf_src bf_ident
    bf_src="$(intake_apply_backfill_stage "$type" "$repo" "$canonical" "$asset_id" "$staging" "$name")"
    if [ -n "$bf_src" ]; then
      bf_ident="$(intake_apply_content_identity "$type" "$bf_src" "$name")"
      if [ -n "$bf_ident" ]; then
        vwrites="$(printf '%s' "$vwrites" | jq -c --arg src "$bf_src" --arg i "$bf_ident" \
          --arg at "$at" --arg ap "$apply_id" --arg aid "$asset_id" \
          '. + [{asset_id: $aid, version: 1, identity: $i, content_src: $src, kind: "backfill",
                 created_at: $at, apply_id: $ap}]')"
        backfill_count=1
      fi
    fi
  fi

  local want_version="true"
  if [ "$kind" = "link" ]; then want_version="false"; fi
  if [ -n "$cur_identity" ] && [ "$cur_identity" = "$identity" ]; then want_version="false"; fi

  local next_version
  next_version=$((cur + backfill_count))
  if [ "$want_version" = "true" ]; then
    next_version=$((next_version + 1))
    local raw_src vsrc
    if [ "$type" = "mcp" ]; then
      raw_src="${staging}/mcp-servers/${name}.json"
    else
      raw_src="${staging}/${canonical}"
    fi
    # 暂存内容必须真实存在且类型正确：目录不是文件、空 rel 也不能当成"已暂存"
    if [ "$type" = "skill" ]; then
      [ -d "$raw_src" ] || { jq -nc '{update: null, version_writes: [], errors: ["staged_content_missing"]}'; return 0; }
    else
      [ -f "$raw_src" ] || { jq -nc '{update: null, version_writes: [], errors: ["staged_content_missing"]}'; return 0; }
    fi
    vsrc="$(intake_apply_version_content "$type" "$staging" "$aid" "$raw_src")"
    vwrites="$(printf '%s' "$vwrites" | jq -c --arg src "$vsrc" --arg i "$identity" \
      --arg at "$at" --arg ap "$apply_id" --argjson v "$next_version" --arg aid "$asset_id" \
      '. + [{asset_id: $aid, version: $v, identity: $i, content_src: $src, kind: "new",
             created_at: $at, apply_id: $ap}]')"
  fi

  # 版本记录（registry 内）
  local versions
  versions="$(printf '%s' "$vwrites" | jq -c --arg type "$type" '
    map({version: .version, identity: .identity, kind: .kind,
         fingerprint: (if $type == "mcp" then (.identity | split("|")[0]) else .identity end),
         created_at: .created_at, apply_id: .apply_id})')"

  # 来源关系
  local sources
  sources="$(printf '%s' "$action" | jq -c --arg id "$identity" '
    [ (.source_occurrences // []) as $occs
      | (range(0; ($occs | length))) as $i
      | {occurrence_id: $occs[$i],
         source_root: (.source_paths[$i].source_root // null),
         tool: (.source_paths[$i].tool // null),
         scope: (.source_paths[$i].scope // null),
         path: (.source_paths[$i].path // null),
         identity: $id} ]')"

  local parent="null"
  if [ "$kind" = "variant" ]; then
    parent="$(printf '%s' "$action" | jq -c '.target_asset_id // null')"
  fi

  jq -nc --argjson vw "$vwrites" --argjson up "$(jq -nc \
      --arg id "$asset_id" --arg type "$type" --arg name "$name" \
      --arg canonical "$canonical" --arg at "$at" \
      --argjson versions "$versions" --argjson sources "$sources" --argjson parent "$parent" \
      '{asset_id: $id, type: $type, name: $name, canonical_path: $canonical, at: $at,
        versions: $versions, sources: $sources, related_parent: $parent}')" \
    '{update: $up, version_writes: $vw, errors: []}'
}

# 汇总全部动作：暂存内容、版本写入、registry 更新、决定记录
intake_apply_collect() {
  local plan="$1" repo="$2" staging="$3" apply_id="$4" committed="${5:-[]}"
  local registry staged ops errors
  registry="$(intake_registry_read "$repo")"

  staged="$(intake_apply_stage_all "$plan" "$repo" "$staging")"
  ops="$(printf '%s' "$staged" | jq -c '.ops')"
  errors="$(printf '%s' "$staged" | jq -c '.errors')"

  local updates="[]" vwrites="[]" decisions="[]"
  local failed_ids
  failed_ids="$(printf '%s' "$errors" | jq -c '[.[].action_id] | unique')"
  local n i
  n="$(printf '%s' "$plan" | jq '.actions | length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local a kind
    a="$(printf '%s' "$plan" | jq -c --argjson i "$i" '.actions[$i]')"
    kind="$(printf '%s' "$a" | jq -r '.kind')"
    # 暂存失败的动作不产生 registry 更新与版本写入
    if [ "$(printf '%s' "$failed_ids" | jq --arg a "$(printf '%s' "$a" | jq -r '.action_id')" 'index($a) != null')" = "true" ]; then
      i=$((i + 1))
      continue
    fi
    if [ "$kind" = "ignore" ] || [ "$kind" = "defer" ]; then
      decisions="$(printf '%s' "$decisions" | jq -c --argjson a "$a" \
        '. + [{kind: ($a.kind), candidate_id: ($a.candidate_id),
               asset_type: ($a.asset_type), asset_name: ($a.asset_name),
               occurrence_ids: ($a.source_occurrences // []),
               content_fingerprint_at_decision: ($a.source_identity // "")}]')"
    elif [ "$(printf '%s' "$a" | jq -r '.asset_type')" = "mcp" ]; then
      local mr
      mr="$(intake_apply_registry_update "$a" "$repo" "$staging" "$registry" "$apply_id" "$ops" "$committed")"
      updates="$(printf '%s' "$updates" | jq -c --argjson r "$mr" '. + [$r.update] | map(select(. != null))')"
      vwrites="$(printf '%s' "$vwrites" | jq -c --argjson r "$mr" \
        '. + [($r.version_writes[]? // empty)]')"
      errors="$(printf '%s' "$errors" | jq -c --argjson r "$mr" --arg a "$(printf '%s' "$a" | jq -r '.action_id')" \
        '. + [($r.errors[]? | {action_id: $a, error: .})]')"
    else
      local r
      r="$(intake_apply_registry_update "$a" "$repo" "$staging" "$registry" "$apply_id" "$ops" "$committed")"
      updates="$(printf '%s' "$updates" | jq -c --argjson r "$r" '. + [$r.update] | map(select(. != null))')"
      vwrites="$(printf '%s' "$vwrites" | jq -c --argjson r "$r" \
        --arg t "$(printf '%s' "$a" | jq -r '.asset_type')" \
        '. + [($r.version_writes[]? | . + {asset_type: $t})]')"
      errors="$(printf '%s' "$errors" | jq -c --argjson r "$r" --arg a "$(printf '%s' "$a" | jq -r '.action_id')" \
        '. + [($r.errors[]? | {action_id: $a, error: .})]')"
    fi
    i=$((i + 1))
  done

  jq -nc --argjson ops "$ops" --argjson u "$updates" --argjson v "$vwrites" \
    --argjson d "$decisions" --argjson e "$errors" \
    '{ops: $ops, updates: $u, version_writes: $v, decisions: $d, errors: $e}'
}

# 汇总全部内容的暂存结果（含 MCP 一次合并写入）
# 输出 {"ops": [...], "errors": [...]}
intake_apply_stage_all() {
  local plan="$1" repo="$2" staging="$3"
  local ops="[]" errors="[]"
  local n i
  n="$(printf '%s' "$plan" | jq '.actions | length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local a kind type r
    a="$(printf '%s' "$plan" | jq -c --argjson i "$i" '.actions[$i]')"
    kind="$(printf '%s' "$a" | jq -r '.kind')"
    type="$(printf '%s' "$a" | jq -r '.asset_type')"

    # link 只增加来源关系，不写内容；mcp 由 aggregate 统一处理
    if [ "$kind" = "ignore" ] || [ "$kind" = "defer" ] || [ "$kind" = "link" ] || [ "$type" = "mcp" ]; then
      i=$((i + 1))
      continue
    fi

    r="$(intake_apply_stage_action "$a" "$repo" "$staging")"
    if printf '%s' "$r" | jq -e 'has("error")' >/dev/null 2>&1; then
      errors="$(printf '%s' "$errors" | jq -c --argjson r "$r" \
        --arg a "$(printf '%s' "$a" | jq -r '.action_id')" \
        '. + [{action_id: $a, error: ($r.error // "stage_failed")}]')"
    else
      ops="$(printf '%s' "$ops" | jq -c --argjson r "$r" '. + [$r]')"
    fi
    i=$((i + 1))
  done

  local mcp_res
  mcp_res="$(intake_apply_stage_mcp_all "$plan" "$repo" "$staging")"
  ops="$(printf '%s' "$ops" | jq -c --argjson m "$(printf '%s' "$mcp_res" | jq -c '.ops')" '. + $m')"
  errors="$(printf '%s' "$errors" | jq -c --argjson m "$(printf '%s' "$mcp_res" | jq -c '.errors')" '. + $m')"

  jq -nc --argjson o "$ops" --argjson e "$errors" '{ops: $o, errors: $e}'
}
