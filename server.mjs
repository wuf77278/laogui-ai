import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  communityPromptBlueprintLines,
  communityPromptCompactRules,
  communityPromptLibraryBlock,
  communityPromptPreflightLines,
  promptLibraryVersion
} from "./prompt-library.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

loadDotEnv(path.join(__dirname, ".env"));

const appDataDir = resolveAppDataDir();
const externalDataDirEnabled = Boolean(process.env.LAOGUI_DATA_DIR);
const generatedDir = externalDataDirEnabled ? path.join(appDataDir, "generated") : path.join(publicDir, "generated");
const generatedArchiveDir = path.join(appDataDir, "archive", "generated");
const logsDir = path.join(appDataDir, "logs");
const taskLogPath = path.join(logsDir, "task-runs.jsonl");
const taskLogDir = path.join(logsDir, "task-runs");
const canvasStatePath = path.join(logsDir, "canvas-state.json");
const canvasStateDir = path.join(logsDir, "canvas-states");
const runtimeSettingsPath = path.join(logsDir, "runtime-settings.json");

function resolveAppDataDir() {
  if (process.env.LAOGUI_DATA_DIR) return path.resolve(process.env.LAOGUI_DATA_DIR);
  return __dirname;
}

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback || "").replace(/\/+$/, "");
}

function splitBaseUrlList(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => normalizeBaseUrl(item))
    .filter(Boolean);
}

function uniqueBaseUrls(values) {
  return [...new Set(values.map((value) => normalizeBaseUrl(value)).filter(Boolean))];
}

function envHasValue(name) {
  return String(process.env[name] || "").trim() !== "";
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function readJsonEnv(names) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const raw = String(process.env[key] || "").trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`[settings] ignored invalid JSON env ${key}: ${error.message || error}`);
    }
  }
  return null;
}

function normalizeImageApiMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["images", "responses", "auto"].includes(mode) ? mode : "images";
}

function boundedIntegerEnv(names, fallback, min = 1, max = 20) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const value = Number(process.env[key]);
    if (Number.isFinite(value)) return Math.max(min, Math.min(value, max));
  }
  return fallback;
}

function defaultImageBaseUrls() {
  return [
    "https://ai.mxou.cn",
    "https://yybb.codes"
  ];
}

function imageBaseUrlConfiguredByEnv() {
  return [
    "IMAGE_BASE_URL",
    "IMAGE_BASE_URLS",
    "IMAGE_COST_FIRST_BASE_URLS",
    "IMAGE_PRIORITY_BASE_URLS",
    "IMAGE_ENDPOINT_PRIORITY_BASE_URLS",
    "YYBB_BASE_URL",
    "YYBB_BASE_URLS",
    "FHL_IMAGE_BASE_URL",
    "OPENAI_BASE_URL"
  ].some(envHasValue);
}

function includeDefaultImageBaseUrls() {
  if (envHasValue("IMAGE_INCLUDE_DEFAULT_BASE_URLS")) {
    return parseBooleanEnv(process.env.IMAGE_INCLUDE_DEFAULT_BASE_URLS, false);
  }
  return !imageBaseUrlConfiguredByEnv();
}

function costFirstImageBaseUrls() {
  const configured = splitBaseUrlList(process.env.IMAGE_COST_FIRST_BASE_URLS || process.env.FHL_IMAGE_BASE_URL);
  if (configured.length) return uniqueBaseUrls(configured);
  return [];
}

function priorityImageBaseUrls() {
  return uniqueBaseUrls([
    ...costFirstImageBaseUrls(),
    ...splitBaseUrlList(process.env.IMAGE_PRIORITY_BASE_URLS || process.env.IMAGE_ENDPOINT_PRIORITY_BASE_URLS)
  ]);
}

function configuredImageBaseUrls() {
  const priorityBaseUrls = priorityImageBaseUrls();
  const includeDefaults = includeDefaultImageBaseUrls();
  const primaryFallback = includeDefaults ? "https://yybb.codes" : "";
  const primary = process.env.IMAGE_BASE_URL || process.env.YYBB_BASE_URL || process.env.OPENAI_BASE_URL || primaryFallback;
  return uniqueBaseUrls([
    ...priorityBaseUrls,
    ...splitBaseUrlList(process.env.IMAGE_BASE_URLS || process.env.YYBB_BASE_URLS),
    primary,
    ...(includeDefaults ? defaultImageBaseUrls() : [])
  ]);
}

const config = {
  port: Number(process.env.PORT || 4177),
  reasoningModel: process.env.REASONING_MODEL || "gpt-5.5",
  imageModel: process.env.IMAGE_MODEL || "gpt-image-2",
  reasoningProvider: {
    baseUrl: normalizeBaseUrl(process.env.REASONING_BASE_URL || process.env.OPENAI_BASE_URL || process.env.YYBB_BASE_URL, "https://yybb.codes"),
    apiKey: process.env.REASONING_API_KEY || process.env.OPENAI_API_KEY || process.env.YYBB_API_KEY || "",
    responsesPath: process.env.REASONING_RESPONSES_PATH || ""
  },
  imageProvider: {
    baseUrl: normalizeBaseUrl(process.env.IMAGE_BASE_URL || process.env.YYBB_BASE_URL || process.env.OPENAI_BASE_URL, "https://yybb.codes"),
    baseUrls: configuredImageBaseUrls(),
    apiKey: process.env.IMAGE_API_KEY || process.env.YYBB_API_KEY || process.env.OPENAI_API_KEY || "",
    responsesPath: process.env.IMAGE_RESPONSES_PATH || "",
    imageGenerationPath: process.env.IMAGE_GENERATIONS_PATH || process.env.IMAGE_GENERATION_PATH || "",
    imageEditPath: process.env.IMAGE_EDITS_PATH || process.env.IMAGE_EDIT_PATH || "",
    providerManifest: null
  },
  maxJsonBodyBytes: boundedIntegerEnv("MAX_JSON_BODY_MB", 80, 1, 200) * 1024 * 1024,
  imageApiMode: normalizeImageApiMode(process.env.IMAGE_API_MODE || process.env.IMAGE_GENERATION_API_MODE),
  imageGenerationConcurrency: boundedIntegerEnv(["IMAGE_GENERATION_CONCURRENCY", "LAOGUI_IMAGE_CONCURRENCY"], 2, 1, 8),
  imageGenerationQueueMaxPending: boundedIntegerEnv(["IMAGE_GENERATION_QUEUE_MAX_PENDING", "LAOGUI_IMAGE_QUEUE_MAX_PENDING"], 12, 0, 200),
  imageGenerationQueueTimeoutMs: boundedIntegerEnv(["IMAGE_GENERATION_QUEUE_TIMEOUT_SECONDS", "LAOGUI_IMAGE_QUEUE_TIMEOUT_SECONDS"], 600, 10, 3600) * 1000,
  publicApi: {
    token: process.env.LAOGUI_API_TOKEN || process.env.API_ACCESS_TOKEN || "",
    corsOrigin: process.env.API_CORS_ORIGIN || ""
  }
};

const imageEndpointStats = new Map();
const imageGenerationQueue = [];
let activeImageGenerationTasks = 0;
let lastImageEndpointPrecheckAt = 0;
let imageEndpointPrecheckPromise = null;
const runtimeSettings = {
  providers: {
    reasoning: null,
    image: null
  },
  providerProfiles: [],
  imageEndpoints: []
};
const taskResults = new Map();
const TASK_RESULT_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key]) continue;
    process.env[key] = value.replace(/^["']|["']$/g, "");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function setApiCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const configured = String(config.publicApi.corsOrigin || "").trim();
  if (!configured) return;

  const allowedOrigins = configured
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowedOrigins.includes("*")
    ? "*"
    : allowedOrigins.includes(origin)
      ? origin
      : "";
  if (!allowOrigin) return;

  res.setHeader("access-control-allow-origin", allowOrigin);
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-laogui-api-key, x-api-key");
  res.setHeader("access-control-max-age", "86400");
  if (allowOrigin !== "*") res.setHeader("vary", "origin");
}

function readHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function externalApiAuthorized(req) {
  const token = config.publicApi.token;
  if (!token) return true;
  const authorization = readHeader(req, "authorization");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const apiKey = readHeader(req, "x-laogui-api-key") || readHeader(req, "x-api-key");
  return bearer === token || apiKey === token;
}

function sendUnauthorizedApi(res) {
  sendJson(res, 401, {
    ok: false,
    error: "Unauthorized API request",
    message: "Set Authorization: Bearer <LAOGUI_API_TOKEN> or x-laogui-api-key."
  });
}

function isLoopbackAddress(address = "") {
  const normalized = String(address || "").replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1" || normalized === "localhost";
}

function hasForwardedClientHeaders(req) {
  return Boolean(
    readHeader(req, "cf-connecting-ip")
    || readHeader(req, "cf-ray")
    || readHeader(req, "x-forwarded-for")
    || readHeader(req, "x-real-ip")
  );
}

function isLocalHostHeader(req) {
  const host = String(readHeader(req, "host") || "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function requestByteLength(req) {
  const raw = Number(readHeader(req, "content-length") || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function describeRequestSize(req) {
  const bytes = requestByteLength(req);
  if (!bytes) return "unknown size";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

function isClientAbortError(error) {
  const code = String(error?.code || "");
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  return code === "ECONNRESET"
    || code === "ERR_STREAM_PREMATURE_CLOSE"
    || name === "AbortError"
    || /\baborted\b|request aborted|premature close/i.test(message);
}

function clientAbortError(req) {
  const error = new Error(`Client disconnected while reading request body (${describeRequestSize(req)}).`);
  error.status = 499;
  return error;
}

function isOwnerRequest(req) {
  return isLocalHostHeader(req) && isLoopbackAddress(req.socket?.remoteAddress) && !hasForwardedClientHeaders(req);
}

function sendOwnerOnly(res) {
  sendJson(res, 403, {
    ok: false,
    error: "只有本机 localhost 可以修改 API 设置。请在电脑本机打开 http://localhost:4177 后再调整。"
  });
}

function isRemoteRequest(req) {
  return !isOwnerRequest(req);
}

function requireRemoteApiAuthorization(req, res) {
  if (!isRemoteRequest(req)) return true;
  if (externalApiAuthorized(req)) return true;
  sendUnauthorizedApi(res);
  return false;
}

function clientIdFromRequest(req, url, { requiredForRemote = true } = {}) {
  const raw = url.searchParams.get("clientId") || "";
  if (requiredForRemote && isRemoteRequest(req) && !raw.trim()) {
    const error = new Error("Missing clientId");
    error.status = 400;
    throw error;
  }
  return sanitizeClientId(raw || "local");
}

async function readJson(req) {
  let raw = "";
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > config.maxJsonBodyBytes) {
        const error = new Error(`JSON body too large; limit is ${Math.round(config.maxJsonBodyBytes / 1024 / 1024)}MB`);
        error.status = 413;
        throw error;
      }
      raw += chunk;
    }
  } catch (error) {
    if (isClientAbortError(error) || req.aborted) throw clientAbortError(req);
    throw error;
  }
  if (req.aborted) throw clientAbortError(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerFor(kind) {
  if (kind === "image") return config.imageProvider;
  return config.reasoningProvider;
}

function providerKeyNames(kind) {
  return kind === "image"
    ? "IMAGE_API_KEY or YYBB_API_KEY"
    : "REASONING_API_KEY or OPENAI_API_KEY";
}

function providerUrl(source, pathname) {
  const nextPath = source.baseUrl.endsWith("/v1") && pathname.startsWith("/v1/")
    ? pathname.slice(3)
    : pathname;
  return `${source.baseUrl}${nextPath}`;
}

function providerResponsesPath(source) {
  if (source.responsesPath) return source.responsesPath.startsWith("/") ? source.responsesPath : `/${source.responsesPath}`;
  return isYybbBaseUrl(source.baseUrl) ? "/responses" : "/v1/responses";
}

function normalizeProviderApiPath(value, fallback) {
  const text = String(value || fallback || "").trim() || fallback;
  return text.startsWith("/") ? text : `/${text}`;
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key, item]) => key && ["string", "number", "boolean"].includes(typeof item))
    .map(([key, item]) => [key, String(item)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

const defaultImageResultMapping = {
  imageUrlPaths: ["data.*.url"],
  b64JsonPaths: ["data.*.b64_json"]
};

const defaultImageGenerationBodyTemplate = {
  model: "$profile.model",
  prompt: "$prompt",
  size: "$params.size",
  quality: "$params.quality",
  output_format: "$params.output_format",
  moderation: "$params.moderation",
  output_compression: "$params.output_compression",
  n: "$params.n"
};

const defaultImageEditFiles = [
  { field: "image[]", source: "inputImages", array: true },
  { field: "mask", source: "mask" }
];

function normalizeRequestMethod(value, fallback = "POST") {
  const method = String(value || fallback).trim().toUpperCase();
  return method === "GET" || method === "POST" ? method : fallback;
}

function normalizeContentType(value, fallback = "json") {
  return String(value || fallback).trim().toLowerCase() === "multipart" ? "multipart" : "json";
}

function normalizeBodyTemplate(value, fallback = defaultImageGenerationBodyTemplate) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function normalizeFileMappings(value, fallback = defaultImageEditFiles) {
  if (!Array.isArray(value)) return fallback;
  const files = value
    .map((item) => {
      if (!item || typeof item !== "object" || !String(item.field || "").trim()) return null;
      if (!["inputImages", "mask"].includes(item.source)) return null;
      return {
        field: String(item.field).trim(),
        source: item.source,
        array: Boolean(item.array)
      };
    })
    .filter(Boolean);
  return files.length ? files : fallback;
}

function normalizeResultMapping(value, fallback = defaultImageResultMapping) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    imageUrlPaths: normalizeStringArray(record.imageUrlPaths, fallback.imageUrlPaths),
    b64JsonPaths: normalizeStringArray(record.b64JsonPaths, fallback.b64JsonPaths)
  };
}

function normalizeSubmitMapping(value, fallback = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const contentType = normalizeContentType(record.contentType, fallback.contentType || "json");
  const defaultBody = contentType === "multipart" ? defaultImageGenerationBodyTemplate : defaultImageGenerationBodyTemplate;
  return {
    path: normalizeProviderApiPath(record.path, fallback.path || "/v1/images/generations"),
    method: normalizeRequestMethod(record.method, fallback.method || "POST"),
    contentType,
    query: normalizeStringRecord(record.query) || fallback.query,
    body: normalizeBodyTemplate(record.body, fallback.body || defaultBody),
    files: contentType === "multipart" ? normalizeFileMappings(record.files, fallback.files || defaultImageEditFiles) : undefined,
    taskIdPath: typeof record.taskIdPath === "string" && record.taskIdPath.trim() ? record.taskIdPath.trim() : fallback.taskIdPath,
    result: normalizeResultMapping(record.result, fallback.result || defaultImageResultMapping)
  };
}

function normalizePollMapping(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const statusPath = typeof value.statusPath === "string" && value.statusPath.trim() ? value.statusPath.trim() : "";
  if (!statusPath) return undefined;
  return {
    path: normalizeProviderApiPath(value.path, "/v1/images/tasks/{task_id}"),
    method: normalizeRequestMethod(value.method, "GET"),
    query: normalizeStringRecord(value.query),
    intervalSeconds: Math.max(1, Number(value.intervalSeconds) || 5),
    statusPath,
    successValues: normalizeStringArray(value.successValues, ["SUCCESS", "succeeded", "completed", "COMPLETED"]),
    failureValues: normalizeStringArray(value.failureValues, ["FAILURE", "failed", "error", "FAILED", "cancelled"]),
    errorPath: typeof value.errorPath === "string" && value.errorPath.trim() ? value.errorPath.trim() : "",
    result: normalizeResultMapping(value.result, defaultImageResultMapping)
  };
}

function normalizeProviderManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const submit = input.submit && typeof input.submit === "object" ? input.submit : null;
  if (!submit) return null;
  return {
    id: String(input.id || input.name || "custom-http-image").trim(),
    name: String(input.name || input.id || "自定义服务商").trim(),
    template: "http-image",
    submit: normalizeSubmitMapping(submit, {
      path: "/v1/images/generations",
      method: "POST",
      contentType: "json",
      body: defaultImageGenerationBodyTemplate,
      result: defaultImageResultMapping
    }),
    editSubmit: input.editSubmit && typeof input.editSubmit === "object"
      ? normalizeSubmitMapping(input.editSubmit, {
          path: "/v1/images/edits",
          method: "POST",
          contentType: "multipart",
          body: defaultImageGenerationBodyTemplate,
          files: defaultImageEditFiles,
          result: defaultImageResultMapping
        })
      : undefined,
    poll: normalizePollMapping(input.poll)
  };
}

function providerManifestFromInput(input, existing = null) {
  const direct = input?.providerManifest ?? input?.manifest ?? input?.customProviderManifest ?? input?.customProvider;
  if (typeof input?.providerManifestJson === "string" && input.providerManifestJson.trim()) {
    try {
      return normalizeProviderManifest(JSON.parse(input.providerManifestJson));
    } catch (error) {
      error.message = `Provider Manifest JSON 无效：${error.message || error}`;
      error.status = 400;
      throw error;
    }
  }
  if (typeof direct === "string" && direct.trim()) {
    try {
      return normalizeProviderManifest(JSON.parse(direct));
    } catch (error) {
      error.message = `Provider Manifest JSON 无效：${error.message || error}`;
      error.status = 400;
      throw error;
    }
  }
  if (direct && typeof direct === "object") return normalizeProviderManifest(direct);
  if (input?.providerManifest === null || input?.manifest === null || input?.customProviderManifest === null) return null;
  return existing?.providerManifest || null;
}

config.imageProvider.providerManifest = normalizeProviderManifest(readJsonEnv(["IMAGE_PROVIDER_MANIFEST", "IMAGE_API_PROVIDER_MANIFEST"]));

function isYybbBaseUrl(baseUrl) {
  return /(^|\/\/)(?:[^/]*\.)?yybb\.(?:codes|dog)(?:\/|$)/i.test(String(baseUrl || ""));
}

function isFhlBaseUrl(baseUrl) {
  return /(^|\/\/)(?:www\.)?fhl\.mom(?:\/|$)/i.test(String(baseUrl || ""));
}

function imageProviderKind(baseUrl) {
  if (isYybbBaseUrl(baseUrl)) return "yybb";
  if (isFhlBaseUrl(baseUrl)) return "fhl";
  return "custom";
}

function imageProviderApiKey(baseUrl) {
  if (isFhlBaseUrl(baseUrl)) {
    return process.env.FHL_API_KEY || config.reasoningProvider.apiKey || "";
  }
  return config.imageProvider.apiKey;
}

function imageProviderKeySource(baseUrl) {
  if (isFhlBaseUrl(baseUrl)) return process.env.FHL_API_KEY ? "FHL_API_KEY" : "reasoning";
  return "image";
}

function runtimeImageEndpointSources() {
  return runtimeSettings.imageEndpoints
    .filter((endpoint) => endpoint.enabled && endpoint.baseUrl && endpoint.apiKey)
    .map((endpoint) => ({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      responsesPath: endpoint.responsesPath || config.imageProvider.responsesPath,
      imageGenerationPath: endpoint.imageGenerationPath || config.imageProvider.imageGenerationPath,
      imageEditPath: endpoint.imageEditPath || config.imageProvider.imageEditPath,
      providerManifest: endpoint.providerManifest || null,
      kind: "custom",
      keySource: "runtime",
      runtimeId: endpoint.id,
      label: endpoint.label || endpoint.baseUrl
    }));
}

function imageProviderSources() {
  const runtimeSources = runtimeImageEndpointSources();
  const runtimeBaseUrls = new Set(runtimeSources.map((source) => normalizeBaseUrl(source.baseUrl)));
  const envSources = config.imageProvider.baseUrls
    .filter((baseUrl) => !runtimeBaseUrls.has(normalizeBaseUrl(baseUrl)))
    .map((baseUrl) => ({
    ...config.imageProvider,
    baseUrl,
    apiKey: imageProviderApiKey(baseUrl),
    kind: imageProviderKind(baseUrl),
    keySource: imageProviderKeySource(baseUrl),
    imageGenerationPath: config.imageProvider.imageGenerationPath,
    imageEditPath: config.imageProvider.imageEditPath,
    providerManifest: config.imageProvider.providerManifest || null,
    responsesPath: isFhlBaseUrl(baseUrl)
      ? (process.env.FHL_RESPONSES_PATH || config.reasoningProvider.responsesPath || config.imageProvider.responsesPath)
      : config.imageProvider.responsesPath
  }));
  const seen = new Set();
  return [...runtimeSources, ...envSources].filter((source) => {
    const key = normalizeBaseUrl(source.baseUrl);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activeImageProviderSource() {
  return imageProviderSources().find((source) => source.baseUrl === config.imageProvider.baseUrl)
    || imageProviderSources().find((source) => source.apiKey)
    || config.imageProvider;
}

function imageEndpointStat(baseUrl) {
  if (!imageEndpointStats.has(baseUrl)) {
    imageEndpointStats.set(baseUrl, {
      baseUrl,
      successes: 0,
      failures: 0,
      avgMs: null,
      probeMs: null,
      lastProbeAt: 0,
      lastProbeError: "",
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      imageUnsupportedUntil: 0,
      imageUnsupportedReason: "",
      lastError: ""
    });
  }
  return imageEndpointStats.get(baseUrl);
}

function imageEndpointBlockReason(source, now = Date.now()) {
  const stat = imageEndpointStat(source.baseUrl);
  if (!source.apiKey) return "missing_api_key";
  if (stat.imageUnsupportedUntil > now) return "image_unsupported";
  if (stat.cooldownUntil > now) return "cooling";
  return "";
}

function imageEndpointPriority(baseUrl) {
  const priorityIndex = priorityImageBaseUrls().indexOf(normalizeBaseUrl(baseUrl));
  return priorityIndex >= 0 ? priorityIndex + 1 : null;
}

function imageEndpointPriorityBoost(source) {
  const priority = imageEndpointPriority(source.baseUrl);
  if (!priority) return 0;
  return -50_000_000 + priority * 100;
}

function imageEndpointCostFirstMaxAttempts(source) {
  const costFirstBaseUrls = costFirstImageBaseUrls();
  if (!costFirstBaseUrls.includes(normalizeBaseUrl(source.baseUrl))) return 1;
  const configured = Number(process.env.IMAGE_COST_FIRST_MAX_ATTEMPTS || process.env.FHL_IMAGE_MAX_ATTEMPTS || 2);
  return Math.max(1, Math.min(Number.isFinite(configured) ? configured : 2, 20));
}

function imageEndpointCostFirstCandidate(source, now = Date.now()) {
  if (!source?.apiKey) return false;
  const reason = imageEndpointBlockReason(source, now);
  return !["missing_api_key", "image_unsupported"].includes(reason);
}

function orderedImageProviderSources({ includeBlocked = false } = {}) {
  const now = Date.now();
  return imageProviderSources()
    .map((source, index) => ({ source, stat: imageEndpointStat(source.baseUrl), index }))
    .filter((item) => includeBlocked || !imageEndpointBlockReason(item.source, now))
    .sort((a, b) => {
      const score = (item) => {
        const unsupported = item.stat.imageUnsupportedUntil > now ? 1 : 0;
        const cooling = item.stat.cooldownUntil > now ? 1 : 0;
        const hasRealSuccess = item.stat.successes > 0;
        const neverGeneratedPenalty = hasRealSuccess ? 0 : (item.stat.failures > 0 ? 1_000_000 : 800_000);
        const latency = hasRealSuccess
          ? (item.stat.avgMs ?? 120_000)
          : (item.stat.probeMs ?? 5_000);
        const reliability = item.stat.failures * 15_000 - item.stat.successes * 20_000;
        return unsupported * 10_000_000
          + cooling * 1_000_000
          + neverGeneratedPenalty
          + reliability
          + latency
          + item.index * 20
          + imageEndpointPriorityBoost(item.source);
      };
      return score(a) - score(b);
    })
    .map((item) => item.source);
}

function plannedImageProviderAttempts() {
  const now = Date.now();
  const allSources = imageProviderSources();
  const costFirstBaseUrls = costFirstImageBaseUrls();
  const costFirstBaseUrlSet = new Set(costFirstBaseUrls);
  const plan = [];

  for (const baseUrl of costFirstBaseUrls) {
    const source = allSources.find((item) => normalizeBaseUrl(item.baseUrl) === baseUrl);
    if (!imageEndpointCostFirstCandidate(source, now)) continue;
    const maxAttempts = imageEndpointCostFirstMaxAttempts(source);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      plan.push({ source, attempt, maxAttempts, costFirst: true });
    }
  }

  const orderedSources = orderedImageProviderSources();
  const fallbackSources = orderedSources.length ? orderedSources : orderedImageProviderSources({ includeBlocked: true });
  for (const source of fallbackSources) {
    if (!source?.apiKey) continue;
    if (costFirstBaseUrlSet.has(normalizeBaseUrl(source.baseUrl))) continue;
    plan.push({ source, attempt: 1, maxAttempts: 1, costFirst: false });
  }

  return plan.length
    ? plan
    : allSources
        .filter((source) => source.apiKey)
        .map((source) => ({ source, attempt: 1, maxAttempts: 1, costFirst: false }));
}

function markImageEndpointSuccess(source, ms, { activate = true, probe = false } = {}) {
  const stat = imageEndpointStat(source.baseUrl);
  const now = Date.now();
  if (probe) {
    stat.lastProbeAt = now;
    stat.lastProbeError = "";
    stat.probeMs = stat.probeMs === null ? ms : Math.round(stat.probeMs * 0.6 + ms * 0.4);
  } else {
    stat.successes += 1;
    stat.lastSuccessAt = now;
    stat.avgMs = stat.avgMs === null ? ms : Math.round(stat.avgMs * 0.7 + ms * 0.3);
    stat.imageUnsupportedUntil = 0;
    stat.imageUnsupportedReason = "";
  }
  stat.cooldownUntil = 0;
  if (!probe) stat.lastError = "";
  if (activate) config.imageProvider.baseUrl = source.baseUrl;
}

function markImageEndpointFailure(source, error, { probe = false } = {}) {
  const stat = imageEndpointStat(source.baseUrl);
  const now = Date.now();
  stat.failures += 1;
  stat.lastFailureAt = now;
  const message = error?.status ? `${error.status} ${error.message || ""}`.trim() : String(error?.message || "request failed");
  if (probe) {
    stat.lastProbeAt = now;
    stat.lastProbeError = message;
  }
  stat.lastError = message;
  if (isImageCapabilityError(error)) {
    stat.imageUnsupportedUntil = now + 30 * 60 * 1000;
    stat.imageUnsupportedReason = message;
  }
  const failureCount = Math.min(stat.failures, 5);
  const baseCooldown = error?.status === 429 ? 120000 : 30000;
  stat.cooldownUntil = now + baseCooldown * failureCount;
}

function imageEndpointHealth() {
  const now = Date.now();
  return imageProviderSources().map((source) => {
    const stat = imageEndpointStat(source.baseUrl);
    const blockReason = imageEndpointBlockReason(source, now);
    return {
      baseUrl: source.baseUrl,
      label: source.label || shortRuntimeEndpointLabel(source.baseUrl),
      runtimeId: source.runtimeId || null,
      responsesPath: providerResponsesPath(source),
      imageGenerationPath: providerImageApiPath(source, "generation"),
      imageEditPath: providerImageApiPath(source, "edit"),
      providerManifestName: source.providerManifest?.name || null,
      kind: source.kind,
      keySource: source.keySource,
      priority: imageEndpointPriority(source.baseUrl),
      costFirst: costFirstImageBaseUrls().includes(normalizeBaseUrl(source.baseUrl)),
      maxAttemptsBeforeFallback: imageEndpointCostFirstMaxAttempts(source),
      configured: Boolean(source.apiKey),
      active: source.baseUrl === config.imageProvider.baseUrl,
      status: blockReason || "available",
      successes: stat.successes,
      failures: stat.failures,
      avgMs: stat.avgMs,
      probeMs: stat.probeMs,
      lastProbeAt: stat.lastProbeAt || null,
      lastProbeError: stat.lastProbeError || null,
      lastSuccessAt: stat.lastSuccessAt || null,
      lastFailureAt: stat.lastFailureAt || null,
      cooldownMs: Math.max(0, stat.cooldownUntil - now),
      imageUnsupportedMs: Math.max(0, stat.imageUnsupportedUntil - now),
      imageUnsupportedReason: stat.imageUnsupportedReason || null,
      lastError: stat.lastError || null
    };
  });
}

const providerProbeStats = {
  reasoning: null,
  image: null
};

function publicProviderProbe(kind) {
  const probe = providerProbeStats[kind];
  return probe ? { ...probe } : null;
}

function imageEndpointRecommendation(endpoints = imageEndpointHealth()) {
  const recommended = endpoints.find((endpoint) => endpoint.active)
    || endpoints.find((endpoint) => endpoint.configured && endpoint.status === "available")
    || null;
  if (!recommended) return null;

  const reason = (() => {
    if (recommended.status !== "available") {
      return `当前端点状态为 ${recommended.status}，仅作为候选，不建议优先使用。`;
    }
    if (recommended.priority) {
      const probe = recommended.probeMs ? `，本次轻量测速 ${recommended.probeMs}ms` : "";
      const success = recommended.successes > 0
        ? `，历史真实出图成功 ${recommended.successes} 次${recommended.avgMs ? `，平均约 ${Math.round(recommended.avgMs / 1000)} 秒` : ""}`
        : "，暂无真实出图成功记录";
      const costFirst = recommended.costFirst
        ? `，成本优先端点会连续尝试 ${recommended.maxAttemptsBeforeFallback || 5} 次后再切换`
        : "";
      return `已设为生图优先级 #${recommended.priority}${probe}${success}${costFirst}；生成时会优先尝试该端点，失败后自动降级到其它端点。`;
    }
    if (recommended.successes > 0) {
      const avg = recommended.avgMs ? `，历史真实出图平均约 ${Math.round(recommended.avgMs / 1000)} 秒` : "";
      const probe = recommended.probeMs ? `，本次轻量测速 ${recommended.probeMs}ms` : "";
      return `历史真实出图成功 ${recommended.successes} 次${avg}${probe}，综合成功率和速度后推荐使用。`;
    }
    if (recommended.probeMs) {
      return `本次轻量测速 ${recommended.probeMs}ms，但暂无真实出图成功记录；如果有已成功端点，会优先选择成功端点。`;
    }
    return "端点已配置但还没有测速和真实出图记录。";
  })();

  return {
    baseUrl: recommended.baseUrl,
    status: recommended.status,
    successes: recommended.successes,
    failures: recommended.failures,
    avgMs: recommended.avgMs,
    probeMs: recommended.probeMs,
    priority: recommended.priority || null,
    reason
  };
}

function hydrateImageEndpointStatsFromTaskLogs(limit = 120) {
  if (!existsSync(taskLogPath)) return;
  const knownSources = new Map(imageProviderSources().map((source) => [source.baseUrl, source]));
  const lines = readFileSync(taskLogPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);

  for (const line of lines) {
    let log;
    try {
      log = JSON.parse(line);
    } catch {
      continue;
    }

    const attempts = [
      ...(Array.isArray(log.result?.attempts) ? log.result.attempts : []),
      ...(!log.result?.attempts && Array.isArray(log.error?.attempts) ? log.error.attempts : [])
    ];

    for (const attempt of attempts) {
      const source = knownSources.get(attempt.endpoint);
      if (!source || !["success", "failed"].includes(attempt.status)) continue;
      const stat = imageEndpointStat(source.baseUrl);
      const durationMs = Number(attempt.durationMs || 0);
      if (attempt.status === "success") {
        stat.successes += 1;
        stat.lastSuccessAt = new Date(log.completedAt || log.startedAt || Date.now()).getTime();
        if (durationMs > 0) stat.avgMs = stat.avgMs === null ? durationMs : Math.round(stat.avgMs * 0.7 + durationMs * 0.3);
        stat.lastError = "";
      } else {
        stat.failures += 1;
        stat.lastFailureAt = new Date(log.completedAt || log.startedAt || Date.now()).getTime();
        stat.lastError = truncateLogText(attempt.error || log.error?.message || "request failed", 1000);
      }
    }

    if (!attempts.length && log.status === "failed") {
      const endpoint = log.error?.endpoint || log.result?.endpoint || log.activeImageBaseUrl;
      const source = knownSources.get(endpoint);
      if (!source) continue;
      const stat = imageEndpointStat(source.baseUrl);
      stat.failures += 1;
      stat.lastFailureAt = new Date(log.completedAt || log.startedAt || Date.now()).getTime();
      stat.lastError = truncateLogText(log.error?.message || "request failed", 1000);
    }
  }

  const preferred = orderedImageProviderSources()[0];
  if (preferred) config.imageProvider.baseUrl = preferred.baseUrl;
}

async function probeImageEndpointSource(source, { timeoutMs = 12000 } = {}) {
  const started = Date.now();
  try {
    const modelBody = await runCurlModelsRequest(providerUrl(source, "/v1/models"), source.apiKey, timeoutMs);
    if (shouldRequireImageModelInProbe(source) && !modelListContainsModel(modelBody, config.imageModel)) {
      const error = new Error(`${config.imageModel} not listed by endpoint model list`);
      error.status = 422;
      throw error;
    }
    markImageEndpointSuccess(source, Date.now() - started, { activate: false, probe: true });
    return { ok: true, baseUrl: source.baseUrl, ms: Date.now() - started };
  } catch (error) {
    markImageEndpointFailure(source, error, { probe: true });
    return {
      ok: false,
      baseUrl: source.baseUrl,
      error: error?.status ? `${error.status} ${error.message || ""}`.trim() : String(error?.message || error || "request failed")
    };
  }
}

async function probeImageEndpoints({ timeoutMs = 12000, endpointId = "", baseUrl = "", autoActivate = true } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const allSources = imageProviderSources().filter((source) => source.apiKey);
  const sources = allSources.filter((source) => {
    if (endpointId && source.runtimeId !== endpointId) return false;
    if (normalizedBaseUrl && normalizeBaseUrl(source.baseUrl) !== normalizedBaseUrl) return false;
    return true;
  });

  if (!sources.length) {
    if (endpointId || normalizedBaseUrl) {
      const error = new Error("未找到可检测的生图 API 端点，或这个端点缺少 API Key。");
      error.status = 404;
      throw error;
    }
    return imageEndpointHealth();
  }

  await Promise.all(sources.map((source) => probeImageEndpointSource(source, { timeoutMs })));

  if (autoActivate) {
    const preferred = orderedImageProviderSources()[0];
    if (preferred) config.imageProvider.baseUrl = preferred.baseUrl;
    console.log(`[image-provider] active endpoint: ${config.imageProvider.baseUrl}`);
  }
  return imageEndpointHealth();
}

async function refreshImageEndpointSpeeds({ force = false } = {}) {
  if (process.env.IMAGE_ENDPOINT_PRECHECK === "0") return imageEndpointHealth();
  const ttlMs = boundedIntegerEnv(["IMAGE_ENDPOINT_PRECHECK_TTL_SECONDS", "LAOGUI_IMAGE_ENDPOINT_PRECHECK_TTL_SECONDS"], 300, 10, 3600) * 1000;
  const now = Date.now();
  if (!force && lastImageEndpointPrecheckAt && now - lastImageEndpointPrecheckAt < ttlMs) {
    return imageEndpointHealth();
  }
  if (imageEndpointPrecheckPromise) return imageEndpointPrecheckPromise;
  const timeoutMs = Number(process.env.IMAGE_ENDPOINT_PRECHECK_TIMEOUT_MS || 6000);
  imageEndpointPrecheckPromise = (async () => {
    try {
      const health = await probeImageEndpoints({ timeoutMs });
      lastImageEndpointPrecheckAt = Date.now();
      return health;
    } catch (error) {
      console.warn(`[image-provider] pre-generation endpoint probe failed: ${error.message || error}`);
      return imageEndpointHealth();
    } finally {
      imageEndpointPrecheckPromise = null;
    }
  })();
  return imageEndpointPrecheckPromise;
}

async function tryImageProviderPool(run) {
  let lastError;
  const providerAttempts = [];
  const attempts = plannedImageProviderAttempts();
  for (const providerAttempt of attempts) {
    const { source } = providerAttempt;
    const started = Date.now();
    try {
      const result = await run(source);
      const durationMs = Date.now() - started;
      providerAttempts.push({
        endpoint: source.baseUrl,
        status: "success",
        durationMs,
        error: "",
        providerAttempt: providerAttempt.attempt,
        providerMaxAttempts: providerAttempt.maxAttempts,
        costFirst: providerAttempt.costFirst
      });
      markImageEndpointSuccess(source, durationMs);
      if (result && typeof result === "object") {
        result.providerAttempts = providerAttempts;
      }
      return result;
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - started;
      providerAttempts.push({
        endpoint: source.baseUrl,
        status: "failed",
        durationMs,
        error: `${error.status || "ERR"} ${error.message || "unknown error"}`,
        providerAttempt: providerAttempt.attempt,
        providerMaxAttempts: providerAttempt.maxAttempts,
        costFirst: providerAttempt.costFirst
      });
      markImageEndpointFailure(source, error);
      const attemptLabel = providerAttempt.maxAttempts > 1
        ? ` (${providerAttempt.attempt}/${providerAttempt.maxAttempts})`
        : "";
      console.warn(`[image-provider] ${source.baseUrl}${attemptLabel} failed: ${error.status || "ERR"} ${error.message || "unknown error"}`);
      error.providerAttempts = providerAttempts;
      if (!isRetryableImageProviderError(error)) throw error;
    }
  }
  const error = lastError || new Error("No image provider endpoint available");
  error.providerAttempts = providerAttempts;
  throw error;
}

async function runCurlModelsRequest(url, apiKey, timeoutMs) {
  const timeoutSeconds = String(Math.max(5, Math.ceil(timeoutMs / 1000)));
  const statusMarker = "\n__HTTP_STATUS__:";
  const child = spawn("curl", [
    "--http1.1",
    "--silent",
    "--show-error",
    "--max-time",
    timeoutSeconds,
    "--request",
    "GET",
    "--url",
    url,
    "--header",
    `Authorization: Bearer ${apiKey}`,
    "--write-out",
    `${statusMarker}%{http_code}`
  ]);

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  if (exitCode !== 0) throw new Error(stderr || `curl exited with code ${exitCode}`);

  const markerIndex = stdout.lastIndexOf(statusMarker);
  if (markerIndex < 0) throw new Error("endpoint probe returned no HTTP status");

  const rawBody = stdout.slice(0, markerIndex);
  const status = Number(stdout.slice(markerIndex + statusMarker.length).trim());
  let body;
  try {
    body = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    body = { raw: rawBody.slice(0, 2000) };
  }

  if (status < 200 || status >= 300) {
    const message = body?.error?.message || body?.message || `endpoint probe failed with HTTP ${status}`;
    const error = new Error(message);
    error.status = status;
    error.details = body;
    throw error;
  }
  return body;
}

async function probeResponsesTextProvider(source, model, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl(source, providerResponsesPath(source)), {
      method: "POST",
      headers: {
        authorization: `Bearer ${source.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({
        model,
        input: "Reply with exactly OK. This is a local API connectivity test.",
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await safeJsonResponse(response);
      const message = errorBody?.error?.message || errorBody?.message || response.statusText || "Responses test failed";
      const error = new Error(message);
      error.status = response.status;
      error.details = errorBody;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("event-stream")) {
      const body = await response.json().catch(() => ({}));
      return findOutputText(body) || body?.output_text || "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        text += parseResponsesTextFromSseFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) text += parseResponsesTextFromSseFrame(buffer);
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function probeProviderConnection(kind, provider, { timeoutMs = 12000 } = {}) {
  const started = Date.now();
  const source = {
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
    responsesPath: provider.responsesPath,
    imageGenerationPath: provider.imageGenerationPath,
    imageEditPath: provider.imageEditPath,
    providerManifest: provider.providerManifest || null,
    kind
  };
  if (!source.baseUrl || !source.apiKey) {
    const error = new Error(kind === "image" ? "请先填写生图 API Base URL 和 Key。" : "请先填写思考 API Base URL 和 Key。");
    error.status = 400;
    throw error;
  }

  try {
    const model = String(provider.model || "").trim();
    const responsesPath = source.responsesPath || providerResponsesPath(source);
    let message = "Responses API 检测成功。";
    let imageBytes = 0;
    let modelListed = null;
    let imageProbeSource = null;

    if (kind === "image") {
      imageProbeSource = {
        ...source,
        responsesPath,
        imageGenerationPath: provider.imageGenerationPath || source.imageGenerationPath || config.imageProvider.imageGenerationPath,
        imageEditPath: provider.imageEditPath || source.imageEditPath || config.imageProvider.imageEditPath,
        providerManifest: provider.providerManifest || source.providerManifest || null,
        keySource: "runtime",
        label: shortRuntimeEndpointLabel(source.baseUrl)
      };
      const generated = config.imageApiMode === "responses"
        ? await openaiResponsesImageStreamFromSource({
            model,
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "Use the image_generation tool to create exactly one tiny clean test image: a simple modern wooden chair on a white background. No text, no watermark."
                  }
                ]
              }
            ],
            tools: [
              {
                type: "image_generation",
                size: "1024x1024",
                quality: "low",
                output_format: "png"
              }
            ]
          }, { timeoutMs, source: imageProbeSource })
        : await openaiCompatibleImagesFromSource({
            prompt: "A tiny clean test image: a simple modern wooden chair on a white background. No text, no watermark.",
            inputImages: [],
            size: "1024x1024",
            quality: "low"
          }, { timeoutMs, source: imageProbeSource });
      imageBytes = generated.buffer?.length || 0;
      message = `${generated.imageApi === "responses" ? "Responses Image Gen" : "Images API"} 检测成功，已返回图片数据 ${formatBytes(imageBytes)}。`;
    } else {
      const text = await probeResponsesTextProvider({ ...source, responsesPath }, model, timeoutMs);
      message = text ? `Responses 文本检测成功：${truncateLogText(text, 80)}` : "Responses 文本检测成功。";
    }

    const result = {
      ok: true,
      kind,
      status: "available",
      baseUrl: source.baseUrl,
      model,
      responsesPath,
      imageGenerationPath: kind === "image" ? providerImageApiPath(imageProbeSource || source, "generation") : "",
      imageEditPath: kind === "image" ? providerImageApiPath(imageProbeSource || source, "edit") : "",
      providerManifestName: kind === "image" ? (imageProbeSource?.providerManifest?.name || "") : "",
      ms: Date.now() - started,
      checkedAt: new Date().toISOString(),
      modelListed,
      imageBytes,
      message
    };
    providerProbeStats[kind] = result;
    if (kind === "image") {
      markImageEndpointSuccess(imageProbeSource || source, result.ms, { activate: false, probe: true });
    }
    return result;
  } catch (error) {
    const result = {
      ok: false,
      kind,
      status: "error",
      baseUrl: source.baseUrl,
      model: String(provider.model || "").trim(),
      responsesPath: source.responsesPath || providerResponsesPath(source),
      ms: Date.now() - started,
      checkedAt: new Date().toISOString(),
      message: error?.status ? `${error.status} ${error.message || ""}`.trim() : String(error?.message || error || "检测失败")
    };
    providerProbeStats[kind] = result;
    if (kind === "image") {
      const imageSource = {
        ...source,
        responsesPath: source.responsesPath || providerResponsesPath(source),
        imageGenerationPath: provider.imageGenerationPath || source.imageGenerationPath || config.imageProvider.imageGenerationPath,
        imageEditPath: provider.imageEditPath || source.imageEditPath || config.imageProvider.imageEditPath,
        providerManifest: provider.providerManifest || source.providerManifest || null,
        keySource: "runtime",
        label: shortRuntimeEndpointLabel(source.baseUrl)
      };
      markImageEndpointFailure(imageSource, error, { probe: true });
    }
    return result;
  }
}

async function openaiChatCompletionStream(payload, { timeoutMs = 180000, provider = "reasoning" } = {}) {
  const source = providerFor(provider);
  if (!source.apiKey) {
    const error = new Error(`Missing ${providerKeyNames(provider)}`);
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl(source, "/v1/chat/completions"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${source.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const errorBody = await safeJsonResponse(response);
      const message = errorBody?.error?.message || errorBody?.message || response.statusText || "Model request failed";
      const error = new Error(message);
      error.status = response.status;
      error.details = errorBody;
      throw error;
    }

    if (!contentType.includes("event-stream")) {
      const body = await response.json();
      return body?.choices?.[0]?.message?.content || "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        text += parseSseFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }

    if (buffer.trim()) text += parseSseFrame(buffer);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function openaiResponsesImageStream(payload, { timeoutMs = 420000, provider = "image" } = {}) {
  const source = providerFor(provider);
  return openaiResponsesImageStreamFromSource(payload, { timeoutMs, source });
}

async function openaiResponsesImageStreamWithProviderPool(payload, { timeoutMs = 420000, provider = "image" } = {}) {
  if (provider !== "image") return openaiResponsesImageStream(payload, { timeoutMs, provider });
  return tryImageProviderPool((source) => openaiResponsesImageStreamFromSource(payload, { timeoutMs, source }));
}

async function openaiResponsesImageStreamFromSource(payload, { timeoutMs = 420000, source } = {}) {
  if (!source.apiKey) {
    const error = new Error("Missing image provider API key");
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl(source, providerResponsesPath(source)), {
      method: "POST",
      headers: {
        authorization: `Bearer ${source.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await safeJsonResponse(response);
      const message = errorBody?.error?.message || errorBody?.message || response.statusText || "Model request failed";
      const error = new Error(message);
      error.status = response.status;
      error.details = errorBody;
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let imageB64 = "";
    let text = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        imageB64 = imageB64 || parseImageFromSseFrame(frame);
        text += parseResponsesTextFromSseFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }

    if (buffer.trim()) {
      imageB64 = imageB64 || parseImageFromSseFrame(buffer);
      text += parseResponsesTextFromSseFrame(buffer);
    }
    if (!imageB64) throw new Error("Responses image_generation returned no image data");
    return {
      buffer: Buffer.from(stripDataUrlPrefix(imageB64), "base64"),
      thinking: text.trim(),
      imageApi: "responses",
      actualParams: pickActualImageParams(Array.isArray(payload.tools) ? payload.tools[0] : null)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function openaiResponsesTextStream(payload, { timeoutMs = 240000, provider = "reasoning" } = {}) {
  const source = providerFor(provider);
  if (!source.apiKey) {
    const error = new Error(`Missing ${providerKeyNames(provider)}`);
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl(source, providerResponsesPath(source)), {
      method: "POST",
      headers: {
        authorization: `Bearer ${source.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await safeJsonResponse(response);
      const message = errorBody?.error?.message || errorBody?.message || response.statusText || "Model request failed";
      const error = new Error(message);
      error.status = response.status;
      error.details = errorBody;
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        text += parseResponsesTextFromSseFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }

    if (buffer.trim()) text += parseResponsesTextFromSseFrame(buffer);
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function openaiResponsesImageDirect({ prompt, inputImages, size, quality, useProviderPool = true }) {
  const content = [
    {
      type: "input_text",
      text: [
        "Use the image_generation tool to create exactly one finished image from this production prompt.",
        "Do not answer with text only. The image result is required.",
        prompt
      ].join("\n\n")
    },
    ...inputImages.map((image) => ({
      type: "input_image",
      image_url: image.dataUrl
    }))
  ];
  const payload = {
    model: config.reasoningModel,
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        size,
        quality: normalizeImageToolQuality(quality),
        output_format: "png"
      }
    ]
  };
  if (useProviderPool) {
    return openaiResponsesImageStreamWithProviderPool(payload, { timeoutMs: 420000, provider: "image" });
  }
  return openaiResponsesImageStreamFromSource(payload, {
    timeoutMs: 420000,
    source: activeImageProviderSource()
  });
}

function normalizeImageToolQuality(quality) {
  return ["low", "medium", "high", "auto"].includes(String(quality || "").trim())
    ? String(quality).trim()
    : "auto";
}

function imageGenSkillMaxAttempts() {
  return boundedIntegerEnv(["IMAGE_GEN_SKILL_MAX_ATTEMPTS", "IMAGEGEN_SKILL_MAX_ATTEMPTS"], 2, 1, 20);
}

const PROMPT_REWRITE_GUARD_PREFIX = "Use the following text as the complete prompt. Do not rewrite it:";

function imagePromptWithRewriteGuard(prompt) {
  const text = String(prompt || "").trim();
  return text.startsWith(PROMPT_REWRITE_GUARD_PREFIX)
    ? text
    : `${PROMPT_REWRITE_GUARD_PREFIX}\n${text}`;
}

function providerImageApiPath(source, kind = "generation") {
  const manifestPath = kind === "edit"
    ? source.providerManifest?.editSubmit?.path
    : source.providerManifest?.submit?.path;
  if (manifestPath) return normalizeProviderApiPath(manifestPath, kind === "edit" ? "/v1/images/edits" : "/v1/images/generations");

  const configured = kind === "edit"
    ? (source.imageEditPath || process.env.IMAGE_EDITS_PATH || process.env.IMAGE_EDIT_PATH)
    : (source.imageGenerationPath || process.env.IMAGE_GENERATIONS_PATH || process.env.IMAGE_GENERATION_PATH);
  const fallback = kind === "edit" ? "/v1/images/edits" : "/v1/images/generations";
  return normalizeProviderApiPath(configured, fallback);
}

function appendQuery(pathname, query) {
  if (!query || !Object.keys(query).length) return pathname;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, value);
  return `${pathname}${pathname.includes("?") ? "&" : "?"}${params.toString()}`;
}

function getByPath(source, pathValue) {
  if (!pathValue) return source;
  return String(pathValue).split(".").filter(Boolean).reduce((current, key) => {
    if (current == null) return undefined;
    if (/^\d+$/.test(key) && Array.isArray(current)) return current[Number(key)];
    if (typeof current === "object") return current[key];
    return undefined;
  }, source);
}

function getAllByPath(source, pathValue) {
  if (!pathValue) return [source];
  let current = [source];
  for (const key of String(pathValue).split(".").filter(Boolean)) {
    const next = [];
    for (const item of current) {
      if (item == null) continue;
      if (key === "*") {
        if (Array.isArray(item)) next.push(...item);
        else if (typeof item === "object") next.push(...Object.values(item));
        continue;
      }
      if (/^\d+$/.test(key) && Array.isArray(item)) {
        next.push(item[Number(key)]);
        continue;
      }
      if (typeof item === "object") next.push(item[key]);
    }
    current = next;
  }
  return current.flatMap((item) => Array.isArray(item) ? item : [item]).filter((item) => item != null);
}

function resolveTemplateValue(value, context) {
  if (typeof value === "string" && value.startsWith("$")) return getByPath(context, value.slice(1));
  if (Array.isArray(value)) {
    return value
      .map((item) => resolveTemplateValue(item, context))
      .filter((item) => item !== undefined && item !== null && (!Array.isArray(item) || item.length > 0));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, resolveTemplateValue(item, context)])
      .filter(([, item]) => item !== undefined && item !== null && (!Array.isArray(item) || item.length > 0));
    return Object.fromEntries(entries);
  }
  return value;
}

function renderManifestQuery(query, context) {
  if (!query) return undefined;
  const entries = Object.entries(query)
    .map(([key, value]) => [key, resolveTemplateValue(value, context)])
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([key, value]) => [key, String(value)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function imageApiRequestContext({ prompt, inputImages = [], size, quality, outputFormat = "png", n = 1 }, source) {
  return {
    profile: {
      model: config.imageModel,
      baseUrl: source.baseUrl,
      provider: source.kind || "custom"
    },
    prompt: imagePromptWithRewriteGuard(prompt),
    params: {
      size,
      quality: normalizeImageToolQuality(quality),
      output_format: outputFormat,
      output_compression: null,
      moderation: "auto",
      n
    },
    inputImages: {
      dataUrls: inputImages.map((image) => image.dataUrl).filter(Boolean),
      count: inputImages.filter((image) => image?.dataUrl).length
    },
    mask: {
      dataUrl: ""
    }
  };
}

async function createManifestMultipartBody(mapping, context) {
  const formData = new FormData();
  const body = resolveTemplateValue(mapping.body || {}, context);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, String(item));
      } else {
        formData.append(key, String(value));
      }
    }
  }

  const inputDataUrls = context.inputImages?.dataUrls || [];
  for (const file of mapping.files || []) {
    if (file.source === "inputImages") {
      for (let index = 0; index < inputDataUrls.length; index += 1) {
        const blob = imageDataUrlToBlob(inputDataUrls[index]);
        const ext = imageExtensionFromMime(blob.type);
        formData.append(file.field, blob, `input-${index + 1}.${ext}`);
      }
    } else if (file.source === "mask" && context.mask?.dataUrl) {
      const blob = imageDataUrlToBlob(context.mask.dataUrl);
      formData.append(file.field, blob, "mask.png");
    }
  }
  return formData;
}

async function fetchImageApiJson({ source, mapping, context, timeoutMs, defaultPayload = null, defaultPath = "" }) {
  if (!source.apiKey) {
    const error = new Error("Missing image provider API key");
    error.status = 503;
    throw error;
  }

  const method = normalizeRequestMethod(mapping?.method, "POST");
  const contentType = normalizeContentType(mapping?.contentType, "json");
  const pathname = appendQuery(
    normalizeProviderApiPath(mapping?.path, defaultPath || providerImageApiPath(source, "generation")),
    renderManifestQuery(mapping?.query, context)
  );
  const headers = { authorization: `Bearer ${source.apiKey}` };
  let body;
  if (method !== "GET") {
    if (contentType === "multipart") {
      body = await createManifestMultipartBody(mapping, context);
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(mapping ? resolveTemplateValue(mapping.body || {}, context) : defaultPayload);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl(source, pathname), {
      method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await safeJsonResponse(response);
      const message = errorBody?.error?.message || errorBody?.message || response.statusText || "Image API request failed";
      const error = new Error(message);
      error.status = response.status;
      error.details = errorBody;
      throw error;
    }
    const payload = await response.json();
    const taskId = mapping?.taskIdPath ? getByPath(payload, mapping.taskIdPath) : "";
    if (taskId && source.providerManifest?.poll) {
      return pollManifestImageTask(source, source.providerManifest.poll, String(taskId), controller.signal);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function manifestTaskState(payload, poll) {
  const status = getByPath(payload, poll.statusPath);
  const value = typeof status === "string" ? status : String(status ?? "");
  if (poll.successValues.includes(value)) return "success";
  if (poll.failureValues.includes(value)) return "failure";
  return "pending";
}

function buildManifestTaskPath(pathname, taskId) {
  return pathname
    .replace(/\{task_id\}/g, encodeURIComponent(taskId))
    .replace(/\{taskId\}/g, encodeURIComponent(taskId));
}

async function pollManifestImageTask(source, poll, taskId, signal) {
  const deadline = Date.now() + 420000;
  let first = true;
  while (Date.now() < deadline) {
    if (!first) await sleep((poll.intervalSeconds || 5) * 1000);
    first = false;
    const pathname = appendQuery(buildManifestTaskPath(poll.path, taskId), poll.query);
    const response = await fetch(providerUrl(source, pathname), {
      method: normalizeRequestMethod(poll.method, "GET"),
      headers: { authorization: `Bearer ${source.apiKey}` },
      cache: "no-store",
      signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || response.statusText || "Image task polling failed");
      error.status = response.status;
      error.details = payload;
      throw error;
    }
    const state = manifestTaskState(payload, poll);
    if (state === "success") return payload;
    if (state === "failure") {
      const detail = poll.errorPath ? getByPath(payload, poll.errorPath) : "";
      const error = new Error(String(detail || "Image task failed"));
      error.status = 502;
      error.details = payload;
      throw error;
    }
  }
  const error = new Error("Image task polling timed out");
  error.status = 504;
  throw error;
}

async function openaiImagesGenerationDirect({ prompt, size, quality }) {
  return openaiCompatibleImagesDirect({ prompt, inputImages: [], size, quality });
}

async function openaiCompatibleImagesDirect({ prompt, inputImages = [], size, quality }) {
  return tryImageProviderPool((source) => openaiCompatibleImagesFromSource({
    prompt,
    inputImages,
    size,
    quality
  }, { timeoutMs: 420000, source }));
}

async function openaiCompatibleImagesFromSource({ prompt, inputImages = [], size, quality }, { timeoutMs = 420000, source } = {}) {
  const validInputImages = inputImages.filter((image) => image?.dataUrl);
  if (validInputImages.length) {
    return openaiImagesEditFromSource({ prompt, inputImages: validInputImages, size, quality }, { timeoutMs, source });
  }

  const context = imageApiRequestContext({ prompt, inputImages: [], size, quality }, source);
  const payload = {
    model: config.imageModel,
    prompt: context.prompt,
    n: 1,
    size,
    quality: context.params.quality,
    moderation: "auto",
    output_format: "png"
  };
  return openaiImagesGenerationFromSource(payload, { timeoutMs, source, context });
}

async function openaiImagesGenerationFromSource(payload, { timeoutMs = 420000, source, context = null } = {}) {
  const mapping = source.providerManifest?.submit || null;
  const body = await fetchImageApiJson({
    source,
    mapping,
    context: context || imageApiRequestContext({
      prompt: payload.prompt,
      inputImages: [],
      size: payload.size,
      quality: payload.quality,
      outputFormat: payload.output_format || "png",
      n: payload.n || 1
    }, source),
    timeoutMs,
    defaultPayload: payload,
    defaultPath: providerImageApiPath(source, "generation")
  });
  const resultMapping = mapping?.taskIdPath && source.providerManifest?.poll ? source.providerManifest.poll.result : mapping?.result;
  const result = await imageResultFromModelBody(body, { source, mapping: resultMapping, fallbackMime: "image/png" });
  return {
    ...result,
    thinking: "",
    imageApi: mapping ? "custom-images" : "images"
  };
}

async function openaiImagesEditFromSource({ prompt, inputImages, size, quality }, { timeoutMs = 420000, source } = {}) {
  const context = imageApiRequestContext({ prompt, inputImages, size, quality }, source);
  const mapping = source.providerManifest?.editSubmit || null;
  const fallbackMapping = mapping || {
    path: providerImageApiPath(source, "edit"),
    method: "POST",
    contentType: "multipart",
    body: defaultImageGenerationBodyTemplate,
    files: defaultImageEditFiles,
    result: defaultImageResultMapping
  };
  const body = await fetchImageApiJson({
    source,
    mapping: fallbackMapping,
    context,
    timeoutMs,
    defaultPath: providerImageApiPath(source, "edit")
  });
  const resultMapping = fallbackMapping.taskIdPath && source.providerManifest?.poll ? source.providerManifest.poll.result : fallbackMapping.result;
  const result = await imageResultFromModelBody(body, { source, mapping: resultMapping, fallbackMime: "image/png" });
  return {
    ...result,
    thinking: "",
    imageApi: mapping ? "custom-images-edit" : "images-edit"
  };
}

function imageDataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) {
    const error = new Error("Invalid image data URL");
    error.status = 400;
    throw error;
  }

  const mime = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const buffer = isBase64
    ? Buffer.from(payload.replace(/\s/g, ""), "base64")
    : Buffer.from(decodeURIComponent(payload));
  return new Blob([buffer], { type: mime });
}

function imageExtensionFromMime(mime = "") {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "png";
}

async function safeJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

async function imageBufferFromModelBody(body) {
  return (await imageResultFromModelBody(body)).buffer;
}

async function imageResultFromModelBody(body, { mapping = null, fallbackMime = "image/png" } = {}) {
  const mappedResult = await mappedImageResultFromBody(body, mapping || defaultImageResultMapping, fallbackMime);
  if (mappedResult) {
    return {
      ...mappedResult,
      revisedPrompt: findRevisedPrompt(body),
      actualParams: mergeActualImageParams(pickActualImageParams(body), pickActualImageParams(firstImageDataItem(body)))
    };
  }

  const imageB64 = findImageString(body);
  if (imageB64) {
    return {
      buffer: bufferFromImageValue(imageB64),
      imageB64: stripDataUrlPrefix(imageB64),
      revisedPrompt: findRevisedPrompt(body),
      actualParams: mergeActualImageParams(pickActualImageParams(body), pickActualImageParams(firstImageDataItem(body)))
    };
  }

  const imageUrl = findImageUrl(body);
  if (imageUrl) {
    return {
      buffer: await downloadImageUrlBuffer(imageUrl),
      imageUrl,
      revisedPrompt: findRevisedPrompt(body),
      actualParams: mergeActualImageParams(pickActualImageParams(body), pickActualImageParams(firstImageDataItem(body)))
    };
  }

  throw new Error("Image model returned no image data");
}

async function mappedImageResultFromBody(body, mapping, fallbackMime) {
  for (const pathValue of mapping?.b64JsonPaths || []) {
    for (const value of getAllByPath(body, pathValue)) {
      if (typeof value === "string" && value.trim()) {
        return {
          buffer: bufferFromImageValue(value, fallbackMime),
          imageB64: stripDataUrlPrefix(value)
        };
      }
    }
  }

  for (const pathValue of mapping?.imageUrlPaths || []) {
    for (const value of getAllByPath(body, pathValue)) {
      if (typeof value === "string" && value.trim()) {
        if (value.startsWith("data:")) {
          return {
            buffer: bufferFromImageValue(value, fallbackMime),
            imageUrl: value
          };
        }
        if (/^https?:\/\//i.test(value)) {
          return {
            buffer: await downloadImageUrlBuffer(value),
            imageUrl: value
          };
        }
      }
    }
  }
  return null;
}

function bufferFromImageValue(value, fallbackMime = "image/png") {
  const text = String(value || "");
  if (!text.startsWith("data:")) return Buffer.from(stripDataUrlPrefix(text), "base64");
  const match = text.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return Buffer.from(stripDataUrlPrefix(text), "base64");
  const payload = match[3] || "";
  if (match[2]) return Buffer.from(payload.replace(/\s/g, ""), "base64");
  return Buffer.from(decodeURIComponent(payload));
}

async function downloadImageUrlBuffer(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Image URL download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function firstImageDataItem(body) {
  if (Array.isArray(body?.data) && body.data.length) return body.data[0];
  if (Array.isArray(body?.output)) return body.output.find((item) => item?.type === "image_generation_call") || null;
  return null;
}

function pickActualImageParams(source) {
  if (!source || typeof source !== "object") return undefined;
  const record = source;
  const actual = {};
  if (typeof record.size === "string") actual.size = record.size;
  if (["auto", "low", "medium", "high"].includes(record.quality)) actual.quality = record.quality;
  if (["png", "jpeg", "webp"].includes(record.output_format)) actual.output_format = record.output_format;
  if (typeof record.output_compression === "number") actual.output_compression = record.output_compression;
  if (["auto", "low"].includes(record.moderation)) actual.moderation = record.moderation;
  if (typeof record.n === "number") actual.n = record.n;
  return Object.keys(actual).length ? actual : undefined;
}

function mergeActualImageParams(...sources) {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length));
  return Object.keys(merged).length ? merged : undefined;
}

function findRevisedPrompt(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRevisedPrompt(item);
      if (found) return found;
    }
    return "";
  }
  if (typeof value.revised_prompt === "string" && value.revised_prompt.trim()) return value.revised_prompt.trim();
  if (typeof value.revisedPrompt === "string" && value.revisedPrompt.trim()) return value.revisedPrompt.trim();
  for (const item of Object.values(value)) {
    const found = findRevisedPrompt(item);
    if (found) return found;
  }
  return "";
}

function parseImageFromSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data || data === "[DONE]") return "";
  try {
    const event = JSON.parse(data);
    return findImageString(event);
  } catch {
    return "";
  }
}

function findImageString(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageString(item);
      if (found) return found;
    }
    return "";
  }

  for (const [key, item] of Object.entries(value)) {
    if (["b64_json", "image", "partial_image_b64", "result"].includes(key) && typeof item === "string" && item.length > 1000) {
      return item;
    }
    const found = findImageString(item);
    if (found) return found;
  }
  return "";
}

function findImageUrl(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item);
      if (found) return found;
    }
    return "";
  }

  for (const [key, item] of Object.entries(value)) {
    if (key === "url" && typeof item === "string" && /^https?:\/\//.test(item)) return item;
    const found = findImageUrl(item);
    if (found) return found;
  }
  return "";
}

function parseResponsesTextFromSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data || data === "[DONE]") return "";
  try {
    const event = JSON.parse(data);
    if (typeof event.delta === "string") return event.delta;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") return event.delta;
    return findOutputText(event);
  } catch {
    return "";
  }
}

function findOutputText(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(findOutputText).join("");
  if (value.type === "output_text" && typeof value.text === "string") return value.text;
  let text = "";
  for (const item of Object.values(value)) text += findOutputText(item);
  return text;
}

function stripDataUrlPrefix(value) {
  return String(value).startsWith("data:image") && String(value).includes(",")
    ? String(value).split(",", 2)[1]
    : String(value);
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data || data === "[DONE]") return "";
  try {
    const event = JSON.parse(data);
    const choice = event?.choices?.[0];
    return choice?.delta?.content || choice?.message?.content || "";
  } catch {
    return "";
  }
}

function briefDeliveryContext(brief = {}) {
  const parts = [
    brief.projectStage ? `Project stage: ${brief.projectStage}` : "",
    brief.deliveryPurpose ? `Delivery purpose: ${brief.deliveryPurpose}` : "",
    brief.reviewAudience ? `Review audience: ${brief.reviewAudience}` : "",
    brief.preserveNotes ? `Must preserve: ${brief.preserveNotes}` : "",
    brief.constraints ? `Constraints: ${brief.constraints}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : "No extra delivery metadata provided.";
}

async function createDesignPlan(brief) {
  const system = [
    "You are a senior creative director for architecture, interiors, retail, hospitality, exhibition and residential space design.",
    "Use gpt-5.5 level reasoning to turn a designer brief into practical creative directions.",
    "Think like a working designer: first diagnose site and user intent, then set spatial order, then compose material, lighting, camera and atmosphere, then run an aesthetic critique before finalizing.",
    designerAgentAestheticRubric(),
    "Return valid JSON only. No markdown. No explanatory wrapper.",
    "Write in concise professional Chinese.",
    "Every visual direction must be buildable as a spatial concept, not only a decorative style.",
    "Avoid copying named living designers. Avoid fake certainty about codes, budget or engineering feasibility."
  ].join(" ");

  const user = {
    task: "Generate a first-round concept board plan for a spatial design creative platform.",
    brief,
    delivery_context: briefDeliveryContext(brief),
    required_schema: {
      project_title: "string",
      project_summary: "string",
      design_read: "string",
      directions: [
        {
          id: "string, short slug",
          name: "string",
          concept: "string",
          spatial_strategy: "string",
          plan_moves: ["string"],
          palette: [
            { name: "string", hex: "string" }
          ],
          materials: ["string"],
          lighting: "string",
          signature_moments: ["string"],
          image_prompt: "English prompt for gpt-image-2, 9:16 editorial architecture/interior concept image, no brand logos, no text",
          client_pitch: "string",
          risks: ["string"]
        }
      ],
      proposal_sections: ["string"],
      next_questions: ["string"]
    },
    constraints: [
      "Return exactly 3 design directions.",
      "Each direction must include 4-6 plan_moves and 4-6 materials.",
      "Each image_prompt must describe architecture, layout, materials, camera, lighting and atmosphere.",
      "Reflect projectStage, deliveryPurpose and reviewAudience in design_read, client_pitch and proposal_sections.",
      "Treat preserveNotes and constraints as design invariants before style language; surface related tradeoffs in risks.",
      "Use realistic materials and spatial vocabulary.",
      "Every direction must pass the designer aesthetic rubric: clear spatial order, proportion, material authenticity, lighting hierarchy, restrained palette, focal point, negative space, contextual fit and feasibility.",
      "Avoid generic showroom looks, random decoration, impossible materials, cluttered styling and one-note color palettes."
    ]
  };

  const payload = {
    model: config.reasoningModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user, null, 2) }
    ],
    response_format: { type: "json_object" },
    temperature: 0.45,
    max_completion_tokens: 3600
  };

  let result;
  let text = "";
  try {
    text = await openaiChatCompletionStream(payload, { timeoutMs: 240000 });
  } catch (error) {
    if (error.status !== 400) throw error;
    const fallback = { ...payload };
    delete fallback.response_format;
    text = await openaiChatCompletionStream(fallback, { timeoutMs: 240000 });
  }

  const parsed = parseModelJson(text);
  return normalizePlan(parsed, brief);
}

function parseModelJson(text) {
  if (!text.trim()) throw new Error("gpt-5.5 returned an empty planning result");
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonText = extractFirstJsonObject(cleaned);
    if (!jsonText) throw new Error("gpt-5.5 did not return JSON");
    return JSON.parse(jsonText);
  }
}

function extractFirstJsonObject(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function normalizePlan(plan, brief) {
  const directions = Array.isArray(plan.directions) ? plan.directions : [];
  return {
    project_title: String(plan.project_title || brief.projectName || "未命名空间项目"),
    project_summary: String(plan.project_summary || ""),
    design_read: String(plan.design_read || ""),
    directions: directions.slice(0, 3).map((item, index) => ({
      id: slugify(item.id || item.name || `direction-${index + 1}`),
      name: String(item.name || `方向 ${index + 1}`),
      concept: String(item.concept || ""),
      spatial_strategy: String(item.spatial_strategy || ""),
      plan_moves: asStringArray(item.plan_moves).slice(0, 6),
      palette: normalizePalette(item.palette),
      materials: asStringArray(item.materials).slice(0, 8),
      lighting: String(item.lighting || ""),
      signature_moments: asStringArray(item.signature_moments).slice(0, 6),
      image_prompt: String(item.image_prompt || ""),
      client_pitch: String(item.client_pitch || ""),
      risks: asStringArray(item.risks).slice(0, 5),
      image: null
    })),
    proposal_sections: asStringArray(plan.proposal_sections).slice(0, 8),
    next_questions: asStringArray(plan.next_questions).slice(0, 8),
    meta: {
      reasoning_model: config.reasoningModel,
      image_model: config.imageModel,
      created_at: new Date().toISOString()
    }
  };
}

function normalizePalette(palette) {
  if (!Array.isArray(palette)) return [];
  return palette.slice(0, 6).map((item, index) => {
    if (typeof item === "string") {
      return { name: item, hex: fallbackHex(index) };
    }
    return {
      name: String(item?.name || `色彩 ${index + 1}`),
      hex: isHex(item?.hex) ? item.hex : fallbackHex(index)
    };
  });
}

function isHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function fallbackHex(index) {
  return ["#c7b299", "#394047", "#e8e1d4", "#8f6f52", "#d7d9d3", "#1f2933"][index % 6];
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

async function generateImage(body) {
  const direction = body.direction || {};
  const brief = body.brief || {};
  const imagePrompt = String(body.imagePrompt || direction.image_prompt || "").trim();
  if (!imagePrompt) {
    const error = new Error("Missing image prompt");
    error.status = 400;
    throw error;
  }

  const prompt = [
    gptImage2PromptFusionGuide({ mode: "plan-render", referenceCount: 0, references: [] }),
    "",
    architectureInteriorPromptSchema({ mode: "plan-render", brief, intent: imagePrompt, referenceCount: 0, references: [], selection: null }),
    "",
    designerAgentThinkingModel({ mode: "plan-render", brief, intent: imagePrompt, referenceCount: 0, references: [], selection: null }),
    "",
    imagePrompt,
    "",
    "Use case: architecture and spatial design concept visual.",
    `Project context: ${brief.spaceType || "spatial project"}, ${brief.area || ""}, ${brief.location || ""}.`,
    "Output: high-quality editorial architecture/interior concept render, designer presentation quality.",
    "Constraints: no watermarks, no brand logos, no UI overlays, no readable text, no people as the main subject unless needed for scale."
  ].join("\n");

  const generated = await thinkThenGenerateImage({
    prompt,
    inputImages: [],
    size: body.size || "1024x1536",
    quality: body.quality || "low",
    title: direction.name || brief.projectName || "space concept",
    mode: "plan-render",
    useReasoning: body.thinkingEnabled === true
  });

  return saveGeneratedImage({
    buffer: generated.buffer,
    slug: slugify(direction.name || brief.projectName || "space-concept"),
    meta: {
        reasoning_model: generated.reasoningModel || config.reasoningModel,
        image_model: config.imageModel,
        prompt_library_version: promptLibraryVersion,
        source_prompt: prompt,
      prompt: generated.prompt || prompt,
      thinking: generated.thinking,
      direction: direction.name || null,
      created_at: new Date().toISOString()
    },
    extra: {
      prompt: generated.prompt || prompt,
      sourcePrompt: prompt,
      thinking: generated.thinking,
      endpoint: generated.endpoint,
      attempt: generated.attempt,
      attempts: generated.attempts,
      imageApi: generated.imageApi,
      actualParams: generated.actualParams,
      revisedPrompt: generated.revisedPrompt,
      workflowId: body.workflowId || null,
      parentImageId: body.parentImageId || null,
      stepMode: body.stepMode || "plan-render",
      inputImageType: body.inputImageType || null
    }
  });
}

async function renderFromUploadedImages(body) {
  const mode = normalizeRenderMode([
    "custom",
    "plan-axonometric",
    "plan-render",
    "floorplan",
    "viewpoint",
    "photo",
    "whitemodel",
    "sketch",
    "cadrender",
    "upscale",
    "detail",
    "materialreplace",
    "lightingadjust",
    "styletransfer",
    "materialboard",
    "sharpen",
    "outpaint"
  ].includes(body.mode) ? body.mode : "plan-render");
  const brief = body.brief || {};
  const intent = String(body.intent || "").trim();
  const primary = body.primaryImage;
  const references = activeReferenceImagesFromBody(body);

  if (!primary?.dataUrl && mode !== "custom") {
    const error = new Error("Missing primary image");
    error.status = 400;
    throw error;
  }

  const inputCount = (primary?.dataUrl ? 1 : 0) + references.filter((reference) => reference?.dataUrl).length;

  const prompt = buildRenderPrompt({
    mode,
    brief,
    intent,
    selection: body.selection,
    viewpoint: body.viewpoint,
    referenceCount: references.length,
    references
  });

  const generated = await thinkThenGenerateImage({
    prompt,
    inputImages: [
      ...(primary?.dataUrl ? [{ dataUrl: primary.dataUrl, label: firstInputLabel(mode) }] : []),
      ...references.map((reference, index) => ({ dataUrl: reference.dataUrl, label: `reference ${index + 1} (${referenceWeightMeta(reference.weight).label}; ${referenceUsageMeta(reference.usage).label})` }))
    ],
    size: body.size || "1024x1536",
    quality: body.quality || "low",
    title: `${mode} render`,
    mode,
    useReasoning: body.thinkingEnabled === true
  });

  return saveGeneratedImage({
    buffer: generated.buffer,
    slug: `${mode}-${slugify(brief.projectName || "render")}`,
    meta: {
      reasoning_model: generated.reasoningModel || config.reasoningModel,
      image_model: config.imageModel,
      prompt_library_version: promptLibraryVersion,
      mode,
      workflowId: body.workflowId || null,
      parentImageId: body.parentImageId || null,
      stepMode: body.stepMode || mode,
      inputImageType: body.inputImageType || null,
      mode_knowledge: renderModeKnowledge(mode),
      source_prompt: prompt,
      prompt: generated.prompt || prompt,
      thinking: generated.thinking,
      selection: body.selection || null,
      viewpoint: body.viewpoint || null,
      input_count: inputCount,
      created_at: new Date().toISOString()
    },
    extra: {
      prompt: generated.prompt || prompt,
      sourcePrompt: prompt,
      thinking: generated.thinking,
      endpoint: generated.endpoint,
      attempt: generated.attempt,
      attempts: generated.attempts,
      imageApi: generated.imageApi,
      actualParams: generated.actualParams,
      revisedPrompt: generated.revisedPrompt,
      workflowId: body.workflowId || null,
      parentImageId: body.parentImageId || null,
      stepMode: body.stepMode || mode,
      inputImageType: body.inputImageType || null,
      viewpoint: body.viewpoint || null
    }
  });
}

function firstInputLabel(mode) {
  mode = normalizeRenderMode(mode);
  const labels = {
    custom: "optional primary image",
    "plan-axonometric": "black-and-white or colored floor plan hard layout reference",
    "plan-render": "3D floor plan or selected plan-based spatial guide",
    photo: "site photo",
    whitemodel: "white model screenshot",
    sketch: "concept sketch",
    viewpoint: "spatial source image with a marked camera standing point",
    cadrender: "CAD drawing",
    upscale: "image to enhance",
    detail: "image to enrich",
    materialreplace: "image for material replacement",
    lightingadjust: "image for lighting adjustment",
    styletransfer: "image for style transfer",
    materialboard: "source image for material board",
    outpaint: "image to expand"
  };
  return labels[mode] || "primary input image";
}

function reasoningFallbackReason(error) {
  const status = error?.status ? `${error.status} ` : "";
  return truncateLogText(`${status}${error?.message || "reasoning request failed"}`.trim(), 240);
}

function isReasoningFallbackError(error) {
  const status = Number(error?.status || 0);
  const details = error?.details ? JSON.stringify(error.details).slice(0, 1000) : "";
  const message = `${error?.message || ""} ${details}`.toLowerCase();
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  if (!status) return /(abort|timeout|timed out|network|fetch failed|socket|bad gateway|gateway timeout)/.test(message);
  return false;
}

function designSeriesContextText(context = {}) {
  const brief = context.brief || {};
  const analysis = context.analysis || {};
  return [
    brief.projectName,
    brief.spaceType,
    brief.functions,
    brief.style,
    brief.deliveryPurpose,
    brief.reviewAudience,
    brief.location,
    brief.constraints,
    brief.preserveNotes,
    context.intent,
    context.userPrompt,
    analysis.project_type,
    analysis.project_type_key,
    analysis.project_type_visual,
    ...(Array.isArray(analysis.project_type_evidence) ? analysis.project_type_evidence : []),
    ...(Array.isArray(analysis.context_conflicts) ? analysis.context_conflicts : []),
    analysis.title,
    analysis.summary,
    analysis.series_strategy,
    analysis.spatial_sequence,
    ...(Array.isArray(analysis.suggested_outputs) ? analysis.suggested_outputs : []),
    ...(Array.isArray(analysis.reference_read) ? analysis.reference_read.flatMap((item) => [item.observation, item.usable_design_language]) : []),
    ...(Array.isArray(analysis.scene_briefs) ? analysis.scene_briefs.flatMap((scene) => [
      scene.title,
      scene.field_type,
      scene.spatial_role,
      scene.connects_from,
      scene.connects_to,
      scene.camera,
      scene.must_vary,
      scene.forbidden_repetition,
      ...(Array.isArray(scene.must_repeat) ? scene.must_repeat : [])
    ]) : []),
    ...(Array.isArray(analysis.recurring_signatures) ? analysis.recurring_signatures : []),
    ...(Array.isArray(analysis.materials) ? analysis.materials : []),
    ...(Array.isArray(analysis.composition_rules) ? analysis.composition_rules : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function normalizeDesignSeriesProjectTypeKey(value = "") {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  if (/office|workplace|workspace|corporate|办公|办公室|办公空间|企业|工区|工位|开放办公|会议室|董事|专注间|电话间/.test(text)) return "office";
  if (/hospitality|hotel|homestay|guesthouse|guest house|resort|bnb|b&b|民宿|酒店|旅宿|旅馆|宾馆|客房|套房|度假|泡池/.test(text)) return "hospitality";
  if (/food|beverage|restaurant|cafe|coffee|bar|bistro|bakery|tearoom|餐饮|餐厅|咖啡|酒吧|茶饮|茶室|烘焙|面包店/.test(text)) return "foodbeverage";
  if (/retail|shop|store|showroom|display|boutique|pop.?up|零售|店铺|商店|展厅|展示|陈列|品牌空间|体验店/.test(text)) return "retail";
  if (/residential|apartment|villa|home|living room|bedroom|kitchen|住宅|公寓|别墅|家装|居住|客厅|卧室|主卧|厨房|书房/.test(text)) return "residential";
  if (/generic|通用/.test(text)) return "generic";
  return "";
}

function designSeriesProjectTypeLabel(key = "generic") {
  const labels = {
    office: "办公/企业接待",
    hospitality: "民宿/酒店/度假住宿",
    foodbeverage: "餐饮/咖啡/酒吧",
    retail: "零售/展厅/品牌空间",
    residential: "住宅/居住空间",
    generic: "通用空间项目"
  };
  return labels[key] || labels.generic;
}

function explicitDesignSeriesProjectType(analysis = {}) {
  const candidates = [
    analysis.project_type_visual,
    analysis.visual_project_type,
    analysis.detected_visual_project_type,
    analysis.dominant_project_type,
    analysis.project_type_key,
    analysis.project_type
  ];
  for (const value of candidates) {
    const key = normalizeDesignSeriesProjectTypeKey(value);
    if (key && key !== "generic") {
      return {
        key,
        label: designSeriesProjectTypeLabel(key),
        score: 120,
        source: value === analysis.project_type ? "analysis" : "visual-analysis"
      };
    }
  }
  return null;
}

function detectDesignSeriesProjectType(context = {}) {
  const explicit = explicitDesignSeriesProjectType(context.analysis || context);
  if (explicit) return explicit;
  const text = designSeriesContextText(context);
  const hasOfficeProgramCue = [
    "办公空间", "办公室", "开放办公", "办公大堂", "企业大堂", "企业接待", "企业展厅", "工区", "工位", "办公桌", "会议室", "会议桌", "洽谈室", "董事办公室", "总裁办公室", "专注间", "电话间", "茶水间",
    "office", "workplace", "workspace", "workstation", "workstations", "desk", "desks", "task chair", "conference room", "meeting room", "boardroom", "pantry"
  ].some((keyword) => text.includes(keyword.toLowerCase()));
  const hasHospitalityProgramCue = [
    "民宿", "酒店", "旅宿", "旅馆", "宾馆", "客房", "套房", "度假村", "泡池",
    "hotel", "resort", "homestay", "guesthouse", "hospitality", "guestroom", "bedroom suite", "bnb", "b&b"
  ].some((keyword) => text.includes(keyword.toLowerCase()));
  if (hasOfficeProgramCue && !hasHospitalityProgramCue) {
    return { key: "office", label: "办公/企业接待", score: 99 };
  }
  const definitions = [
    {
      key: "office",
      label: "办公/企业接待",
      keywords: ["办公", "办公空间", "办公室", "企业", "会议", "会议室", "会议桌", "工区", "工位", "办公桌", "开放办公", "前厅", "前台", "接待区", "企业接待", "董事", "茶水间", "洽谈", "专注间", "电话间", "workplace", "office", "workspace", "workstation", "desk", "conference", "meeting", "reception", "pantry", "focus room"]
    },
    {
      key: "hospitality",
      label: "民宿/酒店/度假住宿",
      keywords: ["民宿", "酒店", "旅宿", "旅馆", "宾馆", "客房", "套房", "酒店大堂", "民宿大堂", "接待大堂", "度假", "度假村", "主卧", "泡池", "hotel", "resort", "homestay", "guesthouse", "hospitality", "guestroom", "suite", "bnb", "b&b"]
    },
    {
      key: "foodbeverage",
      label: "餐饮/咖啡/酒吧",
      keywords: ["咖啡", "餐厅", "餐饮", "酒吧", "茶饮", "茶室", "烘焙", "面包店", "小酒馆", "餐吧", "cafe", "coffee", "restaurant", "bar", "bistro", "bakery", "tearoom"]
    },
    {
      key: "retail",
      label: "零售/展厅/品牌空间",
      keywords: ["零售", "店铺", "商店", "买手店", "展厅", "展示", "陈列", "快闪", "品牌空间", "体验店", "retail", "shop", "store", "showroom", "display", "boutique", "pop-up"]
    },
    {
      key: "residential",
      label: "住宅/居住空间",
      keywords: ["住宅", "公寓", "别墅", "家装", "居住", "客厅", "餐厨", "厨房", "卧室", "主卧", "书房", "阳台", "residential", "apartment", "villa", "home", "living room", "bedroom", "kitchen"]
    }
  ];
  let best = { key: "generic", label: designSeriesProjectTypeLabel("generic"), score: 0 };
  for (const definition of definitions) {
    const score = definition.keywords.reduce((total, keyword) => total + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { key: definition.key, label: definition.label, score };
  }
  return best;
}

function designSeriesPlanCount(count = 4) {
  const numeric = Math.max(1, Math.min(8, Number(count) || 4));
  if (numeric >= 7) return 8;
  if (numeric >= 5) return 6;
  return 4;
}

function designSeriesRole(title, fieldType, spatialRole, connectsFrom, connectsTo, camera, mustVary, forbiddenRepetition = "") {
  return {
    title,
    field_type: fieldType,
    spatial_role: spatialRole,
    connects_from: connectsFrom,
    connects_to: connectsTo,
    camera,
    must_vary: mustVary,
    forbidden_repetition: forbiddenRepetition || "Do not repeat the same room type, same camera position, same hero composition, same furniture grouping or same single-angle style variation from other outputs."
  };
}

function designSeriesSceneAllocationText(count = 4, context = {}) {
  const detected = detectDesignSeriesProjectType(context);
  const requestedCount = Math.max(1, Math.min(8, Number(count) || 4));
  const roles = defaultDesignSeriesSceneRoles(count, context).slice(0, requestedCount);
  const typeGuard = designSeriesProjectTypeGuard(detected);
  return [
    `Detected project type: ${detected.label}.`,
    typeGuard,
    "Project inference rule: infer a complete spatial project from one or more references, then allocate the requested number of images to the strongest rooms/functions in that project. Do not make isolated same-room style variations.",
    "Reference DNA rule: precisely extract visible brand cues, color system, material family, spatial organization, lighting atmosphere, composition rhythm, furniture/workstation language and crafted details from the references.",
    "UI settings rule: output count, aspect ratio, image size/resolution and quality are controlled by the current UI/API request. Do not override them with horizontal, 4:3, 4K or any fixed count unless the user explicitly set those values.",
    "Universal hard rule: all generated images must be empty architecture/interior spaces with no people, no human figures, no staff, no guests, no silhouettes, no hands, no faces, no crowds, no animals and no pets.",
    `Requested output count: ${requestedCount}.`,
    `Locked scene schedule: ${roles.map((role, index) => `${index + 1}. ${role.title} [${role.field_type}] - ${role.spatial_role}`).join(" | ")}.`,
    "If the user explicitly names required rooms, cover those rooms first while keeping every image a unique scene role.",
    "For office/workplace/corporate projects, prioritize reception, open workspace, collaboration/project discussion, meeting/boardroom, private office/focus room, pantry/lounge, corridor/support and material/detail scenes depending on count. Never add bedrooms, guestrooms, beds, hotel suites, bath/spa/pool or homestay rooms to an office series.",
    "For hospitality/homestay/hotel projects only, prioritize a balanced package that can include lobby/arrival, public living/lounge, master guestroom/suite, work/reading/activity area, dining/bar/tea area, bath/spa/support, courtyard/exterior and crafted detail depending on count."
  ].join("\n");
}

function designSeriesProjectTypeGuard(projectType = {}) {
  const key = projectType.key || "generic";
  if (key === "office") {
    return [
      "PROJECT_TYPE_LOCK: office/workplace/corporate interior.",
      "Visual evidence override: if the uploaded reference image shows desks, workstations, task chairs, conference tables, office partitions, corporate reception, meeting rooms, collaboration areas, pantry or workplace lighting, classify it as office even if it also has warm lounge materials.",
      "Office forbidden content: bedroom, master bedroom, guestroom, guest suite, bed, bedside table, hotel room, homestay room, bathtub, spa, pool, resort bath, residential kitchen or private home living room.",
      "Allowed office spaces: corporate reception/front desk, open workspace, collaboration area, project discussion zone, meeting room, boardroom, executive/private office, focus room, phone booth, pantry/tea point, lounge breakout, corridor, material/detail node.",
      "No people or animals: show the office space empty and ready for use; no employees, clients, silhouettes, bodies, faces, hands, crowd, animals or pets."
    ].join(" ");
  }
  if (key === "hospitality") {
    return [
      "PROJECT_TYPE_LOCK: hospitality/homestay/hotel.",
      "Visual evidence override: if the uploaded references show guestrooms, beds, bedside lighting, hotel/homestay lobby, resort lounge, reception for guests, courtyard arrival, bath/spa/soaking tub, breakfast/tea/bar amenity or leisure hospitality atmosphere, classify it as hospitality even if a desk, reading table or work corner is visible.",
      "Hospitality forbidden content: corporate office, open workstations, office desk rows, task-chair work area, boardroom, corporate meeting room, executive office, phone booth, company pantry, office reception or workplace planning package.",
      "Allowed hospitality spaces: exterior/arrival, lobby/reception, public guest lounge, tea/dining/bar/breakfast amenity, reading/work activity area for guests, guestroom/suite, bath/spa/support, corridor/stair/detail.",
      "No people or animals in any generated image."
    ].join(" ");
  }
  if (key === "residential") {
    return "PROJECT_TYPE_LOCK: residential/home. Bedroom scenes are allowed only when this type is detected or explicitly requested. No people or animals in any generated image.";
  }
  return "PROJECT_TYPE_LOCK: follow the detected project category and do not borrow room types from unrelated categories. No people or animals in any generated image.";
}

function designSeriesPresetAnalysis(body = {}, references = [], { fallbackReason = "", summary = "" } = {}) {
  const brief = body.brief || {};
  const count = Math.max(1, Math.min(8, Number(body.seriesCount || body.count || 4) || 4));
  const context = { brief, intent: body.intent || "", userPrompt: body.userPrompt || "" };
  const roles = defaultDesignSeriesSceneRoles(count, context).slice(0, count);
  const projectType = detectDesignSeriesProjectType(context);
  const styleHint = [
    brief.style,
    brief.spaceType,
    brief.functions,
    brief.deliveryPurpose,
    body.userPrompt,
    String(body.intent || "").slice(0, 600)
  ].filter(Boolean).join("; ");
  const fallbackPrefix = fallbackReason
    ? "FHL 参考图分析暂时不可用，已自动使用内置设计系列预设继续。"
    : "已关闭思考模式，使用内置设计系列预设直接生成。";

  return normalizeDesignSeriesAnalysis({
    title: fallbackReason ? "预设设计系列（分析降级）" : "预设设计系列",
    summary: summary || `${fallbackPrefix}${fallbackReason ? `原因：${fallbackReason}` : ""}`,
    reference_read: references.map((reference, index) => ({
      index: index + 1,
      observation: `参考图 ${index + 1} 将作为开放视觉证据直接交给 Image Gen 读取。`,
      usable_design_language: "整体提取空间气质、材料家族、灯光层次、构图关系、家具陈列和工艺细节，不预设单一参考角色。"
    })),
    series_strategy: [
      "Use the uploaded references as open visual evidence and create a coherent multi-space design series.",
      `Detected project type: ${projectType.label}. Use a count-aware scene allocation instead of generic same-room variations.`,
      "Infer the whole project from the reference visual DNA: brand cues, color system, material family, lighting atmosphere, composition rhythm, furniture/object language and spatial organization.",
      "Keep one project DNA across all outputs while changing space function, room type, camera angle, viewpoint and focal zone.",
      "Do not lock aspect ratio, resolution, quality or image count in the prompt; those come from the user's current generation settings.",
      styleHint ? `User/style context: ${styleHint}` : ""
    ].filter(Boolean).join(" "),
    project_type: projectType.label,
    project_type_key: projectType.key,
    project_type_visual: "",
    project_type_source: "preset-context",
    project_type_confidence: projectType.score ? Math.min(0.92, 0.58 + projectType.score * 0.08) : 0.45,
    project_type_evidence: [
      "思考模式关闭或分析降级时无法单独读取图像语义，按当前文字上下文和内置项目类型词表锁定。",
      "生成阶段仍会把参考图作为视觉证据交给 Image Gen，并使用项目类型禁区防止办公/酒店串类。"
    ],
    context_conflicts: [],
    scene_allocation_strategy: designSeriesSceneAllocationText(count, context),
    suggested_outputs: roles.map((role) => role.title),
    project_dna: "same project identity, same material family, same lighting philosophy, same furniture era, same craft/detail logic and same render finish",
    spatial_sequence: roles.map((role) => role.title).join(" -> "),
    continuity_rules: [
      "repeat key wall, floor, ceiling or display materials across adjacent spaces",
      "maintain compatible openings, thresholds, corridor/stair logic and spatial scale",
      "keep the same color grading, exposure, lighting temperature and shadow softness",
      "vary function and camera while preserving project budget level, furniture era and design team language",
      "include at least one visual cue in every image that links it to the rest of the series",
      "keep every image unoccupied, with no people, human body parts, animals or pets"
    ],
    recurring_signatures: [
      "shared material palette and tactile texture",
      "repeated lighting fixture or hidden-light detail",
      "consistent furniture and object scale",
      "compatible arches, openings, shelving, wall niches, wood/stone/plaster or other reference-derived craft motifs"
    ],
    scene_briefs: roles.map((role, index) => ({
      ...role,
      index: index + 1,
      title: role.title,
      must_repeat: [
        "same material family",
        "same lighting philosophy",
        "same furniture/object era",
        "same render finish"
      ],
      forbidden_repetition: role.forbidden_repetition || "do not repeat the same room, same camera position, same hero composition or same primary furniture grouping"
    })),
    palette: ["reference-led warm neutrals", "natural material tones", "soft shadow gradients", "restrained accent colors"],
    materials: ["reference-derived wall finish", "natural wood or timber", "stone or textured mineral surface", "woven or tactile soft goods", "ceramic/object display details", "warm integrated lighting"],
    composition_rules: [
      "one clear spatial role per image",
      "different camera axis across the series",
      "foreground/midground/background depth",
      "no collage and no repeated same-angle hero view"
    ],
    image_prompt: "Create one finished architecture/interior render belonging to a coherent design series derived from the uploaded references; unified project DNA, material family, lighting logic, palette and render finish; distinct space, function, viewpoint and camera for this image.",
    analysis_backend: fallbackReason ? "preset-fallback" : "preset",
    fallback_reason: fallbackReason,
    fallback: Boolean(fallbackReason)
  }, references);
}

function enforceDesignSeriesProjectType(analysis = {}, context = {}) {
  const detected = detectDesignSeriesProjectType({ ...context, analysis });
  const count = designSeriesRequestedCount(context.seriesCount || context.count || analysis.scene_briefs?.length || 4);
  const sceneTexts = Array.isArray(analysis.scene_briefs)
    ? analysis.scene_briefs.map((scene) => [
        scene.title,
        scene.field_type,
        scene.spatial_role,
        scene.connects_from,
        scene.connects_to,
        scene.camera,
        scene.must_vary,
        scene.forbidden_repetition,
        ...(Array.isArray(scene.must_repeat) ? scene.must_repeat : [])
      ].filter(Boolean).join(" ").toLowerCase())
    : [];
  const duplicateFields = sceneTexts.some((text, index) => text && sceneTexts.indexOf(text) !== index);
  const missingFields = sceneTexts.length < count;
  const forbiddenByType = {
    office: /卧室|主卧|客房|套房|酒店房|民宿房|床|床头|卫浴|浴缸|泡池|spa|resort|hotel room|guestroom|suite|bedroom|bathtub|bath|pool|homestay/i,
    hospitality: /开放工区|工位|工位区|办公桌排|企业前台|企业接待|董事办公室|总裁办公室|专注间|电话间|boardroom|corporate office|open workspace|workstations|task chairs|office desk rows|executive office|phone booth|workplace planning/i,
    residential: /开放工区|工位|企业前台|酒店大堂|民宿大堂|客房套房|泡池|boardroom|corporate office|open workspace|workstations|hotel lobby|guestroom suite/i,
    foodbeverage: /卧室|主卧|客房|套房|开放工区|工位|董事办公室|bedroom|guestroom|suite|open workspace|workstations|executive office/i,
    retail: /卧室|主卧|客房|套房|开放工区|工位|酒店套房|bedroom|guestroom|suite|open workspace|workstations/i
  };
  const normalizedAnalysisKey = normalizeDesignSeriesProjectTypeKey(analysis.project_type);
  const analysisConflict = normalizedAnalysisKey
    && detected.key !== "generic"
    && normalizedAnalysisKey !== detected.key;
  const hasForbiddenScenes = Boolean(forbiddenByType[detected.key])
    && sceneTexts.some((text) => forbiddenByType[detected.key].test(text));
  const needsOverride = detected.key !== "generic"
    && (analysisConflict || missingFields || duplicateFields || hasForbiddenScenes);
  const lockedAnalysis = {
    ...analysis,
    project_type: detected.label,
    project_type_key: detected.key,
    project_type_source: detected.source || analysis.project_type_source || "context-detection"
  };
  if (!needsOverride) {
    const roles = defaultDesignSeriesSceneRoles(count, { ...context, analysis: lockedAnalysis }).slice(0, count);
    return {
      ...lockedAnalysis,
      scene_allocation_strategy: analysis.scene_allocation_strategy || designSeriesSceneAllocationText(count, { ...context, analysis: lockedAnalysis }),
      suggested_outputs: roles.map((role) => role.title),
      spatial_sequence: roles.map((role) => role.title).join(" -> ")
    };
  }
  const roles = defaultDesignSeriesSceneRoles(count, { ...context, analysis: lockedAnalysis }).slice(0, count);
  return {
    ...lockedAnalysis,
    scene_allocation_strategy: designSeriesSceneAllocationText(count, { ...context, analysis: lockedAnalysis }),
    suggested_outputs: roles.map((role) => role.title),
    spatial_sequence: roles.map((role) => role.title).join(" -> "),
    scene_briefs: roles.map((role, index) => ({
      ...role,
      index: index + 1,
      title: role.title,
      must_repeat: [
        `same ${detected.label} material family`,
        `same ${detected.label} lighting philosophy`,
        "same project furniture/object era",
        "same render finish",
        "no people or animals"
      ],
      forbidden_repetition: [
        role.forbidden_repetition,
        designSeriesProjectTypeGuard(detected)
      ].filter(Boolean).join(" ")
    }))
  };
}

async function analyzeDesignSeriesReferences(body) {
  const references = activeReferenceImagesFromBody(body);
  if (!references.length) {
    const error = new Error("Please upload at least one reference image");
    error.status = 400;
    throw error;
  }

  const content = [
    {
      type: "input_text",
      text: [
        "You are gpt-5.5 acting as a senior architecture and interior creative director.",
        `Selected UI workflow button: ${renderModeKnowledge("designseries").label}.`,
        `Button meaning: ${renderModeKnowledge("designseries").purpose}`,
        "Analyze the uploaded reference images for a spatial designer.",
        "Do not assign fixed roles such as material, furniture, lighting, color or atmosphere to the reference images.",
        "Treat every reference image as a complete open reference. Read spatial language, mood, composition, materials, lighting, object systems and design intent only when they are actually visible and useful.",
        "Then propose a coherent design series that can be generated from these references.",
        "Core goal: stand at project-planning level. From one or more references, infer the likely whole project, then allocate the user-requested number of images to the most useful spaces in that project.",
        "Important: this function is deep one-to-many spatial design generation. It is NOT one camera angle with multiple styles, NOT one hero composition repeated with small variations, and NOT four isolated beautiful images.",
        "Definition of deep design series: one unified design system expanded into multiple fields, multiple camera angles, multiple viewpoints and multiple functional zones.",
        "Unified style means same project DNA, material system, lighting philosophy, furniture era, palette, render quality and design team language. It does not mean same room, same camera, same circular lobby, same sofa scene or same facade repeated.",
        "The output set must read like a connected project walkthrough or professional design package: different spaces/functions/views that belong to the same project.",
        "Reference extraction must be precise: extract visible brand elements, color elements, material system, spatial organization, lighting atmosphere, composition rhythm, furniture/workstation/object language, ceiling/wall/floor logic and crafted details.",
        "Thinking-mode emphasis: when reasoning is enabled, keep more of the original reference visual DNA in the project bible and scene briefs, but still extrapolate new connected spaces instead of copying one angle.",
        "Generation settings rule: do not hardcode horizontal, 4:3, 4K, 8 images or any fixed output setting in the analysis or image prompts. Output count, aspect ratio, size/resolution and quality must follow the current UI/API generation settings.",
        "Project-type classification is mandatory and has two stages.",
        "Stage 1 IMAGE-ONLY CLASSIFICATION: set project_type_visual by looking only at the uploaded reference images. Ignore previous templates, hidden prompts, brief text and user context for this field.",
        "Stage 2 CONTEXT MERGE: set project_type after comparing project_type_visual with the brief/user context. If they conflict, visual evidence wins unless the user explicitly writes a different project type in the latest user prompt.",
        "If references show office/workplace cues such as desk rows, workstations, task chairs, conference tables, glass partitions, corporate reception, meeting rooms, collaboration areas or company pantry, project_type_visual must be office/workplace/corporate, not hospitality.",
        "If references show hotel/homestay/hospitality cues such as guestrooms, beds, bedside lighting, suite layout, guest lobby, resort lounge, courtyard arrival, bath/spa/soaking tub, breakfast/tea/bar amenity or leisure hospitality staging, project_type_visual must be hospitality/homestay/hotel, not office, even if a writing desk or reading/work corner is visible.",
        "If project_type_visual conflicts with stale UI templates or old brief text, list that conflict in context_conflicts and keep scene_briefs aligned to project_type_visual.",
        designSeriesSceneAllocationText(body.seriesCount || body.count || 4, {
          brief: body.brief || {},
          intent: body.intent || "",
          userPrompt: body.userPrompt || ""
        }),
        "Scene allocation rule: use the detected project type and requested output count to choose the strongest set of rooms/functions. Do not leave scene_briefs as generic labels when the project type implies specific spaces.",
        "Unique-scene rule: each scene_brief must represent a different room/function and each scheduled role may appear once only. If image 1 is reception/front desk, no later image may be another reception/front desk. If image 2 is open workspace, no later image may be another open workspace.",
        "Office count schedule rule: for 4 office images use exactly one each from reception, open workspace/collaboration, meeting/focus, pantry/corridor/detail. For 6 office images use exactly one each from reception, open workspace, collaboration/project discussion, meeting, private/focus room, pantry/corridor/detail. For 8 office images use reception, open workspace, collaboration, meeting, private office, focus room, pantry/lounge, corridor/detail.",
        "Occupancy rule: every scene must be unoccupied. Do not include people, staff, guests, clients, workers, silhouettes, body parts, faces, hands, crowds, animals, pets or lifestyle photography staging.",
        "Office hard rule: when project_type is office/workplace/corporate, scene_briefs must not include bedroom, master bedroom, guestroom, suite, hotel room, bath, spa, soaking tub, resort, homestay or residential private rooms. Use reception, open workspace, collaboration, meeting, private office/focus, pantry/lounge, corridor/support and detail instead.",
        "For hotel/homestay/hospitality, a 4-image set should normally cover lobby/arrival, public living/lounge, master guestroom/suite, and a work/tea/dining/detail support scene. A 6-image set should add exterior/arrival and bath/spa/support. An 8-image set should also cover tea/dining/bar and work/reading/activity as separate scenes.",
        "Build a project bible before any image prompt: project DNA, spatial sequence, field/zone list, functional zoning, adjacency between spaces, recurring signatures, material system, lighting philosophy, palette, camera rhythm and render finish.",
        "The scene_briefs must assign truly different spaces/functions/viewpoints to each image and describe how each output connects to the previous/next image, for example exterior/arrival -> entry -> public lounge -> dining/office/retail zone -> suite/quiet room -> bath/corridor -> material detail.",
        "Every scene_brief must have a unique field or functional role. Do not create four versions of the same circular lobby, same sofa area, same bedroom, same facade or same camera position.",
        "If the references show only one room or one angle, extrapolate a full project around that same design DNA: arrival threshold, main shared zone, secondary function, quiet/private/support zone, circulation and detail.",
        designerAgentThinkingModel({
          mode: "designseries",
          brief: body.brief || {},
          intent: body.intent || "",
          referenceCount: references.length,
          references
        }),
        referenceImageReadingProtocol({ references, referenceCount: references.length }),
        promptEngineV2CompactReference("designseries"),
        "Return valid JSON only. No markdown. Write concise professional Chinese.",
        "",
        JSON.stringify({
          brief: body.brief || {},
          user_intent: body.intent || "",
          required_schema: {
            title: "string",
            summary: "string",
            reference_read: [
              {
                index: "number starting at 1",
                observation: "string",
                usable_design_language: "string"
              }
            ],
            series_strategy: "string",
            suggested_outputs: ["4 to 8 strings"],
            project_type: "string, detected project category such as hospitality/residential/office/retail/foodbeverage/generic",
            project_type_key: "one of office/hospitality/residential/retail/foodbeverage/generic",
            project_type_visual: "string, image-only project category based only on uploaded references",
            project_type_source: "string, visual-evidence/context/user-explicit/fallback",
            project_type_confidence: "number from 0 to 1",
            project_type_evidence: ["3 to 6 visible cues from the references that justify project_type_visual"],
            context_conflicts: ["stale template or brief clues that conflict with the image-only classification, empty if none"],
            scene_allocation_strategy: "string, count-aware room/function schedule for the requested output count",
            project_dna: "string describing the shared project identity across every output",
            spatial_sequence: "string describing how spaces connect from exterior/entry/public/private/detail",
            continuity_rules: ["4 to 8 strings for spatial/material/lighting continuity between images"],
            recurring_signatures: ["4 to 8 strings for repeated motifs, materials, forms, objects or lighting gestures"],
            scene_briefs: [
              {
                index: "number starting at 1",
                title: "string",
                field_type: "arrival/public/secondary/private/support/transition/detail or another unique field category",
                spatial_role: "string",
                connects_from: "string",
                connects_to: "string",
                camera: "string",
                must_repeat: ["shared details to repeat from the series DNA"],
                must_vary: "what is different in this image",
                forbidden_repetition: "what this image must not repeat from other scene briefs"
              }
            ],
            palette: ["4 to 6 strings"],
            materials: ["4 to 8 strings"],
            composition_rules: ["3 to 5 strings"],
            image_prompt: "English global project-DNA prompt foundation only; it must not lock the series to one scene, one angle or one function"
          }
        }, null, 2)
      ].join("\n")
    },
    ...references.map((reference) => ({
      type: "input_image",
      image_url: reference.dataUrl
    }))
  ];

  const payload = {
    model: config.reasoningModel,
    input: [{ role: "user", content }],
    max_output_tokens: 3200
  };

  try {
    const text = await openaiResponsesTextStream(payload, { timeoutMs: 240000 });
    const analysis = enforceDesignSeriesProjectType(normalizeDesignSeriesAnalysis(parseModelJson(text), references), {
      brief: body.brief || {},
      intent: body.intent || "",
      userPrompt: body.userPrompt || "",
      seriesCount: body.seriesCount || body.count || 4
    });
    return {
      ...analysis,
      analysis_backend: analysis.analysis_backend || "gpt-5.5"
    };
  } catch (error) {
    if (!isReasoningFallbackError(error)) throw error;
    const reason = reasoningFallbackReason(error);
    console.warn(`[design-series] reference analysis fallback: ${reason}`);
    return designSeriesPresetAnalysis(body, references, { fallbackReason: reason });
  }
}

function normalizeDesignSeriesAnalysis(value, references = []) {
  const referenceRead = Array.isArray(value.reference_read) ? value.reference_read : [];
  const sceneBriefs = Array.isArray(value.scene_briefs) ? value.scene_briefs : [];
  return {
    title: String(value.title || "参考图设计系列"),
    summary: String(value.summary || "已完成参考图识别，并整理为一套设计系列方向。"),
    reference_read: referenceRead.slice(0, references.length || 8).map((item, index) => ({
      index: Number(item.index || index + 1),
      observation: String(item.observation || ""),
      usable_design_language: String(item.usable_design_language || "")
    })),
    series_strategy: String(value.series_strategy || ""),
    suggested_outputs: asStringArray(value.suggested_outputs).slice(0, 8),
    project_dna: String(value.project_dna || ""),
    project_type: String(value.project_type || value.projectType || ""),
    project_type_key: normalizeDesignSeriesProjectTypeKey(value.project_type_key || value.projectTypeKey || value.project_type || value.projectType || value.project_type_visual || value.visual_project_type),
    project_type_visual: String(value.project_type_visual || value.visual_project_type || value.detected_visual_project_type || ""),
    project_type_source: String(value.project_type_source || value.projectTypeSource || ""),
    project_type_confidence: Math.max(0, Math.min(1, Number(value.project_type_confidence ?? value.projectTypeConfidence ?? 0) || 0)),
    project_type_evidence: asStringArray(value.project_type_evidence || value.projectTypeEvidence).slice(0, 8),
    context_conflicts: asStringArray(value.context_conflicts || value.contextConflicts).slice(0, 8),
    scene_allocation_strategy: String(value.scene_allocation_strategy || value.sceneAllocationStrategy || ""),
    spatial_sequence: String(value.spatial_sequence || ""),
    continuity_rules: asStringArray(value.continuity_rules).slice(0, 8),
    recurring_signatures: asStringArray(value.recurring_signatures).slice(0, 8),
    scene_briefs: sceneBriefs.slice(0, 8).map((item, index) => ({
      index: Number(item.index || index + 1),
      title: String(item.title || ""),
      field_type: String(item.field_type || ""),
      spatial_role: String(item.spatial_role || ""),
      connects_from: String(item.connects_from || ""),
      connects_to: String(item.connects_to || ""),
      camera: String(item.camera || ""),
      must_repeat: asStringArray(item.must_repeat).slice(0, 8),
      must_vary: String(item.must_vary || ""),
      forbidden_repetition: String(item.forbidden_repetition || "")
    })),
    palette: asStringArray(value.palette).slice(0, 6),
    materials: asStringArray(value.materials).slice(0, 8),
    composition_rules: asStringArray(value.composition_rules).slice(0, 5),
    image_prompt: String(value.image_prompt || ""),
    analysis_backend: String(value.analysis_backend || value.backend || ""),
    fallback_reason: String(value.fallback_reason || value.fallbackReason || ""),
    fallback: Boolean(value.fallback || value.fallback_reason || value.fallbackReason)
  };
}

function designSeriesRequestedCount(count = 4) {
  return Math.max(1, Math.min(8, Number(count) || 4));
}

function defaultDesignSeriesSceneRoles(count = 4, context = {}) {
  const planCount = designSeriesPlanCount(count);
  const projectType = detectDesignSeriesProjectType(context).key;
  const catalog = {
    hospitality: {
      4: [
        designSeriesRole("大堂/到达接待主视觉", "arrival-lobby", "establish the hospitality arrival experience with reception, threshold, brand memory and first circulation cue", "site approach or entry canopy", "public living lounge", "wide eye-level or slightly wide establishing view; show reception, threshold, seating anchor and route inward", "show the lobby/arrival identity, not another guestroom or generic lounge"),
        designSeriesRole("公共客厅/共享休闲区", "public-lounge", "show the main social living room for guests with the full material, lighting, furniture and hospitality atmosphere at large scale", "lobby or entry threshold", "work/tea/dining zone or guestroom corridor", "wide interior view from a different axis; include sofas/lounge seating, circulation and wall/ceiling/floor system", "show social public life and spatial depth, not another lobby hero"),
        designSeriesRole("主卧/客房套房", "guestroom-suite", "show a private guest suite or master bedroom that inherits the same project DNA at a calmer and more intimate scale", "public lounge through corridor or stair", "bath/support/detail zone", "calm eye-level bedroom/suite view with bed, window/view or sitting corner; no lobby camera repeat", "show private hospitality comfort, not another public seating area"),
        designSeriesRole("工区/茶歇/餐吧或材料节点", "secondary-detail", "show one secondary guest function such as work area, reading room, tea lounge, breakfast bar or a crafted material moment that completes the package", "public lounge or guestroom", "rest of project memory", "mid-wide functional view or close crafted view; emphasize repeated lighting, millwork, stone/wood/plaster junctions", "show a clearly different support function or craft detail")
      ],
      6: [
        designSeriesRole("室外/到达入口", "arrival-exterior", "establish the hotel or homestay from site approach, facade, courtyard gate or entry canopy", "site path or street/courtyard", "lobby reception", "wide exterior or threshold view with clear approach, landscape/context and project identity", "show exterior/threshold language, not an interior room"),
        designSeriesRole("大堂/接待", "lobby-reception", "show the reception lobby as the first interior impression with hospitality operations and brand memory", "entry threshold", "public living lounge", "eye-level wide interior view; reception, waiting seat, lighting hierarchy and circulation must be visible", "show reception/lobby function, not generic living room"),
        designSeriesRole("公共客厅/休闲会客区", "public-lounge", "show the main guest lounge or living room where the design language operates at full public scale", "lobby", "work/tea/dining zone", "wide interior view from a new axis; show lounge furniture grouping, circulation and full material system", "show public social space, not another reception"),
        designSeriesRole("工区/茶室/餐吧/活动区", "secondary-amenity", "show a distinct amenity such as work area, reading lounge, tea room, breakfast bar, dining nook or small event zone", "public lounge", "guestroom/suite corridor", "mid-wide operational view; include work surface/table/bar/display and repeated material cues", "show a specific secondary guest activity, not another sofa lounge"),
        designSeriesRole("主卧/客房套房", "guestroom-suite", "show the private guestroom or master bedroom as a calmer hospitality scale connected to the public areas", "amenity area through corridor/stair", "bath/spa/detail", "calm eye-level suite view with bed, window/view, bedside lighting and sitting detail", "show private comfort and changed scale"),
        designSeriesRole("卫浴/泡池/走廊材料节点", "bath-spa-detail", "show a bath, spa, powder room, corridor threshold or crafted material detail that proves continuity beyond hero spaces", "guestroom/suite", "whole project memory", "controlled framed view or intimate detail; water/stone/plaster/wood/lighting junctions visible", "show support/detail craft, not another bedroom")
      ],
      8: [
        designSeriesRole("外观/场地入口", "arrival-exterior", "show the homestay/hotel arrival from landscape, street, courtyard or facade with project identity", "site context", "entry lobby", "wide exterior/threshold view; reveal facade, approach path and landscape/context", "show exterior arrival language"),
        designSeriesRole("门厅/大堂接待", "entry-lobby", "show the first interior threshold and reception/lobby operation", "entry", "public living lounge", "eye-level arrival view from a new position; reception, waiting point and circulation visible", "show first interior impression"),
        designSeriesRole("公共客厅/共享休闲区", "public-lounge", "show the main guest social room at full public scale", "lobby", "tea/dining/work area", "wide interior view with lounge grouping, circulation, ceiling and wall/floor material system", "show large-scale guest lounge"),
        designSeriesRole("茶室/餐吧/早餐区", "food-tea-amenity", "show the hospitality food, tea, bar or breakfast amenity with operational detail", "public lounge", "work/activity zone or guestroom corridor", "mid-wide activity view with table/bar/counter/service detail and repeated materials", "show dining/tea/bar function"),
        designSeriesRole("工区/阅读/活动区", "work-reading-amenity", "show a guest work area, reading room, small meeting area or activity zone as a different public function", "tea/dining amenity", "guestroom corridor", "mid-wide view from a new axis; desks, reading table, shelving or activity anchor visible", "show work/reading/activity function"),
        designSeriesRole("主卧/客房套房", "guestroom-suite", "show the guestroom or master suite at private scale", "corridor/stair from public areas", "bath/spa/support", "calm eye-level room view with bed, sitting corner, window/view and integrated lighting", "show private room comfort"),
        designSeriesRole("卫浴/泡池/更衣支持空间", "bath-spa-support", "show bath, spa, soaking tub, changing area or refined support room using the same materials", "guestroom/suite", "transition/detail", "controlled support-area view; stone/water/soft light/crafted junctions", "show wet/support spatial language"),
        designSeriesRole("走廊/楼梯/材料节点特写", "transition-detail", "show the connective corridor/stair/threshold or close material junction tying the whole series together", "public and private rooms", "project memory", "linear perspective or intimate close view; repeated lights, openings, handrail, wall/floor junctions visible", "show circulation/craft evidence")
      ]
    },
    residential: {
      4: [
        designSeriesRole("玄关/客厅主视觉", "entry-living", "establish the home identity from entry into the living room", "home entry", "dining/kitchen", "wide eye-level living view with entry cue, seating, storage and main material system", "show public home identity"),
        designSeriesRole("餐厨/家庭活动区", "dining-kitchen", "show dining, kitchen or family activity zone adjacent to the living area", "living room", "master bedroom/study", "mid-wide view with table/island/cabinetry and repeated materials", "show family function, not another sofa view"),
        designSeriesRole("主卧/书房安静区", "private-quiet", "show a private bedroom, master suite or study at a calmer scale", "public zone through corridor", "bath/balcony/detail", "calm eye-level room view with bed/desk/storage/window", "show private scale"),
        designSeriesRole("卫浴/阳台/收纳材料节点", "support-detail", "show support space or crafted detail proving the design system beyond main rooms", "private room", "whole home memory", "controlled support/detail view with lighting and material junctions", "show support/detail function")
      ],
      6: [
        designSeriesRole("玄关/入户收纳", "entry", "establish arrival, storage and first material cue", "building corridor or exterior threshold", "living room", "entry view with cabinet, threshold and lighting cue", "show entry function"),
        designSeriesRole("客厅/家庭核心区", "living-core", "main family living space", "entry", "dining/kitchen", "wide living view with seating, TV/storage or focal wall and circulation", "show living core"),
        designSeriesRole("餐厨/岛台/家庭活动", "dining-kitchen", "dining and kitchen or activity extension", "living room", "study/bedroom corridor", "mid-wide view with dining table/island/cabinetry", "show dining/kitchen function"),
        designSeriesRole("书房/儿童/多功能房", "study-flex", "focused or flexible room using the same design system", "public zone", "master bedroom", "mid-wide room view with desk/shelving/flexible furniture", "show a different room type"),
        designSeriesRole("主卧/套房", "master-bedroom", "private master bedroom or suite", "corridor/flex room", "bath/balcony/detail", "calm eye-level bedroom view", "show private comfort"),
        designSeriesRole("卫浴/阳台/材料节点", "support-detail", "support or close material moment", "master bedroom", "whole home memory", "controlled support/detail view", "show craft/support")
      ],
      8: [
        designSeriesRole("玄关/门厅", "entry", "home arrival and storage logic", "building corridor", "living room", "entry view", "show entry"),
        designSeriesRole("客厅", "living", "main living room", "entry", "dining/kitchen", "wide living view", "show living"),
        designSeriesRole("餐厅", "dining", "dining space", "living", "kitchen", "mid-wide dining view", "show dining"),
        designSeriesRole("厨房/岛台", "kitchen", "kitchen and preparation function", "dining", "study/flex", "operational kitchen view", "show kitchen"),
        designSeriesRole("书房/多功能房", "study-flex", "study or flexible room", "public zone", "bedroom corridor", "desk/shelving view", "show focused function"),
        designSeriesRole("主卧/套房", "master-bedroom", "private bedroom suite", "corridor", "bath", "calm bedroom view", "show private room"),
        designSeriesRole("卫浴/衣帽间", "bath-closet", "support private function", "bedroom", "balcony/detail", "controlled support view", "show support"),
        designSeriesRole("阳台/走廊/材料节点", "transition-detail", "transition or crafted detail", "whole home", "project memory", "linear or close detail view", "show continuity")
      ]
    },
    office: {
      4: [
        designSeriesRole("前台/企业接待", "reception", "establish company arrival and brand identity", "elevator lobby or entry", "open work area", "wide reception view with brand wall implied without readable text", "show reception identity"),
        designSeriesRole("开放工区/协作区", "workspace", "main working area with desks or collaboration setting", "reception", "meeting/focus area", "wide office view with workstation rhythm and circulation", "show work function"),
        designSeriesRole("会议/洽谈/专注空间", "meeting-focus", "secondary focused function with different privacy level", "workspace", "pantry/corridor/detail", "mid-wide meeting or focus room view", "show meeting/focus function"),
        designSeriesRole("茶水/走廊/材料节点", "support-detail", "support or transition space tying office language together", "meeting/workspace", "whole project", "controlled support/detail view", "show support/craft")
      ],
      6: [
        designSeriesRole("入口/前台接待", "reception", "office arrival and brand identity", "entry", "open workspace", "wide reception view", "show reception"),
        designSeriesRole("开放工区", "open-workspace", "primary work area", "reception", "collaboration zone", "wide desk rhythm view", "show workstations"),
        designSeriesRole("协作/项目讨论区", "collaboration", "informal teamwork area", "workspace", "meeting room", "mid-wide collaboration view", "show teamwork"),
        designSeriesRole("会议室/洽谈室", "meeting", "formal meeting or client discussion room", "collaboration", "executive/focus/support", "controlled meeting view", "show meeting"),
        designSeriesRole("独立办公室/专注间/电话间", "focus-private", "private focused work scale", "meeting/workspace", "pantry/corridor", "calm smaller room view", "show privacy"),
        designSeriesRole("茶水区/走廊/材料节点", "support-detail", "support or transition detail", "work areas", "project memory", "linear or close detail view", "show continuity")
      ],
      8: [
        designSeriesRole("前台/品牌入口", "reception", "arrival and reception", "entry", "workspace", "wide reception view", "show reception"),
        designSeriesRole("开放工区", "open-workspace", "primary desk area", "reception", "collaboration", "wide workspace view", "show workstation rhythm"),
        designSeriesRole("协作区", "collaboration", "teamwork setting", "workspace", "meeting", "mid-wide collaboration view", "show collaboration"),
        designSeriesRole("会议室", "meeting", "formal meeting room", "collaboration", "executive/focus", "meeting room view", "show meeting"),
        designSeriesRole("主管/独立办公室", "private-office", "private office scale", "meeting", "focus/pantry", "calm private office view", "show private work"),
        designSeriesRole("专注间/电话间", "focus-room", "small focused support room", "workspace", "pantry", "compact focused view", "show focus"),
        designSeriesRole("茶水/休息区", "pantry-lounge", "support and informal social space", "work areas", "corridor/detail", "support lounge view", "show support"),
        designSeriesRole("走廊/材料节点", "transition-detail", "transition/crafted detail", "whole office", "project memory", "linear/detail view", "show continuity")
      ]
    },
    foodbeverage: {
      4: [
        designSeriesRole("门头/入口主视觉", "arrival", "establish storefront or arrival identity", "street/site approach", "ordering/dining zone", "wide storefront or threshold view", "show arrival"),
        designSeriesRole("点单/吧台/核心运营区", "counter-bar", "main service counter or bar operation", "entry", "seating/dining", "eye-level operational counter view", "show service function"),
        designSeriesRole("堂食/休闲座位区", "dining-lounge", "main guest seating experience", "counter/bar", "private nook/detail", "wide seating view", "show dining/social function"),
        designSeriesRole("包间/卡座/材料氛围节点", "nook-detail", "secondary seating or crafted detail", "dining area", "project memory", "mid-wide nook or close detail view", "show secondary/detail")
      ],
      6: [
        designSeriesRole("外立面/入口", "arrival-exterior", "street arrival and storefront identity", "street/site", "ordering counter", "wide exterior/threshold view", "show exterior"),
        designSeriesRole("点单/接待吧台", "counter", "service counter and ordering moment", "entry", "main seating", "operational counter view", "show ordering"),
        designSeriesRole("主堂食区", "dining-core", "main dining/social room", "counter", "booth/private area", "wide seating view", "show main dining"),
        designSeriesRole("卡座/包间/多人桌", "booth-private", "secondary dining scale", "main dining", "kitchen/display/support", "mid-wide secondary seating view", "show another seating type"),
        designSeriesRole("开放厨房/展示/零售陈列", "display-operation", "operation or display detail", "dining", "support/detail", "operational/display view", "show function detail"),
        designSeriesRole("灯光/材料/餐具氛围特写", "detail", "crafted atmosphere detail", "whole restaurant", "project memory", "close or intimate detail view", "show tactile memory")
      ],
      8: [
        designSeriesRole("外立面/门头", "facade", "storefront identity", "street", "entry", "wide exterior view", "show facade"),
        designSeriesRole("入口/等候", "entry-waiting", "threshold and waiting", "entry", "counter", "entry view", "show threshold"),
        designSeriesRole("点单/吧台", "counter-bar", "service core", "entry", "dining", "counter view", "show service"),
        designSeriesRole("主堂食区", "dining-core", "main dining room", "counter", "booth", "wide dining view", "show main dining"),
        designSeriesRole("卡座/包间", "booth-private", "secondary seating", "dining", "terrace/display", "mid-wide booth view", "show seating variety"),
        designSeriesRole("露台/窗边/外摆", "terrace-window", "edge seating or terrace", "dining", "display/detail", "edge seating view", "show another atmosphere"),
        designSeriesRole("厨房/陈列/运营细节", "operation-display", "operation or display", "public rooms", "detail", "operational detail view", "show operations"),
        designSeriesRole("材料/灯光/餐具特写", "detail", "memory detail", "whole project", "project memory", "close detail view", "show craft")
      ]
    },
    retail: {
      4: [
        designSeriesRole("门头/入口展示", "arrival", "establish brand arrival and first display", "street/mall approach", "main display floor", "wide storefront or threshold view", "show arrival/display"),
        designSeriesRole("主陈列/销售核心区", "display-core", "main retail display floor", "entry", "try-on/experience/cashier", "wide retail interior view with fixture rhythm", "show display core"),
        designSeriesRole("体验/洽谈/试衣/产品场景", "experience-zone", "secondary customer experience zone", "display core", "cashier/storage/detail", "mid-wide functional view", "show different retail function"),
        designSeriesRole("收银/橱窗/材料节点", "support-detail", "transaction, window or crafted fixture detail", "experience zone", "project memory", "detail or support view", "show craft/support")
      ],
      6: [
        designSeriesRole("外立面/橱窗", "facade-window", "brand storefront and window display", "street/mall", "entry", "wide exterior/window view", "show storefront"),
        designSeriesRole("入口/迎宾陈列", "entry-display", "first interior display moment", "entry", "main display", "entry display view", "show threshold display"),
        designSeriesRole("主陈列区", "display-core", "main product display floor", "entry display", "experience zone", "wide fixture rhythm view", "show main display"),
        designSeriesRole("体验/试衣/洽谈区", "experience", "customer experience or consultation zone", "display core", "cashier/support", "mid-wide experience view", "show customer function"),
        designSeriesRole("收银/包装/后场支持", "cashier-support", "transaction or support function", "experience", "detail/window", "controlled support view", "show support"),
        designSeriesRole("展具/材料/灯光节点", "detail", "crafted display detail", "whole store", "project memory", "close fixture/material detail", "show detail")
      ],
      8: [
        designSeriesRole("外立面/橱窗", "facade-window", "storefront identity", "street/mall", "entry", "wide window view", "show facade"),
        designSeriesRole("入口迎宾", "entry", "entry threshold", "facade", "display", "entry view", "show entry"),
        designSeriesRole("主陈列区", "display-core", "main display", "entry", "feature display", "wide retail view", "show display"),
        designSeriesRole("重点产品岛/艺术装置", "feature-display", "feature display moment", "main display", "experience", "feature view", "show hero display"),
        designSeriesRole("体验/试衣/洽谈", "experience", "customer experience function", "display", "cashier", "mid-wide experience view", "show experience"),
        designSeriesRole("收银/包装", "cashier", "transaction function", "experience", "support/detail", "cashier view", "show transaction"),
        designSeriesRole("后场/走廊/仓储入口", "support-transition", "support transition", "cashier", "detail", "controlled transition view", "show support"),
        designSeriesRole("展具/材料/灯光特写", "detail", "fixture and material memory", "whole store", "project memory", "close detail view", "show craft")
      ]
    },
    generic: {
      4: [
        designSeriesRole("到达/入口/项目主视觉", "arrival", "establish the first arrival point and overall project identity", "site approach or exterior threshold", "main public or primary functional zone", "wide establishing view with clear threshold and circulation cue", "show arrival identity, not another interior detail"),
        designSeriesRole("公共核心/主要功能场域", "public-core", "show the main shared or primary functional space where the project language operates at full scale", "arrival or entry threshold", "secondary function or quiet zone", "eye-level wide interior view showing circulation, furniture grouping and wall/ceiling/floor system", "show the primary function and spatial depth, not another entrance hero"),
        designSeriesRole("次级功能/安静场域", "secondary-or-quiet", "show a different functional zone such as dining, office, retail display, lounge, meeting, wellness, study or quiet room using the same project DNA", "public core or corridor", "transition/support/detail zone", "different eye-level or mid-wide view with calmer scale and changed focal direction", "show a different program and camera direction, not another public core view"),
        designSeriesRole("过渡空间/材料节点", "transition-detail", "show a connective threshold, corridor, stair, service/support moment or crafted material detail that ties the series together", "previous public/secondary zone", "the rest of the project", "detail-rich framed view, closer or more linear than the previous images", "show material/craft/circulation evidence, not another wide hero shot")
      ],
      6: [
        designSeriesRole("室外/到达/入口", "arrival", "establish the same project from outside or at the arrival threshold", "site approach", "entry/public zone", "vertical establishing view with clear approach cue", "exterior or threshold expression of project DNA"),
        designSeriesRole("接待/公共主空间", "public-core", "main public room connected to the entrance", "entry", "lounge/dining/office/display/corridor", "wide eye-level interior view with circulation and full material system", "social or primary functional scale"),
        designSeriesRole("休闲/餐厨/办公/展示等次级功能区", "secondary-function", "secondary shared space adjacent to the public zone, with a different program but the same design DNA", "public main space", "quiet/private/support rooms", "mid-wide interior view from a new direction", "different function with repeated material language"),
        designSeriesRole("安静/私密/套房/会议等不同尺度空间", "quiet-private", "quieter or more private room inheriting the same material and lighting system", "corridor/public zone", "support/detail/terrace", "calm eye-level room view with changed view axis", "quiet/private atmosphere and changed scale"),
        designSeriesRole("走廊/楼梯/服务/支持等过渡空间", "support-transition", "connective or support space that proves the design system works beyond hero rooms", "private/secondary zone or corridor", "detail/exit", "controlled framed or linear perspective view", "narrower spatial rhythm and threshold logic"),
        designSeriesRole("材料节点/氛围特写", "detail", "close spatial moment showing repeated craft and material signatures", "any previous room", "whole project memory", "detail or intimate perspective with tactile material evidence", "texture, lighting detail and crafted junction")
      ],
      8: [
        designSeriesRole("外观/入口", "arrival", "arrival and project identity", "site context", "entry lobby", "wide vertical exterior/threshold view", "facade or entry language"),
        designSeriesRole("门厅/接待", "entry-lobby", "threshold between exterior and interior", "entry", "main public room", "eye-level arrival view from a new position", "first interior impression"),
        designSeriesRole("公共休闲区", "public-core", "main social or primary functional space", "lobby", "dining/bar/office/display/corridor", "wide interior view with full spatial depth", "large-scale furniture and circulation"),
        designSeriesRole("餐厨/吧台/办公/展示/活动区", "secondary-function", "secondary public function with operational or activity detail", "public lounge", "quiet/private corridor", "mid-wide operational view from another axis", "functional detail"),
        designSeriesRole("安静/专注/会议/洽谈区", "quiet-focused", "quieter or focused room scale selected by the detected project category", "corridor", "support/detail/terrace", "calm eye-level view", "private or focused atmosphere"),
        designSeriesRole("服务/后勤/支持空间", "support", "support space with the same material system selected by the detected project category", "focused/private zone", "detail", "controlled support-area view", "stone/wood/service/light expression"),
        designSeriesRole("走廊/楼梯/过渡", "transition", "spatial connector that reveals project continuity", "public/private rooms", "detail/end point", "linear perspective view with strong threshold cues", "circulation and threshold language"),
        designSeriesRole("材料节点/氛围特写", "detail", "close crafted moment tying the series together", "whole project", "memory/detail", "detail-rich intimate view", "tactile signature")
      ]
    }
  };
  const table = catalog[projectType] || catalog.generic;
  return table[planCount] || table[4];
}

function designSeriesLockedSchedule(count = 4, analysis = {}) {
  const requestedCount = designSeriesRequestedCount(count);
  return defaultDesignSeriesSceneRoles(requestedCount, { analysis }).slice(0, requestedCount);
}

function designSeriesScheduleLine(role, index) {
  return `${index + 1}. ${role.title} [${role.field_type}] - ${role.spatial_role}`;
}

function designSeriesScheduleText(count = 4, analysis = {}) {
  return designSeriesLockedSchedule(count, analysis).map(designSeriesScheduleLine).join(" | ");
}

function designSeriesOtherSceneTitles(index = 1, count = 4, analysis = {}, direction = "previous") {
  return designSeriesLockedSchedule(count, analysis)
    .filter((_, itemIndex) => {
      const ordinal = itemIndex + 1;
      if (direction === "previous") return ordinal < index;
      if (direction === "future") return ordinal > index;
      return ordinal !== index;
    })
    .map((role) => role.title);
}

function designSeriesSceneBrief(analysis = {}, index = 1, count = 4) {
  const fallbackContext = { analysis };
  const schedule = designSeriesLockedSchedule(count, analysis);
  const fallback = schedule[Math.max(0, index - 1)] || defaultDesignSeriesSceneRoles(4, fallbackContext)[0];
  const scene = Array.isArray(analysis.scene_briefs)
    ? analysis.scene_briefs.find((item) => Number(item.index) === Number(index)) || analysis.scene_briefs[index - 1]
    : null;
  const sceneRole = scene?.spatial_role ? `Reference-informed expansion: ${scene.spatial_role}` : "";
  const sceneCamera = scene?.camera ? `Reference-informed camera suggestion: ${scene.camera}` : "";
  const sceneVary = scene?.must_vary ? `Reference-informed variation: ${scene.must_vary}` : "";
  const otherSceneTitles = designSeriesOtherSceneTitles(index, count, analysis, "all");
  const previousSceneTitles = designSeriesOtherSceneTitles(index, count, analysis, "previous");
  const baseForbidden = [
    fallback.forbidden_repetition,
    scene?.forbidden_repetition,
    otherSceneTitles.length ? `Do not generate these other scheduled spaces for image ${index}: ${otherSceneTitles.join(", ")}.` : "",
    previousSceneTitles.length ? `Already covered earlier in this series and forbidden to repeat now: ${previousSceneTitles.join(", ")}.` : "",
    "Each scheduled space role may appear only once in the whole design series."
  ].filter(Boolean).join(" ");
  return {
    ...fallback,
    ...(scene || {}),
    title: fallback.title,
    field_type: fallback.field_type,
    reference_title: scene?.title || "",
    spatial_role: [fallback.spatial_role, sceneRole].filter(Boolean).join("; "),
    connects_from: scene?.connects_from || fallback.connects_from,
    connects_to: scene?.connects_to || fallback.connects_to,
    camera: [fallback.camera, sceneCamera].filter(Boolean).join("; "),
    must_repeat: Array.isArray(scene?.must_repeat) && scene.must_repeat.length ? scene.must_repeat : [],
    must_vary: [fallback.must_vary, sceneVary].filter(Boolean).join("; "),
    forbidden_repetition: baseForbidden || "Do not repeat the same room, same camera position, same hero composition, same furniture grouping or same single-angle style variation from other images."
  };
}

function designSeriesContinuityContract({ analysis = {}, index = 1, count = 4, sceneBrief = {} } = {}) {
  const schedule = designSeriesScheduleText(count, analysis);
  const previousScenes = designSeriesOtherSceneTitles(index, count, analysis, "previous");
  const otherScenes = designSeriesOtherSceneTitles(index, count, analysis, "all");
  return [
    "DESIGN_SERIES_CONTINUITY_CONTRACT:",
    `- This is image ${index} of ${count} in one deep spatial project series, not an isolated render and not a style variation of one angle.`,
    `- LOCKED_UNIQUE_SCENE_SCHEDULE: ${schedule}.`,
    "- Unique-scene rule: each scheduled room/function appears once only. Do not make two images of reception, two images of open workspace, two meeting rooms, or repeated variants of the same area unless the schedule explicitly says so.",
    `- CURRENT_IMAGE_ONLY: generate image ${index}/${count} as "${sceneBrief.title || ""}". Do not borrow the spatial role from image 1, image 2, the reference image, or any previous output.`,
    previousScenes.length ? `- ALREADY_COVERED_AND_FORBIDDEN_NOW: ${previousScenes.join("; ")}.` : "- ALREADY_COVERED_AND_FORBIDDEN_NOW: none.",
    otherScenes.length ? `- OTHER_SCHEDULED_SCENES_NOT_FOR_THIS_IMAGE: ${otherScenes.join("; ")}.` : "",
    "- Deep series definition: unified style across different fields, viewpoints, angles and functional zones. Same design DNA, different spatial role.",
    "- Project-planning rule: infer the whole project from the references, then show the current most useful scene in that project according to the requested count.",
    "- UI settings rule: keep output count, aspect ratio, resolution/size and quality exactly as provided by the current UI/API request; do not add fixed horizontal, 4:3, 4K or 8-image requirements.",
    "- Reference DNA extraction: preserve visible brand cues, color elements, material system, spatial organization, lighting atmosphere, composition rhythm, furniture/object language and crafted details.",
    `- Project DNA: ${analysis.project_dna || analysis.series_strategy || "same project identity, same design team, same render pipeline"}.`,
    `- Spatial sequence: ${analysis.spatial_sequence || "the images should read as a connected walk-through from arrival/public space to private space and detail moments"}.`,
    `- Current scene role is non-negotiable: ${sceneBrief.title || ""} / ${sceneBrief.spatial_role || ""}.`,
    `- Current field category: ${sceneBrief.field_type || "distinct field/function zone"}.`,
    `- It connects from: ${sceneBrief.connects_from || "the previous space in the series"}; it connects to: ${sceneBrief.connects_to || "the next space in the series"}.`,
    `- Camera rule for this image: ${sceneBrief.camera || "a clear architectural visualization camera consistent with the series"}.`,
    `- Must repeat: ${(sceneBrief.must_repeat || []).concat(analysis.recurring_signatures || []).filter(Boolean).slice(0, 10).join("; ") || "the same palette, material family, lighting philosophy, furniture language, trim/detail logic and render finish"}.`,
    `- Must vary: ${sceneBrief.must_vary || "space function, camera angle, focal zone and composition only; do not invent a new style."}`,
    `- Forbidden repetition: ${sceneBrief.forbidden_repetition || "do not repeat the same room, same camera position, same hero composition or same primary furniture grouping from other outputs."}`,
    `- Continuity rules: ${(analysis.continuity_rules || []).join("; ") || "repeat key materials across adjacent rooms; maintain a believable circulation axis; keep openings/thresholds/ceiling logic compatible; use the same lighting temperature and post-processing; keep object scale and styling density consistent."}`,
    "- Spatial linkage requirement: include at least one visual cue that can connect this image to the rest of the set, such as a repeated wall/floor material, ceiling detail, doorway/threshold, corridor axis, exterior view, furniture family, lighting fixture language or crafted motif.",
    "- No people or animals: the image must be an empty spatial design render. Do not include people, employees, guests, clients, silhouettes, faces, hands, crowds, lifestyle figures, animals or pets.",
    "- Hard avoid: do not make this image a totally new hotel/house/shop; do not change render style, color grading, material family, furniture era, lighting mood or project budget level between images; do not solve continuity by repeating the same view."
  ].join("\n");
}

function designSeriesFinalPromptLock({ index = 1, count = 4, sceneBrief = {} } = {}) {
  return [
    "DESIGN_SERIES_IMAGE_LOCK:",
    `- This final prompt is for image ${index}/${count}. The generated image must follow this exact scene role and field category.`,
    `- CURRENT_IMAGE_ONLY: generate only "${sceneBrief.title || "this scheduled scene"}".`,
    "- One schedule item, one image: do not generate another scheduled scene in this slot, and do not repeat any earlier scene role.",
    "- Respect current generation settings for aspect ratio, image size/resolution, quality and total count. Do not inject horizontal, 4:3, 4K or 8-image constraints unless they came from the current request.",
    `- Scene role: ${sceneBrief.title || "series scene"} / ${sceneBrief.spatial_role || "one distinct space in the same project"}.`,
    `- Field category: ${sceneBrief.field_type || "distinct functional zone"}.`,
    `- Spatial continuity: comes from ${sceneBrief.connects_from || "the previous space"} and leads to ${sceneBrief.connects_to || "the next space"}.`,
    `- Camera and composition: ${sceneBrief.camera || "use a clear architectural camera appropriate to this scene role"}.`,
    `- Required variation: ${sceneBrief.must_vary || "change the space function, camera position and focal zone while preserving the same project DNA."}`,
    `- Forbidden repetition: ${sceneBrief.forbidden_repetition || "do not repeat the same room, same camera position, same hero composition or same primary furniture grouping."}`,
    "- No people or animals allowed: empty architecture/interior space only. No humans, staff, guests, clients, workers, silhouettes, portraits, faces, hands, body parts, crowds, animals or pets.",
    "- If any earlier text says image 1, entrance hero, or a different scene role, treat that earlier text only as global series context and follow this IMAGE_LOCK instead.",
    "- If any earlier text over-focuses on a single reference angle, reinterpret it as style/material DNA only, not as the scene to repeat.",
    "- Do not repeat the same entrance hero composition for every output. This image must be visually distinct in function, viewpoint and focal zone while staying connected by materials, lighting, palette, furniture language and render finish."
  ].join("\n");
}

async function generateDesignSeries(body) {
  const references = activeReferenceImagesFromBody(body);
  if (!references.length) {
    const error = new Error("Please upload at least one reference image");
    error.status = 400;
    throw error;
  }

  const useReasoning = body.thinkingEnabled === true;
  const promptFusionEnabled = body.promptFusionEnabled !== false;
  const hasProvidedAnalysis = body.analysis && (
    body.analysis.image_prompt
    || body.analysis.project_dna
    || body.analysis.spatial_sequence
    || (Array.isArray(body.analysis.scene_briefs) && body.analysis.scene_briefs.length)
  );
  const analysis = hasProvidedAnalysis
    ? enforceDesignSeriesProjectType(normalizeDesignSeriesAnalysis(body.analysis, references), {
        brief: body.brief || {},
        intent: body.intent || "",
        userPrompt: body.userPrompt || "",
        seriesCount: body.seriesCount || body.count || 4
      })
    : useReasoning
      ? await analyzeDesignSeriesReferences(body)
      : designSeriesPresetAnalysis(body, references, {
          summary: "已关闭思考模式，使用内置设计系列预设直接生成。"
        });
  const brief = body.brief || {};
  const seriesCount = Math.max(1, Math.min(8, Number(body.seriesCount || body.count || 1) || 1));
  const seriesIndex = Math.max(1, Math.min(seriesCount, Number(body.seriesIndex || 1) || 1));
  const sceneBrief = designSeriesSceneBrief(analysis, seriesIndex, seriesCount);
  const detectedProjectType = detectDesignSeriesProjectType({ brief, intent: body.intent || "", userPrompt: body.userPrompt || "", analysis });
  const lockedSchedule = designSeriesScheduleText(seriesCount, analysis);
  const previousSceneTitles = designSeriesOtherSceneTitles(seriesIndex, seriesCount, analysis, "previous");
  const otherSceneTitles = designSeriesOtherSceneTitles(seriesIndex, seriesCount, analysis, "all");
  const prompt = [
    gptImage2PromptFusionGuide({
      mode: "designseries",
      referenceCount: references.length,
      references
    }),
    "",
    `Selected UI workflow button: ${renderModeKnowledge("designseries").label}.`,
    `Button meaning: ${renderModeKnowledge("designseries").purpose}`,
    `Reference-reading rule for this button: ${renderModeKnowledge("designseries").referenceFocus}`,
    "Before calling image_generation, internally combine the reference image reading with the selected design-series function.",
    designerAgentThinkingModel({
      mode: "designseries",
      brief,
      intent: body.intent || "",
      referenceCount: references.length,
      references
    }),
    "",
    promptEngineV2CompactReference("designseries"),
    "",
    designSeriesContinuityContract({ analysis, index: seriesIndex, count: seriesCount, sceneBrief }),
    "",
    `LOCKED_SERIES_SCHEDULE: ${lockedSchedule}`,
    `CURRENT_IMAGE_ONLY: image ${seriesIndex}/${seriesCount} must be "${sceneBrief.title || ""}" and must not be a repeat of any other scheduled space.`,
    previousSceneTitles.length ? `ALREADY_COVERED_SCENES_FORBIDDEN_NOW: ${previousSceneTitles.join("; ")}` : "",
    otherSceneTitles.length ? `DO_NOT_GENERATE_OTHER_SCHEDULED_SCENES_IN_THIS_SLOT: ${otherSceneTitles.join("; ")}` : "",
    "",
    designSeriesProjectTypeGuard(detectedProjectType),
    "",
    analysis.image_prompt || "Generate a cohesive architecture/interior design series image.",
    "",
    "DEEP_DESIGN_SERIES_DEFINITION:",
    "- Create one finished single scene image that belongs to a coherent design series for spatial designers.",
    "- This series is unified by style/material/light/render language, but diversified by field, function, viewpoint, angle and spatial scale.",
    "- Stand at the project-planning level: infer the whole design from the references, then generate the current scene as one part of that larger design.",
    "- Precisely preserve reference-derived brand cues, color elements, material system, spatial rhythm, lighting atmosphere, composition logic, furniture/object language and crafted details.",
    "- Do not turn the series into one camera angle with multiple style variations.",
    "- Do not hardcode aspect ratio, resolution/size, quality or total image count in the prompt. These are already supplied by the current generation request.",
    "",
    `This request represents image ${seriesIndex}/${seriesCount}; follow the scene role and spatial continuity contract above more strongly than generic style words.`,
    "Do not create a multi-panel presentation board, collage, contact sheet, moodboard, split-screen layout, captions or text unless the user explicitly asks for that.",
    "Use the uploaded reference images as design language references, not as content to copy exactly.",
    `Image-only project type: ${analysis.project_type_visual || "not available from analysis; use the project type lock below and visible reference cues"}`,
    `Project type source: ${analysis.project_type_source || detectedProjectType.source || "analysis"}`,
    `Project type evidence: ${(analysis.project_type_evidence || []).join("; ") || "use visible reference-image cues before old templates or stale brief text"}`,
    (analysis.context_conflicts || []).length ? `Context conflicts to ignore unless explicitly requested: ${analysis.context_conflicts.join("; ")}` : "",
    `Project type: ${analysis.project_type || detectedProjectType.label}`,
    `Scene allocation strategy: ${analysis.scene_allocation_strategy || designSeriesSceneAllocationText(seriesCount, { brief, intent: body.intent || "", userPrompt: body.userPrompt || "", analysis })}`,
    `Series strategy: ${analysis.series_strategy}`,
    `Project DNA: ${analysis.project_dna || ""}`,
    `Spatial sequence: ${analysis.spatial_sequence || ""}`,
    `Suggested outputs: ${(analysis.suggested_outputs || []).join("; ")}`,
    `Current scene brief: ${sceneBrief.title || ""}; ${sceneBrief.spatial_role || ""}; connects from ${sceneBrief.connects_from || ""}; connects to ${sceneBrief.connects_to || ""}; camera ${sceneBrief.camera || ""}.`,
    `Current field category: ${sceneBrief.field_type || "distinct field/function zone"}.`,
    `Forbidden repetition for this image: ${sceneBrief.forbidden_repetition || "do not repeat the same room, same camera position, same hero composition or same primary furniture grouping."}`,
    `Continuity rules: ${(analysis.continuity_rules || []).join("; ")}`,
    `Recurring signatures: ${(analysis.recurring_signatures || []).join("; ")}`,
    `Palette: ${(analysis.palette || []).join(", ")}`,
    `Materials: ${(analysis.materials || []).join(", ")}`,
    `Project context: ${brief.spaceType || "architecture/interior spatial design"}, ${brief.location || ""}.`,
    `Reference weights: ${referenceWeightSummary(references)}`,
    `Reference usage intent: ${referenceIntentSummary(references)}`,
    `User intent: ${body.intent || ""}`,
    "No people, no human figures, no staff, no guests, no clients, no silhouettes, no hands, no faces, no crowds, no animals, no pets.",
    "No readable text, no logos, no watermark, no UI overlay, no presentation-board composition."
  ].join("\n");

  const generated = await thinkThenGenerateImage({
    prompt,
    inputImages: references.map((reference, index) => ({ dataUrl: reference.dataUrl, label: `reference ${index + 1} (${referenceWeightMeta(reference.weight).label})` })),
    size: body.size || "1536x1024",
    quality: body.quality || "low",
    title: [analysis.title || "design series", sceneBrief.title].filter(Boolean).join(" / "),
    mode: "designseries",
    preferReferenceEdit: false,
    finalPromptFooter: [
      designSeriesProjectTypeGuard(detectedProjectType),
      designSeriesFinalPromptLock({ index: seriesIndex, count: seriesCount, sceneBrief })
    ].join("\n\n"),
    useReasoning: useReasoning && promptFusionEnabled
  });

  const render = await saveGeneratedImage({
    buffer: generated.buffer,
    slug: `design-series-${slugify(analysis.title || "reference")}`,
    meta: {
      reasoning_model: generated.reasoningModel || config.reasoningModel,
      image_model: config.imageModel,
      prompt_library_version: promptLibraryVersion,
      mode: "designseries",
      series_index: seriesIndex,
      series_count: seriesCount,
      scene_brief: sceneBrief,
      source_prompt: prompt,
      prompt: generated.prompt || prompt,
      thinking: generated.thinking,
      analysis,
      reference_count: references.length,
      project_type: analysis.project_type || "",
      scene_allocation_strategy: analysis.scene_allocation_strategy || "",
      created_at: new Date().toISOString()
    },
    extra: {
      prompt: generated.prompt || prompt,
      sourcePrompt: prompt,
      thinking: generated.thinking,
      endpoint: generated.endpoint,
      attempt: generated.attempt,
      attempts: generated.attempts,
      imageApi: generated.imageApi,
      actualParams: generated.actualParams,
      revisedPrompt: generated.revisedPrompt,
      seriesIndex,
      seriesCount,
      sceneBrief
    }
  });

  return { analysis, render };
}

async function thinkThenGenerateImage({ prompt, inputImages, size, quality, title, mode = "plan-render", preferReferenceEdit = true, finalPromptFooter = "", useReasoning = true }) {
  const requestedSize = normalizeImageSize(size);
  const normalizedMode = normalizeRenderMode(mode);
  const promptGuard = buildFinalPromptGuard({
    mode: normalizedMode,
    requestedSize,
    quality,
    title
  });
  const directPromptAudit = auditFinalPromptForMode({
    mode: normalizedMode,
    prompt
  });

  if (!useReasoning) {
    const imagePrompt = [
      hardenFinalPromptForMode({
        mode: normalizedMode,
        finalPrompt: prompt,
        promptGuard,
        audit: directPromptAudit
      }),
      String(finalPromptFooter || "").trim()
    ].filter(Boolean).join("\n\n");
    const generated = await generateImageWithImageProvider({
      prompt: imagePrompt,
      inputImages,
      size: requestedSize,
      quality,
      preferReferenceEdit,
      mode: normalizedMode
    });

    return {
      ...generated,
      prompt: imagePrompt,
      reasoningModel: "preset-only",
      thinking: [
        "已关闭思考模式：本次未做单独的 gpt-5.5 提示词融合，直接使用网页内置预设提示词和用户描述交给 Image Gen。",
        directPromptAudit.length
          ? `预设提示词加固：已补回 ${directPromptAudit.length} 项关键约束：${directPromptAudit.join("；")}`
          : "预设提示词加固：最终提示词已覆盖当前功能的关键输出边界。"
      ].join("\n")
    };
  }

  const content = [
    {
      type: "input_text",
      text: [
        "You are gpt-5.5 acting as an architecture and spatial-design creative director.",
        "First inspect the input image(s), open reference images, selected UI button meaning, spatial constraints, camera, material logic, lighting, and generation risks.",
        "Then synthesize those decisions into a strong gpt-image-2 prompt.",
        "For architecture/interior work, split spatial layout, camera, materials, lighting, palette, styling details, invariants, and avoid-lines into separate controls.",
        "Use Prompt Engine v2: put canvas/aspect and artifact type first, then the operation boundary, then concrete scene grammar, then quality controls and targeted avoid-lines.",
        inputImageOrderGuide(inputImages),
        "Different UI buttons mean different creative operations; never ignore the selected workflow semantics.",
        "Run a concise designer aesthetic review before finalizing: spatial order, proportion, material authenticity, lighting hierarchy, focal point, negative space, contextual fit, feasibility and image-generation risk.",
        "Before returning JSON, run FINAL_PROMPT_PREFLIGHT against your own final_prompt. If it misses the selected workflow output boundary, non-negotiable invariants, camera/view grammar or failure guard, rewrite final_prompt once before returning it.",
        "Do not call tools. Return valid JSON only with keys summary, aesthetic_review and final_prompt.",
        `Target image model capability: ${config.imageModel}.`,
        `Target image size: ${requestedSize}. Target quality: ${quality}.`,
        finalOutputRuleForMode(normalizedMode),
        `Request title: ${title}`,
        "",
        designerAgentAestheticRubric(),
        "",
        prompt
      ].join("\n")
    },
    ...inputImages.map((image) => ({
      type: "input_image",
      image_url: image.dataUrl
    }))
  ];

  const reasoningPayload = {
    model: config.reasoningModel,
    input: [{ role: "user", content }],
    max_output_tokens: 2600
  };

  const reasoningText = await openaiResponsesTextStream(reasoningPayload, {
    timeoutMs: 240000,
    provider: "reasoning"
  });
  const reasoning = parsePromptFusion(reasoningText);
  const promptAudit = auditFinalPromptForMode({
    mode: normalizedMode,
    prompt: reasoning.final_prompt || prompt
  });
  const imagePrompt = [
    hardenFinalPromptForMode({
      mode: normalizedMode,
      finalPrompt: reasoning.final_prompt || prompt,
      promptGuard,
      audit: promptAudit
    }),
    String(finalPromptFooter || "").trim()
  ].filter(Boolean).join("\n\n");
  const generated = await generateImageWithImageProvider({
    prompt: imagePrompt,
    inputImages,
    size: requestedSize,
    quality,
    preferReferenceEdit,
    mode: normalizedMode
  });

  return {
    ...generated,
    prompt: imagePrompt,
    thinking: [
      reasoning.summary || "已完成参考图、功能按钮、空间约束、审美自检和生成参数的提示词融合。",
      promptAudit.length
        ? `提示词加固：已补回 ${promptAudit.length} 项关键约束：${promptAudit.join("；")}`
        : "提示词加固：最终提示词已覆盖当前功能的关键输出边界。"
    ].join("\n")
  };
}

function parsePromptFusion(text) {
  if (!text.trim()) return { summary: "", final_prompt: "" };
  try {
    const value = parseModelJson(text);
    const summary = [
      String(value.summary || value.reasoning_summary || value.design_decisions || "").trim(),
      value.aesthetic_review ? `审美自检：${String(value.aesthetic_review).trim()}` : ""
    ].filter(Boolean).join("\n");
    return {
      summary,
      final_prompt: String(value.final_prompt || value.prompt || value.image_prompt || "").trim()
    };
  } catch {
    return {
      summary: "已完成提示词融合。",
      final_prompt: text.trim()
    };
  }
}

function buildFinalPromptGuard({ mode, requestedSize, quality, title }) {
  mode = normalizeRenderMode(mode);
  return [
    "MANDATORY_GPT_IMAGE_2_MODE_GUARD:",
    `- Request title: ${title || "spatial design generation"}.`,
    `- Canvas and quality: ${requestedSize}; ${quality}.`,
    `- Final output rule: ${outputInstructionForMode(mode)}`,
    ...communityPromptBlueprintLines(mode).slice(1),
    `- Visual controls: ${requiredVisualControlsForMode(mode)}`,
    `- Quality target: ${qualityTargetForMode(mode)}`,
    "- Universal avoid: no watermark, no logo, no UI overlay, no random readable text, no distorted geometry, no unrelated collage."
  ].join("\n");
}

function auditFinalPromptForMode({ mode, prompt }) {
  mode = normalizeRenderMode(mode);
  const text = String(prompt || "").toLowerCase();
  const checks = {
    "plan-axonometric": [
      ["真实3D平面图输出", /(3d floor plan|3d平面|三维平面|轴测)/i],
      ["锁定原平面线条布局", /(locked|hard|preserve|保留|锁定).{0,140}(linework|layout|room|wall|opening|footprint|plan|线条|布局|房间|墙|开口|脚印)/i],
      ["上帝视角/弱透视/轴测相机", /(orthographic|isometric|top-down|weak-perspective|上帝视角|弱透视|轴测)/i],
      ["禁止人视角/改布局/二维彩平", /(no|avoid|不要|禁止).{0,160}(eye-level|human-eye|layout drift|moved|redesigned|flat 2d|colored plan|人视角|改布局|布局漂移|二维彩平)/i]
    ],
    "plan-render": [
      ["人视角效果图输出", /(eye-level|human-eye|effect render|效果图|人视角)/i],
      ["保留空间关系/选区", /(preserve|保留).{0,100}(spatial|circulation|selected|zone|空间|动线|选区|功能)/i],
      ["前中后景与材料灯光", /(foreground|midground|background|materials|lighting|前景|中景|背景|材料|灯光)/i]
    ],
    viewpoint: [
      ["新机位人视角", /(new|marked|camera|standing point|eye-level|新视角|机位|站位|人视角)/i],
      ["保留原空间设计语言", /(preserve|same|保留).{0,120}(source|spatial|structure|materials|lighting|furniture|原图|空间|结构|材料|灯光|家具)/i],
      ["不生成UI标记人物", /(no|avoid|不要|禁止).{0,120}(ui|marker|person|human|figure|模型|标记|人物|人)/i]
    ],
    designseries: [
      ["统一系列DNA", /(series|coherent|same project|design dna|系列|统一|同一项目)/i],
      ["空间衔接/动线关系", /(spatial sequence|walkthrough|adjacency|connects|threshold|corridor|sequence|动线|衔接|相邻|过渡|门厅|走廊)/i],
      ["重复设计母题", /(recurring|signature|motif|repeated|threshold|ceiling detail|joinery|重复|母题|标志|节点|收口)/i],
      ["共享材料灯光色彩", /(material|lighting|palette|render finish|材料|灯光|色彩|渲染)/i],
      ["禁止拼贴/无关风格", /(no|avoid|不要|禁止).{0,100}(collage|unrelated|style drift|拼贴|无关|风格漂移)/i]
    ],
    photo: [
      ["保留现场透视结构", /(preserve|保留).{0,100}(perspective|envelope|openings|columns|site|透视|结构|开口|柱)/i],
      ["只改软装材料灯光", /(finishes|furniture|lighting|renovation|完成面|家具|灯光|改造)/i]
    ],
    cadrender: [
      ["CAD硬约束", /(cad|dxf|svg|linework|axis|线稿|轴线)/i],
      ["不保留CAD线", /(no|avoid|不要|禁止).{0,80}(cad strokes|linework|technical lines|cad线|图纸线)/i]
    ],
    whitemodel: [
      ["保留白模体块视角", /(preserve|保留).{0,100}(massing|camera|openings|white model|体块|视角|开口|白模)/i],
      ["真实材质灯光", /(materials|lighting|context|scale|材质|灯光|环境|尺度)/i]
    ],
    sketch: [
      ["保留草图意图", /(preserve|保留).{0,100}(sketch|composition|perspective|volumes|草图|构图|透视|体块)/i],
      ["转译成真实空间", /(realistic|buildable|architecture|interior|真实|可建造|空间)/i]
    ],
    upscale: [
      ["保持原图内容", /(preserve|same image|保留|不改变).{0,100}(composition|geometry|content|构图|几何|内容)/i],
      ["只增强清晰噪声", /(clarity|denoise|local contrast|resolution|清晰|降噪|对比|分辨率)/i]
    ],
    sharpen: [
      ["保持原图内容", /(preserve|same image|保留|不改变).{0,100}(composition|geometry|content|color|构图|几何|内容|色彩)/i],
      ["只增强边缘局部对比", /(sharpen|edge clarity|local contrast|crispness|锐化|边缘|局部对比|清晰)/i]
    ],
    detail: [
      ["保留布局镜头", /(preserve|保留).{0,100}(layout|camera|walls|openings|布局|镜头|墙|开口)/i],
      ["增加材质细节", /(texture|joints|fixtures|lighting layers|纹理|收口|灯光层次|细节)/i]
    ],
    materialreplace: [
      ["只替换材质", /(material replacement|replace material|材质替换|替换材质)/i],
      ["保留几何透视光向", /(preserve|保留).{0,100}(geometry|perspective|lighting direction|几何|透视|光向)/i]
    ],
    lightingadjust: [
      ["只调整灯光", /(lighting adjustment|adjust lighting|灯光调整|调整灯光)/i],
      ["保留空间材料镜头", /(preserve|保留).{0,100}(space|materials|camera|空间|材料|镜头)/i]
    ],
    styletransfer: [
      ["风格系统迁移", /(style transfer|style language|风格迁移|风格语言)/i],
      ["保留结构镜头尺度", /(preserve|保留).{0,100}(architecture|camera|scale|circulation|结构|镜头|尺度|动线)/i]
    ],
    materialboard: [
      ["材料板输出", /(material board|swatches|samples|材料板|色卡|样板)/i],
      ["禁止文字logo", /(no|avoid|不要|禁止).{0,80}(text|logos|watermark|文字|logo|水印)/i]
    ],
    outpaint: [
      ["扩图输出", /(outpaint|expand|extension|扩图|扩展)/i],
      ["延续透视光照材质", /(perspective|lighting|material scale|透视|灯光|材料尺度)/i],
      ["禁止接缝重复物", /(no|avoid|不要|禁止).{0,80}(seams|repeated|distorted|接缝|重复|变形)/i]
    ]
  };
  const modeChecks = checks[mode] || [
    ["输出物类型", /(render|visual|image|board|效果图|设计图|材料板|图像)/i],
    ["保留/变化边界", /(preserve|transform|保留|变化|改变)/i]
  ];
  return modeChecks
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label);
}

function hardenFinalPromptForMode({ mode, finalPrompt, promptGuard, audit }) {
  const prompt = String(finalPrompt || "").trim();
  const parts = [prompt || "Generate the requested spatial design image."];
  const needsGuard = audit.length || !prompt.includes("MANDATORY_GPT_IMAGE_2_MODE_GUARD");
  if (needsGuard) parts.push(promptGuard);
  return parts.join("\n\n");
}

async function generateImageWithImageProvider({ prompt, inputImages, size, quality, preferReferenceEdit = true, mode = "" }) {
  await refreshImageEndpointSpeeds();

  const attempts = [];
  const attemptEvents = [];
  const standardSize = closestStandardImageSize(size);
  const skillAttempts = imageGenSkillMaxAttempts();
  const apiMode = normalizeImageApiMode(config.imageApiMode);
  const addImageGenerationAttempts = (candidateSize) => {
    if (apiMode !== "responses") {
      attempts.push({
        name: `OpenAI-compatible Images API ${candidateSize}`,
        run: () => openaiCompatibleImagesDirect({
          prompt,
          inputImages: preferReferenceEdit ? inputImages : [],
          size: candidateSize,
          quality
        })
      });
    }
    if (apiMode !== "images") {
      for (let attempt = 1; attempt <= skillAttempts; attempt += 1) {
        attempts.push({
          name: `Responses image_generation tool ${candidateSize} (${attempt}/${skillAttempts})`,
          run: () => openaiResponsesImageDirect({
            prompt,
            inputImages,
            size: candidateSize,
            quality,
            useProviderPool: false
          })
        });
      }
    } else {
      attempts.push({
        name: `Responses image_generation fallback ${candidateSize}`,
        run: () => openaiResponsesImageDirect({
          prompt,
          inputImages,
          size: candidateSize,
          quality,
          useProviderPool: false
        })
      });
    }
    if (parseBooleanEnv(process.env.IMAGE_ALLOW_LEGACY_FALLBACK, false)) {
      attempts.push({
        name: `Legacy app image generation ${candidateSize}`,
        run: () => openaiImagesGenerationDirect({ prompt, size: candidateSize, quality })
      });
    }
  };

  addImageGenerationAttempts(size);
  if (standardSize !== size) {
    addImageGenerationAttempts(standardSize);
  }

  if (!attempts.length) {
    const error = new Error("当前没有可用的 Image Gen 生图路径。");
    error.endpoint = config.imageProvider.baseUrl;
    error.attempts = attemptEvents;
    error.retryCount = 0;
    throw error;
  }

  let lastError;
  for (const attempt of attempts) {
    console.log(`[image] trying ${attempt.name}`);
    const started = Date.now();
    const event = {
      name: attempt.name,
      status: "running",
      endpoint: config.imageProvider.baseUrl,
      durationMs: 0,
      error: ""
    };
    attemptEvents.push(event);
    try {
      const result = await attempt.run();
      console.log(`[image] success ${attempt.name}`);
      const providerAttempts = Array.isArray(result?.providerAttempts) ? result.providerAttempts : [];
      if (providerAttempts.length) {
        const eventIndex = attemptEvents.indexOf(event);
        if (eventIndex >= 0) {
          attemptEvents.splice(
            eventIndex,
            1,
            ...providerAttempts.map((providerAttempt) => ({
              name: attempt.name,
              status: providerAttempt.status,
              endpoint: providerAttempt.endpoint,
              durationMs: providerAttempt.durationMs || 0,
              error: providerAttempt.error || ""
            }))
          );
        }
        const successProvider = providerAttempts.find((item) => item.status === "success") || providerAttempts.at(-1);
        if (successProvider?.endpoint) config.imageProvider.baseUrl = successProvider.endpoint;
      }
      event.status = "success";
      event.endpoint = config.imageProvider.baseUrl;
      event.durationMs = Date.now() - started;
      return {
        ...result,
        endpoint: config.imageProvider.baseUrl,
        attempt: attempt.name,
        attempts: attemptEvents
      };
    } catch (error) {
      lastError = error;
      const providerAttempts = Array.isArray(error?.providerAttempts) ? error.providerAttempts : [];
      if (providerAttempts.length) {
        const eventIndex = attemptEvents.indexOf(event);
        if (eventIndex >= 0) {
          attemptEvents.splice(
            eventIndex,
            1,
            ...providerAttempts.map((providerAttempt) => ({
              name: attempt.name,
              status: providerAttempt.status,
              endpoint: providerAttempt.endpoint,
              durationMs: providerAttempt.durationMs || 0,
              error: providerAttempt.error || ""
            }))
          );
        }
      }
      event.status = "failed";
      event.endpoint = config.imageProvider.baseUrl;
      event.durationMs = Date.now() - started;
      event.error = `${error.status || "ERR"} ${error.message || "unknown error"}`;
      console.warn(`[image] failed ${attempt.name}: ${error.status || "ERR"} ${error.message || "unknown error"}`);
      if (!isRetryableImageProviderError(error)) {
        error.endpoint = config.imageProvider.baseUrl;
        error.attempts = attemptEvents;
        error.retryCount = attemptEvents.filter((item) => item.status === "failed").length;
        throw error;
      }
    }
  }
  const error = lastError || new Error("Image generation failed");
  error.endpoint = config.imageProvider.baseUrl;
  error.attempts = attemptEvents;
  error.retryCount = attemptEvents.filter((item) => item.status === "failed").length;
  throw error;
}

function isRetryableImageProviderError(error) {
  if (!error.status) return true;
  return [400, 404, 408, 409, 415, 422, 429, 500, 502, 503, 504].includes(error.status);
}

function shouldRequireImageModelInProbe(source) {
  return process.env.IMAGE_ENDPOINT_REQUIRE_MODEL_LIST === "1";
}

function modelListContainsModel(value, model) {
  const target = String(model || "").trim();
  if (!target || !value) return false;
  if (typeof value === "string") return value === target;
  if (Array.isArray(value)) return value.some((item) => modelListContainsModel(item, target));
  if (typeof value !== "object") return false;

  for (const [key, item] of Object.entries(value)) {
    if ((key === "id" || key === "model") && typeof item === "string" && item === target) return true;
    if (modelListContainsModel(item, target)) return true;
  }
  return false;
}

function isImageCapabilityError(error) {
  const status = Number(error?.status || 0);
  const details = error?.details ? JSON.stringify(error.details).slice(0, 1000) : "";
  const message = `${error?.message || ""} ${details}`.toLowerCase();
  if (!message.trim()) return false;
  if (status === 404) return /(model|image|endpoint).*(not found|unknown)|not found.*(model|image|endpoint)/.test(message);
  if ([400, 415, 422].includes(status)) {
    return /(unsupported|not support|not compatible|invalid model|unknown model|model_not_found|not listed|image_generation|image generation)/.test(message);
  }
  if (status === 503) {
    return /(no available compatible accounts|no compatible accounts|not compatible|image.*not available|gpt-image.*not available)/.test(message);
  }
  return false;
}

function normalizeRenderMode(mode) {
  return mode === "floorplan" ? "plan-render" : (mode || "plan-render");
}

const PLAN_TO_3D_FIXED_PROMPT = [
  "FIXED PLAN-TO-3D FLOOR PLAN PROMPT:",
  "Generate a realistic 3D floor plan from the uploaded black-and-white floor plan line drawing or colored floor plan.",
  "Treat the uploaded plan as locked base geometry, not as loose inspiration.",
  "Do not move, delete, simplify, redraw, crop, rotate, add or remove any room, wall, opening, door swing, window, stair, fixed fixture or major furniture footprint.",
  "Preserve the original outer contour, wall linework/thickness, room shapes, room adjacency, circulation, zoning, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation.",
  "Only extrude the existing 2D footprints into wall height, proportional furniture volumes, floor materials, wall finishes, subtle shadows and readable spatial depth.",
  "Camera must be a complete orthographic or weak-perspective top-down/isometric cutaway 3D floor-plan view with the full plan visible and minimal distortion.",
  "Final image must not be a flat 2D colored plan, not a human-eye interior render, not a redesigned layout, not a dramatic perspective scene and not a simplified new plan."
].join("\n");

function planWorkflowPromptConfig(mode) {
  mode = normalizeRenderMode(mode);
  const map = {
    "plan-axonometric": {
      step: 1,
      label: "平面图转3D平面图",
      input: "black-and-white architectural floor plan line drawing or colored architectural floor plan",
      output: "realistic 3D floor plan, orthographic/isometric top-down cutaway",
      preserve: "the original outer contour, wall linework/thickness, room shapes, room adjacency, openings, door swings, windows, stairs, circulation, zoning, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation exactly",
      transform: "extrude only the existing 2D footprints into realistic cutaway wall height, proportional furniture volumes, floor materials, wall finishes, subtle shadows and readable spatial depth",
      camera: "complete orthographic or weak-perspective top-down/isometric 3D floor-plan cutaway, full plan visible, minimal distortion",
      avoid: "no moved/deleted/simplified/redrawn rooms, no moved walls/openings/door swings, no eye-level render, no unrelated rotated/cropped perspective, no flat 2D-only colored plan, no layout drift, no invented room arrangement"
    },
    "plan-render": {
      step: 2,
      label: "3D平面图转效果图",
      input: "3D floor plan, selected 3D-floor-plan region, or legacy plan-based spatial reference when explicitly provided",
      output: "final human-eye architecture/interior effect render",
      preserve: "spatial relationship, selected zone, circulation, functional logic, main furniture or display arrangement, room adjacency and scale cues",
      transform: "translate only the selected or inferred target zone into an eye-level scene with camera position, foreground, midground, background, furniture systems, display objects, wall/ceiling/floor materials, lighting fixtures and controlled atmosphere",
      camera: "human-eye interior or architectural render camera, selected-area focus when a red-box region exists",
      avoid: "no blueprint lines, no plan symbols, no full-plan camera, no unclear source zone, no collage, no diagram, no distorted geometry"
    }
  };
  return map[mode] || null;
}

function finalOutputRuleForMode(mode) {
  const normalizedMode = normalizeRenderMode(mode);
  const planConfig = planWorkflowPromptConfig(normalizedMode);
  if (planConfig) {
    return `The final result must be ${planConfig.output}; camera rule: ${planConfig.camera}; avoid: ${planConfig.avoid}.`;
  }
  if (normalizedMode === "plan-axonometric") {
    return "The final result must be a realistic 3D floor plan: orthographic or weak-perspective top-down cutaway, visible wall height and furniture volumes, plan-faithful layout; not an eye-level render and not a flat 2D colored plan.";
  }
  if (normalizedMode === "materialboard") {
    return "The final result must be a polished visual material/color/FF&E board, not a single eye-level spatial render.";
  }
  return "The final result must be a finished architectural/interior visualization, not a diagram, not a floor plan, not a UI screenshot.";
}

function normalizeImageSize(size) {
  if (String(size || "").trim() === "auto") return "auto";
  const match = String(size || "").match(/^(\d+)x(\d+)$/);
  if (!match) return "1024x1024";
  let width = Number(match[1]);
  let height = Number(match[2]);
  if (!width || !height) return "1024x1024";
  const round16 = (value) => Math.min(3840, Math.max(640, Math.round(value / 16) * 16));
  width = round16(width);
  height = round16(height);
  const minPixels = 655360;
  const maxPixels = 8294400;
  if (width * height < minPixels) {
    const scale = Math.sqrt(minPixels / (width * height));
    width = round16(width * scale);
    height = round16(height * scale);
  }
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width = round16(width * scale);
    height = round16(height * scale);
  }
  if (Math.max(width, height) / Math.min(width, height) > 3) {
    if (width > height) height = round16(width / 3);
    else width = round16(height / 3);
  }
  return `${width}x${height}`;
}

function closestStandardImageSize(size) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/);
  if (!match) return "1024x1024";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "1024x1024";
  if (Math.abs(width - height) <= Math.max(width, height) * 0.08) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

function renderModeKnowledge(mode) {
  mode = normalizeRenderMode(mode);
  const map = {
    custom: {
      label: "自定义",
      purpose: "Free-form canvas generation without a fixed workflow; first infer the required artifact type from user text, optional primary image, reference images and canvas resources.",
      referenceFocus: "Read references holistically before assigning use: spatial layout, material, furniture, lighting, color, atmosphere, composition, detail, facade, landscape, product language, board content or edit target.",
      preserve: "No fixed preservation rule; preserve explicit user constraints and, if a primary image is uploaded, preserve only the subject, perspective, composition, spatial logic or design information the request depends on.",
      transform: "Generate the most useful artifact for the request: render, concept image, design board, material study, design series, edit, outpaint, facade, product scene, diagram-like visual or another clearly named visual output."
    },
    "plan-axonometric": {
      label: "平面图转3D平面图",
      purpose: "Use the fixed plan-to-3D prompt: treat the black-and-white floor plan or colored plan as locked base geometry and create a realistic 3D floor plan.",
      referenceFocus: "Use references only for material language, color and presentation quality after the input plan layout is locked; references must never override walls, openings or furniture footprints.",
      preserve: "Preserve the original outer contour, wall linework/thickness, room shapes, adjacency, openings, door swings, windows, stairs, circulation, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation exactly.",
      transform: "Only extrude the original 2D footprints into a realistic top-down/isometric 3D floor plan with wall height, proportional furniture volumes, floor/wall materials, subtle shadows and readable spatial depth."
    },
    "plan-render": {
      label: "3D平面图转效果图",
      purpose: "Generate the final eye-level architecture/interior effect render from a selected 3D floor-plan zone or, when no selection exists, from the clearest inferred functional zone.",
      referenceFocus: "Use references for materials, lighting, furniture, display language, palette and atmosphere, without overriding the 3D floor-plan spatial guide or target-zone location.",
      preserve: "Preserve the input image's spatial relationship, selected or inferred target zone, circulation, functional logic, key furniture/display arrangement, room adjacency and scale cues.",
      transform: "Translate only that target zone into a realistic human-eye render with a believable camera position, detailed foreground/midground/background, materials, lighting and presentation quality."
    },
    viewpoint: {
      label: "视角转换",
      purpose: "Treat the input image as an enterable spatial scene; use the user-marked standing point, image-depth coordinate, yaw direction and shift intensity to generate a new eye-level view from that position.",
      referenceFocus: "Use references only to support material, lighting, furniture, display language and atmosphere; never override the source image's spatial identity, design language, openings, major structure or marker-driven camera logic.",
      preserve: "Preserve the source image's spatial identity, main structure, openings, material system, lighting direction, furniture/display logic, scale cues and design atmosphere.",
      transform: "Change camera position and visible field only: infer walkable floor area, eye height, lens, view direction, foreground/midground/background and adjacent-space continuity from x/y/yaw/intensity marker data."
    },
    photo: {
      label: "现场图转效果图",
      purpose: "Use an existing site photo as the base condition and redesign finishes, lighting, furniture and atmosphere.",
      referenceFocus: "Use references as renovation direction for materials, lighting, furniture and styling.",
      preserve: "Preserve site perspective, envelope, openings, columns, ceiling height and major geometry.",
      transform: "Change finishes, FF&E, lighting hierarchy and visual mood."
    },
    whitemodel: {
      label: "白模润色",
      purpose: "Convert a white model screenshot into a realistic design visualization.",
      referenceFocus: "Use references to infer material realism, lighting, furniture density and environmental tone.",
      preserve: "Preserve massing, camera, openings, floor levels, proportions and design intent.",
      transform: "Add realistic materials, lighting, context, furniture and detail."
    },
    sketch: {
      label: "手稿生成实景",
      purpose: "Translate a sketch or line drawing into a realistic architectural/interior render.",
      referenceFocus: "Use references to fill in material, lighting, furniture, landscape and style details missing from the sketch.",
      preserve: "Preserve composition, perspective, main volumes and conceptual intent.",
      transform: "Convert drawn intent into a finished real-space visualization."
    },
    cadrender: {
      label: "CAD转效果图",
      purpose: "Read CAD linework as hard spatial constraints and create a realistic render.",
      referenceFocus: "Use references for finish palette, lighting, furniture systems, fixtures and commercial tone.",
      preserve: "Preserve axes, walls, openings, room adjacency and scale logic.",
      transform: "Turn technical linework into a polished visual scene."
    },
    designseries: {
      label: "生成设计系列",
      purpose: "Generate a deep one-to-many architecture/interior design series from one or more references: one unified project style expanded across multiple fields, viewpoints, angles and functional zones.",
      referenceFocus: "Read every reference as an open complete design reference, then extract a shared project DNA: spatial sequence, field/zone matrix, recurring motifs, material family, lighting philosophy, palette, furniture language, camera rhythm and render finish.",
      preserve: "Preserve useful design language from the references and keep one consistent project identity across all images: shared materials, lighting logic, color grading, furniture era, detail vocabulary, scale and presentation quality. Do not preserve one reference camera angle as the whole series.",
      transform: "Create different fields, spaces, functions and viewpoints that feel spatially connected, as if walking through one real project from arrival/public areas to secondary functions, quiet/support zones and detail moments."
    },
    upscale: {
      label: "画质增强",
      purpose: "Improve clarity and perceived quality of an existing image without redesigning it.",
      referenceFocus: "References can indicate target texture quality only; they must not override the original design.",
      preserve: "Preserve composition, geometry, objects, materials and subject matter.",
      transform: "Improve resolution feel, sharpness, noise control, local contrast and presentation quality."
    },
    detail: {
      label: "细节增强",
      purpose: "Add richer material, lighting, styling and display details while keeping the original image direction.",
      referenceFocus: "Use references to decide detail density, material tactility, display language and soft furnishing character.",
      preserve: "Preserve original layout, camera, walls, openings and main objects.",
      transform: "Enhance realism, craft, material texture and proposal readiness."
    },
    materialreplace: {
      label: "材质替换",
      purpose: "Replace material language on walls, floors, ceiling, furniture or selected areas while preserving structure.",
      referenceFocus: "Treat references primarily as new material, texture, color, reflectivity and craft direction.",
      preserve: "Preserve geometry, perspective, object placement, lighting direction and spatial relationship.",
      transform: "Change material finish, texture, color, reflectivity and junction details."
    },
    lightingadjust: {
      label: "灯光调整",
      purpose: "Change time of day, exposure, color temperature and lighting mood.",
      referenceFocus: "Use references to infer daylight, dusk, night, wall-wash, spotlight, hospitality or showroom lighting mood.",
      preserve: "Preserve space, materials, furniture, camera and composition.",
      transform: "Adjust exposure, shadows, highlights, indirect light, color temperature and fixture glow."
    },
    styletransfer: {
      label: "风格迁移",
      purpose: "Keep the spatial structure and composition while changing the overall style language.",
      referenceFocus: "Use references to define new material language, color palette, furniture, lighting fixtures and styling grammar.",
      preserve: "Preserve core structure, camera, scale, openings and circulation.",
      transform: "Replace overall style, finishes, furniture, lighting fixtures, soft furnishings and display atmosphere."
    },
    materialboard: {
      label: "材料板生成",
      purpose: "Synthesize uploaded images into a professional material, color, lighting and FF&E board.",
      referenceFocus: "References are primary input; decompose them into material samples, color swatches, textures, lighting and furniture language.",
      preserve: "Preserve design direction, palette and material logic from the references.",
      transform: "Create a visual proposal board instead of a single spatial render."
    },
    outpaint: {
      label: "扩图",
      purpose: "Extend an image boundary while preserving its original subject and visual logic.",
      referenceFocus: "Use references to maintain continuity in materials, lighting, composition and environment.",
      preserve: "Preserve original subject, perspective, style, materials and lighting.",
      transform: "Naturally complete surrounding architecture/interior space outside the original frame."
    },
    cad: {
      label: "平面图转CAD",
      purpose: "Extract clean CAD-like linework from a plan image for downstream tracing and visualization.",
      referenceFocus: "References should not affect CAD extraction; only the uploaded plan image matters.",
      preserve: "Preserve wall axes, main outlines, openings, room boundaries and drawing proportions where visible.",
      transform: "Convert raster plan information into simplified vector linework."
    },
    sharpen: {
      label: "提高锐化",
      purpose: "Improve edge clarity and local contrast with a local image-processing pass.",
      referenceFocus: "References should not affect local sharpening.",
      preserve: "Preserve all original pixels' subject matter, layout, color relationships and geometry.",
      transform: "Increase edge definition and perceived clarity without redesigning content."
    }
  };
  return map[mode] || map["plan-render"];
}

function modeOptimizationPlaybook(mode) {
  mode = normalizeRenderMode(mode);
  const map = {
    custom: [
      "Mode optimization - custom free canvas:",
      "- This is a default preset for open creation, not a hidden workflow. Do not assume a floor plan, site photo, interior render or fixed module unless the user says so.",
      "- First classify the requested artifact: spatial render, design series, material board, image edit, outpaint, product scene, facade, diagram-like visual, concept image or another explicit output.",
      "- Read the user message as the primary brief and classify every uploaded reference image by its most useful design contribution after observing it holistically.",
      "- If there is no primary image, generate directly from the text, references and canvas resources.",
      "- If there is a primary image, preserve only what the user asks to preserve or what the requested artifact depends on; otherwise use it as one reference among others.",
      "- Name the chosen output type in the final prompt so the image model does not drift into a generic interior render."
    ],
    "plan-axonometric": [
      "Mode optimization - floor plan to realistic 3D floor plan:",
      "- Use the fixed plan-to-3D prompt. Treat the uploaded floor plan as locked base geometry, not as loose inspiration.",
      "- Preserve outer contour, wall linework/thickness, room shapes, adjacency, openings, door swings, windows, stairs, circulation, visible labels/dimensions, fixed fixtures and main furniture footprints.",
      "- Use an orthographic or weak-perspective high oblique/isometric top-down camera with the full plan visible and minimal distortion.",
      "- Only extrude existing footprints into wall height, proportional furniture volumes, floor/wall materials, subtle shadows and spatial depth.",
      "- Reject any moved wall/opening/furniture, added or missing room, cropped plan, human-eye render, flat 2D colored plan or redesigned layout."
    ],
    "plan-render": [
      "Mode optimization - 3D floor plan / plan guide to final effect render:",
      "- This is step 2 of the current floor-plan workflow: 3D floor plan or selected 3D-plan zone to finished human-eye spatial render.",
      "- Use the selected region as the target zone when present; without a selection, infer one clear functional zone and state why it was chosen.",
      "- Preserve room relationships, target-zone location, circulation, adjacency, scale cues and main display/furniture logic.",
      "- Improve success rate by naming camera standing point, view direction, foreground, midground, background, furniture systems, materials, fixtures, lighting and clutter limits.",
      "- The output must make it clear which area of the 3D floor plan it represents; avoid full-plan views and leftover diagram symbols."
    ],
    viewpoint: [
      "Mode optimization - marked viewpoint transformation:",
      "- Treat the source image as a coherent spatial scene, not as a style-only reference.",
      "- The marker coordinates define camera standing point; yaw defines left/right viewing direction. The UI marker itself must not appear in the image.",
      "- Preserve the source structure, openings, material system, lighting direction, furniture/display logic, scale and design atmosphere.",
      "- Change only camera position and visible field; infer foreground, midground, background and adjacent-space continuity from the marked point.",
      "- Output a new eye-level view, not the original camera, not a floor plan, not a bird's-eye view and not a model viewport."
    ],
    cad: [
      "Mode optimization - plan image to CAD:",
      "- Prioritize long structural lines over texture, text, furniture symbols and shadows.",
      "- Keep line output simple and traceable; avoid overfitting noisy hatch patterns.",
      "- Separate wall-like continuous segments from labels and decorative marks.",
      "- The result should be useful as a first-pass underlay, not a perfect construction document."
    ],
    cadrender: [
      "Mode optimization - CAD to render:",
      "- Treat CAD linework as hard spatial constraint, then infer height, openings and camera.",
      "- Do not leave CAD strokes visible in the final render.",
      "- Use references to fill material and lighting only after preserving axes and room logic.",
      "- Make the render feel like a designed space, not a colored plan extrusion."
    ],
    designseries: [
      "Mode optimization - design series:",
      "- Read each reference image as a full open design reference; do not force fixed roles before composing the series.",
      "- First build a project bible: project DNA, spatial sequence, recurring signatures, continuity rules, material system, lighting system, palette and render finish.",
      "- Treat each output as one scene in a connected project walkthrough; assign an exact field category, spatial role and adjacency relation for every image.",
      "- Deep series means one style system across multiple fields, angles, viewpoints and functional zones; it is not one camera angle with multiple styles.",
      "- Build one visual language across all images: repeated material families, ceiling/wall/floor logic, furniture era, lighting temperature, detail vocabulary and camera rhythm.",
      "- Each image must vary function, viewpoint, focal zone or spatial scale while preserving shared project identity; never regenerate a different hotel/house/shop for each frame.",
      "- Include spatial linkage cues such as thresholds, corridors, repeated openings, exterior views, furniture families, ceiling details or recurring material joints.",
      "- Avoid readable labels, moodboard/collage layout, style drift, mixed render quality, unrelated standalone mood images and repeated hero compositions."
    ],
    photo: [
      "Mode optimization - site photo to render:",
      "- Preserve perspective, envelope, fixed openings, columns and major built constraints.",
      "- Redesign finish layers, lighting, furniture and display without breaking site geometry.",
      "- Keep existing photo scale cues; avoid impossible ceiling heights or shifted vanishing points.",
      "- Use references as renovation language, not as a replacement for the site."
    ],
    whitemodel: [
      "Mode optimization - white model polish:",
      "- Preserve massing, camera, openings and level changes from the model.",
      "- Add materials and lighting that explain the design, not random decoration.",
      "- Use restrained context, furniture or landscape only where it clarifies scale.",
      "- Avoid raw viewport artifacts, gray clay surfaces and untextured generic blocks."
    ],
    sketch: [
      "Mode optimization - sketch to real scene:",
      "- Preserve the sketch's composition, gesture, perspective and core idea.",
      "- Resolve ambiguous lines into plausible architecture and interior details.",
      "- Keep the final image realistic unless the user asks for sketch language.",
      "- Do not over-polish away the design intent; translate it into buildable form."
    ],
    upscale: [
      "Mode optimization - quality enhancement:",
      "- Preserve subject, geometry, composition, materials and object identity.",
      "- Improve clarity, noise, texture and local contrast without redesigning.",
      "- Avoid hallucinated new furniture, changed finishes or over-sharpened halos.",
      "- Prioritize natural professional presentation quality."
    ],
    detail: [
      "Mode optimization - detail enhancement:",
      "- If a selected area exists, enhance that area first and keep non-selected areas stable.",
      "- Preserve layout, camera, walls, openings, main objects and main design direction.",
      "- Add believable craft: texture, junctions, lighting layers, fixtures, styling objects and scale cues.",
      "- Increase detail density only where it supports function or material story.",
      "- Avoid clutter, random luxury props, moved architecture and decorative noise."
    ],
    materialreplace: [
      "Mode optimization - material replacement:",
      "- If a selected area exists, treat it as the target material area unless the user names another area.",
      "- Change only the requested material system: color, texture, pattern scale, reflectivity, roughness and craft details.",
      "- Preserve geometry, perspective, lighting direction, object placement, shadows and non-target areas.",
      "- Match replacement material to scale and construction logic.",
      "- Avoid changing the whole style unless explicitly requested."
    ],
    lightingadjust: [
      "Mode optimization - lighting adjustment:",
      "- Preserve space, materials, furniture, object placement, camera and non-lighting content.",
      "- Define one lighting condition: daylight, dusk, night, hospitality, showroom or task lighting.",
      "- Balance exposure, shadow softness, color temperature and fixture glow physically.",
      "- Avoid blown highlights, muddy shadows and inconsistent light directions."
    ],
    styletransfer: [
      "Mode optimization - style transfer:",
      "- Preserve architecture, scale, openings, perspective, circulation and main object positions.",
      "- Replace material system, furniture language, fixtures and styling grammar coherently.",
      "- Keep the new style buildable for the space type and audience.",
      "- Avoid superficial filter-like changes that only alter color, and avoid making the original space unrecognizable."
    ],
    materialboard: [
      "Mode optimization - material board:",
      "- Decompose references into materials, swatches, textures, lighting mood and FF&E language.",
      "- Create a proposal board with clear visual grouping and hierarchy.",
      "- Show material relationships, not isolated samples.",
      "- Avoid text-heavy labels, brand logos and random collage clutter."
    ],
    sharpen: [
      "Mode optimization - local sharpening:",
      "- Preserve original image content exactly.",
      "- Apply edge enhancement and local contrast conservatively.",
      "- Avoid halos, crunchy texture, color shifts and amplified noise.",
      "- Best used after or before AI output as a finishing pass."
    ],
    outpaint: [
      "Mode optimization - outpaint:",
      "- Preserve the original subject, vanishing points, perspective, lighting, material scale and camera logic.",
      "- Extend architecture or interior context naturally beyond the frame only; do not redraw the original subject.",
      "- Use references for continuity, not to replace the original scene.",
      "- Avoid seams, duplicated objects, distorted perspective and style drift."
    ]
  };
  return (map[mode] || map["plan-render"]).join("\n");
}

function normalizeReferenceWeight(value) {
  const weight = String(value || "default").toLowerCase();
  return ["default", "strong", "soft", "ignore"].includes(weight) ? weight : "default";
}

function normalizeReferenceUsage(value) {
  const usage = String(value || "auto").toLowerCase();
  return ["auto", "space", "material", "lighting", "color", "detail"].includes(usage) ? usage : "auto";
}

function referenceUsageMeta(value) {
  const map = {
    auto: {
      label: "auto intent",
      instruction: "the user did not assign a specific use; observe the image holistically before deciding usable contributions"
    },
    space: {
      label: "space/composition intent",
      instruction: "prioritize spatial organization, camera composition, scale cues, openings and circulation logic"
    },
    material: {
      label: "material/texture intent",
      instruction: "prioritize materials, texture scale, reflectivity, roughness, joinery and craft behavior"
    },
    lighting: {
      label: "lighting/atmosphere intent",
      instruction: "prioritize light timing, color temperature, contrast hierarchy, exposure and spatial mood"
    },
    color: {
      label: "color/furnishing intent",
      instruction: "prioritize palette relationships, furniture styling, soft goods, display density and color balance"
    },
    detail: {
      label: "detail/craft intent",
      instruction: "prioritize nodes, fixtures, edges, installation details, furniture details and finish quality"
    }
  };
  return map[normalizeReferenceUsage(value)] || map.auto;
}

function referenceWeightMeta(value) {
  const map = {
    default: {
      label: "default reference",
      instruction: "balanced influence; use visible design evidence only when it supports the user intent"
    },
    strong: {
      label: "priority reference",
      instruction: "higher influence; strongly absorb its design language, composition logic, material mood or quality benchmark without copying the exact image"
    },
    soft: {
      label: "light reference",
      instruction: "low influence; borrow only compatible cues and never override stronger inputs"
    },
    ignore: {
      label: "ignored reference",
      instruction: "do not use this image for the current generation"
    }
  };
  return map[normalizeReferenceWeight(value)] || map.default;
}

function activeReferenceImagesFromBody(body = {}) {
  return Array.isArray(body.referenceImages)
    ? body.referenceImages
        .slice(0, 8)
        .filter((reference) => reference?.dataUrl && normalizeReferenceWeight(reference.weight) !== "ignore")
        .map((reference) => ({
          ...reference,
          weight: normalizeReferenceWeight(reference.weight),
          usage: normalizeReferenceUsage(reference.usage)
        }))
    : [];
}

function referenceWeightSummary(references = []) {
  if (!references.length) return "none";
  return references
    .map((reference, index) => {
      const meta = referenceWeightMeta(reference.weight);
      return `reference ${index + 1}: ${meta.label}`;
    })
    .join("; ");
}

function referenceIntentSummary(references = []) {
  if (!references.length) return "none";
  return references
    .map((reference, index) => {
      const weight = referenceWeightMeta(reference.weight);
      const usage = referenceUsageMeta(reference.usage);
      return `reference ${index + 1}: ${weight.label}; ${usage.label}`;
    })
    .join("; ");
}

function referenceImageReadingProtocol({ references = [], referenceCount = 0 } = {}) {
  const count = references.length || referenceCount;
  if (!count) {
    return [
      "REFERENCE_IMAGE_PROTOCOL:",
      "- No secondary reference images were provided.",
      "- Infer visual direction from the user's brief, selected workflow button, canvas resources and project context."
    ].join("\n");
  }

  const indexed = references.length
    ? references.map((reference, index) => {
        const weight = referenceWeightMeta(reference.weight);
        const usage = referenceUsageMeta(reference.usage);
        return `- Reference image ${index + 1}: ${weight.label}; ${weight.instruction}. User intent label: ${usage.label}; ${usage.instruction}.`;
      })
    : [`- There are ${count} secondary reference images; read each as a complete open reference.`];

  return [
    "REFERENCE_IMAGE_PROTOCOL:",
    `- There are ${count} secondary reference image(s).`,
    "- First understand each image holistically: space, object system, material behavior, lighting, palette, camera, mood, craft, scene density and quality benchmark.",
    "- Do not pre-label references as material, furniture, lighting, color or atmosphere sources before observing them.",
    "- Treat usage labels as user intent and priority observation cues, not as hard classifications that erase other useful evidence.",
    "- After observing, decide what each image can safely contribute to the current user request.",
    "- Do not copy exact compositions, rooms, branded content, logos, watermarks or accidental artifacts from references.",
    ...indexed
  ].join("\n");
}

function inputImageOrderGuide(inputImages = []) {
  if (!inputImages.length) {
    return "Input image order: no uploaded image is attached to this reasoning request.";
  }
  return [
    "Input image order:",
    ...inputImages.map((image, index) => `- Image ${index + 1}: ${image.label || `input ${index + 1}`}`)
  ].join("\n");
}

function gptImage2CraftPrinciples({ mode } = {}) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  return [
    "GPT_IMAGE_2_CRAFT_PRINCIPLES:",
    "- Put canvas, aspect ratio, orientation and artifact type before subject description.",
    "- Prefer structured prompt blocks or config-like sections when the scene has many interacting systems.",
    "- Scene density beats vague adjectives: include concrete zones, furniture, surfaces, fixtures, openings, props and construction details when appropriate.",
    "- Camera context unlocks realism: specify eye-level/wide/close-up/low angle/lens feel/perspective discipline when useful; for floor-plan artifacts, top-down/orthographic rules override eye-level language.",
    "- For architecture/interior: define room or facade type, camera/lens feel, materials, light direction, negative space, shadows, scale and render finish.",
    "- Keep material, lighting and palette as separate controls; do not compress them into generic words such as premium, luxury or modern.",
    "- For edit workflows, name the target transformation first, then repeat invariants that must remain unchanged.",
    "- Use targeted avoid-lines only for likely failures: fake text, logos, watermarks, UI overlay, collage when a single render is needed, distorted geometry or over-stylized CGI.",
    ...communityPromptCompactRules(mode),
    `- Current workflow anchor: ${modeInfo.label} / ${modeInfo.purpose}`
  ].join("\n");
}

function promptContractControlLines(mode) {
  mode = normalizeRenderMode(mode);
  if (mode === "plan-axonometric") {
    return [
      "8) LOCKED PLAN GEOMETRY: preserve outer contour, wall linework/thickness, room shapes, room adjacency, openings, door swings, windows, stairs, circulation, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation.",
      "9) CAMERA: complete orthographic or weak-perspective top-down/isometric 3D floor-plan cutaway; full plan visible; no crop, no rotation change, no human-eye camera.",
      "10) MATERIALS: add believable floor, wall, furniture and built-in material cues only on the original locked footprints.",
      "11) LIGHTING: clean even render lighting that clarifies volumes; subtle shadows only; avoid dramatic eye-level lighting or strong sun glare.",
      "12) PALETTE: restrained coordinated material palette that supports plan readability without hiding the original layout.",
      "13) DETAIL DENSITY: enough proportional furniture volume, fixtures and surface detail to read scale, but no clutter or new objects that alter circulation.",
      "14) QUALITY: realistic 3D floor plan, crisp cut walls, readable wall height, stable geometry, plan-faithful layout and no layout drift.",
      "15) AVOID: no moved walls/openings/furniture, no added or missing rooms, no simplified/redesigned plan, no flat 2D-only plan, no final eye-level render, no rotated unrelated perspective."
    ];
  }
  if (mode === "materialboard") {
    return [
      "8) BOARD GRAMMAR: coordinated material samples, color swatches, texture close-ups, lighting mood and FF&E references.",
      "9) CAMERA: clean presentation-board composition, not an eye-level room camera.",
      "10) MATERIALS: show tactile surface behavior, edge details, grain, fabric, stone, metal, wood or plaster logic.",
      "11) LIGHTING: controlled studio-like presentation light that reveals material texture.",
      "12) PALETTE: 4-6 bounded colors with clear hierarchy and usable design relationships.",
      "13) DETAIL DENSITY: enough samples to communicate a system, no random collage clutter.",
      "14) QUALITY: refined design proposal board, balanced whitespace, no UI screenshot look.",
      "15) AVOID: no readable labels, no brand logos, no watermarks, no paragraph text."
    ];
  }
  if (mode === "designseries") {
    return [
      "8) SERIES DNA: define one shared project identity before image-specific details: spatial thesis, material family, palette, lighting logic, recurring motifs and render finish.",
      "9) SPATIAL SEQUENCE: treat this image as one stop in a connected walkthrough; state what space it comes from and what space it leads to.",
      "10) IMAGE ROLE: assign a clear field/function role to this output, such as arrival, public core, secondary function, quiet/private room, support space, transition corridor, facade or material moment.",
      "11) COMPOSITION: vary viewpoint, camera direction, focal zone or spatial scale while preserving the same project identity, camera rhythm, lens behavior and color grading.",
      "12) MATERIALS: repeat the same material system with controlled variation instead of inventing a new style per image.",
      "13) LIGHTING: keep one coherent lighting philosophy across the series, with compatible color temperature and exposure.",
      "14) DETAIL DENSITY: enough repeated design signatures to read as one project: thresholds, openings, ceiling detail, furniture family, lighting fixtures, joinery or landscape cues.",
      "15) AVOID: no unrelated styles, no copied reference composition, no same-angle style variations, no repeated hero composition, no text labels, no mixed render qualities, no isolated mood images."
    ];
  }
  if (mode === "plan-render") {
    return [
      "8) TARGET ZONE: use the selected red-box area when present; otherwise infer one clear functional zone from the 3D floor plan and make that source area explicit.",
      "9) CAMERA: human-eye architectural/interior camera from a believable standing point inside or just outside the target zone; no full-plan or top-down camera.",
      "10) SPATIAL FIDELITY: preserve room adjacency, circulation, openings, major furniture/display logic and scale cues from the 3D floor-plan guide.",
      "11) SCENE GRAMMAR: translate the zone into foreground, midground and background with clear view direction and depth.",
      "12) MATERIALS: use references for finish language only after target-zone geometry is stable.",
      "13) LIGHTING: controlled render lighting that clarifies the selected space and does not conflict with visible openings.",
      "14) QUALITY: realistic client-presentation effect render with crisp geometry and no plan-symbol residue.",
      "15) AVOID: no blueprint strokes, no plan labels, no diagram symbols, no unclear source zone, no copied reference room, no distorted perspective."
    ];
  }
  if (mode === "cadrender") {
    return [
      "8) CAD GEOMETRY: preserve axes, wall logic, openings, room adjacency, circulation and scale from the CAD/line drawing.",
      "9) CAMERA: choose a believable spatial camera only after linework relationships are understood.",
      "10) MATERIALS: add finishes and furniture without covering or contradicting the CAD spatial constraints.",
      "11) LIGHTING: use clean architectural render lighting that clarifies height, openings and depth.",
      "12) PALETTE: keep palette coherent with the brief and references after geometry is locked.",
      "13) DETAIL DENSITY: add enough fixtures and furniture for scale, not enough to hide layout mistakes.",
      "14) QUALITY: polished render derived from CAD, with stable geometry and no technical strokes visible.",
      "15) AVOID: no CAD lines in final image, no colored-plan extrusion, no arbitrary room changes."
    ];
  }
  if (mode === "photo") {
    return [
      "8) SITE INVARIANTS: preserve perspective, envelope, windows, doors, columns, ceiling height, scale cues and major geometry.",
      "9) CAMERA: keep the original camera logic and vanishing points unless the user explicitly asks for a new view.",
      "10) MATERIALS: redesign finishes as renovation layers over the existing structure.",
      "11) LIGHTING: improve ambience while respecting visible openings and plausible light direction.",
      "12) PALETTE: coordinate new palette with the retained site conditions.",
      "13) DETAIL DENSITY: add furniture, fixtures and styling that fit the existing scale and circulation.",
      "14) QUALITY: realistic renovated effect render, not a copied reference room.",
      "15) AVOID: no shifted windows/columns, no warped structure, no impossible ceiling changes."
    ];
  }
  if (mode === "whitemodel") {
    return [
      "8) MODEL INVARIANTS: preserve massing, levels, openings, camera, proportions and spatial hierarchy.",
      "9) CAMERA: keep the model's intended view unless the user asks for a new camera.",
      "10) MATERIALS: assign believable surfaces according to form, function and reference direction.",
      "11) LIGHTING: add controlled render lighting that reveals form and scale.",
      "12) PALETTE: avoid one-note gray; build a restrained material palette that clarifies design intent.",
      "13) DETAIL DENSITY: add context, furniture or landscape only where it supports scale and use.",
      "14) QUALITY: polished visualization with clean geometry and material behavior.",
      "15) AVOID: no raw viewport artifacts, no gray clay look, no random decoration."
    ];
  }
  if (mode === "sketch") {
    return [
      "8) SKETCH INVARIANTS: preserve composition, gesture, main volumes, intended openings, perspective and design idea.",
      "9) CAMERA: respect the sketch perspective or translate it into the closest plausible architectural camera.",
      "10) MATERIALS: resolve ambiguous lines into buildable surfaces and junctions.",
      "11) LIGHTING: choose lighting that supports the sketch's atmosphere without hiding the form.",
      "12) PALETTE: use a coherent palette that strengthens the concept rather than random realism.",
      "13) DETAIL DENSITY: add enough real-world detail to make the idea buildable, not enough to erase the sketch intent.",
      "14) QUALITY: realistic spatial visualization faithful to the sketch concept.",
      "15) AVOID: no generic room substitution, no impossible construction, no leftover sketch strokes unless requested."
    ];
  }
  if (mode === "upscale" || mode === "sharpen") {
    return [
      "8) RESTORATION INVARIANTS: preserve all content, composition, geometry, material identity, color relationships and camera.",
      "9) CAMERA: unchanged.",
      "10) MATERIALS: improve readability only; do not replace or reinterpret materials.",
      "11) LIGHTING: preserve lighting logic while improving exposure clarity when appropriate.",
      "12) PALETTE: preserve original color relationships and white balance naturally.",
      "13) DETAIL DENSITY: reveal existing detail; do not hallucinate new objects or design features.",
      "14) QUALITY: natural clarity, controlled denoising, crisp edges and no artificial finish.",
      "15) AVOID: no redesign, no new furniture, no halos, no amplified noise, no fake texture."
    ];
  }
  if (mode === "detail") {
    return [
      "8) DETAIL TARGET: enhance the selected area or named target first; if none exists, enhance the whole image conservatively.",
      "9) DETAIL INVARIANTS: preserve layout, camera, walls, openings, main objects, non-selected areas and design direction.",
      "10) CAMERA: unchanged.",
      "11) MATERIALS: add believable grain, joints, edge details, fixtures and tactile surface behavior.",
      "12) LIGHTING: enrich existing lighting layers without changing the scene identity.",
      "13) PALETTE: preserve palette while improving material nuance.",
      "14) QUALITY: richer but still clean and controlled design presentation.",
      "15) AVOID: no clutter, no moved architecture, no camera shift, no unrelated decoration."
    ];
  }
  if (mode === "materialreplace") {
    return [
      "8) EDIT TARGET: identify the exact material area or system to replace; use selected area as target when present unless the user names another target.",
      "9) CAMERA: preserve original camera, perspective and crop.",
      "10) MATERIALS: change only the target material's texture, color, reflectivity, pattern scale and junction logic.",
      "11) LIGHTING: preserve light direction and shadows; adapt material response physically.",
      "12) PALETTE: keep non-target colors stable unless the user requests coordinated adjustment.",
      "13) NON-TARGET AREAS: preserve geometry, furniture, object count, styling and all non-target surfaces.",
      "14) QUALITY: surgical material edit, unchanged structure and composition.",
      "15) AVOID: no full style transfer, no changed furniture, no geometry drift, no inconsistent scale."
    ];
  }
  if (mode === "lightingadjust") {
    return [
      "8) LIGHTING TARGET: define one lighting condition before visual details.",
      "9) CAMERA: unchanged.",
      "10) MATERIALS: preserve material identity while changing how light reveals it.",
      "11) LIGHTING: control exposure, color temperature, shadow softness, indirect light, fixture glow and highlight limits.",
      "12) PALETTE: preserve palette but let color temperature shift naturally with the lighting condition.",
      "13) NON-LIGHTING CONTENT: keep object placement, styling, geometry and material system unchanged.",
      "14) QUALITY: physically plausible, clean, balanced lighting edit.",
      "15) AVOID: no blown windows, no muddy shadows, no fantasy glow, no conflicting light directions."
    ];
  }
  if (mode === "styletransfer") {
    return [
      "8) STYLE TARGET: define the new style as a material, furniture, lighting and styling system.",
      "9) CAMERA: preserve original perspective, crop, scale and circulation.",
      "10) MATERIALS: replace surfaces and FF&E language coherently while respecting existing architecture.",
      "11) LIGHTING: adapt fixtures and ambience to the new style without changing spatial logic.",
      "12) PALETTE: build a bounded 4-6 color palette for the new style.",
      "13) INVARIANTS: preserve main object positions, openings, circulation and recognizable structure.",
      "14) QUALITY: recognizable same space with coherent new style.",
      "15) AVOID: no filter-only recolor, no surface-only reskin, no unbuildable overlay, no unrecognizable structure."
    ];
  }
  if (mode === "outpaint") {
    return [
      "8) OUTPAINT INVARIANTS: preserve original subject, perspective, vanishing points, lighting, material scale, camera height and style.",
      "9) CAMERA: continue the same lens and vanishing-point logic beyond the frame.",
      "10) MATERIALS: extend surfaces, edges and patterns with matching scale and construction logic.",
      "11) LIGHTING: continue light direction, color temperature and shadow softness.",
      "12) PALETTE: continue the existing palette without sudden hue shifts.",
      "13) EXPANSION AREA: add plausible surrounding context only outside the original frame without redrawing the original subject.",
      "14) QUALITY: seamless expansion with no boundary artifacts.",
      "15) AVOID: no seams, no repeated objects, no distorted perspective, no style drift."
    ];
  }
  return [
    "8) SCENE GRAMMAR: spatial layout, zones, circulation, openings, furniture/object placement and foreground/midground/background.",
    "9) CAMERA: viewpoint, lens feel, perspective discipline, crop and negative space.",
    "10) MATERIALS: exact surface system, texture, reflectivity, joinery, edge details and craft.",
    "11) LIGHTING: time/condition, color temperature, light direction, fixture logic, shadows, exposure and highlight control.",
    "12) PALETTE: 4-6 bounded colors with controlled contrast; avoid one-note palettes.",
    "13) DETAIL DENSITY: 5-12 concrete visible details that support function and design story, not random decoration.",
    "14) QUALITY: crisp geometry, believable material behavior, clean composition, low noise, professional presentation finish.",
    "15) AVOID: concise targeted negatives for this workflow."
  ];
}

function requiredVisualControlsForMode(mode) {
  mode = normalizeRenderMode(mode);
  if (mode === "plan-axonometric") {
    return "Required visual controls: locked input plan invariants, original linework/layout preservation, orthographic/weak-perspective 3D floor-plan camera, full-plan visibility, cut-wall height, proportional furniture volumes, material cues, even render lighting and avoid-lines for no moved walls/no missing rooms/no eye-level view/no layout drift.";
  }
  if (mode === "materialboard") {
    return "Required visual controls: board composition, material samples, texture close-ups, color swatches, lighting mood, FF&E references, visual hierarchy and avoid-lines for no text/logos/watermarks.";
  }
  if (mode === "designseries") {
    return "Required visual controls: project DNA, spatial sequence, field/function matrix, per-image role, adjacency cues, recurring signatures, shared material system, shared palette, shared lighting logic, camera rhythm, render finish and avoid-lines for no unrelated style drift/no same-angle variations/no repeated hero composition.";
  }
  if (mode === "plan-render") {
    return "Required visual controls: target zone selection or inferred functional zone, explicit source-area note, believable eye-level camera standing point, preserved 3D floor-plan adjacency/circulation/scale cues, foreground/midground/background, material and lighting system, and avoid-lines for no full-plan view/no plan symbols/no unclear source zone.";
  }
  if (mode === "viewpoint") {
    return "Required visual controls: marked camera standing point coordinates, yaw/view direction, eye-level camera height, changed camera position, preserved source-space structure/materials/lighting/furniture logic, inferred foreground/midground/background and avoid-lines for no UI marker/no visible person/no copied original camera/no bird's-eye view.";
  }
  if (mode === "cadrender") {
    return "Required visual controls: CAD linework invariants, axes/walls/openings/scale, inferred height, camera, material system, lighting and avoid-lines for no visible CAD strokes/no layout drift.";
  }
  if (mode === "photo") {
    return "Required visual controls: existing site perspective, envelope, openings, columns, ceiling height, unchanged camera, redesigned finishes, FF&E, lighting and avoid-lines for no shifted vanishing points.";
  }
  if (mode === "whitemodel") {
    return "Required visual controls: massing, camera, levels, openings, proportions, material assignment, context, lighting, scale cues and avoid-lines for no raw viewport/gray clay model look.";
  }
  if (mode === "sketch") {
    return "Required visual controls: sketch composition, perspective, major volumes, intended openings, buildable interpretation, materials, lighting and avoid-lines for no lost design intent.";
  }
  if (mode === "upscale" || mode === "sharpen") {
    return "Required visual controls: exact content preservation, no geometry/object/style changes, controlled clarity, denoising, local contrast, edge quality and avoid-lines for no halos/no fake detail.";
  }
  if (mode === "detail") {
    return "Required visual controls: selected or named detail target, preserved layout/camera/main objects/non-selected areas, material texture, edge joints, fixture/detail density, styling scale cues and avoid-lines for no clutter/no structural changes.";
  }
  if (mode === "materialreplace") {
    return "Required visual controls: target material area, preserved geometry/perspective/object placement/light direction/non-target areas, replacement texture scale, reflectivity, junction details and avoid-lines for no full redesign.";
  }
  if (mode === "lightingadjust") {
    return "Required visual controls: preserved space/materials/camera/object placement, selected lighting condition, exposure, shadow softness, color temperature, fixture logic and avoid-lines for no blown highlights/no muddy shadows.";
  }
  if (mode === "styletransfer") {
    return "Required visual controls: preserved architecture/camera/scale/circulation/main object positions, new style grammar, material system, furniture, lighting fixtures, palette and avoid-lines for no filter-only change.";
  }
  if (mode === "outpaint") {
    return "Required visual controls: preserved subject/vanishing points/perspective/material scale/light direction, extended surrounding context outside the original frame, matched geometry, matched surfaces and avoid-lines for no seams/no repeated objects.";
  }
  return "Required visual controls: specify spatial layout, camera/lens feel, material system, lighting system, color palette, styling details, realism constraints, and avoid-lines.";
}

function promptEngineV2Contract({ mode, brief = {}, intent = "", referenceCount = 0, references = [], selection = null } = {}) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  const artifact = mode === "materialboard"
    ? "professional visual material board"
    : mode === "plan-axonometric"
    ? "realistic 3D floor plan"
    : mode === "plan-render"
    ? "final eye-level architecture/interior effect render"
    : mode === "viewpoint"
    ? "new eye-level view from the marked camera standing point"
    : mode === "designseries"
    ? "single finished scene belonging to a coherent design series"
    : mode === "custom"
    ? "the most useful visual artifact implied by the user's request"
    : "finished architecture/interior visualization";

  const controlLines = promptContractControlLines(mode);
  return [
    "PROMPT_ENGINE_V2_FINAL_PROMPT_CONTRACT:",
    "Write final_prompt as a production-ready GPT-Image-2 instruction, not as analysis.",
    "Use this order in the final prompt:",
    "1) CANVAS: aspect ratio, orientation, image count for this request, and artifact type.",
    `2) TASK: selected workflow is ${modeInfo.label}; operation is ${modeInfo.purpose}.`,
    `3) PROJECT: ${brief.projectName || "spatial design project"}; ${brief.spaceType || "space type unspecified"}; ${brief.location || "location unspecified"}; target users ${brief.audience || "unspecified"}.`,
    "4) REFERENCES: summarize how uploaded images should influence the output, using the reference weights and visible evidence.",
    `5) PRESERVE: ${modeInfo.preserve}`,
    `6) TRANSFORM: ${modeInfo.transform}`,
    selection
      ? `7) SELECTED AREA: focus on normalized region x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}, while preserving whole-space logic.`
      : "7) SELECTED AREA: none; choose the most communicative overall composition.",
    ...controlLines,
    ...communityPromptCompactRules(mode),
    ...communityPromptBlueprintLines(mode),
    ...communityPromptPreflightLines(mode),
    `Artifact decision: ${artifact}.`,
    referenceImageReadingProtocol({ references, referenceCount }),
    gptImage2CraftPrinciples({ mode }),
    `User intent to respect: ${intent || brief.constraints || "produce a practical, elegant concept render"}.`
  ].join("\n");
}

function promptEngineV2CompactReference(mode) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  return [
    "PROMPT_ENGINE_V2_COMPACT_REFERENCE:",
    `- Follow the single full prompt contract from GPT-IMAGE-2 PROMPT FUSION METHOD for ${modeInfo.label}; do not repeat the full contract in this layer.`,
    `- Preserve: ${modeInfo.preserve}`,
    `- Transform: ${modeInfo.transform}`,
    ...communityPromptCompactRules(mode)
  ].join("\n");
}

function gptImage2PromptFusionGuide({ mode, referenceCount = 0, references = [] } = {}) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  const referenceProtocol = referenceImageReadingProtocol({ references, referenceCount });
  return [
    "GPT-IMAGE-2 PROMPT FUSION METHOD V2:",
    gptImage2CraftPrinciples({ mode }),
    communityPromptLibraryBlock({ mode, referenceCount, references }),
    "1) Start with the canvas and output purpose: aspect ratio, image type, audience, and whether this is a render, edit, board, or enhancement.",
    `2) Apply the selected workflow button semantics: ${modeInfo.label} means ${modeInfo.purpose}`,
    "3) Read reference images openly before writing the final image prompt:",
    `If a primary input image exists, preserve or transform it according to the selected workflow. ${modeInfo.preserve}`,
    "For reference-only workflows, treat every uploaded image as an open reference rather than a primary image.",
    referenceProtocol,
    `4) Decide the operation boundary: preserve ${modeInfo.preserve}; change ${modeInfo.transform}.`,
    "5) For architecture/interior images, separate these controls instead of merging them into vague words:",
    "- Spatial layout: room type, zones, circulation, openings, scale, furniture placement.",
    "- Camera and composition: eye-level / low / wide / close-up, lens feel, perspective lines, negative space.",
    "- Materials: exact surfaces, texture, reflectivity, joinery, tactile details.",
    "- Lighting: time of day, color temperature, direction, shadow quality, practical fixtures, indirect light.",
    "- Palette: 4 to 6 bounded colors, not a one-note palette.",
    "- Styling/details: props, greenery, signage, display contents, people only when useful for scale.",
    "6) For edit-like workflows, be surgical: name the target transformation first, then repeat invariants that must stay unchanged.",
    "7) End with targeted avoid-lines: no watermark, no fake logos, no UI overlay, no unreadable random text, no diagram unless the workflow is a board/diagram."
  ].join("\n");
}

function designerAgentAestheticRubric() {
  return [
    "DESIGNER_AGENT_AESTHETIC_RUBRIC:",
    "- Spatial order: the image must show a clear plan logic, circulation, focal zone and relationship between zones.",
    "- Proportion and scale: furniture, openings, ceiling height, objects and people-for-scale must feel plausible.",
    "- Material authenticity: surfaces need believable grain, reflectivity, edge details, joints, seams and craft.",
    "- Lighting hierarchy: one dominant lighting idea, controlled exposure, physical shadows, practical fixtures and indirect light.",
    "- Palette control: 4 to 6 bounded colors; avoid one-note palettes, random accents and oversaturated rendering.",
    "- Composition: strong camera position, readable depth, leading lines, foreground/midground/background and intentional negative space.",
    "- Contextual fit: style must fit the space type, audience, climate/city context, operation scenario and user intent.",
    "- Design restraint: remove decorative noise; keep only details that support function, story, material or scale.",
    "- Feasibility: avoid impossible structures, fake construction details, irrational furniture placement and unbuildable lighting.",
    "- Image quality: no watermark, no fake logos, no UI overlay, no random text, no distorted geometry, no AI-glossy clutter."
  ].join("\n");
}

function designerAgentThinkingModel({ mode, brief = {}, intent = "", referenceCount = 0, references = [], selection = null } = {}) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  return [
    "DESIGNER_AGENT_COGNITION_MODEL:",
    "Identity: act as a senior spatial designer, art director and design critic, not a generic image prompt writer.",
    `Workflow button: ${modeInfo.label}; purpose: ${modeInfo.purpose}`,
    `Project read: ${brief.projectName || "unnamed project"} / ${brief.spaceType || "space type unspecified"} / ${brief.area || "area unspecified"} / ${brief.location || "location unspecified"} / audience: ${brief.audience || "unspecified"}.`,
    `User intent: ${intent || brief.constraints || "produce a practical, elegant concept render"}.`,
    referenceImageReadingProtocol({ references, referenceCount }),
    modeOptimizationPlaybook(mode),
    promptEngineV2CompactReference(mode),
    selection
      ? "There is a selected region; judge the local design move while preserving the whole-space logic."
      : "No selected region; choose the most useful overall view for design communication.",
    "Thinking sequence:",
    "1) Diagnose the input image: geometry, envelope, openings, circulation, functional zones, existing constraints and visual risks.",
    "2) Read each reference image as a full design reference; only extract spatial language, composition, material, lighting, object systems or atmosphere when it is actually relevant.",
    "3) Decide preserve vs transform boundaries according to the selected workflow; never let style override spatial constraints.",
    "4) Build one clear design thesis before adding details: spatial mood, focal point, material story, lighting story and camera story.",
    "5) Choose materials and palette as a coordinated system, not isolated trendy finishes.",
    "6) Self-critique the proposal with the aesthetic rubric; revise weak points before writing final_prompt.",
    "7) Write final_prompt as a production-ready gpt-image-2 instruction with explicit layout, camera, materials, lighting, palette, invariants and avoid-lines.",
    designerAgentAestheticRubric()
  ].join("\n");
}

function architectureInteriorPromptSchema({ mode, brief, intent, referenceCount = 0, references = [], selection }) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  const ratioMatch = String(intent || "").match(/图片比例：([^；\n]+)/);
  const sizeMatch = String(intent || "").match(/尺寸：([^；\n]+)/);
  return [
    "ARCHITECTURE_INTERIOR_PROMPT_SCHEMA:",
    `Artifact: ${modeInfo.label} output for ${brief.spaceType || "architecture/interior spatial design"}.`,
    `Canvas: ${ratioMatch ? ratioMatch[1] : "use requested aspect ratio"}; target size: ${sizeMatch ? sizeMatch[1] : "requested size"}.`,
    `Project context: ${brief.projectName || "spatial design project"}; ${brief.area || "area unspecified"}; ${brief.location || "location unspecified"}.`,
    `Audience/use case: ${brief.audience || "designer/client presentation"}.`,
    `Primary operation: ${modeInfo.purpose}`,
    `Preserve: ${modeInfo.preserve}`,
    `Transform: ${modeInfo.transform}`,
    selection
      ? `Selected region: x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}; focus the generated view on this zone while respecting the whole-space logic.`
      : "Selected region: none; generate the most useful overall view for this workflow.",
    referenceImageReadingProtocol({ references, referenceCount }),
    `Reference use: ${modeInfo.referenceFocus}`,
    modeOptimizationPlaybook(mode),
    `Designer/user intent: ${intent || brief.constraints || "produce a practical, elegant concept render"}.`,
    promptEngineV2CompactReference(mode),
    requiredVisualControlsForMode(mode),
    qualityTargetForMode(mode)
  ].join("\n");
}

async function saveGeneratedImage({ buffer, slug, meta, extra = {} }) {
  await fs.mkdir(generatedDir, { recursive: true });
  const fileName = `${Date.now()}-${slug}-${randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(generatedDir, fileName);
  const sidecarMeta = {
    ...meta,
    ...(extra.imageApi ? { image_api: extra.imageApi } : {}),
    ...(extra.actualParams ? { actual_params: extra.actualParams } : {}),
    ...(extra.revisedPrompt ? { revised_prompt: extra.revisedPrompt } : {})
  };
  await fs.writeFile(filePath, buffer);
  await fs.writeFile(filePath.replace(/\.png$/, ".json"), JSON.stringify(sidecarMeta, null, 2));

  return {
    url: `/generated/${fileName}`,
    file: filePath,
    bytes: buffer.length,
    model: config.imageModel,
    reasoningModel: config.reasoningModel,
    endpoint: extra.endpoint || config.imageProvider.baseUrl,
    ...extra
  };
}

function primaryInstructionForCustomPrompt(referenceCount) {
  return referenceCount
    ? "The uploaded images may all be references; do not require a separate primary image. Do not assign fixed roles before composing."
    : "No uploaded image is required in this mode; a text-only request is valid.";
}

function outputInstructionForMode(mode) {
  mode = normalizeRenderMode(mode);
  if (mode === "plan-axonometric") {
    return "Output must be a realistic 3D floor plan from the locked uploaded plan geometry: complete orthographic/isometric top-down cutaway, full plan visible, preserved linework/layout relationships, visible wall height, proportional furniture volumes and materials; not a flat 2D plan, not an eye-level render and not a redesigned layout.";
  }
  if (mode === "plan-render") {
    return "Output must be a final human-eye architecture/interior effect render derived from the selected or inferred zone of a 3D floor plan or plan-based spatial guide; it must be clear which area it represents; not a diagram, not a floor plan, not a collage.";
  }
  if (mode === "viewpoint") {
    return "Output must be a new eye-level architecture/interior view from the marked camera standing point in the source image: same spatial scene and design language, changed camera position and visible field; not the original camera copied, not a floor plan, not a bird's-eye view, not a UI screenshot and no visible marker/person.";
  }
  if (mode === "materialboard") {
    return "Output must be a visual board/collage with material samples, color swatches, lighting mood and furniture references.";
  }
  if (mode === "designseries") {
    return "Output must be one finished image in a connected deep architecture/interior design series: same project DNA, believable spatial sequence, shared material system, recurring design signatures, lighting logic, palette, camera rhythm and render finish; this image must represent a distinct field/function/viewpoint in the series, not an unrelated standalone mood image, not a same-angle style variation and not a collage.";
  }
  if (mode === "cadrender") {
    return "Output must be a realistic architecture/interior render derived from CAD linework; preserve axes, walls, openings and room logic, with no visible CAD strokes in the final image.";
  }
  if (mode === "photo") {
    return "Output must be a renovated site-photo-based effect render: preserve the original perspective and built envelope while redesigning finishes, furniture, lighting and atmosphere.";
  }
  if (mode === "whitemodel") {
    return "Output must be a polished realistic render from the white model: preserve massing and camera, add believable materials, lighting, environment and scale cues; not a raw gray model viewport.";
  }
  if (mode === "sketch") {
    return "Output must be a realistic render translated from the sketch: preserve composition, perspective and design intent while resolving ambiguous lines into buildable architecture/interior form.";
  }
  if (mode === "upscale") {
    return "Output must be an enhanced version of the same image: same content, same geometry, same composition, better clarity, noise control, material readability and presentation quality.";
  }
  if (mode === "sharpen") {
    return "Output must be a controlled sharpened version of the same image: same content, same geometry, same composition and same color relationships, with clearer edges and local contrast only.";
  }
  if (mode === "detail") {
    return "Output must be a detail-enhanced version of the same scene: selected or named target enhanced first, preserved layout, camera, non-selected areas and main objects, richer material texture, junctions, fixtures, styling and scale cues; not a redesign.";
  }
  if (mode === "materialreplace") {
    return "Output must be a material-replacement edit: preserve geometry, perspective, object placement, light direction and non-target areas while changing only the targeted material system.";
  }
  if (mode === "lightingadjust") {
    return "Output must be a lighting-adjusted edit: preserve space, furniture, materials, object placement and camera while changing exposure, color temperature, shadow quality and fixture/ambient light behavior.";
  }
  if (mode === "styletransfer") {
    return "Output must be a style-transfer edit: preserve architecture, camera, scale, circulation and main object positions while replacing material language, furniture, fixtures, palette and styling coherently.";
  }
  if (mode === "outpaint") {
    return "Output must be an expanded version of the original image: preserve the subject, vanishing points, perspective, lighting and material scale while naturally extending only the surrounding architecture/interior context beyond the frame.";
  }
  return "Output must be a finished spatial render, not a diagram, not a floor plan, not a collage.";
}

function creationInstructionForMode(mode) {
  mode = normalizeRenderMode(mode);
  if (mode === "plan-axonometric") return "Create a polished realistic 3D floor plan for a professional spatial designer.";
  if (mode === "plan-render") return "Create a realistic human-eye architecture/interior effect render from the provided 3D floor plan or plan-based spatial guide.";
  if (mode === "viewpoint") return "Create a new realistic eye-level architecture/interior view from the user-marked camera standing point in the provided spatial source image.";
  if (mode === "materialboard") return "Create a polished visual material and color board for a professional spatial designer.";
  if (mode === "custom") return "Create the most useful visual response for the user's request: spatial render, concept image, design board, material study, mood image, detail view, facade, product scene, edit, outpaint or design series.";
  if (mode === "designseries") return "Create one polished image that clearly belongs to one connected architecture/interior project series, with visible spatial continuity to the other images and a distinct field, function, viewpoint or spatial scale.";
  if (mode === "cadrender") return "Create a realistic architecture/interior render from the provided CAD or linework constraints.";
  if (mode === "photo") return "Create a renovated effect render from the provided site photo while preserving real site geometry.";
  if (mode === "whitemodel") return "Create a polished realistic visualization from the provided white model screenshot.";
  if (mode === "sketch") return "Create a realistic architectural/interior visualization from the provided sketch while preserving its design intent.";
  if (mode === "upscale") return "Create a quality-enhanced version of the provided image without changing its design.";
  if (mode === "sharpen") return "Create a controlled sharpened version of the provided image without changing its design, geometry, composition or color relationships.";
  if (mode === "detail") return "Create a detail-enhanced version of the provided image without changing the core layout, camera, non-selected areas or main object identity.";
  if (mode === "materialreplace") return "Create a targeted material-replacement edit of the provided image with unchanged geometry, perspective, object placement and non-target areas.";
  if (mode === "lightingadjust") return "Create a lighting-adjusted edit of the provided image with unchanged space, material system, object placement and camera.";
  if (mode === "styletransfer") return "Create a coherent style-transfer edit of the provided image with unchanged spatial structure, camera and main object positions.";
  if (mode === "outpaint") return "Create an outpainted expansion of the provided image with continuous vanishing points, perspective, lighting and materials.";
  return "Create a realistic architectural/interior design effect rendering for a professional spatial designer.";
}

function qualityTargetForMode(mode) {
  mode = normalizeRenderMode(mode);
  if (mode === "plan-axonometric") {
    return "Quality target: realistic 3D floor plan, locked plan-faithful layout, unchanged wall/opening/furniture footprints, orthographic/isometric top-down view, full-plan readability, readable wall height, proportional furniture volumes, believable material cues, clean lighting and no layout drift.";
  }
  if (mode === "plan-render") {
    return "Quality target: final human-eye architecture/interior effect render, faithful to the input 3D floor plan or plan guide, clear target zone, believable camera standing point, believable scale, detailed foreground/midground/background, controlled lighting, no plan-symbol residue and crisp client-presentation finish.";
  }
  if (mode === "viewpoint") {
    return "Quality target: a believable new eye-level view from the marked standing point, same source-space identity and design language, stable perspective, plausible eye height, coherent foreground/midground/background, preserved materials/lighting/furniture logic, no UI marker, no person, no copied original camera and no warped geometry.";
  }
  if (mode === "materialboard") {
    return "Quality target: refined visual material board, coordinated samples, restrained palette, tactile texture evidence, balanced spacing, no labels, no logos and no UI screenshot feel.";
  }
  if (mode === "designseries") {
    return "Quality target: coherent connected project series language, consistent palette/materials/lighting/render finish, recurring design signatures, believable adjacency between spaces, varied field/function/viewpoint roles, client-presentation clarity, no collage drift, no unrelated styles and no repeated same-angle hero composition.";
  }
  if (mode === "cadrender") {
    return "Quality target: CAD-faithful spatial render, stable walls/openings/scale, no visible linework, believable height and materials, clean lighting and professional presentation finish.";
  }
  if (mode === "photo") {
    return "Quality target: renovation render faithful to site perspective and envelope, believable scale, coherent material upgrades, controlled lighting, no warped structure or shifted openings.";
  }
  if (mode === "whitemodel") {
    return "Quality target: massing-faithful realistic render, believable material assignment, refined context, controlled lighting, clear scale cues, no raw viewport artifacts or generic clay model look.";
  }
  if (mode === "sketch") {
    return "Quality target: sketch-faithful realistic visualization, preserved composition and idea, plausible construction, coherent materials and lighting, no over-polished loss of intent.";
  }
  if (mode === "upscale") {
    return "Quality target: same image with higher perceived resolution, cleaner noise, better white balance, natural local contrast, improved material readability, no added objects or redesign.";
  }
  if (mode === "detail") {
    return "Quality target: same scene with richer craft detail on the selected or implied target, material grain, edge joints, fixtures, styling and scale cues, controlled density, no clutter, no non-target changes and no geometry changes.";
  }
  if (mode === "materialreplace") {
    return "Quality target: believable replacement material scale, reflectivity, texture and junctions, unchanged geometry/perspective/shadows/non-target areas, no unintended style transfer.";
  }
  if (mode === "lightingadjust") {
    return "Quality target: physically plausible lighting condition, balanced exposure, controlled highlights, clean shadows, consistent color temperature, unchanged object placement and unchanged spatial identity.";
  }
  if (mode === "styletransfer") {
    return "Quality target: coherent new style system with preserved structure, camera and main object positions, buildable materials, furniture and lighting, not a superficial color filter.";
  }
  if (mode === "outpaint") {
    return "Quality target: seamless expansion, matched vanishing points and perspective, continuous materials and lighting, plausible surrounding context outside the original frame, no repeated objects, no boundary seams and no distorted geometry.";
  }
  return "Quality target: photorealistic architectural visualization, believable material behavior, crisp geometry, controlled scene density, realistic shadows, professional presentation finish.";
}

function buildRenderPrompt({ mode, brief, intent, selection, viewpoint = null, referenceCount, references = [] }) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  const workflowConfig = planWorkflowPromptConfig(mode);
  const fusionGuide = gptImage2PromptFusionGuide({ mode, referenceCount, references });
  const spatialSchema = architectureInteriorPromptSchema({ mode, brief, intent, referenceCount, references, selection });
  const designerThinking = designerAgentThinkingModel({ mode, brief, intent, referenceCount, references, selection });
  const common = [
    fusionGuide,
    "",
    spatialSchema,
    "",
    designerThinking,
    "",
    `Selected UI workflow button: ${modeInfo.label}.`,
    `Button meaning: ${modeInfo.purpose}`,
    `Reference-reading rule for this button: ${modeInfo.referenceFocus}`,
    `Preserve priority: ${modeInfo.preserve}`,
    `Transformation priority: ${modeInfo.transform}`,
    `Reference weights: ${referenceWeightSummary(references)}`,
    `Reference usage intent: ${referenceIntentSummary(references)}`,
    "Before calling image_generation, internally inspect the primary input image, identify what every reference image contributes, and combine that reading with the selected button meaning.",
    "The final prompt sent to image_generation must reflect the selected button's purpose; do not treat all buttons as generic image generation.",
    "Do not expose hidden chain-of-thought; if a rationale is returned, summarize only the design decisions.",
    creationInstructionForMode(mode),
    `Project: ${brief.projectName || "spatial design project"}.`,
    `Space type: ${brief.spaceType || "unspecified"}. Area: ${brief.area || "unspecified"}. Location: ${brief.location || "unspecified"}.`,
    `Target users: ${brief.audience || "unspecified"}. Style intent: ${brief.style || "unspecified"}.`,
    `Functional requirements: ${brief.functions || "unspecified"}.`,
    `Designer notes: ${intent || brief.constraints || "produce a practical, elegant concept render"}.`,
    referenceCount
      ? `Use the additional ${referenceCount} reference image(s) as open references. Do not limit them to material, palette, furniture or lighting; decide what they contribute from the user's instruction and visible content.`
      : "No extra reference images were provided; infer a coherent material and lighting direction.",
    mode === "custom"
      ? "Output type is open; choose the format that best matches the user's instruction and reference images."
      : outputInstructionForMode(mode),
    communityPromptBlueprintLines(mode).join("\n"),
    communityPromptPreflightLines(mode).join("\n"),
    "No watermark, no readable text, no logos, no UI overlay."
  ];

  if (mode === "custom") {
    return [
      "The user selected custom free-canvas mode.",
      "There is no fixed workflow restriction: do not assume floor plan, CAD, site photo, material board, style transfer, or outpaint unless the user's message implies it.",
      primaryInstructionForCustomPrompt(referenceCount),
      "Use the user's text as the main brief. Use uploaded reference images as open visual/design references without assigning fixed roles.",
      "If there is no primary image, generate directly from the brief, references, canvas resources, selected aspect ratio and quality settings.",
      "Choose the most useful output type for the request and make the final image feel intentional, designer-led and presentation-ready.",
      ...common
    ].join("\n");
  }

  if (mode === "plan-axonometric") {
    return [
      PLAN_TO_3D_FIXED_PROMPT,
      "",
      `Workflow config: step ${workflowConfig.step}, ${workflowConfig.label}; input ${workflowConfig.input}; output ${workflowConfig.output}.`,
      `Preserve from config: ${workflowConfig.preserve}.`,
      `Transform from config: ${workflowConfig.transform}.`,
      `Camera/output rule from config: ${workflowConfig.camera}. Avoid: ${workflowConfig.avoid}.`,
      "The first input image is a black-and-white architectural floor plan line drawing or a colored floor plan.",
      "This workflow converts the input plan into a realistic 3D floor plan, not a flat colored plan and not an eye-level render.",
      "Use the input plan as a hard locked layout reference. Preserve all visible linework relationships, room relationships, wall boundaries, door/window openings, door swings, circulation, zoning and major furniture/display footprints.",
      "Use an orthographic or high oblique isometric top-down 3D floor-plan camera with minimal perspective distortion and clear full-layout readability.",
      "Add plausible wall height, proportional furniture volumes, floor materials, surface finishes, ceiling/lighting cues and spatial depth while keeping every footprint plan-faithful.",
      "Do not make a human-eye view render; do not rotate or crop the space into an unrelated perspective; do not leave it as a flat 2D color plan; do not invent, simplify or redesign the floor plan.",
      ...common
    ].join("\n");
  }

  if (mode === "plan-render") {
    const selectionText = selection
      ? `The user selected a normalized region x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}. Generate the final eye-level render for this zone while preserving its relationship to the surrounding 3D floor plan or plan-based spatial guide.`
      : "No region was selected. Infer one clear functional zone from the 3D floor plan or plan-based spatial guide, then generate a final eye-level render for that zone and state the area source in the prompt.";
    return [
      `Workflow config: step ${workflowConfig.step}, ${workflowConfig.label}; input ${workflowConfig.input}; output ${workflowConfig.output}.`,
      `Preserve from config: ${workflowConfig.preserve}.`,
      `Transform from config: ${workflowConfig.transform}.`,
      `Camera/output rule from config: ${workflowConfig.camera}. Avoid: ${workflowConfig.avoid}.`,
      "The first input image is a 3D floor plan or selected plan-based spatial reference; legacy flat or colored plans may be used only when explicitly uploaded.",
      "This is step 2 of the current floor-plan workflow: 3D spatial guide to final human-eye architecture/interior effect render.",
      selectionText,
      "Preserve the spatial relationship, target-zone location, circulation, functional logic, main display/furniture arrangement, room adjacency and scale cues from the input image.",
      "Improve success rate by describing the target scene in concrete elements: camera standing point, view direction, foreground, midground, background, furniture systems, display objects, wall/ceiling/floor materials, lighting fixtures, color temperature and clutter limits.",
      "Do not reproduce blueprint lines, plan symbols or a full-plan camera in the final image. The output must be a realistic client-presentation effect render with a clear source zone.",
      ...common
    ].join("\n");
  }

  if (mode === "viewpoint") {
    const hasPoint = viewpoint && typeof viewpoint === "object";
    const x = Number(viewpoint?.x);
    const y = Number(viewpoint?.y);
    const yaw = Number(viewpoint?.yaw || 0);
    const intensity = String(viewpoint?.intensity || "medium");
    const normalizedX = Number.isFinite(x) ? Math.max(0.05, Math.min(0.95, x)) : null;
    const normalizedY = Number.isFinite(y) ? Math.max(0.08, Math.min(0.94, y)) : null;
    const normalizedYaw = Number.isFinite(yaw) ? Math.max(-135, Math.min(135, Math.round(yaw))) : 0;
    const horizontal = normalizedX == null ? "unknown horizontal position" : normalizedX < 0.34 ? "left side of the image" : normalizedX > 0.66 ? "right side of the image" : "center area of the image";
    const depth = normalizedY == null ? "unknown depth" : normalizedY < 0.34 ? "far/deep part of the scene" : normalizedY > 0.66 ? "near foreground / viewer-side part of the scene" : "middle-depth part of the scene";
    const direction = normalizedYaw <= -75
      ? "strongly looking left from the standing point"
      : normalizedYaw <= -25
        ? "looking toward the left-front diagonal"
        : normalizedYaw >= 75
          ? "strongly looking right from the standing point"
          : normalizedYaw >= 25
            ? "looking toward the right-front diagonal"
            : "looking forward into scene depth";
    const intensityRule = intensity === "small"
      ? "Viewpoint shift intensity: small. Stay conservative, keep close to visible source evidence, prioritize spatial/material stability over dramatic change."
      : intensity === "large"
        ? "Viewpoint shift intensity: large. Allow a clearly different camera position and plausible reconstruction of hidden side surfaces, but do not alter the source architecture, material system or design identity."
        : "Viewpoint shift intensity: medium. Create a clearly new view while keeping source-scene identity stable.";
    const point = hasPoint
      ? `x=${normalizedX ?? viewpoint.x}, y=${normalizedY ?? viewpoint.y}, yaw=${normalizedYaw} degrees, intensity=${intensity}`
      : "not provided; infer a useful eye-level standing point from the user's instruction";
    return [
      "The first input image is a spatial source image to reinterpret from a new camera position.",
      `VIEWPOINT_MARKER: ${point}. This marker is a UI control only; never render it, never render a person, mannequin, arrow, dot, label or overlay.`,
      hasPoint ? `Spatial reading of the marker: standing point is in the ${horizontal}, ${depth}; camera direction is ${direction}.` : "No explicit marker was provided; choose a plausible human standing point and state it internally before prompting image generation.",
      intensityRule,
      "Coordinate semantics: x is left-to-right image position, y is image-depth proxy where higher y means nearer/viewer-side and lower y means deeper/farther. Yaw is horizontal view direction relative to the source image axis.",
      "Treat the input image as a coherent 3D architecture/interior scene that can be entered, not as a flat picture to crop or rotate.",
      "Infer walkable floor area, camera foot position, eye height around 1.55m, lens between 24-35mm full-frame equivalent, stable vanishing points and what foreground/midground/background would be visible from this location.",
      "Create a new realistic eye-level view from that standing point with a changed visible field. The output should feel like moving a camera inside the same space, not generating a new unrelated room.",
      "Preserve the source scene's spatial identity, major structure, openings, materials, lighting direction, furniture/display logic, scale cues and design atmosphere.",
      "Allow only viewpoint-driven reconstruction: add plausible side faces, foreground objects, thresholds, adjacent rooms, doorways, ceiling/floor continuation and background continuity that would be visible from the marked point.",
      "Failure modes to avoid: original camera copied, flat crop/zoom, bird's-eye view, floor plan, diagram, model viewport, collage, warped perspective, changed room type, changed openings, extra people, UI markers or marker shadows.",
      ...common
    ].join("\n");
  }

  if (mode === "photo") {
    return [
      "The first input image is an on-site real photo of the existing space.",
      "Preserve the major spatial envelope, perspective, openings, windows, columns, ceiling height and circulation logic from the site photo.",
      "Redesign finishes, lighting, furniture, fixtures, display systems and atmosphere according to the brief and reference images.",
      ...common
    ].join("\n");
  }

  if (mode === "whitemodel") {
    return [
      "The first input image is a white clay / massing model screenshot from a 3D design tool.",
      "Preserve the camera, massing, major openings, floor levels, spatial envelope, proportions and design intent from the white model.",
      "Add realistic architecture/interior materials, lighting, context, furniture or landscape only where appropriate.",
      "Do not make it look like a raw model viewport. Convert it into a polished realistic design visualization.",
      ...common
    ].join("\n");
  }

  if (mode === "sketch") {
    return [
      "The first input image is a hand sketch, concept sketch, or line drawing for architecture/interior design.",
      "Preserve the composition, core spatial idea, main volumes, openings, perspective and intended atmosphere from the sketch.",
      "Translate the sketch into a realistic architectural/interior render with coherent materials, lighting and scale.",
      "Do not reproduce sketch lines in the final image unless they are subtle conceptual traces.",
      ...common
    ].join("\n");
  }

  if (mode === "cadrender") {
    return [
      "The first input image is a CAD drawing, DXF/SVG-derived line drawing, or CAD screenshot.",
      "Read the CAD linework as spatial constraint: walls, openings, rooms, circulation, axes and built-in elements.",
      "Convert it into a realistic architectural/interior rendering according to the brief and reference images.",
      "Do not reproduce CAD linework in the final image.",
      ...common
    ].join("\n");
  }

  if (mode === "upscale") {
    return [
      "The first input image is an existing render/photo that needs quality enhancement.",
      "Preserve the composition, layout, objects, materials and design intent exactly.",
      "Improve perceived resolution, clarity, noise control, material realism and professional presentation quality.",
      "Do not redesign the space or change the main geometry.",
      ...common
    ].join("\n");
  }

  if (mode === "sharpen") {
    return [
      "The first input image is an existing render/photo that needs controlled sharpening.",
      "Preserve the composition, layout, objects, materials, color relationships, camera and design intent exactly.",
      "Improve edge clarity, local contrast and perceived crispness only.",
      "Do not add objects, change materials, shift geometry, move furniture, alter lighting direction or redesign the space.",
      ...common
    ].join("\n");
  }

  if (mode === "detail") {
    return [
      "The first input image is an existing render/photo that needs richer detail.",
      "If a selected area exists, enhance that target first and keep non-selected areas stable.",
      "Preserve the original layout, camera, walls, openings, main objects and design direction.",
      "Enhance material texture, lighting hierarchy, furniture styling, shelf/display content, soft furnishing and small architectural details only where it supports the scene.",
      "Avoid changing walls, openings, camera view, object identity or core composition.",
      ...common
    ].join("\n");
  }

  if (mode === "materialreplace") {
    return [
      "The first input image is an existing spatial render or photo for material replacement.",
      "Preserve the camera, perspective, spatial envelope, openings, object placement, scale, shadows and lighting direction.",
      "Use a selected area as the target material area when present, unless the user explicitly names a different target.",
      "Replace wall, floor, ceiling, furniture or selected-area materials according to the designer notes and reference images.",
      "Keep the layout, major geometry and non-target areas unchanged; only alter material finish, texture, color, reflectivity, roughness and craft details where requested.",
      ...common
    ].join("\n");
  }

  if (mode === "lightingadjust") {
    return [
      "The first input image is an existing spatial render or photo for lighting adjustment.",
      "Preserve the space, geometry, furniture, materials, object placement, camera, composition and non-lighting content.",
      "Change the lighting condition according to the designer notes: daytime, dusk, night scene, warm hospitality mood, showroom spotlighting or other requested ambience.",
      "Make exposure, shadows, highlights, color temperature and indirect light physically plausible and professionally balanced.",
      ...common
    ].join("\n");
  }

  if (mode === "styletransfer") {
    return [
      "The first input image is an existing spatial render or photo for style transfer.",
      "Preserve the structure, camera, composition, circulation logic, major openings, spatial scale and main object positions.",
      "Replace the overall design style, material language, furniture, lighting fixtures, soft furnishings and display atmosphere according to the selected style and reference images.",
      "Avoid changing the core architecture, turning the operation into a color filter or making the space unrecognizable.",
      ...common
    ].join("\n");
  }

  if (mode === "materialboard") {
    return [
      "The first input image and references define the design direction for a material and color board.",
      "Generate a presentation-ready visual board with coordinated material samples, color swatches, texture close-ups, lighting mood, furniture or fixture references and a clear spatial atmosphere.",
      "The board can be a clean collage, but it must feel like a professional interior/architecture material proposal, not a UI screenshot.",
      "Use only visual samples; do not include readable labels, brand names, watermarks or paragraph text.",
      ...common
    ].join("\n");
  }

  if (mode === "outpaint") {
    return [
      "The first input image needs outpainting / image expansion.",
      "Preserve the original subject, vanishing points, perspective, style, materials and lighting.",
      "Extend only the surrounding architecture/interior space beyond the original frame in a natural, plausible way.",
      "Do not crop or distort the original main subject.",
      ...common
    ].join("\n");
  }

  return [
    "The first input image is a plan-based spatial guide.",
    "Use the selected workflow semantics to decide whether this should become a realistic 3D floor plan or final human-eye spatial render.",
    ...common
  ].join("\n");
}

function sanitizeFileName(value) {
  const ext = path.extname(String(value || "")).toLowerCase() || ".png";
  const base = path.basename(String(value || "input"), ext).replace(/[^\w.-]+/g, "-").slice(0, 40) || "input";
  return `${base}${ext}`;
}

function truncateLogText(value, max = 6000) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function summarizeImageForLog(image) {
  if (!image) return null;
  const dataUrl = String(image.dataUrl || "");
  return {
    name: image.name || null,
    type: image.type || null,
    sourceType: image.sourceType || null,
    inputAnalysis: image.inputAnalysis ? {
      key: image.inputAnalysis.key || null,
      label: image.inputAnalysis.label || null,
      suggestedMode: image.inputAnalysis.suggestedMode || null,
      confidence: image.inputAnalysis.confidence || null,
      reason: truncateLogText(image.inputAnalysis.reason || "", 800)
    } : null,
    weight: image.weight || null,
    dataUrlBytes: dataUrl ? Math.round(dataUrl.length * 0.75) : 0
  };
}

function summarizeTaskInput(body = {}) {
  const references = Array.isArray(body.referenceImages) ? body.referenceImages : [];
  return {
    mode: body.mode || null,
    workflowId: body.workflowId || null,
    parentImageId: body.parentImageId || null,
    stepMode: body.stepMode || body.mode || null,
    inputImageType: body.inputImageType || body.primaryImage?.inputAnalysis?.label || body.primaryImage?.sourceType || null,
    size: body.size || null,
    quality: body.quality || null,
    skill: body.skill || null,
    useCase: body.useCase || null,
    intentKind: body.intentKind || null,
    viewpoint: body.viewpoint || null,
    primaryRequest: truncateLogText(body.primaryRequest || "", 5000),
    userPrompt: truncateLogText(body.userPrompt || "", 5000),
    intent: truncateLogText(body.intent || body.imagePrompt || body.primaryRequest || "", 5000),
    brief: body.brief || null,
    selection: body.selection || null,
    seriesIndex: body.seriesIndex || null,
    seriesCount: body.seriesCount || body.count || null,
    primaryImage: summarizeImageForLog(body.primaryImage),
    referenceCount: references.length,
    referenceImages: references.map(summarizeImageForLog),
    analysisTitle: body.analysis?.title || null,
    analysisSummary: truncateLogText(body.analysis?.summary || body.analysis?.series_strategy || "", 2000)
  };
}

function summarizeTaskAttempts(attempts) {
  return Array.isArray(attempts)
    ? attempts.slice(0, 20).map((attempt) => ({
        name: attempt.name || null,
        status: attempt.status || null,
        endpoint: attempt.endpoint || null,
        durationMs: attempt.durationMs || null,
        error: truncateLogText(attempt.error || "", 1000)
      }))
    : [];
}

function summarizeTaskResult(result = {}) {
  const render = result.render || result.image || result;
  const attempts = summarizeTaskAttempts(render?.attempts || result.attempts);
  return {
    outputUrl: render?.url || render?.outputUrl || null,
    outputFile: render?.file || render?.outputFile || null,
    title: render?.title || null,
    mode: render?.mode || result.mode || null,
    intent: truncateLogText(render?.intent || "", 3000),
    bytes: render?.bytes || null,
    model: render?.model || result.model || null,
    reasoningModel: render?.reasoningModel || result.reasoningModel || null,
    endpoint: render?.endpoint || result.endpoint || null,
    attempt: render?.attempt || result.attempt || null,
    imageApi: render?.imageApi || result.imageApi || null,
    actualParams: render?.actualParams || result.actualParams || null,
    revisedPrompt: truncateLogText(render?.revisedPrompt || result.revisedPrompt || "", 3000),
    attempts,
    retryCount: attempts.filter((attempt) => attempt?.status === "failed").length,
    prompt: truncateLogText(render?.prompt || result.prompt || "", 12000),
    sourcePrompt: truncateLogText(render?.sourcePrompt || result.sourcePrompt || "", 12000),
    thinking: truncateLogText(render?.thinking || result.thinking || "", 6000),
    analysisTitle: result.analysis?.title || null,
    analysisSummary: truncateLogText(result.analysis?.summary || result.analysis?.series_strategy || "", 3000)
  };
}

function taskLogPathForClient(clientId) {
  const safeClientId = sanitizeClientId(clientId);
  if (safeClientId === "local") return taskLogPath;
  return path.join(taskLogDir, `${safeClientId}.jsonl`);
}

async function appendTaskLog(entry, clientId = "local") {
  const safeClientId = sanitizeClientId(clientId);
  const logPath = taskLogPathForClient(safeClientId);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify({ ...entry, clientId: safeClientId })}\n`);
}

async function readTaskLogs(limit = 80, clientId = "local") {
  const safeClientId = sanitizeClientId(clientId);
  const logPath = taskLogPathForClient(safeClientId);
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function deleteTaskLog(logId, clientId = "local") {
  const safeClientId = sanitizeClientId(clientId);
  const targetId = String(logId || "").trim();
  if (!targetId) {
    const error = new Error("Missing log id");
    error.status = 400;
    throw error;
  }
  const logPath = taskLogPathForClient(safeClientId);
  let raw = "";
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { deleted: false };
    throw error;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let deleted = false;
  const kept = lines.filter((line) => {
    try {
      const entry = JSON.parse(line);
      if (String(entry?.id || "") === targetId) {
        deleted = true;
        return false;
      }
    } catch {}
    return true;
  });
  if (!deleted) return { deleted: false };
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const tmpPath = `${logPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, kept.length ? `${kept.join("\n")}\n` : "");
  await fs.rename(tmpPath, logPath);
  return { deleted: true };
}

function sanitizeClientId(value) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return cleaned || "local";
}

function compactStoredImage(image) {
  if (!image || typeof image !== "object") return image || null;
  const dataUrl = String(image.dataUrl || "");
  return {
    ...image,
    dataUrlBytes: dataUrl ? Math.round(dataUrl.length * 0.75) : Number(image.dataUrlBytes || 0)
  };
}

function compactCanvasSnapshot(snapshot = {}) {
  const next = { ...snapshot };
  next.primaryImage = compactStoredImage(next.primaryImage);
  next.referenceImages = Array.isArray(next.referenceImages)
    ? next.referenceImages.slice(0, 8).map(compactStoredImage)
    : [];
  next.renders = Array.isArray(next.renders) ? next.renders.slice(-24) : [];
  next.designSeriesResults = Array.isArray(next.designSeriesResults) ? next.designSeriesResults.slice(-24) : [];
  next.imageToolResults = Array.isArray(next.imageToolResults) ? next.imageToolResults.slice(-24) : [];
  return next;
}

function taskIdFromBodyOrUrl(body = {}, url = null) {
  return String(body.clientTaskId || body.taskId || url?.searchParams?.get("taskId") || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 120);
}

function canvasStatePathForClient(clientId) {
  const safeClientId = sanitizeClientId(clientId);
  if (safeClientId === "local") return canvasStatePath;
  return path.join(canvasStateDir, `${safeClientId}.json`);
}

async function readCanvasState(clientId = "local") {
  const safeClientId = sanitizeClientId(clientId);
  const statePath = canvasStatePathForClient(clientId);
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.canvases)) return null;
    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCanvasState(body = {}, clientId = "local") {
  const safeClientId = sanitizeClientId(clientId);
  const canvases = Array.isArray(body.canvases) ? body.canvases : [];
  const state = {
    version: Number(body.version || 1),
    clientId: safeClientId,
    activeCanvasId: String(body.activeCanvasId || ""),
    nextCanvasIndex: Number(body.nextCanvasIndex || 1),
    canvases: canvases.map((record, index) => ({
      ...record,
      id: String(record?.id || `canvas-${Date.now()}-${index}`),
      index: Number(record?.index || index + 1),
      snapshot: compactCanvasSnapshot(record?.snapshot || {})
    })),
    savedAt: new Date().toISOString()
  };
  const statePath = canvasStatePathForClient(safeClientId);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(state)}\n`);
  await fs.rename(tmpPath, statePath);
  return state;
}

function normalizeRuntimeImageEndpoint(endpoint = {}, existing = null) {
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl || existing?.baseUrl || "");
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    const error = new Error("请输入有效的生图 API Base URL，例如 https://api.example.com 或 https://api.example.com/v1");
    error.status = 400;
    throw error;
  }

  const apiKey = String(endpoint.apiKey || endpoint.key || "").trim() || existing?.apiKey || "";
  if (!apiKey) {
    const error = new Error("请输入这个生图 API 的 Key。");
    error.status = 400;
    throw error;
  }

  const responsesPath = String(endpoint.responsesPath || endpoint.path || existing?.responsesPath || "/v1/responses").trim();
  const imageGenerationPath = String(endpoint.imageGenerationPath || endpoint.generationPath || existing?.imageGenerationPath || "/v1/images/generations").trim();
  const imageEditPath = String(endpoint.imageEditPath || endpoint.editPath || existing?.imageEditPath || "/v1/images/edits").trim();
  const providerManifest = providerManifestFromInput(endpoint, existing);
  return {
    id: String(existing?.id || endpoint.id || randomUUID()),
    label: String(endpoint.label || endpoint.name || existing?.label || shortRuntimeEndpointLabel(baseUrl)),
    baseUrl,
    apiKey,
    responsesPath: normalizeProviderApiPath(responsesPath, "/v1/responses"),
    imageGenerationPath: normalizeProviderApiPath(providerManifest?.submit?.path || imageGenerationPath, "/v1/images/generations"),
    imageEditPath: normalizeProviderApiPath(providerManifest?.editSubmit?.path || imageEditPath, "/v1/images/edits"),
    providerManifest,
    enabled: parseBooleanEnv(endpoint.enabled, existing?.enabled ?? true),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function shortRuntimeEndpointLabel(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function normalizeRuntimeProvider(provider = {}, existing = null, { kind = "reasoning" } = {}) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl || existing?.baseUrl || "");
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    const error = new Error("请输入有效的 API Base URL，例如 https://api.example.com 或 https://api.example.com/v1");
    error.status = 400;
    throw error;
  }

  const apiKey = String(provider.apiKey || provider.key || "").trim() || existing?.apiKey || "";
  if (!apiKey) {
    const error = new Error("请输入 API Key。");
    error.status = 400;
    throw error;
  }

  const fallbackModel = kind === "image" ? config.imageModel : config.reasoningModel;
  const fallbackResponsesPath = kind === "image" ? providerResponsesPath({ baseUrl, responsesPath: config.imageProvider.responsesPath }) : "/v1/responses";
  const responsesPath = String(provider.responsesPath || provider.path || existing?.responsesPath || fallbackResponsesPath).trim();
  const normalized = {
    baseUrl,
    apiKey,
    model: String(provider.model || existing?.model || fallbackModel).trim() || fallbackModel,
    responsesPath: normalizeProviderApiPath(responsesPath, fallbackResponsesPath),
    updatedAt: new Date().toISOString()
  };
  if (kind === "image") {
    const providerManifest = providerManifestFromInput(provider, existing);
    normalized.imageGenerationPath = normalizeProviderApiPath(
      providerManifest?.submit?.path || provider.imageGenerationPath || provider.generationPath || existing?.imageGenerationPath,
      "/v1/images/generations"
    );
    normalized.imageEditPath = normalizeProviderApiPath(
      providerManifest?.editSubmit?.path || provider.imageEditPath || provider.editPath || existing?.imageEditPath,
      "/v1/images/edits"
    );
    normalized.providerManifest = providerManifest;
  }
  return normalized;
}

function publicRuntimeProvider(provider) {
  return {
    configured: Boolean(provider?.apiKey),
    baseUrl: provider?.baseUrl || "",
    model: provider?.model || "",
    responsesPath: provider?.responsesPath || "",
    imageGenerationPath: provider?.imageGenerationPath || "",
    imageEditPath: provider?.imageEditPath || "",
    providerManifest: provider?.providerManifest || null,
    providerManifestName: provider?.providerManifest?.name || "",
    keyPreview: provider?.apiKey ? `${provider.apiKey.slice(0, 5)}...${provider.apiKey.slice(-4)}` : "",
    updatedAt: provider?.updatedAt || ""
  };
}

function normalizeRuntimeProviderProfile(profile = {}, existing = null) {
  const source = { ...(existing || {}), ...(profile || {}) };
  const id = String(source.id || source.slug || source.name || randomUUID()).trim();
  const label = String(source.label || source.name || id || "API").trim();
  const reasoning = normalizeRuntimeProvider(source.reasoning || {}, existing?.reasoning || null, { kind: "reasoning" });
  const image = normalizeRuntimeProvider(source.image || {}, existing?.image || null, { kind: "image" });
  return {
    id,
    label,
    active: Boolean(source.active),
    reasoning,
    image,
    createdAt: existing?.createdAt || source.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function publicRuntimeProviderProfile(profile) {
  return {
    id: profile.id,
    label: profile.label,
    active: Boolean(profile.active),
    reasoning: publicRuntimeProvider(profile.reasoning),
    image: publicRuntimeProvider(profile.image),
    createdAt: profile.createdAt || "",
    updatedAt: profile.updatedAt || ""
  };
}

function applyRuntimeProviders() {
  const reasoning = runtimeSettings.providers.reasoning;
  if (reasoning?.apiKey && reasoning.baseUrl) {
    config.reasoningProvider.baseUrl = reasoning.baseUrl;
    config.reasoningProvider.apiKey = reasoning.apiKey;
    config.reasoningProvider.responsesPath = reasoning.responsesPath || config.reasoningProvider.responsesPath;
    config.reasoningModel = reasoning.model || config.reasoningModel;
  }

  const image = runtimeSettings.providers.image;
  if (image?.apiKey && image.baseUrl) {
    config.imageProvider.baseUrl = image.baseUrl;
    config.imageProvider.apiKey = image.apiKey;
    config.imageProvider.responsesPath = image.responsesPath || config.imageProvider.responsesPath;
    config.imageProvider.imageGenerationPath = image.imageGenerationPath || config.imageProvider.imageGenerationPath;
    config.imageProvider.imageEditPath = image.imageEditPath || config.imageProvider.imageEditPath;
    config.imageProvider.providerManifest = image.providerManifest || config.imageProvider.providerManifest;
    config.imageModel = image.model || config.imageModel;
    config.imageProvider.baseUrls = uniqueBaseUrls([image.baseUrl, ...config.imageProvider.baseUrls]);
  }
}

function publicRuntimeImageEndpoint(endpoint, { includeKeyPreview = false } = {}) {
  return {
    id: endpoint.id,
    label: endpoint.label,
    baseUrl: endpoint.baseUrl,
    responsesPath: endpoint.responsesPath,
    imageGenerationPath: endpoint.imageGenerationPath,
    imageEditPath: endpoint.imageEditPath,
    providerManifest: endpoint.providerManifest || null,
    providerManifestName: endpoint.providerManifest?.name || "",
    enabled: endpoint.enabled,
    keyConfigured: Boolean(endpoint.apiKey),
    keyPreview: includeKeyPreview && endpoint.apiKey ? `${endpoint.apiKey.slice(0, 5)}...${endpoint.apiKey.slice(-4)}` : "",
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt
  };
}

async function loadRuntimeSettings() {
  try {
    const raw = await fs.readFile(runtimeSettingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const providers = parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {};
    runtimeSettings.providers = { reasoning: null, image: null };
    for (const kind of ["reasoning", "image"]) {
      if (!providers[kind]) continue;
      try {
        runtimeSettings.providers[kind] = normalizeRuntimeProvider(providers[kind], providers[kind], { kind });
      } catch {
        runtimeSettings.providers[kind] = null;
      }
    }
    const profiles = Array.isArray(parsed.providerProfiles) ? parsed.providerProfiles : [];
    runtimeSettings.providerProfiles = profiles
      .map((profile) => {
        try {
          return normalizeRuntimeProviderProfile(profile, profile);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const endpoints = Array.isArray(parsed.imageEndpoints) ? parsed.imageEndpoints : [];
    runtimeSettings.imageEndpoints = endpoints
      .map((endpoint) => {
        try {
          return normalizeRuntimeImageEndpoint(endpoint, endpoint);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    applyRuntimeProviders();
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`[settings] load failed: ${error.message || error}`);
    runtimeSettings.providers = { reasoning: null, image: null };
    runtimeSettings.providerProfiles = [];
    runtimeSettings.imageEndpoints = [];
  }
}

async function saveRuntimeSettings() {
  await fs.mkdir(logsDir, { recursive: true });
  const tmpPath = `${runtimeSettingsPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(runtimeSettings, null, 2)}\n`);
  await fs.rename(tmpPath, runtimeSettingsPath);
}

function runtimeSettingsBody(req = null) {
  const imageEndpointHealthValue = imageEndpointHealth();
  const owner = req ? isOwnerRequest(req) : true;
  return {
    ok: true,
    settings: {
      dataDir: appDataDir,
      externalDataDir: externalDataDirEnabled,
      providers: {
        reasoning: publicRuntimeProvider(runtimeSettings.providers.reasoning),
        image: publicRuntimeProvider(runtimeSettings.providers.image)
      },
      providerProfiles: runtimeSettings.providerProfiles.map(publicRuntimeProviderProfile),
      providerProbes: {
        reasoning: publicProviderProbe("reasoning"),
        image: publicProviderProbe("image")
      },
      imageEndpoints: runtimeSettings.imageEndpoints.map((endpoint) => publicRuntimeImageEndpoint(endpoint, { includeKeyPreview: owner })),
      activeImageBaseUrl: config.imageProvider.baseUrl,
      imageEndpointHealth: imageEndpointHealthValue,
      recommendedImageEndpoint: imageEndpointRecommendation(imageEndpointHealthValue),
      imageBackend: config.imageApiMode === "responses" ? "responses-image-generation-tool" : "openai-compatible-images-api",
      imageGenContract: config.imageApiMode === "responses"
        ? "Images are generated through the Responses image_generation tool."
        : "Images are generated through OpenAI-compatible /images/generations or /images/edits first, with Responses image_generation as fallback.",
      canManageSettings: owner,
      publicApiTokenConfigured: Boolean(config.publicApi.token),
      publicApiCorsOrigin: config.publicApi.corsOrigin || ""
    }
  };
}

async function updateRuntimeProvider(kind, body = {}) {
  if (!["reasoning", "image"].includes(kind)) {
    const error = new Error("未知 API 类型");
    error.status = 400;
    throw error;
  }
  const provider = normalizeRuntimeProvider(body, runtimeSettings.providers[kind], { kind });
  runtimeSettings.providers[kind] = provider;
  applyRuntimeProviders();
  await saveRuntimeSettings();
  return provider;
}

async function providerProbeBody(body = {}) {
  const kind = String(body.kind || "").trim();
  if (!["reasoning", "image"].includes(kind)) {
    const error = new Error("未知 API 类型");
    error.status = 400;
    throw error;
  }
  const timeoutMs = kind === "image"
    ? clampNumber(Number(body.timeoutMs || 120000), 10000, 240000)
    : clampNumber(Number(body.timeoutMs || 30000), 5000, 60000);
  const existing = runtimeSettings.providers[kind] || null;
  const provider = normalizeRuntimeProvider(body, existing, { kind });
  const probe = await probeProviderConnection(kind, provider, { timeoutMs });
  const imageEndpointHealthValue = kind === "image" ? imageEndpointHealth() : undefined;
  return {
    ok: probe.ok,
    probe,
    settings: runtimeSettingsBody().settings,
    ...(imageEndpointHealthValue ? {
      imageBaseUrl: config.imageProvider.baseUrl,
      imageEndpointHealth: imageEndpointHealthValue,
      recommendedImageEndpoint: imageEndpointRecommendation(imageEndpointHealthValue)
    } : {})
  };
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function isGeneratedSidecarJson(fileName = "") {
  return fileName.endsWith(".json");
}

function isGeneratedImage(fileName = "") {
  return /\.(png|jpg|jpeg|webp)$/i.test(fileName);
}

async function listFilesRecursive(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(fullPath);
      if (!entry.isFile()) return [];
      const stat = await fs.stat(fullPath);
      return [{ path: fullPath, name: entry.name, stat }];
    }));
    return nested.flat();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function directoryStats(dirPath) {
  const files = await listFilesRecursive(dirPath);
  const bytes = files.reduce((sum, file) => sum + file.stat.size, 0);
  return {
    files: files.length,
    bytes,
    formatted: formatBytes(bytes)
  };
}

function generatedFileTimestamp(fileName = "", stat = null) {
  const match = String(fileName).match(/^(\d{10,})-/);
  const fromName = match ? Number(match[1]) : 0;
  if (Number.isFinite(fromName) && fromName > 0) return fromName;
  return stat?.mtimeMs || Date.now();
}

function generatedFileBase(fileName = "") {
  return fileName.replace(/\.(png|jpg|jpeg|webp|json)$/i, "");
}

async function generatedStorageSummary() {
  const [generated, archive, logs] = await Promise.all([
    directoryStats(generatedDir),
    directoryStats(generatedArchiveDir),
    directoryStats(logsDir)
  ]);
  return {
    generated,
    archive,
    logs,
    retentionDefaults: {
      archiveOlderThanDays: 30,
      deleteTestFiles: true,
      keepLogDays: 30
    }
  };
}

async function moveFileSafe(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath);
  }
}

async function archiveGeneratedFiles({ olderThanDays = 30, dryRun = false } = {}) {
  const cutoff = Date.now() - Math.max(0, Number(olderThanDays) || 0) * DAY_MS;
  const entries = await listFilesRecursive(generatedDir);
  const selected = entries.filter((file) => generatedFileTimestamp(file.name, file.stat) < cutoff);
  let moved = 0;
  let bytes = 0;
  for (const file of selected) {
    bytes += file.stat.size;
    if (dryRun) continue;
    const timestamp = new Date(generatedFileTimestamp(file.name, file.stat));
    const folder = timestamp.toISOString().slice(0, 7);
    await moveFileSafe(file.path, path.join(generatedArchiveDir, folder, file.name));
    moved += 1;
  }
  return {
    ok: true,
    action: "archive-generated",
    olderThanDays,
    dryRun,
    matched: selected.length,
    moved: dryRun ? 0 : moved,
    bytes,
    formattedBytes: formatBytes(bytes)
  };
}

async function deleteGeneratedPairsByPredicate(predicate, { dryRun = false } = {}) {
  const entries = await listFilesRecursive(generatedDir);
  const byBase = new Map();
  for (const file of entries) {
    const base = generatedFileBase(file.name);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(file);
  }
  const selected = new Set();
  for (const [base, files] of byBase.entries()) {
    if (files.some((file) => predicate(file, base))) {
      files.forEach((file) => selected.add(file));
    }
  }
  let deleted = 0;
  let bytes = 0;
  for (const file of selected) {
    bytes += file.stat.size;
    if (dryRun) continue;
    await fs.unlink(file.path);
    deleted += 1;
  }
  return {
    ok: true,
    action: "delete-generated",
    dryRun,
    matched: selected.size,
    deleted: dryRun ? 0 : deleted,
    bytes,
    formattedBytes: formatBytes(bytes)
  };
}

async function cleanupTestGeneratedFiles(options = {}) {
  const testPattern = /(test|tmp|probe|debug|sample|floorplan-item|local-colorize)/i;
  return deleteGeneratedPairsByPredicate((file, base) => testPattern.test(file.name) || testPattern.test(base), options);
}

async function pruneLogFile(filePath, keepDays = 30) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { file: filePath, before: 0, after: 0, removed: 0 };
    throw error;
  }
  const cutoff = Date.now() - Math.max(1, Number(keepDays) || 30) * DAY_MS;
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const kept = lines.filter((line) => {
    try {
      const entry = JSON.parse(line);
      const value = entry.completedAt || entry.startedAt || entry.time || entry.createdAt || "";
      const time = new Date(value).getTime();
      return !Number.isFinite(time) || time >= cutoff;
    } catch {
      return true;
    }
  });
  if (kept.length !== lines.length) {
    await fs.writeFile(filePath, `${kept.join("\n")}${kept.length ? "\n" : ""}`);
  }
  return {
    file: path.relative(__dirname, filePath),
    before: lines.length,
    after: kept.length,
    removed: lines.length - kept.length
  };
}

async function pruneTaskLogs({ keepDays = 30 } = {}) {
  const files = [
    taskLogPath,
    ...(await listFilesRecursive(taskLogDir)).filter((file) => file.name.endsWith(".jsonl")).map((file) => file.path)
  ];
  const results = [];
  for (const filePath of files) {
    results.push(await pruneLogFile(filePath, keepDays));
  }
  return {
    ok: true,
    action: "prune-task-logs",
    keepDays,
    files: results,
    removed: results.reduce((sum, item) => sum + item.removed, 0)
  };
}

async function runStorageMaintenance(body = {}) {
  const action = String(body.action || "").trim();
  const dryRun = Boolean(body.dryRun);
  if (action === "summary") return { ok: true, summary: await generatedStorageSummary() };
  if (action === "archive-generated") return archiveGeneratedFiles({ olderThanDays: body.olderThanDays ?? 30, dryRun });
  if (action === "cleanup-test-generated") return cleanupTestGeneratedFiles({ dryRun });
  if (action === "prune-task-logs") return pruneTaskLogs({ keepDays: body.keepDays ?? 30 });
  if (action === "daily-maintenance") {
    const archive = await archiveGeneratedFiles({ olderThanDays: body.olderThanDays ?? 30, dryRun });
    const cleanup = body.deleteTestFiles === false
      ? { ok: true, action: "delete-generated", skipped: true }
      : await cleanupTestGeneratedFiles({ dryRun });
    const logs = await pruneTaskLogs({ keepDays: body.keepLogDays ?? 30 });
    return { ok: true, action, dryRun, archive, cleanup, logs, summary: await generatedStorageSummary() };
  }
  const error = new Error("未知维护动作");
  error.status = 400;
  throw error;
}

async function imageEndpointProbeBody(body = {}) {
  const endpointId = String(body.endpointId || body.id || "").trim();
  const baseUrl = normalizeBaseUrl(body.baseUrl || "");
  const apiKey = String(body.apiKey || body.key || "").trim();
  const hasTarget = Boolean(endpointId || baseUrl);
  const requestedTimeoutMs = Number(body.timeoutMs || 12000);
  const timeoutMs = clampNumber(Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : 12000, 5000, 30000);
  const autoActivate = hasTarget
    ? parseBooleanEnv(body.autoActivate, false)
    : parseBooleanEnv(body.autoActivate, true);
  if (baseUrl && apiKey) {
    if (!/^https?:\/\//i.test(baseUrl)) {
      const error = new Error("请输入有效的生图 API Base URL，例如 https://api.example.com 或 https://api.example.com/v1");
      error.status = 400;
      throw error;
    }
    const responsesPathValue = String(body.responsesPath || body.path || "/v1/responses").trim();
    const providerManifest = providerManifestFromInput(body);
    const source = {
      baseUrl,
      apiKey,
      responsesPath: normalizeProviderApiPath(responsesPathValue, "/v1/responses"),
      imageGenerationPath: normalizeProviderApiPath(providerManifest?.submit?.path || body.imageGenerationPath || body.generationPath, "/v1/images/generations"),
      imageEditPath: normalizeProviderApiPath(providerManifest?.editSubmit?.path || body.imageEditPath || body.editPath, "/v1/images/edits"),
      providerManifest,
      kind: "runtime-draft",
      keySource: "draft",
      label: String(body.label || body.name || shortRuntimeEndpointLabel(baseUrl)).trim()
    };
    const draftProbe = await probeImageEndpointSource(source, { timeoutMs });
    const endpoints = imageEndpointHealth();
    return {
      ok: true,
      imageBaseUrl: config.imageProvider.baseUrl,
      imageEndpointHealth: endpoints,
      recommendedImageEndpoint: imageEndpointRecommendation(endpoints),
      checkedAt: new Date().toISOString(),
      checkedEndpointId: endpointId || null,
      checkedBaseUrl: baseUrl,
      draftProbe: {
        ...draftProbe,
        label: source.label,
        responsesPath: providerResponsesPath(source),
        imageGenerationPath: providerImageApiPath(source, "generation"),
        imageEditPath: providerImageApiPath(source, "edit"),
        providerManifestName: source.providerManifest?.name || "",
        checkedAt: new Date().toISOString()
      }
    };
  }
  const endpoints = await probeImageEndpoints({ timeoutMs, endpointId, baseUrl, autoActivate });
  return {
    ok: true,
    imageBaseUrl: config.imageProvider.baseUrl,
    imageEndpointHealth: endpoints,
    recommendedImageEndpoint: imageEndpointRecommendation(endpoints),
    checkedAt: new Date().toISOString(),
    checkedEndpointId: endpointId || null,
    checkedBaseUrl: baseUrl || null
  };
}

async function addRuntimeImageEndpoint(body = {}) {
  const endpoint = normalizeRuntimeImageEndpoint(body);
  const existingIndex = runtimeSettings.imageEndpoints.findIndex((item) => item.baseUrl === endpoint.baseUrl);
  if (existingIndex >= 0) {
    endpoint.id = runtimeSettings.imageEndpoints[existingIndex].id;
    endpoint.createdAt = runtimeSettings.imageEndpoints[existingIndex].createdAt;
    runtimeSettings.imageEndpoints[existingIndex] = endpoint;
  } else {
    runtimeSettings.imageEndpoints.unshift(endpoint);
  }
  if (endpoint.enabled) config.imageProvider.baseUrl = endpoint.baseUrl;
  await saveRuntimeSettings();
  return endpoint;
}

async function updateRuntimeImageEndpoint(id, body = {}) {
  const index = runtimeSettings.imageEndpoints.findIndex((endpoint) => endpoint.id === id);
  if (index < 0) {
    const error = new Error("未找到这个生图 API 配置。");
    error.status = 404;
    throw error;
  }
  const endpoint = normalizeRuntimeImageEndpoint({ ...body, id }, runtimeSettings.imageEndpoints[index]);
  runtimeSettings.imageEndpoints[index] = endpoint;
  if (endpoint.enabled) config.imageProvider.baseUrl = endpoint.baseUrl;
  await saveRuntimeSettings();
  return endpoint;
}

async function deleteRuntimeImageEndpoint(id) {
  const before = runtimeSettings.imageEndpoints.length;
  runtimeSettings.imageEndpoints = runtimeSettings.imageEndpoints.filter((endpoint) => endpoint.id !== id);
  if (runtimeSettings.imageEndpoints.length === before) {
    const error = new Error("未找到这个生图 API 配置。");
    error.status = 404;
    throw error;
  }
  const active = activeImageProviderSource();
  if (active?.baseUrl) config.imageProvider.baseUrl = active.baseUrl;
  await saveRuntimeSettings();
}

async function activateRuntimeImageEndpoint(id) {
  const endpoint = runtimeSettings.imageEndpoints.find((item) => item.id === id);
  if (!endpoint) {
    const error = new Error("未找到这个生图 API 配置。");
    error.status = 404;
    throw error;
  }
  endpoint.enabled = true;
  endpoint.updatedAt = new Date().toISOString();
  config.imageProvider.baseUrl = endpoint.baseUrl;
  await saveRuntimeSettings();
  return endpoint;
}

function healthBody() {
  const reasoningConfigured = Boolean(config.reasoningProvider.apiKey);
  const imageConfigured = imageProviderSources().some((source) => source.apiKey);
  const imageEndpointHealthValue = imageEndpointHealth();
  return {
    ok: true,
    keyConfigured: reasoningConfigured && imageConfigured,
    reasoningConfigured,
    imageConfigured,
    reasoningBaseUrl: config.reasoningProvider.baseUrl,
    imageBaseUrl: config.imageProvider.baseUrl,
    imageBaseUrls: config.imageProvider.baseUrls,
    runtimeImageEndpoints: runtimeSettings.imageEndpoints.map((endpoint) => publicRuntimeImageEndpoint(endpoint, { includeKeyPreview: false })),
    imageEndpointHealth: imageEndpointHealthValue,
    recommendedImageEndpoint: imageEndpointRecommendation(imageEndpointHealthValue),
    imageQueue: imageGenerationQueueState(),
    reasoningModel: config.reasoningModel,
    imageModel: config.imageModel,
    imageBackend: config.imageApiMode === "responses" ? "responses-image-generation-tool" : "openai-compatible-images-api",
    dataDir: appDataDir,
    externalDataDir: externalDataDirEnabled,
    runtimeProviders: {
      reasoning: publicRuntimeProvider(runtimeSettings.providers.reasoning),
      image: publicRuntimeProvider(runtimeSettings.providers.image)
    },
    providerProfiles: runtimeSettings.providerProfiles.map(publicRuntimeProviderProfile),
    publicApi: {
      version: "v1",
      authenticationRequired: Boolean(config.publicApi.token),
      corsEnabled: Boolean(config.publicApi.corsOrigin)
    }
  };
}

function imageGenerationQueueState() {
  return {
    active: activeImageGenerationTasks,
    pending: imageGenerationQueue.length,
    limit: config.imageGenerationConcurrency,
    maxPending: config.imageGenerationQueueMaxPending,
    timeoutMs: config.imageGenerationQueueTimeoutMs
  };
}

function releaseImageGenerationSlot() {
  const next = imageGenerationQueue.shift();
  if (next) {
    next();
    return;
  }
  activeImageGenerationTasks = Math.max(0, activeImageGenerationTasks - 1);
}

async function withImageGenerationSlot(label, run) {
  const queuedAt = Date.now();
  let queued = false;
  if (activeImageGenerationTasks >= config.imageGenerationConcurrency) {
    if (imageGenerationQueue.length >= config.imageGenerationQueueMaxPending) {
      const error = new Error("生图任务排队过多，请稍后再试。");
      error.status = 429;
      error.details = imageGenerationQueueState();
      throw error;
    }
    queued = true;
    await new Promise((resolve) => {
      let timeout = null;
      const resume = () => {
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      timeout = setTimeout(() => {
        const index = imageGenerationQueue.indexOf(resume);
        if (index >= 0) imageGenerationQueue.splice(index, 1);
        const error = new Error("生图任务排队超时，请稍后重试。");
        error.status = 429;
        error.details = imageGenerationQueueState();
        resolve(Promise.reject(error));
      }, config.imageGenerationQueueTimeoutMs);
      imageGenerationQueue.push(resume);
    });
  } else {
    activeImageGenerationTasks += 1;
  }
  const waitedMs = Date.now() - queuedAt;
  if (queued && waitedMs > 250) {
    console.log(`[image-queue] ${label} waited ${waitedMs}ms; active=${activeImageGenerationTasks}/${config.imageGenerationConcurrency}`);
  }
  try {
    return await run();
  } finally {
    releaseImageGenerationSlot();
  }
}

async function runLoggedTask({ type, body, run, clientId = "local" }) {
  const safeClientId = sanitizeClientId(clientId);
  const taskId = randomUUID();
  const startedAt = new Date();
  const started = Date.now();
  const base = {
    id: taskId,
    clientId: safeClientId,
    type,
    startedAt: startedAt.toISOString(),
    input: summarizeTaskInput(body),
    imageEndpointHealth: imageEndpointHealth()
  };

  try {
    const result = await run();
    await appendTaskLog({
      ...base,
      status: "success",
      durationMs: Date.now() - started,
      completedAt: new Date().toISOString(),
      result: summarizeTaskResult(result),
      activeImageBaseUrl: config.imageProvider.baseUrl
    }, safeClientId);
    return result;
  } catch (error) {
    const attempts = summarizeTaskAttempts(error.attempts);
    const retryCount = attempts.filter((attempt) => attempt?.status === "failed").length;
    await appendTaskLog({
      ...base,
      status: "failed",
      durationMs: Date.now() - started,
      completedAt: new Date().toISOString(),
      ...(attempts.length ? {
        result: {
          outputUrl: null,
          outputFile: null,
          endpoint: error.endpoint || config.imageProvider.baseUrl,
          attempts,
          retryCount
        }
      } : {}),
      error: {
        status: error.status || 500,
        message: error.message || "Server error",
        details: error.details ? truncateLogText(JSON.stringify(error.details), 3000) : null,
        endpoint: error.endpoint || config.imageProvider.baseUrl,
        attempts,
        retryCount
      },
      activeImageBaseUrl: config.imageProvider.baseUrl
    }, safeClientId).catch((logError) => {
      console.warn(`[task-log] write failed: ${logError.message || logError}`);
    });
    throw error;
  }
}

function asyncTaskKey(clientId, taskId) {
  return `${sanitizeClientId(clientId)}:${String(taskId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120)}`;
}

function pruneTaskResults() {
  const now = Date.now();
  for (const [key, entry] of taskResults.entries()) {
    if (!entry || now - Number(entry.updatedAt || entry.startedAt || 0) > TASK_RESULT_TTL_MS) taskResults.delete(key);
  }
}

function publicTaskEntry(entry) {
  if (!entry) return null;
  return {
    ok: true,
    taskId: entry.taskId,
    status: entry.status,
    done: entry.status === "success" || entry.status === "failed",
    startedAt: entry.startedAtIso,
    completedAt: entry.completedAtIso || null,
    result: entry.result || null,
    error: entry.error || null
  };
}

function rememberTaskStarted(clientId, taskId, type) {
  if (!taskId) return null;
  pruneTaskResults();
  const key = asyncTaskKey(clientId, taskId);
  const existing = taskResults.get(key);
  if (existing && ["running", "success", "failed"].includes(existing.status)) return existing;
  const entry = {
    taskId,
    clientId: sanitizeClientId(clientId),
    type,
    status: "running",
    startedAt: Date.now(),
    startedAtIso: new Date().toISOString(),
    updatedAt: Date.now(),
    completedAtIso: null,
    result: null,
    error: null
  };
  taskResults.set(key, entry);
  return entry;
}

function rememberTaskSuccess(clientId, taskId, result) {
  if (!taskId) return;
  const entry = taskResults.get(asyncTaskKey(clientId, taskId)) || rememberTaskStarted(clientId, taskId, "task");
  entry.status = "success";
  entry.result = result;
  entry.error = null;
  entry.updatedAt = Date.now();
  entry.completedAtIso = new Date().toISOString();
}

function rememberTaskFailure(clientId, taskId, error) {
  if (!taskId) return;
  const entry = taskResults.get(asyncTaskKey(clientId, taskId)) || rememberTaskStarted(clientId, taskId, "task");
  entry.status = "failed";
  entry.result = null;
  entry.error = {
    status: error.status || 500,
    message: error.message || "Server error",
    details: error.details || null
  };
  entry.updatedAt = Date.now();
  entry.completedAtIso = new Date().toISOString();
}

async function runRecoverableTask({ type, body, clientId, taskId, run }) {
  if (!taskId) return run();
  const entry = rememberTaskStarted(clientId, taskId, type);
  if (entry?.status === "success") return entry.result;
  if (entry?.status === "failed") {
    const error = new Error(entry.error?.message || "Task failed");
    error.status = entry.error?.status || 500;
    error.details = entry.error?.details || null;
    throw error;
  }
  if (entry?.promise) return entry.promise;

  let taskPromise;
  taskPromise = (async () => {
    try {
      const result = await run();
      rememberTaskSuccess(clientId, taskId, result);
      return result;
    } catch (error) {
      rememberTaskFailure(clientId, taskId, error);
      throw error;
    } finally {
      const latest = taskResults.get(asyncTaskKey(clientId, taskId));
      if (latest?.promise === taskPromise) delete latest.promise;
    }
  })();
  entry.promise = taskPromise;
  return taskPromise;
}

function publicApiRoutes() {
  return [
    {
      method: "GET",
      path: "/api/v1/health",
      description: "服务、模型和生图端点状态。"
    },
    {
      method: "POST",
      path: "/api/v1/plan",
      description: "根据空间 brief 生成三套设计方向。"
    },
    {
      method: "POST",
      path: "/api/v1/images/generate",
      description: "根据方向或 imagePrompt 生成单张空间概念图。"
    },
    {
      method: "POST",
      path: "/api/v1/images/render-from-images",
      description: "用底图、参考图和文字意图生成效果图或迭代图。"
    },
    {
      method: "POST",
      path: "/api/v1/design-series/analyze",
      description: "分析参考图并整理设计系列策略。"
    },
    {
      method: "POST",
      path: "/api/v1/design-series/generate",
      description: "根据参考图、brief 和策略生成设计系列图。"
    },
    {
      method: "GET",
      path: "/api/v1/task-logs",
      description: "读取最近任务日志，支持 ?limit=1..200。"
    },
    {
      method: "GET",
      path: "/api/v1/canvas-state",
      description: "读取当前多画布状态快照。"
    },
    {
      method: "POST",
      path: "/api/v1/canvas-state",
      description: "保存当前多画布状态快照。"
    },
    {
      method: "POST",
      path: "/api/v1/image-endpoints/probe",
      description: "测速并更新生图端点可用性。"
    },
    {
      method: "GET",
      path: "/api/v1/settings",
      description: "读取运行时设置和自定义生图 API。"
    },
    {
      method: "GET",
      path: "/api/v1/storage",
      description: "读取生成图、归档和日志占用。"
    },
    {
      method: "POST",
      path: "/api/v1/storage/maintenance",
      description: "本机 owner 执行生成图归档、测试图清理和任务日志裁剪。"
    },
    {
      method: "POST",
      path: "/api/v1/settings/image-endpoints",
      description: "新增或更新自定义 Image Gen API 端点。"
    },
    {
      method: "PATCH",
      path: "/api/v1/settings/image-endpoints/:id",
      description: "更新自定义 Image Gen API 端点。"
    },
    {
      method: "DELETE",
      path: "/api/v1/settings/image-endpoints/:id",
      description: "删除自定义 Image Gen API 端点。"
    },
    {
      method: "POST",
      path: "/api/v1/settings/image-endpoints/:id/activate",
      description: "启用并设为优先自定义 Image Gen API 端点。"
    }
  ];
}

function apiIndexBody(req) {
  const baseUrl = `http://${req.headers.host || `localhost:${config.port}`}`;
  return {
    ok: true,
    name: "老鬼AI API",
    version: "v1",
    baseUrl: `${baseUrl}/api/v1`,
    authentication: {
      required: Boolean(config.publicApi.token),
      headers: ["Authorization: Bearer <token>", "x-laogui-api-key: <token>"],
      env: "LAOGUI_API_TOKEN"
    },
    cors: {
      enabled: Boolean(config.publicApi.corsOrigin),
      env: "API_CORS_ORIGIN"
    },
    docs: {
      openapi: "/api/openapi.json"
    },
    routes: publicApiRoutes(),
    legacyRoutes: [
      "/api/health",
      "/api/plan",
      "/api/generate-image",
      "/api/render-from-images",
      "/api/analyze-design-series",
      "/api/design-series"
    ]
  };
}

function jsonSchemaRef(name) {
  return { "$ref": `#/components/schemas/${name}` };
}

function createOpenApiDocument(req) {
  const baseUrl = `http://${req.headers.host || `localhost:${config.port}`}`;
  const jsonContent = (schema) => ({
    "application/json": { schema }
  });
  const okJson = (schema) => ({
    description: "OK",
    content: jsonContent(schema)
  });
  const errorResponse = {
    description: "Error",
    content: jsonContent(jsonSchemaRef("ErrorResponse"))
  };
  const auth = config.publicApi.token ? [{ bearerAuth: [] }, { apiKeyAuth: [] }] : [];

  return {
    openapi: "3.1.0",
    info: {
      title: "老鬼AI API",
      version: "1.0.0",
      description: "面向空间设计工作流的本地 HTTP API。"
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    paths: {
      "/health": {
        get: {
          summary: "服务状态",
          security: auth,
          responses: { 200: okJson(jsonSchemaRef("HealthResponse")), 401: errorResponse }
        }
      },
      "/plan": {
        post: {
          summary: "生成设计方向",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("PlanRequest")) },
          responses: { 200: okJson(jsonSchemaRef("PlanResponse")), 401: errorResponse, 500: errorResponse }
        }
      },
      "/images/generate": {
        post: {
          summary: "生成单张概念图",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("GenerateImageRequest")) },
          responses: { 200: okJson(jsonSchemaRef("GenerateImageResponse")), 400: errorResponse, 401: errorResponse, 500: errorResponse }
        }
      },
      "/images/render-from-images": {
        post: {
          summary: "基于上传图片生成效果图",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("RenderFromImagesRequest")) },
          responses: { 200: okJson(jsonSchemaRef("RenderFromImagesResponse")), 400: errorResponse, 401: errorResponse, 500: errorResponse }
        }
      },
      "/design-series/analyze": {
        post: {
          summary: "分析设计系列参考图",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("DesignSeriesAnalyzeRequest")) },
          responses: { 200: okJson(jsonSchemaRef("DesignSeriesAnalyzeResponse")), 400: errorResponse, 401: errorResponse, 500: errorResponse }
        }
      },
      "/design-series/generate": {
        post: {
          summary: "生成设计系列图",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("DesignSeriesGenerateRequest")) },
          responses: { 200: okJson(jsonSchemaRef("DesignSeriesGenerateResponse")), 400: errorResponse, 401: errorResponse, 500: errorResponse }
        }
      },
      "/task-logs": {
        get: {
          summary: "读取任务日志",
          security: auth,
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200, default: 80 }
            }
          ],
          responses: { 200: okJson(jsonSchemaRef("TaskLogsResponse")), 401: errorResponse }
        }
      },
      "/canvas-state": {
        get: {
          summary: "读取画布状态",
          security: auth,
          responses: { 200: okJson(jsonSchemaRef("CanvasStateResponse")), 401: errorResponse }
        },
        post: {
          summary: "保存画布状态",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("CanvasState")) },
          responses: { 200: okJson(jsonSchemaRef("CanvasStateSaveResponse")), 401: errorResponse }
        }
      },
      "/image-endpoints/probe": {
        post: {
          summary: "检测生图端点",
          security: auth,
          requestBody: { required: false, content: jsonContent(jsonSchemaRef("ImageEndpointProbeRequest")) },
          responses: { 200: okJson(jsonSchemaRef("ImageEndpointProbeResponse")), 401: errorResponse }
        }
      },
      "/settings": {
        get: {
          summary: "读取运行时设置",
          security: auth,
          responses: { 200: okJson(jsonSchemaRef("RuntimeSettingsResponse")), 401: errorResponse }
        }
      },
      "/settings/image-endpoints": {
        post: {
          summary: "新增或更新自定义 Image Gen API 端点",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("ImageEndpointRequest")) },
          responses: { 200: okJson(jsonSchemaRef("RuntimeImageEndpointResponse")), 400: errorResponse, 401: errorResponse }
        }
      },
      "/settings/image-endpoints/{id}": {
        patch: {
          summary: "更新自定义 Image Gen API 端点",
          security: auth,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("ImageEndpointRequest")) },
          responses: { 200: okJson(jsonSchemaRef("RuntimeImageEndpointResponse")), 400: errorResponse, 401: errorResponse, 404: errorResponse }
        },
        delete: {
          summary: "删除自定义 Image Gen API 端点",
          security: auth,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: okJson(jsonSchemaRef("RuntimeSettingsResponse")), 401: errorResponse, 404: errorResponse }
        }
      },
      "/settings/image-endpoints/{id}/activate": {
        post: {
          summary: "启用自定义 Image Gen API 端点",
          security: auth,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: okJson(jsonSchemaRef("RuntimeImageEndpointResponse")), 401: errorResponse, 404: errorResponse }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-laogui-api-key" }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", const: false },
            error: { type: "string" },
            details: {}
          }
        },
        Brief: {
          type: "object",
          additionalProperties: true,
          properties: {
            projectName: { type: "string" },
            spaceType: { type: "string" },
            area: { type: "string" },
            location: { type: "string" },
            style: { type: "string" },
            functions: { type: "string" },
            constraints: { type: "string" },
            preserveNotes: { type: "string" }
          }
        },
        InputImage: {
          type: "object",
          required: ["dataUrl"],
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            sourceType: { type: "string", enum: ["primary", "reference", "output"] },
            dataUrl: { type: "string", description: "data:image/...;base64,... 或可被前端保存的图片 data URL。" },
            weight: { type: "number" }
          },
          additionalProperties: true
        },
        PlanRequest: {
          type: "object",
          properties: {
            brief: jsonSchemaRef("Brief")
          },
          additionalProperties: true
        },
        PlanResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            plan: { type: "object", additionalProperties: true }
          }
        },
        GenerateImageRequest: {
          type: "object",
          required: ["imagePrompt"],
          properties: {
            brief: jsonSchemaRef("Brief"),
            direction: { type: "object", additionalProperties: true },
            imagePrompt: { type: "string" },
            userPrompt: { type: "string" },
            size: { type: "string", default: "1024x1536" },
            quality: { type: "string", enum: ["low", "medium", "high", "auto"], default: "low" },
            thinkingEnabled: { type: "boolean", default: false }
          },
          additionalProperties: true
        },
        GenerateImageResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            image: { type: "object", additionalProperties: true }
          }
        },
        RenderFromImagesRequest: {
          type: "object",
          properties: {
            mode: { type: "string", default: "custom" },
            brief: jsonSchemaRef("Brief"),
            intent: { type: "string" },
            userPrompt: { type: "string" },
            primaryImage: jsonSchemaRef("InputImage"),
            referenceImages: { type: "array", items: jsonSchemaRef("InputImage") },
            selection: { type: "object", additionalProperties: true },
            size: { type: "string", default: "1024x1536" },
            quality: { type: "string", enum: ["low", "medium", "high", "auto"], default: "low" },
            thinkingEnabled: { type: "boolean", default: false }
          },
          additionalProperties: true
        },
        RenderFromImagesResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            render: { type: "object", additionalProperties: true }
          }
        },
        DesignSeriesAnalyzeRequest: {
          type: "object",
          properties: {
            brief: jsonSchemaRef("Brief"),
            intent: { type: "string" },
            userPrompt: { type: "string" },
            referenceImages: { type: "array", items: jsonSchemaRef("InputImage") }
          },
          additionalProperties: true
        },
        DesignSeriesAnalyzeResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            analysis: { type: "object", additionalProperties: true }
          }
        },
        DesignSeriesGenerateRequest: {
          type: "object",
          properties: {
            brief: jsonSchemaRef("Brief"),
            intent: { type: "string" },
            userPrompt: { type: "string" },
            referenceImages: { type: "array", items: jsonSchemaRef("InputImage") },
            analysis: { type: "object", additionalProperties: true },
            seriesIndex: { type: "integer", minimum: 1 },
            seriesCount: { type: "integer", minimum: 1, maximum: 8 },
            size: { type: "string", default: "1024x1536" },
            quality: { type: "string", enum: ["low", "medium", "high", "auto"], default: "low" },
            thinkingEnabled: { type: "boolean", default: false }
          },
          additionalProperties: true
        },
        DesignSeriesGenerateResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            ok: { type: "boolean" },
            analysis: { type: "object", additionalProperties: true },
            render: { type: "object", additionalProperties: true }
          }
        },
        HealthResponse: { type: "object", additionalProperties: true },
        TaskLogsResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            logs: { type: "array", items: { type: "object", additionalProperties: true } }
          }
        },
        CanvasState: {
          type: "object",
          additionalProperties: true,
          properties: {
            version: { type: "integer" },
            activeCanvasId: { type: "string" },
            nextCanvasIndex: { type: "integer" },
            canvases: { type: "array", items: { type: "object", additionalProperties: true } }
          }
        },
        CanvasStateResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            state: jsonSchemaRef("CanvasState")
          }
        },
        CanvasStateSaveResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            savedAt: { type: "string" }
          }
        },
        ImageEndpointRequest: {
          type: "object",
          required: ["baseUrl", "apiKey"],
          properties: {
            label: { type: "string" },
            baseUrl: { type: "string", description: "可包含端口，例如 http://127.0.0.1:8080 或 https://api.example.com/v1" },
            apiKey: { type: "string" },
            responsesPath: { type: "string", default: "/v1/responses" },
            imageGenerationPath: { type: "string", default: "/v1/images/generations" },
            imageEditPath: { type: "string", default: "/v1/images/edits" },
            providerManifest: { type: "object", additionalProperties: true },
            enabled: { type: "boolean", default: true }
          }
        },
        RuntimeImageEndpoint: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            baseUrl: { type: "string" },
            responsesPath: { type: "string" },
            imageGenerationPath: { type: "string" },
            imageEditPath: { type: "string" },
            providerManifestName: { type: "string" },
            enabled: { type: "boolean" },
            keyConfigured: { type: "boolean" },
            keyPreview: { type: "string" }
          }
        },
        RuntimeSettingsResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            settings: {
              type: "object",
              properties: {
                imageEndpoints: { type: "array", items: jsonSchemaRef("RuntimeImageEndpoint") },
                activeImageBaseUrl: { type: "string" },
                imageBackend: { type: "string" },
                imageGenContract: { type: "string" }
              },
              additionalProperties: true
            }
          }
        },
        RuntimeImageEndpointResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            endpoint: jsonSchemaRef("RuntimeImageEndpoint"),
            settings: jsonSchemaRef("RuntimeSettingsResponse")
          },
          additionalProperties: true
        },
        ImageEndpointProbeRequest: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "只检测某个已保存自定义端点。留空时检测所有可用端点。" },
            baseUrl: { type: "string", description: "只检测某个 Base URL，可包含端口。" },
            apiKey: { type: "string", description: "临时检测未保存端点时使用，不会写入本机设置。" },
            label: { type: "string", description: "临时检测端点的显示名。" },
            responsesPath: { type: "string", default: "/v1/responses", description: "临时检测端点的 Responses 路径。" },
            imageGenerationPath: { type: "string", default: "/v1/images/generations" },
            imageEditPath: { type: "string", default: "/v1/images/edits" },
            providerManifest: { type: "object", additionalProperties: true },
            autoActivate: { type: "boolean", default: true, description: "检测后是否按可用性自动切换当前生图端点。单端点检测默认 false。" },
            timeoutMs: { type: "integer", minimum: 5000, maximum: 30000, default: 12000 }
          },
          additionalProperties: false
        },
        ImageEndpointProbeResponse: { type: "object", additionalProperties: true }
      }
    }
  };
}

function slugify(value) {
  return String(value || "item")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "-")
    .slice(0, 60) || "item";
}

async function serveStatic(req, res) {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  if (externalDataDirEnabled && requested.startsWith("/generated/")) {
    await serveStaticFromDir(req, res, generatedDir, requested.replace(/^\/generated\/?/, ""));
    return;
  }

  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    const cacheControl = [".html", ".css", ".js"].includes(ext)
      ? "no-store, max-age=0"
      : "public, max-age=31536000, immutable";
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": cacheControl,
      "content-length": stat.size,
      "last-modified": stat.mtime.toUTCString()
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function serveStaticFromDir(req, res, baseDir, requestedPath) {
  const safePath = path.normalize(decodeURIComponent(requestedPath || "")).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(baseDir, safePath);
  if (!filePath.startsWith(baseDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": stat.size,
      "last-modified": stat.mtime.toUTCString()
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function handleExternalApi(req, res, routePath) {
  if (!externalApiAuthorized(req)) {
    sendUnauthorizedApi(res);
    return;
  }

  if (req.method === "GET" && routePath === "/health") {
    sendJson(res, 200, healthBody());
    return;
  }

  if (req.method === "GET" && routePath === "/task-logs") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = clampNumber(Number(url.searchParams.get("limit") || 80), 1, 200);
    const clientId = clientIdFromRequest(req, url);
    const logs = await readTaskLogs(limit, clientId);
    sendJson(res, 200, { ok: true, clientId, logs });
    return;
  }

  const taskLogMatch = routePath.match(/^\/task-logs\/([^/]+)$/);
  if (taskLogMatch && req.method === "DELETE") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const result = await deleteTaskLog(decodeURIComponent(taskLogMatch[1]), clientId);
    sendJson(res, 200, { ok: true, clientId, ...result });
    return;
  }

  if (req.method === "GET" && routePath === "/task-result") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const taskId = taskIdFromBodyOrUrl({}, url);
    if (!taskId) {
      sendJson(res, 400, { ok: false, error: "Missing taskId" });
      return;
    }
    pruneTaskResults();
    const entry = taskResults.get(asyncTaskKey(clientId, taskId));
    if (!entry) {
      sendJson(res, 404, { ok: false, error: "Task result not found", status: "missing", taskId });
      return;
    }
    sendJson(res, 200, publicTaskEntry(entry));
    return;
  }

  if (req.method === "GET" && routePath === "/canvas-state") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const state = await readCanvasState(clientId);
    sendJson(res, 200, { ok: true, clientId, state });
    return;
  }

  if (req.method === "POST" && routePath === "/canvas-state") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const body = await readJson(req);
    const state = await writeCanvasState(body, clientId);
    sendJson(res, 200, { ok: true, clientId, savedAt: state.savedAt });
    return;
  }

  if (req.method === "POST" && routePath === "/image-endpoints/probe") {
    if (!isOwnerRequest(req)) {
      sendOwnerOnly(res);
      return;
    }
    const body = await readJson(req);
    sendJson(res, 200, await imageEndpointProbeBody(body));
    return;
  }

  if (req.method === "GET" && routePath === "/settings") {
    sendJson(res, 200, runtimeSettingsBody(req));
    return;
  }

  if (req.method === "POST" && routePath === "/settings/providers") {
    if (!isOwnerRequest(req)) {
      sendOwnerOnly(res);
      return;
    }
    const body = await readJson(req);
    const provider = await updateRuntimeProvider(String(body.kind || ""), body);
    sendJson(res, 200, { ok: true, provider: publicRuntimeProvider(provider), settings: runtimeSettingsBody(req).settings });
    return;
  }

  if (req.method === "POST" && routePath === "/settings/providers/probe") {
    if (!isOwnerRequest(req)) {
      sendOwnerOnly(res);
      return;
    }
    const body = await readJson(req);
    sendJson(res, 200, await providerProbeBody(body));
    return;
  }

  if (req.method === "GET" && routePath === "/storage") {
    sendJson(res, 200, { ok: true, summary: await generatedStorageSummary() });
    return;
  }

  if (req.method === "POST" && routePath === "/storage/maintenance") {
    if (!isOwnerRequest(req)) {
      sendOwnerOnly(res);
      return;
    }
    const body = await readJson(req);
    sendJson(res, 200, await runStorageMaintenance(body));
    return;
  }

  if (req.method === "POST" && routePath === "/settings/image-endpoints") {
    if (!isOwnerRequest(req)) {
      sendOwnerOnly(res);
      return;
    }
    const body = await readJson(req);
    const endpoint = await addRuntimeImageEndpoint(body);
    sendJson(res, 200, { ok: true, endpoint: publicRuntimeImageEndpoint(endpoint), settings: runtimeSettingsBody(req).settings });
    return;
  }

  const endpointMatch = routePath.match(/^\/settings\/image-endpoints\/([^/]+)(?:\/(activate))?$/);
  if (endpointMatch) {
    const id = decodeURIComponent(endpointMatch[1]);
    const action = endpointMatch[2] || "";
    if (req.method === "POST" && action === "activate") {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const endpoint = await activateRuntimeImageEndpoint(id);
      sendJson(res, 200, { ok: true, endpoint: publicRuntimeImageEndpoint(endpoint), settings: runtimeSettingsBody(req).settings });
      return;
    }
    if (req.method === "PATCH" && !action) {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const body = await readJson(req);
      const endpoint = await updateRuntimeImageEndpoint(id, body);
      sendJson(res, 200, { ok: true, endpoint: publicRuntimeImageEndpoint(endpoint), settings: runtimeSettingsBody(req).settings });
      return;
    }
    if (req.method === "DELETE" && !action) {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      await deleteRuntimeImageEndpoint(id);
      sendJson(res, 200, { ok: true, settings: runtimeSettingsBody(req).settings });
      return;
    }
  }

  if (req.method === "POST" && routePath === "/plan") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const body = await readJson(req);
    const plan = await runLoggedTask({
      type: "api-v1-plan",
      body,
      clientId,
      run: () => createDesignPlan(body.brief || body)
    });
    sendJson(res, 200, { ok: true, plan });
    return;
  }

  if (req.method === "POST" && routePath === "/images/generate") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const body = await readJson(req);
    const taskId = taskIdFromBodyOrUrl(body, url);
    const image = await runRecoverableTask({
      type: "api-v1-generate-image",
      body,
      clientId,
      taskId,
      run: () => runLoggedTask({
        type: "api-v1-generate-image",
        body,
        clientId,
        run: () => withImageGenerationSlot("api-v1-generate-image", () => generateImage(body))
      })
    });
    sendJson(res, 200, { ok: true, image });
    return;
  }

  if (req.method === "POST" && routePath === "/images/render-from-images") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const body = await readJson(req);
    const taskId = taskIdFromBodyOrUrl(body, url);
    const render = await runRecoverableTask({
      type: "api-v1-render-from-images",
      body,
      clientId,
      taskId,
      run: () => runLoggedTask({
        type: "api-v1-render-from-images",
        body,
        clientId,
        run: () => withImageGenerationSlot("api-v1-render-from-images", () => renderFromUploadedImages(body))
      })
    });
    sendJson(res, 200, { ok: true, render });
    return;
  }

  if (req.method === "POST" && routePath === "/design-series/analyze") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const body = await readJson(req);
    const analysis = await runLoggedTask({
      type: "api-v1-analyze-design-series",
      body,
      clientId,
      run: () => analyzeDesignSeriesReferences(body)
    });
    sendJson(res, 200, { ok: true, analysis });
    return;
  }

  if (req.method === "POST" && routePath === "/design-series/generate") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = clientIdFromRequest(req, url);
    const body = await readJson(req);
    const taskId = taskIdFromBodyOrUrl(body, url);
    const series = await runRecoverableTask({
      type: "api-v1-design-series",
      body,
      clientId,
      taskId,
      run: () => runLoggedTask({
        type: "api-v1-design-series",
        body,
        clientId,
        run: () => withImageGenerationSlot("api-v1-design-series", () => generateDesignSeries(body))
      })
    });
    sendJson(res, 200, { ok: true, ...series });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Unknown API v1 route" });
}

async function handleApi(req, res) {
  setApiCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!requireRemoteApiAuthorization(req, res)) return;

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api") {
      sendJson(res, 200, apiIndexBody(req));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/openapi.json") {
      sendJson(res, 200, createOpenApiDocument(req));
      return;
    }

    if (url.pathname === "/api/v1") {
      sendJson(res, 200, apiIndexBody(req));
      return;
    }

    if (url.pathname.startsWith("/api/v1/")) {
      await handleExternalApi(req, res, url.pathname.slice("/api/v1".length));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/canvas-state") {
      const clientId = clientIdFromRequest(req, url);
      const state = await readCanvasState(clientId);
      sendJson(res, 200, { ok: true, clientId, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/canvas-state") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const state = await writeCanvasState(body, clientId);
      sendJson(res, 200, { ok: true, clientId, savedAt: state.savedAt });
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/api/task-logs")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampNumber(Number(url.searchParams.get("limit") || 80), 1, 200);
      const clientId = clientIdFromRequest(req, url);
      const logs = await readTaskLogs(limit, clientId);
      sendJson(res, 200, { ok: true, clientId, logs });
      return;
    }

    const taskLogUrl = new URL(req.url, `http://${req.headers.host}`);
    const taskLogMatch = taskLogUrl.pathname.match(/^\/api\/task-logs\/([^/]+)$/);
    if (taskLogMatch && req.method === "DELETE") {
      const clientId = clientIdFromRequest(req, taskLogUrl);
      const result = await deleteTaskLog(decodeURIComponent(taskLogMatch[1]), clientId);
      sendJson(res, 200, { ok: true, clientId, ...result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/task-result") {
      const clientId = clientIdFromRequest(req, url);
      const taskId = taskIdFromBodyOrUrl({}, url);
      if (!taskId) {
        sendJson(res, 400, { ok: false, error: "Missing taskId" });
        return;
      }
      pruneTaskResults();
      const entry = taskResults.get(asyncTaskKey(clientId, taskId));
      if (!entry) {
        sendJson(res, 404, { ok: false, error: "Task result not found", status: "missing", taskId });
        return;
      }
      sendJson(res, 200, publicTaskEntry(entry));
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, healthBody());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/image-endpoints/probe") {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const body = await readJson(req);
      sendJson(res, 200, await imageEndpointProbeBody(body));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, runtimeSettingsBody(req));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/providers") {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const body = await readJson(req);
      const provider = await updateRuntimeProvider(String(body.kind || ""), body);
      sendJson(res, 200, { ok: true, provider: publicRuntimeProvider(provider), settings: runtimeSettingsBody(req).settings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/providers/probe") {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const body = await readJson(req);
      sendJson(res, 200, await providerProbeBody(body));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/storage") {
      sendJson(res, 200, { ok: true, summary: await generatedStorageSummary() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/storage/maintenance") {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const body = await readJson(req);
      sendJson(res, 200, await runStorageMaintenance(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/image-endpoints") {
      if (!isOwnerRequest(req)) {
        sendOwnerOnly(res);
        return;
      }
      const body = await readJson(req);
      const endpoint = await addRuntimeImageEndpoint(body);
      sendJson(res, 200, { ok: true, endpoint: publicRuntimeImageEndpoint(endpoint), settings: runtimeSettingsBody(req).settings });
      return;
    }

    const legacyEndpointUrl = new URL(req.url, `http://${req.headers.host}`);
    const legacyEndpointMatch = legacyEndpointUrl.pathname.match(/^\/api\/settings\/image-endpoints\/([^/]+)(?:\/(activate))?$/);
    if (legacyEndpointMatch) {
      const id = decodeURIComponent(legacyEndpointMatch[1]);
      const action = legacyEndpointMatch[2] || "";
      if (req.method === "POST" && action === "activate") {
        if (!isOwnerRequest(req)) {
          sendOwnerOnly(res);
          return;
        }
        const endpoint = await activateRuntimeImageEndpoint(id);
        sendJson(res, 200, { ok: true, endpoint: publicRuntimeImageEndpoint(endpoint), settings: runtimeSettingsBody(req).settings });
        return;
      }
      if (req.method === "PATCH" && !action) {
        if (!isOwnerRequest(req)) {
          sendOwnerOnly(res);
          return;
        }
        const body = await readJson(req);
        const endpoint = await updateRuntimeImageEndpoint(id, body);
        sendJson(res, 200, { ok: true, endpoint: publicRuntimeImageEndpoint(endpoint), settings: runtimeSettingsBody(req).settings });
        return;
      }
      if (req.method === "DELETE" && !action) {
        if (!isOwnerRequest(req)) {
          sendOwnerOnly(res);
          return;
        }
        await deleteRuntimeImageEndpoint(id);
        sendJson(res, 200, { ok: true, settings: runtimeSettingsBody(req).settings });
        return;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/task-log-event") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const entry = {
        id: randomUUID(),
        clientId,
        type: body.type || "client-event",
        status: body.status || "success",
        startedAt: body.startedAt || new Date().toISOString(),
        completedAt: body.completedAt || new Date().toISOString(),
        durationMs: Number(body.durationMs || 0),
        input: summarizeTaskInput(body.input || {}),
        result: summarizeTaskResult(body.result || {}),
        activeImageBaseUrl: config.imageProvider.baseUrl,
        clientLogged: true
      };
      await appendTaskLog(entry, clientId);
      sendJson(res, 200, { ok: true, log: entry });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plan") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const plan = await runLoggedTask({
        type: "plan",
        body,
        clientId,
        run: () => createDesignPlan(body.brief || body)
      });
      sendJson(res, 200, { ok: true, plan });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-image") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const taskId = taskIdFromBodyOrUrl(body, url);
      const image = await runRecoverableTask({
        type: "generate-image",
        body,
        clientId,
        taskId,
        run: () => runLoggedTask({
          type: "generate-image",
          body,
          clientId,
          run: () => withImageGenerationSlot("generate-image", () => generateImage(body))
        })
      });
      sendJson(res, 200, { ok: true, image });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/render-from-images") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const taskId = taskIdFromBodyOrUrl(body, url);
      const render = await runRecoverableTask({
        type: "render-from-images",
        body,
        clientId,
        taskId,
        run: () => runLoggedTask({
          type: "render-from-images",
          body,
          clientId,
          run: () => withImageGenerationSlot("render-from-images", () => renderFromUploadedImages(body))
        })
      });
      sendJson(res, 200, { ok: true, render });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/analyze-design-series") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const analysis = await runLoggedTask({
        type: "analyze-design-series",
        body,
        clientId,
        run: () => analyzeDesignSeriesReferences(body)
      });
      sendJson(res, 200, { ok: true, analysis });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design-series") {
      const clientId = clientIdFromRequest(req, url);
      const body = await readJson(req);
      const taskId = taskIdFromBodyOrUrl(body, url);
      const series = await runRecoverableTask({
        type: "design-series",
        body,
        clientId,
        taskId,
        run: () => runLoggedTask({
          type: "design-series",
          body,
          clientId,
          run: () => withImageGenerationSlot("design-series", () => generateDesignSeries(body))
        })
      });
      sendJson(res, 200, { ok: true, ...series });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Unknown API route" });
  } catch (error) {
    const status = error.status || 500;
    const logMethod = status === 499 ? console.warn : console.error;
    logMethod(`[api] ${req.method} ${req.url} failed: ${status} ${error.message || "Server error"}; body=${describeRequestSize(req)}`);
    if (res.writableEnded || res.destroyed) return;
    sendJson(res, status, {
      ok: false,
      error: error.message || "Server error",
      details: error.details || null
    });
  }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${config.port}`}`);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }
  await serveStatic(req, res);
});

export function closeLaoguiServer({ timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, timeoutMs);
    timer.unref?.();

    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections?.();
  });
}

server.listen(config.port, async () => {
  await loadRuntimeSettings().catch((error) => {
    console.warn(`[settings] runtime settings load failed: ${error.message || error}`);
  });
  const runtimeCount = runtimeSettings.imageEndpoints.filter((endpoint) => endpoint.enabled).length;
  if (runtimeCount) {
    const active = activeImageProviderSource();
    if (active?.baseUrl) config.imageProvider.baseUrl = active.baseUrl;
  }
  hydrateImageEndpointStatsFromTaskLogs();
  console.log(`老鬼AI running at http://localhost:${config.port}`);
  console.log(`Reasoning model: ${config.reasoningModel} via ${config.reasoningProvider.baseUrl}`);
  console.log(`Image model: ${config.imageModel} via ${config.imageProvider.baseUrls.join(", ")}`);
  console.log(`Reasoning key configured: ${config.reasoningProvider.apiKey ? "yes" : "no"}`);
  console.log(`Image key configured: ${imageProviderSources().some((source) => source.apiKey) ? "yes" : "no"}`);
  if (runtimeCount) console.log(`Runtime Image Gen endpoints configured: ${runtimeCount}`);
  setTimeout(() => {
    probeImageEndpoints().catch((error) => {
      console.warn(`[image-provider] endpoint probe failed: ${error.message || error}`);
    });
  }, 250);
});
