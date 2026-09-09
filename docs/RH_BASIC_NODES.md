# RunningHub 风格基础节点系统

## 概述

本文档描述了基于 RunningHub/TapNow 风格的4个基础节点类型及其连接机制。

## 设计理念

与 ComfyUI 风格的固定端口不同，RunningHub 风格的节点是独立的，通过**引用选择器**建立联系：

- **文本节点** → 存储提示词文本
- **图片节点** → 引用文本节点获取提示词，或手动上传/生成图片
- **视频节点** → 引用文本节点或图片节点生成视频
- **音频节点** → 引用文本节点进行文本转语音（TTS）

## 4个基础节点类型

### 1. RHTextNode (文本节点)

**功能**：纯文本存储和编辑

**特性**：
- 简单的文本输入框
- 支持多行文本
- 可被其他节点引用作为提示词来源

**使用场景**：
- 存储生图提示词
- 存储视频描述
- 存储TTS文本

### 2. RHImageNode (图片节点)

**功能**：图片上传、生成和显示

**特性**：
- 支持手动上传图片
- 支持拖放上传
- 可引用文本节点获取提示词
- 也可手动输入提示词
- 配置模型和尺寸参数
- 点击"生成图片"按钮开始生成

**引用机制**：
```javascript
{
  referencedTextNodeId: "text-node-id", // 引用哪个文本节点
  prompt: "manual prompt fallback",      // 无引用时的手动提示词
  model: "doubao-seedream",              // 生成模型
  size: "1024x1024"                      // 图片尺寸
}
```

### 3. RHVideoNode (视频节点)

**功能**：视频上传、生成和显示

**特性**：
- 支持手动上传视频
- 支持两种生成模式：
  - **文生视频**：引用文本节点获取运动描述
  - **图生视频**：引用图片节点作为首帧
- 配置时长、模型等参数
- 点击"生成视频"按钮开始生成

**引用机制**：
```javascript
{
  generationMode: "text-to-video",       // 或 "image-to-video"
  referencedTextNodeId: "text-node-id",  // 文生视频时引用
  referencedImageNodeId: "image-node-id",// 图生视频时引用
  prompt: "additional motion description",
  duration: "5",                         // 秒
  model: "runway-gen2"
}
```

### 4. RHAudioNode (音频节点)

**功能**：音频上传、生成（TTS）和显示

**特性**：
- 支持手动上传音频文件
- 可引用文本节点获取TTS文本
- 也可手动输入文本
- 配置声音类型和音频格式
- 点击"生成音频"按钮开始生成

**引用机制**：
```javascript
{
  referencedTextNodeId: "text-node-id",  // 引用哪个文本节点
  textContent: "fallback text",          // 无引用时的手动文本
  voice: "female-zh",                    // 声音类型
  format: "mp3"                          // 音频格式
}
```

## 工作流程示例

### 文生图工作流

1. 创建 **文本节点**，输入提示词："一个魔法森林，有发光的蘑菇"
2. 创建 **图片节点**
3. 在图片节点的"提示词来源"下拉框中选择刚才的文本节点
4. 选择模型和尺寸
5. 点击"生成图片"

### 图生视频工作流

1. 创建 **图片节点**，上传或生成一张图片
2. 创建 **文本节点**，输入运动描述："镜头缓慢推进，树叶随风摆动"
3. 创建 **视频节点**
4. 选择"图生视频"模式
5. 在"参考图片"中选择图片节点
6. 在"提示词来源"中选择文本节点
7. 设置时长和模型
8. 点击"生成视频"

### TTS工作流

1. 创建 **文本节点**，输入要朗读的文本
2. 创建 **音频节点**
3. 在"文本来源"中选择文本节点
4. 选择声音类型和格式
5. 点击"生成音频"

## 技术实现

### 节点注册

在 `Canvas.vue` 中注册：

```javascript
import { RHTextNode, RHImageNode, RHVideoNode, RHAudioNode } from '../components/nodes/rh-base/index.js'

const nodeTypes = {
  rhText: markRaw(RHTextNode),
  rhImage: markRaw(RHImageNode),
  rhVideo: markRaw(RHVideoNode),
  rhAudio: markRaw(RHAudioNode)
}
```

### 数据存储

每个节点的数据存储在 Vue Flow 的 `nodes` store 中：

```javascript
{
  id: "node-id",
  type: "rhImage",
  position: { x: 100, y: 200 },
  data: {
    label: "图片",
    url: "...",
    loading: false,
    referencedTextNodeId: "text-node-id",
    // ... 其他参数
  }
}
```

### 引用解析

当节点需要生成内容时，从引用的节点获取数据：

```javascript
// 在 RHImageNode 中
if (referencedTextNodeId.value) {
  const textNode = nodes.value.find(n => n.id === referencedTextNodeId.value)
  if (textNode?.data?.content) {
    promptText = textNode.data.content
  }
}
```

## 与旧节点系统的对比

| 特性 | 旧系统 (ComfyUI风格) | 新系统 (RunningHub风格) |
|------|---------------------|------------------------|
| 节点类型 | 15+ 种专门节点 | 4 种基础节点 |
| 连接方式 | 固定端口连线 | 引用选择器 |
| 数据流 | 隐式通过边传递 | 显式引用其他节点ID |
| 灵活性 | 低（需要特定类型的边） | 高（任何节点可引用任何兼容节点） |
| 学习成本 | 高（需理解端口类型） | 低（直观的下拉选择） |

## 下一步计划

1. ✅ 创建4个基础节点组件
2. ⏳ 实现可视化连线系统（Vue Flow edges）
3. ⏳ 添加节点侧边的"+"按钮用于快速创建连接
4. ⏳ 实现连接线的视觉反馈
5. ⏳ 支持一键创建工作流模板

## 文件结构

```
src/components/nodes/rh-base/
├── index.js              # 导出所有RH节点
├── RHNodeCard.vue        # 基础卡片组件
├── ReferenceSelector.vue # 引用选择器组件
├── RHTextNode.vue        # 文本节点
├── RHImageNode.vue       # 图片节点
├── RHVideoNode.vue       # 视频节点
└── RHAudioNode.vue       # 音频节点
```

## 注意事项

- RH节点是独立的，不依赖 Vue Flow 的边系统来传递数据
- 引用关系通过存储节点ID实现，而非物理连线
- 未来可以添加可视化连线作为引用的视觉表示
- 保持节点简洁，避免过度复杂化
