/**
 * useModelGuard - 模型用途校验 | Model purpose guard
 * 对话模型（gemini/gpt/flash 等）不能用于图片/视频生成，
 * 发送前拦截并提示，避免服务端 500（"only imagen models are supported" 一类报错）
 */
import { useModelStore } from '../stores/pinia'
import { CHAT_MODELS } from '../config/models'

// 明显是图片/视频模型的特征 | Strongly image/video models
// 注意：gemini-3.1-flash-image 等 "-image" 后缀模型是生图模型，须豁免
const MEDIA_MODEL_FEATURE = /(imagen|banana|seedream|seedance|nano-|dall|kling|runway|sora|vidu|pix|[-_.]image$|^image)/i
// 常见对话模型特征（未出现在内置/自定义模型表时的兜底）| Text-model key patterns
const TEXT_MODEL_FEATURE = /(^gpt-|^claude|^deepseek|^qwen|^o\d|flash$|-flash|preview$|-preview|^-?lite$|-lite|gemini-[\d.]+(?!.*image)|gemini-pro(?!.*image)|gemini-flash(?!.*image)|chat$|^glm)/i

/**
 * 判断模型 key 是否为"对话模型"
 * @returns {boolean} true = 应视为文本模型（不可用于 图片/视频 生成）
 */
export const isLikelyTextModel = (modelKey) => {
  const key = String(modelKey || '')
  if (!key) return false
  const modelStore = useModelStore()
  // 权威判定 1：在对话模型列表中（内置或自定义）→ 文本模型
  if (modelStore.getChatModel?.(key)) {
    // 若同时也在图片模型列表（如用户双配），以"图片白名单特征"优先豁免
    if (!MEDIA_MODEL_FEATURE.test(key)) return true
  }
  // 权威判定 2：在图片模型列表中且在媒体白名单 → 图片模型
  if (MEDIA_MODEL_FEATURE.test(key)) return false
  // 兜底：内置对话 key / 特征匹配
  if (CHAT_MODELS.some(m => m.key === key)) return true
  return TEXT_MODEL_FEATURE.test(key)
}

/** 生成错误附带使用的模型与供应商信息 | Enrich error message */
export const enrichModelError = (err, model, extra = '') => {
  const msg = err?.message || String(err)
  if (model) {
    return `${msg}\n（使用模型：${model}${extra ? ' · ' + extra : ''}）`
  }
  return msg
}
