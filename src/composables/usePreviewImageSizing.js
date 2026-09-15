/**
 * usePreviewImageSizing - 大图预览的按比例自适应尺寸 | Size a preview card to its image
 *
 * 素材库页和画布内的选图弹窗共用同一份算法：两处的大图必须长得一样，
 * 尺寸算两遍迟早会漂。调用方只管拿 url，尺寸由这里负责。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** 卡片左右内边距合计（App.vue 的 Card override 是 24px 一侧） */
const PREVIEW_PADDING_X = 48
/** 卡片上下除图片以外的开销：标题栏 + 底部路径 + 上下内边距 */
const PREVIEW_CHROME_Y = 132
/** 再大的原图也不放到这个宽度以上，否则一张图占满整个屏幕 */
const PREVIEW_MAX_IMAGE_WIDTH = 1600

export const usePreviewImageSizing = () => {
  /** 按原图比例算出的显示尺寸；null = 还没加载出来（或已复位） */
  const previewSize = ref(null)
  const previewImageRef = ref(null)

  /**
   * 外框宽度 = 图片显示宽度 + 左右内边距。
   * 之前直接用图片宽度当卡片宽度，图片只占内容区，于是两侧各空出 24px，
   * 看起来像"外框比图片大一圈"。
   */
  const previewModalStyle = computed(() => (
    previewSize.value
      ? { width: `${previewSize.value.width + PREVIEW_PADDING_X}px`, maxWidth: '94vw' }
      : { width: '380px' }
  ))

  const measure = (image) => {
    if (!image?.naturalWidth) return
    // 卡片自身也要留在视口内：可用高度要扣掉标题和底部路径
    const maxImageWidth = Math.min(
      window.innerWidth * 0.94 - PREVIEW_PADDING_X,
      PREVIEW_MAX_IMAGE_WIDTH
    )
    const maxImageHeight = window.innerHeight * 0.9 - PREVIEW_CHROME_Y
    const scale = Math.min(1, maxImageWidth / image.naturalWidth, maxImageHeight / image.naturalHeight)
    previewSize.value = {
      width: Math.max(120, Math.round(image.naturalWidth * scale)),
      height: Math.max(80, Math.round(image.naturalHeight * scale))
    }
  }

  const onPreviewImageLoad = (event) => measure(event.target)

  /**
   * 换图前调用。不复位的话，新图解码出来之前外框会先按上一张的尺寸撑在那儿，
   * 换图时能看到明显的跳一下。
   */
  const resetPreviewSize = () => { previewSize.value = null }

  // 全屏 / 改窗口尺寸后按新视口重算，否则外框会一直停在打开那一刻的尺寸
  const onWindowResize = () => measure(previewImageRef.value)

  onMounted(() => window.addEventListener('resize', onWindowResize))
  onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))

  return { previewSize, previewModalStyle, previewImageRef, onPreviewImageLoad, resetPreviewSize }
}
