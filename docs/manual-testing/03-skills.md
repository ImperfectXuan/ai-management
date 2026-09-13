# 03 · 技能（Skills）

> **测试对象**：技能列表（含三态 `link_status`）、链接（`link`）、卸载（`unlink`）、安装（`install`）。
> **前置**：[01-cli-basics.md](01-cli-basics.md)。
> **写文件**：`link`/`unlink` 创建/删除 symlink；`install` 复制文件。建议在临时仓库做。

---

## 1. 目标

技能是「可复用能力」，存在 `.ai-workspace/skills/<name>/SKILL.md`，通过 **symlink** 分发到各工具（macOS/Linux 用 symlink，Windows 用 junction，失败回退复制）。本域验证：

1. `skills list` 列出技能与三态同步状态。
2. `link` / `unlink` 正确建立/移除 symlink。
3. `install` 从本地/远程安装新技能。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws
```

---

## 3. `skills list`（只读）

### 步骤 3.1 — 文本列表

```bash
$AIWS skills list | head -20
```

**预期**：打印 `Skills in workspace:`，随后列出技能名 + 描述 + 每个工具一行 `global=<三态> project=<三态>`。

**判定**：✅ 出现多个技能（本项目共 25 个），每个技能有 4 行工具状态。

### 步骤 3.2 — JSON 列表（含 link_status）

```bash
AIWS_JSON=1 $AIWS skills list 2>/dev/null | jq '.skills | length'
AIWS_JSON=1 $AIWS skills list 2>/dev/null | jq '.skills[0] | {name, link_status}'
```

**预期**：
- 第一条命令输出 `25`（技能总数）。
- 第二条输出 `name` + `link_status`（每个工具含 `global`/`project` 两态）。

**判定**：✅ 数量 25，`link_status` 结构正确。

### 步骤 3.3 — 理解三态

每个工具 × scope 的链接状态是**三态**：

| 状态 | 含义 |
|---|---|
| `managed` | 目标已链接且指向本技能（受管理 symlink） |
| `conflict` | 目标位置存在同名但**非**本技能指向的文件/目录 |
| `missing` | 目标位置无该技能的链接 |

**判定**：✅ 能读懂列表里 `managed/conflict/missing` 的含义。

---

## 4. `link` / `unlink`（写 symlink）

在**临时仓库**做 project scope 链接（不污染 `~/` 全局目录）：

```bash
TMP=$(mktemp -d /tmp/aiws-skills.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws
```

### 步骤 4.1 — 链接单个技能到单个工具

```bash
$AIWS_TMP skills link project cursor brainstorm
```

**预期**：输出 `Skills synced: cursor (project) - 1 skill(s)` 之类进度。

```bash
ls -l .cursor/skills/brainstorm
```

**预期**：`.cursor/skills/brainstorm` 是一个 **symlink**，指向 `…/.ai-workspace/skills/brainstorm`。
**判定**：✅ 出现指向源目录的 symlink。

### 步骤 4.2 — 链接全部技能到全部工具

```bash
$AIWS_TMP skills link project
```

**预期**：四个工具各输出 `Skills synced: <tool> (project) - 25 skill(s)`。

```bash
ls .cursor/skills | wc -l
```

**预期**：`25`（project scope 下 Cursor 链接了 25 个技能）。
**判定**：✅ 数量 25。

### 步骤 4.3 — 验证 link_status 变为 managed

```bash
AIWS_JSON=1 $AIWS_TMP skills list 2>/dev/null | jq '.skills[] | select(.name=="brainstorm") | .link_status.cursor.project'
```

**预期**：`"managed"`。
**判定**：✅ 链接后状态从 `missing` 变为 `managed`。

### 步骤 4.4 — 卸载

```bash
$AIWS_TMP skills unlink project
```

**预期**：输出 `Unlinked: cursor/brainstorm (project)` 等逐条卸载。

```bash
ls .cursor/skills 2>&1
```

**预期**：目录为空或不存在（symlink 已移除）。
**判定**：✅ symlink 被清除。

### 步骤 4.5 — 收尾

```bash
cd / && rm -rf "$TMP"
```

---

## 5. `skills install`（安装新技能）

`install <source>` 支持三种来源：GitHub URL / npm 包 / 本地路径。本步用**本地路径**（无网络依赖）验证。

### 步骤 5.1 — 准备一个本地技能目录

```bash
TMP=$(mktemp -d /tmp/aiws-install.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws

mkdir -p /tmp/sample-skill
cat > /tmp/sample-skill/SKILL.md <<'EOF'
---
name: sample-skill
description: 一个用于测试 install 的本地技能
---

# 使用场景

仅用于验证 `aiws skills install` 从本地路径安装。
EOF
```

### 步骤 5.2 — 安装

```bash
$AIWS_TMP skills install /tmp/sample-skill
```

**预期**：输出 `Installed skill: sample-skill`。

```bash
ls .ai-workspace/skills/sample-skill/SKILL.md && head -3 .ai-workspace/skills/sample-skill/SKILL.md
```

**预期**：`sample-skill` 出现在 `.ai-workspace/skills/` 下，`SKILL.md` 存在。
**判定**：✅ 安装成功。

### 步骤 5.3 — 收尾

```bash
rm -rf /tmp/sample-skill
cd / && rm -rf "$TMP"
```

---

## 6. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `skills link global` 后 `~/` 出现 `.agents/.cursor/.trae` 目录 | global scope 写到用户主目录 | 属正常；测 project scope 即可避免 |
| `conflict` 状态 | 目标已有同名非管理文件 | 先确认是否可删，或用 `unlink` 前备份 |
| `skills install` 报 `Failed to clone` | 网络/仓库不可达 | 用本地路径测试，规避网络 |

---

## 7. 验收清单

- [ ] `skills list` 文本与 JSON 均列出 25 个技能，`link_status` 三态可读。
- [ ] `link project <tool> <skill>` 建 symlink 指向源目录。
- [ ] 链接后对应 `link_status` 变 `managed`。
- [ ] `unlink project` 清除 symlink。
- [ ] `install <本地路径>` 安装新技能到 `.ai-workspace/skills/`。
