<template>
  <!-- 音频节点：承载型，只存上传的音频，不接生成（后端没有 TTS 能力）。
       波形是真实峰值：解码出 PCM 后按桶取最大振幅。解不出来时退回装饰性柱条。 -->
  <NodeFrame
    :node-id="id"
    tone="audio"
    :title="data.label || '音频'"
    :focused="focused"
    :multi="multi"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    uploadable
    viewable
    media-kind="audio"
    :media-url="data.url || ''"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @view="openPreview"
    @upload="triggerFileInput"
    @drop-file="handleDroppedFile"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <div class="flow-audio" :class="{ 'is-empty': !data.url }">
        <div v-if="!data.url" class="flow-media-empty" @click="triggerFileInput">
          <span v-html="emptyIcon"></span>
            <div class="flow-media-empty-row">
            <button class="flow-media-empty-btn nodrag" type="button" @click.stop="triggerFileInput">
              <span v-html="uploadIcon"></span>上传音频
            </button>
          </div>
        </div>

        <template v-else>
          <div class="flow-wave" :class="{ 'is-compact': !focused }" @click="togglePlay">
            <i
              v-for="(peak, index) in bars"
              :key="index"
              :style="{ height: `${Math.max(6, Math.round(peak * 64))}px` }"
              :class="{ 'is-past': playedRatio > index / bars.length }"
            ></i>
          </div>
          <div v-if="focused" class="flow-audio-controls">
            <button class="flow-audio-play nodrag" type="button" :title="playing ? '暂停' : '播放'" @click="togglePlay">
              <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3.4" height="12" rx="1" /><rect x="13.6" y="6" width="3.4" height="12" rx="1" /></svg>
            </button>
            <span class="flow-audio-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
            <button class="flow-audio-open nodrag" type="button" title="全屏查看" @click="openPreview">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H3v-6M15 3h6v6M21 3l-7 7M3 21l7-7" /></svg>
            </button>
          </div>
        </template>
      </div>
      <audio ref="audioRef" :src="data.url || undefined" preload="metadata" @timeupdate="onTimeUpdate" @loadedmetadata="onLoadedMetadata" @ended="playing = false" />
    </template>
  </NodeFrame>

  <input ref="fileInputRef" type="file" accept="audio/*" style="display: none" @change="handleFileSelect" />
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NodeFrame } from './base'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { openMediaViewer } from '../../composables/useMediaViewer'
import {
  updateNode, editField, editNode, setNodeMedia, dropOrphanRefs,
  duplicateNode, removeNode
} from '../../stores/canvas'
import { makeToken, refKey } from '../../utils/promptRefs'
import { buildNodeNotices } from '../../utils/nodeNotices'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { refs, candidates, inboundCount } = useNodeRefs(props.id)

const focused = useFocusExpanded(props.id)
const multi = useMultiSelected(props.id)

const fileInputRef = ref(null)
const audioRef = ref(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const peaks = ref(null)


const emptyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>'
const uploadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>'

const BAR_COUNT = 34

/** 解不出波形时的兜底：按 url 生成一串稳定的柱高，至少不是一片空白 */
const fallbackPeaks = (seed) => {
  let hash = 0
  const source = String(seed || '')
  for (let i = 0; i < source.length; i += 1) hash = (hash * 31 + source.charCodeAt(i)) & 0xffff
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const n = Math.sin(hash + index * 12.9898) * 43758.5453
    return 0.22 + Math.abs(n - Math.floor(n)) * 0.7
  })
}

/**
 * 真实峰值：解码 PCM，按桶取最大振幅。
 * data: / blob: 都能 fetch；跨域或解码失败就退回兜底柱条，不打断渲染。
 */
const analyzePeaks = async (url) => {
  try {
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    const ctx = new AudioCtx()
    const decoded = await ctx.decodeAudioData(buffer)
    const channel = decoded.getChannelData(0)
    const step = Math.max(1, Math.floor(channel.length / BAR_COUNT))
    const out = []
    for (let i = 0; i < BAR_COUNT; i += 1) {
      let max = 0
      for (let j = 0; j < step; j += 1) {
        const value = Math.abs(channel[i * step + j] || 0)
        if (value > max) max = value
      }
      out.push(max)
    }
    const peak = Math.max(...out) || 1
    ctx.close?.()
    return out.map(value => value / peak)
  } catch {
    return null
  }
}

const bars = computed(() => peaks.value || fallbackPeaks(props.data?.url || 'audio'))

watch(() => props.data?.url, async (url) => {
  peaks.value = null
  if (!url) return
  const analyzed = await analyzePeaks(url)
  // 分析期间用户可能又换了一张，回来时确认还是同一个 url
  if (props.data?.url === url) peaks.value = analyzed
}, { immediate: true })

const playedRatio = computed(() => (duration.value ? currentTime.value / duration.value : 0))

/* ------------------------------------------------------------ 状态与提示 */
const statusText = computed(() => {
  if (props.data?.error) return '失败'
  return props.data?.url ? '已就绪' : '待上传'
})
const statusClass = computed(() => {
  if (props.data?.error) return 'is-fail'
  return props.data?.url ? 'is-ok' : ''
})

const notices = computed(() => buildNodeNotices(props.data))

/* ------------------------------------------------------------------ 播放 */

const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
const onTimeUpdate = (event) => { currentTime.value = event.target.currentTime }
const onLoadedMetadata = (event) => {
  duration.value = event.target.duration || 0
  if (!props.data?.duration) updateNode(props.id, { duration: Math.round(duration.value) })
}
const togglePlay = () => {
  const el = audioRef.value
  if (!el) return
  if (playing.value) { el.pause(); playing.value = false; return }
  el.play().then(() => { playing.value = true }).catch(() => window.$message?.warning('无法播放这段音频'))
}

const openPreview = () => openMediaViewer({ url: props.data.url, kind: 'audio', alt: props.data.label })

/* ------------------------------------------------------------------ 提示条 */
// 音频不生成，"插入引用"对它没有意义（没有可写引用的地方），所以不留这个动作
const handleNoticeAction = (act) => {
  if (act === 'drop-orphans') dropOrphanRefs(props.id)
}

/* ------------------------------------------------------------------ 上传 */
const triggerFileInput = () => fileInputRef.value?.click()
const handleFileSelect = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) handleDroppedFile(file)
}
const handleDroppedFile = (file) => {
  if (!file.type.startsWith('audio/')) {
    window.$message?.warning('音频节点只能放音频文件')
    return
  }
  const reader = new FileReader()
  reader.onload = (event) => {
    setNodeMedia(props.id, {
      url: event.target.result,
      base64: event.target.result,
      fileName: file.name.replace(/\.[^.]+$/, '')
    })
  }
  reader.onerror = () => window.$message?.error('音频读取失败')
  reader.readAsDataURL(file)
}

const duplicateAndRefresh = () => { duplicateNode(props.id) }
const remove = () => { removeNode(props.id)}
</script>
