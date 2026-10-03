import { computed, ref } from 'vue'
const STORAGE_KEY = 'ling-agent-shortcut'
const defaultShortcut = { code: 'KeyQ', key: 'q', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }
const valid = value => value && /^[A-Z0-9]$/i.test(value.key || '') && /^(Key[A-Z]|Digit[0-9])$/.test(value.code || '') && (value.altKey || value.ctrlKey || value.metaKey)
export const agentShortcut = ref(defaultShortcut)
export const agentShortcutLabel = computed(() => [agentShortcut.value.ctrlKey && 'Ctrl', agentShortcut.value.metaKey && 'Meta', agentShortcut.value.altKey && 'Alt', agentShortcut.value.shiftKey && 'Shift', agentShortcut.value.key.toUpperCase()].filter(Boolean).join(' + '))
export const saveAgentShortcut = event => {
  const value = { code: event.code, key: event.key.toLowerCase(), altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }
  if (!valid(value)) throw new Error('请使用 Ctrl 或 Alt 加字母／数字，可附加 Shift')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  agentShortcut.value = value
}
