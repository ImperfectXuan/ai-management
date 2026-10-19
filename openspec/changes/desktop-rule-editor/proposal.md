# Proposal

## Why

Desktop 目前只能查看规则的 id / scope / globs 并切换装载开关；要修改规则正文，用户必须离开应用、用外部编辑器直接改 `.ai-workspace/rules/**/*.md`，再回到界面同步。这打断了配置整理流程，也让不熟悉 YAML frontmatter 的用户容易写出无法解析的规则文件。

## What Changes

- 在 Desktop 规则页新增详情与编辑视图：选中规则后展示完整正文与 frontmatter 字段。
- 正文使用 Markdown-native 的 WYSIWYG 富文本编辑器（Milkdown / ProseMirror），支持标题、段落、加粗/斜体、列表、引用、行内代码、代码块、链接、表格等常见 Markdown 元素，保存时序列化回标准 Markdown。
- frontmatter 以表单编辑 `title`、`description`、`scope`、`globs`、`tools`；`id` 由文件名派生，仅只读展示。
- 新增主进程读写通道：读取单条规则原文与内容摘要；保存时做路径约束、字段校验、未知 frontmatter 键保留、外部修改冲突检测。
- 保存只写 canonical 规则文件并广播同步状态重查提示，不自动同步；是否同步仍由用户显式点击。
- 不新增、不删除、不重命名规则文件；mapping 登记仍由现有流程维护。
- TUI 不在本次范围内，保持现状。

## Capabilities

### New Capabilities

- `rule-editing`: Desktop 内查看规则全文、以富文本编辑正文和受校验的 frontmatter 字段，并将结果安全保存回 canonical Markdown 规则文件。

### Modified Capabilities

无。项目当前没有已归档的 capability specs，本次不修改既有需求。

## Impact

- 代码：`electron/src/core/rules.ts`、`electron/src/main/ipc.ts`、`electron/src/main/rules-args.ts`、`electron/src/shared/ipc.ts`、`electron/src/renderer/pages/rules.tsx`、`electron/src/renderer/styles.css`。
- 依赖：新增 Markdown 富文本编辑器依赖（Milkdown 及 ProseMirror 相关包），需确认 esbuild 打包与 jsdom 测试兼容性。
- 数据：仅写入内容库 `.ai-workspace/rules/**/*.md`；不改 `adapters/**/mapping.yaml` 的 `required` 语义。
- 测试：扩充 `electron/test/rules.test.ts`、`ipc-rules-validate.test.ts`，新增编辑视图与保存冲突场景测试。
- 文档：同步更新 `docs/FEATURE_BREAKDOWN.md`、`docs/PROGRESS.md`、`ROADMAP.md`、`CHANGELOG.md`。
