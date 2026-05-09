# 老鬼AI

老鬼AI 是一个面向建筑、室内、民宿和商业空间设计师的本地 AI 创意工作台。它把方案分析、空间推演、参考图理解、提示词生成、设计系列出图和项目画布放在同一个界面里，适合做概念方案、视觉方向、客户提案和批量设计探索。

## 下载安装

请到 [GitHub Releases](https://github.com/wuf77278/laogui-ai/releases/latest) 下载最新版安装包：

- macOS Apple Silicon：下载 `LaoguiAI-v0.1.0-mac-arm64.dmg`
- macOS Intel：下载 `LaoguiAI-v0.1.0-mac-intel.dmg`
- Windows 10 / 11：下载 `LaoguiAI-v0.1.0-windows-setup.exe`

首次打开后，在右上角“设置”里填入你自己的文本/思考 API 和生图 API。软件会把 API Key 保存在本机运行环境里，不会暴露给浏览器页面。

## 网页使用

老鬼AI 可以作为网页使用，但它不是纯静态网页项目。前端页面需要配套 `server.mjs` 这个 Node 服务，由服务端统一代理模型请求、保存画布状态和管理本地生成结果。

本机网页方式：

```bash
cp .env.example .env
# 编辑 .env，填写 REASONING_API_KEY 和 YYBB_API_KEY
npm install
npm start
```

然后打开 `http://localhost:4177`。

如果要给团队或客户在线访问，可以部署到支持 Node.js 的平台，例如 Render、Railway、Fly.io、VPS 或内网服务器；GitHub Pages 只能托管静态页面，不适合直接运行这一版完整功能。

## 主要功能

- 空间设计方案生成：根据项目类型、风格、功能和约束生成方向建议。
- 图片参考理解：上传参考图后分析材质、灯光、空间关系和可复用设计语言。
- 设计系列出图：围绕同一个项目批量生成统一风格的设计画面。
- 无限画布工作区：沉淀项目素材、生成结果、提示词和阶段性方案。
- 本地桌面应用：通过 Electron 在 macOS / Windows 上运行，减少部署门槛。
- 服务端代理 API：浏览器端不直接接触密钥，适合本机或小团队内网使用。

## Desktop App

The project can run as a local desktop app on macOS and Windows. Electron starts
the same Node service locally, then opens the app at `http://127.0.0.1:4177`.

```bash
npm install
npm run desktop
```

Build installers:

```bash
npm run pack:mac
npm run pack:win
```

In the desktop app, generated images, canvas history, task logs and runtime API
settings are stored under the OS user data directory instead of the project
folder. API keys saved from Settings are written to that local runtime settings
file only.

When opening the app from another device, use the host machine address instead
of `localhost`, for example `http://<host-lan-ip>:4177` or the mapped tunnel
URL. The app keeps API keys on the host service, and remote browsers only call
the local `/api/*` proxy.

Remote-device stability notes:

- Uploads and saved canvas state are compressed client-side before API calls so
  large base64 images do not overload mapped/tunneled connections.
- If a remote browser disconnects mid-upload, the server records it as HTTP
  `499 Client disconnected` with the request body size in logs.
- API endpoint settings can only be changed from the host machine's
  `localhost` session; remote devices can generate tasks but cannot edit keys.
- For LAN sharing or tunnel sharing, configure `LAOGUI_API_TOKEN` and
  `API_CORS_ORIGIN` in `.env` before exposing the service.

## Daily Safety

Initialize version control before making frequent changes:

```bash
git status
npm run check
npm run doctor
```

The repository ignores `.env`, `logs/`, `public/generated/`, screenshots and
other local artifacts. Generated images and logs are runtime data, not source.

Owner-only storage maintenance is available from the web Settings panel, or by
calling `/api/storage/maintenance` from `localhost`. It can archive old generated
files to `archive/generated`, clean test outputs, and prune task logs.

## Check

```bash
npm run check
```

## API Roles

- `gpt-5.5`: creates spatial design directions, material logic, client proposal structure, and image prompts.
- `Images API`: generates final visuals through the OpenAI-compatible `/images/generations` endpoint, or `/images/edits` when a primary/reference image is present. The Responses `image_generation` tool remains as fallback.

The app uses separate providers:

- `REASONING_BASE_URL` / `REASONING_API_KEY`: text and vision reasoning.
- `YYBB_BASE_URL` / `YYBB_API_KEY`: image-generation compatible calls for final visuals.
- `IMAGE_API_MODE=images`: 默认优先使用 playground 风格的 OpenAI-compatible Images API；可设为 `responses` 只走 Responses `image_generation`，或 `auto` 保持 Images API 优先并保留回退。
- `IMAGE_GENERATIONS_PATH=/v1/images/generations` / `IMAGE_EDITS_PATH=/v1/images/edits`: Images API 的文本生图与图像编辑路径。
- `IMAGE_PROVIDER_MANIFEST='{"submit":{"path":"/v1/images/generations","result":{"b64JsonPaths":["data.*.b64_json"],"imageUrlPaths":["data.*.url"]}}}'`: 可选，自定义 OpenAI-compatible 或异步 HTTP 生图服务的提交、轮询和结果字段映射。
- `IMAGE_RESPONSES_PATH=/responses`: yybb 的 Responses 路径；其他 OpenAI-compatible 服务通常是 `/v1/responses`，用于回退通道和探测。
- `IMAGE_GEN_SKILL_MAX_ATTEMPTS=2`: Responses `image_generation` 回退通道的重试次数。
- `IMAGE_COST_FIRST_MAX_ATTEMPTS=2`: 成本优先端点失败时连续尝试次数，降低异常端点拖慢整批任务的风险。
- `IMAGE_ENDPOINT_PRECHECK_TTL_SECONDS=300`: 生图前端点测速缓存时间，避免每张图都重复检测所有端点。
- `IMAGE_ALLOW_LEGACY_FALLBACK=0`: 保留旧兼容开关；新默认通道已是 OpenAI-compatible Images API。
- `IMAGE_GENERATION_CONCURRENCY=2`: 同时生图任务数；其余任务排队，避免 API 被打爆。
- `IMAGE_GENERATION_QUEUE_MAX_PENDING=12`: 最多等待中的生图任务数，超过会返回 429。
- `IMAGE_GENERATION_QUEUE_TIMEOUT_SECONDS=600`: 生图排队最长等待时间。
- `MAX_JSON_BODY_MB=80`: 单次 JSON 请求体上限，避免超大 base64 上传把本地服务拖慢。

The browser never receives the API key. All model calls are proxied through `server.mjs`.

## HTTP API

The app exposes stable external endpoints under `/api/v1`. The older `/api/*` routes remain for the web UI.

- API index: `GET http://localhost:4177/api`
- OpenAPI spec: `GET http://localhost:4177/api/openapi.json`
- Health: `GET http://localhost:4177/api/v1/health`
- Plan: `POST http://localhost:4177/api/v1/plan`
- Single image: `POST http://localhost:4177/api/v1/images/generate`
- Image-to-render: `POST http://localhost:4177/api/v1/images/render-from-images`
- Design series analysis: `POST http://localhost:4177/api/v1/design-series/analyze`
- Design series generation: `POST http://localhost:4177/api/v1/design-series/generate`
- Task logs: `GET http://localhost:4177/api/v1/task-logs?limit=20`
- Canvas state: `GET/POST http://localhost:4177/api/v1/canvas-state`
- Runtime settings: `GET http://localhost:4177/api/v1/settings`
- Add Image Gen endpoint: `POST http://localhost:4177/api/v1/settings/image-endpoints`

Custom Image Gen endpoints added from the web settings panel are saved locally in `logs/runtime-settings.json`. They can define direct `/images/generations` and `/images/edits` paths plus an optional Provider Manifest; Responses `image_generation` remains available as fallback.

External access protection is required when sharing beyond localhost:

```bash
LAOGUI_API_TOKEN=replace-with-a-private-token
API_CORS_ORIGIN=https://your-tunnel-domain.example
```

Call the public `/api/v1/*` API with either header:

```bash
curl http://localhost:4177/api/v1/health \
  -H "Authorization: Bearer replace-with-a-private-token"
```

## Codex / CLI Bridge

For Codex workflows, use the thin local CLI wrapper instead of hand-writing
`curl` payloads. It calls the same `/api/v1` endpoints, converts local images to
data URLs, and can copy the generated image to a workflow path.

```bash
npm run api -- health
npm run api -- image \
  --prompt "quiet boutique hotel lobby, warm stone, brass details" \
  --size 1024x1536 \
  --quality low \
  --image-out /tmp/laogui-lobby.png
npm run api -- render \
  --mode plan-render \
  --primary /path/to/plan.png \
  --prompt "turn the selected public lounge zone into an eye-level render"
npm run api -- series \
  --brief /path/to/brief.json \
  --ref /path/to/ref-a.jpg \
  --ref /path/to/ref-b.jpg \
  --count 6 \
  --task-id minsu-board11 \
  --out-dir /tmp/minsu-board11-series
```

Set `LAOGUI_API_BASE_URL`, `LAOGUI_API_TOKEN`, and `LAOGUI_CLIENT_ID` when a
workflow runs outside the local machine. See `docs/codex-bridge.md` for the
bridge command map and payload examples.

Example plan request:

```bash
curl http://localhost:4177/api/v1/plan \
  -H "content-type: application/json" \
  -d '{
    "brief": {
      "projectName": "精品民宿公共休息区",
      "spaceType": "民宿大堂",
      "style": "高端、克制、暖色石材与金属",
      "functions": "接待、休息、茶饮、拍照打卡"
    }
  }'
```

## Image Generation

The workspace does not expose a separate imagegen skill panel. The normal `生成图片` workflow is the integration point: the server builds the spatial-design prompt, optionally lets `gpt-5.5` refine it, then calls Image Gen first and only falls back to the older app image path after the configured retry limit.

The Responses Image Gen request intentionally uses the minimal compatible tool payload (`type`, `size`, `quality`, `output_format`) because some OpenAI-compatible image proxies return 502 when `model`, `background`, `moderation`, `n`, or `output_compression` are included inside the tool object.

For `生成设计系列`, the reference-analysis step also has a production fallback: if the FHL reasoning endpoint times out or returns a gateway error, the server returns a local preset series analysis and continues generation instead of failing the whole workflow. The UI marks this as an analysis fallback, while final image generation still prioritizes the active Image Gen endpoint.

Quality tiers are `1K / 2K / 4K`, and the server normalizes sizes to 16px steps within the model limits.
