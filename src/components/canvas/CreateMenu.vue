<template>
  <!-- 创建菜单 | Create menu
       双击空白、点端口、从端口拖到空白 —— 三种入口共用同一个菜单，
       只是标题与能不能选"分支方向"不同。

       竖向列表 + 分区（添加节点 / 添加资源）：一行一个，名字排得开、扫得快，
       不用在两列卡片里左右找。 -->
  <div
    v-if="visible"
    class="create-menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mousedown.stop
    @click.stop
  >
    <div class="menu-title">添加节点</div>

    <button
      v-for="option in options"
      :key="option.type"
      class="menu-row"
      type="button"
      @click="emit('select', option)"
    >
      <span class="menu-icon" v-html="NODE_ICONS[option.type]"></span>
      <span class="menu-label">{{ option.name }}</span>
    </button>

    <template v-if="showResources">
      <div class="menu-line"></div>
      <div class="menu-title">添加资源</div>
      <button class="menu-row" type="button" @click="emit('upload')">
        <span class="menu-icon" v-html="ACTION_ICONS.upload"></span>
        <span class="menu-label">上传本地文件</span>
      </button>
      <button class="menu-row" type="button" @click="emit('assets')">
        <span class="menu-icon" v-html="ACTION_ICONS.assets"></span>
        <span class="menu-label">从素材库选择</span>
      </button>
    </template>
  </div>
</template>

<script setup>
import { NODE_ICONS, ACTION_ICONS } from '../../config/nodeIcons'

defineProps({
  visible: { type: Boolean, default: false },
  /** 画布内的屏幕坐标（左上角） */
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  /** [{ type, name }]，顺序就是列表顺序 */
  options: { type: Array, default: () => [] },
  /** 双击空白时额外给出资源入口 */
  showResources: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'upload', 'assets'])


</script>

<style scoped>
.create-menu {
  position: absolute;
  z-index: 150;
  width: 216px;
  padding: 7px;
  border: 1px solid var(--border-color, #dde0e4);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 98%, transparent);
  box-shadow: 0 18px 50px rgba(18, 22, 28, 0.17);
  backdrop-filter: blur(18px);
}

.menu-title {
  padding: 5px 9px 6px;
  color: var(--text-tertiary, #9a9fa7);
  font-size: 11px;
}


.menu-row {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  gap: 10px;
  padding: 0 9px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-primary, #2a2d32);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  transition: background-color 0.12s ease;
}
.menu-row:hover { background: var(--bg-tertiary, #f2f3f5); }

.menu-icon {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--text-tertiary, #9aa0a8);
}
.menu-icon svg { width: 18px; height: 18px; }
/* 图标一律单色：菜单是"选一个"，颜色反而让人以为它们在表示状态。
   类型色交给画布上的卡片（表头小圆点、端口）去表达。 */

.menu-label { min-width: 0; flex: 1 1 auto; }
.menu-line { height: 1px; margin: 6px 4px; background: var(--border-color, #eceef0); }
</style>
