/**
 * 清晰度档位选项 | Which 1K/2K/4K tiers the user should even be offered
 *
 * 这段逻辑原先在 CanvasComposer / SimpleImageNode / TaskNode / RenderNode 各写了一遍。
 * 现在多了一条「渠道能不能真的指定档位」的判据（providerCapabilities.supportsImageTier），
 * 四份都得跟着变 —— 所以收成一处，免得下次只改到三处。
 */

import { supportsImageTier } from '@/config/providerCapabilities'

/** 模型没声明档位时的通用兜底 */
export const DEFAULT_IMAGE_TIERS = ['1K', '2K', '4K']

/** 渠道吞档位时，上游实际会出的那一档（gemini 系图片模型的默认档） */
export const FALLBACK_IMAGE_TIER = '1K'

/**
 * @param {Object} args
 * @param {Object} [args.model]          getImageModel() 的结果，读它的 imageResolutions / resolutions
 * @param {string} [args.modelKey]       模型名，用于识别 Seedream 特例与 gemini 系
 * @param {Object} [args.providerConfig]
 * @param {string} [args.baseUrl]        本次实际生效的 Base URL
 * @returns {string[]} 形如 ['1K', '2K', '4K']
 */
export const resolveImageTierOptions = ({ model, modelKey, providerConfig, baseUrl } = {}) => {
  const declared = model?.imageResolutions || model?.resolutions
  const source = Array.isArray(declared) && declared.length
    ? declared
    : (/seedream/i.test(String(modelKey || model?.name || '')) ? ['2K', '4K'] : DEFAULT_IMAGE_TIERS)
  const tiers = source.map(value => String(value).toUpperCase())

  // 渠道收下档位却不透传时，它永远按自己的默认档出图 —— 给 2K/4K 等于让用户选一个拿不到的东西
  if (supportsImageTier(providerConfig, baseUrl, modelKey)) return tiers
  return [FALLBACK_IMAGE_TIER]
}

/**
 * 档位被渠道锁死时给用户看的一句话；能自由切换时返回空串。
 * 没有这句话，下拉从三档静默变成一档只会让人以为界面坏了。
 */
export const imageTierLockNote = ({ providerConfig, baseUrl, modelKey } = {}) => (
  supportsImageTier(providerConfig, baseUrl, modelKey)
    ? ''
    : '该渠道不支持指定清晰度，固定按 1K 出图'
)
