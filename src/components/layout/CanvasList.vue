<script setup>
/**
 * CanvasList | 画布卡片网格列表组件
 * Responsive grid layout for canvas cards
 */
import CanvasCard from '../CanvasCard.vue'

const props = defineProps({
  projects: { type: Array, required: true },
  selectable: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})

const emit = defineEmits(['delete', 'rename', 'open', 'toggleSelect', 'toggleSelectAll'])

const handleDelete = (id) => {
  emit('delete', id)
}

const handleRename = (id) => {
  emit('rename', id)
}

const handleToggleSelect = (id) => {
  emit('toggleSelect', id)
}

// Computed: are all items selected? | 计算：是否全选？
const allSelected = () => {
  if (!props.projects.length) return false
  return props.projects.every(p => props.selectedIds.includes(p.id))
}
</script>

<template>
  <div>
    <!-- Selection bar (manage mode) | 选择栏（管理模式） -->
    <div
      v-if="selectable && projects.length > 0"
      class="mb-4 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <!-- Select all checkbox | 全选复选框 -->
      <button
        class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        @click="emit('toggleSelectAll')"
      >
        <div
          class="flex h-5 w-5 items-center justify-center rounded border-2 transition-all"
          :class="allSelected()
            ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400'
            : 'border-gray-300 bg-white dark:border-gray-500 dark:bg-gray-700'"
        >
          <svg
            v-if="allSelected()"
            class="h-3 w-3 text-white dark:text-gray-900"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        全选
      </button>

      <span class="text-sm text-gray-400 dark:text-gray-500">|</span>

      <span class="text-sm text-gray-500 dark:text-gray-400">
        已选择 <span class="font-semibold text-blue-500 dark:text-blue-400">{{ selectedIds.length }}</span> 项
      </span>

      <!-- Right-side actions slot | 右侧操作按钮插槽 -->
      <div class="ml-auto flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- Card grid | 卡片网格 -->
    <div
      v-if="projects.length > 0"
      class="grid grid-cols-2 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
    >
      <CanvasCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :selectable="selectable"
        :selected="selectedIds.includes(project.id)"
        @delete="handleDelete"
        @rename="handleRename"
        @toggle-select="handleToggleSelect"
      />
    </div>

    <!-- Empty state | 空状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <svg
        class="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
        />
      </svg>
      <p class="text-base font-medium text-gray-400 dark:text-gray-500">
        暂无画布
      </p>
      <p class="mt-1 text-sm text-gray-300 dark:text-gray-600">
        创建你的第一个画布开始创作
      </p>
    </div>
  </div>
</template>