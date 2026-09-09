# 画布节点系统重构设计方案

> **调研参考**：RunningHub、LibTV、ComfyUI、n8n、React Flow 等主流 AI 工作流编辑器

---

## 行业调研总结

### RunningHub (基于 ComfyUI)
- **节点类型**：13,000+ 预置节点，支持文本、图片、视频、音频等多模态
- **连接方式**：拖拽连线构建 DAG（有向无环图）工作流
- **执行方式**：支持分支并行执行与局部重跑
- **样式特点**：
  - 节点包含预览图和完整日志
  - 固化参数元数据展示
  - 支持多方案横向对比
  - 分层整理区域

### LibTV
- **节点类型**：文本、图片、视频、音频、脚本五种核心节点
- **连接方式**：拖拽连线自由组合
- **工作流**：结构化流程，可反复修改的"搭积木"模式
- **设计理念**：还原创作全流程可视化协作

### 通用最佳实践（n8n、React Flow 等）

**节点视觉设计：**
- **卡片式布局**：圆角矩形（8-12px），轻微阴影
- **头部区域**：标题 + 图标 + 状态指示器/操作按钮
- **主体区域**：内容展示区（输入框、预览图、配置项等）
- **连接点**：左侧输入（圆形小点），右侧输出
- **颜色语义**：不同类型节点用不同主题色区分

**交互设计：**
- **默认状态**：细边框，浅色背景
- **悬停状态**：边框加粗，阴影加深
- **选中状态**：主色边框 + 光晕效果
- **执行状态**：动态边框或进度指示器

---

## 核心原则

### 1. 极简主义
- 单个节点组件不超过 200 行代码
- UI 与业务逻辑完全分离
- 节点只负责展示和基础交互

### 2. 统一规范
- 所有节点遵循相同的视觉体系
- 统一的尺寸、圆角、阴影标准
- 一致的颜色语义（主色、辅助色、状态色）

### 3. 组合优于继承
- 通过组合小组件构建复杂节点
- 使用 Composition API 提取可复用逻辑
- 避免深层嵌套的组件层级

### 4. 数据驱动
- 节点数据结构扁平化
- 状态管理集中在 Store
- 组件无状态化（Pure Component）

---

## 新架构设计

### 一、简化的节点数据结构

```typescript
// 基础节点结构（所有节点共用）
interface BaseNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  zIndex?: number
  
  // 统一的数据字段
  data: {
    label: string              // 节点标题
    description?: string       // 可选描述
    status?: 'idle' | 'loading' | 'success' | 'error'
    error?: string
    
    // 通用元数据
    createdAt: number
    updatedAt: number
    
    // 类型特定数据（通过 union types 区分）
    content?: any
  }
}
```

### 二、统一的节点样式规范

#### 尺寸系统
```css
/* 节点宽度 */
--node-width-sm: 240px   /* 文本、配置类节点 */
--node-width-md: 320px   /* 图片、视频节点 */
--node-width-lg: 480px   /* 复杂工作流节点 */

/* 内边距 */
--node-padding: 12px

/* 圆角 */
--node-radius: 12px

/* 阴影 */
--node-shadow: 0 2px 8px rgba(0, 0, 0, 0.08)
--node-shadow-hover: 0 4px 16px rgba(0, 0, 0, 0.12)
--node-shadow-selected: 0 0 0 2px var(--accent-color), 0 4px 16px rgba(59, 130, 246, 0.2)
```

#### 配色系统
```css
/* 浅色模式 */
--node-bg: #ffffff
--node-border: #e5e7eb
--node-text-primary: #111827
--node-text-secondary: #6b7280

/* 深色模式 */
.dark {
  --node-bg: #1a1a1a
  --node-border: #2a2a2a
  --node-text-primary: #f3f4f6
  --node-text-secondary: #9ca3af
}

/* 状态颜色 */
--node-status-loading: #3b82f6
--node-status-success: #10b981
--node-status-error: #ef4444
```

### 三、清晰的节点交互逻辑

#### 基础交互（所有节点统一）
1. **选择** - 单击节点边框高亮
2. **拖拽** - 按住节点主体移动
3. **连接** - 从 Handle 拖拽创建连线
4. **删除** - 选中后按 Delete 键
5. **复制** - Ctrl+D 或右键菜单

#### 节点内交互
- **编辑标题** - 双击标题进入编辑模式
- **展开/收起** - 点击头部图标（可选）
- **操作菜单** - 右上角固定按钮组

### 四、可扩展的节点类型系统

#### 节点分类

**1. 输入节点（Input Nodes）**
- `text` - 文本输入
- `image-upload` - 图片上传
- `file-import` - 文件导入

**2. 处理节点（Process Nodes）**
- `image-config` - 图像生成配置
- `video-config` - 视频生成配置
- `llm-config` - LLM 文本处理

**3. 输出节点（Output Nodes）**
- `image` - 图片展示
- `video` - 视频播放
- `text-output` - 文本输出

**4. 容器节点（Container Nodes）**
- `group` - 节点分组

---

## 组件架构

### 分层设计

```
NodeComponent (顶层)
├── NodeHeader (可复用)
│   ├── LabelEditor (可复用)
│   └── ActionButtons (可复用)
├── NodeBody (类型特定)
│   ├── TextInput / ImagePreview / VideoPlayer
│   └── ConfigPanel
└── NodeFooter (可选)
    └── StatusIndicator
```

### 核心组件

#### 1. NodeHeader.vue（通用头部）
```vue
<template>
  <div class="node-header">
    <LabelEditor 
      :value="label" 
      @update="handleUpdateLabel" 
    />
    <ActionButtons 
      :actions="actions"
      @click="handleAction" 
    />
  </div>
</template>
```

**职责：**
- 显示/编辑节点标题
- 提供常用操作按钮（复制、删除、展开）
- 统一的视觉样式

**Props：**
- `label: string`
- `actions: Array<{ icon, tooltip, action }>`

---

#### 2. NodeBody 容器（类型特定）

每种节点类型有自己的 Body 组件，但遵循统一接口：

```typescript
interface NodeBodyProps {
  data: NodeData
  onUpdate: (updates: Partial<NodeData>) => void
}
```

**示例：SimpleImageNode**
```vue
<template>
  <NodeWrapper :selected="data.selected">
    <NodeHeader 
      :label="data.label"
      :actions="[
        { icon: CopyOutline, action: 'duplicate' },
        { icon: TrashOutline, action: 'delete' }
      ]"
      @action="handleAction"
    />
    
    <div class="node-body">
      <!-- 简化：只显示图片 -->
      <img v-if="data.url" :src="data.url" />
      <UploadPlaceholder v-else @upload="handleUpload" />
    </div>
    
    <NodeHandles />
  </NodeWrapper>
</template>
```

---

#### 3. Composable Hooks（提取公共逻辑）

```typescript
// useNodeActions.ts - 节点操作
export function useNodeActions(nodeId: string) {
  const duplicate = () => duplicateNode(nodeId)
  const remove = () => removeNode(nodeId)
  const update = (data) => updateNode(nodeId, data)
  
  return { duplicate, remove, update }
}

// useNodeLabel.ts - Label 编辑
export function useNodeLabel(initialLabel: string) {
  const isEditing = ref(false)
  const label = ref(initialLabel)
  
  const startEdit = () => { isEditing.value = true }
  const finishEdit = () => { isEditing.value = false }
  
  return { isEditing, label, startEdit, finishEdit }
}

// useNodeStatus.ts - 节点状态
export function useNodeStatus() {
  const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
  const error = ref<string>('')
  
  const setLoading = () => { status.value = 'loading' }
  const setSuccess = () => { status.value = 'success' }
  const setError = (msg: string) => { 
    status.value = 'error'
    error.value = msg
  }
  
  return { status, error, setLoading, setSuccess, setError }
}
```

---

## 迁移策略

### 第一阶段：建立新架构基础（1-2天）

1. **创建基础组件**
   - `NodeWrapper.vue` - 节点包裹层（统一样式）
   - `NodeHeader.vue` - 通用头部
   - `NodeHandles.vue` - 连接点管理
   - `LabelEditor.vue` - 标题编辑器

2. **创建 Composables**
   - `useNodeActions.ts`
   - `useNodeLabel.ts`
   - `useNodeStatus.ts`

3. **定义 TypeScript 类型**
   - `types/node.ts` - 节点数据结构
   - `types/node-types.ts` - 节点类型枚举

### 第二阶段：重构简单节点（2-3天）

优先重构最简单的节点类型：

1. **TextNode** → `SimpleTextNode`
   - 移除复杂的 @ 引用功能（移到单独组件）
   - 保留基础文本输入
   - 代码量目标：< 150 行

2. **GroupNode** → `SimpleGroupNode`
   - 简化为纯容器
   - 移除复杂的嵌套逻辑

### 第三阶段：重构复杂节点（3-4天）

1. **ImageNode** → 拆分为多个小组件
   - `ImagePreview.vue` - 图片展示
   - `ImageUpload.vue` - 上传区域
   - `ImageToolbar.vue` - 工具栏
   - 主节点代码量目标：< 200 行

2. **VideoNode** - 类似 ImageNode 拆分

### 第四阶段：清理和优化（1-2天）

1. 删除旧节点代码
2. 更新 Canvas.vue 中的节点注册
3. 编写单元测试
4. 性能优化

---

## 技术选型

### 必选
- **Vue 3 Composition API** - 更好的逻辑复用
- **TypeScript** - 类型安全（可选，但强烈推荐）
- **Tailwind CSS** - 统一样式系统

### 可选优化
- **Zustand/Pinia** - 如果 Pinia store 变得复杂
- **VueUse** - 现成的 composables（useDraggable, useClipboard 等）

---

## 验收标准

### 代码质量
- [ ] 单个节点组件 ≤ 200 行
- [ ] 无重复代码（DRY 原则）
- [ ] 所有组件有清晰的 Props/Emits 定义
- [ ] Composables 有完整的类型注解

### 功能完整性
- [ ] 所有现有节点类型正常工作
- [ ] 节点拖拽、连接、删除功能正常
- [ ] 撤销/重做功能正常
- [ ] 项目保存/加载正常

### 用户体验
- [ ] 节点样式统一美观
- [ ] 交互流畅无卡顿
- [ ] 深色/浅色模式适配完美
- [ ] 响应式布局正常

### 性能指标
- [ ] 100 个节点时帧率 ≥ 50fps
- [ ] 节点渲染时间 < 10ms
- [ ] 内存占用降低 30%+

---

## 风险评估

### 高风险
1. **破坏现有功能** - 需要充分的回归测试
2. **数据迁移问题** - 旧项目数据可能不兼容

**缓解措施：**
- 保留旧节点代码作为备份
- 实现数据迁移脚本
- 灰度发布，先在小范围测试

### 中风险
1. **开发时间超出预期** - 复杂节点重构可能耗时
2. **学习曲线** - 团队成员需要适应新架构

**缓解措施：**
- 分阶段交付，每阶段可独立验收
- 编写详细的迁移文档和示例

---

## 下一步行动

1. **立即开始** - 创建基础组件和 Composables
2. **本周完成** - 重构 TextNode 和 GroupNode
3. **下周完成** - 重构 ImageNode 和 VideoNode
4. **下周末** - 全面测试和上线

---

## 附录：新旧对比

### 旧架构问题
```javascript
// ImageNode.vue - 993 行
// ❌ 所有逻辑混在一起
// ❌ 难以测试
// ❌ 无法复用
```

### 新架构优势
```javascript
// SimpleImageNode.vue - 180 行
// ✅ 清晰的职责分离
// ✅ 易于测试
// ✅ 高度可复用
```
