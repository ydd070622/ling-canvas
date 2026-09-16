<template>
  <!-- 媒体区 | Media stage
       四态：加载中 / 有产出 / 空（即上传入口） -->
  <div class="flow-media" :class="{ 'is-wide': tone === 'video' }">
    <template v-if="loading">
      <div class="flow-media-overlay">
        <div class="flow-spinner"></div>
        <span style="font-size: 10.5px; color: var(--flow-text-mid)">{{ loadingText }}</span>
      </div>
    </template>

    <template v-else-if="url && tone === 'video'">
      <video class="flow-media-fill" :src="url" controls playsinline @dblclick.stop />
    </template>

    <template v-else-if="url">
      <img class="flow-media-fill" :src="url" :alt="alt" @dblclick.stop="$emit('preview')" />
    </template>

    <template v-else>
      <div class="flow-media-empty" :class="{ 'is-wide': tone === 'video' }" @click="$emit('upload')">
        <span v-html="emptyIcon"></span>
        <span class="flow-media-empty-hint">拖文件到这里，或</span>
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
const props = defineProps({
  tone: { type: String, default: 'image' },
  url: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  alt: { type: String, default: '' },
  meta: { type: String, default: '' },
  /** 加载中的文案，视频节点会显示任务进度 */
  loadingText: { type: String, default: '生成中…' }
})
defineEmits(['upload', 'pick-asset', 'preview'])

const emptyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>'
const uploadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>'
const libraryIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>'
</script>
