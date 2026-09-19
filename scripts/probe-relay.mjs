/**
 * 中转站体检 | Onboard a new relay
 *
 * 加一家新站时要问的四件事，一次问完，最后直接给出能粘进
 * 「设置 → 渠道 → 高级配置」的 JSON —— 不用改代码、不用重新构建。
 *
 *   1. 它支不支持原生 Gemini 路由    ← 免费，读 /api/pricing
 *   2. 它有哪些图片模型               ← 免费，读 /v1/models
 *   3. 尺寸参数真的送得进去吗         ← --deep，会真出图计费
 *   4. 该不该给这家开参数广播         ← 只在 3 判定「吞了」时才考虑
 *
 * 用法（在项目根目录，什么都不传就自己从客户端存档里取 Key 和 Base URL）：
 *   node scripts/probe-relay.mjs
 *   node scripts/probe-relay.mjs --deep
 *   node scripts/probe-relay.mjs --base https://x.pro --key sk-xxx --model gemini-3.1-flash-image --deep
 *
 * 三点设计约束：
 *
 * - **免费的先跑、有定论就停。** 出图是真花钱，不能一上来就广播一轮。
 *   /api/pricing 里每个模型的 supported_endpoint_types 就够了 —— 这条线索
 *   当初正是定位 4K 问题的关键（gemini 系是 ["gemini","openai"]，第一项就是原生路由）。
 *
 * - **请求体一律由 src/utils/upstreamRequest.js 的真实构造函数生成。**
 *   手搓一份 body 只能证明「我以为客户端发的是这样」，证不了对面收这个形状。
 *
 * - **判定「档位认不认」用差分而不是查表。** 同一路由各打一次 1K 和 4K，
 *   比真实像素：一样大就是被吞了。查表要维护各模型各比例的尺寸表，
 *   而且换个模型就失效；差分与模型无关，还能顺带把「比例也被吞」一起证出来。
 *
 * Key 只在本进程内存里用，打印时永远只露头尾。
 */

import { register } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

register('./alias-loader.mjs', import.meta.url)

const { buildGeminiImageRequest, buildGeminiNativePath, normalizeImageGenerationRequestBody } =
  await import('../src/utils/upstreamRequest.js')
const { prefersChatProtocolForImage } = await import('../src/config/providerCapabilities.js')
const { buildChatImageRequest } = await import('../src/api/image.js')

/* ------------------------------------------------------------------ 参数 */

const argv = process.argv.slice(2)
const flagValue = name => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : ''
}
const DEEP = argv.includes('--deep')

/** 差分探测用的比例。3:4 在 gemini 的 1K/2K/4K 三档里都有确定尺寸。 */
const RATIO = '3:4'
const PROMPT = 'a red ceramic teapot on a wooden table, soft daylight'
const TIMEOUT_MS = 240_000

let BASE = (flagValue('base') || process.env.RELAY_BASE || '').replace(/\/+$/, '')
let KEY = flagValue('key') || process.env.RELAY_KEY || ''
let MODEL = flagValue('model') || process.env.RELAY_MODEL || 'gemini-3.1-flash-image'

const LEVELDB = join(
  homedir(), 'AppData', 'Local', 'com.lingcanvas.app',
  'EBWebView', 'Default', 'Local Storage', 'leveldb'
)

/* ------------------------------------------------------ 没传参数就从存档里挖 */

/** LevelDB 里的值是 UTF-16 味儿的，NUL 会夹在字符中间，正则匹配不到 */
const stripNuls = text => text.replace(/\x00/g, '')

const harvestCreds = () => {
  let blob = ''
  try {
    for (const name of readdirSync(LEVELDB)) {
      try { blob += stripNuls(readFileSync(join(LEVELDB, name), 'latin1')) } catch { /* 被锁的文件跳过 */ }
    }
  } catch {
    return { key: '', base: '' }
  }
  const found = (blob.match(/sk-[A-Za-z0-9_-]{20,}/) || [])[0] || ''
  // 存档里出现的 http(s) 域名，取第一个像中转站的
  const hosts = [...new Set(blob.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [])]
    .filter(host => !/chatfire|localhost|127\.0\.0\.1|w3\.org|schema/i.test(host))
  return { key: found, base: hosts[0] || '' }
}

if (!KEY || !BASE) {
  const harvested = harvestCreds()
  if (!KEY) KEY = harvested.key
  if (!BASE) BASE = harvested.base
}

const mask = value => (value
  ? `${value.slice(0, 7)}…${value.slice(-4)}（${value.length} 字符）`
  : '（没有）')

if (!BASE || !KEY) {
  console.error('缺少 Base URL 或 Key。用 --base / --key 传，或先让客户端存过一次配置。')
  process.exit(1)
}

/* --------------------------------------------------------------- 小工具 */

const hasKey = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

/** 从字节流读像素尺寸，不引依赖。png / jpeg / webp 够用了。 */
const dimensionsFromBytes = bytes => {
  if (bytes.length < 24) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), format: 'jpeg' }
      }
      const length = bytes.readUInt16BE(offset + 2)
      if (!length) break
      offset += 2 + length
    }
    return null
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = bytes.toString('ascii', 12, 16)
    if (fourcc === 'VP8X') {
      return {
        width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
        height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
        format: 'webp'
      }
    }
    if (fourcc === 'VP8 ') {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, format: 'webp' }
    }
  }
  return null
}

const B64_KEYS = /^(b64_json|base64|image_base64|img)$/i
const URL_KEYS = /^(url|image_url|imageUrl|link|src)$/i
const INLINE_KEYS = /^(inlineData|inline_data)$/i

/**
 * 递归收图，**记下每张图在 JSON 里的路径** —— 路径本身就是证据：
 * 它同时说明了「上游把图放哪」和「我们的解析器有没有走到那里」。
 */
const collectImages = (node, path = '$', out = [], depth = 0) => {
  if (node === null || node === undefined || depth > 12) return out
  if (typeof node === 'string') {
    if (/^data:image\//i.test(node)) out.push({ path, kind: 'dataurl', value: node })
    else if (/^https?:\/\//i.test(node)) out.push({ path, kind: 'url', value: node })
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectImages(item, `${path}[${index}]`, out, depth + 1))
    return out
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        if (B64_KEYS.test(key) && value.length > 64) { out.push({ path: `${path}.${key}`, kind: 'b64', value }); continue }
        if (URL_KEYS.test(key) && /^https?:\/\//i.test(value)) { out.push({ path: `${path}.${key}`, kind: 'url', value }); continue }
      }
      if (INLINE_KEYS.test(key) && value && typeof value === 'object' && typeof value.data === 'string') {
        out.push({ path: `${path}.${key}.data`, kind: 'b64', value: value.data })
        continue
      }
      collectImages(value, `${path}.${key}`, out, depth + 1)
    }
  }
  return out
}

const measure = async candidate => {
  try {
    let bytes
    if (candidate.kind === 'url') {
      bytes = Buffer.from(await (await fetch(candidate.value)).arrayBuffer())
    } else if (candidate.value.startsWith('data:')) {
      bytes = Buffer.from(candidate.value.slice(candidate.value.indexOf(',') + 1), 'base64')
    } else {
      bytes = Buffer.from(candidate.value, 'base64')
    }
    return { ...dimensionsFromBytes(bytes), bytes: bytes.length }
  } catch (error) {
    return { error: error?.message || String(error) }
  }
}

/* ---------------------------------------------------------- 发请求（分两种） */

/** 纯读接口，不带 Authorization 之外的东西 */
const getJson = async path => {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) return { ok: false, status: response.status, text: (await response.text()).slice(0, 200) }
    const text = await response.text()
    try {
      return { ok: true, json: JSON.parse(text) }
    } catch {
      return { ok: false, status: response.status, text: text.slice(0, 200) }
    }
  } catch (error) {
    return { ok: false, status: 0, text: error?.message || String(error) }
  }
}

/**
 * 出图请求。headers 里两个鉴权头都带上 —— 原生 Gemini 路由认 x-goog-api-key，
 * 中转站多半也接受 Authorization；两边都发才不会因为「少了哪个头」误判成不支持。
 */
const postImage = async ({ path, body, label }) => {
  console.log(`\n  → ${label}`)
  console.log(`    POST ${BASE}${path}`)
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
        'x-goog-api-key': KEY
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const text = await response.text()
    if (!response.ok) {
      console.log(`    HTTP ${response.status} — ${text.slice(0, 240)}`)
      return { ok: false, status: response.status, text }
    }
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON，按文本继续挖 */ }

    const tokens = json?.usageMetadata?.candidatesTokenCount
    if (tokens !== undefined) console.log(`    usageMetadata.candidatesTokenCount = ${tokens}`)

    const found = json ? collectImages(json) : collectImages(text)
    const unique = []
    for (const item of found) {
      if (!unique.some(existing => existing.value === item.value)) unique.push(item)
    }
    if (!unique.length) {
      console.log(`    没挖到图片。响应片段：${text.slice(0, 240)}`)
      return { ok: true, images: [] }
    }

    const images = []
    for (const candidate of unique) {
      const size = await measure(candidate)
      if (size.error || !size.width) {
        console.log(`    · ${candidate.path}  量不出尺寸（${size.error || '未知格式'}）`)
        continue
      }
      images.push(size)
      console.log(`    · ${candidate.path}`)
      console.log(`      ${size.width}x${size.height} ${size.format} ${Math.round(size.bytes / 1024)}KB`)
    }
    if (unique.length > 1) {
      console.log(`    注意：一次响应里挖到 ${unique.length} 张图 —— 解析器取第一张，其余会被丢掉。`)
    }
    return { ok: true, images, tokens }
  } catch (error) {
    console.log(`    请求失败：${error?.message || error}`)
    return { ok: false, status: 0, text: String(error?.message || error) }
  }
}

/* -------------------------------------------------------------- 免费阶段 */

/** 价格表里每个模型的 supported_endpoint_types —— 这是厂商自己声明的能力清单 */
const harvestPricing = (node, out = [], depth = 0) => {
  if (!node || typeof node !== 'object' || depth > 14) return out
  if (Array.isArray(node)) {
    node.forEach(item => harvestPricing(item, out, depth + 1))
    return out
  }
  const declared = node.supported_endpoint_types || node.supportedEndpointTypes || node.supported_endpoints
  if (Array.isArray(declared) && declared.length) {
    const name = String(node.model_name || node.model || node.name || node.id || node.key || '').trim()
    if (name) out.push({ name, endpoints: declared.map(String) })
  }
  Object.values(node).forEach(value => {
    if (value && typeof value === 'object') harvestPricing(value, out, depth + 1)
  })
  return out
}

const harvestModelIds = payload => {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.models) ? payload.models : []
  return list
    .map(item => String(typeof item === 'string' ? item : (item?.id || item?.name || item?.model || '')).trim())
    .filter(Boolean)
}

const IMAGE_MODEL_RE = /image|imagen|banana|flux|seedream|dall|sd-|stable/i

const runFreeStage = async () => {
  console.log('\n════════ 免费探测（不打图，不计费）════════')

  const pricing = await getJson('/api/pricing')
  let declaredEndpoints = []
  if (pricing.ok) {
    const entries = harvestPricing(pricing.json)
    const hit = entries.find(entry => entry.name === MODEL)
      || entries.find(entry => entry.name.includes(MODEL) || MODEL.includes(entry.name))
    if (hit) {
      declaredEndpoints = hit.endpoints
      console.log(`\n/api/pricing 命中 ${hit.name}`)
      console.log(`  supported_endpoint_types = ${JSON.stringify(hit.endpoints)}`)
    } else {
      console.log(`\n/api/pricing 里没有 ${MODEL}（共 ${entries.length} 个模型有声明）`)
    }
  } else {
    console.log(`\n/api/pricing 不可用（HTTP ${pricing.status}）—— 这家站可能不是 new-api。跳过。`)
  }

  const models = await getJson('/v1/models')
  let imageModelIds = []
  if (models.ok) {
    const ids = harvestModelIds(models.json)
    imageModelIds = ids.filter(id => IMAGE_MODEL_RE.test(id))
    console.log(`\n/v1/models 返回 ${ids.length} 个模型，其中图片相关的 ${imageModelIds.length} 个：`)
    imageModelIds.slice(0, 20).forEach(id => console.log(`  · ${id}`))
    if (ids.length && !ids.includes(MODEL)) {
      console.log(`  注意：清单里没有 ${MODEL} —— 名字写错了会直接 404。`)
    }
  } else {
    console.log(`\n/v1/models 不可用（HTTP ${models.status}）`)
  }

  return { declaredEndpoints, imageModelIds }
}

/* -------------------------------------------------------------- 付费阶段 */

/** 该走哪条路由 —— 和 api/image.js 的判定保持一致 */
const routesFor = declaredEndpoints => {
  const geminiFamily = prefersChatProtocolForImage(MODEL)
  // 价格表里第一项是厂商推荐的那条路。没有价格表时按模型名猜。
  const declaredNative = declaredEndpoints.some(item => /gemini/i.test(item))
  const routes = []
  if (geminiFamily) {
    if (declaredNative || !declaredEndpoints.length) routes.push('native')
    routes.push('chat')
  }
  routes.push('image')
  return routes
}

const buildBody = async (route, tier) => {
  if (route === 'native') {
    return {
      path: buildGeminiNativePath(MODEL),
      body: await buildGeminiImageRequest({ model: MODEL, prompt: PROMPT, size: RATIO, resolution: tier })
    }
  }
  if (route === 'chat') {
    return {
      path: '/v1/chat/completions',
      body: buildChatImageRequest({
        model: MODEL, prompt: PROMPT, images: [], size: RATIO, resolution: tier, ratioInPrompt: false
      })
    }
  }
  return {
    path: '/v1/images/generations',
    body: normalizeImageGenerationRequestBody({
      requestBody: { model: MODEL, prompt: PROMPT, n: 1, size: '1024x1536', resolution: tier },
      modelKey: MODEL,
      // 默认严格：只发标准字段。探测的目的就是看标准字段够不够。
      strict: true
    })
  }
}

const ROUTE_LABEL = {
  native: '原生 Gemini 路由',
  chat: 'chat 协议出图',
  image: 'OpenAI 生图端点'
}

/**
 * 差分：同一路由各打一次 1K 和 4K，比真实像素。
 * 形状一样 = 档位被吞（和具体模型无关，不用维护尺寸表）。
 */
const probeTier = async route => {
  const lowSpec = await buildBody(route, '1K')
  const low = await postImage({ ...lowSpec, label: `${ROUTE_LABEL[route]} · 1K` })
  if (!low.ok || !low.images?.length) return { route, verdict: 'unreachable', low }

  const highSpec = await buildBody(route, '4K')
  const high = await postImage({ ...highSpec, label: `${ROUTE_LABEL[route]} · 4K` })
  if (!high.ok || !high.images?.length) return { route, verdict: 'unreachable', low, high }

  const maxOf = list => Math.max(...list.map(item => Math.max(item.width, item.height)))
  const lowMax = maxOf(low.images)
  const highMax = maxOf(high.images)
  // 1.5 倍是宽松阈值：真正的 1K→4K 是 4 倍，而「换个默认档」这种抖动不会超过 1.5
  const verdict = highMax > lowMax * 1.5 ? 'honored' : 'swallowed'
  return { route, verdict, low, high, lowMax, highMax }
}

const runDeepStage = async declaredEndpoints => {
  console.log('\n════════ 付费探测（会真出图计费）════════')
  console.log('每条路由两次请求（1K / 4K），命中定论即停。')

  const routes = routesFor(declaredEndpoints)
  console.log(`候选路由：${routes.map(route => ROUTE_LABEL[route]).join(' → ')}`)

  for (const route of routes) {
    const result = await probeTier(route)
    if (result.verdict === 'unreachable') {
      console.log(`  ${ROUTE_LABEL[route]}：打不通，试下一条。`)
      continue
    }
    if (result.verdict === 'honored') {
      console.log(`\n  ✓ ${ROUTE_LABEL[route]} 认档位：1K → ${result.lowMax}px，4K → ${result.highMax}px`)
      return { route, verdict: 'honored' }
    }
    console.log(`\n  ✗ ${ROUTE_LABEL[route]} 吞档位：1K 和 4K 都回 ${result.highMax}px，一模一样。`)
    return { route, verdict: 'swallowed' }
  }

  return { route: '', verdict: 'unreachable' }
}

/* ------------------------------------------------------------------ 主流程 */

console.log('中转站体检 | probe-relay')
console.log(`Base URL: ${BASE}`)
console.log(`Key:      ${mask(KEY)}`)
console.log(`模型:     ${MODEL}`)

const { declaredEndpoints } = await runFreeStage()

let tierResult = { route: '', verdict: 'skipped' }
if (DEEP) {
  tierResult = await runDeepStage(declaredEndpoints)
} else {
  console.log('\n（没加 --deep：跳过出图探测。要确认尺寸参数真的送得进去，加 --deep。）')
}

/* ------------------------------------------------------- 结论 → 可粘贴配置 */

const config = {}
const notes = []
const geminiFamily = prefersChatProtocolForImage(MODEL)

if (tierResult.verdict === 'honored') {
  if (tierResult.route === 'native') {
    config.geminiNative = true
    notes.push('原生 Gemini 路由认档位 —— 开了它，1K/2K/4K 才是真的。')
  }
  config.supportsImageSize = true
  notes.push('档位送得进去，不需要锁清晰度选项。')
} else if (tierResult.verdict === 'swallowed') {
  config.supportsImageSize = false
  notes.push('档位被吞（1K/4K 出图一样大）。客户端会把清晰度选项收敛到实际会出的那一档。')
  if (tierResult.route === 'chat') {
    config.ratioInPrompt = true
    notes.push('这条路上参数连比例一起吞，比例改由提示词正文表达。')
  }
} else if (tierResult.verdict === 'unreachable') {
  notes.push('所有候选路由都打不通 —— 先确认模型名和 Key，再考虑是不是要设 protocols 换协议。')
} else {
  notes.push('没跑出图探测，尺寸相关的开关暂时无法判定。加 --deep 再来一次。')
}

if (!geminiFamily && !declaredEndpoints.some(item => /image-generation|Generate image/i.test(item))) {
  notes.push(`${MODEL} 在价格表里没有生图相关的能力声明 —— 确认它真的能出图。`)
}

console.log('\n════════ 结论 ════════')
notes.forEach(note => console.log(`· ${note}`))

console.log('\n粘到「设置 → 渠道 → 高级配置」（留空即用默认行为）：')
if (Object.keys(config).length) {
  console.log(JSON.stringify(config, null, 2))
} else {
  console.log('{}   ← 这家站用默认行为就行，不用填')
}

console.log('\n如果你发现某家站其实接受额外参数写法（比如认 aspect_ratio 但不认 size），')
console.log('可以试着加 "broadcastImageParams": true 再出一次图验证 —— 默认是关的，')
console.log('因为照着 OpenAI schema 校验的站才是多数，多一个未知键会整个请求 400。')
