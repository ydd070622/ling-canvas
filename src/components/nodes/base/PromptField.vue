<template>
  <!-- 正文富文本字段 | Rich prompt field
       上游引用直接以芯片形态长在句子里（{{Image 1}}），不再另开一块引用列表。
       输入 @ 唤出引用菜单，只列本节点连入的素材。 -->
  <div
    ref="fieldRef"
    class="flow-pfield nodrag nowheel"
    :class="{ 'flow-pfield-well': well }"
    contenteditable="true"
    spellcheck="false"
    :data-placeholder="placeholder"
    @input="handleInput"
    @keydown="handleKeydown"
    @paste="handlePaste"
    @blur="emit('blur')"
  />

  <Teleport to="body">
    <div v-if="mentionOpen" ref="menuRef" class="flow-mention" :style="menuStyle" @mousedown.prevent>
      <div class="flow-mention-title">引用上游素材</div>

      <template v-if="!candidates.length">
        <div class="flow-mention-empty">暂无可引用资产<br />请先从左侧端口连入</div>
      </template>
      <template v-else-if="!filtered.length">
        <div class="flow-mention-empty">没有匹配「{{ query }}」的素材</div>
      </template>
      <template v-else>
        <button
          v-for="(item, index) in filtered"
          :key="item.edgeId"
          class="flow-mention-item"
          :class="{ 'is-active': index === activeIndex }"
          type="button"
          @click="pick(item)"
        >
          <i :class="`flow-tone-${item.kind}`">{{ item.code }}</i>
          <span>{{ item.name }}</span>
          <small>{{ item.role }}</small>
        </button>
        <div class="flow-mention-hint">Tab 插入 · Shift+Tab 全部插入 · Esc 取消</div>
      </template>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { makeToken, refKey } from '../../../utils/promptRefs'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 已解析的引用（按出现顺序），用来上色与标注失效 */
  refs: { type: Array, default: () => [] },
  /** @ 菜单候选：{ edgeId, kind, index, code, role, name } */
  candidates: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  well: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'insert-ref', 'blur'])

const fieldRef = ref(null)
const menuRef = ref(null)
const mentionOpen = ref(false)
const query = ref('')
const activeIndex = ref(0)
const mentionAt = ref(-1)
const menuStyle = ref({})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.candidates
  return props.candidates.filter(item =>
    `${item.code} ${item.name} ${item.role} ${item.kind}`.toLowerCase().includes(q))
})

/* ---------------------------------------------------------------- DOM 读写 */
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const chipClass = (status, kind) => {
  if (status === 'orphan') return 'flow-tok is-orphan'
  if (status === 'beyond') return 'flow-tok is-beyond'
  return `flow-tok flow-tone-${kind}`
}

/** 按 refs 把正文渲染成「文本 + 芯片」 */
const buildHtml = (text, refs) => {
  const source = text || ''
  let out = ''
  let last = 0
  refs.forEach((r) => {
    out += escapeHtml(source.slice(last, r.from))
    const tip = r.status === 'ok'
      ? `${r.slot?.role || ''} · 来自「${r.slot?.src?.data?.label || ''}」`
      : (r.status === 'orphan' ? '来源连线已被断开' : '引用了不存在的编号')
    out += `<span class="${chipClass(r.status, r.kind)}" contenteditable="false" data-token="${escapeHtml(r.raw)}" title="${escapeHtml(tip)}">${escapeHtml(r.raw)}</span>`
    last = r.to
  })
  return out + escapeHtml(source.slice(last))
}

/** 从 DOM 读回纯文本（芯片的 textContent 就是 token 本身） */
const readField = (el) => {
  let out = ''
  el?.childNodes.forEach((node) => {
    if (node.nodeType === 3) out += node.data
    else if (node.nodeName === 'BR') out += '\n'
    else if (node.dataset?.token) out += node.dataset.token
    else if (node.nodeType === 1) {
      const block = /^(DIV|P)$/.test(node.nodeName)
      out += (block && out && !out.endsWith('\n') ? '\n' : '') + node.textContent
    }
  })
  return out
}

const caretOffset = (el) => {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

const caretRange = (el, from, to) => {
  const range = document.createRange()
  let pos = 0
  let started = false
  const visit = (parent) => {
    for (const child of parent.childNodes) {
      if (started && pos >= to) return true
      if (child.nodeType === 3) {
        const len = child.data.length
        if (!started && from <= pos + len) { range.setStart(child, Math.max(0, from - pos)); started = true }
        if (started && to <= pos + len) { range.setEnd(child, Math.max(0, to - pos)); return true }
        pos += len
      } else if (child.nodeName === 'BR') {
        const index = [...parent.childNodes].indexOf(child)
        if (!started && from <= pos) { range.setStart(parent, index); started = true }
        if (started && to <= pos) { range.setEnd(parent, index); return true }
        pos += 1
      } else {
        const len = child.textContent.length
        if (!started && from <= pos + len) { range.setStartBefore(child); started = true }
        if (started && to <= pos + len) { range.setEndAfter(child); return true }
        pos += len
      }
    }
    return false
  }
  visit(el)
  if (!started) { range.selectNodeContents(el); range.collapse(false) }
  return range
}

const setCaret = (el, offset) => {
  if (!el) return
  const range = caretRange(el, offset, offset)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

const repaint = () => {
  const el = fieldRef.value
  if (!el) return
  const chips = el.querySelectorAll('.flow-tok')
  chips.forEach((chip, index) => {
    const r = props.refs[index]
    if (!r) return
    chip.className = chipClass(r.status, r.kind)
    chip.title = r.status === 'ok'
      ? `${r.slot?.role || ''} · 来自「${r.slot?.src?.data?.label || ''}」`
      : (r.status === 'orphan' ? '来源连线已被断开' : '引用了不存在的编号')
  })
}

/** 只有 DOM 与 modelValue 真的不一致时才重建 —— 否则打字时会把光标打掉 */
const syncDom = () => {
  const el = fieldRef.value
  if (!el) return
  if (readField(el) === (props.modelValue || '')) { repaint(); return }
  el.innerHTML = buildHtml(props.modelValue, props.refs)
  setCaret(el, (props.modelValue || '').length)
}

watch(() => props.modelValue, syncDom)
watch(() => props.refs, repaint, { deep: true })
watch(fieldRef, () => nextTick(syncDom), { immediate: true })

/* ---------------------------------------------------------------- 输入 */
const handleInput = () => {
  const el = fieldRef.value
  const text = readField(el)
  emit('update:modelValue', text)

  const caret = caretOffset(el)
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  const tail = at >= 0 ? before.slice(at + 1) : ''
  if (at >= 0 && (at === 0 || /\s/.test(before[at - 1])) && !/\s/.test(tail)) {
    mentionAt.value = at
    query.value = tail
    activeIndex.value = 0
    openMention()
  } else {
    closeMention()
  }
}

const openMention = () => {
  mentionOpen.value = true
  nextTick(() => {
    const el = fieldRef.value
    const menu = menuRef.value
    if (!el || !menu) return
    const r = el.getBoundingClientRect()
    const m = menu.getBoundingClientRect()
    menuStyle.value = {
      left: `${Math.max(8, Math.min(r.left, window.innerWidth - m.width - 10))}px`,
      top: `${Math.max(8, Math.min(r.top + 30, window.innerHeight - m.height - 10))}px`
    }
  })
}

const closeMention = () => { mentionOpen.value = false; mentionAt.value = -1; query.value = '' }

/** 写入 chip：先把自己 DOM 更新到位，再通知父组件，避免回传时因不一致而重建 */
const applyInsert = (insertions) => {
  const el = fieldRef.value
  const caret = mentionAt.value >= 0 ? caretOffset(el) : caretOffset(el)
  const from = mentionAt.value >= 0 ? mentionAt.value : caret
  const text = props.modelValue || ''
  const tokens = insertions.map(i => makeToken(i.kind, i.index))
  const next = `${text.slice(0, from)}${tokens.join(' ')} ${text.slice(caret)}`

  closeMention()
  emit('update:modelValue', next)
  insertions.forEach(i => emit('insert-ref', {
    key: refKey(i.kind, i.index),
    edgeId: i.edgeId
  }))

  // 本地先把 DOM 换成新文本（引用状态沿用旧 refs，父组件回传后再 repaint 校正）
  nextTick(() => {
    const host = fieldRef.value
    if (!host) return
    const projected = props.refs
    host.innerHTML = buildHtml(next, projected)
    setCaret(host, from + tokens.join(' ').length + 1)
    host.focus()
  })
}

const pick = (item) => applyInsert([item])

const handleKeydown = (event) => {
  if (mentionOpen.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex.value = (activeIndex.value + 1) % Math.max(1, filtered.value.length); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % Math.max(1, filtered.value.length); return }
    if (event.key === 'Tab') {
      event.preventDefault()
      applyInsert(event.shiftKey ? [...props.candidates] : [filtered.value[activeIndex.value]].filter(Boolean))
      return
    }
    if (event.key === 'Enter' && filtered.value.length) {
      event.preventDefault()
      applyInsert([filtered.value[activeIndex.value]])
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); closeMention(); return }
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    document.execCommand('insertText', false, '\n')
    handleInput()
  }
  if (event.key === 'Escape' && mentionOpen.value) closeMention()
}

const handlePaste = (event) => {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
  handleInput()
}

const onDocDown = (event) => {
  if (!mentionOpen.value) return
  if (menuRef.value?.contains(event.target)) return
  if (fieldRef.value?.contains(event.target)) return
  closeMention()
}
document.addEventListener('mousedown', onDocDown)
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

defineExpose({
  focus: () => fieldRef.value?.focus(),
  focusEnd: () => { const el = fieldRef.value; if (el) { el.focus(); setCaret(el, (props.modelValue || '').length) } }
})
</script>
