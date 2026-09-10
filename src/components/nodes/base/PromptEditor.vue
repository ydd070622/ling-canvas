<template>
  <div class="flow-prompt-editor nodrag nowheel">
    <textarea
      :value="modelValue"
      :placeholder="placeholder"
      @input="handleInput"
    />
    <button class="prompt-expand-btn nodrag" type="button" title="放大编辑" @click.stop="openEditor">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="expanded" class="prompt-editor-overlay" @click.self="closeEditor">
        <section class="prompt-editor-dialog" role="dialog" aria-modal="true" aria-label="提示词编辑器">
          <header>
            <span>提示词编辑器</span>
            <button type="button" title="关闭" @click="closeEditor">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <textarea
            ref="expandedTextareaRef"
            :value="modelValue"
            :placeholder="placeholder"
            @input="handleInput"
          />
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '输入提示词...' }
})

const emit = defineEmits(['update:modelValue'])
const expandedTextareaRef = ref(null)
const expanded = ref(false)

const handleInput = event => emit('update:modelValue', event.target.value)
const openEditor = async () => {
  expanded.value = true
  await nextTick()
  expandedTextareaRef.value?.focus()
}
const closeEditor = () => { expanded.value = false }
const handleKeydown = event => {
  if (event.key === 'Escape' && expanded.value) closeEditor()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.flow-prompt-editor { width: 100%; }
.flow-prompt-editor > textarea {
  display: block;
  width: 100%;
  min-height: 72px;
  max-height: 360px;
  padding: 9px 34px 9px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--flow-text-strong);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  outline: none;
  resize: none;
}
.flow-prompt-editor > textarea::placeholder { color: var(--flow-text-weak); }
.prompt-expand-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  width: 27px;
  height: 27px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--flow-text-mid);
  cursor: pointer;
}
.prompt-expand-btn:hover { background: var(--flow-body-bg); color: var(--flow-text-strong); }
.prompt-expand-btn svg { width: 15px; height: 15px; }
.prompt-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 10020;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5vh 5vw;
  background: rgba(7, 7, 8, 0.72);
  backdrop-filter: blur(6px);
}
.prompt-editor-dialog {
  display: flex;
  width: min(920px, 90vw);
  height: min(720px, 88vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3b3b3e;
  border-radius: 18px;
  background: #1d1d1f;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
}
.prompt-editor-dialog header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px 22px;
  color: #e8e8eb;
  font-size: 14px;
  font-weight: 600;
}
.prompt-editor-dialog header button {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #929298;
  cursor: pointer;
}
.prompt-editor-dialog header button:hover { background: #2a2a2d; color: #fff; }
.prompt-editor-dialog header svg { width: 21px; height: 21px; }
.prompt-editor-dialog > textarea {
  min-height: 0;
  flex: 1 1 auto;
  margin: 0 18px 18px;
  padding: 12px 6px;
  border: 0;
  background: transparent;
  color: #ededf0;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.7;
  outline: none;
  resize: none;
}
.prompt-editor-dialog > textarea::placeholder { color: #696970; }
</style>
