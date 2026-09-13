<script setup>
/**
 * 素材库页面主体 | Asset library page
 *
 * 只读浏览用户的本地素材库。素材是「引用式」的：本组件从不写任何素材字节，
 * 只读元数据 + 按需生成缩略图缓存。
 *
 * 搜索走全局的 uiStore.searchQuery —— TitleBar 的搜索框显示的正是它，
 * 所以页面留在 Home.vue 里就能白捡「搜素材」能力。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NModal, useDialog } from 'naive-ui'
import AssetThumb from './AssetThumb.vue'
import { ASSET_PAGE_BATCH } from '../../config/assets'
import { resolveAssetUrl } from '../../services/assetLibrary'
import {
  assetError,
  assetEpoch,
  assetRoot,
  assetScannedMs,
  assetSkipped,
  assetStatus,
  categories,
  changeAssetRoot,
  filteredAssetEntries,
  folders,
  rootAssetCount,
  assetCategory,
  assetFolder,
  loadAssetLibrary,
  setAssetCategory,
  setAssetFolder
} from '../../stores/assets'
import { useUIStore } from '../../stores/ui'

const uiStore = useUIStore()
const dialog = useDialog()

const visibleCount = ref(ASSET_PAGE_BATCH)
const sentinel = ref(null)
const previewEntry = ref(null)
const previewUrl = ref('')
const previewError = ref('')
/** 预览图按原图比例算出的显示尺寸；null = 还没加载出来 */
const previewSize = ref(null)
const previewImageRef = ref(null)
let sentinelObserver = null

/** 卡片左右内边距合计（App.vue 的 Card override 是 24px 一侧） */
const PREVIEW_PADDING_X = 48
/** 卡片上下除图片以外的开销：标题栏 + 底部路径 + 上下内边距 */
const PREVIEW_CHROME_Y = 132
/** 再大的原图也不放到这个宽度以上，否则一张图占满整个屏幕 */
const PREVIEW_MAX_IMAGE_WIDTH = 1600

/**
 * 外框宽度 = 图片显示宽度 + 左右内边距。
 * 之前直接用图片宽度当卡片宽度，图片只占内容区，于是两侧各空出 24px，
 * 看起来像"外框比图片大一圈"。
 */
const previewModalStyle = computed(() => (
  previewSize.value
    ? { width: `${previewSize.value.width + PREVIEW_PADDING_X}px`, maxWidth: '94vw' }
    : { width: '380px' }
))

const measurePreviewImage = (image) => {
  if (!image?.naturalWidth) return
  // 卡片自身也要留在视口内：可用高度要扣掉标题和底部路径
  const maxImageWidth = Math.min(
    window.innerWidth * 0.94 - PREVIEW_PADDING_X,
    PREVIEW_MAX_IMAGE_WIDTH
  )
  const maxImageHeight = window.innerHeight * 0.9 - PREVIEW_CHROME_Y
  const scale = Math.min(1, maxImageWidth / image.naturalWidth, maxImageHeight / image.naturalHeight)
  previewSize.value = {
    width: Math.max(120, Math.round(image.naturalWidth * scale)),
    height: Math.max(80, Math.round(image.naturalHeight * scale))
  }
}

const onPreviewImageLoad = (event) => measurePreviewImage(event.target)

// 全屏 / 改窗口尺寸后按新视口重算，否则外框会一直停在打开那一刻的尺寸
const onWindowResize = () => measurePreviewImage(previewImageRef.value)

const query = computed(() => uiStore.searchQuery.trim().toLowerCase())

const matched = computed(() => {
  const text = query.value
  if (!text) return filteredAssetEntries.value
  return filteredAssetEntries.value.filter(entry => entry.relativePath.toLowerCase().includes(text))
})

/** 分批渲染：561 个瓦片各自带一个 IntersectionObserver，一次全建太浪费 */
const paged = computed(() => matched.value.slice(0, visibleCount.value))
const hasMore = computed(() => matched.value.length > visibleCount.value)

const currentCategoryLabel = computed(() => {
  if (assetCategory.value === '__root__') return '根目录散图'
  return assetCategory.value || '全部素材'
})

watch([matched, assetCategory, assetFolder], () => { visibleCount.value = ASSET_PAGE_BATCH })

const openPreview = async (entry) => {
  previewEntry.value = entry
  previewUrl.value = ''
  previewError.value = ''
  previewSize.value = null
  try {
    const url = await resolveAssetUrl(entry.relativePath)
    // 用户可能在等待期间又点了别的图
    if (previewEntry.value?.relativePath !== entry.relativePath) {
      URL.revokeObjectURL(url)
      return
    }
    previewUrl.value = url
  } catch (error) {
    previewError.value = error?.message || '素材读取失败'
  }
}

const closePreview = () => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  previewError.value = ''
  previewEntry.value = null
  previewSize.value = null
}

const runChangeRoot = async () => {
  closePreview()  // 预览里的 objectURL 属于旧根
  try {
    await changeAssetRoot()
  } catch (error) {
    window.$message?.error(error?.message || '更换素材库目录失败')
  }
}

/**
 * 换根入口。当前库是健康状态时要先确认——画布节点存的是相对路径，
 * 换根后旧引用可能指向别的文件或直接丢失。目录本来就缺失/报错时不弹确认，
 * 直接进选择器（那正是用户点这个按钮的原因）。
 */
const onChangeRoot = () => {
  if (assetStatus.value !== 'ready') {
    runChangeRoot()
    return
  }
  dialog.warning({
    title: '更换素材库目录',
    content: '更换后，画布中已引用的素材会按新目录重新解析，旧目录里的素材可能显示为丢失。缩略图缓存将被清空并重建。',
    positiveText: '继续选择',
    negativeText: '取消',
    onPositiveClick: runChangeRoot
  })
}

onMounted(() => {
  loadAssetLibrary()
  window.addEventListener('resize', onWindowResize)
  sentinelObserver = new IntersectionObserver(entries => {
    if (entries.some(item => item.isIntersecting)) {
      visibleCount.value += ASSET_PAGE_BATCH
    }
  }, { rootMargin: '600px' })
  if (sentinel.value) sentinelObserver.observe(sentinel.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  sentinelObserver?.disconnect()
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <section class="asset-page">
    <div class="asset-toolbar">
      <div class="asset-chips">
        <button
          type="button"
          class="asset-chip"
          :class="{ 'asset-chip--active': !assetCategory }"
          @click="setAssetCategory('')"
        >
          全部
        </button>
        <button
          v-for="item in categories"
          :key="item.name"
          type="button"
          class="asset-chip"
          :class="{ 'asset-chip--active': assetCategory === item.name }"
          @click="setAssetCategory(item.name)"
        >
          {{ item.name }}<em>{{ item.count }}</em>
        </button>
        <button
          v-if="rootAssetCount"
          type="button"
          class="asset-chip"
          :class="{ 'asset-chip--active': assetCategory === '__root__' }"
          @click="setAssetCategory('__root__')"
        >
          根目录散图<em>{{ rootAssetCount }}</em>
        </button>
      </div>

      <div class="asset-toolbar__actions">
        <button
          type="button"
          class="asset-rescan"
          :disabled="assetStatus === 'loading'"
          @click="loadAssetLibrary(true)"
        >
          {{ assetStatus === 'loading' ? '扫描中…' : '重新扫描' }}
        </button>
        <button
          type="button"
          class="asset-rescan"
          @click="onChangeRoot"
        >
          更改目录
        </button>
      </div>
    </div>

    <div v-if="folders.length" class="asset-chips asset-chips--sub">
      <button
        type="button"
        class="asset-chip asset-chip--sm"
        :class="{ 'asset-chip--active': !assetFolder }"
        @click="setAssetFolder('')"
      >
        全部
      </button>
      <button
        v-for="item in folders"
        :key="item.name"
        type="button"
        class="asset-chip asset-chip--sm"
        :class="{ 'asset-chip--active': assetFolder === item.name }"
        @click="setAssetFolder(item.name)"
      >
        {{ item.name }}<em>{{ item.count }}</em>
      </button>
    </div>

    <div v-if="assetStatus === 'loading'" class="asset-state">
      <strong>正在扫描素材库…</strong>
      <span>{{ assetRoot || '未设置素材库目录' }}</span>
    </div>

    <div v-else-if="assetStatus === 'error'" class="asset-state asset-state--error">
      <strong>素材库不可用</strong>
      <span>{{ assetError }}</span>
      <span v-if="assetRoot" class="asset-state__path">{{ assetRoot }}</span>
      <div class="asset-state__actions">
        <button type="button" class="asset-rescan asset-rescan--primary" @click="onChangeRoot">选择目录</button>
        <button type="button" class="asset-rescan" @click="loadAssetLibrary(true)">重试</button>
      </div>
    </div>

    <div v-else-if="!matched.length" class="asset-state">
      <strong>{{ query ? '没有匹配的素材' : '这个分类下还没有图片' }}</strong>
      <span>{{ query ? `搜索“${uiStore.searchQuery}”` : (assetRoot || '未设置素材库目录') }}</span>
    </div>

    <div v-else class="asset-grid">
      <AssetThumb
        v-for="entry in paged"
        :key="`${assetEpoch}:${entry.relativePath}`"
        :entry="entry"
        @open="openPreview"
      />
    </div>

    <div v-if="hasMore" ref="sentinel" class="asset-sentinel" />

    <footer v-if="assetStatus === 'ready'" class="asset-footnote">
      <span>{{ currentCategoryLabel }} · 共 {{ matched.length }} 张</span>
      <span v-if="assetRoot" class="asset-footnote__root" :title="assetRoot">{{ assetRoot }}</span>
      <span v-if="assetRoot">已忽略 {{ assetSkipped }} 个非图片/隐藏项 · 扫描 {{ assetScannedMs }}ms</span>
    </footer>

    <n-modal
      :show="!!previewEntry"
      preset="card"
      class="asset-preview"
      :style="previewModalStyle"
      :title="previewEntry?.name || ''"
      :bordered="false"
      @update:show="value => { if (!value) closePreview() }"
    >
      <div class="asset-preview__body">
        <img
          v-if="previewUrl"
          ref="previewImageRef"
          :src="previewUrl"
          :alt="previewEntry?.name || ''"
          @load="onPreviewImageLoad"
        />
        <span v-else-if="previewError" class="asset-preview__error">{{ previewError }}</span>
        <span v-else class="asset-preview__loading">读取中…</span>
      </div>
      <template #footer>
        <span class="asset-preview__path">{{ previewEntry?.relativePath }}</span>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.asset-page { display: flex; flex-direction: column; gap: 14px; }

.asset-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.asset-toolbar__actions { display: flex; flex: none; gap: 8px; }

.asset-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.asset-chips--sub { padding-top: 2px; }

.asset-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-secondary, #fff);
  color: var(--text-secondary, #64748b);
  font-size: 13px; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.asset-chip:hover { border-color: var(--accent-color, #22c55e); color: var(--text-primary, #1e293b); }
.asset-chip--active {
  border-color: transparent;
  background: #e7f0ff; color: #3b82f6; font-weight: 600;
}
.asset-chip--sm { height: 28px; font-size: 12px; }
.asset-chip em { font-style: normal; opacity: 0.6; font-size: 11px; }

.asset-rescan {
  flex: none; height: 32px; padding: 0 14px; border-radius: 10px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-secondary, #fff);
  color: var(--text-secondary, #64748b);
  font-size: 13px; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.asset-rescan:hover:not(:disabled) { background: var(--bg-tertiary, #f1f5f9); color: var(--text-primary, #1e293b); }
.asset-rescan:disabled { opacity: 0.6; cursor: default; }
/* 错误态的主行动：选目录比重试更可能是用户真正要做的事 */
.asset-rescan--primary {
  border-color: var(--accent-color, #22c55e);
  background: var(--accent-color, #22c55e);
  color: #fff;
}
.asset-rescan--primary:hover:not(:disabled) { background: var(--accent-color, #22c55e); color: #fff; filter: brightness(1.06); }

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}

.asset-state {
  min-height: 320px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: #a4afbd;
}
.asset-state strong { color: #7c8797; font-weight: 600; }
.asset-state span { font-size: 12px; text-align: center; word-break: break-all; }
.asset-state--error strong { color: #ef4444; }
.asset-state__path { font-family: ui-monospace, monospace; color: #b6c0cd; }
.asset-state__actions { display: flex; gap: 8px; margin-top: 6px; }

.asset-sentinel { height: 1px; }

.asset-footnote {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding-top: 4px; color: #9aa6b7; font-size: 12px;
}
/* 路径占中间，过长时截断而不是把两侧挤走 */
.asset-footnote__root {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: center; color: #b6c0cd;
}

/* 不再留 min-height：外框尺寸由图片比例决定，小图就该是小框 */
.asset-preview__body { display: flex; align-items: center; justify-content: center; }
.asset-preview__body img { display: block; width: 100%; height: auto; border-radius: 8px; }
.asset-preview__error { color: #ef4444; font-size: 13px; }
.asset-preview__loading { color: #94a3b8; font-size: 13px; }
.asset-preview__path { color: #9aa6b7; font-size: 12px; word-break: break-all; }
</style>
