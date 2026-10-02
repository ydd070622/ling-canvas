export const isEdgeRunning = (source, target) => {
  if (target?.data?.error && !target?.data?.loading) return false
  if (source?.type === 'render') return target?.data?.loading === true && !target?.data?.error
  return source?.data?.loading === true || target?.data?.loading === true
}
