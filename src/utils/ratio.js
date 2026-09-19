/**
 * Ratio helpers | 比例工具
 * 归一化尺寸字符串（'3024x1296' / '16x9' / '16:9'）→ 常用比例（'21:9'）
 */

// 常用比例（与参考面板一致）| Common ratios
export const COMMON_RATIOS = [
  '1:1', '2:3', '3:2', '4:5',
  '5:4', '4:3', '3:4', '16:9',
  '9:16', '21:9', '9:21', '2:1',
  '1:2', '3:1', '1:3'
]

const gcd = (a, b) => (b ? gcd(b, a % b) : a)

/**
 * 按素材比例给卡片一个合适的宽度 | Card width by media ratio
 *
 * 全景给满宽，竖图收窄 —— 不然一张 9:21 的图在满宽卡片里会撑成一根 860px 高的长条，
 * 明显高过一屏。档位取自原型 infinite_canvas_node_system_v23/25 的 adaptImageNodeToRatio。
 */
export const cardWidthForRatio = (ratio, base = 392) => {
  if (!ratio) return base
  if (ratio >= 1.9) return base
  if (ratio >= 1.45) return Math.round(base * 0.91)
  if (ratio >= 1.15) return Math.round(base * 0.84)
  if (ratio >= 0.88) return Math.round(base * 0.75)
  if (ratio >= 0.68) return Math.round(base * 0.66)
  return Math.round(base * 0.59)
}

/**
 * 尺寸 key 归一化为比例字符串 | Normalize a size key into 'a:b'
 * '1x1'→'1:1'；'2560x1440'→'16:9'（近似匹配常见比例）
 */
export const normalizeRatioKey = (size, { fallback = '' } = {}) => {
  const s = String(size || '')
  let m = s.match(/^(\d+)[x×:](\d+)$/)
  if (!m) return fallback || s
  const w = Number(m[1])
  const h = Number(m[2])
  if (!w || !h) return fallback || s
  const g = gcd(w, h)
  if (g > 1 && w / g <= 32 && h / g <= 32) {
    return `${w / g}:${h / g}`
  }
  return approximateRatio(w / h)
}

/** 宽高比 → 最近常用比例 | Ratio value → nearest common ratio label */
export const approximateRatio = (value) => {
  let best = COMMON_RATIOS[0]
  let bestDiff = Infinity
  COMMON_RATIOS.forEach(ratio => {
    const [a, b] = ratio.split(':').map(Number)
    const diff = Math.abs(value - a / b)
    if (diff < bestDiff) {
      bestDiff = diff
      best = ratio
    }
  })
  return best
}

/** 比例字符串 → 宽高比数值 | '16:9' → 1.777 */
export const ratioValue = (ratio) => {
  const [a, b] = String(ratio).split(':').map(Number)
  return a && b ? a / b : 1
}

/** 查找模型 sizes 中匹配指定比例的尺寸 key | Find model size key matching a ratio */
export const findSizeByRatio = (sizes, ratio) => {
  if (!Array.isArray(sizes)) return null
  const target = ratioValue(ratio)
  let best = null
  let bestDiff = Infinity
  sizes.forEach(size => {
    const m = String(size).match(/^(\d+)[x×:](\d+)$/)
    if (!m) return
    const diff = Math.abs(Number(m[1]) / Number(m[2]) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = size
    }
  })
  return bestDiff < 0.03 ? best : null
}

/** 比例展示文本：'21:9' → '21:9'，'1:1' → '1 × 1' | Display label for a ratio */
export const ratioDisplay = (ratio, { keepColon = false } = {}) => {
  const [a, b] = String(ratio || '').split(':').map(Number)
  if (!a || !b) return String(ratio || '')
  return keepColon ? `${a}:${b}` : `${a} × ${b}`
}
