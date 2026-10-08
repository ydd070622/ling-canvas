<template>
  <!-- 节点外壳 | Node frame
       按原型 infinite_canvas_node_system_v25.html 的卡片结构：**只有两种状态**。

       - **内容态**（没选中）：只剩内容本身，没有底色 / 描边 / 阴影 / 表头 / 底部。
       - **焦点态**（恰好选中这一个）：内容 + 表头（类型 + 标题 + 状态）+ 底部一行
         （类型名 + 尺寸/时长 + 生成按钮）。

       卡片上**不放任何参数控件**：模型 / 比例 / 张数 / 清晰度 / 提示词全部走底部 composer。
       表头、底部、工具栏都用 v-if 控制，所以尺寸变化只发生在选中态切换的那一刻。

       端口在任何状态下都渲染（靠 opacity 隐藏，见 NodePort 的说明）。 -->
  <div
    class="flow-node-outer"
    :class="[
      `flow-node-${tone}`,
      expanded ? 'is-expanded' : 'is-compact',
      { 'is-focused': focused, 'is-multi': multi, 'is-dropzone': dragOver }
    ]"
    :style="cardStyle"
    @dragover="onDragOver"
    @dragleave="dragOver = false"
    @drop="onDrop"
  >
    <!-- 焦点态（恰好选一个）才出现。
         多选时的批量操作走画布顶部那条 selection-action-bar，不在这里。 -->
    <NodeToolbar v-if="focused">
      <div class="flow-tb-group">
<button
          v-if="uploadable"
          class="flow-tool-btn nodrag"
          type="button"
          :title="uploadTitle"
          @click="emit('upload')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg><span>上传</span>
        </button>
<button v-if="viewable && tone !== 'image'" class="flow-tool-btn nodrag" type="button" title="查看" @click="emit('view')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg><span>预览</span>
        </button>
        <button v-if="tone === 'image' && mediaUrl" class="flow-tool-btn nodrag" type="button" title="裁切图片" @click="emit('crop')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3v14h14M3 7h14v14" /></svg><span>裁切</span>
        </button>
        <button v-if="tone === 'image' && mediaUrl" class="flow-tool-btn nodrag" type="button" title="圈选物体，生成透明背景图片" @click="emit('cutout')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 19c-4-2-5-6-3-10s8-6 12-3 3 9-1 11-8 0-8 4 5 2 6 0" /></svg><span>抠图</span>
        </button>
<button v-if="editable" class="flow-tool-btn nodrag" type="button" title="编辑提示词" @click="emit('edit')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="M13.5 6.5 17.5 10.5" /></svg><span>编辑提示词</span>
        </button>
<button class="flow-tool-btn nodrag" type="button" title="创建副本" @click="emit('duplicate')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2.2" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></svg><span>复制</span>
        </button>
<div v-if="(tone === 'image' && mediaUrl) || (viewable && mediaUrl)" class="flow-tb-sep"></div>
<button
          v-if="tone === 'image' && mediaUrl"
          class="flow-tool-btn nodrag"
          type="button"
          title="发送到智能体"
          @click="emit('send-to-agent')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" /><path d="M12 13V8" /><path d="M9.5 10.5 12 8l2.5 2.5" /></svg><span>智能体</span>
        </button>
<button
          v-if="viewable && mediaUrl"
          class="flow-tool-btn nodrag"
          type="button"
          :title="downloading ? '正在保存…' : '保存到本地'"
          :disabled="downloading"
          @click="saveMedia"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11" /><path d="M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></svg><span>{{ downloading ? '保存中…' : '下载' }}</span>
        </button>
        <button v-if="tone === 'image' && mediaUrl" class="flow-tool-btn nodrag" type="button" @click="saveLocal"><span>本地空间</span></button>
</div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn flow-tool-danger nodrag" type="button" title="删除" @click="emit('remove')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M10 4h4M6.5 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7" /></svg><span>删除</span>
        </button>
      </div>
    </NodeToolbar>

    <div class="flow-card" :class="{ 'flow-card-failed': failed }">
      <!-- 内容态的节点没有表头，"这是什么"就全靠这个角标说。
           焦点态不显示：那时表头已经写着同样的东西，再来一遍是重复。 -->
      <span v-if="!expanded" class="flow-zoom-tag">
        <span class="flow-zoom-tag-icon" v-html="NODE_ICONS[tone]"></span>
        <span class="flow-zoom-tag-name">{{ compactLabel || typeLabel }}</span>
      </span>
      <span v-if="!expanded && mediaDetails" class="flow-media-details">{{ mediaDetails }}</span>
      <div v-if="!expanded && $slots['header-actions']" class="flow-header-actions"><slot name="header-actions" /></div>

      <div v-if="expanded" class="flow-card-head">
        <span class="flow-head-left">
          <span class="flow-head-dot" :class="`flow-tone-${tone}`"></span>
          <span
            ref="titleRef"
            class="flow-head-title"
            title="双击重命名"
            @dblclick="startRename"
          >{{ title }}</span>
        </span>
        <span class="flow-head-right">
          <slot name="header-actions" />
          <!-- 失败的原因挂在悬停上，不占正文：底部栏那条 toast 已经报过一次了 -->
          <span class="flow-status" :class="statusClass" :title="failed ? failText : ''"><i></i>{{ statusText }}</span>
        </span>
      </div>

      <div
        v-for="(notice, index) in notices"
        v-show="expanded"
        :key="index"
        class="flow-notice"
        :class="`is-${notice.kind}`"
      >
        <span class="flow-notice-text">{{ notice.text }}</span>
        <button
          v-for="action in notice.actions"
          :key="action.act"
          type="button"
          :class="{ 'is-ghost': action.ghost }"
          @click="emit('notice-action', action.act)"
        >{{ action.label }}</button>
      </div>

      <div class="flow-card-body">
        <div class="flow-stage"><slot name="body" /></div>
      </div>

      <!-- 内容态：表头、提示条都收起来了，但"这节点出错了"不能一起收掉，
           否则一张失败的卡片看起来和正常的一模一样 -->
      <span
        v-if="!expanded && (failed || notices.length)"
        class="flow-compact-flag is-fail"
        :title="failText || notices[0]?.text || '生成失败'"
      ></span>

      <!-- 右下角缩放把手：只有可缩放的节点（文本）才有。
            挂在卡片右下角外面一点，不吃框选（nodrag/nopan）。 -->
      <span
        v-if="focused && resizable"
        class="flow-resize-grip nodrag nopan"
        title="拖动改变大小"
        @mousedown.stop.prevent="startResize"
      ></span>

      <slot name="inputs"><NodePort type="target" side="left" :tone="tone" /></slot>
      <NodePort v-if="hasOutput" type="source" side="right" :tone="tone" />
    </div>

  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import NodeToolbar from './NodeToolbar.vue'
import NodePort from './NodePort.vue'
import { canvasViewport, updateNode } from '../../../stores/canvas'
import { NODE_ICONS } from '../../../config/nodeIcons'
import { NODE_DEFINITIONS } from '../../../config/nodeRegistry'
import { downloadMedia } from '../../../utils/downloadMedia'
import { requestLocalSave } from '../../../stores/localSpace'
import { nodes } from '../../../stores/canvas'
const saveLocal = () => { const data = nodes.value.find(n => n.id === props.nodeId)?.data; requestLocalSave([props.mediaUrl, ...(data?.galleryUrls || []).filter(url => url !== props.mediaUrl)], props.title) }

const props = defineProps({
  nodeId: { type: String, required: true },
  tone: { type: String, default: 'text' },
  title: { type: String, default: '' },
  /** 内容态需要比节点类型更具体的标签时使用 */
  compactLabel: { type: String, default: '' },
  /** 是否展开（= 恰好选中这一个节点） */
  focused: { type: Boolean, default: false },
  /**
   * 常驻展开 | Pinned open
   *
   * 不看选中状态，永远渲染完整 chrome。给室内渲染这类「卡片本体就是一整块大表单」
   * 的节点用：表单收成不可交互的静态块之后，用户根本不知道参数改哪去了。
   * 只有真正需要展开的节点传这个，其余节点仍然靠选中决定。
   */
  alwaysExpanded: { type: Boolean, default: false },
  /** 多选中的一员：加描边，但不展开 */
  multi: { type: Boolean, default: false },
  statusText: { type: String, default: '' },
  statusClass: { type: String, default: '' },
  notices: { type: Array, default: () => [] },
  failed: { type: Boolean, default: false },
  /** 失败原因原文。卡片正文里不再铺这条错误，只挂在「失败」状态和角标的悬停上 */
  failText: { type: String, default: '' },
  /** 卡片宽度；0 = 用默认宽度。素材比例不同时由外层节点算好传进来 */
  cardWidth: { type: Number, default: 0 },
  /**
   * 有没有输出口 | Has an output port
   *
   * 查看型节点（图片对比）没有下游可接的东西，右口一存在就会被当成"能往下接"。
   * 不渲染 Handle 就彻底连不出边 —— 比渲染出来再在校验里拒掉干净。
   */
  hasOutput: { type: Boolean, default: true },
  /** 右下角是否出现缩放把手 */
  resizable: { type: Boolean, default: false },
  /** 有本地文件可上传（图片 / 视频 / 音频） */
  uploadable: { type: Boolean, default: false },
  /** 有内容可全屏查看（图片 / 视频 / 音频） */
  viewable: { type: Boolean, default: false },
  /**
   * 可保存素材的地址 | Downloadable source
   *
   * 单独一个 prop 而不是让 NodeFrame 自己 emit：下载要先取字节再落盘，
   * 是外壳能自己做完的事，没必要让每个媒体节点各写一遍。
   * 空值 = 还没有内容，按钮不出现。
   */
  mediaUrl: { type: String, default: '' },
  /** 素材类型，用于取不到响应头时兜底扩展名；空值则按 tone 推断 */
  mediaKind: { type: String, default: '' },
  /** 素材真实像素与比例，在紧凑态右上角显示 */
  mediaDetails: { type: String, default: '' },
  /** 多一个「编辑提示词」按钮（AI 任务节点） */
  editable: { type: Boolean, default: false }
})

const emit = defineEmits([
  'remove', 'duplicate', 'view', 'edit', 'upload', 'drop-file', 'notice-action', 'resize', 'send-to-agent', 'crop', 'cutout'
])

/**
 * 角标默认显示**类型名**（图片/文本/视频），不是节点自己的名字。
 * 节点名会随上传的文件变成文件名，那样同一类节点在画布上就认不出来了；
 * 名字留给展开后的表头去显示。多图节点可用 compactLabel 标明「图片生成」。
 */
const typeLabel = computed(() => NODE_DEFINITIONS[props.tone]?.label || '')

/** 正文 chrome 是否铺开。常驻展开的节点与选中状态无关，但工具条仍只在选中时出现 */
const expanded = computed(() => props.alwaysExpanded)

const cardStyle = computed(() => ({
  ...(props.cardWidth ? { '--flow-card-width': `${props.cardWidth}px` } : {}),
  '--flow-selection-width': `${2 / Math.max(0.1, canvasViewport.value?.zoom || 1)}px`,
  '--flow-selection-gap': `${5 / Math.max(0.1, canvasViewport.value?.zoom || 1)}px`
}))

/**
 * 拖动右下角改大小 | Resize by dragging the bottom-right grip
 *
 * 屏幕位移要除以缩放才是 flow 单位 —— 画布缩到 0.5 时，鼠标走 100px 只等于画布上的 50。
 */
const RESIZE_MIN_WIDTH = 160
// 下限只保证"还看得出是个文本框"。这是**内容区**的高度，卡片会另外加上表头那一段。
const RESIZE_MIN_HEIGHT = 56
const startResize = (event) => {
  const zoom = canvasViewport.value?.zoom || 1
  const card = event.currentTarget?.closest('.flow-card')
  if (!card) return
  const startRect = card.getBoundingClientRect()
  // 宽度按**卡片**量、高度按**内容区**量：
  // 卡片高度里含表头那一段固定开销，把它算进尺寸会让"拖动量的高度"和用户看到的
  // 内容区不一致；而宽度没有这个问题（表头本来就跟着卡片一起变宽）。
  const stage = card.querySelector('.flow-stage')
  const from = { x: event.clientX, y: event.clientY }
  // 注意：offsetHeight / offsetWidth 是**布局尺寸，不受 CSS 缩放影响**，
  // 画布的缩放是靠 transformationpane 上的 scale 做的，所以它们本来就是 flow 坐标，
  // 不能再除 zoom（和"保持卡片中心不动"那里踩过的是同一个坑）。
  const start = {
    width: card.offsetWidth,
    height: stage?.offsetHeight || card.offsetHeight
  }

  const onMove = (moveEvent) => {
    emit('resize', {
      width: Math.max(RESIZE_MIN_WIDTH, Math.round(start.width + (moveEvent.clientX - from.x) / zoom)),
      height: Math.max(RESIZE_MIN_HEIGHT, Math.round(start.height + (moveEvent.clientY - from.y) / zoom))
    })
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

const uploadTitle = computed(() => {
  const what = props.tone === 'video' ? '视频' : props.tone === 'audio' ? '音频' : '图片'
  return `上传本地${what}`
})

/* ------------------------------------------------------------ 保存到本地 */
const downloading = ref(false)
const saveMedia = async () => {
  if (downloading.value) return
  downloading.value = true
  try {
    await downloadMedia({
      url: props.mediaUrl,
      kind: props.mediaKind || (['video', 'audio'].includes(props.tone) ? props.tone : 'image'),
      // 节点名往往已经带后缀（上传的素材），downloadFileName 会认出来不再叠一层
      label: props.title
    })
  } finally {
    downloading.value = false
  }
}

/* 拖文件到节点上：媒体节点才接收 */
const dragOver = ref(false)
const acceptsDrop = computed(() => ['image', 'video', 'audio'].includes(props.tone))
const onDragOver = (event) => {
  if (!acceptsDrop.value || !event.dataTransfer?.types?.includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
const onDrop = (event) => {
  dragOver.value = false
  if (!acceptsDrop.value) return
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  event.preventDefault()
  event.stopPropagation()
  emit('drop-file', file)
}

/* 双击标题原地重命名 */
const titleRef = ref(null)
const startRename = () => {
  const el = titleRef.value
  if (!el) return
  el.contentEditable = 'true'
  el.focus()
  window.getSelection()?.selectAllChildren(el)
  const finish = () => {
    el.contentEditable = 'false'
    const next = el.textContent.trim()
    if (next && next !== props.title) updateNode(props.nodeId, { label: next })
    else el.textContent = props.title
  }
  el.addEventListener('blur', finish, { once: true })
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); el.blur() }
    if (event.key === 'Escape') { el.textContent = props.title; el.blur() }
  })
  nextTick(() => window.getSelection()?.selectAllChildren(el))
}
</script>
