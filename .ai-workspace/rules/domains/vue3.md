---
id: vue3
title: Vue 3 & TypeScript 编码规范
scope: vue
description: Vue 3, TypeScript 与 TailwindCSS 组件编写与状态管理规范。
---

# Vue 3 & TypeScript 编码规范

- **范式**：严格使用 Vue 3 Composition API 和 `<script setup lang="ts">`。
- **状态管理**：使用 Pinia，避免过度使用全局状态，优先组件内组合式函数 (Composables)。
- **样式**：使用 TailwindCSS (若有配置) 或 Scoped SCSS，遵循 BEM 命名规范。
- **强类型**：所有 Props、Emits、API 返回值必须有严格的 TypeScript 接口定义，禁止使用 `any`。
- **组件通信**：避免深层 Prop drilling，善用 Provide/Inject。
