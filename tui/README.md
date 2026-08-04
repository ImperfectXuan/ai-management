# AI Workspace TUI

终端可视化管理界面，薄壳调用 `aiws` CLI。

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
| `?` | 帮助 |

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
