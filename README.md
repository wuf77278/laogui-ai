# 老鬼AI

Local MVP for an AI creative workspace aimed at architecture and spatial designers.

## Run

```bash
cd /Users/Apple_501/Desktop/设计师网站
cp .env.example .env
# edit .env and set REASONING_API_KEY + YYBB_API_KEY
npm start
```

Open `http://localhost:4177`.

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
- `Image Gen`: generates the final visuals through the Responses `image_generation` tool. The server tries this skill path first, up to `IMAGE_GEN_SKILL_MAX_ATTEMPTS` times, then falls back to the older app-compatible image generation endpoint with `gpt-image-2`.

The app uses separate providers:

- `REASONING_BASE_URL` / `REASONING_API_KEY`: text and vision reasoning.
- `YYBB_BASE_URL` / `YYBB_API_KEY`: Image Gen-compatible calls for final image generation.
- `IMAGE_RESPONSES_PATH=/responses`: yybb 的 Responses 路径；其他 OpenAI-compatible 服务通常是 `/v1/responses`。
- `IMAGE_GEN_SKILL_MAX_ATTEMPTS=5`: Image Gen skill 的最高优先级重试次数；全部失败后才切换到旧 App 生图路径。
- `IMAGE_ALLOW_LEGACY_FALLBACK=0`: 默认只走 Responses `image_generation`，确保网页里配置的自定义生图 API 也经过 Image Gen 链路。
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

Custom Image Gen endpoints added from the web settings panel are saved locally in `logs/runtime-settings.json`. They are used as Responses `image_generation` providers, not as direct legacy image-generation calls.

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
