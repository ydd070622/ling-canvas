import { cardWidthForRatio, ratioValue } from './ratio.js'

export const renderOutputSize = (ratio, measured = {}) => {
  const value = ratioValue(ratio || '3:4')
  const width = Math.max(cardWidthForRatio(value), Number(measured.width) || 0)
  return { width, height: Math.max(width / value + 44, Number(measured.height) || 0) }
}

export const renderOutputOffsets = (sourceY, ratios) => {
  const known = sourceY.filter(Number.isFinite)
  const base = known.length ? Math.min(...known) : 0
  let bottom = -48
  return sourceY.map((value, index) => {
    const y = Math.max(Number.isFinite(value) ? value - base : 0, bottom + 48)
    bottom = y + renderOutputSize(ratios[index]).height
    return y
  })
}
