/**
 * 生成链路离线验证 | Offline verification of the generation pipeline
 *
 * 目的：在没有真实 API Key、也不启动 Tauri 的前提下，把「文生图 / 图生图 /
 * 图生视频」整条链路对着一个本地 mock 上游真跑一遍，覆盖：
 *   - 端点拼接与 {taskId} 占位符解析
 *   - 请求体归一化（count→n、剥离内部字段、丢弃空值）
 *   - 图生图 multipart 组装（字段名 / 文件名 / MIME / 字节完整性）
 *   - 外链参考图下载分支
 *   - 各家响应包装的图片抽取（裸数组 / 双层 data / chat markdown / b64_json）
 *   - 视频任务状态机（回归：旧实现把「响应里有 data」当成完成）
 *   - 通过 model store 解析自定义渠道，并校验缺 Key / 未知渠道的报错
 *
 * 运行：node scripts/verify-gateway.mjs
 */

import { register } from 'node:module'
import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'

register('./alias-loader.mjs', import.meta.url)

// ---------------------------------------------------------------------------
// 环境桩：本地存储（model store 依赖）
// ---------------------------------------------------------------------------
const memoryStore = new Map()
globalThis.localStorage = {
  getItem: key => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => { memoryStore.set(key, String(value)) },
  removeItem: key => { memoryStore.delete(key) },
  clear: () => memoryStore.clear()
}

// ---------------------------------------------------------------------------
// Mock 上游：一个「OpenAI 兼容」厂商
// ---------------------------------------------------------------------------
const received = []
let videoPollCount = 0
const REFERENCE_BYTES = Buffer.from('ling-canvas-reference-image-bytes')

const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  received.push({ method: req.method, path, headers: req.headers, body })

  const sendJson = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }

  if (req.method === 'GET' && path === '/assets/ref.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(REFERENCE_BYTES)
    return
  }
  // 文生图：标准 OpenAI 包装
  if (path === '/v1/images/generations') {
    return sendJson(200, { created: 1, data: [{ url: `${base}/assets/out.png`, revised_prompt: 'r' }] })
  }
  // 图生图：故意用双层包装 {code, data:{data:[...]}}，验证剥壳
  if (path === '/v1/images/edits') {
    return sendJson(200, { code: 200, data: { data: [{ url: `${base}/assets/edited.png` }] } })
  }
  // 部分厂商只能走对话协议出图
  if (path === '/v1/chat/completions') {
    return sendJson(200, {
      choices: [{ message: { role: 'assistant', content: `好的：\n\n![img](${base}/assets/chat-image.png)` } }]
    })
  }
  if (path === '/v1/videos') {
    return sendJson(200, { code: 200, data: { task_id: 'task_abc' } })
  }
  if (path === '/v1/video/task/task_abc') {
    videoPollCount += 1
    if (videoPollCount === 1) {
      // 关键回归点：带 data 字段但状态仍是处理中，旧实现会在此误判完成
      return sendJson(200, { code: 200, data: { status: 'PROCESSING', progress: 0.4 } })
    }
    return sendJson(200, { code: 200, data: { status: 'SUCCESS', progress: 1, video_url: `${base}/assets/out.mp4` } })
  }
  // 错误路径
  if (path === '/v1/broken/images/generations') {
    return sendJson(401, { error: { message: 'invalid api key' } })
  }
  // 复刻真实上游：图片端点只收 Imagen 模型（用户实测遇到的那条 500）
  if (path === '/v1/imagen-only/images/generations') {
    return sendJson(500, {
      error: { message: 'not supported model for image generation, only imagen models are supported' }
    })
  }
  // 其他 5xx：不应触发协议改道
  if (path === '/v1/ratelimited/images/generations') {
    return sendJson(500, { error: { message: 'rate limit exceeded' } })
  }

  return sendJson(404, { error: { message: `no route ${path}` } })
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`

// ---------------------------------------------------------------------------
// 被测模块（动态导入，确保别名钩子先注册）
// ---------------------------------------------------------------------------
const {
  joinUrl,
  resolveEndpointPath,
  describeUpstreamError,
  requestUpstream
} = await import('../src/services/aiGateway.js')
const {
  normalizeImageGenerationRequestBody,
  buildImageEditMultipart,
  readReferenceImageBytes,
  toTransportableReferenceImage
} = await import('../src/utils/upstreamRequest.js')
const { collectImageResults, collectVideoTask, VIDEO_TASK_STATUS } = await import('../src/utils/resultParser.js')
const { generateImage } = await import('../src/api/image.js')
const { createVideoTask, pollVideoTask } = await import('../src/api/video.js')

const { createPinia, setActivePinia } = await import('pinia')
setActivePinia(createPinia())
const { useModelStore } = await import('../src/stores/pinia/models.js')
const modelStore = useModelStore()
const { useImageGeneration } = await import('../src/hooks/useApi.js')

// ---------------------------------------------------------------------------
// 用 model store 注册一个自定义渠道（等价于用户在设置里新增供应商）
// ---------------------------------------------------------------------------
const relayKey = modelStore.addCustomProvider('MockRelay')
modelStore.updateCustomProvider(relayKey, {
  defaultBaseUrl: base,
  endpoints: {
    chat: '/v1/chat/completions',
    image: '/v1/images/generations',
    imageEdit: '/v1/images/edits',
    video: '/v1/videos',
    videoQuery: '/v1/video/task/{taskId}'
  }
})
modelStore.setApiKeyByProvider(relayKey, 'test-key-123')
modelStore.setBaseUrlByProvider(relayKey, base)
const upstream = modelStore.resolveUpstreamContext(relayKey)

const dataUrl = `data:image/png;base64,${REFERENCE_BYTES.toString('base64')}`

// ---------------------------------------------------------------------------
// 迷你测试运行器
// ---------------------------------------------------------------------------
const failures = []
let passed = 0

const test = async (name, fn) => {
  try {
    await fn()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push({ name, message: error?.message || String(error) })
    console.log(`  FAIL  ${name}\n        ${error?.message || error}`)
  }
}

const lastRequest = path => received.filter(item => item.path === path).pop()
const pollCount = () => received.filter(item => item.path === '/v1/video/task/task_abc' && item.method === 'GET').length

console.log(`\nmock upstream @ ${base}\n`)

// ---------------------------------------------------------------------------
// 1. URL 与端点解析
// ---------------------------------------------------------------------------
await test('joinUrl：base 已带 /v1 时不重复拼接', () => {
  assert.equal(joinUrl('https://a.com/v1', '/v1/images/edits'), 'https://a.com/v1/images/edits')
  assert.equal(joinUrl('https://a.com', 'v1/images/edits'), 'https://a.com/v1/images/edits')
  assert.equal(joinUrl('https://a.com/', '/images/edits'), 'https://a.com/images/edits')
})

await test('resolveEndpointPath：{taskId} 替换与无占位符退化', () => {
  assert.equal(
    resolveEndpointPath({ endpoints: { videoQuery: '/v1/video/task/{taskId}' } }, 'video-query', { taskId: 't 1' }),
    '/v1/video/task/t%201'
  )
  assert.equal(
    resolveEndpointPath({ endpoints: { video: '/v1/videos' } }, 'video-query', { taskId: 't1' }),
    '/v1/videos/t1'
  )
  assert.equal(resolveEndpointPath({}, 'image-edit'), '/v1/images/edits')
})

// ---------------------------------------------------------------------------
// 2. 请求体归一化
// ---------------------------------------------------------------------------
await test('normalizeImageGenerationRequestBody：count→n、剥离内部字段、丢弃空值', () => {
  const body = normalizeImageGenerationRequestBody({
    requestBody: { prompt: '  hi  ', count: 2, _traceId: 'x', quality: '', image: ['   '], providerId: 'p' },
    modelKey: 'm'
  })
  assert.equal(body.n, 2)
  assert.equal(body.prompt, 'hi')
  assert.equal(body.count, undefined)
  assert.equal(body._traceId, undefined)
  assert.equal(body.providerId, undefined)
  assert.equal(body.quality, undefined)
  assert.equal(body.image, undefined)
  assert.equal(body.model, 'm')
})

// ---------------------------------------------------------------------------
// 3. 图生图 multipart 组装
// ---------------------------------------------------------------------------
await test('buildImageEditMultipart：data URL → 文件字段（含 MIME 与扩展名）', async () => {
  const multipart = await buildImageEditMultipart({
    model: 'mock-image-edit',
    prompt: 'edit it',
    size: '1024x1024',
    count: 3,
    referenceImages: [dataUrl]
  })
  const names = multipart.fields.map(field => field.name)
  assert.deepEqual(names, ['model', 'prompt', 'n', 'size'])
  assert.equal(multipart.fields.find(f => f.name === 'n').value, '3')
  assert.equal(multipart.files.length, 1)
  assert.equal(multipart.files[0].name, 'image')
  // 未传 fileNamePrefix 时使用默认前缀
  assert.equal(multipart.files[0].fileName, 'reference-image-1.png')
  assert.equal(multipart.files[0].mime, 'image/png')
  assert.equal(multipart.files[0].dataBase64, REFERENCE_BYTES.toString('base64'))
})

await test('buildImageEditMultipart：自定义文件名前缀与字段名', async () => {
  const multipart = await buildImageEditMultipart({
    model: 'm',
    referenceImages: [dataUrl],
    fileNamePrefix: 'ling-canvas-reference',
    imageField: 'image[]'
  })
  assert.equal(multipart.files[0].fileName, 'ling-canvas-reference-1.png')
  assert.equal(multipart.files[0].name, 'image[]')
})

await test('readReferenceImageBytes：外链走 fetch 分支并保持字节一致', async () => {
  const result = await readReferenceImageBytes(`${base}/assets/ref.png`)
  assert.equal(result.mime, 'image/png')
  assert.equal(result.dataBase64, REFERENCE_BYTES.toString('base64'))
})

// ---------------------------------------------------------------------------
// 4. 文生图 / 图生图 端到端（经网关 fetch 分支）
// ---------------------------------------------------------------------------
await test('文生图：JSON 协议打到 /v1/images/generations，count 归一为 n', async () => {
  const images = await generateImage(
    { model: 'mock-t2i', prompt: 'a cat', size: '1024x1024', count: 3 },
    { upstream }
  )
  assert.equal(images[0].url, `${base}/assets/out.png`)

  const request = lastRequest('/v1/images/generations')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.authorization, 'Bearer test-key-123')
  assert.match(request.headers['content-type'], /^application\/json/)

  const payload = JSON.parse(request.body.toString('utf8'))
  assert.equal(payload.model, 'mock-t2i')
  assert.equal(payload.n, 3)
  assert.equal(payload.count, undefined)
})

await test('图生图：multipart 协议打到 /v1/images/edits，且能解析双层包装响应', async () => {
  const images = await generateImage(
    { model: 'mock-image-edit', prompt: 'edit it', size: '1024x1024', image: [dataUrl] },
    { upstream }
  )
  assert.equal(images[0].url, `${base}/assets/edited.png`)

  const request = lastRequest('/v1/images/edits')
  assert.equal(request.headers.authorization, 'Bearer test-key-123')
  assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/)

  const text = request.body.toString('utf8')
  assert.match(text, /name="model"/)
  assert.match(text, /mock-image-edit/)
  assert.match(text, /name="prompt"/)
  assert.match(text, /Content-Disposition: form-data; name="image"; filename="ling-canvas-reference-1\.png"/)
  assert.match(text, /Content-Type: image\/png/)
  // 字节完整性：multipart 体内是解码后的原始字节（不是 base64 文本）
  assert.ok(request.body.includes(REFERENCE_BYTES), 'multipart 体应包含参考图原始字节')
})

await test('图生图：外链参考图（上游产出图）也能作为参考图上传', async () => {
  await generateImage(
    { model: 'mock-image-edit', prompt: 'from link', image: [`${base}/assets/ref.png`] },
    { upstream }
  )
  const request = lastRequest('/v1/images/edits')
  assert.ok(request.body.includes(REFERENCE_BYTES), '外链参考图应下载后原样上传')
})

await test('上游错误：401 归一成可读文案并抛出', async () => {
  const brokenKey = modelStore.addCustomProvider('BrokenRelay')
  modelStore.updateCustomProvider(brokenKey, {
    defaultBaseUrl: base,
    endpoints: { image: '/v1/broken/images/generations' }
  })
  modelStore.setApiKeyByProvider(brokenKey, 'bad-key')
  const brokenUpstream = modelStore.resolveUpstreamContext(brokenKey)

  await assert.rejects(
    () => generateImage({ model: 'x', prompt: 'y' }, { upstream: brokenUpstream }),
    /HTTP 401: invalid api key/
  )
})

await test('describeUpstreamError：优先取上游 message', () => {
  assert.match(describeUpstreamError(401, { error: { message: 'bad key' } }, ''), /^HTTP 401: bad key/)
  assert.match(describeUpstreamError(500, { message: 'boom' }, ''), /^HTTP 500: boom/)
  assert.equal(describeUpstreamError(0, null, ''), '请求失败')
})

// ---------------------------------------------------------------------------
// 5. 结果抽取
// ---------------------------------------------------------------------------
await test('collectImageResults：裸数组 / 双层 data / chat markdown / b64_json', () => {
  assert.equal(collectImageResults([{ url: 'u1' }])[0].url, 'u1')
  assert.equal(collectImageResults({ data: [{ url: 'u2' }] })[0].url, 'u2')
  assert.equal(collectImageResults({ code: 200, data: { data: [{ url: 'u3' }] } })[0].url, 'u3')
  assert.equal(
    collectImageResults({ choices: [{ message: { content: '![x](https://a.example/b.png)' } }] })[0].url,
    'https://a.example/b.png'
  )
  assert.equal(collectImageResults({ data: [{ b64_json: 'AAA' }] })[0].url, 'data:image/png;base64,AAA')
})

// ---------------------------------------------------------------------------
// 6. 视频任务状态机（含旧 bug 回归）
// ---------------------------------------------------------------------------
await test('回归：响应里有 data 但状态是处理中 → 不算完成', () => {
  const task = collectVideoTask({ code: 200, data: { status: 'PROCESSING', progress: 0.4 } })
  assert.equal(task.status, VIDEO_TASK_STATUS.PENDING)
  assert.equal(task.progress, 40) // 0-1 进度归一为百分比
})

await test('状态说成功但没有地址 → 继续等待', () => {
  assert.equal(collectVideoTask({ status: 'SUCCESS' }).status, VIDEO_TASK_STATUS.PENDING)
})

await test('失败状态带出上游错误信息', () => {
  const task = collectVideoTask({ status: 'FAILED', error: { message: 'boom' } })
  assert.equal(task.status, VIDEO_TASK_STATUS.FAILED)
  assert.equal(task.error, 'boom')
})

await test('拿到视频地址即可判定成功（无状态字段的厂商）', () => {
  const task = collectVideoTask({ data: { url: 'https://cdn.example/v.mp4' } })
  assert.equal(task.status, VIDEO_TASK_STATUS.SUCCEEDED)
  assert.equal(task.url, 'https://cdn.example/v.mp4')
})

await test('图生视频：创建任务 + 轮询（第一次 PROCESSING 不提前结束）', async () => {
  const created = await createVideoTask({ model: 'mock-video', prompt: 'p' }, { upstream })
  assert.equal(created.taskId, 'task_abc')

  const before = pollCount()
  const task = await pollVideoTask('task_abc', { upstream, intervalMs: 5, maxAttempts: 5 })
  assert.equal(task.status, VIDEO_TASK_STATUS.SUCCEEDED)
  assert.equal(task.url, `${base}/assets/out.mp4`)
  assert.equal(task.progress, 100)
  assert.equal(pollCount() - before, 2, '第一次轮询不应被判为完成')
})

// ---------------------------------------------------------------------------
// 7. 渠道协议覆盖：只能走 chat 协议出图的厂商
// ---------------------------------------------------------------------------
await test('渠道 protocols 覆盖：image-edit 改走 chat 多模态并从 markdown 取图', async () => {
  const chatKey = modelStore.addCustomProvider('ChatImageRelay')
  modelStore.updateCustomProvider(chatKey, {
    defaultBaseUrl: base,
    endpoints: { chat: '/v1/chat/completions', image: '/v1/images/generations', imageEdit: '/v1/images/edits' },
    protocols: { 'image-edit': 'chat' }
  })
  modelStore.setApiKeyByProvider(chatKey, 'k')
  const chatUpstream = modelStore.resolveUpstreamContext(chatKey)

  const images = await generateImage(
    { model: 'mock-chat-image', prompt: 'draw', image: [dataUrl] },
    { upstream: chatUpstream }
  )
  assert.equal(images[0].url, `${base}/assets/chat-image.png`)

  const body = JSON.parse(lastRequest('/v1/chat/completions').body.toString('utf8'))
  assert.equal(body.messages[0].content[0].type, 'text')
  assert.equal(body.messages[0].content[1].type, 'image_url')
})

// ---------------------------------------------------------------------------
// 8. 渠道解析与节点侧守卫
// ---------------------------------------------------------------------------
await test('未知渠道不再静默回退到默认渠道', () => {
  const unknown = modelStore.resolveUpstreamContext('does-not-exist')
  assert.equal(unknown.providerConfig, null)
  assert.equal(unknown.apiKey, '')
})

await test('回归：分组模型选项必须带出 sourceProvider（节点据此判定渠道）', () => {
  // 用「按渠道启用模型」这条真实路径构造可选项
  modelStore.addCustomImageModelByProvider('mock-image-model', relayKey, 'Mock Image')

  const options = modelStore.groupedImageModelOptions
  assert.ok(options.length > 0, '启用模型后应有可选图片模型')
  options.forEach(option => {
    assert.ok(
      'sourceProvider' in option && option.sourceProvider,
      `下拉选项 ${option.value} 缺少非空 sourceProvider —— 节点会误报「该模型未绑定供应商」`
    )
  })

  // 反查 helper 必须与选项给出同一渠道
  const option = options.find(item => item.value === 'mock-image-model')
  assert.ok(option, '应能找到刚启用的模型')
  assert.equal(option.sourceProvider, relayKey)
  assert.equal(modelStore.resolveModelSourceProvider('mock-image-model', 'IMAGE'), relayKey)
  // 视频/文本分类不应串到图片池
  assert.equal(modelStore.resolveModelSourceProvider('mock-image-model', 'VIDEO'), '')
})

await test('节点守卫：未知渠道 / 缺 Key 时报出可读错误', async () => {
  const image = useImageGeneration()
  await assert.rejects(
    () => image.generate({ model: 'm', prompt: 'p' }, { providerId: 'does-not-exist' }),
    /未找到该模型所属的供应商配置/
  )

  const noKey = modelStore.addCustomProvider('NoKeyRelay')
  modelStore.updateCustomProvider(noKey, { defaultBaseUrl: base })
  await assert.rejects(
    () => image.generate({ model: 'm', prompt: 'p' }, { providerId: noKey }),
    /尚未配置 API Key/
  )
})

await test('节点调用链：useImageGeneration 走完 store → 网关 → 上游', async () => {
  const image = useImageGeneration()
  const result = await image.generate(
    { model: 'mock-t2i', prompt: 'via hook', size: '1024x1024' },
    { providerId: relayKey }
  )
  assert.equal(result[0].url, `${base}/assets/out.png`)
  assert.equal(lastRequest('/v1/images/generations').headers.authorization, 'Bearer test-key-123')
})

// ---------------------------------------------------------------------------
// 9. Tauri 通道契约
//
// 桌面端真正的出网路径是 invoke('http_request' / 'fetch_binary')。这里把
// window.__TAURI_INTERNALS__ 打桩，断言「交给 Rust 的载荷字段名与取值」——
// 字段名一旦写错（camelCase 拼错、忘了 args 包装），Rust 侧会静默丢参。
// ---------------------------------------------------------------------------
const tauriCalls = []

const jsonOk = payload => ({
  status: 200,
  ok: true,
  contentType: 'application/json',
  body: JSON.stringify(payload)
})

const defaultTauriResponder = ({ args }) => {
  // invoke 的载荷形如 { args: {...} }，这里要用内层
  const path = new URL(args.args.url).pathname
  if (path === '/v1/images/generations') return jsonOk({ data: [{ url: 'https://cdn.example/t2i.png' }] })
  if (path === '/v1/images/edits') return jsonOk({ data: [{ url: 'https://cdn.example/edit.png' }] })
  if (path === '/v1/video/task/task_abc') return jsonOk({ status: 'SUCCESS', url: 'https://cdn.example/out.mp4' })
  return jsonOk({})
}

const installTauriStub = (responder = defaultTauriResponder) => {
  globalThis.window = globalThis
  globalThis.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args, options) => {
      tauriCalls.push({ cmd, args, options })
      if (cmd === 'fetch_binary') {
        return {
          contentType: 'image/png',
          dataBase64: REFERENCE_BYTES.toString('base64'),
          byteLength: REFERENCE_BYTES.length
        }
      }
      return responder({ cmd, args })
    }
  }
  tauriCalls.length = 0
}

const removeTauriStub = () => {
  delete globalThis.__TAURI_INTERNALS__
  delete globalThis.window
}

await test('Tauri 通道：文生图 invoke 载荷（args 包装 / camelCase / 无文件字段）', async () => {
  installTauriStub()
  try {
    const images = await generateImage(
      { model: 'mock-t2i', prompt: 'cat', size: '1024x1024', count: 2 },
      { upstream }
    )
    assert.equal(images[0].url, 'https://cdn.example/t2i.png')
    assert.equal(tauriCalls.length, 1)

    const { cmd, args } = tauriCalls[0]
    assert.equal(cmd, 'http_request')
    assert.ok(args.args, '必须以 args 包装，对应 Rust 的 args: HttpRequestArgs')
    assert.equal(args.args.method, 'POST')
    assert.equal(args.args.timeoutMs, 300000) // IMAGE_TIMEOUT_MS
    assert.equal(args.args.headers.Authorization, 'Bearer test-key-123')
    assert.equal(args.args.json.model, 'mock-t2i')
    assert.equal(args.args.json.n, 2)
    assert.deepEqual(args.args.fields, [])
    assert.deepEqual(args.args.files, [])
  } finally {
    removeTauriStub()
  }
})

await test('Tauri 通道：图生图把 base64 交给 Rust，且不携带 json 体', async () => {
  installTauriStub()
  try {
    const images = await generateImage(
      { model: 'mock-image-edit', prompt: 'e', image: [dataUrl] },
      { upstream }
    )
    assert.equal(images[0].url, 'https://cdn.example/edit.png')

    const { args } = tauriCalls[0]
    assert.equal(args.args.json, undefined, 'multipart 请求不能同时带 json')
    assert.equal(args.args.files.length, 1)

    const file = args.args.files[0]
    assert.equal(file.name, 'image')
    assert.equal(file.fileName, 'ling-canvas-reference-1.png')
    assert.equal(file.mime, 'image/png')
    assert.equal(file.dataBase64, REFERENCE_BYTES.toString('base64'))
    assert.equal(file.byteLength, undefined, 'Rust 侧字段名是 dataBase64，不是 byteLength')
    assert.equal(args.args.fields.find(field => field.name === 'prompt').value, 'e')
  } finally {
    removeTauriStub()
  }
})

await test('Tauri 通道：外链参考图先 fetch_binary 再由 Rust 字节上传', async () => {
  installTauriStub()
  try {
    await generateImage(
      { model: 'mock-image-edit', prompt: 'e', image: ['https://cdn.example/ref.png'] },
      { upstream }
    )
    const binary = tauriCalls.find(call => call.cmd === 'fetch_binary')
    assert.ok(binary, '应通过 fetch_binary 下载外链参考图')
    assert.equal(binary.args.url, 'https://cdn.example/ref.png')
    assert.equal(binary.args.timeoutMs, 60000)

    const upload = tauriCalls.find(call => call.cmd === 'http_request')
    assert.equal(upload.args.args.files[0].dataBase64, REFERENCE_BYTES.toString('base64'))
  } finally {
    removeTauriStub()
  }
})

await test('Tauri 通道：视频查询用 GET 且不带 json 体', async () => {
  installTauriStub()
  try {
    const task = await pollVideoTask('task_abc', { upstream, intervalMs: 5, maxAttempts: 2 })
    assert.equal(task.status, VIDEO_TASK_STATUS.SUCCEEDED)

    const request = tauriCalls.find(call => call.cmd === 'http_request')
    assert.equal(request.args.args.method, 'GET')
    assert.ok(request.args.args.url.endsWith('/v1/video/task/task_abc'))
    assert.equal(request.args.args.json, undefined)
  } finally {
    removeTauriStub()
  }
})

await test('Tauri 通道：非 2xx 归一为可读错误', async () => {
  installTauriStub(() => ({
    status: 401,
    ok: false,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'invalid api key' } })
  }))
  try {
    await assert.rejects(
      () => generateImage({ model: 'm', prompt: 'p' }, { upstream }),
      /HTTP 401: invalid api key/
    )
  } finally {
    removeTauriStub()
  }
})

await test('Tauri 通道：命令层失败（字符串 rejection）被包成可用 err.message', async () => {
  installTauriStub(() => {
    throw '上游请求失败: 连接被拒绝'
  })
  try {
    await assert.rejects(
      () => generateImage({ model: 'm', prompt: 'p' }, { upstream }),
      /连接被拒绝/
    )
  } finally {
    removeTauriStub()
  }
})

// ---------------------------------------------------------------------------
// 10. 参考图来源分流
//
// 本地上传的图片在项目重载后会被 canvas store 恢复成 blob: URL
// （stores/canvas.js 的 URL.createObjectURL）。blob: 只能在 webview 内解析：
// 既不能交给 Rust，更不能原样发给厂商——否则图生图必然失败。
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch
const BLOB_URL = 'blob:http://localhost:5173/9f3a-4c21'

const stubBlobFetch = (bytes, mime = 'image/png') => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (String(url || '').startsWith('blob:')) {
      return new Response(bytes, { status: 200, headers: { 'Content-Type': mime } })
    }
    return realFetch(input, init)
  }
}
const restoreFetch = () => { globalThis.fetch = realFetch }

await test('blob: 参考图在 webview 内解析，不经 Rust 下载', async () => {
  stubBlobFetch(REFERENCE_BYTES)
  installTauriStub()
  try {
    const images = await generateImage(
      { model: 'mock-image-edit', prompt: 'e', image: [BLOB_URL] },
      { upstream }
    )
    assert.equal(images[0].url, 'https://cdn.example/edit.png')
    assert.equal(
      tauriCalls.filter(call => call.cmd === 'fetch_binary').length,
      0,
      'blob: 不应交给 Rust fetch_binary'
    )
    const upload = tauriCalls.find(call => call.cmd === 'http_request')
    assert.equal(upload.args.args.files[0].dataBase64, REFERENCE_BYTES.toString('base64'))
  } finally {
    removeTauriStub()
    restoreFetch()
  }
})

await test('本地路径参考图交给 Rust 读盘（而不是被拒绝）', async () => {
  installTauriStub()
  try {
    await generateImage(
      { model: 'mock-image-edit', prompt: 'e', image: ['E:\\pics\\ref.png'] },
      { upstream }
    )
    const binary = tauriCalls.find(call => call.cmd === 'fetch_binary')
    assert.ok(binary, '本地路径应交给 Rust fetch_binary')
    assert.equal(binary.args.url, 'E:\\pics\\ref.png')
  } finally {
    removeTauriStub()
  }
})

await test('toTransportableReferenceImage：外链/data 原样，本地来源转 data URL', async () => {
  assert.equal(
    await toTransportableReferenceImage('https://cdn.example/a.png'),
    'https://cdn.example/a.png'
  )
  const dataUrlInput = `data:image/png;base64,${REFERENCE_BYTES.toString('base64')}`
  assert.equal(await toTransportableReferenceImage(dataUrlInput), dataUrlInput)

  stubBlobFetch(REFERENCE_BYTES)
  try {
    const converted = await toTransportableReferenceImage(BLOB_URL)
    assert.match(converted, /^data:image\/png;base64,/)
    assert.ok(converted.includes(REFERENCE_BYTES.toString('base64')))
  } finally {
    restoreFetch()
  }
})

await test('JSON 协议下 blob: 参考图被转成 data URL，绝不泄漏给厂商', async () => {
  const jsonKey = modelStore.addCustomProvider('JsonEditRelay')
  modelStore.updateCustomProvider(jsonKey, {
    defaultBaseUrl: base,
    endpoints: { image: '/v1/images/generations', imageEdit: '/v1/images/generations' },
    protocols: { 'image-edit': 'json' }
  })
  modelStore.setApiKeyByProvider(jsonKey, 'k')
  const jsonUpstream = modelStore.resolveUpstreamContext(jsonKey)

  stubBlobFetch(REFERENCE_BYTES)
  try {
    await generateImage(
      { model: 'mock-t2i', prompt: 'p', image: [BLOB_URL] },
      { upstream: jsonUpstream }
    )
  } finally {
    restoreFetch()
  }

  const body = JSON.parse(lastRequest('/v1/images/generations').body.toString('utf8'))
  assert.ok(Array.isArray(body.image), 'image 应为数组')
  assert.match(body.image[0], /^data:image\/png;base64,/)
  assert.ok(!String(body.image[0]).startsWith('blob:'), 'blob: 绝不能出现在请求体里')
})

// ---------------------------------------------------------------------------
// 11. 出图协议偏好与自愈
//
// 真实场景：OpenAI 兼容聚合站的 /images/generations 只收 Imagen，Gemini 系
// 图像模型必须走 /chat/completions。这里锁死「按模型名预判」与「按上游报错
// 自愈重试」两条路径，以及不被滥用的边界。
// ---------------------------------------------------------------------------
const { prefersChatProtocolForImage } = await import('../src/config/providerCapabilities.js')

const countPath = path => received.filter(item => item.path === path).length

await test('协议偏好：Gemini / Nano Banana 走 chat，Imagen 等仍走图片端点', () => {
  assert.equal(prefersChatProtocolForImage('gemini-3.1-flash-image'), true)
  assert.equal(prefersChatProtocolForImage('gemini-2.5-flash-image-preview'), true)
  assert.equal(prefersChatProtocolForImage('nano-banana-pro'), true)
  assert.equal(prefersChatProtocolForImage('nano_banana'), true)
  // 这些恰恰是图片端点支持的，绝不能改道
  assert.equal(prefersChatProtocolForImage('imagen-4.0-generate-001'), false)
  assert.equal(prefersChatProtocolForImage('doubao-seedream-4-5-251128'), false)
  assert.equal(prefersChatProtocolForImage('flux-pro-1.1'), false)
  assert.equal(prefersChatProtocolForImage('gpt-image-1'), false)
  assert.equal(prefersChatProtocolForImage(''), false)
})

await test('Gemini 图像模型：文生图自动改走 chat/completions', async () => {
  const generationsBefore = countPath('/v1/images/generations')
  const chatBefore = countPath('/v1/chat/completions')

  const images = await generateImage(
    { model: 'gemini-3.1-flash-image', prompt: '一只猫' },
    { upstream }
  )
  assert.equal(images[0].url, `${base}/assets/chat-image.png`)
  assert.equal(countPath('/v1/images/generations') - generationsBefore, 0, '不应打到图片端点')
  assert.equal(countPath('/v1/chat/completions') - chatBefore, 1)
})

await test('自愈：图片端点回「不支持该模型」时自动改走 chat 重试', async () => {
  const relayKey2 = modelStore.addCustomProvider('ImagenOnlyRelay')
  modelStore.updateCustomProvider(relayKey2, {
    defaultBaseUrl: base,
    endpoints: {
      chat: '/v1/chat/completions',
      image: '/v1/imagen-only/images/generations',
      imageEdit: '/v1/imagen-only/images/generations'
    }
  })
  modelStore.setApiKeyByProvider(relayKey2, 'k')
  const relayUpstream = modelStore.resolveUpstreamContext(relayKey2)

  const badBefore = countPath('/v1/imagen-only/images/generations')
  const chatBefore = countPath('/v1/chat/completions')

  // 模型名不命中偏好表 → 先按默认 json 协议打图片端点 → 500 → 自愈
  const images = await generateImage(
    { model: 'mystery-image-model', prompt: 'p' },
    { upstream: relayUpstream }
  )
  assert.equal(images[0].url, `${base}/assets/chat-image.png`)
  assert.equal(countPath('/v1/imagen-only/images/generations') - badBefore, 1, '应先试图片端点')
  assert.equal(countPath('/v1/chat/completions') - chatBefore, 1, '再改走 chat 重试')
})

await test('自愈边界：限流等其他 5xx 原样抛出，不改道重试', async () => {
  const relayKey3 = modelStore.addCustomProvider('RateLimitedRelay')
  modelStore.updateCustomProvider(relayKey3, {
    defaultBaseUrl: base,
    endpoints: { chat: '/v1/chat/completions', image: '/v1/ratelimited/images/generations' }
  })
  modelStore.setApiKeyByProvider(relayKey3, 'k')
  const relayUpstream = modelStore.resolveUpstreamContext(relayKey3)

  const chatBefore = countPath('/v1/chat/completions')
  await assert.rejects(
    () => generateImage({ model: 'mystery-image-model', prompt: 'p' }, { upstream: relayUpstream }),
    /HTTP 500: rate limit exceeded/
  )
  assert.equal(countPath('/v1/chat/completions') - chatBefore, 0, '不应改道重试')
})

await test('边界：渠道显式声明协议时不被自动改道', async () => {
  const relayKey4 = modelStore.addCustomProvider('ExplicitProtocolRelay')
  modelStore.updateCustomProvider(relayKey4, {
    defaultBaseUrl: base,
    endpoints: { chat: '/v1/chat/completions', image: '/v1/images/generations' },
    // 显式要求走图片端点，即使模型名命中 Gemini 偏好
    protocols: { image: 'json' }
  })
  modelStore.setApiKeyByProvider(relayKey4, 'k')
  const relayUpstream = modelStore.resolveUpstreamContext(relayKey4)

  const generationsBefore = countPath('/v1/images/generations')
  const images = await generateImage(
    { model: 'gemini-3.1-flash-image', prompt: 'p' },
    { upstream: relayUpstream }
  )
  assert.equal(images[0].url, `${base}/assets/out.png`)
  assert.equal(countPath('/v1/images/generations') - generationsBefore, 1, '显式选择优先')
})

// ---------------------------------------------------------------------------
server.close()

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\n失败用例：')
  failures.forEach(item => console.log(`  - ${item.name}: ${item.message}`))
  process.exit(1)
}
