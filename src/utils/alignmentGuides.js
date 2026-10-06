// Screen-space comparison keeps the visual tolerance constant at every zoom.
export function alignmentGuides(moving, stationary, tolerance = 2) {
  const result = []
  for (const axis of ['x', 'y']) {
    let best = null
    for (const a of moving) for (const b of stationary) {
      const anchors = rect => axis === 'x'
        ? [rect.left, (rect.left + rect.right) / 2, rect.right]
        : [rect.top, (rect.top + rect.bottom) / 2, rect.bottom]
      const aa = anchors(a), bb = anchors(b)
      for (let i = 0; i < 3; i++) {
        const distance = Math.abs(aa[i] - bb[i])
        if (distance <= tolerance && (!best || distance < best.distance)) best = { axis, position: bb[i], distance, offset: bb[i] - aa[i] }
      }
    }
    if (best) result.push(best)
  }
  return result
}
