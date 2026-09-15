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
import { NIcon } from 'naive-ui'
import { EyeOutline } from '@vicons/ionicons5'
import { acquireThumbUrl } from '../../services/assetLibrary'

const props = defineProps({
  entry: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  /**
   * 是否显示「放大查看」按钮。
   *
   * 画布内的选图弹窗要开：那里单击是**选中**，看和选必须分成两个动作。
   * 素材库页不要：那边单击本来就是打开大图，再挂一个按钮只是把同一件事
   * 说两遍，而且那个按钮还会因为没人接 `preview` 事件变成一个哑按钮。
   */
  showPreviewButton: { type: Boolean, default: false }
})
// open = 单击选中（插进画布走这条），preview = 点眼睛放大查看，两者互不干扰
const emit = defineEmits(['open', 'preview'])

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
  <!-- 根节点是 div 而不是 button：眼睛按钮要放在里面，而 button 套 button
       是非法 HTML，浏览器会把 DOM 重排掉。role + tabindex 补回按钮语义。 -->
  <div
    ref="root"
    class="asset-thumb"
    :class="{ 'asset-thumb--selected': selected }"
    :title="entry.relativePath"
    role="button"
    tabindex="0"
    @click="emit('open', entry)"
    @keydown.enter.prevent="emit('open', entry)"
    @keydown.space.prevent="emit('open', entry)"
  >
    <img v-if="thumbUrl" class="asset-thumb__img" :src="thumbUrl" :alt="entry.name" />
    <span v-else-if="state === 'failed'" class="asset-thumb__failed">无法预览</span>
    <span v-else class="asset-thumb__skeleton" />

    <!-- 放大查看。必须 stop，否则会连带切换选中态——这个按钮的全部意义
         就是「看」和「选」分开。 -->
    <button
      v-if="showPreviewButton"
      type="button"
      class="asset-thumb__zoom"
      title="放大查看"
      aria-label="放大查看"
      @click.stop="emit('preview', entry)"
    >
      <n-icon :size="16"><EyeOutline /></n-icon>
    </button>
  </div>
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

/* 放大查看。默认不仅透明，而且 pointer-events: none——
   只藏 opacity 的话右上角会留一块看不见的点击区，
   用户想选中却点到那儿，会意外开出大图而不是切换选中。 */
.asset-thumb__zoom {
  position: absolute; top: 4px; right: 4px; z-index: 2;
  display: grid; place-items: center;
  /* 图标视觉 16px，但命中区撑到 30px：素材库里全是密集小图，点不准就白做了 */
  width: 30px; height: 30px; padding: 0;
  border: none; border-radius: 8px;
  background: rgba(15, 23, 42, 0.55);
  color: #fff; cursor: pointer;
  opacity: 0; pointer-events: none;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.asset-thumb:hover .asset-thumb__zoom,
.asset-thumb:focus-within .asset-thumb__zoom,
.asset-thumb__zoom:focus-visible {
  opacity: 1; pointer-events: auto;
}
.asset-thumb__zoom:hover { background: rgba(15, 23, 42, 0.8); }
.asset-thumb__zoom:focus-visible { outline: 2px solid var(--accent-color, #22c55e); outline-offset: 1px; }

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
  .asset-thumb__zoom { transition: none; }
}
</style>
