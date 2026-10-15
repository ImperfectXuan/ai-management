#!/bin/sh
# intake/store.sh - 本地批次记录区读写
# 供 intake/scan.sh 与 CLI 调用；需先 source common.sh
#
# 批次目录: <repo>/.ai-workspace/intake/batches/<batch-id>/
# 该目录应在 .gitignore 中（机器本地草稿）

INTAKE_DIR_REL="intake"
INTAKE_BATCHES_REL="intake/batches"

# 解析批次目录（在总库下）
intake_batch_dir() {
  local repo="$1" batch_id="$2"
  echo "${repo}/.ai-workspace/${INTAKE_BATCHES_REL}/${batch_id}"
}

# 创建批次目录
intake_batch_init() {
  local dir
  dir="$(intake_batch_dir "$1" "$2")"
  mkdir -p "$dir"
  echo "$dir"
}

# 写 scan.json 到批次目录
intake_batch_write_scan() {
  local repo="$1" batch_id="$2" json="$3"
  local dir
  dir="$(intake_batch_init "$repo" "$batch_id")"
  printf '%s\n' "$json" > "${dir}/scan.json"
}

# 读批次 scan.json
intake_batch_read_scan() {
  local repo="$1" batch_id="$2"
  local dir
  dir="$(intake_batch_dir "$repo" "$batch_id")"
  if [ -f "${dir}/scan.json" ]; then
    cat "${dir}/scan.json"
  else
    echo '{"schema":"intake/v1","error":"batch_not_found"}'
  fi
}

# 列出所有批次（按时间倒序）
intake_batch_list() {
  local repo="$1"
  local batches_dir="${repo}/.ai-workspace/${INTAKE_BATCHES_REL}"
  if [ ! -d "$batches_dir" ]; then
    echo "[]"
    return
  fi
  # 只列有 scan.json 的目录
  local d
  for d in "${batches_dir}"/*/; do
    [ -d "$d" ] || continue
    [ -f "${d}scan.json" ] || continue
    basename "${d%/}"
  done | sort -r | jq -R -s 'split("\n") | map(select(length > 0))'
}

# 确保 intake/ 目录被 .gitignore 排除（不写入来源，只检查）
intake_check_gitignore() {
  local repo="$1"
  local gi="${repo}/.gitignore"
  if [ -f "$gi" ] && grep -q '^\.ai-workspace/intake/' "$gi" 2>/dev/null; then
    return 0
  fi
  return 1
}

# ============================================================================
# 候选与审核决定记录（本地记录区，绝不写入总库规范源）
# ============================================================================

INTAKE_DECISIONS_REL="intake/decisions"

# 写 candidates.json 到批次目录
intake_batch_write_candidates() {
  local repo="$1" batch_id="$2" json="$3"
  local dir
  dir="$(intake_batch_init "$repo" "$batch_id")"
  printf '%s\n' "$json" > "${dir}/candidates.json"
}

# 读批次 candidates.json
intake_batch_read_candidates() {
  local repo="$1" batch_id="$2"
  local dir
  dir="$(intake_batch_dir "$repo" "$batch_id")"
  if [ -f "${dir}/candidates.json" ]; then
    cat "${dir}/candidates.json"
  else
    echo '{"schema":"intake/v1","error":"candidates_not_found"}'
  fi
}

# 审核决定目录（按批次分文件，design 3.1）
intake_decisions_dir() {
  echo "${1}/.ai-workspace/${INTAKE_DECISIONS_REL}"
}

# 追加一条审核决定；同一候选重复记录时覆盖旧记录（保留最新决定）
# $1=repo $2=batch_id $3=决定 JSON
#   必需: kind(ignore|defer)、candidate_id、content_fingerprint_at_decision
#   来源版本: occurrence_ids（design 3.6 的 occurrence_id 作为首来源保留，兼容旧记录）
intake_decision_write() {
  local repo="$1" batch_id="$2" decision="$3"
  local dir file
  dir="$(intake_decisions_dir "$repo")"
  file="${dir}/${batch_id}.json"
  mkdir -p "$dir"

  # 补齐 design 3.6 的单数 occurrence_id 字段，便于旧消费方读取
  decision="$(printf '%s' "$decision" | jq -c '
    if (.occurrence_id // "") == "" then
      . + {occurrence_id: ((.occurrence_ids // [])[0] // "")}
    else . end')"

  local key
  key="$(printf '%s' "$decision" | jq -r '.candidate_id // .occurrence_id // ""')"
  if [ -z "$key" ]; then
    die "intake_decision_write: 决定缺少 candidate_id / occurrence_id"
  fi

  local current='[]'
  if [ -f "$file" ]; then
    current="$(cat "$file")"
  fi

  printf '%s' "$current" | jq -c --argjson d "$decision" --arg k "$key" \
    '[.[] | select((.candidate_id // .occurrence_id // "") != $k)] + [$d]' > "${file}.tmp"
  mv "${file}.tmp" "$file"
}

# 列出全部审核决定（跨批次），同一候选只保留 decided_at 最新的一条
# 输出: JSON 数组
intake_decision_list() {
  local repo="$1"
  local dir
  dir="$(intake_decisions_dir "$repo")"

  if [ ! -d "$dir" ]; then
    echo '[]'
    return 0
  fi

  local f
  for f in "${dir}"/*.json; do
    [ -f "$f" ] || continue
    cat "$f"
  done | jq -s -c 'map(if type == "array" then . else [] end) | add // []
    | group_by(.candidate_id // .occurrence_id // "")
    | map(sort_by(.decided_at // "") | last)'
}

# 查某个候选的当前决定；无则输出空
intake_decision_find() {
  local repo="$1" candidate_id="$2"
  intake_decision_list "$repo" | jq -c --arg c "$candidate_id" '[.[] | select(.candidate_id == $c)] | last // empty'
}

# ============================================================================
# 审核计划、资产版本库、执行历史与执行锁
# 总库共享部分（assets/）纳入 Git；计划/锁/暂存属本地记录区
# ============================================================================

intake_now() {
  date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ'
}

INTAKE_PLANS_REL="intake/plans"
INTAKE_LOCKS_REL="intake/locks"
INTAKE_STAGING_REL="intake/staging"
INTAKE_ASSETS_REL="assets"
INTAKE_HISTORY_REL="assets/history"

# ---- 审核计划 ----

intake_plan_dir() { echo "${1}/.ai-workspace/${INTAKE_PLANS_REL}"; }
intake_plan_path() { echo "$(intake_plan_dir "$1")/$2.json"; }
intake_plan_progress_path() { echo "$(intake_plan_dir "$1")/$2.progress.json"; }

intake_plan_write() {
  local repo="$1" plan_id="$2" json="$3"
  mkdir -p "$(intake_plan_dir "$repo")"
  printf '%s\n' "$json" > "$(intake_plan_path "$repo" "$plan_id")"
}

intake_plan_read() {
  local repo="$1" plan_id="$2" f
  f="$(intake_plan_path "$repo" "$plan_id")"
  if [ -f "$f" ]; then
    cat "$f"
  else
    printf '{"schema":"intake/v1","error":"plan_not_found"}\n'
  fi
}

# 阶段进度检查点（崩溃恢复依据，design 8.3）
intake_plan_progress_write() {
  local repo="$1" plan_id="$2" json="$3"
  mkdir -p "$(intake_plan_dir "$repo")"
  printf '%s\n' "$json" > "$(intake_plan_progress_path "$repo" "$plan_id")"
}

intake_plan_progress_read() {
  local repo="$1" plan_id="$2" f
  f="$(intake_plan_progress_path "$repo" "$plan_id")"
  if [ -f "$f" ]; then
    cat "$f"
  else
    printf '{"schema":"intake/v1","error":"progress_not_found"}\n'
  fi
}

# ---- 执行锁 ----

intake_lock_file() { echo "${1}/.ai-workspace/${INTAKE_LOCKS_REL}/$2.lock"; }

# 锁文件年龄（秒）；无法读取 mtime 时返回 0，宁可视为新锁也不误抢占
intake_lock_age_seconds() {
  local lock="$1" mtime
  mtime="$(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || echo '')"
  if [ -z "$mtime" ]; then
    printf '0'
    return 0
  fi
  printf '%s' "$(($(date +%s) - mtime))"
}

# 获取执行锁；成功时输出锁文件路径
# $1=repo $2=scope（repo / deploy:<target>）$3=operation $4=ref
intake_lock_acquire() {
  local repo="$1" scope="$2" op="$3" ref="$4"
  local lock meta
  lock="$(intake_lock_file "$repo" "$scope")"
  mkdir -p "$(dirname "$lock")"

  meta="$(jq -nc --arg pid "$$" --arg at "$(intake_now)" --arg op "$op" --arg ref "$ref" \
    '{pid: ($pid | tonumber), started_at: $at, operation: $op, ref: $ref}')"

  # O_EXCL 语义：noclobber 下向已存在文件重定向会失败
  if ( set -C; printf '%s\n' "$meta" > "$lock" ) 2>/dev/null; then
    printf '%s\n' "$lock"
    return 0
  fi

  local age ttl
  ttl="${INTAKE_LOCK_TTL_SECONDS:-1800}"
  age="$(intake_lock_age_seconds "$lock")"
  if [ "${age:-0}" -ge "$ttl" ]; then
    log_warn "intake: 抢占过期执行锁 ${lock}（age=${age}s ≥ ${ttl}s）"
    printf '%s\n' "$meta" > "$lock"
    printf '%s\n' "$lock"
    return 0
  fi

  return 1
}

intake_lock_release() {
  local lock="$1"
  if [ -n "$lock" ]; then
    rm -f "$lock"
  fi
}

# ---- 资产版本库 ----

intake_assets_dir() { echo "${1}/.ai-workspace/${INTAKE_ASSETS_REL}"; }
intake_registry_path() { echo "$(intake_assets_dir "$1")/registry.json"; }

intake_registry_read() {
  local repo="$1" f
  f="$(intake_registry_path "$repo")"
  if [ -f "$f" ]; then
    cat "$f"
  else
    jq -nc '{schema: "intake/v1", version_counter: 0, updated_at: null, assets: {}}'
  fi
}

# 原子替换 registry（design 8.3：write_registry 原子替换）
intake_registry_write() {
  local repo="$1" json="$2"
  local dir f tmp
  dir="$(intake_assets_dir "$repo")"
  f="${dir}/registry.json"
  mkdir -p "$dir"
  tmp="${f}.tmp.$$"
  printf '%s\n' "$json" > "$tmp"
  mv "$tmp" "$f"
}

# ---- 执行历史 ----

intake_history_dir() { echo "${1}/.ai-workspace/${INTAKE_HISTORY_REL}"; }
intake_history_path() { echo "$(intake_history_dir "$1")/$2.json"; }

intake_history_write() {
  local repo="$1" apply_id="$2" json="$3"
  mkdir -p "$(intake_history_dir "$repo")"
  printf '%s\n' "$json" > "$(intake_history_path "$repo" "$apply_id")"
}

intake_history_read() {
  local repo="$1" apply_id="$2" f
  f="$(intake_history_path "$repo" "$apply_id")"
  if [ -f "$f" ]; then
    cat "$f"
  else
    printf '{"schema":"intake/v1","error":"history_not_found"}\n'
  fi
}

# 某幂等键下已成功应用的 action_id（重试不重复写入）
intake_history_applied_actions() {
  local repo="$1" key="$2" dir
  dir="$(intake_history_dir "$repo")"
  if [ ! -d "$dir" ]; then
    echo '[]'
    return 0
  fi

  local f
  for f in "${dir}"/*.json; do
    [ -f "$f" ] || continue
    cat "$f"
  done | jq -s -c --arg k "$key" '
    map(select(.idempotency_key == $k))
    | map(.applied_actions // []) | add // [] | unique'
}

# 某幂等键的最近一次执行记录（判断是否需要 --resume）
intake_history_latest_for_key() {
  local repo="$1" key="$2" dir
  dir="$(intake_history_dir "$repo")"
  if [ ! -d "$dir" ]; then
    echo 'null'
    return 0
  fi

  local f
  for f in "${dir}"/*.json; do
    [ -f "$f" ] || continue
    cat "$f"
  done | jq -s -c --arg k "$key" '
    map(select(.idempotency_key == $k))
    | sort_by(.started_at // "") | last // null'
}

# 某幂等键下最近一条「未完成」执行记录（内容/registry 已部分落盘，需要续跑）；无则 null
# 与 failed 区分：failed 表示还没进入提交，incomplete 表示做到一半
intake_history_inflight_for_key() {
  local repo="$1" key="$2" dir
  dir="$(intake_history_dir "$repo")"
  if [ ! -d "$dir" ]; then
    echo 'null'
    return 0
  fi

  local f
  for f in "${dir}"/*.json; do
    [ -f "$f" ] || continue
    cat "$f"
  done | jq -s -c --arg k "$key" '
    map(select(.idempotency_key == $k and .status == "incomplete"))
    | sort_by(.started_at // "") | last // null'
}

# ---- 暂存区（预备写入，失败保留供诊断） ----

intake_staging_dir() { echo "${1}/.ai-workspace/${INTAKE_STAGING_REL}/$2"; }

# ============================================================================
# AI 辅助整理记录区（design 9.1：本地，不纳入 Git，不含凭据值）
# ============================================================================

INTAKE_AI_REL="intake/ai"

intake_ai_dir() { echo "${1}/.ai-workspace/${INTAKE_AI_REL}"; }
intake_ai_requests_dir() { echo "$(intake_ai_dir "$1")/requests"; }
intake_ai_results_dir() { echo "$(intake_ai_dir "$1")/results/$2"; }
intake_ai_request_path() { echo "$(intake_ai_requests_dir "$1")/$2.json"; }
intake_ai_manifest_path() { echo "$(intake_ai_results_dir "$1" "$2")/manifest.json"; }
intake_ai_attempt_path() { echo "$(intake_ai_results_dir "$1" "$2")/batch-$3.attempt-$4.json"; }

# 模型服务配置；只保存凭据引用名，绝不保存凭据值
intake_model_config_path() { echo "${1}/.ai-workspace/intake/model-config.json"; }

intake_model_config_read() {
  local repo="$1" f
  f="$(intake_model_config_path "$repo")"
  if [ -f "$f" ]; then
    jq -c '. + {schema: "intake/v1"}' "$f" 2>/dev/null || printf '%s\n' "$(intake_model_config_default)"
  else
    intake_model_config_default
  fi
}

intake_model_config_default() {
  jq -nc '{schema: "intake/v1", base_url: null, model: null, credential_ref: null,
           timeout_ms: 60000, max_retries: 2}'
}

intake_model_config_write() {
  local repo="$1" json="$2"
  mkdir -p "$(dirname "$(intake_model_config_path "$repo")")"
  printf '%s\n' "$json" > "$(intake_model_config_path "$repo")"
}

# 请求 ID：ai-YYYYmmdd-HHMMSS-<6位随机>
intake_ai_new_request_id() {
  local ts rnd
  ts="$(date -u '+%Y%m%d-%H%M%S' 2>/dev/null || date '+%Y%m%d-%H%M%S')"
  rnd="$(od -An -N3 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | cut -c1-6)"
  [ -n "$rnd" ] || rnd="$$"
  printf 'ai-%s-%s\n' "$ts" "$rnd"
}

intake_ai_request_write() {
  local repo="$1" request_id="$2" json="$3"
  mkdir -p "$(intake_ai_requests_dir "$repo")"
  printf '%s\n' "$json" > "$(intake_ai_request_path "$repo" "$request_id")"
}

intake_ai_request_read() {
  local repo="$1" request_id="$2" f
  f="$(intake_ai_request_path "$repo" "$request_id")"
  if [ -f "$f" ]; then
    cat "$f"
  else
    printf '{"schema":"intake/v1","error":"request_not_found"}\n'
  fi
}

# 保存一次尝试的结果；绝不覆盖既有尝试（design 9.4：重试不静默覆盖）
# 用 O_EXCL 语义写入：文件已存在（含并发发送）时返回 1，由调用方换号重试
intake_ai_attempt_write() {
  local repo="$1" request_id="$2" batch_index="$3" attempt="$4" json="$5"
  local f
  mkdir -p "$(intake_ai_results_dir "$repo" "$request_id")"
  f="$(intake_ai_attempt_path "$repo" "$request_id" "$batch_index" "$attempt")"
  if ( set -C; printf '%s\n' "$json" > "$f" ) 2>/dev/null; then
    return 0
  fi
  return 1
}

# 某批次已有的最大尝试序号；新一次发送从这里往后接着编号，跨次不覆盖
intake_ai_attempt_max_seq() {
  local repo="$1" request_id="$2" batch_index="$3" dir max
  dir="$(intake_ai_results_dir "$repo" "$request_id")"
  if [ ! -d "$dir" ]; then printf '0'; return 0; fi
  max="$(ls "$dir" 2>/dev/null \
    | sed -n "s/^batch-${batch_index}\.attempt-\([0-9][0-9]*\)\.json$/\1/p" \
    | sort -n | tail -n 1)"
  [ -n "$max" ] || max=0
  printf '%s' "$max"
}

# 某请求已有的最大发送轮次；用于区分"单次发送内部重试"和"用户再次发送"
intake_ai_attempt_max_send_seq() {
  local repo="$1" request_id="$2" dir max
  dir="$(intake_ai_results_dir "$repo" "$request_id")"
  if [ ! -d "$dir" ]; then printf '0'; return 0; fi
  max="$(cat "$dir"/batch-*.json 2>/dev/null | jq -s -r 'map(.send_seq // 0) | max // 0' 2>/dev/null)"
  [ -n "$max" ] || max=0
  printf '%s' "$max"
}

intake_ai_manifest_write() {
  local repo="$1" request_id="$2" json="$3"
  mkdir -p "$(intake_ai_results_dir "$repo" "$request_id")"
  printf '%s\n' "$json" > "$(intake_ai_manifest_path "$repo" "$request_id")"
}

intake_ai_manifest_read() {
  local repo="$1" request_id="$2" f
  f="$(intake_ai_manifest_path "$repo" "$request_id")"
  if [ -f "$f" ]; then
    cat "$f"
  else
    printf '{"schema":"intake/v1","error":"manifest_not_found"}\n'
  fi
}

# 列出某请求的全部尝试（按批次与次序）
intake_ai_attempt_list() {
  local repo="$1" request_id="$2" dir
  dir="$(intake_ai_results_dir "$repo" "$request_id")"
  if [ ! -d "$dir" ]; then
    printf '[]\n'
    return 0
  fi
  local f
  for f in "${dir}"/batch-*.attempt-*.json; do
    [ -f "$f" ] || continue
    cat "$f"
  done | jq -s -c 'sort_by(.batch_index, .attempt)'
}
