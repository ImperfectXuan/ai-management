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

- 统一内容库：首次使用显式选择文件夹，可创建空库或接入已有库，持久化规则、Skills 与 MCP 的共同存储位置
- 应用项目管理：单独选择目标文件夹，无需 Git；保留选定子目录，同步产物写入该项目
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

批量同步使用应用自带的 CLI 引擎，从所选内容库读取资产并写入应用项目，覆盖四工具规则、context、MCP 和 Skills；默认仅同步 project scope。规则页与差异页仅同步规则。取消会终止子进程组，失败或取消不会报告成功；已写文件不自动回滚。详细步骤见 [本机演示指南](../docs/guides/local-demo.zh-CN.md)。

跨项目安装、日常维护与恢复步骤见 [个人用户操作手册](../docs/guides/personal-user-manual.zh-CN.md)。

## 内容库与应用项目

首次打开应用，先在“统一内容库”选择文件夹：

1. 新目录选择“在此创建空内容库”，只创建 `.ai-workspace/` 框架，不复制本项目的规则、技能、MCP 或密钥。
2. 已有 `.ai-workspace/` 选择“使用已有内容库”，保留其资产。选择保存在应用的用户数据目录中，重启后恢复。
3. 在“管理应用项目”添加目标文件夹，在侧边栏选择应用项目，再从规则页或工作区概览执行同步。

规则、MCP、技能及配置收编都以当前内容库为来源。未添加项目时仍可管理内容库；同步与项目技能链接需要明确的应用项目。切换项目不会切换内容库，切换内容库不会移动旧文件或自动同步。可从“内容库存放位置”更换内容库。

应用项目不需要 `.ai-workspace/` 或内嵌 CLI；打包时通过 `extraResources` 携带 CLI。原有 CLI 单项目用法保持兼容。需要从独立内容库同步时，可以显式指定来源与目标：

```sh
AIWS_ROOT=/path/to/application \
AIWS_SOURCE_DIR=/path/to/library/.ai-workspace \
/path/to/library/.ai-workspace/scripts/aiws sync --scope project
```

`AIWS_SOURCE_DIR` 表示规范层，`AIWS_ROOT` 表示目标项目；默认仍为目标项目内的 `.ai-workspace/`。规则分发的范围、已有规则的 `tools/globs` 语义不变。内容库中的项目上下文也会随规则分发，跨项目通用库应只存放希望共享的上下文。
