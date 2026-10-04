<template>
  <!-- 智能体面板 | Canvas agent drawer
       从右侧滑入的固定抽屉。打开方式有两个：左侧栏的「智能体」图标，或 Alt+A。

       与 WorkflowPanel 的两处刻意不同：
       1. **不做点击外部关闭**。这是个常驻抽屉，会和画布交互并存；点一下画布就把它收掉，
          用户每选一个节点都得重新唤起。
       2. **整体吃下键盘事件**（根节点 @keydown.stop）。否则焦点在面板按钮上时按 Delete/撤销，
          会被画布的全局快捷键接走，"删面板里的东西"变成了"删画布上的节点"。 -->
  <Transition name="agent-slide">
    <aside
      v-if="visible"
      class="agent-panel"
      :class="{ 'is-resizing': resizing }"
      :style="{ width: `min(${agent.panelWidth}px, 100vw)` }"
      @keydown.stop="swallowKeydown"
    >
      <!-- 左边缘拖宽。刻意比边框宽一点并探出去 3px，好抓 -->
      <div class="agent-resizer" title="拖动调整宽度" @pointerdown.stop="startResize"></div>


      <div ref="scrollEl" class="agent-messages">
        <div v-if="!agent.messages.length" class="agent-empty">
          <p class="agent-empty-title">问我关于这张画布的任何事</p>
          <p class="agent-empty-hint">我能看到当前选中的节点、它们的参数，以及画布上的连线关系。</p>
        </div>

        <div
          v-for="message in agent.messages"
          :key="message.id"
          class="agent-bubble"
          :class="message.role"
        >
          <!-- 这一轮发出去的图。用降采样后的小图，不为 60px 的展示去解码大图 -->
          <div v-if="message.images?.length" class="agent-bubble-images">
            <img
              v-for="(src, index) in message.images"
              :key="index"
              class="agent-bubble-thumb"
              :src="src"
              :alt="`图片 ${index + 1}`"
            >
          </div>
          <div class="agent-bubble-body" @copy="copySelectedText">{{ message.content
            }}<span v-if="message.streaming" class="agent-caret"></span></div>
          <div v-if="message.role === 'assistant' && (message.content || message.skills?.length)" class="agent-reply-footer">
            <button v-if="message.content && !message.streaming" type="button" class="agent-copy-btn" @click="copyMessage(message.content)">复制文案</button>
            <span v-if="message.skills?.length" class="agent-reply-skills" :title="`技能调用：${message.skills.join('、')}`">技能：{{ message.skills.join('、') }}</span>
          </div>
          <!-- 思考 / 调技能期间模型不吐字，这一段靠状态行告诉用户它没卡死 -->
          <div v-if="message.status" class="agent-bubble-status">
            <span class="agent-status-dot"></span>{{ message.status }}
          </div>
        </div>
      </div>

      <!-- 出错时才浮出 CLI 路径设置：绝大多数情况 PATH 里就有 claude，不该常驻占地方 -->
      <div v-if="agent.error" class="agent-error">
        <p class="agent-error-text">{{ agent.error }}</p>
        <label class="agent-cli-field">
          <span>Claude CLI 路径（留空则用 PATH 里的 claude）</span>
          <input
            class="agent-cli-input"
            :value="cliPathDraft"
            placeholder="C:\\Users\\你\\AppData\\Roaming\\npm\\claude.cmd"
            @input="cliPathDraft = $event.target.value"
            @change="agent.setCliPath(cliPathDraft)"
          >
        </label>
      </div>

      <footer class="agent-composer">
        <div class="agent-conversation-row">
          <div class="agent-conversation-tabs" role="tablist" aria-label="打开的对话">
            <button v-for="(chat,index) in agent.openConversations" :key="chat.id" role="tab" :aria-selected="chat.id === agent.activeConversationId" :class="{ active:chat.id === agent.activeConversationId }" :disabled="!agent.historyReady" :title="`${chat.title} · 右键关闭，记录保留在历史中`" @click="agent.switchConversation(chat.id)" @contextmenu.stop.prevent="agent.closeConversation(chat.id)">{{ index+1 }}</button>
          </div>
          <button class="agent-icon-btn" :disabled="!agent.historyReady" title="新建对话" aria-label="新建对话" @click="agent.newConversation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14" /></svg></button>
          <button class="agent-icon-btn" title="聊天历史" aria-label="聊天历史" :aria-expanded="showHistory" @click="showHistory = !showHistory"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" /></svg></button>
        </div>
        <div v-if="showHistory" class="agent-chat-history">
          <div class="agent-history-heading"><div class="history-filter"><button :class="{active: !showArchived}" @click="showArchived = false">历史</button><button :class="{active: showArchived}" @click="showArchived = true">已归档</button></div><button class="agent-icon-btn" aria-label="收起历史" @click="showHistory = false">×</button></div>
          <p v-if="!historyItems.length">{{ showArchived ? '暂无归档记录' : '发送消息后自动保存。关闭标签不会删除记录。' }}</p>
          <div v-for="chat in historyItems" :key="chat.id" class="agent-history-item">
            <div class="agent-history-content">
              <input v-if="renamingId === chat.id" v-model="historyTitle" autofocus maxlength="80" aria-label="对话名称" @keydown.enter.stop.prevent="finishHistoryRename(chat.id)" @keydown.esc.stop.prevent="renamingId = null" @blur="finishHistoryRename(chat.id)" />
              <button v-else :disabled="showArchived" @click="agent.switchConversation(chat.id); showHistory = false"><span>{{ chat.title }}</span><small>{{ new Date(chat.updatedAt).toLocaleString('zh-CN') }} · {{ chat.messages.filter(message => message.role === 'user').length }} 轮</small></button>
            </div>
            <NDropdown trigger="click" :options="historyOptions(chat)" @select="key => manageHistory(key, chat)"><button class="agent-history-manage" :aria-label="`管理对话：${chat.title}`" @click.stop>···</button></NDropdown>
          </div>
        </div>
        <!-- 待发图片。点了节点上的「发送到智能体」后暂存在这里，补完要求再一起发出 -->
        <div v-if="agent.pendingImages.length" class="agent-attachments">
          <div v-for="item in agent.pendingImages" :key="item.id" class="agent-chip">
            <img v-if="item.previewUrl" class="agent-chip-thumb" :src="item.previewUrl" :alt="item.label || '图片'">
            <span v-else class="agent-chip-loading"></span>
            <button
              type="button"
              class="agent-chip-remove"
              title="移除这张图"
              @click="agent.removePendingImage(item.id)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>

        <!-- 快捷指令：只填入输入框，不直接发送 —— 方便用户再补两句 -->
        <div class="agent-quick">
          <button
            v-for="command in QUICK_COMMANDS"
            :key="command"
            type="button"
            class="agent-quick-btn"
            @click="applyQuickCommand(command)"
          >{{ command }}</button>
        </div>

        <div class="agent-input-box">
        <textarea
          ref="inputEl"
          v-model="draft"
          class="agent-input"
          rows="1"
          :placeholder="inputPlaceholder"
          @keydown.enter.exact.prevent="submit"
        ></textarea>
        <div class="agent-composer-row">
          <span class="agent-context" :title="agent.contextSummary">{{ agent.contextSummary }}</span>
          <button
            v-if="agent.running"
            type="button"
            class="agent-btn is-stop"
            @click="agent.cancel()"
          >停止</button>
          <button
            v-else
            type="button"
            class="agent-btn"
            :disabled="!draft.trim() || !agent.historyReady"
            @click="submit"
          >发送</button>
        </div>
        </div>
      </footer>
    </aside>
  </Transition>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NDropdown } from 'naive-ui'
import { useAgentStore } from '../../stores/agent'
import { copyAgentText, copySelectionAsPlainText } from '../../utils/agentClipboard'
const copySelectedText = event => copySelectionAsPlainText(event, window.getSelection()?.toString() || '')
const copyMessage = async text => {
  try { await copyAgentText(text); window.$message?.success('已复制，段落换行已保留') }
  catch { window.$message?.error('复制失败，请选中文字后按 Ctrl+C') }
}
const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['update:show'])

const agent = useAgentStore()
const showHistory = ref(false)
const showArchived = ref(false), renamingId = ref(null), historyTitle = ref('')
const historyItems = computed(() => showArchived.value ? agent.archivedConversations : agent.historyConversations)
const historyOptions = chat => [{label: '重命名', key: 'rename'}, {label: chat.archived ? '恢复到历史' : '归档', key: 'archive', disabled: !!chat.running}]
const manageHistory = async (key, chat) => {
  if (key === 'archive') { agent.archiveConversation(chat.id, !chat.archived); return }
  renamingId.value = chat.id; historyTitle.value = chat.title
  await nextTick()
  const input = document.querySelector('.agent-history-content input')
  input?.focus(); input?.select()
}
const finishHistoryRename = id => {
  if (renamingId.value !== id) return
  agent.renameConversation(id, historyTitle.value)
  renamingId.value = null
}

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value)
})

// 键盘事件在此止步，别让画布的全局快捷键（Delete / Ctrl+Z…）从面板里穿到画布上。
// 配合模板上的 `.stop`：这个函数本身什么都不做，作用只是让监听器存在。
const swallowKeydown = () => {}

/* ------------------------------------------------------------------ 拖宽 */
/** 再窄就装不下了：输入区和发送按钮会挤成一团 */
const MIN_PANEL_WIDTH = 260

const resizing = ref(false)
let dragStartX = 0
let dragStartWidth = 0

const onResizeMove = (event) => {
  // 面板钉在右侧，往左拖才是变宽 —— 所以是「起点宽度 − 位移」
  const next = dragStartWidth - (event.clientX - dragStartX)
  agent.setPanelWidth(Math.min(Math.max(next, MIN_PANEL_WIDTH), window.innerWidth))
}

const onResizeEnd = () => {
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  // 拖动过程只改了内存，松手这最后一次才落盘
  agent.setPanelWidth(agent.panelWidth, true)
}

const startResize = (event) => {
  if (event.button !== 0) return
  event.preventDefault()
  resizing.value = true
  dragStartX = event.clientX
  dragStartWidth = agent.panelWidth
  // 拖到面板外面时，光标和选中态得跟着走，所以挂在 body 上
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

// 拖到一半面板被关掉（换项目、Alt+A）也要把监听摘干净
onBeforeUnmount(onResizeEnd)

const draft = computed({ get:() => agent.draft, set:value => { agent.draft=value } })
const scrollEl = ref(null)
const inputEl = ref(null)
const cliPathDraft = ref(agent.cliPath)

/** 常用开场指令。点一下只填进输入框，让用户还能补两句再发 */
const QUICK_COMMANDS = [
  '起小红书标题',
  '写一篇文案',
  '描述这张图'
]

const applyQuickCommand = (command) => {
  draft.value = command
  inputEl.value?.focus()
}

// 有附件时换个问法 —— 此时用户欠的不是「问题」，是「要拿这张图做什么」
const inputPlaceholder = computed(() => (
  agent.pendingImages.length
    ? '说说你想让我拿这张图做什么…'
    : '输入消息，Enter 发送，Shift+Enter 换行'
))

// 面板一打开就把光标送进输入框，省得用户再点一下
watch(visible, async (value) => {
  if (!value) return
  await nextTick()
  inputEl.value?.focus()
})

const submit = () => {
  const text = draft.value.trim()
  if (!text || agent.running || !agent.historyReady) return
  draft.value = ''
  agent.send(text)
}

/**
 * 跟随到底部。
 *
 * 监听的是「最后一条气泡的内容长度」而不是 messages 数组本身 —— 流式输出时数组没变，
 * 只有气泡正文在长，盯数组会漏掉最后半句话。
 */
watch(
  () => {
    const last = agent.messages[agent.messages.length - 1]
    // 状态行也要盯：它出现/消失会改变气泡高度，不跟着滚会把它切掉半行
    return `${agent.activeConversationId}:${agent.messages.length}:${last?.content?.length || 0}:${last?.status || ''}`
  },
  async () => {
    await nextTick()
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<style scoped>
/* 抽屉容器 | Drawer container
   top: 40px 让开自绘标题栏（含右侧窗口按钮），否则会盖住最小化/关闭。
   宽度不写死在这里 —— 由 store 的 panelWidth 经内联样式给，用户可拖 */
.agent-panel {
  --accent-color: #3c4655;
  position: fixed;
  top: 40px;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(30, 41, 59, 0.10);
  overflow: visible;
  z-index: 100;
}

/* 左边缘的拖宽把手 | Resize handle
   比边框宽、且向左探出 3px，抓起来才不费劲 */
.agent-resizer {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  z-index: 2;
}

/* 悬停时在真正的边界位置显一条高亮线，让"能拖"这件事看得出来 */
.agent-resizer::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: transparent;
  transition: background 0.15s;
}

.agent-resizer:hover::after,
.agent-panel.is-resizing .agent-resizer::after {
  background: var(--accent-color);
}

/* 拖动中禁掉面板内部的选择与 hover 抖动 */
.agent-panel.is-resizing {
  user-select: none;
}

:global(.dark) .agent-panel {
  --accent-color: #64748b;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45);
}

/* Header | 头部 */
.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-radius: 16px 16px 0 0;
}

.agent-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.agent-title small {
  padding: 3px 6px;
  border-radius: 5px;
  background: var(--bg-tertiary);
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
}

.agent-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.5;
}

.agent-dot.is-running {
  background: var(--accent-color);
  opacity: 1;
  animation: agent-pulse 1.2s ease-in-out infinite;
}

@keyframes agent-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.agent-header-actions {
  display: flex;
  gap: 4px;
}
.agent-shortcut-btn { color: var(--text-secondary); font-size: 11px; padding: 4px 6px; border-radius: 6px; }
.agent-tool-info { padding: 6px 16px; font-size: 11px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); }
.agent-shortcut-settings { padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-size: 12px; color: var(--text-primary); }
.agent-shortcut-settings input { width: 100%; margin: 8px 0; padding: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; outline: none; }
.agent-shortcut-settings input:focus { border-color: var(--accent-color); }
.agent-shortcut-settings small { display: block; color: var(--text-secondary); line-height: 1.5; }

.agent-icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.agent-icon-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.agent-icon-btn svg {
  width: 16px;
  height: 16px;
}

/* Messages | 消息区 */
.agent-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-empty {
  margin: auto 0;
  text-align: center;
  color: var(--text-secondary);
  padding: 24px 8px;
}

.agent-empty-title {
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.agent-empty-hint {
  font-size: 12px;
  line-height: 1.6;
}

.agent-bubble {
  max-width: 88%;
  font-size: 13px;
  line-height: 1.65;
}

.agent-bubble.user {
  align-self: flex-end;
}

.agent-bubble.assistant {
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.agent-bubble-body {
  padding: 9px 12px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-bubble.user .agent-bubble-body {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-bottom-right-radius: 4px;
}

.agent-bubble.assistant .agent-bubble-body {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

/* 思考中 / 正在调用技能：气泡下方的一行小字 */
.agent-bubble-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  padding-left: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}
.agent-copy-btn { margin-top: 6px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-secondary); background: var(--bg-secondary); font-size: 11px; }
.agent-copy-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

.agent-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-color);
  animation: agent-pulse 1.2s ease-in-out infinite;
}

/* 气泡里这一轮发的图 */
.agent-bubble-images {
  display: flex;
  flex-wrap: nowrap;
  max-width: 100%;
  overflow-x: auto;
  gap: 6px;
  margin-bottom: 6px;
}

.agent-bubble-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.agent-reply-footer { display:flex; align-items:center; gap:12px; margin-top:6px; }
.agent-reply-footer .agent-copy-btn { margin-top:0; }
.agent-reply-skills { margin-left:auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary); font-size:11px; }
.agent-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: currentColor;
  animation: agent-blink 1s steps(2, start) infinite;
}

@keyframes agent-blink {
  to { visibility: hidden; }
}

/* Error | 错误 */
.agent-error {
  flex-shrink: 0;
  margin: 0 16px 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.25);
}

.agent-error-text {
  font-size: 12px;
  line-height: 1.6;
  color: #dc2626;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-cli-field {
  display: block;
  margin-top: 8px;
}

.agent-cli-field span {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.agent-cli-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  outline: none;
}

.agent-cli-input:focus {
  border-color: var(--accent-color);
}

/* Composer | 输入区 */
.agent-composer {
  flex-shrink: 0;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  border-radius: 0 0 16px 16px;
}

/* Attachments | 待发图片 */
.agent-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.agent-chip {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.agent-chip-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.agent-chip-loading {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, var(--bg-tertiary), var(--bg-secondary), var(--bg-tertiary));
  background-size: 200% 100%;
  animation: agent-chip-shimmer 1.1s linear infinite;
}

@keyframes agent-chip-shimmer {
  to { background-position: -200% 0; }
}

.agent-chip-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.agent-chip:hover .agent-chip-remove {
  opacity: 1;
}

.agent-chip-remove svg {
  width: 11px;
  height: 11px;
}

/* Quick commands | 快捷指令 */
.agent-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.agent-quick-btn {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.agent-quick-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.agent-conversation-row { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
.agent-conversation-tabs { display:flex; flex:1; min-width:0; gap:5px; overflow-x:auto; }
.agent-conversation-tabs button { flex-shrink:0; width:26px; height:26px; border:1px solid var(--border-color); border-radius:6px; color:var(--text-secondary); background:var(--bg-tertiary); font-size:12px; }
.agent-conversation-tabs button.active { border-color:var(--text-primary); color:var(--text-primary); background:var(--bg-secondary); }
.agent-conversation-row button:disabled { opacity:.45; cursor:default; }
.agent-chat-history { border:1px solid var(--border-color); border-radius:10px; padding:8px; max-height:240px; overflow:auto; margin-bottom:10px; background:var(--bg-tertiary); }
.agent-history-heading { display:flex; align-items:center; justify-content:space-between; font-size:12px; }
.agent-chat-history>button { display:flex; flex-direction:column; gap:4px; width:100%; padding:10px 8px; text-align:left; border:0; border-radius:6px; background:transparent; color:var(--text-primary); }
.agent-chat-history>button:hover { background:var(--bg-secondary); }
.agent-chat-history small,.agent-chat-history p { font-size:11px; color:var(--text-secondary); }
.agent-chat-history span { font-size:12px; }
.history-filter { display:flex; gap:4px; }
.history-filter button { padding:4px 8px; border-radius:6px; color:var(--text-secondary); }
.history-filter button.active { background:var(--bg-secondary); color:var(--text-primary); }
.agent-history-item { display:flex; align-items:center; gap:6px; border-radius:6px; padding:4px; }
.agent-history-item:hover { background:var(--bg-secondary); }
.agent-history-content { flex:1; min-width:0; }
.agent-history-content>button { display:flex; flex-direction:column; gap:4px; width:100%; padding:6px 4px; text-align:left; color:var(--text-primary); }
.agent-history-content span { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.agent-history-content input { width:100%; padding:6px; border:1px solid var(--border-color); border-radius:5px; color:var(--text-primary); background:var(--bg-secondary); }
.agent-history-manage { flex-shrink:0; width:28px; height:28px; border-radius:6px; color:var(--text-secondary); font-size:18px; }
.agent-history-manage:hover { color:var(--text-primary); background:var(--bg-tertiary); }
.agent-input-box {
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-tertiary);
  overflow: hidden;
}
.agent-input-box:focus-within { border-color: var(--accent-color); }
.agent-input {
  width: 100%;
  min-height: 94px;
  max-height: 160px;
  resize: none;
  padding: 10px 12px 42px;
  font-size: 13px;
  line-height: 1.55;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: none;
  border-radius: 0;
  display: block;
  outline: none;
  transition: border-color 0.2s;
}

.agent-input:focus {
  border-color: var(--accent-color);
}

.agent-composer-row {
  position: absolute;
  bottom: 8px;
  left: 12px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 0;
}

.agent-context {
  min-width: 0;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 13px;
  border: none;
  border-radius: 8px;
  background: var(--accent-color);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s;
}

.agent-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.agent-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.agent-btn.is-stop {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

/* Transition | 从右往左滑入 */
.agent-slide-enter-active,
.agent-slide-leave-active {
  transition: transform 0.26s ease, opacity 0.26s ease;
}

.agent-slide-enter-from,
.agent-slide-leave-to {
  transform: translateX(100%);
  opacity: 0.4;
}

/* Scrollbar | 滚动条 */
.agent-messages::-webkit-scrollbar {
  width: 6px;
}

.agent-messages::-webkit-scrollbar-track {
  background: transparent;
}

.agent-messages::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.agent-messages::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
