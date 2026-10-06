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
      :style="{ width: `min(${displayWidth}px, 100vw)` }"
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
          <div v-if="message.role === 'user'" class="agent-bubble-body" @copy="copySelectedText"><span v-if="message.skill" class="agent-skill-tag">/{{ message.skill }}</span>{{ message.skill && message.content.startsWith('/' + message.skill) ? message.content.slice(message.skill.length + 1).trimStart() : message.content }}</div>
          <div v-else class="agent-bubble-body agent-formatted" @copy="copySelectedText" v-html="formatAgentReply(message.content)"></div>
          <div v-if="message.prompts?.length && !message.streaming" class="agent-prompt-results">
            <div v-for="(prompt,index) in message.prompts" :key="index" class="agent-prompt-card">
              <div class="agent-prompt-heading"><strong>{{ [prompt.group,prompt.title].filter(Boolean).join(' · ') }}</strong><button type="button" @click="sendPromptCards(message,[index])">{{ prompt.nodeId && nodes.some(node=>node.id===prompt.nodeId) ? '定位到节点' : '发送到画布' }}</button></div>
              <details><summary>查看提示词</summary><p>{{ prompt.prompt }}</p></details>
            </div>
            <button v-if="message.prompts.length>1" class="agent-prompt-all" @click="sendPromptCards(message,message.prompts.map((_,index)=>index))">全部发送到画布</button>
          </div>
          <div class="agent-message-meta" :class="{ 'is-streaming': message.streaming }">
            <div v-if="message.streaming" class="agent-bubble-status" role="status"><span class="agent-result-animation"><i v-for="n in 9" :key="n" :style="{ animationDelay: `${n * 80}ms` }"></i></span><span class="agent-status-text" :title="message.status || '正在生成结果'">{{ message.status || '正在生成结果' }}</span></div>
            <div v-if="message.role === 'assistant' && message.content && !message.streaming" class="agent-reply-actions">
              <button title="复制" aria-label="复制" @click="copyMessage(message.content)"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button>
              <button title="引用" aria-label="引用" @click="quoteMessage(message)"><svg viewBox="0 0 24 24"><path d="M5 5h5v8H6c0 3-1 5-3 6m11-14h5v8h-4c0 3-1 5-3 6"/></svg></button>
              <button title="在画布中定位" aria-label="在画布中定位" @click="locateMessage(message)"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6"/></svg></button>
            </div>
            <span v-if="message.skills?.length" class="agent-reply-skills" :title="message.skills.join('、')">技能：{{ message.skills.map(skill=>skillDisplayName(skill)).join('、') }}</span>
            <time v-if="message.createdAt" :datetime="new Date(message.createdAt).toISOString()" class="agent-message-time">{{ new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</time>
          </div>
        </div>
      </div>

      <!-- 出错时才浮出 CLI 路径设置：绝大多数情况 PATH 里就有 claude，不该常驻占地方 -->
      <div v-if="agent.error" class="agent-error">
        <p class="agent-error-text">{{ agent.error }}</p>
        <label v-if="/不是内部或外部命令|not recognized|command not found|系统找不到指定的文件|os error 2/i.test(agent.error)" class="agent-cli-field">
          <span>{{ agent.activeAgentName }} 程序路径（留空自动检测）</span>
          <input
            class="agent-cli-input"
            :value="cliPathDraft"
            placeholder="C:\\Users\\你\\AppData\\Roaming\\npm\\claude.cmd"
            @input="cliPathDraft = $event.target.value"
            @change="saveCurrentCliPath"
          >
        </label>
      </div>

      <!-- 固定在消息区底部，独立于消息滚动和输入区。 -->
      <div class="agent-quick" aria-label="快捷提示">
        <button
          v-for="command in QUICK_COMMANDS"
          :key="command"
          type="button"
          class="agent-quick-btn"
          @click="applyQuickCommand(command)"
        >{{ command }}</button>
      </div>

      <div v-if="agent.approvalRequests.length" class="agent-approvals">
        <section v-for="request in agent.approvalRequests" :key="String(request.rpcId)">
          <strong>{{ request.method.endsWith('requestUserInput') ? 'Codex 需要你的回答' : 'Codex 请求确认操作' }}</strong>
          <p>{{ request.params.reason || request.params.command || request.params.grantRoot || '请检查操作后确认' }}</p>
          <pre v-if="request.params.permissions">{{ JSON.stringify(request.params.permissions,null,2) }}</pre>
          <template v-if="request.params.questions"><label v-for="question in request.params.questions" :key="question.id">{{ question.question }}<select v-if="question.options?.length" v-model="request.answers[question.id]"><option disabled value="">请选择</option><option v-for="option in question.options" :key="option.label">{{ option.label }}</option></select><input v-else v-model="request.answers[question.id]" :type="question.isSecret ? 'password' : 'text'"></label><button @click="answerRequest(request)">提交回答</button></template>
          <template v-else><button @click="approveRequest(request,true)">允许本次</button><button @click="approveRequest(request,false)">拒绝</button></template>
        </section>
      </div>
      <footer class="agent-composer">
        <div v-if="conversationProvider !== agent.activeProvider" class="agent-provider-notice">当前为 {{ conversationProvider === 'codex' ? 'Codex' : 'Claude' }} 历史，请新建对话后发送</div>
        <div class="agent-conversation-row">
          <div class="agent-conversation-tabs" role="tablist" aria-label="打开的对话">
            <button v-for="(chat,index) in agent.openConversations" :key="chat.id" role="tab" :aria-selected="chat.id === agent.activeConversationId" :class="{ active:chat.id === agent.activeConversationId }" :disabled="!agent.historyReady" :title="`${chat.provider === 'codex' ? 'Codex' : 'Claude Code'} · ${chat.title} · 右键关闭，记录保留在历史中`" @click="agent.switchConversation(chat.id)" @contextmenu.stop.prevent="agent.closeConversation(chat.id)">{{ index+1 }}</button>
          </div>
          <span class="agent-provider-label">{{ agent.activeProvider === 'codex' ? 'Codex' : 'Claude' }}</span>
          <button class="agent-icon-btn" :disabled="!agent.historyReady" title="新建对话" aria-label="新建对话" @click="agent.newConversation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14" /></svg></button>
          <button class="agent-icon-btn" title="聊天历史" aria-label="聊天历史" :aria-expanded="showHistory" @click="showHistory = !showHistory"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" /></svg></button>
        </div>
        <div v-if="showHistory" class="agent-chat-history">
          <div class="agent-history-heading"><div class="history-filter"><button :class="{active: !showArchived}" @click="showArchived = false">历史</button><button :class="{active: showArchived}" @click="showArchived = true">已归档</button></div><button class="agent-icon-btn" aria-label="收起历史" @click="showHistory = false">×</button></div>
          <p v-if="!historyItems.length">{{ showArchived ? '暂无归档记录' : '发送消息后自动保存。关闭标签不会删除记录。' }}</p>
          <div v-for="chat in historyItems" :key="chat.id" class="agent-history-item">
            <div class="agent-history-content">
              <input v-if="renamingId === chat.id" v-model="historyTitle" autofocus maxlength="80" aria-label="对话名称" @keydown.enter.stop.prevent="finishHistoryRename(chat.id)" @keydown.esc.stop.prevent="renamingId = null" @blur="finishHistoryRename(chat.id)" />
              <button v-else :disabled="showArchived" @click="agent.switchConversation(chat.id); showHistory = false"><span>{{ chat.title }}</span><small>{{ chat.provider === 'codex' ? 'Codex' : 'Claude Code' }} · {{ new Date(chat.updatedAt).toLocaleString('zh-CN') }} · {{ chat.messages.filter(message => message.role === 'user').length }} 轮</small></button>
            </div>
            <div class="agent-history-actions">
              <button type="button" class="agent-history-manage" title="重命名" aria-label="重命名" @click.stop="manageHistory('rename', chat)"><svg viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l4-1 12-12-4-4L4 15v5Z" /></svg></button>
              <button type="button" class="agent-history-manage" :disabled="chat.running" :title="chat.archived ? '恢复' : '归档'" :aria-label="chat.archived ? '恢复' : '归档'" @click.stop="manageHistory('archive', chat)"><svg viewBox="0 0 24 24"><path d="M4 8h16v12H4zM3 4h18v4H3z"/><path v-if="chat.archived" d="M12 17v-6m-3 3 3-3 3 3"/><path v-else d="M9 12h6"/></svg></button>
              <button type="button" class="agent-history-manage is-delete" :disabled="chat.running" title="删除" aria-label="删除" @click.stop="agent.deleteConversation(chat.id)"><svg viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button>
            </div>
          </div>
        </div>
        <div class="agent-input-box" :class="{ 'is-expanded': inputExpanded }">
        <button type="button" class="agent-expand-input" :title="inputExpanded ? '收起输入框' : '扩大输入框'" :aria-label="inputExpanded ? '收起输入框' : '扩大输入框'" :aria-expanded="inputExpanded" @click="toggleInputExpanded"><svg viewBox="0 0 24 24"><path v-if="!inputExpanded" d="M14 3h7v7M21 3l-8 8M10 21H3v-7M3 21l8-8"/><path v-else d="M21 10h-7V3m0 7 7-7M3 14h7v7m0-7-7 7"/></svg></button>
        <div v-if="quotedMessage" class="agent-quote"><span>{{ quotedMessage.content }}</span><button title="取消引用" aria-label="取消引用" @click="quotedMessage = null">×</button></div>
        <!-- 待发图片。点了节点上的「发送到智能体」后暂存在这里，补完要求再一起发出 -->
        <div v-if="agent.pendingImages.length" class="agent-attachments">
          <NPopover v-for="item in agent.pendingImages" :key="item.id" trigger="hover" placement="top-start" :flip="true" :delay="150" :disabled="!item.previewUrl" :show-arrow="false" raw>
            <template #trigger><div class="agent-chip" tabindex="0" :aria-label="item.label || '图片'">
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
          </div></template>
            <div class="agent-image-preview"><img :src="item.previewUrl" :alt="item.label || '图片'"><span v-if="item.label">{{ item.label }}</span></div>
          </NPopover>
        </div>

        <div v-if="selectedInputSkill" class="agent-selected-skill"><span class="agent-skill-tag" :title="selectedInputSkill">/{{ skillDisplayName(selectedInputSkill) }}<button type="button" aria-label="移除技能" @click="removeInputSkill">×</button></span></div>
        <div v-if="skillMenuOpen" ref="skillMenuEl" class="agent-skill-menu" role="listbox" aria-label="本地智能体技能">
          <p v-if="skillsLoading">正在读取本地技能…</p>
          <p v-else-if="skillsError">{{ skillsError }}</p>
          <p v-else-if="!filteredSkills.length">未找到当前智能体的本地技能</p>
          <button v-for="(skill,index) in filteredSkills" :key="skill.name" type="button" role="option"
            :aria-selected="index === skillIndex" :class="{ active: index === skillIndex }"
            :title="skill.name" @mousedown.prevent="chooseSkill(skill)"><strong>/{{ skill.displayName || skill.name }}<small v-if="skill.scope" style="margin-left:8px;font-weight:normal;opacity:.55">{{ skill.scope==='user' ? '个人' : skill.scope==='repo' ? '项目' : skill.scope==='system' ? '内置' : '插件' }}</small></strong><span>{{ skill.description }}</span></button>
        </div>
        <textarea
          ref="inputEl"
          v-model="messageDraft"
          class="agent-input"
          rows="1"
          :placeholder="inputPlaceholder"
          @keydown="handleSkillKeys"
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
            :disabled="!draft.trim() || !agent.historyReady || conversationProvider !== agent.activeProvider"
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
import { invoke } from '@tauri-apps/api/core'
import { NPopover } from 'naive-ui'
import { formatAgentReply } from '../../utils/agentReplyFormat'
import { nodes } from '../../stores/canvas'
import { agentSettings, saveAgentSettings } from '../../stores/agentSettings'
import { useAgentStore } from '../../stores/agent'
import { copyAgentText, copySelectionAsPlainText } from '../../utils/agentClipboard'
const copySelectedText = event => copySelectionAsPlainText(event, window.getSelection()?.toString() || '')
const copyMessage = async text => {
  try { await copyAgentText(text); window.$message?.success('已复制，段落换行已保留') }
  catch { window.$message?.error('复制失败，请选中文字后按 Ctrl+C') }
}
const props = defineProps({
  show: Boolean,
  panelWidth: Number
})

const emit = defineEmits(['update:show', 'locate-nodes'])

const agent = useAgentStore()
const displayWidth = computed(() => props.panelWidth ?? agent.panelWidth)
const inputExpanded = ref(false)
const toggleInputExpanded = async () => { inputExpanded.value = !inputExpanded.value; await nextTick(); inputEl.value?.focus() }
const quotedMessage = ref(null)
const quoteMessage = async message => { quotedMessage.value = message; await nextTick(); inputEl.value?.focus() }
const locateMessage = message => {
  const ids = messageNodeIds(message)
  if (!ids.length) { window.$message?.warning('该消息没有关联的画布节点'); return }
  emit('locate-nodes', ids)
}
const sendPromptCards = (message,indices) => {
  try {
    const locating = indices.length === 1 && nodes.value.some(node => node.id === message.prompts[indices[0]]?.nodeId)
    const ids = agent.sendPromptsToCanvas(message, indices)
    if (locating && ids.length) emit('locate-nodes', ids)
  }
  catch(error){window.$message?.warning(error.message)}
}
const messageNodeIds = message => [...new Set([...(message.nodeIds || []), ...(message.content.match(/node_[a-zA-Z0-9_-]+/g) || [])])].filter(id => nodes.value.some(node => node.id === id))
watch(() => agent.activeConversationId, () => { quotedMessage.value = null })
const conversationProvider = computed(() => agent.conversations.find(item => item.id===agent.activeConversationId)?.provider || 'claude')
const approveRequest = (request, accepted) => agent.respondCodexRequest(request, request.method.includes('/permissions/') ? {permissions:accepted ? request.params.permissions || {} : {},scope:'turn'} : {decision:accepted ? 'accept' : 'decline'})
const answerRequest = request => agent.respondCodexRequest(request,{answers:Object.fromEntries(request.params.questions.map(question => [question.id,{answers:[request.answers[question.id] || '']}]))})
const showHistory = ref(false)
const showArchived = ref(false), renamingId = ref(null), historyTitle = ref('')
const historyItems = computed(() => showArchived.value ? agent.archivedConversations : agent.historyConversations)
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
  dragStartWidth = displayWidth.value
  // 拖到面板外面时，光标和选中态得跟着走，所以挂在 body 上
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

// 拖到一半面板被关掉（换项目、Alt+A）也要把监听摘干净
onBeforeUnmount(onResizeEnd)

const draft = computed({ get:() => agent.draft, set:value => { agent.draft=value } })
const localSkills = ref([]), skillsLoading = ref(false), skillsError = ref(''), skillIndex = ref(0), skillDismissed = ref(false)
const skillDisplayName = name => localSkills.value.find(skill=>skill.name===name)?.displayName || name
const skillMenuEl = ref(null)
const skillMenuOpen = computed(() => /^\/[^\s]*$/.test(draft.value) && !skillDismissed.value)
const filteredSkills = computed(() => localSkills.value.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(draft.value.slice(1).toLowerCase())))
watch([skillIndex, () => filteredSkills.value.length, () => skillMenuOpen.value], async () => {
  await nextTick()
  skillMenuEl.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
const selectedInputSkill = computed(() => {
  const name = draft.value.match(/^\/([^\s]+)\s/)?.[1]
  return localSkills.value.some(skill => skill.name === name) ? name : ''
})
const messageDraft = computed({
  get: () => selectedInputSkill.value ? draft.value.slice(selectedInputSkill.value.length + 2) : draft.value,
  set: value => { draft.value = selectedInputSkill.value ? `/${selectedInputSkill.value} ${value}` : value }
})
const removeInputSkill = () => { draft.value = messageDraft.value; inputEl.value?.focus() }
const loadSkills = async () => {
  const provider=agent.activeProvider
  skillsLoading.value = true; skillsError.value = ''
  try {
    if(agent.activeProvider==='codex') {
      const settings=agentSettings.codex
      const result=await invoke('codex_capabilities',{cliPath:settings.path,cwd:settings.cwd,scope:'skills'})
      Object.assign(settings,result);saveAgentSettings();if(agent.activeProvider===provider) localSkills.value=result.skills
    } else { const skills=await invoke('list_agent_skills');if(agent.activeProvider===provider) localSkills.value=skills }
  }
  catch (error) { skillsError.value = String(error) }
  finally { skillsLoading.value = false }
}
watch(() => agent.activeProvider, () => {localSkills.value=[];if(draft.value.startsWith('/')) loadSkills()})
watch(draft, (value, previous) => {
  skillDismissed.value = false; skillIndex.value = 0
  if (value.startsWith('/') && !previous.startsWith('/')) loadSkills()
})
const chooseSkill = skill => { draft.value = `/${skill.name} `; inputEl.value?.focus() }
const handleSkillKeys = event => {
  if (!skillMenuOpen.value) {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) { event.preventDefault(); submit() }
    return
  }
  if (event.isComposing || event.shiftKey) return
  if (['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation()
    if (event.key === 'Escape') { skillDismissed.value = true; return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      skillIndex.value = (skillIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + filteredSkills.value.length) % (filteredSkills.value.length || 1)
    } else if (filteredSkills.value[skillIndex.value]) chooseSkill(filteredSkills.value[skillIndex.value])
  }
}
const scrollEl = ref(null)
const inputEl = ref(null)
const cliPathDraft = ref(agentSettings[agent.activeProvider].path)
watch(() => agent.activeProvider, () => {cliPathDraft.value=agentSettings[agent.activeProvider].path})
const saveCurrentCliPath = () => { if(agent.activeProvider==='claude') agent.setCliPath(cliPathDraft.value); else {agentSettings.codex.path=cliPathDraft.value.trim();saveAgentSettings()} }

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
    : '输入消息，/ 选择技能，Enter 发送'
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
  const name = text.match(/^\/([^\s]+)/)?.[1]
  const quote = quotedMessage.value
  quotedMessage.value = null
  agent.send(quote ? `引用先前回复：\n${quote.content}\n\n我的要求：\n${text}` : text, localSkills.value.some(skill => skill.name === name) ? name : '')
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
  transition: width .48s cubic-bezier(.2,.85,.2,1.08);
}
.agent-panel.is-resizing { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .agent-panel { transition: none; }
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
  min-height: 0;
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
  padding: 4px 0;
  background: transparent;
  border: none;
  border-radius: 0;
  color: var(--text-primary);
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
  gap: 6px;
  padding: 10px 12px 0;
}

.agent-chip {
  position: relative;
  width: 36px;
  height: 36px;
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

.agent-chip:hover .agent-chip-remove,
.agent-chip:focus-within .agent-chip-remove {
  opacity: 1;
}

.agent-chip-remove svg {
  width: 11px;
  height: 11px;
}

/* Quick commands | 快捷指令 */
.agent-quick {
  display: flex;
  flex-shrink: 0;
  overflow-x: auto;
  gap: 6px;
  padding: 8px 16px 12px;
}

.agent-quick-btn {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
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
.agent-history-actions { display:flex; flex-shrink:0; gap:3px; }
.agent-history-manage { display:grid; place-items:center; padding:5px; border:0; background:transparent; cursor:pointer; }
.agent-history-manage svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.agent-history-manage:disabled { opacity:.35; cursor:not-allowed; }
.agent-history-manage.is-delete:hover:not(:disabled) { color:#e78b8b; }
.agent-skill-menu { position:absolute; bottom:calc(100% + 8px); left:0; right:0; max-height:280px; overflow-y:auto; padding:6px; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-secondary); box-shadow:0 8px 24px #0005; z-index:10; }
.agent-skill-menu button { display:flex; flex-direction:column; gap:4px; width:100%; padding:9px; text-align:left; border:0; border-radius:6px; background:transparent; color:var(--text-primary); cursor:pointer; }
.agent-skill-menu button.active, .agent-skill-menu button:hover { background:var(--bg-tertiary); }
.agent-skill-menu { scrollbar-width:thin; scrollbar-color:var(--text-tertiary) var(--bg-secondary); }
:global(.dark) .agent-skill-menu { color-scheme:dark; }
.agent-skill-menu::-webkit-scrollbar { width:6px; }
.agent-skill-menu::-webkit-scrollbar-track { background:var(--bg-secondary); }
.agent-skill-menu::-webkit-scrollbar-thumb { background:var(--text-tertiary); border-radius:6px; }
.agent-skill-menu::-webkit-scrollbar-thumb:hover { background:var(--text-secondary); }
.agent-skill-menu::-webkit-scrollbar-button { display:none; }
.agent-skill-menu span, .agent-skill-menu p { font-size:12px; color:var(--text-secondary); }
.agent-skill-menu span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.agent-input-box {
  --skill-color: #bba5ee;
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-tertiary);
  overflow: visible;
}
.agent-input-box:focus-within { border-color: var(--accent-color); }
.agent-selected-skill { padding:10px 12px 0; }
.agent-skill-tag { display:inline-flex; align-items:center; gap:8px; margin-right:6px; padding:3px 8px; border:1px solid #a88adc55; border-radius:6px; color:#a585d0; background:#a88adc18; font-size:12px; line-height:1.5; }
.agent-skill-tag button { padding:0; border:0; background:transparent; color:inherit; cursor:pointer; font-size:16px; line-height:1; }
:global(.dark) .agent-skill-tag { color:#cbb5f2; }
.agent-input {
  width: 100%;
  min-height: 60px;
  height: 60px;
  box-sizing: border-box;
  overflow-y: auto;
  max-height: 160px;
  resize: none;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.55;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: none;
  border-radius: 12px;
  display: block;
  outline: none;
  transition: border-color 0.2s;
}

.agent-input:focus {
  border-color: var(--accent-color);
}

.agent-composer-row {
  position: relative;
  padding: 4px 8px 8px 12px;
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
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.agent-slide-enter-active { transition-delay: 0.18s; }

.agent-slide-enter-from,
.agent-slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
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

<style scoped>
.agent-image-preview { width:220px; max-width:calc(100vw - 32px); overflow:hidden; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-secondary); box-shadow:0 8px 28px #0004; }
.agent-image-preview img { display:block; width:100%; height:280px; max-height:calc(100dvh - 100px); object-fit:contain; }
.agent-image-preview span { display:block; padding:7px 10px; color:var(--text-secondary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>

<style scoped>
.agent-message-meta { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:7px; min-height:20px; }
.agent-prompt-card { border:1px solid var(--border-color); border-radius:9px; padding:10px 12px; margin:10px 0; }
.agent-prompt-heading { display:flex;align-items:center;justify-content:space-between;gap:8px; }
.agent-prompt-heading strong { font-weight:500;min-width:0; }
.agent-prompt-heading button,.agent-prompt-all { border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);border-radius:6px;padding:5px 9px;cursor:pointer;flex-shrink:0; }
.agent-prompt-card details { margin-top:8px;font-size:12px;color:var(--text-secondary); }
.agent-prompt-card summary { cursor:pointer; }
.agent-prompt-card p { white-space:pre-wrap;color:var(--text-primary); }
.agent-message-meta.is-streaming { flex-wrap:nowrap; }
.agent-message-meta.is-streaming .agent-bubble-status { margin:0; min-width:0; flex:1; }
.agent-message-meta.is-streaming .agent-status-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.agent-message-meta.is-streaming .agent-reply-skills { min-width:0; max-width:45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.agent-message-meta.is-streaming .agent-message-time { flex-shrink:0; }
.agent-message-time { margin-left:auto; color:var(--text-secondary); opacity:.65; font-size:10px; }
.agent-reply-actions { display:flex; gap:3px; }
.agent-reply-actions button { display:grid; place-items:center; width:26px; height:26px; border:0; border-radius:6px; color:var(--text-secondary); background:transparent; cursor:pointer; }
.agent-reply-actions button:hover,.agent-reply-actions button.active { color:var(--text-primary); background:var(--bg-tertiary); }
.agent-reply-actions button:disabled { opacity:.3; cursor:default; }
.agent-reply-actions svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
.agent-quote { display:flex; align-items:center; gap:8px; margin:10px 12px 0; padding:7px 9px; border:1px solid var(--border-color); border-radius:7px; color:var(--text-secondary); font-size:12px; }
.agent-quote span { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; border-left:2px solid var(--text-secondary); padding-left:8px; }
.agent-quote button { border:0; background:none; color:inherit; cursor:pointer; }
.agent-result-animation { display:grid; grid-template-columns:repeat(3,3px); gap:2px; }
.agent-result-animation i { width:3px; height:3px; background:currentColor; animation:agent-result 1.2s ease-in-out infinite; }
@keyframes agent-result { 0%,100% { opacity:.25; } 50% { opacity:1; } }
.agent-formatted { white-space:normal; line-height:1.8; }
.agent-formatted :deep(p) { margin:0 0 12px; }
.agent-formatted :deep(pre) { overflow:auto; padding:10px; border-radius:8px; background:var(--bg-tertiary); white-space:pre; }
.agent-formatted :deep(code) { font-size:12px; background:var(--bg-tertiary); border-radius:3px; padding:1px 3px; }
@media(prefers-reduced-motion:reduce) { .agent-result-animation i { animation:none; } }
</style>

<style scoped>
.agent-expand-input { position:absolute; right:8px; top:6px; z-index:2; display:grid; place-items:center; width:26px; height:26px; border:0; border-radius:5px; background:var(--bg-tertiary); color:var(--text-secondary); cursor:pointer; }
.agent-expand-input:hover { color:var(--text-primary); }
.agent-expand-input svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
.agent-input { padding-right:40px; }
.agent-input-box.is-expanded .agent-input { height:min(45dvh, 420px); max-height:min(45dvh, 420px); }
.agent-input-box .agent-attachments { padding-right:40px; }
</style>

<style scoped>
.agent-provider-label { flex-shrink:0; font-size:11px; color:var(--text-secondary); white-space:nowrap; }
.agent-provider-notice { font-size:11px; color:var(--text-secondary); margin-bottom:8px; }
.agent-approvals { padding:12px 16px; max-height:260px; overflow:auto; background:var(--bg-tertiary); border-top:1px solid var(--border-color); }
.agent-approvals section { font-size:12px; padding:8px 0; }
.agent-approvals p,.agent-approvals pre { white-space:pre-wrap; overflow-wrap:anywhere; }
.agent-approvals button,.agent-approvals input,.agent-approvals select { padding:6px 8px; margin:4px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); }
.agent-approvals label { display:block; margin:8px 0; }
.agent-approvals input,.agent-approvals select { display:block; width:100%; }
</style>
