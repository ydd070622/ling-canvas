/**
 * 把素材存到本地 | Save media to disk
 *
 * **桌面端和网页端是两条不同的路，不是一个实现的两种包装。**
 *
 * 桌面端走 Rust 的 `save_media_file`：原生「另存为」对话框，用户自己选路径。
 * 起因是 WebView2 那条路走不通 —— `<a download>` 配 blob 地址点了既不下载也不
 * 报错（Tauri 的 webview 没有转发浏览器的下载事件）。同时这样还顺带解决了跨域：
 * 外链的字节由 Rust 去取，压根不经过 webview 的 CORS。
 *
 * 网页端走浏览器标准做法：取字节 → Blob → `<a download>`。**必须先取到字节**，
 * 直接写 `<a href="https://厂商域名/xxx.png" download>` 是不行的：跨域时浏览器
 * 会忽略 `download` 属性，点下去只是在新标签里打开那张图，用户还得右键另存一次。
 *
 * 两条路都失败时最后一步是 `openExternal`：至少把图丢给系统浏览器打开，
 * 用户还有办法自己存。**宁可退化成"帮你打开"，也不要静默什么都不做。**
 */
import { isTauriRuntime } from '../services/assetLibrary'
import { openExternal } from './openExternal'
import { zipSync } from 'fflate'

export const downloadImageBatch = async (nodes, onProgress = () => {}) => {
  const items = nodes.flatMap(node => {
    const urls = node.data?.galleryUrls?.length ? node.data.galleryUrls : [node.data?.url]
    return urls.filter(Boolean).map(url => ({ url, kind: 'image', label: node.data?.label || '图片' }))
  })
  const files = {}
  let failed = 0
  for (let index = 0; index < items.length; index++) {
    try {
      const { bytes, contentType } = await fetchBytes(items[index].url)
      if (!bytes.length) throw new Error('图片内容为空')
      const name = `${String(index + 1).padStart(3, '0')}-${downloadFileName({ ...items[index], contentType })}`
      files[name] = bytes
    } catch {
      failed++
    }
    onProgress(index + 1, items.length)
  }
  const count = Object.keys(files).length
  if (!count) throw new Error('所选图片均无法读取，请检查图片或网络')
  const archive = zipSync(files, { level: 0 })
  const fileName = `画布图片-${Date.now()}.zip`
  const saved = isTauriRuntime()
    ? !!await saveViaDialog({ fileName, dataBase64: bytesToBase64(archive) })
    : saveBlob(archive, 'application/zip', fileName)
  if (saved) {
    const message = `已下载 ${count} 张图片${failed ? `，${failed} 张读取失败` : ''}`
    if (failed) window.$message?.warning(message)
    else window.$message?.success(message)
  } else if (failed) window.$message?.warning(`${failed} 张图片读取失败，保存已取消`)
  return { saved, count, failed }
}

/** MIME → 扩展名。只覆盖这个应用会碰到的几类 */
const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a'
}

/** 类型 → 拿不到响应头时的兜底 MIME */
const KIND_FALLBACK_MIME = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg'
}

/**
 * 从地址末尾猜扩展名。
 * 只认 2–5 位的字母数字（`png` / `jpeg` / `webp`），**不认 `?x=1` 这类查询串** ——
 * 有的图床地址是 `.../image?token=abc`，那段不是扩展名。
 */
const extensionFromUrl = (url) => {
  const path = String(url || '').split(/[?#]/)[0]
  const match = path.match(/\.([a-z0-9]{2,5})$/i)
  return match ? match[1].toLowerCase() : ''
}

/**
 * 文件名清洗：`? * : " < > | / \` 在 Windows 上不能进文件名，
 * 空名会让浏览器存成 "download" 而不是"图片"。
 */
const sanitizeFileName = (name) => {
  const cleaned = String(name || '')
    .replace(/[?*:"<>|/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || '素材'
}

/**
 * 最终的存盘文件名。
 *
 * 优先用节点名（用户在画布上认得的就是它，如「视角 2」），
 * 再按真实 MIME 补扩展名 —— **不是照抄地址里的扩展名**：
 * 厂商返回的 `.../file_abc` 常常没有后缀，而 `content-type` 是准的。
 */
const downloadFileName = ({ label, url, kind, contentType } = {}) => {
  const base = sanitizeFileName(label)
  const fromMime = MIME_EXTENSIONS[String(contentType || '').split(';')[0].trim().toLowerCase()]
  const extension = fromMime || extensionFromUrl(url) || (kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png')
  // 名字里已经有正确后缀就不再叠一层（上传的素材节点名常常已经带 `.png`）
  return new RegExp(`\\.${extension}$`, 'i').test(base) ? base : `${base}.${extension}`
}

const base64ToBytes = (base64) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** 反过来：要把字节交给 Rust 落盘，得先编成 base64 过 IPC */
const bytesToBase64 = (bytes) => {
  // 分块拼：一次 spread 几十万个参数会爆调用栈
  const CHUNK = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

/**
 * 取字节。
 *
 * 分三档，顺序不能反：
 * 1. `data:` / `blob:` —— **只能在本 webview 里解析**，后端读不到（`fetch_binary`
 *    遇到 blob: 会直接报错）。上传的素材和从 IndexedDB 还原回来的图都是这两种地址。
 * 2. 桌面端其余一律交给 `fetch_binary`：外链绕开 CORS，本地路径 / `asset:` 也能读。
 * 3. 网页端 `fetch`（同源素材能过，跨域外链会被 CORS 挡下 → 走 openExternal 兜底）。
 */
export const fetchBytes = async (url) => {
  // mime 段可能带 `;charset=utf-8` 之类的参数，所以先整段吞下再自己切
  const dataMatch = url.match(/^data:([^,]*),([\s\S]*)$/)
  if (dataMatch) {
    const meta = dataMatch[1]
    const payload = dataMatch[2]
    const mime = meta.replace(/;base64$/i, '').split(';')[0]
    if (/;base64$/i.test(meta)) return { bytes: base64ToBytes(payload), contentType: mime }
    // 非 base64 的 data URL：按 UTF-8 还原
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), contentType: mime }
  }

  if (/^blob:/i.test(url)) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`读取失败 (${response.status})`)
    const blob = await response.blob()
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type || '' }
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('fetch_binary', { url, timeoutMs: 120_000 })
    const base64 = String(result?.dataBase64 || '')
    if (!base64) throw new Error('没有取到字节')
    return { bytes: base64ToBytes(base64), contentType: String(result?.contentType || '') }
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`读取失败 (${response.status})`)
  const blob = await response.blob()
  return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type || '' }
}

/** 浏览器下载通道（网页端用）。blob 地址**不能马上 revoke**，否则下载会被掐断 */
const saveBlob = (bytes, contentType, fileName) => {
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
  return true
}

/** 原生「另存为」。返回落盘路径；用户取消返回 '' */
const saveViaDialog = async ({ fileName, url, dataBase64 }) => {
  const { invoke } = await import('@tauri-apps/api/core')
  const args = { fileName }
  if (dataBase64) args.dataBase64 = dataBase64
  else args.url = url
  const saved = await invoke('save_media_file', args)
  return String(saved || '')
}

/**
 * 存一张素材。
 *
 * 桌面端和网页端走的是**两条不同的路**，不是同一个实现的两种包装：
 * - 桌面端 → Rust 的原生「另存为」+ 自己写盘。WebView2 不理会 `<a download>` 的
 *   blob 地址，浏览器那条路在这里根本不通（实测：点了没反应，也不报错）。
 * - 网页端 → blob + `<a download>`，浏览器里这条是标准做法。
 *
 * 取字节失败时兜底 `openExternal`：把地址交给系统浏览器，用户还能右键另存。
 *
 * @param {Object} media { url, kind: 'image'|'video'|'audio', label }
 * @returns {Promise<boolean>} 是否真的存下来了（用户取消 / 退化成"打开"时 false）
 */
export const downloadMedia = async (media = {}) => {
  const url = String(media.url || '').trim()
  if (!url) {
    window.$message?.warning('这个节点还没有内容可下载')
    return false
  }

  const kind = media.kind || 'image'
  // data: / blob: 只有 webview 解析得出来，后端读不到，必须先在前端解成字节
  const inline = /^(data:|blob:)/i.test(url)

  try {
    if (isTauriRuntime()) {
      let args
      if (inline) {
        const { bytes, contentType } = await fetchBytes(url)
        args = { fileName: downloadFileName({ ...media, contentType }), dataBase64: bytesToBase64(bytes) }
      } else {
        args = { fileName: downloadFileName(media), url }
      }
      const saved = await saveViaDialog(args)
      // 用户按了取消：既不算成功也不算失败，不弹提示
      if (!saved) return false
      window.$message?.success('已保存到本地')
      return true
    }

    const { bytes, contentType } = await fetchBytes(url)
    const resolvedType = contentType && contentType !== 'application/octet-stream'
      ? contentType
      : KIND_FALLBACK_MIME[kind]
    return saveBlob(bytes, resolvedType, downloadFileName({ ...media, contentType }))
  } catch (error) {
    console.warn('保存素材失败，改为在浏览器中打开:', error)
    window.$message?.warning('无法直接保存，已在浏览器中打开，可右键另存为')
    await openExternal(url)
    return false
  }
}
