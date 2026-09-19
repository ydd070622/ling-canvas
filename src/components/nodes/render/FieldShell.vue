<template>
  <!-- 表单字段外壳 | Field shell
       就是把「标签 + 提示 + 控件」这套重复了十几遍的排版收成一个组件。 -->
  <label class="flow-render-field">
    <span class="flow-render-label">
      <span class="flow-render-label-text">{{ label }}</span>
      <small v-if="hint">{{ hint }}</small>
    </span>
    <slot />
  </label>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' }
})
</script>
