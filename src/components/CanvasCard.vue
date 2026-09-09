<script setup>
/**
 * CanvasCard | 画布卡片组件
 * Displays a single project as a card with thumbnail, info, and hover actions
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NTooltip, NPopconfirm } from 'naive-ui'
import { deleteProject } from '../stores/projects.js'

const props = defineProps({
  project: { type: Object, required: true },
  selectable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false }
})

const emit = defineEmits(['delete', 'toggleSelect'])
const router = useRouter()

// Hover state | 悬停状态
const isHovered = ref(false)

// Format date | 格式化日期
const formattedDate = computed(() => {
  const d = new Date(props.project.createdAt)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
})

// Navigate to canvas | 跳转到画布
const openCanvas = () => {
  if (props.selectable) {
    emit('toggleSelect', props.project.id)
    return
  }
  router.push(`/canvas/${props.project.id}`)
}

// Handle delete | 处理删除
const handleDelete = () => {
  deleteProject(props.project.id)
  emit('delete', props.project.id)
}

</script>

<template>
  <div
    class="canvas-card group cursor-pointer rounded-xl bg-white dark:bg-[#161616] shadow-sm ring-1 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg"
    :class="[
      selected
        ? 'ring-blue-500 shadow-blue-100 dark:shadow-blue-900/30 dark:ring-blue-400'
        : 'ring-gray-100 hover:ring-gray-200 dark:ring-gray-700/50 dark:hover:ring-gray-600'
    ]"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @click="openCanvas"
  >
    <!-- Thumbnail area | 缩略图区域 -->
    <div class="thumbnail-area relative h-[160px] overflow-hidden rounded-t-xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800">
      <!-- Thumbnail image or placeholder | 缩略图图片或占位符 -->
      <div v-if="project.thumbnail" class="h-full w-full">
        <img
          :src="project.thumbnail"
          :alt="project.name"
          class="h-full w-full object-cover"
        />
      </div>
      <div
        v-else
        class="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900"
      >
        <svg
          class="h-12 w-12 text-gray-300 dark:text-gray-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      </div>

      <!-- Checkbox (manage mode) | 复选框（管理模式） -->
      <div
        v-if="selectable"
        class="absolute left-2 top-2 z-20"
        @click.stop="emit('toggleSelect', project.id)"
      >
        <div
          class="flex h-5 w-5 items-center justify-center rounded border-2 transition-all"
          :class="selected
            ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400'
            : 'border-gray-300 bg-white/90 backdrop-blur-sm dark:border-gray-500 dark:bg-gray-700/90'"
        >
          <svg
            v-if="selected"
            class="h-3 w-3 text-white dark:text-gray-900"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <!-- Action buttons (top-right, on hover) | 操作按钮组（右上角，悬停显示） -->
      <transition name="fade">
        <div
          v-show="isHovered && !selectable"
          class="absolute right-2 top-2 flex gap-1.5"
          @click.stop
        >
          <!-- Delete button with confirm | 删除按钮（带确认） -->
          <n-tooltip trigger="hover" :show-arrow="false" placement="bottom">
            <template #trigger>
              <n-popconfirm
                @positive-click="handleDelete"
                :positive-text="'删除'"
                :negative-text="'取消'"
              >
                <template #trigger>
                  <button
                    class="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-red-500 hover:shadow-md dark:bg-gray-700/90 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-red-400"
                  >
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </template>
                确定要删除这个画布吗？
              </n-popconfirm>
            </template>
            删除
          </n-tooltip>
        </div>
      </transition>
    </div>

    <!-- Info area | 底部信息区 -->
    <div class="rounded-b-xl px-3 py-2.5">
      <h3 class="truncate text-sm font-bold leading-snug text-gray-800 dark:text-gray-200">
        {{ project.name }}
      </h3>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

button.action-btn:active {
  transform: scale(0.9);
}
</style>