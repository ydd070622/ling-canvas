// Vue Flow owns these caches. Replaying them from a document or a business
// update can reset the current drag geometry to an older frame.
export const toCanvasNode = node => {
  const { computedPosition, handleBounds, dimensions, initialized, isParent,
    dragging, resizing, ...payload } = node
  return payload
}

export const toFlowNode = node => {
  const { computedPosition, handleBounds, dimensions, initialized, isParent,
    ...payload } = node
  return payload
}
