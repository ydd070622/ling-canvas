<template>
  <!-- Canvas page | 画布页面 -->
  <div class="canvas-page h-full w-full flex flex-col bg-[var(--bg-primary)]">
    <!-- Main canvas area | 主画布区域 -->
    <div
      class="flex-1 relative overflow-hidden"
      :style="{ '--flow-zoom': zoomLevel }"
      @click.capture="onReferenceClick"
      @pointerdown.capture="onReferencePointerDown"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Vue Flow canvas | Vue Flow 画布 -->
      <VueFlow
        :key="flowKey"
        :delete-key-code="null"
        @nodes-change="onFlowNodesChange"
        v-model:viewport="viewport"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :default-viewport="canvasViewport"
        :min-zoom="0.1"
        :max-zoom="2"
        :zoom-on-double-click="false"
        :zoom-on-scroll="preferences.zoomOnScroll"
        :selection-key-code="true"
        :multi-selection-key-code="['Control', 'Meta', 'Shift']"
        :selection-mode="'partial'"
        :pan-on-drag="[1, 2]"
        :pan-activation-key-code="'Space'"
        :snap-to-grid="false"
        :is-valid-connection="isValidConnection"
        :connect-on-click="false"
        @connect="onConnect"
        @connect-start="onConnectStart"
        @connect-end="onConnectEnd"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
        @dblclick="onCanvasDoubleClick"
        @selection-start="clearEdgeFocus"
        @selection-end="onCanvasSelectionEnd"
        @node-drag-start="handleNodeDragStart"
        @node-drag-stop="handleNodeDragStop"
        @viewport-change="handleViewportChange"
        @edges-change="onEdgesChange"
        class="canvas-flow"
      >
      </VueFlow>

      <div class="canvas-alignment-guides" aria-hidden="true">
        <div v-for="guide in alignmentLines" :key="guide.axis" :class="`alignment-line-${guide.axis}`"
          :style="guide.axis === 'x' ? { left: `${guide.position}px` } : { top: `${guide.position}px` }" />
      </div>

      <div v-if="isDragOverCanvas" class="canvas-drop-overlay">
        <div class="canvas-drop-hint">
          <span>松开鼠标，将图片放入画布</span>
        </div>
      </div>

      <!-- Multi-node selection management | 多节点框选管理 -->
      <svg v-if="selectionWire" class="selection-wire-preview">
        <path v-for="(start, index) in selectionWire.starts" :key="index"
          :d="`M ${start.x} ${start.y} C ${start.x + 70} ${start.y}, ${selectionWire.x - 70} ${selectionWire.y}, ${selectionWire.x} ${selectionWire.y}`" />
      </svg>
      <div
        v-if="selectionOverlay"
        class="selection-group-outline"
        :style="selectionOverlay.boxStyle"
      >
        <button v-if="selectedCanvasNodes.filter(node => node.type === 'image').length >= 2" class="selection-output-port" type="button" title="拖到空白处创建共同下游；拖到节点连接全部所选图片"
          @pointerdown.stop.prevent="startSelectionConnection">+</button>
        <div class="selection-action-bar" @mousedown.stop @click.stop>
          <button type="button" class="selection-action" title="将所选节点编为一组" @click="groupSelectedNodes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="13" height="13" rx="2" /><path d="M16 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3" /></svg><span>打组</span>
          </button>
          <button v-if="selectedImageNodes.length >= 2" type="button" class="selection-action"
            :disabled="mergingImages" aria-label="图层合并" :title="mergingImages ? '合并中…' : '图层合并：保留当前布局与间隙'" @click="mergeSelectedImages">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M9 18v3h12V9h-3M8 9h5M10.5 6.5v5" /></svg><span>{{ mergingImages ? '合并中…' : '图层合并' }}</span>
          </button>
          <button type="button" class="selection-action" title="复制所选节点" @click="duplicateSelectedNodes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="11" rx="1.5" /><path d="M6 16H5a1 1 0 0 1-1-1V6.5A1.5 1.5 0 0 1 5.5 5H14a1 1 0 0 1 1 1v1" /></svg><span>复制</span>
          </button>
          <span class="selection-action-divider" aria-hidden="true"></span>
          <button
            v-if="selectedImageNodes.length"
            type="button"
            class="selection-action"
            title="把所选图片发送到智能体，让它看图写作"
            @click="sendSelectionToAgent"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" /><path d="M12 13V8" /><path d="M9.5 10.5 12 8l2.5 2.5" /></svg><span>智能体</span>
          </button>
          <button v-if="selectedImageNodes.length" type="button" class="selection-action" title="保存所选图片到本地空间" @click="saveSelectionLocal">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v11H3Z" /><path d="M3 7V4h7l2 3" /></svg><span>本地空间</span>
          </button>
          <button v-if="selectedImageNodes.length >= 2" type="button" class="selection-action"
            :disabled="batchDownloading" aria-label="批量下载" :title="batchDownloading ? batchDownloadProgress : '批量下载：保存为 ZIP'" @click="downloadSelectedImages">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 17v4h16v-4" /></svg><span>{{ batchDownloading ? batchDownloadProgress : '批量下载' }}</span>
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
        <CanvasLocalOutput :project-id="String(route.params.id)" />
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

      <!-- 创建菜单：双击空白、点端口、从端口拖到空白，三处共用 -->
      <CreateMenu
        :visible="menu.visible"
        :x="menu.x"
        :y="menu.y"
        :title="menuTitle"
        :options="menuOptions"
        :show-resources="menu.mode === 'blank'"
        @select="handleMenuSelect"
        @upload="handleUploadResource"
        @assets="openAssetPicker"
      />

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

    <!-- Agent Panel | 智能体抽屉：左侧栏图标 / Alt+A 打开 -->
    <AgentPanel v-model:show="agent.panelOpen" :panel-width="agentDisplayWidth" @locate-nodes="locateAgentNodes" />

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
            <div class="shortcut-row"><span>打开 / 收回智能体</span><kbd>{{ agentShortcutLabel }}</kbd></div>
            <div class="shortcut-row"><span>滚轮缩放</span><span>滚动鼠标</span></div>
          </section>
          <section>
            <h4>其他</h4>
            <div class="shortcut-row"><span>多选节点</span><kbd>Ctrl/Shift</kbd><i>+</i><span>点击</span></div>
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

    <!-- 底部 composer：选中的节点自动成为上下文 -->
    <CanvasComposer ref="composerRef" :agent-open="agent.panelOpen" :agent-width="agentDisplayWidth" :screen-to-flow="screenToFlowCoordinate" @visibility-change="composerVisible = $event" @attach="handleComposerAttach" />

    <!-- 全屏查看图片 / 视频 / 音频（全局唯一一个） -->
    <MediaViewer />
  </div>
</template>

<script setup>
import { requestLocalSave } from '../stores/localSpace'
/**
 * Canvas view component | 画布视图组件
 * Main infinite canvas with Vue Flow integration
 */
import { useCanvasFlowSync } from '../composables/useCanvasFlowSync'
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watch, nextTick, markRaw } from 'vue'
import { alignmentGuides } from '../utils/alignmentGuides'
import { fitNodeGroups, releaseGroupMembers, joinDroppedGroupMembers } from '../utils/groupBounds'
import { handleAgentShortcut } from '../utils/agentShortcut'
import { agentShortcut, agentShortcutLabel } from '../stores/agentShortcut'
import { downloadImageBatch } from '../utils/downloadMedia'
import { mergeImages } from '../utils/mergeImages'
import { instantiateGroupWorkflow } from '../utils/groupWorkflow'
import { generationHistory, loadGenerationHistory, recordGeneratedImages, deleteGenerationHistory } from '../stores/generationHistory'
import { openMediaViewer } from '../composables/useMediaViewer'
import { useRouter, useRoute } from 'vue-router'
import { preferences } from '../stores/preferences'
import { VueFlow, useVueFlow } from '@vue-flow/core'
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
import { nodes, edges, pendingReferenceImages, addNode, addNodes, addEdge, addEdges, updateNode, updateNodeMeta, removeNode, removeEdge, normalizeEdgeOrders, loadProject, saveProject, flushCanvasMediaSaves, clearCanvas, canvasViewport, updateViewport, undo, redo, canUndo, canRedo, manualSaveHistory, startBatchOperation, endBatchOperation, hydrateSingleAssetNode, inEdges, renumberNodeRefs, setNodeMedia, cutEdge, editNode, duplicateNode } from '../stores/canvas'
import { useChat, useWorkflowOrchestrator } from '../hooks'
import { useModelStore } from '../stores/pinia'
import { projects, initProjectsStore, renameProject, deleteProject, flushProjectSaves } from '../stores/projects'
import CanvasLocalOutput from '../components/local/CanvasLocalOutput.vue'
import { flushProjectThumbnails } from '../stores/projectThumbnails'
import { isContentNodeType, validateCanvasConnection, findModeAccepting, getAcceptLimit, AUTO_MODE, INPUT_HANDLE, OUTPUT_HANDLE, NODE_MODES, CONTENT_NODE_TYPES } from '../config/nodeRegistry'
import { selectedNodeIds } from '../composables/useFocusMode'
import { activeEdgeId, clearEdgeFocus } from '../composables/useEdgeFocus'

// Window close handler for saving | 窗口关闭处理函数（用于保存）
let handleBeforeUnload = null
let closeRequestUnlisten = null
let isDestroyingWindow = false

// API Settings component | API 设置组件
import ApiSettings from '../components/ApiSettings.vue'
import DownloadModal from '../components/DownloadModal.vue'
import WorkflowPanel from '../components/WorkflowPanel.vue'
import AgentPanel from '../components/agent/AgentPanel.vue'
import { useAgentStore } from '../stores/agent'
import { isDark, toggleTheme } from '../stores/theme'
import { openExternal } from '@/utils'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'

// API Config state | API 配置状态
const modelStore = useModelStore()
const isApiConfigured = computed(() => !!modelStore.currentApiKey)

// Canvas agent | 画布智能体
const agent = useAgentStore()

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
import AudioNode from '../components/nodes/AudioNode.vue'
import TaskNode from '../components/nodes/TaskNode.vue'
import RenderNode from '../components/nodes/RenderNode.vue'
import CompareNode from '../components/nodes/CompareNode.vue'
import FlowEdge from '../components/edges/FlowEdge.vue'
import AssetPickerModal from '../components/canvas/AssetPickerModal.vue'
import { resolveAssetUrl } from '../services/assetLibrary'
import { layoutAssetImages } from '../utils/assetLayout'
import MediaViewer from '../components/canvas/MediaViewer.vue'
import CreateMenu from '../components/canvas/CreateMenu.vue'
import CanvasComposer from '../components/canvas/CanvasComposer.vue'

const router = useRouter()
const route = useRoute()

/**
 * 当前缩放。挂在画布容器上当 CSS 变量：缩小状态下节点左上角的角标要按它**反向缩放**，
 * 否则角标自己也跟着缩小，小到读不出来就失去了"用来认节点"的意义。
 */
const zoomLevel = computed(() => viewport.value?.zoom ?? 1)

// Vue Flow instance | Vue Flow 实例
const canvasFlow = useVueFlow()
// ResizeObserver delivers dimensions before paint. Apply group geometry in
// the next frame so measuring and resizing never feed back in that delivery.
let groupFitFrame = null
const draggedGroupMembers = new Set()
const dragGroupBounds = new Map()
watch(nodes, () => {
  if (!nodes.value.some(node => node.type === 'group')) return
  if (groupFitFrame !== null) return
  groupFitFrame = requestAnimationFrame(() => {
    groupFitFrame = null
    let fitted = nodes.value
    // Preview incoming members without changing their parent mid-gesture.
    if (draggedGroupMembers.size) {
      const preview = joinDroppedGroupMembers(fitted, draggedGroupMembers)
      const previewGroups = new Set(preview.filter(node => node.type === 'group').map(node => node.id))
      const visual = fitNodeGroups(preview, 28, previewGroups)
      let changed = false
      const next = fitted.map(node => {
        if (node.type !== 'group') return node
        const bounds = visual.find(candidate => candidate.id === node.id)?.data?.dragBounds
        if (JSON.stringify(bounds) === JSON.stringify(node.data?.dragBounds)) return node
        changed = true
        return { ...node, data: { ...node.data, dragBounds: bounds } }
      })
      if (changed) fitted = next
    } else fitted = fitNodeGroups(nodes.value)
    if (fitted !== nodes.value) nodes.value = fitted
  })
}, { flush: 'post' })
onBeforeUnmount(() => {
  if (groupFitFrame !== null) cancelAnimationFrame(groupFitFrame)
})
const { viewport, zoomIn, zoomOut, fitView, updateNodeInternals, screenToFlowCoordinate } = canvasFlow
const { onNodesChange: syncFlowNodesChange, onEdgeSelectionChange } = useCanvasFlowSync(nodes, edges, canvasFlow)
const onFlowNodesChange = changes => syncFlowNodesChange(snapDragChanges(changes))

// Register custom node types | 注册自定义节点类型
const nodeTypes = {
  text: markRaw(SimpleTextNode),
  video: markRaw(VideoNode),
  image: markRaw(SimpleImageNode),
  audio: markRaw(AudioNode),
  task: markRaw(TaskNode),
  render: markRaw(RenderNode),
  compare: markRaw(CompareNode),
  group: markRaw(GroupNode)
}

// Register custom edge types | 注册自定义边类型
const edgeTypes = {
  flowEdge: markRaw(FlowEdge)
}

// UI state | UI状态
const chatInput = ref('')
const autoExecute = ref(false)
const homepageGenerationSettings = ref(null)
const homepageReferenceImages = ref([])
const isMobile = ref(false)
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
  video: '视频',
  audio: '音频',
  task: 'AI 任务',
  render: '室内渲染',
  compare: '图片对比',
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
const historyImageAssets = computed(() => generationHistory.value)
const migratedHistoryUrls = new Set()
onMounted(() => loadGenerationHistory().catch(() => window.$message?.error('读取生成历史失败')))
watch(() => nodes.value.filter(node => node.type === 'image' && node.data?.url && (node.data.ownerId || node.data.galleryUrls?.length)).map(node => node.data.galleryUrls?.length ? node.data.galleryUrls : [node.data.url]).flat(), urls => {
  const unseen = urls.filter(url => !migratedHistoryUrls.has(url))
  unseen.forEach(url => migratedHistoryUrls.add(url))
  if (unseen.length) recordGeneratedImages(unseen.map(url => ({ url }))).catch(error => console.warn('恢复生成历史失败', error))
}, { immediate: true })
const isAllHistorySelected = computed(() => historyImageAssets.value.length > 0 && historyImageAssets.value.every(asset => selectedHistoryIds.value.includes(asset.id)))
const historyDate = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('/', '-'))
const selectedCanvasNodes = computed(() => nodes.value.filter(node => node.selected))

/** 所选里真正有图可发的图片节点 —— 「发给智能体」那颗按钮据此显隐 */
const selectedImageNodes = computed(() => (
  selectedCanvasNodes.value.filter(node => node.type === 'image' && node.data?.url)
))
const batchDownloading = ref(false)
const mergingImages = ref(false)
const mergeSelectedImages = async () => {
  if (mergingImages.value) return
  mergingImages.value = true
  try {
    const items = selectedImageNodes.value.map(node => {
      const element = [...document.querySelectorAll('.vue-flow__node')].find(element => element.dataset.id === node.id)
      const image = element?.querySelector('.flow-stage img')
      if (!image) throw new Error('请等待所选图片显示后再合并')
      const rect = image.getBoundingClientRect()
      const position = screenToFlowCoordinate({ x: rect.left, y: rect.top })
      return { url: image.currentSrc || node.data.url, ...position, width: rect.width / viewport.value.zoom,
        height: rect.height / viewport.value.zoom, z: Number(getComputedStyle(element).zIndex) || 0 }
    })
    const result = await mergeImages(items)
    const id = stampImageNode(addNode('image', { x: result.left, y: result.top + result.layoutHeight + 60 }, {
      url: result.url, base64: result.url, label: '合并图片', width: result.width, height: result.height
    }))
    nodes.value = nodes.value.map(node => ({ ...node, selected: node.id === id }))
    window.$message?.success('已按当前布局合并为一张图片，原图已保留')
  } catch (error) {
    window.$message?.error(error.message || '图片合并失败')
  } finally { mergingImages.value = false }
}
const batchDownloadProgress = ref('准备下载…')
const saveSelectionLocal = () => {
  const urls = selectedImageNodes.value.flatMap(node => [node.data.url, ...(node.data.galleryUrls || [])]).filter(Boolean)
  requestLocalSave([...new Set(urls)], '图片')
}
const downloadSelectedImages = async () => {
  if (batchDownloading.value) return
  const selected = selectedImageNodes.value.map(node => ({ ...node, data: { ...node.data, galleryUrls: node.data?.galleryUrls ? [...node.data.galleryUrls] : undefined } }))
  batchDownloading.value = true
  try {
    await downloadImageBatch(selected, (done, total) => { batchDownloadProgress.value = `下载 ${done}/${total}` })
  } catch (error) {
    window.$message?.error(error.message || '批量下载失败')
  } finally {
    batchDownloading.value = false
    batchDownloadProgress.value = '准备下载…'
  }
}
const selectionBoxStyle = ref(null)
const selectionOverlay = computed(() => (
  selectedCanvasNodes.value.length >= 2 && selectionBoxStyle.value
    ? { boxStyle: selectionBoxStyle.value }
    : null
))

let selectionOverlayFrame = null
const refreshSelectionOverlay = () => {
  if (selectedCanvasNodes.value.length < 2) {
    selectionBoxStyle.value = null
    return
  }
  if (selectionOverlayFrame !== null) return
  selectionOverlayFrame = requestAnimationFrame(() => {
    selectionOverlayFrame = null
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

let edgeSelectionRect = null
watch(canvasFlow.userSelectionRect, rect => {
  if (rect) edgeSelectionRect = { ...rect }
}, { flush: 'sync' })
const onCanvasSelectionEnd = () => {
  const rect = edgeSelectionRect
  edgeSelectionRect = null
  const canvas = document.querySelector('.canvas-flow')
  if (rect && rect.width > 3 && rect.height > 3 && canvas) {
    const bounds = canvas.getBoundingClientRect()
    const box = { left: bounds.left + rect.x, top: bounds.top + rect.y,
      right: bounds.left + rect.x + rect.width, bottom: bounds.top + rect.y + rect.height }
    const selected = new Set()
    canvas.querySelectorAll('.flow-edge-hit').forEach(path => {
      const matrix = path.getScreenCTM()
      if (!matrix) return
      const length = path.getTotalLength()
      const steps = Math.max(1, Math.ceil(length * (viewport.value.zoom || 1) / 4))
      for (let step = 0; step <= steps; step++) {
        const point = path.getPointAtLength(length * step / steps)
        const x = matrix.a * point.x + matrix.c * point.y + matrix.e
        const y = matrix.b * point.x + matrix.d * point.y + matrix.f
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          selected.add(path.dataset.edgeId); break
        }
      }
    })
    edges.value = edges.value.map(edge => ({ ...edge, selected: selected.has(edge.id) }))
  }
  refreshSelectionOverlay()
}

watch(() => selectedCanvasNodes.value.map(node => [node.id, node.position?.x, node.position?.y,
  node.dimensions?.width, node.dimensions?.height, node.parentNode]), refreshSelectionOverlay, { flush: 'post' })
onBeforeUnmount(() => {
  if (selectionOverlayFrame !== null) cancelAnimationFrame(selectionOverlayFrame)
})

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

// Add new node | 添加新节点（视口中心）
const addNewNode = async (type) => {
  // Calculate viewport center position | 计算视口中心位置
  const viewportCenterX = -viewport.value.x / viewport.value.zoom + (window.innerWidth / 2) / viewport.value.zoom
  const viewportCenterY = -viewport.value.y / viewport.value.zoom + (window.innerHeight / 2) / viewport.value.zoom

  // Add node at viewport center | 在视口中心添加节点
  const nodeId = addNode(type, { x: viewportCenterX - 100, y: viewportCenterY - 100 })
  // 只选中新节点；选中即展开（焦点态），不需要再往节点上写 expanded
  nodes.value = nodes.value.map(node => ({ ...node, selected: node.id === nodeId }))

  // Set highest z-index | 设置最高层级
  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))
  updateNodeMeta(nodeId, { zIndex: maxZIndex + 1 })

  // Force Vue Flow to recalculate node dimensions | 强制 Vue Flow 重新计算节点尺寸
  setTimeout(() => {
    updateNodeInternals(nodeId)
  }, 50)

  closeMenu()
}

const handleUploadResource = () => {
  closeMenu()
}

// Canvas agent | 画布智能体：左侧栏图标与 Alt+A 共用这一个开关
// 开关本身在 store 里 —— 图片节点上的「发送到智能体」按钮也要打开它
const handleCanvasAgent = () => {
  agent.togglePanel()
}

const toggleHistoryBatching = () => {
  isHistoryBatching.value = !isHistoryBatching.value
  if (!isHistoryBatching.value) selectedHistoryIds.value = []
}

const handleHistoryAssetClick = (asset) => {
  if (!isHistoryBatching.value) {
    openMediaViewer({ url: asset.data.url, kind: 'image', alt: asset.data.label || '生成图片' })
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
  // 点中某条线（剪刀已经钉出来）时按 Delete 也应该剪断它。这一步不走 Vue Flow 的选中，
  // 所以得单独接一下 —— 见 composables/useEdgeFocus 里"为什么不用 edge.selected"。
  const focusedEdgeId = activeEdgeId.value && !selectedEdgeIds.includes(activeEdgeId.value)
    ? activeEdgeId.value
    : ''
  if (!selectedNodeIds.length && !selectedEdgeIds.length && !focusedEdgeId) return false

  startBatchOperation()
  selectedNodeIds.forEach(removeNode)
  selectedEdgeIds.forEach(cutEdge)
  // 走 cutEdge 而不是 removeEdge：它会顺带把目标节点正文里的引用编号重排
  if (focusedEdgeId) cutEdge(focusedEdgeId)
  endBatchOperation()
  return true
}

const duplicateSelectedNodes = () => {
  const sourceIds = selectedCanvasNodes.value.map(node => node.id)
  if (!sourceIds.length) return

  // 走 store 的 duplicateNode：它会把入边一起克隆、并通过 edgeIdMap 把副本的
  // refBindings 重绑到副本自己的边上。以前这里是手写 spread `{...node.data}`，
  // 绑定值还是**原节点**的 edge id，副本里每个引用都解析成 orphan，
  // 生成直接被 E_ORPHAN 挡住 —— 而用户看到的只是"复制了一份"。
  const newIds = sourceIds.map(duplicateNode).filter(Boolean)
  nodes.value = nodes.value.map(node => ({ ...node, selected: newIds.includes(node.id) }))
}

const downloadSelectedNodes = () => {
  const downloadableNodes = selectedCanvasNodes.value.filter(node => node.data?.url)
  if (!downloadableNodes.length) {
    window.$message?.warning('选中的节点中没有可下载的文件')
    return
  }

  downloadableNodes.forEach(node => openExternal(node.data.url))
}

// 把所选图片整批发给画布智能体（暂存为附件，等用户补要求再发）
const sendSelectionToAgent = () => {
  if (!selectedImageNodes.value.length) return
  agent.attachSelectedImages()
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
          extent: undefined,
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

const downloadSelectedHistoryAssets = async () => {
  const selectedAssets = historyImageAssets.value.filter(asset => selectedHistoryIds.value.includes(asset.id))
  try { await downloadImageBatch(selectedAssets) } catch (error) { window.$message?.error(error.message) }
}

const deleteSelectedHistoryAssets = async () => {
  const selectedAssets = historyImageAssets.value.filter(asset => selectedHistoryIds.value.includes(asset.id))
  if (!selectedAssets.length || !window.confirm(`确定删除选中的 ${selectedAssets.length} 张历史记录吗？画布图片会保留。`)) return
  try { await deleteGenerationHistory(selectedAssets.map(asset => asset.id)) } catch (error) { window.$message?.error(error.message); return }
  selectedHistoryIds.value = []
}

const locateAgentNodes = async ids => {
  const targets = nodes.value.filter(node => ids.includes(node.id))
  if (!targets.length) return
  nodes.value = nodes.value.map(node => ({ ...node, selected: ids.includes(node.id) }))
  await nextTick()
  const surface = document.querySelector('.vue-flow')?.getBoundingClientRect()
  if (!surface) return
  const panel = document.querySelector('.agent-panel')?.getBoundingClientRect()
  const bounds = targets.map(node => {
    const live = canvasFlow.findNode(node.id) || node
    const position = live.computedPosition || live.position
    return { x:position.x, y:position.y, width:live.dimensions?.width || 320, height:live.dimensions?.height || 240 }
  })
  const left = Math.min(...bounds.map(item => item.x)), top = Math.min(...bounds.map(item => item.y))
  const right = Math.max(...bounds.map(item => item.x + item.width)), bottom = Math.max(...bounds.map(item => item.y + item.height))
  const visibleLeft = 90, visibleRight = Math.max(visibleLeft + 100, (panel ? panel.left : surface.right) - surface.left - 24)
  const visibleTop = 64, visibleBottom = Math.max(visibleTop + 100, surface.height - 80)
  const zoom = Math.max(0.1, Math.min(1.2, (visibleRight - visibleLeft) / (right - left + 120), (visibleBottom - visibleTop) / (bottom - top + 120)))
  canvasFlow.setViewport({ x:(visibleLeft + visibleRight) / 2 - (left + right) / 2 * zoom, y:(visibleTop + visibleBottom) / 2 - (top + bottom) / 2 * zoom, zoom }, { duration:320 })
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
  if (workflow.savedGroup) {
    const restored = instantiateGroupWorkflow(workflow, startPosition)
    startBatchOperation()
    nodes.value = [...nodes.value, ...restored.nodes]
    edges.value = [...edges.value, ...restored.edges]
    endBatchOperation()
    nextTick(() => restored.nodes.forEach(node => updateNodeInternals(node.id)))
    return
  }
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
    targetHandle: edge.targetHandle || INPUT_HANDLE,
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

}

const targetInputHandle = (sourceId, targetId) => {
  const source = nodes.value.find(node => node.id === sourceId)
  const target = nodes.value.find(node => node.id === targetId)
  return target?.type === 'render' && source?.type === 'text' ? 'in-text' : INPUT_HANDLE
}

// ===== Flow 连线系统：语义标签 + 类型校验 + 快速新建 =====
// Flow connection system: semantic labels + type validation + quick add

// 内容节点类型：只有这些会走「展开 / 连通性重算」


// 连接合法性校验 | Connection validity check
const isValidConnection = (connection) => {
  return validateCanvasConnection(connection, nodes.value, edges.value).valid
}

/**
 * 创建菜单的**单一状态** | Create menu state
 *
 * 三种入口写同一份状态，共用一个菜单：
 * - `blank`：双击空白。落点就是鼠标处，列出全部类型 + 资源入口。
 * - `port` ：点端口 / 从端口拖到空白。落点按方向让开一个身位，可以再选上下分支。
 */
const menu = ref({
  visible: false,
  // 画布内的屏幕坐标（菜单左上角）
  x: 0,
  y: 0,
  mode: 'blank',
  direction: 'downstream',
  /** 要连给新节点的来源节点 id；双击空白时为空数组 */
  sources: [],
  flowX: 0,
  flowY: 0
})

const closeMenu = () => { menu.value = { ...menu.value, visible: false } }

/** 新节点落在锚点哪一侧；点击端口时没有落点，就按锚点尺寸摆 */
const QUICK_ADD_GAP = 100
const QUICK_ADD_FALLBACK_WIDTH = 520

/**
 * 该类型能不能收下某种上游。
 *
 * auto 节点用 `getAcceptLimit` 的最大容量口径 —— 模式已经不由用户选，就不能再拿
 * 某个具体模式（用户看不见）的容量去过滤菜单项。
 */
const canAcceptKind = (type, kind) =>
  getAcceptLimit({ type, data: { mode: AUTO_MODE } }, kind) > 0

/**
 * 创建菜单里能建的类型 | Types offered by the create menu
 *
 * 只留文本 / 图片 / 视频 / 室内渲染 / 图片对比。音频与 AI 任务仍保留在底层
 * （composer 建任务节点走的是 addNode，不经过这个菜单），只是不再从这里出现。
 * 数组顺序就是菜单里的排列顺序。
 *
 * 室内渲染与图片对比必须在这里 —— 它们没有别的入口（不像任务节点能由 composer
 * 建出来），从菜单里拿掉这个功能就没法新建了。
 */
const MENU_NODE_TYPES = Object.freeze(['text', 'image', 'video', 'render', 'compare'])

/**
 * 可新建的节点类型 | Options for the create menu
 *
 * 来源可能不止一个（框选之后「创建下游」是把整个选区接给新节点），
 * 所以下游要**每个来源都能连**才列出这个类型，避免建出来只连上一半。
 *
 * 不再预选 mode：新节点一律 auto，连上之后由上游构成推断。
 */
const buildQuickAddOptions = (sources, direction) => {
  const upstream = direction === 'upstream'
  if (!sources.length) return []
  return MENU_NODE_TYPES
    .filter(type => upstream || sources.every(node => canAcceptKind(type, node.type)))
    .map(type => ({
      type,
      name: nodeTypeLabels[type] || type
    }))
}

const menuSources = computed(() => {
  const ids = menu.value.sources || []
  return nodes.value.filter(node => ids.includes(node.id))
})

const menuOptions = computed(() => {
  if (menu.value.mode === 'blank') {
    return MENU_NODE_TYPES.map(type => ({
      type,
      name: nodeTypeLabels[type] || type
    }))
  }
  const options = buildQuickAddOptions(menuSources.value, menu.value.direction)
  if (menu.value.direction === 'upstream' && menuSources.value.length === 1 && menuSources.value[0].type === 'render') {
    const kind = connectStartHandleId.value === 'in-text' ? 'text' : 'image'
    return options.filter(option => option.type === kind)
  }
  return options
})

const menuTitle = computed(() => {
  if (menu.value.mode === 'blank') return '创建节点'
  const count = menuSources.value.length
  const side = menu.value.direction === 'upstream' ? '左侧创建上游节点' : '右侧创建下游节点'
  return count > 1 ? `从 ${count} 个节点在${side}` : `在${side}`
})

/** 端口 id → 方向：左口(in) 往上游，右口(out) 往下游 */
const resolveDirection = handleId => ([INPUT_HANDLE, 'in-text'].includes(handleId) ? 'upstream' : 'downstream')

/** 点击端口时新节点的落点：按锚点尺寸往对应方向让开一个身位 */
const anchorSidePosition = (anchor, direction) => {
  const width = anchor.measured?.width ?? anchor.width ?? QUICK_ADD_FALLBACK_WIDTH
  const height = anchor.measured?.height ?? anchor.height ?? 240
  const y = anchor.position.y + height / 2 - 120
  return direction === 'upstream'
    ? { x: anchor.position.x - width - QUICK_ADD_GAP, y }
    : { x: anchor.position.x + width + QUICK_ADD_GAP, y }
}

/** 松手处离按下处有多远；端口点击判定用它，见 onConnectEnd */
const PORT_CLICK_MAX_DRIFT = 8

const onConnectEnd = (params) => {
  // Vue Flow 1.48 的 connectEnd 直接传原生事件；兼容部分版本 { event, connection } 结构
  const event = params?.event || params
  const connection = params?.connection || null
  const mouseEvent = event?.clientX !== undefined ? event : null

  // 连接已成功建立（边数比拖动开始多）则不弹新建菜单 | Skip when a connection was created
  if (edges.value.length > (connectStartEdgeCount.value ?? edges.value.length)) return

  // 拖线起点信息：connectStart 记录优先，其次 connection 结构
  const sourceNodeId = connection?.source || connectStartNodeId.value
  const sourceHandleId = connection?.sourceHandle || connectStartHandleId.value
  const sourceNode = nodes.value.find(n => n.id === sourceNodeId)
  if (!sourceNode || !isContentNodeType(sourceNode.type)) return

  /**
   * 几乎没动 = **点端口**，不是拖线。
   *
   * 这个判定原来挂在 NodePort 自己往 handle DOM 上挂的 pointerup 监听里，但 handle 是
   * Vue Flow 渲染的、随节点重渲染会被换掉，监听器跟着失效 —— 实测就是 pointerdown
   * 压根到不了 handle 上，于是"点端口出菜单"偶发失灵。改成在 connectEnd 里按位移判断：
   * Vue Flow 自己的手势永远会走到这里，不依赖任何外部 DOM 节点。
   */
  const drift = (mouseEvent && connectStartPoint.value)
    ? Math.hypot(mouseEvent.clientX - connectStartPoint.value.x, mouseEvent.clientY - connectStartPoint.value.y)
    : Infinity
  const isPortClick = drift < PORT_CLICK_MAX_DRIFT

  // 拖线时松手落在节点 / 端口上（非法连接被拒绝的场景）不弹菜单。
  // 点端口时落点必然就在端口自己身上，不能照这个规则排除。
  const target = mouseEvent?.target
  if (!isPortClick && target?.closest?.('.vue-flow__handle, .vue-flow__node, .flow-select-menu')) return

  // 从哪个口出来决定新节点建在哪一侧。
  // 锚点若在多选里，就把整个选区一起接给新节点（v25 的「从选区创建下游」）。
  const direction = resolveDirection(sourceHandleId)
  const sources = selectedNodeIds.value.includes(String(sourceNodeId)) && selectedNodeIds.value.length > 1
    ? [...selectedNodeIds.value]
    : [String(sourceNodeId)]
  const sourceNodes = nodes.value.filter(node => sources.includes(String(node.id)))
  if (!buildQuickAddOptions(sourceNodes, direction).length) return
  if (!mouseEvent) return

  // 把选中还原回点之前：点 `+` 的语义是"从这里建节点"，不该顺手改选中。
  // 不还原的话卡片会当场从内容态展开，而且多选会被收缩成一个，
  // "一次给多个节点建下游"就没了。
  const keep = new Set(selectionBeforePortClick)
  if (nodes.value.some(node => node.selected !== keep.has(String(node.id)))) {
    nodes.value = nodes.value.map(node => ({ ...node, selected: keep.has(String(node.id)) }))
  }

  const canvasBounds = document.querySelector('.canvas-flow')?.getBoundingClientRect?.()
  // 点端口时没有"落点"，按锚点尺寸往对应方向让开一个身位；拖到空白则用松手处
  const dropPos = isPortClick
    ? anchorSidePosition(sourceNode, direction)
    : (() => {
        const at = screenToFlowCoordinate({ x: mouseEvent.clientX, y: mouseEvent.clientY })
        return { x: at.x - 196, y: at.y - 120 }
      })()

  menu.value = {
    visible: true,
    direction,
    sources,
    flowX: dropPos.x,
    flowY: dropPos.y,
    x: canvasBounds ? mouseEvent.clientX - canvasBounds.left : mouseEvent.clientX,
    y: canvasBounds ? mouseEvent.clientY - canvasBounds.top : mouseEvent.clientY,
    mode: 'port'
  }
}

/**
 * 点端口 → 在鼠标处弹新建菜单，由 onConnectEnd 判定（见那里的说明）。
 *
 * 模板上把 Vue Flow 自带的 connect-on-click 关掉了：那是「点端口进入待连状态、
 * 再点目标完成连线」，与本菜单抢同一个手势 —— 菜单还没选完，Vue Flow 那边
 * 已经挂着半个待连边。拖拽连线不受影响。
 */

// 记录拖动开始时的源端口、按下位置与边数，用于区分"连上了"/"点端口"/"拖到空白"
const connectStartEdgeCount = ref(null)
const connectStartNodeId = ref(null)
const connectStartHandleId = ref(null)
const connectStartPoint = ref(null)

/** 点端口前的选中状态：点端口（`+`）不该改变选中，见 onConnectEnd */
let selectionBeforePortClick = []

/**
 * 必须在 **pointerdown 的捕获阶段**记，不能等 connectStart。
 * Vue Flow 自己的 mousedown 处理器会先把选中改掉（落在这个节点上就把它选上、把别的取消），
 * 等 connectStart 再记已经是被改过的了 —— 之前的版本就是记晚了，多选一进去就被清空。
 */
const rememberSelectionOnPort = (event) => {
  if (event.target?.closest?.('.vue-flow__handle')) {
    selectionBeforePortClick = [...selectedNodeIds.value]
  }
}

const onConnectStart = (params) => {
  connectStartEdgeCount.value = edges.value.length
  connectStartNodeId.value = params?.nodeId || null
  connectStartHandleId.value = params?.handleId || null
  const event = params?.event
  connectStartPoint.value = event && event.clientX !== undefined
    ? { x: event.clientX, y: event.clientY }
    : null
  closeMenu()
}

/** 菜单里选中一个类型：建节点，端口来的还要顺手连上 */
const handleMenuSelect = (option) => {
  const state = menu.value
  const sources = state.mode === 'port' ? menuSources.value : []
  if (state.mode === 'port' && !sources.length) {
    closeMenu()
    return
  }

  // 上下分支只挪纵向：两个卡高左右，保证不叠在一起
  /**
   * 从同一个端口连建第二个、第三个节点时，落点要往下错开。
   * 落点坐标是按锚点算的固定值，不错开的话每建一个都叠在同一个位置上 ——
   * 以前靠"向上/向下分支"手动选，现在没有那个了，就得自己让开。
   */
  const siblings = state.mode === 'port' && !state.atDropPosition
    ? (state.direction === 'upstream'
        ? edges.value.filter(edge => edge.target === state.sources[0]).length
        : edges.value.filter(edge => edge.source === state.sources[0]).length)
    : 0
  const position = { x: state.flowX, y: state.flowY + siblings * 320 }

  // 双击空白建节点：不连线，建完就完事
  if (state.mode === 'blank') {
    const blankId = addNode(option.type, position)
    nodes.value = nodes.value.map(node => ({ ...node, selected: node.id === blankId }))
    const blankZ = Math.max(0, ...nodes.value.map(node => node.zIndex || 0))
    updateNodeMeta(blankId, { zIndex: blankZ + 1 })
    setTimeout(() => updateNodeInternals(blankId), 50)
    closeMenu()
    return
  }

  const upstream = state.direction === 'upstream'

  // 旧存档里显式选了模式的节点，如果收不下这类上游就替它换一个能收的模式。
  // auto 节点不做这件事：模式由上游推断，钉死成"能收第一条边"的那个，后面第二条就对不上了。
  // 多来源时也不做 —— 几个来源互相换模式会打架。
  let anchorMode = null
  const anchor = sources.length === 1 ? sources[0] : null
  if (upstream && anchor && anchor.data?.mode !== AUTO_MODE) {
    const accepts = (NODE_MODES[anchor.type]?.[anchor.data?.mode]?.accepts?.[option.type] || 0) > 0
    if (!accepts) {
      anchorMode = findModeAccepting(anchor.type, option.type)
      if (!anchorMode) {
        closeMenu()
        window.$message?.warning(`「${anchor.data?.label || anchor.type}」没有能接收${option.name}的模式`)
        return
      }
    }
  }

  const nodeId = addNode(option.type, position)
  // 只选中新节点。展开态不再往节点上写：现在展开与否是选中状态的派生物
  // （useFocusMode），写 expanded 只会留下一份没人读的旧字段。
  nodes.value = nodes.value.map(node => ({ ...node, selected: node.id === nodeId }))

  // 校验读的是节点当前模式，所以「切模式」必须发生在校验之前
  const originalMode = anchor?.data?.mode
  if (anchorMode) {
    editNode(anchor.id, { mode: anchorMode })
    renumberNodeRefs(anchor.id)
  }

  // 逐个来源试连连；能连上的都连上，一个都连不上才算失败
  let connected = 0
  let firstReason = ''
  sources.forEach((sourceNode) => {
    const source = upstream ? nodeId : sourceNode.id
    const target = upstream ? sourceNode.id : nodeId
    const validation = validateCanvasConnection({ source, target }, nodes.value, edges.value)
    if (!validation.valid) {
      if (!firstReason) firstReason = validation.reason
      return
    }
    // 引用顺序接着已有的排下去，别把新边插到别人前面
    const nextOrder = Math.max(0, ...inEdges(target).map(edge => Number(edge.data?.order) || 0)) + 1
    addEdge({
      source,
      target,
      sourceHandle: OUTPUT_HANDLE,
      targetHandle: targetInputHandle(source, target),
      type: 'flowEdge',
      data: { order: nextOrder }
    })
    connected += 1
  })

  if (!connected) {
    removeNode(nodeId)
    // 没接上就别把来源的模式留在改过的状态
    if (anchorMode && anchor) {
      editNode(anchor.id, { mode: originalMode })
      renumberNodeRefs(anchor.id)
    }
    closeMenu()
    window.$message?.warning(firstReason || `这个${option.name}节点接不上选中的上游`)
    return
  }

  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))
  updateNodeMeta(nodeId, { zIndex: maxZIndex + 1 })
  setTimeout(() => updateNodeInternals(nodeId), 50)
  closeMenu()
}

/** 从整个选区在右侧创建下游：多选工具条上那个「创建下游」 */
const createDownstreamFromSelection = () => {
  const selected = selectedCanvasNodes.value
  if (!selected.length) return
  const right = Math.max(...selected.map(node => node.position.x + (node.measured?.width || 320)))
  const centerY = selected.reduce((sum, node) => (
    sum + node.position.y + (node.measured?.height || 200) / 2
  ), 0) / selected.length

  // flow → 画布内的屏幕坐标（菜单是绝对定位在画布上的）
  const zoom = viewport.value?.zoom || 1
  const screenX = right * zoom + (viewport.value?.x || 0) + 24
  const screenY = centerY * zoom + (viewport.value?.y || 0)

  menu.value = {
    visible: true,
    mode: 'port',
    direction: 'downstream',
    sources: selected.map(node => node.id),
    flowX: right + 120,
    flowY: centerY - 160,
    x: Math.max(16, screenX),
    y: Math.max(16, screenY)
  }
}

// Handle connection | 处理连接
const selectionWire = ref(null)
let selectionWireController = null
const startSelectionConnection = event => {
  if (event.button !== 0) return
  const sources = selectedCanvasNodes.value.filter(node => node.type === 'image').map(node => node.id)
  if (!sources.length) return
  const canvasRect = document.querySelector('.canvas-flow').getBoundingClientRect()
  const origin = { x: event.clientX, y: event.clientY }
  const starts = sources.map(id => {
    const rect = Array.from(document.querySelectorAll('.vue-flow__node')).find(el => el.dataset.id === id)?.getBoundingClientRect()
    return rect ? { x: rect.right - canvasRect.left, y: (rect.top + rect.bottom) / 2 - canvasRect.top } : null
  }).filter(Boolean)
  selectionWireController?.abort()
  const controller = new AbortController()
  selectionWireController = controller
  window.addEventListener('pointermove', move => {
    selectionWire.value = { starts, x: move.clientX - canvasRect.left, y: move.clientY - canvasRect.top }
  }, { signal: controller.signal })
  window.addEventListener('pointerup', release => {
    controller.abort()
    selectionWire.value = null
    if (Math.hypot(release.clientX-origin.x, release.clientY-origin.y) < 5) {
      createDownstreamFromSelection()
      return
    }
    const targetElement = document.elementFromPoint(release.clientX, release.clientY)?.closest('.vue-flow__node')
    const target = targetElement?.dataset.id
    if (!target) {
      const sourceNodes = nodes.value.filter(node => sources.includes(node.id))
      if (!buildQuickAddOptions(sourceNodes, 'downstream').length) return
      const position = screenToFlowCoordinate({ x: release.clientX, y: release.clientY })
      menu.value = {
        visible: true,
        mode: 'port',
        direction: 'downstream',
        sources,
        atDropPosition: true,
        flowX: position.x,
        flowY: position.y - 120,
        x: release.clientX - canvasRect.left,
        y: release.clientY - canvasRect.top
      }
      return
    }
    if (sources.includes(target)) return
    const candidates = sources.filter(source => !edges.value.some(edge => edge.source === source && edge.target === target))
    if (!candidates.length) return
    let proposed = [...edges.value]
    for (const source of candidates) {
      const validation = validateCanvasConnection({ source, target }, nodes.value, proposed)
      if (!validation.valid) { window.$message?.warning(validation.reason); return }
      proposed.push({ source, target })
    }
    startBatchOperation()
    candidates.forEach(source => onConnect({ source, target }))
    endBatchOperation()
  }, { once: true, signal: controller.signal })
  window.addEventListener('pointercancel', () => { controller.abort(); selectionWire.value = null }, { once: true, signal: controller.signal })
}
onBeforeUnmount(() => selectionWireController?.abort())

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
    targetHandle: targetInputHandle(params.source, params.target),
    type: 'flowEdge',
    data: { order: nextOrder }
  })
}
const composerRef = ref(null)
const composerVisible = ref(false)
const canvasWindowWidth = ref(window.innerWidth)
// 临时让位不写入 panelWidth，收起输入框后自然恢复用户保存的宽度。
const agentDisplayWidth = computed(() => {
  if (!agent.panelOpen || !composerVisible.value) return agent.panelWidth
  const composerWidth = Math.min(700, canvasWindowWidth.value - 190)
  return Math.min(agent.panelWidth, Math.max(330, (canvasWindowWidth.value - composerWidth) / 2 - 24))
})
const referenceNodeForEvent = event => {
  if (!event.ctrlKey || event.target?.closest?.('button, input, textarea, .vue-flow__handle')) return null
  const id = event.target?.closest?.('.vue-flow__node')?.getAttribute('data-id')
  return nodes.value.find(node => String(node.id) === id && node.type === 'image' && node.data?.url)
}
const onReferencePointerDown = event => {
  if (event.button !== 0) return
  const node = referenceNodeForEvent(event)
  if (!node) return
  event.preventDefault(); event.stopPropagation()
  composerRef.value?.addImageReference(node.id)
}
const onReferenceClick = event => {
  const node = referenceNodeForEvent(event)
  if (!node) return
  event.preventDefault(); event.stopPropagation()
}
const onNodeClick = (event) => {
  // 点端口（`+`）只是"从这里建节点"，不该改变选中。
  // 否则卡片会从内容态展开、位置补偿一动，端口就跑掉了 —— 菜单看着像在跳，也很难点。
  // 光在 connectEnd 里还原还不够：随后的 click 事件会再选一次，这里必须也挡住。
  if (event.event?.target?.closest?.('.vue-flow__handle')) return

  // 点节点＝注意力换到节点上，钉住的剪刀收起来
  clearEdgeFocus()

  // Selection itself is handled by Vue Flow. Rewriting `selected` here used
  // to run after Vue Flow and collapse Ctrl-selection (or toggle Shift twice).
}

// 受控节点同步后，已有 DOM 的尺寸归零不会必然触发 ResizeObserver。
// 补量只处理缺少尺寸的节点，避免连线仍在但节点 visibility:hidden。
watch(() => nodes.value.filter(node => !node.hidden &&
  (!node.dimensions?.width || !node.dimensions?.height)).map(node => node.id).join('|'),
  async (ids) => {
    if (!ids) return
    await nextTick()
    updateNodeInternals(ids.split('|'))
  }, { flush: 'post' })

// NodeFrame 的内容尺寸不再随选中状态变化，工具栏是绝对定位。
// 不在选中后的 nextTick 中重写 position：该回调会与 Vue Flow 拖动竞争，
// 使用过期坐标覆盖鼠标位置。节点位置统一交给拖动处理。

// Handle viewport change | 处理视口变化
const handleViewportChange = (newViewport) => {
  updateViewport(newViewport)
  refreshSelectionOverlay()
}

const alignmentLines = ref([])
let alignmentMovingIds = new Set()
let alignmentAlt = false
const trackAlignmentAlt = event => { alignmentAlt = event.altKey }
const snapDragChanges = changes => {
  if (!alignmentMovingIds.size || alignmentAlt) return changes
  const positions = changes.filter(change => change.type === 'position' && change.position && alignmentMovingIds.has(change.id))
  if (!positions.length) return changes
  const container = document.querySelector('.canvas-flow')
  if (!container) return changes
  const zoom = viewport.value.zoom || 1
  const moving = [], stationary = []
  for (const element of container.querySelectorAll('.vue-flow__node')) {
    const id = element.getAttribute('data-id')
    const node = nodes.value.find(item => item.id === id)
    if (!node) continue
    const box = (element.querySelector('.flow-card') || element).getBoundingClientRect()
    const change = positions.find(item => item.id === id)
    const dx = change ? (change.position.x - node.position.x) * zoom : 0
    const dy = change ? (change.position.y - node.position.y) * zoom : 0
    const rect = { left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy }
    if (alignmentMovingIds.has(id)) {
      if (change && !alignmentMovingIds.has(node.parentNode)) moving.push(rect)
    } else stationary.push(rect)
  }
  const guides = alignmentGuides(moving, stationary, 10)
  const dx = (guides.find(guide => guide.axis === 'x')?.offset || 0) / zoom
  const dy = (guides.find(guide => guide.axis === 'y')?.offset || 0) / zoom
  return changes.map(change => {
    const node = nodes.value.find(item => item.id === change.id)
    return positions.includes(change) && !alignmentMovingIds.has(node?.parentNode)
      ? { ...change, position: { x: change.position.x + dx, y: change.position.y + dy } } : change
  })
}
let alignmentFrame = 0
const stopAlignmentGuides = () => {
  alignmentMovingIds.clear()
  window.removeEventListener('keydown', trackAlignmentAlt)
  window.removeEventListener('keyup', trackAlignmentAlt)
  alignmentAlt = false
  cancelAnimationFrame(alignmentFrame)
  alignmentFrame = 0
  alignmentLines.value = []
}
const startAlignmentGuides = moving => {
  stopAlignmentGuides()
  const ids = new Set(moving.map(node => node.id))
  // Children of a moving group are moving too, never stationary targets.
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes.value) if (ids.has(node.parentNode) && !ids.has(node.id)) { ids.add(node.id); changed = true }
  }
  alignmentMovingIds = ids
  window.addEventListener('keydown', trackAlignmentAlt)
  window.addEventListener('keyup', trackAlignmentAlt)
  const tick = () => {
    const container = document.querySelector('.canvas-flow')
    if (!container) { stopAlignmentGuides(); return }
    const origin = container.getBoundingClientRect()
    const movingRects = [], stationaryRects = []
    for (const element of container.querySelectorAll('.vue-flow__node')) {
      const id = element.getAttribute('data-id')
      const card = element.querySelector('.flow-card') || element
      const box = card.getBoundingClientRect()
      if (!box.width || !box.height) continue
      const rect = { left: box.left - origin.left, right: box.right - origin.left,
        top: box.top - origin.top, bottom: box.bottom - origin.top }
      ;(ids.has(id) ? movingRects : stationaryRects).push(rect)
    }
    alignmentLines.value = alignmentGuides(movingRects, stationaryRects)
    alignmentFrame = requestAnimationFrame(tick)
  }
  alignmentFrame = requestAnimationFrame(tick)
}
onBeforeUnmount(stopAlignmentGuides)

const handleNodeDragStart = ({ node, nodes: draggedNodes, event }) => {
  startAlignmentGuides(draggedNodes?.length ? draggedNodes : [node])
  alignmentAlt = !!event?.altKey
  startBatchOperation()
  draggedGroupMembers.clear()
  dragGroupBounds.clear()
  const moving = draggedNodes?.length ? draggedNodes : [node]
  const movingIds = new Set(moving.map(item => item.id))
  for (const item of moving) {
    const member = nodes.value.find(candidate => candidate.id === item.id)
    if (!member || member.type === 'group' || movingIds.has(member.parentNode)) continue
    draggedGroupMembers.add(member.id)
    if (!member.parentNode) continue
    const group = nodes.value.find(candidate => candidate.id === member.parentNode)
    if (!group) continue
    draggedGroupMembers.add(member.id)
    dragGroupBounds.set(group.id, { x: group.position.x, y: group.position.y,
      width: parseFloat(group.style?.width) || group.dimensions?.width || 0,
      height: parseFloat(group.style?.height) || group.dimensions?.height || 0 })
  }
}
const handleNodeDragStop = () => {
  stopAlignmentGuides()
  const allowDetach = true
  // Engine release patches finish before changing parent coordinates.
  requestAnimationFrame(() => {
    const previousParents = new Map(nodes.value.filter(node => draggedGroupMembers.has(node.id) && node.parentNode).map(node => [node.id, node.parentNode]))
    nodes.value = releaseGroupMembers(nodes.value, draggedGroupMembers, dragGroupBounds, allowDetach)
    nodes.value = joinDroppedGroupMembers(nodes.value, draggedGroupMembers, previousParents)
    dragGroupBounds.clear()
    draggedGroupMembers.clear()
    nodes.value = fitNodeGroups(nodes.value)
    endBatchOperation()
    refreshSelectionOverlay()
  })
}

// Handle edges change | 处理边变化
// 边被删掉之后已经查不到它的目标了，所以平时就要记下 EdgeID → 目标节点。
const edgeTargets = new Map()
watch(edges, (list) => { list.forEach(edge => edgeTargets.set(edge.id, edge.target)) }, { immediate: true })

const onEdgesChange = (changes) => {
  onEdgeSelectionChange(changes)
  const removals = changes.filter(change => change.type === 'remove')
  if (!removals.length) return
  removals.forEach(change => removeEdge(change.id))

  // 被删的边可能带着引用绑定：目标节点要重排编号、正文里的 token 也要同步改写
  const affected = [...new Set(removals.map(change => edgeTargets.get(change.id)).filter(Boolean))]
  nextTick(() => {
    normalizeEdgeOrders()
    affected.forEach((targetId) => {
      if (!nodes.value.some(node => node.id === targetId)) return
      renumberNodeRefs(targetId)
    })
    manualSaveHistory()
  })
}

// Handle pane click | 处理画布点击
// 取消选中即收起（焦点态是选中状态的派生物），这正是"点空白回到内容态"的行为。
const onPaneClick = () => {
  closeMenu()
  // 点空白：钉住的剪刀跟着收起来（选中的连线同理）
  clearEdgeFocus()
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
    if (!bounds) return
    const flowPos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    menu.value = {
      visible: true,
      mode: 'blank',
      direction: 'downstream',
      sources: [],
      // 新节点左上角：让鼠标大致落在卡片上半部，而不是压住标题
      flowX: flowPos.x - 100,
      flowY: flowPos.y - 60,
      x: Math.max(16, Math.min(event.clientX - bounds.left + 12, bounds.width - 300)),
      y: Math.max(16, Math.min(event.clientY - bounds.top + 12, bounds.height - 420))
    }
  }
}

// Canvas undo / redo shortcuts | 画布撤销、重做快捷键
const handleAgentToggleShortcut = (event) => handleAgentShortcut(event, () => agent.togglePanel(), agentShortcut.value)

const handleCanvasShortcut = (event) => {
  const target = event.target

  // Esc 关掉新建菜单：放在输入框判断之前，因为光标多半还在提示词框里
  if (event.key === 'Escape' && menu.value.visible) {
    closeMenu()
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
        
        // Execute the workflow | 执行工作流
        await executeWorkflow(workflowParams, { x: baseX, y: baseY })
        
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
  canvasWindowWidth.value = window.innerWidth
  isMobile.value = window.innerWidth < 768
}

// Load project by ID | 根据ID加载项目
const loadProjectById = (projectId) => {
  // Update flow key to force VueFlow re-render | 更新 key 强制 VueFlow 重新渲染
  flowKey.value = Date.now()

  // 换项目就把智能体收掉：它这一轮的上下文快照属于上一张画布
  agent.closePanel()
  agent.cancel()


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
  window.addEventListener('keydown', handleAgentToggleShortcut, true)
  window.addEventListener('ling-canvas:open-asset-picker', onOpenAssetPicker)
  document.addEventListener('dblclick', onCanvasDoubleClick, true)
  document.addEventListener('pointerdown', rememberSelectionOnPort, true)

  // Save before window/tab close | 窗口/标签页关闭前保存
  handleBeforeUnload = (e) => {
    if (isDestroyingWindow) return
    saveProject()
  }
  window.addEventListener('beforeunload', handleBeforeUnload)

  // Tauri can actually await the queued atomic file write before destroying
  // the window. Browser beforeunload cannot await IndexedDB and remains only a
  // best-effort fallback for web development.
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const appWindow = getCurrentWindow()
      closeRequestUnlisten = await appWindow.onCloseRequested(async event => {
        if (isDestroyingWindow) return
        event.preventDefault()
        // 智能体进程要在窗口销毁前收掉。Rust 侧销毁时也会兜底 kill_all，
        // 这里先发一次是为了让正在跑的那一轮尽早停，不白等它跑完。
        agent.cancel()
        saveProject()
        const [projectSaved, mediaSaved, chatsSaved] = await Promise.all([
          flushProjectSaves(),
          flushCanvasMediaSaves(),
          agent.persistHistory(),
          // 缩略图也排空，但**不参与下面的失败判断**：它是派生数据，
          // 没写完不该阻止用户关闭窗口。3 秒上限覆盖"刚编辑完就关窗"这个窗口。
          Promise.race([
            flushProjectThumbnails(),
            new Promise(resolve => setTimeout(resolve, 3000))
          ])
        ])
        if (!projectSaved || !mediaSaved || !chatsSaved) {
          window.$message?.error('项目或图片尚未保存成功，已取消关闭窗口')
          return
        }
        isDestroyingWindow = true
        try {
          // Destroy only after both persistence queues have drained. The
          // explicit capability keeps ACL enforcement from rejecting this
          // final, non-recursive shutdown step.
          await appWindow.destroy()
        } catch (error) {
          isDestroyingWindow = false
          console.error('[ProjectStorage] window destroy failed:', error)
          window.$message?.error('关闭窗口失败，请重试')
        }
      })
    } catch (err) {
      console.warn('[ProjectStorage] close-save hook unavailable:', err)
    }
  }

  // Initialize projects store | 初始化项目存储
  await initProjectsStore()

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
  closeMenu()
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

const handleAssetPick = async (items) => {
  if (!items?.length) return
  // 从节点里的「素材库」按钮打开时，目标就是那个节点，不再新建
  const targetId = assetTargetNodeId.value
  assetTargetNodeId.value = ''
  if (targetId && fillNodeWithAsset(targetId, items[0])) {
    saveProject()
    showAssetPicker.value = false
    return
  }

  const center = screenToFlowCoordinate({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  showAssetPicker.value = false
  const ratios = await Promise.all(items.map(async item => {
    try {
      const url = await resolveAssetUrl(item.relativePath)
      return await new Promise(resolve => {
        const image = new Image()
        const timer = setTimeout(() => finish(0), 5000)
        const finish = ratio => {
          clearTimeout(timer)
          image.onload = image.onerror = null
          resolve(ratio)
        }
        image.onload = () => finish(image.naturalWidth / image.naturalHeight)
        image.onerror = () => finish(0)
        image.src = url
      })
    } catch { return 0 }
  }))
  const positions = layoutAssetImages(ratios, center)
  startBatchOperation()
  try { items.forEach((item, index) => {
    addAssetNode({
      relativePath: item.relativePath,
      name: item.name,
      position: positions[index]
    })
  }) } finally { endBatchOperation() }
  // 与 handleTauriDragDrop 一致：节点建完显式落盘
  saveProject()
  showAssetPicker.value = false
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
      const imported = []

      startBatchOperation()
      try { for (const [index, filePath] of imagePaths.entries()) {
        try {
          // Copy into project storage so the node does not depend on the source path | 复制进项目存储，不依赖原文件路径
          const image = await invoke('read_dropped_image', { path: filePath })
          const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(filePath)
          const pseudoFile = { type: isVideo ? 'video/mp4' : 'image/png', name: `${image.fileName}` }
          // 落在节点上就地填充；落在空白处新建
          if (index === 0 && droppedOnNode && fillNodeWithFile(droppedOnNode, pseudoFile, image.dataUrl)) continue
          imported.push({ file: pseudoFile, dataUrl: image.dataUrl,
            ratio: isVideo ? 16 / 9 : await measureImportedImage(image.dataUrl) })
        } catch (err) {
          console.error('[DragDrop] Failed to import file:', filePath, err)
          window.$message?.error(`文件导入失败：${String(err)}`)
        }
      }
      addImportedMediaGrid(imported, screenToFlowCoordinate({ x: clientX, y: clientY }))
      } finally { endBatchOperation() }
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
  // 室内渲染的输入是「视角」，由连线决定编号与顺序，塞一张散图进去没有槽位可落
  if (node.type === 'render') {
    window.$message?.warning('室内渲染不接受直接拖入的素材，请把空间截图连到它左侧的输入口')
    return true
  }
  // 图片对比的前后由连线先后决定，同理：素材得是画布上的节点，连进去
  if (node.type === 'compare') {
    window.$message?.warning('图片对比不接受直接拖入的素材，请把两张图连到它左侧的输入口')
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
  const type = file.type.startsWith('video/') ? 'video'
    : file.type.startsWith('audio/') ? 'audio'
      : 'image'
  const fallback = type === 'video' ? '拖入视频' : type === 'audio' ? '拖入音频' : '拖入图片'
  const name = file.name.replace(/\.[^.]+$/, '') || fallback
  const nodeId = stampImageNode(addNode(type, position, { label: name }))
  setNodeMedia(nodeId, { url: dataUrl, base64: dataUrl, fileName: name })
  return nodeId
}

const measureImportedImage = url => new Promise(resolve => {
  const image = new Image()
  const finish = ratio => {
    clearTimeout(timer)
    image.onload = image.onerror = null
    resolve(ratio)
  }
  const timer = setTimeout(() => finish(0), 5000)
  image.onload = () => finish(image.naturalWidth / image.naturalHeight)
  image.onerror = () => finish(0)
  image.src = url
})

const addImportedMediaGrid = (items, origin) => {
  const positions = layoutAssetImages(items.map(item => item.ratio), origin)
  items.forEach((item, index) => addMediaNode({ ...item, position: positions[index] }))
}

/** composer 的 ＋：选文件 → 落在视口中心 */
const handleComposerAttach = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,video/*,audio/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const rect = document.querySelector('.canvas-flow')?.getBoundingClientRect?.()
    const center = rect
      ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    const dataUrl = await fileToDataUrl(file)
    addMediaNode({ file, dataUrl, position: { x: center.x - 160, y: center.y - 160 } })
    saveProject()
  }
  input.click()
}

const onDrop = async (event) => {
  isDragOverCanvas.value = false
  const files = Array.from(event.dataTransfer?.files || []).filter(isMediaFile)
  if (!files.length) return

  const droppedOnNode = nodeIdAtPoint(event.clientX, event.clientY)
  const imported = []
  startBatchOperation()
  try { for (const [index, file] of files.entries()) {
    try {
      const dataUrl = await fileToDataUrl(file)
      // 落在节点上就地填充；落在空白处建新节点（多文件时第一个落节点、其余各自建节点）
      if (index === 0 && droppedOnNode && fillNodeWithFile(droppedOnNode, file, dataUrl)) continue
      imported.push({ file, dataUrl, ratio: file.type.startsWith('video/') ? 16 / 9 : await measureImportedImage(dataUrl) })
    } catch (err) {
      console.error('[DragDrop] 导入失败:', file.name, err)
      window.$message?.error(`导入失败：${file.name}`)
    }
  }
  addImportedMediaGrid(imported, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
  } finally { endBatchOperation() }
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
  window.removeEventListener('keydown', handleAgentToggleShortcut, true)
  window.removeEventListener('ling-canvas:open-asset-picker', onOpenAssetPicker)
  document.removeEventListener('dblclick', onCanvasDoubleClick, true)
  document.removeEventListener('pointerdown', rememberSelectionOnPort, true)

  // Clean up beforeunload listener | 清理窗口关闭前保存监听器
  if (handleBeforeUnload) {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    handleBeforeUnload = null
  }
  if (closeRequestUnlisten) {
    closeRequestUnlisten()
    closeRequestUnlisten = null
  }

  // Clean up Tauri native drag-drop listener | 清理 Tauri 原生拖拽监听器
  if (canvasDragDropUnlisten) {
    canvasDragDropUnlisten()
    canvasDragDropUnlisten = null
  }
  window.removeEventListener('dragover', preventWindowDrop)
  window.removeEventListener('drop', preventWindowDrop)
  // Route changes still need a final save. Native window close already saved
  // and flushed before destroy; queuing another IPC write while the WebView is
  // disappearing can surface as an unhandled error in the fatal overlay.
  if (!isDestroyingWindow) saveProject()
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

.selection-group-outline { position: absolute; z-index: 15; pointer-events: none; border: 1px solid rgb(140 140 145 / 65%); border-radius: 12px; background: rgb(120 120 125 / 14%); }
.selection-output-port { position: absolute; right: -12px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-secondary); pointer-events: auto; cursor: crosshair; touch-action: none; }
.selection-wire-preview { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 16; pointer-events: none; }
.selection-wire-preview path { fill: none; stroke: #92929e; stroke-width: 1.5; stroke-dasharray: 5 4; }
.selection-action-bar { position: absolute; left: 50%; top: -10px; display: flex; align-items: center; gap: 2px; min-height: 38px; transform: translate(-50%, -100%); border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--bg-secondary) 94%, transparent); padding: 4px; box-shadow: 0 8px 22px rgb(15 23 42 / 10%), 0 1px 2px rgb(15 23 42 / 6%); backdrop-filter: blur(14px); pointer-events: auto; white-space: nowrap; }
.selection-action-bar button { border: 1px solid transparent; border-radius: 8px; color: var(--text-secondary); font-size: 12.5px; font-weight: 500; line-height: 1; transition: color .15s ease, background .15s ease, border-color .15s ease, transform .15s ease; }
.selection-action { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; padding: 6px 9px; }
.selection-action:hover { background: color-mix(in srgb, var(--text-primary) 6%, transparent); color: var(--text-primary); }
.selection-action:active { transform: translateY(1px); }
.selection-action-divider { width: 1px; height: 18px; margin: 0 3px; background: color-mix(in srgb, var(--border-color) 78%, transparent); }
.selection-action.is-primary { border-color: rgb(128 128 132 / 28%); background: rgb(128 128 132 / 12%); color: var(--text-primary); }
.selection-action.is-primary:hover { border-color: rgb(160 160 165 / 40%); background: rgb(128 128 132 / 22%); color: var(--text-primary); }
.dark .selection-action-bar { border-color: rgb(255 255 255 / 9%); background: rgb(37 37 39 / 88%); box-shadow: 0 10px 28px rgb(0 0 0 / 34%); }
.dark .selection-action-divider { background: rgb(255 255 255 / 10%); }
.dark .selection-action.is-primary { color: #e4e4e7; border-color: #48484c; background: #343437; }
.selection-action svg, .selection-layout-popover svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
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
.canvas-alignment-guides { position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: hidden; }
.alignment-line-x { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(160, 170, 185, .65); }
.alignment-line-y { position: absolute; left: 0; right: 0; height: 1px; background: rgba(160, 170, 185, .65); }
.canvas-flow .vue-flow__node { cursor: grab; }
.canvas-flow .vue-flow__node.dragging { cursor: grabbing; }
.canvas-flow .vue-flow__node input,
.canvas-flow .vue-flow__node textarea,
.canvas-flow .vue-flow__node [contenteditable="true"],
.canvas-flow .vue-flow__node .cursor-text { cursor: text !important; }
.canvas-flow .vue-flow__node button,
.canvas-flow .vue-flow__node a,
.canvas-flow .vue-flow__node select,
.canvas-flow .vue-flow__node summary,
.canvas-flow .vue-flow__node [role="button"],
.canvas-flow .vue-flow__node input:is([type="checkbox"], [type="radio"], [type="range"]),
.canvas-flow .vue-flow__node label:has(input:is([type="checkbox"], [type="radio"])) { cursor: pointer !important; }
.canvas-flow .vue-flow__node :is(button, select, input, textarea):disabled,
.canvas-flow .vue-flow__node [role="button"][aria-disabled="true"] { cursor: not-allowed !important; }
.canvas-flow .vue-flow__node .flow-toolbar { cursor: default; }
.canvas-flow .vue-flow__node .vue-flow__handle { cursor: crosshair !important; }
.canvas-flow .vue-flow__node .group-resize.left,
.canvas-flow .vue-flow__node .group-resize.right { cursor: ew-resize !important; }
.canvas-flow .vue-flow__node .group-resize.top,
.canvas-flow .vue-flow__node .group-resize.bottom { cursor: ns-resize !important; }

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
.history-batch-actions button.primary { border-color: var(--accent-color); background: var(--accent-color); color: var(--accent-on); }
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
.history-image-card.selected .history-select-mark { border-color: var(--accent-color); background: var(--accent-color); color: var(--accent-on); }
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
