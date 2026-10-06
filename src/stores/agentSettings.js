import { reactive, computed } from 'vue'
const key = 'ling-canvas-local-agents'
let saved = {}, legacyClaudePath = ''
try { saved = JSON.parse(localStorage.getItem(key) || '{}'); legacyClaudePath = localStorage.getItem('ling-canvas-claude-cli-path') || '' } catch {}
const defaults = () => ({ path:'', model:'', cwd:'', permission:'workspaceWrite', status:'未检测', loggedIn:null, models:[], skills:[] })
export const agentSettings = reactive({
  active:saved.active === 'codex' ? 'codex' : 'claude',
  claude:{...defaults(), path:legacyClaudePath, ...saved.claude},
  codex:{...defaults(), ...saved.codex}
})
export const activeAgentName = computed(() => agentSettings.active === 'codex' ? 'Codex' : 'Claude Code')
export const saveAgentSettings = () => { try { localStorage.setItem(key, JSON.stringify(agentSettings)) } catch { window.$message?.error('智能体设置保存失败') } }
