<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  HomeOutline,
  GridOutline,
  HeartOutline,
  CubeOutline,
  TrashOutline,
  FolderOutline,
  AddCircleOutline,
  SunnyOutline,
  MoonOutline,
  SettingsOutline
} from '@vicons/ionicons5'
import { isDark, toggleTheme } from '../../stores/theme'
import { activeProjects, trashedProjects } from '../../stores/projects'
import { useUIStore } from '../../stores/ui'
import ApiSettings from '../ApiSettings.vue'

const router = useRouter()
const ui = useUIStore()
const showApiSettings = ref(false)

const projectCount = computed(() => activeProjects.value.length)
const trashCount = computed(() => trashedProjects.value.length)
const favoriteCount = computed(() => activeProjects.value.filter(project => project.favorite).length)
// 素材库尚未建立独立的数据源，不能用画布节点数冒充素材数量。
const assetCount = computed(() => 0)

const navigateToView = (view) => {
  ui.setView(view)
  if (router.currentRoute.value.path !== '/') router.push('/')
}

const navigateToFolder = (folderName) => {
  ui.setView('folder', folderName)
  if (router.currentRoute.value.path !== '/') router.push('/')
}

const createFolder = () => {
  const name = window.prompt('请输入文件夹名称')
  if (!name) return
  if (ui.addFolder(name)) {
    navigateToFolder(name.trim())
    window.$message?.success('文件夹已创建')
  } else {
    window.$message?.warning('文件夹名称为空或已存在')
  }
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

      <button
        v-for="folder in ui.folders"
        :key="folder"
        class="home-sidebar__item home-sidebar__folder"
        :class="{ 'home-sidebar__item--active': ui.currentView === 'folder' && ui.currentFolder === folder }"
        @click="navigateToFolder(folder)"
      >
        <span class="home-sidebar__icon"><FolderOutline /></span>
        <span class="truncate">{{ folder }}</span>
      </button>

      <button class="home-sidebar__item home-sidebar__create" @click="createFolder">
        <span class="home-sidebar__icon"><AddCircleOutline /></span>
        <span>创建文件夹</span>
      </button>
    </nav>

    <div class="home-sidebar__footer">
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

.home-sidebar__footer {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin: 0 16px; padding: 12px 0 15px; border-top: 1px solid #e5eaf1;
}
.dark .home-sidebar__footer { border-top-color: rgba(255, 255, 255, 0.08); }
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
</style>
