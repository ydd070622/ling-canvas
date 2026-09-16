<template>
  <!-- 节点组：纯容器，不参与数据流（没有端口） -->
  <div class="flow-group-node">
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
  </div>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { updateNode } from '../../stores/canvas'

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
</script>
