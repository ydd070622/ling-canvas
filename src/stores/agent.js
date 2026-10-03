/**
 * Canvas agent store | 画布智能体
 *
 * 把「本地已登录的 Claude Code」接进画布：一次发送 = 一次 `claude -p` 进程（见
 * `src-tauri/src/agent.rs`），回复以 NDJSON 流回来，这里逐行解析、拼成气泡。
 *
 * **会话靠 Claude Code 自己保存**：第一轮用我们生成的 `--session-id` 建会话，
 * 之后用 `--resume` 续接。所以本 store 只需要记住「这一串对话的 session_id」和
 * 「它是不是已经建立过了」—— 后者决定下一轮该 `--session-id` 还是 `--resume`。
 *
 * 这一版智能体**只读**：工具白名单只放行 `Skill`（起标题/写文案时调 xhs-ti），
 * 文件、命令、网络全关 —— 它改不了画布、也碰不到文件系统。
 * 它能看到的东西全部由 utils/agentContext.js 打包进系统提示词。
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { loadAgentHistory, saveAgentHistory } from './agentHistory'
import { invoke, Channel } from '@tauri-apps/api/core'
import { nodes, edges } from './canvas'
import { currentProject } from './projects'
import { selectedNodeIds } from '../composables/useFocusMode'
import { buildAgentSystemPrompt } from '../utils/agentContext'
import { buildAgentInputLine, resolveAgentImage } from '../utils/agentImage'
import { isCopyRequest, copyRequestPrompt, cleanCopyOutput } from '../utils/agentCopyOutput'

const SESSION_ID_KEY = 'ling-canvas-agent-session'
const SESSION_STARTED_KEY = 'ling-canvas-agent-session-started'
const TOOL_PROFILE_KEY = 'ling-canvas-agent-tool-profile'
const TOOL_PROFILE = 'skill-read-v2'
const CLI_PATH_KEY = 'ling-canvas-claude-cli-path'
const PANEL_WIDTH_KEY = 'ling-canvas-agent-panel-width'

/** 面板初始宽度。之后由用户从左边缘拖到自己想要的宽度 */
const DEFAULT_PANEL_WIDTH = 420

// localStorage 在隐私模式 / 配额耗尽时会抛，读写都包一层，别让它炸掉 store
const safeGet = (key, fallback = '') => {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}
const safeSet = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

const newSessionId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // 落到下面的兜底
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

export const useAgentStore = defineStore('agent', () => {
  /** 面板开关。放在 store 里，好让图片节点上的按钮也能唤起面板 */
  const panelOpen = ref(false)
  /** 气泡列表。assistant 气泡在流式期间 `streaming` 为 true */
  const messages = ref([])
  const running = ref(false)
  /** 上一次运行留下的错误（stderr / 启动失败），展示在面板里 */
  const error = ref('')
  const sessionId = ref(safeGet(SESSION_ID_KEY) || newSessionId())
  /** 这个 session_id 是否已经在 Claude Code 那边建立过 —— 决定下一轮用 --session-id 还是 --resume */
  const sessionStarted = ref(safeGet(SESSION_STARTED_KEY) === '1')
  if (safeGet(TOOL_PROFILE_KEY) !== TOOL_PROFILE) {
    sessionId.value = newSessionId()
    sessionStarted.value = false
    safeSet(SESSION_ID_KEY, sessionId.value)
    safeSet(SESSION_STARTED_KEY, '')
    safeSet(TOOL_PROFILE_KEY, TOOL_PROFILE)
  }
  const availableTools = ref([])
  /** 空串 = 走 PATH 里的 claude */
  const cliPath = ref(safeGet(CLI_PATH_KEY))
  /** 面板宽度（px）。从左边缘拖动调整，下次打开沿用 */
  const panelWidth = ref(Number(safeGet(PANEL_WIDTH_KEY)) || DEFAULT_PANEL_WIDTH)

  /**
   * 待发送的图片附件。用户点节点上的「发送到智能体」后先暂存到这里，
   * 等他补完要求再一起发出。
   * 每项：{ id, nodeId, label, previewUrl, dataBase64, mime, loading }
   */
  const pendingImages = ref([])
  const conversations = ref([]), draft = ref(''), historyReady = ref(false)
  const activeConversationId = ref(sessionId.value)
  const openConversations = computed(() => conversations.value.filter(item => item.open))
  const historyConversations = computed(() => [...conversations.value].filter(item => item.messages?.length).sort((a,b) => b.updatedAt-a.updatedAt))
  let historyWritable=false, historyTimer=null, historyQueue=Promise.resolve()
  const captureConversation = () => {
    const item=conversations.value.find(item => item.id===activeConversationId.value)
    if (!item) return
    Object.assign(item,{sessionId:sessionId.value,sessionStarted:sessionStarted.value,messages:messages.value,draft:draft.value,attachments:pendingImages.value,error:error.value,running:running.value,requestId:activeRequestId})
    const first=messages.value.find(message => message.role==='user')
    if (first) item.title=first.content.replace(/\s+/g,' ').slice(0,24)
  }
  const persistHistory = () => {
    if (!historyWritable) return Promise.resolve(false)
    captureConversation()
    const state=JSON.parse(JSON.stringify({activeId:activeConversationId.value,conversations:conversations.value.map(({running,requestId,...item}) => item)}))
    historyQueue=historyQueue.catch(() => {}).then(() => saveAgentHistory(state)).then(() => true).catch(() => { window.$message?.error('聊天记录保存失败，请勿关闭应用'); return false })
    return historyQueue
  }
  const activateConversation = item => {
    activeConversationId.value=item.id; sessionId.value=item.sessionId; sessionStarted.value=!!item.sessionStarted
    messages.value=item.messages || []; running.value=!!item.running; activeRequestId=item.requestId || null
    draft.value=item.draft || ''; pendingImages.value=(item.attachments || []).filter(item => !item.loading); error.value=item.error || ''
    item.open=true; persistSession()
  }
  const newConversation = () => {
    if (!historyReady.value) return
    captureConversation()
    const id=newSessionId(),now=Date.now()
    const item={id,sessionId:id,sessionStarted:false,title:'新对话',open:true,messages:[],draft:'',attachments:[],createdAt:now,updatedAt:now}
    conversations.value.push(item); activateConversation(item); persistHistory()
  }
  const switchConversation = id => {

    const item=conversations.value.find(item => item.id===id)
    if (item) { captureConversation(); activateConversation(item); persistHistory() }
  }
  const closeConversation = id => {

    captureConversation()
    const item=conversations.value.find(item => item.id===id)
    if (!item) return
    item.open=false
    if (id===activeConversationId.value) {
      const next=openConversations.value.at(-1)
      if (next) activateConversation(next)
      else newConversation()
    }
    persistHistory()
  }
  loadAgentHistory().then(state => {
    if (state?.conversations?.length) {
      conversations.value=state.conversations.map(item => ({...item,running:false,requestId:null,messages:(item.messages || []).map(message => ({...message,streaming:false,status:''}))}))
      const item=conversations.value.find(item => item.id===state.activeId && item.open) || openConversations.value[0]
      if (item) activateConversation(item)
    }
    historyWritable=true; historyReady.value=true
    if (!conversations.value.length) {
      const now=Date.now()
      conversations.value.push({id:sessionId.value,sessionId:sessionId.value,sessionStarted:sessionStarted.value,title:'新对话',open:true,messages:[],createdAt:now,updatedAt:now})
    } else if (!openConversations.value.length) newConversation()
  }).catch(() => {
    historyReady.value=true
    window.$message?.error('聊天历史读取失败，旧记录未覆盖；新聊天暂不保存')
    const id=sessionId.value
    conversations.value=[{id,sessionId:id,title:'新对话',open:true,messages:[],createdAt:Date.now(),updatedAt:Date.now()}]
  })
  watch([messages,draft,pendingImages,sessionStarted],() => {
    if (!historyReady.value) return
    captureConversation()
    const item=conversations.value.find(item => item.id===activeConversationId.value)
    if (item) item.updatedAt=Date.now()
    clearTimeout(historyTimer); historyTimer=setTimeout(persistHistory,400)
  },{deep:true})
  /** 有任何一张还在转换 → 节点按钮转圈。用 computed 而不是手动维护，免得不一致 */
  const attaching = computed(() => pendingImages.value.some(item => item.loading))

  /** 当前这一轮的 request id，用来取消 */
  let activeRequestId = null

  const persistSession = () => {
    safeSet(SESSION_ID_KEY, sessionId.value)
    safeSet(SESSION_STARTED_KEY, sessionStarted.value ? '1' : '')
  }

  /** 面板底部显示"上下文里有什么"的小字 */
  const contextSummary = computed(() => {
    const selected = selectedNodeIds.value.length
    return `${nodes.value.length} 个节点 · 选中 ${selected} 个`
  })

  const openPanel = () => { panelOpen.value = true }
  const closePanel = () => { panelOpen.value = false }
  const togglePanel = () => { panelOpen.value = !panelOpen.value }

  const setCliPath = (value) => {
    cliPath.value = String(value || '').trim()
    safeSet(CLI_PATH_KEY, cliPath.value)
  }

  /**
   * 改面板宽度。
   *
   * 拖动过程中 `persist` 留 false：pointermove 每秒能来几十次，每次都同步写
   * localStorage 会把拖动拖卡。松手时再调一次 `persist: true` 落盘。
   */
  const setPanelWidth = (value, persist = false) => {
    const next = Math.round(Number(value) || 0)
    if (next <= 0) return
    panelWidth.value = next
    if (persist) safeSet(PANEL_WIDTH_KEY, String(next))
  }

  /**
   * 把一张画布图片暂存为附件。
   *
   * 先 push 一个 `loading` 占位 chip 并打开面板 —— 转换要解码 + 重新编码，可能上百毫秒，
   * 用户点完立刻看到反馈才不会以为没生效。转换完再回填预览与载荷。
   *
   * **同一个节点只加一次**：多选批量发常常会连点几下，转换又是几百毫秒，没有这道闸门
   * 就会攒出一堆同一张图的 chip。
   */
  const attachImage = async (nodeId, url, label) => {
    openPanel()
    const key = String(nodeId ?? '')
    if (key && pendingImages.value.some(item => item.nodeId === key)) return

    const chipId = newSessionId()
    const attachmentConversationId = activeConversationId.value
    pendingImages.value.push({
      id: chipId,
      nodeId: key,
      label: String(label || ''),
      previewUrl: '',
      dataBase64: '',
      mime: '',
      loading: true
    })

    try {
      const { dataBase64, mime, previewUrl } = await resolveAgentImage(url)
      const owner=conversations.value.find(item => item.id===attachmentConversationId)
      const chip = (attachmentConversationId===activeConversationId.value ? pendingImages.value : owner?.attachments || []).find(item => item.id === chipId)
      // 转换期间用户可能已经把它移除了 —— 那就别再回填
      if (chip) Object.assign(chip, { dataBase64, mime, previewUrl, loading: false })
    } catch (err) {
      inConversation(attachmentConversationId,() => { pendingImages.value=pendingImages.value.filter(item => item.id!==chipId) })
      window.$message?.error?.(String(err?.message || err || '这张图发送失败'))
    }
  }

  /** 把当前选中的图片节点整批加进附件（画布顶部「发给智能体」按钮用） */
  const attachSelectedImages = () => {
    const ids = new Set(selectedNodeIds.value)
    nodes.value
      .filter(node => ids.has(String(node.id)) && node.type === 'image' && node.data?.url)
      .forEach(node => { attachImage(node.id, node.data.url, node.data.label) })
  }

  const removePendingImage = (id) => {
    pendingImages.value = pendingImages.value.filter(item => item.id !== id)
  }

  /** 开一段新对话：换个 session_id，清空气泡与待发附件 */
  const resetSession = () => {
    newConversation()
  }

  const currentAssistant = () => messages.value[messages.value.length - 1]

  /**
   * 气泡上的临时状态行。
   *
   * 模型在思考（thinking）和调技能（tool_use）期间**一个字都不吐**，实测头几秒完全是空的 ——
   * 不给提示用户会以为是卡死了。正文一开始流，这行就撤掉。
   */
  const setStatus = (text) => {
    const bubble = currentAssistant()
    if (bubble && bubble.role === 'assistant') bubble.status = text
  }
  const clearStatus = () => setStatus('')

  const finishTurn = () => {
    running.value = false
    activeRequestId = null
    const last = currentAssistant()
    if (last && last.role === 'assistant') {
      last.streaming = false
      last.status = ''
    }
  }

  // Route each CLI event into its own conversation, including hidden chats.
  const inConversation = (id, action) => {
    const target=conversations.value.find(item => item.id===id)
    if (!target) return
    if (id===activeConversationId.value) { action(); captureConversation(); return }
    captureConversation()
    const visible=conversations.value.find(item => item.id===activeConversationId.value)
    activeConversationId.value=id; sessionId.value=target.sessionId; sessionStarted.value=!!target.sessionStarted
    messages.value=target.messages || []; draft.value=target.draft || ''; pendingImages.value=target.attachments || []
    error.value=target.error || ''; running.value=!!target.running; activeRequestId=target.requestId || null
    try { action(); captureConversation() }
    finally {
      if (visible) activateConversation(visible)
      clearTimeout(historyTimer); historyTimer=setTimeout(persistHistory,400)
    }
  }

  /** 处理一条 NDJSON 行（Claude Code 的 stream-json 输出） */
  const handleLine = (line) => {
    let payload
    try {
      payload = JSON.parse(line)
    } catch {
      return // 非 JSON 行（极少数日志串）直接忽略
    }

    if (payload.type === 'system' && payload.subtype === 'init') {
      availableTools.value = Array.isArray(payload.tools) ? payload.tools : []
      // CLI 会把实际使用的 session_id 回报过来，以它为准
      if (payload.session_id) sessionId.value = payload.session_id
      sessionStarted.value = true
      persistSession()
      return
    }

    if (payload.type === 'stream_event') {
      const event = payload.event

      // 一块内容的开头：思考块 / 工具调用块。这两种都不产生正文，但都耗时，先亮状态。
      if (event?.type === 'content_block_start') {
        const block = event.content_block
        if (block?.type === 'tool_use') setStatus(`正在调用 ${block.name || '工具'}…`)
        else if (block?.type === 'thinking') setStatus('思考中…')
        return
      }

      if (event?.type === 'content_block_delta') {
        const delta = event.delta
        // 思考内容本身不进气泡（一屏几百个 delta，铺出来全是噪声），只拿它当"还在动"的信号
        if (delta?.type === 'thinking_delta') {
          setStatus('思考中…')
          return
        }
        if (delta?.type === 'text_delta') {
          clearStatus()
          const bubble = currentAssistant()
          if (bubble && bubble.role === 'assistant') bubble.content += delta.text || ''
        }
      }
      return
    }

    // assistant 事件是整条消息的快照，夹在流式 delta 中间重复出现。
    // 只在「它比已拼的内容更长」时覆盖，用来补齐可能丢掉的 delta，绝不回退。
    if (payload.type === 'assistant') {
      const text = (payload.message?.content || [])
        .filter(block => block?.type === 'text')
        .map(block => block.text || '')
        .join('')
      const bubble = currentAssistant()
      const skills = (payload.message?.content || []).filter(block => block?.type === 'tool_use' && block.name === 'Skill').map(block => block.input?.skill).filter(Boolean)
      if (bubble && skills.length) bubble.skills = [...new Set([...(bubble.skills || []), ...skills])]
      if (text && bubble && bubble.role === 'assistant' && text.length > bubble.content.length) {
        bubble.content = text
        bubble.status = ''
      }
      return
    }

    if (payload.type === 'result') {
      const bubble = currentAssistant()
      if (bubble && bubble.role === 'assistant') {
        if (typeof payload.result === 'string') bubble.content = bubble.copyOnly && !payload.is_error ? cleanCopyOutput(payload.result) : payload.result
        bubble.status = ''
      }
      if (payload.is_error) {
        error.value = typeof payload.result === 'string' && payload.result.trim()
          ? payload.result.trim()
          : '本轮对话出错，请重试。'
        // 续接失败多半是会话文件没了（清过 ~/.claude）。重置会话，下一轮开一段新的。
        if (sessionStarted.value && !String(bubble?.content || '').trim()) {
          sessionId.value = newSessionId()
          sessionStarted.value = false
          persistSession()
          error.value = '上一段对话的记录已失效，已为你开一段新对话，请重发一次。'
        }
      }
    }
  }

  const handleEvent = (event) => {
    if (event?.kind === 'line') {
      handleLine(event.line)
      return
    }
    if (event?.kind === 'err') {
      const text = String(event.message || '').trim()
      if (text) error.value = text
      return
    }
    if (event?.kind === 'done') {
      finishTurn()
    }
  }

  /** 发一条消息 */
  const send = async (text) => {
    const prompt = String(text || '').trim()
    if (!prompt || running.value || !historyReady.value) return

    // 还没转换完的 chip 这一轮先不发：留给下一轮，别把半截数据写进会话
    const attachments = pendingImages.value.filter(item => !item.loading && item.dataBase64)

    error.value = ''
    messages.value.push({
      id: newSessionId(),
      role: 'user',
      content: prompt,
      streaming: false,
      // 记下当时发的图（用降采样后的小图当缩略图，不为 60px 展示去解码大图）
      images: attachments.map(item => item.previewUrl)
    })
    messages.value.push({ id: newSessionId(), role: 'assistant', content: '', streaming: true, status: '', copyOnly: isCopyRequest(prompt) })
    running.value = true

    const requestId = newSessionId()
    activeRequestId = requestId
    const conversationId=activeConversationId.value
    captureConversation()

    // 上下文在发送这一刻快照，之后用户再动画布不影响这一轮
    const systemPrompt = buildAgentSystemPrompt({
      nodes: nodes.value,
      edges: edges.value,
      selectedIds: selectedNodeIds.value,
      projectName: currentProject.value?.title || currentProject.value?.name || ''
    })

    // 有图无图同一条路径：无附件时 content 里就只有一个文字块
    const input = buildAgentInputLine({ text: copyRequestPrompt(prompt), images: attachments })

    const channel = new Channel()
    channel.onmessage = event => inConversation(conversationId,() => handleEvent(event))

    try {
      await invoke('agent_send', {
        requestId,
        input,
        sessionId: sessionId.value,
        resume: sessionStarted.value,
        cliPath: cliPath.value,
        systemPrompt,
        onEvent: channel
      })
    } catch (err) {
      inConversation(conversationId,() => { error.value=String(err?.message || err || '启动智能体失败') })
    } finally {
      // done 事件通常已经收尾；这里兜底，防止 invoke 直接抛错时状态卡住
      inConversation(conversationId,() => { if (activeRequestId===requestId) finishTurn() })
    }

    // 图已随会话进了 Claude Code 的历史，后续追问靠 --resume，不重发。
    // 只清掉这一轮真发出去的；仍在转换的 chip 留着，下一轮还能用。
    const sentIds = new Set(attachments.map(item => item.id))
    inConversation(conversationId,() => { pendingImages.value=pendingImages.value.filter(item => !sentIds.has(item.id)) })
  }

  const cancel = async () => {
    const requestId = activeRequestId
    if (!requestId) return
    try {
      await invoke('agent_cancel', { requestId })
    } catch {
      // 进程可能已经自己结束了，忽略
    }
  }

  return {
    conversations, openConversations, historyConversations, activeConversationId, historyReady, draft,
    newConversation, switchConversation, closeConversation, persistHistory,
    panelOpen,
    messages,
    running,
    error,
    sessionId,
    sessionStarted,
    availableTools,
    cliPath,
    panelWidth,
    pendingImages,
    attaching,
    contextSummary,
    openPanel,
    closePanel,
    togglePanel,
    setCliPath,
    setPanelWidth,
    attachImage,
    attachSelectedImages,
    removePendingImage,
    resetSession,
    send,
    cancel
  }
})
