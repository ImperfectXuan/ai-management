---
id: 02-project-structure
title: 项目结构
scope: all
---

# 项目结构

关于把代码组织进目录与模块的约定。与语言或框架无关。

## 入口点

- 项目根目录必须有清晰、易发现的入口点
- 常见模式：`src/index.*`、`app/main.*`、`cmd/` 目录，或根目录的 `main.*`
- 新开发者应在打开仓库 30 秒内找到入口点

## 目录命名

- 目录用 **kebab-case**：`user-service`、`payment-gateway`、`email-templates`
- 目录名应描述里面装什么 —— 用 `authentication` 而非 `auth-stuff`
- 按特性或领域分组，而非按文件类型：
  - ✅ `users/`（包含 handler、repository、model、tests）
  - ❌ `controllers/`、`models/`、`views/` 散落在整棵树上

## 分层

按与领域的距离组织代码，而非按技术角色：

```
entrypoint / delivery  ← HTTP、CLI、事件处理器（薄，无业务逻辑）
       ↓
  business logic       ← 领域规则、用例、工作流
       ↓
  data access          ← 仓储、数据源、外部 API
       ↓
 infrastructure        ← 日志、配置、框架装配
```

- 内层永不从外层导入
- 同层兄弟模块不应互相导入 —— 把共享代码向上抽取
- 每层暴露窄的公共接口；内部保持私有

## 文件命名

- 以主要导出命名文件：`UserAuthenticator.js`、`password-hasher.go`、`email_service.py`
- 测试文件与被测代码放在一起：`UserAuthenticator.test.js`、`password_hasher_test.go`
- 只有一个公共模块的目录可用 `index` 文件再导出

## 配置

- 环境相关的值放在配置文件或环境变量中，绝不可硬编码
- 默认配置值应开箱即可用，支撑起一个能跑的开发环境
- 密钥（API key、密码、token）绝不放配置文件 —— 用密钥管理器或环境变量

## Shared / Common / Utils

- 无业务含义的通用代码：字符串辅助、日期格式化、类型守卫
- 这些目录应保持小 —— 若它们膨胀，这些代码可能更应靠近其消费者
- 只被一个模块使用的函数不是「工具」—— 它属于那个模块
