# Tasks

## 1. 依赖与编辑器基座

- [x] 1.1 在 `electron/package.json` 添加 Milkdown 依赖（`@milkdown/kit`、`@milkdown/react`）并更新 lockfile；验证：`cd electron && npm install && npm run typecheck` 通过
- [x] 1.2 确定编辑器 CSS 的打包方式（写入 `styles.css`，或由 esbuild 输出独立 CSS 并在 `index.html` 引用）；验证：`cd electron && npm run build:renderer` 成功且产物包含被页面引用的样式文件

## 2. core 规则文档读写

- [x] 2.1 在规则文档模块 `electron/src/core/rule-document.ts`（由 `rules.ts` 再导出）新增解析：返回 frontmatter 原始行、类型化字段、剥离后的正文与 `sha256` 版本；验证：`electron/test/rules.test.ts` 覆盖普通规则与领域规则解析
- [x] 2.2 在 `electron/src/core/rule-document.ts` 实现 `saveRule`：字段校验、仅替换被编辑的已知键、未知键与未编辑键原样保留、LF 归一、文件恰好一个尾换行；验证：新增测试覆盖往返保存、未知键保留、非法 `scope`/`globs`/`tools`
- [x] 2.3 实现路径约束与原子写入：`id` 白名单、拒绝绝对路径与 `..`、仅写已存在文件、临时文件 + rename、失败保留原文件、`expectedVersion` 冲突拒绝；验证：测试覆盖穿越、缺失文件、冲突与只读目录场景
- [x] 2.4 以仓库现有 `.ai-workspace/rules/**` 为 fixture 复制到临时目录，断言“加载 → 不修改 → 保存”后文字内容不变；验证：新增往返测试通过
- [x] 2.5 扩展 `listRules` 返回 `title` 供列表显示；验证：现有 `rules.test.ts` 全部通过并新增 title 断言

## 3. IPC 与主进程接线

- [x] 3.1 在 `electron/src/shared/ipc.ts` 增加 `RulesGet` / `RulesSave`，在 `electron/src/main/rules-args.ts` 增加对应入参校验；验证：`electron/test/ipc-rules-validate.test.ts` 覆盖缺失字段、类型错误、非法 tool/domain
- [x] 3.2 在 `electron/src/main/ipc.ts` 注册两个 handler：读取内容库根、调用 core、保存成功后广播 `SyncStatusChanged`（`changedBy: 'rules'`）且不触发同步；验证：`cd electron && npm run typecheck` 通过，并在第 4 组 UI 流程中确认广播生效

## 4. Renderer 编辑视图

- [x] 4.1 将 `rules.tsx` 改为主从视图：列表显示 `title`，选中后调用 `RulesGet` 加载全文；验证：`electron/test/` 新增 renderer 测试，使用 Testing Library + mock `window.api.invoke`
- [x] 4.2 实现 frontmatter 表单：`title`、`description`、`scope`、`globs`、`tools` 可编辑，`id` 只读；验证：测试覆盖字段回填、提交校验错误与只读 id
- [x] 4.3 新增 `RuleMarkdownEditor`（Milkdown）并通过可注入 `BodyEditor` 接入 `RuleEditor`；验证：测试注入 `textarea` 替身，覆盖正文加载与编辑后脏状态
- [x] 4.4 检测正文中的行首 HTML 块并自动切换源码 `textarea` 模式；验证：测试覆盖命中与未命中两条路径
- [x] 4.5 实现未保存更改保护：切换规则、切换工具与 App 导航页签前弹出“保存并离开 / 放弃更改 / 取消”；验证：测试覆盖三种选择及取消后状态不变
- [x] 4.6 实现保存流程：成功刷新版本并清空脏状态；冲突、文件不存在、写入失败显示可操作错误；验证：测试覆盖成功、版本冲突与错误响应
- [x] 4.7 补充编辑器与详情面板样式，保证与现有界面一致、窄窗口可用；验证：`cd electron && npm run build && npm run start` 手动确认布局与富文本显示
- [x] 4.8 更新 `docs/FEATURE_BREAKDOWN.md`、`docs/PROGRESS.md`、`ROADMAP.md`、`CHANGELOG.md` 中规则编辑相关条目；验证：条目描述与实现能力一致，未把未实现项标为完成

## 5. 集成验收

- [x] 5.1 运行 `cd electron && npm test`，确认全部测试通过
- [x] 5.2 运行 `cd electron && npm run build`，并在应用中完成“打开规则 → 富文本编辑 → 保存 → 重新打开”的往返验证
- [x] 5.3 运行 `cd electron && npm run demo:verify`，确认现有演示流程未被破坏
- [x] 5.4 检查 `git diff`，确认未修改规则生成语义、未触碰 `mapping.yaml` 的 `required` 行为、未引入未使用依赖

## Workflow follow-up

- 代码评审通过后归档本 change。
- 归档后确认 `openspec/specs/rule-editing/spec.md` 的内容与实现一致。
