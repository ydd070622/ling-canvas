<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { localFolders, loadLocalFolders, localCall } from '../../stores/localSpace'
import { useUIStore } from '../../stores/ui'
import { createProject, activeProjects, updateProjectCanvas } from '../../stores/projects'
import { NModal, NButton } from 'naive-ui'
import { FolderOutline } from '@vicons/ionicons5'
import LocalImageThumb from './LocalImageThumb.vue'
import { usePreviewImageSizing } from '../../composables/usePreviewImageSizing'
import { sortLocalFiles } from '../../utils/localFileSort'
import { saveImage } from '../../stores/imageStore'
const ui = useUIStore(), router = useRouter(), entries = ref([]), relative = ref(''), error = ref(''), busy = ref(false), selected = ref([]), previews = ref({})
const viewer = ref(false), text = ref(''), textName = ref(''), textError = ref(''), textBusy = ref(false)
const sortKey = computed(() => 'ling-local-sort-level:' + relative.value.split('/').filter(Boolean).length)
const sortSettings = ref({})
const sortOrder = computed({
  get() { if(sortSettings.value[sortKey.value]) return sortSettings.value[sortKey.value]; try { const saved = localStorage.getItem(sortKey.value); return ['name-asc','name-desc','time-asc','time-desc'].includes(saved) ? saved : 'name-asc' } catch { return 'name-asc' } },
  set(value) { sortSettings.value[sortKey.value] = value; try { localStorage.setItem(sortKey.value, value) } catch {} }
})
const cacheVersion = ref(0)
const { previewSize, previewImageRef, onPreviewImageLoad, resetPreviewSize } = usePreviewImageSizing()
const previewModalStyle = computed(() => ({ width: previewSize.value ? `${previewSize.value.width + 20}px` : '380px', maxWidth: '94vw' }))
function reload() { cacheVersion.value = Date.now(); refresh() }
const sortedEntries = computed(() => sortLocalFiles(entries.value, sortOrder.value))
const images = computed(() => sortedEntries.value.filter(e => !e.isDir && e.kind !== 'text'))
const imageViewer = ref(false), imageEntry = ref(null), imageUrl = ref(''), imageError = ref(''), imageBusy = ref(false)
const imageIndex = computed(() => images.value.findIndex(e => e.relativePath === imageEntry.value?.relativePath))
let imageEpoch = 0
let textEpoch = 0
let epoch = 0
const folder = () => localFolders.value.find(f => f.id === ui.currentFolder)
async function refresh() {
  const seq = ++epoch; imageViewer.value = false; imageEpoch++; busy.value = true; error.value = ''; entries.value = []; previews.value = {}; selected.value = []
  try {
    if (!localFolders.value.length) await loadLocalFolders()
    const id = ui.currentFolder, path = relative.value
    const items = await localCall('list_local_folder', { id, relative: path })
    if (seq !== epoch) return
    entries.value = items
  } catch (e) { if (seq === epoch) error.value = e.message } finally { if (seq === epoch) busy.value = false }
}
watch(() => ui.currentFolder, () => { relative.value = ''; viewer.value = false; textEpoch++; refresh() }, { immediate: true })
function open(entry) { if (entry.isDir) { relative.value = entry.relativePath; refresh() } else if (entry.kind === 'text') { viewText(entry) } else viewImage(entry) }
function toggleSelected(entry) { selected.value = selected.value.includes(entry.relativePath) ? selected.value.filter(p => p !== entry.relativePath) : [...selected.value, entry.relativePath] }
const originalCache = new Map()
function loadOriginal(entry) {
  const key = `${ui.currentFolder}:${entry.relativePath}:${entry.modifiedAt}:${entry.byteLength}`
  if(originalCache.has(key)) return originalCache.get(key)
  const task = localCall('read_local_image', { id: ui.currentFolder, relative: entry.relativePath }).then(async url => {
    const image = new Image(); image.src = url
    await image.decode()
    return url
  })
  originalCache.set(key, task)
  task.catch(() => originalCache.delete(key))
  if(originalCache.size > 3) originalCache.delete(originalCache.keys().next().value)
  return task
}
async function viewImage(entry) {
  const seq = ++imageEpoch
  if(!imageViewer.value) { resetPreviewSize(); imageUrl.value = ''; imageEntry.value = entry }
  imageViewer.value = true; imageError.value = ''; imageBusy.value = true
  try {
    const url = await loadOriginal(entry)
    if(seq !== imageEpoch || !imageViewer.value) return
    imageUrl.value = url; imageEntry.value = entry
    const index = images.value.findIndex(e => e.relativePath === entry.relativePath)
    for(const neighbor of [images.value[index - 1], images.value[index + 1]]) if(neighbor) loadOriginal(neighbor).catch(() => {})
  }
  catch(e) { if(seq === imageEpoch) imageError.value = e.message }
  finally { if(seq === imageEpoch) imageBusy.value = false }
}
function stepImage(delta) { if(imageBusy.value) return; const entry = images.value[imageIndex.value + delta]; if(entry) viewImage(entry) }
function imageKey(event) { if(!imageViewer.value || event.altKey || event.ctrlKey || event.metaKey) return; if(event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); stepImage(-1) } else if(event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); stepImage(1) } }
watch(imageViewer, visible => {
  if(visible) window.addEventListener('keydown', imageKey, true)
  else { window.removeEventListener('keydown', imageKey, true); imageEpoch++; imageUrl.value = '' }
}, { flush: 'sync' })
async function viewText(entry) {
  const seq = ++textEpoch
  viewer.value = true; textName.value = entry.name; text.value = ''; textError.value = ''; textBusy.value = true
  try { const content = await localCall('read_local_text', { id: ui.currentFolder, relative: entry.relativePath }); if(seq === textEpoch) text.value = content }
  catch(e) { if(seq === textEpoch) textError.value = e.message }
  finally { if(seq === textEpoch) textBusy.value = false }
}
async function copyText() { try { await navigator.clipboard.writeText(text.value); window.$message?.success('已复制') } catch { window.$message?.error('复制失败') } }
function back() { relative.value = relative.value.split('/').slice(0, -1).join('/'); refresh() }
const openExplorer = () => localCall('open_local_folder', { id: ui.currentFolder, relative: relative.value }).catch(e => window.$message?.error(e.message))
async function addToCanvas(projectId) {
  try {
    const urls = await Promise.all(selected.value.map(path => localCall('read_local_image', { id: ui.currentFolder, relative: path })))
    const id = projectId || createProject(folder()?.name || '本地图片')
    const project = activeProjects.value.find(p => p.id === id), old = project.canvasData?.nodes || []
    const stamp = Date.now()
    const nodes = urls.map((url, i) => ({ id: `local-${stamp}-${i}`, type: 'image', position: { x: 100 + i % 3 * 340, y: 100 + Math.floor(i / 3) * 400 }, data: { label: selected.value[i].split('/').at(-1), url, base64: url } }))
    for (const node of nodes) await saveImage(`${id}:${node.id}`, node.data.url)
    updateProjectCanvas(id, { nodes: [...old, ...nodes] }, [...old, ...nodes]); router.push(`/canvas/${id}`)
  } catch(e) { window.$message?.error(e.message) }
}
onBeforeUnmount(() => { epoch++; textEpoch++; imageEpoch++; originalCache.clear(); window.removeEventListener('keydown', imageKey, true) })
</script>
<template>
 <section class="local-folder-view">
  <div class="local-tools"><div class="local-breadcrumb"><button v-if="relative" @click="back">← 返回</button><span>{{ relative ? relative.split('/').join(' / ') : '全部文件' }}</span></div><select v-model="sortOrder" aria-label="文件排序"><option value="name-asc">名称 ↑</option><option value="name-desc">名称 ↓</option><option value="time-asc">时间 ↑</option><option value="time-desc">时间 ↓</option></select><button @click="reload">刷新</button><button :title="folder()?.path" @click="openExplorer">打开文件夹</button><button v-if="selected.length" @click="addToCanvas()">加入新画布 · {{ selected.length }}张</button><select v-if="selected.length" aria-label="加入已有画布" @change="addToCanvas($event.target.value)"><option value="" disabled selected>加入已有画布</option><option v-for="p in activeProjects" :key="p.id" :value="p.id">{{ p.name }}</option></select></div>
  <p v-if="error" role="alert">{{ error }} <button @click="refresh">重试</button></p><p v-else-if="!entries.length" class="local-empty">{{ busy ? '正在读取…' : '暂无文件' }}</p>
  <div class="local-files"><div role="button" tabindex="0" @keydown.enter.self.prevent="open(entry)" @keydown.space.self.prevent="open(entry)" v-for="entry in sortedEntries" :key="entry.relativePath" class="local-file" :class="{ selected: selected.includes(entry.relativePath) }" :title="entry.name"  @click="open(entry)"><div v-if="entry.kind === 'text'" class="text-cover"><span>{{ entry.name.split('.').at(-1).toUpperCase() }}</span><i></i><i></i><i></i><i></i></div><LocalImageThumb v-else :key="ui.currentFolder + entry.relativePath + entry.modifiedAt + cacheVersion" :folder-id="ui.currentFolder" :relative="entry.relativePath" :name="entry.name" :folder="entry.isDir" :modified-at="entry.modifiedAt" :byte-length="entry.byteLength" :cache-version="cacheVersion" /><input v-if="!entry.isDir && entry.kind !== 'text'" type="checkbox" class="image-select" :checked="selected.includes(entry.relativePath)" :aria-label="`选择 ${entry.name}`" @click.stop @change="toggleSelected(entry)"><div class="local-file-name" :class="{ compact: !entry.isDir }"><FolderOutline v-if="entry.isDir" /><span>{{ entry.name }}</span></div></div></div>
  <NModal v-model:show="imageViewer" preset="card" class="local-image-modal" :header-style="{ padding: '10px 12px', fontSize: '14px' }" :content-style="{ padding: '0 10px 10px' }" :title="imageEntry?.name" :style="previewModalStyle" :bordered="false"><div class="image-preview"><img v-if="imageUrl" ref="previewImageRef" @load="onPreviewImageLoad" :src="imageUrl" :alt="imageEntry?.name" /><p v-else>{{ imageError || '正在读取…' }}</p></div><p v-if="imageError && imageUrl" role="alert">{{ imageError }}</p><div class="image-preview-tools"><NButton :disabled="imageBusy || imageIndex <= 0" size="small" @click="stepImage(-1)">上一张</NButton><span>{{ imageIndex + 1 }} / {{ images.length }}</span><NButton :disabled="imageBusy || imageIndex >= images.length - 1" size="small" @click="stepImage(1)">下一张</NButton></div></NModal>
  <NModal v-model:show="viewer" preset="card" class="local-text-modal" :header-style="{ padding: '10px 16px', fontSize: '14px' }" :content-style="{ padding: '0 16px 16px' }" :style="{ width: '840px', maxWidth: 'calc(100vw - 48px)' }">
   <template #header><div class="text-preview-heading"><span class="text-preview-name" :title="textName">{{ textName }}</span><span class="text-preview-format">{{ textName.split('.').at(-1).toUpperCase() }}</span></div></template>
   <template #header-extra><NButton size="small" :disabled="textBusy || !!textError" @click="copyText">复制全文</NButton></template>
   <p v-if="textBusy">正在读取…</p><p v-else-if="textError" role="alert">{{ textError }}</p><pre v-else class="text-content">{{ text }}</pre>
  </NModal>
 </section>
</template>
<style scoped>
.local-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px}.local-breadcrumb{display:flex;align-items:center;gap:12px;flex:1;min-width:120px;color:var(--text-secondary);font-size:13px;overflow-wrap:anywhere}.local-tools button,.local-tools select{padding:7px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary)}button:disabled{opacity:.45}.local-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:22px 18px}.local-file{position:relative;padding:0;overflow:hidden;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-secondary);color:var(--text-primary);text-align:left;cursor:pointer;transition:box-shadow .18s,border-color .18s}.local-file:hover{border-color:var(--text-secondary);box-shadow:0 4px 15px #0000000d}.local-file.selected{outline:2px solid var(--accent-color,#4489f7)}.local-file-name{display:flex;align-items:flex-start;gap:6px;padding:11px 10px;height:58px;box-sizing:border-box}.local-file-name svg{flex-shrink:0;width:16px;height:16px;color:var(--text-secondary)}.local-file-name span{font-size:12px;line-height:18px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.text-cover{aspect-ratio:3/4;box-sizing:border-box;padding:28px 22px;background:var(--bg-tertiary);display:flex;flex-direction:column;gap:13px;color:var(--text-secondary)}.text-cover span{font-size:23px;font-weight:600;margin-bottom:18px;letter-spacing:.05em}.text-cover i{height:3px;background:currentColor;opacity:.15;border-radius:2px}.text-cover i:last-child{width:60%}.local-empty{padding:60px 0;text-align:center;color:var(--text-secondary)}.text-preview-heading{display:flex;align-items:center;gap:8px;min-width:0}.text-preview-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.text-preview-format{flex-shrink:0;padding:2px 6px;border-radius:4px;background:var(--bg-tertiary);color:var(--text-secondary);font-size:10px;line-height:16px;font-weight:400}.local-text-modal :deep(.n-card-header__main){min-width:0}.local-text-modal :deep(.n-card-header__extra){margin-left:12px}.local-text-modal :deep(.n-card-header__close){margin-left:12px}.text-content{white-space:pre-wrap;overflow-wrap:anywhere;max-height:65vh;overflow:auto;font:14px/1.85 ui-monospace,Consolas,monospace;margin:0;padding:16px;border-radius:8px;background:var(--bg-tertiary)}
.local-file-name.compact{height:36px;padding:8px 10px;align-items:center}.local-file-name.compact span{-webkit-line-clamp:1}.image-select{position:absolute;bottom:44px;right:8px;margin:0;width:18px;height:18px;cursor:pointer;accent-color:#4489f7;opacity:0;transition:opacity .15s}.local-file:hover .image-select,.local-file:focus-within .image-select,.local-file.selected .image-select{opacity:1}.image-preview{display:flex;align-items:center;justify-content:center;border-radius:8px;overflow:hidden}.image-preview img{display:block;width:100%;height:auto;border-radius:8px}.image-preview-tools{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:8px;color:var(--text-secondary);font-size:13px}@media(hover:none){.image-select{opacity:1}}
</style>
