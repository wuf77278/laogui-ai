# 老鬼AI

老鬼AI 是一个面向建筑、室内、民宿和商业空间设计师的本地 AI 创意工作台。它把方案分析、空间推演、参考图理解、提示词生成、设计系列出图和项目画布放在同一个界面里，适合做概念方案、视觉方向、客户提案和批量设计探索。

## 下载安装

请到 [GitHub Releases](https://github.com/wuf77278/laogui-ai/releases/latest) 下载最新版安装包：

- Windows 10 / 11：下载名称中带 `windows-x64-setup.exe` 的最新版安装包
- macOS：Apple 芯片下载 `mac-arm64.dmg`，Intel 芯片下载 `mac-x64.dmg`。

首次打开后，在右上角“设置”里添加自己的生图 API。可以保存多套配置并设置调用优先级，首选失败后会自动尝试下一套。软件会把 API Key 保存在本机用户数据目录，关闭软件和自动更新都不会丢失，也不会暴露给浏览器页面。“提示词优化”、方案整理、参考图整理和建模分析都使用项目内置预设，不需要再配置思考 API。

## 手动更新

Windows 安装版启动时不会自动检查或下载。用户需要打开“设置 / 软件更新”，手动点击“检查更新”。发现新版本后，按钮会变成“下载并更新”；只有用户再次确认后才会下载和安装。更新不需要先卸载，原来的本机设置和项目记录会保留。

发布新版本时：

1. 把 `package.json` 中的版本号改大，例如从 `2.0.4` 改为 `2.1.0`。
2. 提交代码，并创建同名标签，例如 `v2.1.0`，然后推送到 GitHub。
3. GitHub 会自动执行 `.github/workflows/release-windows.yml`，生成并发布 Windows 安装包、差分文件和 `latest.yml`。

旧版本如果没有软件内更新功能，需要先手动安装一次新版本。之后发布新版本时，就可以在软件内手动检查并更新。

## 网页使用

老鬼AI 可以作为网页使用，但它不是纯静态网页项目。前端页面需要配套 `server.mjs` 这个 Node 服务，由服务端统一代理模型请求、保存画布状态和管理本地生成结果。

本机网页方式：

```bash
cp .env.example .env
# 编辑 .env，只需填写 IMAGE_API_KEY
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
- AI 编辑：支持矩形、椭圆智能范围，自由套索、多边形套索和画笔精准蒙版；两个编号选区可以分别填写提示词。
- 深度编辑：支持选区、裁切、旋转、翻转、调色、锐化、降噪、图层和透明 PNG 导出。
- AI 局部生成：支持局部消除、局部替换、材质替换、细节增强和自定义编辑，原图不会被覆盖。
- API 配置导入：支持粘贴文本、拖入文件或选择文件夹，真实密钥只保存在本机。
- 本地桌面应用：通过 Electron 在 macOS / Windows 上运行，减少部署门槛。
- 服务端代理 API：浏览器端不直接接触密钥，适合本机或小团队内网使用。

## 当前开发进度（v2.3.5）

- [x] 上传素材参考图后留在当前工作区，需要时可手动进入局部编辑。
- [x] 参考强度与重点参考内容使用磨砂玻璃卡片，并适配白天、暗夜和窄屏。
- [x] 多套生图 API 可设置调用优先级，并在失败时依次自动切换。
- [x] API 配置文件支持读取 `优先级`、`顺序`、`priority`、`rank` 和 `order`。
- [x] API 设置页可直接调整顺序，“设为当前使用”会移动到优先级 1。

- [x] AI 编辑与深度编辑拆分，旧入口统一到新的编辑工作区。
- [x] 编号选区、智能范围和精准蒙版编辑。
- [x] AI 清除后的自然背景重建，避免矩形贴片和蒙版叠加感。
- [x] 生成前显示实际执行能力、影响范围和选区提醒。
- [x] 常用提示词模板、提示词优化开关和失败后重新生成。
- [x] FHL 图片编辑蒙版传递，默认由 FHL 生图 CLI 自动选择正确线路。
- [x] macOS Apple Silicon / Intel 与 Windows x64 / ARM64 图片内核同步。
- [x] 前端算法测试、Go 测试和安装包内容检查。
- [ ] 下一阶段：完善原图对比、结果确认与更清晰的任务进度展示。

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

## API 说明

软件会按调用优先级依次尝试本机保存的多套生图 API：

- `IMAGE_BASE_URL` / `IMAGE_API_KEY`：用于所有实际生图请求。
- “提示词优化”和其他文字整理功能由项目内置预设完成，不会请求另一套思考 API。
- 软件没有内置公共 API 地址，需要在“设置”中添加自己的生图 API。可以添加、编辑、检测、删除并调整每套配置的调用优先级。
- 每套配置会独立显示连接状态、检测时间和延迟；“检测全部”会真实生成测试图，可能产生 API 费用。
- 支持粘贴文本、JSON、`.env`、文件和文件夹导入，也支持导出文件或复制分享文本。导出内容包含完整 API Key，只能发给可信任的人。
- `IMAGE_API_MODE=images`: 默认使用 Images API；也可以在每套 API 配置中单独切换。
- `IMAGE_STUDIO_RESPONSES_TRANSPORT=sse` / `IMAGE_STUDIO_REQUEST_POLICY=openai`: 对齐 Image-Studio 的 “HTTP SSE + OpenAI 标准” 配置。
- `IMAGE_STUDIO_IMAGES_NEW_API_COMPAT=1`: Images API 默认使用普通返回（旧接口兼容）；需要流式返回时改成 `0`。
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
- Add API profile: `POST http://localhost:4177/api/v1/settings/image-endpoints`
- Update API profile: `PATCH http://localhost:4177/api/v1/settings/image-endpoints/:id`
- Select API profile: `POST http://localhost:4177/api/v1/settings/image-endpoints/:id/activate`
- Delete API profile: `DELETE http://localhost:4177/api/v1/settings/image-endpoints/:id`
- Import API profiles: `POST http://localhost:4177/api/v1/settings/image-endpoints/import`
- Export API profiles: `POST http://localhost:4177/api/v1/settings/image-endpoints/export` (localhost only; contains complete API keys)

在设置页面保存的多套生图 API 会写入本机 `logs/runtime-settings.json`。关闭软件、重新打开或自动更新后都仍会保留。接口读取时只返回“Key 已保存”，不会把 Key 发给网页。生图服务可以设置 Responses / Images 路径和可选的 Provider Manifest。

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

“提示词优化”关闭时，软件使用当前功能的精简预设和用户描述进入极速生图；开启时，软件使用 `prompt-library.mjs` 中的项目内置预设整理完整提示词，再直接交给生图 AI。两种模式都只会请求生图 API。

For the software build, Image Studio's `go-cli` is the image-generation core. Laogui AI keeps the design workflow, canvas, task queue, prompt assembly and local history, while `gptcodex-image` handles the upstream image protocol, raw response capture, retry behavior and Responses/Images compatibility.

```bash
IMAGE_STUDIO_ENGINE=required
IMAGE_STUDIO_CLI_PATH=
IMAGE_STUDIO_RESPONSES_TRANSPORT=sse
IMAGE_STUDIO_FAST_REASONING_EFFORT=low
FAST_IMAGE_PROMPT_MAX_CHARS=1200
OPTIMIZED_IMAGE_PROMPT_MAX_CHARS=24000
IMAGE_STUDIO_ALLOW_NATIVE_FALLBACK=0
```

The Image Studio `go-cli` source is vendored under `engines/image-studio/source/go-cli`. Before packaging for friends, build the bundled engine:

```bash
npm run engine:image-studio
```

This writes `engines/image-studio/gptcodex-image` on macOS/Linux or `engines/image-studio/gptcodex-image.exe` on Windows. You can still set `IMAGE_STUDIO_CLI_PATH` for local development. In `required` mode, standard OpenAI-compatible paths do not fall back to the old native `/images/generations` or Responses tool path unless `IMAGE_STUDIO_ALLOW_NATIVE_FALLBACK=1` is explicitly set. Providers that explicitly configure custom paths or a Provider Manifest use the native HTTP adapter so those saved mappings are honored.

The preferred distribution layout is platform-aware:

- macOS Apple Silicon: `engines/image-studio/darwin-arm64/gptcodex-image`
- macOS Intel: `engines/image-studio/darwin-x64/gptcodex-image`
- Windows x64: `engines/image-studio/win32-x64/gptcodex-image.exe`

`npm run engine:image-studio` builds the current machine's platform folder and updates the legacy flat binary path for backward compatibility. Run `npm run doctor` before sharing a build; the `已打包内核平台` line tells you which friend machines are covered.

生图 API 支持 Image Studio 兼容参数，包括 Responses / Images 模式、接口地址、图片模型和生成强度。`reasoningEffort` 只是同一次生图请求里的生成强度参数，不代表另一套思考 API。关闭“提示词优化”时，软件会限制最终提示词长度，并使用较低生成强度以便更快出图。

从 `2.1.1` 开始，1K / 2K / 4K 会按界面显示的实际像素传给生图接口，不再把 2K 横图固定缩成 `1536x1024`。任务记录会同时保存请求尺寸和最终图片真实尺寸；如果上游接口自行缩小，界面会显示“请求尺寸 → 实际尺寸”。

本机的 FHL 精准蒙版编辑通过 `image-studio-fhl` Skill 调用，并固定使用 `--provider auto`。项目不会复制或固化 FHL 的接口、模型、密钥读取方式；没有安装该 Skill 的电脑仍可使用套索、魔棒、抠图、裁切和调色，但 AI 局部编辑需要先安装对应 Skill。

## 深度编辑

画布图片上的“深度编辑”会打开统一全屏工作区，包含矩形选择、自由套索、多边形套索、魔棒、画笔补选/减选、羽化、扩缩选区、裁切、旋转、翻转、调整尺寸、调色、降噪、锐化和透明抠图。所有结果都会生成原图的子节点，不覆盖原图。

“AI 编辑”使用独立工作区，提供“框选编号 1”和“框选编号 2”两个蒙版。两个编号分别保存自己的操作类型和提示词，并按 1 → 2 的顺序通过 FHL `--provider auto` 精准编辑；选区外像素会在前端重新覆盖，结果仍作为原图子节点保存。

“生成设计系列”的参考图整理也使用项目内置预设，并把参考图直接交给生图模型，不需要额外 API。

Quality tiers are `1K / 2K / 4K`, and the server normalizes sizes to 16px steps within the model limits.
