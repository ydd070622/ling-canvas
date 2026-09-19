<template>
  <!-- 全屏查看器 | Fullscreen media viewer
       图片 / 视频 / 音频共用。挂在画布上唯一一个，由 useMediaViewer 单例驱动。

       行为：**按窗口适配（fit to window）** —— 无论原图多大，都缩放到刚好放得下；
       窗口变大或进全屏，图片跟着变大。不是"按原尺寸显示、超了才缩"，
       那样一张 4000px 的图会几乎顶满屏幕，而一张小图又只有一点点。
       不铺黑底：遮罩透明，只用来接点击，画面靠阴影浮在画布上。 -->
  <Teleport to="body">
    <div v-if="viewerState" ref="viewerRef" class="media-viewer" @click.self="close">
      <button class="viewer-close" type="button" title="关闭（Esc）" @click="close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <div ref="stageRef" class="viewer-stage" @click.stop>
        <img
          v-if="viewerState.kind === 'image'"
          :src="viewerState.url"
          :alt="viewerState.alt"
          :style="mediaStyle"
          @load="fitToWindow"
        />
        <video
          v-else-if="viewerState.kind === 'video'"
          :src="viewerState.url"
          :style="mediaStyle"
          controls
          autoplay
          playsinline
          @loadedmetadata="fitToWindow"
        />
        <div v-else class="viewer-audio">
          <span class="viewer-audio-name">{{ viewerState.alt || '音频' }}</span>
          <audio :src="viewerState.url" controls autoplay />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMediaViewer } from '../../composables/useMediaViewer'

const { viewerState, close } = useMediaViewer()

const viewerRef = ref(null)
const stageRef = ref(null)
/** 算出来的显示尺寸；null = 还没量到原始尺寸（用 CSS 上限先兜着） */
const mediaSize = ref(null)

/**
 * 画面最多占窗口的多少。留出的边就是"四周的留白"——
 * 太贴近 1 会让图片顶满窗口，看不出是浮在画布上的一层。
 */
const FIT_RATIO = 0.82

const naturalSize = () => {
  const el = stageRef.value?.querySelector('img, video')
  if (!el) return null
  const width = el.naturalWidth || el.videoWidth || 0
  const height = el.naturalHeight || el.videoHeight || 0
  return width && height ? { width, height } : null
}

/**
 * 按当前窗口算一个刚好放得下的尺寸。
 * 窗口缩放、进/出全屏都会重算 —— 所以 windowed 与 fullscreen 两种模式都跟着变。
 */
const fitToWindow = () => {
  const natural = naturalSize()
  if (!natural) return
  const boxWidth = window.innerWidth * FIT_RATIO
  const boxHeight = window.innerHeight * FIT_RATIO
  const scale = Math.min(boxWidth / natural.width, boxHeight / natural.height)
  mediaSize.value = {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale)
  }
}

const mediaStyle = computed(() => (
  mediaSize.value
    ? { width: `${mediaSize.value.width}px`, height: `${mediaSize.value.height}px` }
    : null
))

const onKeydown = (event) => {
  if (event.key === 'Escape' && viewerState.value) close()
}

// 打开时重置尺寸：上一次的尺寸直接套到新素材上会先闪一下错的形状
watch(viewerState, (state) => {
  mediaSize.value = null
  if (!state || state.kind === 'audio') return
  // 缓存命中的图不会再触发 load，得自己补一次
  requestAnimationFrame(fitToWindow)
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', fitToWindow)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', fitToWindow)
})
</script>

<style scoped>
/* 不铺黑底：遮罩全透明，只负责接住"点击空白关闭" */
.media-viewer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  cursor: zoom-out;
}

.viewer-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.viewer-stage img,
.viewer-stage video {
  display: block;
  /* 尺寸由 fitToWindow 算好写进行内样式；这两条只是加载出来之前先兜住，
     免得原始尺寸的大图先撑满一帧再缩回去 */
  max-width: 82vw;
  max-height: 82vh;
  border-radius: 6px;
  object-fit: contain;
  box-shadow: 0 20px 60px rgba(15, 20, 28, 0.34);
}

/* 音频没有画面，给它一张卡片当载体 */
.viewer-audio {
  display: flex;
  min-width: min(480px, 80vw);
  flex-direction: column;
  gap: 14px;
  padding: 22px 24px;
  border: 1px solid var(--border-color, #e3e5e8);
  border-radius: 14px;
  background: var(--bg-secondary, #fff);
  box-shadow: 0 20px 60px rgba(15, 20, 28, 0.24);
}
.viewer-audio-name { color: var(--text-primary, #15171a); font-size: 13px; }
.viewer-audio audio { width: 100%; }

.viewer-close {
  position: fixed;
  top: 20px;
  right: 22px;
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color, #e3e5e8);
  border-radius: 50%;
  background: var(--bg-secondary, #fff);
  color: var(--text-secondary, #626770);
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(15, 20, 28, 0.16);
}
.viewer-close:hover { color: var(--text-primary, #15171a); }
</style>
