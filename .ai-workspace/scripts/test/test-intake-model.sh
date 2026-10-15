#!/bin/sh
# test-intake-model.sh - 模型 API 边界与结构化建议校验测试
# 覆盖 AC-001-09 / AC-001-10 / AC-001-11 的服务边界：未确认发送、范围变化、无效 JSON/来源引用、
# 锚点不匹配、超时、取消、部分失败、重试、凭据过滤与泄漏检查。
#
# 模型服务是外部边界：测试用本机 127.0.0.1 上的模拟服务，不调用真实模型服务、不产生费用。
# 独立沙盒：临时总库（含真实 CLI 引擎副本）、临时来源、临时 HOME。
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIWS="${SCRIPT_DIR}/../aiws"

PASS=0
FAIL=0
t_pass() { PASS=$((PASS + 1)); printf '  ok - %s\n' "$1"; }
t_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK - %s\n' "$1"; }
expect_eq() { if [ "$1" = "$2" ]; then t_pass "$3"; else t_fail "$3 (expected [$2], got [$1])"; fi; }
expect_absent() { if printf '%s' "$1" | grep -qF -- "$2"; then t_fail "$3 (unexpected: $2)"; else t_pass "$3"; fi; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/aiws-intake-model.XXXXXX")"
MOCK_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

export HOME="${SANDBOX}/home"
export HOME_DIR="${SANDBOX}/home"
mkdir -p "$HOME"

REPO="${SANDBOX}/repo"
SRC="${SANDBOX}/src"
mkdir -p "$REPO/.ai-workspace/rules/domains" "$REPO/.ai-workspace/skills" \
         "$REPO/.ai-workspace/mcp" "$REPO/.ai-workspace/adapters"
cp -R "${SCRIPT_DIR}/.." "$REPO/.ai-workspace/scripts"
chmod +x "$REPO/.ai-workspace/scripts/aiws"
for t in cursor trae claude codex; do
  mkdir -p "$REPO/.ai-workspace/adapters/$t"
  printf 'tool: %s\nrules:\n  - source: rules/00-core.md\n    required: true\n' "$t" \
    > "$REPO/.ai-workspace/adapters/$t/mapping.yaml"
done
printf -- '---\nid: 00-core\ntitle: 核心原则\n---\n# 核心原则\n\n总库原文。\n' \
  > "$REPO/.ai-workspace/rules/00-core.md"
echo '{"servers":{}}' > "$REPO/.ai-workspace/mcp/mcp.json"

mkdir -p "$SRC/.cursor/rules"
printf -- '---\nid: newrule\ntitle: 新规则\n---\n# 新规则\n\n第一行。\nAPI_KEY: sk-plaintext-must-not-leak\n第三行。\n' \
  > "$SRC/.cursor/rules/newrule.mdc"

# ---------------------------------------------------------------
# 模拟模型服务（本机回环，不产生外部费用）
# ---------------------------------------------------------------
cat > "${SANDBOX}/mock-model.js" <<'MOCK'
const http = require('http');
const fs = require('fs');
const mode = process.env.MOCK_MODE || 'ok';
const logFile = process.env.MOCK_LOG;
const portFile = process.env.MOCK_PORTFILE;
const expectAuth = process.env.MOCK_EXPECT_AUTH || '';

const lines = (s) => String(s).split('\n');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (logFile) fs.appendFileSync(logFile, JSON.stringify({
      url: req.url, auth: req.headers.authorization || null, bytes: body.length } ) + '\n');

    if (mode === 'timeout') { setTimeout(() => { res.writeHead(200); res.end('{}'); }, 8000); return; }
    if (mode === 'http500') { res.writeHead(500); res.end('{"error":"boom"}'); return; }
    if (mode === 'badjson') { res.writeHead(200); res.end('this is not json'); return; }
    if (mode === 'auth' && (req.headers.authorization || '') !== expectAuth) {
      res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
    }

    let payload;
    try { payload = JSON.parse(JSON.parse(body).messages[1].content); }
    catch (e) { res.writeHead(400); res.end('{"error":"bad request"}'); return; }

    const items = payload.items || [];
    const first = items[0] || { occurrence_id: 'none', content: '' };
    const ls = lines(first.content);
    let out;
    if (mode === 'badref') {
      out = { suggestions: [{ suggestion_id: 'ai-1', kind: 'split', source_occurrence_id: 'occ-missing',
        source_anchors: [{ source_occurrence_id: first.occurrence_id, start_line: 1, end_line: 1, quote: ls[0] }], proposed_content: 'x',
        category: 'general', rationale: 'y', related_asset_ids: [] }], uncovered_ranges: [] };
    } else if (mode === 'badanchor') {
      out = { suggestions: [{ suggestion_id: 'ai-1', kind: 'split', source_occurrence_id: first.occurrence_id,
        source_anchors: [{ source_occurrence_id: first.occurrence_id, start_line: 1, end_line: 1, quote: '原文中不存在的句子' }], proposed_content: 'x',
        category: 'general', rationale: 'y', related_asset_ids: [] }], uncovered_ranges: [] };
    } else if (mode === 'badkind') {
      out = { suggestions: [{ suggestion_id: 'ai-1', kind: 'rewrite', source_occurrence_id: first.occurrence_id,
        source_anchors: [{ source_occurrence_id: first.occurrence_id, start_line: 1, end_line: 1, quote: ls[0] }], proposed_content: 'x',
        category: 'general', rationale: 'y', related_asset_ids: [] }], uncovered_ranges: [] };
    } else if (mode === 'nocoverage') {
      out = { suggestions: [{ suggestion_id: 'ai-1', kind: 'split', source_occurrence_id: first.occurrence_id,
        source_anchors: [{ source_occurrence_id: first.occurrence_id, start_line: 1, end_line: 1, quote: ls[0] }], proposed_content: 'x',
        category: 'general', rationale: 'y', related_asset_ids: [] }], uncovered_ranges: [] };
    } else {
      out = {
        suggestions: items.map((it, i) => ({
          suggestion_id: `ai-${i + 1}`, kind: 'split', source_occurrence_id: it.occurrence_id,
          source_anchors: [{ source_occurrence_id: it.occurrence_id, start_line: 1, end_line: 1, quote: lines(it.content)[0] }],
          proposed_content: `整理自 ${it.name}`, category: 'general',
          rationale: '该段落是通用规范', related_asset_ids: [] })),
        uncovered_ranges: [{ source_occurrence_id: first.occurrence_id, start_line: 2, end_line: Math.max(2, ls.length) }],
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
});
server.listen(0, '127.0.0.1', () => {
  if (portFile) fs.writeFileSync(portFile, String(server.address().port));
});
MOCK

MOCK_LOG="${SANDBOX}/mock.log"
start_mock() {
  stop_mock
  rm -f "${SANDBOX}/port"
  : > "$MOCK_LOG"
  MOCK_MODE="$1" MOCK_EXPECT_AUTH="${2:-}" MOCK_LOG="$MOCK_LOG" MOCK_PORTFILE="${SANDBOX}/port" \
    node "${SANDBOX}/mock-model.js" >/dev/null 2>&1 &
  MOCK_PID=$!
  local i=0
  while [ "$i" -lt 80 ]; do
    [ -s "${SANDBOX}/port" ] && break
    sleep 0.05
    i=$((i + 1))
  done
  MOCK_PORT="$(cat "${SANDBOX}/port" 2>/dev/null || echo '')"
  # 每次重启占用新的随机端口，配置必须跟着指向当前服务
  if [ -n "$MOCK_PORT" ]; then
    "$AIWS" intake model config --repo "$REPO" \
      --base-url "http://127.0.0.1:${MOCK_PORT}/v1" --model mock-model --json >/dev/null 2>&1 || true
  fi
}
stop_mock() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true   # 回收作业，避免 shell 打印 Terminated 噪音
    MOCK_PID=""
  fi
}

# ---------------------------------------------------------------
# 夹具
# ---------------------------------------------------------------
BATCH="$("$AIWS" intake scan --repo "$REPO" --source "${SRC}:cursor:project" --json 2>/dev/null | jq -r '.batch_id')"
"$AIWS" intake compare --repo "$REPO" --batch "$BATCH" --json >/dev/null 2>&1 || true
CAND="$(jq -r '[.candidates[] | select(.names | index("newrule"))][0].candidate_id' \
  "$REPO/.ai-workspace/intake/batches/$BATCH/candidates.json")"
SCAN_HASH="$(shasum -a 256 "$REPO/.ai-workspace/intake/batches/$BATCH/scan.json" | awk '{print $1}')"
CAND_HASH="$(shasum -a 256 "$REPO/.ai-workspace/intake/batches/$BATCH/candidates.json" | awk '{print $1}')"

_run_json() {
  local out
  out="$("$@" 2>/dev/null)" || true
  [ -n "$out" ] || out='{}'
  printf '%s' "$out"
}
prepare() {
  _run_json "$AIWS" intake model prepare --repo "$REPO" --batch "$BATCH" --candidate "$CAND" ${1:-} --json
}
send() {
  local rid="$1"; shift
  _run_json "$AIWS" intake model send --repo "$REPO" --request "$rid" "$@" --json
}

echo "=== intake model 测试 ==="

# ---------------------------------------------------------------
# 未配置：不发请求，整条人工闭环不受影响
# ---------------------------------------------------------------
echo ""
echo "--- 未配置 ---"

NOCONF="$(prepare)"
expect_eq "$(printf '%s' "$NOCONF" | jq -r '.ok')" "false" "prepare_without_config_refused"
expect_eq "$(printf '%s' "$NOCONF" | jq -r '.errors | index("model_not_configured") != null')" "true" "missing_config_reported"

start_mock ok
CONFIG_OUT="$("$AIWS" intake model config --repo "$REPO" \
  --base-url "http://127.0.0.1:${MOCK_PORT}/v1" --model mock-model --json 2>/dev/null)"
expect_eq "$(printf '%s' "$CONFIG_OUT" | jq -r '.configured')" "true" "config_written"
expect_eq "$(printf '%s' "$CONFIG_OUT" | jq -r '.config.base_url')" "http://127.0.0.1:${MOCK_PORT}/v1" "config_base_url_normalized"
expect_absent "$(cat "$REPO/.ai-workspace/intake/model-config.json")" "sk-" "config_file_holds_no_secret"

BAD_URL="$(_run_json "$AIWS" intake model config --repo "$REPO" --base-url "file:///etc/passwd" --model x --json)"
expect_absent "$BAD_URL" '"configured":true' "non_http_base_url_rejected"

# ---------------------------------------------------------------
# AC-001-09：未确认不发送；确认后实际发送内容与预览一致
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-09: 未确认不发送 ---"

: > "$MOCK_LOG"
PREP="$(prepare --with-repo)"
expect_eq "$(printf '%s' "$PREP" | jq -r '.request_id | startswith("ai-")')" "true" "prepare_creates_request"
expect_eq "$(wc -l < "$MOCK_LOG" | tr -d ' ')" "0" "prepare_sends_nothing"

RID="$(printf '%s' "$PREP" | jq -r '.request_id')"
REQ_FILE="$REPO/.ai-workspace/intake/ai/requests/$RID.json"
expect_eq "$(jq -r '.batches[0].body.messages | length' "$REQ_FILE")" "2" "request_has_system_and_user_message"
expect_eq "$(jq -r '.batches[0].body.response_format.type' "$REQ_FILE")" "json_object" "request_asks_json_object"

# 发送内容仅限选定候选，且含总库摘要
expect_eq "$(jq -r '.batches[0].body.messages[1].content | fromjson | .items | length' "$REQ_FILE")" "1" "only_selected_candidates_sent"
expect_eq "$(jq -r '.batches[0].body.messages[1].content | fromjson | .repo_assets | length > 0' "$REQ_FILE")" "true" "repo_assets_included_for_similarity"

# 凭据脱敏：明文绝不出现在发送内容里
expect_absent "$(jq -r '.batches[0].body.messages[1].content' "$REQ_FILE")" "sk-plaintext-must-not-leak" "plaintext_credential_not_in_payload"
expect_eq "$(jq -r '.batches[0].body.messages[1].content | fromjson | .items[0].redactions | length > 0' "$REQ_FILE")" "true" "credential_redaction_recorded"

SEND1="$(send "$RID" --batch 1)"
expect_eq "$(printf '%s' "$SEND1" | jq -r '.batches[0].status')" "ok" "confirmed_send_succeeds"
expect_eq "$(printf '%s' "$SEND1" | jq -r '.batches[0].suggestions | length')" "1" "suggestion_kept"
expect_eq "$(printf '%s' "$SEND1" | jq -r '.batches[0].suggestions[0].source_occurrence_id != null')" "true" "suggestion_references_source"
expect_eq "$(printf '%s' "$SEND1" | jq -r '.batches[0].uncovered_ranges | length')" "1" "uncovered_ranges_present"
expect_eq "$(wc -l < "$MOCK_LOG" | tr -d ' ')" "1" "send_performs_exactly_one_request"
expect_eq "$(jq -r '.url' "$MOCK_LOG" | head -1)" "/v1/chat/completions" "correct_endpoint"

# 响应内容不落盘，只留摘要
expect_eq "$(grep -c '整理自' "$REPO/.ai-workspace/intake/ai/results/$RID/manifest.json" 2>/dev/null || true)" "0" "manifest_holds_no_response_body"

# ---------------------------------------------------------------
# AC-001-10：范围变化 / 无效输出 / 部分失败 / 重试
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-10: 范围变化与失败处理 ---"

# 范围变化（预览后被改动）→ 拒绝按旧确认发送
TAMPER="$REPO/.ai-workspace/intake/ai/requests/$RID.json"
jq -c '.batches[0].body.messages[1].content = (.batches[0].body.messages[1].content | sub("newrule"; "newrule-tampered"))' "$TAMPER" > "${TAMPER}.tmp"
mv "${TAMPER}.tmp" "$TAMPER"
: > "$MOCK_LOG"
TAMPERED="$(send "$RID" --batch 1)"
expect_eq "$(printf '%s' "$TAMPERED" | jq -r '.batches[0].status')" "request_tampered" "changed_scope_refused"
expect_eq "$(wc -l < "$MOCK_LOG" | tr -d ' ')" "0" "changed_scope_not_sent"

# 无效 JSON；请求冻结了目标地址，必须在当前模拟服务启动后再 prepare
start_mock badjson
PREP2="$(prepare)"
RID2="$(printf '%s' "$PREP2" | jq -r '.request_id')"
expect_eq "$([ "$RID2" != "$RID" ] && echo yes || echo no)" "yes" "resend_requires_new_prepare"
BADJ="$(send "$RID2" --batch 1)"
expect_eq "$(printf '%s' "$BADJ" | jq -r '.batches[0].status')" "invalid_output" "invalid_json_detected"
expect_eq "$(printf '%s' "$BADJ" | jq -r '.batches[0].suggestions | length')" "0" "invalid_json_keeps_nothing"

# 无效来源引用 / 锚点不匹配 / 非法 kind → 建议被丢弃并记录原因
for m in badref badanchor badkind; do
  start_mock "$m"
  R="$(prepare)"
  RI="$(printf '%s' "$R" | jq -r '.request_id')"
  OUT="$(send "$RI" --batch 1)"
  expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].suggestions | length')" "0" "${m}_suggestion_discarded"
  expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].rejected | length')" "1" "${m}_rejection_recorded"
done

# 未覆盖区间：自动补齐并给出警告，原文不丢
start_mock nocoverage
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
OUT="$(send "$RI" --batch 1)"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].suggestions | length')" "1" "nocoverage_keeps_valid_suggestion"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].warnings | index("uncovered_ranges_autofilled") != null')" "true" "nocoverage_autofilled_and_warned"

# 超时：可重试；每次尝试单独留存
# 请求冻结了超时值，所以必须先改配置再 prepare
start_mock timeout
"$AIWS" intake model config --repo "$REPO" --timeout-ms 1200 --json >/dev/null 2>&1
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
OUT="$(send "$RI" --batch 1 --retry 1)"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].status')" "timeout" "timeout_reported"
expect_eq "$(printf '%s' "$(ls "$REPO/.ai-workspace/intake/ai/results/$RI"/batch-1.attempt-*.json | wc -l | tr -d ' ')" )" "2" "retry_keeps_each_attempt"
"$AIWS" intake model config --repo "$REPO" --timeout-ms 60000 --json >/dev/null 2>&1

# HTTP 500 → 可重试；4xx → 不重试
start_mock http500
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
OUT="$(send "$RI" --batch 1 --retry 1)"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].status')" "http_error" "http_500_reported"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[-1] | .errors[0]')" "http_status_500" "http_status_recorded"

# 4xx：客户端带了错误凭据 → 401；4xx 不重试
start_mock auth "Bearer sk-expected-by-server"
"$AIWS" intake model config --repo "$REPO" --credential-ref test_key --json >/dev/null 2>&1
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
OUT="$(AIWS_MODEL_CREDENTIAL="sk-wrong-value" send "$RI" --batch 1 --retry 2)"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].status')" "http_error" "4xx_not_retried"
expect_eq "$(ls "$REPO/.ai-workspace/intake/ai/results/$RI"/batch-1.attempt-*.json | wc -l | tr -d ' ')" "1" "4xx_single_attempt"

# 取消（清空凭据引用，避免解析失败掩盖取消路径）
"$AIWS" intake model config --repo "$REPO" --no-credential --json >/dev/null 2>&1
start_mock ok
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
touch "${SANDBOX}/cancel"
: > "$MOCK_LOG"
OUT="$(send "$RI" --batch 1 --cancel-file "${SANDBOX}/cancel")"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].status')" "cancelled" "cancel_reported"
expect_eq "$(wc -l < "$MOCK_LOG" | tr -d ' ')" "0" "cancel_sends_nothing"
rm -f "${SANDBOX}/cancel"

# ---------------------------------------------------------------
# AC-001-11：凭据与敏感值
# ---------------------------------------------------------------
echo ""
echo "--- AC-001-11: 凭据边界 ---"

CW="$REPO/.ai-workspace/intake/model-config.json"
expect_absent "$(cat "$CW")" "sk-" "config_never_stores_secret"

"$AIWS" intake model config --repo "$REPO" --credential-ref test_key --json >/dev/null 2>&1
start_mock auth "Bearer sk-unit-test-value"
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
OUT="$(AIWS_MODEL_CREDENTIAL="sk-unit-test-value" send "$RI" --batch 1)"
expect_eq "$(printf '%s' "$OUT" | jq -r '.batches[0].status')" "ok" "credential_sent_only_in_header"
expect_eq "$(jq -r '.auth' "$MOCK_LOG" | tail -1)" "Bearer sk-unit-test-value" "authorization_header_used"
expect_absent "$(cat "$REPO/.ai-workspace/intake/ai/requests/$RI.json")" "sk-unit-test-value" "secret_absent_from_request_record"
expect_absent "$(cat "$REPO/.ai-workspace/intake/ai/results/$RI/manifest.json")" "sk-unit-test-value" "secret_absent_from_manifest"
expect_eq "$(grep -rc "sk-unit-test-value" "$REPO/.ai-workspace/intake/ai" 2>/dev/null | grep -v ':0$' | wc -l | tr -d ' ')" "0" "secret_absent_from_all_attempt_records"

# 凭据解析不到 → 拒绝发送
R="$(prepare)"; RI="$(printf '%s' "$R" | jq -r '.request_id')"
: > "$MOCK_LOG"
AIWS_MODEL_CREDENTIAL="" "$AIWS" intake model send --repo "$REPO" --request "$RI" --batch 1 --json >/dev/null 2>&1 && RC=0 || RC=$?
expect_eq "$([ "$RC" != "0" ] && echo refused || echo sent)" "refused" "missing_credential_refuses_send"
expect_eq "$(wc -l < "$MOCK_LOG" | tr -d ' ')" "0" "missing_credential_sends_nothing"

# ---------------------------------------------------------------
# 失败不改变扫描与人工状态；无直接入库通道
# ---------------------------------------------------------------
echo ""
echo "--- 状态与写入边界 ---"

expect_eq "$(shasum -a 256 "$REPO/.ai-workspace/intake/batches/$BATCH/scan.json" | awk '{print $1}')" "$SCAN_HASH" "scan_state_unchanged"
expect_eq "$(shasum -a 256 "$REPO/.ai-workspace/intake/batches/$BATCH/candidates.json" | awk '{print $1}')" "$CAND_HASH" "candidate_state_unchanged"
expect_eq "$([ -e "$REPO/.ai-workspace/assets" ] && echo exists || echo absent)" "absent" "model_path_never_writes_assets"
expect_eq "$([ -e "$REPO/.ai-workspace/rules/domains/newrule.md" ] && echo exists || echo absent)" "absent" "model_path_never_writes_canonical"

stop_mock

echo ""
echo "=== 结果: ${PASS} ok, ${FAIL} not ok ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
