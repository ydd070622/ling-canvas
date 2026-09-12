/**
 * 素材库 store | Asset library store
 *
 * 模块级 ref 风格（对齐 `stores/projects.js`）：AppSidebar 直接 import 裸 ref
 * 就能接上计数，不必为此引入 Pinia。
 *
 * 列表只缓存在内存：陈旧列表比慢更糟，重进页面重扫一次只要十几毫秒。
 * 缩略图缓存才落 IndexedDB，因为生成一张要 80-200ms。
 */
import { computed, ref } from 'vue'
import { listAssetLibrary } from '../services/assetLibrary'

/** 'idle' | 'loading' | 'ready' | 'error' */
export const assetStatus = ref('idle')
export const assetError = ref('')
export const assetEntries = ref([])
export const assetRoot = ref('')
export const assetSkipped = ref(0)
export const assetScannedMs = ref(0)
/** 顶层分类，''=全部 */
export const assetCategory = ref('')
/** 二级目录，''=全部 */
export const assetFolder = ref('')

let inflight = null

const byNatural = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })

/** 顶层分类及其图片数。一张图都没有的分类（例如「03-提示词」）不进列表 */
export const categories = computed(() => {
  const counts = new Map()
  for (const entry of assetEntries.value) {
    if (!entry.category) continue
    counts.set(entry.category, (counts.get(entry.category) || 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort(byNatural)
})

/** 当前分类下的二级目录 */
export const folders = computed(() => {
  if (!assetCategory.value) return []
  const counts = new Map()
  for (const entry of assetEntries.value) {
    if (entry.category !== assetCategory.value || !entry.folder) continue
    counts.set(entry.folder, (counts.get(entry.folder) || 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort(byNatural)
})

/** 根目录散图的数量，用于「全部」之外的单列入口 */
export const rootAssetCount = computed(
  () => assetEntries.value.filter(entry => !entry.category).length
)

export const filteredAssetEntries = computed(() => {
  const category = assetCategory.value
  const folder = assetFolder.value
  return assetEntries.value.filter(entry => {
    if (category === '__root__') return !entry.category
    if (category && entry.category !== category) return false
    if (folder && entry.folder !== folder) return false
    return true
  })
})

export const setAssetCategory = (name) => {
  assetCategory.value = name
  assetFolder.value = ''
}

export const setAssetFolder = (name) => {
  assetFolder.value = name
}

/**
 * 扫描素材库。`force` 用于「重新扫描」——盘符中途插回、或用户在资源管理器里
 * 增删了文件之后。
 */
export const loadAssetLibrary = (force = false) => {
  if (inflight) return inflight
  if (!force && assetStatus.value === 'ready') return Promise.resolve()

  assetStatus.value = 'loading'
  assetError.value = ''
  inflight = (async () => {
    try {
      const library = await listAssetLibrary()
      assetEntries.value = library?.entries || []
      assetRoot.value = library?.root || ''
      assetSkipped.value = library?.skipped || 0
      assetScannedMs.value = library?.scannedMs || 0
      assetStatus.value = 'ready'
      // 重扫后原来选中的分类/目录可能已经不存在了
      if (assetCategory.value && assetCategory.value !== '__root__'
        && !categories.value.some(item => item.name === assetCategory.value)) {
        setAssetCategory('')
      }
      if (assetFolder.value && !folders.value.some(item => item.name === assetFolder.value)) {
        assetFolder.value = ''
      }
    } catch (error) {
      assetEntries.value = []
      assetStatus.value = 'error'
      assetError.value = error?.message || '素材库加载失败'
    } finally {
      inflight = null
    }
  })()
  return inflight
}
