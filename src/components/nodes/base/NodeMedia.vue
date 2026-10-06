<template>
  <!-- 媒体区 | Media stage
       四态：加载中 / 有产出 / 空（即上传入口）

       媒体框的宽高比**跟着素材本身的真实比例走**（图片 21:9 就显示成 21:9）。
       以前这里是 CSS 里写死的 4:3，任何比例的图都会被 `object-fit: cover` 裁掉一块。 -->
  <div class="flow-media" :class="{ 'is-wide': tone === 'video' }" :style="mediaStyle">
    <template v-if="loading">
      <GenerationLoader v-if="tone === 'image'" :label="loadingText === '生成中…' ? '图片生成中' : loadingText" />
      <div v-else class="flow-media-overlay">
        <div class="flow-spinner"></div>
        <span style="font-size: 10.5px; color: var(--flow-text-mid)">{{ loadingText }}</span>
      </div>
    </template>

    <template v-else-if="url && tone === 'video'">
      <video
        class="flow-media-fill"
        :src="url"
        controls
        playsinline
        @dblclick.stop
        @loadedmetadata="measure($event.target.videoWidth, $event.target.videoHeight)"
      />
    </template>

    <template v-else-if="url || previewUrl">
      <CanvasPreviewImage
        class="flow-media-fill"
        :src="previewUrl || url"
        :alt="alt"
        @dblclick.stop="$emit('preview')"
        @dimensions="measure(originalDimensions?.width || $event.width, originalDimensions?.height || $event.height)"
      />
    </template>

    <template v-else>
      <div class="flow-media-empty" :class="{ 'is-wide': tone === 'video' }" @click="$emit('upload')">
        <span v-html="emptyIcon"></span>
        <div class="flow-media-empty-row">
          <button class="flow-media-empty-btn nodrag" type="button" @click.stop="$emit('upload')">
            <span v-html="uploadIcon"></span>上传{{ tone === 'video' ? '视频' : '图片' }}
          </button>
          <button class="flow-media-empty-btn nodrag" type="button" @click.stop="$emit('pick-asset')">
            <span v-html="libraryIcon"></span>素材库
          </button>
        </div>
      </div>
    </template>

    <span v-if="url && meta" class="flow-media-meta">{{ meta }}</span>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import CanvasPreviewImage from './CanvasPreviewImage.vue'
import GenerationLoader from './GenerationLoader.vue'

const props = defineProps({
  tone: { type: String, default: 'image' },
  url: { type: String, default: '' },
  previewUrl: { type: String, default: '' },
  originalDimensions: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  alt: { type: String, default: '' },
  meta: { type: String, default: '' },
  /** 加载中的文案，视频节点会显示任务进度 */
  loadingText: { type: String, default: '生成中…' },
  /**
   * 节点上配置的出图比例（宽/高数值，0 = 不指定）。
   * 只在**还没有素材**时兜底 —— 一旦载入了素材，就按素材自己的真实比例显示，
   * 否则选了 3:4 会把一张 16:9 的图塞进 3:4 的框里。
   */
  ratio: { type: Number, default: 0 }
})
const emit = defineEmits(['upload', 'pick-asset', 'preview', 'ratio', 'dimensions'])

/**
 * 素材的真实宽高比。
 * 换素材时要复位（0 = 还没量到），否则会先按上一张的形状闪一下。
 */
const ratio = ref(0)
const measure = (width, height) => {
  if (!width || !height) return
  ratio.value = width / height
  emit('dimensions', { width, height })
  // 卡片宽度也跟着素材比例走，由外层节点决定（NodeMedia 只管内容）
  emit('ratio', ratio.value)
}
watch(() => props.url, () => {
  if (props.previewUrl) return
  ratio.value = 0
  emit('ratio', 0)
  emit('dimensions', null)
})

const mediaStyle = computed(() => {
  const effective = ratio.value || props.ratio
  return effective ? { aspectRatio: String(effective) } : null
})

const emptyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>'
const uploadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>'
const libraryIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>'
</script>
