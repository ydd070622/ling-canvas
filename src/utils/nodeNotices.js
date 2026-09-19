/**
 * 卡片上还要不要再铺一条提示 | Node notices
 *
 * 规则：**顶部 toast 已经报过的错，卡片上不再重复一遍**。
 * "这个节点失败了"本身由表头那个红色的「失败」承载（悬停能看到原因，见 NodeFrame 的
 * failText），卡片正文里只留**带动作**的失败 —— 否则同一句话一处在上、一处在下，
 * 用户还要在一个删不掉的横条上再读一遍。
 *
 * 现在只有一种失败带动作：正文里的 `@图片1` 指到了一根已经断开的连线（E_ORPHAN）。
 * 它需要一个「移除失效引用」的按钮，而 toast 是转瞬即逝的，按钮得留得住。
 *
 * 从前是无差别铺 + 无差别配按钮：每条 error 都挂一个「移除失效引用」，
 * HTTP 503 也挂 —— 点下去会真的把正常的引用删掉。错误的提示配了个会做错事的按钮。
 */

/** 失败码 → 卡片上要给的修法按钮。没有条目 = 这条失败只在 toast 里说一次 */
const NOTICE_ACTIONS = {
  E_ORPHAN: [{ act: 'drop-orphans', label: '移除失效引用' }]
}

/**
 * @param {object} data 节点 data
 * @returns {Array<{kind:string, text:string, actions:Array}>}
 */
export const buildNodeNotices = (data) => {
  const list = []

  const actions = NOTICE_ACTIONS[data?.errorCode] || []
  if (actions.length && data?.error) {
    list.push({ kind: 'error', text: data.error, actions })
  }

  // warn 留着：它**不走 toast**（没有别的地方会说），而且说的是"编号冲突了、
  // 自动重写已跳过、你自己看一眼"—— 转瞬即逝的提示承载不了这种要停下来的信息。
  // 目前唯一的来源是 renumberNodeRefs 的 collided 分支。
  if (data?.warn) {
    list.push({ kind: 'warn', text: data.warn.message, actions: data.warn.actions || [] })
  }

  return list
}
