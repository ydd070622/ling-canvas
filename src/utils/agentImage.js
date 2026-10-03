/**
 * 画布图片 → 智能体载荷 | Canvas image → agent payload
 *
 * 两件事，刻意放在同一个文件里：
 *   1. `resolveAgentImage(url)` —— 取字节 + 降采样，产出「载荷 base64」和「小图预览」
 *   2. `buildAgentInputLine({ text, images })` —— 纯函数，拼出 CLI 要吃的那一行 JSONL
 *
 * 第 2 件是这次唯一改动 CLI 协议的地方，JSON 形状错了整条链路就哑了，所以它必须是
 * **可离线验证的纯函数**（见 scripts/verify-agent-input.mjs）——这也是它单独成函数、
 * 不藏在 store 里的原因。第 1 件依赖 OffscreenCanvas / createImageBitmap，只能真机验证。
 *
 * **为什么统一降采样、不"原图直发"**：出图动辄 2K/4K，原图 base64 有几 MB，又慢又贵，
 * 而模型看图写笔记不需要那个精度。降采样后体积有界，也就不需要额外的尺寸阈值判断。
 */
import { blobToDataUrl, downscaleToWebpBlob, readLocalImageBlob } from './imageThumb'
import { readReferenceImageBytes } from './upstreamRequest'

/** 长边上限。比缩略图（512）大，够模型看清画面细节；又远小于原图，体积可控 */
const AGENT_IMAGE_MAX_EDGE = 1280
const AGENT_IMAGE_QUALITY = 0.82

/**
 * 裸 base64 → Blob。
 *
 * 只服务"外链/本地文件经 Rust 拿回 base64"这一路；data: / blob: 用 `readLocalImageBlob`
 * 直接拿到 Blob，不走这个往返（省一次 base64 解码）。`downscaleToWebpBlob` 只能吃
 * Blob / ImageBitmap，喂不进字符串，所以必须有这一道。
 */
const base64ToBlob = (base64, mime) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime || 'image/png' })
}

/**
 * 串行闸门。
 *
 * `downscaleToWebpBlob` 的文档明确要求调用方压住并发（全尺寸解码一张 4000×6000
 * 就近 100MB）。用户连点几张图时如果各解各的，内存会瞬间叠上去，所以这里用一条
 * promise 链把所有 `resolveAgentImage` 串起来。
 *
 * 链本身吞掉错误（`queue = run.catch(...)`）：某张图失败不能让后面排队的一起卡死。
 */
let queue = Promise.resolve()
const serialize = (task) => {
  const run = queue.then(() => task())
  queue = run.catch(() => {})
  return run
}

/**
 * 取一张画布图片的字节，降采样成 webp，返回载荷与预览。
 *
 * @param {string} url 图片地址：data: / blob: / http(s) / 本地文件路径
 * @returns {Promise<{ dataBase64: string, mime: string, previewUrl: string }>}
 * @throws {Error} 地址为空、字节取不到、或解码失败时抛出可读原因
 */
export const resolveAgentImage = (url) => serialize(async () => {
  const text = String(url || '').trim()
  if (!text) throw new Error('这张图没有可读取的地址')

  // data: / blob: 本地解码；其余（外链、本地文件）交给 Rust —— 顺带绕开 CORS
  let blob = await readLocalImageBlob(text)
  if (!blob) {
    const { dataBase64, mime } = await readReferenceImageBytes(text)
    if (!dataBase64) throw new Error('这张图读不出内容，可能是链接已失效')
    blob = base64ToBlob(dataBase64, mime)
  }
  if (!blob || !blob.size) throw new Error('这张图读不出来，可能是格式不支持或链接已失效')

  const small = await downscaleToWebpBlob(blob, {
    maxEdge: AGENT_IMAGE_MAX_EDGE,
    quality: AGENT_IMAGE_QUALITY
  })
  if (!small) throw new Error('这张图解码失败，可能是格式不支持')

  // 一次拿到预览 + 载荷：小图正好当 chip / 气泡缩略图，不为 60px 的展示去解码大图
  const dataUrl = await blobToDataUrl(small)
  return {
    dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mime: 'image/webp',
    previewUrl: dataUrl
  }
})

/**
 * 拼出 CLI 的 stream-json 输入行（一行 JSONL）。
 *
 * 形状由 `--input-format stream-json` 约定：图片作为 content block 喂进模型，
 * **不需要为它开任何工具**（实测图片是有效的视觉输入，与 `--tools` 无关）。
 *
 * 图片在前、文字在后 —— 让模型先看图再读要求。
 *
 * @param {{ text?: string, images?: Array<{ dataBase64: string, mime?: string }> }} input
 * @returns {string} 单行 JSON
 */
export const buildAgentInputLine = ({ text, images = [] } = {}) => JSON.stringify({
  type: 'user',
  message: {
    role: 'user',
    content: [
      ...images.map(image => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mime || 'image/png',
          data: image.dataBase64
        }
      })),
      { type: 'text', text: String(text || '') }
    ]
  }
})
