// JSON cloning must not encode megabytes of immutable media on every edit.
const encode = (value, media) => JSON.stringify(value, (_key, item) => {
  if (typeof item !== 'string' || !item.startsWith('data:')) return item
  if (!media.has(item)) media.set(item, media.size)
  return { __canvasSnapshotMedia: media.get(item) }
})

export const cloneMediaSnapshot = value => {
  const media = new Map()
  const json = encode(value, media)
  const values = [...media.keys()]
  return JSON.parse(json, (_key, item) => (
    item && typeof item === 'object' && Object.keys(item).length === 1 &&
    Number.isInteger(item.__canvasSnapshotMedia)
      ? values[item.__canvasSnapshotMedia] : item
  ))
}

export const equalMediaSnapshots = (a, b) => {
  const media = new Map()
  return encode(a, media) === encode(b, media)
}
