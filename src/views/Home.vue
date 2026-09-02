<template>
  <!-- Home page | 首页 -->
  <div class="min-h-screen h-screen overflow-y-auto bg-[var(--bg-primary)]">
    <!-- Main content | 主要内容 -->
    <main class="max-w-5xl mx-auto px-4 py-8 md:py-16">
      <!-- Welcome section | 欢迎区域 -->
      <section class="text-center mb-12">
        <div class="flex items-center justify-center gap-4 mb-8">
          <img src="../assets/logo.png" alt="Ling Canvas Logo" class="w-12 h-12 md:w-16 md:h-16" />
          <h1 class="text-2xl md:text-4xl font-bold text-[var(--text-primary)]">欢迎来到 Ling Canvas</h1>
        </div>
        
        <!-- Input area | 输入区域 -->
        <div class="max-w-[980px] mx-auto">
          <div class="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] p-4 shadow-sm">
            <!-- Reference images | 参考图 -->
            <div class="mb-3 flex items-center gap-2">
              <input
                ref="referenceInputRef"
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                @change="handleReferenceImageChange"
              />
              <button
                type="button"
                data-testid="home-add-reference"
                aria-label="添加参考图"
                title="添加参考图"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                @click="referenceInputRef?.click()"
              >
                <n-icon :size="16"><AddOutline /></n-icon>
              </button>
              <div
                v-for="(img, index) in referenceImages"
                :key="`${img.name}-${index}`"
                class="group relative h-9 w-9 overflow-hidden rounded-lg border border-[var(--border-color)]"
                :title="img.name"
              >
                <img :src="img.dataUrl" :alt="img.name" class="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="移除参考图"
                  title="移除参考图"
                  class="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-black/65 text-xs leading-none text-white opacity-0 transition-opacity group-hover:opacity-100"
                  @click="removeReferenceImage(index)"
                >
                  ×
                </button>
              </div>
            </div>
            <textarea
              v-model="inputText"
              placeholder="输入你的创意，开始新项目"
              class="w-full bg-transparent resize-none outline-none text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] min-h-[150px]"
              @keydown.enter.ctrl="handleCreateWithInput"
            />
            <!-- Image generation settings | 生图配置 -->
            <div class="relative mt-2 flex items-center justify-between gap-3 text-sm text-[var(--text-primary)]">
              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <!-- Model selector | 模型选择 -->
                <n-dropdown
                  v-if="imageModelOptions.length > 0"
                  :options="imageModelDropdownOptions"
                  @select="selectImageModel"
                  placement="bottom-start"
                >
                  <button
                    type="button"
                    data-testid="home-image-model"
                    class="flex max-w-44 items-center gap-1 rounded-md px-2 py-1.5 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
                  >
                    <span class="max-w-36 truncate">{{ selectedImageModelLabel }}</span>
                    <n-icon :size="13" class="text-[var(--text-secondary)]"><ChevronDownOutline /></n-icon>
                  </button>
                </n-dropdown>
                <button
                  v-else
                  type="button"
                  data-testid="home-add-image-model"
                  class="rounded-md px-2 py-1.5 text-[var(--accent-color)] transition-colors hover:bg-[var(--bg-tertiary)]"
                  @click="openImageModelSettings"
                >
                  暂无模型，先添加
                </button>

                <span class="text-[var(--text-secondary)]">·</span>

                <!-- Combined ratio, resolution and quality selector | 比例、分辨率、画质组合选择 -->
                <button
                  type="button"
                  data-testid="home-image-ratio"
                  class="flex items-center gap-1 rounded-md px-2 py-1.5 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
                  :class="{ 'bg-[var(--bg-tertiary)]': showImageSettings }"
                  @click="showImageSettings = !showImageSettings"
                >
                  {{ selectedRatioLabel }}
                  <span class="text-[var(--text-secondary)]">·</span>
                  {{ selectedResolutionLabel }}
                  <span class="text-[var(--text-secondary)]">·</span>
                  {{ selectedQualityLabel }}
                  <n-icon :size="13" class="text-[var(--text-secondary)]"><ChevronDownOutline /></n-icon>
                </button>

                <span class="text-[var(--text-secondary)]">·</span>

                <!-- Count selector | 张数选择 -->
                <n-dropdown
                  :options="countDropdownOptions"
                  @select="selectImageCount"
                  placement="bottom-start"
                >
                  <button
                    type="button"
                    data-testid="home-image-count"
                    class="flex items-center gap-1 rounded-md px-2 py-1.5 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
                  >
                    {{ imageCount }} 张
                    <n-icon :size="13" class="text-[var(--text-secondary)]"><ChevronDownOutline /></n-icon>
                  </button>
                </n-dropdown>
              </div>

              <button
                type="button"
                data-testid="home-send"
                aria-label="开始生成"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-color)] text-white transition-colors hover:bg-[var(--accent-hover)]"
                @click="handleCreateWithInput"
              >
                <n-icon :size="20"><SendOutline /></n-icon>
              </button>

              <!-- Settings popover | 设置弹层 -->
              <div
                v-if="showImageSettings"
                data-testid="home-image-settings-popover"
                class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-24px)] w-[min(280px,calc(100vw-16px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2.5 text-left text-[var(--text-primary)] shadow-xl"
              >
                <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">比例</div>
                <div class="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    class="row-span-5 flex h-full min-h-[210px] flex-col items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-xs transition-colors hover:border-[var(--accent-color)]"
                    :class="{ '!border-[var(--accent-color)] !bg-[var(--accent-color)] !text-white shadow-sm': selectedImageRatioMode === 'auto' }"
                    @click="selectImageSize('auto')"
                  >
                    <span class="mb-1 h-5 w-3 rounded-sm border border-current"></span>
                    自适应
                  </button>
                  <button
                    v-for="(option, index) in ratioOptions"
                    :key="option.key || option.label"
                    type="button"
                    class="flex h-11 flex-col items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-xs transition-colors hover:border-[var(--accent-color)]"
                    :class="{ 'col-start-2': index === 12, '!border-[var(--accent-color)] !bg-[var(--accent-color)] !text-white shadow-sm': selectedImageRatioMode !== 'auto' && option.key === selectedImageSize }"
                    @click="selectImageSize(option.key)"
                  >
                    <span class="mb-0.5 h-3.5 w-6 rounded-sm border border-current" :style="ratioPreviewStyle(option.label)"></span>
                    {{ option.label }}
                  </button>
                </div>

                <div class="my-3 border-t border-[var(--border-color)]"></div>
                <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">画质</div>
                <div class="grid grid-cols-3 gap-1">
                  <button
                    v-for="option in qualityOptions"
                    :key="option.key"
                    type="button"
                    class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-xs transition-colors hover:border-[var(--accent-color)]"
                    :class="{ '!border-[var(--accent-color)] !bg-[var(--accent-color)] !text-white shadow-sm': option.key === selectedImageQuality }"
                    @click="selectImageQuality(option.key)"
                  >
                    {{ option.label }}
                  </button>
                </div>

                <div class="my-3 border-t border-[var(--border-color)]"></div>
                <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">分辨率</div>
                <div class="grid grid-cols-3 gap-1">
                  <button
                    v-for="option in resolutionOptions"
                    :key="option.key"
                    type="button"
                    class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-xs transition-colors hover:border-[var(--accent-color)]"
                    :class="{ '!border-[var(--accent-color)] !bg-[var(--accent-color)] !text-white shadow-sm': option.key === selectedResolution }"
                    @click="selectImageResolution(option.key)"
                  >
                    {{ option.label }}
                  </button>
                </div>

              </div>
            </div>
          </div>
          
        </div>
      </section>

      <!-- My projects section | 我的项目区域 -->
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-[var(--text-primary)]">我的项目</h2>
          <div class="flex items-center gap-2">
            <button 
              @click="createNewProject"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-white transition-colors"
            >
              <n-icon :size="16"><AddOutline /></n-icon>
              新建项目
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
              @click="showTrashModal = true"
            >
              <n-icon :size="16"><TrashOutline /></n-icon>
              回收站
              <span v-if="trashedProjects.length" class="rounded-full bg-[var(--bg-tertiary)] px-1.5 text-xs">{{ trashedProjects.length }}</span>
            </button>
          </div>
        </div>
        
        <!-- Empty state | 空状态 -->
        <div v-if="projects.length === 0" class="text-center py-12 bg-[var(--bg-secondary)] rounded-xl border border-dashed border-[var(--border-color)]">
          <n-icon :size="48" class="text-[var(--text-secondary)] mb-4"><FolderOutline /></n-icon>
          <p class="text-[var(--text-secondary)] mb-4">还没有项目，创建一个开始吧</p>
          <button 
            @click="createNewProject"
            class="px-4 py-2 text-sm rounded-lg bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-white transition-colors"
          >
            创建第一个项目
          </button>
        </div>
        
        <!-- Projects grid | 项目网格 -->
        <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div 
            v-for="project in projects" 
            :key="project.id"
            class="group relative"
          >
            <!-- Project card | 项目卡片 -->
            <div 
              @click="openProject(project)"
              class="cursor-pointer"
            >
              <div 
                class="aspect-video rounded-xl overflow-hidden bg-[var(--bg-tertiary)] mb-2 border border-[var(--border-color)] relative"
                @mouseenter="handleThumbnailHover(project, true)"
                @mouseleave="handleThumbnailHover(project, false)"
              >
                <!-- Thumbnail or placeholder | 缩略图或占位 -->
                <template v-if="project.thumbnail">
                  <!-- Video thumbnail | 视频缩略图 -->
                  <video 
                    v-if="isVideoUrl(project.thumbnail)"
                    :ref="el => setVideoRef(project.id, el)"
                    :src="project.thumbnail"
                    class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    muted
                    loop
                    playsinline
                  />
                  <!-- Image thumbnail | 图片缩略图 -->
                  <img 
                    v-else
                    :src="project.thumbnail" 
                    :alt="project.name"
                    class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </template>
                <div v-else class="w-full h-full flex items-center justify-center">
                  <n-icon :size="32" class="text-[var(--text-secondary)]"><DocumentOutline /></n-icon>
                </div>
                
                <!-- Hover overlay | 悬浮遮罩 -->
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span class="text-white text-sm">打开项目</span>
                </div>
              </div>
              <p class="text-sm text-[var(--text-primary)] truncate">{{ project.name }}</p>
              <p class="text-xs text-[var(--text-secondary)]">{{ formatDate(project.updatedAt) }}</p>
            </div>
            
            <!-- Project actions | 项目操作 -->
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <n-dropdown :options="getProjectActions(project)" @select="(key) => handleProjectAction(key, project)" placement="bottom-end">
                <button 
                  @click.stop
                  class="p-1.5 bg-white/90 dark:bg-gray-800/90 rounded-lg shadow hover:bg-white dark:hover:bg-gray-800 transition-colors"
                >
                  <n-icon :size="16"><EllipsisHorizontalOutline /></n-icon>
                </button>
              </n-dropdown>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Floating bottom-left actions | 左下角悬浮操作（主题 / 设置） -->
    <div class="fixed bottom-4 left-4 z-40 flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-2 shadow-lg">
      <button
        type="button"
        class="flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
        :title="isDark ? '切换浅色主题' : '切换深色主题'"
        @click="toggleTheme"
      >
        <n-icon :size="20">
          <SunnyOutline v-if="isDark" />
          <MoonOutline v-else />
        </n-icon>
      </button>
      <button
        type="button"
        class="flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
        title="API 设置"
        @click="showApiSettings = true"
      >
        <n-icon :size="20"><SettingsOutline /></n-icon>
      </button>
    </div>

    <!-- API Settings Modal | API 设置弹窗 -->
    <ApiSettings v-model:show="showApiSettings" @saved="refreshApiConfig" />

    <!-- Rename modal | 重命名弹窗 -->
    <n-modal v-model:show="showRenameModal" preset="dialog" title="重命名项目">
      <n-input v-model:value="renameValue" placeholder="请输入项目名称" />
      <template #action>
        <n-button @click="showRenameModal = false">取消</n-button>
        <n-button type="primary" @click="confirmRename">确定</n-button>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showTrashModal"
      preset="card"
      title="项目回收站"
      class="project-trash-modal"
      :bordered="false"
    >
      <div v-if="trashedProjects.length" class="grid grid-cols-3 gap-3">
        <div
          v-for="project in trashedProjects"
          :key="project.id"
          class="group relative min-w-0"
        >
          <div class="relative mb-2 flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]">
            <video
              v-if="project.thumbnail && isVideoUrl(project.thumbnail)"
              :src="project.thumbnail"
              class="h-full w-full object-cover"
              muted
              playsinline
            />
            <img
              v-else-if="project.thumbnail"
              :src="project.thumbnail"
              :alt="project.name"
              class="h-full w-full object-cover"
            />
            <n-icon v-else :size="34" class="text-[var(--text-secondary)]"><DocumentOutline /></n-icon>
            <div class="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
              <span class="text-sm text-white">已移入回收站</span>
            </div>
            <div class="absolute right-2 top-2 z-10">
              <n-dropdown :options="getTrashProjectActions(project)" @select="key => handleTrashProjectAction(key, project)" placement="bottom-end">
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-gray-700 shadow-sm transition-colors hover:bg-white dark:bg-gray-800/90 dark:text-gray-100 dark:hover:bg-gray-800"
                  @click.stop
                >
                  <n-icon :size="17"><EllipsisHorizontalOutline /></n-icon>
                </button>
              </n-dropdown>
            </div>
          </div>
          <p class="truncate text-sm font-medium text-[var(--text-primary)]">{{ project.name }}</p>
          <p class="mt-0.5 text-xs text-[var(--text-secondary)]">删除于 {{ formatDate(project.deletedAt) }}</p>
        </div>
      </div>
      <div v-else class="flex min-h-52 flex-col items-center justify-center text-[var(--text-secondary)]">
        <n-icon :size="44"><TrashOutline /></n-icon>
        <p class="mt-3 text-sm">回收站是空的</p>
      </div>
      <template v-if="trashedProjects.length" #footer>
        <div class="flex justify-end">
          <n-button size="small" type="error" ghost @click="confirmEmptyTrash">清空回收站</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
/**
 * Home view component | 首页视图组件
 * Entry point with project list and creation input
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon, NDropdown, NModal, NInput, NButton, useDialog } from 'naive-ui'
import { 
  AddOutline, 
  SendOutline,
  RefreshOutline,
  DocumentOutline,
  FolderOutline,
  EllipsisHorizontalOutline,
  CreateOutline,
  CopyOutline,
  SettingsOutline,
  TrashOutline,
  ChevronDownOutline,
  SunnyOutline,
  MoonOutline
} from '@vicons/ionicons5'
import { 
  projects, 
  trashedProjects,
  initProjectsStore, 
  createProject, 
  deleteProject, 
  restoreProject,
  permanentlyDeleteProject,
  emptyProjectTrash,
  duplicateProject, 
  renameProject 
} from '../stores/projects'
import { useModelStore } from '../stores/pinia'
import { pendingReferenceImages } from '../stores/canvas'
import { isDark, toggleTheme } from '../stores/theme'
import ApiSettings from '../components/ApiSettings.vue'

const router = useRouter()
const dialog = useDialog()
const modelStore = useModelStore()

// API Settings state | API 设置状态
const showApiSettings = ref(false)
const showTrashModal = ref(false)
const isApiConfigured = computed(() => !!modelStore.currentApiKey)

// Refresh API config state | 刷新 API 配置状态
const refreshApiConfig = () => {
  // 通过 computed 自动更新，不需要手动刷新
}

// Video refs for hover play | 视频引用用于悬停播放
const videoRefs = new Map()

// Set video ref | 设置视频引用
const setVideoRef = (projectId, el) => {
  if (el) {
    videoRefs.set(projectId, el)
  } else {
    videoRefs.delete(projectId)
  }
}

// Handle thumbnail hover | 处理缩略图悬停
const handleThumbnailHover = (project, isHovering) => {
  if (!isVideoUrl(project.thumbnail)) return
  
  const video = videoRefs.get(project.id)
  if (!video) return
  
  if (isHovering) {
    video.play().catch(() => {
      // Ignore play errors (e.g., autoplay policy)
    })
  } else {
    video.pause()
    video.currentTime = 0 // Reset to start
  }
}

// Input state | 输入状态
const inputText = ref('')
const referenceInputRef = ref(null)
const referenceImages = ref([])

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|svg)$/i
const MAX_REFERENCE_IMAGES = 9

const handleReferenceImageChange = (event) => {
  const input = event.target
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return

  for (const file of files) {
    if (referenceImages.value.length >= MAX_REFERENCE_IMAGES) {
      window.$message?.warning(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`)
      break
    }

    const looksLikeImage = file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name)
    if (!looksLikeImage) {
      window.$message?.warning(`「${file.name}」不是图片文件，请选择图片`)
      continue
    }
    if (file.size > 10 * 1024 * 1024) {
      window.$message?.warning(`「${file.name}」超过 10MB（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后再试`)
      continue
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (referenceImages.value.length >= MAX_REFERENCE_IMAGES) return
      referenceImages.value = [...referenceImages.value, { name: file.name, dataUrl: reader.result }]
      window.$message?.success(`已添加参考图「${file.name}」`)
    }
    reader.onerror = () => window.$message?.error(`「${file.name}」读取失败，请重试`)
    reader.readAsDataURL(file)
  }
}

const removeReferenceImage = (index) => {
  referenceImages.value.splice(index, 1)
}

// Homepage image generation settings | 首页生图配置
const selectedImageModelKey = ref('')
const selectedImageSize = ref('')
const selectedImageRatioMode = ref('auto')
const selectedImageQuality = ref('medium')
const selectedResolution = ref('2k')
const imageCount = ref(1)
const showImageSettings = ref(false)

const imageModelOptions = computed(() => modelStore.availableImageModels || [])
const selectedImageModel = computed(() =>
  imageModelOptions.value.find(model => model.key === selectedImageModelKey.value) || imageModelOptions.value[0]
)
const selectedImageModelLabel = computed(() => selectedImageModel.value?.label || '选择模型')
const imageModelDropdownOptions = computed(() => imageModelOptions.value.map(model => ({
  label: model.label,
  key: model.key
})))

const ratioLabel = (size) => {
  if (!size || !size.includes('x')) return size || '自动'
  const [width, height] = size.split('x').map(Number)
  if (!width || !height) return size
  const ratio = width / height
  const knownRatios = [
    [21 / 9, '21:9'], [16 / 9, '16:9'], [3 / 2, '3:2'], [4 / 3, '4:3'],
    [1, '1:1'], [3 / 4, '3:4'], [2 / 3, '2:3'], [9 / 16, '9:16'], [9 / 21, '9:21']
  ]
  return knownRatios.find(([value]) => Math.abs(ratio - value) < 0.03)?.[1] || `${width}:${height}`
}

const ratioDefinitions = [
  { label: '1:1', fallback: '1x1' },
  { label: '2:3', fallback: '2x3' },
  { label: '3:2', fallback: '3x2' },
  { label: '4:5', fallback: '4x5' },
  { label: '5:4', fallback: '5x4' },
  { label: '16:9', fallback: '16x9' },
  { label: '9:16', fallback: '9x16' },
  { label: '21:9', fallback: '21x9' },
  { label: '9:21', fallback: '9x21' },
  { label: '3:4', fallback: '3x4' },
  { label: '4:3', fallback: '4x3' },
  { label: '1:2', fallback: '1x2' },
  { label: '2:1', fallback: '2x1' },
  { label: '1:3', fallback: '1x3' },
  { label: '3:1', fallback: '3x1' }
]

const ratioOptions = computed(() => {
  const sizes = selectedImageModel.value?.sizes || []
  return ratioDefinitions.map(definition => ({
    label: definition.label,
    key: sizes.find(size => ratioLabel(size) === definition.label) || definition.fallback
  }))
})
const selectedRatioLabel = computed(() => selectedImageRatioMode.value === 'auto'
  ? '自适应'
  : ratioOptions.value.find(option => option.key === selectedImageSize.value)?.label || '自动')

const HOME_QUALITY_OPTIONS = [
  { label: '低', key: 'low' },
  { label: '中', key: 'medium' },
  { label: '高', key: 'high' }
]
const qualityOptions = computed(() => HOME_QUALITY_OPTIONS)
const selectedQualityLabel = computed(() => qualityOptions.value.find(option => option.key === selectedImageQuality.value)?.label || '中')
const resolutionOptions = [
  { label: '1K', key: '1k' },
  { label: '2K', key: '2k' },
  { label: '4K', key: '4k' }
]
const selectedResolutionLabel = computed(() => resolutionOptions.find(option => option.key === selectedResolution.value)?.label || '2K')
const countDropdownOptions = [1, 2, 3, 4].map(count => ({ label: `${count} 张`, key: count }))

const resolutionForSize = (size) => {
  if (!size || !size.includes('x')) return '2k'
  const longestSide = Math.max(...size.split('x').map(Number))
  if (longestSide >= 3800) return '4k'
  if (longestSide >= 1800) return '2k'
  return '1k'
}

const ratioPreviewStyle = (label) => {
  const [width, height] = String(label).split(':').map(Number)
  if (!width || !height) return {}
  const max = 28
  const scale = Math.min(max / width, 16 / height)
  return { width: `${Math.max(8, Math.round(width * scale))}px`, height: `${Math.max(6, Math.round(height * scale))}px` }
}

const syncImageSettings = () => {
  const model = selectedImageModel.value
  if (!model) return
  selectedImageModelKey.value = model.key
  if (model.sourceProvider && modelStore.currentProvider !== model.sourceProvider) {
    modelStore.setProvider(model.sourceProvider)
  }
  const options = ratioOptions.value
  if (!options.some(option => option.key === selectedImageSize.value)) {
    selectedImageSize.value = model.defaultParams?.size || options[0]?.key || ''
  }
  const qualities = qualityOptions.value
  if (!qualities.some(option => option.key === selectedImageQuality.value)) {
    const configuredQuality = model.defaultParams?.quality
    selectedImageQuality.value = ['low', 'medium', 'high'].includes(configuredQuality) ? configuredQuality : 'medium'
  }
}

watch(imageModelOptions, syncImageSettings, { immediate: true })
watch(selectedImageModelKey, syncImageSettings)

const selectImageModel = (key) => {
  selectedImageModelKey.value = key
  const selected = imageModelOptions.value.find(model => model.key === key)
  if (selected?.sourceProvider) modelStore.setProvider(selected.sourceProvider)
  modelStore.selectedImageModel = key
  syncImageSettings()
}

const selectImageSize = (size) => {
  if (size === 'auto') {
    selectedImageRatioMode.value = 'auto'
    selectedImageSize.value = selectedImageModel.value?.defaultParams?.size || ratioOptions.value[0]?.key || ''
    return
  }
  selectedImageRatioMode.value = 'ratio'
  selectedImageSize.value = size
}

const selectImageQuality = (quality) => {
  selectedImageQuality.value = quality
}

const selectImageResolution = (resolution) => {
  selectedResolution.value = resolution
  const currentRatio = selectedRatioLabel.value
  const candidate = ratioOptions.value.find(option => option.label === currentRatio && resolutionForSize(option.key) === resolution)
  if (candidate) selectedImageSize.value = candidate.key
}

const selectImageCount = (count) => {
  imageCount.value = Number(count)
}

const openImageModelSettings = () => {
  dialog.warning({
    title: '暂无图片模型',
    content: '请先在 API 设置中添加图片模型，再开始生图。',
    positiveText: '去设置',
    negativeText: '取消',
    onPositiveClick: () => { showApiSettings.value = true }
  })
}

const saveGenerationSettings = () => {
  sessionStorage.setItem('ai-canvas-generation-settings', JSON.stringify({
    model: selectedImageModelKey.value,
    size: selectedImageSize.value,
    quality: selectedImageQuality.value,
    resolution: selectedResolution.value,
    n: imageCount.value
  }))

  // Pass reference images in memory: sessionStorage (~5MB) cannot hold base64 images | 参考图通过内存传递，sessionStorage 容量装不下 base64 图片
  pendingReferenceImages.value = referenceImages.value.map(img => ({ ...img }))
}

// Rename modal state | 重命名弹窗状态
const showRenameModal = ref(false)
const renameValue = ref('')
const renameTargetId = ref(null)

// Format date | 格式化日期
const formatDate = (date) => {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diff = now - d
  
  // Less than 1 minute | 小于1分钟
  if (diff < 60000) return '刚刚'
  // Less than 1 hour | 小于1小时
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  // Less than 1 day | 小于1天
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  // Less than 7 days | 小于7天
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
  // Format as date | 格式化为日期
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// Get project actions | 获取项目操作选项
const getProjectActions = (project) => [
  { label: '重命名', key: 'rename', icon: () => h(NIcon, null, { default: () => h(CreateOutline) }) },
  { label: '复制', key: 'duplicate', icon: () => h(NIcon, null, { default: () => h(CopyOutline) }) },
  { type: 'divider' },
  { label: '删除', key: 'delete', icon: () => h(NIcon, null, { default: () => h(TrashOutline) }) }
]

// Handle project action | 处理项目操作
const handleProjectAction = (key, project) => {
  switch (key) {
    case 'rename':
      renameTargetId.value = project.id
      renameValue.value = project.name
      showRenameModal.value = true
      break
    case 'duplicate':
      const newId = duplicateProject(project.id)
      if (newId) {
        window.$message?.success('项目已复制')
      }
      break
    case 'delete':
      dialog.warning({
        title: '移入回收站',
        content: `确定要将项目「${project.name}」移入回收站吗？之后可以恢复。`,
        positiveText: '移入回收站',
        negativeText: '取消',
        onPositiveClick: () => {
          deleteProject(project.id)
          window.$message?.success('项目已移入回收站')
        }
      })
      break
  }
}

const handleRestoreProject = project => {
  if (restoreProject(project.id)) {
    window.$message?.success(`已恢复项目「${project.name}」`)
  }
}

const getTrashProjectActions = () => [
  { label: '恢复项目', key: 'restore', icon: () => h(NIcon, null, { default: () => h(RefreshOutline) }) },
  { type: 'divider' },
  { label: '永久删除', key: 'permanent-delete', icon: () => h(NIcon, null, { default: () => h(TrashOutline) }) }
]

const handleTrashProjectAction = (key, project) => {
  if (key === 'restore') handleRestoreProject(project)
  if (key === 'permanent-delete') confirmPermanentDelete(project)
}

const confirmPermanentDelete = project => {
  dialog.error({
    title: '永久删除项目',
    content: `确定永久删除项目「${project.name}」吗？删除后无法恢复。`,
    positiveText: '永久删除',
    negativeText: '取消',
    onPositiveClick: () => {
      permanentlyDeleteProject(project.id)
      window.$message?.success('项目已永久删除')
    }
  })
}

const confirmEmptyTrash = () => {
  dialog.error({
    title: '清空回收站',
    content: `确定永久删除回收站中的 ${trashedProjects.value.length} 个项目吗？此操作无法恢复。`,
    positiveText: '清空回收站',
    negativeText: '取消',
    onPositiveClick: () => {
      emptyProjectTrash()
      window.$message?.success('回收站已清空')
    }
  })
}

// Confirm rename | 确认重命名
const confirmRename = () => {
  if (renameTargetId.value && renameValue.value.trim()) {
    renameProject(renameTargetId.value, renameValue.value.trim())
    window.$message?.success('已重命名')
  }
  showRenameModal.value = false
  renameTargetId.value = null
  renameValue.value = ''
}

// Check API key before navigation | 跳转前检查 API Key
const checkApiKeyAndNavigate = (callback) => {
  
  if (!isApiConfigured.value) {
    dialog.warning({
      title: '未配置 API Key',
      content: '请先在设置中配置 API Key 才能使用画布功能。',
      positiveText: '知道了'
    })
    return false
  }
  callback()
  return true
}

// Create new project | 创建新项目
const createNewProject = () => {
  checkApiKeyAndNavigate(() => {
    const id = createProject('未命名项目')
    saveGenerationSettings()
    router.push(`/canvas/${id}`)
  })
}

// Create project with input text | 使用输入文本创建项目
const handleCreateWithInput = () => {
  checkApiKeyAndNavigate(() => {
    const name = inputText.value.trim() || '未命名项目'
    const id = createProject(name)
    // Store the input text to be used as initial prompt
    sessionStorage.setItem('ai-canvas-initial-prompt', inputText.value.trim())
    saveGenerationSettings()
    inputText.value = ''
    router.push(`/canvas/${id}`)
  })
}

// Open existing project | 打开已有项目
const openProject = (project) => {
  checkApiKeyAndNavigate(() => {
    router.push(`/canvas/${project.id}`)
  })
}

// Check if URL is a video | 检查 URL 是否为视频
const isVideoUrl = (url) => {
  if (!url || typeof url !== 'string') return false
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv']
  return videoExtensions.some(ext => url.toLowerCase().includes(ext))
}

// Import h for render functions | 导入 h 用于渲染函数
import { h } from 'vue'

// Initialize projects store on mount | 挂载时初始化项目存储
const handleImageSettingsOutsideClick = (event) => {
  if (!showImageSettings.value) return
  const target = event.target
  if (target?.closest?.('[data-testid="home-image-settings-popover"]') || target?.closest?.('[data-testid="home-image-ratio"]')) return
  showImageSettings.value = false
}

onMounted(() => {
  initProjectsStore()
  document.addEventListener('click', handleImageSettingsOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleImageSettingsOutsideClick)
})
</script>

<style scoped>
:global(.project-trash-modal) {
  width: min(680px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 48px));
}

:global(.project-trash-modal .n-card__content) {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}
</style>
