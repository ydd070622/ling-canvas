<template>
  <div ref="editor" class="inline-prompt-editor" contenteditable="true" role="textbox" aria-label="提示词" aria-multiline="true" spellcheck="false"
    @input="syncInput" @beforeinput="beforeInput" @paste="pasteText" @keydown="rememberSelection" @keyup="rememberSelection" @mouseup="rememberSelection" @blur="rememberSelection" @compositionstart="composing = true" @compositionend="finishComposition"></div>
</template>
<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
const props = defineProps({ modelValue: { type: String, default: '' }, preset: { type: Object, default: null }, presetPosition: { type: Number, default: 0 } })
const emit = defineEmits(['update:modelValue', 'update:presetPosition', 'input', 'remove-preset', 'open-preset'])
const editor = ref(null)
let composing = false, savedStart = 0, savedEnd = 0
const plainText = node => {
  if (node.nodeType === 3) return node.nodeValue || ''
  if (node.nodeType !== 1 && node.nodeType !== 11) return ''
  if (node.nodeType === 1 && node.hasAttribute('data-preset-chip')) return ''
  if (node.nodeName === 'BR') return '\n'
  return [...node.childNodes].map(plainText).join('')
}
const offsetFor = (node, offset) => {
  const range = document.createRange(); range.selectNodeContents(editor.value); range.setEnd(node, offset)
  return plainText(range.cloneContents()).length
}
const rememberSelection = () => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.value?.contains(selection.anchorNode) || !editor.value.contains(selection.focusNode)) return
  const range = selection.getRangeAt(0)
  savedStart = offsetFor(range.startContainer, range.startOffset); savedEnd = offsetFor(range.endContainer, range.endOffset)
}
const setSelectionRange = (start, end = start) => {
  if (!editor.value) return
  const textNodes = []
  const collect = node => { if (node.nodeType === 3) textNodes.push(node); else if (!node.hasAttribute?.('data-preset-chip')) [...node.childNodes].forEach(collect) }
  collect(editor.value)
  const point = index => { let remaining = Math.max(0, index); for (const node of textNodes) { if (remaining <= node.length) return [node, remaining]; remaining -= node.length } return [editor.value, editor.value.childNodes.length] }
  const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end)); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); savedStart = start; savedEnd = end
}
const render = () => {
  if (!editor.value || composing) return
  const focused = document.activeElement === editor.value; if (focused) rememberSelection()
  const position = Math.min(props.modelValue.length, Math.max(0, props.presetPosition))
  editor.value.replaceChildren(document.createTextNode(props.modelValue.slice(0, position)))
  if (props.preset) {
    const chip = document.createElement('span'); chip.className = 'inline-preset-chip'; chip.contentEditable = 'false'; chip.setAttribute('data-preset-chip', '')
    const title = document.createElement('button'); title.type = 'button'; title.className = 'inline-preset-title'; title.textContent = '✦ ' + props.preset.title; title.title = '当前预设：' + props.preset.title; title.onmousedown = event => event.preventDefault(); title.onclick = () => emit('open-preset')
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'inline-preset-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除预设：' + props.preset.title); remove.onmousedown = event => event.preventDefault(); remove.onclick = () => emit('remove-preset')
    chip.append(title, remove); editor.value.append(chip)
  }
  editor.value.append(document.createTextNode(props.modelValue.slice(position)))
  if (focused) setSelectionRange(Math.min(savedStart, props.modelValue.length), Math.min(savedEnd, props.modelValue.length))
}
const syncInput = event => {
  rememberSelection()
  const chip = editor.value.querySelector('[data-preset-chip]')
  const value = plainText(editor.value)
  if (chip) { const range = document.createRange(); range.selectNodeContents(editor.value); range.setEndBefore(chip); emit('update:presetPosition', plainText(range.cloneContents()).length) }
  else if (props.preset && !composing) emit('remove-preset')
  emit('update:modelValue', value); emit('input', event)
}
const insertText = value => {
  const selection = window.getSelection(); if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0); if (!editor.value.contains(range.commonAncestorContainer)) return
  range.deleteContents(); const node = document.createTextNode(value); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); syncInput()
}
const beforeInput = event => { if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') { event.preventDefault(); insertText('\n') } }
const pasteText = event => { event.preventDefault(); insertText(event.clipboardData.getData('text/plain')) }
const finishComposition = event => { composing = false; syncInput(event); nextTick(render) }
watch(() => [props.modelValue, props.preset?.id, props.preset?.title, props.presetPosition], () => {
  const chip = editor.value?.querySelector('[data-preset-chip]')
  let position = -1
  if (chip) { const range = document.createRange(); range.selectNodeContents(editor.value); range.setEndBefore(chip); position = plainText(range.cloneContents()).length }
  if (editor.value && plainText(editor.value) === props.modelValue && !!chip === !!props.preset && (!chip || (chip.querySelector('.inline-preset-title')?.textContent === '✦ ' + props.preset.title && position === props.presetPosition))) return
  render()
}, { flush: 'post' })
onMounted(render)
defineExpose({ focus: options => editor.value?.focus(options), setSelectionRange, get selectionStart() { rememberSelection(); return savedStart }, get selectionEnd() { rememberSelection(); return savedEnd }, get value() { return props.modelValue }, get scrollTop() { return editor.value?.scrollTop || 0 }, set scrollTop(value) { if (editor.value) editor.value.scrollTop = value } })
</script>
<style scoped>
.inline-prompt-editor { white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; }
.inline-prompt-editor :deep(.inline-preset-chip) { display: inline-flex; vertical-align: baseline; align-items: center; margin: 0 5px 0 0; padding: 1px 4px 1px 7px; border: 1px solid #8b6bc83b; border-radius: 6px; background: #8b6bc814; color: #7750b2; white-space: nowrap; user-select: none; }
:global(.dark) .inline-prompt-editor :deep(.inline-preset-chip) { color: #c6a4f4; border-color: #b08be040; background: #a47bd91c; }
.inline-prompt-editor :deep(.inline-preset-title), .inline-prompt-editor :deep(.inline-preset-remove) { border: 0; padding: 0; color: inherit; background: none; font: inherit; font-size: 12px; cursor: pointer; }
.inline-prompt-editor :deep(.inline-preset-title) { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.inline-prompt-editor :deep(.inline-preset-remove) { margin-left: 5px; width: 18px; font-size: 16px; opacity: .7; }
.inline-prompt-editor :deep(.inline-preset-remove:hover) { opacity: 1; }
</style>
