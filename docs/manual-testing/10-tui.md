# 10 · TUI 界面

> **测试对象**：终端交互界面（Ink + React），6 个页面逐页走查。
> **前置**：[00-environment.md](00-environment.md) 已 `npm install`；CLI 各域测试通过。
> **写文件**：规则开关、MCP 增删、技能链接等操作会写文件（与对应 CLI 相同）。

---

## 1. 目标

TUI 是 CLI 的「薄壳」，所有读写都调 `aiws` 子进程。本域验证 6 个页面能进、能看、能操作、能退出。

---

## 2. 启动

```bash
cd /Users/xuanyi/Documents/AI-management/tui
npm run tui
```

**预期**：终端进入全屏界面，顶部标题，底部 6 个 tab，出现仪表盘。

> TUI 依赖项目根目录的 git 仓库与 `.ai-workspace`。确保在项目根目录（或其子目录）启动。

**全局快捷键**：

| 键 | 功能 |
|---|---|
| `1`–`6` | 切换页面 |
| `r` | 刷新当前页 |
| `q` | 退出 |
| `?` | 帮助 |

---

## 3. 页面走查

### 页面 1 — 仪表盘（默认）

**操作**：启动后即在此页；按 `s`、`v`、`r`。

**预期**：
- 四张工具状态卡（Cursor / Trae / Claude / Codex）。
- 技能 / MCP 计数非 0。
- 按 `s`：显示同步日志（`Syncing rules...` 等滚动）。
- 按 `v`：显示 `validate` 输出。
- 按 `r`：刷新计数。

**判定**：✅ 卡片渲染、计数非 0、`s`/`v`/`r` 均有输出。

### 页面 2 — 规则

**操作**：按 `2`；方向键选中一条领域规则（如 `vue3`）；按 `Space`；按 `f` 循环过滤。

**预期**：
- 列表显示每条规则与 ☑/☐ 装载状态（☑ = `required:true`）。
- 按 `Space` 切换某规则装载，随后**自动 sync**（屏幕出现同步日志）。
- 按 `f` 在「全部 / 仅领域 / 已禁用」间循环。

**判定**：✅ 切换后 `.cursor/rules/` 对应文件的 `alwaysApply` 变化（或按 [02-rules.md §4](02-rules.md) 用 `grep alwaysApply` 复核）。

### 页面 3 — MCP

**操作**：按 `3`；按 `a` 添加；方向键选中 + `d` + `y` 删除。

**预期**：
- 列表显示服务器（name + command）。
- 按 `a`：进入添加（依次输入 name、command，回车提交）。
- 选中后 `d` + `y`：删除。

**判定**：✅ 添加后 `mcp.json` 出现新 server；删除后消失（用后删除恢复）。

### 页面 4 — 技能

**操作**：按 `4`；`Enter` 看详情；详情页按 `l` 链接、`u` 卸载；`s` 切换 global/project scope。

**预期**：
- 技能列表（25 个）。
- `Enter` 看详情 + `link_status`（三态）。
- 详情页 `l`/`u` 链接/卸载；`s` 切换 scope；`q`/`b` 返回。

**判定**：✅ 详情显示 `link_status`；链接/卸载后状态变化（与 [03-skills.md](03-skills.md) 一致）。

### 页面 5 — 密钥

**操作**：按 `5`。

**预期**：
- 显示 vault 就绪状态（未初始化时黄色提示 + `brew install age oath-toolkit` 指引）。
- 显示各工具 `allowed` 密钥列表（只读）。

**判定**：✅ 页面渲染、无崩溃；未就绪时出现安装指引。

### 页面 6 — 生效规则

**操作**：按 `6`；按 `t` 切换 Cursor/Trae。

**预期**：列出 `.cursor/rules/` 或 `.trae/rules/` 的生成文件；选中文件显示 frontmatter（`globs`/`alwaysApply`）。

**判定**：✅ 能列出生成文件并展示 frontmatter。

---

## 4. 退出

按 `q` 退出。

**预期**：回到普通终端提示符，退出码 0。
**判定**：✅ 干净退出，无残留进程。

---

## 5. 回归测试（自动化）

TUI 有 19 个单测，走查后可跑一遍确认没回归：

```bash
cd /Users/xuanyi/Documents/AI-management/tui
npm test
```

**预期**：`pass 19 / fail 0`（含 `aiws.test.js`、`json.test.js`、`skills.test.js`、`screens.test.js`）。
**判定**：✅ 全绿。

> 详细测试文件对应关系见 [12-acceptance.md](12-acceptance.md)。

---

## 6. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 启动报 `Cannot find module` | 未 `npm install` 或未 `npm run build` | 先 `npm install`（`npm run tui` 会自动 build） |
| 界面空白/乱码 | 终端不支持 | 换现代终端（iTerm2 / 系统终端） |
| 计数为 0 | 未在项目根目录启动 | `cd` 到项目根再 `npm run tui` |
| 密钥页卡住 | vault 未就绪 | 只读页不交互，正常；装 age+oathtool 可解锁 |

---

## 7. 验收清单

- [ ] TUI 启动，6 个 tab 可用 `1`–`6` 切换。
- [ ] 仪表盘卡片/计数正确，`s`/`v`/`r` 生效。
- [ ] 规则页 `Space` 切换装载并自动 sync，`f` 过滤。
- [ ] MCP 页增删生效。
- [ ] 技能页详情 + 链接/卸载 + scope 切换。
- [ ] 密钥页只读展示 + 安装指引。
- [ ] 生效规则页 `t` 切换工具并显示 frontmatter。
- [ ] `q` 退出；`npm test` 19 用例全绿。
