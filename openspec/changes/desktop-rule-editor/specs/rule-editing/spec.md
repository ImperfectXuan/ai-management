# Spec Delta

## Purpose

让 Desktop 用户无需离开应用即可查看规则全文，并以富文本方式编辑规则正文和受校验的 frontmatter 字段，安全保存回内容库中的 canonical Markdown 规则文件。

## ADDED Requirements

### Requirement: 规则全文查看

Desktop MUST 允许用户从规则列表选中任意规则并查看其完整内容，包括 frontmatter 字段与 Markdown 正文。

#### Scenario: 打开普通规则
- **WHEN** 用户在规则列表中选择 `rules/00-core.md`
- **THEN** 界面展示该规则的 `id`、`title`、`scope`、`globs`、`tools` 与完整 Markdown 正文

#### Scenario: 打开领域规则
- **WHEN** 用户选择 `rules/domains/vue3.md`
- **THEN** 界面展示相同字段，并标明该规则属于领域规则

#### Scenario: 规则文件读取失败
- **WHEN** 规则文件在读取时不存在或无权限
- **THEN** 界面显示可操作的错误信息，且不展示过期或伪造的内容

### Requirement: 富文本正文编辑

编辑器 MUST 以格式化后的富文本形式呈现 Markdown 正文，并支持编辑标题、段落、加粗、斜体、列表、引用、行内代码、代码块、链接和表格；保存时 MUST 将正文序列化为有效的 Markdown 文本。

#### Scenario: 应用常见格式
- **WHEN** 用户在编辑器中新增二级标题、无序列表、加粗文本与代码块
- **THEN** 保存后的规则正文包含对应的 Markdown 语法，重新打开时仍呈现为相同的富文本结构

#### Scenario: 保留既有正文语义
- **WHEN** 用户打开一条未作修改的规则并直接保存
- **THEN** 正文的语义内容保持不变，允许 Markdown 排版规范化（如空行与列表标记），但不得丢失或改变文字内容

#### Scenario: 编辑过程中的文本操作
- **WHEN** 用户在正文编辑器中输入、删除、粘贴与撤销
- **THEN** 编辑器提供连续可用的文本编辑与撤销/重做能力，不因格式化操作丢失输入

### Requirement: frontmatter 字段编辑与校验

界面 MUST 以表单方式编辑 `title`、`description`、`scope`、`globs`、`tools`；`id` MUST 只读展示。保存前 MUST 校验字段取值，并保留文件中原有的未知 frontmatter 键。

#### Scenario: 修改可编辑字段
- **WHEN** 用户将 `title` 改为“核心原则（修订）”并将 `scope` 保持为 `all`
- **THEN** 保存后的 frontmatter 包含新的 `title`，其他未修改键保持原值

#### Scenario: 非法工具值
- **WHEN** 用户在 `tools` 中提交 `codex`、`claude`、`cursor`、`trae` 之外的值或非字符串值
- **THEN** 保存被拒绝，界面指出具体字段与非法取值，文件保持不变

#### Scenario: 未知键保留
- **WHEN** 原规则 frontmatter 含有本次界面未提供的自定义键
- **THEN** 保存后该键及其值仍存在于文件中

#### Scenario: id 只读
- **WHEN** 用户尝试在界面修改规则 id
- **THEN** 界面不提供编辑入口，保存请求也不能改变 id 或文件名

### Requirement: 保存范围与文件安全

保存 MUST 只写入统一内容库 `.ai-workspace/rules/` 或 `.ai-workspace/rules/domains/` 下已存在的规则文件，MUST 拒绝绝对路径、`..` 路径段、目录穿越以及新增、删除、重命名规则文件。

#### Scenario: 拒绝目录穿越
- **WHEN** 保存请求携带包含 `..` 或绝对路径的规则标识
- **THEN** 主进程拒绝请求并返回参数错误，不写入任何文件

#### Scenario: 不存在的规则
- **WHEN** 保存请求指向不存在的规则文件
- **THEN** 保存失败并提示规则不存在，不创建新文件

#### Scenario: 文件写入失败
- **WHEN** 目标文件在写入时不可写或磁盘错误
- **THEN** 保存失败并显示错误，原有文件内容保持不变

### Requirement: 外部修改冲突检测

保存请求 MUST 携带编辑开始时读取的内容版本；若文件在该次读取后已被外部修改，保存 MUST 被拒绝而不是覆盖外部修改。

#### Scenario: 外部编辑器已修改文件
- **WHEN** 用户在 Desktop 打开规则后，用外部编辑器修改并保存同一文件，再回到 Desktop 保存
- **THEN** Desktop 拒绝保存，提示文件已被外部修改，并提供重新加载的入口

#### Scenario: 无并发修改
- **WHEN** 文件自读取后未被其他进程修改
- **THEN** 保存成功，并返回更新后的内容版本

### Requirement: 保存后的同步状态联动

保存成功 MUST 只更新规则文件并触发同步状态重查提示，MUST NOT 自动向任何工具分发规则；实际同步仍由用户显式触发。

#### Scenario: 保存后仍待同步
- **WHEN** 用户保存一条属于已登记规则的修改
- **THEN** 界面将该规则显示为待同步，且不调用同步执行

#### Scenario: 用户显式同步
- **WHEN** 用户在保存后点击“同步规则”
- **THEN** 按现有同步流程向所选工具分发规则

### Requirement: 未保存更改保护

当编辑器存在未保存更改时，切换规则、切换工具或离开规则页 MUST 阻止直接丢弃更改，并让用户选择保存、放弃或取消。

#### Scenario: 切换规则时存在未保存更改
- **WHEN** 用户修改正文后点击列表中的另一条规则
- **THEN** 界面提示存在未保存更改，并在用户确认前不切换选中规则

#### Scenario: 放弃更改
- **WHEN** 用户选择放弃未保存更改
- **THEN** 编辑器恢复为磁盘上的最新内容，不写入文件
