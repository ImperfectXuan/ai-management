#!/bin/sh
# intake/compare.sh - 确定性比较、来源关系与增量决定
# 需先 source common.sh / import-mcp.sh / intake/identity.sh / intake/store.sh
#
# 输入环境: INTAKE_REPO（总库）INTAKE_BATCH_ID（扫描批次）
# 输出: candidates JSON 到 stdout
#
# 设计约束（design 3.4/3.6/4.4、spec 5.2）：
#   1. 只读来源与总库规范源，本模块不写总库资产，只把候选写入本地记录区
#   2. 内容相同即合并来源，名称不参与"内容相同"判定
#   3. 同名不同内容只标记冲突并保留差异，绝不自动合并
#   4. 名称相似只作 similar 提示，永不据此判定为同一资产
#   5. MCP 凭据身份单独表达；账号不同不合并

# ============================================================================
# 总库既有规范源索引
# 总库不要求先建 assets/registry.json，直接读既有 rules / skills / mcp 规范源
# ============================================================================

# 把 registry 的稳定资产 ID 与当前版本挂到规范源索引上
# 资产 ID 由 registry 决定，绝不再由内容指纹推导（否则每次内容变化都会换 ID）
intake_repo_index_annotate() {
  local repo="$1" arr="$2"
  local reg
  reg="$(intake_registry_read "$repo")"
  printf '%s' "$arr" | jq -c --argjson reg "$reg" '
    (($reg.assets // {}) | to_entries
     | map({key: .value.canonical_path, value: {asset_id: .key, version: .value.current_version}})
     | from_entries) as $by_path
    | map(. as $e
        | . + {asset_id: (($by_path[$e.path] // {}).asset_id),
               version:  (($by_path[$e.path] // {}).version)})'
}

intake_repo_index() {
  local repo="$1"
  local base="${repo}/.ai-workspace"
  local rules="[]" skills="[]" mcp="[]"

  local f name rel
  for f in "${base}"/rules/*.md "${base}"/rules/domains/*.md; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"; name="${name%.*}"
    rel="${f#"${repo}"/}"
    rules="$(printf '%s' "$rules" | jq -c \
      --arg n "$name" --arg p "$rel" --arg fp "sha256:$(intake_sha256 "$f")" \
      --argjson meta "$(intake_rule_meta "$f")" \
      '. + [{name: $n, path: $p, fingerprint: $fp, meta: $meta}]')"
  done

  local d sname srel
  for d in "${base}"/skills/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    sname="$(basename "$d")"
    srel="${d#"${repo}"/}"
    skills="$(printf '%s' "$skills" | jq -c \
      --arg n "$sname" --arg p "$srel" --arg fp "sha256:$(intake_fingerprint_skill_dir "$d")" \
      '. + [{name: $n, path: $p, fingerprint: $fp}]')"
  done

  local mcp_file="${base}/mcp/mcp.json"
  if [ -f "$mcp_file" ]; then
    mcp="$(intake_mcp_server_identities canonical "$mcp_file" \
      | jq -s -c --arg p ".ai-workspace/mcp/mcp.json" \
          'map({name: .name, path: $p, fingerprint: .behavior_fingerprint,
                cred_fingerprint: .cred_fingerprint, cred_refs: .cred_refs, behavior: .behavior})')"
  fi

  rules="$(intake_repo_index_annotate "$repo" "$rules")"
  skills="$(intake_repo_index_annotate "$repo" "$skills")"
  mcp="$(intake_repo_index_annotate "$repo" "$mcp")"

  # 键用单数 rule/skill/mcp，与比较项 type 对齐
  jq -nc --argjson r "$rules" --argjson s "$skills" --argjson m "$mcp" \
    '{rule: $r, skill: $s, mcp: $m}'
}

# 总库规范源清单（含未登记的既有源）：Desktop 的目标选择需要真实可选项
# registered=false 表示尚未纳入 registry，首次纳管时用派生 ID
intake_compare_repo_asset_list() {
  # 未登记的既有源也要给出可用的 asset_id（与入库派生规则一致），否则 Desktop 选不到它
  printf '%s' "$1" | jq -c '
    [ ((.rule // [])[]  | {asset_id, type: "rule",  name, path, version,
                           fingerprint, cred_fingerprint: null}),
      ((.skill // [])[] | {asset_id, type: "skill", name, path, version,
                           fingerprint, cred_fingerprint: null}),
      ((.mcp // [])[]   | {asset_id, type: "mcp",   name, path, version,
                           fingerprint, cred_fingerprint}) ]
    | .[]' 2>/dev/null \
  | intake_index_fill_asset_ids \
  | jq -s -c 'map({asset_id, type, name, path, version, registered}) | sort_by(.type, (.name // ""))'
}

# ============================================================================
# occurrence → 比较项
# ============================================================================

# 无法解析项：不猜内容，单独成组
intake_compare_unparseable_item() {
  local occ="$1" status="$2" reason="$3"
  printf '%s' "$occ" | jq -c --arg st "$status" --arg rs "$reason" '{
    key: ("unparseable|" + (.occurrence_id // "")),
    type: (.asset_type // "unknown"),
    name: (.original_name // .path // ""),
    occurrence_id: .occurrence_id,
    fingerprint: null, identity: null, cred_fingerprint: null,
    cred_refs: [], behavior: null,
    managed: false, unparseable: true,
    read_status: $st, read_error: $rs,
    resolved_path: null,
    source: {source_root: .source_root, tool: .tool, scope: .scope, path: .path}
  }'
}

intake_compare_items_of_mcp() {
  local occ="$1"
  local tool src_file servers count idents
  tool="$(printf '%s' "$occ" | jq -r '.tool // ""' 2>/dev/null)"
  src_file="$(printf '%s' "$occ" | jq -r '(.source_root // "") + "/" + (.path // "")' 2>/dev/null)"

  if [ ! -f "$src_file" ]; then
    intake_compare_unparseable_item "$occ" "unreadable" "source_unreadable_at_compare"
    return 0
  fi

  servers="$(intake_mcp_read_servers "$tool" "$src_file")"
  count="$(printf '%s' "$servers" | jq 'keys | length' 2>/dev/null || echo 0)"
  [ -n "$count" ] || count=0
  if [ "$count" = "0" ]; then
    return 0
  fi

  idents="$(intake_mcp_server_identities "$tool" "$src_file")"
  if [ -z "$idents" ]; then
    intake_compare_unparseable_item "$occ" "parse_error" "mcp_parse_failed"
    return 0
  fi

  printf '%s\n' "$idents" | jq -c --argjson occ "$occ" '{
    key: ("mcp|" + .behavior_fingerprint + "|" + .cred_fingerprint),
    type: "mcp",
    name: .name,
    occurrence_id: $occ.occurrence_id,
    fingerprint: .behavior_fingerprint,
    identity: (.behavior_fingerprint + "|" + .cred_fingerprint),
    cred_fingerprint: .cred_fingerprint,
    cred_refs: .cred_refs,
    behavior: .behavior,
    managed: false, unparseable: false,
    read_status: "ok",
    meta: {},
    resolved_path: ($occ.source_root + "/" + $occ.path),
    source: {source_root: $occ.source_root, tool: $occ.tool, scope: $occ.scope, path: $occ.path}
  }'
}

intake_compare_items_of_occurrence() {
  local occ="$1"
  local status type
  status="$(printf '%s' "$occ" | jq -r '.read_status // "unknown"' 2>/dev/null)"
  type="$(printf '%s' "$occ" | jq -r '.asset_type // "unknown"' 2>/dev/null)"

  if [ "$status" != "ok" ]; then
    intake_compare_unparseable_item "$occ" "$status" ""
    return 0
  fi

  case "$type" in
    rule|skill)
      printf '%s' "$occ" | jq -c '{
        key: (.asset_type + "|" + .content_fingerprint),
        type: .asset_type,
        name: (.original_name // ""),
        occurrence_id: .occurrence_id,
        fingerprint: .content_fingerprint,
        identity: .content_fingerprint,
        cred_fingerprint: null, cred_refs: [], behavior: null,
        managed: ((.is_generated_copy // false) or (.is_managed_link // false)),
        unparseable: false,
        read_status: "ok",
        meta: {title: .title, description: .description, globs: .globs,
               always_apply: .always_apply, file_count: .file_count, has_script: .has_script},
        resolved_path: (.link_target // (.source_root + "/" + .path)),
        source: {source_root: .source_root, tool: .tool, scope: .scope, path: .path}
      }'
      ;;
    mcp)
      intake_compare_items_of_mcp "$occ"
      ;;
    *)
      intake_compare_unparseable_item "$occ" "unsupported" "unsupported_asset_type"
      ;;
  esac
}

# 收集全部比较项（JSONL）
intake_compare_collect_items() {
  local scan_json="$1"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-items.XXXXXX")"
  printf '%s' "$scan_json" | jq -c '.occurrences[]?' 2>/dev/null > "$tmp"

  local occ
  while IFS= read -r occ; do
    [ -n "$occ" ] || continue
    intake_compare_items_of_occurrence "$occ"
  done < "$tmp"

  rm -f "$tmp"
}

# ============================================================================
# 差异摘要
# ============================================================================

# Skill 相对路径差异：added=来源新增、removed=缺少、changed=内容不同
intake_skill_diff() {
  local src_dir="$1" base_dir="$2"
  local ma mb
  ma="$(mktemp "${TMPDIR:-/tmp}/aiws-sd-a.XXXXXX")"
  mb="$(mktemp "${TMPDIR:-/tmp}/aiws-sd-b.XXXXXX")"
  intake_skill_manifest "$src_dir" > "$ma"
  intake_skill_manifest "$base_dir" > "$mb"

  jq -n -c --rawfile a "$ma" --rawfile b "$mb" '
    def to_map($s): $s | split("\n") | map(select(length > 0) | split("|") | {key: .[0], value: ((.[1] // "") + ":" + (.[2] // ""))}) | from_entries;
    (to_map($a)) as $A | (to_map($b)) as $B |
    {
      added:   [($A | keys[]) as $k | select(($B | has($k)) | not) | $k] | sort,
      removed: [($B | keys[]) as $k | select(($A | has($k)) | not) | $k] | sort,
      changed: [($A | keys[]) as $k | select(($B | has($k)) and $A[$k] != $B[$k]) | $k] | sort
    }'
  rm -f "$ma" "$mb"
}

# 规则差异：changed=frontmatter 行为字段变化；added/removed=正文行（限 40 行）
intake_rule_diff() {
  local src_file="$1" base_file="$2"
  local meta_src meta_base changed dout added removed

  meta_src="$(intake_rule_meta "$src_file")"
  meta_base="$(intake_rule_meta "$base_file")"
  changed="$(jq -n -c --argjson a "$meta_src" --argjson b "$meta_base" \
    '[($a | keys[]) as $k | select($a[$k] != $b[$k]) | $k] | sort')"

  dout="$(diff "$src_file" "$base_file" 2>/dev/null || true)"
  added="$(printf '%s\n' "$dout" | grep '^>' | sed 's/^> //' | head -40 | jq -R -s 'split("\n") | map(select(length > 0))')"
  removed="$(printf '%s\n' "$dout" | grep '^<' | sed 's/^< //' | head -40 | jq -R -s 'split("\n") | map(select(length > 0))')"

  jq -nc --argjson a "$added" --argjson r "$removed" --argjson c "$changed" \
    '{added: $a, removed: $r, changed: $c}'
}

# 单个候选的差异摘要；无对照物时返回空摘要
intake_compare_diff_of_candidate() {
  local cand="$1" repo="$2"
  local empty='{"added":[],"removed":[],"changed":[]}'
  local type base src

  type="$(printf '%s' "$cand" | jq -r '.type // ""' 2>/dev/null)"
  base="$(printf '%s' "$cand" | jq -r '.existing_source.path // ""' 2>/dev/null)"
  src="$(printf '%s' "$cand" | jq -r '[._resolved_paths[]?] | first // ""' 2>/dev/null)"

  if [ -z "$base" ] || [ -z "$src" ]; then
    printf '%s\n' "$empty"
    return 0
  fi

  if [ "$type" = "skill" ] && [ -d "$src" ] && [ -d "${repo}/${base}" ]; then
    intake_skill_diff "$src" "${repo}/${base}"
  elif [ "$type" = "rule" ] && [ -f "$src" ] && [ -f "${repo}/${base}" ]; then
    intake_rule_diff "$src" "${repo}/${base}"
  else
    printf '%s\n' "$empty"
  fi
}

# ============================================================================
# 分类 jq 程序
# ============================================================================

intake_compare_classify_jq() {
  cat <<'JQ_EOF'
def normname: (. // "") | ascii_downcase | gsub("[^a-z0-9]"; "");
def simname($a; $b):
  ($a | length) as $la | ($b | length) as $lb |
  if $a == "" or $b == "" or $a == $b then false
  elif ($la >= 4 and ($b | contains($a))) then true
  elif ($lb >= 4 and ($a | contains($b))) then true
  else false end;
def flat($o; $p):
  if ($o | type) == "object" then
    ([$o | to_entries[] | .key as $k | flat(.value; ($p + [$k]))] | add // [])
  else [{path: ($p | join(".")), value: $o}] end;
def fielddiff($a; $b):
  (flat($a; []) | map({key: .path, value: .value}) | from_entries) as $A |
  (flat($b; []) | map({key: .path, value: .value}) | from_entries) as $B |
  {
    added:   [($A | keys[]) as $k | select(($B | has($k)) | not) | $k] | sort,
    removed: [($B | keys[]) as $k | select(($A | has($k)) | not) | $k] | sort,
    changed: [($A | keys[]) as $k | select(($B | has($k)) and $A[$k] != $B[$k]) | $k] | sort
  };

. as $items
| (reduce $items[] as $it ({};
     .[$it.type + "|" + ($it.name | normname)] =
       (((.[$it.type + "|" + ($it.name | normname)]) // []) + [$it.key] | unique))) as $namekeys
| ($items | group_by(.key) | map(
    . as $g | ($g[0]) as $h
    | ([$g[] | .occurrence_id] | unique) as $occs
    | ([$g[] | .name] | unique) as $names
    | ($names | map(normname) | unique) as $norms
    | (($repo_index[$h.type]) // []) as $assets
    | ($assets | map(select(.fingerprint == $h.fingerprint
        and ($h.type != "mcp" or .cred_fingerprint == $h.cred_fingerprint)))) as $by_content
    | ($assets | map(select((.name | normname) as $n | ($norms | index($n)) != null))) as $by_name
    | (if ($by_content | length) > 0 then $by_content[0]
       elif ($by_name | length) > 0 then $by_name[0]
       else null end) as $ex
    | ($g | map(.unparseable) | any) as $is_unparsable
    # 忽略/暂缓只对「实际审核过的来源组」生效：未被审核过的来源（如另一个项目里的同内容文件）
    # 必须重新进入审核，不能被别的来源的忽略决定吞掉。
    | ($decisions | map(select(.asset_type == $h.type
        and .kind == "ignore"
        and ((.content_fingerprint_at_decision // "") == $h.identity))
        | (.occurrence_ids // [.occurrence_id]))) | (add // []) as $ign_occs
    | ($decisions | map(select(.asset_type == $h.type
        and .kind == "defer"
        and ((.content_fingerprint_at_decision // "") == $h.identity))
        | (.occurrence_ids // [.occurrence_id]))) | (add // []) as $def_occs
    | ($decisions | map(select(.asset_type == $h.type
        and (((.occurrence_ids // [.occurrence_id]) | map(select(. as $o | ($occs | index($o)) != null))) | length) > 0))) as $src_dec
    | ($src_dec | map(select((.content_fingerprint_at_decision // "") != $h.identity))) as $stale_dec
    | (
        (if $is_unparsable then ["unparseable"] else [] end)
        + (if ($is_unparsable | not) and (($by_content | length) > 0) then ["duplicate"] else [] end)
        + (if ($g | map(.managed) | any) then ["managed"] else [] end)
        + (if ($is_unparsable | not) and (($by_name | length) > 0) and (($by_content | length) == 0) then ["conflict"] else [] end)
        + (if ($is_unparsable | not)
              and ([$norms[] as $n | (((($namekeys[$h.type + "|" + $n]) // []) | length) > 1)] | any)
           then ["conflict"] else [] end)
        + (if (($stale_dec | length) > 0) then ["changed"] else [] end)
      ) as $labels
    | {
        _key: $h.key,
        _identity: $h.identity,
        _resolved_paths: ([$g[] | .resolved_path] | map(select(. != null)) | unique),
        _meta: ($g | map(.meta) | map(select(. != null)) | first),
        type: $h.type,
        names: $names,
        display_name: ($names[0] // ""),
        content_fingerprint: $h.fingerprint,
        cred_fingerprint: $h.cred_fingerprint,
        cred_refs: ([$g[] | .cred_refs[]?] | unique),
        labels: ($labels | unique),
        occurrences: $occs,
        sources: [$g[] | {occurrence_id, name, read_status, managed, source}],
        existing_asset_id: (($ex // {}).asset_id // null),
        existing_version: (($ex // {}).version // null),
        existing_source: (
          if $ex == null then null
          else {name: $ex.name, path: $ex.path, fingerprint: $ex.fingerprint,
                cred_fingerprint: $ex.cred_fingerprint,
                asset_id: ($ex.asset_id // null), version: ($ex.version // null)} end),
        credential_diff: (
          if $h.type != "mcp" or ($by_name | length) == 0 then null
          else
            (($h.cred_refs // []) | map({key: .field, value: .ref}) | from_entries) as $A |
            (($by_name[0].cred_refs // []) | map({key: .field, value: .ref}) | from_entries) as $B |
            {
              added:   [($A | keys[]) as $k | select(($B | has($k)) | not) | $k] | sort,
              removed: [($B | keys[]) as $k | select(($A | has($k)) | not) | $k] | sort,
              changed: [($A | keys[]) as $k | select(($B | has($k)) and $A[$k] != $B[$k]) | $k] | sort
            }
          end),
        diff_summary: {added: [], removed: [], changed: []},
        behavior_diff: (
          if $h.type == "mcp" and ($by_name | length) > 0
          then fielddiff($h.behavior; $by_name[0].behavior) else null end),
        deferred: ((($occs | length) > 0)
                   and ([$occs[] as $o | select(($def_occs | index($o)) == null)] | length) == 0),
        suppressed: ((($occs | length) > 0)
                   and ([$occs[] as $o | select(($ign_occs | index($o)) == null)] | length) == 0)
      }
  ))
| . as $cands
| $cands | map(
    . as $c
    | (if (($c.labels | index("unparseable")) != null) or (($c.labels | index("duplicate")) != null)
            or (($c.labels | index("conflict")) != null) then false
       else
         ([$cands[] | select(.type == $c.type and ._key != $c._key) | .names[] | normname]
          + [(($repo_index[$c.type]) // [])[] | .name | normname]) as $others
         | ([$c.names[] | normname] | map(. as $n | [$others[] | simname($n; .)] | any) | any)
       end) as $is_similar
    | if $is_similar then .labels = ((.labels + ["similar"]) | unique) else . end)
| map(if (.labels | length) == 0 then .labels = ["new"] else . end)
JQ_EOF
}

# ============================================================================
# 主入口
# ============================================================================

# Usage: intake_compare
#   INTAKE_REPO       总库路径（必需）
#   INTAKE_BATCH_ID   扫描批次 ID（必需）
# 输出: candidates JSON 到 stdout；不下写任何总库规范源
intake_compare() {
  local repo="${INTAKE_REPO:-}" batch_id="${INTAKE_BATCH_ID:-}"
  [ -n "$repo" ] || die "intake compare: 必须指定 --repo（总库路径）"
  [ -n "$batch_id" ] || die "intake compare: 必须指定 --batch（批次 ID）"

  local scan_json
  scan_json="$(intake_batch_read_scan "$repo" "$batch_id")"
  if printf '%s' "$scan_json" | jq -e '.error == "batch_not_found"' >/dev/null 2>&1; then
    die "intake compare: 批次不存在: ${batch_id}"
  fi
  if ! printf '%s' "$scan_json" | jq -e '.occurrences' >/dev/null 2>&1; then
    die "intake compare: 批次 scan.json 不是有效的 intake/v1 结构: ${batch_id}"
  fi

  local repo_index decisions
  repo_index="$(intake_repo_index "$repo")"
  decisions="$(intake_decision_list "$repo")"

  local items_file cands
  items_file="$(mktemp "${TMPDIR:-/tmp}/aiws-items.XXXXXX")"
  intake_compare_collect_items "$scan_json" > "$items_file"
  cands="$(jq -s --argjson repo_index "$repo_index" --argjson decisions "$decisions" \
    "$(intake_compare_classify_jq)" "$items_file")"
  rm -f "$items_file"

  local patches patch_json
  patches="$(mktemp "${TMPDIR:-/tmp}/aiws-patch.XXXXXX")"
  : > "$patches"
  intake_compare_patch_ids "$cands" "$repo" >> "$patches"
  patch_json="$(jq -s -c '.' "$patches")"
  rm -f "$patches"

  local counts compared_at asset_list
  counts="$(printf '%s' "$repo_index" | jq -c \
    '{rule: (.rule | length), skill: (.skill | length), mcp: (.mcp | length)}')"
  asset_list="$(intake_compare_repo_asset_list "$repo_index")"
  compared_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')"

  jq -nc \
    --arg schema "intake/v1" \
    --arg batch_id "$batch_id" \
    --arg repo "$repo" \
    --arg compared_at "$compared_at" \
    --argjson repo_assets "$counts" \
    --argjson repo_asset_list "$asset_list" \
    --argjson candidates "$cands" \
    --argjson patches "$patch_json" '
      $candidates
      | to_entries
      | map(.key as $i | .value as $c
          | ($patches | map(select(.index == $i)) | first) as $p
          | ($c + {candidate_id: $p.candidate_id, diff_summary: $p.diff_summary})
          | del(._key, ._identity, ._resolved_paths, ._meta))
      | . as $all
      | ($all | map(select(.suppressed | not))) as $live
      | ($all | map(select(.suppressed))) as $dead
      | {
          schema: $schema,
          batch_id: $batch_id,
          repo: $repo,
          compared_at: $compared_at,
          repo_assets: $repo_assets,
          repo_asset_list: $repo_asset_list,
          candidates: $live,
          suppressed: ($dead | map({candidate_id, type, names, occurrences,
                                    reason: "ignored_unchanged"})),
          summary: {
            new:         [$live[] | select((.labels | index("new")) != null)] | length,
            duplicate:   [$live[] | select((.labels | index("duplicate")) != null)] | length,
            conflict:    [$live[] | select((.labels | index("conflict")) != null)] | length,
            changed:     [$live[] | select((.labels | index("changed")) != null)] | length,
            managed:     [$live[] | select((.labels | index("managed")) != null)] | length,
            similar:     [$live[] | select((.labels | index("similar")) != null)] | length,
            unparseable: [$live[] | select((.labels | index("unparseable")) != null)] | length,
            deferred:    [$live[] | select(.deferred)] | length,
            total:       ($live | length)
          },
          errors: []
        }'
}

# 为每个候选计算稳定 ID 与差异摘要，输出 JSONL（index/candidate_id/diff_summary）
intake_compare_patch_ids() {
  local cands="$1" repo="$2"
  local n i
  n="$(printf '%s' "$cands" | jq 'length' 2>/dev/null || echo 0)"
  [ -n "$n" ] || n=0

  i=0
  while [ "$i" -lt "$n" ]; do
    local c type identity cid
    c="$(printf '%s' "$cands" | jq -c --argjson i "$i" '.[$i]')"
    type="$(printf '%s' "$c" | jq -r '.type // "unknown"')"
    identity="$(printf '%s' "$c" | jq -r '._identity // ""')"
    if [ -z "$identity" ]; then
      identity="unparseable|$(printf '%s' "$c" | jq -r '.occurrences[0] // ""')"
    fi
    cid="$(intake_candidate_id "$type" "$identity")"

    jq -nc --argjson i "$i" --arg cid "$cid" \
      --argjson d "$(intake_compare_diff_of_candidate "$c" "$repo")" \
      '{index: $i, candidate_id: $cid, diff_summary: $d}'
    i=$((i + 1))
  done
}
