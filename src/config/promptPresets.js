/**
 * 提示词预设 | Prompt presets
 *
 * 预设是**整套方案的模板**，不只是几个词：每条带封面、图标、说明和完整的提示词文本，
 * 在画廊弹窗里以卡片形式挑（见 components/canvas/PresetGallery.vue）。
 *
 * 选中之后节点上存的是 `{ id, title, text }` 这个整体，**不往输入框灌文本** ——
 * 那段是固定的套路话，灌进去用户还得在一堆模板腔里找自己写的那句。
 * 真正的文本在生成时由 useNodeRefs 的 buildPrompt 拼在最前面。
 */

const preset = (id, title, description, icon, cover, prompt) =>
  Object.freeze({ id, title, description, icon, cover, prompt })

export const DEFAULT_PRESETS = Object.freeze([
  preset('cinematic', '电影肖像', '电影级人物肖像', '◉', 'linear-gradient(135deg,#3f2b2c,#b88969)',
    '电影级人物肖像，富有层次的戏剧光影，真实皮肤质感，浅景深，精致构图，高动态范围，细节清晰'),
  preset('product', '产品摄影', '干净商业产品图', '◇', 'linear-gradient(135deg,#27333a,#b8c7c9)',
    '专业商业产品摄影，干净背景，柔和棚拍光线，准确材质与色彩，高级构图，清晰细节，无多余元素'),
  preset('concept', '概念场景', '大型环境概念图', '△', 'linear-gradient(135deg,#21364a,#d19a5d)',
    '大型环境概念设计，宏大的空间尺度，清晰的视觉焦点，电影感氛围，丰富层次，高精度细节'),
  preset('fashion', '时尚大片', '杂志风格人像', '✦', 'linear-gradient(135deg,#482d46,#d6a6b9)',
    '高端时尚杂志大片，专业模特姿态，先锋造型，精致布光，强烈视觉风格，高级色彩，高清细节'),
  preset('architecture', '建筑空间', '真实空间可视化', '▦', 'linear-gradient(135deg,#4a4033,#d4c1a2)',
    '专业建筑空间摄影，真实尺度与材质，自然采光，透视准确，构图克制，细节清晰，写实效果'),
  preset('food', '美食摄影', '诱人的食物特写', '●', 'linear-gradient(135deg,#582f20,#e4ae65)',
    '专业美食摄影，新鲜诱人的食物质感，自然柔光，浅景深，精致摆盘，温暖色调，高清细节'),
  preset('anime', '动漫角色', '精细角色立绘', '☆', 'linear-gradient(135deg,#29335c,#b6a8ee)',
    '高质量动漫角色设计，清晰轮廓，精致五官与服装细节，富有表现力的姿态，完整配色，插画级完成度'),
  preset('watercolor', '水墨意境', '现代东方水墨', '≈', 'linear-gradient(135deg,#303638,#c7c4b8)',
    '现代东方水墨画，留白构图，淡雅墨色，自然笔触，诗意氛围，细腻纸张肌理，含蓄而高级'),
  preset('retro', '复古胶片', '胶片纪实质感', '▣', 'linear-gradient(135deg,#493b2b,#c69555)',
    '复古胶片摄影，自然颗粒，柔和对比度，略微褪色的色彩，纪实瞬间，真实环境光，怀旧氛围'),
  preset('scifi', '科幻界面', '可信未来装置', '⌁', 'linear-gradient(135deg,#152d3b,#3cc2cb)',
    '可信的未来科技场景，精密工业结构，克制的发光界面，冷色氛围，电影级照明，丰富机械细节'),
  preset('storybook', '儿童绘本', '温暖绘本插画', '☀', 'linear-gradient(135deg,#70523d,#f1cb75)',
    '温暖儿童绘本插画，友善可爱的角色，柔软形状，明快配色，手绘肌理，清晰叙事场景，充满想象力'),
  preset('minimal', '极简海报', '现代平面设计', '□', 'linear-gradient(135deg,#28282c,#d9d9dc)',
    '现代极简海报设计，大面积留白，清晰视觉层级，克制配色，几何构成，精致排版，编辑设计感')
])

/** 画廊里的预设卡片 → 节点上存的那个形状（只留 id / title / text） */
export const toStoredPreset = (item) => (
  item ? { id: item.id, title: item.title, text: item.prompt || item.text || '' } : null
)

/**
 * 归一化节点上存的预设，返回 `{ id, title, text } | null`。
 * 兼容早期只存了裸字符串 id 的节点 —— 那时还没把标题和文本一起落盘。
 */
export const normalizePreset = (value) => {
  if (!value) return null
  if (typeof value === 'string') {
    const hit = DEFAULT_PRESETS.find(item => item.id === value)
    return hit ? toStoredPreset(hit) : null
  }
  return value.text ? value : null
}

export const presetTextOf = (value) => normalizePreset(value)?.text || ''
export const presetTitleOf = (value) => normalizePreset(value)?.title || ''
