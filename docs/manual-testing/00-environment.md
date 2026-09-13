# 00 · 环境准备

> **测试对象**：把项目跑起来之前的环境。
> **预计耗时**：10–20 分钟（含首次 `npm install` 下载）。
> **写文件**：无（除 `npm install` 写入依赖外）。

---

## 1. 目标

把跑通 CLI / TUI / Desktop 所需的依赖全部装好，并掌握两条基本功：

1. 定位并运行 `aiws` 命令。
2. 搭建一个「临时仓库」，供后续写操作测试隔离使用。

---

## 2. 依赖清单与安装

### 2.1 基础依赖（CLI 必需）

| 依赖 | 作用 | 检查命令 | 安装命令（macOS） |
|---|---|---|---|
| git | 定位仓库根、规则版本化 | `git --version` | 系统自带 / `brew install git` |
| Node.js ≥ 18 | TUI、Desktop 运行 | `node --version` | `brew install node` |
| jq | 解析 JSON/YAML（**CLI 必需**） | `jq --version` | `brew install jq` |
| shasum | 规则版本化哈希（macOS 自带） | `shasum -v`（无输出即存在） | 系统自带 |

```bash
# 一次性检查
git --version && node --version && jq --version && shasum --version 2>&1 | head -1
```

> ⚠️ **jq 缺失是最常见的坑**：`aiws sync`/`aiws mcp list`/`aiws validate` 都会用到 jq，缺失时会直接报 `jq is required ... Install with: brew install jq`。

### 2.2 vault 依赖（仅测「密钥」域时需要）

`05-secrets.md` 里的 vault 初始化、`secrets set/list/remove` 需要加密工具：

```bash
brew install age oath-toolkit
```

- `age`：文件加密（`age`、`age-keygen`）。
- `oathtool`：TOTP 动态口令（2FA）。

> 如果本轮不测密钥，可暂不装；`aiws secrets audit` 与 `AIWS_JSON=1 aiws secrets list` 是**只读**的，不依赖它们。

### 2.3 TUI / Desktop 依赖

```bash
cd /Users/xuanyi/Documents/AI-management/tui && npm install
cd /Users/xuanyi/Documents/AI-management/electron && npm install
```

> 首次 `npm install` 需联网下载 Electron 二进制，较慢，耐心等待。
> Desktop（electron）仅支持 macOS。

---

## 3. 定位并运行 `aiws`

`aiws` 是 POSIX shell 脚本，入口在 `.ai-workspace/scripts/aiws`。它会用 `git rev-parse --show-toplevel` 自动找到所在 git 仓库根，所以**在仓库内任意子目录执行都行**。

约定一个简写变量，本手册后续统一用它：

```bash
cd /Users/xuanyi/Documents/AI-management      # 进入项目根目录
AIWS=./.ai-workspace/scripts/aiws             # 命令简写
```

验证：

```bash
$AIWS --version
```

**预期**：

```
aiws v0.1.0
```

**判定**：✅ 打印版本号即环境就绪；❌ 报 `Permission denied` 说明脚本无执行权限，执行 `chmod +x .ai-workspace/scripts/aiws`。

> 提示：`.ai-workspace/scripts/aiws` 用相对路径 `./`，确保在项目根目录执行。若在别的 git 仓库测试，就 `cd` 到那个仓库，用那个仓库自己的 `.ai-workspace/scripts/aiws`（参见下节临时仓库）。

---

## 4. 临时仓库（写操作沙盒）

后续「写文件」类测试（sync 生成、mcp add、skills link、secrets init、memory new）建议先在临时仓库做，测完即删，避免污染真实仓库。

### 4.1 搭建

```bash
TMP=$(mktemp -d /tmp/aiws-test.XXXXXX)     # 建临时目录
cd "$TMP" && git init -q                   # 初始化为 git 仓库
cp -R /Users/xuanyi/Documents/AI-management/.ai-workspace "$TMP/"
AIWS=./.ai-workspace/scripts/aiws          # 指向临时仓库里的 CLI
```

**预期**：`git init` 无输出；`.ai-workspace` 被完整复制（含 rules/skills/mcp/config/scripts）。

**判定**：✅ `ls -d .ai-workspace/rules` 存在；❌ 复制失败则后续命令会找不到脚本。

### 4.2 验证临时仓库可用

```bash
cd "$TMP" && $AIWS --version && $AIWS validate
```

**预期**：版本号 + validate 通过（详见 [01-cli-basics.md §3](01-cli-basics.md)）。

### 4.3 收尾

```bash
cd / && rm -rf "$TMP"                       # 删除临时仓库
```

> 记录下 `$TMP` 的实际路径（每次 `mktemp` 都不同）。每个 shell 会话里 `$TMP` 变量只在当前会话有效，重新开终端需重新赋值。

---

## 5. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `command not found: aiws` | 用了 `aiws` 而非完整路径 | 用 `$AIWS` 简写或 `.ai-workspace/scripts/aiws` |
| `jq is required` | 未装 jq | `brew install jq` |
| `age is required` / `oathtool is required` | 未装 vault 依赖 | `brew install age oath-toolkit` |
| `npm install` 卡住 | 下载 Electron 慢 | 耐心等待或配置 npm 镜像 |
| 在非 git 目录跑 `$AIWS` | 找不到仓库根 | 先在目录里 `git init` |

---

## 6. 验收清单

- [ ] `node --version`、`git --version`、`jq --version` 均正常。
- [ ] `$AIWS --version` 输出 `aiws v0.1.0`。
- [ ] `tui`、`electron` 两个目录 `npm install` 完成。
- [ ] 临时仓库能搭建并运行 `$AIWS validate`。
