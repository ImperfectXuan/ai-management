# 人工验证指导 — 规则业务域代码审查

**日期**：2026-08-24
**配套报告**：[2026-08-24-rules-domain-review.md](./2026-08-24-rules-domain-review.md)
**目的**：在自动化测试覆盖不足的情况下，提供可由人工逐步执行的复现 / 验证步骤。每一节都对应审查报告中的一条 issue，可独立执行。

---

## 0. 验证总则

### 0.1 环境准备

```bash
# 1. 确认在仓库根目录
cd /Users/xuanyi/Documents/AI-management

# 2. 准备一个临时测试仓库（避免污染主仓库的 .ai-workspace）
TMPREPO=$(mktemp -d)
cd "$TMPREPO"
git init -q
.ai-workspace/scripts/aiws setup
ls -la .ai-workspace/
```

预期看到：`adapters/  config/  mcp/  memory/  rules/  rules/domains/  scripts/  secrets/  skills/`

### 0.2 复现速查表

| Issue | 严重度 | 复现耗时 | 自动化覆盖 |
|---|---|---|---|
| #1 | major | 5 min | ❌（需扩展 listRules 测试） |
| #2 | major | 3 min | ❌（需新增 CRLF fixture） |
| #3 | major | 3 min | ❌（需新增 foo.mdx 兄弟文件 fixture） |
| #4 / D2 | major | 5 min | ❌（需用户手放文件） |
| #5 | major | 3 min | ❌（需 trae adapter） |
| #6 | major | 2 min | ❌ |
| #8 | major | 3 min | ❌ |
| #9 | major | 2 min | ❌（需构造"正文含 scope:"的规则） |
| #12 / D3 | major | 2 min | ❌（需在非 git 目录 require） |
| #7 | minor | 2 min | ✅ 可加单测 |
| #10 | minor | 2 min | ✅ 可加单测 |
| #11 | minor | 1 min | ✅ 可加单测 |

---

## 1. 验证 #1 — `listRules` 只读 cursor mapping

### 目标
证明 `electron/src/core/rules.ts` 永远只读 cursor adapter 的 required 状态，其他工具不可见。

### 步骤

1. 在测试仓库准备两份 adapter mapping：
   ```bash
   cd "$TMPREPO"
   cat > .ai-workspace/adapters/cursor/mapping.yaml <<'EOF'
   tool: cursor
   rules:
     - source: rules/00-core.md
       required: true
   EOF
   cat > .ai-workspace/adapters/trae/mapping.yaml <<'EOF'
   tool: trae
   rules:
     - source: rules/00-core.md
       required: false
   EOF
   ```
2. 运行 Desktop（或者在测试仓库用 Node 调 `listRules`）：
   ```bash
   cd /Users/xuanyi/Documents/AI-management
   node -e "
     import('./electron/src/core/rules.ts').then(m => {
       // 先 tsc 编译或在 electron 进程内跑
     });
   "
   ```
   或者用 `electron/test/rules.test.ts` 模板写一个对比 fixture。
3. 观察返回结果：无论 trae mapping 写什么 `required`，`listRules` 返回的 `00-core.required` 只反映 cursor。

### 预期（issue 存在）
- `listRules` 返回的 `required` 永远是 cursor 的值
- 改动 trae mapping 后，Desktop Rules 页面 `00-core` 行的 `required` 开关状态不变化

### 预期（修复后）
- `Rule` 接口应包含 `requiredByTool: Record<string, boolean>`
- 切换 trae 的 `required: false` 后，Desktop 显示 trae 列的状态为关、cursor 列仍为开

### 回归基线
- `electron/test/rules.test.ts` 的 `listRules 读取规则 + required 与 domain 标志` 用例需扩展为 per-tool 断言

---

## 2. 验证 #2 — TUI 正则在 CRLF 下失效

### 目标
证明 `tui/src/lib/rules.js:26` 在 Windows 仓库（CRLF）下 `required` 全部解析为 false。

### 步骤

1. 准备 CRLF 版本的 mapping：
   ```bash
   cd "$TMPREPO"
   unix2dos .ai-workspace/adapters/cursor/mapping.yaml
   file .ai-workspace/adapters/cursor/mapping.yaml
   # 预期：ASCII text, with CRLF line terminators
   ```
2. 启动 TUI 规则页：
   ```bash
   cd /Users/xuanyi/Documents/AI-management
   cd tui && npm run tui -- rules
   ```
3. 观察：所有规则的 `required` 显示为关（☐），但 `mapping.yaml` 实际写的是 `required: true`

### 替代验证（无需 Windows）
```bash
# 直接用 Node 模拟
cd "$TMPREPO"
node -e "
  const fs = require('fs');
  const map = fs.readFileSync('.ai-workspace/adapters/cursor/mapping.yaml', 'utf8');
  // map 已是 CRLF
  const rel = 'rules/00-core.md';
  const re = new RegExp(\`- source: \${rel.replace(/\./g, '\\\\.')}\\\\n(?:.*\\\\n)*?\\\\s*required:\\\\s*(true|false)\`);
  const m = map.match(re);
  console.log('match:', m ? m[1] : 'null');
  // 预期打印 null
"
```

### 预期（issue 存在）
- 打印 `null`
- TUI 中所有规则显示为 `☐`

### 修复后回归
- 改为 `[\r\n]+` 或先 `map.replace(/\r\n/g, '\n')`
- 再次运行上述 Node 脚本，应打印 `true`

### 性能问题验证（顺带）
在 `tui/src/lib/rules.js:23-29` 的 for 循环中加 `console.log('read mapping')`，调用 `listRules()`：
- 预期（issue 存在）：打印 N 次（N = 规则数）
- 修复后：仅打印 1 次

---

## 3. 验证 #3 — `setRuleRequired` 子串匹配误命中

### 目标
证明查找 `rules/foo.md` 时，`source: rules/foo.mdx` 会被错命中并改写。

### 步骤

1. 准备有"兄弟"文件的 mapping：
   ```bash
   cd "$TMPREPO"
   mkdir -p .ai-workspace/rules .ai-workspace/rules/domains
   echo -e '---\nid: foo\n---\n# foo' > .ai-workspace/rules/foo.md
   echo -e '---\nid: foo-md\n---\n# foo-md' > .ai-workspace/rules/foo.mdx  # ⚠️ Windows 友好文件名，Mac 也可
   cat > .ai-workspace/adapters/cursor/mapping.yaml <<'EOF'
   tool: cursor
   rules:
     - source: rules/foo.md
       required: true
     - source: rules/foo.mdx
       required: false
   EOF
   ```
2. 调用 `setRuleRequired(root, 'cursor', 'foo', false, false)`（试图把 `foo.md` 设为 `required: false`）
3. 回读 mapping：
   ```bash
   cat .ai-workspace/adapters/cursor/mapping.yaml
   ```

### 预期（issue 存在）
- `foo.md` 的 `required` 被改成 `false` ✅（碰巧正确）
- **或者**（取决于子串匹配先命中哪条）`foo.mdx` 的 `required` 被错改成 `false`，`foo.md` 不变 ❌
- 关键观察：原始行为取决于 `findIndex` 命中的是 `foo.md` 行还是 `foo.mdx` 行

### 更稳的复现：构造只能命中错条目的情况
```bash
# 让 foo.mdx 排在 foo.md 之前
cat > .ai-workspace/adapters/cursor/mapping.yaml <<'EOF'
tool: cursor
rules:
  - source: rules/foo.mdx
    required: true
  - source: rules/foo.md
    required: true
EOF
# 切换 foo 的 required 为 false
# 预期（issue 存在）：foo.mdx 的 required 被错改成 false
```

### 修复后回归
- 修复后的代码必须按整行匹配（如 `/^\s*-\s+source:\s+${rel}\s*$/`）
- 重复上述命令，`foo.mdx` 的 `required` 应保持 `true`

---

## 4. 验证 #4 / D2 — 破坏性 `rm -f out_dir/*`

### 目标
证明 `rules-generate.sh` / `sync.ts` 会无差别清空 `.cursor/rules/` 和 `.trae/rules/`，含用户手放文件。

### 步骤

1. 准备有用户手放文件的目录：
   ```bash
   cd "$TMPREPO"
   mkdir -p .cursor/rules
   echo "# My personal rule" > .cursor/rules/my-personal.mdc
   echo "# Another local rule" > .cursor/rules/another.mdc
   ls .cursor/rules/
   # 预期：another.mdc  my-personal.mdc
   ```
2. 触发 sync：
   ```bash
   .ai-workspace/scripts/aiws sync
   ```
3. 再次列出：
   ```bash
   ls .cursor/rules/
   ```

### 预期（issue 存在）
- `my-personal.mdc` 和 `another.mdc` **消失**
- 没有 `*.bak` 备份
- 终端只打印 `rm -f` 不存在的文件警告，或根本不打印

### 验证 TS 侧（D2）
1. 在 Electron 内触发 `SyncRun`
2. 同样会清空目录
3. 比较两边实现差异：shell 版用 `rm -f *` 通配，TS 版用 `fs.rm` 逐文件。**破坏结果一致，只是触发面略窄**

### 修复后回归
- 删除前应：
  - 把当前目录所有文件 `.bak`
  - 打印 `log_warn "Deleting: ${file_list}"`
  - 或者改为只删 mapping 声明过的 `{id}.mdc`

---

## 5. 验证 #5 — TUI / Desktop 硬编码 cursor

### 目标
证明切换规则后，sync 只对 cursor 生效；trae/claude/codex 的 mapping 改动不会触发对应工具的文件生成。

### 步骤

1. 准备 trae adapter 并切换一条规则：
   ```bash
   cd "$TMPREPO"
   # 确保 trae mapping 存在
   cp .ai-workspace/adapters/cursor/mapping.yaml .ai-workspace/adapters/trae/mapping.yaml
   sed -i '' 's/cursor/trae/' .ai-workspace/adapters/trae/mapping.yaml
   ```
2. 启动 Desktop（或 TUI）规则页，切换 `vue3` 规则的 `required` 开关
3. 观察：UI 调用 `SyncRun({ tool: 'cursor' })`（硬编码），trae 的 mapping 改了但 `.trae/rules/` 不会重新生成
4. 手动 `aiws sync --tool trae` 才能让 trae 看到变化

### 预期（issue 存在）
- 操作日志只看到 cursor sync
- `.trae/rules/` 内容不更新

### 修复后回归
- 顶部加 tool 选择器
- 切换任意工具的规则都触发对应工具的 sync

---

## 6. 验证 #6 — IPC 缺 tool 校验

### 目标
证明 `electron/src/main/ipc.ts:51-54` 接受任意 `tool` 字符串，会触发 fs 报错或路径遍历。

### 步骤（需要 Electron 调试模式）

1. 在 DevTools console 或测试代码中调用：
   ```js
   await window.api.invoke('rules:set-required', {
     repoId: '<your-repo-id>',
     tool: '../../etc',
     id: '00-core',
     domain: false,
     value: true
   });
   ```
2. 观察：要么 `ENOENT` 报错，要么 `findIndex` 在 `/etc/mapping.yaml` 上执行（无害但意义不对）

### 预期（issue 存在）
- 没有 4xx / 业务错误码返回，只有 `InternalError` + `ENOENT` 消息
- 没有路径遍历保护（虽然 IPC 调用方在 renderer 进程内，受信任，但仍属缺失）

### 修复后回归
- 抛 `WorkspaceError(ErrorCodes.UnsupportedTool, 'tool "foo" not supported')`
- IPC 返回 `{ ok: false, code: 'UnsupportedTool', message: '...' }`

---

## 7. 验证 #7 — scope→globs 重复定义

### 目标
证明同一份默认值在两处复制，且无单测保护。

### 步骤

1. 文本对比：
   ```bash
   diff <(grep -A 3 "case \"csharp\"" electron/src/core/rules.ts | head -3) \
        <(grep -A 3 "csharp)" .ai-workspace/scripts/lib/rules-generate.sh | head -3)
   ```
2. 验证：两处均出现 `**/*.{cs,csproj,sln}` 和 `**/*.{vue,ts,js,css,scss}`

### 预期（issue 存在）
- 字符串完全一致
- 任何一处改了 scope 别名，另一处不会同步

### 修复后回归
- 抽到 `core/scope-globs.ts`（TS 测覆盖）
- shell 侧从同一 JSON 读取（或约定 `workspace.json` 的 `scope_globs` 字段）

---

## 8. 验证 #8 — TUI `setRequired` 静默失败

### 目标
证明规则不在 mapping 中时，TUI 仍显示"切换成功"。

### 步骤

1. 在 mapping 中**删除**某条规则（比如 `vue3`）：
   ```bash
   cd "$TMPREPO"
   # 备份 + 删除 vue3
   cp .ai-workspace/adapters/cursor/mapping.yaml /tmp/m.yaml
   sed -i '' '/vue3/d' .ai-workspace/adapters/cursor/mapping.yaml
   ```
2. 启动 TUI 规则页
3. 在 `vue3` 行上按空格（切换 required）
4. 观察：屏幕显示 `切换 vue3 → 已应用`，但 `mapping.yaml` 实际未变

### 预期（issue 存在）
- `mapping.yaml` 不变
- UI 显示成功消息
- 紧接着 `runAiws(['sync', '--tool', 'cursor'])` 跑过（但无意义）

### 修复后回归
- `setRequired` 抛错或返回 `{ok:false, reason:'not_found'}`
- UI 根据返回值决定是否显示成功消息

---

## 9. 验证 #9 — `scope`/`globs` 解析未限定 frontmatter

### 目标
证明规则正文中若出现 `scope: all`（如 YAML 示例），会被误抓。

### 步骤

1. 构造一条"陷阱"规则：
   ```bash
   cd "$TMPREPO"
   cat > .ai-workspace/rules/trap.md <<'EOF'
   ---
   id: trap
   title: Trap Rule
   scope: all
   ---

   # Trap Rule

   This rule is for the `csharp` scope.

   ```yaml
   # 代码示例：下面是 YAML frontmatter 写法
   scope: csharp
   globs: "**/*.cs"
   ```
   EOF
   ```
2. 调用 `listRules`：
   ```bash
   cd /Users/xuanyi/Documents/AI-management
   # 在 Electron 进程或 test 文件里跑 listRules
   ```
3. 观察：返回的 `trap.scope` 应该是 `'all'`（frontmatter 命中），但若 body 里的 `scope: csharp` 先被正则抓到，scope 会变成 `'csharp'`

### 预期（issue 存在）
- 取决于多行匹配的命中顺序，存在抓到 `csharp` 的可能
- 用 `assert.strictEqual(rule.scope, 'all')` 单测可见

### 修复后回归
- 先剥离 frontmatter（`split('---').slice(2).join('---')` 或现有 `stripFrontmatter`）
- 再对 frontmatter 段做 `match`

---

## 10. 验证 #12 / D3 — TUI lib 顶层 getRoot()

### 目标
证明在非 git 上下文 `require('tui/src/lib/rules')` 直接抛错。

### 步骤

1. 在临时目录（非 git）require：
   ```bash
   NOT_GIT=$(mktemp -d)
   cd "$NOT_GIT"
   node -e "
     require('/Users/xuanyi/Documents/AI-management/tui/src/lib/rules');
   "
   ```
2. 观察：抛出 `Error: 未在 git 仓库中运行（找不到 .ai-workspace）`

### 预期（issue 存在）
- 模块加载即崩
- TUI 的所有单元测试（`tui/test/screens.test.js`）如果跑在没有 `.ai-workspace/` 的临时目录都会失败

### 修复后回归
- `RULES` / `MAPPING` 改为函数 `rulesPaths(root)` 或接收参数
- `require` 阶段不再触发 `getRoot()`
- 测试可在 `before()` 里 mock `getRoot` 或传 fixture 路径

---

## 11. 验证 #10 / #11 — 一致性与性能

### #10 错误码一致性

```bash
# 在 Electron 进程内，调用 setRuleRequired 触发 "规则不在 mapping" 错误
# 观察 IPC 返回的 payload.code：
# 预期（issue 存在）：'InternalError'
# 修复后：'RuleNotInMapping'（业务码）
```

### #11 listRules 串行读

```bash
# 在 listRules 入口加 console.time / console.timeEnd
# 准备 30 条规则，测耗时
# 预期（issue 存在）：N × readFile 延迟叠加
# 修复后：Promise.all 几乎与单次 readFile 同量级
```

---

## 12. 修复后回归模板

每修一个 issue，跑一遍 `electron/test/rules.test.ts` + `tui/test/screens.test.js`：

```bash
cd /Users/xuanyi/Documents/AI-management
cd electron && npm test          # Desktop core 测试
cd ../tui && npm test            # TUI 屏测试
```

并补一个针对本次 issue 的单测，参考模板：

```ts
// electron/test/rules.test.ts（追加）
test('setRuleRequired 不会误命中兄弟文件', async () => {
  // ... 构造 foo.md + foo.mdx
  await setRuleRequired(root, 'cursor', 'foo', false, false);
  // 断言 foo.mdx 的 required 未变
});
```

---

## 13. 验证总结 checklist

完成所有验证后，勾选：

- [ ] #1 — 准备多 adapter mapping，确认 per-tool 状态差异
- [ ] #2 — 准备 CRLF mapping 或在 Node REPL 直接验证
- [ ] #3 — 构造 `foo.md` / `foo.mdx` 兄弟文件
- [ ] #4 — 在 `.cursor/rules/` 手放文件，sync 后确认丢失
- [ ] #5 — 准备 trae adapter，切规则后看 sync 日志
- [ ] #6 — 通过 DevTools console 注入非法 `tool`
- [ ] #7 — `diff` 两处 scope→globs
- [ ] #8 — 删除 mapping 中的某条规则，TUI 操作
- [ ] #9 — 构造含 `scope:` 行的 body 的规则
- [ ] #10 — IPC 返回 payload 的 `code` 字段
- [ ] #11 — `console.time` 测 listRules
- [ ] #12 — 非 git 目录 `require('tui/src/lib/rules')`
- [ ] 修复后全量测试通过

---

## 14. 自动化建议（未来）

以下场景可加 CI 自动覆盖（当前无覆盖）：

1. **#3 子串匹配** — 写 fixture：3 条规则 `00-core` / `00-corex` / `0-core`，验证 setRuleRequired 改写不串位
2. **#4 破坏性 rm** — pre-sync 在 out_dir 放 sentinel 文件，sync 后断言存在
3. **#8 静默失败** — 故意删 mapping 一条规则，断言 setRequired 抛错
4. **#9 frontmatter 边界** — fixture：body 含 `scope: csharp` 的 `csharp: false`，断言解析为 `scope: csharp`（frontmatter）而非 `false`
5. **#12 模块可加载性** — 在 `/tmp/notgit` 跑 `node -e "require('.../rules')"`，断言不抛
6. **#2 CRLF** — 用 `iconv` 或 `Buffer` 模拟 CRLF，断言解析正确
