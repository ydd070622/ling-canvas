<template>
  <!-- 生成参数面板 | Generation parameters popover
       底部栏里那串参数（清晰度 / 比例 / 张数 / 清晰度·时长）收进这一个弹出面板，
       分区摆开、点选即可。栏上只留一句摘要，眼睛不用再在一排下拉里找。 -->
  <Teleport to="body">
    <div v-if="visible" class="param-layer" @click.self="emit('close')">
      <div ref="panelRef" class="param-panel" :style="panelStyle">
        <section v-if="resolutionOptions.length" class="param-section">
          <h4>清晰度</h4>
          <div class="param-grid">
            <button
              v-for="option in resolutionOptions"
              :key="option"
              class="param-btn"
              :class="{ 'is-active': option === resolution }"
              type="button"
              @click="emit('update:resolution', option)"
            >{{ option }}</button>
          </div>
          <p v-if="resolutionHint" class="param-note">{{ resolutionHint }}</p>
        </section>

        <section v-if="videoPresetOptions.length" class="param-section">
          <h4>清晰度 · 时长</h4>
          <div class="param-grid">
            <button
              v-for="option in videoPresetOptions"
              :key="option.value"
              class="param-btn"
              :class="{ 'is-active': option.value === videoPreset }"
              type="button"
              @click="emit('update:videoPreset', option.value)"
            >{{ option.label }}</button>
          </div>
        </section>

        <section v-if="ratioOptions.length" class="param-section">
          <h4>比例</h4>
          <div class="param-grid is-ratio">
            <button
              v-for="option in ratioOptions"
              :key="option"
              class="param-btn is-ratio"
              :class="{ 'is-active': option === ratio }"
              type="button"
              :title="option === 'auto' ? '自适应' : option"
              @click="emit('update:ratio', option)"
            >
              <span class="ratio-glyph" :class="{ 'is-auto': option === 'auto' }" :style="glyphStyle(option)"></span>
              <span>{{ option === 'auto' ? '自适应' : option }}</span>
            </button>
          </div>
        </section>

        <section v-if="countOptions.length" class="param-section">
          <h4>生成数量</h4>
          <div class="param-grid is-count">
            <button
              v-for="option in countOptions"
              :key="option"
              class="param-btn"
              :class="{ 'is-active': option === count }"
              type="button"
              @click="emit('update:count', option)"
            >{{ option }} 张</button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ratioValue } from '../../utils/ratio'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 锚点：栏上那个「参数」按钮，面板贴着它弹出 */
  anchor: { type: Object, default: null },
  resolution: { type: String, default: '' },
  resolutionOptions: { type: Array, default: () => [] },
  /** 档位被渠道锁死时的说明（空串 = 可自由切换） */
  resolutionHint: { type: String, default: '' },
  ratio: { type: String, default: 'auto' },
  ratioOptions: { type: Array, default: () => [] },
  count: { type: Number, default: 1 },
  countOptions: { type: Array, default: () => [] },
  videoPreset: { type: String, default: '' },
  videoPresetOptions: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:resolution', 'update:ratio', 'update:count', 'update:videoPreset', 'close'])

const panelRef = ref(null)
const position = ref({ left: 0, bottom: 0, maxHeight: 0 })

/** 贴在锚点上方；右边越界就收回来；高度按锚点上方真正剩多少空间给，不够就内部滚动 */
const place = () => {
  const rect = props.anchor?.getBoundingClientRect?.()
  if (!rect) return
  const width = panelRef.value?.offsetWidth || 330
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
  position.value = {
    left,
    bottom: window.innerHeight - rect.top + 10,
    maxHeight: Math.max(180, rect.top - 24)
  }
}

const panelStyle = computed(() => ({
  left: `${position.value.left}px`,
  bottom: `${position.value.bottom}px`,
  maxHeight: `${position.value.maxHeight}px`
}))

/** 比例按钮里的小方块：按真实宽高比画出来，一眼能看出横竖 */
const glyphStyle = (option) => {
  if (option === 'auto') return null
  const value = ratioValue(option)
  const MAX = 15
  const width = value >= 1 ? MAX : MAX * value
  const height = value >= 1 ? MAX / value : MAX
  return { width: `${Math.max(5, width).toFixed(1)}px`, height: `${Math.max(5, height).toFixed(1)}px` }
}

const onKeydown = (event) => { if (event.key === 'Escape' && props.visible) emit('close') }

watch(() => props.visible, (open) => {
  if (!open) return
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
.param-layer {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: transparent;
}

.param-panel {
  position: fixed;
  width: 372px;
  max-height: 70vh;
  overflow: auto;
  padding: 17px;
  border: 1px solid var(--border-color, #e3e5e8);
  border-radius: 18px;
  background: var(--bg-secondary, #fff);
  box-shadow: 0 20px 55px rgba(19, 23, 30, 0.18);
}

.param-section + .param-section { margin-top: 19px; }
.param-section h4 {
  margin: 0 0 10px;
  color: var(--text-tertiary, #94a3b8);
  font-size: 12.5px;
  font-weight: 500;
}

.param-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }

/* 档位被渠道锁死时的说明 —— 不写这句，三档突然变一档只会像界面坏了 */
.param-note {
  margin: 9px 0 0;
  color: var(--text-tertiary, #94a3b8);
  font-size: 11.5px;
  line-height: 1.5;
}
.param-grid.is-ratio { grid-template-columns: repeat(5, 1fr); }
.param-grid.is-count { grid-template-columns: repeat(3, 1fr); }

.param-btn {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 7px;
  border: 0;
  border-radius: 10px;
  background: var(--bg-tertiary, #f1f5f9);
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  font-size: 13px;
  box-shadow: inset 0 0 0 1px transparent;
  transition: color 0.13s ease, background-color 0.13s ease, box-shadow 0.13s ease;
}
.param-btn:hover { color: var(--text-primary, #1e293b); }

/* 选中态：描一圈实线 —— 和参考面板一样，一眼看出选了哪个 */
.param-btn.is-active {
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #1e293b);
  font-weight: 650;
  box-shadow: inset 0 0 0 1.5px var(--text-primary, #1e293b), 0 1px 3px rgba(0, 0, 0, 0.06);
}

.param-btn.is-ratio { flex-direction: column; min-height: 56px; gap: 5px; font-size: 11.5px; }
.param-btn.is-ratio.is-active { font-weight: 650; }

.ratio-glyph {
  display: block;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  opacity: 0.7;
}
.ratio-glyph.is-auto { width: 13px; height: 10px; border-style: dashed; }
</style>
