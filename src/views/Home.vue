<script setup>
import { computed, h, onMounted, onBeforeUnmount, ref } from 'vue'
import { warmProjectMedia } from '../stores/mediaWarmup'
import { useRouter } from 'vue-router'
import { NButton, NDropdown, NIcon, NInput, NModal, useDialog } from 'naive-ui'
import {
  CubeOutline,
  EllipsisHorizontalOutline,
  FolderOutline,
  GridOutline,
  HeartOutline,
  RefreshOutline,
  TrashOutline
} from '@vicons/ionicons5'
import {
  projects,
  activeProjects,
  trashedProjects,
  initProjectsStore,
  createProject,
  deleteProject,
  renameProject,
  restoreProject,
  permanentlyDeleteProject,
  emptyProjectTrash
} from '../stores/projects'
import { useModelStore } from '../stores/pinia'
import { useUIStore } from '../stores/ui'
import CanvasList from '../components/layout/CanvasList.vue'
import AssetLibrary from '../components/assets/AssetLibrary.vue'
import { assetRoot } from '../stores/assets'

const router = useRouter()
const dialog = useDialog()
const modelStore = useModelStore()
const uiStore = useUIStore()

const heroImages = {
  room: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=900&q=84',
  plant: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=520&q=82',
  chair: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=420&q=82',
  lamp: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=360&q=82'
}

// 首页内容区只展示真实数据。模板和素材目前没有独立数据源，因此保持空状态。
const templateItems = []
const assetItems = []
const favoriteItems = computed(() => activeProjects.value
  .filter(project => project.favorite)
  .slice(0, 4)
  .map(project => ({
    title: project.name,
    image: project.thumbnail && Number(project.cardCount) > 0 ? project.thumbnail : ''
  })))

const searchText = computed(() => uiStore.searchQuery.trim().toLowerCase())

const viewProjects = computed(() => {
  let list
  switch (uiStore.currentView) {
    case 'trash':
      list = trashedProjects.value
      break
    case 'recent':
      list = [...activeProjects.value].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 10)
      break
    case 'folder':
      // 文件夹已不再承载画布，这里保持空列表而不是落到 default（全部画布）
      list = []
      break
    case 'favorites':
      list = activeProjects.value.filter(project => project.favorite)
      break
    default:
      list = activeProjects.value
  }
  if (!searchText.value) return list
  return list.filter(project => project.name?.toLowerCase().includes(searchText.value))
})

const recentProjects = computed(() => [...activeProjects.value]
  .filter(project => !searchText.value || project.name?.toLowerCase().includes(searchText.value))
  .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  .slice(0, 4))
const recentColumnCount = computed(() => Math.min(Math.max(recentProjects.value.length + 1, 3), 5))

// 模板目前没有独立数据源，保持空态；素材库改由 AssetLibrary 组件自渲染，
// 它带自己的生命周期（扫描、懒加载缩略图），不再塞进这个通用网格。
const libraryContent = computed(() => templateItems)

const isLibraryView = computed(() => ['templates', 'assets'].includes(uiStore.currentView))
const showDashboard = computed(() => uiStore.currentView === 'all' && !searchText.value)
// 文件夹是纯目录，不提供「新建画布」入口
const canCreateCanvas = computed(() => !isLibraryView.value && !['favorites', 'folder', 'trash'].includes(uiStore.currentView))

const showRenameModal = ref(false)
const renameValue = ref('')
const renameTargetId = ref(null)

const ensureApiAndRun = (callback) => {
  if (!modelStore.currentApiKey) {
    dialog.warning({
      title: '未配置 API Key',
      content: '请先在设置中配置 API Key 才能使用画布功能。',
      positiveText: '知道了'
    })
    return
  }
  callback()
}

const createNewCanvas = () => {
  ensureApiAndRun(() => {
    const id = createProject('未命名项目')
    router.push(`/canvas/${id}`)
  })
}

const openProject = (project) => router.push(`/canvas/${project.id}`)
const browseTemplates = () => uiStore.setView('templates')
const showAllCanvases = () => {
  uiStore.setView('canvases')
  uiStore.setSearchQuery('')
}

const hasProjectPreview = project => Boolean(project.thumbnail && Number(project.cardCount) > 0)

const formatDate = (date) => {
  if (!date) return '刚刚'
  const value = new Date(date)
  const diff = Date.now() - value.getTime()
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `今天 ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  if (diff < 48 * 60 * 60 * 1000) return `昨天 ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  return `${value.getMonth() + 1}月${value.getDate()}日 ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

const projectActions = [
  { label: '重命名', key: 'rename' },
  { type: 'divider' },
  { label: '移到回收站', key: 'delete' }
]

const handleProjectAction = (key, project) => {
  if (key === 'rename') {
    renameTargetId.value = project.id
    renameValue.value = project.name
    showRenameModal.value = true
  }
  if (key === 'delete') {
    deleteProject(project.id)
  }
}

const confirmRename = () => {
  const value = renameValue.value.trim()
  if (renameTargetId.value && value) renameProject(renameTargetId.value, value)
  showRenameModal.value = false
  renameTargetId.value = null
  renameValue.value = ''
}

const handleCanvasDelete = () => {}

const handleCanvasRename = (projectId) => {
  const project = projects.value.find(item => item.id === projectId)
  if (project) handleProjectAction('rename', project)
}

const trashActions = () => [
  { label: '恢复项目', key: 'restore', icon: () => h(NIcon, null, { default: () => h(RefreshOutline) }) },
  { type: 'divider' },
  { label: '永久删除', key: 'permanent-delete', icon: () => h(NIcon, null, { default: () => h(TrashOutline) }) }
]

const handleTrashAction = (key, project) => {
  if (key === 'restore') {
    restoreProject(project.id)
    return
  }
  dialog.error({
    title: '永久删除项目',
    content: `确定永久删除项目「${project.name}」吗？删除后无法恢复。`,
    positiveText: '永久删除',
    negativeText: '取消',
    onPositiveClick: () => permanentlyDeleteProject(project.id)
  })
}

const confirmEmptyTrash = () => {
  dialog.error({
    title: '清空回收站',
    content: '确定永久删除回收站中的全部项目吗？此操作无法恢复。',
    positiveText: '清空回收站',
    negativeText: '取消',
    onPositiveClick: emptyProjectTrash
  })
}

let warmupTimer
let warmupCancelled = false
onMounted(async () => {
  await initProjectsStore()
  warmupTimer = setTimeout(async () => {
    for (const project of activeProjects.value.slice(0, 2)) {
      if (warmupCancelled) break
      await warmProjectMedia(project, () => warmupCancelled)
    }
  }, 250)
})
onBeforeUnmount(() => { warmupCancelled = true; clearTimeout(warmupTimer) })
</script>

<template>
  <div class="home-page">
    <div v-if="showDashboard" class="home-dashboard">
      <section class="home-hero">
        <div class="home-hero__copy">
          <span class="home-hero__eyebrow">LING CANVAS</span>
          <h1>在无限画布上，<br />让空间灵感自由发生</h1>
          <p>收集灵感 · 整理素材 · 构思方案 · 展现你的理想空间</p>
          <div class="home-hero__actions">
            <button class="home-primary-btn" @click="createNewCanvas">
              <span>＋</span> 新建画布
            </button>
            <button class="home-secondary-btn" @click="browseTemplates">
              <GridOutline /> 浏览模板
            </button>
          </div>
        </div>

        <div class="home-hero__collage" aria-hidden="true">
          <div class="home-hero__note">无限画布<br />连接每一个灵感 <span>↘</span></div>
          <img class="collage-room" :src="heroImages.room" alt="" />
          <img class="collage-plant" :src="heroImages.plant" alt="" />
          <img class="collage-lamp" :src="heroImages.lamp" alt="" />
          <div class="collage-plan">
            <svg viewBox="0 0 180 130" fill="none">
              <path d="M8 8h164v114H8zM50 8v51H8m42 0h52V8m0 51h70m-70 0v63m-52-63v63m0-30h52m35-33v63" stroke="#8993a3" stroke-width="2" />
              <path d="M20 20h19v27H20zm96 4h40v24h-40zM61 72h25v18H61zm54 7h40v29h-40zM19 75h21v35H19z" stroke="#b8c0cc" />
            </svg>
          </div>
          <div class="collage-swatches"><i /><i /><i /></div>
          <div class="collage-checklist">
            <span>✓ 空间规划</span><span>✓ 材质搭配</span><span>□ 软装选型</span><span>□ 方案呈现</span>
          </div>
          <img class="collage-chair" :src="heroImages.chair" alt="" />
          <div class="collage-memo">自然<br />温暖<br />有呼吸感 <b>♥</b></div>
        </div>
      </section>

      <section class="home-recent">
        <div class="home-section-heading">
          <h2>最近的画布 <span>›</span></h2>
          <button @click="showAllCanvases">查看全部</button>
        </div>

        <div class="home-project-grid" :style="{ '--home-recent-columns': recentColumnCount }">
          <article
            v-for="project in recentProjects"
            :key="project.id"
            class="home-project-card"
            @click="openProject(project)"
          >
            <img v-if="hasProjectPreview(project)" :src="project.thumbnail" :alt="project.name" />
            <div v-else class="home-project-card__empty" aria-label="此画布暂无内容">
              <GridOutline />
              <span>暂无画布内容</span>
            </div>
            <div class="home-project-card__meta">
              <div>
                <h3>{{ project.name }}</h3>
                <p>{{ formatDate(project.updatedAt || project.createdAt) }}</p>
              </div>
              <n-dropdown :options="projectActions" placement="bottom-end" @select="key => handleProjectAction(key, project)">
                <button class="home-project-menu" @click.stop><EllipsisHorizontalOutline /></button>
              </n-dropdown>
            </div>
          </article>

          <button class="home-new-card" @click="createNewCanvas">
            <span>＋</span>
            <strong>新建画布</strong>
            <small>在无限画布上开始创作</small>
          </button>
        </div>
      </section>

      <section class="home-explore-grid">
        <button class="home-explore-card" @click="uiStore.setView('templates')">
          <div class="home-explore-card__heading">
            <span class="explore-icon explore-icon--blue"><GridOutline /></span>
            <div><strong>模板中心 ›</strong><small>从专业模板开始，快速搭建你的创意空间</small></div>
          </div>
          <div class="home-explore-card__items">
            <figure v-for="item in templateItems" :key="item.title"><img :src="item.image" :alt="item.title" /><figcaption>{{ item.title }}</figcaption></figure>
            <div v-if="!templateItems.length" class="home-explore-card__empty">暂无模板</div>
          </div>
        </button>

        <button class="home-explore-card" @click="uiStore.setView('favorites')">
          <div class="home-explore-card__heading">
            <span class="explore-icon explore-icon--rose"><HeartOutline /></span>
            <div><strong>灵感收藏 ›</strong><small>收藏你喜欢的图片、材质、家具与灵感</small></div>
          </div>
          <div class="home-explore-card__items">
            <figure v-for="item in favoriteItems" :key="item.title" class="home-explore-card__image-only">
              <img v-if="item.image" :src="item.image" :alt="item.title" />
              <div v-else class="home-explore-card__item-empty"><HeartOutline /></div>
              <figcaption>{{ item.title }}</figcaption>
            </figure>
            <div v-if="!favoriteItems.length" class="home-explore-card__empty">暂无收藏</div>
          </div>
        </button>

        <button class="home-explore-card" @click="uiStore.setView('assets')">
          <div class="home-explore-card__heading">
            <span class="explore-icon explore-icon--indigo"><CubeOutline /></span>
            <div><strong>素材库 ›</strong><small>管理你的图片、材质、家具等设计素材</small></div>
          </div>
          <div class="home-explore-card__items">
            <figure v-for="item in assetItems" :key="item.title"><img :src="item.image" :alt="item.title" /><figcaption>{{ item.title }}</figcaption></figure>
            <div v-if="!assetItems.length" class="home-explore-card__empty">浏览本地素材库</div>
          </div>
        </button>
      </section>

      <footer class="home-signature"><span>☆</span><p>让灵感，成就更好的空间<small>Ling Canvas</small></p><em>Good Spaces<br />Better Lives</em></footer>
    </div>

    <div
      v-else
      class="home-library-page"
      :class="{ 'home-library-page--wide': uiStore.currentView === 'assets' }"
    >
      <header class="home-library-header">
        <div>
          <span class="home-hero__eyebrow">LING CANVAS</span>
          <h1>{{ searchText ? `搜索“${uiStore.searchQuery}”` : uiStore.viewTitle }}</h1>
          <p v-if="uiStore.currentView === 'templates'">从专业模板开始，快速搭建你的创意空间。</p>
          <p v-else-if="uiStore.currentView === 'favorites'">集中浏览和整理你收藏的空间灵感。</p>
          <p v-else-if="uiStore.currentView === 'assets'">浏览 {{ assetRoot || '本地素材库' }} · 只读，不会改动你的文件</p>
          <p v-else-if="uiStore.currentView === 'trash'">删除的画布可以在这里恢复。</p>
          <p v-else-if="uiStore.currentView === 'folder'">文件夹目前是空的，可以随时重命名或删除。</p>
          <p v-else>管理此空间下的画布项目。</p>
        </div>
        <button v-if="uiStore.currentView === 'trash' && trashedProjects.length" class="home-danger-btn" @click="confirmEmptyTrash">清空回收站</button>
        <button v-else-if="canCreateCanvas" class="home-primary-btn" @click="createNewCanvas"><span>＋</span> 新建画布</button>
      </header>

      <AssetLibrary v-if="uiStore.currentView === 'assets'" />

      <div v-else-if="isLibraryView && libraryContent.length" class="home-library-grid">
        <button v-for="item in libraryContent" :key="item.title" class="home-library-card" @click="uiStore.currentView === 'templates' ? createNewCanvas() : null">
          <img :src="item.image" :alt="item.title" />
          <div><strong>{{ item.title }}</strong><span>查看内容 ›</span></div>
        </button>
      </div>

      <div v-else-if="isLibraryView" class="home-empty-state">
        <GridOutline v-if="uiStore.currentView === 'templates'" />
        <CubeOutline v-else />
        <strong>{{ uiStore.currentView === 'templates' ? '暂无模板' : '暂无素材' }}</strong>
        <span>这里会展示你实际添加的内容</span>
      </div>

      <div v-else-if="uiStore.currentView === 'trash'" class="home-trash-grid">
        <article v-for="project in viewProjects" :key="project.id" class="home-project-card home-project-card--trash">
          <img v-if="hasProjectPreview(project)" :src="project.thumbnail" :alt="project.name" />
          <div v-else class="home-project-card__empty" aria-label="此画布暂无内容"><GridOutline /><span>暂无画布内容</span></div>
          <div class="home-project-card__meta">
            <div><h3>{{ project.name }}</h3><p>删除于 {{ formatDate(project.deletedAt) }}</p></div>
            <n-dropdown :options="trashActions()" placement="bottom-end" @select="key => handleTrashAction(key, project)">
              <button class="home-project-menu" @click.stop><EllipsisHorizontalOutline /></button>
            </n-dropdown>
          </div>
        </article>
        <div v-if="!viewProjects.length" class="home-empty-state"><TrashOutline /><strong>回收站是空的</strong><span>删除的画布会出现在这里</span></div>
      </div>

      <div v-else-if="uiStore.currentView === 'folder'" class="home-empty-state">
        <FolderOutline />
        <strong>文件夹是空的</strong>
        <span>这里暂时还没有内容</span>
      </div>

      <CanvasList
        v-else
        :projects="viewProjects"
        @delete="handleCanvasDelete"
        @rename="handleCanvasRename"
      />
    </div>

    <n-modal v-model:show="showRenameModal" preset="dialog" title="重命名项目">
      <n-input v-model:value="renameValue" placeholder="请输入项目名称" @keyup.enter="confirmRename" />
      <template #action>
        <n-button @click="showRenameModal = false">取消</n-button>
        <n-button type="primary" @click="confirmRename">确定</n-button>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.home-page { height: 100%; min-height: 100%; overflow-y: auto; color: #172033; background: #fff; }
.dark .home-page { color: #f1f5f9; background: #171717; }
.home-dashboard {
  width: 100%; height: 100%; min-width: 800px; min-height: 100%; max-width: 1800px;
  display: flex; flex-direction: column; margin: 0 auto; padding: 10px clamp(22px, 2vw, 36px) 8px;
}

.home-hero {
  position: relative; min-height: 245px; display: grid; grid-template-columns: 38% 62%; overflow: hidden;
  border: 1px solid #eef2f8; border-radius: 14px;
  background: radial-gradient(circle at 78% 40%, rgba(211, 228, 253, 0.82), transparent 42%), linear-gradient(122deg, #fff 10%, #f5f9ff 100%);
  box-shadow: 0 8px 28px rgba(39, 65, 105, 0.06);
}
.dark .home-hero { border-color: #2b2b2b; background: radial-gradient(circle at 78% 40%, rgba(39, 76, 126, 0.35), transparent 42%), #1d1d1d; }
.home-hero__copy { position: relative; z-index: 4; padding: 25px 0 20px 30px; }
.home-hero__eyebrow { display: block; color: #7c8aa0; font-size: 10px; font-weight: 750; letter-spacing: .42em; }
.home-hero h1 { margin-top: 8px; color: #131b2b; font-size: clamp(25px, 2.35vw, 35px); line-height: 1.28; font-weight: 780; letter-spacing: -.035em; }
.dark .home-hero h1 { color: #f8fafc; }
.home-hero__copy p { margin-top: 8px; color: #7c8798; font-size: 13px; }
.home-hero__actions { display: flex; gap: 10px; margin-top: 14px; }
.home-primary-btn, .home-secondary-btn, .home-danger-btn { height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 10px; padding: 0 23px; font-size: 13px; font-weight: 650; transition: all .2s ease; }
.home-primary-btn { color: #fff; background: linear-gradient(135deg, #4489f7, #397cf0); box-shadow: 0 8px 18px rgba(59, 130, 246, .22); }
.home-primary-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px rgba(59, 130, 246, .32); }
.home-secondary-btn { color: #344055; border: 1px solid #e4e9f0; background: rgba(255,255,255,.86); box-shadow: 0 5px 14px rgba(30,41,59,.07); }
.home-secondary-btn svg { width: 17px; }
.dark .home-secondary-btn { color: #d7deea; border-color: #3a3a3a; background: #252525; }
.home-danger-btn { color: #ef4444; border: 1px solid #fecaca; background: #fff; }

.home-hero__collage { position: relative; min-width: 0; }
.home-hero__collage img, .collage-plan, .collage-checklist, .collage-memo { position: absolute; object-fit: cover; background: #fff; box-shadow: 0 9px 20px rgba(47, 65, 91, .17); }
.collage-room { z-index: 3; left: 25%; top: 52px; width: 24%; height: 128px; transform: rotate(4deg); border: 7px solid #fff; border-radius: 6px; }
.collage-plant { z-index: 4; left: 58%; top: 16px; width: 15%; height: 108px; transform: rotate(-6deg); border: 6px solid #fff; border-radius: 5px; }
.collage-lamp { z-index: 5; left: 48%; top: 8px; width: 10%; height: 71px; transform: rotate(7deg); border: 5px solid #fff; border-radius: 5px; }
.collage-chair { z-index: 5; right: 6%; bottom: 17px; width: 14%; height: 112px; transform: rotate(4deg); border: 6px solid #fff; border-radius: 5px; }
.collage-plan { z-index: 6; left: 48%; top: 90px; width: 23%; height: 130px; padding: 8px; transform: rotate(3deg); border-radius: 4px; }
.collage-plan svg { width: 100%; height: 100%; }
.collage-swatches { position: absolute; z-index: 5; left: 68%; bottom: 26px; display: flex; transform: rotate(7deg); }
.collage-swatches i { width: 35px; height: 104px; display: block; box-shadow: 0 5px 12px rgba(0,0,0,.12); }
.collage-swatches i:nth-child(1) { background: #97846e; }.collage-swatches i:nth-child(2) { background: #e7ded0; }.collage-swatches i:nth-child(3) { background: #74766c; }
.collage-checklist { z-index: 7; right: 1.8%; top: 42px; width: 15%; padding: 12px 10px; display: grid; gap: 7px; color: #71809a; font-size: 10px; line-height: 1; transform: rotate(-4deg); border-radius: 5px; }
.collage-checklist span:nth-child(-n+2) { color: #4b86df; }
.collage-memo { z-index: 6; left: 13%; bottom: 11px; padding: 14px 20px; color: #586276; font: 12px/1.6 'Segoe Print', cursive; transform: rotate(-6deg); background: #fff8e8; }
.collage-memo b { color: #e99a8e; }
.home-hero__note { position: absolute; z-index: 8; left: 5%; top: 38px; color: #397fe8; font: 13px/1.7 'Segoe Print', cursive; transform: rotate(-5deg); }
.home-hero__note span { display: block; margin-left: 55px; font-size: 30px; }

.home-recent { flex: 0 0 auto; margin-top: 16px; }
.home-section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.home-section-heading h2 { font-size: 17px; font-weight: 760; }.home-section-heading h2 span { margin-left: 5px; color: #9ba8b9; font-size: 24px; font-weight: 400; }
.home-section-heading button { color: #4d8eea; font-size: 12px; }
.home-project-grid { display: grid; grid-template-columns: repeat(var(--home-recent-columns, 5), minmax(0, 1fr)); gap: 12px; }
.home-project-card { min-width: 0; overflow: hidden; display: flex; flex-direction: column; border: 1px solid #edf1f6; border-radius: 10px; background: #fff; box-shadow: 0 5px 13px rgba(30, 52, 82, .08); cursor: pointer; transition: transform .2s ease, box-shadow .2s ease; }
.home-project-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(30, 52, 82, .14); }
.home-project-card > img { width: 100%; height: clamp(142px, 18vh, 178px); display: block; flex: 1 1 auto; object-fit: cover; }
.home-project-card__empty { width: 100%; height: clamp(142px, 18vh, 178px); display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #9ca8b8; background: linear-gradient(145deg, #f8fafc, #eef2f7); font-size: 11px; }
.home-project-card__empty svg { width: 34px; color: #bdc7d4; }
.home-project-card__meta { min-height: 57px; display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px 8px 10px; }
.home-project-card__meta > div { min-width: 0; }
.home-project-card h3 { overflow: hidden; color: #273247; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.home-project-card p { margin-top: 2px; color: #9ba6b6; font-size: 10px; }
.home-project-menu { width: 26px; height: 26px; display: grid; flex: 0 0 26px; place-items: center; border-radius: 7px; color: #758297; }
.home-project-menu:hover { background: #f1f5f9; }.home-project-menu svg { width: 17px; }
.home-new-card { min-height: clamp(199px, 25vh, 235px); display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #ced9e8; border-radius: 10px; color: #77859a; transition: all .2s ease; }
.home-new-card:hover { border-color: #7eb0f5; color: #3b82f6; background: #f8fbff; }
.home-new-card > span { width: 41px; height: 41px; display: grid; place-items: center; margin-bottom: 7px; border-radius: 50%; color: #4d8ff1; background: #e8f1ff; font-size: 26px; font-weight: 300; }
.home-new-card strong { font-size: 13px; }.home-new-card small { margin-top: 3px; color: #b0b9c7; font-size: 10px; }

.home-explore-grid { display: grid; flex: 1 1 auto; grid-template-columns: 1.18fr 1.1fr 1.1fr; grid-auto-rows: minmax(clamp(210px, 25vh, 260px), 1fr); gap: 13px; margin-top: 14px; }
.home-explore-card { min-width: 0; height: 100%; display: flex; flex-direction: column; padding: 17px 16px 14px; border: 1px solid #e7ecf3; border-radius: 12px; text-align: left; background: #fff; transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease; }
.home-explore-card:hover { transform: translateY(-2px); border-color: #ccd9ec; box-shadow: 0 9px 22px rgba(41,61,88,.08); }
.home-explore-card__heading { display: flex; align-items: center; gap: 10px; }
.home-explore-card__heading > div { min-width: 0; }.home-explore-card__heading strong { display: block; color: #273247; font-size: 14px; }.home-explore-card__heading small { display: block; overflow: hidden; margin-top: 1px; color: #9aa5b5; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.explore-icon { width: 34px; height: 34px; display: grid; flex: 0 0 34px; place-items: center; border-radius: 50%; }.explore-icon svg { width: 18px; }.explore-icon--blue { color: #4b8ef3; background: #e8f2ff; }.explore-icon--rose { color: #ef7f86; background: #ffebed; }.explore-icon--indigo { color: #5284ed; background: #e9f0ff; }
.home-explore-card__items { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 7px; margin-top: 13px; flex: 1 1 auto; align-items: stretch; }
.home-explore-card__empty { grid-column: 1 / -1; min-height: 105px; display: grid; place-items: center; border: 1px dashed #d9e1ec; border-radius: 9px; color: #a2adbb; background: #fafbfd; font-size: 11px; }
.home-explore-card__item-empty { min-height: clamp(105px, 13vh, 137px); display: grid; flex: 1 1 auto; place-items: center; border-radius: 8px; color: #b1bdcc; background: linear-gradient(145deg, #f7f9fc, #edf1f6); }
.home-explore-card__item-empty svg { width: 25px; }
.home-explore-card figure { position: relative; min-width: 0; display: flex; flex-direction: column; }.home-explore-card figure img { width: 100%; height: clamp(105px, 13vh, 137px); display: block; flex: 1 1 auto; object-fit: cover; border-radius: 8px; }.home-explore-card figcaption { overflow: hidden; margin-top: 6px; color: #465167; font-size: 10px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }.home-explore-card__image-only img { height: clamp(128px, 16vh, 164px) !important; }.home-explore-card__more { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 8px; color: #fff; font-size: 12px; background: rgba(50,45,40,.54); }
.home-signature { display: flex; flex: 0 0 auto; align-items: center; margin-top: 10px; color: #8491a5; }.home-signature > span { width: 32px; height: 32px; display: grid; place-items: center; margin-right: 9px; border-radius: 50%; color: #4b8ef3; background: #eaf2ff; }.home-signature p { font-size: 11px; }.home-signature p small { display: block; color: #acb5c2; }.home-signature em { margin-left: auto; color: #a2adbd; font: 12px/1.2 'Segoe Print', cursive; transform: rotate(-8deg); }

.home-library-page { max-width: 1240px; margin: 0 auto; padding: 34px 30px 60px; }
/* 素材库要铺满可用宽度：1240 是给固定 4 列的模板卡片定的，用在几百张图的
   网格上会让全屏下面空掉一大片。仍然留一个上限，避免超宽屏上无意义地拉伸。 */
.home-library-page--wide { max-width: 1760px; }
.home-library-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 26px; }.home-library-header h1 { margin-top: 7px; color: #172033; font-size: 29px; font-weight: 780; }.home-library-header p { margin-top: 5px; color: #8c98aa; font-size: 13px; }
.home-library-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 18px; }.home-library-card { overflow: hidden; border: 1px solid #e8edf4; border-radius: 13px; text-align: left; background: #fff; box-shadow: 0 5px 15px rgba(30,52,82,.06); transition: all .2s ease; }.home-library-card:hover { transform: translateY(-3px); box-shadow: 0 12px 27px rgba(30,52,82,.13); }.home-library-card img { width: 100%; height: 175px; object-fit: cover; }.home-library-card div { display: flex; justify-content: space-between; padding: 13px 14px; }.home-library-card strong { color: #344055; font-size: 14px; }.home-library-card span { color: #6798df; font-size: 11px; }
.home-trash-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 18px; }.home-project-card--trash > img { height: 155px; filter: saturate(.65); }.home-empty-state { grid-column: 1/-1; min-height: 330px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #a4afbd; }.home-empty-state svg { width: 50px; margin-bottom: 12px; }.home-empty-state strong { color: #7c8797; }.home-empty-state span { margin-top: 4px; font-size: 12px; }

.dark .home-project-card, .dark .home-explore-card, .dark .home-library-card { border-color: #2d2d2d; background: #1e1e1e; }.dark .home-project-card h3, .dark .home-explore-card__heading strong, .dark .home-explore-card figcaption, .dark .home-library-header h1, .dark .home-library-card strong { color: #e8edf5; }.dark .home-project-card__empty, .dark .home-explore-card__item-empty { color: #707b8b; background: linear-gradient(145deg, #242424, #1b1b1b); }.dark .home-explore-card__empty { border-color: #363d47; color: #707b8b; background: #1a1a1a; }.dark .home-new-card { border-color: #3b4452; }.dark .home-new-card:hover { background: #1a2637; }.dark .home-project-menu:hover { background: #303030; }

@media (max-width: 1180px) {
  .home-dashboard { padding-inline: 16px; }.home-project-grid { grid-template-columns: repeat(min(var(--home-recent-columns, 4), 4),minmax(0,1fr)); }.home-project-grid > :nth-child(4) { display: none; }.home-explore-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.home-explore-grid > :last-child { display: none; }.home-hero { grid-template-columns: 43% 57%; }.home-hero__note { display: none; }
}

/* Neutral controls; illustrations and application logo keep their original colors. */
.home-hero, .dark .home-hero { background: var(--bg-secondary); border-color: var(--border-color); }
.home-primary-btn { background: var(--accent-color); color: var(--accent-on); box-shadow: 0 8px 18px #00000012; }
.home-section-head > button { color: var(--text-secondary); }
.home-new-card, .dark .home-new-card { border-color: var(--border-color); color: var(--text-primary); }
.home-new-card:hover, .dark .home-new-card:hover { border-color: var(--text-secondary); color: var(--text-primary); background: var(--bg-tertiary); }
.home-new-card > span { color: var(--text-primary); background: var(--bg-tertiary); }
</style>
