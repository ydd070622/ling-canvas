<template>
  <!-- Canvas page | 画布页面 -->
  <div class="canvas-page h-full w-full flex flex-col bg-[var(--bg-primary)]">
    <!-- Main canvas area | 主画布区域 -->
    <div class="flex-1 relative overflow-hidden" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
      <!-- Vue Flow canvas | Vue Flow 画布 -->
      <VueFlow
        :key="flowKey"
        v-model:nodes="nodes"
        v-model:edges="edges"
        v-model:viewport="viewport"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :default-viewport="canvasViewport"
        :min-zoom="0.1"
        :max-zoom="2"
        :zoom-on-double-click="false"
        :selection-key-code="true"
        :selection-mode="'partial'"
        :pan-on-drag="[1, 2]"
        :pan-activation-key-code="'Space'"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :is-valid-connection="isValidConnection"
        :connect-on-click="false"
        @connect="onConnect"
        @connect-start="onConnectStart"
        @connect-end="onConnectEnd"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
        @dblclick="onCanvasDoubleClick"
        @selection-end="refreshSelectionOverlay"
        @node-drag-start="startBatchOperation"
        @node-drag-stop="handleNodeDragStop"
        @viewport-change="handleViewportChange"
        @edges-change="onEdgesChange"
        class="canvas-flow"
      >
        <Background v-if="showGrid" :gap="20" :size="1" />
      </VueFlow>

      <div v-if="isDragOverCanvas" class="canvas-drop-overlay">
        <div class="canvas-drop-hint">
          <span>松开鼠标，将图片放入画布</span>
        </div>
      </div>

      <!-- Multi-node selection management | 多节点框选管理 -->
      <div
        v-if="selectionOverlay"
        class="selection-group-outline"
        :style="selectionOverlay.boxStyle"
      >
        <div class="selection-action-bar" @mousedown.stop @click.stop>
          <button type="button" class="selection-action" @click="duplicateSelectedNodes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="11" rx="1.5" /><path d="M6 16H5a1 1 0 0 1-1-1V6.5A1.5 1.5 0 0 1 5.5 5H14a1 1 0 0 1 1 1v1" /></svg>
            <span>创建副本</span>
          </button>
          <button type="button" class="selection-action" @click="downloadSelectedNodes">
            <n-icon :size="16"><DownloadOutline /></n-icon>
            <span>批量下载</span>
          </button>
          <button type="button" class="selection-action" @click="groupSelectedNodes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="17" r="2.4" /><path d="M9 8.5l6 6M15 8.5l-6 6" /></svg>
            <span>打组</span>
          </button>
        </div>
      </div>

      <!-- Canvas title | 画布名称（位于标题栏下方） -->
      <div class="absolute left-4 top-2 z-10">
        <input
          v-if="isTitleEditing"
          ref="titleInput"
          v-model="titleEditValue"
          class="min-w-32 rounded-lg bg-transparent px-2 py-1 text-lg font-medium text-[var(--text-primary)] outline-none ring-1 ring-[var(--accent-color)]"
          @blur="saveInlineRename"
          @keyup.enter="saveInlineRename"
          @keyup.esc="cancelInlineRename"
        />
        <button
          v-else
          @dblclick="startInlineRename"
          class="rounded-lg px-2 py-1 text-lg font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          {{ projectName }}
        </button>
      </div>

      <!-- Left toolbar | 左侧工具栏 -->
      <aside class="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-1 px-2 py-3 bg-[var(--bg-secondary)] rounded-full border border-[var(--border-color)] shadow-lg z-10">
        <button
          @click="goBack"
          class="w-9 h-9 mx-auto flex items-center justify-center rounded-full bg-[#262626] text-white hover:bg-[#404040] transition-colors"
          title="返回项目"
        >
          <n-icon :size="20"><ChevronBackOutline /></n-icon>
        </button>
        <button
          @click="showSearchModal = true"
          class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title="搜索图片或文本"
        >
          <n-icon :size="24"><SearchOutline /></n-icon>
        </button>
        <button
          @click="showAssetHistoryModal = true"
          class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title="历史资产"
        >
          <n-icon :size="24"><TimeOutline /></n-icon>
        </button>
        <button
          @click="openAssetPicker"
          class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title="素材库"
        >
          <n-icon :size="24"><ImagesOutline /></n-icon>
        </button>
        <button
          @click="showWorkflowPanel = true"
          class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title="工作流"
        >
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="4" height="4" rx=".7" />
            <rect x="17" y="10" width="4" height="4" rx=".7" />
            <rect x="3" y="17" width="4" height="4" rx=".7" />
            <path d="M7 5h5a2 2 0 0 1 2 2v5h3M14 12v3a2 2 0 0 1-2 2H7" />
          </svg>
        </button>
        <button
          @click="handleCanvasAgent"
          class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title="智能体"
        >
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 7V4m-2.5 0h5" />
            <rect x="4.5" y="7" width="15" height="11.5" rx="2.5" />
            <path d="M4.5 10H2v4.5M19.5 10H22v4.5M9 12.5h.01m6 0h.01M9.5 18.5V21m5-2.5V21" />
          </svg>
        </button>
        <button
          @click="showApiSettings = true"
          class="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors"
          title="设置"
        >
          <n-icon :size="24"><SettingsOutline /></n-icon>
        </button>
      </aside>

      <!-- Node menu popup | 节点菜单弹窗 -->
      <div 
        v-if="showNodeMenu"
        :style="{ left: `${nodeMenuPosition.x}px`, top: `${nodeMenuPosition.y}px` }"
        class="node-menu absolute z-20"
      >
        <div class="node-menu-title">添加节点</div>
        <button 
          v-for="nodeType in nodeTypeOptions" 
          :key="nodeType.id"
          @click="handleNodeMenuSelect(nodeType)"
          class="node-menu-item"
        >
          <n-icon :size="18"><component :is="nodeType.icon" /></n-icon>
          <span>{{ nodeType.name }}</span>
        </button>
        <div class="node-menu-divider"></div>
        <div class="node-menu-title node-menu-resource-title">添加资源</div>
        <button
          type="button"
          @click="handleUploadResource"
          class="node-menu-item"
        >
          <n-icon :size="18"><AddOutline /></n-icon>
          <span>上传</span>
        </button>
        <button
          type="button"
          @click="handleHistoryResource"
          class="node-menu-item"
        >
          <n-icon :size="18"><TimeOutline /></n-icon>
          <span>从生成历史选择</span>
        </button>
        <button
          type="button"
          @click="openAssetPicker"
          class="node-menu-item"
        >
          <n-icon :size="18"><ImagesOutline /></n-icon>
          <span>从素材库选择</span>
        </button>
      </div>

      <!-- 拖线到空白：快速新建并自动连线 | Quick add on connect-to-pane -->
      <div
        v-if="showQuickAdd"
        class="flow-quick-add"
        :style="{ left: `${quickAddState.screenX}px`, top: `${quickAddState.screenY}px` }"
        @mousedown.stop
        @click.stop
      >
        <div class="flow-quick-add-title">{{ quickAddTitle }}</div>
        <button
          v-for="opt in quickAddOptions"
          :key="opt.type"
          class="flow-quick-add-item nodrag"
          @click="handleQuickAdd(opt)"
        >
          <span class="qa-dot" :class="`qa-${opt.type}`"></span>
          <span>{{ opt.name }}</span>
          <small>{{ opt.desc }}</small>
        </button>
      </div>

      <!-- Bottom controls | 底部控制 -->
      <div class="absolute bottom-4 left-4 flex items-center gap-1 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] p-1.5 shadow-sm z-10">
        <button @click="zoomIn" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors" title="放大">
          <n-icon :size="17"><AddOutline /></n-icon>
        </button>
        <button @click="zoomOut" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors" title="缩小">
          <n-icon :size="17"><RemoveOutline /></n-icon>
        </button>
        <button @click="fitView({ padding: 0.2 })" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors" title="显示全部画布内容">
          <n-icon :size="17"><ScanOutline /></n-icon>
        </button>
        <button @click="showShortcutModal = true" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors" title="快捷键设置">
          <svg viewBox="0 0 24 24" class="h-[17px] w-[17px]" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <path d="M6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M6.5 13h.01M9.5 13h.01M12.5 13h.01M15.5 13h.01M8 16h8" />
          </svg>
        </button>
        <button @click="toggleTheme" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors" title="切换主题">
          <n-icon :size="17"><SunnyOutline v-if="isDark" /><MoonOutline v-else /></n-icon>
        </button>
      </div>
    </div>

    <!-- API Settings Modal | API 设置弹窗 -->
    <ApiSettings v-model:show="showApiSettings" />

    <!-- Delete Confirm Modal | 删除确认弹窗 -->
    <n-modal v-model:show="showDeleteModal" preset="dialog" title="删除项目" type="warning">
      <p>确定要删除项目「{{ projectName }}」吗？此操作不可恢复。</p>
      <template #action>
        <n-button @click="showDeleteModal = false">取消</n-button>
        <n-button type="error" @click="confirmDelete">删除</n-button>
      </template>
    </n-modal>

    <!-- Download Modal | 下载弹窗 -->
    <DownloadModal v-model:show="showDownloadModal" />

    <!-- Workflow Panel | 工作流面板 -->
    <WorkflowPanel v-model:show="showWorkflowPanel" @add-workflow="handleAddWorkflow" />

    <!-- Canvas search | 画布搜索 -->
    <n-modal v-model:show="showSearchModal" preset="card" :closable="false" :mask-closable="true" class="canvas-search-modal">
      <div class="canvas-search-panel">
        <div class="canvas-search-bar">
          <n-icon :size="19"><SearchOutline /></n-icon>
          <input v-model="searchQuery" autofocus placeholder="搜索画布中的图片或文本" />
          <button type="button" @click="showSearchModal = false" title="关闭">×</button>
        </div>
        <div class="canvas-search-tabs">
          <button :class="{ active: searchScope === 'all' }" @click="searchScope = 'all'">全部</button>
          <button :class="{ active: searchScope === 'image' }" @click="searchScope = 'image'">图片</button>
          <button :class="{ active: searchScope === 'text' }" @click="searchScope = 'text'">文本</button>
        </div>
      <div class="search-results">
        <template v-if="matchedNodes.length">
          <section v-if="matchedNodes.length">
            <h4>画布节点</h4>
            <button v-for="node in matchedNodes" :key="node.id" class="search-result-item" @click="focusSearchNode(node)">
              <span>{{ node.data?.label || node.type }}</span>
              <small>{{ getNodeTypeLabel(node.type) }}</small>
            </button>
          </section>
        </template>
        <div v-else class="search-empty">没有找到相关图片或文本</div>
      </div>
      </div>
    </n-modal>

    <!-- Keyboard shortcuts | 快捷键设置 -->
    <n-modal v-model:show="showShortcutModal" preset="card" :closable="false" :mask-closable="true" class="shortcut-modal">
      <div class="shortcut-panel">
        <div class="shortcut-header">
          <div>
            <h3>快捷键设置</h3>
            <p>使用快捷键，更高效地操作画布</p>
          </div>
          <button type="button" @click="showShortcutModal = false" title="关闭">×</button>
        </div>
        <div class="shortcut-grid">
          <section>
            <h4>创作</h4>
            <div class="shortcut-row"><span>添加节点</span><span>双击空白处</span></div>
            <div class="shortcut-row"><span>移动节点</span><span>拖动节点</span></div>
          </section>
          <section>
            <h4>缩放</h4>
            <div class="shortcut-row"><span>放大</span><kbd>Ctrl</kbd><i>+</i><kbd>+</kbd></div>
            <div class="shortcut-row"><span>缩小</span><kbd>Ctrl</kbd><i>+</i><kbd>−</kbd></div>
            <div class="shortcut-row"><span>适应画布</span><kbd>Ctrl</kbd><i>+</i><kbd>0</kbd></div>
          </section>
          <section>
            <h4>移动画布</h4>
            <div class="shortcut-row"><span>平移画布</span><kbd>Space</kbd><i>+</i><span>拖动</span></div>
            <div class="shortcut-row"><span>滚轮缩放</span><span>滚动鼠标</span></div>
          </section>
          <section>
            <h4>其他</h4>
            <div class="shortcut-row"><span>撤销</span><kbd>Ctrl</kbd><i>+</i><kbd>Z</kbd></div>
            <div class="shortcut-row"><span>重做</span><kbd>Ctrl</kbd><i>+</i><kbd>Shift</kbd><i>+</i><kbd>Z</kbd></div>
            <div class="shortcut-row"><span>删除</span><kbd>⌫</kbd></div>
          </section>
        </div>
      </div>
    </n-modal>

    <!-- Asset history | 历史资产 -->
    <n-modal v-model:show="showAssetHistoryModal" preset="card" :closable="false" :mask-closable="true" class="canvas-history-modal">
      <div class="canvas-history-panel">
        <div class="history-panel-header">
          <div class="history-tabs">
            <button :class="{ active: historyTab === 'image' }" @click="historyTab = 'image'">图片历史</button>
            <button :class="{ active: historyTab === 'video' }" @click="historyTab = 'video'">视频历史</button>
            <button :class="{ active: historyTab === 'audio' }" @click="historyTab = 'audio'">音频历史</button>
            <button :class="{ active: historyTab === 'world' }" @click="historyTab = 'world'">3D世界</button>
          </div>
          <div class="history-panel-actions">
            <button type="button" class="history-batch" :class="{ active: isHistoryBatching }" @click="toggleHistoryBatching">{{ isHistoryBatching ? '退出批量' : '批量操作' }}</button>
            <button type="button" class="history-close" @click="showAssetHistoryModal = false" title="关闭">×</button>
          </div>
        </div>
        <div class="history-panel-content">
          <template v-if="historyTab === 'image'">
            <div v-if="isHistoryBatching" class="history-batch-toolbar">
              <span>点击图片可选择或取消；支持下载与删除。</span>
              <div class="history-batch-actions">
                <b>已选 {{ selectedHistoryIds.length }} 项</b>
                <button @click="selectAllHistoryAssets">全选当前列表</button>
                <button @click="clearHistorySelection">清空已选</button>
                <button class="primary" :disabled="!selectedHistoryIds.length" @click="downloadSelectedHistoryAssets">下载</button>
                <button class="danger" :disabled="!selectedHistoryIds.length" @click="deleteSelectedHistoryAssets">删除</button>
              </div>
            </div>
            <label class="history-date">
              <input v-if="isHistoryBatching" type="checkbox" :checked="isAllHistorySelected" @change="toggleAllHistoryAssets" />
              {{ historyDate }}
            </label>
            <div v-if="historyImageAssets.length" class="history-image-grid">
              <button v-for="asset in historyImageAssets" :key="asset.id" class="history-image-card" :class="{ selected: selectedHistoryIds.includes(asset.id) }" @click="handleHistoryAssetClick(asset)">
                <img :src="asset.data.url" :alt="asset.data?.label || '生成图片'" />
                <span v-if="isHistoryBatching" class="history-select-mark">✓</span>
              </button>
            </div>
            <div v-else class="history-empty">暂无生成图片记录</div>
          </template>
          <div v-else-if="historyTab === 'video'" class="history-empty">暂无生成视频记录</div>
          <div v-else-if="historyTab === 'audio'" class="history-empty">暂无生成音频记录</div>
          <div v-else class="history-empty">暂无 3D 世界记录</div>
        </div>
      </div>
    </n-modal>

    <!-- 从本地素材库选图 | Pick from the local asset library -->
    <AssetPickerModal v-model:show="showAssetPicker" @select="handleAssetPick" />
  </div>
</template>

<script setup>
/**
 * Canvas view component | 画布视图组件
 * Main infinite canvas with Vue Flow integration
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick, markRaw } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { NIcon, NSwitch, NMessageProvider, NSpin, NModal, NInput, NButton } from 'naive-ui'
import { 
  ChevronBackOutline,
  SettingsOutline,
  SearchOutline,
  AddOutline,
  ImageOutline,
  ImagesOutline,
  SendOutline,
  RefreshOutline,
  TextOutline,
  VideocamOutline,
  ColorPaletteOutline,
  BookmarkOutline,
  ArrowUndoOutline,
  ArrowRedoOutline,
  RemoveOutline,
  ScanOutline,
  DownloadOutline,
  SunnyOutline,
  MoonOutline,
  AppsOutline,
  TimeOutline,
  VolumeMediumOutline,
  DocumentTextOutline,
  SparklesOutline
} from '@vicons/ionicons5'
import { nodes, edges, pendingReferenceImages, addNode, addNodes, addEdge, addEdges, updateNode, updateNodeMeta, removeNode, removeEdge, normalizeEdgeOrders, loadProject, saveProject, clearCanvas, canvasViewport, updateViewport, undo, redo, canUndo, canRedo, manualSaveHistory, startBatchOperation, endBatchOperation, hydrateSingleAssetNode, inEdges, renumberNodeRefs, propagateStale, setNodeMedia, cutEdge, editNode } from '../stores/canvas'
import { useChat, useWorkflowOrchestrator } from '../hooks'
import { useModelStore } from '../stores/pinia'
import { projects, initProjectsStore, renameProject, deleteProject } from '../stores/projects'
import { isContentNodeType, validateCanvasConnection, findModeAccepting, INPUT_HANDLE, OUTPUT_HANDLE, NODE_MODES, CONTENT_NODE_TYPES, PORT_CLICK_EVENT } from '../config/nodeRegistry'

// Window close handler for saving | 窗口关闭处理函数（用于保存）
let handleBeforeUnload = null

// API Settings component | API 设置组件
import ApiSettings from '../components/ApiSettings.vue'
import DownloadModal from '../components/DownloadModal.vue'
import WorkflowPanel from '../components/WorkflowPanel.vue'
import { isDark, toggleTheme } from '../stores/theme'
import { openExternal } from '@/utils'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'

// API Config state | API 配置状态
const modelStore = useModelStore()
const isApiConfigured = computed(() => !!modelStore.currentApiKey)

// Chat templates | 问答模板
const CHAT_TEMPLATES = {
  imagePrompt: {
    name: '生图提示词',
    systemPrompt: '你是一个专业的AI绘画提示词专家。将用户输入的内容美化成高质量的生图提示词，包含风格、光线、構图、细节等要素。直接返回提示词，不要其他解释。',
    model: 'gpt-4o-mini'
  },
  videoPrompt: {
    name: '视频提示词',
    systemPrompt: '你是一个专业的AI视频提示词专家。将用户输入的内容美化成高质量的视频生成提示词，包含运动、场景、镜头等要素。直接返回提示词，不要其他解释。',
    model: 'gpt-4o-mini'
  }
}

// Chat hook with image prompt template | 问答 hook
const { send: sendChat } = useChat({
  systemPrompt: CHAT_TEMPLATES.imagePrompt.systemPrompt,
  model: CHAT_TEMPLATES.imagePrompt.model
})

// Workflow orchestrator hook | 工作流编排 hook
const {
  analyzeIntent,
  executeWorkflow,
  WORKFLOW_TYPES
} = useWorkflowOrchestrator()

// Custom node components | 自定义节点组件
import VideoNode from '../components/nodes/VideoNode.vue'
import GroupNode from '../components/nodes/GroupNode.vue'
import SimpleTextNode from '../components/nodes/SimpleTextNode.vue'
import SimpleImageNode from '../components/nodes/SimpleImageNode.vue'
import FlowEdge from '../components/edges/FlowEdge.vue'
import AssetPickerModal from '../components/canvas/AssetPickerModal.vue'

const router = useRouter()
const route = useRoute()

// Vue Flow instance | Vue Flow 实例
const { viewport, zoomIn, zoomOut, fitView, updateNodeInternals, screenToFlowCoordinate } = useVueFlow()

// Register custom node types | 注册自定义节点类型
const nodeTypes = {
  text: markRaw(SimpleTextNode),
  video: markRaw(VideoNode),
  image: markRaw(SimpleImageNode),
  group: markRaw(GroupNode)
}

// Register custom edge types | 注册自定义边类型
const edgeTypes = {
  flowEdge: markRaw(FlowEdge)
}

// UI state | UI状态
const showNodeMenu = ref(false)
const nodeMenuPosition = ref({ x: 80, y: 120 })
const chatInput = ref('')
const autoExecute = ref(false)
const homepageGenerationSettings = ref(null)
const homepageReferenceImages = ref([])
const isMobile = ref(false)
const showGrid = ref(true)
const showApiSettings = ref(false)
const isProcessing = ref(false)

// Flow key for forcing re-render on project switch | 项目切换时强制重新渲染的 key
const flowKey = ref(Date.now())

// Modal state | 弹窗状态
const showDeleteModal = ref(false)
const showDownloadModal = ref(false)
const showWorkflowPanel = ref(false)
const showSearchModal = ref(false)
const showShortcutModal = ref(false)
const showAssetHistoryModal = ref(false)
const searchQuery = ref('')
const searchScope = ref('all')
const isLayoutMenuOpen = ref(false)
const historyTab = ref('image')
const isHistoryBatching = ref(false)
const selectedHistoryIds = ref([])
const isTitleEditing = ref(false)
const titleEditValue = ref('')
const titleInput = ref(null)

// Check if has downloadable assets | 检查是否有可下载素材
const hasDownloadableAssets = computed(() => {
  return nodes.value.some(n => 
    (n.type === 'image' || n.type === 'video') && n.data?.url
  )
})


// Project info | 项目信息
const projectName = computed(() => {
  const project = projects.value.find(p => p.id === route.params.id)
  return project?.name || '未命名项目'
})

const nodeTypeLabels = {
  text: '文本',
  image: '图片',
  video: '视频'
}

const getNodeTypeLabel = (type) => nodeTypeLabels[type] || '节点'

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase())
const matchedNodes = computed(() => {
  const query = normalizedSearchQuery.value
  return nodes.value.filter(node => {
    if (!['image', 'text'].includes(node.type)) return false
    if (searchScope.value !== 'all' && node.type !== searchScope.value) return false
    if (!query) return true
    const searchableText = `${node.data?.label || ''} ${node.type || ''} ${getNodeTypeLabel(node.type)}`.toLowerCase()
    return searchableText.includes(query)
  }).slice(0, 8)
})
const historyImageAssets = computed(() => nodes.value.filter(node => node.type === 'image' && node.data?.url).slice().reverse())
const isAllHistorySelected = computed(() => historyImageAssets.value.length > 0 && historyImageAssets.value.every(asset => selectedHistoryIds.value.includes(asset.id)))
const historyDate = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('/', '-'))
const selectedCanvasNodes = computed(() => nodes.value.filter(node => node.selected))
const selectionBoxStyle = ref(null)
const selectionOverlay = computed(() => (
  selectedCanvasNodes.value.length >= 2 && selectionBoxStyle.value
    ? { boxStyle: selectionBoxStyle.value }
    : null
))

const refreshSelectionOverlay = () => {
  nextTick(() => {
    const canvas = document.querySelector('.canvas-flow')
    const selectedElements = canvas?.querySelectorAll?.('.vue-flow__node.selected')
    if (!canvas || !selectedElements || selectedElements.length < 2) {
      selectionBoxStyle.value = null
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    const rects = Array.from(selectedElements).map(element => element.getBoundingClientRect())
    const padding = 12
    const left = Math.min(...rects.map(rect => rect.left)) - canvasRect.left - padding
    const top = Math.min(...rects.map(rect => rect.top)) - canvasRect.top - padding
    const right = Math.max(...rects.map(rect => rect.right)) - canvasRect.left + padding
    const bottom = Math.max(...rects.map(rect => rect.bottom)) - canvasRect.top + padding

    selectionBoxStyle.value = {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`
    }
  })
}

watch(selectedCanvasNodes, refreshSelectionOverlay, { deep: true, flush: 'post' })

watch(showAssetHistoryModal, (isOpen) => {
  if (!isOpen) {
    isHistoryBatching.value = false
    selectedHistoryIds.value = []
  }
})

// Toolbar tools | 工具栏工具
const tools = [
  { id: 'text', name: '文本', icon: TextOutline, action: () => addNewNode('text') },
  { id: 'image', name: '图片', icon: ImageOutline, action: () => addNewNode('image') },
  { id: 'video', name: '视频', icon: VideocamOutline, action: () => addNewNode('video') },
  { id: 'undo', name: '撤销', icon: ArrowUndoOutline, action: () => undo(), disabled: () => !canUndo() },
  { id: 'redo', name: '重做', icon: ArrowRedoOutline, action: () => redo(), disabled: () => !canRedo() }
]

// Node type options for menu | 节点类型菜单选项
const nodeTypeOptions = [
  { id: 'text', type: 'text', name: '文本', icon: TextOutline, color: '#64748b' },
  { id: 'image', type: 'image', name: '图片', icon: ImageOutline, color: '#64748b' },
  { id: 'video', type: 'video', name: '视频', icon: VideocamOutline, color: '#64748b' },
  { id: 'audio', type: 'audio', name: '音频', icon: VolumeMediumOutline, color: '#64748b' },
  { id: 'script', type: 'script', name: '脚本', icon: DocumentTextOutline, color: '#64748b' }
]

// Input placeholder | 输入占位符
const inputPlaceholder = '你可以试着说"帮我生成一个二次元的卡通角色"'

// Quick suggestions | 快捷建议
const suggestions = [
  '像个魔法森林',
  '三只不同的小猫',
  '生成多角度分镜',
  '夏日田野环绕漫步'
]

// Add new node | 添加新节点
const addNewNode = async (type) => {
  // Calculate viewport center position | 计算视口中心位置
  const viewportCenterX = -viewport.value.x / viewport.value.zoom + (window.innerWidth / 2) / viewport.value.zoom
  const viewportCenterY = -viewport.value.y / viewport.value.zoom + (window.innerHeight / 2) / viewport.value.zoom
  
  // Add node at viewport center | 在视口中心添加节点
  const nodeId = addNode(type, { x: viewportCenterX - 100, y: viewportCenterY - 100 }, { expanded: true })
  // 同上：新建节点只负责把自己展开、选中，不动别人的展开态
  nodes.value = nodes.value.map(node => ({ ...node, selected: node.id === nodeId }))
  
  // Set highest z-index | 设置最高层级
  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))
  updateNodeMeta(nodeId, { zIndex: maxZIndex + 1 })
  
  // Force Vue Flow to recalculate node dimensions | 强制 Vue Flow 重新计算节点尺寸
  setTimeout(() => {
    updateNodeInternals(nodeId)
  }, 50)
  
  showNodeMenu.value = false
}

const handleNodeMenuSelect = (nodeType) => {
  if (nodeType.type === 'audio' || nodeType.type === 'script') {
    window.$message?.info(`${nodeType.name}节点即将支持`)
    showNodeMenu.value = false
    return
  }
  addNewNode(nodeType.type)
}

const handleUploadResource = () => {
  window.$message?.info('上传资源功能即将支持')
  showNodeMenu.value = false
}

const handleHistoryResource = () => {
  window.$message?.info('生成历史选择功能即将支持')
  showNodeMenu.value = false
}

// Canvas agent placeholder | 画布智能体预留入口
const handleCanvasAgent = () => {
  window.$message?.info('画布智能体功能正在开发中')
}

const toggleHistoryBatching = () => {
  isHistoryBatching.value = !isHistoryBatching.value
  if (!isHistoryBatching.value) selectedHistoryIds.value = []
}

const handleHistoryAssetClick = (asset) => {
  if (!isHistoryBatching.value) {
    focusSearchNode(asset)
    return
  }
  selectedHistoryIds.value = selectedHistoryIds.value.includes(asset.id)
    ? selectedHistoryIds.value.filter(id => id !== asset.id)
    : [...selectedHistoryIds.value, asset.id]
}

const selectAllHistoryAssets = () => {
  selectedHistoryIds.value = historyImageAssets.value.map(asset => asset.id)
}

const toggleAllHistoryAssets = () => {
  if (isAllHistorySelected.value) {
    clearHistorySelection()
  } else {
    selectAllHistoryAssets()
  }
}

const clearHistorySelection = () => {
  selectedHistoryIds.value = []
}

const deleteSelectedCanvasElements = () => {
  const selectedNodeIds = nodes.value.filter(node => node.selected).map(node => node.id)
  const selectedEdgeIds = edges.value.filter(edge => edge.selected).map(edge => edge.id)
  if (!selectedNodeIds.length && !selectedEdgeIds.length) return false

  startBatchOperation()
  selectedNodeIds.forEach(removeNode)
  selectedEdgeIds.forEach(removeEdge)
  endBatchOperation()
  return true
}

const duplicateSelectedNodes = () => {
  if (!selectedCanvasNodes.value.length) return

  const newIds = addNodes(selectedCanvasNodes.value.map(node => ({
    type: node.type,
    position: { x: node.position.x + 40, y: node.position.y + 40 },
    data: { ...node.data }
  })))
  nodes.value = nodes.value.map(node => ({ ...node, selected: newIds.includes(node.id) }))
  window.$message?.success(`已创建 ${newIds.length} 个节点副本`)
}

const downloadSelectedNodes = () => {
  const downloadableNodes = selectedCanvasNodes.value.filter(node => node.data?.url)
  if (!downloadableNodes.length) {
    window.$message?.warning('选中的节点中没有可下载的文件')
    return
  }

  downloadableNodes.forEach(node => openExternal(node.data.url))
  window.$message?.success(`已打开 ${downloadableNodes.length} 个下载链接`)
}

const groupSelectedNodes = () => {
  if (selectedCanvasNodes.value.length < 2) return
  const groupId = `group-${Date.now()}`
  const padding = 28
  const getNodeSize = (node) => {
    const nodeElement = document.querySelector(`.vue-flow__node[data-id="${node.id}"]`)
    const rect = nodeElement?.getBoundingClientRect()
    const zoom = viewport.value.zoom || 1
    return {
      width: node.dimensions?.width || node.width || (rect ? rect.width / zoom : 320),
      height: node.dimensions?.height || node.height || (rect ? rect.height / zoom : 240)
    }
  }

  const selected = selectedCanvasNodes.value.map(node => ({ node, size: getNodeSize(node) }))
  const minX = Math.min(...selected.map(({ node }) => node.position.x))
  const minY = Math.min(...selected.map(({ node }) => node.position.y))
  const maxX = Math.max(...selected.map(({ node, size }) => node.position.x + size.width))
  const maxY = Math.max(...selected.map(({ node, size }) => node.position.y + size.height))
  const groupPosition = { x: minX - padding, y: minY - padding }
  const groupWidth = maxX - minX + padding * 2
  const groupHeight = maxY - minY + padding * 2
  const selectedIds = new Set(selected.map(({ node }) => node.id))

  startBatchOperation()
  nodes.value = [
    ...nodes.value,
    {
      id: groupId,
      type: 'group',
      position: groupPosition,
      style: { width: `${groupWidth}px`, height: `${groupHeight}px`, zIndex: 0 },
      data: { label: `节点组（${selectedIds.size}）`, memberIds: [...selectedIds] },
      selectable: true,
      draggable: true
    }
  ]
  nodes.value = nodes.value.map(node => (
    selectedIds.has(node.id)
      ? {
          ...node,
          parentNode: groupId,
          extent: 'parent',
          position: {
            x: node.position.x - groupPosition.x,
            y: node.position.y - groupPosition.y
          },
          style: { ...(node.style || {}), zIndex: 1 },
          data: { ...node.data, groupId },
          selected: false
        }
      : node
  ))
  endBatchOperation()
  nextTick(() => {
    updateNodeInternals(groupId)
    refreshSelectionOverlay()
  })
  window.$message?.success(`已将 ${selectedIds.size} 个节点打组`)
}

const layoutSelectedNodes = (layout) => {
  const selection = [...selectedCanvasNodes.value]
  if (selection.length < 2) return

  const minX = Math.min(...selection.map(node => node.position.x))
  const minY = Math.min(...selection.map(node => node.position.y))
  const spacingX = 380
  const spacingY = 300
  const columns = Math.ceil(Math.sqrt(selection.length))
  const positions = new Map()

  selection
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .forEach((node, index) => {
      if (layout === 'horizontal') {
        positions.set(node.id, { x: minX + index * spacingX, y: minY })
      } else if (layout === 'vertical') {
        positions.set(node.id, { x: minX, y: minY + index * spacingY })
      } else {
        positions.set(node.id, {
          x: minX + (index % columns) * spacingX,
          y: minY + Math.floor(index / columns) * spacingY
        })
      }
    })

  startBatchOperation()
  nodes.value = nodes.value.map(node => (
    positions.has(node.id) ? { ...node, position: positions.get(node.id) } : node
  ))
  endBatchOperation()
  isLayoutMenuOpen.value = false
  refreshSelectionOverlay()
}

const downloadSelectedHistoryAssets = () => {
  const selectedAssets = historyImageAssets.value.filter(asset => selectedHistoryIds.value.includes(asset.id))
  selectedAssets.forEach(asset => openExternal(asset.data.url))
  window.$message?.success(`已打开 ${selectedAssets.length} 个图片下载链接`)
}

const deleteSelectedHistoryAssets = () => {
  const selectedAssets = historyImageAssets.value.filter(asset => selectedHistoryIds.value.includes(asset.id))
  if (!selectedAssets.length || !window.confirm(`确定删除选中的 ${selectedAssets.length} 张历史图片吗？对应画布节点也会一并删除。`)) return
  selectedAssets.forEach(asset => removeNode(asset.id))
  selectedHistoryIds.value = []
  window.$message?.success('已删除选中的历史图片')
}

const focusSearchNode = async (node) => {
  nodes.value = nodes.value.map(item => ({ ...item, selected: item.id === node.id }))
  showSearchModal.value = false
  showAssetHistoryModal.value = false
  await nextTick()
  fitView({ nodes: [node], padding: 0.6, duration: 280 })
}

// Handle add workflow from panel | 处理从面板添加工作流
const handleAddWorkflow = ({ workflow, options }) => {
  // Calculate viewport center position | 计算视口中心位置
  const viewportCenterX = -viewport.value.x / viewport.value.zoom + (window.innerWidth / 2) / viewport.value.zoom
  const viewportCenterY = -viewport.value.y / viewport.value.zoom + (window.innerHeight / 2) / viewport.value.zoom

  // Create nodes from workflow template | 从工作流模板创建节点
  const startPosition = { x: viewportCenterX - 300, y: viewportCenterY - 200 }
  const { nodes: newNodes, edges: newEdges } = workflow.createNodes(startPosition, options)

  // Start batch operation manually | 手动开始批量操作
  startBatchOperation()

  // Add nodes to canvas in batch | 批量将节点添加到画布
  const nodeSpecs = newNodes.map(node => ({
    type: node.type,
    position: node.position,
    data: node.data
  }))
  const nodeIds = addNodes(nodeSpecs, false)

  // Map old node IDs to new IDs | 映射旧节点ID到新ID
  const idMap = {}
  newNodes.forEach((node, index) => {
    idMap[node.id] = nodeIds[index]
  })

  // Add edges to canvas in batch | 批量将边添加到画布
  const edgeSpecs = newEdges.map(edge => ({
    source: idMap[edge.source] || edge.source,
    target: idMap[edge.target] || edge.target,
    sourceHandle: OUTPUT_HANDLE,
    targetHandle: INPUT_HANDLE,
    type: edge.type,
    data: edge.data
  }))

  // Add edges (autoBatch=false to use manual batch) | 添加边（autoBatch=false 以使用手动批量）
  addEdges(edgeSpecs, false)

  // End batch operation and save to history | 结束批量操作并保存到历史
  endBatchOperation()

  // Delay node internals update | 延迟节点内部更新
  setTimeout(() => {
    // Update node internals | 更新节点内部
    nodeIds.forEach(nodeId => {
      updateNodeInternals(nodeId)
    })
  }, 100)

  window.$message?.success(`已添加工作流: ${workflow.name}`)
}

// ===== Flow 连线系统：语义标签 + 类型校验 + 快速新建 =====
// Flow connection system: semantic labels + type validation + quick add

// 内容节点类型：只有这些会走「展开 / 连通性重算」


// 连接合法性校验 | Connection validity check
const isValidConnection = (connection) => {
  return validateCanvasConnection(connection, nodes.value, edges.value).valid
}

// 拖线到空白 / 点端口：快速新建菜单 | Quick add menu state
const showQuickAdd = ref(false)
const quickAddState = ref({
  direction: 'downstream',
  flowX: 0,
  flowY: 0,
  screenX: 0,
  screenY: 0,
  source: null,
  sourceHandle: null
})

const QUICK_ADD_DESC = {
  text: '作为提示词 / 上下文',
  image: '作为参考图或首帧',
  video: '作为参考视频'
}

/** 往上游建时，新节点是给锚点供料的，说法要反过来 */
const UPSTREAM_ADD_DESC = {
  text: '供给它当提示词 / 上下文',
  image: '供给它当底图 / 参考',
  video: '供给它当参考视频'
}

/** 新节点落在锚点哪一侧；点击端口时没有落点，就按锚点尺寸摆 */
const QUICK_ADD_GAP = 100
const QUICK_ADD_FALLBACK_WIDTH = 520

/**
 * 可新建的节点类型。
 * 下游：只列「存在能接收锚点产出的模式」的类型，选中后新节点直接落在那个模式上，
 *       避免建出来才发现连不上。
 * 上游：不筛选，全部内容节点都列（用户要的是自由度，连不上时再提示）。
 */
const buildQuickAddOptions = (anchor, direction) => {
  const upstream = direction === 'upstream'
  return CONTENT_NODE_TYPES
    .map(type => ({ type, mode: upstream ? null : findModeAccepting(type, anchor.type) }))
    .filter(item => upstream || item.mode)
    .map(item => ({
      type: item.type,
      mode: item.mode,
      name: nodeTypeLabels[item.type] || item.type,
      desc: (upstream ? UPSTREAM_ADD_DESC : QUICK_ADD_DESC)[item.type]
    }))
}

const quickAddOptions = computed(() => {
  const anchor = nodes.value.find(n => n.id === quickAddState.value.source)
  return anchor ? buildQuickAddOptions(anchor, quickAddState.value.direction) : []
})

const quickAddTitle = computed(() => (
  quickAddState.value.direction === 'upstream' ? '在上游新建节点并自动连线' : '在下游新建节点并自动连线'
))

/** 端口 id → 方向：左口(in) 往上游，右口(out) 往下游 */
const resolveDirection = handleId => (handleId === INPUT_HANDLE ? 'upstream' : 'downstream')

/** 点击端口时新节点的落点：按锚点尺寸往对应方向让开一个身位 */
const anchorSidePosition = (anchor, direction) => {
  const width = anchor.measured?.width ?? anchor.width ?? QUICK_ADD_FALLBACK_WIDTH
  const height = anchor.measured?.height ?? anchor.height ?? 240
  const y = anchor.position.y + height / 2 - 120
  return direction === 'upstream'
    ? { x: anchor.position.x - width - QUICK_ADD_GAP, y }
    : { x: anchor.position.x + width + QUICK_ADD_GAP, y }
}

const onConnectEnd = (params) => {
  // Vue Flow 1.48 的 connectEnd 直接传原生事件；兼容部分版本 { event, connection } 结构
  const event = params?.event || params
  const connection = params?.connection || null
  const mouseEvent = event?.clientX !== undefined ? event : null

  // 连接已成功建立（边数比拖动开始多）则不弹新建菜单 | Skip when a connection was created
  if (edges.value.length > (connectStartEdgeCount.value ?? edges.value.length)) return

  // 松手落在节点 / 端口上（非法连接被拒绝的场景）也不弹 | Skip when dropped on a node/handle
  const target = mouseEvent?.target
  if (target?.closest?.('.vue-flow__handle, .vue-flow__node, .flow-select-menu')) return

  // 拖线起点信息：connectStart 记录优先，其次 connection 结构
  const sourceNodeId = connection?.source || connectStartNodeId.value
  const sourceHandleId = connection?.sourceHandle || connectStartHandleId.value
  const sourceNode = nodes.value.find(n => n.id === sourceNodeId)
  if (!sourceNode || !isContentNodeType(sourceNode.type)) {
    return
  }
  // 从哪个口拖出来决定新节点建在哪一侧
  const direction = resolveDirection(sourceHandleId)
  if (!buildQuickAddOptions(sourceNode, direction).length) return

  if (!mouseEvent) return
  const canvasBounds = document.querySelector('.canvas-flow')?.getBoundingClientRect?.()
  const flowPos = screenToFlowCoordinate({ x: mouseEvent.clientX, y: mouseEvent.clientY })
  quickAddState.value = {
    direction,
    // 落点换算成新节点左上角（松手处大致落在卡片中心）
    flowX: flowPos.x - 196,
    flowY: flowPos.y - 120,
    screenX: canvasBounds ? mouseEvent.clientX - canvasBounds.left : mouseEvent.clientX,
    screenY: canvasBounds ? mouseEvent.clientY - canvasBounds.top : mouseEvent.clientY,
    source: sourceNodeId,
    sourceHandle: sourceHandleId
  }
  showQuickAdd.value = true
}

/**
 * 点端口 → 在鼠标处弹新建菜单 | Open quick add from a port click
 * 左口往上游建（新节点落在锚点左边），右口往下游建（落在右边）。
 *
 * 模板上把 Vue Flow 自带的 connect-on-click 关掉了：那是「点端口进入待连状态、
 * 再点目标完成连线」，与本菜单抢同一个手势 —— 菜单还没选完，Vue Flow 那边
 * 已经挂着半个待连边。拖拽连线不受影响。
 */
const onPortClick = (event) => {
  const { nodeId, handleId, handleType, clientX, clientY } = event.detail || {}
  const anchor = nodes.value.find(n => n.id === nodeId)
  if (!anchor || !isContentNodeType(anchor.type)) return

  const direction = resolveDirection(handleId || (handleType === 'target' ? INPUT_HANDLE : OUTPUT_HANDLE))
  if (!buildQuickAddOptions(anchor, direction).length) return

  const flowPos = anchorSidePosition(anchor, direction)
  const canvasBounds = document.querySelector('.canvas-flow')?.getBoundingClientRect?.()
  quickAddState.value = {
    direction,
    flowX: flowPos.x,
    flowY: flowPos.y,
    screenX: canvasBounds ? clientX - canvasBounds.left : clientX,
    screenY: canvasBounds ? clientY - canvasBounds.top : clientY,
    source: anchor.id,
    sourceHandle: handleId || (direction === 'upstream' ? INPUT_HANDLE : OUTPUT_HANDLE)
  }
  showQuickAdd.value = true
}

// 记录拖动开始时的源端口与边数，用于区分"连上了"还是"拖到空白" | Connect start state
const connectStartEdgeCount = ref(null)
const connectStartNodeId = ref(null)
const connectStartHandleId = ref(null)

const onConnectStart = (params) => {
  connectStartEdgeCount.value = edges.value.length
  connectStartNodeId.value = params?.nodeId || null
  connectStartHandleId.value = params?.handleId || null
  showQuickAdd.value = false
}

// 快速新建节点并自动连线 | Quick create node and auto-wire
const handleQuickAdd = (opt) => {
  const state = quickAddState.value
  const anchor = nodes.value.find(n => n.id === state.source)
  if (!anchor) {
    showQuickAdd.value = false
    return
  }
  const upstream = state.direction === 'upstream'

  // 下游：新节点落在「能接收锚点产出」的模式上。
  // 上游：新节点自己不吃上游，但锚点的模式得能收下它 —— 先按锚点当前模式试，
  //       不行就找一个能收的模式换过去（换模式要重排引用编号，和手动切换一致）。
  let anchorMode = null
  if (upstream) {
    const accepts = (NODE_MODES[anchor.type]?.[anchor.data?.mode]?.accepts?.[opt.type] || 0) > 0
    if (!accepts) {
      anchorMode = findModeAccepting(anchor.type, opt.type)
      if (!anchorMode) {
        showQuickAdd.value = false
        window.$message?.warning(`「${anchor.data?.label || anchor.type}」没有能接收${opt.name}的模式`)
        return
      }
    }
  }

  // flowX/flowY 存的已经是新节点的左上角（拖到空白时在 onConnectEnd 里换算过）
  const nodeId = addNode(opt.type, { x: state.flowX, y: state.flowY },
    { expanded: true, ...(opt.mode ? { mode: opt.mode } : {}) })
  // 只选中新节点。展开态不要在这里碰：新建节点跟原有节点的展开/收起无关，
  // 这里一旦写 expanded 就会把锚点（还有画布上所有别的节点）一起收起来。
  nodes.value = nodes.value.map(node => ({ ...node, selected: node.id === nodeId }))

  const source = upstream ? nodeId : anchor.id
  const target = upstream ? anchor.id : nodeId

  // 校验读的是节点当前模式，所以「切模式」必须发生在校验之前，否则上游那条永远判不合法
  const originalMode = anchor.data?.mode
  let switched = false
  if (anchorMode) {
    editNode(anchor.id, { mode: anchorMode })
    renumberNodeRefs(anchor.id)
    switched = true
  }
  const validation = validateCanvasConnection({ source, target }, nodes.value, edges.value)
  if (!validation.valid) {
    removeNode(nodeId)
    // 没接上就别把锚点的模式留在改过的状态
    if (switched) {
      editNode(anchor.id, { mode: originalMode })
      renumberNodeRefs(anchor.id)
    }
    showQuickAdd.value = false
    window.$message?.warning(validation.reason)
    return
  }

  // 引用顺序接着已有的排下去，别把新边插到别人前面
  const nextOrder = Math.max(0, ...inEdges(target).map(edge => Number(edge.data?.order) || 0)) + 1
  addEdge({
    source,
    target,
    sourceHandle: OUTPUT_HANDLE,
    targetHandle: INPUT_HANDLE,
    type: 'flowEdge',
    data: { order: nextOrder }
  })

  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))
  updateNodeMeta(nodeId, { zIndex: maxZIndex + 1 })
  setTimeout(() => updateNodeInternals(nodeId), 50)
  showQuickAdd.value = false
  // 上游接进来了 → 锚点及其下游该重跑
  if (upstream) propagateStale(anchor.id)
  window.$message?.success(`已创建${opt.name}节点并自动连线`)
}

// Handle connection | 处理连接
// 单一输入口：边不再分槽，顺序（data.order）就是正文里的引用编号顺序。
const onConnect = (params) => {
  const validation = validateCanvasConnection(params, nodes.value, edges.value)
  if (!validation.valid) {
    window.$message?.warning(validation.reason)
    return
  }

  const nextOrder = Math.max(0, ...inEdges(params.target).map(edge => Number(edge.data?.order) || 0)) + 1
  addEdge({
    source: params.source,
    target: params.target,
    sourceHandle: OUTPUT_HANDLE,
    targetHandle: INPUT_HANDLE,
    type: 'flowEdge',
    data: { order: nextOrder }
  })
  // 目标节点的入边变了 → 它和它的下游都该重跑
  propagateStale(params.target)
}
const onNodeClick = (event) => {
  const clickedId = event.node.id
  // 点击节点：展开并选中自己，不影响其他节点的展开状态（连线需要多节点同时展开）
  nodes.value = nodes.value.map(node => ({
    ...node,
    selected: node.id === clickedId,
    data: {
      ...node.data,
      expanded: node.id === clickedId ? true : node.data.expanded
    }
  }))
  // 展开/收缩后刷新节点几何，保证端口与边位置正确 | Refresh bounds after expand/collapse
  nextTick(() => {
    nodes.value.forEach(node => {
      if (isContentNodeType(node.type)) updateNodeInternals(node.id)
    })
  })
}

// Handle viewport change | 处理视口变化
const handleViewportChange = (newViewport) => {
  updateViewport(newViewport)
  refreshSelectionOverlay()
}

const handleNodeDragStop = () => {
  endBatchOperation()
  refreshSelectionOverlay()
}

// Handle edges change | 处理边变化
// 边被删掉之后已经查不到它的目标了，所以平时就要记下 EdgeID → 目标节点。
const edgeTargets = new Map()
watch(edges, (list) => { list.forEach(edge => edgeTargets.set(edge.id, edge.target)) }, { immediate: true })

const onEdgesChange = (changes) => {
  const removals = changes.filter(change => change.type === 'remove')
  if (!removals.length) return

  // 被删的边可能带着引用绑定：目标节点要重排编号、正文里的 token 也要同步改写
  const affected = [...new Set(removals.map(change => edgeTargets.get(change.id)).filter(Boolean))]
  nextTick(() => {
    normalizeEdgeOrders()
    affected.forEach((targetId) => {
      if (!nodes.value.some(node => node.id === targetId)) return
      renumberNodeRefs(targetId)
      propagateStale(targetId)
    })
    manualSaveHistory()
  })
}

// Handle pane click | 处理画布点击
// 只取消选中，**不再折叠所有节点** —— 收起之后端口虽然还能连，
// 但每次点空白都把所有卡片收掉会让人没法工作。收起只由卡片按钮或顶栏命令触发。
const onPaneClick = () => {
  showNodeMenu.value = false
  showQuickAdd.value = false
  if (nodes.value.some(node => node.selected)) {
    nodes.value = nodes.value.map(node => ({ ...node, selected: false }))
  }
}

const onCanvasDoubleClick = (event) => {
  // Check if double-click is inside a node | 检查双击是否在节点内部
  const clickedNode = event.target.closest('.vue-flow__node')
  if (clickedNode) {
    // Double-click inside node, don't show menu | 节点内双击，不显示菜单
    return
  }

  if (event?.target?.closest?.('.vue-flow__pane')) {
    // Group body is pointer-events: none, so its area hits the pane; skip menu there | 组内双击穿透到 pane，需按分组区域排除
    const insideGroup = nodes.value.some((node) => {
      if (node.type !== 'group') return false
      const rect = document.querySelector(`.vue-flow__node[data-id="${node.id}"]`)?.getBoundingClientRect()
      return rect
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom
    })
    if (insideGroup) return

    const canvas = event.target.closest('.vue-flow')
    const bounds = canvas?.getBoundingClientRect?.()
    if (bounds) {
      nodeMenuPosition.value = {
        x: Math.max(16, Math.min(event.clientX - bounds.left + 12, bounds.width - 220)),
        y: Math.max(16, Math.min(event.clientY - bounds.top + 12, bounds.height - 340))
      }
    }
    showNodeMenu.value = true
  }
}

// Canvas undo / redo shortcuts | 画布撤销、重做快捷键
const handleCanvasShortcut = (event) => {
  const target = event.target

  // Esc 关掉新建菜单：放在输入框判断之前，因为光标多半还在提示词框里
  if (event.key === 'Escape' && showQuickAdd.value) {
    showQuickAdd.value = false
    return
  }

  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return

  const key = event.key.toLowerCase()
  if ((key === 'backspace' || key === 'delete') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (deleteSelectedCanvasElements()) event.preventDefault()
    return
  }

  if (!(event.ctrlKey || event.metaKey) || event.altKey) return

  if (key === 'z') {
    event.preventDefault()
    if (event.shiftKey) {
      redo()
    } else {
      undo()
    }
  } else if (key === 'y') {
    event.preventDefault()
    redo()
  } else if (key === '+' || key === '=') {
    event.preventDefault()
    zoomIn()
  } else if (key === '-' || key === '_') {
    event.preventDefault()
    zoomOut()
  } else if (key === '0') {
    event.preventDefault()
    fitView({ padding: 0.2 })
  }
}

// Inline rename | 原地重命名
const startInlineRename = async () => {
  titleEditValue.value = projectName.value
  isTitleEditing.value = true
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

const saveInlineRename = () => {
  const projectId = route.params.id
  const newName = titleEditValue.value.trim()
  if (newName && newName !== projectName.value) {
    renameProject(projectId, newName)
    window.$message?.success('已重命名')
  }
  isTitleEditing.value = false
}

const cancelInlineRename = () => {
  isTitleEditing.value = false
}

// Confirm delete | 确认删除
const confirmDelete = () => {
  const projectId = route.params.id
  deleteProject(projectId)
  showDeleteModal.value = false
  window.$message?.success('项目已删除')
  router.push('/')
}

// Handle Enter key | 处理回车键
const handleEnterKey = (e) => {
  e.preventDefault()
  sendMessage()
}

// Handle AI polish | 处理 AI 润色
const handlePolish = async () => {
  const input = chatInput.value.trim()
  if (!input) return
  
  // Check API configuration | 检查 API 配置
  if (!isApiConfigured.value) {
    window.$message?.warning('请先配置 API Key')
    showApiSettings.value = true
    return
  }

  isProcessing.value = true
  const originalInput = chatInput.value

  try {
    // Call chat API to polish the prompt | 调用 AI 润色提示词
    const result = await sendChat(input, true)
    
    if (result) {
      chatInput.value = result
      window.$message?.success('提示词已润色')
    }
  } catch (err) {
    chatInput.value = originalInput
    window.$message?.error(err.message || '润色失败')
  } finally {
    isProcessing.value = false
  }
}

// Send message | 发送消息
const sendMessage = async () => {
  const input = chatInput.value.trim()
  // Allow empty prompt when reference images are pending | 带参考图时允许空提示词
  if (!input && !homepageReferenceImages.value.length) return

  // Check API configuration | 检查 API 配置
  if (!isApiConfigured.value) {
    window.$message?.warning('请先配置 API Key')
    showApiSettings.value = true
    return
  }

  isProcessing.value = true
  const content = chatInput.value
  chatInput.value = ''

  try {
    // Calculate position to avoid overlap | 计算位置避免重叠
    let maxY = 0
    if (nodes.value.length > 0) {
      maxY = Math.max(...nodes.value.map(n => n.position.y))
    }
    const baseX = 100
    const baseY = maxY + 200

    if (autoExecute.value && input) {
      // Auto-execute mode: analyze intent and execute workflow | 自动执行模式：分析意图并执行工作流
      window.$message?.info('正在分析工作流...')
      
      try {
        // Analyze user intent | 分析用户意图
        const result = await analyzeIntent(content)
        
        // Ensure we have valid workflow params | 确保有效的工作流参数
        const workflowParams = {
          workflow_type: result?.workflow_type || WORKFLOW_TYPES.TEXT_TO_IMAGE,
          image_prompt: result?.image_prompt || content,
          video_prompt: result?.video_prompt || content,
          character: result?.character,
          shots: result?.shots,
          multi_angle: result?.multi_angle,
          picture_book: result?.picture_book
        }
        
        window.$message?.info(`执行工作流: ${result?.description || '文生图'}`)
        
        // Execute the workflow | 执行工作流
        await executeWorkflow(workflowParams, { x: baseX, y: baseY })
        
        window.$message?.success('工作流已启动')
      } catch (err) {
        console.error('Workflow error:', err)
        window.$message?.error(err.message || '工作流执行失败')
      }
    } else {
      // Manual mode: just create nodes | 手动模式：仅创建节点
      const imageNodeId = addNode('image', { x: baseX + 400, y: baseY }, {
        label: '图片',
        ...(homepageGenerationSettings.value || {})
      })

      // Only create the text node when there is prompt content | 仅在有提示词内容时创建文本节点
      if (content) {
        const textNodeId = addNode('text', { x: baseX, y: baseY }, {
          content: content,
          label: '提示词'
        })

        addEdge({
          source: textNodeId,
          target: imageNodeId,
          sourceHandle: OUTPUT_HANDLE,
          targetHandle: INPUT_HANDLE,
          type: 'flowEdge',
          data: { order: 1 }
        })
      }

      homepageReferenceImages.value.forEach((image, index) => {
        const referenceNodeId = addNode('image', { x: baseX + index * 360, y: baseY - 260 }, {
          label: `参考图${index + 1}`,
          base64: image.dataUrl,
          url: image.dataUrl,
          fileName: image.name || `参考图${index + 1}`
        })
        addEdge({
          source: referenceNodeId,
          target: imageNodeId,
          sourceHandle: OUTPUT_HANDLE,
          targetHandle: INPUT_HANDLE,
          type: 'flowEdge',
          data: { order: index + 1 }
        })
      })
      homepageReferenceImages.value = []
    }
  } catch (err) {
    window.$message?.error(err.message || '创建失败')
  } finally {
    isProcessing.value = false
    // Save immediately so homepage-created nodes survive reload | 立即保存，确保首页带入的节点不因自动保存门闸丢失
    saveProject()
  }
}

// Go back to home | 返回首页
const goBack = () => {
  router.push('/')
}

// Check if mobile | 检测是否移动端
const checkMobile = () => {
  isMobile.value = window.innerWidth < 768
}

// Load project by ID | 根据ID加载项目
const loadProjectById = (projectId) => {
  // Update flow key to force VueFlow re-render | 更新 key 强制 VueFlow 重新渲染
  flowKey.value = Date.now()
  
  if (projectId && projectId !== 'new') {
    loadProject(projectId)
  } else {
    // New project - clear canvas | 新项目 - 清空画布
    clearCanvas()
  }
}

// Watch for route changes | 监听路由变化
watch(
  () => route.params.id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      // Save current project before switching | 切换前保存当前项目
      if (oldId) {
        saveProject()
      }
      // Load new project | 加载新项目
      loadProjectById(newId)
    }
  }
)

// Initialize | 初始化
onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  window.addEventListener('keydown', handleCanvasShortcut)
  window.addEventListener('ling-canvas:open-asset-picker', onOpenAssetPicker)
  window.addEventListener(PORT_CLICK_EVENT, onPortClick)
  document.addEventListener('dblclick', onCanvasDoubleClick, true)

  // Save before window/tab close | 窗口/标签页关闭前保存
  handleBeforeUnload = (e) => {
    saveProject()
  }
  window.addEventListener('beforeunload', handleBeforeUnload)

  // Initialize projects store | 初始化项目存储
  initProjectsStore()

  // Load project data | 加载项目数据
  loadProjectById(route.params.id)

  // Set up Tauri native drag-drop handler (reliable for OS file drops in WebView2)
  // 使用 Tauri 原生拖拽 API（在 WebView2 中比 HTML5 拖拽更可靠）
  let dragDropUnlisten = null
  try {
    // Try webview first (more reliable for WebView2 drag-drop on Windows)
    // 优先使用 webview（在 Windows WebView2 中拖拽更可靠）
    dragDropUnlisten = await getCurrentWebview().onDragDropEvent(handleTauriDragDrop)
    console.log('[DragDrop] Tauri webview drag-drop listener registered')
  } catch (err) {
    console.warn('[DragDrop] Tauri webview drag-drop not available, trying window:', err)
    try {
      dragDropUnlisten = await getCurrentWindow().onDragDropEvent(handleTauriDragDrop)
      console.log('[DragDrop] Tauri window drag-drop listener registered')
    } catch (err2) {
      console.warn('[DragDrop] Tauri window drag-drop not available:', err2)
    }
  }
  canvasDragDropUnlisten = dragDropUnlisten

  // Prevent default browser behavior for file drag on window | 防止浏览器默认的文件拖拽行为
  window.addEventListener('dragover', preventWindowDrop)
  window.addEventListener('drop', preventWindowDrop)

  // Apply image settings selected on the home page | 应用首页选择的生图配置
  const rawGenerationSettings = sessionStorage.getItem('ai-canvas-generation-settings')
  if (rawGenerationSettings) {
    try {
      homepageGenerationSettings.value = JSON.parse(rawGenerationSettings)
    } catch {
      homepageGenerationSettings.value = null
    }
    sessionStorage.removeItem('ai-canvas-generation-settings')
  }

  // Consume homepage reference images passed in memory | 消费首页内存传递的参考图
  if (pendingReferenceImages.value.length) {
    homepageReferenceImages.value = pendingReferenceImages.value.map(img => ({ ...img }))
    pendingReferenceImages.value = []
  }

  // Check for initial prompt / reference images from home page | 检查来自首页的初始提示词或参考图
  const initialPrompt = sessionStorage.getItem('ai-canvas-initial-prompt')
  const hasPendingReferences = homepageReferenceImages.value.length > 0
  if (initialPrompt !== null || hasPendingReferences) {
    sessionStorage.removeItem('ai-canvas-initial-prompt')
    chatInput.value = initialPrompt || ''
    // Auto-send the message | 自动发送消息
    nextTick(() => {
      sendMessage()
    })
  }
})

// Drag & drop image files from file system | 从文件系统拖拽图片文件到画布
let canvasDragDropUnlisten = null

// Tauri native drag-drop handler | Tauri 原生拖拽处理
// 使用 Tauri 原生 API 处理 OS 文件拖拽，比 HTML5 drag-drop 在 WebView2 中更可靠
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v']

const isImageFile = (filePath) => {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.includes(ext)
}
const isVideoPath = (filePath) => VIDEO_EXTENSIONS.includes(filePath.split('.').pop()?.toLowerCase() || '')
const isMediaPath = (filePath) => isImageFile(filePath) || isVideoPath(filePath)

/** 图片节点建好后的共同收尾：置顶 + 通知 Vue Flow 重算内部尺寸 */
const stampImageNode = (nodeId) => {
  const maxZIndex = Math.max(0, ...nodes.value.map(node => node.zIndex || 0))
  updateNodeMeta(nodeId, { zIndex: maxZIndex + 1 })
  setTimeout(() => updateNodeInternals(nodeId), 50)
  return nodeId
}

const addDroppedImageNode = ({ dataUrl, fileName, position }) => stampImageNode(addNode('image', position, {
  url: dataUrl,
  base64: dataUrl,
  label: fileName || '拖入图片',
  fileName: fileName || '拖入图片'
}))

// ---------------------------------------------------------------- 素材库引用
const showAssetPicker = ref(false)

const openAssetPicker = () => {
  showNodeMenu.value = false
  assetTargetNodeId.value = ''
  showAssetPicker.value = true
}

/**
 * 插入一张本地素材。
 *
 * **只写 assetRef，刻意不传 base64、不传 data: url** —— 这是「纯引用式」的硬约束：
 * persistProjectImages 只认 node.data.base64 和 data: 开头的 url，只要这两者不存在，
 * 素材字节就永远不会被写进 IndexedDB。
 */
const addAssetNode = ({ relativePath, name, position }) => {
  const nodeId = stampImageNode(addNode('image', position, {
    assetRef: relativePath,
    label: name || '素材图片',
    fileName: name || '素材图片'
  }))
  // 异步补 url，失败会退化成「素材已丢失」占位（SimpleImageNode 已有该分支）
  hydrateSingleAssetNode(nodeId).catch(() => {})
  return nodeId
}

/** 把素材就地引到已有节点上（同样是纯引用式：只写 assetRef） */
const fillNodeWithAsset = (nodeId, item) => {
  const node = nodes.value.find(n => n.id === nodeId)
  if (!node || node.type !== 'image') return false
  updateNode(nodeId, {
    assetRef: item.relativePath,
    label: item.name || '素材图片',
    fileName: item.name || '素材图片',
    url: ''
  })
  hydrateSingleAssetNode(nodeId).catch(() => {})
  return true
}

const handleAssetPick = (items) => {
  // 从节点里的「素材库」按钮打开时，目标就是那个节点，不再新建
  const targetId = assetTargetNodeId.value
  assetTargetNodeId.value = ''
  if (targetId && fillNodeWithAsset(targetId, items[0])) {
    saveProject()
    showAssetPicker.value = false
    window.$message?.success(`已把素材插入「${nodes.value.find(n => n.id === targetId)?.data?.label || '图片'}」`)
    return
  }

  const center = screenToFlowCoordinate({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  items.forEach((item, index) => {
    addAssetNode({
      relativePath: item.relativePath,
      name: item.name,
      // 与拖入多图的错位规则保持一致
      position: {
        x: center.x + (index % 4) * 40,
        y: center.y + Math.floor(index / 4) * 40
      }
    })
  })
  // 与 handleTauriDragDrop 一致：节点建完显式落盘
  saveProject()
  showAssetPicker.value = false
  window.$message?.success(`已插入 ${items.length} 张素材`)
}

const handleTauriDragDrop = async (event) => {
  console.log('[DragDrop] Tauri event received:', event.payload?.type, 'paths:', event.payload?.paths)
  const payload = event.payload
  switch (payload.type) {
    case 'enter':
      console.log('[DragDrop] Tauri drag enter')
      isDragOverCanvas.value = true
      break
    case 'over':
      isDragOverCanvas.value = true
      break
    case 'drop': {
      isDragOverCanvas.value = false
      const filePaths = payload.paths || []
      console.log('[DragDrop] Tauri drop, paths:', filePaths)
      const imagePaths = filePaths.filter(isMediaPath)
      if (!imagePaths.length) {
        console.log('[DragDrop] No media files found in dropped paths')
        return
      }

      // Tauri returns physical pixels; Vue Flow expects CSS pixels | Tauri 返回物理像素，画布使用 CSS 像素
      const dpr = window.devicePixelRatio || 1
      const clientX = payload.position.x / dpr
      const clientY = payload.position.y / dpr
      const droppedOnNode = nodeIdAtPoint(clientX, clientY)

      for (const [index, filePath] of imagePaths.entries()) {
        try {
          // Copy into project storage so the node does not depend on the source path | 复制进项目存储，不依赖原文件路径
          const image = await invoke('read_dropped_image', { path: filePath })
          const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(filePath)
          const pseudoFile = { type: isVideo ? 'video/mp4' : 'image/png', name: `${image.fileName}` }
          // 落在节点上就地填充；落在空白处新建
          if (index === 0 && droppedOnNode && fillNodeWithFile(droppedOnNode, pseudoFile, image.dataUrl)) continue
          addMediaNode({
            file: pseudoFile,
            dataUrl: image.dataUrl,
            position: screenToFlowCoordinate({ x: clientX + index * 40, y: clientY + index * 40 })
          })
        } catch (err) {
          console.error('[DragDrop] Failed to import file:', filePath, err)
          window.$message?.error(`文件导入失败：${String(err)}`)
        }
      }
      // Save project after drop | 拖拽完成后保存项目
      saveProject()
      break
    }
    case 'leave':
      isDragOverCanvas.value = false
      break
  }
}


// HTML5 drag-drop fallback handler | HTML5 拖拽后备处理器
const isDragOverCanvas = ref(false)

// Prevent file drop on window from navigating | 防止文件拖到窗口外导致页面跳转
const preventWindowDrop = (e) => { e.preventDefault() }

const onDragOver = (event) => {
  const hasFiles = event.dataTransfer?.types?.includes('Files')
  if (hasFiles) {
    isDragOverCanvas.value = true
    console.log('[DragDrop] HTML5 dragover - files detected')
  }
}

const onDragLeave = (event) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = event.clientX
  const y = event.clientY
  if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
    isDragOverCanvas.value = false
  }
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
  reader.readAsDataURL(file)
})

/* ===== 素材入口：拖文件进画布 / 落到节点上 / 素材库 ===== */

/** 落点下面是哪个节点（没有则返回空） */
const nodeIdAtPoint = (clientX, clientY) =>
  document.elementFromPoint(clientX, clientY)?.closest?.('.vue-flow__node')?.dataset?.id || null

const isMediaFile = (file) => file.type.startsWith('image/') || file.type.startsWith('video/') ||
  IMAGE_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() || '')

/** 把文件就地填进某个节点；返回 true 表示已处理（含明确拒绝） */
const fillNodeWithFile = (nodeId, file, dataUrl) => {
  const node = nodes.value.find(item => item.id === nodeId)
  if (!node || !isContentNodeType(node.type)) return false
  const want = file.type.startsWith('video/') ? 'video' : 'image'
  if (node.type === 'text') {
    window.$message?.warning('文本节点放不了图片或视频，拖到空白处可以新建节点')
    return true
  }
  if (node.type !== want) {
    window.$message?.warning(
      `「${node.data?.label || nodeTypeLabels[node.type]}」是${nodeTypeLabels[node.type]}节点，放不了${want === 'video' ? '视频' : '图片'}`
    )
    return true
  }
  setNodeMedia(nodeId, { url: dataUrl, base64: dataUrl, fileName: file.name.replace(/\.[^.]+$/, '') })
  return true
}

/** 拖到空白处：按文件类型新建节点 */
const addMediaNode = ({ file, dataUrl, position }) => {
  const isVideo = file.type.startsWith('video/')
  const name = file.name.replace(/\.[^.]+$/, '') || (isVideo ? '拖入视频' : '拖入图片')
  const nodeId = stampImageNode(addNode(isVideo ? 'video' : 'image', position, { label: name }))
  setNodeMedia(nodeId, { url: dataUrl, base64: dataUrl, fileName: name })
  return nodeId
}

const onDrop = async (event) => {
  isDragOverCanvas.value = false
  const files = Array.from(event.dataTransfer?.files || []).filter(isMediaFile)
  if (!files.length) return

  const droppedOnNode = nodeIdAtPoint(event.clientX, event.clientY)
  for (const [index, file] of files.entries()) {
    try {
      const dataUrl = await fileToDataUrl(file)
      // 落在节点上就地填充；落在空白处建新节点（多文件时第一个落节点、其余各自建节点）
      if (index === 0 && droppedOnNode && fillNodeWithFile(droppedOnNode, file, dataUrl)) continue
      addMediaNode({ file, dataUrl, position: screenToFlowCoordinate({
        x: event.clientX + index * 40,
        y: event.clientY + index * 40
      }) })
    } catch (err) {
      console.error('[DragDrop] 导入失败:', file.name, err)
      window.$message?.error(`导入失败：${file.name}`)
    }
  }
  // FileReader is asynchronous, so save only after every node exists | 全部节点创建后再保存
  saveProject()
}

/* 节点内「素材库」按钮 → 定向插入到那个节点 */
const assetTargetNodeId = ref('')
const onOpenAssetPicker = (event) => {
  assetTargetNodeId.value = event.detail?.nodeId || ''
  showAssetPicker.value = true
}

// Cleanup on unmount | 卸载时清理
onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  window.removeEventListener('keydown', handleCanvasShortcut)
  window.removeEventListener('ling-canvas:open-asset-picker', onOpenAssetPicker)
  window.removeEventListener(PORT_CLICK_EVENT, onPortClick)
  document.removeEventListener('dblclick', onCanvasDoubleClick, true)

  // Clean up beforeunload listener | 清理窗口关闭前保存监听器
  if (handleBeforeUnload) {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    handleBeforeUnload = null
  }

  // Clean up Tauri native drag-drop listener | 清理 Tauri 原生拖拽监听器
  if (canvasDragDropUnlisten) {
    canvasDragDropUnlisten()
    canvasDragDropUnlisten = null
  }
  window.removeEventListener('dragover', preventWindowDrop)
  window.removeEventListener('drop', preventWindowDrop)
  // Save project before leaving | 离开前保存项目
  saveProject()
})
</script>

<style>
/* Import Vue Flow styles | 引入 Vue Flow 样式 */
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/minimap/dist/style.css';

.canvas-flow {
  width: 100%;
  height: 100%;
}

/* Dark canvas uses neutral black and gray instead of the app's navy palette. */
.dark .canvas-page {
  --bg-primary: #090909;
  --bg-secondary: #161616;
  --bg-tertiary: #242424;
  --border-color: #343434;
  --text-primary: #f5f5f5;
  --text-secondary: #a3a3a3;
}

.dark .canvas-flow,
.dark .canvas-flow .vue-flow {
  background-color: var(--bg-primary);
}

.node-menu {
  width: 208px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: var(--bg-secondary);
  box-shadow: 0 18px 42px rgb(0 0 0 / 18%);
}

.dark .node-menu {
  background: #202020;
  border-color: #343434;
  box-shadow: 0 18px 42px rgb(0 0 0 / 45%);
}

.node-menu-title {
  padding: 6px 8px 8px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.node-menu-resource-title {
  padding-top: 10px;
}

.node-menu-item {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  border-radius: 9px;
  color: var(--text-primary);
  font-size: 14px;
  text-align: left;
  transition: background-color .15s ease, color .15s ease;
}

.node-menu-item:hover {
  background: var(--bg-tertiary);
  color: var(--accent-color);
}

.node-menu-divider {
  height: 1px;
  margin: 8px 4px 0;
  background: var(--border-color);
}

.canvas-search-modal, .canvas-search-modal.n-card { width: min(640px, 92vw); max-width: 92vw; }
.canvas-search-modal .n-card, .canvas-search-modal.n-card { height: min(560px, 72vh); overflow: hidden; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-secondary); box-shadow: 0 24px 60px rgb(0 0 0 / 28%); }
.canvas-search-modal .n-card__content, .canvas-search-modal.n-card .n-card__content { height: 100%; padding: 0; }
.dark .canvas-search-modal .n-card { border-color: #373737; background: #1e1e20; box-shadow: 0 24px 60px rgb(0 0 0 / 56%); }
.canvas-search-panel { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.canvas-search-bar { display: flex; height: 68px; align-items: center; gap: 12px; padding: 0 18px; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); }
.canvas-search-bar input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-size: 15px; }
.canvas-search-bar input::placeholder { color: var(--text-secondary); }
.canvas-search-bar button { padding: 4px 7px; color: var(--text-secondary); font-size: 23px; line-height: 1; }
.canvas-search-bar button:hover { color: var(--text-primary); }
.canvas-search-tabs { display: flex; gap: 8px; padding: 14px 18px 10px; }
.canvas-search-tabs button { border-radius: 7px; padding: 5px 10px; color: var(--text-secondary); font-size: 13px; }
.canvas-search-tabs button:hover, .canvas-search-tabs button.active { background: var(--bg-tertiary); color: var(--text-primary); }
.dark .canvas-search-tabs button:hover, .dark .canvas-search-tabs button.active { background: #3a3a3d; }
.search-results { min-height: 0; flex: 1; margin: 0 10px 12px; overflow-y: auto; padding: 0 8px; }
.search-results section + section { margin-top: 18px; }
.search-results h4 { margin: 5px 0 7px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.search-result-item { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 9px; color: var(--text-primary); text-align: left; }
.search-result-item:hover { background: var(--bg-tertiary); }
.search-result-item small { color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.search-empty { padding: 36px 0; color: var(--text-secondary); font-size: 14px; text-align: center; }

.selection-group-outline { position: absolute; z-index: 15; pointer-events: none; border: 1px dashed var(--accent-color); border-radius: 10px; background: color-mix(in srgb, var(--accent-color) 4%, transparent); }
.selection-action-bar { position: absolute; left: 50%; top: -12px; display: flex; align-items: center; gap: 4px; min-height: 42px; transform: translate(-50%, -100%); border: 1px solid var(--border-color); border-radius: 11px; background: var(--bg-secondary); padding: 5px 7px; box-shadow: 0 12px 30px rgb(0 0 0 / 16%); pointer-events: auto; white-space: nowrap; }
.dark .selection-action-bar { border-color: #383838; background: #252527; box-shadow: 0 12px 30px rgb(0 0 0 / 46%); }
.selection-action-bar button { border-radius: 7px; color: var(--text-primary); font-size: 13px; transition: background .15s ease; }
.selection-action { display: inline-flex; min-height: 32px; align-items: center; gap: 7px; padding: 7px 10px; }
.selection-action:hover { background: var(--bg-tertiary); }
.selection-action svg, .selection-layout-popover svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.selection-caret { margin-left: -3px; color: var(--text-secondary); font-size: 13px; }
.selection-layout-menu { position: relative; }
.selection-layout-popover { position: absolute; bottom: calc(100% + 8px); left: 0; display: grid; min-width: 128px; gap: 2px; border: 1px solid var(--border-color); border-radius: 11px; background: var(--bg-secondary); padding: 5px; box-shadow: 0 12px 30px rgb(0 0 0 / 18%); }
.dark .selection-layout-popover { border-color: #383838; background: #252527; box-shadow: 0 12px 30px rgb(0 0 0 / 46%); }
.selection-layout-popover button { display: flex; align-items: center; gap: 8px; border-radius: 7px; padding: 8px; color: var(--text-primary); text-align: left; white-space: nowrap; }
.selection-layout-popover button:hover { background: var(--bg-tertiary); }
.canvas-flow .vue-flow__node.selected { filter: drop-shadow(0 8px 18px rgba(215, 149, 84, 0.2)); }
.canvas-flow .vue-flow__nodesselection-rect { opacity: 0; border: 0; background: transparent; pointer-events: none; }
.canvas-flow .vue-flow__pane,
.canvas-flow .vue-flow__container { cursor: default; }
.canvas-flow .vue-flow__node,
.canvas-flow .vue-flow__node * { cursor: grab !important; }
.canvas-flow .vue-flow__node.dragging,
.canvas-flow .vue-flow__node.dragging * { cursor: grabbing !important; }
.canvas-flow .vue-flow__node input,
.canvas-flow .vue-flow__node textarea,
.canvas-flow .vue-flow__node [contenteditable="true"],
.canvas-flow .vue-flow__node .cursor-text { cursor: text !important; }
.canvas-flow .vue-flow__node button,
.canvas-flow .vue-flow__node a { cursor: pointer !important; }
.canvas-flow .vue-flow__node .vue-flow__handle { cursor: crosshair !important; }

.shortcut-modal, .shortcut-modal.n-card { width: min(1120px, 92vw); max-width: 92vw; }
.shortcut-modal .n-card, .shortcut-modal.n-card { overflow: hidden; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-secondary); box-shadow: 0 24px 60px rgb(0 0 0 / 28%); }
.shortcut-modal .n-card__content, .shortcut-modal.n-card .n-card__content { padding: 0; }
.dark .shortcut-modal .n-card, .dark .shortcut-modal.n-card { border-color: #373737; background: #1e1e20; box-shadow: 0 24px 60px rgb(0 0 0 / 56%); }
.shortcut-panel { padding: 22px 24px 24px; }
.shortcut-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--border-color); }
.shortcut-header h3 { margin: 0; color: var(--text-primary); font-size: 17px; font-weight: 650; }
.shortcut-header p { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; }
.shortcut-header button { padding: 0 6px; color: var(--text-secondary); font-size: 24px; line-height: 1; }
.shortcut-header button:hover { color: var(--text-primary); }
.shortcut-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 20px; }
.shortcut-grid section { min-height: 206px; padding: 0 24px; border-left: 1px solid var(--border-color); }
.shortcut-grid section:first-child { padding-left: 0; border-left: 0; }
.shortcut-grid section:last-child { padding-right: 0; }
.shortcut-grid h4 { margin: 0 0 16px; color: var(--accent-color); font-size: 14px; font-weight: 600; }
.shortcut-row { display: flex; min-height: 36px; align-items: center; justify-content: flex-end; gap: 7px; color: var(--text-secondary); font-size: 13px; white-space: nowrap; }
.shortcut-row > span:first-child { margin-right: auto; }
.shortcut-row kbd { min-width: 27px; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-tertiary); padding: 4px 7px; color: var(--text-primary); font-family: inherit; font-size: 13px; text-align: center; }
.shortcut-row i { color: var(--text-secondary); font-style: normal; }
@media (max-width: 820px) { .shortcut-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 0; } .shortcut-grid section:nth-child(3) { padding-left: 0; border-left: 0; } .shortcut-grid section:nth-child(2) { padding-right: 0; } }
@media (max-width: 520px) { .shortcut-grid { grid-template-columns: 1fr; } .shortcut-grid section { min-height: auto; padding: 0; border-left: 0; } }

.canvas-history-modal, .canvas-history-modal.n-card { width: min(1320px, 92vw); max-height: none !important; overflow: hidden !important; }
.canvas-history-modal .n-card, .canvas-history-modal.n-card { height: min(720px, 76vh); max-height: none !important; overflow: hidden !important; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-secondary); box-shadow: 0 24px 60px rgb(0 0 0 / 28%); }
.canvas-history-modal .n-card__content, .canvas-history-modal.n-card .n-card__content { height: 100%; padding: 0; }
.dark .canvas-history-modal .n-card, .dark .canvas-history-modal.n-card { border-color: #373737; background: #1e1e20; box-shadow: 0 24px 60px rgb(0 0 0 / 56%); }
.canvas-history-panel { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.history-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; }
.history-tabs { display: flex; gap: 5px; padding: 3px; border: 1px solid var(--border-color); border-radius: 9px; }
.history-tabs button { border-radius: 6px; padding: 6px 11px; color: var(--text-secondary); font-size: 13px; }
.history-tabs button.active { background: var(--bg-tertiary); color: var(--text-primary); }
.dark .history-tabs button.active { background: #363639; }
.history-panel-actions { display: flex; align-items: center; gap: 12px; }
.history-batch { border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 11px; color: var(--text-secondary); font-size: 13px; }
.history-batch:hover { border-color: var(--text-secondary); color: var(--text-primary); }
.history-batch.active { border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 12%, transparent); color: var(--accent-color); }
.history-close { padding: 2px 7px; color: var(--text-secondary); font-size: 24px; line-height: 1; }
.history-close:hover { color: var(--text-primary); }
.history-panel-content { min-height: 0; flex: 1; overflow-y: auto; padding: 14px 16px 20px; }
.history-panel-content { scrollbar-width: thin; scrollbar-color: #666 transparent; }
.history-panel-content::-webkit-scrollbar { width: 8px; }
.history-panel-content::-webkit-scrollbar-track { background: transparent; }
.history-panel-content::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: #5a5a5e; background-clip: padding-box; }
.history-panel-content::-webkit-scrollbar-thumb:hover { background: #77777b; background-clip: padding-box; }
.history-batch-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: -14px -16px 14px; padding: 10px 16px; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: 13px; }
.history-batch-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.history-batch-actions b { color: var(--accent-color); font-size: 13px; }
.history-batch-actions button { border: 1px solid var(--border-color); border-radius: 7px; padding: 5px 9px; color: var(--text-secondary); font-size: 12px; }
.history-batch-actions button:hover:not(:disabled) { border-color: var(--text-secondary); color: var(--text-primary); }
.history-batch-actions button.primary { border-color: var(--accent-color); background: var(--accent-color); color: white; }
.history-batch-actions button.danger { border-color: #ef4444; color: #ef4444; }
.history-batch-actions button:disabled { cursor: not-allowed; opacity: .45; }
.history-date { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--text-secondary); font-size: 14px; }
.history-date input { width: 16px; height: 16px; accent-color: var(--accent-color); }
.history-image-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.history-image-card { overflow: hidden; border: 1px solid var(--border-color); border-radius: 8px; background-color: #2b2b2d; background-image: linear-gradient(45deg, rgb(255 255 255 / 5%) 25%, transparent 25%), linear-gradient(-45deg, rgb(255 255 255 / 5%) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgb(255 255 255 / 5%) 75%), linear-gradient(-45deg, transparent 75%, rgb(255 255 255 / 5%) 75%); background-position: 0 0, 0 6px, 6px -6px, -6px 0; background-size: 12px 12px; }
.history-image-card:hover { border-color: var(--accent-color); }
.history-image-card.selected { border-color: var(--accent-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 72%, transparent); }
.history-image-card img { display: block; aspect-ratio: 1 / 1; width: 100%; object-fit: cover; }
.history-select-mark { position: absolute; right: 8px; top: 8px; display: flex; height: 22px; width: 22px; align-items: center; justify-content: center; border: 1px solid var(--border-color); border-radius: 50%; background: rgb(0 0 0 / 48%); color: transparent; font-size: 13px; }
.history-image-card { position: relative; }
.history-image-card.selected .history-select-mark { border-color: var(--accent-color); background: var(--accent-color); color: white; }
.history-empty { display: flex; height: 100%; min-height: 180px; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 14px; }
@media (max-width: 760px) { .history-image-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.canvas-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  border: 2px dashed var(--accent-color, #6366f1);
  border-radius: 12px;
  pointer-events: none;
  animation: dropOverlayPulse 1.5s ease-in-out infinite;
}
@keyframes dropOverlayPulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
.canvas-drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-primary, #fff);
  font-size: 15px;
  font-weight: 500;
}
.canvas-drop-hint svg {
  width: 36px;
  height: 36px;
  opacity: 0.8;
}
</style>
