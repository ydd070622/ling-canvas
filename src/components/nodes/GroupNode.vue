<template>
  <!-- 节点组：纯容器，不参与数据流（没有端口）
       分组框本身不吃鼠标事件 —— 组内部要留给框选和双击建节点。可点的只有框外
       那一小条标题栏（在 top:-26px，不覆盖组内区域）。 -->
  <div class="flow-group-node" :style="{ ...(data.color ? { background: `${data.color}26`, borderColor: `${data.color}99` } : {}), ...(data.dragBounds ? { transform: `translate(${data.dragBounds.x}px, ${data.dragBounds.y}px)`, width: `${data.dragBounds.width}px`, height: `${data.dragBounds.height}px` } : {}) }">
    <div v-if="selected" class="group-actions nodrag" @mousedown.stop @click.stop>
      <div class="group-color-control">
        <button title="组颜色" :style="{ color: data.color || '#888888' }" @click="showColors = !showColors">●</button>
        <div v-if="showColors" class="group-colors"><button v-for="color in colors" :key="color" :style="{ color }" :title="color" @click="updateNode(id, { color }); showColors = false">●</button></div>
      </div>
      <select class="nodrag" aria-label="组内布局" @change="layoutGroup($event.target.value); $event.target.value = ''"><option value="">布局</option><option value="row">横向排列</option><option value="column">纵向排列</option></select>
      <button :disabled="running" @click="executeGroup">{{ running ? '执行中…' : '▶ 整组执行' }}</button>
      <button :disabled="saving" @click="saveWorkflow">创建工作流</button>
      <button @click="ungroup">解组</button>
    </div>
    <button v-for="side in selected ? ['left', 'right', 'top', 'bottom'] : []" :key="side" class="group-resize nodrag nopan" :class="side" :title="'拖动调整组大小'" @pointerdown.stop.prevent="startResize($event, side)"></button>
    <div class="flow-group-bar">
      <span
        v-if="!isEditingLabel"
        class="flow-group-title"
        title="双击编辑名称；将整张图片拖离组边界一段距离后松手可移出"
        @dblclick="startEditLabel"
      >{{ data.label || '节点组' }}</span>
      <input
        v-else
        ref="labelInputRef"
        v-model="editingLabelValue"
        class="flow-group-title"
        @blur="finishEditLabel"
        @keydown.enter="finishEditLabel"
        @keydown.escape="cancelEditLabel"
        @mousedown.stop
        @dblclick.stop
        @click.stop
      />
      <button class="flow-group-ungroup nodrag" type="button" title="解散这个组（节点保留）" @click.stop="ungroup">
        取消分组
      </button>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { updateNode, removeNode, nodes, edges, startBatchOperation, endBatchOperation } from '../../stores/canvas'
import { workflowOrder } from '../../utils/groupWorkflow'
import { saveGroupWorkflow } from '../../stores/groupWorkflows'
import { fetchBytes } from '../../utils/downloadMedia'
import { runNodeAndWait } from '../../composables/useNodeRunBridge'

const props = defineProps({
  id: String,
  selected: Boolean,
  data: {
    type: Object,
    default: () => ({})
  }
})
const { viewport } = useVueFlow()
const showColors = ref(false), running = ref(false), saving = ref(false)
const colors = ['#888888', '#b64747', '#b8772e', '#aa982b', '#6a943b', '#349396', '#3e71b3', '#8059b5']
const members = () => nodes.value.filter(node => node.parentNode === props.id)
const layoutGroup = direction => {
  if (!direction) return
  let offset = 28
  const patches = new Map(members().map(node => {
    const position = direction === 'row' ? { x: offset, y: 28 } : { x: 28, y: offset }
    offset += (direction === 'row' ? node.dimensions?.width || 320 : node.dimensions?.height || 240) + 28
    return [node.id, position]
  }))
  startBatchOperation()
  nodes.value = nodes.value.map(node => patches.has(node.id) ? { ...node, position: patches.get(node.id) } : node)
  endBatchOperation()
}
const executeGroup = async () => {
  if (running.value) return
  running.value = true
  try {
    const ordered = workflowOrder(members(), edges.value)
    for (const node of ordered) {
      if (!nodes.value.some(item => item.id === props.id)) throw new Error('组已被移除，执行停止')
      const sourceOnly = !edges.value.some(edge => edge.target === node.id) && !node.data?.prompt && (node.data?.url || node.data?.content)
      if (sourceOnly || node.type === 'group') continue
      if (node.data?.loading) throw new Error('组内已有节点正在生成，请稍后再执行')
      await runNodeAndWait(node.id)
      const current = nodes.value.find(item => item.id === node.id)
      if (!current || current.data?.error) throw new Error(current?.data?.error || '节点已移除')
      if (current.data?.loading) throw new Error('节点仍在生成，已停止下游执行')
      if (!current.data?.url && !current.data?.content && node.type !== 'render') throw new Error('节点未生成结果，请检查模型和提示词')
      await nextTick()
    }
    window.$message?.success('整组执行完成')
  } catch (error) { window.$message?.error(error.message) }
  finally { running.value = false }
}
const saveWorkflow = async () => {
  if (saving.value) return
  saving.value = true
  try {
    const group = nodes.value.find(node => node.id === props.id)
    const selected = [group, ...members()]
    const ids = new Set(selected.map(node => node.id))
    const snapshot = JSON.parse(JSON.stringify(selected))
    snapshot.forEach(node => {
      delete node.computedPosition; delete node.dimensions; delete node.handleBounds
      if (!node.parentNode) node.position = { x: 0, y: 0 }
      delete node.data.dragBounds; delete node.data.manualResizing
      node.data.loading = false; node.data.error = ''
    })
    const portableUrl = async url => {
        if (url && !url.startsWith('data:')) {
          const { bytes, contentType } = await fetchBytes(url)
          return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(new Blob([bytes], { type: contentType })) })
        }
        return url
    }
    for (const node of snapshot) {
      for (const key of ['url', 'base64']) {
        if (node.data?.[key]) node.data[key] = await portableUrl(node.data[key])
      }
      if (Array.isArray(node.data.galleryUrls)) node.data.galleryUrls = await Promise.all(node.data.galleryUrls.map(portableUrl))
    }
    await saveGroupWorkflow({ id: crypto.randomUUID(), name: props.data.label || '节点组工作流', nodes: snapshot, edges: JSON.parse(JSON.stringify(edges.value.filter(edge => ids.has(edge.source) && ids.has(edge.target)))) })
    window.$message?.success('已保存到「我的工作流」')
  } catch (error) { window.$message?.error(error.message || '保存工作流失败') }
  finally { saving.value = false }
}
let finishResize = null
const startResize = (event, side) => {
  if (event.button !== 0) return
  finishResize?.()
  const group = nodes.value.find(node => node.id === props.id)
  const origin = { ...group.position }, width = parseFloat(group.style.width), height = parseFloat(group.style.height)
  const positions = new Map(members().map(node => [node.id, { ...node.position }]))
  const zoom = viewport.value.zoom || 1, sx = event.clientX, sy = event.clientY
  startBatchOperation()
  updateNode(props.id, { manualResizing: true })
  const move = e => {
    const dx = (e.clientX - sx) / zoom, dy = (e.clientY - sy) / zoom
    const left = side === 'left' ? Math.min(dx, width - 100) : 0
    const top = side === 'top' ? Math.min(dy, height - 100) : 0
    const w = Math.max(100, width + (side === 'right' ? dx : -left))
    const h = Math.max(100, height + (side === 'bottom' ? dy : -top))
    nodes.value = nodes.value.map(node => node.id === props.id ? { ...node, position: { x: origin.x + left, y: origin.y + top }, style: { ...node.style, width: `${w}px`, height: `${h}px` }, data: { ...node.data, manualBounds: { x: 0, y: 0, width: w, height: h }, dragBounds: undefined } } : positions.has(node.id) ? { ...node, position: { x: positions.get(node.id).x - left, y: positions.get(node.id).y - top } } : node)
  }
  finishResize = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finishResize); window.removeEventListener('pointercancel', finishResize)
    updateNode(props.id, { manualResizing: false }); endBatchOperation(); finishResize = null
  }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finishResize); window.addEventListener('pointercancel', finishResize)
}
onBeforeUnmount(() => finishResize?.())

const isEditingLabel = ref(false)
const editingLabelValue = ref('')
const labelInputRef = ref(null)

const startEditLabel = () => {
  editingLabelValue.value = props.data?.label || '节点组'
  isEditingLabel.value = true
  nextTick(() => {
    labelInputRef.value?.focus()
    labelInputRef.value?.select()
  })
}

const finishEditLabel = () => {
  const newLabel = editingLabelValue.value.trim()
  if (newLabel && newLabel !== props.data?.label) updateNode(props.id, { label: newLabel })
  isEditingLabel.value = false
}

const cancelEditLabel = () => { isEditingLabel.value = false }

/**
 * 取消分组 = 删掉这个组节点。
 * store 的 removeNode 对组是特判过的：会把每个成员的位置加回组的偏移、摘掉
 * parentNode / extent / data.groupId，成员本身一个不删。
 */
const ungroup = () => {
  removeNode(props.id)
}
</script>

<style scoped>
.group-actions { position:absolute; bottom:calc(100% + 38px / var(--flow-zoom, 1)); left:50%; transform:translateX(-50%) scale(calc(1 / var(--flow-zoom, 1))); transform-origin:bottom center; display:flex; gap:6px; padding:5px; border:1px solid var(--border-color); border-radius:12px; background:var(--bg-secondary); pointer-events:auto; white-space:nowrap; z-index:10; }
.group-actions button { padding:6px 10px; border-radius:7px; color:var(--text-primary); font-size:12px; }
.group-actions select { background:var(--bg-secondary); color:var(--text-primary); font-size:12px; border-radius:7px; padding:6px; }
.group-actions button:hover { background:var(--bg-tertiary); }
.group-actions button:disabled { opacity:.5; }
.group-color-control { position:relative; }
.group-colors { position:absolute; top:100%; left:0; display:flex; flex-direction:column; padding:4px; border-radius:8px; background:var(--bg-secondary); border:1px solid var(--border-color); }
.group-color-control button { font-size:20px; line-height:20px; }
.group-resize { position:absolute; background:#4d86da; border-radius:2px; pointer-events:auto; z-index:8; }
.group-resize.left,.group-resize.right { width:calc(6px / var(--flow-zoom, 1)); height:calc(30px / var(--flow-zoom, 1)); top:50%; transform:translateY(-50%); cursor:ew-resize; }
.group-resize.left { left:0; } .group-resize.right { right:0; }
.group-resize.top,.group-resize.bottom { height:calc(6px / var(--flow-zoom, 1)); width:calc(30px / var(--flow-zoom, 1)); left:50%; transform:translateX(-50%); cursor:ns-resize; }
.group-resize.top { top:0; } .group-resize.bottom { bottom:0; }
</style>
