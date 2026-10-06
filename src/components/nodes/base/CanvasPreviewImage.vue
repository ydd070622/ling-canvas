<template>
  <img :src="displayUrl || undefined" decoding="async" @load="loaded" />
</template>
<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { canvasPreview } from '../../../utils/canvasPreview'
const props = defineProps({ src: { type: String, default: '' } })
const emit = defineEmits(['dimensions'])
const displayUrl = ref('')
let sequence = 0, objectUrl = '', originalSize = null
const release = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = '' }
watch(() => props.src, async url => {
  const current = ++sequence
  if (!url) { release(); displayUrl.value = ''; originalSize = null; return }
  const preview = await canvasPreview(url)
  if (current !== sequence) return
  release(); originalSize = null
  if (preview) {
    originalSize = { width: preview.width, height: preview.height }
    objectUrl = URL.createObjectURL(preview.blob)
    displayUrl.value = objectUrl
  } else displayUrl.value = url
}, { immediate: true })
const loaded = event => emit('dimensions', originalSize || { width: event.target.naturalWidth, height: event.target.naturalHeight })
onBeforeUnmount(() => { sequence++; release() })
</script>
