const COMMON_RATIOS = [
  [1, 1], [3, 4], [4, 3], [2, 3], [3, 2], [9, 16], [16, 9], [21, 9]
]

export const formatMediaDetails = (dimensions) => {
  const width = Math.round(Number(dimensions?.width) || 0)
  const height = Math.round(Number(dimensions?.height) || 0)
  if (!width || !height) return ''
  const actual = width / height
  const closest = COMMON_RATIOS.reduce((best, ratio) => (
    Math.abs(ratio[0] / ratio[1] - actual) < Math.abs(best[0] / best[1] - actual) ? ratio : best
  ))
  const ratio = Math.abs(closest[0] / closest[1] - actual) < 0.025
    ? `${closest[0]}:${closest[1]}`
    : `${Math.round(actual * 100) / 100}:1`
  return `${width}×${height}·${ratio}`
}
