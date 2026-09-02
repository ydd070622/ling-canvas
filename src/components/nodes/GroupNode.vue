<template>
  <div class="group-node">
    <span
      v-if="!isEditingLabel"
      class="group-node__title"
      title="双击编辑名称"
      @dblclick="startEditLabel"
    >{{ data.label || '节点组' }}</span>
    <input
      v-else
      ref="labelInputRef"
      v-model="editingLabelValue"
      class="group-node__title group-node__title-input"
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

// Label editing state | 标题编辑状态
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
  if (newLabel && newLabel !== props.data?.label) {
    updateNode(props.id, { label: newLabel })
  }
  isEditingLabel.value = false
}

const cancelEditLabel = () => {
  isEditingLabel.value = false
}
</script>

<style scoped>
.group-node {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px dashed var(--accent-color);
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent-color) 5%, transparent);
  pointer-events: none;
}

.group-node__title {
  position: absolute;
  top: -28px;
  left: 0;
  padding: 2px 6px;
  border-radius: 5px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  /* Re-enable pointer events so the title can be double-clicked to rename | 仅标题可交互，主体保持穿透不影响内部节点拖拽 */
  pointer-events: auto;
  cursor: text;
  user-select: none;
}

.group-node__title:hover {
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.group-node__title-input {
  min-width: 120px;
  width: 160px;
  border: 1px solid var(--accent-color);
  outline: none;
  background: var(--bg-secondary, #fff);
  color: var(--text-secondary);
  font-size: 12px;
  user-select: text;
  cursor: text;
}
</style>
