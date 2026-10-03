<template>
  <Teleport to="body">
    <div v-if="show" class="image-edit-backdrop" @keydown.esc.stop="close" tabindex="0" ref="dialog" role="dialog" aria-modal="true" :aria-label="mode === 'crop' ? '图片裁切' : '图片抠图'" @pointerdown.self="close">
      <section class="image-edit-dialog" @keydown.stop @keydown.esc="close">
        <header><strong>{{ mode === 'crop' ? '裁切图片' : '抠图 · 圈选保留区域' }}</strong><button @click="close" :disabled="busy" aria-label="关闭">×</button></header>
        <p>{{ mode === 'crop' ? '拖动边角调整范围，拖动框内移动选区。' : '沿物体边缘点击添加轮廓点，闭合区域会被保留，其余背景透明。' }}</p>
        <div v-if="loading" class="image-edit-loading">正在读取原图…</div>
        <div v-else-if="error" class="image-edit-error">{{ error }}</div>
        <div v-else class="image-edit-stage" ref="stage" :style="{ aspectRatio: `${width} / ${height}` }" @pointerdown.prevent="beginDrag">
          <img :src="displayUrl" draggable="false" alt="待编辑图片" />
          <template v-if="mode === 'crop'">
            <div class="image-crop-box" data-handle="move" :style="cropStyle">
              <i v-for="handle in handles" :key="handle" :data-handle="handle" :class="`crop-handle ${handle}`"></i>
              <span>{{ cropPixels.width }} × {{ cropPixels.height }}</span>
            </div>
          </template>
          <svg v-else viewBox="0 0 1 1" preserveAspectRatio="none" class="image-cutout-path">
            <polygon v-if="points.length >= 3" :points="points.map(p => `${p.x},${p.y}`).join(' ')" />
            <polyline :points="points.map(p => `${p.x},${p.y}`).join(' ')" />
          </svg>
          <button v-for="(point, index) in mode === 'cutout' ? points : []" :key="index" class="cutout-point" :data-point="index" :style="{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }" :aria-label="`轮廓点 ${index + 1}`"></button>
        </div>
        <footer>
          <select v-if="mode === 'crop'" v-model.number="ratio" @change="applyRatio" aria-label="裁切比例"><option :value="0">自由比例</option><option :value="1">1:1</option><option :value="3/4">3:4</option><option :value="4/3">4:3</option><option :value="9/16">9:16</option><option :value="16/9">16:9</option></select>
          <button v-else :disabled="!points.length || busy" @click="points = points.slice(0,-1)">撤销点</button>
          <button :disabled="busy || loading" @click="reset">重置</button>
          <span class="image-edit-note">保留原图，创建新节点</span>
          <button class="image-edit-confirm" :disabled="busy || loading || !!error || (mode === 'cutout' && points.length < 3)" @click="confirm">{{ busy ? '处理中…' : '确认' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { fetchBytes } from '../../utils/downloadMedia'
import { normalizedRect, pixelCrop, fitCropRatio } from '../../utils/imageEditGeometry'
const props = defineProps({ show: Boolean, url: String, mode: { type: String, default: 'crop' } })
const emit = defineEmits(['update:show', 'complete'])
const stage = ref(null), dialog = ref(null), loading = ref(false), busy = ref(false), error = ref('')
const displayUrl = ref(''), width = ref(1), height = ref(1), ratio = ref(0)
const rect = ref({ x: 0, y: 0, width: 1, height: 1 }), points = ref([])
const handles = ['nw','n','ne','e','se','s','sw','w']
let bitmap = null, controller = null, loadVersion = 0
const cropPixels = computed(() => pixelCrop(rect.value, width.value, height.value))
const cropStyle = computed(() => ({ left: `${rect.value.x*100}%`, top: `${rect.value.y*100}%`, width: `${rect.value.width*100}%`, height: `${rect.value.height*100}%` }))
const reset = () => { rect.value = { x: 0, y: 0, width: 1, height: 1 }; points.value = []; ratio.value = 0 }
const release = () => { controller?.abort(); bitmap?.close(); bitmap = null; if (displayUrl.value) URL.revokeObjectURL(displayUrl.value); displayUrl.value = '' }
watch(() => [props.show, props.url, props.mode], async () => {
  const version = ++loadVersion
  release(); reset(); error.value = ''
  if (!props.show) return
  loading.value = true
  try {
    const { bytes, contentType } = await fetchBytes(props.url)
    const blob = new Blob([bytes], { type: contentType || 'image/png' })
    const decoded = await createImageBitmap(blob)
    if (version !== loadVersion) { decoded.close(); return }
    bitmap = decoded; width.value = decoded.width; height.value = decoded.height
    displayUrl.value = URL.createObjectURL(blob)
  } catch (err) { if (version === loadVersion) error.value = `读取失败：${err.message}` }
  finally { if (version === loadVersion) { loading.value = false; await nextTick(); dialog.value?.focus() } }
}, { immediate: true })
const close = () => { if (!busy.value) emit('update:show', false) }
const applyRatio = () => { rect.value = fitCropRatio(rect.value, ratio.value, width.value, height.value) }
const pointAt = event => {
  const bounds = stage.value.getBoundingClientRect()
  return { x: Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)), y: Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height)) }
}
const beginDrag = event => {
  if (busy.value || !bitmap || event.button !== 0) return
  const point = pointAt(event)
  if (props.mode === 'cutout' && event.target.dataset.point === undefined) { points.value = [...points.value,point]; return }
  const initial = { ...rect.value }, handle = event.target.dataset.handle || 'new', pointIndex = Number(event.target.dataset.point)
  controller?.abort(); controller = new AbortController()
  window.addEventListener('pointermove', move => {
    const next = pointAt(move)
    if (props.mode === 'cutout') { points.value = points.value.map((p,i) => i === pointIndex ? next : p); return }
    if (handle === 'move') {
      rect.value = { ...initial, x: Math.max(0,Math.min(1-initial.width,initial.x+next.x-point.x)), y: Math.max(0,Math.min(1-initial.height,initial.y+next.y-point.y)) }; return
    }
    const a = { x: initial.x,y:initial.y }, b = { x: initial.x+initial.width,y:initial.y+initial.height }
    if (handle === 'new') { Object.assign(a,point); Object.assign(b,next) }
    else { if(handle.includes('w')) a.x=next.x; if(handle.includes('e')) b.x=next.x; if(handle.includes('n')) a.y=next.y; if(handle.includes('s')) b.y=next.y }
    const result = fitCropRatio(normalizedRect(a,b),ratio.value,width.value,height.value)
    if (result.width*width.value >= 2 && result.height*height.value >= 2) rect.value = result
  }, { signal: controller.signal })
  const stop = () => controller?.abort()
  window.addEventListener('pointerup',stop,{ once:true,signal:controller.signal })
  window.addEventListener('pointercancel',stop,{ once:true,signal:controller.signal })
}
const confirm = async () => {
  if (!bitmap || busy.value) return
  busy.value = true
  try {
    const crop = props.mode === 'crop' ? cropPixels.value : { x:0,y:0,width:width.value,height:height.value }
    const canvas = document.createElement('canvas'); canvas.width=crop.width; canvas.height=crop.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建图片画布')
    if (props.mode === 'cutout') {
      ctx.beginPath(); points.value.forEach((p,i) => i ? ctx.lineTo(p.x*width.value,p.y*height.value) : ctx.moveTo(p.x*width.value,p.y*height.value)); ctx.closePath(); ctx.clip()
    }
    ctx.drawImage(bitmap,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height)
    const dataUrl = canvas.toDataURL('image/png')
    emit('complete',{ dataUrl,width:crop.width,height:crop.height,mode:props.mode })
    emit('update:show',false)
  } catch (err) { error.value = `处理失败：${err.message}` }
  finally { busy.value=false }
}
onBeforeUnmount(() => { ++loadVersion; release() })
</script>

<style scoped>
.image-edit-backdrop { position:fixed; inset:0; z-index:10000; background:#000a; display:flex; align-items:center; justify-content:center; padding:24px; outline:none; }
.image-edit-dialog { width:min(880px,95vw); max-height:94vh; overflow:auto; padding:18px; background:var(--bg-secondary,#fff); color:var(--text-primary,#20242b); border:1px solid var(--border-color,#ddd); border-radius:18px; box-shadow:0 20px 80px #0005; }
header,footer { display:flex; align-items:center; gap:10px; } header { justify-content:space-between; } p { font-size:12px; color:var(--text-secondary,#778); margin:10px 0 16px; }
button,select { background:var(--bg-tertiary,#eee); color:inherit; border:1px solid var(--border-color,#ddd); padding:7px 12px; border-radius:8px; cursor:pointer; } button:disabled { opacity:.4; cursor:default; }
.image-edit-stage { position:relative; margin:0 auto; width:min(100%,calc(62vh * v-bind('width / height'))); max-height:62vh; overflow:hidden; user-select:none; touch-action:none; background:repeating-conic-gradient(#bbb 0% 25%,#eee 0% 50%) 0 / 16px 16px; }
.image-edit-stage img { width:100%;height:100%;display:block;pointer-events:none; }
.image-crop-box { position:absolute; border:1px solid white; box-shadow:0 0 0 2000px #0008; cursor:move; }
.image-crop-box span { position:absolute; bottom:10px;left:10px;background:#0009;color:white;border-radius:6px;padding:4px 8px;font-size:12px;pointer-events:none;white-space:nowrap; }
.crop-handle { position:absolute;width:12px;height:12px;background:white;border:1px solid #333;border-radius:2px;transform:translate(-50%,-50%); }
.nw{left:0;top:0;cursor:nwse-resize}.n{left:50%;top:0;cursor:ns-resize}.ne{left:100%;top:0;cursor:nesw-resize}.e{left:100%;top:50%;cursor:ew-resize}.se{left:100%;top:100%;cursor:nwse-resize}.s{left:50%;top:100%;cursor:ns-resize}.sw{left:0;top:100%;cursor:nesw-resize}.w{left:0;top:50%;cursor:ew-resize}
.image-cutout-path { position:absolute;inset:0;width:100%;height:100%;pointer-events:none; }.image-cutout-path polygon{fill:#fff3}.image-cutout-path polyline{fill:none;stroke:white;stroke-width:2;vector-effect:non-scaling-stroke}.cutout-point{position:absolute;width:10px;height:10px;padding:0;border-radius:50%;background:white;border:1px solid #333;transform:translate(-50%,-50%);cursor:move;}
footer{margin-top:16px;flex-wrap:wrap;font-size:12px}.image-edit-note{flex:1;color:var(--text-secondary,#778)}.image-edit-confirm{background:var(--text-primary,#20242b);color:var(--bg-secondary,#fff)}.image-edit-error{padding:30px;color:#d66}.image-edit-loading{padding:50px;text-align:center}
</style>
