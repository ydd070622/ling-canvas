<script setup>
/**
 * 画布内素材选择弹窗 | In-canvas asset picker
 *
 * 为什么是弹窗而不是跨页面拖拽：素材库在路由 `/`，画布在 `/canvas/:id`，
 * 把素材从库拖到画布必须先切路由，而 router.push 会卸载素材库的 DOM，
 * HTML5 drag 的 source 消失、drag 立刻取消，永远等不到 drop。
 * Tauri 的原生 onDragDropEvent 只认操作系统级的文件拖拽，页面内拖拽进不去。
 * 所以正确形态是「画布内弹窗选图」。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NModal } from 'naive-ui'
import AssetThumb from '../assets/AssetThumb.vue'
import { ASSET_PAGE_BATCH, ASSET_ROOT_LABEL } from '../../config/assets'
import {
  assetError,
  assetStatus,
  categories,
  filteredAssetEntries,
  loadAssetLibrary,
  rootAssetCount,
  assetCategory,
  setAssetCategory
} from '../../stores/assets'

const props = defineProps({
  show: { type: Boolean, default: false }
})
const emit = defineEmits(['update:show', 'select'])

const query = ref('')
const selectedPaths = ref([])
const visibleCount = ref(ASSET_PAGE_BATCH)

// 随视口伸缩但有上下限：固定 900px 在 1400 宽下合适（64%），
// 到 2560 全屏就只剩 35%，显得又小又窄。
const pickerStyle = { width: 'clamp(720px, 68vw, 1400px)' }

const matched = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return filteredAssetEntries.value
  return filteredAssetEntries.value.filter(entry => entry.relativePath.toLowerCase().includes(text))
})

const paged = computed(() => matched.value.slice(0, visibleCount.value))
const hasMore = computed(() => matched.value.length > visibleCount.value)

watch([matched, assetCategory], () => { visibleCount.value = ASSET_PAGE_BATCH })

watch(() => props.show, value => {
  if (!value) {
    selectedPaths.value = []
    query.value = ''
    return
  }
  // 每次打开都重扫：用户很可能刚在资源管理器里拖了几张图进来。
  // 扫描实测十几毫秒，代价可以忽略。
  loadAssetLibrary(true)
})

const toggle = (entry) => {
  const index = selectedPaths.value.indexOf(entry.relativePath)
  if (index === -1) selectedPaths.value.push(entry.relativePath)
  else selectedPaths.value.splice(index, 1)
}

const confirm = () => {
  const picked = matched.value.filter(entry => selectedPaths.value.includes(entry.relativePath))
  if (!picked.length) return
  emit('select', picked.map(entry => ({ relativePath: entry.relativePath, name: entry.name })))
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="asset-picker"
    :style="pickerStyle"
    title="从素材库选择"
    :bordered="false"
    @update:show="value => emit('update:show', value)"
  >
    <div class="asset-picker__toolbar">
      <input v-model="query" class="asset-picker__search" type="text" placeholder="按文件名或路径筛选" />
      <span class="asset-picker__count">已选 {{ selectedPaths.length }} 张</span>
    </div>

    <div class="asset-picker__chips">
      <button
        type="button"
        class="asset-picker__chip"
        :class="{ 'asset-picker__chip--active': !assetCategory }"
        @click="setAssetCategory('')"
      >
        全部
      </button>
      <button
        v-for="item in categories"
        :key="item.name"
        type="button"
        class="asset-picker__chip"
        :class="{ 'asset-picker__chip--active': assetCategory === item.name }"
        @click="setAssetCategory(item.name)"
      >
        {{ item.name }}<em>{{ item.count }}</em>
      </button>
      <!-- 根目录散图没有 category，不在 categories 里，要单独给一个入口 -->
      <button
        v-if="rootAssetCount"
        type="button"
        class="asset-picker__chip"
        :class="{ 'asset-picker__chip--active': assetCategory === '__root__' }"
        @click="setAssetCategory('__root__')"
      >
        根目录散图<em>{{ rootAssetCount }}</em>
      </button>
    </div>

    <div class="asset-picker__body">
      <div v-if="assetStatus === 'loading'" class="asset-picker__state">正在扫描素材库…</div>
      <div v-else-if="assetStatus === 'error'" class="asset-picker__state asset-picker__state--error">
        <span>{{ assetError }}</span>
        <span class="asset-picker__hint">{{ ASSET_ROOT_LABEL }}</span>
      </div>
      <div v-else-if="!matched.length" class="asset-picker__state">没有匹配的素材</div>
      <div v-else class="asset-picker__grid">
        <AssetThumb
          v-for="entry in paged"
          :key="entry.relativePath"
          :entry="entry"
          :selected="selectedPaths.includes(entry.relativePath)"
          @open="toggle"
        />
      </div>
      <button
        v-if="hasMore"
        type="button"
        class="asset-picker__more"
        @click="visibleCount += ASSET_PAGE_BATCH"
      >
        加载更多（还有 {{ matched.length - paged.length }} 张）
      </button>
    </div>

    <template #footer>
      <div class="asset-picker__footer">
        <span class="asset-picker__hint">素材以引用方式插入，不会复制文件</span>
        <div class="asset-picker__actions">
          <n-button @click="emit('update:show', false)">取消</n-button>
          <n-button type="primary" :disabled="!selectedPaths.length" @click="confirm">
            插入 {{ selectedPaths.length ? selectedPaths.length : '' }}
          </n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.asset-picker__toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 10px;
}
.asset-picker__search {
  flex: 1; height: 34px; padding: 0 12px; border-radius: 10px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #1e293b); font-size: 13px; outline: none;
}
.asset-picker__search:focus { border-color: var(--accent-color, #22c55e); }
.asset-picker__count { flex: none; color: #94a3b8; font-size: 12px; }

.asset-picker__chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.asset-picker__chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-secondary, #fff);
  color: var(--text-secondary, #64748b);
  font-size: 13px; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.asset-picker__chip:hover { border-color: var(--accent-color, #22c55e); }
.asset-picker__chip--active { border-color: transparent; background: #e7f0ff; color: #3b82f6; font-weight: 600; }
.asset-picker__chip em { font-style: normal; opacity: 0.6; font-size: 11px; }

/* max-height 而不是 height：图少时（某个分类只有几张）弹窗要跟着缩，
   写死高度会在下面留一大片空白；图多时到此为止并内部滚动 */
.asset-picker__body { max-height: min(56vh, 620px); overflow-y: auto; padding-right: 4px; }

.asset-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 12px;
}

.asset-picker__state {
  min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: #a4afbd; font-size: 13px;
}
.asset-picker__state--error { color: #ef4444; }
.asset-picker__hint { color: #9aa6b7; font-size: 12px; }

.asset-picker__more {
  width: 100%; margin-top: 14px; height: 36px; border-radius: 10px;
  border: 1px dashed var(--border-color, #e2e8f0);
  background: transparent; color: var(--text-secondary, #64748b);
  font-size: 13px; cursor: pointer;
}
.asset-picker__more:hover { border-color: var(--accent-color, #22c55e); color: var(--text-primary, #1e293b); }

.asset-picker__footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.asset-picker__actions { display: flex; gap: 8px; }
</style>
