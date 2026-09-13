# 09 · CI 与 pre-commit 钩子

> **测试对象**：GitHub Actions 自动同步工作流（`ci install`）、git pre-commit 漂移守卫（`hooks install`）。
> **前置**：[07-sync.md](07-sync.md)。
> **写文件**：`ci install` 写 `.github/workflows/aiws-sync.yml`；`hooks install` 写 `.git/hooks/pre-commit`。后者在临时仓库测。

---

## 1. 目标

两项「自动化兜底」：

1. **CI 工作流**：push 触发 `.ai-workspace/**` 变更时，自动 validate + sync + 回写。
2. **pre-commit 钩子**：本地提交时拦截「生成文件与规范规则漂移」。

---

## 2. 前置

```bash
cd /Users/xuanyi/Documents/AI-management
AIWS=./.ai-workspace/scripts/aiws
```

---

## 3. `ci install`（工作流）

### 步骤 3.1 — 安装（幂等）

```bash
$AIWS ci install
```

**预期**：本仓库已装过，输出 `Regenerated aiws workflow: .github/workflows/aiws-sync.yml`（首次安装则 `Installed aiws workflow: ...`）。

**判定**：✅ 幂等，重复执行不报错。

### 步骤 3.2 — 检查工作流内容

```bash
head -1 .github/workflows/aiws-sync.yml
grep -nE "paths:|\.ai-workspace|contents: write|aiws sync" .github/workflows/aiws-sync.yml | head
```

**预期**：
- 首行 `# aiws-managed`（受管理标记，卸载/重装以此判定）。
- 触发条件 `paths: ['.ai-workspace/**']`。
- 权限 `contents: write`（允许 GITHUB_TOKEN 回写）。

**判定**：✅ 内容符合自动同步语义。

### 步骤 3.3 — 卸载 / 重装（可选，在临时仓库）

```bash
TMP=$(mktemp -d /tmp/aiws-ci.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws

$AIWS_TMP ci install     # 首次安装
$AIWS_TMP ci uninstall   # 卸载
ls .github/workflows/aiws-sync.yml 2>&1
cd / && rm -rf "$TMP"
```

**预期**：`install` 后生成文件，`uninstall` 后 `No such file or directory`。
**判定**：✅ 卸载干净。

---

## 4. `hooks install`（pre-commit）

> `.git/hooks/` 是**本地、不提交**的目录，在真实仓库装/卸也安全。为演示完整「安装 → 拦截 → 修复」闭环，用临时仓库。

### 步骤 4.1 — 准备并安装

```bash
TMP=$(mktemp -d /tmp/aiws-hooks.XXXXXX)
cd "$TMP" && git init -q
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS_TMP=./.ai-workspace/scripts/aiws

$AIWS_TMP sync >/dev/null            # 先生成规则文件（漂移检测需要它们存在）
$AIWS_TMP hooks install
```

**预期**：`Installed pre-commit hook: .git/hooks/pre-commit`。
**判定**：✅ 安装成功。

### 步骤 4.2 — 基线提交（应通过）

```bash
git -C "$TMP" add -A
git -C "$TMP" -c user.name=tester -c user.email=t@t commit -m "baseline" -q && echo "提交成功"
```

**预期**：`提交成功`（钩子运行 `validate --drift-strict` 通过，未拦截）。
**判定**：✅ 无漂移时放行。

### 步骤 4.3 — 制造漂移后提交（应被拦截）

```bash
echo "- 手改漂移行" >> "$TMP/.cursor/rules/00-core.mdc"
git -C "$TMP" add -A
git -C "$TMP" -c user.name=tester -c user.email=t@t commit -m "drift" 2>&1
```

**预期**：提交被拦截，stderr 出现：

```
[aiws] Commit blocked: generated files drifted from canonical rules.
[aiws] Fix: run 'aiws sync', then re-stage and commit.
```

**判定**：✅ 漂移被拦下，并给出修复指引。

### 步骤 4.4 — sync 修复后提交（应通过）

```bash
"$TMP/.ai-workspace/scripts/aiws" sync >/dev/null
git -C "$TMP" add -A
git -C "$TMP" -c user.name=tester -c user.email=t@t commit -m "fixed" -q && echo "提交成功"
```

**预期**：`提交成功`（漂移已修复）。
**判定**：✅ sync 修复后放行。

### 步骤 4.5 — 卸载并收尾

```bash
"$TMP/.ai-workspace/scripts/aiws" hooks uninstall
cd / && rm -rf "$TMP"
```

**预期**：`Removed pre-commit hook: .git/hooks/pre-commit`。
**判定**：✅ 卸载干净。

---

## 5. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 提交被拦但明明没改规则 | 生成文件被手改过 | `aiws sync` 后重新 `git add` 再提交 |
| 想临时跳过钩子 | 钩子默认拦漂移 | `git commit --no-verify` 绕过（有提示） |
| `ci install` 报「已存在非受管工作流」 | 同路径已有手写 workflow | 按提示手动合并，或备份后删掉重装 |
| 钩子未生效 | 脚本无执行位 | `chmod +x .ai-workspace/scripts/aiws` |

---

## 6. 验收清单

- [ ] `ci install` 幂等（已装时 `Regenerated`）。
- [ ] 工作流含 `# aiws-managed` 标记 + `paths: ['.ai-workspace/**']` + `contents: write`。
- [ ] `ci uninstall` 卸载干净。
- [ ] `hooks install` / `uninstall` 正常。
- [ ] pre-commit 钩子：无漂移放行、有漂移拦截、sync 修复后放行。
