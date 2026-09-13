# 11 · Desktop 界面（Electron）

> **测试对象**：macOS 桌面应用（Electron + React + TS），8 页逐页走查 + 托盘 + 打包。
> **前置**：[00-environment.md](00-environment.md) 已 `npm install`；仅 macOS。
> **写文件**：多仓库列表（userData）、规则开关、MCP 增删、技能链接等。

---

## 1. 目标

Desktop 是独立多仓库管理应用，core 层用纯 TS 重写（可脱离 GUI 直测）。本域验证 GUI 各页面、托盘、打包。

---

## 2. 启动

```bash
cd /Users/xuanyi/Documents/AI-management/electron
npm start
```

**预期**：弹出 1120×740 窗口，标题「AI Workspace」，左侧仓库列表、右侧内容区、顶部 tab、底部状态栏。

**判定**：✅ 窗口打开，控制台无未捕获异常。

> 若之前没跑过 `npm install`，先执行 `npm install`（首次下载 Electron 较慢）。

---

## 3. 仓库管理

### 步骤 3.1 — 添加仓库

**操作**：无仓库时显示「管理仓库」页；输入框填 `/Users/xuanyi/Documents/AI-management`，点添加。

**预期**：仓库出现在列表，进入主界面。
**判定**：✅ 添加成功并进入主界面。

### 步骤 3.2 — 无效仓库

**操作**：输入一个非 git 目录路径（如 `/tmp`）。

**预期**：提示「不是 git 仓库」。
**判定**：✅ 错误被拒绝。

### 步骤 3.3 — 移除仓库

**操作**：移除某仓库。

**预期**：从列表消失，切回仓库管理页。
**判定**：✅ 移除生效。

---

## 4. 逐页走查

| # | 页面 | 操作 | 预期 |
|---|---|---|---|
| 1 | 仪表盘 | 查看计数 | 规则/技能/MCP 计数非 0 |
| 2 | 仪表盘 | 点「一键同步」 | 日志逐行滚动，完成后计数刷新 |
| 3 | 规则 | 切一个领域规则开关 | `.cursor/rules/` 对应文件的 `alwaysApply` 变化 |
| 4 | MCP | 添加测试服务器 | 表格出现新行 |
| 5 | MCP | 删除该服务器 | 表格行消失（用后删除恢复） |
| 6 | 技能 | 查看列表 + 详情 | 主-从布局，link 状态表正确 |
| 7 | 技能 | 链接/卸载 | 状态表对应变化 |
| 8 | 密钥 | 查看 | vault 就绪状态 + 各工具可用密钥表（只读） |
| 9 | 差异对比 | 选工具+规则看 diff | 增绿删红；「重新同步」后显示无差异 |
| 10 | 设置 | 查看 | 语言/通知为界面占位（首版未持久化） |

**判定**：✅ 10 项全部符合预期。

> 差异对比页的预期细节：源文件（规范层）与生成文件对比，生成文件含 frontmatter，故「规范化前后」有差异属正常；点「重新同步」后应显示无差异。

---

## 5. 错误场景

| 场景 | 操作 | 预期 |
|---|---|---|
| 无效仓库 | 添加非 git 目录 | 提示「不是 git 仓库」 |
| 未初始化仓库 | 添加无 `.ai-workspace/` 的 git 仓库 | 仪表盘提示未初始化 |
| vault 未就绪 | 进入密钥页 | 黄色提示条 + 安装指引 |

**判定**：✅ 三种错误场景均有友好提示、不崩溃。

---

## 6. 托盘与系统通知

**操作**：点击菜单栏托盘图标。

**预期**：右键菜单三项 ——「显示窗口」「快速同步全部」「退出」。

- 点「快速同步全部」→ 弹出系统通知（如「已同步 N 个仓库」）。
- 点「退出」→ 应用完全退出。

**判定**：✅ 托盘可用、通知弹出、退出生效。

---

## 7. 打包 dmg（arm64）

```bash
cd /Users/xuanyi/Documents/AI-management/electron
npm run dist
```

**预期**：`electron/release/AI Workspace-0.1.0-arm64.dmg` 生成。

**判定**：
- ✅ dmg 生成；双击 → 拖入 `/Applications` → 启动正常。
- 未配 Apple 开发者账号时，签名/公证为关闭状态（可本地安装），属**正常**，不算失败。

---

## 8. core 层冒烟（无需 GUI，可选）

core 层纯 TS，可用 `node --import tsx -e` 直测（详细命令见 `electron/ACCEPTANCE.zh-CN.md` §2）。例如验证同步链路：

```bash
cd /Users/xuanyi/Documents/AI-management/electron
node --import tsx -e "
const { syncRun } = require('./src/core/sync');
(async () => {
  for await (const line of syncRun('/Users/xuanyi/Documents/AI-management')) {
    console.log('[sync]', line);
  }
})();
"
```

**预期**：输出含「已生成 cursor 规则 N 个」「已生成 trae 规则 N 个」「同步完成」。
**判定**：✅ core 层与 CLI 行为一致。

---

## 9. 验收清单

- [ ] `npm start` 弹出窗口，无异常。
- [ ] 仓库增删正常；无效/未初始化仓库有友好提示。
- [ ] 10 项逐页走查全通过。
- [ ] 差异对比增绿删红、重新同步后无差异。
- [ ] 托盘三功能可用、通知弹出、退出生效。
- [ ] `npm run dist` 产出 arm64 dmg 并可在本机安装启动。
