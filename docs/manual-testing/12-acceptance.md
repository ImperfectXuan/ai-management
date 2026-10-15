# 12 · 自动化回归 + 上线验收清单

> **测试对象**：全量自动化回归（shell + TUI + Desktop），以及汇总所有功能面的最终验收清单。
> **前置**：00–11 各篇均已完成。
> **写文件**：测试通常写入临时沙盒；执行前按环境手册隔离目标与凭据。
> **需求关联**：[TRACEABILITY](../TRACEABILITY.md)；下方用例数来自 2026-09-07 历史记录，当前以实际运行结果为准，本轮未运行功能回归。

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

# ── CLI shell 套件（用例数以实际执行为准） ──
sh .ai-workspace/scripts/test/test-ci.sh
sh .ai-workspace/scripts/test/test-drift-check.sh
sh .ai-workspace/scripts/test/test-import-rules.sh
sh .ai-workspace/scripts/test/test-rules-versioning.sh
sh .ai-workspace/scripts/test/test-skills-link.sh
sh .ai-workspace/scripts/test/test-memory.sh
sh .ai-workspace/scripts/test/test-rules-tools.sh

# ── TUI（完整套件） ──
cd tui && npm test && cd ..

# ── Desktop core + renderer（完整套件） ──
cd electron && npm test && cd ..
```

**预期**：

| 套件 | 历史用例数（2026-09-07） | 当次通过标志 |
|---|---|---|
| shell 套件（7 个脚本） | 88 | 各脚本输出 `PASS` / `ok`，无 `FAIL` |
| TUI | 19 | 完整套件 `fail 0`，记录实际用例数 |
| Desktop | 65 | 完整套件 `fail 0`，记录实际用例数 |

**判定**：✅ 全部绿；❌ 任一 `FAIL` 需定位（见 §3 排查）。

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

- [ ] 规则：按当前规范源清点来源 + `mapping.yaml` 装载语义 + `rules status/history` + `tools` 过滤。
- [ ] 技能：`list`（与当前规范源一致 + 三态）+ `link/unlink`（symlink）+ `install`。
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
- [ ] 自动化回归：当次完整 shell + TUI + Desktop 套件无失败，记录实际用例数。

---

## 5. 验收报告模板

测试完成后，填写并归档：

```markdown
# AI Workspace 人工系统测试报告

- 测试人 / 日期：
- 被测 commit：
- 关联需求 / 验收 ID：
- 适用端、执行范围与未执行项：
- 自动化输出 / 日志位置：
- 环境：macOS <版本> · Node <版本> · jq <版本>

## 结果汇总

| 篇 | 切面 | 结果（通过 / 失败 / 未执行 / 不适用） | 备注与验收 ID |
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
