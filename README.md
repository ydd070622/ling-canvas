# Ling Canvas

Ling Canvas 是一个基于 Vue Flow 的可视化 AI 创作画布，支持文生图、视频生成等 AI 工作流的节点式编排。

![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vue.js)
![Vite](https://img.shields.io/badge/Vite-5.2-646CFF?logo=vite)
![License](https://img.shields.io/badge/License-MIT-blue)

## 📸 截图

### 首页
![首页](./docs/home.png)

### 画布
![画布](./docs/canvas.png)

### API 配置
![API 配置](./docs/api-config.png)

## ✨ 特性

- 🎨 **可视化节点编排** - 基于 Vue Flow 的无限画布，支持拖拽、缩放、连接
- 🖼️ **文生图工作流** - 支持配置提示词、模型、尺寸等参数生成图片
- 🎬 **视频生成工作流** - 支持图生视频，可设置首帧/尾帧图片
- 🤖 **AI 提示词润色** - 一键 AI 优化提示词，提升生成质量
- 🌓 **深色/浅色主题** - 支持主题切换，保护眼睛
- 💾 **本地项目存储** - 项目数据本地持久化，支持多项目管理
- ↩️ **撤销/重做** - 完整的操作历史记录

## 📦 节点类型

| 节点 | 描述 |
|------|------|
| **文本节点** | 输入、改写文本，并引用上游文本或图片 |
| **图片节点** | 上传或生成图片，直接配置模型、比例、数量和参考图 |
| **视频节点** | 上传或生成视频，直接配置模型并接收描述、首帧和尾帧 |
| **节点组** | 整理一组相关内容节点 |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- pnpm / npm / yarn

### 安装

```bash
# 克隆项目
git clone https://github.com/ydd070622/ling-canvas.git
cd ling-canvas

# 安装依赖
pnpm install
# 或
npm install

# 启动开发服务器
pnpm dev
# 或
npm run dev
```

### 构建

```bash
pnpm build
# 或
npm run build
```

## ⚙️ 配置

首次使用需要配置 API：

1. 点击右上角设置图标 ⚙️
2. 填入 API Base URL 和 API Key
3. 选择需要使用的模型

支持 OpenAI 兼容的 API 接口。

## 🛠️ 技术栈

- **框架**: [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/)
- **画布**: [Vue Flow](https://vueflow.dev/)
- **UI 组件**: [Naive UI](https://www.naiveui.com/)
- **样式**: [Tailwind CSS](https://tailwindcss.com/)
- **图标**: [@vicons/ionicons5](https://www.xicons.org/)
- **路由**: [Vue Router](https://router.vuejs.org/)

## 📁 项目结构

```
src/
├── api/          # API 请求封装
├── assets/       # 静态资源
├── components/   # 组件
│   ├── nodes/    # 节点组件
│   └── edges/    # 边组件
├── hooks/        # 组合式函数
├── router/       # 路由配置
├── stores/       # 状态管理
├── utils/        # 工具函数
└── views/        # 页面视图
```

## 🔄 自动执行工作流

开启「自动执行」模式后，系统会通过 AI 分析用户意图，自动编排并执行工作流。

### 工作流类型

| 类型 | 触发条件 | 说明 |
|------|---------|------|
| `text_to_image` | 默认 | 文生图工作流 |
| `text_to_image_to_video` | 包含"视频"、"动画"等关键词 | 文生图生视频工作流 |
| `storyboard` | 包含"分镜"、"场景"、"镜头"等关键词 | 分镜工作流 |

### 工作流 1: 文生图 / 文生图生视频

![工作流架构](./doc/workflow.png)

### 工作流 2: 分镜工作流 (Storyboard)

![分镜工作流](./doc/workflow2.png)

**示例输入:** `蜡笔小新去上学。分镜一：清晨的战争；分镜二：出发的风姿`

**AI 解析:**
- 提取角色: 蜡笔小新 (外观描述)
- 拆分分镜: 清晨的战争、出发的风姿

**执行流程:**
1. 生成角色参考图
2. 依次生成各分镜图片 (连接角色参考图保持一致性)

### 执行流程

1. **AI 意图分析** - 分析用户输入，判断工作流类型，生成优化后的提示词
2. **创建节点** - 按顺序创建文本、图片和视频内容节点
3. **依赖执行** - 根据连线等待必要的上游结果，再执行下游节点
4. **输出结果** - 结果保存在对应的图片或视频节点中

### 核心组件

- `useWorkflowOrchestrator` - 工作流编排器 Hook
- `waitForConfigComplete` - 等待配置节点完成
- `waitForOutputReady` - 等待输出节点就绪

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 联系我

扫码添加微信交流：

<img src="./doc/wx-group.jpg" width="200" alt="微信二维码" />

## 📄 License

[MIT](./LICENSE)
