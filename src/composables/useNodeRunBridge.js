/**
 * useNodeRunBridge | 底部 composer → 节点生成
 *
 * 生成按钮只有底部固定栏那一个（卡片上不再放动作按钮）。但生成逻辑长在各节点组件里
 * —— 它要用自己的模型、上游槽位、状态机（视频还有轮询）—— composer 拿不到。
 *
 * 所以两头之间只搭一根最小的桥：窗口事件 + nodeId，谁被选中谁响应。
 * 与 `ling-canvas:open-asset-picker`、`ling-canvas:focus-composer` 是同一套做法。
 */
import { onBeforeUnmount, onMounted } from 'vue'

export const RUN_NODE_EVENT = 'ling-canvas:run-node'
export const CANCEL_NODE_EVENT = 'ling-canvas:cancel-node'

/** 让 composer 触发 / 取消某个节点的生成 */
export const runNode = (nodeId) => {
  window.dispatchEvent(new CustomEvent(RUN_NODE_EVENT, { detail: { nodeId } }))
}
export const cancelNode = (nodeId) => {
  window.dispatchEvent(new CustomEvent(CANCEL_NODE_EVENT, { detail: { nodeId } }))
}
const runners = new Map()
export const runNodeAndWait = async (id) => {
  const run = runners.get(String(id))
  if (!run) throw new Error('节点未准备好，请确认它已显示在画布中')
  await run()
}

/**
 * 节点侧：只响应发给自己的那条。
 * @param {string} id 本节点 id
 * @param {{ run: Function, cancel?: Function }} handlers
 */
export const useNodeRunBridge = (id, { run, cancel }) => {
  const onRun = (event) => {
    if (String(event.detail?.nodeId) !== String(id)) return
    run()
  }
  const onCancel = (event) => {
    if (String(event.detail?.nodeId) !== String(id)) return
    cancel?.()
  }

  onMounted(() => {
    runners.set(String(id), run)
    window.addEventListener(RUN_NODE_EVENT, onRun)
    window.addEventListener(CANCEL_NODE_EVENT, onCancel)
  })
  onBeforeUnmount(() => {
    runners.delete(String(id))
    window.removeEventListener(RUN_NODE_EVENT, onRun)
    window.removeEventListener(CANCEL_NODE_EVENT, onCancel)
  })
}
