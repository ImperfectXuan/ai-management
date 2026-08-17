# AI Coding 工作流调研：面向"新时代初级程序员"博客写作的素材库

> 调研目的：为撰写《新时代下初级程序员如何构建 AI Coding 工作流》博客收集业界已有的高质量工作流文章与实践，提炼可复用的工作流模式，作为博客写作的参考素材。
>
> 调研日期：2026-08-16
>
> 说明：优先收录官方文档、知名工程师/工程团队博客；中文社区文章已标注可信度。核心观点均为原创总结，不构成原文翻译。

## 一、文章清单

| # | 标题 | 作者/机构 | 日期 | 链接 | 一句话简介 |
|---|------|-----------|------|------|-----------|
| 1 | Five Best Practices for Using AI Coding Assistants | Google Cloud 官方博客 | 2025-10 | [原文](https://cloud.google.com/blog/topics/developers-practitioners/five-best-practices-for-using-ai-coding-assistants) | 官方视角的五大实践：按场景选工具、用基础工作训练工具、先做计划、重视提示词工程、会话间用上下文文件"接续" |
| 2 | Best practices for Claude Code（Claude Code 最佳实践） | Anthropic 官方文档 | 持续更新 | [中文](https://code.claude.com/docs/zh-CN/best-practices) / [英文](https://code.claude.com/docs/en/best-practices) | 官方 Agent 工作流规范："先探索、再规划、最后编码"，善用 CLAUDE.md、控制上下文、用 CLI 工具 |
| 3 | Steering Claude Code: CLAUDE.md, skills, hooks, and subagents | Anthropic 官方博客 | 2026-06 | [原文](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more) | 官方对"如何引导 Agent 行为"的完整指南：规则文件管"总是做"，hooks 管"可靠触发"，skills 管"按需调用" |
| 4 | Cursor 智能体最佳实践（Best practices for coding with agents） | Cursor 官方博客 | 2026-01 | [中文](https://cursor.ac.cn/blog/agent-best-practices) / [英文](https://cursor.com/blog/agent-best-practices) | 官方 Agent 使用手册：从规划开始、管理上下文、Rules/Skills 扩展、TDD 工作流、并行 Agent 与 review 流程 |
| 5 | First attempt will be 95% garbage（资深工程师 6 周 Claude Code 实践） | Sanity（Vincent Quigley） | 2025-09 | [原文](https://www.sanity.io/blog/first-attempt-will-be-95-garbage) | 一线管理者现身说法：AI 首版代码约 95% 是垃圾，第二版 50%，第三版才可用；把 AI 当作"不学习的初级开发"来带 |
| 6 | Taming AI Chaos: A Structured Agent Workflow for Predictable Coding | Allegro Tech 工程博客 | 2025-10 | [原文](https://blog.allegro.tech/2025/10/taming-ai-chaos-a-structured-agent-workflow-for-predicable-coding.html) | 用"Architect & Coder"双 Agent 模式分离规划与执行，用 `copilot-instructions.md` 作为项目"DNA"，让输出可预测 |
| 7 | Break It Small, Ship It Right – Skills for Coding Agents | CyberAgent 开发者博客 | 2026-05 | [原文](https://developers.cyberagent.co.jp/blog/archives/63674/) | 用 Claude Code Skills 覆盖完整开发周期：拆子任务、并行开发、提交前验证完整性、规范化 commit/PR |
| 8 | A Year Of Vibes（Agentic Coding 一年回顾） | Armin Ronacher（Flask 作者） | 2025-12 | [原文](https://lucumr.pocoo.org/2025/12/22/a-year-of-vibes/) | 深度用户年度反思：AI 时代的版本控制、代码评审、可观测性都需要新形态；人与 Agent 的责任边界仍是未解问题 |
| 9 | Agentic Coding Recommendations | Armin Ronacher（经 Simon Willison 整理） | 2025-06 | [Simon Willison 博文](https://simonwillison.net/2025/Jun/12/) | 实用建议：把工具链（Makefile、linter、测试、日志）做成 Agent 可访问的状态；日志是 Agent 的"眼睛"，调试模式把邮件打到 stdout |
| 10 | 规范驱动开发（SDD）：用 AI 写生产级代码的完整指南 | 程序猿DD（译） | 2025-11 | [原文](https://cloud.tencent.com.cn/developer/article/2586438) | 系统介绍 Spec-Driven Development：规范 → 计划 → 任务 → 实现，五支柱验证框架，分阶段落地的完整路线图 |
| 11 | 一份关于 AI 编程的简明行为指南 | piglei（转） | 2026-03 | [原文](https://developer.cloud.tencent.cn/article/2643597)（[原出处](https://www.piglei.com/articles/a-simple-ai-coding-guide-for-engineers/)） | 面向工程师的行为准则，特别针对初级工程师：质量胜过效率、尝试手动修 bug、先自己动脑再"对答案" |
| 12 | Karpathy 氛围编程（Vibe Coding）指南 2.0 | Andrej Karpathy（量子位编译） | 2025-08 | [原文](https://www.163.com/dy/article/K7T59AQI0511DSSR.html) | 三层工具结构：Cursor 处理 75% 小改动，Claude Code/Codex 做功能块，GPT-5 Pro 解决最棘手问题；"代码后稀缺时代" |
| 13 | 5 AI Coding Best Practices from a Google AI Director | hamy.xyz（转述 Google Gemini 团队 Addy Osmani） | 2026-01 | [原文](https://hamy.xyz/blog/2026-01_ai-engineering-best-practices) | 提炼 Osmani 的 5 原则：Spec 先行、小步提交、给足上下文、自动化安全网、人始终是"司机" |
| 14 | Exploring Generative AI（系列备忘录索引） | Martin Fowler / Thoughtworks | 2023 至今 | [原文](https://martinfowler.com/articles/exploring-gen-ai.html) | Thoughtworks 对生成式 AI 软件交付的系统性研究索引，覆盖 TDD、上下文工程、Spec 驱动、风险与评估等主题 |

## 二、各文章核心观点摘录

### 官方/厂商视角

**Google Cloud（#1）**

- 按使用场景选择工具（补全、聊天、Agent 各有适配场景），不要只追最新工具。
- 用"基础工作"训练工具：先让它做小而有代表性的任务，建立项目上下文。
- 先做计划：在需求文档上迭代，彻底理解要解决的问题再动手。
- 提示词工程要优先投入；会话之间用"上下文文件"连接，每次工作结束沉淀一份。

**Claude Code 官方文档（#2）**

- 推荐顺序是"先探索、再规划、最后编码"；给 Agent 验证手段（运行测试、linter）。
- 上下文窗口越满性能越差：保持对话精简，必要时开新会话。
- 用 CLAUDE.md 写清 Bash 命令、代码风格和工作流规则；外部服务优先让 Agent 用 CLI 工具（gh、aws、sentry-cli），比 MCP 更省上下文。

**Anthropic 官方博客（#3）**

- "每次 X 都做 Y"的规则放 CLAUDE.md；"必须可靠发生"的行为（如每次编辑后跑 prettier）用 hooks；按需触发的领域知识用 skills。
- 给 Agent 装"骨架"比给"完整大脑"更好：规则要少而准，避免上下文稀释。

**Cursor 官方博客（#4）**

- 最大的改变是"先规划后编码"：Plan 模式分析代码库、提出澄清问题、产出含文件路径的详细计划，确认后才动手；计划可保存到 `.cursor/plans/` 供后续复用。
- 上下文管理是核心技能：让 Agent 自己搜索上下文，只在明确时引用文件；切换任务/对话变糊涂/完成工作单元时开新对话。
- 让 Agent 可验证：强类型、linter、测试给 Agent 提供"成功信号"；TDD 是官方推荐的 agent 工作流（先写测试→确认失败→再实现→迭代到全绿）。
- Review 不可省：Agent 越快，review 越重要；可并行跑多个模型对比结果，用 worktree 隔离并行 Agent。

### 工程师实践视角

**Sanity（#5）**

- 心智模型：把 AI 当成"不学习、每天失忆的初级开发"。首版约 95% 垃圾 → 第二版 50% → 第三版才可用，这是过程而非失败。
- 上下文文件（Claude.md）解决"失忆"：架构决策、常见模式、坑与 workaround 都写进去；配合 MCP 接 Linear/Notion/数据库/GitHub 等，能直接从"第二轮"开始。
- 多 Agent 并行像带团队：不要并行处理同一问题空间；用项目管理工具追踪；明确标记人工改过的代码。
- 三级 review：AI 先 review（抓测试缺失、明显 bug）→ 工程师 review 关键点（架构、业务正确性、集成点）→ 团队正常 review，质量门槛不变。
- 反复出现的三类问题：AI 不学习、过度自信地写错、大代码库超出上下文窗口。

**Allegro Tech（#6）**

- 反对"万能超级提示词"：上下文稀释（Context Dilution）和模式渗透（Pattern Bleeding）会让输出变差；给模型精简的、100% 相关的上下文。
- 架构师 + 编码者双 Agent：Architect 负责分析现状、制定分步计划、生成 Coder 提示词；Coder 只执行当前一步；每次生成后重新分析代码现状再走下一步。
- `copilot-instructions.md` 作为项目"DNA"：架构规则、代码风格、测试策略的事实来源，所有 Agent 强制遵守。

**CyberAgent（#7）**

- 大特性必须拆小：每个子任务只涉及一个层/一个关注点，包含描述、涉及文件、验收标准（checkbox）。
- 人类审批门禁：AI 拆解方案先给人看，批准后才创建 GitHub 子任务。
- 并行开发：独立子任务用 worktree + 多终端并行，但每个 worker 先出计划再写码；依赖关系自动排队。
- 提交前验证：用只读检查核对原始需求是否全部覆盖（他们曾因漏掉一个模块损失两周），小改动不能"假完整"。
- 提交纪律：一次提交一个逻辑单元，lint 修复、依赖升级、功能各自成 commit，这样 Agent 出错可精确回滚。

**Armin Ronacher（#8/#9）**

- 让工具链对 Agent 可见：Makefile 汇总命令，linter/测试/日志都可访问；调试模式下邮件打到 stdout，Agent 就能自动完成注册/登录流程。
- 日志是 Agent 的"眼睛"：清晰的日志让 Agent 无需人工介入即可完成端到端操作。
- 传统 PR/git 不足以承载 AI 时代的协作：希望看到"产生这次改动的提示词"和"失败过的路径"；评审应该成为版本控制的一部分。
- 保持人类责任：不同意完全"躺平交给机器"；开源世界里"无审查 AI PR"是糟糕行为。

**程序猿DD（#10）**

- SDD 核心：把"形式化、可执行的规范"当作事实来源，工作流从"聊天式"升级为"规范 → 计划 → 任务 → 实现"。
- 规范要点：清晰、完整、上下文充分、具体（示例优于抽象）、可测；好规范包含目标/约束/功能与非功能需求/边界与错误处理/测试标准/示例。
- 五支柱验证框架：安全（SAST、依赖扫描）、测试（覆盖率+集成+E2E）、代码质量（lint、复杂度）、性能、上线就绪（配置、可观测、回滚）。
- 预期现实：67% 开发者在学习阶段调试时间增加；通常 2–3 轮"生成→测试→把错误写回规范→再生成"达到生产质量；ROI 3–6 个月打平。
- 探索用 vibe coding，生产用规范驱动；AI 更擅长在明确框架下做实现，整体设计仍需要人。

**piglei 行为指南（#11）**

- 对所有人：AI 不对代码担责，人是最终责任人；多"协作"少"委派"；控制 PR 粒度（推荐 <600 行）；善用 Plan 模式；采纳成熟库优于从零实现；PR 前先用 AI review；让改动可验证且总是验证。
- 对初级工程师（博客重点素材）：
  - 质量胜过效率：更慢但能学到东西的方式，在协调好期限的前提下值得选。
  - 尝试手动修复 bug：不要全自动丢给 Agent，用聊天模式边思考边问，加深对项目理解。
  - 自己先动脑：先花半小时设计自己的思路，再和 AI 的方案"对答案"，避免丧失技术视野。
  - 让 AI 反问自己，模拟"面试"；读官方文档（AI 知识有截止日期）；补架构与设计模式短板；关注非功能需求（安全、可维护性、并发）。

**Karpathy（#12）**

- 三层工具结构：Cursor 自动补全（约 75% 场景，用小代码片段/注释高带宽传达意图）→ Claude Code/Codex 实现大功能块（陌生领域、一次性可视化/调试代码很好用）→ GPT-5 Pro 解决最棘手的 bug 与复杂抽象。
- 提醒：AI 容易跑偏，别开 YOLO 模式；AI 代码容易"屎山"（滥用 try/catch、过度抽象、代码膨胀、复制粘贴不抽函数），需要人工清理。
- 早期 Vibe Coding 循环：塞上下文 → 描述增量小改动（先要思路分析而非直接要代码）→ 选一种思路要第一版 → 复查/学习 → 测试 → commit → 问下一步，循环。
- 观点："代码后稀缺时代"：代码可随意创造删除，价值转向评审、取舍与方向判断。

**hamy.xyz（#13）**

- Osmani 五原则：Spec 先行（"15 分钟的瀑布"）、小步提交（commit 是存档点）、给 AI 正确上下文（AGENTS/CLAUDE.md + 分层文档）、自动化安全网（类型/linter/测试/CI）、人是司机（AI 增强而非自动化）。
- Spec 层级：产品级 spec（长期、描述产品全貌）与变更级 spec（一次变更的结果，只写"做什么"不写"怎么做"）+ plan（分阶段、原子提交、验证步骤）。
- "AI 10 倍速写代码 = 10 倍速写 bug"：速度越快越需要护栏，不是更少。

**Martin Fowler / Thoughtworks（#14）**

- 值得关注的系列主题：Agent 循环中的 TDD 实验、上下文工程、Spec 驱动开发三种工具对比（Kiro / GitHub spec-kit / Tessl）、AI 代码的"接受率"指标缺陷、Agent 扩大的供应链攻击面。
- 核心立场："LLM 不是自然语言的编译器，而是推断器"——评审与验证永远是人的职责。

## 三、工作流模式提炼（跨文章共性）

1. **Plan-then-code（先规划后编码）**
   - 来源：#1 #2 #4 #6 #10 #11 #13
   - 共性：动手写码前先产出计划/规范，Agent 以计划为锚；计划与人确认后再执行；计划文件落盘复用。
   - 变体：Cursor Plan 模式 / Architect-Coder 双 Agent / SDD 规范 / "15 分钟瀑布" spec。

2. **上下文工程（Context Engineering）**
   - 来源：#1 #2 #4 #5 #9 #13
   - 共性：用 CLAUDE.md / AGENTS.md / 项目规则文件承载架构决策、代码风格、命令与坑；按需加载避免上下文稀释；会话间用上下文文件接续；让工具链对 Agent 可见（Makefile、日志、测试）。

3. **拆小 + 小步提交（Small Chunks, Atomic Commits）**
   - 来源：#4 #5 #7 #10 #11 #13
   - 共性：一个 Agent 任务 = 一个原子变更；提交是"存档点"，便于回滚；PR <600 行；AI 在聚焦任务上表现远好于"一次性建整个功能"。

4. **验证闭环（Verify Loop / TDD / 测试驱动）**
   - 来源：#2 #4 #7 #10 #13
   - 共性：给 Agent 可验证的成功信号（类型检查、linter、测试、CI）；"生成 → 测试 → 把错误反馈给规范 → 再生成"循环，2–3 轮达生产质量；提交前用只读检查核对需求覆盖。

5. **AI 前置评审 + 人工最终负责（AI-first Review, Human Responsible）**
   - 来源：#5 #8 #10 #11 #13 #14
   - 共性：PR 前先让 AI review（抓边界、安全问题、重复实现），再人工 review 架构与业务正确性；AI 不对代码担责，人是最终责任人；评审标准不因代码来自 AI 而降低。

6. **分层工具与多 Agent 编排（Tool Hierarchy & Orchestration）**
   - 来源：#4 #5 #8 #12
   - 共性：按任务难度分层使用工具（补全 → 功能 Agent → 最强模型）；并行 Agent 各管独立问题空间，用 worktree/项目管理工具隔离追踪；人做协调者。

## 四、初级程序员常见误区（来自 #11 为主，交叉印证其他文章）

1. **全盘接受 AI 代码**：不 review、不理解就提交，把 AI 当"外包"而非"协作者"。（#5 #11 #13）
2. **用 AI 替代学习**：让 Agent 无监督地自动修 bug、自动写一切，跳过自己思考与理解，长远损害能力成长。（#11 #14）
3. **跳过规划直接要代码**：需求没澄清就让 AI 开写，得到"看起来对但完全跑偏"的结果，反而更慢。（#1 #2 #4 #10）
4. **上下文给得太少或太杂**：要么只丢一句话，要么把无关文件全塞进去，导致 AI 靠猜或注意力被稀释。（#4 #6 #13）
5. **不验证、不测试**：让"Review 兜底"或"AI 说能跑就行"，把质量问题留到后期。（#2 #4 #10 #11）
6. **迷信单次完美生成**：期待一次出完美代码，遇到垃圾首版就否定 AI，而不是进入"迭代修正"模式。（#5 #10）

## 五、对博客写作的启示（草稿方向）

- 博客可采用的叙事弧线：旧时代（搜索 + 手写）→ 过渡（补全工具）→ 新时代（Agent 工作流），引出"初级程序员如何构建自己的 AI Coding 工作流"。
- 建议覆盖的章节骨架：
  1. 为什么初级程序员最需要工作流（而不是更多工具）
  2. 工作流的五个环节：规划 → 上下文 → 生成 → 验证 → 评审/沉淀
  3. 面向初级程序员的特殊建议：质量优先、手动修 bug、先想后问、费曼学习法
  4. 常见误区与反模式
  5. 个人工作流分享（待用户补充）
  6. 工具与资源清单
- 素材使用建议：引用 Google/Anthropic/Cursor 官方实践建立可信度；用 Sanity、CyberAgent、Karpathy 的实践故事增加可读性；用 piglei 指南支撑"初级程序员"专属章节。

---

*本文件为调研素材，后续博客正文写作时可自由引用其中观点，建议在博客中标注灵感来源链接。*
