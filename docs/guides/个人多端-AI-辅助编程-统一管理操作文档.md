<!-- 历史方案：本文档描述的是早期的 ~/.ai-rules 软链接方案，已被仓库内的 .ai-workspace/ 规范化方案取代。仅供参考，不再维护。 -->

## 1. 概述与架构理念
本方案旨在解决 macOS 环境下，跨多款 AI Coding 工具（Cursor、Trae、Claude Code）的提示词（Prompt）统一管理问题。

+ **适用技术栈**：ASP.NET Core (.NET 8)、Vue 3、WPF、WinForms。
+ **核心架构**：基于**“中央集中维护 + 脚本动态挂载 + 终端/IDE 无感触发”**的架构。通过统一的 `.mdc`（Markdown Cursor）文件结合软/硬链接技术，实现“一处修改，全平台同步”。

---

## 2. 第一步：建立中央规则库 (Central Repository)
打开终端，创建系统级的 AI 规则存放目录：

```bash
mkdir -p ~/.ai-rules
```

所有规则文件均采用 `.mdc` 格式，并带有严格的 YAML 头部配置（支持 Cursor / Trae 底层解析）。

### 2.1 全局与 Git 规范 (自动装载)
创建 `~/.ai-rules/global.mdc`。_(注：脚本会自动装载所有以 _`global`_ 开头的文件)_

```yaml
---
description: 通用代码规范、防呆设计与自动 Git 提交流程。
globs: "**/*"
alwaysApply: true
scene: git_message
---
# 通用代码规范
- 可读性优先：代码必须自文档化。
- 防御性编程：必须处理可能的 Null 引用，禁止吃掉异常。
- 无痕修改：修改现有代码时，严格保持原有文件的缩进格式、命名风格。

# 自动 Git 提交规范
1. 审查：提交前必须先静默执行 `git status` 和 `git diff`。
2. 规范：使用 Conventional Commits 标准（如 feat:, fix:, refactor: 等），并使用**中文**编写。
3. 推送：执行 push 前优先尝试 `git pull --rebase`。
```

### 2.2 ASP.NET Core 规范 (按需装载)
创建 `~/.ai-rules/aspnet.mdc`：

```yaml
---
description: ASP.NET Core 与 C# 相关的架构设计、依赖注入与异步编程规范。
globs: "**/*.{cs,csproj,sln}"
alwaysApply: false
---
# ASP.NET Core & C# (.NET 8) 编码规范
- 语言：C# 12+ 语法，开启 nullable 引用类型。
- 架构：优先使用干净架构 (Clean Architecture) 或 Feature Folders。
- 异步：Async/Await 一撸到底，禁止使用 `.Result` 或 `.Wait()`。
- 注入：必须通过构造函数注入服务。
```

### 2.3 Vue 3 规范 (按需装载)
创建 `~/.ai-rules/vue3.mdc`：

```yaml
---
description: Vue 3, TypeScript 与 TailwindCSS 组件编写与状态管理规范。
globs: "**/*.{vue,ts,js,css,scss}"
alwaysApply: false
---
# Vue 3 & TypeScript 编码规范
- 范式：严格使用 Vue 3 Composition API 和 `<script setup lang="ts">`。
- 强类型：Props、Emits、API 返回值必须有严格接口定义，禁止使用 `any`。
- 状态：使用 Pinia，优先组件内组合式函数 (Composables)。
```

_(其他如 _`wpf.mdc`_ (globs: _`**/*.{xaml,cs}`_ ) 依此类推构建。)_

---

## 3. 第二步：配置动态挂载脚本
编辑你的终端配置文件（`~/.zshrc` 或 `~/.bash_profile`），将以下代码添加到底部：

```bash
# AI 规则终极动态扫描与挂载工具
function link_ai_rules() {
    local ai_dir="$HOME/.ai-rules"

    # 1. 拦截空参数并列出可用模块
    if [ $# -eq 0 ]; then
        echo "⚠️ 请指定要加载的规则模块！"
        echo "💡 用法示例:"
        echo "   快捷组: link_ai_rules web (相当于 aspnet + vue3)"
        echo "   自定义: link_ai_rules python docker"
        echo "---"
        echo "📂 当前可用的可选模块有："
        for file in "$ai_dir"/*.mdc; do
            if [ -f "$file" ]; then
                local rule_name=$(basename "$file" .mdc)
                if [[ ! "$rule_name" == global* ]]; then
                    echo "   - $rule_name"
                fi
            fi
        done
        return 1
    fi

    echo "🚀 正在自动化扫描并动态挂载 AI 规则..."

    # 2. 参数解析与别名展开
    local selected_rules=()
    for arg in "$@"; do
        case $arg in
            web) selected_rules+=("aspnet" "vue3") ;;
            wpf) selected_rules+=("wpf") ;;
            winforms) selected_rules+=("winforms") ;;
            *) selected_rules+=("$arg") ;;
        esac
    done

    # 3. 初始化目录并清理旧配置
    mkdir -p .cursor/rules .trae/rules .claude/rules
    rm -f .cursorrules .traerules
    rm -f .cursor/rules/*.mdc .trae/rules/*.md .claude/rules/*.md 2>/dev/null

    # 4. 挂载全局核心规则 (自动扫描 global* 文件)
    echo "📦 挂载全局核心规则:"
    for global_file in "$ai_dir"/global*.mdc; do
        if [ -f "$global_file" ]; then
            local filename=$(basename "$global_file")
            local basename_no_ext="${filename%.*}"
            echo "  👉 命中: $filename"
            ln -sf "$global_file" ".cursor/rules/$filename"      # Cursor 软链
            ln -sf "$global_file" ".claude/rules/$basename_no_ext.md" # Claude 软链
            ln -f "$global_file" ".trae/rules/$basename_no_ext.md"    # Trae 硬链
        fi
    done

    # 5. 挂载按需拓展规则
    echo "🧩 挂载按需拓展规则:"
    for rule in "${selected_rules[@]}"; do
        local rule_file="$ai_dir/${rule}.mdc"
        if [ -f "$rule_file" ]; then
            echo "  👉 命中: ${rule}.mdc"
            ln -sf "$rule_file" ".cursor/rules/${rule}.mdc"
            ln -sf "$rule_file" ".claude/rules/${rule}.md"
            ln -f "$rule_file" ".trae/rules/${rule}.md"
        else
            echo "  ⚠️ 警告: 未在规则库中找到 ${rule}.mdc，已跳过！"
        fi
    done

    echo "✅ 动态规则挂载完成！"
    echo "💡 提示: 切换到 Trae 请按 Cmd+Shift+P 执行 Reload Window 刷新缓存。"
}
```

保存后，在终端执行 `source ~/.zshrc` 生效。

---

## 4. 第三步：配置全局 Git 隔离（防污染）
由于挂载的文件中包含个人电脑的绝对路径配置，必须全局忽略，避免提交到团队代码库。

在终端依次执行：

```bash
# 创建/写入全局黑名单
touch ~/.gitignore_global
echo ".cursor/" >> ~/.gitignore_global
echo ".claude/" >> ~/.gitignore_global
echo ".trae/rules/" >> ~/.gitignore_global

# 注册到 Git
git config --global core.excludesfile ~/.gitignore_global
```

---

## 5. 日常使用工作流
1. **创建或克隆项目**后，进入根目录：

```bash
cd /path/to/my-web-project
```

2. **初始化 AI 环境**（如全栈项目）：

```bash
link_ai_rules web
```

3. **IDE 开发表现**：
    - **Cursor**：直接写 `.cs` 代码，Agent 会自动加载 `aspnet` 规范。
    - **Trae**：开发 `.vue` 页面前，按下 `Cmd+Shift+P` 执行 `Reload Window`。随后 Agent 会自动依据 `vue3` 规范产出代码。在 Git 侧边栏点击 ✨ 按钮，自动遵循全局 Git 规范输出纯中文的 Commit message。
    - **Claude Code**：终端运行 `claude "完成开发，提交并推送"`，自动遵循规范完成 Git 全流程自动化。

---

## 6. 排坑指南 (Troubleshooting)
### Q1: 在访达(Finder)里改后缀名为 .mdc，但 IDE 识别成 `xxx.mdc.md`？
+ **原因**：macOS 默认隐藏已知扩展名。
+ **解决**：在访达顶部菜单进入 `设置 -> 高级`，勾选 **“显示所有文件扩展名”**。然后删掉多余的 `.md`。

### Q2: 脚本运行成功，但在 Trae 的 “设置 -> 规则” 里看不到？
+ **原因**：Trae 有界面缓存。
+ **解决**：必须在 Trae 中按下 `Cmd+Shift+P` 唤出命令面板，输入并执行 `Reload Window` (重载窗口)。脚本中针对 Trae 已专门采用**硬链接 (**`ln -f`**)**，重载后必定能绕过安全拦截显示在列表中。

### Q3: Trae 规则页面提示 “此 glob 匹配模式未匹配到工作区中的任何文件”？
+ **原因**：这是善意提示。说明你的 `globs` 语法写对了，但当前项目文件夹太干净（或是一个新项目），还没建立对应的 `.cs` 或 `.vue` 文件。
+ **解决**：随便建一个对应后缀的空文件，该提示会瞬间消失，证明联动成功。

### Q4: 规则文件夹在 VS Code/IDE 的源码管理里依然显示为待提交 (未被忽略)？
+ **原因**：Git 缓存机制。说明你在配置全局忽略前，这些文件已经被 `git add` 追踪过了。
+ **解决**：在项目根目录运行以下命令清除追踪缓存：

```bash
git rm -r --cached .cursor/ .trae/rules/ .claude/ 2>/dev/null
git commit -m "chore: 移除本地 AI 工具配置文件的 Git 追踪"
```



