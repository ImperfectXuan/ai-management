#!/bin/sh
# intake/plan.sh - 人工审核计划生成与校验
# 需先 source common.sh / intake/identity.sh / intake/store.sh
#
# 输入环境: INTAKE_REPO、INTAKE_BATCH_ID、INTAKE_DECISIONS_FILE
# 输出: ReviewPlan JSON 到 stdout
#
# 设计约束（design 4.4 / 8.3、spec 5.3）：
#   1. 计划只由人工决定产生；扫描或比较结果不能自动变成计划
#   2. 无法解析项不能进入写入动作，只能 ignore / defer
#   3. 未处理的冲突与无法解析项记入 unresolved，apply 拒绝执行
#   4. 计划携带来源身份与目标版本快照，供 apply 执行前复核

INTAKE_ACTION_KINDS="add link update variant ignore defer"

# 计划 ID：plan-YYYYmmdd-HHMMSS-<6位随机>
intake_new_plan_id() {
  local ts rnd
  ts="$(date -u '+%Y%m%d-%H%M%S' 2>/dev/null || date '+%Y%m%d-%H%M%S')"
  rnd="$(od -An -N3 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | cut -c1-6)"
  [ -n "$rnd" ] || rnd="$$"
  printf 'plan-%s-%s\n' "$ts" "$rnd"
}

# 计划过期时间；取不到时返回空串（视为不设过期）
intake_plan_expires_at() {
  local ttl="${INTAKE_PLAN_TTL_SECONDS:-86400}"
  date -u -v+"${ttl}"S '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u -d "+${ttl} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || printf ''
}

# 收集需要稳定 ID 的 (type, identity) 对，输出 "type<空格>identity" 行
intake_plan_identity_rows() {
  local candidates="$1"
  printf '%s' "$candidates" | jq -r '
    def src_ident($c):
      if $c.type == "mcp" then (($c.content_fingerprint // "") + "|" + ($c.cred_fingerprint // ""))
      else ($c.content_fingerprint // "") end;
    def tgt_ident($c):
      if $c.existing_source == null then null
      elif $c.type == "mcp" then (($c.existing_source.fingerprint // "") + "|" + ($c.existing_source.cred_fingerprint // ""))
      else ($c.existing_source.fingerprint // "") end;
    [ (.[] | {type: .type, ident: src_ident(.)}), (.[] | {type: .type, ident: tgt_ident(.)}) ]
    | map(select(.ident != null and .ident != ""))
    | unique
    | .[]
    | "\(.type) \(.ident)"' 2>/dev/null
}

# 目标资产的实际身份快照：{asset_id: {path, fingerprint, cred_fingerprint, version}}
# 只记录指纹，不复制内容；apply 用它判断目标是否在计划之后被改动过
# （registry 的 current_version 不变，但文件被人手改，也必须能识别出来）
intake_plan_target_snapshots() {
  local repo="$1" index="$2"
  local derive_tmp
  derive_tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-tgt.XXXXXX")"
  : > "$derive_tmp"

  # 未登记的既有源也要有稳定 ID：与入库时同一套派生规则（type|identity）
  # 分隔符用 | 而不是制表符：制表符是 IFS 空白字符，连续分隔会吞掉空字段
  printf '%s' "$index" | jq -r '
    ([ ((.rule // [])[]  | {t: "rule",  i: (.fingerprint // ""), c: ""}),
       ((.skill // [])[] | {t: "skill", i: (.fingerprint // ""), c: ""}),
       ((.mcp // [])[]   | {t: "mcp",   i: (.fingerprint // ""), c: (.cred_fingerprint // "")}) ]
     | .[] | select(.i != "") | "\(.t)|\(.i)|\(.c)")' 2>/dev/null \
  | while IFS='|' read -r t i c; do
      [ -n "$t" ] || continue
      local ident
      if [ "$t" = "mcp" ]; then ident="${i}|${c}"; else ident="$i"; fi
      printf '%s\t%s\n' "${t}|${ident}" "$(intake_asset_id "$t" "$ident")"
    done > "$derive_tmp"

  jq -R -s -c --argjson idx "$index" '
    (split("\n") | map(select(length > 0) | split("\t")
        | {key: .[0], value: .[1]}) | from_entries) as $derived
    | [ ((($idx.rule // [])[]  | {asset_id, type: "rule",  name, path, fingerprint,
                                  cred_fingerprint: null, version})),
        ((($idx.skill // [])[] | {asset_id, type: "skill", name, path, fingerprint,
                                  cred_fingerprint: null, version})),
        ((($idx.mcp // [])[]   | {asset_id, type: "mcp",   name, path, fingerprint,
                                  cred_fingerprint, version})) ]
    | map(. as $e
        | ($e.fingerprint // "") as $f
        | ($e.cred_fingerprint // "") as $c
        | ($e.type + "|" + $f + (if $e.type == "mcp" then "|" + $c else "" end)) as $k
        | . + {asset_id: ($e.asset_id // $derived[$k])})
    | map(select(.asset_id != null))
    | map({key: .asset_id,
           value: {asset_id, type,
                   path,
                   fingerprint: (if (.fingerprint // "") == "" then null else .fingerprint end),
                   cred_fingerprint: (if (.cred_fingerprint // "") == "" then null else .cred_fingerprint end),
                   version}})
    | from_entries' "$derive_tmp"
  rm -f "$derive_tmp"
}

# ---- 计划构建 jq 程序 ----

intake_plan_build_jq() {
  cat <<'JQ_EOF'
def KINDS: ["add", "link", "update", "variant", "ignore", "defer"];
def src_ident($c):
  if $c.type == "mcp" then (($c.content_fingerprint // "") + "|" + ($c.cred_fingerprint // ""))
  else ($c.content_fingerprint // "") end;
def tgt_ident($c):
  if $c.existing_source == null then null
  elif $c.type == "mcp" then (($c.existing_source.fingerprint // "") + "|" + ($c.existing_source.cred_fingerprint // ""))
  else ($c.existing_source.fingerprint // "") end;

. as $in
| ($in.candidates // []) as $cands
| ($in.decisions // []) as $decs
| ($in.registry // {assets: {}}) as $reg
| ($in.occmap // {}) as $om
| ($in.idmap // {}) as $idmap
| ($in.tgtmap // {}) as $tgtmap
| ($cands | map({key: .candidate_id, value: .}) | from_entries) as $cmap
| ($decs | map(.candidate_id) | unique) as $decided
| ($reg.assets // {}) as $assets

| ([$decs[] | select($cmap[.candidate_id] == null) | "unknown_candidate:\(.candidate_id)"]) as $e_unknown
| ([$decs | group_by(.candidate_id)[] | select(length > 1) | "duplicate_decision:\(.[0].candidate_id)"]) as $e_dup
| ([$decs[] as $d | select((KINDS | index($d.kind)) == null) | "invalid_kind:\($d.candidate_id):\($d.kind // "")"]) as $e_kind

| (reduce ($decs[] | select($cmap[.candidate_id] != null)) as $d (
    {actions: [], errors: []};
    $cmap[$d.candidate_id] as $c
    | (tgt_ident($c)) as $tident
    | ($d.target_asset_id // $c.existing_asset_id
       // (if $tident == null then null else $idmap[($c.type + "|" + $tident)] end)) as $tid
    | ($tgtmap[($tid // "")] // null) as $tsnap
    | if ((KINDS | index($d.kind)) == null) then .
      elif ((($c.labels | index("unparseable")) != null) and ($d.kind != "ignore" and $d.kind != "defer")) then
        .errors += ["unparseable_cannot_ingest:\($d.candidate_id)"]
      elif ((["link", "update", "variant"] | index($d.kind)) != null and $tid == null) then
        .errors += ["target_unresolved:\($d.candidate_id)"]
      elif ($d.target_asset_id != null and $tsnap == null) then
        .errors += ["target_not_found:\($d.candidate_id)"]
      elif ($d.target_asset_id != null and $tsnap.type != $c.type) then
        .errors += ["target_type_mismatch:\($d.candidate_id)"]
      else
        .actions += [{
          action_id: ("act-" + ($c.candidate_id | sub("^cand-"; "")) + "-" + $d.kind),
          kind: $d.kind,
          candidate_id: $c.candidate_id,
          asset_type: $c.type,
          asset_name: $c.display_name,
          target_asset_id: (if (["link", "update", "variant"] | index($d.kind)) != null then $tid else null end),
          source_fingerprint: ($c.content_fingerprint // null),
          source_identity: (src_ident($c)),
          source_cred_fingerprint: ($c.cred_fingerprint // null),
          source_occurrences: ($c.occurrences // []),
          source_paths: [($c.occurrences // [])[] as $o
                         | ($om[$o] // null) | select(. != null)
                         | {occurrence_id: $o, tool: .tool, scope: .scope,
                            source_root: .source_root, path: .path,
                            resolved_path: (.link_target // (.source_root + "/" + .path)),
                            read_status: .read_status}],
          labels: ($c.labels // []),
          deferred: ($c.deferred // false),
          target_existing_source: ($c.existing_source // null),
          target_version_snapshot: (if $tid == null then null else ($assets[$tid].current_version // null) end),
          # 目标实际身份快照：版本号之外的复核依据（文件被手改时版本号不会变）
          target_content_fingerprint:
            (if $tsnap != null then $tsnap.fingerprint
             elif $c.existing_source != null then ($c.existing_source.fingerprint // null)
             else null end),
          target_cred_fingerprint:
            (if $tsnap != null then $tsnap.cred_fingerprint
             elif $c.existing_source != null then ($c.existing_source.cred_fingerprint // null)
             else null end),
          target_path:
            (if $tsnap != null then $tsnap.path
             elif $c.existing_source != null then ($c.existing_source.path // null)
             else null end),
          registry_counter_snapshot: ($reg.version_counter // 0),
          resolved: true
        }]
      end
  )) as $built

| ([$cands[] as $c | select(($decided | index($c.candidate_id)) == null)
    | select((($c.labels | index("unparseable")) != null) or (($c.labels | index("conflict")) != null))
    | $c.candidate_id]) as $unresolved
| ([$cands[] as $c | select(($decided | index($c.candidate_id)) == null)
    | select((($c.labels | index("unparseable")) == null) and (($c.labels | index("conflict")) == null))
    | $c.candidate_id]) as $skipped

| ($e_unknown + $e_dup + $e_kind + $built.errors) as $errors
| {
    ok: (($errors | length) == 0),
    errors: $errors,
    plan: {
      schema: $in.schema,
      plan_id: $in.plan_id,
      batch_id: $in.batch_id,
      repo: $in.repo,
      created_at: $in.created_at,
      expires_at: $in.expires_at,
      registry_counter_snapshot: ($reg.version_counter // 0),
      actions: ($built.actions | sort_by(.action_id)),
      unresolved: $unresolved,
      skipped: $skipped,
      summary: {
        add:     [$built.actions[] | select(.kind == "add")] | length,
        link:    [$built.actions[] | select(.kind == "link")] | length,
        update:  [$built.actions[] | select(.kind == "update")] | length,
        variant: [$built.actions[] | select(.kind == "variant")] | length,
        ignore:  [$built.actions[] | select(.kind == "ignore")] | length,
        defer:   [$built.actions[] | select(.kind == "defer")] | length,
        unresolved: ($unresolved | length),
        skipped: ($skipped | length)
      }
    }
  }
JQ_EOF
}

# 构建审核计划；输入由环境变量给出
# 输出: {"ok": bool, "errors": [...], "plan": {...}}
intake_plan_build() {
  local repo="${INTAKE_REPO:-}" batch_id="${INTAKE_BATCH_ID:-}"
  local decisions_file="${INTAKE_DECISIONS_FILE:-}"
  local plan_id="${INTAKE_PLAN_ID:-$(intake_new_plan_id)}"

  [ -n "$repo" ] || die "intake plan: 必须指定 --repo（总库路径）"
  [ -n "$batch_id" ] || die "intake plan: 必须指定 --batch（扫描批次 ID）"
  [ -n "$decisions_file" ] || die "intake plan: 必须指定 --decisions（人工决定文件）"
  [ -f "$decisions_file" ] || die "intake plan: 决定文件不存在: $decisions_file"

  local candidates
  candidates="$(intake_batch_read_candidates "$repo" "$batch_id")"
  if printf '%s' "$candidates" | jq -e '.error == "candidates_not_found"' >/dev/null 2>&1; then
    die "intake plan: 批次没有候选结果: ${batch_id}（先运行 aiws intake compare）"
  fi

  # 决定文件允许 {"decisions": [...]} 或裸数组
  local decisions
  decisions="$(jq -c 'if type == "array" then . elif has("decisions") then .decisions else [] end' "$decisions_file" 2>/dev/null || echo '[]')"

  local registry occmap idmap tgtmap repo_index
  registry="$(intake_registry_read "$repo")"
  repo_index="$(intake_repo_index "$repo")"

  occmap="$(intake_batch_read_scan "$repo" "$batch_id" \
    | jq -c '(.occurrences // []) | map({key: .occurrence_id, value: .}) | from_entries' 2>/dev/null || echo '{}')"

  # 稳定资产 ID 由 shell 计算（jq 无 sha256）
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-ids.XXXXXX")"
  intake_plan_identity_rows "$(printf '%s' "$candidates" | jq -c '.candidates // []')" \
    | while IFS=' ' read -r t i; do
        [ -n "$t" ] || continue
        printf '%s\t%s\n' "${t}|${i}" "$(intake_asset_id "$t" "$i")"
      done > "$tmp"
  idmap="$(jq -R -s -c 'split("\n") | map(select(length > 0) | split("\t") | {key: .[0], value: .[1]}) | from_entries' "$tmp")"
  rm -f "$tmp"

  tgtmap="$(intake_plan_target_snapshots "$repo" "$repo_index")"
  [ -n "$tgtmap" ] || tgtmap='{}' 

  # 分类程序以对象为输入：先组装输入对象再管道进程序（-n 时 . 为 null）
  jq -nc \
    --argjson candidates "$(printf '%s' "$candidates" | jq -c '.candidates // []')" \
    --argjson decisions "$decisions" \
    --argjson registry "$registry" \
    --argjson occmap "$occmap" \
    --argjson idmap "$idmap" \
    --argjson tgtmap "$tgtmap" \
    --arg schema "intake/v1" \
    --arg plan_id "$plan_id" \
    --arg batch_id "$batch_id" \
    --arg repo "$repo" \
    --arg created_at "$(intake_now)" \
    --arg expires_at "$(intake_plan_expires_at)" \
    '{candidates: $candidates, decisions: $decisions, registry: $registry,
      occmap: $occmap, idmap: $idmap, tgtmap: $tgtmap, schema: $schema, plan_id: $plan_id,
      batch_id: $batch_id, repo: $repo, created_at: $created_at, expires_at: $expires_at}' \
  | jq "$(intake_plan_build_jq)" | intake_plan_write_paths "$repo"
}


# 在计划返回之前计算最终目标。独立 write_path 字段不会改变既有目标快照语义。
intake_plan_write_paths() {
  local repo="$1" built actions
  built="$(cat)"
  if [ "$(printf '%s' "$built" | jq -r '.ok')" != "true" ]; then
    printf '%s\n' "$built"
    return 0
  fi
  actions="$(printf '%s' "$built" | jq -c '.plan.actions[]' | while IFS= read -r action; do
    local write_path
    write_path="$(intake_apply_write_path "$action" "$repo")"
    printf '%s' "$action" | jq -c --arg p "$write_path" '. + {write_path: (if $p == "" then null else $p end)}'
  done | jq -s .)"
  printf '%s' "$built" | jq --argjson a "$actions" '.plan.actions = $a'
}
