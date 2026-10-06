export function codexErrorText(value) {
  let text=String(value || 'Codex 执行失败')
  try { const parsed=JSON.parse(text); text=parsed.error?.message || parsed.message || text } catch {}
  return /model.*not supported/i.test(text) ? `当前账户不支持所选模型，请在设置中更换模型。\n${text}` : text
}
