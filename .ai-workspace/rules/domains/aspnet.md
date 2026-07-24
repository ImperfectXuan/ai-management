---
id: aspnet
title: ASP.NET Core & C# (.NET 8) 编码规范
scope: csharp
description: ASP.NET Core 与 C# 相关的架构设计、依赖注入与异步编程规范。
---

# ASP.NET Core & C# (.NET 8) 编码规范

- **语言**：使用 C# 12+ 语法，开启 nullable 引用类型 (`<Nullable>enable</Nullable>`)。
- **架构**：优先使用干净架构 (Clean Architecture) 或基于特性的文件夹结构 (Feature Folders)。
- **接口**：RESTful API 使用基于 Controller 或 Minimal API 的标准写法，统一返回格式。
- **数据访问**：使用 Entity Framework Core，优先考虑异步方法 (Async/Await 一撸到底，禁止使用 `.Result` 或 `.Wait()`)。
- **依赖注入**：必须通过构造函数注入服务。
- **日志记录**：使用 `ILogger` 进行结构化日志记录 (推荐 Serilog)。
