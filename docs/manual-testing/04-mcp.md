# 04 · MCP（MCP 服务器配置）

> **测试对象**：MCP 服务器的列表/详情/新增/删除，`scope` 字段驱动的分发，生成 JSON/TOML 原生配置。
> **前置**：[01-cli-basics.md](01-cli-basics.md)。
> **写文件**：`mcp add/remove` 改 `mcp.json`；`sync` 生成工具原生 MCP 配置。建议临时仓库。

---

## 1. 目标

MCP 配置存在 `.ai-workspace/mcp/mcp.json`（主配置，可提交）+ `mcp.local.json`（本地覆盖，gitignore）。本域验证：

1. `mcp list/show` 读取配置。
2. `mcp add/remove` 增删服务器。
3. `scope` 字段控制 global / project 分发。
4. sync 生成各工具原生 JSON / TOML。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws
```

---

## 3. 列表与详情（只读）

### 步骤 3.1 — 文本列表

```bash
$AIWS mcp list
```

**预期**：

```
Configured MCP servers:
  filesystem: npx
  browser-use: npx
  node_repl: /Applications/Codex.app/Contents/Resources/node_repl
```

**判定**：✅ 列出已配置的服务器名 + command。

### 步骤 3.2 — JSON 列表

```bash
AIWS_JSON=1 $AIWS mcp list 2>/dev/null | jq .
```

**预期**：`{"servers":[{"name":"filesystem","command":"npx"}, ...]}`。
**判定**：✅ 合法 JSON，含 `name`/`command`。

### 步骤 3.3 — 查看单服务器详情

```bash
$AIWS mcp show filesystem
```

**预期**：打印该服务器的完整 JSON（含 `command`、`args`、`scope`）。
**判定**：✅ 详情含 `scope` 字段。

---

## 4. `scope` 字段与分发（理解）

`scope` 决定该服务器分发到 project（仓库内）还是 global（用户主目录）配置：

| scope | 分发位置（示例） |
|---|---|
| `["project"]` | 仓库内 `.mcp.json`、`.cursor/mcp.json`、`.trae/mcp.json`、`.codex/config.toml` |
| `["global"]` | 主目录 `~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json`（Trae 无 global） |
| `["global","project"]` | 两处都分发 |

**用现有配置对照**：

```bash
# node_repl 是 global-only，project 配置里不应出现
grep -c node_repl .mcp.json .cursor/mcp.json 2>&1
# filesystem 是 global+project，project 配置里应有
grep -c filesystem .mcp.json .cursor/mcp.json 2>&1
```

**预期**：`node_repl` 在 project 配置计数 `0`；`filesystem` 计数 `≥1`。
**判定**：✅ 理解 scope 过滤。

---

## 5. `mcp add` / `remove`（写配置）

在**临时仓库**做增删：

```bash
TMP=$(mktemp -d /tmp/aiws-mcp.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws
```

### 步骤 5.1 — 添加

```bash
$AIWS_TMP mcp add echo-server npx -y @modelcontextprotocol/server-everything
```

**预期**：`Added MCP server: echo-server`。

```bash
$AIWS_TMP mcp show echo-server
```

**预期**：`echo-server` 含 `command: npx`、`args: ["-y","@modelcontextprotocol/server-everything"]`、`scope: ["project"]`。
**判定**：✅ 命令 + 参数 + 默认 scope 正确（`mcp add` 默认 scope 为 `["project"]`）。

### 步骤 5.2 — 列表确认

```bash
$AIWS_TMP mcp list
```

**预期**：列表新增 `echo-server: npx`。
**判定**：✅ 新服务器出现。

### 步骤 5.3 — 删除

```bash
$AIWS_TMP mcp remove echo-server
```

**预期**：`Removed MCP server: echo-server`。

```bash
$AIWS_TMP mcp list | grep echo-server || echo "已删除"
```

**预期**：`已删除`（列表中不再有 echo-server）。
**判定**：✅ 删除生效。

### 步骤 5.4 — 收尾

```bash
cd / && rm -rf "$TMP"
```

---

## 6. sync 分发验证（生成原生配置）

在临时仓库验证：`sync` 把 `mcp.json` 翻译成各工具原生格式。

```bash
TMP=$(mktemp -d /tmp/aiws-mcp-sync.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws
```

### 步骤 6.1 — 仅同步 MCP 到 project scope

```bash
$AIWS_TMP sync --only mcp --scope project
```

**预期**：输出 `Syncing MCP configurations...` 及每工具 `MCP synced: <tool> (project) -> <路径>`。

**判定**：✅ 四个工具都输出 `MCP synced`。

### 步骤 6.2 — 检查 JSON 输出（Claude / Cursor / Trae）

```bash
cat .mcp.json | jq '.mcpServers | keys'
cat .cursor/mcp.json | jq '.mcpServers | keys'
```

**预期**：`filesystem`、`browser-use` 在列；`node_repl`（global-only）**不在**列。
**判定**：✅ project scope 只含 project/both 的服务器。

### 步骤 6.3 — 检查 TOML 输出（Codex）

```bash
cat .codex/config.toml
```

**预期**：`[mcp_servers.filesystem]`、`[mcp_servers.browser-use]` 段落，`command`/`args` 正确。
**判定**：✅ Codex 输出 TOML（其余为 JSON）。

### 步骤 6.4 — 收尾

```bash
cd / && rm -rf "$TMP"
```

> ⚠️ 若不加 `--scope project`，`sync --only mcp` 会同时写 **global** 配置到 `~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json`。手工测试时优先用 `--scope project` 隔离在仓库内。

---

## 7. `${secret:}` 占位符（简提）

`mcp.json` 里可用 `${secret:XXX}` 引用密钥占位，sync 时若 vault 就绪则替换为真实值、未就绪则告警。完整验证见 [05-secrets.md §6](05-secrets.md)。

```bash
# 示例：向 mcp.json 加入含占位符的服务器后 sync，观察告警
# sync 输出会提示 "Unresolved secret references found. Run 'aiws setup' to initialize vault."
```

---

## 8. 验收清单

- [ ] `mcp list` 文本 / JSON 均列出服务器。
- [ ] `mcp show <name>` 显示完整详情（含 `scope`）。
- [ ] `mcp add` 默认 `scope: ["project"]`，`command`/`args` 正确。
- [ ] `mcp remove` 删除生效。
- [ ] `sync --only mcp --scope project` 生成 JSON（claude/cursor/trae）+ TOML（codex），并按 scope 过滤。
