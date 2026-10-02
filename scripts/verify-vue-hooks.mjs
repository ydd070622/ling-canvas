import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, babelParse } from '@vue/compiler-sfc'

const hooks = new Set(['onMounted', 'onBeforeMount', 'onUpdated', 'onBeforeUpdate',
  'onUnmounted', 'onBeforeUnmount', 'onActivated', 'onDeactivated', 'onErrorCaptured',
  'onRenderTracked', 'onRenderTriggered', 'onServerPrefetch'])
const errors = []
let checked = 0
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return
  if (node.type) visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
const scan = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await scan(path); continue }
    if (!path.endsWith('.vue')) continue
    const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
    for (const script of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
      const ast = babelParse(script.content, { sourceType: 'module', plugins: ['typescript'] })
      const imports = new Set()
      walk(ast, node => {
        if (node.type === 'ImportDeclaration' && node.source.value === 'vue') {
          node.specifiers.forEach(specifier => imports.add(specifier.local.name))
        }
      })
      walk(ast, node => {
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && hooks.has(node.callee.name)) {
          checked++
          if (!imports.has(node.callee.name)) errors.push(`${path}:${node.loc.start.line}: missing Vue import ${node.callee.name}`)
        }
      })
    }
  }
}
await scan('src')
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log(`PASS: ${checked} Vue lifecycle calls have explicit imports`)
