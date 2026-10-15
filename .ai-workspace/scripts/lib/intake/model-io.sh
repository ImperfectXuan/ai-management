#!/bin/sh
# intake/model-io.sh - 模型调用边界：HTTP 发送、响应校验、尝试与结果记录
# 需先 source common.sh / intake/identity.sh / intake/store.sh / intake/model.sh
#
# 设计约束（design 9.2-9.4、spec 5.4）：
#   1. 只发送已确认的载荷：发送前校验 body_hash，与预览时不一致即拒绝
#   2. 凭据在发送前一刻解析，经 curl --config - 从标准输入传入，不进 argv、不进日志
#   3. 响应先按契约校验；非法建议逐条丢弃并记录原因，绝不写总库
#   4. 每次尝试单独落盘，重试不覆盖既有尝试；记录只存摘要与已校验建议，不存原始响应
#   5. 外部内容只作数据；本模块不执行任何来自模型的指令

# ============================================================================
# HTTP
# ============================================================================

# POST；输出 "<http_code> <curl_rc>"；响应体写 $5，错误写 $5.err
intake_model_http_post() {
  local endpoint="$1" body_file="$2" credential="$3" timeout_ms="$4" resp_file="$5"
  local max_time code rc
  max_time="$(awk -v ms="$timeout_ms" 'BEGIN { printf "%.3f", ms / 1000 }')"

  # 用 if 承接失败：命令替换失败时 set -e 会直接终止函数，退出码就丢了
  if code="$(
    {
      printf 'silent\nshow-error\n'
      printf 'max-time = %s\n' "$max_time"
      printf 'url = "%s"\n' "$endpoint"
      printf 'request = "POST"\n'
      printf 'header = "Content-Type: application/json"\n'
      if [ -n "$credential" ]; then
        printf 'header = "Authorization: Bearer %s"\n' "$credential"
      fi
      printf 'data-binary = "@%s"\n' "$body_file"
      printf 'output = "%s"\n' "$resp_file"
      printf 'write-out = "%%{http_code}"\n'
    } | curl --config - 2>"${resp_file}.err"
  )"; then
    rc=0
  else
    rc=$?
  fi

  [ -n "$code" ] || code="000"
  printf '%s %s' "$code" "$rc"
}

# ============================================================================
# 响应校验（design 9.3）
# ============================================================================

intake_model_validate_jq() {
  cat <<'JQ_EOF'
# 校验顺序固定：先判类型，再做索引与遍历。
# 原因：jq 对对象做非字符串下标、对非数组做 [] 迭代都会直接报错退出，
# 一个畸形字段就会让整批结果丢掉（审查缺陷 P1）。
def is_int: (type == "number") and (. == floor);
def def_lines($by_occ; $occ):
  (($by_occ[$occ].content // "") | split("\n"));

# 锚点自带来源 ID，按各自来源校验行号与原文，支持真实的多文件 merge
def validate_anchor($a; $by_occ):
  if ($a | type) != "object" then "anchor_not_object"
  elif (($a.source_occurrence_id | type) != "string") or ($a.source_occurrence_id == "") then "anchor_source_missing"
  elif ($by_occ[$a.source_occurrence_id] == null) then "anchor_source_unknown"
  elif ((($a.start_line | is_int) and ($a.end_line | is_int)) | not) then "anchor_bounds_not_integer"
  elif ($a.start_line < 1 or $a.start_line > $a.end_line) then "anchor_out_of_range"
  elif ($a.end_line > ((def_lines($by_occ; $a.source_occurrence_id)) | length)) then "anchor_out_of_range"
  elif (($a.quote | type) != "string") or (($a.quote | length) == 0) then "anchor_quote_missing"
  else
    (def_lines($by_occ; $a.source_occurrence_id)) as $lines
    | if (((($lines[($a.start_line - 1):$a.end_line]) | join("\n")) | contains($a.quote)) | not)
      then "anchor_quote_mismatch"
      else null end
  end;

def validate_suggestion($s; $by_occ; $kinds; $cats):
  if ($s | type) != "object" then "not_object"
  elif (($s.suggestion_id | type) != "string") or ($s.suggestion_id == "") then "missing_suggestion_id"
  elif (($s.kind | type) != "string") or (($kinds | index($s.kind)) == null) then "invalid_kind"
  elif (($s.source_occurrence_id | type) != "string") or ($s.source_occurrence_id == "") then "source_occurrence_missing"
  elif ($by_occ[$s.source_occurrence_id] == null) then "unknown_source_occurrence"
  elif (($s.category // "") != "") and (($cats | index($s.category)) == null) then "invalid_category"
  elif (($s.source_anchors | type) != "array") or (($s.source_anchors | length) == 0) then "missing_anchors"
  elif (($s.proposed_content | type) != "string") or ($s.proposed_content == "") then "missing_proposed_content"
  elif (($s.rationale | type) != "string") or ($s.rationale == "") then "missing_rationale"
  else ([$s.source_anchors[] | validate_anchor(.; $by_occ)] | map(select(. != null)) | first) // null
  end;

# 未覆盖区间逐条校验：类型、来源 ID、整数行号、来源内范围
def valid_range($r; $by_occ):
  ($r | type) == "object"
  and (($r.source_occurrence_id | type) == "string")
  and ($r.source_occurrence_id != "")
  and ($by_occ[$r.source_occurrence_id] != null)
  and (($r.start_line | is_int) and ($r.end_line | is_int))
  and ($r.start_line >= 1)
  and ($r.end_line >= $r.start_line)
  and ($r.end_line <= ((def_lines($by_occ; $r.source_occurrence_id)) | length));

. as $in
| ($in.items // []) as $items
| ($items | map(select((.occurrence_id | type) == "string")
                | {key: .occurrence_id, value: .}) | from_entries) as $by_occ
| (["split", "categorize", "merge", "variant"]) as $kinds
| (["general", "domain", "project_constraint", "project_context"]) as $cats
| (try ($in.response | fromjson) catch null) as $resp
| if ($resp == null or ($resp | type) != "object") then
    {status: "invalid_output", errors: ["response_not_json_object"],
     suggestions: [], uncovered_ranges: [], rejected: [], warnings: [],
     coverage_gaps: [], raw_suggestion_count: 0, raw_uncovered_count: 0}
  elif (($resp.suggestions | type) != "array") then
    {status: "invalid_output", errors: ["suggestions_must_be_array"],
     suggestions: [], uncovered_ranges: [], rejected: [], warnings: [],
     coverage_gaps: [], raw_suggestion_count: 0, raw_uncovered_count: 0}
  else
    ( $resp.suggestions | to_entries
      | map(.key as $i | .value as $s
            | {index: $i, suggestion: $s,
               error: (try validate_suggestion($s; $by_occ; $kinds; $cats) catch "validator_error")})
    ) as $checked
    | ($checked | map(select(.error == null) | .suggestion)) as $ok
    | ($checked | map(select(.error != null) | {index, reason: .error})) as $rejected

    # uncovered_ranges 类型非法时按"没有区间"处理，不因为一个字段丢掉整批建议
    | ( (if (($resp.uncovered_ranges // null) | type) == "array" then $resp.uncovered_ranges else [] end) ) as $unc_raw
    | ( $unc_raw | map(select(try valid_range(.; $by_occ) catch false)) ) as $unc_ok

    | ( $items | map(. as $it
        | ($it.line_count // 0) as $lc
        | ([$ok[] | select(.source_occurrence_id == $it.occurrence_id) | .source_anchors[]
            | select((.source_occurrence_id // "") == $it.occurrence_id)
            | {s: .start_line, e: .end_line}]) as $covered
        | ([$unc_ok[] | select(.source_occurrence_id == $it.occurrence_id) | {start_line, end_line}]) as $unc
        | [ range(1; $lc + 1) | . as $ln
            | select(([$covered[] | select(.s <= $ln and .e >= $ln)] | length) == 0)
            | select(([$unc[] | select(.start_line <= $ln and .end_line >= $ln)] | length) == 0)
            | $ln ]
        | select(length > 0)
        | {source_occurrence_id: $it.occurrence_id, missing_lines: .} )) as $gaps

    # 自动补齐的区间同样携带正确来源（spec 5.3：原文不能从视图里消失）
    | ( $unc_ok + ($gaps | map({source_occurrence_id: .source_occurrence_id,
                                start_line: (.missing_lines | min),
                                end_line: (.missing_lines | max)})) ) as $unc_final
    | {
        status: (if ($rejected | length) > 0 then "partial" else "ok" end),
        errors: [],
        warnings: ((if ($gaps | length) > 0 then ["uncovered_ranges_autofilled"] else [] end)
                   + (if ($unc_raw | length) > ($unc_ok | length) then ["uncovered_ranges_dropped"] else [] end)),
        coverage_gaps: $gaps,
        suggestions: $ok,
        uncovered_ranges: $unc_final,
        rejected: $rejected,
        raw_suggestion_count: ($resp.suggestions | length),
        raw_uncovered_count: ($unc_raw | length)
      }
  end
JQ_EOF
}

# 从 OpenAI-compatible 响应中取出模型输出的 JSON 文本；
# 服务端直接返回契约对象时原样使用（便于本地简单服务）。
intake_model_extract_content() {
  local response="$1" content=""
  # 响应可能根本不是 JSON：jq 失败时按"无信封"处理，交给契约校验去判定
  content="$(printf '%s' "$response" | jq -r '
    if (type == "object")
       and ((.choices | type) == "array")
       and ((.choices[0].message.content | type) == "string")
    then .choices[0].message.content
    else empty end' 2>/dev/null)" || content=""
  if [ -n "$content" ]; then
    printf '%s' "$content"
  else
    printf '%s' "$response"
  fi
}

# $1=请求批次 JSON $2=响应文本；输出校验结果
intake_model_validate() {
  local batch="$1" response="$2" content items out
  content="$(intake_model_extract_content "$response")"
  items="$(printf '%s' "$batch" | jq -c '(.body.messages[1].content | try fromjson catch null | .items) // []' 2>/dev/null)"
  [ -n "$items" ] || items='[]'

  out="$(jq -nc --argjson items "$items" --arg response "$content" \
    '{items: $items, response: $response}' | jq "$(intake_model_validate_jq)" 2>/dev/null)"
  if [ -z "$out" ] || ! printf '%s' "$out" | jq -e '.suggestions' >/dev/null 2>&1; then
    # 校验器自身出错也必须返回可识别的结构化结果，不能丢记录
    out='{"status":"invalid_output","errors":["validator_error"],"suggestions":[],
          "uncovered_ranges":[],"rejected":[],"warnings":[],"coverage_gaps":[],
          "raw_suggestion_count":0,"raw_uncovered_count":0}'
  fi
  printf '%s' "$out"
}

# ============================================================================
# 发送编排
# ============================================================================

intake_model_attempt_count() {
  local repo="$1" request_id="$2" idx="$3" dir count
  dir="$(intake_ai_results_dir "$repo" "$request_id")"
  if [ ! -d "$dir" ]; then
    printf '0'
    return 0
  fi
  count="$(ls "$dir"/batch-"$idx".attempt-*.json 2>/dev/null | wc -l | tr -d ' ')"
  [ -n "$count" ] || count=0
  printf '%s' "$count"
}

# 单批一次尝试；输出结果 JSON（由调用方落盘）
# body_canonical 必须显式传入：记录里的 body_hash 与实际发送体必须来自同一份内容
intake_model_attempt_run() {
  local repo="$1" request_id="$2" batch="$3" attempt="$4" credential="$5" cancel_file="$6" request="$7"
  local body_canonical="$8" send_seq="${9:-1}"

  local idx endpoint model timeout started body_file resp_file
  idx="$(printf '%s' "$batch" | jq -r '.index')"
  endpoint="$(printf '%s' "$request" | jq -r '.target.endpoint')"
  model="$(printf '%s' "$request" | jq -r '.target.model')"
  timeout="$(printf '%s' "$request" | jq -r '.target.timeout_ms // 60000')"
  started="$(intake_now)"

  body_file="$(mktemp "${TMPDIR:-/tmp}/aiws-ai-body.XXXXXX")"
  resp_file="$(mktemp "${TMPDIR:-/tmp}/aiws-ai-resp.XXXXXX")"
  chmod 600 "$body_file" "$resp_file" 2>/dev/null || true

  printf '%s' "$body_canonical" > "$body_file"

  local out code rc status result errors
  out="$(intake_model_http_post "$endpoint" "$body_file" "$credential" "$timeout" "$resp_file")"
  code="$(printf '%s' "$out" | awk '{print $1}')"
  rc="$(printf '%s' "$out" | awk '{print $2}')"

  local response="" resp_bytes=0 resp_digest=""
  if [ -f "$resp_file" ]; then
    response="$(cat "$resp_file")"
    resp_bytes="${#response}"
    resp_digest="sha256:$(intake_sha256 "$resp_file")"
  fi

  if [ "$rc" = "28" ]; then
    status="timeout"
    errors='["request_timeout"]'
    result='{"suggestions": [], "uncovered_ranges": [], "rejected": [], "warnings": []}'
  elif [ "$rc" != "0" ]; then
    status="network_error"
    errors='["network_error"]'
    result='{"suggestions": [], "uncovered_ranges": [], "rejected": [], "warnings": []}'
  elif [ "$code" -lt 200 ] 2>/dev/null || [ "$code" -ge 300 ] 2>/dev/null; then
    status="http_error"
    errors="[\"http_status_${code}\"]"
    result='{"suggestions": [], "uncovered_ranges": [], "rejected": [], "warnings": []}'
  else
    result="$(intake_model_validate "$batch" "$response")"
    status="$(printf '%s' "$result" | jq -r '.status')"
    errors="$(printf '%s' "$result" | jq -c '.errors')"
  fi

  # 原始响应只用于校验：计算摘要后即删除，不落盘
  rm -f "$resp_file" "${resp_file}.err" "$body_file"

  jq -nc \
    --arg schema "intake/v1" --arg rid "$request_id" --argjson idx "$idx" --argjson att "$attempt" \
    --argjson sseq "$send_seq" \
    --arg started "$started" --arg finished "$(intake_now)" --arg status "$status" \
    --arg code "$code" --arg endpoint "$endpoint" --arg model "$model" \
    --argjson req_bytes "${#body_canonical}" --argjson resp_bytes "$resp_bytes" \
    --arg digest "$resp_digest" --argjson errors "$errors" \
    --argjson result "$result" --argjson batch_meta "$(printf '%s' "$batch" | jq -c '{candidate_ids, occurrence_ids, items_digest, body_hash}')" '
    {
      schema: $schema, request_id: $rid, batch_index: $idx, attempt: $att, send_seq: $sseq,
      started_at: $started, finished_at: $finished, status: $status,
      http_status: ($code | tonumber? // 0),
      endpoint: $endpoint, model: $model,
      request_bytes: $req_bytes, response_bytes: $resp_bytes, response_digest: $digest,
      body_hash: $batch_meta.body_hash,
      candidate_ids: $batch_meta.candidate_ids,
      occurrence_ids: $batch_meta.occurrence_ids,
      items: $batch_meta.items_digest,
      suggestions: ($result.suggestions // []),
      uncovered_ranges: ($result.uncovered_ranges // []),
      rejected: ($result.rejected // []),
      warnings: ($result.warnings // []),
      coverage_gaps: ($result.coverage_gaps // []),
      errors: $errors
    }'
}

intake_model_manifest_rebuild() {
  local repo="$1" request_id="$2" request="$3"
  local attempts
  attempts="$(intake_ai_attempt_list "$repo" "$request_id")"
  jq -nc --arg schema "intake/v1" --arg rid "$request_id" --arg at "$(intake_now)" \
    --argjson req "$request" --argjson a "$attempts" '
    {
      schema: $schema, request_id: $rid, updated_at: $at,
      target: $req.target, purpose: $req.purpose, batch_id: $req.batch_id,
      batches: [ $req.batches[] | . as $b
        | ([$a[] | select(.batch_index == $b.index)] | sort_by(.attempt)) as $mine
        | {
            index: $b.index, total: $b.total, bytes: $b.bytes, body_hash: $b.body_hash,
            candidate_ids: $b.candidate_ids,
            attempts: [$mine[] | {attempt, status, http_status, started_at, finished_at,
                                  suggestions: (.suggestions | length), rejected: (.rejected | length)}],
            status: (if ($mine | length) == 0 then "pending" else ($mine | last | .status) end)
          }]
    }'
}

# 主入口：INTAKE_REPO / INTAKE_REQUEST_ID / INTAKE_BATCH_INDEX / INTAKE_MAX_RETRIES / INTAKE_CANCEL_FILE
intake_model_send() {
  local repo="${INTAKE_REPO:-}" request_id="${INTAKE_REQUEST_ID:-}"
  local batch_index="${INTAKE_BATCH_INDEX:-0}" max_retries="${INTAKE_MAX_RETRIES:-0}"
  local cancel_file="${INTAKE_CANCEL_FILE:-}"

  [ -n "$repo" ] || die "intake model send: 必须指定 --repo（总库路径）"
  [ -n "$request_id" ] || die "intake model send: 必须指定 --request（请求 ID）"

  local req
  req="$(intake_ai_request_read "$repo" "$request_id")"
  if printf '%s' "$req" | jq -e '.error == "request_not_found"' >/dev/null 2>&1; then
    die "intake model send: 找不到请求: ${request_id}（先运行 aiws intake model prepare）"
  fi

  local total
  total="$(printf '%s' "$req" | jq -r '.batches | length')"
  local indices=""
  if [ "$batch_index" = "0" ] || [ -z "$batch_index" ]; then
    indices="$(seq 1 "$total")"
  else
    if [ "$batch_index" -lt 1 ] 2>/dev/null || [ "$batch_index" -gt "$total" ]; then
      die "intake model send: 批次序号超范围: ${batch_index}（共 ${total} 批）"
    fi
    indices="$batch_index"
  fi

  # 凭据在发送前一刻解析；解析不到就拒绝发送
  local cred_ref credential=""
  cred_ref="$(printf '%s' "$req" | jq -r '.target.credential_ref // ""')"
  if [ -n "$cred_ref" ]; then
    credential="$(intake_model_credential "$cred_ref")" || credential=""
    if [ -z "$credential" ]; then
      die "intake model send: 无法取得凭据引用 '${cred_ref}'（vault 需交互解锁；本地/自动化场景可显式设置 AIWS_MODEL_CREDENTIAL）"
    fi
  fi

  local results_file
  results_file="$(mktemp "${TMPDIR:-/tmp}/aiws-ai-results.XXXXXX")"
  : > "$results_file"

  local idx
  for idx in $indices; do
    if [ -n "$cancel_file" ] && [ -f "$cancel_file" ]; then
      jq -nc --arg rid "$request_id" --argjson i "$idx" \
        '{schema: "intake/v1", request_id: $rid, batch_index: $i, attempt: 0,
          status: "cancelled", suggestions: [], uncovered_ranges: [], rejected: [],
          warnings: [], coverage_gaps: [], errors: ["cancelled"]}' >> "$results_file"
      continue
    fi

    local batch body_canonical expected_hash actual_hash
    batch="$(printf '%s' "$req" | jq -c --argjson i "$idx" '.batches[($i - 1)]')"
    body_canonical="$(printf '%s' "$batch" | jq -c '.body | .')"
    body_canonical="$(printf '%s' "$body_canonical" | jq -cS '.')"
    expected_hash="$(printf '%s' "$batch" | jq -r '.body_hash')"
    actual_hash="sha256:$(intake_sha256_str "$body_canonical")"

    if [ "$expected_hash" != "$actual_hash" ]; then
      # 预览后被改动过：拒绝按旧确认发送
      jq -nc --arg rid "$request_id" --argjson i "$idx" \
        '{schema: "intake/v1", request_id: $rid, batch_index: $i, attempt: 0,
          status: "request_tampered", suggestions: [], uncovered_ranges: [], rejected: [],
          warnings: [], coverage_gaps: [], errors: ["payload_changed_after_confirmation"]}' >> "$results_file"
      continue
    fi

    # 尝试序号跨次连续：同一请求第二次发送不会覆盖第一次的 attempt-1
    local base_seq send_seq
    base_seq="$(intake_ai_attempt_max_seq "$repo" "$request_id" "$idx")"
    send_seq=$(( $(intake_ai_attempt_max_send_seq "$repo" "$request_id") + 1 ))

    local attempt=0 tries=$((max_retries + 1))
    local record=""
    while [ "$attempt" -lt "$tries" ]; do
      if [ -n "$cancel_file" ] && [ -f "$cancel_file" ]; then
        break
      fi
      attempt=$((attempt + 1))
      local seq=$((base_seq + attempt))
      record="$(intake_model_attempt_run "$repo" "$request_id" "$batch" "$seq" "$credential" "$cancel_file" "$req" "$body_canonical" "$send_seq")"
      # 并发发送可能争用同一序号：换号重试，绝不覆盖既有记录
      while ! intake_ai_attempt_write "$repo" "$request_id" "$idx" "$seq" "$record"; do
        seq=$((seq + 1))
        record="$(printf '%s' "$record" | jq -c --argjson s "$seq" '.attempt = $s')"
      done
      local st
      st="$(printf '%s' "$record" | jq -r '.status')"
      if [ "$st" = "ok" ] || [ "$st" = "partial" ]; then
        break
      fi
      # timeout / network_error / http_error(5xx) / invalid_output 可重试
      if [ "$st" = "http_error" ]; then
        local hcode
        hcode="$(printf '%s' "$record" | jq -r '.http_status')"
        if [ "$hcode" -lt 500 ] 2>/dev/null; then
          break
        fi
      fi
    done

    if [ -n "$record" ]; then
      printf '%s\n' "$record" >> "$results_file"
    fi
  done

  intake_ai_manifest_write "$repo" "$request_id" "$(intake_model_manifest_rebuild "$repo" "$request_id" "$req")"

  local results
  results="$(jq -s -c '.' "$results_file")"
  rm -f "$results_file"

  jq -nc --arg schema "intake/v1" --arg rid "$request_id" --argjson r "$results" \
    --argjson req "$req" '
    {
      schema: $schema, request_id: $rid,
      target: $req.target,
      batches: $r,
      summary: {
        sent: [$r[] | select(.batch_index > 0)] | length,
        ok: [$r[] | select(.status == "ok")] | length,
        partial: [$r[] | select(.status == "partial")] | length,
        failed: [$r[] | select(.status != "ok" and .status != "partial")] | length,
        suggestions: ([$r[].suggestions[]?] | length),
        rejected: ([$r[].rejected[]?] | length)
      }
    }'
}
