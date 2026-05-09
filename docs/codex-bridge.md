# Codex Bridge

这个桥接层的目标是让 Codex、n8n、shell 脚本或其它本地工作流，稳定复用老鬼AI网页里的生图能力。

服务端仍然只有一套核心能力：`server.mjs` 里的 `/api/v1`。CLI 只是薄封装，负责把“本地文件、prompt、brief、参考图”整理成服务端已经支持的 JSON。

## 启动服务

```bash
npm start
```

默认服务地址是：

```text
http://127.0.0.1:4177/api/v1
```

如果 Codex 工作流不在同一台机器上运行，需要在 `.env` 里配置：

```bash
LAOGUI_API_TOKEN=replace-with-a-private-token
API_CORS_ORIGIN=https://your-tunnel-domain.example
LAOGUI_API_BASE_URL=https://your-tunnel-domain.example/api/v1
LAOGUI_CLIENT_ID=codex
```

## 快捷命令

```bash
npm run api -- health
npm run api -- settings
npm run api -- logs --limit 20
```

生成单张概念图：

```bash
npm run api -- image \
  --prompt "high-end boutique homestay lounge, warm stone, dark walnut, soft indirect light" \
  --size 1024x1536 \
  --quality low \
  --task-id homestay-lounge-001 \
  --image-out /tmp/homestay-lounge.png
```

基于图片生成效果图：

```bash
npm run api -- render \
  --mode plan-render \
  --primary /absolute/path/to/floor-plan.png \
  --ref /absolute/path/to/style-reference.jpg \
  --prompt "convert the public lounge zone into an eye-level interior render" \
  --image-out /tmp/lounge-render.png
```

设计系列可以一条命令跑完整批次，也可以拆成分析和逐张生成。

一条命令生成完整系列：

```bash
npm run api -- series \
  --brief /absolute/path/to/brief.json \
  --ref /absolute/path/to/ref-a.jpg \
  --ref /absolute/path/to/ref-b.jpg \
  --prompt "create a coherent six-image boutique homestay design series" \
  --count 6 \
  --size 1024x1536 \
  --quality low \
  --task-id minsu-board11 \
  --out-dir /tmp/minsu-board11-series
```

这会自动生成：

```text
/tmp/minsu-board11-series/analysis.json
/tmp/minsu-board11-series/manifest.json
/tmp/minsu-board11-series/minsu-board11-01.png
/tmp/minsu-board11-series/minsu-board11-02.png
...
```

拆成分析和逐张生成：

```bash
npm run api -- series-analyze \
  --brief /absolute/path/to/brief.json \
  --ref /absolute/path/to/ref-a.jpg \
  --ref /absolute/path/to/ref-b.jpg \
  --output /tmp/series-analysis.json

npm run api -- series-generate \
  --brief /absolute/path/to/brief.json \
  --analysis /tmp/series-analysis.json \
  --ref /absolute/path/to/ref-a.jpg \
  --ref /absolute/path/to/ref-b.jpg \
  --index 1 \
  --count 6 \
  --image-out /tmp/series-01.png
```

继续从第 3 张开始补跑：

```bash
npm run api -- series \
  --brief /absolute/path/to/brief.json \
  --analysis /tmp/minsu-board11-series/analysis.json \
  --ref /absolute/path/to/ref-a.jpg \
  --ref /absolute/path/to/ref-b.jpg \
  --count 6 \
  --start-index 3 \
  --out-dir /tmp/minsu-board11-series \
  --task-id minsu-board11
```

`--analysis` 只复用设计策略，仍然要传 `--ref`，因为服务端生成每张系列图时需要参考图参与生图。

## Codex 工作流建议

在工作流里把每一次生成都设置一个稳定的 `--task-id`。如果请求中断或 Codex 重新运行同一个步骤，服务端会用已有结果恢复，避免重复消耗生图额度。

推荐命名方式：

```text
<workflow-name>-<scene-name>-<index>
```

批量 `series` 命令会自动把 `--task-id minsu-board11` 展开成：

```text
minsu-board11-01
minsu-board11-02
minsu-board11-03
...
```

例如：

```bash
npm run api -- image \
  --task-id minsu-board11-lobby-01 \
  --prompt-file /tmp/final-prompt.txt \
  --image-out /tmp/minsu-board11-lobby-01.png \
  --field codexBridge.savedImage
```

`--field` 可以只输出某个字段，方便上游脚本接收路径：

```bash
npm run api -- image --prompt "..." --field image.file
```

## JSON 请求体

CLI 支持从完整 JSON 文件开始，再用命令行参数覆盖局部字段：

```bash
npm run api -- image --body request.json --quality medium
```

也可以从 stdin 读：

```bash
cat request.json | npm run api -- image --body -
```

最小 `image` 请求：

```json
{
  "brief": {
    "projectName": "精品民宿公共休息区",
    "spaceType": "民宿大堂",
    "style": "高端、克制、暖色石材与金属"
  },
  "imagePrompt": "eye-level interior render, quiet boutique homestay lobby, warm stone, brass details",
  "size": "1024x1536",
  "quality": "low",
  "clientTaskId": "homestay-lobby-001"
}
```

最小 `render` 请求可以直接用图片参数，不必手写 base64：

```bash
npm run api -- render \
  --mode photo \
  --primary /path/to/site-photo.jpg \
  --prompt "replace finishes and lighting, preserve camera and structure"
```

## 端点管理

本机 owner 会话可以用 CLI 添加或切换 Image Gen API 端点：

```bash
npm run api -- endpoint-add \
  --label mxou \
  --base-url https://ai.mxou.cn \
  --api-key sk-your-api-key \
  --responses-path /v1/responses

npm run api -- probe
npm run api -- endpoint-activate --id <endpoint-id>
```

远程工作流只建议调用生成、日志和状态接口；新增、删除、切换端点仍应在运行服务的主机上操作。
