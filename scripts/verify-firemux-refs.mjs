import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
register('./alias-loader.mjs', import.meta.url)
globalThis.localStorage = { getItem: () => null, setItem() {} }
const { checkGenerate, resolveRefs } = await import('../src/utils/promptRefs.js')
const node = { id: 'target', type: 'image', data: { prompt: '参考 @图片1 @图片6 @图片7 @图片8，设计客厅' } }
const nodes = [node, ...Array.from({ length: 6 }, (_, i) => ({ id: `ref${i}`, type: 'image', data: { url: `https://example.com/${i}.png` } }))]
const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: n.id, target: node.id, data: { order: i } }))
assert.equal(checkGenerate(node, nodes, edges).ok, true)
const source = fs.readFileSync(new URL('../src/composables/useNodeRefs.js', import.meta.url), 'utf8')
const body = source.split('  const buildPrompt = () => {')[1].split('\n  return {')[0].replace(/\r/g, '').replace(/\n  }\s*$/, '')
const build = new Function('node', 'refs', 'slots', 'presetTextOf', `return ()=>{${body}}`)({ value: node }, { value: resolveRefs(node, nodes, edges) }, { value: [] }, () => '')
assert.equal(build(), '参考 参考图1 参考图6 ，设计客厅')
assert.match(node.data.prompt, /@图片7/)
node.data.refBindings = { 图片1: 'deleted' }
assert.equal(checkGenerate(node, nodes, edges).ok, true)
node.data.prompt = '@文本1'
assert.equal(checkGenerate(node, nodes, edges).code, 'E_BEYOND')
const requests = []
globalThis.fetch = async (url, init) => {
  requests.push({ url, init })
  return new Response(JSON.stringify({ data: [{ url: 'https://example.com/output.png' }] }), { status: 200 })
}
const { generateImage } = await import('../src/api/image.js')
const { describeUpstreamError } = await import('../src/services/aiGateway.js')
assert.doesNotMatch(describeUpstreamError(502, null, '<html><head><title>502 Bad Gateway</title></head></html>'), /<html>/)
const upstream = { baseUrl: 'https://api.chatfire.site/v1', providerConfig: { defaultBaseUrl: 'https://api.chatfire.site' }, apiKey: 'mock-key' }
for (const image of [undefined, nodes.slice(1).map(n => n.data.url)]) {
  await generateImage({ model: 'doubao-seedream-5-0-pro-260628', prompt: '客厅', size: '3:4', resolution: '2K', image }, { upstream })
  const { url, init } = requests.at(-1)
  assert.equal(url, 'https://api.chatfire.site/volcengine/api/v3/images/generations')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(init.body), { model: 'doubao-seedream-5-0-pro-260628', prompt: '客厅', size: '2K', aspect_ratio: '3:4', ...(image ? { image } : {}), n: 1, response_format: 'url' })
}
await generateImage({ model: 'gpt-image-1', prompt: '客厅', image: ['data:image/png;base64,YQ=='] }, { upstream })
assert.equal(requests.at(-1).url, 'https://api.chatfire.site/v1/images/edits')
assert.ok(requests.at(-1).init.body instanceof FormData)
await generateImage({model:'doubao-seedream-5-0-pro-260628',prompt:'客厅',size:'3x4',resolution:'2K'},{upstream})
assert.equal(JSON.parse(requests.at(-1).init.body).size,'2K')
assert.equal(JSON.parse(requests.at(-1).init.body).aspect_ratio,'3:4')
await generateImage({model:'doubao-seedream-5-0-pro-260628',prompt:'客厅',size:'1728x2304',resolution:'2K'},{upstream})
assert.equal(JSON.parse(requests.at(-1).init.body).size,'1728x2304')
await generateImage({ model: 'doubao-seedream-5-0-pro-260628', prompt: '客厅' }, { upstream: { ...upstream, providerConfig: { ...upstream.providerConfig, protocols: { image: 'json' } } } })
assert.equal(requests.at(-1).url, 'https://api.chatfire.site/v1/images/generations')
console.log('PASS: FireMux native JSON, six references, invalid image refs ignored, text validation and explicit overrides preserved')
