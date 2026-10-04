<script setup>
import { ref } from 'vue'
import { NButton, NSwitch, useDialog, useMessage } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { isDark } from '../stores/theme'
import { preferences, setPreference } from '../stores/preferences'
import { assetRoot, assetEpoch, assetStatus, loadAssetLibrary, changeAssetRoot } from '../stores/assets'
import { resetAssetThumbCache } from '../services/assetLibrary'
import { useAgentStore } from '../stores/agent'
import { agentShortcutLabel } from '../stores/agentShortcut'
import { appVersion } from '../composables/useAppVersion'
import AssetFolderManager from './assets/AssetFolderManager.vue'
defineProps({page:String})
defineEmits(['close'])
const agent = useAgentStore(), dialog = useDialog(), message = useMessage()
const showFolders = ref(false), busy = ref(false)
const pickingCli = ref(false)
const detectingCli = ref(false)
const detectCliPath = async () => {
  if (detectingCli.value || pickingCli.value) return
  if (!('__TAURI_INTERNALS__' in window)) { message.info('请在桌面应用中检测程序路径'); return }
  detectingCli.value = true
  try {
    const path = await invoke('detect_agent_cli_path')
    if (path) { agent.setCliPath(path); message.success('已检测并保存 Claude Code 路径') }
    else message.warning('未找到 Claude Code，请安装后重试或手动选择路径')
  } catch (error) { message.error(String(error?.message || error)) }
  finally { detectingCli.value = false }
}
const chooseCliPath = async () => {
  if (pickingCli.value || detectingCli.value) return
  if (!('__TAURI_INTERNALS__' in window)) { message.info('请在桌面应用中选择程序路径'); return }
  pickingCli.value = true
  try {
    const path = await invoke('pick_agent_cli_path')
    if (path) { agent.setCliPath(path); message.success('程序路径已保存') }
  } catch (error) { message.error(String(error?.message || error)) }
  finally { pickingCli.value = false }
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
    <section class="prefs-card"><h3>素材库</h3><div class="prefs-row"><div><span>素材目录</span><small>{{ assetRoot || '未设置' }}</small></div><NButton size="small" @click="chooseRoot">更改目录</NButton></div><div class="prefs-row"><span>目录可见性</span><NButton size="small" @click="showFolders=true">管理目录</NButton></div><div class="prefs-row"><span>扫描素材</span><NButton size="small" :loading="assetStatus==='loading'" @click="loadAssetLibrary(true)">重新扫描</NButton></div></section>
    <section class="prefs-card"><h3>图片缓存</h3><div class="prefs-row"><span>主页预加载最近画布</span><NSwitch :value="preferences.prewarm" @update:value="value=>setPreference('prewarm',value)" /></div><div class="prefs-row"><span>内存缓存上限</span><span class="muted">64 MB</span></div><div class="prefs-row"><span>磁盘预览缓存</span><NButton size="small" :loading="busy" @click="clearCache">清理预览缓存</NButton></div></section>
  </template>
  <template v-if="page==='agent'">
    <section class="prefs-card"><h3>本地 Claude Code</h3><div class="prefs-row"><div><span>程序路径</span><small :title="agent.cliPath">{{ agent.cliPath || '自动检测' }}</small></div><div class="path-actions"><NButton size="small" :loading="detectingCli" :disabled="pickingCli" @click="detectCliPath">自动检测</NButton><NButton size="small" :loading="pickingCli" :disabled="detectingCli" @click="chooseCliPath">选择路径</NButton></div></div><div class="prefs-row"><span>智能体快捷键</span><span class="muted">{{ agentShortcutLabel }}</span></div><div class="prefs-row"><span>对话历史</span><NButton size="small" @click="agent.openPanel(); $emit('close')">打开智能体</NButton></div></section>
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
