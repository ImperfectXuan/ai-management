---
id: winforms
title: WinForms (.NET Framework 4.x) 编码规范
scope: winforms
description: WinForms 编写规范 — MVP 模式、线程安全与资源管理。
globs:
  - "**/*.cs"
  - "**/*.Designer.cs"
---

# WinForms (.NET Framework 4.x) 编码规范

- **架构**：由于是老技术，尽可能使用 MVP (Model-View-Presenter) 模式分离业务逻辑与窗体代码。
- **线程**：禁止在 UI 线程执行长耗时任务。必须使用 `Task.Run` 并在完成后通过 `Control.Invoke` / `Control.BeginInvoke` 更新 UI。
- **资源**：所有实现 `IDisposable` 的对象 (如 `Pen`, `Brush`, DB 连接) 必须包裹在 `using` 语句中以防内存泄漏。
