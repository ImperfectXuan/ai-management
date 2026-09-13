# 05 · 密钥（Secrets）

> **测试对象**：加密 vault 初始化、`secrets set/list/remove/audit`、`${secret:}` 占位符替换。
> **前置**：装好 `age` + `oathtool`（`brew install age oath-toolkit`，见 [00-environment.md §2.2](00-environment.md)），并准备一个 TOTP 认证器 App（如 Google Authenticator / Authy）。
> **写文件**：`setup`（vault 初始化）、`secrets set/remove` 写 `vault.enc`。**强烈建议在临时仓库做**。

---

## 1. 目标

密钥用 `age` 加密存于 `secrets/vault.enc`，配 TOTP 2FA；`permissions.yaml` 控制「哪些工具可用哪些密钥」。本域验证：

1. 只读审计（`audit`）无需加密依赖也能跑。
2. `AIWS_JSON=1` 下只读命令不触发交互（不挂起）。
3. vault 初始化（passphrase + 2FA）流程正确。
4. `set/list/remove` 读写加密 vault。
5. MCP 中的 `${secret:XXX}` 占位符被正确替换。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws

# 确认依赖
age --version && oathtool --version 2>&1 | head -1
```

> 未装依赖时，`secrets` 写命令会报 `age is required` / `oathtool is required`。

---

## 3. 只读审计 `secrets audit`（无依赖）

`audit` 只读 `permissions.yaml` + 扫描 MCP 占位符，**不需要** age/oathtool，也不解密。

### 步骤 3.1 — 文本审计

```bash
$AIWS secrets audit
```

**预期**：`Secrets usage audit:` + 每个工具一行 `codex: / claude: / cursor: / trae:`（默认 `allowed_secrets: []` 显示 `(none)`），随后 `No secret references in MCP config.`（或列出占位符）。

**判定**：✅ 列出四工具权限与 MCP 引用，无 `[ERROR]`。

### 步骤 3.2 — JSON 审计

```bash
AIWS_JSON=1 $AIWS secrets audit 2>/dev/null | jq .
```

**预期**：`{"tools":[{"tool":"codex","allowed":[]},...],"mcp_refs":[]}`。
**判定**：✅ 合法 JSON，`tools` 四条目。

---

## 4. 只读 JSON 输出不挂起（关键）

`secrets list` 在**文本模式**会走交互解密（若 vault 已初始化），但 `AIWS_JSON=1` 时**不触发交互**：

```bash
AIWS_JSON=1 $AIWS secrets list 2>/dev/null
```

**预期**（vault 未初始化时）：`{"secrets":[],"vault_ready":false,"error":"vault not initialized"}`。
**判定**：✅ 命令**立即返回**（不等待输入），输出 JSON。

> ⚠️ 这是 TUI 密钥页能安全调用的保证。若这里卡住等输入，说明回归 bug。

---

## 5. vault 初始化（交互）

在**临时仓库**做，避免把 vault 建到真实仓库：

```bash
TMP=$(mktemp -d /tmp/aiws-vault.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws
```

### 步骤 5.1 — 启动 setup 并选择初始化 vault

```bash
$AIWS_TMP setup
```

**预期**：目录创建完成后，提示：

```
Initialize secrets vault? [y/N]
```

输入 `y` 回车。

### 步骤 5.2 — 设置主口令

**预期**：出现 `Step 1: Set master passphrase`，提示 `Minimum 8 characters.`

输入一个 ≥8 位口令（如 `test-passphrase-123`），回车。

**判定**：✅ 进入下一步；若提示 `Passphrase must be at least 8 characters` 说明口令太短。

### 步骤 5.3 — 设置 2FA

**预期**：`Step 3: Setup Two-Factor Authentication`，打印 `TOTP Secret: XXXX...`（一串大写 base32，如 16 字符）。

**操作**：把 `TOTP Secret` 录入手机认证器 App（或手动添加），然后在 `Enter the 6-digit code ...` 输入 App 显示的 6 位码。

**预期**：`2FA verified successfully!`（若码错/超时则 `Verification failed`，可稍后 `aiws setup --reset-2fa` 重设）。

**判定**：✅ 验证成功。

### 步骤 5.4 — 检查产物

```bash
ls -la .ai-workspace/secrets/
```

**预期**：出现 `vault.enc`（加密 vault）、`.vault-key.age`、`.vault-salt`、`.vault-totp`、`permissions.yaml`。

```bash
grep -q '.vault-key.age' .gitignore && echo "已加入 gitignore"
```

**预期**：`已加入 gitignore`（密钥文件已排除提交）。
**判定**：✅ 产物齐全、gitignore 已更新。

> 注意：`.vault-key.age` / `.vault-salt` / `.vault-totp` 是**绝不可提交**的本地密钥；`vault.enc` 是加密态、可安全提交。

---

## 6. `secrets set` / `list` / `remove`（读写）

继续在同一个临时仓库（vault 已初始化）。

### 步骤 6.1 — 写入一个密钥

```bash
$AIWS_TMP secrets set GITHUB_TOKEN
```

**预期**：交互流程：
1. `Enter value for 'GITHUB_TOKEN': ` → 输入值（如 `ghp_test123`）回车（输入被隐藏）。
2. `Enter passphrase:` → 输入主口令。
3. `Enter 2FA code from authenticator:` → 输入 6 位码。
4. `Re-enter passphrase to save:` → 再次输入主口令。
5. `[OK] Secret set: GITHUB_TOKEN`

**判定**：✅ 五步走完，输出 `Secret set`。

> 也可直接带值：`$AIWS_TMP secrets set GITHUB_TOKEN ghp_test123`，跳过第 1 步输入。

### 步骤 6.2 — 列出密钥名（不显示值）

```bash
$AIWS_TMP secrets list
```

**预期**：`Stored secrets:` 后跟 `  - GITHUB_TOKEN`（只显示名字，不显示值）。同样需要 passphrase + 2FA。
**判定**：✅ 列出密钥名、不泄露值。

### 步骤 6.3 — 删除密钥

```bash
$AIWS_TMP secrets remove GITHUB_TOKEN
```

**预期**：passphrase + 2FA + 再次 passphrase，输出 `Secret removed: GITHUB_TOKEN`。
**判定**：✅ 删除生效，`secrets list` 不再有它。

### 步骤 6.4 — 收尾

```bash
cd / && rm -rf "$TMP"
```

---

## 7. `${secret:}` 占位符替换（MCP 联动）

vault 初始化后，`mcp.json` 里的 `${secret:XXX}` 会在 sync 时替换为真实值（按 `permissions.yaml` 授权）。

### 步骤 7.1 — 观察未初始化时的告警

在**未初始化 vault 的临时仓库**里，向 `mcp.json` 加一个含占位符的服务器：

```bash
TMP=$(mktemp -d /tmp/aiws-secret-ref.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws

# 直接往 mcp.json 加占位符（vault 未初始化）
jq '.servers["with-secret"] = {command:"echo", args:["${secret:GITHUB_TOKEN}"], scope:["project"]}' \
  .ai-workspace/mcp/mcp.json > /tmp/mcp.tmp && mv /tmp/mcp.tmp .ai-workspace/mcp/mcp.json

$AIWS_TMP sync --only mcp --scope project 2>&1 | grep -i "secret"
```

**预期**：输出 `Unresolved secret references found. Run 'aiws setup' to initialize vault.`
**判定**：✅ 未初始化 vault 时给出明确告警（不静默失败）。

### 步骤 7.2 — 收尾

```bash
cd / && rm -rf "$TMP"
```

> 完整「占位符 → 真实值」的替换需在已初始化 vault 的仓库里、且 `permissions.yaml` 授予该工具对应密钥后才能看到（涉及交互解密，可选用 §6 的仓库继续验证）。

---

## 8. 验收清单

- [ ] `secrets audit` 文本 + JSON 均可用（无 age/oathtool 依赖）。
- [ ] `AIWS_JSON=1 secrets list` 立即返回、不挂起。
- [ ] `setup` → `y` 完成 vault 初始化（passphrase + 2FA + 产物齐全 + gitignore）。
- [ ] `secrets set/list/remove` 走 passphrase + 2FA 流程，值不泄露。
- [ ] `${secret:}` 占位符在 vault 未初始化时触发告警。
