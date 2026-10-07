<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { localThumbnail } from '../../utils/localThumbCache'
const props = defineProps({ folderId: String, relative: String, name: String, folder: Boolean, modifiedAt: Number, byteLength: Number, cacheVersion: Number })
const element = ref(null), url = ref(''), failed = ref(false)
let observer, stopped = false, objectUrl = ''
onMounted(() => {
 observer = new IntersectionObserver(async entries => {
  if (!entries.some(e => e.isIntersecting)) return
  observer.disconnect()
  try { const blob = await localThumbnail(props); if(stopped) return; if(!blob) { failed.value = true; return } objectUrl = URL.createObjectURL(blob); url.value = objectUrl } catch { if(!stopped) failed.value = true }
 }, { rootMargin: '120px' }); observer.observe(element.value)
})
onBeforeUnmount(() => { stopped = true; observer?.disconnect(); if(objectUrl) URL.revokeObjectURL(objectUrl) })
</script>
<template><div ref="element" class="local-thumb"><img v-if="url" :src="url" :alt="name"><span v-else>{{ folder ? '文件夹' : failed ? '图片不可用' : '图片' }}</span></div></template>
<style scoped>.local-thumb{aspect-ratio:3/4;display:grid;place-items:center;color:var(--text-secondary);background:var(--bg-tertiary);overflow:hidden}img{width:100%;height:100%;object-fit:cover;display:block}</style>
