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
 * 智能体可以执行本地技能、命令和文件操作；结构化动作接入画布生成。
 * 它能看到的东西全部由 utils/agentContext.js 打包进系统提示词。
 */
import { defineStore } from 'pinia'
import { codexErrorText } from '../utils/codexError'
import { agentSettings, activeAgentName, saveAgentSettings } from './agentSettings'
import { computed, ref, watch, nextTick } from 'vue'
import { loadAgentHistory, saveAgentHistory } from './agentHistory'
import { invoke, Channel } from '@tauri-apps/api/core'
import { nodes, edges, addNode, addEdge, updateNode, startBatchOperation, endBatchOperation } from './canvas'
import { parseAgentPrompts, agentPromptRatio } from '../utils/agentPrompts'
import { runNodeAndWait } from '../composables/useNodeRunBridge'
import { parseCanvasActions } from '../utils/agentCanvasActions'
import { currentProject } from './projects'
import { selectedNodeIds } from '../composables/useFocusMode'
import { buildAgentSystemPrompt } from '../utils/agentContext'
import { buildAgentInputLine, resolveAgentImage } from '../utils/agentImage'
import { isCopyRequest, copyRequestPrompt, cleanCopyOutput } from '../utils/agentCopyOutput'
import { cleanAgentDiagnostic } from '../utils/agentDiagnostics'

const SESSION_ID_KEY = 'ling-canvas-agent-session'
const SESSION_STARTED_KEY = 'ling-canvas-agent-session-started'
const TOOL_PROFILE_KEY = 'ling-canvas-agent-tool-profile'
const TOOL_PROFILE = 'full-execution-v3'
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
  const approvalRequests = ref([])
  const anyRunning = computed(() => running.value || conversations.value.some(item => item.running))
  const activeProvider = computed(() => agentSettings.active)
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
  const openConversations = computed(() => conversations.value.filter(item => item.open && !item.archived))
  const historyConversations = computed(() => [...conversations.value].filter(item => item.messages?.length && !item.archived).sort((a,b) => b.updatedAt-a.updatedAt))
  const archivedConversations = computed(() => [...conversations.value].filter(item => item.archived).sort((a,b) => b.updatedAt-a.updatedAt))
  let historyWritable=false, historyTimer=null, historyQueue=Promise.resolve()
  const captureConversation = () => {
    const item=conversations.value.find(item => item.id===activeConversationId.value)
    if (!item) return
    Object.assign(item,{sessionId:sessionId.value,sessionStarted:sessionStarted.value,messages:messages.value,draft:draft.value,attachments:pendingImages.value,error:error.value,running:running.value,requestId:activeRequestId})
    const first=messages.value.find(message => message.role==='user')
    if (first && !item.customTitle) item.title=first.content.replace(/\s+/g,' ').slice(0,24)
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
    draft.value=item.draft || ''; pendingImages.value=(item.attachments || []).filter(item => !item.loading); error.value=cleanAgentDiagnostic(item.error)
    item.provider ||= 'claude'
    item.open=true; persistSession()
  }
  const newConversation = () => {
    if (!historyReady.value) return
    captureConversation()
    const id=newSessionId(),now=Date.now()
    const item={id,provider:agentSettings.active,sessionId:id,sessionStarted:false,title:'新对话',open:true,messages:[],draft:'',attachments:[],createdAt:now,updatedAt:now}
    conversations.value.push(item); activateConversation(item); persistHistory()
  }
  const switchConversation = id => {

    const item=conversations.value.find(item => item.id===id)
    if (item && !item.archived) { captureConversation(); activateConversation(item); persistHistory() }
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
  const deleteConversation = id => {
    captureConversation()
    const item = conversations.value.find(item => item.id === id)
    if (!item || item.running) return
    closeConversation(id)
    conversations.value = conversations.value.filter(item => item.id !== id)
    persistHistory()
  }
  const renameConversation = (id, title) => {
    const item = conversations.value.find(item => item.id === id)
    if (!item || !title.trim()) return
    item.title = title.trim().slice(0, 80); item.customTitle = true
    persistHistory()
  }
  const archiveConversation = (id, archived = true) => {
    captureConversation()
    const item = conversations.value.find(item => item.id === id)
    if (!item || item.running) return
    item.archived = archived
    if (archived) closeConversation(id)
    persistHistory()
  }
  loadAgentHistory().then(state => {
    if (state?.conversations?.length) {
      conversations.value=state.conversations.map(item => ({...item,error:cleanAgentDiagnostic(item.error),running:false,requestId:null,messages:(item.messages || []).map(message => ({...message,streaming:false,status:''}))}))
      const item=conversations.value.find(item => item.id===state.activeId && item.open && !item.archived) || openConversations.value[0]
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
    agentSettings.claude.path = cliPath.value; saveAgentSettings()
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
    error.value=cleanAgentDiagnostic(target.error); running.value=!!target.running; activeRequestId=target.requestId || null
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
      if (!payload.is_error && typeof payload.result==='string' && bubble) {
        const parsed=parseAgentPrompts(payload.result)
        if(parsed.prompts.length){bubble.prompts=parsed.prompts;payload.result=parsed.text || '提示词已整理完成。'}
      }
      if (!payload.is_error && typeof payload.result === 'string') {
        try {
          const parsed = parseCanvasActions(payload.result)
          if (parsed.actions.length) {
            payload.result = parsed.text || '正在执行画布生成任务。'
            const conversationId = activeConversationId.value
            const project = currentProject.value?.id
            const execute = async () => {
              for (const action of parsed.actions) {
                if (currentProject.value?.id !== project) throw new Error('项目已切换，画布操作已停止')
                let id = action.nodeId
                if (action.type === 'create_image') {
                  const sources = (action.references || []).map(id => nodes.value.find(node => node.id === id)).filter(Boolean)
                  const anchor = sources[0] || nodes.value.at(-1)
                  id = addNode('image', { x: (anchor?.position?.x || 100) + 380, y: anchor?.position?.y || 100 }, {
                    label: action.title || '图片生成', prompt: action.prompt,
                    count: Math.max(1, Math.min(4, Number(action.count) || 1)), ratio: action.ratio || '4:3'
                  })
                  for (const source of sources) addEdge({ source: source.id, target: id })
                  await nextTick(); await new Promise(resolve => requestAnimationFrame(resolve))
                } else if (!nodes.value.some(node => node.id === id && ['image','video','render','task'].includes(node.type))) {
                  throw new Error('找不到可运行的画布节点')
                }
                if (bubble) bubble.nodeIds = [...new Set([...(bubble.nodeIds || []), id])]
                await runNodeAndWait(id)
                if (nodes.value.find(node => node.id === id)?.data?.error) throw new Error(nodes.value.find(node => node.id === id).data.error)
              }
            }
            execute().catch(err => inConversation(conversationId, () => { error.value = `画布执行失败：${err.message}` }))
          }
        } catch (err) { error.value = `画布动作解析失败：${err.message}` }
      }
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

  const respondCodexRequest = async (request, result) => {
    try { await invoke('codex_respond', { requestId:request.requestId, rpcId:request.rpcId, result }); approvalRequests.value=approvalRequests.value.filter(item => item !== request) }
    catch (e) { window.$message?.error(String(e)) }
  }
  const enableProvider = provider => {
    if (anyRunning.value) throw new Error('请等待当前任务结束再切换智能体')
    if (!historyReady.value) throw new Error('聊天历史正在加载，请稍后重试')
    if (agentSettings.active === provider) return
    agentSettings.active = provider; saveAgentSettings(); newConversation()
  }
  const handleCodexLine = line => {
    let value; try { value=JSON.parse(line) } catch { return }
    if (value.type === 'codex_request') { value.answers={}; approvalRequests.value.push(value); setStatus('等待确认操作…'); return }
    const method=value.method, params=value.params || {}, bubble=messages.value.at(-1)
    if (method === 'item/agentMessage/delta') { if (bubble?.role==='assistant') bubble.content += params.delta || ''; clearStatus(); return }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') { if (bubble?.role==='assistant' && !bubble.content) bubble.content=params.item.text || ''; return }
    if (method === 'item/started') {
      const kind=params.item?.type
      if (kind !== 'agentMessage') setStatus(kind === 'commandExecution' ? '正在执行命令…' : kind === 'fileChange' ? '正在修改文件…' : '正在处理任务…')
      return
    }
    if (method === 'serverRequest/resolved') { approvalRequests.value=approvalRequests.value.filter(item => String(item.rpcId) !== String(params.requestId)); return }
    if (method === 'turn/completed') {
      const turn=params.turn || {}, failed=turn.status === 'failed'
      if (turn.status === 'interrupted') { clearStatus(); return }
      handleLine(JSON.stringify({type:'result',is_error:failed,result:failed ? codexErrorText(turn.error?.message) : bubble?.content || ''})); return
    }
    if (value.type) handleLine(line)
  }
  const handleEvent = (event, provider = 'claude') => {
    if (event?.kind === 'line') {
      if (provider === 'codex') handleCodexLine(event.line)
      else handleLine(event.line)
      return
    }
    if (event?.kind === 'err') {
      const text = provider==='codex' ? codexErrorText(event.message) : cleanAgentDiagnostic(event.message)
      if (text) error.value = text
      return
    }
    if (event?.kind === 'done') {
      approvalRequests.value=approvalRequests.value.filter(item => item.requestId !== activeRequestId)
      finishTurn()
    }
  }

  /** 发一条消息 */
  const send = async (text, skill = '') => {
    const prompt = String(text || '').trim()
    if (!prompt || running.value || !historyReady.value) return
    const provider=agentSettings.active, settings={...agentSettings[provider]}
    const conversation=conversations.value.find(item => item.id===activeConversationId.value)
    if ((conversation?.provider || 'claude') !== provider) { window.$message?.warning('这段历史属于另一个智能体，请新建对话后发送'); return }

    // 还没转换完的 chip 这一轮先不发：留给下一轮，别把半截数据写进会话
    const attachments = pendingImages.value.filter(item => !item.loading && item.dataBase64)

    const projectId = currentProject.value?.id
    const explicitReferences = [...new Set([...attachments.map(item => item.nodeId).filter(Boolean), ...selectedNodeIds.value.filter(id => nodes.value.some(node => node.id === id && node.type === 'image'))])]
    const referenceNodeIds = explicitReferences.length ? explicitReferences : (attachments.length ? [] : inheritedReferences(messages.value, projectId))
    error.value = ''
    messages.value.push({
      id: newSessionId(),
      role: 'user',
      createdAt: Date.now(),
      content: prompt,
      skill,
      streaming: false,
      // 记下当时发的图（用降采样后的小图当缩略图，不为 60px 展示去解码大图）
      images: attachments.map(item => item.previewUrl)
    })
    messages.value.push({ id: newSessionId(), role: 'assistant', createdAt: Date.now(), projectId:currentProject.value?.id, referenceNodeIds, nodeIds: [...new Set([...selectedNodeIds.value, ...attachments.map(item => item.nodeId).filter(Boolean)])], content: '', streaming: true, status: '', copyOnly: isCopyRequest(prompt) })
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
      provider, permission:settings.permission,
      projectName: currentProject.value?.title || currentProject.value?.name || ''
    })

    // 有图无图同一条路径：无附件时 content 里就只有一个文字块
    const input = buildAgentInputLine({ text: skill
      ? `用户明确选择了本地技能「${skill}」。请先使用 Skill 工具调用该技能，再按技能完成以下需求：\n${prompt}`
      : copyRequestPrompt(prompt), images: attachments })

    const channel = new Channel()
    channel.onmessage = event => inConversation(conversationId,() => handleEvent(event, provider))

    try {
      if (provider === 'codex') {
        const skillInfo=settings.skills?.find(item => item.name===skill)
        const inputs=[...attachments.map(item => ({type:'image',url:`data:${item.mime};base64,${item.dataBase64}`})),{type:'text',text:copyRequestPrompt(prompt)}]
        if (skill && !skillInfo?.path) throw new Error('技能列表已变化，请重新选择技能')
        if (skillInfo?.path) inputs.push({type:'skill',name:skillInfo.name,path:skillInfo.path})
        await invoke('codex_send', { requestId, input:inputs, sessionId:sessionId.value, resume:sessionStarted.value, cliPath:settings.path, systemPrompt, cwd:settings.cwd, model:settings.model, permission:settings.permission, onEvent:channel })
      } else await invoke('agent_send', {
        requestId,
        input,
        sessionId: sessionId.value,
        resume: sessionStarted.value,
        cliPath: settings.path,
        cwd:settings.cwd, model:settings.model, permission:settings.permission,
        systemPrompt,
        onEvent: channel
      })
    } catch (err) {
      inConversation(conversationId,() => { error.value=provider==='codex' ? codexErrorText(err?.message || err) : String(err?.message || err || '启动智能体失败') })
    } finally {
      // done 事件通常已经收尾；这里兜底，防止 invoke 直接抛错时状态卡住
      inConversation(conversationId,() => { if (activeRequestId===requestId) finishTurn() })
    }

    // 图已随会话进了 Claude Code 的历史，后续追问靠 --resume，不重发。
    // 只清掉这一轮真发出去的；仍在转换的 chip 留着，下一轮还能用。
    if (conversations.value.find(item=>item.id===conversationId)?.error) return
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

  function inheritedReferences(history, projectId) {
    for(let i = history.length - 1; i >= 0; i--) {
      const message = history[i]
      if(message.projectId && message.projectId !== projectId) return []
      if(message.referenceNodeIds?.length) return [...message.referenceNodeIds]
      if(message.role === 'user' && message.images?.length) return []
    }
    return []
  }
  const sendPromptsToCanvas = (message, indices) => {
    if(message.projectId!==currentProject.value?.id) throw new Error('请打开生成这条提示词时的画布')
    const references=message.referenceNodeIds?.length ? message.referenceNodeIds : inheritedReferences(messages.value.slice(0, messages.value.indexOf(message)), currentProject.value?.id)
    message.referenceNodeIds = [...references]
    const sources=references.map(id=>nodes.value.find(node=>node.id===id))
    if(sources.some(node=>!node)) throw new Error('部分参考图已删除，请恢复参考图后再发送')
    const ids=[]
    const right=Math.max(100,...sources.map(node=>(node.position?.x || 0)+(node.dimensions?.width || 280)))
    const top=Math.min(...sources.map(node=>node.position?.y || 0),sources.length?Infinity:100)
    startBatchOperation()
    try {
      for(const index of indices){
        const item=message.prompts?.[index];if(!item)continue
        const existing=nodes.value.find(node=>node.id===item.nodeId)
        if(existing){
          const ratio=agentPromptRatio(item)
          if(ratio && !existing.data?.ratio && !existing.data?.size) updateNode(existing.id,{ratio})
          if(sources.length && !edges.value.some(edge => edge.target === existing.id)) {
            let y = top
            while(nodes.value.some(node => node.id !== existing.id && Math.abs((node.position?.x || 0) - (right + 120)) < 300 && Math.abs((node.position?.y || 0) - y) < 360)) y += 400
            existing.position = { x: right + 120, y }
            sources.forEach(source => addEdge({ source: source.id, target: existing.id }))
          }
          ids.push(item.nodeId);continue
        }
        let y=top
        while(nodes.value.some(node=>Math.abs((node.position?.x || 0)-(right+120))<300 && Math.abs((node.position?.y || 0)-y)<360))y+=400
        const id=addNode('image',{x:right+120,y},{label:[item.group,item.title].filter(Boolean).join(' · '),prompt:item.prompt,ratio:agentPromptRatio(item)})
        sources.forEach(source=>addEdge({source:source.id,target:id}))
        item.nodeId=id;ids.push(id)
      }
    } finally {endBatchOperation()}
    selectedNodeIds.value=ids
    message.nodeIds=[...new Set([...(message.nodeIds || []),...ids])]
    persistHistory()
    return ids
  }
  return {
    sendPromptsToCanvas,
    activeProvider, activeAgentName, enableProvider, anyRunning, approvalRequests, respondCodexRequest,
    conversations, openConversations, historyConversations, activeConversationId, historyReady, draft,
    newConversation, switchConversation, closeConversation, deleteConversation, persistHistory, archivedConversations, renameConversation, archiveConversation,
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
