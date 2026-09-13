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
import {
  getAssetRoot,
  listAssetLibrary,
  pickAssetRoot,
  resetAssetThumbCache
} from '../services/assetLibrary'

/** 'idle' | 'loading' | 'ready' | 'error' */
export const assetStatus = ref('idle')
export const assetError = ref('')
export const assetEntries = ref([])
export const assetRoot = ref('')
export const assetSkipped = ref(0)
export const assetScannedMs = ref(0)
/**
 * 换根计数器。必须作为瓦片 v-for 的 key 前缀：
 * AssetThumb 只在 onMounted 加载一次且没有 watch，换根后同名相对路径
 * 会让 Vue 复用组件实例、继续显示旧图。
 */
export const assetEpoch = ref(0)
/** 顶层分类，''=全部 */
export const assetCategory = ref('')
/** 二级目录，''=全部 */
export const assetFolder = ref('')

let inflight = null
let scanEpoch = 0

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
  // force 必须能顶掉在途扫描：否则换根后会拿到旧根的 inflight 结果
  if (!force && inflight) return inflight
  if (!force && assetStatus.value === 'ready') return Promise.resolve()

  const epoch = ++scanEpoch
  assetStatus.value = 'loading'
  assetError.value = ''

  inflight = (async () => {
    try {
      const library = await listAssetLibrary()
      // 已被更新的扫描取代（例如换根），丢弃这份结果
      if (epoch !== scanEpoch) return
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
      if (epoch !== scanEpoch) return
      assetEntries.value = []
      assetStatus.value = 'error'
      assetError.value = error?.message || '素材库加载失败'
      // 扫描失败时拿不到 library.root，单独问一次配置路径供错误态展示
      try {
        assetRoot.value = await getAssetRoot()
      } catch {
        // 保持旧值，不覆盖成空串
      }
    } finally {
      if (epoch === scanEpoch) inflight = null
    }
  })()
  return inflight
}

/**
 * 换根。返回 true 表示确实换过。
 *
 * 用户取消（pickAssetRoot 返回 null）时**一个副作用都不做**——
 * 不闪 loading、不清缓存、不重置分类。
 */
export const changeAssetRoot = async () => {
  const next = await pickAssetRoot()
  if (!next) return false

  await resetAssetThumbCache()
  assetEpoch.value += 1
  assetEntries.value = []
  assetRoot.value = next
  assetError.value = ''
  setAssetCategory('')
  setAssetFolder('')
  assetStatus.value = 'idle'
  await loadAssetLibrary(true)
  return true
}
