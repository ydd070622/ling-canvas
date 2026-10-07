<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { NModal, NSelect, NButton, NSwitch } from 'naive-ui'
import { projects, updateProjectCanvas } from '../../stores/projects'
import { localFolders, loadLocalFolders, connectLocalFolder, localCall, saveImagesToFolder } from '../../stores/localSpace'
const props = defineProps({ projectId: String })
const output = computed(() => projects.value.find(p => p.id === props.projectId)?.canvasData?.localOutput || {})
const show = ref(false), mode = ref('output'), folderId = ref(''), relative = ref(''), dirs = ref([]), busy = ref(false), images = ref([]), label = ref('图片'), scope = ref('all')
const options = computed(() => localFolders.value.map(f => ({ label: f.name, value: f.id })))
let listingSequence = 0
watch([folderId, relative], async () => { const seq = ++listingSequence; dirs.value = []; if (!folderId.value) return; try { const list = await localCall('list_local_folder', { id: folderId.value, relative: relative.value }); if (seq === listingSequence) dirs.value = list.filter(e => e.isDir) } catch(e) { if (seq === listingSequence) window.$message?.error(e.message) } })
async function open(kind, detail = {}) {
 mode.value = kind; images.value = detail.urls || []; label.value = detail.label || '图片'; scope.value = 'all'
 try { await loadLocalFolders(); folderId.value = output.value.id || localFolders.value[0]?.id || ''; relative.value = output.value.relative || ''; show.value = true } catch(e) { window.$message?.error(e.message) }
}
const saveEvent = e => open('save', e.detail)
onMounted(() => { window.addEventListener('ling-save-local', saveEvent); loadLocalFolders().catch(() => {}) })
onBeforeUnmount(() => window.removeEventListener('ling-save-local', saveEvent))
function setAuto(value) { if (!output.value.id) return open('output'); updateProjectCanvas(props.projectId, { localOutput: { ...output.value, auto: value } }) }
async function confirm() {
 if (!folderId.value) return
 busy.value = true
 try {
   const destination = { id: folderId.value, relative: relative.value }
   if (mode.value === 'output') { updateProjectCanvas(props.projectId, { localOutput: { ...destination, auto: output.value.auto || false } }); show.value = false; window.$message?.success('已设置画布输出文件夹') }
   else { const urls = scope.value === 'main' ? images.value.slice(0, 1) : images.value; const result = await saveImagesToFolder(urls, destination, label.value); if (result.failures.length) { images.value = result.failures.map(f => f.url); window.$message?.error(`已保存${result.paths.length}张，${result.failures.length}张失败：${result.failures[0].error}，可以重试`) } else { show.value = false; window.$message?.success(`已保存 ${result.paths.length} 张原图`) } }
 } finally { busy.value = false }
}
async function connect() { try { const f = await connectLocalFolder(); if(f) { folderId.value = f.id; relative.value = '' } } catch(e) { window.$message?.error(e.message) } }
</script>
<template>
 <div class="canvas-local-output"><button @click="open('output')" :title="localFolders.find(f => f.id === output.id)?.path || '设置生成图片的保存位置'">输出：{{ localFolders.find(f => f.id === output.id)?.name || (output.id ? '目录不可用' : '未设置') }}{{ output.relative ? ' / ' + output.relative : '' }}</button><label><n-switch size="small" :value="!!output.auto" :disabled="!output.id" @update:value="setAuto" /><span>自动保存</span></label></div>
 <n-modal v-model:show="show" preset="card" :title="mode === 'save' ? '保存到本地空间' : '画布输出文件夹'" style="width:420px;max-width:calc(100vw - 32px)">
  <label class="output-label">本地文件夹</label><n-select :value="folderId" :options="options" placeholder="选择已连接文件夹" :disabled="busy" @update:value="value => { folderId = value; relative = '' }" /><n-button text style="margin-top:10px" :disabled="busy" @click="connect">＋ 连接本地文件夹</n-button>
  <label class="output-label">保存位置</label><div class="output-path">{{ relative || '根目录' }} <n-button v-if="relative" text :disabled="busy" @click="relative = relative.split('/').slice(0,-1).join('/')">返回上级</n-button></div><n-select :value="null" :options="dirs.map(d => ({ label:d.name, value:d.relativePath }))" placeholder="进入子文件夹（可选）" :disabled="busy" @update:value="value => relative = value" />
  <template v-if="mode === 'save' && images.length > 1"><label class="output-label">保存图片</label><n-select v-model:value="scope" :disabled="busy" :options="[{label:'当前主图',value:'main'},{label:`全部 ${images.length} 张`,value:'all'}]" /></template>
  <n-button type="primary" block style="margin-top:22px" :loading="busy" :disabled="!folderId" @click="confirm">{{ mode === 'save' ? '保存原图' : '设为输出文件夹' }}</n-button>
 </n-modal>
</template>
<style scoped>.canvas-local-output{display:flex;align-items:center;gap:12px;color:var(--text-secondary);font-size:12px}.canvas-local-output>button{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.canvas-local-output label{display:flex;align-items:center;gap:6px}.output-label{display:block;margin:16px 0 8px;font-size:12px;color:var(--text-secondary)}.output-path{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;overflow-wrap:anywhere}</style>
