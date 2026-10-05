<template>
  <Teleport to="body">
    <div v-if="visible" class="preset-overlay" @click.self="emit('close')" @keydown.esc="emit('close')">
      <section class="preset-dialog" role="dialog" aria-modal="true" aria-label="自定义提示词预设">
        <header><div><strong>提示词预设</strong><small>{{ subtitle }} · 自定义</small></div><button type="button" title="关闭" @click="emit('close')">×</button></header>
        <form class="custom-editor" @submit.prevent="saveCustom">
          <div class="editor-heading"><strong>{{ editingId ? '编辑预设' : '新建预设' }}</strong><div class="editor-heading-actions"><button v-if="editingId" type="button" class="quiet-button" @click="resetDraft">取消编辑</button><button type="submit" class="save-button" :disabled="coverBusy || !draftTitle.trim() || !draftPrompt.trim()">{{ editingId ? '保存修改' : '保存预设' }}</button></div></div>
          <div class="editor-fields">
            <div class="cover-editor"><button type="button" class="cover-upload" :disabled="coverBusy" @click="coverInput.click()"><img v-if="draftCover" :src="draftCover" alt="封面预览" /><span v-else>＋<small>添加封面</small></span><span v-if="draftCover" class="cover-change">更换封面</span></button><button v-if="draftCover" type="button" class="cover-remove" title="移除封面" aria-label="移除封面" @click="draftCover = ''">×</button></div>
            <div class="text-fields"><input v-model="draftTitle" aria-label="预设名称" placeholder="预设名称" maxlength="80" /><textarea v-model="draftPrompt" aria-label="完整提示词" placeholder="输入完整提示词，可随时编辑修改…" /></div>
          </div>
          <input ref="coverInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="uploadCover" />
          <div v-if="error || coverBusy" class="editor-footer"><span class="editor-error" role="status">{{ error || '正在处理封面…' }}</span></div>
        </form>
        <div class="preset-grid">
          <article v-for="item in customPresets" :key="item.id" class="preset-card" :class="{ 'is-active': selectedId === item.id }">
            <button type="button" class="preset-pick" :aria-label="'使用预设：' + item.title" @click="emit('select', item)"><div class="preset-cover" :style="{ background: item.cover }"><img v-if="item.coverImage" :src="item.coverImage" alt="" /><span v-else>✎</span></div></button>
            <div class="preset-card-footer"><button type="button" class="preset-title" :title="item.title" @click="emit('select', item)">{{ item.title }}</button><div class="card-actions"><button type="button" @click="editCustom(item)">编辑</button><button type="button" class="delete-button" @click="removeCustom(item.id)">删除</button></div></div>
          </article>
        </div>
        <div v-if="!customPresets.length" class="preset-empty">还没有自定义预设，在上方保存第一条提示词</div>
      </section>
    </div>
  </Teleport>
</template>
<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ visible: { type: Boolean, default: false }, selectedId: { type: String, default: '' }, subtitle: { type: String, default: '' } })
const emit = defineEmits(['select', 'update', 'close'])
const STORAGE_CUSTOM = 'ling-canvas-image-prompt-presets'
const readCustom = () => { try { const value = JSON.parse(localStorage.getItem(STORAGE_CUSTOM) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
const customPresets = ref(readCustom())
const draftTitle = ref(''), draftPrompt = ref(''), draftCover = ref(''), editingId = ref(''), error = ref(''), coverBusy = ref(false), coverInput = ref(null)
let coverRequest = 0
const resetDraft = () => { coverRequest++; draftTitle.value = ''; draftPrompt.value = ''; draftCover.value = ''; editingId.value = ''; error.value = ''; coverBusy.value = false }
const persistCustom = (items) => { try { localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(items)); customPresets.value = items; return true } catch { error.value = '保存失败，本地存储空间不足。请移除封面或删除不需要的预设后重试。'; return false } }
const saveCustom = () => {
  if (coverBusy.value || !draftTitle.value.trim() || !draftPrompt.value.trim()) return
  const previous = customPresets.value.find(item => item.id === editingId.value)
  const text = draftPrompt.value.trim()
  const item = { ...previous, id: editingId.value || 'custom-' + crypto.randomUUID(), title: draftTitle.value.trim(), description: '', icon: '✎', cover: previous?.cover || 'linear-gradient(135deg,#33343a,#737783)', coverImage: draftCover.value, prompt: text, text, source: 'custom' }
  const items = editingId.value ? customPresets.value.map(existing => existing.id === editingId.value ? item : existing) : [item, ...customPresets.value]
  if (!persistCustom(items)) return
  if (props.selectedId === item.id) emit('update', item)
  resetDraft()
}
const editCustom = (item) => { resetDraft(); editingId.value = item.id; draftTitle.value = item.title; draftPrompt.value = item.prompt || item.text || ''; draftCover.value = item.coverImage || '' }
const removeCustom = (id) => { if (!persistCustom(customPresets.value.filter(item => item.id !== id))) return; if (editingId.value === id) resetDraft(); if (props.selectedId === id) emit('update', null) }
const uploadCover = async (event) => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { error.value = '请选择 PNG、JPG 或 WebP 图片'; return }
  if (file.size > 20 * 1024 * 1024) { error.value = '封面图片请小于 20 MB'; return }
  const request = ++coverRequest; coverBusy.value = true; error.value = ''
  const url = URL.createObjectURL(file)
  try {
    const image = new Image(); image.src = url; await image.decode()
    const scale = Math.min(1, 640 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#242427'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (request === coverRequest) draftCover.value = canvas.toDataURL('image/jpeg', .82)
  } catch { if (request === coverRequest) error.value = '无法读取这张图片，请更换封面' } finally { URL.revokeObjectURL(url); if (request === coverRequest) coverBusy.value = false }
}
watch(() => props.visible, (open) => { resetDraft(); if (open) customPresets.value = readCustom() })
</script>
<style scoped>
/* 深色画廊：封面是深色渐变，放在浅色底上会显得脏 */
.preset-overlay {
  position: fixed;
  inset: 0;
  z-index: 10030;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: rgba(5, 5, 6, 0.74);
  backdrop-filter: blur(6px);
}

.preset-dialog {
  display: flex;
  width: min(980px, 92vw);
  height: min(760px, 90vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3a3a3d;
  border-radius: 16px;
  background: #1d1d1f;
  color: #eeeef0;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.55);
}

.preset-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 14px; }
.preset-dialog header div { display: flex; align-items: baseline; gap: 10px; }
.preset-dialog header strong { font-size: 16px; }
.preset-dialog header small { color: #77777e; }
.preset-dialog header button { border: 0; background: transparent; color: #8d8d93; cursor: pointer; font-size: 26px; }
.preset-dialog header button:hover { color: #fff; }

.preset-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  overflow-y: auto;
  padding: 0 20px 24px;
}

.preset-card {
  position: relative;
  overflow: hidden;
  border: 1px solid #38383c;
  border-radius: 10px;
  background: #222225;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.preset-card:hover { transform: translateY(-2px); border-color: #626269; }
/* 当前生效的那张：描一圈亮边，一眼看出现在用的是哪个 */
.preset-card.is-active { border-color: #d7d9de; box-shadow: 0 0 0 1px #d7d9de inset; }

.preset-cover {
  position: relative;
  display: flex;
  height: 112px;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.84);
  font-size: 34px;
}

.preset-meta { display: flex; flex-direction: column; gap: 4px; padding: 11px 12px 13px; }
.preset-meta strong { font-size: 13px; }
.preset-meta small { overflow: hidden; color: #898990; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

.preset-empty { display: flex; flex: 1; align-items: center; justify-content: center; color: #777; font-size: 13px; }

@media (max-width: 760px) {
  .preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>

<style scoped>
.custom-editor{margin:0 20px 20px;padding:16px;border:1px solid #38383c;border-radius:12px;background:#222225}.editor-heading,.editor-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.editor-heading{margin-bottom:12px;font-size:13px}.editor-heading-actions{display:flex;align-items:center;gap:14px}.editor-fields{--cover-size:144px;display:grid;grid-template-columns:var(--cover-size) minmax(0,1fr);gap:14px;align-items:start}.cover-editor{position:relative;width:var(--cover-size);height:var(--cover-size)}.cover-remove{position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;border-radius:5px;background:#0009;color:#eee;font-size:16px;cursor:pointer}.cover-upload{position:relative;display:grid;place-items:center;width:100%;height:100%;aspect-ratio:1;padding:0;overflow:hidden;border:1px dashed #56565f;border-radius:8px;background:#29292e;color:#a5a5ad;cursor:pointer}.cover-upload span{font-size:24px}.cover-upload small{display:block;font-size:12px;margin-top:5px}.cover-upload img,.preset-cover img{width:100%;height:100%;object-fit:cover}.cover-upload .cover-change{position:absolute;bottom:0;left:0;right:0;background:#0008;color:#fff;font-size:11px;padding:5px}.text-fields{display:grid;grid-template-rows:40px minmax(0,1fr);gap:8px;height:var(--cover-size)}.text-fields input,.text-fields textarea{width:100%;min-width:0;border:1px solid #3c3c40;border-radius:8px;padding:9px 11px;background:#242427;color:#eee;font:inherit;outline:none}.text-fields input:focus,.text-fields textarea:focus{border-color:#7c8da9}.text-fields textarea{height:100%;min-height:0;resize:none;line-height:1.5}.quiet-button{border:0;background:none;color:#a7a7af;cursor:pointer;font-size:12px;padding:6px 0}.editor-footer{margin-top:12px}.editor-error{font-size:12px;color:#dca291}.save-button{padding:9px 16px;border:0;border-radius:8px;background:var(--flow-accent-deep,#397cf0);color:#fff;cursor:pointer;white-space:nowrap}.save-button:disabled{opacity:.4;cursor:not-allowed}.preset-grid{min-height:0}.preset-pick{display:block;width:100%;padding:0;border:0;background:none;color:inherit;text-align:left;cursor:pointer}.preset-meta strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preset-card-footer{display:flex;align-items:center;gap:8px;padding:10px 12px}.preset-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:none;color:inherit;text-align:left;font:inherit;font-size:13px;font-weight:600;cursor:pointer}.card-actions{display:flex;flex-shrink:0;gap:8px}.card-actions button{border:0;background:none;color:#acb8cf;font:inherit;font-size:12px;cursor:pointer;padding:3px}.card-actions .delete-button{color:#97979f}.card-actions .delete-button:hover{color:#f87171}.preset-empty{padding:20px}.custom-editor{flex-shrink:0}@media(max-width:760px){.editor-fields{--cover-size:120px;gap:10px}.custom-editor{padding:12px}}@media(max-height:650px){.preset-dialog{overflow-y:auto}.preset-grid{overflow:visible;flex-shrink:0}}
</style>
