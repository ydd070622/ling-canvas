/**
 * 室内渲染超级节点：参数默认值、校验与提示词 | Render node params & prompt
 *
 * 纯函数，不碰 Vue / DOM。卡片组件只负责摆放控件和发请求，所有「这组参数能不能跑」
 * 和「这段话该怎么说」的判断都在这里 —— 便于逐字对照原型核验：
 *   public/prototypes/interior-render/index.html（提示词在 60-75 行）
 *   public/prototypes/interior-render/refined.js（校验在 130-156 行）
 *
 * **默认值是唯一真相**：migrateCanvasDocument 对 schemaVersion >= 4 的存档直接早退，
 * 老节点不会再跑一遍 createDefaultNodeData。所以读参数一律走 readParams()，
 * 不要在组件里直接读 data.xxx —— 将来加字段时老存档才不会炸。
 */

/** 全部参数字段 */
export const ALL_PARAM_FIELDS = Object.freeze([
  'viewMode', 'extra', 'structure', 'closed',
  'person', 'personImage', 'personImageName',
  'personLocation', 'personLocationCustom', 'personAction', 'personBlur',
  'lights', 'temperature', 'temperatureCustom', 'lightType',
  'city', 'cityCustom', 'time', 'timeCustom', 'weather',
  'outside', 'outsideCustom', 'outsideImage', 'outsideImageName', 'sun',
  'resolution'
])

export const RENDER_DEFAULTS = Object.freeze({
  viewMode: 'multi',
  extra: '',
  structure: true,
  closed: false,
  person: false,
  personImage: '',
  personImageName: '',
  personLocation: '由 AI 自然安排',
  personLocationCustom: '',
  personAction: '自然行走',
  personBlur: true,
  lights: true,
  temperature: '4000K',
  temperatureCustom: '',
  lightType: '全部灯具',
  city: '深圳',
  cityCustom: '',
  time: '中午',
  timeCustom: '',
  weather: '晴天',
  outside: '城市',
  outsideCustom: '',
  outsideImage: '',
  outsideImageName: '',
  sun: '跟随原图',
  resolution: '2K'
})

/** 各下拉的选项，照原型的 select 顺序 */
export const RENDER_OPTIONS = Object.freeze({
  viewMode: [
    { value: 'single', label: '单视角' },
    { value: 'multi', label: '多视角' }
  ],
  personLocation: ['由 AI 自然安排', '餐桌旁', '窗边', '厨房操作台旁', '自定义位置'],
  personAction: ['自然行走', '站立', '坐着'],
  temperature: ['3000K', '4000K', '6000K', '自定义'],
  lightType: ['全部灯具', '主灯', '辅助照明'],
  city: ['自动', '深圳', '南京', '台北', '昆明', '成都', '自定义'],
  time: ['自动', '清晨', '中午', '傍晚', '夜晚', '自定义'],
  weather: ['晴天', '多云', '阴天', '雨天'],
  outside: ['原图', '海景', '江景', '山景', '小区', '城市', '庭院', '雪山', '街景', '参考图', '卫星图', '自定义'],
  sun: ['跟随原图', '柔和漫射', '明显光影']
})

/** CUSTOM_FIELDS：值为「自定义」时展开的补充输入框，键是选项字段，值是补充字段 */
export const CUSTOM_FIELD_MAP = Object.freeze({
  city: 'cityCustom',
  time: 'timeCustom',
  temperature: 'temperatureCustom',
  outside: 'outsideCustom'
})

const CUSTOM_LABEL = Object.freeze({ city: '地点', time: '时间', temperature: '色温', outside: '外景' })

/** 哪些下拉弹出了补充输入框 —— 封闭空间下外景整组失效，关灯后色温也失效 */
export const showsCustomField = (params, key) => {
  if (params[key] !== '自定义') return false
  if (key === 'temperature' && !params.lights) return false
  if (key === 'outside' && params.closed) return false
  return true
}

/** 从节点 data 读参数，缺字段补默认（老存档兼容的落点） */
export const readParams = (data) => {
  const out = {}
  ALL_PARAM_FIELDS.forEach((key) => {
    out[key] = data?.[key] ?? RENDER_DEFAULTS[key]
  })
  return out
}

/** 自定义值没填时的占位，与原型的 chosen() 一致 */
const chosen = (value, custom) => (
  value === '自定义' ? (String(custom || '').trim() || '【待填写】') : value
)

/**
 * 生成前校验 | Preflight
 *
 * 逐字移植原型的 refined.js:130-156 与 index.html:82 的人物两条。
 * 返回 field 让卡片能把出错的控件滚进视野并聚焦。
 */
export const validateRenderParams = (params) => {
  for (const key of Object.keys(CUSTOM_FIELD_MAP)) {
    if (!showsCustomField(params, key)) continue
    if (!String(params[CUSTOM_FIELD_MAP[key]] || '').trim()) {
      return { ok: false, message: '请补充自定义' + CUSTOM_LABEL[key], field: CUSTOM_FIELD_MAP[key] }
    }
  }

  if (params.lights && params.temperature === '自定义') {
    const kelvin = Number(params.temperatureCustom)
    if (!Number.isFinite(kelvin) || kelvin < 1000 || kelvin > 20000) {
      return { ok: false, message: '请输入 1000–20000K 之间的色温', field: 'temperatureCustom' }
    }
  }

  if (!params.closed && ['参考图', '卫星图'].includes(params.outside) && !params.outsideImage) {
    return { ok: false, message: '请先上传外景' + params.outside, field: 'outsideImage' }
  }

  if (params.person && !params.personImage) {
    return { ok: false, message: '请先添加全身人物参考图，或关闭「场景人物」', field: 'personImage' }
  }

  if (params.person && params.personLocation === '自定义位置' && !String(params.personLocationCustom || '').trim()) {
    return { ok: false, message: '请填写人物位置', field: 'personLocationCustom' }
  }

  return { ok: true, message: '', field: '' }
}

/**
 * 中文提示词 | Prompt lines
 *
 * 逐行对照 index.html:60-75。**视角之间没有差异** —— 四张原图的区别体现在
 * 各自送进模型的底图上，而不是提示词里多一句「这是第几个视角」，所以这里不收视角参数。
 */
export const buildRenderPrompt = (params) => {
  const lines = []

  lines.push('将当前 SU 视角截图转化为真实、自然的室内摄影效果。')

  if (params.structure) lines.push('保持原图相机视角、空间结构、门窗和家具位置，不改变设计。')
  if (params.closed) lines.push('按封闭空间处理，不添加窗户、开口或外部景观。')

  if (params.lights) {
    const kelvin = params.temperature === '自定义'
      ? `${String(params.temperatureCustom).trim()}K`
      : params.temperature
    lines.push(`开启${params.lightType}，呈现约 ${kelvin} 的照明效果。`)
  } else {
    lines.push('关闭室内人工灯光。')
  }

  lines.push(params.city === '自动'
    ? '地点环境根据原图自然判断。'
    : `地点：${chosen(params.city, params.cityCustom)}。`)
  lines.push(params.time === '自动'
    ? '时间和自然光根据原图判断。'
    : `时间：${chosen(params.time, params.timeCustom)}。`)
  lines.push(`天气：${params.weather}。`)

  if (!params.closed) {
    if (params.outside === '原图') {
      lines.push('保持原图已有的窗外景观。')
    } else if (['参考图', '卫星图'].includes(params.outside)) {
      lines.push((params.outsideImage ? '' : '【待上传外景图片】') + (params.outside === '卫星图'
        ? '根据卫星图参考周边地貌和建筑环境，转换为当前窗口视角，不将俯视图直接贴入窗户。'
        : '以外景参考图为窗外景观依据，匹配相机透视、光照与遮挡。'))
    } else {
      lines.push(`窗外环境：${chosen(params.outside, params.outsideCustom)}。`)
    }
  }

  lines.push(`太阳光影：${params.sun}。`)

  if (params.person) {
    lines.push(params.personImage
      ? '使用人物参考图中的同一人物，保持外貌、发型、服装与鞋子一致；人物图仅用于人物，不改变空间。'
      : '【待添加全身人物参考图】每个视角共用同一人物参考。')
    const where = params.personLocation === '自定义位置'
      ? (String(params.personLocationCustom || '').trim() || '待填写')
      : params.personLocation
    lines.push(`人物位置：${where}；动作：${params.personAction}。遵循当前视角的遮挡关系。`)
    /*
     * 运动模糊**单独占一行**，不再挂在上面那句的尾巴上。
     *
     * 原来写的是「人物带轻微运动模糊。」，夹在一串分句中间，实测被无视 ——
     * 人物参考图本身是清晰锐利的，模型会顺着参考图走。所以这里要说清楚两件事：
     * 模糊到什么程度（比环境虚）、以及**不要什么**（不要锐利清晰的人像）。
     */
    lines.push(params.personBlur
      ? '人物用运动模糊处理：人物比环境明显更虚，带轻微拖影，不要锐利清晰的人像。'
      : '人物清晰自然。')
  }

  const extra = String(params.extra || '').trim()
  if (extra) lines.push(`补充要求：${extra}`)

  return lines
}
