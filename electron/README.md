# AI Workspace Desktop

AI Workspace 的独立 macOS 管理应用（Electron + React + TypeScript）。

## 开发

```bash
cd electron
npm install
npm start          # 编译并启动
npm test           # core 单测 + renderer 冒烟（node:test + tsx）
npm run dist       # 打包 dmg（arm64）
```

## 功能

- 多仓库管理：添加/移除 git 仓库，管理各自的 AI Workspace
- 仪表盘：各工具规则/技能/MCP 状态 + 一键同步 + 实时日志
- 规则：装载开关（改 mapping.yaml）+ 同步
- MCP：增删服务器
- 技能：列表/详情/链接/卸载
- 密钥：只读状态与权限审计
- 差异对比：规范规则 vs 生成文件 side-by-side diff
- 托盘：显示窗口 / 快速同步全部 / 退出

## 架构

renderer (React) → main (IPC) → core (纯 TS，无 electron 依赖)。
核心逻辑可 `node:test` 直测，不启动 GUI。

## 验收

见 [ACCEPTANCE.zh-CN.md](./ACCEPTANCE.zh-CN.md)。
