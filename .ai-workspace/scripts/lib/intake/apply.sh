#!/bin/sh
# intake/apply.sh - 人工审核计划执行：执行前复核、增量入库、幂等、续跑与并发
# 需先 source common.sh / intake/paths.sh / identity.sh / store.sh / plan.sh / stage.sh / commit.sh
#
# 输入环境: INTAKE_REPO、INTAKE_PLAN_FILE（可选 INTAKE_CANCEL_FILE、INTAKE_RESUME、INTAKE_FAULT_STAGE）
# 输出: ApplyBatch JSON 到 stdout
#
# 设计约束（design 8.2/8.3/8.4、spec 5.3/5.5）：
#   1. 只执行明确的人工审核计划；扫描或比较结果不能直接触发写入
#   2. 计划含未处理冲突或无法解析项时拒绝执行
#   3. 执行前复核来源指纹、目标版本与目标实际内容；任一受影响项变化即中止整批
#   4. 提交按阶段推进，每阶段状态持久化：续跑能区分"还没做"和"做了但记录没写完"
#   5. 每次执行都有终态记录；中断留下 incomplete 记录与恢复入口
#   6. 回退只作用于该批次实际改动的文件（见 recover.sh）
#   7. 凭据值绝不写入共享资产：入库要求凭据已是 ${secret:} 引用（见 stage.sh 门禁）

INTAKE_APPLY_STAGES="preflight write_assets write_registry write_history"

# 故障注入入口（仅测试与演练使用）；命中即让指定阶段失败
#   write_assets          内容提交之前中断（总库零改动）
#   write_assets_partial  内容提交到一半中断（部分内容已落盘）
#   write_registry        registry 写入之前中断（内容已落盘、registry 未更新）
#   write_history         终态记录写入之前中断（内容与 registry 均已落盘）
intake_apply_fault() {
  local stage="$1"
  if [ -n "${INTAKE_FAULT_STAGE:-}" ] && [ "${INTAKE_FAULT_STAGE}" = "$stage" ]; then
    return 0
  fi
  return 1
}

intake_apply_idempotency_key() {
  local material
  material="$(printf '%s' "$1" | jq -r '([.plan_id] + ([.actions[].action_id] | sort)) | join("|")' 2>/dev/null)"
  [ -n "$material" ] || material="unknown"
  intake_sha256_str "$material" | cut -c1-16
}

# 路径指纹：目录取清单指纹，文件取内容哈希，不存在为空
intake_apply_path_fingerprint() {
  intake_fingerprint_path "$1"
}

# 来源当前身份（与候选身份同构：mcp 为 "行为|凭据"）
intake_apply_source_identity() {
  local action="$1"
  local type resolved
  type="$(printf '%s' "$action" | jq -r '.asset_type // ""')"
  resolved="$(printf '%s' "$action" | jq -r '.source_paths[0].resolved_path // ""')"

  case "$type" in
    rule)
      if [ ! -f "$resolved" ]; then printf 'unreadable'; return 0; fi
      printf 'sha256:%s' "$(intake_sha256 "$resolved")"
      ;;
    skill)
      if [ ! -d "$resolved" ]; then printf 'unreadable'; return 0; fi
      printf 'sha256:%s' "$(intake_fingerprint_skill_dir "$resolved")"
      ;;
    mcp)
      local tool name one ident
      tool="$(printf '%s' "$action" | jq -r '.source_paths[0].tool // ""')"
      name="$(printf '%s' "$action" | jq -r '.asset_name // ""')"
      if [ ! -f "$resolved" ]; then printf 'unreadable'; return 0; fi
      one="$(intake_mcp_read_servers "$tool" "$resolved" | jq -c --arg n "$name" '.[$n] // null' 2>/dev/null)"
      if [ -z "$one" ] || [ "$one" = "null" ]; then printf 'unreadable'; return 0; fi
      ident="$(intake_mcp_server_identity "$one")"
      printf '%s|%s' "$(printf '%s' "$ident" | jq -r '.behavior_fingerprint')" \
                     "$(printf '%s' "$ident" | jq -r '.cred_fingerprint')"
      ;;
    *) printf 'unsupported' ;;
  esac
}

# 目标当前实际身份：规则/技能 = 规范源内容指纹；mcp = "行为指纹|凭据指纹"
# 与计划里的 target_content_fingerprint / target_cred_fingerprint 同口径
# 输出 "missing" / "unsafe" / "none" / 身份串
intake_apply_target_identity() {
  local action="$1" repo="$2"
  local type path fp
  type="$(printf '%s' "$action" | jq -r '.asset_type // ""')"
  path="$(printf '%s' "$action" | jq -r '.target_path // ""')"

  if [ -z "$path" ]; then printf 'none'; return 0; fi
  if ! intake_is_safe_rel_path "$path"; then printf 'unsafe'; return 0; fi

  if [ "$type" = "mcp" ]; then
    local name one ident
    name="$(printf '%s' "$action" | jq -r '.asset_name // ""')"
    one="$(intake_mcp_read_servers canonical "${repo}/.ai-workspace/mcp/mcp.json" \
      | jq -c --arg n "$name" '.[$n] // null' 2>/dev/null)"
    if [ -z "$one" ] || [ "$one" = "null" ]; then printf 'missing'; return 0; fi
    ident="$(intake_mcp_server_identity "$one")"
    printf '%s|%s' "$(printf '%s' "$ident" | jq -r '.behavior_fingerprint')" \
                   "$(printf '%s' "$ident" | jq -r '.cred_fingerprint')"
    return 0
  fi

  fp="$(intake_fingerprint_path "${repo}/${path}")"
  if [ -z "$fp" ]; then printf 'missing'; return 0; fi
  printf 'sha256:%s' "$fp"
}

# 计划里记录的目标身份，拼成与 intake_apply_target_identity 同口径的串
intake_apply_planned_target_identity() {
  local action="$1"
  printf '%s' "$action" | jq -r '
    if (.target_content_fingerprint // null) == null then "none"
    elif .asset_type == "mcp" then
      (.target_content_fingerprint + "|" + (.target_cred_fingerprint // ""))
    else .target_content_fingerprint end'
}

# 执行前复核：来源身份、目标版本与目标实际内容是否仍是计划时的状态
# 输出 {ok, stale:[{action_id, kind, reason}]}
# $3 = 待复核 action_id 数组（省略则复核全部动作；已提交内容的动作不参与复核）
intake_apply_preflight() {
  local plan="$1" repo="$2" pending="${3:-[]}"
  local registry stale="[]"

  registry="$(intake_registry_read "$repo")"

  local i n
  n="$(printf '%s' "$plan" | jq '.actions | length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local a kind aid now_ident planned_ident
    a="$(printf '%s' "$plan" | jq -c --argjson i "$i" '.actions[$i]')"
    if [ "$(printf '%s' "$pending" | jq --arg a "$(printf '%s' "$a" | jq -r '.action_id')" 'index($a) != null')" != "true" ]; then
      i=$((i + 1))
      continue
    fi
    kind="$(printf '%s' "$a" | jq -r '.kind')"
    aid="$(printf '%s' "$a" | jq -r '.action_id')"

    # 只记录决定，不读来源内容
    if [ "$kind" != "ignore" ] && [ "$kind" != "defer" ]; then
      now_ident="$(intake_apply_source_identity "$a")"
      if [ "$now_ident" != "$(printf '%s' "$a" | jq -r '.source_identity')" ]; then
        stale="$(printf '%s' "$stale" | jq -c --arg a "$aid" --arg k "$kind" --arg r "source_changed" \
          '. + [{action_id: $a, kind: $k, reason: $r}]')"
      fi
    fi

    if [ "$kind" = "link" ] || [ "$kind" = "update" ] || [ "$kind" = "variant" ]; then
      local tid snap nowv
      tid="$(printf '%s' "$a" | jq -r '.target_asset_id // ""')"
      snap="$(printf '%s' "$a" | jq -r '.target_version_snapshot // "none"')"
      nowv="$(printf '%s' "$registry" | jq -r --arg t "$tid" '.assets[$t].current_version // "none"')"
      if [ "$nowv" != "$snap" ]; then
        stale="$(printf '%s' "$stale" | jq -c --arg a "$aid" --arg k "$kind" --arg r "target_version_changed:${snap}->${nowv}" \
          '. + [{action_id: $a, kind: $k, reason: $r}]')"
      fi

      # 版本号没变但目标文件被手改：只比版本号会漏掉，必须比实际内容
      planned_ident="$(intake_apply_planned_target_identity "$a")"
      if [ "$planned_ident" != "none" ]; then
        local now_target
        now_target="$(intake_apply_target_identity "$a" "$repo")"
        if [ "$now_target" != "$planned_ident" ]; then
          stale="$(printf '%s' "$stale" | jq -c --arg a "$aid" --arg k "$kind" \
            --arg r "target_content_changed:${planned_ident}->${now_target}" \
            '. + [{action_id: $a, kind: $k, reason: $r}]')"
        fi
      fi
    fi

    i=$((i + 1))
  done

  jq -nc --argjson s "$stale" '{ok: (($s | length) == 0), stale: $s}'
}

intake_new_apply_id() {
  local ts rnd
  ts="$(date -u '+%Y%m%d-%H%M%S' 2>/dev/null || date '+%Y%m%d-%H%M%S')"
  rnd="$(od -An -N3 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | cut -c1-6)"
  [ -n "$rnd" ] || rnd="$$"
  printf 'apply-%s-%s\n' "$ts" "$rnd"
}

# ============================================================================
# 主入口
# ============================================================================

# Usage: intake_apply
#   INTAKE_REPO        总库路径（必需）
#   INTAKE_PLAN_FILE   人工审核计划文件（必需）
#   INTAKE_RESUME      1 = 允许从既有部分执行继续（可选）
#   INTAKE_CANCEL_FILE 取消文件（可选）
#   INTAKE_FAULT_STAGE 故障注入（测试用）
# 输出: ApplyBatch JSON 到 stdout；人类可读信息到 stderr
intake_apply() {
  local repo="${INTAKE_REPO:-}" plan_file="${INTAKE_PLAN_FILE:-}"
  local resume="${INTAKE_RESUME:-0}"

  [ -n "$repo" ] || die "intake apply: 必须指定 --repo（总库路径）"
  [ -n "$plan_file" ] || die "intake apply: 必须指定 --plan（审核计划文件）"
  [ -f "$plan_file" ] || die "intake apply: 计划文件不存在: $plan_file"
  [ -d "$repo" ] || die "intake apply: repo 目录不存在: $repo"

  local plan plan_id batch_id
  plan="$(cat "$plan_file")"
  if ! printf '%s' "$plan" | jq -e '.plan_id and (.actions | type == "array")' >/dev/null 2>&1; then
    die "intake apply: 计划文件格式非法: $plan_file"
  fi
  plan_id="$(printf '%s' "$plan" | jq -r '.plan_id')"
  batch_id="$(printf '%s' "$plan" | jq -r '.batch_id // ""')"

  # ---- 门禁：计划过期与未处理项（apply 是唯一写入入口） ----
  local expires now unresolved
  expires="$(printf '%s' "$plan" | jq -r '.expires_at // ""')"
  now="$(intake_now)"
  if [ -n "$expires" ] && intake_iso_gt "$now" "$expires"; then
    die "intake apply: 计划已过期（expires_at=${expires}），请重新生成计划"
  fi
  unresolved="$(printf '%s' "$plan" | jq '.unresolved // [] | length')"
  if [ "$unresolved" != "0" ]; then
    die "intake apply: 计划仍有 ${unresolved} 项未处理的冲突或无法解析候选，拒绝写入"
  fi

  local key
  key="$(intake_apply_idempotency_key "$plan")"

  # 锁路径必须是全局变量：EXIT trap 在子 shell 退出时才触发，
  # 那时函数内的 local 已离开作用域，trap 会拿到空值而漏释放。
  if ! INTAKE_APPLY_LOCK="$(intake_lock_acquire "$repo" "repo" "apply" "$plan_id")"; then
    die "intake apply: 总库已有执行中的操作，请稍后重试"
  fi
  trap 'intake_lock_release "$INTAKE_APPLY_LOCK"' EXIT INT TERM

  # ---- 续跑：复用上一轮未完成执行的 apply_id、备份基线与已算好的 registry 变更 ----
  local prior
  prior="$(intake_history_inflight_for_key "$repo" "$key")"
  local apply_id
  if [ "$prior" != "null" ]; then
    if [ "$resume" != "1" ]; then
      die "intake apply: 该计划上次执行未完成（apply_id=$(printf '%s' "$prior" | jq -r '.apply_id')）；确认后加 --resume 继续未完成项"
    fi
    apply_id="$(printf '%s' "$prior" | jq -r '.apply_id')"
  else
    apply_id="$(intake_new_apply_id)"
  fi

  local registry_before started
  if [ "$prior" != "null" ]; then
    registry_before="$(printf '%s' "$prior" | jq -r '.registry_version_before // 0')"
    started="$(printf '%s' "$prior" | jq -r '.started_at // ""')"
  else
    registry_before="$(intake_registry_read "$repo" | jq -r '.version_counter // 0')"
    started="$now"
  fi
  [ -n "$started" ] || started="$now"

  local common
  common="$(intake_apply_common_fields "$apply_id" "$plan_id" "$batch_id" "$repo" "$key" \
    "$started" "$now" "$registry_before" "$registry_before")"

  # ---- 幂等：已成功应用的动作不再复核、不再写入 ----
  local applied pending
  applied="$(intake_history_applied_actions "$repo" "$key")"
  pending="$(printf '%s' "$plan" | jq -c --argjson a "$applied" \
    '[.actions[] | select((([.action_id] | inside($a)) | not)) | .action_id]')"

  if [ "$(printf '%s' "$pending" | jq 'length')" = "0" ]; then
    printf '%s\n' "$(intake_apply_build_record "$repo" "already_applied" "$(printf '%s' "$common" | jq -c \
      --argjson stages "$(intake_apply_stages ok skipped skipped skipped)" \
      --argjson a "$applied" \
      '. + {stages: $stages, applied_actions: $a}')" print)"
    return 0
  fi

  # 上一次是明确失败（未进入提交）时也要求显式 --resume
  if [ "$prior" = "null" ] && [ "$resume" != "1" ]; then
    local latest lstatus
    latest="$(intake_history_latest_for_key "$repo" "$key")"
    if [ "$latest" != "null" ]; then
      lstatus="$(printf '%s' "$latest" | jq -r '.status // ""')"
      if [ "$lstatus" = "failed" ]; then
        die "intake apply: 该计划上次执行失败（apply_id=$(printf '%s' "$latest" | jq -r '.apply_id')）；确认后加 --resume 继续未完成项"
      fi
    fi
  fi

  # 上次已经提交过内容的动作：本轮不再复核（它们的目标已被我们改写过），
  # 但仍要参与 registry 阶段，所以 pending 保持全量。
  local content_committed="[]" prior_files="[]" prior_versions="[]"
  local prior_upserts="[]" prior_decisions="[]" assets_done="pending" registry_done="pending"
  if [ "$prior" != "null" ]; then
    content_committed="$(printf '%s' "$prior" | jq -c '.content_committed_actions // []')"
    prior_files="$(printf '%s' "$prior" | jq -c '.files // []')"
    prior_versions="$(printf '%s' "$prior" | jq -c '.created_versions // []')"
    prior_upserts="$(printf '%s' "$prior" | jq -c '.upserts // []')"
    prior_decisions="$(printf '%s' "$prior" | jq -c '.decisions // []')"
    assets_done="$(printf '%s' "$prior" | jq -r '[.stages[] | select(.stage == "write_assets")][0].status // "pending"')"
    registry_done="$(printf '%s' "$prior" | jq -r '[.stages[] | select(.stage == "write_registry")][0].status // "pending"')"
  fi

  # ---- preflight：只复核本轮真正要动手的动作 ----
  local check_ids
  check_ids="$(printf '%s' "$pending" | jq -c --argjson done "$content_committed" '[.[] | select(([.] | inside($done)) | not)]')"

  if [ "$assets_done" != "ok" ] && [ "$(printf '%s' "$check_ids" | jq 'length')" != "0" ]; then
    local pf
    pf="$(intake_apply_preflight "$plan" "$repo" "$check_ids")"
    if [ "$(printf '%s' "$pf" | jq -r '.ok')" != "true" ]; then
      printf '%s\n' "$(intake_apply_build_record "$repo" "failed" "$(printf '%s' "$common" | jq -c \
        --argjson st "$(printf '%s' "$pf" | jq -c '.stale')" \
        --argjson stages "$(intake_apply_stages failed skipped skipped ok)" \
        '. + {stages: $stages, failed_actions: $st, errors: ["preflight_failed"]}')")"
      log_error "intake apply: 执行前复核未通过，未写入任何内容；请重新生成计划"
      printf '%s' "$pf" | jq -r '.stale[] | "  [\(.reason)] \(.kind // "-") \(.action_id // "-")"' >&2
      return 1
    fi
  fi

  # ---- write_assets：暂存 → 取消检查 → 提交内容与版本 ----
  local staging files created_versions upserts decisions
  if [ "$assets_done" = "ok" ]; then
    # 上一轮内容与版本已落盘：直接复用持久化的结果与 registry 变更
    files="$prior_files"
    created_versions="$prior_versions"
    upserts="$prior_upserts"
    decisions="$prior_decisions"
    staging="$(intake_staging_dir "$repo" "$apply_id")"
  else
    staging="$(intake_staging_dir "$repo" "$apply_id")"
    rm -rf "$staging"
    mkdir -p "$staging"
    local collected
    collected="$(intake_apply_collect "$plan" "$repo" "$staging" "$apply_id" \
      "$(printf '%s' "$prior_files" | jq -c '[.[].rel]' 2>/dev/null || echo '[]')")"

    if [ "$(printf '%s' "$collected" | jq '.errors | length')" != "0" ]; then
      printf '%s\n' "$(intake_apply_build_record "$repo" "failed" "$(printf '%s' "$common" | jq -c \
        --argjson e "$(printf '%s' "$collected" | jq -c '.errors')" \
        --argjson stages "$(intake_apply_stages ok failed skipped ok)" \
        '. + {stages: $stages, failed_actions: $e, errors: [$e[].error]}')")"
      log_error "intake apply: 暂存阶段失败，未写入总库；暂存保留于 ${staging}"
      printf '%s' "$collected" | jq -r '.errors[] | "  [\(.error)] \(.action_id)"' >&2
      return 1
    fi

    if [ -n "${INTAKE_CANCEL_FILE:-}" ] && [ -f "${INTAKE_CANCEL_FILE}" ]; then
      printf '%s\n' "$(intake_apply_build_record "$repo" "cancelled" "$(printf '%s' "$common" | jq -c \
        --argjson stages "$(intake_apply_stages ok skipped skipped ok)" \
        '. + {stages: $stages}')")"
      log_warn "intake apply: 已取消，未批准任何资产"
      return 0
    fi

    if intake_apply_fault "write_assets"; then
      printf '%s\n' "$(intake_apply_build_record "$repo" "failed" "$(printf '%s' "$common" | jq -c \
        --argjson stages "$(intake_apply_stages ok failed skipped ok)" \
        --argjson e '[{"action_id": null, "error": "fault_injected_write_assets"}]' \
        '. + {stages: $stages, failed_actions: $e, errors: ["fault_injected_write_assets"]}')")"
      log_error "intake apply: write_assets 阶段故障；总库未改动，暂存保留于 ${staging}"
      return 1
    fi

    local ops fault_at commit partial
    ops="$(printf '%s' "$collected" | jq -c '.ops')"
    fault_at=0
    if intake_apply_fault "write_assets_partial"; then fault_at=1; fi

    commit="$(intake_apply_commit_content "$repo" "$apply_id" "$ops" "$staging" "$prior_files" "$fault_at")"
    files="$(printf '%s' "$commit" | jq -c '.files')"
    partial="$(printf '%s' "$commit" | jq -r '.partial')"

    created_versions="$(intake_apply_commit_versions "$repo" "$apply_id" \
      "$(printf '%s' "$collected" | jq -c '.version_writes')")"
    upserts="$(printf '%s' "$collected" | jq -c '.updates')"
    decisions="$(printf '%s' "$collected" | jq -c '.decisions')"

    # 提交一开始就把状态与基线落盘：崩溃/中断后能看出"做了什么、还剩什么"
    local jerr
    jerr="$(printf '%s' "$commit" | jq -c '.errors')"
    # 已提交内容的动作：以实际落盘的文件为准（部分提交时只记真正写过的那些）
    content_committed="$(jq -nc --argjson f "$files" --argjson o "$ops" '
      ($f | map(.rel)) as $rels
      | [$o[] | select(.rel as $r | ($rels | index($r)) != null)
              | (.action_id // empty), ((.action_ids // [])[])]
      | unique')"
    local journal
    journal="$(printf '%s' "$common" | jq -c \
      --argjson stages "$(intake_apply_stages ok "$([ "$partial" = "true" ] && echo failed || echo ok)" pending pending)" \
      --argjson f "$files" --argjson cv "$created_versions" \
      --argjson up "$upserts" --argjson de "$decisions" \
      --argjson cca "$content_committed" \
      --argjson e "$jerr" \
      '. + {stages: $stages, files: $f, created_versions: $cv, upserts: $up,
            decisions: $de, content_committed_actions: $cca, errors: $e}')"
    intake_apply_build_record "$repo" "incomplete" "$journal" persist >/dev/null

    if [ "$partial" = "true" ] || [ "$(printf '%s' "$jerr" | jq 'length')" != "0" ]; then
      printf '%s\n' "$(intake_apply_build_record "$repo" "incomplete" "$journal" print)"
      log_error "intake apply: 内容提交中断，已在执行记录中保留状态与备份基线；确认后加 --resume 继续"
      printf '%s' "$jerr" | jq -r '.[] | "  \(.)"' >&2
      return 1
    fi
  fi

  # ---- write_registry：并发检测后原子替换 ----
  local registry_now counter_now registry_new
  if [ "$registry_done" = "ok" ]; then
    registry_now="$(intake_registry_read "$repo")"
    registry_new="$registry_now"
  else
    registry_now="$(intake_registry_read "$repo")"
    counter_now="$(printf '%s' "$registry_now" | jq -r '.version_counter // 0')"
    if [ "$counter_now" != "$registry_before" ]; then
      local cj
      cj="$(printf '%s' "$common" | jq -c \
        --argjson stages "$(intake_apply_stages ok ok failed ok)" \
        --argjson f "$files" --argjson cv "$created_versions" \
        --argjson up "$upserts" --argjson de "$decisions" \
        --argjson cca "$content_committed" \
        '. + {stages: $stages, files: $f, created_versions: $cv, upserts: $up,
              decisions: $de, content_committed_actions: $cca,
              errors: ["concurrent_write_detected"]}')"
      intake_apply_build_record "$repo" "incomplete" "$cj" persist >/dev/null
      die "intake apply: 检测到并发写入（registry ${registry_before} -> ${counter_now}）；已中止且未替换 registry"
    fi

    if intake_apply_fault "write_registry"; then
      local rj
      rj="$(printf '%s' "$common" | jq -c \
        --argjson stages "$(intake_apply_stages ok ok failed ok)" \
        --argjson f "$files" --argjson cv "$created_versions" \
        --argjson up "$upserts" --argjson de "$decisions" \
        --argjson cca "$content_committed" \
        '. + {stages: $stages, files: $f, created_versions: $cv, upserts: $up,
              decisions: $de, content_committed_actions: $cca,
              errors: ["fault_injected_write_registry", "content_written_registry_missing"]}')"
      printf '%s\n' "$(intake_apply_build_record "$repo" "incomplete" "$rj" print)"
      log_error "intake apply: registry 写入故障；内容已落盘但 registry 未更新，请用 --resume 补齐"
      return 1
    fi

    registry_new="$(intake_apply_registry_merge "$registry_now" "$upserts" "$(intake_now)")"
    intake_registry_write "$repo" "$registry_new"

    export AIWS_DIR="${repo}/.ai-workspace"
    intake_apply_register_mappings "$upserts"
    if [ -n "$batch_id" ]; then
      intake_apply_write_decisions "$repo" "$batch_id" "$decisions"
    fi

    local rj2
    rj2="$(printf '%s' "$common" | jq -c \
      --argjson stages "$(intake_apply_stages ok ok ok pending)" \
      --argjson f "$files" --argjson cv "$created_versions" \
      --argjson up "$upserts" --argjson de "$decisions" \
      --argjson cca "$content_committed" \
      --argjson ra "$(printf '%s' "$registry_new" | jq '.version_counter')" \
      '. + {stages: $stages, files: $f, created_versions: $cv, upserts: $up,
            decisions: $de, content_committed_actions: $cca,
            registry_version_after: $ra}')"
    intake_apply_build_record "$repo" "incomplete" "$rj2" persist >/dev/null
  fi

  # ---- write_history：终态记录 ----
  if intake_apply_fault "write_history"; then
    local wj
    wj="$(printf '%s' "$common" | jq -c \
      --argjson stages "$(intake_apply_stages ok ok ok failed)" \
      --argjson f "$files" --argjson cv "$created_versions" \
      --argjson up "$upserts" --argjson de "$decisions" \
      --argjson cca "$content_committed" \
      --argjson ra "$(printf '%s' "$registry_new" | jq '.version_counter')" \
      '. + {stages: $stages, files: $f, created_versions: $cv, upserts: $up,
            decisions: $de, content_committed_actions: $cca,
            registry_version_after: $ra,
            errors: ["fault_injected_write_history", "registry_written_history_missing"]}')"
    intake_apply_build_record "$repo" "incomplete" "$wj" persist >/dev/null
    printf '%s\n' "$(intake_apply_build_record "$repo" "incomplete" "$wj" print)"
    log_error "intake apply: 终态记录写入故障；内容与 registry 均已落盘，请用 --resume 补齐记录"
    return 1
  fi

  local applied_now
  applied_now="$(jq -nc --argjson a "$applied" --argjson n "$pending" '$a + $n | unique')"

  printf '%s\n' "$(intake_apply_build_record "$repo" "ok" "$(printf '%s' "$common" | jq -c \
    --arg fin "$(intake_now)" \
    --argjson ra "$(printf '%s' "$registry_new" | jq '.version_counter')" \
    --argjson stages "$(intake_apply_stages ok ok ok ok)" \
    --argjson a "$applied_now" --argjson f "$files" \
    --argjson cv "$created_versions" \
    --argjson ca "$(printf '%s' "$upserts" | jq -c '[.[] | .asset_id] | unique')" \
    '. + {finished_at: $fin, registry_version_after: $ra, stages: $stages,
          applied_actions: $a, files: $f, created_assets: $ca, created_versions: $cv}')")"
}
