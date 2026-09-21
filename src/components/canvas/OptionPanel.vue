<template>
  <!-- 列表选择面板 | List picker popover
       模型、提示词预设共用。竖向列表而不是下拉：名字、说明、右侧角标都能一行看全，
       下拉里挤成一行的东西在这里才排得开。 -->
  <Teleport to="body">
    <div v-if="visible" class="option-layer" @click.self="emit('close')">
      <div ref="panelRef" class="option-panel" :style="panelStyle">
        <div v-if="searchable" class="option-search">
          <input v-model="query" type="text" :placeholder="searchPlaceholder" @keydown.esc.stop="emit('close')" />
        </div>

        <div class="option-list">
          <button v-if="clearLabel" class="option-row is-plain" type="button" @click="pick('')">
            {{ clearLabel }}
          </button>

          <template v-for="group in groupedFiltered" :key="group.key">
            <div v-if="group.label" class="option-group">{{ group.label }}</div>
            <button
              v-for="option in group.options"
              :key="option.value"
              class="option-row"
              :class="{ 'is-active': option.value === modelValue }"
              type="button"
              @click="pick(option.value)"
            >
              <span class="option-mark">{{ (option.label || '?').trim().slice(0, 1).toUpperCase() }}</span>
              <span class="option-copy">
                <b>{{ option.label }}</b>
                <span v-if="option.tips">{{ option.tips }}</span>
              </span>
            </button>
          </template>

          <div v-if="!filtered.length" class="option-empty">{{ emptyText }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 锚点：栏上那个按钮，面板贴着它弹出 */
  anchor: { type: Object, default: null },
  modelValue: { type: String, default: '' },
  /** [{ value, label, tips, badge }] */
  options: { type: Array, default: () => [] },
  /** 传了才出现筛选框 */
  searchPlaceholder: { type: String, default: '' },
  emptyText: { type: String, default: '没有可选项' },
  /** 传了就在顶部多一行"取消选择" */
  clearLabel: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'close'])

const panelRef = ref(null)
const query = ref('')
const position = ref({ left: 0, bottom: 0, maxHeight: 0 })

const searchable = computed(() => Boolean(props.searchPlaceholder) && props.options.length > 8)

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return props.options
  return props.options.filter(option => `${option.label} ${option.group} ${option.tips}`
    .toLowerCase().includes(keyword))
})
const groupedFiltered = computed(() => {
  const groups = new Map()
  filtered.value.forEach(option => {
    const key = option.sourceProvider || option.group || ''
    if (!groups.has(key)) groups.set(key, { key, label: option.group || '', options: [] })
    groups.get(key).options.push(option)
  })
  return [...groups.values()]
})

/** 贴在锚点上方；右边越界就收回来；高度按锚点上方真正剩多少空间给，不够就内部滚动 */
const place = () => {
  const rect = props.anchor?.getBoundingClientRect?.()
  if (!rect) return
  const width = panelRef.value?.offsetWidth || 340
  position.value = {
    left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12),
    bottom: window.innerHeight - rect.top + 10,
    maxHeight: Math.max(200, rect.top - 24)
  }
}

const panelStyle = computed(() => ({
  left: `${position.value.left}px`,
  bottom: `${position.value.bottom}px`,
  maxHeight: `${position.value.maxHeight}px`
}))

const pick = (value) => {
  emit('update:modelValue', value)
  emit('close')
}

const onKeydown = (event) => { if (event.key === 'Escape' && props.visible) emit('close') }

watch(() => props.visible, (open) => {
  if (!open) { query.value = ''; return }
  nextTick(place)
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', place)
})
</script>

<style scoped>
.option-layer {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: transparent;
}

.option-panel {
  position: fixed;
  display: flex;
  width: 342px;
  flex-direction: column;
  overflow: hidden;
  padding: 7px;
  border: 1px solid var(--border-color, #e3e5e8);
  border-radius: 18px;
  background: var(--bg-secondary, #fff);
  box-shadow: 0 20px 55px rgba(19, 23, 30, 0.18);
}

.option-search { padding: 4px 4px 7px; }
.option-search input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  outline: none;
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-primary, #1e293b);
  font-family: inherit;
  font-size: 13.5px;
}

.option-list { min-height: 0; overflow: auto; }
.option-group { padding: 12px 11px 5px; color: var(--text-tertiary, #94a3b8); font-size: 11px; font-weight: 700; letter-spacing: .025em; }
.option-group:first-child { padding-top: 5px; }

.option-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 11px;
  padding: 10px 11px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background-color 0.13s ease;
}
.option-row:hover { background: var(--bg-tertiary, #f1f5f9); }
.option-row.is-active { background: var(--bg-tertiary, #f1f5f9); }
.option-row.is-plain {
  height: 38px;
  margin-bottom: 2px;
  color: var(--text-tertiary, #94a3b8);
  font-size: 12.5px;
}

.option-mark {
  display: grid;
  width: 33px;
  height: 33px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-secondary, #64748b);
  font-size: 14px;
  font-weight: 700;
}
.option-row.is-active .option-mark { background: var(--text-primary, #1e293b); color: var(--bg-secondary, #fff); }

.option-copy { min-width: 0; flex: 1 1 auto; }
.option-copy b {
  display: block;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-copy span {
  display: block;
  overflow: hidden;
  margin-top: 3px;
  color: var(--text-tertiary, #94a3b8);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-badge {
  flex: 0 0 auto;
  padding: 4px 9px;
  border-radius: 8px;
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-tertiary, #94a3b8);
  font-size: 11px;
}

.option-empty { padding: 20px; color: var(--text-tertiary, #94a3b8); font-size: 12.5px; text-align: center; }
</style>
