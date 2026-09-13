# 02 · 规则（Rules）

> **测试对象**：规范规则的来源结构、`mapping.yaml` 装载语义、规则版本化（`rules status/history`）、`tools` 字段过滤。
> **前置**：[01-cli-basics.md](01-cli-basics.md)；`cd /Users/xuanyi/Documents/AI-management` 并 `AIWS=./.ai-workspace/scripts/aiws`。
> **写文件**：§7 在临时仓库写一条测试规则并 sync。

---

## 1. 目标

规则是「行为约束」，存在 `.ai-workspace/rules/`（核心）+ `rules/domains/`（领域）。本域验证：

1. 规则文件结构（frontmatter 字段）正确。
2. `mapping.yaml` 的 `required` 如何决定「始终装载 / 按需装载」。
3. `rules status` / `rules history` 版本化命令可用。
4. `tools` 字段能按工具过滤规则。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws
```

---

## 3. 规则来源结构（只读）

### 步骤 3.1 — 盘点规则文件

```bash
ls .ai-workspace/rules/*.md .ai-workspace/rules/domains/*.md
```

**预期**：8 条核心（`00-core` ~ `07-conversation-style`）+ 6 条领域（`aspnet / vue3 / winforms / wpf / global-workflow / karpathy-behavioral`），共 14 条。

**判定**：✅ 14 个文件，命名符合 `nn-topic.md`（核心）/ `topic.md`（领域）。

### 步骤 3.2 — 读一条规则 frontmatter

```bash
head -8 .ai-workspace/rules/00-core.md
```

**预期**：

```markdown
---
id: 00-core
title: 核心原则
scope: all
---
```

**判定**：✅ 首行 `---` 起始，含 `id` / `title` / `scope` 三必填字段。

| frontmatter 字段 | 含义 | 示例 |
|---|---|---|
| `id` | 唯一标识，也是生成文件名 | `00-core`、`vue3` |
| `title` | 人类可读标题 | `核心原则` |
| `scope` | 适用领域（all/csharp/vue/winforms/wpf） | `all` |
| `description` | 可选描述，进入生成文件的 `description` | — |
| `globs` | 可选，装载的文件匹配模式 | `**/*.ts` |
| `tools` | 可选，限定适用工具（见 §7） | `[cursor, trae]` |

---

## 4. mapping.yaml 与装载语义（只读）

每个工具适配器有一份 `mapping.yaml`，声明「哪些规则要同步、是否始终装载」。

### 步骤 4.1 — 查看 Cursor 的映射

```bash
cat .ai-workspace/adapters/cursor/mapping.yaml
```

**预期**：`rules:` 列表里，8 条核心 `required: true`，6 条领域 `required: false`。

**判定**：✅ 核心规则 `required: true`、领域规则 `required: false`。

### 步骤 4.2 — `required` 如何落到生成文件（对照生成结果）

`required` 决定生成文件 frontmatter 里的 `alwaysApply`：

```bash
grep -E '^(description|globs|alwaysApply)' .cursor/rules/00-core.mdc
echo "---- 对比领域规则 ----"
grep -E '^(description|globs|alwaysApply)' .cursor/rules/vue3.mdc
```

**预期**：
- `00-core.mdc`：`alwaysApply: true`（始终装载）
- `vue3.mdc`：`alwaysApply: false`（按 globs 按需装载）

**判定**：✅ 核心规则 `alwaysApply: true`，领域规则 `alwaysApply: false`。

> 补充：`required: false` 的领域规则**仍会生成文件**，只是 Cursor 只在文件匹配 `globs` 时才自动装载。若某规则**完全不在 mapping.yaml 里**，sync 才会跳过它（`Skipping ... not listed`）。

---

## 5. `rules status`（版本化，只读）

规则版本化用 sha256 快照（`.ai-workspace/rules/.manifest.sha256`）记录「上次 sync 时」的规则状态，`status` 对照当前规则报告变更。

### 步骤 5.1 — 查看当前状态

```bash
$AIWS rules status; echo "退出码=$?"
```

**预期**（二选一）：
- 若规则与上次 sync 一致：`[OK] 规则与 manifest 一致（N 条）`，退出码 `0`。
- 若有未同步变更：列出 `modified/added/removed` 差异行 + `[ERROR] 共 N 条差异`，退出码 `1`。

**判定**：✅ 输出与退出码自洽；❌ 退出码为 `2`（环境错误，如无 manifest）时看提示。

### 步骤 5.2 — 制造一条变更再观察（临时仓库）

在临时仓库里改一条规则，观察 `status` 从「一致」变「有差异」：

```bash
TMP=$(mktemp -d /tmp/aiws-rules.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws

$AIWS_TMP sync --only rules >/dev/null          # 先建立基线 manifest
$AIWS_TMP rules status; echo "基线退出码=$?"     # 预期 0（一致）

echo "- 测试变更" >> .ai-workspace/rules/00-core.md   # 改动一条规则
$AIWS_TMP rules status; echo "改后退出码=$?"     # 预期 1（有差异）
```

**预期**：基线退出码 `0`；改后退出码 `1`，并出现 `modified rules/00-core.md ...` 差异行。
**判定**：✅ 版本化能感知规则变更。

### 步骤 5.3 — 收尾

```bash
cd / && rm -rf "$TMP"
```

---

## 6. `rules history <id>`（git 历史，只读）

```bash
$AIWS rules history 00-core
$AIWS rules history vue3
```

**预期**：`规则 <id> → rules/00-core.md`（或 `rules/domains/vue3.md`），随后打印该文件的 git 提交历史（`<hash> <date> <message> (<author>)`）。

**判定**：✅ 能按 id 解析到路径并显示 git log；❌ `Rule not found` 说明 id 写错。

> `rules history` 支持多种定位方式：id（如 `vue3`）、相对路径（如 `rules/00-core.md`）、或 frontmatter id 兜底解析。

---

## 7. `tools` 字段过滤（写临时规则）

规则可在 frontmatter 声明 `tools`，只分发给指定工具。**缺省（无 `tools`）＝适用所有工具**。本步在临时仓库验证。

### 步骤 7.1 — 写一条只给 Cursor 的规则

```bash
TMP=$(mktemp -d /tmp/aiws-tools.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws

cat > .ai-workspace/rules/domains/tools-test.md <<'EOF'
---
id: tools-test
title: 工具过滤测试
scope: all
tools: [cursor]
---

# 工具过滤测试

这是一条只应出现在 Cursor、不应出现在 Claude/Codex/Trae 的规则。
EOF
```

### 步骤 7.2 — 同步并验证

```bash
$AIWS_TMP sync --only rules
```

**预期**：`Generated: cursor rules - ...` 等进度。

```bash
# 1) Cursor 应包含该规则
ls .cursor/rules/tools-test.mdc && grep -c "工具过滤测试" .cursor/rules/tools-test.mdc

# 2) Claude/Codex（单文件拼接）不应包含该规则正文
grep -c "工具过滤测试" CLAUDE.md AGENTS.md

# 3) Trae 不应包含该规则（tools 里没有 trae）
ls .trae/rules/tools-test.md 2>&1
```

**预期**：
- Cursor：`tools-test.mdc` 存在且包含该正文。
- Claude/Codex：`CLAUDE.md`/`AGENTS.md` 中 `工具过滤测试` 计数为 `0`。
- Trae：`No such file or directory`（未生成）。

**判定**：✅ 三处结果如上；❌ 任一不符说明 `tools` 过滤失效。

### 步骤 7.3 — 删除测试规则并还原

```bash
rm .ai-workspace/rules/domains/tools-test.md
$AIWS_TMP sync --only rules >/dev/null
cd / && rm -rf "$TMP"
```

---

## 8. 验收清单

- [ ] 规则来源 14 条，frontmatter 三必填字段齐全。
- [ ] `required` → `alwaysApply` 映射正确（核心 true / 领域 false）。
- [ ] `rules status` 一致时为退出码 0，改动后为退出码 1 并列出差异。
- [ ] `rules history <id>` 能按 id 显示 git 历史。
- [ ] `tools` 字段过滤按工具生效（Cursor 有、Claude/Codex/Trae 无）。
