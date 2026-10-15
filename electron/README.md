# AI Workspace Desktop

AI Workspace 的独立 macOS 管理应用（Electron + React + TypeScript）。

## 开发

```bash
cd electron
npm install
npm start          # 编译并启动
npm test           # core 单测 + renderer 冒烟（node:test + tsx）
npm run typecheck  # 完整类型检查（build 已包含）
npm run demo       # 独立样例/HOME/用户目录，构建并启动
npm run demo:verify # 两轮真实引擎演示旅程
npm run demo:freeze # 当前磁盘源码快照与校验清单（不提交 Git）
npm run dist       # 打包 dmg（arm64）
```

## 功能

- 多仓库管理：添加/移除 git 仓库，管理各自的 AI Workspace
- 工作区概览：总库到四工具的分发结构、资产计数、同步进度与失败反馈；配置生成状态不等同于差异一致或 MCP 连接状态
- 规则：装载开关（改 mapping.yaml）+ 同步
- MCP：增删服务器
- 技能：列表/详情/链接/卸载
- 密钥：只读状态与权限审计
- 差异对比：规范规则 vs 生成文件 side-by-side diff
- 配置收编：来源 → 审核 → 计划 → 结果分步展示；多来源（四工具项目/全局 + 手动文件与 Skill 目录）只读扫描 → 候选分类与差异 → 六种动作人工审核（关联/更新/变体需选定实际目标资产）→ 计划预览 → 入库，可取消、可回退。动作或目标一改，旧计划立即作废需重新生成；入库记录读取失败会显式报错而不是显示成空历史。总库必须是已初始化的 AI Workspace，来源不需要；无模型配置也能走完整闭环
- 托盘：显示窗口 / 快速同步全部 / 退出

## 架构

renderer (React) → main (IPC) → core (纯 TS，无 electron 依赖)。
核心逻辑可 `node:test` 直测，不启动 GUI。

## 验收

见 [ACCEPTANCE.zh-CN.md](./ACCEPTANCE.zh-CN.md)。需求、任务与验收关系见 [追踪矩阵](../docs/TRACEABILITY.md)。

批量同步复用目标工作区的 CLI 引擎，覆盖四工具规则、context、MCP 和 Skills；默认仅同步 project scope。规则页与差异页仅同步规则。取消会终止子进程组，失败或取消不会报告成功；已写文件不自动回滚。详细步骤见 [本机演示指南](../docs/guides/local-demo.zh-CN.md)。

跨项目安装、日常维护与恢复步骤见 [个人用户操作手册](../docs/guides/personal-user-manual.zh-CN.md)。
