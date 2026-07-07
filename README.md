# 老鬼AI

老鬼AI 是一个面向建筑、室内、民宿和商业空间设计师的本地 AI 创意工作台。它把方案分析、空间推演、参考图理解、提示词生成、设计系列出图和项目画布放在同一个界面里，适合做概念方案、视觉方向、客户提案和批量设计探索。

## 下载安装

请到 [GitHub Releases](https://github.com/wuf77278/laogui-ai/releases/latest) 下载最新版安装包：

- Windows 10 / 11：下载 `LaoguiAI-v2.0.0-windows-x64-setup.exe`
- macOS：当前可先按下面的“网页使用”或 “Desktop App” 开发方式运行，安装包会在后续 release 补齐。

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
the local `/api/*` proxy. By default the service listens on `127.0.0.1`; set
`HOST=0.0.0.0` only when you intentionally share it on LAN or through a tunnel.

Remote-device stability notes:

- Uploads and saved canvas state are compressed client-side before API calls so
  large base64 images do not overload mapped/tunneled connections.
- If a remote browser disconnects mid-upload, the server records it as HTTP
  `499 Client disconnected` with the request body size in logs.
- API endpoint settings can only be changed from the host machine's
  `localhost` session; remote devices can generate tasks but cannot edit keys.
- For LAN sharing or tunnel sharing, configure `HOST=0.0.0.0`,
  `LAOGUI_API_TOKEN` and `API_CORS_ORIGIN` in `.env` before exposing the
  service. Remote API calls without a token are rejected by default.

## 微信扫码登录

老鬼AI 支持通过微信开放平台“网站应用”做扫码登录。登录后，服务端会把该微信用户映射成独立的 `wx-...` clientId，后续生图任务、任务日志和方案资产库会按用户分开保存。管理员可以在“设置 / 微信登录”里切换查看不同用户的生图记录。

配置项：

```bash
WECHAT_LOGIN_APP_ID=你的微信开放平台网站应用 AppID
WECHAT_LOGIN_APP_SECRET=你的微信开放平台网站应用 AppSecret
WECHAT_LOGIN_REDIRECT_URI=https://你的域名/api/auth/wechat/callback
WECHAT_ADMIN_OPENIDS=可选的管理员 openid，多个用逗号分隔
```

微信开放平台必须配置公网 HTTPS 回调域名；没有服务器时，可以先用 Cloudflare Tunnel 或 ngrok 把本机 `http://127.0.0.1:4177` 映射成 HTTPS 域名测试。微信用户资料和登录会话会保存到本机数据目录的 `logs/auth-users.json` 与 `logs/auth-sessions.json`。

## Daily Safety

Initialize version control before making frequent changes:

```bash
git status
npm run check
npm run doctor
```

The repository ignores `.env`, `logs/`, `public/generated/`, screenshots and
other local artifacts. Generated images and logs are runtime data, not source.
The `public/vendor` Three.js files are generated from the npm dependency during
`npm install`; run `npm run vendor:sync` if they ever drift.

Owner-only storage maintenance is available from the web Settings panel, or by
calling `/api/storage/maintenance` from `localhost`. It can archive old generated
files to `archive/generated`, clean test outputs, and prune task logs.

## Check

```bash
npm run check
```

## API Roles

- `gpt-5.5`: creates spatial design directions, material logic, client proposal structure, and image prompts.
- `Image Studio engine`: generates final visuals through the bundled `gptcodex-image` core. The default contract matches Image Studio: Responses API + HTTP SSE + OpenAI-standard fields.

The app uses separate providers:

- `REASONING_BASE_URL` / `REASONING_API_KEY`: text and vision reasoning.
- `IMAGE_BASE_URL` / `IMAGE_API_KEY`: image-generation compatible calls for final visuals.
- There is no bundled default API endpoint. Leave these env vars empty and configure both providers from Settings, or fill them explicitly for local development.
- `IMAGE_API_MODE=responses`: 默认完全按 Image-Studio 的 Responses API 路由请求；如确实要走标准 Images API，才改成 `images`。
- `IMAGE_STUDIO_RESPONSES_TRANSPORT=sse` / `IMAGE_STUDIO_REQUEST_POLICY=openai`: 对齐 Image-Studio 的 “HTTP SSE + OpenAI 标准” 配置。
- `IMAGE_GENERATIONS_PATH=/v1/images/generations` / `IMAGE_EDITS_PATH=/v1/images/edits`: 仅在切换到 Images API 时使用。
- `IMAGE_PROVIDER_MANIFEST='{"submit":{"path":"/v1/images/generations","result":{"b64JsonPaths":["data.*.b64_json"],"imageUrlPaths":["data.*.url"]}}}'`: 可选，自定义 OpenAI-compatible 或异步 HTTP 生图服务的提交、轮询和结果字段映射。
- `IMAGE_RESPONSES_PATH=/v1/responses`: FHL/OpenAI-compatible 服务的 Responses 路径；yybb 才使用 `/responses`。
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
- Image-to-CAD in the web UI: upload a plan, drawing screenshot, or clean line image, then export DXF / SVG from the canvas.
- Legacy 3D model API: `POST http://localhost:4177/api/v1/modeling/3d-model`
- Legacy ForgeCAD/text-to-cad exports remain available by API, but the current canvas entry now focuses on image-to-CAD first.
- Task logs: `GET http://localhost:4177/api/v1/task-logs?limit=20`
- Canvas state: `GET/POST http://localhost:4177/api/v1/canvas-state`
- Runtime settings: `GET http://localhost:4177/api/v1/settings`
- Save API provider: `POST http://localhost:4177/api/v1/settings/providers`

API provider settings added from the web settings panel are saved locally in `logs/runtime-settings.json`. Reasoning and image providers are stored separately. Image providers can define Responses / Images API paths plus an optional Provider Manifest; you can also paste a `gpt_image_playground` `customProviders` export and let the server extract the manifest automatically.

### Optional 3D/CAD Engines

The canvas UI is currently focused on image-to-CAD DXF / SVG extraction. The older parametric 3D model path is kept as an API-level integration for later use:

- ForgeCAD: set `FORGECAD_BIN=forgecad` after installing the ForgeCAD CLI. The UI can generate a `.forge.js` script and try to open `forgecad studio`.
- text-to-cad: clone `https://github.com/earthtojake/text-to-cad`, install the CAD skill dependencies, then set `TEXT_TO_CAD_DIR=/absolute/path/to/text-to-cad`. If it is not configured, the app still downloads a build123d Python source file that can be run later.

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

The normal `生成图片` workflow is the integration point: the server builds the spatial-design prompt, optionally lets `gpt-5.5` refine it, then sends the final text-to-image or image-to-image task into the Image Studio engine and saves the result through the same local `public/generated` pipeline.

For the software build, Image Studio's `go-cli` is the image-generation core. Laogui AI keeps the design workflow, canvas, task queue, prompt assembly and local history, while `gptcodex-image` handles the upstream image protocol, raw response capture, retry behavior and Responses/Images compatibility.

```bash
IMAGE_STUDIO_ENGINE=required
IMAGE_STUDIO_CLI_PATH=
IMAGE_STUDIO_RESPONSES_TRANSPORT=sse
IMAGE_STUDIO_FAST_REASONING_EFFORT=low
FAST_IMAGE_PROMPT_MAX_CHARS=1200
IMAGE_STUDIO_ALLOW_NATIVE_FALLBACK=0
```

The Image Studio `go-cli` source is vendored under `engines/image-studio/source/go-cli`. Before packaging for friends, build the bundled engine:

```bash
npm run engine:image-studio
```

This writes `engines/image-studio/gptcodex-image` on macOS/Linux or `engines/image-studio/gptcodex-image.exe` on Windows. You can still set `IMAGE_STUDIO_CLI_PATH` for local development. In `required` mode, image generation does not fall back to the old native `/images/generations` or Responses tool path unless `IMAGE_STUDIO_ALLOW_NATIVE_FALLBACK=1` is explicitly set.

The preferred distribution layout is platform-aware:

- macOS Apple Silicon: `engines/image-studio/darwin-arm64/gptcodex-image`
- macOS Intel: `engines/image-studio/darwin-x64/gptcodex-image`
- Windows x64: `engines/image-studio/win32-x64/gptcodex-image.exe`

`npm run engine:image-studio` builds the current machine's platform folder and updates the legacy flat binary path for backward compatibility. Run `npm run doctor` before sharing a build; the `已打包内核平台` line tells you which friend machines are covered.

The upstream image API settings use Image Studio-compatible fields: `apiMode` (`responses` or `images`), `responsesTransport` (`sse` or `websocket`), `requestPolicy` (`openai` or `compat`), `baseURL`, `imageModelID`, and `reasoningEffort`. Reasoning API settings are saved separately with their own Base URL, Key, and model. The bundled `gptcodex-image` engine receives the saved image settings as CLI flags. When UI thinking mode is off, Laogui AI now uses a fast path: it caps the final prompt with `FAST_IMAGE_PROMPT_MAX_CHARS` and sends `IMAGE_STUDIO_FAST_REASONING_EFFORT` to the engine instead of the normal high-reasoning setting.

The local Codex skill `image-studio-fhl` remains as a development fallback on this machine, but the distributed software does not depend on Codex skills or the user's Codex directory.

For `生成设计系列`, the reference-analysis step also has a production fallback: if the configured reasoning endpoint times out or returns a gateway error, the server returns a local preset series analysis and continues generation instead of failing the whole workflow. The UI marks this as an analysis fallback, while final image generation still prioritizes the active Image Gen endpoint.

Quality tiers are `1K / 2K / 4K`, and the server normalizes sizes to 16px steps within the model limits.
