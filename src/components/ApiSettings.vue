<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="模型配置"
    class="api-settings-modal"
    :bordered="false"
    :segmented="{ content: true }"
  >
    <div class="settings-layout">
      <aside class="provider-panel">
        <div class="provider-heading">
          <div>
            <h3>供应商</h3>
            <p>选择或添加 API 来源</p>
          </div>
        </div>

        <div class="provider-list">
          <div
            v-for="provider in providerOptions"
            :key="provider.key"
            class="provider-item"
            :class="{
              active: formData.provider === provider.key,
              dragging: draggingProviderKey === provider.key,
              'drag-over': dragOverProviderKey === provider.key
            }"
            :data-provider-key="provider.key"
          >
            <span
              class="provider-drag-handle"
              title="按住拖动排序"
              @pointerdown.stop.prevent="startProviderDrag($event, provider.key)"
              @pointermove.stop.prevent="moveProviderDrag"
              @pointerup.stop.prevent="finishProviderDrag"
              @pointercancel.stop="endProviderDrag"
            >⠿</span>
            <button type="button" class="provider-select" @click="selectProvider(provider.key)">
              <span class="provider-avatar">{{ provider.label.slice(0, 1).toUpperCase() }}</span>
              <span class="provider-name">{{ provider.label }}</span>
              <span v-if="hasProviderKey(provider.key)" class="provider-dot"></span>
            </button>
          </div>
        </div>

        <button type="button" class="add-provider-button" @click="addBlankProvider">
          <n-icon :size="16"><AddOutline /></n-icon>
          添加供应商
        </button>
      </aside>

      <section class="settings-main">
        <div class="config-card">
          <div class="config-title-row">
            <div class="provider-identity">
              <span class="provider-avatar large">{{ formData.name.slice(0, 1).toUpperCase() || 'A' }}</span>
              <div>
                <h3>{{ formData.name || '未命名供应商' }}</h3>
                <p>配置供应商名称、接口地址与 API Key</p>
              </div>
            </div>
            <div class="config-header-actions">
              <div class="connection-badge" :class="connectionStatus">
                <span class="status-dot"></span>
                {{ connectionStatusLabel }}
              </div>
              <n-button size="small" type="primary" :loading="saving" @click="saveProvider">保存供应商</n-button>
              <n-button size="small" :loading="testing" :disabled="!formData.baseUrl" @click="testConnection">
                <template #icon><n-icon><CloudOutline /></n-icon></template>
                测试连接
              </n-button>
              <n-button
                v-if="!isLinkapi"
                size="small"
                quaternary
                type="error"
                @click="deleteCurrentProvider()"
              >
                <template #icon><n-icon><TrashOutline /></n-icon></template>
                删除
              </n-button>
            </div>
          </div>

          <div class="config-grid">
            <label class="field">
              <span>供应商名称</span>
              <n-input v-model:value="formData.name" placeholder="例如 OpenAI" />
            </label>
            <label class="field wide">
              <span>接口地址 Base URL</span>
              <n-input v-model:value="formData.baseUrl" placeholder="https://api.example.com/v1" />
            </label>
            <label class="field full">
              <span>API Key</span>
              <n-input
                v-model:value="formData.apiKey"
                type="password"
                show-password-on="click"
                placeholder="请输入 API Key"
              />
            </label>
          </div>

        </div>

        <div class="models-card">
          <div class="models-header">
            <div>
              <h3>可用模型</h3>
              <p>通过供应商 API 拉取模型，并选择需要加入画布的模型</p>
            </div>
            <div class="models-toolbar">
              <div class="model-filters">
                <button
                  v-for="filter in modelFilters"
                  :key="filter.key"
                  type="button"
                  :class="{ active: activeModelFilter === filter.key }"
                  @click="activeModelFilter = filter.key"
                >
                  <n-icon :size="14"><component :is="filter.icon" /></n-icon>
                  {{ filter.label }}
                  <span>{{ modelCount(filter.key) }}</span>
                </button>
              </div>
              <n-button size="tiny" :loading="testing" :disabled="!formData.baseUrl" @click="testConnection">
                <template #icon><n-icon><RefreshOutline /></n-icon></template>
                刷新模型
              </n-button>
            </div>
          </div>

          <div class="model-list">
            <div v-if="testing" class="models-empty"><n-spin size="small" /> 正在连接并读取模型…</div>
            <template v-else-if="filteredModels.length">
              <div v-for="model in filteredModels" :key="model.id" class="model-row">
                <div class="model-type-icon" :class="model.type">
                  <n-icon :size="17"><component :is="iconForModelType(model.type)" /></n-icon>
                </div>
                <div class="model-info">
                  <input
                    v-model="model.name"
                    class="model-display-name"
                    title="点击修改画布中显示的名称"
                    @click.stop
                    @blur="saveModelAlias(model)"
                    @keydown.enter.prevent="$event.target.blur()"
                  />
                  <span>{{ model.id }}</span>
                </div>
                <span class="model-type-label">{{ typeLabel(model.type) }}</span>
                <n-switch
                  :value="isModelEnabled(model)"
                  size="small"
                  @update:value="value => toggleModel(model, value)"
                />
              </div>
            </template>
            <div v-else class="models-empty">
              <n-icon :size="32"><CloudOutline /></n-icon>
              <strong>尚未拉取模型</strong>
              <span>保存配置后点击“测试连接”或“刷新模型”</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </n-modal>
</template>

<script setup>
import { computed, markRaw, reactive, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  NButton,
  NIcon,
  NInput,
  NModal,
  NSpin,
  NSwitch,
  useDialog,
  useMessage
} from 'naive-ui'
import {
  AddOutline,
  ChatbubbleEllipsesOutline,
  CloudOutline,
  ImageOutline,
  RefreshOutline,
  TrashOutline,
  VideocamOutline
} from '@vicons/ionicons5'
import { useModelStore } from '../stores/pinia'

const REMOTE_MODELS_CACHE_KEY = 'api-remote-models-by-provider'

const loadRemoteModelsCache = () => {
  try {
    return JSON.parse(localStorage.getItem(REMOTE_MODELS_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

const props = defineProps({
  show: { type: Boolean, default: false }
})

const emit = defineEmits(['update:show', 'saved'])
const modelStore = useModelStore()
const message = useMessage()
const dialog = useDialog()

const showModal = ref(props.show)
const saving = ref(false)
const testing = ref(false)
const draggingProviderKey = ref('')
const dragOverProviderKey = ref('')
const activeModelFilter = ref('all')
const connectionStatus = ref('idle')
const remoteModelsByProvider = ref(loadRemoteModelsCache())

const formData = reactive({
  provider: modelStore.currentProvider,
  name: '',
  baseUrl: '',
  apiKey: ''
})

const providerOptions = computed(() => modelStore.providerList)
const currentProvider = computed(() => providerOptions.value.find(item => item.key === formData.provider))
const isCustomProvider = computed(() => !!currentProvider.value?.isCustom)
const isLinkapi = computed(() => currentProvider.value?.key === 'linkapi')
const remoteModels = computed(() => remoteModelsByProvider.value[formData.provider] || [])

const modelFilters = [
  { key: 'all', label: '全部', icon: markRaw(CloudOutline) },
  { key: 'text', label: '文本', icon: markRaw(ChatbubbleEllipsesOutline) },
  { key: 'image', label: '图像', icon: markRaw(ImageOutline) },
  { key: 'video', label: '视频', icon: markRaw(VideocamOutline) }
]

const filteredModels = computed(() => activeModelFilter.value === 'all'
  ? remoteModels.value
  : remoteModels.value.filter(model => model.type === activeModelFilter.value))

const connectionStatusLabel = computed(() => ({
  idle: '未测试',
  testing: '连接中',
  success: '连接成功',
  error: '连接失败'
})[connectionStatus.value] || '未测试')

const updateForm = () => {
  const provider = currentProvider.value
  const config = modelStore.customProviders[formData.provider] || modelStore.providerList.find(item => item.key === formData.provider)
  formData.name = provider?.label || formData.provider
  formData.apiKey = modelStore.apiKeysByProvider[formData.provider] || ''
  formData.baseUrl = modelStore.baseUrlsByProvider[formData.provider]
    || modelStore.customProviders[formData.provider]?.defaultBaseUrl
    || (formData.provider === modelStore.currentProvider ? modelStore.currentBaseUrl : '')
  if (!formData.baseUrl && config?.defaultBaseUrl) formData.baseUrl = config.defaultBaseUrl
  ensureConfiguredModelsVisible(formData.provider)
  connectionStatus.value = remoteModelsByProvider.value[formData.provider]?.length ? 'success' : 'idle'
  activeModelFilter.value = 'all'
}

const ensureConfiguredModelsVisible = provider => {
  if (remoteModelsByProvider.value[provider]?.length) return
  const configured = [
    ...(modelStore.customChatModelsByProvider[provider] || []).map(model => ({ id: model.key, name: model.label || model.key, type: 'text' })),
    ...(modelStore.customImageModelsByProvider[provider] || []).map(model => ({ id: model.key, name: model.label || model.key, type: 'image' })),
    ...(modelStore.customVideoModelsByProvider[provider] || []).map(model => ({ id: model.key, name: model.label || model.key, type: 'video' }))
  ]
  if (configured.length) {
    remoteModelsByProvider.value = { ...remoteModelsByProvider.value, [provider]: configured }
  }
}

watch(() => props.show, value => {
  showModal.value = value
  if (value) {
    formData.provider = modelStore.currentProvider
    updateForm()
  }
})

watch(showModal, value => emit('update:show', value))

watch(remoteModelsByProvider, value => {
  try {
    localStorage.setItem(REMOTE_MODELS_CACHE_KEY, JSON.stringify(value))
  } catch {
    // Ignore storage quota errors; provider configuration remains available.
  }
}, { deep: true })

const selectProvider = key => {
  formData.provider = key
  // The provider being configured is also the provider used by canvas model
  // selectors, so model switches take effect immediately without another save.
  modelStore.setProvider(key)
  updateForm()
}

const startProviderDrag = (event, key) => {
  draggingProviderKey.value = key
  dragOverProviderKey.value = key
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

const moveProviderDrag = event => {
  if (!draggingProviderKey.value) return
  const items = [...document.querySelectorAll('.provider-item[data-provider-key]')]
  let closestKey = ''
  let closestDistance = Number.POSITIVE_INFINITY
  items.forEach(item => {
    const rect = item.getBoundingClientRect()
    const distance = Math.abs(event.clientY - (rect.top + rect.height / 2))
    if (distance < closestDistance) {
      closestDistance = distance
      closestKey = item.dataset.providerKey || ''
    }
  })
  if (closestKey) dragOverProviderKey.value = closestKey
}

const finishProviderDrag = event => {
  const sourceKey = draggingProviderKey.value
  const targetKey = dragOverProviderKey.value
  if (sourceKey && targetKey && sourceKey !== targetKey) {
    modelStore.reorderProviders(sourceKey, targetKey)
  }
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  endProviderDrag()
}

const endProviderDrag = () => {
  draggingProviderKey.value = ''
  dragOverProviderKey.value = ''
}

const hasProviderKey = key => !!modelStore.apiKeysByProvider[key]

const addBlankProvider = () => {
  const key = modelStore.addCustomProvider('新供应商')
  if (!key) return
  formData.provider = key
  modelStore.setProvider(key)
  updateForm()
}

const saveProvider = (notify = true) => {
  if (!formData.provider || !formData.baseUrl.trim()) {
    message.warning('请填写接口地址')
    return false
  }
  saving.value = true
  try {
    modelStore.updateProviderLabel(formData.provider, formData.name)
    if (isCustomProvider.value) {
      modelStore.updateCustomProvider(formData.provider, {
        label: formData.name.trim() || currentProvider.value?.label,
        defaultBaseUrl: formData.baseUrl.trim().replace(/\/$/, '')
      })
    }
    modelStore.setApiKeyByProvider(formData.provider, formData.apiKey.trim())
    modelStore.setBaseUrlByProvider(formData.provider, formData.baseUrl.trim().replace(/\/$/, ''))
    modelStore.setProvider(formData.provider)
    emit('saved')
    if (notify) message.success('供应商配置已保存')
    return true
  } finally {
    saving.value = false
  }
}

const getModelsEndpoint = () => {
  const base = formData.baseUrl.trim().replace(/\/$/, '')
  if (/\/v1$/i.test(base)) return `${base}/models`
  return `${base}/v1/models`
}

const detectModelType = model => {
  const explicit = String(model.type || model.category || model.model_type || '').toLowerCase()
  const name = String(model.id || model.name || '').toLowerCase()
  if (explicit.includes('video') || /(sora|veo|kling|seedance|video|wan\d)/.test(name)) return 'video'
  if (explicit.includes('image') || /(dall|imagen|image|flux|seedream|nano.?banana|gpt-image|stable.?diffusion)/.test(name)) return 'image'
  return 'text'
}

const normalizeModels = payload => {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.models) ? payload.models
        : Array.isArray(payload?.result) ? payload.result : []
  const seen = new Set()
  return list.map(item => {
    const source = typeof item === 'string' ? { id: item } : item
    const id = String(source.id || source.name || source.model || '').trim()
    return { id, name: source.display_name || source.label || source.name || id, type: detectModelType(source) }
  }).filter(model => model.id && !seen.has(model.id) && seen.add(model.id))
}

const testConnection = async () => {
  if (!saveProvider(false)) return
  testing.value = true
  connectionStatus.value = 'testing'
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  try {
    let payload
    if ('__TAURI_INTERNALS__' in window) {
      payload = await invoke('fetch_models', {
        url: getModelsEndpoint(),
        apiKey: formData.apiKey.trim()
      })
    } else {
      const headers = { Accept: 'application/json' }
      if (formData.apiKey.trim()) headers.Authorization = `Bearer ${formData.apiKey.trim()}`
      const response = await fetch(getModelsEndpoint(), { headers, signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      payload = await response.json()
    }
    const models = normalizeModels(payload)
    if (!models.length) throw new Error('接口已响应，但没有返回可识别的模型')
    const savedNames = new Map(remoteModels.value.map(model => [model.id, model.name]))
    const configuredNames = new Map([
      ...(modelStore.customChatModelsByProvider[formData.provider] || []),
      ...(modelStore.customImageModelsByProvider[formData.provider] || []),
      ...(modelStore.customVideoModelsByProvider[formData.provider] || [])
    ].map(model => [model.key, model.label || model.key]))
    models.forEach(model => {
      model.name = configuredNames.get(model.id) || savedNames.get(model.id) || model.name
    })
    remoteModelsByProvider.value = { ...remoteModelsByProvider.value, [formData.provider]: models }
    connectionStatus.value = 'success'
    message.success(`连接成功，已读取 ${models.length} 个模型`)
  } catch (error) {
    connectionStatus.value = 'error'
    const errorMessage = typeof error === 'string' ? error : error?.message || String(error)
    message.error(error?.name === 'AbortError' ? '连接超时，请检查地址' : `连接失败：${errorMessage}`)
  } finally {
    window.clearTimeout(timeout)
    testing.value = false
  }
}

const modelCount = type => type === 'all'
  ? remoteModels.value.length
  : remoteModels.value.filter(model => model.type === type).length

const typeLabel = type => ({ text: '文本', image: '图像', video: '视频' })[type] || '文本'
const iconForModelType = type => ({
  text: markRaw(ChatbubbleEllipsesOutline),
  image: markRaw(ImageOutline),
  video: markRaw(VideocamOutline)
})[type] || markRaw(ChatbubbleEllipsesOutline)

const customListForType = type => ({
  text: modelStore.customChatModelsByProvider,
  image: modelStore.customImageModelsByProvider,
  video: modelStore.customVideoModelsByProvider
})[type]

const isModelEnabled = model => (customListForType(model.type)?.[formData.provider] || []).some(item => item.key === model.id)

const addModelForType = type => ({
  text: modelStore.addCustomChatModelByProvider,
  image: modelStore.addCustomImageModelByProvider,
  video: modelStore.addCustomVideoModelByProvider
})[type]

const saveModelAlias = model => {
  model.name = model.name?.trim() || model.id
  if (isModelEnabled(model)) {
    addModelForType(model.type)?.(model.id, formData.provider, model.name)
  }
}

const toggleModel = (model, enabled) => {
  const provider = formData.provider
  modelStore.setProvider(provider)
  const add = addModelForType(model.type)
  const remove = {
    text: modelStore.removeCustomChatModelByProvider,
    image: modelStore.removeCustomImageModelByProvider,
    video: modelStore.removeCustomVideoModelByProvider
  }[model.type]
  if (enabled) add?.(model.id, provider, model.name)
  else remove?.(model.id, provider)
}

const deleteProvider = provider => {
  dialog.warning({
    title: '删除供应商',
    content: `确定删除“${provider.label}”及其本地配置吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      const wasSelected = formData.provider === provider.key
      modelStore.removeCustomProvider(provider.key)
      const cache = { ...remoteModelsByProvider.value }
      delete cache[provider.key]
      remoteModelsByProvider.value = cache
      if (wasSelected) {
        formData.provider = modelStore.currentProvider
        updateForm()
      }
      message.success('供应商已删除')
    }
  })
}

const deleteCurrentProvider = () => {
  if (currentProvider.value) {
    const provider = currentProvider.value
    dialog.warning({
      title: '删除供应商',
      content: `确定删除“${provider.label}”及其本地配置吗？`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        const wasSelected = formData.provider === provider.key
        modelStore.removeProvider(provider.key)
        const cache = { ...remoteModelsByProvider.value }
        delete cache[provider.key]
        remoteModelsByProvider.value = cache
        if (wasSelected) {
          formData.provider = modelStore.currentProvider
          updateForm()
        }
        message.success('供应商已删除')
      }
    })
  }
}

const clearProviderConfiguration = provider => {
  dialog.warning({
    title: '清除供应商配置',
    content: `确定清除“${provider.label}”的 API Key、接口地址和模型缓存吗？`,
    positiveText: '清除',
    negativeText: '取消',
    onPositiveClick: () => {
      modelStore.clearApiConfigByProvider(provider.key)
      const cache = { ...remoteModelsByProvider.value }
      delete cache[provider.key]
      remoteModelsByProvider.value = cache
      if (formData.provider === provider.key) updateForm()
      message.success('供应商配置已清除')
    }
  })
}
</script>

<style scoped>
:global(.api-settings-modal) {
  width: min(1180px, calc(100vw - 32px));
  height: min(800px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
}

:global(.api-settings-modal .n-card__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 !important;
}

:global(.api-settings-modal .n-card-header) {
  min-height: 44px;
  box-sizing: border-box;
  padding: 9px 16px !important;
}

:global(.api-settings-modal .n-card-header__main) {
  font-size: 15px;
  line-height: 24px;
}

:global(.api-settings-modal .n-card-header__close) {
  margin: 0;
}

.settings-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.provider-panel {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  padding: 20px 14px;
}

.provider-heading h3,
.config-card h3,
.models-card h3 { margin: 0; font-size: 16px; font-weight: 650; }
.provider-heading p,
.provider-identity p,
.models-header p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; }
.provider-list { margin-top: 18px; display: flex; flex: 1; flex-direction: column; gap: 6px; overflow-y: auto; }
.provider-item { display: flex; width: 100%; min-width: 0; align-items: center; border: 1px solid transparent; border-radius: 10px; padding: 4px; transition: .15s; }
.provider-item:hover { background: var(--bg-tertiary); }
.provider-item.active { border-color: color-mix(in srgb, var(--accent-color) 35%, var(--border-color)); background: color-mix(in srgb, var(--accent-color) 8%, transparent); }
.provider-item.dragging { opacity: .45; }
.provider-item.drag-over { border-color: var(--accent-color); box-shadow: inset 0 2px 0 var(--accent-color); }
.provider-drag-handle { display: flex; width: 16px; flex: 0 0 auto; cursor: grab; touch-action: none; user-select: none; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 17px; line-height: 1; opacity: .7; }
.provider-item:active .provider-drag-handle { cursor: grabbing; }
.provider-select { display: flex; min-width: 0; flex: 1; align-items: center; gap: 9px; padding: 5px; text-align: left; }
.provider-avatar { display: inline-flex; height: 28px; width: 28px; flex: 0 0 auto; align-items: center; justify-content: center; border-radius: 8px; background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-tertiary)); color: var(--accent-color); font-weight: 700; }
.provider-avatar.large { height: 42px; width: 42px; border-radius: 12px; font-size: 18px; }
.provider-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.provider-dot { height: 7px; width: 7px; border-radius: 999px; background: #22c55e; }
.add-provider-button { display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px dashed var(--border-color); border-radius: 10px; padding: 10px; color: var(--text-secondary); font-size: 13px; }
.add-provider-button:hover { border-color: var(--accent-color); color: var(--accent-color); }

.settings-main { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; padding: 16px; }
.config-card, .models-card { border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-secondary); padding: 18px; }
.config-title-row, .models-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.provider-identity { display: flex; align-items: center; gap: 12px; }
.config-header-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.connection-badge { display: flex; align-items: center; gap: 6px; border-radius: 999px; padding: 6px 10px; background: var(--bg-tertiary); color: var(--text-secondary); font-size: 12px; }
.connection-badge .status-dot { height: 7px; width: 7px; border-radius: 50%; background: #94a3b8; }
.connection-badge.success { color: #16a34a; background: color-mix(in srgb, #22c55e 12%, transparent); }
.connection-badge.success .status-dot { background: #22c55e; }
.connection-badge.error { color: #dc2626; background: color-mix(in srgb, #ef4444 12%, transparent); }
.connection-badge.error .status-dot { background: #ef4444; }
.connection-badge.testing .status-dot { background: #f59e0b; animation: pulse 1s infinite; }
.config-grid { display: grid; grid-template-columns: minmax(180px, .7fr) minmax(280px, 1.4fr); gap: 14px; margin-top: 18px; }
.field { display: flex; flex-direction: column; gap: 6px; color: var(--text-secondary); font-size: 12px; }
.field.full { grid-column: 1 / -1; }

.models-card { display: flex; min-height: 0; flex: 1; flex-direction: column; margin-top: 14px; }
.models-header { flex: 0 0 auto; align-items: center; margin-bottom: 12px; }
.models-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.model-filters { display: flex; flex-wrap: wrap; gap: 5px; }
.model-filters button { display: flex; height: 28px; align-items: center; gap: 4px; border: 1px solid var(--border-color); border-radius: 7px; padding: 0 8px; color: var(--text-secondary); font-size: 12px; }
.model-filters button:hover, .model-filters button.active { border-color: var(--accent-color); color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 8%, transparent); }
.model-filters button span { min-width: 16px; border-radius: 999px; background: var(--bg-tertiary); padding: 0 4px; text-align: center; font-size: 10px; line-height: 17px; }
.model-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 8px; min-height: 0; flex: 1; overflow-y: auto; padding-right: 4px; }
.model-row { display: flex; min-width: 0; align-items: center; gap: 10px; padding: 10px 11px; border: 1px solid var(--border-color); border-radius: 10px; }
.model-row:hover { background: var(--bg-tertiary); }
.model-type-icon { display: flex; height: 32px; width: 32px; align-items: center; justify-content: center; border-radius: 9px; background: #eef2ff; color: #6366f1; }
.model-type-icon.image { background: #ecfdf5; color: #10b981; }
.model-type-icon.video { background: #fff7ed; color: #f97316; }
.model-info { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.model-display-name { width: 100%; min-width: 0; border: 0; border-bottom: 1px solid transparent; outline: 0; background: transparent; padding: 0 0 2px; color: var(--text-primary); font: inherit; font-size: 13px; font-weight: 650; text-overflow: ellipsis; }
.model-display-name:hover { border-bottom-color: var(--border-color); }
.model-display-name:focus { border-bottom-color: var(--accent-color); }
.model-info span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-family: monospace; font-size: 11px; }
.model-type-label { border-radius: 999px; background: var(--bg-tertiary); padding: 3px 8px; color: var(--text-secondary); font-size: 11px; }
.models-empty { grid-column: 1 / -1; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-secondary); font-size: 12px; }
.models-empty strong { color: var(--text-primary); font-size: 14px; }

@keyframes pulse { 50% { opacity: .35; } }

@media (max-width: 760px) {
  .settings-layout { grid-template-columns: 1fr; }
  .provider-panel { min-height: auto; border-right: 0; border-bottom: 1px solid var(--border-color); }
  .provider-list { max-height: 140px; }
  .config-grid { grid-template-columns: 1fr; }
  .field.full { grid-column: auto; }
  .model-list { grid-template-columns: 1fr; }
}
</style>
