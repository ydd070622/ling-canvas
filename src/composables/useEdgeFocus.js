/**
 * 被点中的那条连线 | Focused edge
 *
 * 点一下连线，剪刀就钉在那条线上不走了；点画布空白或别的节点才收起来。
 *
 * 为什么不复用 Vue Flow 的 `edge.selected`：
 * 1) 它是**会被存档的**。点一下连线 → `selected: true` 进了 `edges.value`，
 *    下一次快照就把它写进项目文件；重开后剪刀自己挂在那儿，没人知道为什么。
 *    这里的状态只活在内存里，和"滑块位置不落盘"是同一个理由。
 * 2) 它由 Vue Flow 内部维护，而这个画布的选区另有自己的口径（见 useFocusMode 里
 *    对 `node.selected` 的说明），再挂一套容易对不上。
 */
import { ref } from 'vue'

export const activeEdgeId = ref(null)

export const focusEdge = (id) => { activeEdgeId.value = id === null || id === undefined ? null : String(id) }
export const clearEdgeFocus = () => { activeEdgeId.value = null }
