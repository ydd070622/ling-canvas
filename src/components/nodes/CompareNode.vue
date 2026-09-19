<template>
  <!-- 图片对比节点 | Image compare node

       两张图进、一个滑块 —— 卡片本身就是那个对比视图：它不生成、也不产出，
       所以右侧没有输出口（`:has-output="false"`）。「结果」就是这张卡片。

       前后身份 = **入边先后**（`edge.data.order`），和 render 的「视角」同一套口径：
       先连上来的那张是「前」、后连上来的那张是「后」。连反了不用剪线重连 ——
       底部有一颗「交换前后」，这个判断记在 `data.swap` 上，重载后还在。

       滑块位置**不落盘**：它回答的是"我现在想看哪一侧"，明天打开该回到中间。
       两件事分开存，免得下次打开时滑块停在一个谁也看不懂的位置。

       原型：public/prototypes/image-compare/index.html -->
  <NodeFrame
    :node-id="id"
    tone="compare"
    :title="data.label || '图片对比'"
    :focused="focused"
    :multi="multi"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :card-width="cardWidth"
    :has-output="false"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
  >
    <template #body>
      <div ref="boxRef" class="flow-compare" :class="`is-${state}`" :style="boxStyle">
        <!-- 两张都到齐：后图当底、前图盖在上面按滑块裁切 -->
        <template v-if="state === 'ready'">
          <img class="flow-compare-img" :src="after.url" alt="" @load="measure">
          <div class="flow-compare-over">
            <img class="flow-compare-img" :src="before.url" alt="" @load="measure">
          </div>
          <span class="flow-compare-pill is-before" title="前 · 先连上来的那张">前 · {{ before.name }}</span>
          <span class="flow-compare-pill is-after" title="后 · 后连上来的那张">后 · {{ after.name }}</span>

          <!-- 分隔线与手柄合成一个 ~36px 的竖条当抓取区，只有这一条带 nodrag：
               按在图上别处仍然是拖节点。 -->
          <div
            class="flow-compare-grip nodrag"
            role="slider"
            tabindex="0"
            aria-label="前后对比滑块"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(split)"
            @pointerdown="startDrag"
            @keydown="onKeydown"
          >
            <span class="flow-compare-line"></span>
            <span class="flow-compare-handle">‹›</span>
          </div>
        </template>

        <!-- 只连了一张：那张铺满，右半边等着第二张 -->
        <template v-else-if="state === 'half'">
          <img class="flow-compare-img" :src="lone.url" alt="" @load="measure">
          <span class="flow-compare-pill" :class="lone.role === '前' ? 'is-before' : 'is-after'">{{ lone.role }} · {{ lone.name }}</span>
          <div class="flow-compare-wait">
            <span class="flow-compare-wait-plus">＋</span>
            <span>等待第二张图<br>连上后自动补齐对比</span>
          </div>
        </template>

        <div v-else class="flow-compare-empty">
          <span class="flow-compare-empty-icon" v-html="NODE_ICONS.compare"></span>
          <strong>从左侧连入两张图片</strong>
          <p>先连上来的作为「前」<br>后连上来的作为「后」</p>
        </div>
      </div>

      <!-- 底部只跟着焦点态出现，和其他节点一致：内容态的卡片就是那张对比图本身，
           多一行带边框的按钮会让它变成一张"小控件"而不是一张图 -->
      <div v-if="state === 'ready' && focused" class="flow-compare-foot">
        <button type="button" class="flow-compare-swap nodrag" title="调换哪些是前、哪些是后" @click="toggleSwap">⇄ 交换前后</button>
      </div>
    </template>
  </NodeFrame>
</template>

<script setup>
import { computed, ref } from 'vue'
import { NodeFrame } from './base'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { duplicateNode, removeNode, updateNode } from '../../stores/canvas'
import { NODE_ICONS } from '../../config/nodeIcons'
import { buildNodeNotices } from '../../utils/nodeNotices'
import { approximateRatio, cardWidthForRatio, ratioValue } from '../../utils/ratio'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { slots } = useNodeRefs(props.id)
const focused = useFocusExpanded(props.id)
const multi = useMultiSelected(props.id)
const notices = computed(() => buildNodeNotices(props.data))

/**
 * 两张图 = 前两条图片入边。**不按 url 过滤** —— 连了但还没出图的也要占住位置，
 * 否则"前"会随着上游出图时机悄悄换人。
 */
const images = computed(() => slots.value
  .filter(slot => slot.kind === 'image')
  .slice(0, 2)
  .map((slot, index) => ({
    index: index + 1,
    url: slot.src?.data?.url || '',
    name: slot.src?.data?.label || `图片 ${index + 1}`,
    ratio: slot.src?.data?.ratio || ''
  })))

const swapped = computed(() => Boolean(props.data?.swap))
const ordered = computed(() => (swapped.value ? [...images.value].reverse() : images.value))
const before = computed(() => ordered.value[0] || { url: '', name: '', ratio: '' })
const after = computed(() => ordered.value[1] || { url: '', name: '', ratio: '' })

/** 只有一侧有图时是哪一张、它算「前」还是「后」 */
const lone = computed(() => {
  const position = ordered.value.findIndex(image => image.url)
  if (position < 0) return null
  return { ...ordered.value[position], role: position === 0 ? '前' : '后' }
})

const state = computed(() => {
  if (before.value.url && after.value.url) return 'ready'
  return lone.value ? 'half' : 'empty'
})

/* ---------------------------------------------------------------- 滑块 */
/**
 * 滑块位置是**组件本地状态，不落盘**：它回答的是"我现在想看哪一侧"，
 * 明天打开该回到中间，而不是停在上次手指的位置。
 */
const boxRef = ref(null)
const split = ref(50)

/* ------------------------------------------------------------------ 尺寸 */
/**
 * 卡片与图片框的比例 = 量出来的真实比例。
 *
 * 先读上游图片节点存着的 `data.ratio`（生成出来的图都有），没有就等 `<img>` 的
 * `load` 事件量一次（上传的素材没有这个字段）。**只量第一次**：两张图比例不同时，
 * 让后来的那张跟着第一张走，总比两帧之间来回换尺寸强。
 *
 * 量完会带来一次卡片变宽/变窄 —— 值得：对比节点摆在它那两张原图旁边，跟它们
 * 一样大，前后对比才在同一尺度上。
 */
const measured = ref('')
const ratio = computed(() => measured.value || before.value.ratio || after.value.ratio || '4:3')
const cardWidth = computed(() => cardWidthForRatio(ratioValue(ratio.value)))
const boxStyle = computed(() => ({
  '--flow-compare-split': `${split.value}%`,
  aspectRatio: ratio.value.replace(':', ' / ')
}))

const measure = (event) => {
  if (measured.value) return
  const img = event.target
  if (!img?.naturalWidth || !img?.naturalHeight) return
  measured.value = approximateRatio(img.naturalWidth / img.naturalHeight)
}

/* ------------------------------------------------------------------ 状态 */
const statusText = computed(() => {
  if (state.value === 'ready') return '已就绪'
  return state.value === 'half' ? '还差 1 张' : '未接入'
})
const statusClass = computed(() => (state.value === 'ready' ? 'is-ok' : ''))

/* ------------------------------------------------------------ 滑块交互 */
const setSplit = (percent) => {
  split.value = Math.min(100, Math.max(0, percent))
}

const splitAtPointer = (event) => {
  const rect = boxRef.value?.getBoundingClientRect()
  if (!rect?.width) return
  setSplit(((event.clientX - rect.left) / rect.width) * 100)
}

/**
 * 拖分隔线。
 *
 * 抓取区只有中间那条 36px 的竖条（带 nodrag），按在图片其余位置仍是拖节点 ——
 * 一张"拖哪儿都是滑块"的卡片在画布上就搬不动了（内容态的节点没有表头可抓）。
 */
const startDrag = (event) => {
  if (event.button !== 0) return
  event.preventDefault()
  const band = event.currentTarget
  splitAtPointer(event)
  band.setPointerCapture?.(event.pointerId)

  const onMove = (moveEvent) => splitAtPointer(moveEvent)
  const onEnd = () => {
    band.removeEventListener('pointermove', onMove)
    band.removeEventListener('pointerup', onEnd)
    band.removeEventListener('pointercancel', onEnd)
  }
  band.addEventListener('pointermove', onMove)
  band.addEventListener('pointerup', onEnd)
  band.addEventListener('pointercancel', onEnd)
}

/** 键盘：聚焦手柄后方向键微调，Shift 一次跳 10% */
const onKeydown = (event) => {
  const step = event.shiftKey ? 10 : 2
  const next = event.key === 'ArrowLeft' ? split.value - step
    : event.key === 'ArrowRight' ? split.value + step
      : event.key === 'Home' ? 0
        : event.key === 'End' ? 100
          : null
  if (next === null) return
  event.preventDefault()
  setSplit(next)
}

/* ------------------------------------------------------------------ 编辑 */
/** 走 updateNode 而不是直接改 data：否则不进撤销栈，重载后静默变回来 */
const toggleSwap = () => { updateNode(props.id, { swap: !swapped.value }) }

const duplicateAndRefresh = () => { duplicateNode(props.id) }
const remove = () => { removeNode(props.id) }
</script>
