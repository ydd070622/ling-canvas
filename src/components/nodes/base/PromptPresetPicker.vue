<template>
  <button class="flow-pill prompt-preset-trigger nodrag" type="button" @click.stop="open = true">
    <span class="pd-ic">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.6 4.8L17.5 9l-3.9 1.3L12 15l-1.6-4.7L6.5 9l3.9-1.2z"/></svg>
    </span>
    预设
  </button>

  <Teleport to="body">
    <div v-if="open" class="preset-overlay" @click.self="open = false">
      <section class="preset-dialog" role="dialog" aria-modal="true" aria-label="提示词预设">
        <header>
          <div><strong>提示词预设</strong><small>图片</small></div>
          <button title="关闭" @click="open = false">×</button>
        </header>

        <nav>
          <button v-for="item in tabs" :key="item.key" :class="{ active: tab === item.key }" @click="tab = item.key">
            {{ item.label }}
          </button>
        </nav>

        <div v-if="tab === 'custom'" class="preset-create">
          <input v-model="draftTitle" placeholder="预设名称" />
          <textarea v-model="draftPrompt" placeholder="输入要保存的完整提示词…" />
          <button :disabled="!draftTitle.trim() || !draftPrompt.trim()" @click="addCustomPreset">保存预设</button>
        </div>

        <div class="preset-grid">
          <article v-for="preset in visiblePresets" :key="preset.id" class="preset-card" @click="selectPreset(preset)">
            <div class="preset-cover" :style="{ background: preset.cover }">
              <span>{{ preset.icon }}</span>
              <button
                v-if="preset.source === 'default'"
                class="preset-favorite"
                :class="{ active: favorites.includes(preset.id) }"
                :title="favorites.includes(preset.id) ? '取消收藏' : '收藏'"
                @click.stop="toggleFavorite(preset.id)"
              >★</button>
            </div>
            <div class="preset-meta">
              <strong>{{ preset.title }}</strong>
              <small>{{ preset.description }}</small>
            </div>
            <button v-if="preset.source === 'custom'" class="preset-delete" title="删除" @click.stop="removeCustomPreset(preset.id)">×</button>
          </article>
        </div>

        <div v-if="!visiblePresets.length" class="preset-empty">这里还没有预设</div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref } from 'vue'

const emit = defineEmits(['select'])
const STORAGE_KEY = 'ling-canvas-image-prompt-presets'
const FAVORITES_KEY = 'ling-canvas-image-prompt-favorites'

const DEFAULT_PRESETS = [
  { id: 'cinematic', title: '电影肖像', description: '电影级人物肖像', icon: '◉', prompt: '电影级人物肖像，富有层次的戏剧光影，真实皮肤质感，浅景深，精致构图，高动态范围，细节清晰', cover: 'linear-gradient(135deg,#3f2b2c,#b88969)' },
  { id: 'product', title: '产品摄影', description: '干净商业产品图', icon: '◇', prompt: '专业商业产品摄影，干净背景，柔和棚拍光线，准确材质与色彩，高级构图，清晰细节，无多余元素', cover: 'linear-gradient(135deg,#27333a,#b8c7c9)' },
  { id: 'concept', title: '概念场景', description: '大型环境概念图', icon: '△', prompt: '大型环境概念设计，宏大的空间尺度，清晰的视觉焦点，电影感氛围，丰富层次，高精度细节', cover: 'linear-gradient(135deg,#21364a,#d19a5d)' },
  { id: 'fashion', title: '时尚大片', description: '杂志风格人像', icon: '✦', prompt: '高端时尚杂志大片，专业模特姿态，先锋造型，精致布光，强烈视觉风格，高级色彩，高清细节', cover: 'linear-gradient(135deg,#482d46,#d6a6b9)' },
  { id: 'architecture', title: '建筑空间', description: '真实空间可视化', icon: '▦', prompt: '专业建筑空间摄影，真实尺度与材质，自然采光，透视准确，构图克制，细节清晰，写实效果', cover: 'linear-gradient(135deg,#4a4033,#d4c1a2)' },
  { id: 'food', title: '美食摄影', description: '诱人的食物特写', icon: '●', prompt: '专业美食摄影，新鲜诱人的食物质感，自然柔光，浅景深，精致摆盘，温暖色调，高清细节', cover: 'linear-gradient(135deg,#582f20,#e4ae65)' },
  { id: 'anime', title: '动漫角色', description: '精细角色立绘', icon: '☆', prompt: '高质量动漫角色设计，清晰轮廓，精致五官与服装细节，富有表现力的姿态，完整配色，插画级完成度', cover: 'linear-gradient(135deg,#29335c,#b6a8ee)' },
  { id: 'watercolor', title: '水墨意境', description: '现代东方水墨', icon: '≈', prompt: '现代东方水墨画，留白构图，淡雅墨色，自然笔触，诗意氛围，细腻纸张肌理，含蓄而高级', cover: 'linear-gradient(135deg,#303638,#c7c4b8)' },
  { id: 'retro', title: '复古胶片', description: '胶片纪实质感', icon: '▣', prompt: '复古胶片摄影，自然颗粒，柔和对比度，略微褪色的色彩，纪实瞬间，真实环境光，怀旧氛围', cover: 'linear-gradient(135deg,#493b2b,#c69555)' },
  { id: 'scifi', title: '科幻界面', description: '可信未来装置', icon: '⌁', prompt: '可信的未来科技场景，精密工业结构，克制的发光界面，冷色氛围，电影级照明，丰富机械细节', cover: 'linear-gradient(135deg,#152d3b,#3cc2cb)' },
  { id: 'storybook', title: '儿童绘本', description: '温暖绘本插画', icon: '☀', prompt: '温暖儿童绘本插画，友善可爱的角色，柔软形状，明快配色，手绘肌理，清晰叙事场景，充满想象力', cover: 'linear-gradient(135deg,#70523d,#f1cb75)' },
  { id: 'minimal', title: '极简海报', description: '现代平面设计', icon: '□', prompt: '现代极简海报设计，大面积留白，清晰视觉层级，克制配色，几何构成，精致排版，编辑设计感', cover: 'linear-gradient(135deg,#28282c,#d9d9dc)' }
].map(item => ({ ...item, source: 'default' }))

const readStored = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback } catch { return fallback }
}

const open = ref(false)
const tab = ref('default')
const customPresets = ref(readStored(STORAGE_KEY, []))
const favorites = ref(readStored(FAVORITES_KEY, []))
const draftTitle = ref('')
const draftPrompt = ref('')
const tabs = [
  { key: 'default', label: '默认' },
  { key: 'favorite', label: '收藏' },
  { key: 'custom', label: '自定义' }
]

const visiblePresets = computed(() => {
  if (tab.value === 'favorite') return DEFAULT_PRESETS.filter(item => favorites.value.includes(item.id))
  if (tab.value === 'custom') return customPresets.value
  return DEFAULT_PRESETS
})

const persistCustom = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets.value))
const persistFavorites = () => localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value))
const selectPreset = preset => {
  emit('select', preset.prompt)
  open.value = false
}
const toggleFavorite = id => {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter(item => item !== id)
    : [...favorites.value, id]
  persistFavorites()
}
const addCustomPreset = () => {
  if (!draftTitle.value.trim() || !draftPrompt.value.trim()) return
  customPresets.value.unshift({
    id: `custom-${Date.now()}`,
    title: draftTitle.value.trim(),
    description: '自定义提示词',
    prompt: draftPrompt.value.trim(),
    icon: '✎',
    cover: 'linear-gradient(135deg,#33343a,#737783)',
    source: 'custom'
  })
  draftTitle.value = ''
  draftPrompt.value = ''
  persistCustom()
}
const removeCustomPreset = id => {
  customPresets.value = customPresets.value.filter(item => item.id !== id)
  persistCustom()
}
</script>

<style scoped>
.prompt-preset-trigger { flex: 0 0 auto; }
.preset-overlay { position: fixed; inset: 0; z-index: 10030; display: flex; align-items: center; justify-content: center; padding: 4vh 4vw; background: rgba(5,5,6,.74); backdrop-filter: blur(6px); }
.preset-dialog { display: flex; width: min(980px,92vw); height: min(760px,90vh); flex-direction: column; overflow: hidden; border: 1px solid #3a3a3d; border-radius: 16px; background: #1d1d1f; color: #eeeef0; box-shadow: 0 28px 90px rgba(0,0,0,.55); }
.preset-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 14px; }
.preset-dialog header div { display: flex; align-items: baseline; gap: 10px; }
.preset-dialog header strong { font-size: 16px; }
.preset-dialog header small { color: #77777e; }
.preset-dialog header button { border: 0; background: transparent; color: #8d8d93; font-size: 26px; cursor: pointer; }
.preset-dialog nav { display: grid; grid-template-columns: repeat(3,1fr); gap: 4px; margin: 0 20px 18px; padding: 4px; border-radius: 9px; background: #29292c; }
.preset-dialog nav button { height: 38px; border: 0; border-radius: 7px; background: transparent; color: #aaaab0; cursor: pointer; }
.preset-dialog nav button.active { background: #48484c; color: #fff; }
.preset-create { display: grid; grid-template-columns: 190px 1fr auto; gap: 10px; margin: 0 20px 18px; }
.preset-create input,.preset-create textarea { min-width: 0; border: 1px solid #3c3c40; border-radius: 8px; background: #242427; padding: 9px 11px; color: #eee; font: inherit; outline: none; resize: none; }
.preset-create button { border: 0; border-radius: 8px; padding: 0 16px; background: var(--flow-accent-deep); color: #fff; cursor: pointer; }
.preset-create button:disabled { opacity: .4; }
.preset-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 16px; overflow-y: auto; padding: 0 20px 24px; }
.preset-card { position: relative; overflow: hidden; border: 1px solid #38383c; border-radius: 10px; background: #222225; cursor: pointer; transition: transform .15s,border-color .15s; }
.preset-card:hover { transform: translateY(-2px); border-color: #626269; }
.preset-cover { position: relative; display: flex; height: 112px; align-items: center; justify-content: center; color: rgba(255,255,255,.84); font-size: 34px; }
.preset-favorite { position: absolute; top: 7px; right: 7px; border: 0; background: rgba(0,0,0,.35); border-radius: 50%; width: 27px; height: 27px; color: rgba(255,255,255,.55); cursor: pointer; }
.preset-favorite.active { color: #ffca55; }
.preset-meta { display: flex; flex-direction: column; gap: 4px; padding: 11px 12px 13px; }
.preset-meta strong { font-size: 13px; }
.preset-meta small { color: #898990; font-size: 11px; }
.preset-delete { position: absolute; right: 7px; bottom: 7px; border: 0; background: transparent; color: #888; font-size: 18px; cursor: pointer; }
.preset-empty { display: flex; flex: 1; align-items: center; justify-content: center; color: #777; }
@media (max-width:760px) { .preset-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .preset-create { grid-template-columns:1fr; } }
</style>
