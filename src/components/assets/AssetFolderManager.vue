<script setup>
import { NModal, NButton } from 'naive-ui'
import { allAssetCategories, hiddenAssetCategories, setAssetCategoryHidden } from '../../stores/assets'
defineProps({ show: Boolean })
const emit = defineEmits(['update:show'])
</script>
<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="card" title="管理素材目录" style="width: min(540px, 92vw)">
    <p class="folder-hint">隐藏后，该目录及其素材不再出现在浏览列表中。磁盘文件和画布里的素材引用会保留，可随时恢复显示。</p>
    <div class="folder-list">
      <div v-for="item in allAssetCategories" :key="item.name" class="folder-row">
        <div><strong>{{ item.name }}</strong><small>{{ item.count }} 张图片 · {{ hiddenAssetCategories.includes(item.name) ? '已隐藏' : '显示中' }}</small></div>
        <NButton size="small" @click="setAssetCategoryHidden(item.name, !hiddenAssetCategories.includes(item.name))">{{ hiddenAssetCategories.includes(item.name) ? '恢复显示' : '隐藏目录' }}</NButton>
      </div>
      <p v-if="!allAssetCategories.length">当前没有素材目录</p>
    </div>
  </NModal>
</template>
<style scoped>
.folder-hint { color:var(--text-secondary); font-size:12px; line-height:1.7; margin-bottom:14px; }
.folder-list { max-height:55vh; overflow:auto; }
.folder-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--border-color); }
.folder-row>div { display:flex; flex-direction:column; gap:5px; min-width:0; }
.folder-row strong { font-size:13px; overflow-wrap:anywhere; }
.folder-row small { color:var(--text-secondary); font-size:11px; }
.folder-row button { flex-shrink:0; }
</style>
