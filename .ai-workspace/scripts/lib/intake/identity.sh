#!/bin/sh
# intake/identity.sh - 内容指纹、来源 ID、凭据识别与分离
# 供 intake/scan.sh 调用；需先 source common.sh
# 只输出指纹与脱敏结果，绝不回显秘密明文

# ============================================================================
# 内容指纹
# ============================================================================

# 文件内容 sha256（跨平台：优先 shasum / sha256sum / openssl）
intake_sha256() {
  # $1 = 文件路径；$2 = 可选 stdin 内容（$1 为 "-" 时）
  if [ "$1" = "-" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
      shasum -a 256 | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
      openssl dgst -sha256 | awk '{print $NF}'
    else
      echo "nohash"
    fi
    return
  fi
  if [ ! -f "$1" ]; then
    echo "missing"
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    echo "nohash"
  fi
}

# 字符串 sha256（经 stdin）
intake_sha256_str() {
  printf '%s' "$1" | intake_sha256 -
}

# Skill 目录指纹：所有相对路径排序 + 每文件 hash；链接目标单独记录
# 输出单行 sha256
intake_fingerprint_skill_dir() {
  local dir="$1"
  local listing
  listing="$(
    find "$dir" \( -type f -o -type l \) 2>/dev/null \
      | sed "s|^${dir}/||" \
      | sort \
      | while IFS= read -r rel; do
          if [ -L "${dir}/${rel}" ]; then
            printf '%s|link|%s\n' "$rel" "$(readlink "${dir}/${rel}" 2>/dev/null || echo '?')"
          else
            printf '%s|file|%s\n' "$rel" "$(intake_sha256 "${dir}/${rel}")"
          fi
        done
  )"
  printf '%s' "$listing" | intake_sha256 -
}

# MCP JSON 指纹：顶层 server 键排序、保留 args 顺序、env 键值
# 凭据字段在此处已由 intake_strip_credentials 处理为占位符
intake_fingerprint_mcp_json() {
  local json="$1"
  printf '%s' "$json" | jq -cS '
    if type == "object" then
      with_entries(.value |= (
        if type == "object" then
          # 保留 args 数组顺序（jq -S 只排对象键，不排数组）
          .
        else . end
      ))
    else . end
  ' 2>/dev/null | intake_sha256 -
}

# Rule 正文指纹：保留全部字节（不规范化空白）
intake_fingerprint_rule_body() {
  local body_file="$1"
  intake_sha256 "$body_file"
}

# ============================================================================
# 来源 ID（SourceOccurrence）
# ============================================================================

# occurrence_id = sha256(source_root|tool|scope|path)[:16]
intake_occurrence_id() {
  local source_root="$1" tool="$2" scope="$3" path="$4"
  intake_sha256_str "${source_root}|${tool}|${scope}|${path}" | cut -c1-16
}

# batch_id = batch-YYYYmmdd-HHMMSS-<6位随机>
intake_new_batch_id() {
  local ts rnd
  ts="$(date -u '+%Y%m%d-%H%M%S' 2>/dev/null || date '+%Y%m%d-%H%M%S')"
  rnd="$(od -An -N3 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | cut -c1-6)"
  [ -n "$rnd" ] || rnd="$$"
  printf 'batch-%s-%s\n' "$ts" "$rnd"
}

# ============================================================================
# 凭据识别与分离
# ============================================================================

# 已知敏感字段名模式（小写比较）
INTAKE_SENSITIVE_KEY_RE='api[_-]?key|token|password|passwd|secret|credential|authorization|auth[_-]?header|private[_-]?key|access[_-]?key'

# 判断字段名是否敏感
intake_is_sensitive_key() {
  local key="$1"
  printf '%s' "$key" | grep -qiE "$INTAKE_SENSITIVE_KEY_RE"
}

# 判断值是否为 ${secret:...} 引用
intake_is_secret_ref() {
  printf '%s' "$1" | grep -qE '^\$\{secret:[a-zA-Z0-9_]+\}'
}

# 机器本地凭据身份盐：随机生成、0600、只落本地记录区（design 3.2），不纳入 Git
# design 6.1 原方案用 vault 主密钥，但主密钥由口令派生、需要交互认证，
# 扫描与比较不能要求用户输入口令；随机盐同样满足 spec 5.4
# 「不能保存可离线猜测的低熵秘密摘要」——只拿到仓库的人拿不到盐。
# 覆盖顺序：INTAKE_CRED_SALT（测试注入）> INTAKE_CRED_SALT_FILE > <repo>/.../intake/cred-salt
intake_cred_salt() {
  if [ -n "${INTAKE_CRED_SALT:-}" ]; then
    printf '%s' "$INTAKE_CRED_SALT"
    return 0
  fi

  local file="${INTAKE_CRED_SALT_FILE:-}"
  if [ -z "$file" ]; then
    [ -n "${INTAKE_REPO:-}" ] || return 1
    file="${INTAKE_REPO}/.ai-workspace/intake/cred-salt"
  fi

  if [ ! -s "$file" ]; then
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    od -An -tx1 -N32 /dev/urandom 2>/dev/null | tr -d ' \n' > "$file" 2>/dev/null || return 1
    chmod 600 "$file" 2>/dev/null || true
  fi

  [ -s "$file" ] || return 1
  cat "$file"
}

# 凭据身份指纹：HMAC(机器本地盐, 值) 截断 16 位，绝不输出原值
# 无盐可用时返回 unidentified；调用方不得据此认定两个账号相同
intake_credential_identity() {
  local value="$1" salt
  salt="$(intake_cred_salt)" || { printf 'unidentified'; return 0; }

  if command -v openssl >/dev/null 2>&1; then
    printf '%s' "$value" | openssl dgst -sha256 -hmac "$salt" 2>/dev/null \
      | awk '{print $NF}' | cut -c1-16
  else
    intake_sha256_str "${salt}:${value}" | cut -c1-16
  fi
}

# 从 MCP server JSON 中分离凭据与可疑字段（递归处理所有嵌套层级）
# 输入: 单个 server 的 JSON 对象
# 输出: {"sanitized": {...}, "credentials": [{field, kind}], "suspects": [{field, reason}]}
# credentials/suspects 只含字段路径与引用信息，不含明文
# 脱敏失败时返回空 sanitized + 全量 suspects，不回退为原始对象
intake_strip_credentials() {
  local server_json="$1"
  local result
  result="$(printf '%s' "$server_json" | jq -c '
    def senskey: test("(?i)(api[_-]?key|token|password|passwd|secret|credential|authorization|auth[_-]?header|private[_-]?key|access[_-]?key)");
    def as_str: if type == "string" then . else tostring end;
    def is_ref: type == "string" and test("^\\$\\{secret:[A-Za-z0-9_]+\\}");

    # 递归脱敏：处理任意深度嵌套对象与数组
    # 返回 {clean, creds, suspects}，creds/suspects 为累积列表
    def redact(path):
      if type == "object" then
        (to_entries | map(
          .key as $k | .value as $v | (path + [$k]) as $p |
          ($p | join(".")) as $pname |
          if ($k | senskey) then
            # 已知敏感字段
            if ($v | is_ref) then
              {clean: {key: $k, value: $v}, creds: [{field: $pname, kind: "ref"}], suspects: []}
            elif ($v | type) == "string" and ($v | length) > 0 then
              {clean: {key: $k, value: "REDACTED"}, creds: [{field: $pname, kind: "cred"}], suspects: []}
            else
              {clean: {key: $k, value: $v}, creds: [], suspects: []}
            end
          elif ($v | type) == "object" then
            ($v | redact($p)) as $r |
            {clean: {key: $k, value: ($r.clean)}, creds: $r.creds, suspects: $r.suspects}
          elif ($v | type) == "array" then
            ($v | to_entries | map(.value as $item | ($p + [(.key | tostring)]) as $ip |
              ($item | redact($ip)) as $r |
              {clean: $r.clean, creds: $r.creds, suspects: $r.suspects}
            )) as $items |
            {clean: {key: $k, value: ($items | map(.clean))},
             creds: ($items | map(.creds) | add // []),
             suspects: ($items | map(.suspects) | add // [])}
          else
            {clean: {key: $k, value: $v}, creds: [], suspects: []}
          end
        )) as $entries |
        {
          clean: ($entries | map({key: .clean.key, value: .clean.value}) | from_entries),
          creds: ($entries | map(.creds) | add // []),
          suspects: ($entries | map(.suspects) | add // [])
        }
      elif type == "array" then
        (to_entries | map(.value as $item | (path + [(.key | tostring)]) as $ip |
          ($item | redact($ip)) as $r | $r
        )) as $items |
        {
          clean: ($items | map(.clean)),
          creds: ($items | map(.creds) | add // []),
          suspects: ($items | map(.suspects) | add // [])
        }
      else
        {clean: ., creds: [], suspects: []}
      end;

    if type != "object" then
      {sanitized: ., credentials: [], suspects: [{field: "(root)", reason: "not_an_object"}]}
    else
      (redact([])) as $r |
      {
        sanitized: $r.clean,
        credentials: $r.creds,
        suspects: $r.suspects
      }
    end
  ' 2>/dev/null)"

  # 脱敏失败：不回退为原始对象，返回空 sanitized + 全量 suspects
  if [ -z "$result" ] || ! printf '%s' "$result" | jq -e . >/dev/null 2>&1; then
    printf '{"sanitized":{},"credentials":[],"suspects":[{"field":"(all)","reason":"redact_failed"}]}\n'
    return 0
  fi

  printf '%s\n' "$result"
}

# 对 rule/skill 文本做敏感字段提示（不改内容，只报告）
# 输出: JSON 数组 [{field, line, reason}]
intake_scan_text_suspects() {
  local file="$1"
  [ -f "$file" ] || { echo "[]"; return; }
  # 只报告，不修改
  grep -nEi '(api[_-]?key|token|password|passwd|secret|credential|authorization)[[:space:]]*[:=]' "$file" 2>/dev/null \
    | head -20 \
    | awk -F: '{
        gsub(/"/, "", $2);
        printf "%s\n", $1
      }' \
    | jq -R -s 'split("\n") | map(select(length > 0) | {line: (. | tonumber), reason: "sensitive_keyword"})' 2>/dev/null \
    || echo "[]"
}

# 把凭据字段值替换为 REDACTED 占位（用于 content_fingerprint 计算，不存明文）
# 递归处理所有嵌套层级，与 intake_strip_credentials 同步
intake_redact_for_fingerprint() {
  local json="$1"
  printf '%s' "$json" | jq -cS '
    def senskey: test("(?i)(api[_-]?key|token|password|passwd|secret|credential|authorization|auth[_-]?header|private[_-]?key|access[_-]?key)");
    def redact:
      if type == "object" then
        with_entries(
          if (.key | senskey) then
            if (.value | type) == "string" and (.value | test("^\\$\\{secret:")) then .
            else .value = "REDACTED" end
          else
            .value |= redact
          end
        )
      elif type == "array" then map(redact)
      else . end;
    redact
  ' 2>/dev/null || printf '%s' "$json" | jq -cS '.' 2>/dev/null || printf '{}'
}

# ============================================================================
# 比较用共享材料
# scan.sh 与 compare.sh 必须得到完全一致的指纹，两处共用这些函数
# ============================================================================

# Skill 目录清单：每行 "<相对路径>|file|<sha256>" 或 "<相对路径>|link|<目标>"，按路径排序
# 指纹取本清单整体哈希；相对路径差异比较复用同一清单，避免两处语义漂移
intake_skill_manifest() {
  local dir="$1"
  [ -d "$dir" ] || return 0

  find "$dir" \( -type f -o -type l \) 2>/dev/null \
    | sed "s|^${dir}/||" \
    | sort \
    | while IFS= read -r rel; do
        if [ -L "${dir}/${rel}" ]; then
          printf '%s|link|%s\n' "$rel" "$(readlink "${dir}/${rel}" 2>/dev/null || echo '?')"
        else
          printf '%s|file|%s\n' "$rel" "$(intake_sha256 "${dir}/${rel}")"
        fi
      done
}

# 规则 frontmatter 中影响适用范围的元数据
# 输出: {title, description, globs, always_apply}，缺失字段为 null
intake_rule_meta() {
  local file="$1"
  if [ ! -f "$file" ]; then
    printf '{}\n'
    return 0
  fi

  jq -nc \
    --arg title "$(grep -m1 '^title:' "$file" 2>/dev/null | sed 's/^title:[[:space:]]*//' | tr -d '"')" \
    --arg desc "$(grep -m1 '^description:' "$file" 2>/dev/null | sed 's/^description:[[:space:]]*//' | tr -d '"')" \
    --arg globs "$(grep -m1 '^globs:' "$file" 2>/dev/null | sed 's/^globs:[[:space:]]*//' | tr -d '"')" \
    --arg always "$(grep -m1 '^alwaysApply:' "$file" 2>/dev/null | sed 's/^alwaysApply:[[:space:]]*//' | tr -d ' ')" \
    '{
      title: (if $title == "" then null else $title end),
      description: (if $desc == "" then null else $desc end),
      globs: (if $globs == "" then null else $globs end),
      always_apply: (if $always == "" then null else ($always == "true") end)
    }'
}

# 拆分单个 MCP server 为「行为字段」与「凭据字段」（spec 5.2：凭据差异单独表达）
# 行为字段 = 去掉敏感键后的配置；凭据字段只给出字段路径与原始值，由调用方转成身份
# 输出: {"behavior": {...}, "cred_fields": [{field, value}]}
intake_mcp_split_server() {
  local server_json="$1"
  local parts

  parts="$(printf '%s' "$server_json" | jq -c '
    def senskey: test("(?i)(api[_-]?key|token|password|passwd|secret|credential|authorization|auth[_-]?header|private[_-]?key|access[_-]?key)");
    def as_str: if type == "string" then . else tostring end;

    if type != "object" then
      {behavior: ., cred_fields: []}
    else
      (to_entries | map(
        .key as $k | .value as $v |
        if $k == "env" and ($v | type) == "object" then
          {k: $k, sensitive: false,
           behavior: ($v | to_entries | map(select((.key | senskey) | not) | {key: .key, value: .value}) | from_entries),
           creds: ($v | to_entries | map(select(.key | senskey) | {field: ("env." + .key), value: (.value | as_str)}))}
        elif ($k | senskey) then
          {k: $k, sensitive: true, behavior: null,
           creds: [{field: $k, value: ($v | as_str)}]}
        else
          {k: $k, sensitive: false, behavior: $v, creds: []}
        end
      )) as $items |
      {behavior: ($items | map(select(.sensitive | not) | {key: .k, value: .behavior}) | from_entries),
       cred_fields: ($items | map(.creds) | add // [])}
    end
  ' 2>/dev/null)" || parts=""

  [ -n "$parts" ] || parts='{"behavior":{},"cred_fields":[]}'
  printf '%s\n' "$parts"
}

# MCP server 身份：行为指纹 + 凭据身份引用（均不含明文）
# 输出: {"behavior": {...}, "cred_refs": [{field, ref}], "cred_fingerprint": "sha256:..."}
intake_mcp_server_identity() {
  local server_json="$1"
  local parts
  parts="$(intake_mcp_split_server "$server_json")"

  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/aiws-cred.XXXXXX")"
  printf '%s' "$parts" | jq -c '.cred_fields[]?' 2>/dev/null \
    | while IFS= read -r ent; do
        local field value ref
        field="$(printf '%s' "$ent" | jq -r '.field // ""')"
        value="$(printf '%s' "$ent" | jq -r '.value // ""')"
        if intake_is_secret_ref "$value"; then
          ref="ref:$(printf '%s' "$value" | sed -E 's/^\$\{secret:([A-Za-z0-9_]+)\}.*/\1/')"
        else
          ref="cred:$(intake_credential_identity "$value")"
        fi
        printf '%s\t%s\n' "$field" "$ref"
      done > "$tmp"

  local cred_refs cred_fp behavior
  cred_refs="$(jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {field: .[0], ref: .[1]}) | sort_by(.field)' "$tmp" 2>/dev/null)"
  rm -f "$tmp"
  [ -n "$cred_refs" ] || cred_refs="[]"

  cred_fp="$(printf '%s' "$cred_refs" | jq -r '[.[] | (.field + "=" + .ref)] | join("|")' 2>/dev/null | intake_sha256 -)"
  behavior="$(printf '%s' "$parts" | jq -c '.behavior // {}' 2>/dev/null)"
  [ -n "$behavior" ] || behavior='{}'

  # 行为指纹：对象键排序、数组顺序保留（spec 5.2）
  local behavior_fp
  behavior_fp="$(printf '%s' "$behavior" | jq -cS '.' 2>/dev/null | intake_sha256 -)"

  jq -nc --argjson b "$behavior" --argjson c "$cred_refs" \
    --arg cfp "$cred_fp" --arg bfp "$behavior_fp" \
    '{behavior: $b, cred_refs: $c,
      behavior_fingerprint: ("sha256:" + $bfp),
      cred_fingerprint: ("sha256:" + $cfp)}'
}

# 候选稳定 ID：与 design 3.3 的资产 ID 同构，TASK-001-04 生成资产 ID 时可直接沿用
intake_candidate_id() {
  local type="$1" fingerprint="$2"
  printf 'cand-%s\n' "$(intake_sha256_str "${type}|${fingerprint}" | cut -c1-16)"
}

# 资产稳定 ID：与候选 ID 同构（design 3.3 / 17.5），入库时由候选身份直接沿用
# 同一 type+identity 恒定得到同一 ID，因此重复执行 add 不会产生重复资产
intake_asset_id() {
  local type="$1" identity="$2"
  printf 'asset-%s\n' "$(intake_sha256_str "${type}|${identity}" | cut -c1-16)"
}

# ============================================================================
# MCP 文件读取（只读）
# ============================================================================

# 读取 MCP 配置文件中的 servers 对象
# tool=canonical 读取总库规范源 .servers；codex 走 TOML；其余走 .mcpServers
intake_mcp_read_servers() {
  local tool="$1" file="$2" raw=""

  if [ ! -f "$file" ]; then
    printf '{}\n'
    return 0
  fi

  case "$tool" in
    canonical) raw="$(jq -c '.servers // {}' "$file" 2>/dev/null || echo '{}')" ;;
    codex)     raw="$(parse_codex_mcp_json "$file" 2>/dev/null || echo '{}')" ;;
    *)         raw="$(parse_json_mcp "$file" 2>/dev/null || echo '{}')" ;;
  esac

  [ -n "$raw" ] || raw='{}'
  printf '%s' "$raw" | jq -c 'if type == "object" then . else {} end' 2>/dev/null || printf '{}\n'
}

# 逐 server 输出身份信息（每行一个 JSON），按 server 名排序
intake_mcp_server_identities() {
  local tool="$1" file="$2"
  local servers
  servers="$(intake_mcp_read_servers "$tool" "$file")"

  printf '%s' "$servers" | jq -r 'keys[]?' 2>/dev/null \
    | sort \
    | while IFS= read -r name; do
        [ -n "$name" ] || continue
        local one
        one="$(printf '%s' "$servers" | jq -c --arg n "$name" '.[$n] // {}' 2>/dev/null)"
        [ -n "$one" ] || one='{}'
        intake_mcp_server_identity "$one" | jq -c --arg n "$name" '. + {name: $n}' 2>/dev/null
      done
}

# 规则 frontmatter 中的 id（入库时用作规范源文件名，与 register_mapping_entry 约定一致）
intake_rule_frontmatter_id() {
  local file="$1" id
  [ -f "$file" ] || { printf ''; return 0; }
  id="$(grep -m1 '^id:' "$file" 2>/dev/null | sed 's/^id:[[:space:]]*//' | tr -d '"'"'"'')"
  printf '%s' "$id"
}
