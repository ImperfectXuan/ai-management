# Design

## Context

见 `proposal.md` — Why。当前约束：

- 规则是 canonical Markdown 文件：`.ai-workspace/rules/*.md` 与 `.ai-workspace/rules/domains/*.md`，YAML frontmatter + Markdown 正文。
- 现有 `electron/src/core/rules.ts` 只解析列表所需的 `id`、`scope`、`globs`、`tools`，并只写 `adapters/<tool>/mapping.yaml` 的 `required`。
- Renderer 通过 `contextIsolation: true` 的单一 `window.api.invoke` 与主进程通信，不能直接访问文件系统。
- 规则页当前是“列表 + 装载开关 + 同步”；Desktop 的规则读写实际作用于统一内容库（`libraryStore.get()`），不是选中的应用项目。
- 前端只有 React 18 + esbuild，无编辑器依赖；测试使用 `node --test` + jsdom + Testing Library。
- 同步状态由 `describe-inputs` 读取真实文件并重算指纹；保存后广播 `SyncStatusChanged` 即可让已挂载的状态视图重查。

## Goals / Non-Goals

**Goals:**

- 规则页升级为主从视图：列表选中规则后展示全文并进入编辑。
- 正文使用 Markdown-native WYSIWYG 编辑器，保存结果仍是标准 Markdown。
- frontmatter 以受校验表单编辑，未知键与未编辑键的原始文本保持不变。
- 主进程负责路径约束、字段校验、冲突检测与原子写入；renderer 不接触文件系统。
- 保存与同步解耦：保存只刷新待同步状态。

**Non-Goals:**

- 不新增、删除、重命名规则文件，不编辑 `id` 或文件名。
- 不修改 `mapping.yaml` 的登记关系（`required` 开关仍由现有按钮维护）。
- 不自动同步，不改变 `aiws sync` 的生成语义。
- 不改造 TUI。
- 不拦截操作系统级窗口关闭；未保存保护覆盖应用内导航（规则/工具/页签切换）。

## Decisions

### 1. 编辑器选型：Milkdown（ProseMirror + remark）

选择 `@milkdown/kit` + `@milkdown/react`，使用 commonmark 与 GFM preset，正文编辑区只承载 Markdown body（frontmatter 不进入编辑器）。Milkdown 是 Markdown 原生方案，避免 HTML→Markdown 的二次转换损失；ProseMirror 提供成熟的撤销栈、输入法与结构化编辑。

备选：

- TipTap + turndown：HTML-first，序列化回 Markdown 有损，frontmatter/表格/代码块边界难保证，放弃。
- CodeMirror 6：源码编辑，不是用户要求的富文本形态，放弃。
- 自研 contenteditable：维护成本与边界风险过高，放弃。

样式不依赖主题包：ProseMirror 与编辑器容器样式写入 `styles.css`；若编辑器包需要 CSS 且必须由 JS 导入，则由 esbuild 输出独立 CSS 并由 `index.html` 引用（实现时按实际包结构确定）。

### 2. 正文更新采用受控边界，编辑器组件可注入

新增 `RuleMarkdownEditor`，props 为 `{ value, onChange, disabled }`。`RuleEditor` 通过可选 `BodyEditor` prop 默认渲染 Milkdown 实现；测试注入普通 `textarea` 替身。这样 jsdom 测试不需要运行 ProseMirror，同时保持生产路径单一。

`value` 仅在切换规则时整体替换（通过 Milkdown 的 `replaceAll` action），避免每次按键重建编辑器。

### 3. frontmatter 模型与“原行保留”写入

读取时把文档拆成三部分：frontmatter 原始行、分隔线、正文。对已知键提供类型化字段：

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | 只读，来自文件名；不写入 |
| `title` | string | 非空、单行 |
| `description` | string | 可空、单行 |
| `scope` | string | 非空、匹配 `^[a-z0-9][a-z0-9_-]*$` |
| `globs` | string[] | 每项为 glob 模式；空数组表示回退到 scope 默认 |
| `tools` | string[] | 取值来自 `SUPPORTED_TOOLS`；空数组 = 全工具 |

写入策略：

- 未编辑的键保留原始行文本与顺序，逐字节不变。
- 被编辑的已知键就地替换：`title`/`description`/`scope` 写单行标量；`globs` 单项写 `globs: "<pattern>"`，多项写块列表；`tools` 非空写内联 `tools: [a, b]`，全选（等于“全工具”）时删除该键。
- 需要引号时使用双引号并转义 `\` 与 `"`；读取时对标量值做去引号处理（`ruleGlobs` 已有此逻辑，抽取为通用函数）。
- 未知键原样保留；已知键重复出现视为文件损坏，保存前报错而不是猜测。
- 行尾统一为 LF，文件以恰好一个换行结束（与仓库约定一致）。

备选：整份 frontmatter 重新序列化（简单但会重排键、丢注释与原始引号），放弃。

### 4. IPC 契约

新增两个通道，均在主进程解析内容库根：

```ts
// rules:get
{ id: string, domain: boolean }
=> {
     id: string, domain: boolean, relativePath: string,
     version: string,                       // sha256:<hex>，基于原始文件字节
     fields: { title, description, scope, globs, tools },
     body: string                           // 已剥离 frontmatter 的 Markdown
   }

// rules:save
{ id, domain, expectedVersion,
  fields: { title, description, scope, globs, tools },
  body: string }
=> { version: string }
```

- 参数校验放入 `electron/src/main/rules-args.ts`，与 `validateRulesSetRequiredArgs` 并列。
- `rules:list` 与 `rules:setRequired` 保持现有签名与行为；列表项增加 `title` 以便显示。
- 保存成功后广播 `SyncStatusChanged`（`changedBy: 'rules'`），与 `RulesSetRequired` 一致；不调用同步服务。

### 5. 路径与写入安全

- `id` 必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，且不能是 `CHANGELOG`；`domain` 决定子目录。
- 目标路径 = `libraryRoot/.ai-workspace/rules(/domains)/<id>.md`；解析后必须仍位于对应目录内，拒绝绝对路径、`..` 与分隔符。
- 只允许已存在文件：先 `stat`，不存在则报 `InvalidArgument`，绝不创建。
- 原子写入：同目录临时文件（继承原文件 mode）→ `rename`；失败时删除临时文件，原文件不变。
- 冲突检测：写入前读取当前字节并计算 `sha256` 与 `expectedVersion` 比较；不一致即拒绝，错误码 `InvalidArgument`，消息包含“文件已被外部修改”。应用是单用户本地场景，接受检查与 rename 之间的微小 TOCTOU 窗口。

### 6. 未保存更改与导航

`RulesPage` 维护 `dirty`（当前字段+正文字符串与最近一次加载快照比较）。拦截点：

- 切换列表中的规则；
- 切换 Cursor/Trae 工具页签；
- App 侧切换导航页签。

规则页向 App 注册 `{ isDirty, save, discard }` 守卫；App 在 `setTab` 前询问守卫，并渲染统一的三按钮对话框（保存并离开 / 放弃更改 / 取消）。页内切换复用同一对话框组件。另注册 `beforeunload` 作为窗口关闭的尽力提示（不作为验收项）。

### 7. 不支持的 Markdown 语法降级

Milkdown commonmark/GFM 不覆盖原始 HTML 块等语法。加载正文时检测行首 HTML 标签；命中时该规则自动切换到源码 `textarea` 编辑模式，并提示“包含编辑器不支持的语法”。保存路径、字段校验与冲突检测不变，既不丢失内容，也不阻塞编辑。

### 8. 测试分层

- core（node）：读写往返、未知键保留、字段校验、路径穿越、冲突、写入失败保留原文件、CRLF/尾换行归一。
- IPC 校验（node）：`rules:get` / `rules:save` 入参类型与枚举。
- renderer（jsdom）：注入替身编辑器，覆盖加载、脏状态、保存成功/冲突/错误、未保存更改拦截。
- 真实 Markdown 往返：以仓库现有 14 条规则正文为 fixture，断言“加载→不改→保存”文字内容不变。

## Risks / Trade-offs

- [WYSIWYG 往返会规范化 Markdown 排版] → 只编辑 body、使用 commonmark+GFM、以真实规则做往返测试，并在 spec 中明确允许排版规范化但不允许丢失文字。
- [原始 HTML 等语法不被支持] → 检测后自动切换源码编辑模式，保存仍走同一校验与冲突检测。
- [frontmatter 行级改写可能破坏格式] → 仅替换被编辑的键，未知键与未编辑键原样保留；重复键直接报错。
- [Milkdown 体积与打包复杂度] → Desktop 本地应用可接受；样式自管，避免主题包与样式加载链。若 esbuild 打包受阻，改为独立 CSS 输出并在 HTML 引用。
- [`id` 与 frontmatter `id` 可能不一致] → 界面只读展示文件名派生的 id；若检测到不一致，在详情区提示但不自动改写。
- [保存后未登记规则不会显示待同步] → 保持现有语义；详情区可提示“该规则未在任一工具 mapping 中登记”（非验收必须）。
- [冲突检测存在 TOCTOU 窗口] → 单用户本地场景接受；写入失败不会损坏原文件。

## Migration Plan

无数据迁移。规则文件格式不变，旧版本 Desktop 仍可读取保存后的文件。回滚时移除编辑视图与两个 IPC 通道即可，已保存的 Markdown 文件无需恢复。发布前执行 `npm install` 引入编辑器依赖并更新 lockfile。

## Open Questions

- 是否在后续版本提供“源码/WYSIWYG”双模式切换？本次只在检测到不支持的语法时启用源码模式。
