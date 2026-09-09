<template>
  <!-- 比例选择药丸 + 弹出面板（自适应竖条 + 常见比例网格） -->
  <span
    ref="pillRef"
    class="flow-pill flow-select-pill ratio-picker"
    :class="{ 'fs-open': open }"
    role="button"
    tabindex="0"
    @mousedown.stop="toggle"
    @click.stop
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <span class="fs-label">{{ display }}</span>
    <span class="chev" :class="{ 'chev-up': open }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </span>

    <Teleport to="body">
      <div
        v-if="open"
        class="ratio-panel"
        :style="{ top: `${panelPos.top}px`, left: `${panelPos.left}px` }"
        @mousedown.stop
        @click.stop
      >
        <!-- 左侧：自适应 -->
        <button
          class="ratio-auto"
          :class="{ active: modelValue === 'auto' }"
          @click.stop="select('auto')"
        >
          <span class="ratio-auto-thumb"></span>
          <span>自适应</span>
        </button>
        <!-- 右侧：常见比例网格 -->
        <div class="ratio-grid">
          <button
            v-for="ratio in COMMON_RATIOS"
            :key="ratio"
            class="ratio-item"
            :class="{ active: modelValue === ratio }"
            @click.stop="select(ratio)"
          >
            <span class="ratio-thumb" :style="thumbStyle(ratio)"></span>
            <span class="ratio-label">{{ ratio }}</span>
          </button>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { COMMON_RATIOS, ratioValue } from '../../../utils/ratio'

const props = defineProps({
  modelValue: { type: String, default: 'auto' },
  display: { type: String, default: '自适应' }
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const panelPos = ref({ top: 0, left: 0 })
const pillRef = ref(null)

/** 缩略矩形：宽固定 22px，高按比例（竖图更高） */
const thumbStyle = (ratio) => {
  const v = ratioValue(ratio)
  const w = 22
  const h = Math.max(10, Math.min(34, Math.round(w / v)))
  return { width: `${w}px`, height: `${h}px` }
}

const positionPanel = () => {
  const el = pillRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  panelPos.value = { top: r.bottom + 8, left: r.left }
}

const toggle = () => {
  if (open.value) {
    close()
  } else {
    openedAt = Date.now()
    positionPanel()
    open.value = true
  }
}

const select = (ratio) => {
  emit('update:modelValue', ratio)
  emit('change', ratio)
  close()
}

const close = () => { open.value = false }

// 画布平移/缩放时自动关闭，避免面板与节点分离 | Close on canvas viewport change
// 打开瞬间 300ms 内的 viewport 初始化抖动不误关（fitView/初始化阶段）
let openedAt = 0
let offViewport = null
try {
  const { onViewportChange } = useVueFlow()
  offViewport = onViewportChange?.(() => {
    if (open.value && Date.now() - openedAt > 300) close()
  })
} catch { /* 非画布环境忽略 */ }

const onDocClick = (e) => {
  if (!open.value) return
  if (pillRef.value && pillRef.value.contains(e.target)) return
  const panel = document.querySelector('.ratio-panel')
  if (panel && panel.contains(e.target)) return
  close()
}
const onKey = (e) => { if (e.key === 'Escape') close() }

watch(open, (v) => {
  if (v) {
    window.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
  } else {
    window.removeEventListener('mousedown', onDocClick)
    window.removeEventListener('keydown', onKey)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('keydown', onKey)
  if (typeof offViewport === 'function') offViewport()
  else offViewport?.off?.()
})
</script>

<style>
/* 面板：白卡圆角浮层，两栏布局 */
.ratio-panel {
  position: fixed;
  z-index: 9999;
  display: flex;
  gap: 10px;
  padding: 12px;
  background: var(--flow-card-bg);
  border: 1px solid var(--flow-card-border);
  border-radius: 14px;
  box-shadow: 0 14px 34px rgba(20, 30, 45, 0.18);
}

/* 左侧：自适应竖条 */
.ratio-auto {
  display: flex;
  width: 56px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid var(--flow-pill-border);
  border-radius: 10px;
  background: var(--flow-bg-secondary, #f4f5f7);
  color: var(--flow-pill-text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.ratio-auto:hover,
.ratio-auto.active {
  border-color: var(--flow-accent);
  background: var(--flow-accent-soft);
  color: var(--flow-accent-deep);
}

.ratio-auto-thumb {
  width: 26px;
  height: 26px;
  border: 1.6px solid currentColor;
  border-radius: 5px;
  opacity: 0.75;
}

.ratio-auto span {
  writing-mode: vertical-rl;
  letter-spacing: 0.12em;
  font-weight: 600;
}

/* 右侧：比例网格 4 列 */
.ratio-grid {
  display: grid;
  grid-template-columns: repeat(4, 64px);
  gap: 6px;
}

.ratio-item {
  display: flex;
  height: 58px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--flow-pill-text);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.ratio-item:hover {
  background: var(--flow-body-bg);
}

.ratio-item.active {
  border-color: var(--flow-accent);
  background: var(--flow-accent-soft);
  color: var(--flow-accent-deep);
}

.ratio-thumb {
  display: inline-block;
  border: 1.6px solid currentColor;
  border-radius: 4px;
  opacity: 0.8;
}

.ratio-label {
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}
</style>
