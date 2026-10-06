import { loadImageAsDataUrl, imagePreviewKey } from './imageStore'
import { preferences } from './preferences'
import { canvasPreview } from '../utils/canvasPreview'

// Warm only small persisted previews, never full-resolution originals.
export const warmProjectMedia = async (project, cancelled = () => false) => {
  if (!preferences.value.prewarm) return
  const nodes = (project?.canvasData?.nodes || []).filter(node => node.type === 'image').slice(0, 24)
  const keys = nodes.flatMap(node => [
    imagePreviewKey(`${project.id}:${node.id}`),
    ...(node.data?.galleryUrls || []).map((_, index) => imagePreviewKey(`${project.id}:${node.id}:gallery:${index}`))
  ]).slice(0, 48)
  for (const key of keys) {
    if (cancelled() || !preferences.value.prewarm) return
    try {
      const preview = await loadImageAsDataUrl(key)
      if (preview && !cancelled()) await canvasPreview(preview)
    } catch { /* A missing preview never blocks startup or navigation. */ }
    await new Promise(resolve => setTimeout(resolve, 16))
  }
}

export const startMediaWarmup = (projects, router) => {
  let queue = [], revision = 0, running = false
  const drain = async () => {
    if (running) return
    running = true
    try {
      while (queue.length && preferences.value.prewarm) {
        const project = queue.shift(), current = revision
        await warmProjectMedia(project, () => current !== revision)
      }
    } finally { running = false }
  }
  const schedule = () => {
    revision++
    const recent = projects.value.filter(project => !project.deletedAt).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 3)
    const id = router.currentRoute.value.params.id
    const active = projects.value.find(project => String(project.id) === String(id))
    queue = active ? [active, ...recent.filter(project => project.id !== active.id)] : recent
    void drain()
  }
  router.afterEach(schedule)
  setTimeout(schedule, 100)
}
