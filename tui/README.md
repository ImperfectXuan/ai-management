# AI Workspace TUI

终端可视化管理界面，主要通过 `aiws` CLI 执行业务操作；规则与生效规则视图也直接读取本地文件，装载设置直接写 mapping。

需求见 [REQ-TUI](../docs/SPEC.md#req-tui终端交互)，设计与验收关联见 [追踪矩阵](../docs/TRACEABILITY.md)。

## 使用

```bash
cd tui
npm install
npm run tui
```

## 快捷键

| 键 | 功能 |
|---|---|
| `1-6` | 切换页面 |
| `q` | 退出 |
| `r` | 刷新当前页 |
| `?` | 底栏提示，当前尚无独立帮助界面 |

## 页面

- 仪表盘: 状态总览 + 一键同步/验证（s / v）
- 规则: 列表 + 装载开关（Space）+ 自动 sync
- MCP: 列表 + 添加（a）+ 删除（d+y）
- 技能: 列表 + 详情（Enter）+ 链接/卸载（l/u）
- 密钥: 只读状态 + 权限审计
- 生效规则: Cursor/Trae 生成文件 frontmatter（t 切换）

## 测试

```bash
cd tui
npm test
```

跨项目安装、日常维护与恢复步骤见 [个人用户操作手册](../docs/guides/personal-user-manual.zh-CN.md)。
