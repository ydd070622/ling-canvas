<template>
  <!-- 节点组：纯容器，不参与数据流（没有端口）
       分组框本身不吃鼠标事件 —— 组内部要留给框选和双击建节点。可点的只有框外
       那一小条标题栏（在 top:-26px，不覆盖组内区域）。 -->
  <div class="flow-group-node">
    <div class="flow-group-bar">
      <span
        v-if="!isEditingLabel"
        class="flow-group-title"
        title="双击编辑名称"
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
import { nextTick, ref } from 'vue'
import { updateNode, removeNode } from '../../stores/canvas'

const props = defineProps({
  id: String,
  data: {
    type: Object,
    default: () => ({})
  }
})

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
