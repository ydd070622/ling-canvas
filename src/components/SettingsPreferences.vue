<script setup>
import { ref, computed, onMounted } from 'vue'
import { NButton, NSwitch, NInput, NSelect, NIcon, NTooltip, useDialog, useMessage } from 'naive-ui'
import { TerminalOutline, CodeSlashOutline, RefreshOutline, FolderOpenOutline } from '@vicons/ionicons5'
import { invoke } from '@tauri-apps/api/core'
import { isDark } from '../stores/theme'
import { preferences, setPreference } from '../stores/preferences'
import { assetRoot, assetEpoch, assetStatus, loadAssetLibrary, changeAssetRoot } from '../stores/assets'
import { resetAssetThumbCache } from '../services/assetLibrary'
import { agentSettings, saveAgentSettings, activeAgentName } from '../stores/agentSettings'
import { useAgentStore } from '../stores/agent'
import { agentShortcutLabel } from '../stores/agentShortcut'
import { appVersion } from '../composables/useAppVersion'
import AssetFolderManager from './assets/AssetFolderManager.vue'
defineProps({page:String})
defineEmits(['close'])
const agent = useAgentStore(), dialog = useDialog(), message = useMessage()
const showFolders = ref(false), busy = ref(false)
const agentBusy = ref('')
const providerNames = {claude:'Claude Code', codex:'Codex'}
const providerStatus = provider => {
  const config=agentSettings[provider]
  if(agentBusy.value===provider) return '检测中'
  if(config.loggedIn===true && !/失败|未找到|超时/.test(config.status)) return '已登录'
  if(config.loggedIn===false) return '未登录'
  if(config.status==='未检测') return '未检测'
  if(/未找到/.test(config.status)) return '未安装'
  if(/无法确认/.test(config.status)) return '状态未知'
  return '检测失败'
}
const selectedConfig = computed(() => agentSettings[agentSettings.active])
const permissionOptions = [{label:'允许执行',value:'workspaceWrite'},{label:'只读',value:'readOnly'}]
const modelOptions = computed(() => {
  const options=[{label:'默认',value:''}, ...selectedConfig.value.models.map(item => ({label:item.name || item.id,value:item.id}))]
  const selected=selectedConfig.value.model
  if(selected && !options.some(item=>item.value===selected)) options.push({label:selected,value:selected})
  return options
})
const checkAgent = async (provider, activate = false, manual = false) => {
  if (agentBusy.value || agent.anyRunning) return
  if (!('__TAURI_INTERNALS__' in window)) { message.info('请在桌面应用中检测本地智能体'); return }
  agentBusy.value=provider
  try {
    const config=agentSettings[provider]
    let path=config.path
    if (manual) { path=await invoke('pick_agent_cli_path'); if (!path) return }
    config.status='正在检测程序和登录状态…'
    const result=await invoke('probe_local_agent',{provider,cliPath:path,cwd:config.cwd})
    Object.assign(config,result); config.path=result.path; saveAgentSettings()
    if (provider==='claude') agent.setCliPath(result.path)
    if (activate && result.loggedIn === false) { message.warning(result.status); return }
    if (activate) agent.enableProvider(provider)
    message.success(activate ? `已启用 ${providerNames[provider]}` : '检测完成')
    if (provider==='codex' && result.loggedIn!==false) {
      // Optional capabilities must not turn a successful login check into a failure.
      try {
        const metadata=await invoke('codex_capabilities',{cliPath:config.path,cwd:config.cwd,scope:'models'})
        config.models=metadata.models
        if (!config.model) config.model=metadata.models.find(item=>item.isDefault)?.id || metadata.models[0]?.id || ''
        saveAgentSettings()
      } catch(error) {message.warning(String(error?.message || error))}
    }
  } catch (error) { agentSettings[provider].status=String(error?.message || error); saveAgentSettings(); message.error(agentSettings[provider].status) }
  finally { agentBusy.value='' }
}
const chooseAgentDirectory = async () => {
  if (agent.anyRunning) return
  try { const path=await invoke('pick_agent_work_dir'); if(path){selectedConfig.value.cwd=path; saveAgentSettings()} }
  catch(e){message.error(String(e))}
}
const mediaRoot = ref(''), migratingMedia = ref(false)
onMounted(async () => {
  if ('__TAURI_INTERNALS__' in window) {
    try { mediaRoot.value = await invoke('get_media_storage_root') } catch (e) { message.error(String(e)) }
  }
})
const chooseMediaStorage = async () => {
  if (migratingMedia.value) return
  if (!('__TAURI_INTERNALS__' in window)) { message.info('请在桌面应用中选择存储文件夹'); return }
  migratingMedia.value = true
  try {
    const path = await invoke('pick_media_storage_root')
    if (path) { mediaRoot.value = path; message.success('图片已复制并校验，存储位置已切换；旧文件夹保留备份') }
  } catch (e) { message.error(String(e?.message || e)) }
  finally { migratingMedia.value = false }
}
const titles = {canvas:'画布偏好',media:'素材与存储',agent:'智能体',shortcuts:'快捷键',about:'关于'}
const chooseRoot = () => dialog.warning({title:'更改素材目录',content:'画布里的素材引用会按新目录解析。',positiveText:'选择目录',negativeText:'取消',onPositiveClick:async()=>{try{await changeAssetRoot()}catch(e){message.error(String(e.message||e))}}})
const clearCache = () => dialog.warning({title:'清理预览缓存',content:'原始图片和项目会保留，下次浏览时重建预览。',positiveText:'清理',negativeText:'取消',onPositiveClick:async()=>{busy.value=true;try{await resetAssetThumbCache();assetEpoch.value++;message.success('预览缓存已清理')}catch(e){message.error(String(e.message||e))}finally{busy.value=false}}})
</script>
<template>
  <h2 class="prefs-title">{{ titles[page] }}</h2>
  <template v-if="page==='canvas'">
    <section class="prefs-card"><h3>外观</h3><div class="prefs-row"><span>深色主题</span><NSwitch v-model:value="isDark" /></div><div class="prefs-row"><span>画布背景</span><span class="muted">纯色</span></div></section>
    <section class="prefs-card"><h3>移动与缩放</h3><div class="prefs-row"><span>滚轮缩放</span><NSwitch :value="preferences.zoomOnScroll" @update:value="value=>setPreference('zoomOnScroll',value)" /></div><div class="prefs-row"><span>平移画布</span><span class="muted">空格 + 拖动 / 中键 / 右键</span></div><div class="prefs-row"><span>自动保存</span><span class="muted">已开启</span></div></section>
  </template>
  <template v-if="page==='media'">
    <section class="prefs-card"><h3>画布图片存储</h3><div class="prefs-row"><div><span>原图与预览图文件夹</span><small :title="mediaRoot">{{ mediaRoot || '默认应用数据目录' }}</small></div><NButton size="small" :loading="migratingMedia" :disabled="migratingMedia" @click="chooseMediaStorage">选择文件夹</NButton></div><small class="muted">在所选目录创建 LingCanvas-media 文件夹。已有图片自动复制并校验，完成后切换；旧目录保留备份。迁移期间请勿关闭应用。</small></section>
    <section class="prefs-card"><h3>素材库</h3><div class="prefs-row"><div><span>素材目录</span><small>{{ assetRoot || '未设置' }}</small></div><NButton size="small" @click="chooseRoot">更改目录</NButton></div><div class="prefs-row"><span>目录可见性</span><NButton size="small" @click="showFolders=true">管理目录</NButton></div><div class="prefs-row"><span>扫描素材</span><NButton size="small" :loading="assetStatus==='loading'" @click="loadAssetLibrary(true)">重新扫描</NButton></div></section>
    <section class="prefs-card"><h3>图片缓存</h3><div class="prefs-row"><span>启动时预加载最近画布</span><NSwitch :value="preferences.prewarm" @update:value="value=>setPreference('prewarm',value)" /></div><div class="prefs-row"><span>内存缓存上限</span><span class="muted">64 MB</span></div><div class="prefs-row"><span>磁盘预览缓存</span><NButton size="small" :loading="busy" @click="clearCache">清理预览缓存</NButton></div></section>
  </template>
  <template v-if="page==='agent'">
    <div class="agent-provider-grid">
      <section v-for="provider in ['claude','codex']" :key="provider" class="agent-provider" :class="{'is-active':agentSettings.active===provider}">
        <div class="agent-provider-top"><NIcon size="21"><component :is="provider==='claude' ? TerminalOutline : CodeSlashOutline"/></NIcon><h3>{{ providerNames[provider] }}</h3><NButton size="small" :type="agentSettings.active===provider ? 'primary' : 'default'" :loading="agentBusy===provider" :disabled="!!agentBusy || agent.anyRunning || !agent.historyReady" @click="checkAgent(provider,true)">{{ agentSettings.active===provider ? '已启用' : '启用' }}</NButton></div>
        <div class="agent-provider-bottom"><NTooltip><template #trigger><span class="agent-provider-status" :class="{'is-ready':providerStatus(provider)==='已登录'}" aria-live="polite"><i></i>{{ providerStatus(provider) }}</span></template>{{ agentSettings[provider].status }}</NTooltip><div class="agent-provider-tools"><NTooltip><template #trigger><NButton quaternary circle size="small" aria-label="重新检测" :disabled="!!agentBusy || agent.anyRunning" @click="checkAgent(provider)"><template #icon><NIcon><RefreshOutline/></NIcon></template></NButton></template>重新检测</NTooltip><NTooltip><template #trigger><NButton quaternary circle size="small" aria-label="选择程序" :disabled="!!agentBusy || agent.anyRunning" @click="checkAgent(provider,false,true)"><template #icon><NIcon><FolderOpenOutline/></NIcon></template></NButton></template>选择程序</NTooltip></div></div>
      </section>
    </div>
    <section class="agent-config">
      <div class="agent-config-heading"><h3>配置</h3><span>{{ activeAgentName }}</span></div>
      <div class="agent-config-row"><span>程序</span><div class="agent-config-control agent-path" :title="selectedConfig.path">{{ selectedConfig.path || '自动检测' }}</div></div>
      <div class="agent-config-row"><label>模型</label><div class="agent-config-control"><NSelect v-if="agentSettings.active==='codex'" filterable tag placeholder="选择或输入模型" :value="selectedConfig.model" :options="modelOptions" :disabled="agent.anyRunning" @update:value="value=>{selectedConfig.model=value;saveAgentSettings()}"/><NInput v-else v-model:value="selectedConfig.model" placeholder="默认" :disabled="agent.anyRunning" @change="saveAgentSettings" /></div></div>
      <div class="agent-config-row"><span>工作目录</span><div class="agent-config-control agent-directory"><span class="agent-path" :title="selectedConfig.cwd">{{ selectedConfig.cwd || '默认' }}</span><NButton size="small" :disabled="agent.anyRunning" @click="chooseAgentDirectory"><template #icon><NIcon><FolderOpenOutline/></NIcon></template>选择</NButton></div></div>
      <div class="agent-config-row"><label>权限</label><div class="agent-config-control"><NSelect v-model:value="selectedConfig.permission" :options="permissionOptions" :disabled="agent.anyRunning" @update:value="saveAgentSettings" /></div></div>
    </section>
    <div class="agent-settings-footer"><span>{{ agentShortcutLabel }}</span><NButton text @click="agent.openPanel(); $emit('close')">打开智能体</NButton></div>
  </template>
  <template v-if="page==='shortcuts'">
    <section class="prefs-card"><h3>智能体</h3><div class="prefs-row"><span>打开 / 关闭智能体</span><kbd>{{ agentShortcutLabel }}</kbd></div></section>
    <section class="prefs-card"><h3>画布</h3><div v-for="item in [['添加节点','双击空白处'],['平移','空格 + 拖动 / 鼠标中键'],['多选','Ctrl / Shift + 点击'],['撤销','Ctrl + Z'],['重做','Ctrl + Shift + Z'],['删除','Backspace / Delete']]" :key="item[0]" class="prefs-row"><span>{{ item[0] }}</span><kbd>{{ item[1] }}</kbd></div></section>
  </template>
  <section v-if="page==='about'" class="prefs-card"><h3>Ling Canvas</h3><div class="prefs-row"><span>版本</span><span>{{ appVersion }}</span></div><div class="prefs-row"><span>项目存储</span><span class="muted">本地</span></div></section>
  <AssetFolderManager v-model:show="showFolders" />
</template>
<style scoped>
.path-actions{display:flex;gap:8px;flex-shrink:0}
.prefs-title{font-size:21px;margin:0 0 22px}.prefs-card{margin-top:16px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-secondary);padding:18px}.prefs-card h3{font-size:14px;margin:0 0 8px}.prefs-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:15px 0;border-bottom:1px solid var(--border-color);font-size:13px}.prefs-row:last-child{border-bottom:0;padding-bottom:0}.prefs-row small{display:block;color:var(--text-secondary);font-size:11px;overflow-wrap:anywhere;margin-top:5px}.muted,kbd{color:var(--text-secondary);font-size:12px}.shortcut-capture{border:1px solid var(--border-color);border-radius:7px;padding:7px 12px;background:var(--bg-tertiary)}
</style>

<style scoped>
.agent-provider-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.agent-provider { border:1px solid var(--border-color); border-radius:12px; padding:16px; background:var(--bg-secondary); min-width:0; }
.agent-provider.is-active { border-color:var(--text-secondary); }
.agent-provider-top { display:flex; align-items:center; gap:9px; }
.agent-provider-top h3 { flex:1; margin:0; font-size:14px; font-weight:500; }
.agent-provider-top>.n-icon { color:var(--text-secondary); flex-shrink:0; }
.agent-provider-bottom { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:16px; }
.agent-provider-status { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--text-secondary); }
.agent-provider-status i { width:6px; height:6px; border-radius:50%; background:var(--text-secondary); }
.agent-provider-status.is-ready i { background:var(--flow-status-success, #10b981); }
.agent-provider-tools { display:flex; gap:3px; }
.agent-config { margin-top:24px; }
.agent-config-heading { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.agent-config-heading h3 { margin:0; font-size:13px; font-weight:500; }
.agent-config-heading>span { color:var(--text-secondary); font-size:12px; }
.agent-config-row { display:grid; grid-template-columns:82px minmax(0,1fr); align-items:center; gap:18px; padding:13px 0; border-bottom:1px solid var(--border-color); font-size:13px; }
.agent-config-row:last-child { border-bottom:0; }
.agent-config-control { width:100%; min-width:0; }
.agent-path { color:var(--text-secondary); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.agent-directory { display:flex; align-items:center; gap:12px; }
.agent-directory>span { flex:1; min-width:0; }
.agent-settings-footer { display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--border-color); padding-top:16px; margin-top:18px; }
.agent-settings-footer>span { font-size:12px; color:var(--text-secondary); }
@media(max-width:600px){.agent-provider-grid{grid-template-columns:1fr}.agent-config-row{grid-template-columns:70px minmax(0,1fr);gap:10px}}
</style>
