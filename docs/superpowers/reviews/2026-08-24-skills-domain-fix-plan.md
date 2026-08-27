# Skills 业务域修复计划

**日期**：2026-08-24
**基于报告**：[2026-08-24-skills-domain-review.md](./2026-08-24-skills-domain-review.md)

---

## 1. 目标

把 Skills 域从“最小可运行”提升到“与 `FEATURE_BREAKDOWN.md` 口径一致、且不会误伤用户内容”的状态。

成功标准：

1. 详情页操作与真实行为一致，不再出现“看起来改单个，实际改全部”
2. link / unlink / install 不会静默删除未管理目标
3. TUI / Desktop 至少补齐文档已宣称的 `tool + scope` 基本能力
4. Desktop 在 Windows 上具备与 CLI 一致的 link 回退策略
5. `skills install` 能正确处理 GitHub / npm / 本地路径

---

## 2. 实施顺序

### 阶段 A：先修行为和安全（P0）

#### A1. 收敛 UI 语义与后端行为

- **改动**
  - TUI `skills.jsx`
  - Desktop `pages/skills.tsx`
  - 如决定支持“单技能操作”，则扩展 CLI / Electron core API
- **方案**
  - 推荐方案：新增按 skillName 的 link/unlink 能力
  - 备选方案：保留 bulk API，但把 UI 改成“全部技能链接/全部技能卸载”
- **验证**
  - 选中 `brainstorm` 后执行链接，只影响 `brainstorm`
  - 其它技能 `linkStatus` 不变化

#### A2. 给 link / unlink 加管理边界与备份

- **改动**
  - `.ai-workspace/scripts/lib/platform.sh`
  - `.ai-workspace/scripts/lib/skills-link.sh`
  - `electron/src/core/skills.ts`
- **方案**
  - 删除 / 覆盖前先判断目标是否由 AIWS 管理
  - 非 AIWS 管理目标改名为 `<name>.bak`；冲突时加时间戳
  - 日志里打印备份路径和原因
- **验证**
  - 工具目录预先放一个同名普通文件夹，执行 link 后该目录被备份而不是被删
  - unlink 只移除 AIWS 自己创建的 link / junction / copy

#### A3. 修复 `skills install` 的 source 识别和冲突处理

- **改动**
  - `.ai-workspace/scripts/lib/skills-link.sh`
- **方案**
  - 识别顺序：本地路径 → URL / git → npm 包 → GitHub shorthand
  - 安装前检查目标目录是否存在
  - 采用临时目录复制完成后再 `mv` 到正式位置
- **验证**
  - `aiws skills install openskills` 走 npm 分支
  - 已有同名技能时明确报错或备份，不出现目录嵌套

### 阶段 B：补齐已宣称能力（P1）

#### B1. TUI 补 `project` scope

- **改动**
  - `tui/src/screens/skills.jsx`
- **方案**
  - 增加 scope 切换键或显式按钮提示
  - 详情页显示当前操作 scope
- **验证**
  - 可以分别执行 `global` / `project` 的 link 与 unlink

#### B2. Desktop 补 `tool + scope` 选择

- **改动**
  - `electron/src/renderer/pages/skills.tsx`
  - 必要时补共享类型
- **方案**
  - 顶部加工具切换 Tab / Select
  - 详情页同时支持 global/project 的 link 与 unlink
- **验证**
  - 对 `codex / claude / cursor / trae` 都能正确发起操作
  - UI 上显示的 tool/scope 与实际调用一致

#### B3. Desktop 对齐跨平台 link 策略

- **改动**
  - `electron/src/core/skills.ts`
  - 可抽公共 helper 到 `electron/src/core/links.ts`
- **方案**
  - 与 CLI 对齐：macOS/Linux 用 symlink，Windows 优先 junction，失败再 copy
- **验证**
  - 单元测试覆盖 symlink / copy fallback
  - Windows 环境至少完成一轮手工验证

### 阶段 C：提升状态准确性和测试（P2）

#### C1. 精确计算 `linkStatus`

- **改动**
  - `.ai-workspace/scripts/lib/skills-link.sh`
  - `electron/src/core/skills.ts`
- **方案**
  - 不再只看“是否存在”
  - 增加 `managed / conflict / missing` 三态，或最少校验真实目标
- **验证**
  - 同名普通目录不会再显示成“已链接”

#### C2. 接通 `skills.enabled`

- **改动**
  - `.ai-workspace/scripts/aiws`
  - `.ai-workspace/scripts/lib/common.sh`
- **方案**
  - 读取 `workspace.json.modules.skills.enabled` 或既有约定字段
  - 关闭时显式输出 skip 信息
- **验证**
  - 开关关闭后 `sync` 跳过 skills，且日志可见

#### C3. 补回归测试

- **改动**
  - `electron/test/skills.test.ts`
  - `tui/test/` 新增 skills 相关测试
- **最少应覆盖**
  - 详情页只影响目标技能
  - link/unlink 不误删未管理目标
  - npm source 识别
  - `project/global` scope 行为

---

## 3. 推荐拆分为 3 个提交

1. `fix: 修复 skills 链接与安装的安全边界`
2. `feat: 补齐 skills 的 tool 和 scope 交互`
3. `test: 补充 skills 域回归用例`

这样便于评审，也能把“止血修复”和“能力补齐”拆开验证。

---

## 4. 风险提示

- 若把 UI 从 bulk 改为 per-skill，需要同时调整 CLI / Electron / TUI 三层契约
- Windows fallback 最好抽成共用 helper，否则 CLI / Desktop 规则会再次漂移
- 若短期不做 per-skill API，至少先改 UI 文案，避免继续误导用户

---

## 5. 建议执行顺序

我建议实际落地时按这个顺序推进：

1. A2 安全边界
2. A1 UI/行为一致性
3. A3 install 修复
4. B2 Desktop tool/scope
5. B1 TUI scope
6. B3 Windows fallback
7. C1/C2/C3 收尾

这样可以先把“误删”和“误操作”风险压住，再补能力和测试。
