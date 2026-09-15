/**
 * 素材库配置 | Asset library config
 *
 * 素材库根目录由 Rust 侧持有（`src-tauri/src/lib.rs` 的 `AssetRootState`，
 * 由用户在原生目录选择器里指定），它同时是安全边界，所以前端**永远不拼绝对路径**。
 * 界面要展示当前目录时，读 `stores/assets` 的 `assetRoot`。
 */

/** 缩略图最长边（px）。网格瓦片约 150px，360 足够覆盖 2x 屏 */
export const ASSET_THUMB_MAX_EDGE = 360
export const ASSET_THUMB_QUALITY = 0.72

/**
 * 同时解码的图片数。
 * 一张 4000×6000 的图解码后约 96MB，这个闸门是必需项而非优化项。
 */
export const ASSET_THUMB_CONCURRENCY = 3

/** 改缩略图尺寸/质量时 +1，即可让全部缓存失效重建 */
export const ASSET_THUMB_VERSION = 1

/** 缩略图 blob URL 的 LRU 上限。缩略图可重建，必须回收 */
export const ASSET_THUMB_URL_LIMIT = 300

/**
 * 预览大图 blob URL 的 LRU 上限。
 *
 * 与缩略图分开计数：这里是**原图**尺寸，混进同一个池会让几张原图
 * 就把几百张缩略图挤出去，网格会开始重下重画。
 * 取小值即可——预览是显式动作，只需覆盖「反复看同一张」和「来回对比两三张」。
 */
export const ASSET_PREVIEW_URL_LIMIT = 8

/**
 * 网格分批渲染的批量。
 * 每个瓦片自带一个 IntersectionObserver，一次为几百张建观察器太浪费。
 */
export const ASSET_PAGE_BATCH = 120
