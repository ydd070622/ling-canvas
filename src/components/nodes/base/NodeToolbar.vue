<template>
  <!-- 药丸悬浮工具栏 | Pill-shaped floating toolbar -->
  <div class="flow-toolbar nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop>
    <slot />
  </div>
</template>

<script setup>
/**
 * NodeToolbar - 节点上方药丸悬浮工具栏容器
 * 按钮内容由使用方经默认插槽传入，用 .flow-tb-group / .flow-tb-sep 分组
 */
defineProps({
  title: { type: String, default: '' }
})
</script>
