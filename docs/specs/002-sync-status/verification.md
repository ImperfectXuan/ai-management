# 002 · 验证计划与记录

规格：[spec.md](spec.md)；设计：[design.md](design.md)；任务：[tasks.md](tasks.md)。

## 1. 当前证据边界

- 2026-10-15：本轮仅编写 SDD 文档，静态核对实现基线 `81195b47728bd5d99fe6609db83e793c7f1d0fe4`。
- 该基线的 129 项桌面测试等既有结果属于内容库分离变更，不能证明本功能的持久化同步状态已实现。
- 本功能实现代码、CLI 回执及下列新增测试文件尚未创建；AC-002-01～18 全部未执行。文档检查结果单列在 §4。
- 实施状态仅见 [PROGRESS](../../PROGRESS.md)。

## 2. 逐项验收计划

以下测试文件名称为拟新增落点；实际实现时可就近合并，但不得丢失 AC 追踪。

| 验收 ID | 方法 / 预期测试落点 | 预期覆盖 | 实际结果 | 判定 |
|---|---|---|---|---|
| AC-002-01 | `electron/test/sync-status.test.ts` | 两项目/两工具/三模块隔离 | 未执行 | 未执行 |
| AC-002-02 | `sync-status.test.ts`、`sync-service.test.ts` | 换库恢复、global 独立及共享 Skills 物理路径 | 未执行 | 未执行 |
| AC-002-03 | `electron/test/sync-fingerprint.test.ts` | 正文/required/context/附属文件/MCP 覆盖与删除 | 未执行 | 未执行 |
| AC-002-04 | `sync-fingerprint.test.ts` | 确定性、对象键序、数组顺序与排除清单 | 未执行 | 未执行 |
| AC-002-05 | `sync-fingerprint.test.ts` | 实际生成器依赖与算法版本变化 | 未执行 | 未执行 |
| AC-002-06 | `sync-status-store.test.ts` + 两次原生应用启动 | 状态持久化及关闭期间外部修改 | 未执行 | 未执行 |
| AC-002-07 | `sync-status-store.test.ts`、`workspace.test.ts` | 旧字段迁移、真实路径/别名/搬家规则 | 未执行 | 未执行 |
| AC-002-08 | `sync-service.test.ts` + CLI 回执集成 | applied、输入稳定、持久化后才成功 | 未执行 | 未执行 |
| AC-002-09 | `.ai-workspace/scripts/test/test-sync-report.sh` | 退出 0 的各类跳过、空输入与凭据边界 | 未执行 | 未执行 |
| AC-002-10 | `sync-service.test.ts` | 同版本重试失败/取消不继续 current | 未执行 | 未执行 |
| AC-002-11 | `sync-service.test.ts` | 批次部分成功、失败后停止及未开始单元 | 未执行 | 未执行 |
| AC-002-12 | `sync-status-store.test.ts` + 子进程中断夹具 | running 恢复、坏文件、未知 schema、写入失败 | 未执行 | 未执行 |
| AC-002-13 | `sync-service.test.ts` | 运行中编辑来源、取消与目标锁 | 未执行 | 未执行 |
| AC-002-14 | `sync-service.test.ts` | 跨库/跨工具覆盖失效，其他目标不受影响 | 未执行 | 未执行 |
| AC-002-15 | `electron/test/sync-status-ui.test.tsx` + 原生走查 | 切换/刷新/激活、晚到响应、入库与回退 | 未执行 | 未执行 |
| AC-002-16 | `sync-status.test.ts` + diff/查询前后文件树比较 | 只读查询、不解密、不联网、状态与 diff 分开 | 未执行 | 未执行 |
| AC-002-17 | `skills.test.ts`、`sync-service.test.ts` | 单项链接/卸载、global/project 隔离 | 未执行 | 未执行 |
| AC-002-18 | `sync-fingerprint.test.ts`、回执集成与本机文件审计 | 合成凭据无泄露、密钥生命周期、记录权限 | 未执行 | 未执行 |

### 隔离与故障注入

使用独立临时 HOME、Electron userData、普通文件夹内容库与至少两个应用项目；不得读写维护者真实全局工具目录、vault 或配置。CLI/文件系统集成使用真实引擎，错误注入放在进程/文件系统边界；不 mock 自有内部模块来替代真实成功路径。

先记录规范层与目标文件树摘要，状态查询后逐字节比较；故障点覆盖开始记录之前、CLI 部分写入、CLI 成功后记录替换之前、重启恢复。敏感测试仅使用合成值，并扫描状态/报告/日志确认未泄漏。

### 实现后命令

这些是未来执行入口，不是本轮结果；当前缺少新增实现与测试，不应直接运行它们冒充验收。

```sh
cd electron
node --import tsx --test test/sync-status.test.ts test/sync-status-store.test.ts test/sync-fingerprint.test.ts test/sync-service.test.ts test/sync-status-ui.test.tsx
npm test
npm run build
```

```sh
sh .ai-workspace/scripts/test/test-sync-report.sh
sh .ai-workspace/scripts/test/test-rules-tools.sh
sh .ai-workspace/scripts/test/test-drift-check.sh
sh .ai-workspace/scripts/test/test-skills-link.sh
git diff --check
```

原生人工检查：重启应用、切换库/项目、规则与 Skills 单项操作、全量同步中途取消、托盘与主窗口交叉执行、只读查询与现有 diff 的状态区分。源码/自动化通过不替代原生 GUI 与打包检查。

## 3. 实施运行记录模板

每次追加一条，不能覆盖失败历史：

- 日期 / 执行者：待执行。
- 被测 commit / 未提交改动范围：待填写；不得用上面的设计基线代替后续实现版本。
- OS、Node/Electron/CLI 版本及打包/源码环境：待填写。
- 临时目录隔离与合成凭据说明：待填写，不记录凭据值。
- 覆盖 AC、命令或步骤：待填写。
- 实际结果、日志位置与判定：未执行。
- 跳过项、失败处理与遗留边界：待填写；不可据其他端测试推导通过。

## 4. 文档交付检查

2026-10-15 / Codex，基准 commit `81195b47728bd5d99fe6609db83e793c7f1d0fe4` 加本轮未提交文档改动：

- 核对 10 份文档（四份功能文档与六份关联入口）；新增功能相关的 52 个相对文件链接及章节锚点均可解析。
- REQ-002-01～09 均关联设计与任务；AC-002-01～18 均关联任务和独立验证项；TASK-002-01～07 均在 PROGRESS 登记为待开始。检查支持逗号省略与范围简写，不将其误判为漏项。
- 所有功能验收保持未执行；规格工程细则为草案，没有填入虚构通过结果。
- `git diff --check` 通过；本轮改动仅为 docs 下的 Markdown，未改规范源、生成入口、配置或实现代码。
- 未执行构建、功能测试、aiws sync、模型请求、分发、提交或推送。文档检查不替代功能验收。

检查汇总临时保存于 `/tmp/aiws-sync-status-sdd-check.json`，不属于持久交付证据；本节保留检查方法、数量和结果。
