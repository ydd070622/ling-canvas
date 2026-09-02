<script setup>
/**
 * Home view | 主页视图
 * Workspace content area with canvas list
 */
import { ref, computed, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon, NDropdown, NModal, NInput, NButton, useDialog } from 'naive-ui'
import {
  RefreshOutline,
  EllipsisHorizontalOutline,
  SettingsOutline,
  TrashOutline
} from '@vicons/ionicons5'
import {
  projects,
  trashedProjects,
  activeProjects,
  initProjectsStore,
  createProject,
  restoreProject,
  permanentlyDeleteProject,
  emptyProjectTrash,
  renameProject,
  deleteProject
} from '../stores/projects'
import { useModelStore } from '../stores/pinia'
import { useUIStore } from '../stores/ui'
import ApiSettings from '../components/ApiSettings.vue'
import CanvasList from '../components/layout/CanvasList.vue'

const router = useRouter()
const dialog = useDialog()
const modelStore = useModelStore()
const uiStore = useUIStore()

// ─── Manage mode | 管理模式 ───
const isManaging = ref(false)
const selectedIds = ref([])

const toggleSelect = (id) => {
  const idx = selectedIds.value.indexOf(id)
  if (idx === -1) {
    selectedIds.value.push(id)
  } else {
    selectedIds.value.splice(idx, 1)
  }
}

const toggleSelectAll = () => {
  if (selectedIds.value.length === filteredProjects.value.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = filteredProjects.value.map(p => p.id)
  }
}

const exitManageMode = () => {
  isManaging.value = false
  selectedIds.value = []
}

const confirmBatchDelete = () => {
  if (selectedIds.value.length === 0) return
  const count = selectedIds.value.length
  dialog.error({
    title: '批量删除画布',
    content: `确定要删除 ${count} 个画布吗？删除后可在回收站中恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      selectedIds.value.forEach(id => deleteProject(id))
      window.$message?.success(`已将 ${count} 个画布移入回收站`)
      selectedIds.value = []
      // If no more items, exit manage mode
      if (filteredProjects.value.length === 0) {
        exitManageMode()
      }
    }
  })
}

const enterManageMode = () => {
  isManaging.value = true
  selectedIds.value = []
}

// ─── View-based project filtering | 基于视图的项目过滤 ───
const filteredProjects = computed(() => {
  switch (uiStore.currentView) {
    case 'trash':
      return trashedProjects.value
    case 'recent':
      return [...activeProjects.value]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10)
    case 'folder':
      return activeProjects.value.filter(p => p.folder === uiStore.currentFolder)
    case 'shared':
      return []
    case 'all':
    default:
      return activeProjects.value
  }
})

const isTrashView = computed(() => uiStore.currentView === 'trash')

// ─── API Settings | API 设置 ───
const showApiSettings = ref(false)
const isApiConfigured = computed(() => !!modelStore.currentApiKey)
const refreshApiConfig = () => {}

// ─── Rename modal | 重命名弹窗 ───
const showRenameModal = ref(false)
const renameValue = ref('')
const renameTargetId = ref(null)

const confirmRename = () => {
  if (renameTargetId.value && renameValue.value.trim()) {
    renameProject(renameTargetId.value, renameValue.value.trim())
    window.$message?.success('已重命名')
  }
  showRenameModal.value = false
  renameTargetId.value = null
  renameValue.value = ''
}

// ─── CanvasList event handlers | 画布列表事件处理 ───
const handleCanvasDelete = (id) => {
  // CanvasCard already calls deleteProject internally
  window.$message?.success('已移入回收站')
}

const handleCanvasRename = (id) => {
  const project = projects.value.find(p => p.id === id)
  if (project) {
    renameTargetId.value = id
    renameValue.value = project.name
    showRenameModal.value = true
  }
}

// ─── Trash view actions | 回收站视图操作 ───
const handleRestoreProject = (project) => {
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

const confirmPermanentDelete = (project) => {
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

// ─── Navigation | 导航 ───
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

const createNewCanvas = () => {
  checkApiKeyAndNavigate(() => {
    const folder = uiStore.currentView === 'folder' ? uiStore.currentFolder : null

    let name = '未命名项目'
    if (folder) {
      // 获取今天的日期 YYYYMMDD
      const now = new Date()
      const dateStr = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0')

      // 计算当天该分类下已有的画布数量
      const todayPrefix = `${dateStr}-${folder}-`
      const existingCount = activeProjects.value.filter(p =>
        p.folder === folder && p.name && p.name.startsWith(todayPrefix)
      ).length

      // 生成名称
      name = `${todayPrefix}${existingCount + 1}`
    }

    const id = createProject(name, folder)
    router.push(`/canvas/${id}`)
  })
}

// ─── Date formatting | 日期格式化 ───
const formatDate = (date) => {
  if (!date) return ''
  const d = new Date(date)
  const diff = new Date() - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

onMounted(() => {
  initProjectsStore()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-5xl px-6 py-8">
      <!-- ─── Workspace Header | 工作区头部 ─── -->
      <header class="mb-8">
        <span class="mb-1 block text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500">
          WORKSPACE
        </span>
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {{ uiStore.viewTitle }}
            </h1>
            <p class="mt-1.5 text-sm leading-relaxed text-gray-400 dark:text-gray-500">
              把素材、提示词和生成结果组织在同一个项目空间里。
            </p>
          </div>

          <!-- Action buttons group | 操作按钮组 -->
          <div class="flex shrink-0 items-center gap-2">
            <!-- Manage button (non-trash views) | 管理按钮（非回收站视图） -->
            <button
              v-if="!isTrashView && filteredProjects.length > 0"
              type="button"
              class="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium transition-all"
              :class="isManaging
                ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:border-gray-500'"
              @click="isManaging ? exitManageMode() : enterManageMode()"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {{ isManaging ? '退出管理' : '管理' }}
            </button>

            <!-- New canvas button (hidden in manage mode) | 新建画布按钮（管理模式下隐藏） -->
            <button
              v-if="!isTrashView && !isManaging"
              type="button"
              class="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-600 hover:shadow-md active:scale-[0.97]"
              @click="createNewCanvas"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              新建画布
            </button>

            <!-- Empty trash button | 清空回收站按钮 -->
            <button
              v-if="isTrashView && trashedProjects.length > 0"
              type="button"
              class="flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-500 transition-all hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              @click="confirmEmptyTrash"
            >
              清空回收站
            </button>
          </div>
        </div>
      </header>

      <!-- ─── Canvas List | 画布列表 ─── -->
      <section>
        <!-- Trash view | 回收站视图 -->
        <template v-if="isTrashView">
          <div v-if="trashedProjects.length > 0" class="grid grid-cols-2 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <div
              v-for="project in trashedProjects"
              :key="project.id"
              class="group relative min-w-0"
            >
              <div class="relative mb-2 flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                <img
                  v-if="project.thumbnail"
                  :src="project.thumbnail"
                  :alt="project.name"
                  class="h-full w-full object-cover opacity-60"
                />
                <n-icon v-else :size="34" class="text-gray-300 dark:text-gray-600"><TrashOutline /></n-icon>
                <div class="absolute right-2 top-2 z-10">
                  <n-dropdown :options="getTrashProjectActions(project)" @select="key => handleTrashProjectAction(key, project)" placement="bottom-end">
                    <button
                      type="button"
                      class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-gray-700 shadow-sm transition-colors hover:bg-white dark:bg-gray-700/90 dark:text-gray-100 dark:hover:bg-gray-600"
                      @click.stop
                    >
                      <n-icon :size="17"><EllipsisHorizontalOutline /></n-icon>
                    </button>
                  </n-dropdown>
                </div>
              </div>
              <p class="truncate text-sm font-medium text-gray-700 dark:text-gray-300">{{ project.name }}</p>
              <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">删除于 {{ formatDate(project.deletedAt) }}</p>
            </div>
          </div>
          <div v-else class="flex flex-col items-center justify-center py-24 text-center">
            <n-icon :size="48" class="mb-4 text-gray-300 dark:text-gray-600"><TrashOutline /></n-icon>
            <p class="text-base font-medium text-gray-400 dark:text-gray-500">回收站是空的</p>
            <p class="mt-1 text-sm text-gray-300 dark:text-gray-600">删除的画布会出现在这里</p>
          </div>
        </template>

        <!-- Shared view (empty placeholder) | 共享视图（空占位） -->
        <template v-else-if="uiStore.currentView === 'shared'">
          <div class="flex flex-col items-center justify-center py-24 text-center">
            <n-icon :size="48" class="mb-4 text-gray-300 dark:text-gray-600"><SettingsOutline /></n-icon>
            <p class="text-base font-medium text-gray-400 dark:text-gray-500">暂无共享内容</p>
            <p class="mt-1 text-sm text-gray-300 dark:text-gray-600">与他人共享的画布会显示在这里</p>
          </div>
        </template>

        <!-- Normal views (all / recent / folder) | 正常视图 -->
        <template v-else>
          <CanvasList
            :projects="filteredProjects"
            :selectable="isManaging"
            :selected-ids="selectedIds"
            @delete="handleCanvasDelete"
            @rename="handleCanvasRename"
            @toggle-select="toggleSelect"
            @toggle-select-all="toggleSelectAll"
          >
            <template #actions>
              <button
                type="button"
                class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                @click="exitManageMode"
              >
                取消
              </button>
              <button
                type="button"
                :disabled="selectedIds.length === 0"
                class="flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-all hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                @click="confirmBatchDelete"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除选中 ({{ selectedIds.length }})
              </button>
            </template>
          </CanvasList>
        </template>
      </section>
    </div>

    <!-- ─── API Settings Modal | API 设置弹窗 ─── -->
    <ApiSettings v-model:show="showApiSettings" @saved="refreshApiConfig" />

    <!-- ─── Rename Modal | 重命名弹窗 ─── -->
    <n-modal v-model:show="showRenameModal" preset="dialog" title="重命名项目">
      <n-input v-model:value="renameValue" placeholder="请输入项目名称" />
      <template #action>
        <n-button @click="showRenameModal = false">取消</n-button>
        <n-button type="primary" @click="confirmRename">确定</n-button>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
/* Manage mode transitions handled by CanvasList */
</style>