<template>
  <!-- 室内渲染超级节点 | Interior render super node

       一张卡片 = 一整组子任务：上游每张图是一个**视角**，逐视角出图（N 进 N 出），
       共用同一套结构 / 人物 / 灯光 / 环境参数。

       和 task 节点的区别就在这：task 的 count 是「一个提示词出 N 张」，
       这里是「N 个视角各出 1 张」。所以：

       - 每个视角**只把自己那张图**送进模型 —— 送全部 N 张的话，模型要去猜复现哪个视角。
       - 串行而不是并发：useImageGeneration 只有一份 abortController 与 generationVersion，
         并发调用会互相踩掉取消状态。
       - 视角 ↔ 输出的对应关系存在 data.viewOutputIds 里，**不能用出边 order**
         （normalizeEdgeOrders 只按 target 分组，每个输出节点都是独立 target，
         所以出边 order 恒为 1，剪一次线就会静默塌掉）。

       原型：public/prototypes/interior-render/index.html -->
  <NodeFrame
    :node-id="id"
    tone="render"
    :title="data.label || '室内渲染'"
    :focused="focused"
    :always-expanded="renderFormOpen"
    :multi="multi"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :failed="!!data.error"
    :fail-text="data.error || ''"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
  >
    <template #body>
      <div v-if="!renderFormOpen" class="flow-render-compact">
        <img v-if="views[0]?.url" :src="views[0].url" alt="室内渲染视角预览">
        <div class="flow-render-compact-info">
          <span>{{ views.length ? `${views.length} 个视角` : '连接图片后配置室内渲染' }}</span>
          <button class="nodrag" type="button" @click.stop="renderFormOpen = true">编辑参数</button>
        </div>
      </div>
      <div v-else class="flow-render">
        <button class="flow-render-collapse nodrag" type="button" @click.stop="renderFormOpen = false">收起参数</button>
        <div class="flow-render-scroll nodrag">
          <div class="flow-render-mode">
            <button
              type="button"
              class="nodrag"
              :class="{ 'is-active': params.viewMode === 'single' }"
              @click="setField('viewMode', 'single')"
            >单视角</button>
            <button
              type="button"
              class="nodrag"
              :class="{ 'is-active': params.viewMode === 'multi' }"
              @click="setField('viewMode', 'multi')"
            >多视角</button>
          </div>

          <!-- --------------------------------------------- 视角缩略图网格 -->
          <div class="flow-render-views">
            <div class="flow-render-views-head">
              <span class="flow-render-views-title">多角度视角</span>
              <small v-if="views.length">已连接 {{ views.length }} 个</small>
              <small v-else>从左侧连入，或用下面的 ＋ 添加</small>
            </div>

            <!-- 列的是**全部**视角，不只是本次要跑的：单视角模式下被跳过的那几张
                 也要看得见（染灰 + 说明），否则"已连接 4 个却只跑 1 张"就成了静默丢任务 -->
            <div class="flow-render-tiles">
              <div
                v-for="(view, position) in views"
                :key="view.key"
                class="flow-render-tile"
                :class="`is-${viewState(position)}`"
                :title="tileTitle(position)"
              >
                <span class="flow-render-tile-hit">
                  <img v-if="view.url" :src="view.url" :alt="view.name">
                  <span v-else class="flow-render-tile-empty">缺图</span>
                </span>

                <span class="flow-render-tile-no">{{ view.index }}</span>

                <!-- 结果缩略图：真正的图在输出节点里，这里只当一个入口 -->
                <button
                  v-if="outputUrl(position)"
                  type="button"
                  class="flow-render-tile-out nodrag"
                  :title="`查看视角 ${view.index} 的效果图`"
                  @click="previewOutput(position)"
                ><img :src="outputUrl(position)" alt=""></button>

                <button
                  type="button"
                  class="flow-render-tile-act nodrag"
                  :disabled="busy || !view.url || isSkipped(position)"
                  :title="isSkipped(position)
                    ? '单视角模式下这个视角不跑，切回多视角再试'
                    : (view.url ? `只重新生成视角 ${view.index}` : '这个视角还没有图片')"
                  @click="runViews([position])"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11a8.5 8.5 0 1 0-2.4 6.1" /><path d="M20.5 4.5V11h-6.5" /></svg>
                </button>

                <!-- 删视角 = 把左侧那个图片节点一起删掉（见 removeView 的说明） -->
                <button
                  type="button"
                  class="flow-render-tile-act is-x nodrag"
                  :disabled="busy"
                  :title="`删除视角 ${view.index}，左侧对应的图片节点也会一起删掉`"
                  @click="removeView(position)"
                >×</button>
              </div>

              <!-- 卡片内补视角：会在左侧建一个真正的图片节点并连线，
                   不是塞一张图进卡片（见 onLocalFiles 的说明） -->
              <button
                type="button"
                class="flow-render-tile is-add nodrag"
                title="添加视角：左侧会自动生成一个图片节点并连进来"
                @click="localInput?.click()"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5" /><path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" /></svg>
              </button>
              <input ref="localInput" hidden type="file" accept="image/*" multiple @change="onLocalFiles">
            </div>
          </div>

          <RenderForm
            :params="params"
            :model-value="selectedModelOption?.optionId || ''"
            :model-options="modelOptions"
            :resolution-options="resolutionOptions"
            :resolution-hint="imageTier.note"
            @set="setField"
            @update:model="setModelOption"
            @upload="onUpload"
          />
        </div>

        <!-- 一整条通栏按钮：这张卡片上只有一个动作 —— 开始，或者停下。
             视角数量已经在缩略图那一行写过一次，按钮上不再重复（除非两个数不一样，
             见 submitLabel）。 -->
        <div class="flow-render-foot">
          <button
            type="button"
            class="flow-render-submit nodrag"
            :class="{ 'is-stop': busy }"
            :disabled="!busy && !canStart"
            @click="busy ? cancelGeneration() : runViews()"
          >{{ submitLabel }}</button>
        </div>
      </div>
    </template>
  </NodeFrame>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { NodeFrame } from './base'
import RenderForm from './render/RenderForm.vue'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { useNodeRunBridge } from '../../composables/useNodeRunBridge'
import { useImageGeneration } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import { useMediaViewer } from '../../composables/useMediaViewer'
import {
  nodes, edges, inEdges, addNode, addEdge, updateNode, updateNodeMeta, duplicateNode,
  removeNode, setNodeMedia, startBatchOperation, endBatchOperation
} from '../../stores/canvas'
import { INPUT_HANDLE, OUTPUT_HANDLE, getAcceptLimit } from '../../config/nodeRegistry'
import { buildNodeNotices } from '../../utils/nodeNotices'
import { approximateRatio, findSizeByRatio } from '../../utils/ratio'
import { resolveImageTierOptions, imageTierLockNote } from '../../utils/imageTiers'
import { isLikelyTextModel } from '../../composables/useModelGuard'
import { readParams, validateRenderParams, buildRenderPrompt } from '../../utils/renderPrompt'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { slots } = useNodeRefs(props.id)
const focused = useFocusExpanded(props.id)
const multi = useMultiSelected(props.id)
// 室内渲染是参数表单节点：创建后直接显示完整表单，用户仍可手动收起。
const renderFormOpen = ref(true)
const { open: openViewer } = useMediaViewer()
const { updateNodeInternals } = useVueFlow()

/**
 * 新节点建好后的共同收尾 | Post-create stamp
 *
 * 和 Canvas.vue 的 stampImageNode 是同一件事，理由也一样：**Vue Flow 只在一个节点
 * 量到尺寸（node.dimensions）之后才让它可见** —— NodeWrapper 渲染的样式是
 * `visibility: dimensions ? 'visible' : 'hidden'`，而刚建出来的节点尺寸是 0。
 * 补量靠的是它自己的 ResizeObserver，但在本项目里不可靠（全项目十几处建节点路径
 * 都在 50ms 后手动催一次 updateNodeInternals，就是这个原因）。少了这一步，
 * 新节点要刷新一次才现身 —— 边还在、位置也对，因为边端点用的是手上那份尺寸。
 *
 * 顺手把 zIndex 顶到最上：新节点不该被已有节点压住。
 */
const stampNode = (nodeId) => {
  const maxZIndex = Math.max(0, ...nodes.value.map(node => node.zIndex || 0))
  updateNodeMeta(nodeId, { zIndex: maxZIndex + 1 })
  setTimeout(() => updateNodeInternals(nodeId), 50)
  return nodeId
}

const modelStore = useModelStore()
const { loading: imageLoading, generate: generateImage, stop: stopImage } = useImageGeneration()

const running = ref(false)

/**
 * 预检已经开始、但还没发出第一个请求 | Preflight has reserved the run
 *
 * 这一段必须**同步**占住。从点击到真正发请求之间隔着：人物/外景参考图探活、
 * N 张原图量比例、建输出节点 —— 全是 await，整段里 `running` 还是 false、
 * `imageLoading` 也还是 false，于是 `busy` 是 false。而卡片底部的按钮和底部
 * composer 的发送键是**两个入口**（composer 的"停止"态也读节点上的 `loading`，
 * 同样是最后一个 await 之后才写上去的），这段时间里再点一次就会再进一轮 runViews。
 *
 * 两轮共用同一份 useImageGeneration（一个 abortController、一个 generationVersion），
 * 后一轮会把前一轮在飞的请求顶成 AbortError，而循环遇到 AbortError 是 break ——
 * 表现就是「连了 4 张，只出了 1 张」。还会各自建一套输出节点。
 */
const starting = ref(false)
const busy = computed(() => running.value || starting.value || imageLoading.value)
/** 当前正在跑的视角位置（0 基），-1 = 没有 */
const runningPosition = ref(-1)
/** 取消标志：串行循环每轮检查一次 */
const cancelled = ref(false)

/* ------------------------------------------------------------------ 参数 */
/** 一套参数，全部视角共用（见 RenderForm 顶部的说明） */
const params = computed(() => readParams(props.data))

/**
 * 视角 = 入边。**不按 url 过滤** —— 连了但还没图的上游必须占住序号，
 * 否则输出与视角的对应关系会在用户脚下错位。缺图在校验里拦。
 *
 * 序号就是入边顺序（`edge.data.order`），卡片里补图也是走同一条路：新建一个图片节点
 * 再连线，而不是在卡片内藏一张图。这样「视角」在画布上和卡片里是同一个东西 ——
 * 看得到、连得上、剪得断，也才会走正常节点那套持久化。
 */
const views = computed(() => slots.value
  .filter(slot => slot.kind === 'image')
  .map((slot, index) => ({
    index: index + 1,
    key: slot.edge.id,
    /** 画布上那个图片节点的 id —— 删视角就是删它（见 removeView） */
    nodeId: slot.src?.id || '',
    url: slot.src?.data?.url || '',
    name: slot.src?.data?.label || `视角 ${index + 1}`
  })))

/** 本次要跑的视角：单视角模式只跑第一个 */
const activeViews = computed(() => (
  params.value.viewMode === 'single' ? views.value.slice(0, 1) : views.value
))

/** 连进来的文本上游正文，接在提示词末尾（与全画布「连线即使用」一致） */
const upstreamTexts = computed(() => slots.value
  .filter(slot => slot.kind === 'text')
  .map(slot => String(slot.src?.data?.content || '').trim())
  .filter(Boolean))

/* ------------------------------------------------------------ 模型与渠道 */
const modelOptions = computed(() => modelStore.groupedImageModelOptions || [])
const selectedModel = computed(() => {
  const configured = new Set(modelOptions.value.map(option => option.value))
  if (configured.has(props.data?.model)) return props.data.model
  const fallback = modelStore.selectedImageModel
  if (configured.has(fallback)) return fallback
  return modelOptions.value[0]?.value || ''
})
const selectedModelOption = computed(() => modelOptions.value.find(o => o.value === selectedModel.value
  && o.sourceProvider === props.data?.sourceProvider) || modelOptions.value.find(o => o.value === selectedModel.value))
const setModelOption = (optionId) => {
  const option = modelOptions.value.find(item => item.optionId === optionId)
  if (option) updateNode(props.id, { model: option.value, sourceProvider: option.sourceProvider })
}
const providerId = computed(() => (
  modelStore.resolveModelSourceProvider(selectedModel.value, 'IMAGE', props.data?.sourceProvider)
  || selectedModelOption.value?.sourceProvider
  || ''
))
const providerLabel = computed(() => (
  providerId.value ? (modelStore.getProviderConfigById(providerId.value)?.label || providerId.value) : ''
))
const hasProviderKey = computed(() => Boolean(providerId.value) && Boolean(modelStore.getApiKeyByProvider(providerId.value)))
const currentModel = computed(() => modelStore.getImageModel?.(selectedModel.value, providerId.value))

const imageTier = computed(() => {
  const upstream = modelStore.resolveUpstreamContext(providerId.value)
  const args = {
    model: currentModel.value,
    modelKey: selectedModel.value,
    providerConfig: upstream.providerConfig,
    baseUrl: upstream.baseUrl
  }
  return { options: resolveImageTierOptions(args), note: imageTierLockNote(args) }
})
const resolutionOptions = computed(() => imageTier.value.options)
/** 把参数里的清晰度收敛到当前模型支持的档位 */
const resolutionFor = (viewParams) => {
  const wanted = String(viewParams.resolution || '').toUpperCase()
  return resolutionOptions.value.includes(wanted) ? wanted : (resolutionOptions.value[0] || wanted)
}

/* ------------------------------------------------------------ 状态与提示 */
const notices = computed(() => buildNodeNotices(props.data))

const statusText = computed(() => {
  if (busy.value) return `生成中 ${Math.max(runningPosition.value + 1, 1)}/${activeViews.value.length}`
  if (props.data?.error) return '失败'
  return activeViews.value.length ? '已就绪' : '未接入'
})
const statusClass = computed(() => {
  if (busy.value) return 'is-busy'
  if (props.data?.error) return 'is-fail'
  return activeViews.value.length ? 'is-ok' : ''
})

const canStart = computed(() => activeViews.value.length > 0 && !props.data?.error)

/**
 * 按钮文案：只有「要跑的」和「已连接的」不是一个数时才报张数。
 * 多视角下这两个数相等，重复缩略图那一行没有信息量；单视角下 4 张连进来只跑 1 张，
 * 这里必须写明白，否则就成了静默丢任务。
 */
const submitLabel = computed(() => {
  if (busy.value) return '停止'
  return activeViews.value.length === views.value.length
    ? '生成'
    : `生成 ${activeViews.value.length} 张效果图`
})

/**
 * 某个结果节点的归属标记 | Output ownership marker
 *
 * viewOutputIds 只是一串 id，光靠它认不出「这是我的产物」还是「我复制来的别人的产物」：
 * duplicateNode 会把出边一并复制（canvas.js:494-497），所以副本的 viewOutputIds 和
 * 出边都真实存在、却指着原节点的结果。生成时若照单认领，副本会把原节点的输出抢过去。
 * 归属标记写在结果节点的 data 上，跟着节点走，不受复制影响。
 */
const isOwnOutput = (node) => Boolean(node) && String(node.data?.ownerId) === String(props.id)

const outputNode = (position) => {
  const id = props.data?.viewOutputIds?.[position]
  const node = id ? nodes.value.find(item => String(item.id) === String(id)) : null
  return isOwnOutput(node) ? node : null
}
const outputUrl = (position) => outputNode(position)?.data?.url || ''

/**
 * 单视角模式下被跳过的视角 | Views skipped by single-view mode
 *
 * 缩略图网格列的是**全部**视角（见模板），不只是本次要跑的 —— 否则切到单视角后
 * 网格里只剩一张，用户看着"已连接 4 个"却只跑了一张，就成了静默丢任务。
 * 被跳过的那几张照常显示、染成灰的，并说明「单视角模式已跳过」。
 */
const isSkipped = (position) => params.value.viewMode === 'single' && position > 0

const viewState = (position) => {
  if (isSkipped(position)) return 'skipped'
  if (runningPosition.value === position) return 'running'
  if (props.data?.viewErrors?.[position]) return 'failed'
  return outputUrl(position) ? 'done' : 'idle'
}
const viewStateText = (position) => {
  const state = viewState(position)
  if (state === 'running') return '渲染中…'
  if (state === 'skipped') return '单视角模式已跳过'
  if (state === 'failed') return props.data.viewErrors[position] || '失败'
  if (state === 'done') return '已完成'
  return views.value[position]?.url ? '待生成' : '缺图片'
}

/* ------------------------------------------------------------------ 编辑 */
/** 缩略图悬停文案：名字 + 状态 */
const tileTitle = (position) => {
  const view = views.value[position]
  if (!view) return ''
  return `${view.name} · ${viewStateText(position)}`
}

/**
 * 写一个参数。
 *
 * **所有控件都必须走这里，不能 v-model 绑 props.data** —— 直接改 store 对象会绕过
 * updateNode 的存档与撤销栈，编辑会在重载后静默消失、Ctrl+Z 也看不见。
 */
const setField = (key, next) => { updateNode(props.id, { [key]: next }) }

// 档位选项会随「渠道 + 模型」变（渠道吞档位时只剩 1K）。
// 存档里那一档若已不在选项里，原生 <select> 会显示空白 —— 落回第一档并写回节点。
watch(resolutionOptions, (options) => {
  const saved = String(props.data?.resolution || '').toUpperCase()
  if (saved && options.length && !options.includes(saved)) setField('resolution', options[0])
}, { immediate: true })

/**
 * 参考图走 blob URL 而不是 data URL。
 *
 * 节点 data 一旦存进 base64 就会进项目序列化，几张图就能撑爆 localStorage 配额
 * （SimpleImageNode 的注释里踩过同一个坑）。代价是重载后 blob 失效，
 * 所以生成前会探活一次，失效就明确提示重新上传，而不是拿一张死图去请求。
 */
const onUpload = ({ kind, file }) => {
  if (!file?.type?.startsWith('image/')) {
    window.$message?.warning('请选择图片文件')
    return
  }
  const url = URL.createObjectURL(file)
  updateNode(props.id, kind === 'person'
    ? { personImage: url, personImageName: file.name }
    : { outsideImage: url, outsideImageName: file.name })
  window.$message?.success(kind === 'person' ? '人物参考图已添加，整组视角共用' : '外景参考图已添加')
}

const previewOutput = (position) => {
  const url = outputUrl(position)
  if (url) openViewer({ url, kind: 'image', alt: `视角 ${position + 1} 效果图` })
}

/* ------------------------------------------------------------ 卡片内补视角 */
const localInput = ref(null)

/**
 * 删一个视角 = 删掉左侧那个图片节点。
 *
 * 视角就是入边，入边没了视角就没了 —— 反过来把卡片里的缩略图抹掉而留着节点，
 * 下次生成时它又会从入边里长回来。所以这里删的是节点本身。
 *
 * 副作用要知道：**这个图片节点如果还连到别的节点上，一起没**。既然视角等价于
 * 画布上的节点，那它就跟其他节点一样只有一份，不存在「只从这个卡片里摘掉」。
 *
 * 输出映射是位置式的，得跟着 splice 一格；输出节点本身只增不删（里面可能有结果），
 * 所以删完之后那张图还在画布上，只是不再和视角对应了。
 */
const removeView = (position) => {
  const view = views.value[position]
  if (!view?.nodeId) return

  const ids = [...(props.data?.viewOutputIds || [])]
  ids.splice(position, 1)
  const errors = [...(props.data?.viewErrors || [])]
  errors.splice(position, 1)

  // 一次用户动作 = 一步撤销：映射前移和删节点必须裹在同一个批次里
  startBatchOperation()
  updateNode(props.id, { viewOutputIds: ids, viewErrors: errors })
  removeNode(view.nodeId)
  endBatchOperation()
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
  reader.readAsDataURL(file)
})

/**
 * 从卡片里补一张视角图 | Add a view from inside the card
 *
 * **建的是画布上真正的图片节点**，不是一个藏在 data 里的 blob。早先那版把图存在
 * `data.localImages` 上，代价是：画布左侧空着（看着像没连上）、blob 不进项目序列化
 * （重开项目就没了）、以及「卡片内的视角」和「连线来的视角」是两套东西，序号与删除
 * 各自维护。现在补图就是建节点 + 连线，视角只有一种来源。
 *
 * 新节点落在**现有上游那一列的下面**、输入口左侧，所以扇入是竖着长的一条，
 * 不会盖住已经连好的那些。
 */
const onLocalFiles = async (event) => {
  const files = Array.from(event.target.files || []).filter(file => file.type?.startsWith('image/'))
  event.target.value = ''
  if (!files.length) {
    window.$message?.warning('请选择图片文件')
    return
  }

  const self = nodes.value.find(node => String(node.id) === String(props.id))
  const slotCount = views.value.length
  const limit = getAcceptLimit(self, 'image')
  if (slotCount + files.length > limit) {
    window.$message?.warning(`最多 ${limit} 个视角，当前已有 ${slotCount} 个`)
    return
  }

  const payloads = []
  for (const file of files) {
    try {
      payloads.push({
        name: file.name.replace(/\.[^.]+$/, '') || '视角',
        dataUrl: await fileToDataUrl(file)
      })
    } catch {
      // 读不出来的那张跳过，别把整批拖垮
    }
  }
  if (!payloads.length) {
    window.$message?.warning('图片读取失败，请重新选择')
    return
  }

  const sources = inEdges(props.id)
    .map(edge => nodes.value.find(node => String(node.id) === String(edge.source)))
    .filter(Boolean)
  const nodeWidth = self?.measured?.width || 400
  const columnX = sources.length
    ? Math.min(...sources.map(node => node.position?.x || 0))
    : (self?.position?.x || 0) - nodeWidth - 110
  const startY = sources.length
    ? Math.max(...sources.map(node => node.position?.y || 0)) + 300
    : (self?.position?.y || 0)
  // 入边顺序就是视角序号，新边要接在最后一条之后（addEdge 自己不重排，得自己算）
  const nextOrder = Math.max(0, ...inEdges(props.id).map(edge => Number(edge.data?.order) || 0)) + 1

  startBatchOperation()
  payloads.forEach((item, index) => {
    const newId = stampNode(addNode('image', { x: columnX, y: startY + index * 300 }, { label: item.name }))
    setNodeMedia(newId, { url: item.dataUrl, base64: item.dataUrl, fileName: item.name })
    addEdge({
      source: newId,
      target: props.id,
      sourceHandle: OUTPUT_HANDLE,
      targetHandle: INPUT_HANDLE,
      type: 'flowEdge',
      data: { order: nextOrder + index }
    })
  })
  endBatchOperation()

  window.$message?.success(payloads.length === 1 ? '已添加 1 个视角' : `已添加 ${payloads.length} 个视角`)
}

/* ---------------------------------------------------------------- 生成 */
/** 量一张图的真实比例；blob 失效或读不到返回 ok: false */
const probeImage = (url) => new Promise((resolve) => {
  if (!url) return resolve({ ok: false, ratio: '' })
  const image = new Image()
  image.onload = () => resolve({
    ok: true,
    ratio: approximateRatio(image.naturalWidth / image.naturalHeight)
  })
  image.onerror = () => resolve({ ok: false, ratio: '' })
  image.src = url
})

const hasEdgeTo = (nodeId) => edges.value.some(edge => (
  String(edge.source) === String(props.id) && String(edge.target) === String(nodeId)
))

/** 输出节点之间的最小纵向间距：原图挨太近时不许结果叠在一起 */
const OUTPUT_MIN_GAP = 300

/**
 * 每个视角相对最上面那张原图的纵向偏移 | Vertical offset per view
 *
 * **左侧怎么排，右侧就怎么排**：输出节点纵向对齐它对应的那张原图，而不是按序号等距
 * 摊开，原图高低错落时结果也跟着错落，一眼能把「哪张原图出了哪张结果」对上。
 *
 * 但保留一个最小间距：几张原图挨得很近时，照搬偏移会让输出节点叠在一起 ——
 * 结果比原图值钱，宁可错开。
 */
const outputOffsets = () => {
  const sourceY = views.value.map((view) => {
    const node = nodes.value.find(item => String(item.id) === String(view.nodeId))
    return node?.position?.y
  })
  const known = sourceY.filter(value => Number.isFinite(value))
  const base = known.length ? Math.min(...known) : 0
  let previous = -Infinity
  return sourceY.map((value, index) => {
    const offset = Number.isFinite(value) ? value - base : index * OUTPUT_MIN_GAP
    previous = Math.max(offset, previous + OUTPUT_MIN_GAP)
    return previous
  })
}

/**
 * 补足式建输出节点 | Top up output nodes
 *
 * 收的是**视角位置列表**而不是「前 N 个」：单张重生成只跑一个视角，
 * 按数量建的话那个位置会被当成 0，第 3 视角的图会落进第 1 个输出节点里。
 *
 * 与 TaskNode 的版本还有三处不同：
 * 1. **补足而不是「有就不建」** —— 视角从 2 涨到 4 时要接着建。
 * 2. 认领以**归属标记**为准（见 isOwnOutput），不是 id 也不是出边：副本带着原节点的
 *    viewOutputIds 与出边过来，靠 id 或出边都会把原节点的结果抢走。
 * 3. **只增不删** —— 视角变少时旧输出留在画布上（里面可能有结果），不静默孤立。
 *
 * @param {number[]} positions 要保证有输出节点的视角位置（0 基）
 * @param {string[]} ratios 按**位置**索引的原图比例
 */
const ensureOutputs = (positions, ratios) => {
  const self = nodes.value.find(node => String(node.id) === String(props.id))
  const ids = [...(props.data?.viewOutputIds || [])]
  const width = self?.measured?.width || 400
  const offsets = outputOffsets()
  let touched = false

  startBatchOperation()
  positions.forEach((position) => {
    const existing = ids[position] ? nodes.value.find(n => String(n.id) === String(ids[position])) : null
    if (existing?.type === 'image' && isOwnOutput(existing)) {
      // 用户可能剪断过这条出边 —— 补回来，但绝不重建节点（里面可能有结果）
      if (!hasEdgeTo(existing.id)) {
        addEdge({
          source: props.id,
          target: existing.id,
          sourceHandle: OUTPUT_HANDLE,
          targetHandle: INPUT_HANDLE,
          type: 'flowEdge',
          data: { order: 1 }
        })
      }
      return
    }

    const newId = stampNode(addNode('image', {
      x: (self?.position?.x || 0) + width + 110,
      // 纵向跟着**它那张原图**走（不是本次跑的第几个）—— 单张重生成时输出也该落在它那一行
      y: (self?.position?.y || 0) + (offsets[position] ?? position * OUTPUT_MIN_GAP)
    }, {
      label: `视角 ${position + 1}`,
      ratio: ratios?.[position] || null,
      loading: true,
      ownerId: props.id
    }))
    addEdge({
      source: props.id,
      target: newId,
      sourceHandle: OUTPUT_HANDLE,
      targetHandle: INPUT_HANDLE,
      type: 'flowEdge',
      data: { order: 1 }
    })
    ids[position] = newId
    touched = true
  })
  endBatchOperation()

  if (touched) updateNode(props.id, { viewOutputIds: ids })
  return positions.map(position => nodes.value.find(n => String(n.id) === String(ids[position])) || null)
}

const cancelGeneration = () => {
  cancelled.value = true
  stopImage()
  running.value = false
  runningPosition.value = -1
  updateNode(props.id, { loading: false })
}

const requireProvider = () => {
  if (!selectedModel.value) {
    window.$message?.warning('请先前往设置，在模型配置中启用图片模型')
    return false
  }
  if (!providerId.value) {
    window.$message?.warning('该模型未绑定供应商，请在设置中重新启用这个模型')
    return false
  }
  if (!hasProviderKey.value) {
    window.$message?.warning(`请先在设置中为「${providerLabel.value}」配置 API Key`)
    return false
  }
  if (isLikelyTextModel(selectedModel.value)) {
    window.$message?.warning(`「${selectedModel.value}」是文本模型，不能生成图片`)
    return false
  }
  return true
}

/**
 * 跑一批视角 | Run a batch of views
 * @param {number[]} [positions] 只跑这几个位置（单张重生成）；不传 = 全部
 */
const runViews = async (positions) => {
  // 同步占位，见 starting 的说明 —— 这里必须第一个判断，且在任何 await 之前
  if (busy.value) return
  starting.value = true
  cancelled.value = false

  try {
    const all = activeViews.value
    const targets = Array.isArray(positions)
      ? positions.filter(position => all[position])
      : all.map((_, index) => index)

    if (!targets.length) {
      window.$message?.warning('请先从左侧连入空间参考图')
      return
    }

    // 花钱之前把能拦的都拦住
    const missing = targets.filter(position => !all[position].url)
    if (missing.length) {
      window.$message?.warning(`视角 ${missing.map(p => all[p].index).join('、')} 还没有图片`)
      return
    }

    // 一套参数全视角共用，所以校验只需要跑一遍 —— 不过就是整批不跑
    const verdict = validateRenderParams(params.value)
    if (!verdict.ok) {
      updateNode(props.id, { error: verdict.message, errorKind: 'preflight' })
      window.$message?.error(verdict.message)
      return
    }

    if (!requireProvider()) return

    // 参考图是 blob URL 时，重载后可能已经失效 —— 探活一次，别拿死图去请求
    if (params.value.person && params.value.personImage && !(await probeImage(params.value.personImage)).ok) {
      window.$message?.warning('人物参考图已失效（多半是重新打开项目导致），请重新上传')
      return
    }
    if (params.value.outsideImage && !(await probeImage(params.value.outsideImage)).ok) {
      window.$message?.warning('外景参考图已失效（多半是重新打开项目导致），请重新上传')
      return
    }
    if (cancelled.value) return

    // 量比例必须在建输出节点之前完成：卡片宽度按比例定，晚写会让卡片高矮跳一次
    const probes = await Promise.all(all.map(view => probeImage(view.url)))
    const ratios = probes.map(probe => probe.ratio)
    if (cancelled.value) return

    const outputs = ensureOutputs(targets, ratios)
    const viewErrors = [...(props.data?.viewErrors || [])]

    /*
     * 原图读不到的视角就别拿去请求了。
     *
     * `probeImage` 就是拿一个 <img> 去加载它 —— 读不到 = 这个地址在本机已经死了
     * （本地上传的图存的是 blob:，重开项目之后必然失效）。这种图发给厂商只会换来
     * 一句「参考图内容为空」或者一个 400，而且**它排在队列第几位就崩第几位**，
     * 现象就是「前面那张出来了，后面某一张没出来」这种没头没尾的报错。
     * 和上面人物 / 外景参考图是同一个坑，处理方式也保持一致：说清楚，然后跳过 ——
     * 只跳过这一张，其余照跑。
     */
    const plan = []
    targets.forEach((position, index) => {
      const output = outputs[index]
      if (probes[position]?.ok) {
        plan.push({ position, output })
        return
      }
      const message = '原图读不到（多为重新打开项目导致），请重新上传这张图'
      viewErrors[position] = message
      // 已经有图的结果节点不写这条 error：那会让一张好图挂上"失败"的表头。
      // 这次没出图照样记在 viewErrors 上，缩略图和汇总提示都会说。
      if (output) updateNode(output.id, output.data?.url ? { loading: false } : { loading: false, error: message })
    })

    if (!plan.length) {
      outputs.forEach(output => output && updateNode(output.id, { loading: false }))
      updateNode(props.id, { viewErrors })
      window.$message?.warning('所有视角的原图都读不到，请重新上传后再生成')
      return
    }

    if (plan.length === 1 && plan[0].output) updateNode(plan[0].output.id, { loading: true })

    running.value = true
    starting.value = false
    updateNode(props.id, { loading: true, error: '' })

    let ok = 0
    /** 已经轮到的视角数（取消时用来摘掉没轮到的那些"生成中"） */
    let cursor = 0

    for (let i = 0; i < plan.length; i += 1) {
      if (cancelled.value) break
      const { position, output } = plan[i]
      cursor = i + 1
      runningPosition.value = position
      updateNode(props.id, { viewErrors })

      try {
        const results = await generateImage({
          model: selectedModel.value,
          prompt: [...buildRenderPrompt(params.value), ...upstreamTexts.value].join('\n'),
          // 模型带 sizes 表就用表里的像素尺寸；没有（或没有接近的比例）就把**量出来的
          // 比例本身**传下去（'3:4'）。绝不能留空 —— 留空等于告诉厂商"比例你定"，
          // 于是 3:4 的原图会被出成它自己的默认比例（常见就是 16:9）。
          // SimpleImageNode / TaskNode 都是这个兜底，这里以前漏了。
          size: findSizeByRatio(currentModel.value?.sizes || [], ratios[position]) || ratios[position],
          resolution: resolutionFor(params.value),
          n: 1,
          image: [all[position].url, params.value.personImage, params.value.outsideImage].filter(Boolean)
        }, { providerId: providerId.value })

        const url = (Array.isArray(results) ? results : []).find(item => item?.url)?.url
        if (!url) throw new Error('接口未返回图片地址')

        if (output) {
          // 输出节点自己存 url；同时也留一份在 viewErrors 位置上清空旧错误
          updateNode(output.id, { url, loading: false, ratio: ratios[position], updatedAt: Date.now() })
        }
        viewErrors[position] = ''
        ok += 1
      } catch (err) {
        // 取消导致的中断不算失败，也不要打断后面的视角
        if (err?.name === 'AbortError' || cancelled.value) {
          if (output) updateNode(output.id, { loading: false })
          break
        }
        const message = err?.message || '生成失败'
        viewErrors[position] = message
        if (output) updateNode(output.id, { loading: false, error: message })
      }
    }

    running.value = false
    runningPosition.value = -1
    updateNode(props.id, { loading: false, viewErrors })

    // 取消时后面那些视角一个请求都没发出去，但它们的输出节点是带着 loading 建的，
    // 不挨个摘下来就会永远转下去
    plan.slice(cursor).forEach(({ output }) => {
      if (output) updateNode(output.id, { loading: false })
    })

    const failed = targets.filter(position => viewErrors[position]).length
    // 中途停下必须明说 —— 不然「4 个视角只出了 1 张」看起来像静默失败
    if (cancelled.value) window.$message?.info(`已停止：本次完成 ${ok} / ${targets.length}`)
    else if (failed) window.$message?.warning(`已完成 ${ok} / ${targets.length}，${failed} 个视角没出图，原因在各结果节点上`)
    else window.$message?.success(`已完成 ${ok} 张效果图`)
  } finally {
    // 预检抛错时也必须摘掉，否则卡片会永远停在"生成中"
    starting.value = false
    running.value = false
    runningPosition.value = -1
  }
}

// composer 的发送键驱动同一套循环；卡片内的按钮直接调本地函数，不需要过桥
useNodeRunBridge(props.id, { run: () => runViews(), cancel: cancelGeneration })

/**
 * 卸载时必须掐掉循环。
 *
 * useImageGeneration 自己没注册 onUnmounted(stop)，所以删掉节点或切项目
 * （Canvas.vue 的 flowKey 会重挂 VueFlow）之后，循环会继续对着已经不存在的节点
 * 一轮轮发付费请求。
 */
onBeforeUnmount(() => {
  cancelled.value = true
  stopImage()
})

const duplicateAndRefresh = () => { duplicateNode(props.id) }
const remove = () => { removeNode(props.id) }
</script>
