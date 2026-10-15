#!/bin/sh
# intake/recover.sh - 执行记录组装、状态查询与受约束回退
# 需先 source common.sh / intake/identity.sh / intake/store.sh
#
# 设计约束（design 8.3、spec 5.5）：
#   1. 回退仅作用于该批次实际改动的文件
#   2. 目标已被批次之后的修改改变时报告冲突，绝不覆盖
#   3. 保留旧版本不等于自动恢复旧版到各处；回退只作用于总库本批次的写入
#   4. 回退本身留痕：在历史记录中登记回退状态与冲突项

# ISO8601(UTC) 字符串比较：$1 晚于 $2 返回 0
intake_iso_gt() {
  local a="$1" b="$2" max
  if [ "$a" = "$b" ]; then
    return 1
  fi
  max="$(printf '%s\n%s\n' "$a" "$b" | LC_ALL=C sort | tail -n 1)"
  if [ "$max" = "$a" ]; then
    return 0
  fi
  return 1
}

# ApplyBatch 的公共字段
# $1=apply_id $2=plan_id $3=batch_id $4=repo $5=idempotency_key
# $6=started_at $7=finished_at $8=registry_before $9=registry_after
intake_apply_common_fields() {
  jq -nc --arg ap "$1" --arg pl "$2" --arg b "$3" --arg r "$4" --arg k "$5" \
    --arg at "$6" --arg fin "$7" --argjson rb "${8:-0}" --argjson ra "${9:-0}" \
    '{apply_id: $ap, plan_id: $pl, batch_id: $b, repo: $r, idempotency_key: $k,
      started_at: $at, finished_at: $fin,
      registry_version_before: $rb, registry_version_after: $ra}'
}

# 阶段表；四个参数为 preflight / write_assets / write_registry / write_history 的状态
intake_apply_stages() {
  jq -nc --arg a "$1" --arg b "$2" --arg c "$3" --arg d "$4" '[
    {stage: "preflight", status: $a, detail: ""},
    {stage: "write_assets", status: $b, detail: ""},
    {stage: "write_registry", status: $c, detail: ""},
    {stage: "write_history", status: $d, detail: ""}]'
}

# 组装 ApplyBatch 记录；$4=persist 时写入历史，否则只输出（如「已执行过」的查询结果）
# $1=repo $2=status $3=字段 JSON（公共字段 + 本次覆盖）
intake_apply_build_record() {
  local repo="$1" status="$2" fields="$3" persist="${4:-persist}" rec
  rec="$(printf '%s' "$fields" | jq -c --arg schema "intake/v1" --arg st "$status" '
    {
      schema: $schema, status: $st,
      apply_id, plan_id, batch_id, repo, idempotency_key, started_at, finished_at,
      registry_version_before, registry_version_after,
      stages: (.stages // []),
      applied_actions: (.applied_actions // []),
      failed_actions: (.failed_actions // []),
      files: (.files // []),
      created_assets: (.created_assets // []),
      created_versions: (.created_versions // []),
      errors: (.errors // []),
      # 续跑依据：已提交内容的动作、当时算好的 registry 变更与决定记录
      content_committed_actions: (.content_committed_actions // []),
      upserts: (.upserts // []),
      decisions: (.decisions // [])
    }')"
  if [ "$persist" = "persist" ]; then
    intake_history_write "$repo" "$(printf '%s' "$rec" | jq -r '.apply_id')" "$rec"
  fi
  printf '%s' "$rec"
}

# 查询计划或批次状态：汇总进度、历史与（若存在）冲突
intake_apply_status() {
  local repo="${INTAKE_REPO:-}" plan_id="${INTAKE_PLAN_ID:-}" batch_id="${INTAKE_BATCH_ID:-}"
  [ -n "$repo" ] || die "intake status: 必须指定 --repo（总库路径）"
  # plan_id / batch_id 为空表示"查询总库全部历史"，不是错误

  local plans="[]"
  if [ -n "$plan_id" ]; then
    plans="$(jq -nc --argjson p "$(intake_plan_read "$repo" "$plan_id")" \
      --argjson pr "$(intake_plan_progress_read "$repo" "$plan_id")" '[$p + {progress: $pr}]')"
  fi

  local histories="[]"
  local dir
  dir="$(intake_history_dir "$repo")"
  if [ -d "$dir" ]; then
    histories="$(for f in "${dir}"/*.json; do
      [ -f "$f" ] || continue
      cat "$f"
    done | jq -s -c --arg p "$plan_id" --arg b "$batch_id" '
      map(select((($p == "") or (.plan_id == $p)) and (($b == "") or (.batch_id == $b)))
          | {apply_id, plan_id, batch_id, status, started_at, finished_at,
             applied_actions: ((.applied_actions // []) | length),
             failed_actions: ((.failed_actions // []) | length),
             rollback: (.rollback // null)})'
    )"
  fi

  jq -nc --argjson plans "$plans" --argjson histories "$histories" \
    '{schema: "intake/v1", plans: $plans, apply_history: $histories}'
}

# 受约束回退：先整体判定可行性，可行才动手
# 规则：
#   1. 先扫描全部文件与 registry，任一冲突 → 整批不回退（绝不留下"内容与登记版本不一致"）
#   2. 已经回退过的路径按幂等处理（当前内容 == 回退目标），不当作冲突
#   3. 后续批次推进过 registry → 冲突，不动任何文件
#   4. 重复回退幂等；回退中断后重跑按同样的可行性判定继续
intake_apply_rollback() {
  local repo="${INTAKE_REPO:-}" apply_id="${INTAKE_APPLY_ID:-}"
  [ -n "$repo" ] || die "intake rollback: 必须指定 --repo（总库路径）"
  [ -n "$apply_id" ] || die "intake rollback: 必须指定 --apply（执行 ID）"

  local h
  h="$(intake_history_read "$repo" "$apply_id")"
  if printf '%s' "$h" | jq -e '.error == "history_not_found"' >/dev/null 2>&1; then
    die "intake rollback: 找不到执行记录: $apply_id"
  fi

  if ! INTAKE_APPLY_LOCK="$(intake_lock_acquire "$repo" "repo" "rollback" "$apply_id")"; then
    die "intake rollback: 总库已有执行中的操作，请稍后重试"
  fi
  trap 'intake_lock_release "$INTAKE_APPLY_LOCK"' EXIT INT TERM

  local backup_root="${repo}/.ai-workspace/assets/history/${apply_id}.backup"
  local actions="[]" conflicts="[]" n i
  n="$(printf '%s' "$h" | jq '.files | length' 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    local f rel abs expect before bak now state
    f="$(printf '%s' "$h" | jq -c --argjson i "$i" '.files[$i]')"
    rel="$(printf '%s' "$f" | jq -r '.rel')"
    expect="$(printf '%s' "$f" | jq -r '.after_fingerprint // ""')"
    before="$(printf '%s' "$f" | jq -r '.before_fingerprint // ""')"
    state="ok"

    if ! abs="$(intake_repo_abs_path "$repo" "$rel")"; then
      state="unsafe_path"
    else
      bak="${backup_root}/${rel}"
      now="$(intake_apply_path_fingerprint "$abs")"
      if [ "$now" = "$expect" ]; then
        state="ok"
      elif [ -z "$before" ] && [ ! -e "$abs" ]; then
        state="already"                     # 本批次新建的路径，已经删掉了
      elif [ -n "$before" ] && [ "$now" = "$before" ]; then
        state="already"                     # 已经还原成回退前的样子
      else
        state="conflict"
      fi
      if [ "$state" = "ok" ] && [ -n "$before" ] && [ ! -e "$bak" ]; then
        state="conflict"
        conflicts="$(printf '%s' "$conflicts" | jq -c --arg r "$rel" \
          '. + [{rel: $r, reason: "backup_missing", current: null, expected: null}]')"
      fi
    fi

    if [ "$state" = "conflict" ] && [ -z "$(printf '%s' "$conflicts" | jq -r --arg r "$rel" '.[] | select(.rel == $r) | .rel')" ]; then
      local cur
      cur="$(intake_apply_path_fingerprint "${repo}/${rel}")"
      conflicts="$(printf '%s' "$conflicts" | jq -c --arg r "$rel" --arg n "$cur" --arg e "$expect" \
        '. + [{rel: $r, reason: "modified_after_apply", current: $n, expected: $e}]')"
    fi

    actions="$(printf '%s' "$actions" | jq -c --argjson f "$f" --arg s "$state" \
      '. + [{rel: ($f.rel), before_fingerprint: ($f.before_fingerprint // null),
             after_fingerprint: $f.after_fingerprint, state: $s}]')"
    i=$((i + 1))
  done

  # registry 可行性：只有在本批次改动前后之间才允许回退
  local reg_before reg_now rb_after rb_before reg_state
  reg_before="${backup_root}/registry.before.json"
  rb_after="$(printf '%s' "$h" | jq -r '.registry_version_after // 0')"
  rb_before="$(printf '%s' "$h" | jq -r '.registry_version_before // 0')"
  rb_now="$(intake_registry_read "$repo" | jq -r '.version_counter // 0')"
  reg_state="ok"
  if [ "$rb_now" = "$rb_after" ]; then
    reg_state="ok"
  elif [ "$rb_now" = "$rb_before" ]; then
    reg_state="already"
  else
    reg_state="conflict"
    conflicts="$(printf '%s' "$conflicts" | jq -c --arg n "$rb_now" --arg e "$rb_after" \
      '. + [{rel: ".ai-workspace/assets/registry.json", reason: "registry_advanced",
             current: $n, expected: $e}]')"
  fi

  local at status="rolled_back" restored="[]"
  at="$(intake_now)"

  if [ "$(printf '%s' "$conflicts" | jq 'length')" != "0" ]; then
    # 存在冲突：整批不动，绝不留下内容与登记版本不一致的状态
    status="rollback_conflict"
    local cj
    cj="$(printf '%s' "$h" | jq -c --arg at "$at" --arg st "$status" --argjson c "$conflicts" \
      --argjson a "$actions" \
      '. + {rollback: {status: $st, at: $at, restored: [], conflicts: $c, skipped: $a}}')"
    intake_history_write "$repo" "$apply_id" "$cj"
    printf '%s\n' "$cj"
    log_error "intake rollback: 检测到批次之后的修改或 registry 推进，整批未回退（未覆盖任何内容）"
    printf '%s' "$conflicts" | jq -r '.[] | "  [\(.reason)] \(.rel)"' >&2
    return 1
  fi

  # 可行性已确认：先内容、后 registry
  i=0
  while [ "$i" -lt "$(printf '%s' "$actions" | jq 'length')" ]; do
    local act rel before state abs bak
    act="$(printf '%s' "$actions" | jq -c --argjson i "$i" '.[$i]')"
    rel="$(printf '%s' "$act" | jq -r '.rel')"
    before="$(printf '%s' "$act" | jq -r '.before_fingerprint // ""')"
    state="$(printf '%s' "$act" | jq -r '.state')"
    i=$((i + 1))
    [ "$state" = "ok" ] || continue

    abs="$(intake_repo_abs_path "$repo" "$rel")" || continue
    bak="${backup_root}/${rel}"
    if [ -n "$before" ]; then
      rm -rf "$abs"
      mkdir -p "$(dirname "$abs")"
      if [ -d "$bak" ]; then
        cp -R "$bak" "$abs"
      else
        cp "$bak" "$abs"
      fi
    else
      rm -rf "$abs"
    fi
    restored="$(printf '%s' "$restored" | jq -c --arg r "$rel" '. + [$r]')"
  done

  if [ "$reg_state" = "ok" ]; then
    if [ -f "$reg_before" ]; then
      cp "$reg_before" "$(intake_registry_path "$repo")"
    else
      rm -f "$(intake_registry_path "$repo")"
    fi
    restored="$(printf '%s' "$restored" | jq -c '. + [".ai-workspace/assets/registry.json"]')"
  fi

  local updated
  updated="$(printf '%s' "$h" | jq -c --arg at "$at" --arg st "$status" \
    --argjson r "$restored" --argjson a "$actions" \
    '. + {rollback: {status: $st, at: $at, restored: $r, conflicts: [], skipped: $a}}')"
  intake_history_write "$repo" "$apply_id" "$updated"
  printf '%s\n' "$updated"
}
