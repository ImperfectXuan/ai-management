---
id: wpf
title: WPF (.NET 8) 编码规范
scope: wpf
description: WPF, MVVM 与 XAML 编写规范。
globs:
  - "**/*.xaml"
  - "**/*.cs"
  - "**/*.csproj"
---

# WPF (.NET 8) 编码规范

- **架构**：严格遵循 MVVM 模式。
- **核心库**：强制使用 `CommunityToolkit.Mvvm` 进行依赖属性、命令 (RelayCommand) 和消息传递 (WeakReferenceMessenger) 的绑定。
- **XAML**：分离 UI 逻辑，禁止在 Code-Behind (.xaml.cs) 中写业务逻辑。
- **异步 UI**：在 ViewModel 中使用 `IAsyncRelayCommand` 处理耗时操作，确保 UI 线程不卡顿。
