<template>
  <!-- 底部 composer | Bottom composer
       选中的节点自动成为上下文，不用再手动连线。两种模式：
       - 恰好选中一个节点 = **编辑模式**：输入框就是那个节点的提示词，边打边写回，
         发送相当于"用这份提示词生成"。
       - 其余情况 = **创建模式**：发送会建一个 AI 任务节点（收下选中 + @ 引用的上游），
         再按张数在右侧建输出节点。 -->
  <Teleport to="body" :disabled="!composerExpanded">
  <div class="composer-wrap" :class="{ 'is-expanded': composerExpanded, 'is-hidden': !composerVisible }" @keydown="onComposerEscape">
    <div v-if="composerExpanded" class="compose-backdrop" @click="toggleComposerExpanded(false)"></div>
    <div v-if="contextChips.length === 1" class="context-strip">
      <div v-for="chip in contextChips" :key="chip.id" class="context-chip">
        <span class="context-chip-name">{{ chip.label }}</span>
        <button class="context-chip-x" type="button" title="从上下文移除" @click="deselect(chip.id)">×</button>
      </div>
    </div>

    <div class="composer" :role="composerExpanded ? 'dialog' : undefined" :aria-modal="composerExpanded ? true : undefined" :aria-label="composerExpanded ? '编辑提示词' : undefined">
      <button v-if="!isParamlessNode" class="compose-expand" type="button"
        :title="composerExpanded ? '收起提示词' : '展开提示词'" :aria-label="composerExpanded ? '收起提示词' : '展开提示词'"
        :aria-expanded="composerExpanded" @click="toggleComposerExpanded(!composerExpanded)">
        <svg v-if="composerExpanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg>
      </button>
      <div v-if="mentionRefs.length" class="prompt-references">
        <div v-for="ref in mentionRefs" :key="ref.id" class="prompt-ref">
          <img v-if="ref.thumb" :src="ref.thumb" alt="" />
          <span v-else class="prompt-ref-thumb"></span>
          <span>{{ ref.token }}</span>
          <button type="button" class="prompt-ref-x" @click="removeMention(ref)">×</button>
        </div>
      </div>

      <div class="compose-main">
        <!-- 这两类节点没有"提示词"这回事，正文框换成一句说明 -->
        <p v-if="isRenderNode" class="compose-note">
          参数在卡片上设置，比例跟随每个视角的原图。这里只负责开始 / 停止。
        </p>
        <p v-else-if="isCompareNode" class="compose-note">
          图片对比不用生成：连入两张图片后，在卡片里拖中间的滑块看前后差异。
        </p>
        <textarea
          v-else
          ref="inputRef"
          v-model="text"
          class="compose-input"
          placeholder=""
          title="Enter 发送 · Shift+Enter 换行"
          @input="onInput"
          @keydown="onKeydown"
          @click="updateMention"
          @blur="closeMention"
        ></textarea>

      </div>

      <div v-if="!isCompareNode" class="compose-options">
        <div v-if="!isParamlessNode" class="opt-left">
          <label class="node-type-pill">
            <span class="node-type-dot" :class="`tone-${effectiveTarget}`"></span>
            <select
              class="node-type-select"
              :value="targetType"
              :disabled="!canChangeType"
              :title="canChangeType ? '产出类型' : '这个节点的类型由它自己决定'"
              @change="changeTargetType($event.target.value)"
            >
              <option v-for="option in TARGET_TYPES" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <button
            ref="modelTriggerRef"
            class="compose-model"
            :class="{ 'is-open': modelOpen, 'is-empty': !modelOptions.length }"
            type="button"
            :title="modelButtonLabel"
            @click="modelOpen = !modelOpen"
          >{{ modelButtonLabel }}</button>
          <!-- 清晰度 / 比例 / 张数收进这一个按钮，点开是参数面板 -->
          <button
            v-if="paramSummary"
            ref="paramTriggerRef"
            class="compose-params"
            :class="{ 'is-open': paramOpen }"
            type="button"
            :title="`生成参数：${paramSummary}`"
            @click="paramOpen = !paramOpen"
          >{{ paramSummary }}</button>
          <button
            class="compose-model is-preset"
            :class="{ 'is-empty': !preset }"
            type="button"
            :title="preset ? `提示词预设：${preset.title}` : '选择提示词预设'"
            @click="presetOpen = true"
          >
            <span class="preset-glyph">✦</span>{{ preset ? preset.title : '预设' }}
          </button>
        </div>
        <!-- 图片对比没有可生成的东西，这颗键整颗收起来（留着禁用态只会让人找原因） -->
        <button
          v-if="!isCompareNode"
          class="compose-send"
          type="button"
          :class="{ 'is-ready': sendReady, 'is-busy': editingBusy }"
          :disabled="isEditing && !canRun"
          :title="sendTitle"
          @click="send"
        >
          <svg v-if="editingBusy" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="44 15" transform="rotate(-90 12 12)" />
            <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.6" fill="currentColor" />
          </svg>
          <svg v-else-if="isEditing" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6.2v11.6L18.6 12z" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" /></svg>
        </button>
      </div>
    </div>

    <OptionPanel
      :visible="modelOpen"
      :anchor="modelTriggerRef"
      :model-value="selectedOptionId"
      :options="modelPanelOptions"
      search-placeholder="筛选模型…"
      empty-text="没有可用模型"
      @update:model-value="pickModel"
      @close="modelOpen = false"
    />

    <PresetGallery
      :visible="presetOpen"
      :selected-id="preset?.id || ''"
      :subtitle="presetSubtitle"
      @select="selectPreset"
      @close="presetOpen = false"
    />

    <ParamPanel
      :visible="paramOpen"
      :anchor="paramTriggerRef"
      :resolution="resolution"
      :resolution-options="effectiveTarget === 'image' ? resolutionOptions : []"
      :resolution-hint="effectiveTarget === 'image' ? imageTier.note : ''"
      :ratio="ratio"
      :ratio-options="ratioOptions"
      :count="count"
      :count-options="effectiveTarget === 'image' ? COUNTS : []"
      :video-preset="videoPreset"
      :video-preset-options="effectiveTarget === 'video' ? videoPresetOptions : []"
      @update:resolution="resolution = $event"
      @update:ratio="ratio = $event"
      @update:count="count = $event"
      @update:video-preset="videoPreset = $event"
      @close="paramOpen = false"
    />

    <div v-if="mentionOpen" class="mention-menu">
      <button
        v-for="candidate in mentionCandidates"
        :key="candidate.id"
        class="mention-item"
        type="button"
        @mousedown.prevent
        @click="insertMention(candidate)"
      >
        <img v-if="candidate.thumb" :src="candidate.thumb" alt="" />
        <span v-else class="mention-thumb"></span>
        <span class="mention-copy">
          <b>{{ candidate.title }}</b>
          <span>{{ candidate.subtitle }}</span>
        </span>
      </button>
      <div v-if="!mentionCandidates.length" class="mention-empty">没有可引用的上游素材</div>
    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  nodes, edges, addNode, addEdge, updateNode, editNode, editField,
  startBatchOperation, endBatchOperation, renumberNodeRefs
} from '../../stores/canvas'
import { useModelStore } from '../../stores/pinia'
import {
  INPUT_HANDLE, OUTPUT_HANDLE, KIND_TITLE, isReferenceableType, NODE_DEFINITIONS
} from '../../config/nodeRegistry'
import { computeSlots, refKey } from '../../utils/promptRefs'
import { findSizeByRatio, approximateRatio, normalizeRatioKey } from '../../utils/ratio'
import { resolveImageTierOptions, imageTierLockNote } from '../../utils/imageTiers'
import ParamPanel from './ParamPanel.vue'
import OptionPanel from './OptionPanel.vue'
import { normalizePreset, toStoredPreset } from '../../config/promptPresets'
import PresetGallery from './PresetGallery.vue'
import { selectedNodeIds } from '../../composables/useFocusMode'
import { runNode, cancelNode } from '../../composables/useNodeRunBridge'

const props = defineProps({
  /** 由 Canvas 注入的屏幕→flow 坐标换算（见 viewportCenter 的说明） */
  screenToFlow: { type: Function, default: null }
})

const emit = defineEmits(['attach'])

const modelStore = useModelStore()

const TARGET_TYPES = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'text', label: '文本' }
]
const COUNTS = [1, 2, 4]
/** 模型没声明比例时用的兜底档位（顺序照参考面板排） */
const FALLBACK_RATIOS = [
  '1:1', '1:2', '2:1', '9:16', '16:9',
  '3:4', '4:3', '3:2', '2:3', '5:4',
  '4:5', '21:9', '9:21'
]


const inputRef = ref(null)
const text = ref('')
const composerExpanded = ref(false)
const toggleComposerExpanded = async (expanded) => {
  const input = inputRef.value
  const selection = [input?.selectionStart || 0, input?.selectionEnd || 0]
  const scrollTop = input?.scrollTop || 0
  composerExpanded.value = expanded
  await nextTick()
  inputRef.value?.focus({ preventScroll: true })
  inputRef.value?.setSelectionRange(...selection)
  if (inputRef.value) inputRef.value.scrollTop = scrollTop
}
const onComposerEscape = (event) => {
  if (event.key !== 'Escape' || !composerExpanded.value) return
  event.preventDefault()
  event.stopPropagation()
  toggleComposerExpanded(false)
}

const targetType = ref('image')
const ratio = ref('auto')
const count = ref(1)
const preset = ref(null)

/* ------------------------------------------------------------------ 选中上下文 */
const selectedNodes = computed(() => nodes.value.filter(node => selectedNodeIds.value.includes(String(node.id))))
/** 恰好选中一个内容节点 = 编辑它的提示词 */
const editingNode = computed(() => (selectedNodes.value.length === 1 ? selectedNodes.value[0] : null))
const isEditing = computed(() => Boolean(editingNode.value))
/**
 * 室内渲染是唯一一个「参数不在 composer 上」的节点 —— 它自己就是一张大表单。
 * 选中它时 composer 只剩一颗开始 / 停止按钮，正文框与整行选项都收起来：
 * 参数只有卡片这一个可编辑面，镜像一份到这里必然失步。
 */
const isRenderNode = computed(() => isEditing.value && editingNode.value.type === 'render')
/**
 * 图片对比是第二个「参数不在 composer 上」的节点，而且更彻底：它没有提示词、
 * 也没有可生成的东西 —— 参数就是那两根连线本身。选中它时 composer 只留一句说明，
 * 正文框、选项行、发送键全部让位。
 */
const isCompareNode = computed(() => isEditing.value && editingNode.value.type === 'compare')
/** 这两类节点的可编辑面都在卡片上，composer 只说明、不编辑 */
const isParamlessNode = computed(() => isRenderNode.value || isCompareNode.value)

/**
 * 有选中节点时才升起来。
 * 这条栏本质是「选中节点的提示词编辑器」—— 没有选中 = 没有编辑对象，
 * 常驻底部只会挡住画布下方。新建节点走双击空白 / 端口菜单，不依赖它。
 */
const composerVisible = computed(() => selectedNodes.value.length > 0)

const contextChips = computed(() => selectedNodes.value.map(node => ({
  id: node.id,
  label: `${node.data?.label || KIND_TITLE[node.type] || NODE_DEFINITIONS[node.type]?.label || node.type}`
})))

const deselect = (id) => {
  nodes.value = nodes.value.map(node => (String(node.id) === String(id) ? { ...node, selected: false } : node))
}

/* ------------------------------------------------------------------ 选项
   参数只有这一处（卡片上的参数控件已全部撤掉）。编辑模式下这些值会**立即写回**
   选中的节点，不用等"保存"—— 不然改了模型再点保存才生效，手感像两套系统。 */
const modelsFor = (kind) => (
  kind === 'IMAGE' ? (modelStore.groupedImageModelOptions || [])
    : kind === 'VIDEO' ? (modelStore.groupedVideoModelOptions || [])
      : (modelStore.groupedChatModelOptions || [])
)

/** 该节点产出什么；承载型节点（音频）没有"产出类型"，落到图片 */
const targetOf = (node) => {
  if (!node) return 'image'
  const declared = node.type === 'task' ? (node.data?.targetType || 'image') : node.type
  return TARGET_TYPES.some(option => option.value === declared) ? declared : 'image'
}
const effectiveTarget = computed(() => (isEditing.value ? targetOf(editingNode.value) : targetType.value))
/** 产出类型只有任务节点能改；图片/视频/文本节点的类型是它自己 */
const canChangeType = computed(() => !isEditing.value || editingNode.value.type === 'task')

const modelOptions = computed(() => modelsFor(
  effectiveTarget.value === 'image' ? 'IMAGE' : effectiveTarget.value === 'video' ? 'VIDEO' : 'CHAT'
))
const selectedModel = ref('')
const selectedProvider = ref('')
const selectedOptionId = computed(() => `${selectedProvider.value}::${selectedModel.value}`)
const videoPreset = ref('')
const resolution = ref('')
const paramOpen = ref(false)
const paramTriggerRef = ref(null)
const modelOpen = ref(false)
const modelTriggerRef = ref(null)
const presetOpen = ref(false)

/**
 * 面板里的行比下拉选项多两样东西：
 * - `tips` 当副标题（部分模型声明了用法提示，比如"尺寸写在提示词中"）
 * - 供应商按真实的模型来源分组，同名模型保留各自的选项。
 */
const modelPanelOptions = computed(() => modelOptions.value.map(option => {
  const detail = effectiveTarget.value === 'video'
    ? modelStore.getVideoModel?.(option.value, option.sourceProvider)
    : effectiveTarget.value === 'text'
      ? modelStore.getChatModel?.(option.value, option.sourceProvider)
      : modelStore.getImageModel?.(option.value, option.sourceProvider)
  return { ...option, value: option.optionId, modelKey: option.value, tips: detail?.tips || '' }
}))
const pickModel = (optionId) => {
  const option = modelOptions.value.find(item => item.optionId === optionId)
  if (!option) return
  selectedProvider.value = option.sourceProvider
  selectedModel.value = option.value
}

const modelButtonLabel = computed(() => {
  const hit = modelOptions.value.find(option => option.value === selectedModel.value && option.sourceProvider === selectedProvider.value)
  if (!hit) return modelOptions.value.length ? '选择模型' : '未配置模型'
  const duplicated = modelOptions.value.filter(option => option.value === hit.value).length > 1
  return duplicated ? `${hit.group} · ${hit.label}` : hit.label
})

/**
 * 图片的清晰度档位（1K / 2K / 4K…）：跟模型的声明走，
 * 还要看当前渠道能不能真把档位送进去 —— 详见 utils/imageTiers。
 */
const imageTier = computed(() => {
  const upstream = modelStore.resolveUpstreamContext(
    selectedProvider.value || modelStore.resolveModelSourceProvider(selectedModel.value, 'IMAGE') || ''
  )
  const args = {
    model: modelStore.getImageModel?.(selectedModel.value, selectedProvider.value),
    modelKey: selectedModel.value,
    providerConfig: upstream.providerConfig,
    baseUrl: upstream.baseUrl
  }
  return { options: resolveImageTierOptions(args), note: imageTierLockNote(args) }
})
const resolutionOptions = computed(() => imageTier.value.options)

// 换模型后原来那档可能不存在了（1K 的模型换到只有 2K/4K 的），落到新模型的第一档
watch([selectedModel, resolutionOptions], () => {
  if (!resolutionOptions.value.includes(resolution.value)) {
    resolution.value = resolutionOptions.value[0] || ''
  }
})

/** 视频的「清晰度 · 时长」，按模型能力列 */
const videoPresetOptions = computed(() => {
  const model = modelStore.getVideoModel?.(selectedModel.value, selectedProvider.value)
  const resolutions = model?.resolutions?.length ? model.resolutions : [model?.defaultResolution || '1080p']
  const durations = model?.durs?.length ? model.durs.map(item => item.key) : [model?.defaultParams?.duration || 5]
  return resolutions.flatMap(resolution => durations.map(duration => ({
    value: `${resolution}:${duration}`,
    label: `${resolution} · ${duration}s`
  })))
})

/**
 * 比例候选：**`自适应` 永远排第一，也是默认值**（让模型自己决定，用户没要求时最省心）。
 * 视频模型直接声明 `ratios`；图片模型声明的是 `sizes`，取比例去重后当候选。
 * 都没声明就退回通用比例表。
 */
/**
 * 尺寸 key → 常用比例标签。
 * 不能直接约分：'3024x1296' 精确约分是 7:3，但模型配置里它标的是 21:9 ——
 * 同一种比例两种写法，面板上看着像多了个不认识的档位。统一吸附到常用比例。
 */
const ratioFromSize = (size) => {
  const [width, height] = String(size).split(/[x×:]/).map(Number)
  return width && height ? approximateRatio(width / height) : ''
}

const ratioOptions = computed(() => {
  const target = effectiveTarget.value
  if (target === 'text') return []
  const model = target === 'video'
    ? modelStore.getVideoModel?.(selectedModel.value, selectedProvider.value)
    : modelStore.getImageModel?.(selectedModel.value, selectedProvider.value)
  const declared = target === 'video'
    ? model?.ratios
    : (model?.sizes || []).map(ratioFromSize)
  const list = Array.isArray(declared) && declared.length
    ? [...new Set(declared.filter(Boolean))]
    : FALLBACK_RATIOS
  return ['auto', ...list]
})

watch(modelOptions, (options) => {
  const match = options.find(option => option.value === selectedModel.value && option.sourceProvider === selectedProvider.value)
  if (match) return
  const fallback = options.find(option => option.value === selectedModel.value) || options[0]
  selectedProvider.value = fallback?.sourceProvider || ''
  selectedModel.value = fallback?.value || ''
}, { immediate: true })

// 编辑模式下选项要反映那个节点自己的设置
watch(editingNode, (node) => {
  if (!node) return
  targetType.value = targetOf(node)
  // 比例要**从存的 size 反推回来**，不能一看有 size 就当自适应：
  // desiredParams 里选了具体比例时就是写 size（模型认识的尺寸 key），
  // 早先这里写成 `size ? 'auto'`，于是"选 3:4 → 写入 size → 读回来自适应 → 又把 size 清掉"，
  // 请求里 size 变空，服务端就按自己的默认出了 1:1。
  ratio.value = node.data?.size
    ? normalizeRatioKey(node.data.size)
    : (node.data?.ratio || 'auto')
  count.value = Number(node.data?.count || 1)
  if (node.data?.model) {
    const category = targetOf(node) === 'video' ? 'VIDEO' : targetOf(node) === 'text' ? 'CHAT' : 'IMAGE'
    const preferred = node.data.sourceProvider
      || modelStore.resolveModelSourceProvider(node.data.model, category)
    const match = modelOptions.value.find(option => option.value === node.data.model
      && option.sourceProvider === preferred)
      || modelOptions.value.find(option => option.value === node.data.model)
    selectedProvider.value = match?.sourceProvider || preferred || ''
    selectedModel.value = match?.value || node.data.model
  }
  const model = modelStore.getVideoModel?.(selectedModel.value, selectedProvider.value)
  videoPreset.value = `${node.data?.resolution || model?.defaultResolution || '1080p'}:${node.data?.duration || model?.defaultParams?.duration || 5}`
  const saved = String(node.data?.resolution || '').toUpperCase()
  if (saved) resolution.value = saved
}, { immediate: true })

/**
 * 当前选项对应的节点参数。
 * 只有产出类型是图片/视频才有意义 —— 文本没有尺寸，音频也不吃这些。
 */
const desiredParams = () => {
  const target = effectiveTarget.value
  const patch = {}
  if (selectedModel.value) patch.model = selectedModel.value
  if (selectedProvider.value) patch.sourceProvider = selectedProvider.value
  if (target === 'text') return patch

  if (ratio.value === 'auto') {
    patch.size = null
    patch.ratio = null
  } else {
    const matched = target === 'image'
      ? findSizeByRatio(modelStore.getImageModel?.(selectedModel.value, selectedProvider.value)?.sizes || [], ratio.value)
      : null
    patch.size = matched || null
    patch.ratio = matched ? null : ratio.value
  }
  if (target === 'image') {
    patch.count = count.value
    if (resolution.value) patch.resolution = resolution.value
  }
  if (target === 'video' && videoPreset.value) {
    const [resolution, duration] = videoPreset.value.split(':')
    patch.resolution = resolution
    patch.duration = Number(duration)
  }
  return patch
}

/**
 * 把选项写回正在编辑的节点。
 * **值没变就一个字段都不写** —— 这样"选中节点时把它的参数同步到选项"这个反方向的动作
 * 不会被自己误判成用户编辑，不需要额外的同步锁。
 */
const applyOptionsToNode = () => {
  const node = editingNode.value
  if (!node) return
  // 室内渲染 / 图片对比的参数（或压根没有参数）只在卡片上，这一套选项对它没有意义。
  // 必须在这里早退：否则选中它的瞬间，这个 watcher 就会把 composer 里的图片模型、
  // 张数、清晰度写进节点，静默盖掉卡片上刚设好的参数。
  if (isParamlessNode.value) return
  const patch = desiredParams()
  const changed = Object.entries(patch).some(([key, value]) => (node.data?.[key] ?? null) !== (value ?? null))
  if (!changed) return
  editNode(node.id, patch)
}
watch([selectedModel, selectedProvider, ratio, count, videoPreset, resolution, editingNode], applyOptionsToNode)

/** 换产出类型：模型与参数整套换掉，否则会拿着图片参数去调视频模型 */
const changeTargetType = (value) => {
  targetType.value = value
  const node = editingNode.value
  if (!node || node.type !== 'task' || value === node.data?.targetType) return
  editNode(node.id, {
    targetType: value,
    model: '',
    sourceProvider: '',
    size: null,
    ratio: null,
    count: 1,
    resolution: value === 'video' ? '1080p' : '1K',
    duration: value === 'video' ? 5 : 0
  })
}

const presetSubtitle = computed(() => `${KIND_TITLE[effectiveTarget.value] || ''}提示词预设`)

/**
 * 选中预设只做两件事：把预设**本体**记到节点上、栏上显示它的标题。
 * **不往输入框里灌内容** —— 那段是固定的套路话，灌进去用户还得在一堆模板腔里找自己写的那句。
 * 真正的文本在生成时由 useNodeRefs 的 buildPrompt 拼在最前面。
 */
const selectPreset = (item) => {
  preset.value = toStoredPreset(item)
  presetOpen.value = false
  const node = editingNode.value
  if (!node) return
  editNode(node.id, { preset: preset.value })
}

// 预设跟着节点走：换节点时读它自己的那份
watch(editingNode, (node) => {
  preset.value = node ? normalizePreset(node.data?.preset) : preset.value
}, { immediate: true })

// 编辑模式下改预设直接写回节点（上面 selectPreset 已经写了；这里兜住别处改动预设的情况）
watch(preset, (value) => {
  const node = editingNode.value
  if (!node) return
  if (normalizePreset(node.data?.preset)?.id === value?.id) return
  editNode(node.id, { preset: value })
})

/* ---------------------------------------------------------------- 生成（编辑模式） */
/** 能生成的节点类型：音频是纯承载，没有生成 */
const RUNNABLE = ['text', 'image', 'video', 'task', 'render']
const canRun = computed(() => Boolean(editingNode.value) && RUNNABLE.includes(editingNode.value.type))
/** 正在跑：loading 或者视频在等异步任务 */
const editingBusy = computed(() => Boolean(
  editingNode.value?.data?.loading || editingNode.value?.data?.taskId
))
/**
 * 参数按钮上的一句话摘要（清晰度 · 比例 · 张数）。
 * 产出类型是文本时没有生成参数，返回空串 —— 按钮整颗不出现。
 */
const paramSummary = computed(() => {
  const target = effectiveTarget.value
  if (target === 'text') return ''
  const parts = []
  if (target === 'video') {
    const [presetResolution, presetDuration] = String(videoPreset.value || '').split(':')
    if (presetResolution) parts.push(`${presetResolution} · ${presetDuration || 5}s`)
  } else if (resolution.value) {
    parts.push(resolution.value)
  }
  parts.push(ratio.value === 'auto' ? '自适应' : ratio.value)
  if (target === 'image') parts.push(`${count.value} 张`)
  return parts.join(' · ')
})

/**
 * 有东西可以发出去吗 —— 只用来决定按钮要不要"点亮"（填成实心）。
 * 编辑模式看这个节点能不能生成；创建模式看正文或选中的节点。
 * 它**不控制可点性**：创建模式下空着也能点，点了给一句提示（见 send()）。
 */
const sendReady = computed(() => (
  isEditing.value
    ? canRun.value
    : Boolean(text.value.trim() || selectedNodeIds.value.length)
))

const sendTitle = computed(() => {
  if (!isEditing.value) return '创建任务'
  if (!canRun.value) return '这个节点没有生成动作'
  // 是**停止**不是暂停：cancelNode 会中断本次生成，没有"续上"的机制
  return editingBusy.value ? '停止生成' : '生成'
})

watch(editingNode, (node) => {
  text.value = node ? String(node.data?.prompt || '') : ''
}, { immediate: true })

const onInput = () => {
  if (isEditing.value) editField(editingNode.value.id, 'prompt', text.value)
  updateMention()
}

/* ------------------------------------------------------------------ @ 引用 */
/** 本会话里插入过的 mention：[{ nodeId, token }]，发送时用它把占位 token 换成真编号 */
const mentioned = ref([])
const mentionOpen = ref(false)
const mentionFrom = ref(-1)

/**
 * 可以被引用的节点：承载内容、且不是正在编辑的那个。
 * 用 isReferenceableType 而不是逐个排除 group / task —— 任务与室内渲染都是**指令**，
 * 没有可被引用的内容，而 KIND_TITLE 里也没有它们，漏掉一个就会往正文里插入 `@undefined1`。
 */
const referenceable = computed(() => nodes.value.filter(node => (
  isReferenceableType(node.type) && node.id !== editingNode.value?.id
)))

const tokenFor = (node, index) => `@${KIND_TITLE[node.type]}${index}`

const candidateList = computed(() => referenceable.value.map((node) => ({
  id: node.id,
  title: node.data?.label || KIND_TITLE[node.type] || node.type,
  subtitle: (node.data?.url || node.data?.content) ? '有内容' : '还没有内容',
  thumb: node.data?.url || ''
})))

const mentionCandidates = computed(() => {
  const query = mentionQuery.value.toLowerCase()
  if (!query) return candidateList.value
  return candidateList.value.filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(query))
})

const mentionQuery = ref('')

const mentionRefs = computed(() => mentioned.value.map((item) => {
  const node = nodes.value.find(n => String(n.id) === String(item.nodeId))
  return { ...item, thumb: node?.data?.url || '' }
}))

const updateMention = () => {
  const el = inputRef.value
  if (!el) return
  const caret = el.selectionStart ?? text.value.length
  const before = text.value.slice(0, caret)
  const match = before.match(/@([^\s@]*)$/)
  if (!match) { closeMention(); return }
  mentionQuery.value = match[1]
  mentionFrom.value = caret - match[0].length
  mentionOpen.value = true
}

const closeMention = () => { mentionOpen.value = false; mentionQuery.value = '' }

const insertMention = (candidate) => {
  const el = inputRef.value
  const node = nodes.value.find(n => String(n.id) === String(candidate.id))
  if (!node) return
  const caret = el?.selectionStart ?? text.value.length
  const from = mentionFrom.value >= 0 ? mentionFrom.value : caret
  // 先按同类第几号给个占位，发送时按真实槽位改写成最终编号
  const sameKind = mentioned.value.filter(item => {
    const other = nodes.value.find(n => String(n.id) === String(item.nodeId))
    return other?.type === node.type
  }).length
  const token = tokenFor(node, sameKind + 1)
  const next = `${text.value.slice(0, from)}${token} ${text.value.slice(caret)}`
  text.value = next
  if (!mentioned.value.some(item => String(item.nodeId) === String(node.id))) {
    mentioned.value = [...mentioned.value, { nodeId: node.id, token }]
  }
  closeMention()
  if (isEditing.value) editField(editingNode.value.id, 'prompt', next)
  nextTick(() => {
    const at = from + token.length + 1
    inputRef.value?.setSelectionRange(at, at)
    inputRef.value?.focus()
  })
}

const removeMention = (ref_) => {
  mentioned.value = mentioned.value.filter(item => item.token !== ref_.token)
  text.value = text.value.replace(ref_.token, '').replace(/\s{2,}/g, ' ')
  if (isEditing.value) editField(editingNode.value.id, 'prompt', text.value)
}

/* ------------------------------------------------------------------ 发送 */
const onKeydown = (event) => {
  if (event.key === 'Escape') { closeMention(); return }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (mentionOpen.value && mentionCandidates.value.length) {
    insertMention(mentionCandidates.value[0])
    return
  }
  send()
}

/**
 * 把用户正文里的占位 token 换成目标节点上的真实编号。
 * 编号是按"该类上游在本节点入边里的位次"算的，而占位号只是同类第几个 mention，
 * 中间还夹着被选中但没 @ 的节点，所以必须等边建好之后再对齐一次。
 */
const resolveTokens = (targetId, prompt) => {
  const target = nodes.value.find(node => String(node.id) === String(targetId))
  if (!target) return { prompt, refBindings: {} }
  const { slots } = computeSlots(target, nodes.value, edges.value)
  const bindings = {}
  let next = prompt
  mentioned.value.forEach((item) => {
    const slot = slots.find(s => String(s.src.id) === String(item.nodeId))
    if (!slot) return
    const real = slot.token
    if (real !== item.token) next = next.split(item.token).join(real)
    bindings[refKey(slot.kind, slot.index)] = slot.edge.id
  })
  return { prompt: next, refBindings: bindings }
}

/**
 * 换节点 / 换产出类型时把面板收起来。
 *
 * 盯的是**节点 id**，不是 `editingNode` 对象本身：选中节点的对象身份在每次写回数据后
 * 都会变（store 里是 `{...node, data}` 整体替换），盯对象的话"在参数面板里点一下选项"
 * 就会触发一次，面板当场被收掉 —— 换个清晰度还得重新点开。
 */
watch([() => editingNode.value?.id, targetType], () => {
  paramOpen.value = false
  modelOpen.value = false
  presetOpen.value = false
})

/**
 * 收下去时把挂在栏上的浮层一起关掉。
 * 模型 / 参数 / 预设面板是拎到触发按钮旁边渲染的，栏一往下降，锚点就在动，
 * 留着它们会悬在半空跟着飘。mention 候选同理。
 */
watch(composerVisible, (visible) => {
  if (visible) return
  paramOpen.value = false
  modelOpen.value = false
  presetOpen.value = false
  closeMention()
  composerExpanded.value = false
})

const send = async () => {
  // 室内渲染：只借用这颗按钮当作开始 / 停止。必须在 resolveTokens / editNode 之前拦下 ——
  // 那两条会往节点里写 prompt 与 refBindings，而它的提示词是 buildRenderPrompt 现算的。
  if (isRenderNode.value) {
    const node = editingNode.value
    if (editingBusy.value) cancelNode(node.id)
    else runNode(node.id)
    return
  }

  if (isEditing.value) {
    const node = editingNode.value
    if (editingBusy.value) {
      cancelNode(node.id)
      return
    }
    // 落盘提示词、引用与参数 —— 必须在触发生成**之前**，否则节点会拿着旧提示词去跑
    const { prompt, refBindings } = resolveTokens(node.id, text.value)
    editNode(node.id, {
      prompt,
      refBindings: { ...(node.data?.refBindings || {}), ...refBindings },
      ...desiredParams()
    })
    renumberNodeRefs(node.id)
    // 正文里的占位号已经换成真编号了，mention 列表随之作废
    mentioned.value = []
    runNode(node.id)
    return
  }

  const sourceIds = [...new Set([
    ...selectedNodeIds.value,
    ...mentioned.value.map(item => String(item.nodeId))
  ])].filter(id => nodes.value.some(node => String(node.id) === id))

  if (!text.value.trim() && !sourceIds.length) {
    window.$message?.warning('先写点什么，或者选中一些节点当上下文')
    return
  }

  const center = viewportCenter()

  startBatchOperation()
  // 1) 任务节点
  const taskId = addNode('task', { x: center.x - 160, y: center.y - 40 }, {
    prompt: text.value,
    targetType: targetType.value,
    preset: preset.value,
    ...desiredParams()
  })
  // 2) 上游连线。先连被 @ 的（顺序决定编号），再连其余选中的
  const ordered = [
    ...mentioned.value.map(item => String(item.nodeId)),
    ...sourceIds.filter(id => !mentioned.value.some(item => String(item.nodeId) === id))
  ].filter((id, index, list) => list.indexOf(id) === index && nodes.value.some(node => String(node.id) === id))

  ordered.forEach((sourceId, index) => {
    const sourceNode = nodes.value.find(node => String(node.id) === sourceId)
    if (!sourceNode || !isReferenceableType(sourceNode.type)) return
    addEdge({
      source: sourceId,
      target: taskId,
      sourceHandle: OUTPUT_HANDLE,
      targetHandle: INPUT_HANDLE,
      type: 'flowEdge',
      data: { order: index + 1 }
    })
  })

  // 3) 对齐引用编号并写回正文
  const { prompt, refBindings } = resolveTokens(taskId, text.value)
  updateNode(taskId, { prompt, refBindings })

  // 4) 输出节点。一次只出一个：图片要 4 张也是全进同一张卡的画廊（与节点上直接生成一致），
  //    铺开成 4 个节点会让「要一组图」在画布上炸成一片
  const outputs = []
  const outputId = addNode(targetType.value, {
    x: center.x + 220,
    y: center.y - 40
  }, {
    label: KIND_TITLE[targetType.value] || '结果',
    model: selectedModel.value,
    sourceProvider: selectedProvider.value
  })
  addEdge({
    source: taskId,
    target: outputId,
    sourceHandle: OUTPUT_HANDLE,
    targetHandle: INPUT_HANDLE,
    type: 'flowEdge',
    data: { order: 1 }
  })
  outputs.push(outputId)
  endBatchOperation()

  nodes.value = nodes.value.map(node => ({ ...node, selected: outputs.includes(node.id) }))
  text.value = ''
  mentioned.value = []
}

/* 节点工具栏上的「编辑」按钮 → 把光标送进输入框（节点此时已被选中，模式已经对了） */
const onFocusComposer = () => {
  nextTick(() => {
    const el = inputRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}
watch(isParamlessNode, value => { if (value) composerExpanded.value = false })
onMounted(() => window.addEventListener('ling-canvas:focus-composer', onFocusComposer))
onBeforeUnmount(() => window.removeEventListener('ling-canvas:focus-composer', onFocusComposer))

/** composer 自身高度 + 上下留白：新建的节点要避开的区域 */
const COMPOSER_RESERVED_HEIGHT = 275

/**
 * 新建节点的落点：画布**去掉 composer 之后**的可用区域中心。
 *
 * 直接用视口正中会把节点送到 composer 底下去 —— 一句话出一组图时，输出节点
 * 有一半压在输入框后面。坐标换算由 Canvas 以 prop 传进来：composer 挂在
 * `<VueFlow>` 外面，自己再调一次 useVueFlow() 会拿到另一个实例，坐标是错的。
 */
const viewportCenter = () => {
  const el = document.querySelector('.canvas-flow')
  const rect = el?.getBoundingClientRect?.()
  if (!rect || !props.screenToFlow) return { x: 0, y: 0 }
  return props.screenToFlow({
    x: rect.left + rect.width / 2,
    y: rect.top + Math.max(120, rect.height - COMPOSER_RESERVED_HEIGHT) / 2
  })
}
</script>

<style scoped>
.composer-wrap {
  position: absolute;
  left: 50%;
  bottom: 20px;
  z-index: 120;
  width: min(840px, calc(100vw - 190px));
  transform: translateX(-50%);
  transition: transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.24s ease;
  will-change: transform;
}

/* 没选中节点时收下去：整条向下移出自己的高度 + 底部留白，再淡出。
   它 teleport 在 body 上、body 是 overflow:hidden，多出来的部分被裁掉，不会撑出滚动条。 */
.composer-wrap.is-hidden {
  transform: translate(-50%, calc(100% + 28px));
  opacity: 0;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .composer-wrap { transition: none; }
}

/* ---- 上下文 chip ---- */
.context-strip { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 12px 8px; }
.context-chip {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  background: var(--bg-secondary);
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
  font-size: 12px;
}
.context-chip-x {
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0;
}
.context-chip-x:hover { color: var(--text-primary); }

/* ---- 主体 ---- */
.composer {
  position: relative;
  padding: 11px 11px 8px;
  border: 1px solid var(--border-color);
  border-radius: 22px;
  background: color-mix(in srgb, var(--bg-secondary) 97%, transparent);
  box-shadow: 0 16px 48px rgba(19, 23, 30, 0.14), 0 1px 2px rgba(19, 23, 30, 0.05);
  backdrop-filter: blur(22px);
}

.prompt-references { display: flex; flex-wrap: wrap; gap: 6px; padding: 3px 7px 7px; }
.prompt-ref {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 3px 7px 3px 3px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
}
.prompt-ref img, .prompt-ref-thumb {
  display: block;
  width: 27px;
  height: 27px;
  object-fit: cover;
  border-radius: 7px;
  background: linear-gradient(145deg, #d9d4ce, #858b92);
}
.prompt-ref-x { border: 0; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 15px; padding: 0; }

/* 输入区保留多行编辑空间，发送按钮位于底部参数栏。 */
.compose-main { display: flex; align-items: flex-end; gap: 6px; }
.compose-input {
  min-width: 0;
  height: 120px;
  min-height: 120px;
  max-height: 240px;
  overflow-y: auto;
  flex: 1;
  resize: none;
  padding: 10px 38px 10px 8px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 14.5px;
  line-height: 1.45;
}
.compose-input::placeholder { color: var(--text-tertiary); }
/* 室内渲染选中时顶掉正文框的那句话：和输入框同高，按钮的中线才对得上 */
.compose-note {
  min-height: 42px;
  flex: 1;
  margin: 0;
  padding: 11px 8px;
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1.5;
}

.compose-attach, .compose-send {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 13px;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease, filter 0.14s ease, opacity 0.14s ease;
}
/* 附件是次要动作：不占视觉重量，悬停才浮出来 */
.compose-attach { background: transparent; color: var(--text-tertiary); }
.compose-attach:hover { background: var(--bg-tertiary); color: var(--text-secondary); }
.compose-attach svg { width: 21px; height: 21px; }

/* 这一栏在 .canvas-flow 之外，拿不到那里的 --flow-ok，补一份（两个主题各一套） */
.composer-wrap { --send-ok: #10b981; --send-ok-soft: rgba(16, 185, 129, 0.12); }
.dark .composer-wrap { --send-ok: #34d399; --send-ok-soft: rgba(52, 211, 153, 0.14); }

/* 发送：38px 正圆 + 1px 描边。
   原来是 42px 的纯黑方块（radius 13）—— 整条栏里唯一的重物，而且栏 22 / chip 8 /
   按钮 13 三套圆角并存。改成圆之后和 chip 的轻描边是同一套语言，重心回到输入框。
   底下的 2px 是把圆心抬到和 42px 的附件按钮同一水平线（两者都是 flex-end 对齐）。 */
.compose-send {
  width: 38px;
  height: 38px;
  margin-bottom: 2px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
}
.compose-send svg { width: 17px; height: 17px; }
.compose-send:hover { border-color: var(--text-tertiary); color: var(--text-primary); }
/* 真有东西可发时才填成实心 —— 它是这一栏唯一的主色块 */
.compose-send.is-ready {
  border-color: transparent;
  background: var(--text-primary);
  color: var(--bg-secondary);
}
.compose-send.is-ready:hover { filter: brightness(1.15); }
/* 运行中：形状与位置都不变，只把箭头换成"细环 + 实心方块"。
   从前是整块 #10b981 绿 + 白方块，读起来像录音键，而且绿色在别处是"成功"的意思。
   这里刻意**去掉按钮自己的描边** —— 留着的话环、描边、方块是三层同心圆，
   在 38px 里太挤；只留环，环本身就是"可以按下去停止"的边界。 */
.compose-send.is-busy {
  border-color: transparent;
  color: var(--send-ok);
}
.compose-send.is-busy svg { width: 21px; height: 21px; }
.compose-send.is-busy:hover { background: var(--send-ok-soft); }
.compose-send:disabled { cursor: not-allowed; opacity: 0.4; }
.compose-send:disabled:hover { border-color: var(--border-color); color: var(--text-secondary); }

/* 参数行：**无边框文字 chip**。
   原来是一排一模一样的灰盒子 + 9.5px 字，跟调试面板似的 —— 五个控件等权重，
   眼睛没有落点，输入框反而被压住了。现在去掉所有方框，只留文字 + 一个小箭头，
   悬停才给底色；整条栏里只有发送按钮是实心的。 */
/* 左缘和附件按钮对齐（都在 composer 的 9px 内边距上），不再是参差不齐的三条竖线 */
.compose-options { display: flex; align-items: center; gap: 12px; padding: 5px 0 2px; }
.compose-options .compose-send { margin-left: auto; }
.opt-left { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }

.node-type-pill {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 8px 0 10px;
  border-radius: 8px;
  transition: background-color 0.14s ease;
}
.node-type-pill:hover { background: var(--bg-tertiary); }
.node-type-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #10b981; }
.node-type-dot.tone-video { background: #f97316; }
.node-type-dot.tone-text { background: #6366f1; }

/* 下拉一律去壳：appearance:none 去掉原生外框，箭头用一张内联 SVG 画 */
.compose-select,
.node-type-select {
  height: 32px;
  padding: 0 19px 0 9px;
  border: 0;
  border-radius: 8px;
  outline: none;
  background-color: transparent;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  background-size: 10px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 500;
  appearance: none;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.compose-select:hover,
.node-type-select:hover { background-color: var(--bg-tertiary); color: var(--text-primary); }
.compose-select:disabled,
.node-type-select:disabled { cursor: not-allowed; opacity: 0.4; background-color: transparent; }
.node-type-select:disabled:hover { background-color: transparent; color: var(--text-secondary); }
/* 类型名比其他参数重一点：它是这一行里最需要被读到的一个 */
.node-type-select { font-weight: 650; }

/* 模型按钮：和参数按钮同样的无边框文字，只是内容换成模型名 */
.compose-model {
  display: flex;
  max-width: 200px;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.compose-model:hover,
.compose-model.is-open { background: var(--bg-tertiary); color: var(--text-primary); }
.compose-model.is-empty { color: var(--text-tertiary); }
.compose-model::after {
  content: '';
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 9px;
  transition: transform 0.16s ease;
}
.compose-model.is-open::after { transform: rotate(180deg); }

/* 预设按钮：前缀一个小星标，和模型/参数区分开 */
.compose-model.is-preset::after { content: none; }
.compose-model.is-preset .preset-glyph { color: #f0a14d; font-size: 12px; line-height: 1; }

/* 参数按钮：一句话摘要，点开是面板。和下拉同样是无边框文字，右边换成一个上箭头 */
.compose-params {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.compose-params:hover,
.compose-params.is-open { background: var(--bg-tertiary); color: var(--text-primary); }
.compose-params::after {
  content: '';
  width: 11px;
  height: 11px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 11px;
  transition: transform 0.16s ease;
}
.compose-params.is-open::after { transform: rotate(180deg); }

/* ---- @ 候选 ---- */
.mention-menu {
  position: absolute;
  bottom: 100%;
  left: 18px;
  right: 18px;
  z-index: 4;
  max-height: 230px;
  margin-bottom: 8px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  box-shadow: 0 14px 42px rgba(18, 22, 28, 0.16);
}
.mention-item {
  display: flex;
  width: 100%;
  height: 44px;
  align-items: center;
  gap: 9px;
  padding: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}
.mention-item:hover { background: var(--bg-tertiary); }
.mention-item img, .mention-thumb {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  object-fit: cover;
  border-radius: 7px;
  background: linear-gradient(145deg, #d9d4ce, #858b92);
}
.mention-copy b { display: block; font-size: 11px; }
.mention-copy span { display: block; margin-top: 2px; color: var(--text-tertiary); font-size: 9px; }
.mention-empty { padding: 14px; color: var(--text-tertiary); font-size: 11px; text-align: center; }
</style>

<style scoped>
.compose-expand { position: absolute; top: 10px; right: 12px; z-index: 2; display: grid; place-items: center; width: 28px; height: 28px; padding: 4px; border: 0; border-radius: 5px; color: var(--text-tertiary); background: transparent; cursor: pointer; }
.compose-expand svg { width: 20px; height: 20px; }
.compose-expand:hover { color: var(--text-primary); background: var(--bg-tertiary); }
.composer-wrap.is-expanded { position: fixed; inset: 0; left: 0; bottom: 0; width: 100%; height: 100%; transform: none; z-index: 250; display: flex; align-items: center; justify-content: center; padding: 26px; }
.compose-backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / 48%); backdrop-filter: blur(3px); }
.is-expanded .context-strip { display: none; }
.is-expanded .composer { display: flex; flex-direction: column; width: min(840px, 100%); height: min(720px, calc(100dvh - 52px)); min-height: 0; padding: 22px 14px 10px; border-radius: 16px; box-shadow: 0 20px 80px rgb(0 0 0 / 25%); }
.is-expanded .compose-expand { top: 10px; right: 12px; }
.is-expanded .prompt-references { padding-right: 38px; flex-shrink: 0; }
.is-expanded .compose-main { flex: 1; min-height: 0; margin-top: 18px; }
.is-expanded .compose-input { height: 100%; min-height: 0; max-height: none; padding: 8px; line-height: 1.65; }
.is-expanded .compose-options { flex-shrink: 0; padding-top: 12px; }
</style>
