---
id: 05-version-control
title: 版本控制
scope: all
---

# 版本控制

关于提交、分支与 Pull Request 的约定。这些规则与托管平台（GitHub、GitLab、Bitbucket）无关。

## 提交信息

格式：`<type>: <祈使式摘要>`

类型：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 仅文档
- `refactor`: 既不修复 bug 也不新增功能的代码改动
- `test`: 新增或更新测试
- `chore`: 工具、依赖、构建脚本
- `style`: 格式化、分号等 —— 无逻辑改动

规则：
- 使用祈使语气：`add login rate limiting`（而非 `added` 或 `adds`）
- 摘要行 ≤ 72 字符
- 如需更多上下文，摘要后空一行再写一段说明
- **一次提交，一个逻辑变更** —— 不要把 bug 修复、重构、新功能打包进一次提交

## 分支命名

格式：`<type>/<short-description>`

示例：`feat/user-authentication`、`fix/login-timeout`、`refactor/payment-flow`

- 使用小写与连字符，不用下划线
- 合并后删除分支

## Pull Request

PR 描述必须回答三个问题：

1. **改了什么**？（简短摘要）
2. **为什么改**？（问题、上下文或 issue 链接）
3. **审阅者如何验证**？（测试步骤，相关时附截图）

附加指导：
- 目标每次 PR ≤ 500 行改动 —— 更小的 PR 得到更快、更好的审阅
- 如果 PR 是进行中的工作，标记为 draft
- 请至少一位理解受影响区域的人审阅
- 回应所有审阅意见 —— 若不同意，说明理由；若同意，做出改动

## 不应提交的内容

- **密钥**：API key、密码、token、私钥证书 —— 用密钥管理器
- **构建产物**：编译后的二进制、`.o` 文件、分发包
- **依赖**：除非团队明确决定，否则不提交 vendored 依赖（改用 lockfile）
- **IDE 配置**：`.vscode/`、`.idea/` —— 用 EditorConfig（`.editorconfig`）做共享格式规则
- **大二进制文件**：图片、视频、数据集 —— 用 Git LFS 或外部存储
- **本地环境文件**：含真实凭据的 `.env`、机器特定覆盖

## .gitignore

- 首次提交前为上述类别添加模式
- 新增工具或框架时，在同一 PR 中更新 `.gitignore`
- 项目特定忽略用项目级 `.gitignore`；OS 与 IDE 文件用全局 gitignore
