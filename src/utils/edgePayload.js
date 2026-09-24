/**
 * 边的持久化投影 | Persistable edge projection
 *
 * **为什么需要它**：`edges.value` 是直接 `v-model:edges` 绑给 Vue Flow 的
 * （`views/Canvas.vue:16`），Vue Flow 会把运行期对象**原地补进**每条边 ——
 * `sourceNode`/`targetNode` 是两个完整的节点对象（`vue-flow-core.mjs:4838`
 * 的 `createGraphEdges`），而 graph node 与 model node **共享同一个 `data` 对象**。
 * 于是节点里那张图会跟着边的副本再存一份。
 *
 * **实测代价**（2026-09-24，示例项目）：一条边 1,967,949 字节，其中
 * `targetNode.data.url` 占 1,960,958 —— 与 `media/` 里那个文件逐字节相同，
 * 整个项目文档 1,976,091 字节，而它本该只有 8,707。
 *
 * 这不只是"文档大"：`src-tauri/src/lib.rs:221` 读盘时超过 100MB **直接跳过该文件**，
 * `lib.rs:260` 写盘超 100MB **直接报错**。约 53 条泄漏边就会让项目从列表里消失，
 * 而且再也存不进去 —— 永久性数据丢失，只能靠 `.json.bak` 抢救。
 *
 * **为什么用白名单而不是黑名单**：Vue Flow 的内部字段会随版本增加，黑名单会静默腐烂。
 * 白名单的取值口径对齐 `utils/migrateCanvasDocument.js:199-216` —— 那是应用自己对
 * 「一条边的规范形状」的既有定义，不是这里新发明的。
 *
 * 纯函数，零 import：它要同时被 stores 层和 load/save 路径调用。
 */

/**
 * 必须持久化的字段。
 *
 * 单独说明两个容易想当然剥掉的：
 *
 * - `sourceX/sourceY/targetX/targetY` —— **绝不能剥**。`components/edges/FlowEdge.vue:107-110`
 *   的 `anchorX/anchorY` 在节点尺寸尚未测量时会回退到这几个值，剥了会拿到 NaN 的 path `d`。
 *   它们各只几字节，留着零成本、消除全部风险。
 * - `data` —— 保留**整个对象**而不是只留 `data.order`。`order` 是唯一的业务载荷
 *   （决定引用编号 `@图片1` 的顺序），但留整个对象可以零成本保住 legacy 的 `label`/`color`，
 *   避免"静默丢数据"。
 *
 * `style` / `markerEnd` 今天没有任何代码写入（`FlowEdge.vue` 声明了这两个 prop 并转发），
 * 加进来是 0 字节的加固：将来有人给边加自定义外观时，不会被这个白名单悄悄吞掉。
 * 两个 `*Position` 则**故意不加** —— 它们是 Vue Flow 每次渲染从 handle 几何反查出来的派生值
 * （`getEdgeHandle`），持久化没有意义。
 */
export const PERSISTABLE_EDGE_KEYS = Object.freeze([
  'id',
  'source',
  'target',
  'sourceHandle',
  'targetHandle',
  'type',
  'data',
  'sourceX',
  'sourceY',
  'targetX',
  'targetY',
  'style',
  'markerEnd'
])

/**
 * 把一条边投影成可持久化的形状。
 *
 * 被剥掉的（Vue Flow 运行期注入，App 侧零读取）：`sourceNode`、`targetNode`、
 * `events`、`selected`、`updatable`、`selectable`、`focusable`、`hidden`、
 * `animated`、`interactionWidth`、`zIndex`、`label`、`ariaLabel`、`domAttributes` 等。
 *
 * `selected` 值得单独说：它在 `views/Canvas.vue:657` 被读（Delete 键删边），
 * 所以不是"纯内部字段"。但它是瞬态 UI 状态 —— 落盘 `selected: true` 会导致重开后
 * 按 Delete 凭空删掉一条**看不出被选中**的边。不持久化是行为修正。
 *
 * @param {object} edge
 * @returns {object|null} 非对象返回 null（由 `toPersistableEdges` 过滤掉）
 */
export const toPersistableEdge = (edge) => {
  if (!edge || typeof edge !== 'object') return null

  const projected = {}
  for (const key of PERSISTABLE_EDGE_KEYS) {
    if (edge[key] !== undefined) projected[key] = edge[key]
  }

  // data 浅拷贝断开引用：Vue Flow 让 graph node 与 model node 共享 data，
  // 不复制的话，后续 normalizeEdgeOrders 改 order 会波及项目文档里的那一份。
  if (projected.data && typeof projected.data === 'object') {
    projected.data = { ...projected.data }
  }

  return projected
}

/**
 * 批量投影，顺带丢掉非法项。
 *
 * @param {Array} edges
 * @returns {Array}
 */
export const toPersistableEdges = (edges = []) => {
  if (!Array.isArray(edges)) return []
  return edges.map(toPersistableEdge).filter(Boolean)
}
