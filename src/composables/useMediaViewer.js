/**
 * useMediaViewer | 全屏查看器
 *
 * 模块级单例：图片 / 视频 / 音频节点都往这里投递要看的素材，`MediaViewer.vue`
 * 在画布上渲染唯一一个查看器。之前每个图片节点各自 Teleport 一个 lightbox，
 * 几张图就是几份重复的遮罩与关闭逻辑，而且视频、音频没有对应的查看方式。
 */
import { ref } from 'vue'

/** @type {import('vue').Ref<null | {url:string, kind:'image'|'video'|'audio', alt?:string}>} */
const viewerState = ref(null)

export const closeMediaViewer = () => { viewerState.value = null }

/** 打开全屏查看；没有 url 时直接忽略（空节点不该弹一个空遮罩） */
export const openMediaViewer = (payload) => {
  if (!payload?.url) return
  viewerState.value = { alt: '', ...payload }
}

export const useMediaViewer = () => ({
  viewerState,
  open: openMediaViewer,
  close: closeMediaViewer
})
