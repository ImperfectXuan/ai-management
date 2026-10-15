#!/bin/sh
# intake/commit.sh - 提交阶段：内容落盘、版本快照、registry 合并与决定记录
# 需先 source common.sh / intake/paths.sh / intake/identity.sh / intake/store.sh
#
# 设计约束（design 8.2/8.3、spec 5.5）：
#   1. 写入路径先过边界校验，绝不写到总库之外
#   2. 目标文件在暂存与提交之间被改动 → 拒绝写入（不覆盖）
#   3. 续跑复用已持久化的备份基线，绝不把本批次自己写的内容当成"既有文件"
#   4. 已存在的同身份版本目录不重复创建
#   5. registry 与备份同批次一致；备份目录与该批次执行记录同生命周期

# 备份并写入内容
# $1=repo $2=apply_id $3=ops $4=staging $5=既有基线 files[] $6=写满 N 个 op 后中断（0=不中断）
# 输出 {"files": [...], "partial": bool, "errors": [...]}
intake_apply_commit_content() {
  local repo="$1" apply_id="$2" ops="$3" staging="$4"
  local baseline="${5:-[]}" fault_at="${6:-0}"
  local backup_root="${repo}/.ai-workspace/assets/history/${apply_id}.backup"
  local tmp written=0 partial="false" errors="[]"
  mkdir -p "$backup_root"
  tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-files.XXXXXX")"
  : > "$tmp"

  # 原始 registry 只在首次进入提交时留存，续跑不覆盖
  local reg
  reg="$(intake_registry_path "$repo")"
  if [ -f "$reg" ] && [ ! -f "${backup_root}/registry.before.json" ]; then
    cp "$reg" "${backup_root}/registry.before.json"
  fi

  local n i
  n="$(printf '%s' "$ops" | jq 'length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local op rel abs opkind before after bak cur expected prior_entry
    op="$(printf '%s' "$ops" | jq -c --argjson i "$i" '.[$i]')"
    rel="$(printf '%s' "$op" | jq -r '.rel')"
    opkind="$(printf '%s' "$op" | jq -r '.op')"
    after="$(printf '%s' "$op" | jq -r '.after_fingerprint')"

    if ! abs="$(intake_repo_abs_path "$repo" "$rel")"; then
      errors="$(printf '%s' "$errors" | jq -c --arg e "unsafe_target_path:${rel}" '. + [$e]')"
      break
    fi

    prior_entry="$(printf '%s' "$baseline" | jq -c --arg r "$rel" '[.[] | select(.rel == $r)][0] // null')"
    if [ "$prior_entry" != "null" ]; then
      # 本批次上次尝试已经写过这个路径：沿用原始基线，不再重新备份
      before="$(printf '%s' "$prior_entry" | jq -r '.before_fingerprint // ""')"
      bak="$(printf '%s' "$prior_entry" | jq -r '.backup_rel // ""')"
    else
      cur="$(intake_fingerprint_path "$abs")"
      expected="$(printf '%s' "$op" | jq -r '.target_before_fingerprint // ""')"
      if [ "$cur" != "$expected" ]; then
        # 暂存与提交之间目标被改动：拒绝写入，保留现网内容
        errors="$(printf '%s' "$errors" | jq -c --arg e "target_changed_before_commit:${rel}" '. + [$e]')"
        break
      fi
      before="$cur"
      bak=""
      if [ -n "$before" ]; then
        bak="$rel"
        mkdir -p "$(dirname "${backup_root}/${rel}")"
        rm -rf "${backup_root}/${rel}"
        if [ -d "$abs" ]; then
          cp -R "$abs" "${backup_root}/${rel}"
        else
          cp "$abs" "${backup_root}/${rel}"
        fi
      fi
    fi

    mkdir -p "$(dirname "$abs")"
    if [ "$opkind" = "replace_dir" ] && [ -d "${staging}/${rel}" ]; then
      rm -rf "$abs"
      cp -R "${staging}/${rel}" "$abs"
    else
      cp "${staging}/${rel}" "$abs"
    fi

    jq -nc --arg rel "$rel" --arg op "$opkind" --arg before "$before" --arg after "$after" \
      --arg bak "$bak" \
      '{rel: $rel, op: $op,
        before_fingerprint: (if $before == "" then null else $before end),
        after_fingerprint: $after,
        backup_rel: (if $bak == "" then null else $bak end)}' >> "$tmp"

    written=$((written + 1))
    i=$((i + 1))

    if [ "$fault_at" != "0" ] && [ "$written" -ge "$fault_at" ] && [ "$written" -lt "$n" ]; then
      partial="true"
      break
    fi
  done

  jq -nc --argjson f "$(jq -s -c '.' "$tmp")" --argjson p "$partial" --argjson e "$errors" \
    '{files: $f, partial: $p, errors: $e}'
  rm -f "$tmp"
}

# 写版本快照；输出 created_versions[] 记录
# 已存在且身份一致的版本目录不重复创建（续跑幂等）
intake_apply_commit_versions() {
  local repo="$1" apply_id="$2" vwrites="$3"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-vers.XXXXXX")"
  : > "$tmp"

  local n i
  n="$(printf '%s' "$vwrites" | jq 'length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local vw vid vver vsrc vident vkind dest existing
    vw="$(printf '%s' "$vwrites" | jq -c --argjson i "$i" '.[$i]')"
    vid="$(printf '%s' "$vw" | jq -r '.asset_id')"
    vver="$(printf '%s' "$vw" | jq -r '.version')"
    vsrc="$(printf '%s' "$vw" | jq -r '.content_src')"
    vident="$(printf '%s' "$vw" | jq -r '.identity')"
    vkind="$(printf '%s' "$vw" | jq -r '.kind // "new"')"
    dest="${repo}/.ai-workspace/assets/${vid}/v${vver}"

    existing=""
    if [ -f "${dest}/meta.json" ]; then
      existing="$(jq -r '.identity // ""' "${dest}/meta.json" 2>/dev/null)"
    fi
    if [ -z "$existing" ] || [ "$existing" != "$vident" ]; then
      rm -rf "$dest"
      mkdir -p "${dest}/content"
      cp -R "${vsrc}/." "${dest}/content/"
      jq -nc --arg schema "intake/v1" --arg id "$vid" --argjson v "$vver" \
        --arg ident "$vident" --arg kind "$vkind" --arg at "$(intake_now)" --arg ap "$apply_id" \
        '{schema: $schema, asset_id: $id, version: $v, identity: $ident, kind: $kind,
          created_at: $at, apply_id: $ap}' > "${dest}/meta.json"
    fi

    jq -nc --arg id "$vid" --argjson v "$vver" --arg ident "$vident" --arg kind "$vkind" \
      '{asset_id: $id, version: $v, identity: $ident, kind: $kind}' >> "$tmp"
    i=$((i + 1))
  done

  jq -s -c '.' "$tmp"
  rm -f "$tmp"
}

# registry 合并：加入新资产、版本与来源关系
intake_apply_registry_merge() {
  local registry="$1" updates="$2" at="$3"
  printf '%s' "$registry" | jq -c --argjson u "$updates" --arg at "$at" '
    reduce ($u[] | select(. != null)) as $x (.;
      .assets[$x.asset_id] = (
        ((.assets[$x.asset_id]) // {asset_id: $x.asset_id, type: $x.type, name: $x.name,
                                    canonical_path: $x.canonical_path, current_version: 0,
                                    versions: [], sources: [], related: null, created_at: $x.at})
        | .name = $x.name
        | .canonical_path = $x.canonical_path
        | .versions = ((.versions + $x.versions) | unique_by(.version) | sort_by(.version))
        | .current_version = ((.versions | map(.version) | max) // 0)
        | .sources = ((.sources + $x.sources) | unique_by(.occurrence_id))
        | .related = (if $x.related_parent == null then .related else {parent: $x.related_parent} end)
        | .updated_at = $x.at
      ))
    | .version_counter = ((.version_counter // 0) + 1)
    | .updated_at = $at'
}

# 规则 mapping 登记（复用 import-rules.sh 的 register_mapping_entry）
intake_apply_register_mappings() {
  local updates="$1"
  local ids id
  ids="$(printf '%s' "$updates" | jq -r '[.[] | select(.type == "rule") | (.canonical_path | split("/") | last | sub("\\.md$"; ""))] | unique | .[]' 2>/dev/null)"
  for id in $ids; do
    [ -n "$id" ] || continue
    # register_mapping_entry 内部用 log_* 写 stdout，这里转到 stderr 以免污染 JSON 输出
    register_mapping_entry "$id" "false" >&2
  done
}

# 写 ignore / defer 决定记录
intake_apply_write_decisions() {
  local repo="$1" batch_id="$2" decisions="$3"
  local n i
  n="$(printf '%s' "$decisions" | jq 'length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local d
    d="$(printf '%s' "$decisions" | jq -c --argjson i "$i" --arg at "$(intake_now)" \
      '.[$i] + {decided_at: $at, decided_by: "user"}')"
    intake_decision_write "$repo" "$batch_id" "$d"
    i=$((i + 1))
  done
}
