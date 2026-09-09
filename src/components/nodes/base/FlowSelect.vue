<template>
  <!-- 自定义药丸下拉 | Custom pill dropdown -->
  <span
    ref="pillRef"
    class="flow-pill flow-select-pill"
    :class="{ 'fs-open': open }"
    role="button"
    tabindex="0"
    @mousedown.stop="toggle"
    @click.stop
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <span v-if="dot" class="pd-dot" :class="dot"></span>
    <span class="pd-ic" v-if="showIcon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></svg>
    </span>
    <span class="fs-label">{{ display }}</span>
    <span class="chev" :class="{ 'chev-up': open }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </span>

    <Teleport to="body">
      <div
        v-if="open"
        class="flow-select-menu"
        :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px`, minWidth: `${menuPos.width}px` }"
        @mousedown.stop
        @click.stop
      >
        <template v-if="groupedOptions.length">
          <template v-for="(group, gi) in groupedOptions" :key="group.label || `g${gi}`">
            <div v-if="group.label" class="flow-select-group">{{ group.label }}</div>
            <button
              v-for="opt in group.options"
              :key="optValue(opt)"
              class="flow-select-item"
              :class="{ active: optValue(opt) === modelValue }"
              @click.stop="select(opt)"
            >
              {{ optLabel(opt) }}
            </button>
          </template>
        </template>
        <div v-else class="flow-select-empty">暂无选项</div>
      </div>
    </Teleport>
  </span>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'

const props = defineProps({
  /** [{ value, label }] 或 ['a','b'] */
  options: { type: Array, default: () => [] },
  modelValue: { type: [String, Number], default: '' },
  /** 当前展示文本（不回显 modelValue） */
  display: { type: String, default: '' },
  /** 左侧色点：orange / blue / purple */
  dot: { type: String, default: '' },
  /** 高级滑杆图标 */
  showIcon: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const menuPos = ref({ top: 0, left: 0, width: 120 })
const pillRef = ref(null)

const optValue = (opt) => (opt && typeof opt === 'object' ? opt.value : opt)
const optLabel = (opt) => (opt && typeof opt === 'object' ? opt.label : opt)

/** 按 group 字段分组（保持原顺序），无 group 的归入无名组 */
const groupedOptions = computed(() => {
  const groups = []
  const indexMap = new Map()
  props.options.forEach(opt => {
    const group = opt && typeof opt === 'object' ? opt.group : ''
    const key = String(group || '')
    if (!indexMap.has(key)) {
      indexMap.set(key, groups.length)
      groups.push({ label: group || '', options: [] })
    }
    groups[indexMap.get(key)].options.push(opt)
  })
  return groups
})

const positionMenu = () => {
  const el = pillRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  menuPos.value = { top: r.bottom + 6, left: r.left, width: Math.max(r.width, 160) }
}

const toggle = () => {
  if (open.value) {
    close()
  } else {
    openedAt = Date.now()
    positionMenu()
    open.value = true
  }
}

const select = (opt) => {
  const value = optValue(opt)
  emit('update:modelValue', value)
  emit('change', value)
  close()
}

const close = () => { open.value = false }

// 画布平移/缩放时自动关闭，避免菜单与节点分离 | Close on canvas viewport change
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
  const menu = document.querySelector('.flow-select-menu')
  if (menu && menu.contains(e.target)) return
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
watch(() => props.options, () => { if (open.value) positionMenu() })

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('keydown', onKey)
  // VueUse EventHook returns a subscription object ({ off }), not always a
  // bare unsubscribe function. Support both shapes across Vue Flow versions.
  if (typeof offViewport === 'function') offViewport()
  else offViewport?.off?.()
})
</script>

<style>
.flow-select-pill { position: relative; flex: 0 1 auto; transition: border-color 0.15s ease; }
.flow-select-pill.fs-open { border-color: var(--flow-accent); }
.fs-label { overflow: hidden; text-overflow: ellipsis; }
.chev { transition: transform 0.15s ease; }
.chev-up { transform: rotate(180deg); }

.flow-select-menu {
  position: fixed;
  z-index: 9999;
  max-height: 240px;
  overflow-y: auto;
  padding: 5px;
  background: var(--flow-card-bg);
  border: 1px solid var(--flow-card-border);
  border-radius: 12px;
  box-shadow: 0 12px 30px rgba(20, 30, 45, 0.16);
}

.flow-select-item {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--flow-text-strong);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.flow-select-item .fs-item-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-select-group {
  padding: 6px 10px 3px;
  color: var(--flow-text-mid);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.03em;
}

.flow-select-item:hover { background: var(--flow-body-bg); }
.flow-select-item.active { color: var(--flow-accent-deep); font-weight: 650; }

.flow-select-empty { padding: 10px; color: var(--flow-text-mid); font-size: 12px; text-align: center; }
</style>
