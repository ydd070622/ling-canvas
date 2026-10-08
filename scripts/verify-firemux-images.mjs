import { build } from 'esbuild'
import assert from 'node:assert/strict'
const requests = []
globalThis.__imageRequests = requests
const bundled = await build({
  entryPoints: ['src/api/image.js'], bundle: true, write: false, platform: 'node', format: 'esm',
  alias: { '@': './src' }, plugins: [{ name: 'mock-gateway', setup(b) {
    b.onResolve({ filter: /services\/aiGateway|stores\/generationHistory/ }, args => ({ path: args.path, namespace: 'mock' }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('aiGateway')
      ? `export async function requestUpstream(r) { globalThis.__imageRequests.push(r); return {json:{data:[{b64_json:'AAAA'}]}} }`
      : 'export async function recordGeneratedImages() {}' }))
  } }]
})
const { generateImage } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const upstream = { baseUrl: 'https://api.chatfire.site', providerConfig: {} }
const image = 'data:image/png;base64,AAAA'
await generateImage({model:'gemini-3.1-flash-image',prompt:'test',image:[image],size:'3x4',resolution:'2K'}, {upstream})
assert.match(requests[0].requestPath, /gemini-3.1-flash-image:generateContent$/)
assert.deepEqual(requests[0].json.generationConfig, {responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'3:4',imageSize:'2K'}})
assert.equal(requests[0].json.contents[0].parts[1].inlineData.data,'AAAA')
await generateImage({model:'gemini-2.5-flash-image',prompt:'test',resolution:'2K'}, {upstream})
assert.equal(requests[1].json.generationConfig.imageConfig, undefined)
await generateImage({model:'gpt-image-2',prompt:'test',size:'3x4',quality:'standard',n:2}, {upstream})
for (const r of requests.slice(2)) {
  assert.equal(r.requestPath,'/v1/images/generations')
  assert.deepEqual(r.json,{model:'gpt-image-2',prompt:'test',n:1,size:'1024x1536',quality:'auto'})
}
await generateImage({model:'gpt-image-2',prompt:'edit',image:[image,image+'AA'],size:'1024x1536'}, {upstream})
const edit = requests.at(-1)
assert.equal(edit.requestPath,'/v1/images/edits')
assert.equal(edit.files.length,2)
assert.ok(edit.files.every(f => f.name === 'image'))
assert.ok(!edit.fields.some(f => ['resolution','style','response_format'].includes(f.name)))
console.log('PASS: FireMux Gemini native generation/edit, Image 2 JSON/multipart and batch count')
