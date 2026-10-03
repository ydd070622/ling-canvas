export const normalizeClipboardText = text => String(text || '').replace(/\r\n?/g, '\n')

export const copySelectionAsPlainText = (event, selectedText) => {
  if (!selectedText || !event.clipboardData) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', normalizeClipboardText(selectedText))
}

export const copyAgentText = async text => {
  const value = normalizeClipboardText(text)
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {}
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.cssText = 'position:fixed;left:-10000px;top:0;'
  document.body.appendChild(textarea)
  const focused = document.activeElement
  try {
    textarea.focus(); textarea.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally {
    textarea.remove(); focused?.focus?.()
  }
}
