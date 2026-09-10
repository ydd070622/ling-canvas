# 生成链路说明 | Generation pipeline

画布的文生图 / 图生图 / 图生视频统一走一条链路：

```
节点 → hooks/useApi.js（按本次请求解析渠道）
     → api/{image,video,chat}.js（按能力选协议）
     → services/aiGateway.js（解析端点、组装请求、归一化错误）
     → Tauri http_request / fetch_binary（Rust reqwest，绕开 WebView CORS）
     → 厂商（OpenAI 兼容）
```

关键点：**每个请求自带 provider**（取自所选模型的 `sourceProvider`），不依赖全局
`currentProvider`，因此同一画布上不同节点可以分属不同供应商。

## 能力与端点

能力注册表在 `src/config/providerCapabilities.js`：

| 能力 | 默认端点 | 协议 |
|---|---|---|
| `chat` | `/v1/chat/completions` | json |
| `image` | `/v1/images/generations` | json |
| `image-edit` | `/v1/images/edits` | multipart（参考图作为文件上传） |
| `video` | `/v1/videos` | json |
| `video-query` | `/v1/videos/{taskId}` | GET |

渠道配置里的 `endpoints` 覆盖默认值，`{taskId}` 为任务查询占位符：

```js
{
  defaultBaseUrl: 'https://your-relay.example.com',
  endpoints: {
    chat: '/v1/chat/completions',
    image: '/v1/images/generations',
    imageEdit: '/v1/images/edits',
    video: '/v1/video/generations',
    videoQuery: '/v1/video/task/{taskId}'
  }
}
```

## 厂商特例

在渠道配置里加 `protocols` 即可覆盖某个能力的上行协议，无需改代码：

```js
protocols: {
  // 图生图只能走对话协议（把参考图塞进多模态 messages）的厂商
  'image-edit': 'chat',
  // 视频查询是 POST 的厂商
  'video-query': { method: 'POST' }
}
```

- 少数厂商只认 `image[]` 字段名：加 `imageEditImageField: 'image[]'`
- 字段改名类厂商：沿用既有 `requestAdapter.image / video`

## 自检

```bash
npm run verify:gateway
```

脚本会起一个本地 OpenAI 兼容 mock 上游，真跑一遍三条链路（含 multipart、外链
参考图、任务轮询、错误归一化）以及 Tauri invoke 载荷契约。不需要真实 API Key。

## 已知边界

- 视频状态词表是通用映射（`SUCCESS` / `PROCESSING` / `FAILURE` 等）。若某厂商用
  非常规状态串，兜底规则是「没拿到视频地址就继续等」，不会提前结束，但进度可能不准。
- 首帧/参考图若为 base64 data URL，直接透传给厂商；若该厂商只接受 http 地址，
  需要先接入对象存储上传，目前未实现。
