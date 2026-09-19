<template>
  <!-- 提示词预设画廊 | Prompt preset gallery
       预设是整套方案的模板，不是几个词 —— 所以用带封面的卡片画廊来挑，而不是下拉/列表：
       默认 / 收藏 / 自定义三个页签，能收藏、能自己建。

       选中后**只把预设本身记到节点上**（不往输入框灌文本），具体文本生成时才展开。 -->
  <Teleport to="body">
    <div v-if="visible" class="preset-overlay" @click.self="emit('close')">
      <section class="preset-dialog" role="dialog" aria-modal="true" aria-label="提示词预设">
        <header>
          <div>
            <strong>提示词预设</strong>
            <small>{{ subtitle }}</small>
          </div>
          <button title="关闭" @click="emit('close')">×</button>
        </header>

        <nav>
          <button
            v-for="item in TABS"
            :key="item.key"
            :class="{ active: tab === item.key }"
            type="button"
            @click="tab = item.key"
          >{{ item.label }}</button>
        </nav>

        <div v-if="tab === 'custom'" class="preset-create">
          <input v-model="draftTitle" placeholder="预设名称" />
          <textarea v-model="draftPrompt" placeholder="输入要保存的完整提示词…" />
          <button type="button" :disabled="!draftTitle.trim() || !draftPrompt.trim()" @click="addCustom">保存预设</button>
        </div>

        <div class="preset-grid">
          <article
            v-for="item in visiblePresets"
            :key="item.id"
            class="preset-card"
            :class="{ 'is-active': selectedId && item.id === selectedId }"
            @click="emit('select', item)"
          >
            <div class="preset-cover" :style="{ background: item.cover }">
              <span>{{ item.icon }}</span>
              <button
                v-if="item.source !== 'custom'"
                class="preset-favorite"
                :class="{ active: favorites.includes(item.id) }"
                type="button"
                :title="favorites.includes(item.id) ? '取消收藏' : '收藏'"
                @click.stop="toggleFavorite(item.id)"
              >★</button>
            </div>
            <div class="preset-meta">
              <strong>{{ item.title }}</strong>
              <small>{{ item.description }}</small>
            </div>
            <button
              v-if="item.source === 'custom'"
              class="preset-delete"
              type="button"
              title="删除"
              @click.stop="removeCustom(item.id)"
            >×</button>
          </article>
        </div>

        <div v-if="!visiblePresets.length" class="preset-empty">
          {{ tab === 'favorite' ? '还没有收藏的预设，点卡片右上角的 ★ 收藏' : '这里还没有预设' }}
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { DEFAULT_PRESETS } from '../../config/promptPresets'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 当前生效的预设 id，用来高亮那张卡 */
  selectedId: { type: String, default: '' },
  /** 面板右上角的小字，说明这份预设是给哪类产出用的 */
  subtitle: { type: String, default: '' }
})

const emit = defineEmits(['select', 'close'])

const STORAGE_CUSTOM = 'ling-canvas-image-prompt-presets'
const STORAGE_FAVORITES = 'ling-canvas-image-prompt-favorites'
const TABS = [
  { key: 'default', label: '默认' },
  { key: 'favorite', label: '收藏' },
  { key: 'custom', label: '自定义' }
]

const readStored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '') || fallback
  } catch {
    return fallback
  }
}

const tab = ref('default')
const customPresets = ref(readStored(STORAGE_CUSTOM, []))
const favorites = ref(readStored(STORAGE_FAVORITES, []))
const draftTitle = ref('')
const draftPrompt = ref('')

const visiblePresets = computed(() => {
  if (tab.value === 'favorite') return DEFAULT_PRESETS.filter(item => favorites.value.includes(item.id))
  if (tab.value === 'custom') return customPresets.value
  return DEFAULT_PRESETS
})

const toggleFavorite = (id) => {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter(item => item !== id)
    : [...favorites.value, id]
  localStorage.setItem(STORAGE_FAVORITES, JSON.stringify(favorites.value))
}

const persistCustom = () => localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(customPresets.value))

const addCustom = () => {
  if (!draftTitle.value.trim() || !draftPrompt.value.trim()) return
  const text = draftPrompt.value.trim()
  customPresets.value.unshift({
    id: `custom-${Date.now()}`,
    title: draftTitle.value.trim(),
    description: '自定义提示词',
    icon: '✎',
    cover: 'linear-gradient(135deg,#33343a,#737783)',
    prompt: text,
    // 节点上存的是 { id, title, text } 这个整体，所以这里也带上 text
    text,
    source: 'custom'
  })
  draftTitle.value = ''
  draftPrompt.value = ''
  persistCustom()
}

const removeCustom = (id) => {
  customPresets.value = customPresets.value.filter(item => item.id !== id)
  persistCustom()
}

// 每次打开回到「默认」，别把上次停留的页签留给下一次
watch(() => props.visible, (open) => {
  if (!open) return
  tab.value = 'default'
  draftTitle.value = ''
  draftPrompt.value = ''
})
</script>

<style scoped>
/* 深色画廊：封面是深色渐变，放在浅色底上会显得脏 */
.preset-overlay {
  position: fixed;
  inset: 0;
  z-index: 10030;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: rgba(5, 5, 6, 0.74);
  backdrop-filter: blur(6px);
}

.preset-dialog {
  display: flex;
  width: min(980px, 92vw);
  height: min(760px, 90vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3a3a3d;
  border-radius: 16px;
  background: #1d1d1f;
  color: #eeeef0;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.55);
}

.preset-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 14px; }
.preset-dialog header div { display: flex; align-items: baseline; gap: 10px; }
.preset-dialog header strong { font-size: 16px; }
.preset-dialog header small { color: #77777e; }
.preset-dialog header button { border: 0; background: transparent; color: #8d8d93; cursor: pointer; font-size: 26px; }
.preset-dialog header button:hover { color: #fff; }

.preset-dialog nav {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin: 0 20px 18px;
  padding: 4px;
  border-radius: 9px;
  background: #29292c;
}
.preset-dialog nav button { height: 38px; border: 0; border-radius: 7px; background: transparent; color: #aaaab0; cursor: pointer; font-family: inherit; font-size: 13px; }
.preset-dialog nav button.active { background: #48484c; color: #fff; }

.preset-create { display: grid; grid-template-columns: 190px 1fr auto; gap: 10px; margin: 0 20px 18px; }
.preset-create input,
.preset-create textarea {
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid #3c3c40;
  border-radius: 8px;
  outline: none;
  background: #242427;
  color: #eee;
  font: inherit;
  resize: none;
}
.preset-create textarea { height: 38px; }
.preset-create button { padding: 0 16px; border: 0; border-radius: 8px; background: var(--flow-accent-deep, #397cf0); color: #fff; cursor: pointer; font-family: inherit; font-size: 13px; }
.preset-create button:disabled { cursor: not-allowed; opacity: 0.4; }

.preset-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  overflow-y: auto;
  padding: 0 20px 24px;
}

.preset-card {
  position: relative;
  overflow: hidden;
  border: 1px solid #38383c;
  border-radius: 10px;
  background: #222225;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.preset-card:hover { transform: translateY(-2px); border-color: #626269; }
/* 当前生效的那张：描一圈亮边，一眼看出现在用的是哪个 */
.preset-card.is-active { border-color: #d7d9de; box-shadow: 0 0 0 1px #d7d9de inset; }

.preset-cover {
  position: relative;
  display: flex;
  height: 112px;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.84);
  font-size: 34px;
}

.preset-favorite {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 27px;
  height: 27px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
}
.preset-favorite.active { color: #ffca55; }

.preset-meta { display: flex; flex-direction: column; gap: 4px; padding: 11px 12px 13px; }
.preset-meta strong { font-size: 13px; }
.preset-meta small { overflow: hidden; color: #898990; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

.preset-delete { position: absolute; right: 7px; bottom: 7px; border: 0; background: transparent; color: #888; cursor: pointer; font-size: 18px; }
.preset-delete:hover { color: #f87171; }

.preset-empty { display: flex; flex: 1; align-items: center; justify-content: center; color: #777; font-size: 13px; }

@media (max-width: 760px) {
  .preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .preset-create { grid-template-columns: 1fr; }
  .preset-create textarea { height: 70px; }
}
</style>
