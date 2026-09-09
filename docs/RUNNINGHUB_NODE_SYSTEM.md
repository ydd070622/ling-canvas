# RunningHub 风格节点系统文档

## 概述

本项目已成功实现 RunningHub 风格的节点系统，完全摒弃了传统的 ComfyUI 端口式设计，采用国内主流 AI 平台（RunningHub、TapNow、LibTV）的卡片式节点架构。

## 核心设计理念

### 1. 无端口设计 (No Ports)
- **传统方式**：每个节点有固定的输入/输出端口，需要手动连线
- **RunningHub 方式**：节点是独立的卡片，通过"引用关系"连接，而非严格的数据流

### 2. 内部生成按钮 (Internal Generate Button)
- 每个节点都有独立的生成按钮
- 节点可以独立运行，不依赖串行工作流
- 生成结果直接在节点内预览显示

### 3. 引用关系 (Reference Relationships)
- 节点可以引用其他节点的输出
- 一对多关系：一个文本节点可以被多个图像/视频节点引用
- 引用类型过滤：图像节点只能引用文本或图像节点

### 4. 智能识别 (Smart Recognition)
- 自动识别哪些节点可以相互引用
- 根据节点类型显示兼容的引用源
- 动态更新可用节点列表

## 已完成的节点重构

### ✅ TextToImageNode (文生图节点)
**文件**: `src/components/nodes/TextToImageNode.vue`

**特性**:
- 使用 RHNodeCard 基础组件
- 支持引用文本节点获取提示词
- 正向/反向提示词输入
- 模型选择 (SD XL, Midjourney, DALL-E 3, FLUX)
- 尺寸配置 (1:1, 16:9, 9:16, 4:3, 3:4)
- 紫色主题 (#8b5cf6)

**引用功能**:
```vue
<ReferenceSelector
  :node-id="id"
  :references="textReferences"
  :available-nodes="availableNodes"
  :compatible-types="['text']"
  label="引用文本节点"
  @update:references="handleTextReferencesUpdate"
/>
```

### ✅ ImageToImageNode (图生图节点)
**文件**: `src/components/nodes/ImageToImageNode.vue`

**特性**:
- 源图片上传（拖放支持）
- 重绘强度控制 (0-100%)
- 模型选择 (SD XL Img2Img, ControlNet, Inpainting)
- 橙色渐变主题 (#f5576c)

### ✅ MultiImageToImageNode (多图生图节点)
**文件**: `src/components/nodes/MultiImageToImageNode.vue`

**特性**:
- 多图上传（最少 2 张）
- 图片缩略图网格展示
- 混合强度控制
- 青色主题 (#06b6d4)

### ✅ TextToVideoNode (文生视频节点)
**文件**: `src/components/nodes/TextToVideoNode.vue`

**特性**:
- 视频描述输入
- 时长选择 (3s, 5s, 10s, 15s)
- 分辨率选择 (720p, 1080p, 4K)
- 模型选择 (Runway Gen-2, Pika, Sora, Kling, MiniMax)
- FPS 控制 (12-60fps)
- HTML5 视频播放器预览
- 粉色主题 (#ec4899)

**引用功能**:
```vue
<ReferenceSelector
  :node-id="id"
  :references="textReferences"
  :available-nodes="availableNodes"
  :compatible-types="['text']"
  label="引用文本节点"
  @update:references="handleTextReferencesUpdate"
/>
```

### ✅ ImageToVideoNode (图生视频节点)
**文件**: `src/components/nodes/ImageToVideoNode.vue`

**特性**:
- 源图片上传
- 运动描述提示词
- 相机运动控制 (静止、推进、拉远、左移、右移)
- 运动强度控制
- 时长选择 (3s, 5s, 8s)
- HTML5 视频播放器
- 青色主题 (#06b6d4)

**引用功能** (双重引用):
```vue
<!-- 引用文本节点获取提示词 -->
<ReferenceSelector
  :node-id="id"
  :references="textReferences"
  :available-nodes="availableNodes"
  :compatible-types="['text']"
  label="引用文本节点（获取提示词）"
  @update:references="handleTextReferencesUpdate"
/>

<!-- 引用图片节点获取源图片 -->
<ReferenceSelector
  :node-id="id"
  :references="imageReferences"
  :available-nodes="availableNodes"
  :compatible-types="['image']"
  label="引用图片节点（获取源图片）"
  @update:references="handleImageReferencesUpdate"
/>
```

## 核心组件

### RHNodeCard (RunningHub 节点卡片)
**文件**: `src/components/nodes/rh-base/RHNodeCard.vue`

**结构**:
```
┌─────────────────────────────┐
│ Header (图标 + 标题 + 操作)   │
├─────────────────────────────┤
│ Preview Area (预览区域)       │
│ - 空状态 / 上传区             │
│ - 生成结果展示                │
├─────────────────────────────┤
│ Content Area (内容区域)       │
│ - 参数配置                    │
│ - 引用选择器                  │
├─────────────────────────────┤
│ Footer (底部信息)             │
│ - 费用提示                    │
├─────────────────────────────┤
│ Generate Button (生成按钮)    │
└─────────────────────────────┘
```

**Props**:
- `title`: 节点标题
- `icon`: 图标组件
- `iconColor`: 图标颜色
- `selected`: 选中状态
- `isGenerating`: 生成中状态
- `showGenerateButton`: 是否显示生成按钮
- `actions`: 头部操作按钮数组

**Slots**:
- `preview`: 预览区域内容
- `default`: 主要内容区域
- `footer`: 底部控制栏

### ReferenceSelector (引用选择器)
**文件**: `src/components/nodes/rh-base/ReferenceSelector.vue`

**功能**:
1. 显示已引用的节点列表
2. 添加新引用（下拉菜单）
3. 移除已有引用
4. 按类型过滤可用节点
5. 排除自身和已引用的节点

**Props**:
- `nodeId`: 当前节点 ID
- `references`: 已引用的节点数组 `[{ nodeId, nodeType, label }]`
- `availableNodes`: 画布上所有可用节点
- `compatibleTypes`: 兼容的节点类型数组
- `label`: 选择器标签

**Events**:
- `update:references`: 引用更新事件

**使用示例**:
```vue
<ReferenceSelector
  :node-id="currentNodeId"
  :references="myReferences"
  :available-nodes="allCanvasNodes"
  :compatible-types="['text', 'image']"
  label="引用来源"
  @update:references="handleReferencesUpdate"
/>
```

## 引用机制工作原理

### 1. 数据流
```
文本节点 (Text Node)
  ↓ 输出: prompt = "一只可爱的猫咪"
  
图像节点 (Image Node)
  ↓ 引用: textReferences = [{ nodeId: "text-1", ... }]
  ↓ 读取: prompt = referencedNode.data.prompt
  
生成时使用引用的提示词
```

### 2. 一对多关系
```
         ┌──────────┐
         │ 文本节点  │
         │ "森林"   │
         └────┬─────┘
              │
      ┌───────┼───────┐
      ↓       ↓       ↓
  ┌──────┐ ┌──────┐ ┌──────┐
  │ 图像  │ │ 视频  │ │ 音频  │
  │ 节点  │ │ 节点  │ │ 节点  │
  └──────┘ └──────┘ └──────┘
```

### 3. 独立性
每个节点都可以：
- 独立运行（手动输入参数）
- 引用其他节点（自动获取参数）
- 同时被多个节点引用

## 下一步工作

### 待完成的任务

1. **Canvas.vue 集成** (Task #24)
   - [ ] 管理 `availableNodes` 数据并传递给各节点
   - [ ] 渲染节点间的引用连接线
   - [ ] 处理引用关系的创建和删除
   - [ ] 在生成时传递引用节点的数据

2. **旧代码清理** (Task #21)
   - [ ] 移除旧的 ComfyUI 风格组件 (NodeWrapper, NodeHeader, NodeHandles)
   - [ ] 评估 useNodeActions 和 useNodeStatus 是否需要保留

3. **节点注册逻辑更新** (Task #22)
   - [ ] 确保所有新节点正确注册到 Canvas
   - [ ] 验证节点菜单显示正确的图标和名称

## 技术细节

### 样式规范
- **深色主题**: `#1e1e1e` 背景, `#333` 边框
- **圆角**: 8-12px
- **阴影**: `0 4px 12px rgba(0, 0, 0, 0.3)`
- **过渡动画**: `0.15s - 0.2s ease`

### 颜色主题
| 节点类型 | 主题色 | 用途 |
|---------|--------|------|
| 文生图 | `#8b5cf6` (紫色) | 文本到图像生成 |
| 图生图 | `#f5576c` (粉红) | 图像编辑 |
| 多图生图 | `#06b6d4` (青色) | 多图融合 |
| 文生视频 | `#ec4899` (玫红) | 文本到视频 |
| 图生视频 | `#06b6d4` (青色) | 图像到视频 |

### 响应式设计
- 最小宽度: 320px
- 最大宽度: 480px
- 自适应高度（根据内容）

## 与 ComfyUI 的对比

| 特性 | ComfyUI | RunningHub (本项目) |
|-----|---------|-------------------|
| 节点外观 | 带端口的方框 | 无端口卡片 |
| 连接方式 | 输入/输出端口连线 | 引用关系 |
| 执行方式 | 串行工作流 | 独立执行 |
| 生成按钮 | 全局执行 | 每个节点内部 |
| 结果显示 | 单独的输出节点 | 节点内预览 |
| 复杂度 | 高（需要理解数据流） | 低（直观易用） |

## 总结

本次重构成功将节点系统从 ComfyUI 风格转换为 RunningHub 风格，实现了：
- ✅ 无端口卡片式设计
- ✅ 内部生成按钮
- ✅ 引用选择器组件
- ✅ 一对多引用关系
- ✅ 5 个核心节点的重构

接下来需要在 Canvas.vue 中实现引用连接的可视化和管理逻辑。
