# 节点消失调查与修复（2026-10-02，1.9.7）

## 结论及证据范围

确认了一处会让业务数据与界面分离的同步竞态。旧实现可以稳定复现“新结果节点存在于业务数组，但 Vue Flow 数组和 DOM 没有它”。用户报告刷新后节点恢复，与此缺陷相符。未用 computer use 操作用户桌面，因此不能断言所有历史消失事件都出于同一个原因。

检查了删除入口、批量删除、节点 ID、结果节点归属与结果写回、项目加载与保存、撤销恢复、图片节点渲染、Vue Flow 1.48 的节点解析及模型监听。没有发现删除普通旧节点会主动级联删除新结果节点；项目重载入口只在初始化和路由切换触发。节点 ID 使用 UUID，不是按数组长度分配。

## 确认的竞态

旧 `Canvas.vue` 用 `v-model:nodes` / `v-model:edges` 连接业务 store 和 Vue Flow。依赖的 `useWatchProps` 在内部数组回传时暂停 model watcher，到 `nextTick` 才恢复。暂停期间发生的业务变更不会重放。

复现把结果写回、新增结果和删除旧节点安排在图内部更新的同一轮 post watcher：

- 业务数组：旧节点已经删除，新节点已写入结果，并且包含新的 `generated` 节点。
- 旧图内部数组：仍有旧节点，原新节点仍显示 loading，没有 `generated`。
- DOM：没有 `generated`。

刷新重新读业务保存数据，所以会重新出现。单纯补量、修改图片 CSS 或调用 `updateNodeInternals` 不能把图数组中缺失的节点补回来。

## 修复

`useCanvasFlowSync.js` 让业务数组通过 `setNodes` / `setEdges` 单向同步到图，移除了整个内部数组回传覆盖业务数组的通道。选择、位置、拖动与尺寸以明确字段补丁写回业务，结果内容不会被交互补丁覆盖。

关闭 Vue Flow 默认 Backspace 删除，保留应用自己的 Delete/Backspace 删除、撤销与保存路径，避免两个删除入口同时运行。边选择和边删除也显式写回业务。

## 验证

- `pnpm verify:canvas`：同步暂停窗口中的删除、结果写回、新节点 DOM 可见性；60 轮创建/删除/写回/位置/选择；画布重挂载，均通过。
- `node scripts/verify-canvas-sync.mjs --legacy`：复现旧 v-model 实现，预期断言失败。这是对照用例，不是修复后应通过的检查。
- 实际 `SimpleImageNode.vue` 编译后在 DOM 模拟环境中做 60 轮新增、删除、结果写回，零失败。临时脚本与构建位于忽略的 `artifacts/`。
- 前端与 Windows release/NSIS 构建用于交付 1.9.7。

测试使用 jsdom 和真实 Vue Flow，模拟尺寸及 ResizeObserver。没有调用收费生成接口；没有验证真实 WebView2 绘制、鼠标拖动或真实供应商请求。

## 刷新为什么中断生图

`RenderNode.vue` 的 `onBeforeUnmount` 设置 cancelled 并调用 `stopImage()`。`useImageGeneration` 的 stop 会触发 AbortController；网关收到 signal 后会取消对应原生 HTTP 请求。刷新同时销毁 JS 组件、本轮队列和回调；重新加载时还会清理保存的 loading 等瞬态状态。

目前没有持久化生成任务、供应商任务查询或刷新后接续接收结果的机制。取消客户端请求不代表供应商一定停止处理或退款；本次没有更改这项语义，也没有自动重试请求。

## 1.9.8 拖动坐标修正

旧项目节点中含有 Vue Flow 的 computedPosition、handleBounds、dimensions 等运行缓存。setNodes 合并输入时会将旧 computedPosition 覆盖到正在使用的图节点；位置 watcher 要到 post 阶段才重新计算，因此业务更新会造成临时坐标回退，拖动起点也可能读取到旧缓存。

同步入口通过 toFlowNode 去掉引擎缓存，保存入口通过 toCanvasNode 去掉缓存及 dragging/resizing 瞬态字段。保留真实 position、data、连接与节点身份，旧文件无需手工重建。

回归覆盖旧缓存写入后的即时坐标和 DOM transform、保存字段清理，以及真实 Vue Flow updateNodePositions 移动/松手事件 30 轮。所有检查通过；实际桌面鼠标与 WebView2 尚未验证，仍需用户安装后复测。
