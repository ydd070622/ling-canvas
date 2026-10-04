// Bounded LRU; pending reads are shared, invalidated writes cannot resurrect
// stale content, and missing media is never cached.
export const createMediaCache = (limit = 64 * 1024 * 1024) => {
  const entries = new Map(), pending = new Map()
  let bytes = 0
  const remove = key => {
    const entry = entries.get(key)
    if (entry) { bytes -= entry.size; entries.delete(key) }
    pending.delete(key)
  }
  const put = (key, value) => {
    remove(key)
    if (!value) return
    const size = typeof value === 'string' ? value.length * 2 : value.size || 0
    if (size > limit) return
    entries.set(key, {value, size}); bytes += size
    while (bytes > limit) remove(entries.keys().next().value)
  }
  const peek = key => {
    const entry = entries.get(key)
    if (!entry) return null
    entries.delete(key); entries.set(key, entry)
    return entry.value
  }
  const load = (key, reader) => {
    const cached = peek(key)
    if (cached) return Promise.resolve(cached)
    if (pending.has(key)) return pending.get(key)
    const task = Promise.resolve().then(reader).then(value => {
      if (pending.get(key) === task) put(key, value)
      return value
    }).finally(() => { if (pending.get(key) === task) pending.delete(key) })
    pending.set(key, task)
    return task
  }
  return {peek, put, remove, load}
}
