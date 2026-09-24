/**
 * 画布缩略图持久化 | Project thumbnail persistence
 *
 * **要解决的问题**：`project.thumbnail` 以前只是"当前会话的内存状态"。它取自节点
 * 的 `data.url`，而素材库节点是 `URL.createObjectURL()` 造的 `blob:`、生成图是 `data:`——
 * 两者在落盘时都会被 `stores/projects.js` 的 `cleanProjectForStorage` 抹成 `''`
 * （这条剥离**是对的**：blob URL 出了创建它的 WebView 会话必然失效）。
 * 但读盘路径从来没有重建过它，所以重启后首页永远没有缩略图。
 *
 * **做法**：把降采样后的小图（512px webp，约 30-90KB）存进 media 存储的保留 key
 * `${projectId}:__thumb__`，内存里的 `project.thumbnail` 始终是「`<img src>` 能直接吃」
 * 的 data URL。这样**四个读取点一行都不用改**：
 * `views/Home.vue`（dashboard 最近画布 / 回收站 / 收藏）与 `components/CanvasCard.vue`。
 *
 * 选 `media/<projectId>/` 作为落点的收益：`src-tauri/src/lib.rs` 的
 * `delete_project_documents` 已经 `remove_dir_all(media/<projectId>)`，
 * 所以永久删除 / 清空回收站时缩略图自动被清，Rust 侧零改动。软删除（回收站）
 * 保留文件是预期行为——恢复要能恢复。
 *
 * ---
 *
 * **硬性约束**：本文件**绝不 import `./projects.js`**（会成环：
 * projects.js → projectThumbnails.js → projects.js）。所有上下文用参数传入。
 *
 * **不变量**（改动前请先读）：
 * 1. `THUMB_MEDIA_ID` **不能以数字结尾**。`stores/canvas.js` 的
 *    `restoreProjectImages` 有一条兜底会把"以数字结尾的 key"当成旧版连续 ID 配对，
 *    `__thumb__` 靠结尾是 `_` 侥幸躲过——这是巧合，所以那边也加了显式跳过。
 * 2. 缩略图字节**永不写进项目文档**。文档里那个 `thumbnail` 字段只承载 http(s) 远端 URL。
 */
import { saveImage, loadImageAsDataUrl, deleteImage } from './imageStore'
import { makeThumbDataUrl, DEFAULT_THUMB_MAX_EDGE, DEFAULT_THUMB_QUALITY } from '../utils/imageThumb'

/** media 存储里的保留 key 后缀。见文件头不变量 1。 */
export const THUMB_MEDIA_ID = '__thumb__'

export const projectThumbKey = projectId => `${projectId}:${THUMB_MEDIA_ID}`

/**
 * 每个项目当前的缩略图状态。
 * `fingerprint` 用来判断"源有没有变"，避免每次保存都重新降采样——
 * 一次全尺寸解码（4000×6000 素材）接近 100MB，白烧不起。
 */
const thumbStates = new Map()

let thumbQueue = Promise.resolve()
let lastThumbError = null

const nodeTime = node => Number(node?.data?.updatedAt || node?.data?.createdAt || 0)

/**
 * 可作为缩略图源的节点。
 *
 * **只取图片**：视频节点没有 `data.thumbnail`（全库没有任何代码写它），
 * 旧代码回退到 `data.url` 拿到的是 mp4——`createImageBitmap` 必抛，
 * 而若那是 https 地址还会绕过剥离规则被持久化，重启后首页永久碎图。
 */
const imageSources = (nodes) => (Array.isArray(nodes) ? nodes : [])
  .filter(node => node?.type === 'image' && node.data?.url)
  .sort((a, b) => nodeTime(b) - nodeTime(a))

/**
 * 指纹用**全部图片候选的有序集合**，而不是"被选中的那个"：
 * 两个节点 `updatedAt` 相同时（老数据常见都是 0），胜负会由数组顺序决定，
 * 而那个顺序不是契约。集合指纹对顺序不敏感。
 */
const fingerprintOf = (images) => images
  .map(node => `${node.id}:${nodeTime(node)}`)
  .sort()
  .join('|')

/** 「这画布可能有媒体」——注意看的是 `assetRef`，不是 `url` 真值 */
const hasPotentialMedia = (nodes) => (Array.isArray(nodes) ? nodes : []).some(node => (
  (node?.type === 'image' || node?.type === 'video')
  && (node?.data?.assetRef || (typeof node?.data?.url === 'string' && node.data.url))
))

const enqueueThumbWrite = (operation) => {
  thumbQueue = thumbQueue
    .then(async () => {
      await operation()
      lastThumbError = null
    })
    .catch((error) => {
      lastThumbError = error
      console.warn('[projectThumbnails] 缩略图写入失败:', error)
    })
  return thumbQueue
}

/**
 * 保存路径的唯一入口：同步决定内存值 + 入队异步文件写。
 *
 * **三种状态**，判据用结构而不是 `url` 真值 —— 这条区分是必须的：
 * 素材库根目录是外置盘（`DEFAULT_ASSET_ROOT = F:\02-设计素材库`，见
 * `src-tauri/src/lib.rs:34`）。没插盘时 `hydrateAssetRefs` 会把节点 url 清成 `''`，
 * 若按"没有 url 就是没有媒体"来判，下一次自动保存就会把用户所有缩略图删光。
 *
 * | 状态 | 判据 | 动作 |
 * |---|---|---|
 * | 有可处理源 | 找到图片候选 | 入队生成（或远端直通） |
 * | 有媒体但读不到 | `assetRef` 或 `url` 任一存在 | **什么都不做**，保留旧值与旧文件 |
 * | 确实没有媒体 | 上一条为假 | 清内存 + 删文件 |
 *
 * @param {object} project 项目对象（会被就地改写 `thumbnail`）
 * @param {Array} nodes 画布节点
 */
export const syncProjectThumbnail = (project, nodes) => {
  if (!project?.id) return
  const projectId = String(project.id)
  const images = imageSources(nodes)

  if (!hasPotentialMedia(nodes)) {
    // 状态三：结构上确认没有媒体。清内存 + 删文件，否则留下永不回收的垃圾。
    project.thumbnail = ''
    thumbStates.set(projectId, { fingerprint: '', status: 'cleared' })
    enqueueThumbWrite(async () => {
      await deleteImage(projectThumbKey(projectId)).catch(() => {})
    })
    return
  }

  if (!images.length) {
    // 状态二：有媒体但当前一张都读不到（素材库未连接、图片尚在恢复中）。
    // 保留旧文件与旧指纹，等下次保存天气好了再说。
    //
    // 例外：内存里挂着的如果是视频地址（旧代码会把 mp4 的 url 当缩略图），
    // 那在首页就是一张碎图——清掉换成占位符。data: URL 是我们自己的缩略图，不动。
    if (project.thumbnail && !String(project.thumbnail).startsWith('data:')) {
      project.thumbnail = ''
    }
    return
  }

  const fingerprint = fingerprintOf(images)
  const state = thumbStates.get(projectId)
  if (state?.fingerprint === fingerprint) return

  // 远端图直通：不落文件。理由是没必要每次保存都发一次网络请求，而且 http(s)
  // 本来就能过 cleanProjectForStorage 的剥离规则、跨重启有效——现状不该被破坏。
  const remoteUrl = images
    .map(node => String(node.data.url))
    .find(url => /^https?:/i.test(url))

  if (remoteUrl) {
    project.thumbnail = remoteUrl
    thumbStates.set(projectId, { fingerprint, status: 'remote' })
    enqueueThumbWrite(async () => {
      await deleteImage(projectThumbKey(projectId)).catch(() => {})
    })
    return
  }

  thumbStates.set(projectId, { fingerprint, status: 'pending' })
  enqueueThumbWrite(async () => {
    // 按 updatedAt 降序**依次尝试**，而不是只看最新那一个：最新的那个可能是
    // 读不到源的素材节点，退到下一个能处理的才是想要的行为。
    for (const node of images) {
      const result = await makeThumbDataUrl(String(node.data.url), {
        maxEdge: DEFAULT_THUMB_MAX_EDGE,
        quality: DEFAULT_THUMB_QUALITY
      })
      if (!result) continue

      // 防串台：生成期间源又变了就丢弃这次结果，别覆盖新值
      if (thumbStates.get(projectId)?.fingerprint !== fingerprint) return

      await saveImage(projectThumbKey(projectId), result.dataUrl)
      project.thumbnail = result.dataUrl
      thumbStates.set(projectId, { fingerprint, status: 'saved' })
      return
    }
    // 全部候选都处理不了（都是损坏文件之类）：**不删文件、不清内存值**，
    // 保留上一次能用的缩略图，比空着强。
    thumbStates.set(projectId, { fingerprint, status: 'failed' })
  })
}

/**
 * 读盘后播种指纹，抑制"每次打开画布都重新降采样一次"。
 *
 * 时序问题：`loadProject` 之后 Vue Flow 挂载会触发 `handleViewportChange` →
 * `debouncedSave` → `saveProject`，此时指纹表在本会话里还是空的，
 * 于是白烧一次全尺寸解码。
 *
 * **只在内存里已经有可显示的缩略图时播种** —— 文件真缺失时必须允许重生成。
 */
export const seedProjectThumbnail = (project, nodes) => {
  if (!project?.id || !project.thumbnail) return
  const images = imageSources(nodes)
  if (!images.length) return
  thumbStates.set(String(project.id), {
    fingerprint: fingerprintOf(images),
    status: 'seeded'
  })
}

/**
 * 启动水合：把每个项目存在 media 里的小图读回内存的 `project.thumbnail`。
 *
 * **必须 fire-and-forget，不要在 `initProjectsStore` 里 await** ——
 * `src/main.js` 是 `await initProjectsStore()` 之后才 `app.mount('#app')`，
 * await 会把首页白屏时间拉长到 N 次 IPC。
 *
 * 并发 4：每次 `loadImage` 是一轮 IPC + 读一个 ≤160KB 的文本文件。
 */
export const hydrateProjectThumbnails = async (projects, { concurrency = 4 } = {}) => {
  const queue = (Array.isArray(projects) ? projects : []).filter(project => project?.id)
  if (!queue.length) return

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, queue.length)) },
    async () => {
      while (queue.length) {
        const project = queue.shift()
        try {
          // 已经有的值优先（可能是文档里持久化的远端 URL），只在为空时补
          if (project.thumbnail) continue
          const dataUrl = await loadImageAsDataUrl(projectThumbKey(project.id))
          if (dataUrl) project.thumbnail = dataUrl
        } catch {
          // 单张失败不该影响其它项目
        }
      }
    }
  )
  await Promise.all(runners)
}

/**
 * 复制项目时把缩略图字节也复制一份。
 *
 * `duplicateProject` 深拷贝了 `thumbnail` 字段，但 `media/<新id>/` 目录并不存在，
 * 而 `delete_project_documents` 是按目录删的——不复制的话副本会指向源项目的文件，
 * 源项目被永久删除时副本立刻碎图。
 */
export const copyProjectThumbnail = async (source, target) => {
  if (!source?.id || !target?.id) return
  const dataUrl = source.thumbnail
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return
  try {
    await saveImage(projectThumbKey(target.id), dataUrl)
  } catch (error) {
    // 复制失败不该影响"复制项目"本身，缩略图下次保存会重新长出来
    console.warn('[projectThumbnails] 复制缩略图失败:', error)
  }
  seedProjectThumbnail(target, target.canvasData?.nodes)
}

/**
 * 等缩略图写入队列排空。关窗时用，且调用方应加超时——
 * 缩略图是派生数据，不值得无限期拖住关窗。
 */
export const flushProjectThumbnails = async () => {
  await thumbQueue
  return !lastThumbError
}
