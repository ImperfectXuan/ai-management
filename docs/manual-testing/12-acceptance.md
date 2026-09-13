# 12 · 自动化回归 + 上线验收清单

> **测试对象**：全量自动化回归（shell + TUI + Desktop），以及汇总所有功能面的最终验收清单。
> **前置**：00–11 各篇均已完成。
> **写文件**：否（回归测试只读/沙盒）。

---

## 1. 目标

把前面的手动测试收敛为两个动作：

1. 跑一遍**自动化回归套件**，确认没有改动破坏既有行为。
2. 对照**上线验收清单**逐项打勾，给出「可上线 / 不可上线」结论。

---

## 2. 自动化回归（一条总命令）

在**项目根目录**依次执行：

```bash
cd /Users/xuanyi/Documents/AI-management

# ── CLI shell 套件（7 个，共 88 用例） ──
sh .ai-workspace/scripts/test/test-ci.sh
sh .ai-workspace/scripts/test/test-drift-check.sh
sh .ai-workspace/scripts/test/test-import-rules.sh
sh .ai-workspace/scripts/test/test-rules-versioning.sh
sh .ai-workspace/scripts/test/test-skills-link.sh
sh .ai-workspace/scripts/test/test-memory.sh
sh .ai-workspace/scripts/test/test-rules-tools.sh

# ── TUI（19 用例） ──
cd tui && npm test && cd ..

# ── Desktop core + renderer（65 用例） ──
cd electron && npm test && cd ..
```

**预期**：

| 套件 | 用例数（约） | 通过标志 |
|---|---|---|
| shell 套件（7 个脚本） | 88 | 各脚本输出 `PASS` / `ok`，无 `FAIL` |
| TUI | 19 | `pass 19 / fail 0` |
| Desktop | 65 | `pass 65 / fail 0` |

**判定**：✅ 全部绿；❌ 任一 `FAIL` 需定位（见 §4 排查）。

---

## 3. 排查失败

```bash
# TUI：看具体失败用例
cd tui && npm test 2>&1 | grep -A 15 "not ok\|✖"

# Desktop：看断言细节
cd electron && npm test 2>&1 | grep -A 20 "✖\|not ok"
```

**常见原因**：环境缺依赖（jq/age/oathtool）、在非 git 目录运行、生成文件漂移未 sync。对照对应域文档复核。

---

## 4. 上线验收清单（最终判定）

逐项确认，全部 ✅ 即达上线标准。

### 4.1 环境与基础

- [ ] `node` / `git` / `jq` / `shasum` 齐备，`$AIWS --version` 输出 `v0.1.0`。
- [ ] `aiws setup` 能补齐目录与默认配置。
- [ ] `aiws validate` 无 `[ERROR]`，退出码 0。

### 4.2 六大业务域

- [ ] 规则：14 条来源 + `mapping.yaml` 装载语义 + `rules status/history` + `tools` 过滤。
- [ ] 技能：`list`（25 个 + 三态）+ `link/unlink`（symlink）+ `install`。
- [ ] MCP：`list/show/add/remove` + `scope` 分发 + JSON/TOML 生成。
- [ ] 密钥：`audit`（免依赖）+ JSON 只读不挂起 + vault 初始化 + `set/list/remove` + 占位符告警。
- [ ] 记忆：`list/new/show` + ADR 编号自增 + context 注入 sync + validate 校验。
- [ ] 同步：三阶段 + `--tool/--scope/--only` + 幂等 + 漂移检测闭环。

### 4.3 反向导入与自动化

- [ ] `import mcp/skills/rules`：`--dry-run` 预览 + 去重 + 手写规则落地闭环。
- [ ] `ci install`：工作流含 managed 标记 + 自动同步语义。
- [ ] `hooks install`：pre-commit 拦截漂移、sync 修复后放行。

### 4.4 三交付物

- [ ] TUI：6 页逐页走查通过。
- [ ] Desktop：8 页 + 托盘 + dmg 打包通过。
- [ ] 自动化回归：shell 88 + TUI 19 + Desktop 65 全绿。

---

## 5. 验收报告模板

测试完成后，填写并归档：

```markdown
# AI Workspace 人工系统测试报告

- 测试人 / 日期：
- 环境：macOS <版本> · Node <版本> · jq <版本>

## 结果汇总

| 篇 | 切面 | 结果（✅/❌） | 备注 |
|---|---|---|---|
| 00 | 环境准备 | | |
| 01 | CLI 基础 + setup + validate | | |
| 02 | 规则 | | |
| 03 | 技能 | | |
| 04 | MCP | | |
| 05 | 密钥 | | |
| 06 | 记忆 | | |
| 07 | 同步 | | |
| 08 | 反向导入 | | |
| 09 | CI + 钩子 | | |
| 10 | TUI | | |
| 11 | Desktop | | |
| 12 | 回归 + 验收 | | |

## 结论

- [ ] 达到上线验收标准，可发布。
- [ ] 存在阻塞项（列出）：

## 遗留问题

| 问题 | 严重度 | 关联文档 | 处理人 |
|---|---|---|---|
| | | | |
```

---

## 6. 相关文档

- [本手册总纲](README.md)
- [按 task 的自动化测试指导（互补）](../TESTING.md)
- [桌面验收指导](../../electron/ACCEPTANCE.zh-CN.md)
