# Ling Canvas Docker 部署指南

## 本地构建

```bash
pnpm install
pnpm build
docker build -t ling-canvas .
docker run -d -p 8080:80 --name ling-canvas ling-canvas
```

访问：<http://localhost:8080/>

## 常用命令

```bash
docker stop ling-canvas
docker start ling-canvas
docker logs ling-canvas
```

应用本身不内置任何 API 服务。请在应用的模型配置页填写你自己的 OpenAI 兼容接口地址与密钥。
