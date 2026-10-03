export const handleAgentShortcut = (event, toggle, shortcut = { code: 'KeyQ', key: 'q', altKey: true }) => {
  if (event.target?.closest?.('[data-shortcut-recorder]')) return false
  const matches = event.code === shortcut.code || (!event.code && event.key?.toLowerCase() === shortcut.key)
  if (!matches || ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'].some(key => !!event[key] !== !!shortcut[key])) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  if (!event.repeat) toggle()
  return true
}
