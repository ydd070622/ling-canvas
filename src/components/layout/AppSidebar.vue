<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDropdown, NInput, NModal, useDialog } from 'naive-ui'
import {
  HomeOutline,
  GridOutline,
  HeartOutline,
  CubeOutline,
  TrashOutline,
  FolderOutline,
  AddCircleOutline,
  EllipsisHorizontalOutline,
  SunnyOutline,
  MoonOutline,
  SettingsOutline
} from '@vicons/ionicons5'
import { isDark, toggleTheme } from '../../stores/theme'
import { activeProjects, trashedProjects } from '../../stores/projects'
import { assetEntries } from '../../stores/assets'
import { useUIStore } from '../../stores/ui'
import ApiSettings from '../ApiSettings.vue'

const router = useRouter()
const ui = useUIStore()
const dialog = useDialog()
const showApiSettings = ref(false)

const projectCount = computed(() => activeProjects.value.length)
const trashCount = computed(() => trashedProjects.value.length)
const favoriteCount = computed(() => activeProjects.value.filter(project => project.favorite).length)
// 素材库尚未建立独立的数据源，不能用画布节点数冒充素材数量。
// 素材库的列表来自 Rust 扫描本地目录，首次进入该页面时才载入；未载入时计数为 0
const assetCount = computed(() => assetEntries.value.length)

const navigateToView = (view) => {
  ui.setView(view)
  if (router.currentRoute.value.path !== '/') router.push('/')
}

const navigateToFolder = (folderName) => {
  ui.setView('folder', folderName)
  if (router.currentRoute.value.path !== '/') router.push('/')
}

// 文件夹管理：新建 / 重命名 / 删除 | Folder management
const folderActions = [
  { label: '重命名', key: 'rename' },
  { type: 'divider' },
  { label: '删除', key: 'delete' }
]

const showFolderModal = ref(false)
const folderModalMode = ref('create')
const folderNameValue = ref('')
const folderModalTarget = ref('')

const openCreateFolder = () => {
  folderModalMode.value = 'create'
  folderModalTarget.value = ''
  folderNameValue.value = ''
  showFolderModal.value = true
}

const openRenameFolder = (name) => {
  folderModalMode.value = 'rename'
  folderModalTarget.value = name
  folderNameValue.value = name
  showFolderModal.value = true
}

// 校验失败时保持弹窗打开，用户可以直接改输入
const confirmFolderModal = () => {
  const value = folderNameValue.value
  if (folderModalMode.value === 'create') {
    const status = ui.addFolder(value)
    if (status === 'ok') {
      showFolderModal.value = false
      navigateToFolder(value.trim())
    } else {
      window.$message?.warning(status === 'empty' ? '文件夹名称不能为空' : '已存在同名文件夹')
    }
    return
  }

  const status = ui.renameFolder(folderModalTarget.value, value)
  if (status === 'ok') {
    showFolderModal.value = false
  } else if (status === 'unchanged') {
    showFolderModal.value = false
  } else if (status === 'empty') {
    window.$message?.warning('文件夹名称不能为空')
  } else if (status === 'duplicate') {
    window.$message?.warning('已存在同名文件夹')
  } else {
    // missing：文件夹已被别处删掉
    showFolderModal.value = false
    window.$message?.warning('文件夹已不存在')
  }
}

const handleFolderAction = (key, name) => {
  if (key === 'rename') return openRenameFolder(name)
  if (key !== 'delete') return
  dialog.error({
    title: '删除文件夹',
    content: `确定删除文件夹「${name}」吗？此操作无法恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      ui.removeFolder(name)
    }
  })
}
</script>

<template>
  <aside class="home-sidebar" :class="{ 'home-sidebar--collapsed': ui.sidebarCollapsed }">
    <nav class="home-sidebar__nav">
      <p class="home-sidebar__section-title">个人</p>

      <button
        class="home-sidebar__item"
        :class="{ 'home-sidebar__item--active': ['all', 'canvases'].includes(ui.currentView) }"
        @click="navigateToView('all')"
      >
        <span class="home-sidebar__icon"><HomeOutline /></span>
        <span>全部画布</span>
        <span class="home-sidebar__count">{{ projectCount }}</span>
      </button>

      <button
        class="home-sidebar__item"
        :class="{ 'home-sidebar__item--active': ui.currentView === 'templates' }"
        @click="navigateToView('templates')"
      >
        <span class="home-sidebar__icon"><GridOutline /></span>
        <span>模板中心</span>
      </button>

      <button
        class="home-sidebar__item"
        :class="{ 'home-sidebar__item--active': ui.currentView === 'favorites' }"
        @click="navigateToView('favorites')"
      >
        <span class="home-sidebar__icon"><HeartOutline /></span>
        <span>灵感收藏</span>
        <span class="home-sidebar__count">{{ favoriteCount }}</span>
      </button>

      <button
        class="home-sidebar__item"
        :class="{ 'home-sidebar__item--active': ui.currentView === 'assets' }"
        @click="navigateToView('assets')"
      >
        <span class="home-sidebar__icon"><CubeOutline /></span>
        <span>素材库</span>
        <span class="home-sidebar__count">{{ assetCount }}</span>
      </button>

      <button
        class="home-sidebar__item"
        :class="{ 'home-sidebar__item--active': ui.currentView === 'trash' }"
        @click="navigateToView('trash')"
      >
        <span class="home-sidebar__icon"><TrashOutline /></span>
        <span>回收站</span>
        <span class="home-sidebar__count">{{ trashCount }}</span>
      </button>

      <div class="home-sidebar__divider" />
      <p class="home-sidebar__section-title">本地空间</p>

      <div v-for="folder in ui.folders" :key="folder" class="home-sidebar__folder-row">
        <button
          class="home-sidebar__item home-sidebar__folder"
          :class="{ 'home-sidebar__item--active': ui.currentView === 'folder' && ui.currentFolder === folder }"
          @click="navigateToFolder(folder)"
        >
          <span class="home-sidebar__icon"><FolderOutline /></span>
          <span class="truncate">{{ folder }}</span>
        </button>
        <n-dropdown :options="folderActions" placement="bottom-end" @select="key => handleFolderAction(key, folder)">
          <button class="home-sidebar__folder-menu" aria-label="文件夹操作" @click.stop><EllipsisHorizontalOutline /></button>
        </n-dropdown>
      </div>

      <p v-if="!ui.folders.length" class="home-sidebar__folder-empty">还没有文件夹</p>

      <button class="home-sidebar__item home-sidebar__create" @click="openCreateFolder">
        <span class="home-sidebar__icon"><AddCircleOutline /></span>
        <span>创建文件夹</span>
      </button>
    </nav>

    <div class="home-sidebar__footer">
      <div class="home-sidebar__footer-actions">
        <button class="home-sidebar__footer-btn" @click="toggleTheme">
          <SunnyOutline v-if="!isDark" />
          <MoonOutline v-else />
          <span>主题</span>
        </button>
        <button class="home-sidebar__footer-btn" @click="showApiSettings = true">
          <SettingsOutline />
          <span>设置</span>
        </button>
      </div>
    </div>

    <n-modal
      v-model:show="showFolderModal"
      preset="dialog"
      :title="folderModalMode === 'create' ? '新建文件夹' : '重命名文件夹'"
    >
      <n-input
        v-model:value="folderNameValue"
        placeholder="请输入文件夹名称"
        maxlength="20"
        @keyup.enter="confirmFolderModal"
      />
      <template #action>
        <n-button @click="showFolderModal = false">取消</n-button>
        <n-button type="primary" @click="confirmFolderModal">确定</n-button>
      </template>
    </n-modal>

    <ApiSettings v-model:show="showApiSettings" />
  </aside>
</template>

<style scoped>
.home-sidebar {
  width: 224px;
  height: 100%;
  flex: 0 0 224px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(249, 251, 254, 0.96);
  border-right: 1px solid rgba(226, 232, 240, 0.72);
  transition: width 0.25s ease, flex-basis 0.25s ease;
  user-select: none;
}

.dark .home-sidebar {
  background: #101010;
  border-right-color: rgba(255, 255, 255, 0.08);
}

.home-sidebar--collapsed { width: 0; flex-basis: 0; }
.home-sidebar__nav { flex: 1; overflow-y: auto; padding: 9px 14px 16px; }
.home-sidebar__section-title { padding: 7px 12px 8px; color: #8b97aa; font-size: 12px; font-weight: 650; letter-spacing: 0.05em; }

.home-sidebar__item {
  width: 100%; min-height: 42px; display: flex; align-items: center; gap: 11px;
  padding: 0 12px; margin-bottom: 3px; border-radius: 10px; color: #475569;
  font-size: 14px; font-weight: 540;
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
}
.home-sidebar__item:hover { background: rgba(226, 232, 240, 0.62); color: #1e293b; }
.home-sidebar__item:active { transform: scale(0.985); }
.home-sidebar__item--active { background: #e7f0ff; color: #3b82f6; font-weight: 650; }
.home-sidebar__item--active:hover { background: #dce9ff; color: #2563eb; }
.dark .home-sidebar__item { color: #aab3c2; }
.dark .home-sidebar__item:hover { background: rgba(255, 255, 255, 0.06); color: #f1f5f9; }
.dark .home-sidebar__item--active { background: rgba(59, 130, 246, 0.16); color: #78a9ff; }

.home-sidebar__icon { width: 20px; height: 20px; flex: 0 0 20px; display: grid; place-items: center; color: currentColor; }
.home-sidebar__count { margin-left: auto; color: #9aa6b7; font-size: 12px; font-variant-numeric: tabular-nums; }
.home-sidebar__item--active .home-sidebar__count { color: #5591ef; }
.home-sidebar__divider { height: 1px; margin: 15px 10px 13px; background: #e5eaf1; }
.dark .home-sidebar__divider { background: rgba(255, 255, 255, 0.08); }
.home-sidebar__folder { min-height: 39px; }
.home-sidebar__create { color: #64748b; }

/* 文件夹行：外层做定位容器，kebab 绝对定位，避免悬停出现时把文件夹名挤左 | Folder row */
.home-sidebar__folder-row { position: relative; display: flex; align-items: center; margin-bottom: 3px; }
.home-sidebar__folder-row .home-sidebar__item { flex: 1; min-width: 0; margin-bottom: 0; padding-right: 30px; }
.home-sidebar__folder-menu {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px;
  color: #758297; opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.home-sidebar__folder-menu :deep(svg) { width: 16px; height: 16px; }
.home-sidebar__folder-row:hover .home-sidebar__folder-menu,
.home-sidebar__folder-row .home-sidebar__item--active + .home-sidebar__folder-menu,
.home-sidebar__folder-menu:focus-visible { opacity: 1; }
.home-sidebar__folder-menu:hover { background: #eef2f7; color: #334155; }
.dark .home-sidebar__folder-menu { color: #94a3b8; }
.dark .home-sidebar__folder-menu:hover { background: rgba(255, 255, 255, 0.08); color: #e2e8f0; }
.home-sidebar__folder-empty { padding: 6px 12px 10px; color: #9aa6b7; font-size: 12px; }

.home-sidebar__footer {
  display: flex; flex-direction: column;
  margin: 0 16px; padding: 12px 0 15px; border-top: 1px solid #e5eaf1;
}
.dark .home-sidebar__footer { border-top-color: rgba(255, 255, 255, 0.08); }
.home-sidebar__footer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

.home-sidebar__footer-btn {
  display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 8px;
  color: #64748b; font-size: 13px; transition: background 0.18s ease, color 0.18s ease;
}
.home-sidebar__footer-btn:hover { background: #eef2f7; color: #334155; }
.dark .home-sidebar__footer-btn { color: #94a3b8; }
.dark .home-sidebar__footer-btn:hover { background: rgba(255, 255, 255, 0.06); color: #e2e8f0; }
.home-sidebar__footer-btn :deep(svg) { width: 18px; height: 18px; }
.home-sidebar__nav::-webkit-scrollbar { width: 4px; }
.home-sidebar__nav::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(148, 163, 184, 0.35); }

.home-sidebar__item--active, .home-sidebar__item--active:hover, .dark .home-sidebar__item--active { background: var(--bg-tertiary); color: var(--text-primary); }
.home-sidebar__item--active .home-sidebar__count { color: var(--text-secondary); }
</style>
