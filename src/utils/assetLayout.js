import { cardWidthForRatio } from './ratio.js'

// Two columns, with room for the node labels and selection chrome.
export const layoutAssetImages = (ratios, origin, gap = 48) => {
  const sizes = ratios.map(value => {
    const ratio = Number.isFinite(value) && value > 0 ? value : 4 / 3
    const width = cardWidthForRatio(ratio)
    return { width, height: width / ratio }
  })
  const columnWidth = Math.max(0, ...sizes.map(size => size.width))
  let y = origin.y
  return sizes.map((size, index) => {
    if (index > 0 && index % 2 === 0) {
      y += Math.max(sizes[index - 2].height, sizes[index - 1].height) + gap
    }
    return { x: origin.x + (index % 2) * (columnWidth + gap), y }
  })
}
