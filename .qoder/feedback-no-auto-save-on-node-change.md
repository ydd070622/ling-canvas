---
name: feedback-no-auto-save-on-node-change
description: 节点修改禁止自动保存到 localStorage，避免触发主页重渲染
metadata:
  type: feedback
---

**Rule:** 画布节点的增删改操作只修改内存状态（nodes.value、edges.value），严禁自动触发 localStorage 持久化或跨页面影响。

**Why:** 2026-09-03 发现架构问题：`canvas.js` 中的 `watch([nodes, edges], () => { debouncedSave() })` 导致每次节点修改都触发 `saveProject()` → `updateProjectCanvas()` → `localStorage.setItem()`，进而触发 `projects.js` 的响应式更新，最终导致主页（Home.vue）重新渲染。这种隐式副作用使得功能扩展和调试极其困难。

**How to apply:** 
1. **移除自动保存 watch**：删除 `canvas.js` 中的 `watch([nodes, edges], ...)` 监听器
2. **显式保存时机**：仅在以下场景调用 `saveProject()`：
   - 路由切换时（Canvas.vue 的 `watch(() => route.params.id, ...)`）
   - 组件卸载时（Canvas.vue 的 `onUnmounted()`）
   - 窗口关闭前（Canvas.vue 的 `beforeunload` 事件）
3. **验证方法**：在 Home.vue 添加 `console.log` 跟踪渲染次数，在 canvas.js 的 `saveProject()` 中添加日志确认只在预期时机触发
4. **架构原则**：所有跨模块的影响必须是显式的，没有隐式 watch 或自动同步

此规则适用于所有需要隔离状态的模块，确保高内聚低耦合。后续如需实时协作或云同步功能，应通过明确的 API 接口而非隐式 watch 实现。

[[feedback-template-tag-balancing]] — 相关：Vue SFC 修改时的标签配对验证
[[feedback-node-system-isolation]] — 相关：节点系统修改隔离原则
