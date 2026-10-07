const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
export function sortLocalFiles(entries, order) {
  const descending = order.endsWith('-desc')
  const time = order.startsWith('time-')
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    const comparison = time ? (a.modifiedAt || 0) - (b.modifiedAt || 0) : names.compare(a.name, b.name)
    return (comparison || names.compare(a.name, b.name)) * (descending ? -1 : 1)
  })
}
