import { loadImageAsDataUrl, imagePreviewKey, peekImage } from './imageStore'

// Low concurrency and a small recent-project window bound background work.
export const warmProjectMedia = async (project, cancelled = () => false) => {
  const nodes = (project?.canvasData?.nodes || []).filter(node => node.type === 'image').slice(0, 24)
  let index = 0
  await Promise.all(Array.from({length: Math.min(2, nodes.length)}, async () => {
    while (index < nodes.length && !cancelled()) {
      const node = nodes[index++]
      const key = `${project.id}:${node.id}`
      try {
        const preview = await loadImageAsDataUrl(imagePreviewKey(key))
        const source = preview || node.data?.url || await loadImageAsDataUrl(key)
        if (source && !cancelled() && typeof Image !== 'undefined') {
          const image = new Image(); image.src = source
          await image.decode().catch(() => {})
        }
      } catch { /* Missing media must never block homepage navigation. */ }
    }
  }))
}
