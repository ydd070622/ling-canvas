<script setup>
/**
 * 单个素材缩略图瓦片 | Single asset thumbnail tile
 *
 * 缩略图按需生成：只有滚进视口（含 400px 预取边距）才开始解码。
 * 一次性生成几百张会把内存打爆——实测素材库里有单张 42MB 的图，
 * 解码后一张就接近百 MB 量级，所以这里既靠 IntersectionObserver，
 * 也靠 assetLibrary 里的并发闸门。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { acquireThumbUrl } from '../../services/assetLibrary'

const props = defineProps({
  entry: { type: Object, required: true },
  selected: { type: Boolean, default: false }
})
const emit = defineEmits(['open'])

const root = ref(null)
const thumbUrl = ref('')
// 'idle' | 'loading' | 'ready' | 'failed'
const state = ref('idle')
let observer = null
let disposed = false

const load = async () => {
  if (disposed || state.value === 'loading' || state.value === 'ready') return
  state.value = 'loading'
  try {
    const url = await acquireThumbUrl(props.entry)
    if (disposed) return
    if (url) {
      thumbUrl.value = url
      state.value = 'ready'
    } else {
      state.value = 'failed'
    }
  } catch {
    if (!disposed) state.value = 'failed'
  }
}

onMounted(() => {
  observer = new IntersectionObserver(entries => {
    if (entries.some(item => item.isIntersecting)) {
      load()
      // 加载过就不必再观察
      observer?.disconnect()
    }
  }, { rootMargin: '400px' })
  if (root.value) observer.observe(root.value)
})

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
})
</script>

<template>
  <button
    ref="root"
    type="button"
    class="asset-thumb"
    :class="{ 'asset-thumb--selected': selected }"
    :title="entry.relativePath"
    @click="emit('open', entry)"
  >
    <img v-if="thumbUrl" class="asset-thumb__img" :src="thumbUrl" :alt="entry.name" />
    <span v-else-if="state === 'failed'" class="asset-thumb__failed">无法预览</span>
    <span v-else class="asset-thumb__skeleton" />
  </button>
</template>

<style scoped>
.asset-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary, #f1f5f9);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.asset-thumb:hover { transform: translateY(-2px); border-color: var(--accent-color, #22c55e); }
.asset-thumb--selected {
  border-color: var(--accent-color, #22c55e);
  box-shadow: 0 0 0 2px var(--accent-color, #22c55e);
}

.asset-thumb__img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* 骨架屏：避免网格在缩略图陆续生成时不停跳动 */
.asset-thumb__skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, rgba(148, 163, 184, 0.14) 30%, rgba(148, 163, 184, 0.26) 50%, rgba(148, 163, 184, 0.14) 70%);
  background-size: 200% 100%;
  animation: asset-thumb-shimmer 1.4s ease-in-out infinite;
}
@keyframes asset-thumb-shimmer {
  from { background-position: 180% 0; }
  to { background-position: -20% 0; }
}

.asset-thumb__failed {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #94a3b8;
  font-size: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .asset-thumb__skeleton { animation: none; }
  .asset-thumb:hover { transform: none; }
}
</style>
