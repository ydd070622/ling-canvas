/**
 * Node 侧 `@/` 别名解析钩子，供 scripts/verify-gateway.mjs 使用。
 * 仅用于验证脚本，不参与应用构建（应用侧由 vite resolve.alias 负责）。
 *
 * 需要处理三种情况：
 *   1. 带扩展名：@/utils/index.js
 *   2. 单文件：  @/services/aiGateway   → src/services/aiGateway.js
 *   3. 目录索引：@/stores/pinia         → src/stores/pinia/index.js
 */
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcRoot = new URL('../src/', import.meta.url)

const isFile = (url) => {
  try {
    return statSync(fileURLToPath(url)).isFile()
  } catch {
    return false
  }
}

const resolveAlias = (relative) => {
  const candidates = [
    relative,
    `${relative}.js`,
    `${relative}/index.js`,
    `${relative}.mjs`,
    `${relative}.json`
  ]
  for (const candidate of candidates) {
    const url = new URL(candidate, srcRoot)
    // 必须排除目录：@/stores/pinia 本身是目录，直接命中会触发 ERR_UNSUPPORTED_DIR_IMPORT
    if (isFile(url)) return url
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = resolveAlias(specifier.slice(2))
    if (!target) {
      throw new Error(`别名解析失败：${specifier}（在 src/ 下找不到对应文件）`)
    }
    return nextResolve(target.href, context)
  }

  // 源码里存在大量无扩展名的相对导入（如 `from './models'`）：
  // 打包器允许，Node ESM 不允许，这里补齐。
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier)
  if (isRelative && !hasExtension) {
    for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
      const url = new URL(candidate, context.parentURL)
      if (isFile(url)) return nextResolve(url.href, context)
    }
  }

  return nextResolve(specifier, context)
}
