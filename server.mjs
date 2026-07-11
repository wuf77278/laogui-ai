import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
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
const defaultGeneratedDir = externalDataDirEnabled ? path.join(appDataDir, "generated") : path.join(publicDir, "generated");
const logsDir = path.join(appDataDir, "logs");
const taskLogPath = path.join(logsDir, "task-runs.jsonl");
const taskLogDir = path.join(logsDir, "task-runs");
const authUsersPath = path.join(logsDir, "auth-users.json");
const authSessionsPath = path.join(logsDir, "auth-sessions.json");
const canvasStatePath = path.join(logsDir, "canvas-state.json");
const canvasStateDir = path.join(logsDir, "canvas-states");
const runtimeSettingsPath = path.join(logsDir, "runtime-settings.json");
const PUBLIC_GENERATED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".svg",
  ".glb",
  ".gltf",
  ".dxf",
  ".scad",
  ".step",
  ".stl",
  ".3mf",
  ".mp4",
  ".mov"
]);
const activeChildProcesses = new Set();

function trackChildProcess(child) {
  if (!child) return child;
  activeChildProcesses.add(child);
  const cleanup = () => activeChildProcesses.delete(child);
  child.once("exit", cleanup);
  child.once("close", cleanup);
  child.once("error", cleanup);
  return child;
}

function isChildProcessRunning(child) {
  return child && child.exitCode === null && child.signalCode === null && !child.killed;
}

function terminateActiveChildProcesses({ forceAfterMs = 900 } = {}) {
  const children = [...activeChildProcesses].filter(isChildProcessRunning);
  if (!children.length) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const pending = new Set(children);
    const finishOne = (child) => {
      pending.delete(child);
      if (!pending.size) finish();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      children.filter(isChildProcessRunning).forEach((child) => {
        try {
          child.kill("SIGKILL");
        } catch {}
      });
      finish();
    }, Math.max(200, Number(forceAfterMs || 900)));
    timer.unref?.();

    children.forEach((child) => {
      const done = () => finishOne(child);
      child.once("exit", done);
      child.once("close", done);
      try {
        child.kill("SIGTERM");
      } catch {
        finishOne(child);
      }
    });
  });
}

function resolveAppDataDir() {
  if (process.env.LAOGUI_DATA_DIR) return path.resolve(process.env.LAOGUI_DATA_DIR);
  return __dirname;
}

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback || "").replace(/\/+$/, "");
}

function normalizeLocalDirectoryPath(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("\0")) {
    const error = new Error("目录路径无效。");
    error.status = 400;
    throw error;
  }
  const expanded = raw.replace(/^~(?=$|[/\\])/, process.env.HOME || "~");
  return path.resolve(expanded);
}

function defaultStorageSettings() {
  return {
    outputDir: defaultGeneratedDir,
    promptOnFirstRun: true,
    firstRunStoragePrompted: false,
    savePromptMode: "ask",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeStorageSettings(input = {}, existing = null) {
  const source = { ...(existing || defaultStorageSettings()), ...(input || {}) };
  return {
    outputDir: normalizeLocalDirectoryPath(source.outputDir || defaultGeneratedDir),
    promptOnFirstRun: parseBooleanEnv(source.promptOnFirstRun, true),
    firstRunStoragePrompted: parseBooleanEnv(source.firstRunStoragePrompted, false),
    savePromptMode: ["ask", "never"].includes(String(source.savePromptMode || "ask")) ? String(source.savePromptMode || "ask") : "ask",
    createdAt: existing?.createdAt || source.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function ensureRuntimeStorage() {
  runtimeSettings.storage = normalizeStorageSettings(runtimeSettings.storage || {}, runtimeSettings.storage || null);
  return runtimeSettings.storage;
}

function generatedDirectory() {
  return ensureRuntimeStorage().outputDir || defaultGeneratedDir;
}

function generatedArchiveDirectory() {
  return path.join(appDataDir, "archive", "generated");
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
  return ["images", "responses", "auto"].includes(mode) ? mode : "responses";
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
  return [];
}

function imageBaseUrlConfiguredByEnv() {
  return [
    "IMAGE_BASE_URL",
    "IMAGE_BASE_URLS",
    "IMAGE_COST_FIRST_BASE_URLS",
    "IMAGE_PRIORITY_BASE_URLS",
    "IMAGE_ENDPOINT_PRIORITY_BASE_URLS"
  ].some(envHasValue);
}

function includeDefaultImageBaseUrls() {
  if (envHasValue("IMAGE_INCLUDE_DEFAULT_BASE_URLS")) {
    return parseBooleanEnv(process.env.IMAGE_INCLUDE_DEFAULT_BASE_URLS, false);
  }
  return false;
}

function firstConfiguredEnv(names) {
  for (const name of names) {
    const direct = String(name || "").trim();
    if (!direct) continue;
    if (!/^[A-Z_][A-Z0-9_]*$/.test(direct)) return direct;
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function configuredYybbBaseUrl() {
  return firstConfiguredEnv(["YYBB_BASE_URL", "SAVED_YYBB_BASE_URL"])
    || (firstConfiguredEnv(["YYBB_API_KEY", "SAVED_YYBB_API_KEY"]) ? "https://yybb.codes" : "");
}

function configuredReasoningBaseUrl() {
  return normalizeBaseUrl(firstConfiguredEnv([
    "REASONING_BASE_URL",
    "OPENAI_BASE_URL",
    configuredYybbBaseUrl(),
    "SAVED_MXOU_BASE_URL"
  ]));
}

function configuredReasoningApiKey() {
  return firstConfiguredEnv([
    "REASONING_API_KEY",
    "OPENAI_API_KEY",
    "YYBB_API_KEY",
    "SAVED_YYBB_API_KEY",
    "SAVED_MXOU_API_KEY"
  ]);
}

function configuredReasoningModel() {
  return firstConfiguredEnv([
    "REASONING_MODEL",
    "SAVED_YYBB_REASONING_MODEL",
    "SAVED_MXOU_REASONING_MODEL"
  ]) || "gpt-5.5";
}

function configuredImageModel() {
  return firstConfiguredEnv([
    "IMAGE_MODEL",
    "SAVED_YYBB_IMAGE_MODEL",
    "SAVED_MXOU_IMAGE_MODEL"
  ]) || "gpt-image-2";
}

function configuredImageApiKey() {
  return firstConfiguredEnv([
    "IMAGE_API_KEY",
    "YYBB_API_KEY",
    "OPENAI_API_KEY",
    "FHL_API_KEY",
    "SAVED_YYBB_API_KEY",
    "SAVED_MXOU_API_KEY"
  ]);
}

function configuredImageBaseUrlAliases() {
  return uniqueBaseUrls([
    configuredYybbBaseUrl(),
    firstConfiguredEnv(["OPENAI_BASE_URL"]),
    firstConfiguredEnv(["FHL_BASE_URL", "FHL_IMAGE_BASE_URL"]),
    firstConfiguredEnv(["SAVED_MXOU_BASE_URL"])
  ]);
}

function costFirstImageBaseUrls() {
  const configured = splitBaseUrlList(process.env.IMAGE_COST_FIRST_BASE_URLS);
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
  const primaryFallback = firstConfiguredEnv([configuredYybbBaseUrl(), "OPENAI_BASE_URL", "SAVED_MXOU_BASE_URL"]);
  const primary = process.env.IMAGE_BASE_URL || primaryFallback;
  return uniqueBaseUrls([
    ...priorityBaseUrls,
    ...splitBaseUrlList(process.env.IMAGE_BASE_URLS),
    ...configuredImageBaseUrlAliases(),
    primary,
    ...(includeDefaults ? defaultImageBaseUrls() : [])
  ]);
}

const config = {
  port: Number(process.env.PORT || 4177),
  reasoningModel: configuredReasoningModel(),
  imageModel: configuredImageModel(),
  reasoningProvider: {
    baseUrl: configuredReasoningBaseUrl(),
    apiKey: configuredReasoningApiKey(),
    responsesPath: firstConfiguredEnv(["REASONING_RESPONSES_PATH", "SAVED_YYBB_RESPONSES_PATH", "SAVED_MXOU_RESPONSES_PATH"])
  },
  imageProvider: {
    baseUrl: normalizeBaseUrl(process.env.IMAGE_BASE_URL || firstConfiguredEnv([configuredYybbBaseUrl(), "OPENAI_BASE_URL", "SAVED_MXOU_BASE_URL"])),
    baseUrls: configuredImageBaseUrls(),
    apiKey: configuredImageApiKey(),
    responsesPath: firstConfiguredEnv(["IMAGE_RESPONSES_PATH", "SAVED_YYBB_RESPONSES_PATH", "SAVED_MXOU_RESPONSES_PATH"]),
    imageGenerationPath: process.env.IMAGE_GENERATIONS_PATH || process.env.IMAGE_GENERATION_PATH || "",
    imageEditPath: process.env.IMAGE_EDITS_PATH || process.env.IMAGE_EDIT_PATH || "",
    providerManifest: null
  },
  imageStudioFhlSkill: {
    enabled: process.env.IMAGE_STUDIO_FHL_ENABLED || process.env.FHL_IMAGE_STUDIO_ENABLED || "disabled",
    script: process.env.IMAGE_STUDIO_FHL_SCRIPT || "/Users/Apple_501/.codex/skills/image-studio-fhl/scripts/yingfang_image.py",
    provider: process.env.IMAGE_STUDIO_FHL_PROVIDER || "auto",
    outputDir: process.env.IMAGE_STUDIO_FHL_OUTPUT_DIR || path.join(logsDir, "image-studio-fhl"),
    timeoutSeconds: boundedIntegerEnv("IMAGE_STUDIO_FHL_TIMEOUT_SECONDS", 300, 30, 900)
  },
  imageStudioEngine: {
    mode: process.env.IMAGE_STUDIO_ENGINE || process.env.IMAGE_ENGINE || "required",
    cliPath: process.env.IMAGE_STUDIO_CLI_PATH || process.env.GPTCODEX_IMAGE_CLI || "",
    outputDir: process.env.IMAGE_STUDIO_OUTPUT_DIR || path.join(logsDir, "image-studio-engine"),
    timeoutSeconds: boundedIntegerEnv(["IMAGE_STUDIO_TIMEOUT_SECONDS", "IMAGE_STUDIO_ENGINE_TIMEOUT_SECONDS"], 360, 30, 1200),
    responsesTransport: process.env.IMAGE_STUDIO_RESPONSES_TRANSPORT || "sse",
    requestPolicy: process.env.IMAGE_STUDIO_REQUEST_POLICY || "openai",
    imagesNewApiCompat: parseBooleanEnv(process.env.IMAGE_STUDIO_IMAGES_NEW_API_COMPAT, true),
    reasoningEffort: process.env.IMAGE_STUDIO_REASONING_EFFORT || "xhigh",
    fastReasoningEffort: process.env.IMAGE_STUDIO_FAST_REASONING_EFFORT || "low",
    partialImages: boundedIntegerEnv("IMAGE_STUDIO_PARTIAL_IMAGES", 0, 0, 3),
    autoRetryCount: boundedIntegerEnv("IMAGE_STUDIO_AUTO_RETRY_COUNT", 1, 0, 8),
    allowNativeFallback: parseBooleanEnv(process.env.IMAGE_STUDIO_ALLOW_NATIVE_FALLBACK, false)
  },
  fastImagePromptMaxChars: boundedIntegerEnv("FAST_IMAGE_PROMPT_MAX_CHARS", 1200, 600, 8000),
  maxJsonBodyBytes: boundedIntegerEnv("MAX_JSON_BODY_MB", 80, 1, 200) * 1024 * 1024,
  downloadImageMaxBytes: boundedIntegerEnv("DOWNLOAD_IMAGE_MAX_MB", 25, 1, 100) * 1024 * 1024,
  downloadImageTimeoutMs: boundedIntegerEnv("DOWNLOAD_IMAGE_TIMEOUT_SECONDS", 15, 2, 120) * 1000,
  imageApiMode: normalizeImageApiMode(process.env.IMAGE_API_MODE || process.env.IMAGE_GENERATION_API_MODE || "responses"),
  imageGenerationConcurrency: boundedIntegerEnv(["IMAGE_GENERATION_CONCURRENCY", "LAOGUI_IMAGE_CONCURRENCY"], 2, 1, 8),
  imageGenerationQueueMaxPending: boundedIntegerEnv(["IMAGE_GENERATION_QUEUE_MAX_PENDING", "LAOGUI_IMAGE_QUEUE_MAX_PENDING"], 12, 0, 200),
  imageGenerationQueueTimeoutMs: boundedIntegerEnv(["IMAGE_GENERATION_QUEUE_TIMEOUT_SECONDS", "LAOGUI_IMAGE_QUEUE_TIMEOUT_SECONDS"], 600, 10, 3600) * 1000,
  publicApi: {
    token: process.env.LAOGUI_API_TOKEN || process.env.API_ACCESS_TOKEN || "",
    corsOrigin: process.env.API_CORS_ORIGIN || "",
    allowUnauthenticatedRemote: parseBooleanEnv(process.env.LAOGUI_ALLOW_UNAUTHENTICATED_REMOTE || process.env.API_ALLOW_UNAUTHENTICATED_REMOTE, false)
  },
  wechatLogin: {
    appId: process.env.WECHAT_LOGIN_APP_ID || process.env.WECHAT_APP_ID || "",
    appSecret: process.env.WECHAT_LOGIN_APP_SECRET || process.env.WECHAT_APP_SECRET || "",
    redirectUri: process.env.WECHAT_LOGIN_REDIRECT_URI || "",
    admins: String(process.env.WECHAT_ADMIN_OPENIDS || process.env.WECHAT_LOGIN_ADMIN_OPENIDS || "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  },
  host: normalizeBaseUrl(process.env.HOST || process.env.LAOGUI_HOST || "127.0.0.1")
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
  imageEndpoints: [],
  storage: null
};
const taskResults = new Map();
const authSessions = new Map();
let authUsers = [];
let authStorageLoaded = false;
const TASK_RESULT_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 30 * DAY_MS;
const AUTH_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const imageStudioCompatStatePath = path.join(
  process.env.HOME || "",
  "Library",
  "Application Support",
  "image-studio",
  "compat",
  "state.json"
);

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
const TEXT_COMPRESSION_MIN_BYTES = 1024;
const COMPRESSIBLE_STATIC_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".svg",
  ".gltf",
  ".dxf",
  ".scad",
  ".step",
  ".py",
  ".txt"
]);

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

function responseRequest(res) {
  return res.laoguiRequest || null;
}

function requestAcceptsGzip(req) {
  return /\bgzip\b|\*/i.test(readHeader(req || {}, "accept-encoding"));
}

function mergeVary(existing, value) {
  const current = String(existing || "").trim();
  if (!current) return value;
  if (current === "*") return current;
  const lower = current.split(",").map((item) => item.trim().toLowerCase());
  return lower.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}

function isCompressibleResponse(contentType = "") {
  const type = String(contentType).split(";")[0].trim().toLowerCase();
  return type.startsWith("text/")
    || type === "application/json"
    || type === "application/javascript"
    || type === "text/javascript"
    || type === "image/svg+xml"
    || type === "model/gltf+json"
    || type === "application/dxf"
    || type === "model/step";
}

function sendBuffered(res, status, body, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const responseHeaders = { ...headers };
  const req = responseRequest(res);
  const contentType = responseHeaders["content-type"] || responseHeaders["Content-Type"] || "";
  let payload = buffer;

  if (
    req
    && buffer.length >= TEXT_COMPRESSION_MIN_BYTES
    && requestAcceptsGzip(req)
    && isCompressibleResponse(contentType)
  ) {
    payload = gzipSync(buffer, { level: 6 });
    responseHeaders["content-encoding"] = "gzip";
    responseHeaders.vary = mergeVary(responseHeaders.vary, "Accept-Encoding");
  }

  responseHeaders["content-length"] = payload.length;
  res.writeHead(status, responseHeaders);
  res.end(payload);
}

function sendJson(res, status, body) {
  sendBuffered(res, status, JSON.stringify(body), jsonHeaders);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  sendBuffered(res, status, body, { "content-type": contentType });
}

function staticEtag(stat) {
  return `W/"${Math.round(stat.size).toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
}

function staticNotModified(req, stat, etag) {
  const ifNoneMatch = String(readHeader(req, "if-none-match") || "").trim();
  if (ifNoneMatch) {
    const tags = ifNoneMatch.split(",").map((item) => item.trim());
    if (tags.includes("*") || tags.includes(etag)) return true;
  }

  const ifModifiedSince = String(readHeader(req, "if-modified-since") || "").trim();
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (Number.isFinite(since) && stat.mtimeMs <= since) return true;
  }

  return false;
}

function staticCacheControl(ext) {
  return [".html", ".css", ".js"].includes(ext)
    ? "no-cache, max-age=0, must-revalidate"
    : "public, max-age=31536000, immutable";
}

async function writeStaticResponse(req, res, filePath, stat, contentType, { compressible = false, extraHeaders = {} } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const etag = staticEtag(stat);
  const headers = {
    "content-type": contentType,
    "cache-control": staticCacheControl(ext),
    "last-modified": stat.mtime.toUTCString(),
    etag,
    ...extraHeaders
  };

  if (staticNotModified(req, stat, etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (req.method === "HEAD") {
    res.writeHead(200, {
      ...headers,
      "content-length": stat.size
    });
    res.end();
    return;
  }

  if (compressible && stat.size >= TEXT_COMPRESSION_MIN_BYTES && requestAcceptsGzip(req)) {
    const raw = await fs.readFile(filePath);
    const payload = gzipSync(raw, { level: 6 });
    res.writeHead(200, {
      ...headers,
      "content-encoding": "gzip",
      "content-length": payload.length,
      vary: mergeVary(headers.vary, "Accept-Encoding")
    });
    res.end(payload);
    return;
  }

  res.writeHead(200, {
    ...headers,
    "content-length": stat.size
  });
  const stream = createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function decodeUrlPath(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, "Malformed URL path");
  }
}

function staticFilePath(baseDir, requestedPath = "") {
  const decodedPath = decodeUrlPath(requestedPath);
  const relativePath = path.normalize(decodedPath.replace(/^[/\\]+/, ""));
  if (!relativePath || relativePath === "." || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw httpError(403, "Forbidden");
  }

  const filePath = path.join(baseDir, relativePath);
  const relativeToBase = path.relative(baseDir, filePath);
  if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
    throw httpError(403, "Forbidden");
  }
  return filePath;
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
  const value = req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function externalApiAuthorized(req) {
  const token = config.publicApi.token;
  if (!token) return isOwnerRequest(req) || config.publicApi.allowUnauthenticatedRemote;
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

function hostHeaderParts(req) {
  const raw = String(readHeader(req, "host") || "");
  const bracketed = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) return { hostname: bracketed[1].toLowerCase(), port: bracketed[2] || String(config.port) };
  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [hostname, port] = raw.split(":");
    return { hostname: hostname.toLowerCase(), port: port || String(config.port) };
  }
  return { hostname: raw.toLowerCase(), port: String(config.port) };
}

function isLocalHostHeader(req) {
  const { hostname } = hostHeaderParts(req);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLoopbackHostname(hostname = "") {
  const normalized = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

function isOwnerOriginAllowed(req) {
  const origin = readHeader(req, "origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const requestHost = hostHeaderParts(req);
    const originHost = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const originPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    if (originHost === requestHost.hostname && originPort === requestHost.port) return true;
    return isLoopbackHostname(originHost) && originPort === requestHost.port;
  } catch {
    return false;
  }
}

function isOwnerFetchSiteAllowed(req) {
  const site = String(readHeader(req, "sec-fetch-site") || "").toLowerCase();
  return !site || site === "same-origin" || site === "same-site" || site === "none";
}

function requestHasJsonBody(req) {
  if (!requestByteLength(req) && !readHeader(req, "transfer-encoding")) return true;
  const contentType = String(readHeader(req, "content-type") || "").toLowerCase();
  return contentType.split(";")[0].trim() === "application/json";
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

function sendOwnerWriteRejected(res, message, status = 403) {
  sendJson(res, status, {
    ok: false,
    error: message
  });
}

function requireOwnerWriteRequest(req, res) {
  if (!isOwnerRequest(req)) {
    sendOwnerOnly(res);
    return false;
  }
  if (!isOwnerOriginAllowed(req) || !isOwnerFetchSiteAllowed(req)) {
    sendOwnerWriteRejected(res, "本机写入接口拒绝跨站请求。请从当前 localhost 页面发起操作。");
    return false;
  }
  if (!requestHasJsonBody(req)) {
    sendOwnerWriteRejected(res, "写入接口只接受 application/json 请求体。", 415);
    return false;
  }
  return true;
}

function isRemoteRequest(req) {
  return !isOwnerRequest(req);
}

async function requireRemoteApiAuthorization(req, res) {
  if (!isRemoteRequest(req)) return true;
  if (externalApiAuthorized(req)) return true;
  if (await authSessionFromRequest(req)) return true;
  sendUnauthorizedApi(res);
  return false;
}

function wechatLoginConfigured() {
  return Boolean(config.wechatLogin.appId && config.wechatLogin.appSecret);
}

function publicOrigin(req) {
  const proto = readHeader(req, "x-forwarded-proto") || (req.socket?.encrypted ? "https" : "http");
  const host = readHeader(req, "x-forwarded-host") || readHeader(req, "host") || `localhost:${config.port}`;
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
}

function wechatRedirectUri(req) {
  return config.wechatLogin.redirectUri || `${publicOrigin(req)}/api/auth/wechat/callback`;
}

function parseCookies(req) {
  const header = readHeader(req, "cookie");
  const cookies = {};
  String(header || "").split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });
  return cookies;
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader("set-cookie");
  if (!existing) {
    res.setHeader("set-cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("set-cookie", [...existing, cookie]);
  } else {
    res.setHeader("set-cookie", [existing, cookie]);
  }
}

function cookieFlags(req, { maxAge = null } = {}) {
  const secure = publicOrigin(req).startsWith("https://") ? "; Secure" : "";
  const age = maxAge == null ? "" : `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  return `${age}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function setAuthCookie(req, res, name, value, options = {}) {
  appendSetCookie(res, `${name}=${encodeURIComponent(value)}${cookieFlags(req, options)}`);
}

function clearAuthCookie(req, res, name) {
  setAuthCookie(req, res, name, "", { maxAge: 0 });
}

function authClientIdForOpenId(openid) {
  const digest = createHash("sha256")
    .update(`${config.wechatLogin.appId}:${openid}`)
    .digest("hex")
    .slice(0, 32);
  return `wx-${digest}`;
}

function publicAuthUser(user = null) {
  if (!user) return null;
  return {
    id: user.id,
    clientId: user.clientId,
    nickname: user.nickname || "微信用户",
    headimgurl: user.headimgurl || "",
    city: user.city || "",
    province: user.province || "",
    country: user.country || "",
    lastLoginAt: user.lastLoginAt || "",
    createdAt: user.createdAt || ""
  };
}

async function loadAuthStorage() {
  if (authStorageLoaded) return;
  authStorageLoaded = true;
  try {
    const raw = await fs.readFile(authUsersPath, "utf8");
    const parsed = JSON.parse(raw);
    authUsers = Array.isArray(parsed.users) ? parsed.users : [];
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`[auth] users load failed: ${error.message || error}`);
    authUsers = [];
  }
  try {
    const raw = await fs.readFile(authSessionsPath, "utf8");
    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const now = Date.now();
    sessions.forEach((session) => {
      const expiresAt = new Date(session.expiresAt || 0).getTime();
      if (session.id && expiresAt > now) authSessions.set(session.id, session);
    });
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`[auth] sessions load failed: ${error.message || error}`);
  }
}

async function saveAuthUsers() {
  await fs.mkdir(path.dirname(authUsersPath), { recursive: true });
  await fs.writeFile(authUsersPath, `${JSON.stringify({ users: authUsers }, null, 2)}\n`);
}

async function saveAuthSessions() {
  await fs.mkdir(path.dirname(authSessionsPath), { recursive: true });
  const now = Date.now();
  const sessions = [...authSessions.values()].filter((session) => new Date(session.expiresAt || 0).getTime() > now);
  authSessions.clear();
  sessions.forEach((session) => authSessions.set(session.id, session));
  await fs.writeFile(authSessionsPath, `${JSON.stringify({ sessions }, null, 2)}\n`);
}

async function upsertWechatUser(profile = {}) {
  await loadAuthStorage();
  const openid = String(profile.openid || "").trim();
  if (!openid) throw httpError(400, "微信登录缺少 openid");
  const now = new Date().toISOString();
  const clientId = authClientIdForOpenId(openid);
  const existing = authUsers.find((user) => user.openid === openid) || null;
  const user = {
    ...(existing || {}),
    id: existing?.id || randomUUID(),
    provider: "wechat",
    openid,
    unionid: profile.unionid || existing?.unionid || "",
    clientId,
    nickname: profile.nickname || existing?.nickname || "微信用户",
    headimgurl: profile.headimgurl || existing?.headimgurl || "",
    city: profile.city || existing?.city || "",
    province: profile.province || existing?.province || "",
    country: profile.country || existing?.country || "",
    createdAt: existing?.createdAt || now,
    lastLoginAt: now
  };
  authUsers = [user, ...authUsers.filter((item) => item.openid !== openid)];
  await saveAuthUsers();
  return user;
}

async function createAuthSession(req, res, user) {
  await loadAuthStorage();
  const id = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = {
    id,
    userId: user.id,
    clientId: user.clientId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AUTH_SESSION_TTL_MS).toISOString()
  };
  authSessions.set(id, session);
  await saveAuthSessions();
  setAuthCookie(req, res, "laogui_session", id, { maxAge: Math.floor(AUTH_SESSION_TTL_MS / 1000) });
  return session;
}

async function authSessionFromRequest(req) {
  await loadAuthStorage();
  const sessionId = parseCookies(req).laogui_session || "";
  if (!sessionId) return null;
  const session = authSessions.get(sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt || 0).getTime() <= Date.now()) {
    authSessions.delete(sessionId);
    saveAuthSessions().catch((error) => console.warn(`[auth] session prune failed: ${error.message || error}`));
    return null;
  }
  const user = authUsers.find((item) => item.id === session.userId) || null;
  if (!user) return null;
  return { session, user };
}

async function isAdminRequest(req) {
  if (isOwnerRequest(req)) return true;
  const auth = await authSessionFromRequest(req);
  if (!auth?.user?.openid) return false;
  return config.wechatLogin.admins.includes(auth.user.openid);
}

async function authenticatedClientId(req, url = null) {
  const adminTarget = url?.searchParams?.get("userClientId") || "";
  if (adminTarget && await isAdminRequest(req)) return sanitizeClientId(adminTarget);
  const auth = await authSessionFromRequest(req);
  return auth?.session?.clientId ? sanitizeClientId(auth.session.clientId) : "";
}

async function clientIdFromRequest(req, url, { requiredForRemote = true } = {}) {
  const authClientId = await authenticatedClientId(req, url);
  if (authClientId) return authClientId;
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

function defaultResponsesPathForBaseUrl(baseUrl = "") {
  return isYybbBaseUrl(baseUrl) ? "/responses" : "/v1/responses";
}

function normalizeResponsesPathForBaseUrl(baseUrl = "", value = "") {
  const normalized = normalizeProviderApiPath(value || defaultResponsesPathForBaseUrl(baseUrl), defaultResponsesPathForBaseUrl(baseUrl));
  if (isFhlBaseUrl(baseUrl) && normalized === "/responses") return "/v1/responses";
  return normalized;
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

function selectCustomProviderFromExport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const providers = Array.isArray(input.customProviders)
    ? input.customProviders.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
  if (!providers.length) return null;

  const preferredIds = [
    input.providerId,
    input.customProviderId,
    input.selectedProviderId,
    input.activeProviderId,
    input.defaultProviderId
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const id of preferredIds) {
    const match = providers.find((provider) => String(provider.id || "").trim() === id || String(provider.name || "").trim() === id);
    if (match) return match;
  }

  if (Array.isArray(input.profiles)) {
    const activeProfile = input.profiles.find((profile) => profile && typeof profile === "object" && profile.active && profile.provider);
    if (activeProfile) {
      const match = providers.find((provider) => String(provider.id || "").trim() === String(activeProfile.provider).trim());
      if (match) return match;
    }
  }

  if (providers.length === 1) return providers[0];
  return providers[0];
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
  if (!input.submit && Array.isArray(input.customProviders) && input.customProviders.length) {
    const selected = selectCustomProviderFromExport(input);
    return selected ? normalizeProviderManifest(selected) : null;
  }
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

function runtimeImageProviderForBaseUrl(baseUrl) {
  const provider = runtimeSettings.providers.image;
  if (!provider?.apiKey || !provider.baseUrl) return null;
  return normalizeBaseUrl(provider.baseUrl) === normalizeBaseUrl(baseUrl) ? provider : null;
}

function imageProviderApiKey(baseUrl) {
  const runtimeProvider = runtimeImageProviderForBaseUrl(baseUrl);
  if (runtimeProvider) return runtimeProvider.apiKey;
  if (isYybbBaseUrl(baseUrl)) {
    return firstConfiguredEnv(["IMAGE_API_KEY", "YYBB_API_KEY", "SAVED_YYBB_API_KEY", "OPENAI_API_KEY"])
      || config.imageProvider.apiKey;
  }
  if (isFhlBaseUrl(baseUrl)) {
    return firstConfiguredEnv(["FHL_API_KEY", "IMAGE_API_KEY", "OPENAI_API_KEY"])
      || config.imageProvider.apiKey;
  }
  if (firstConfiguredEnv(["SAVED_MXOU_BASE_URL"]) && normalizeBaseUrl(baseUrl) === normalizeBaseUrl(process.env.SAVED_MXOU_BASE_URL)) {
    return firstConfiguredEnv(["SAVED_MXOU_API_KEY", "IMAGE_API_KEY", "OPENAI_API_KEY"])
      || config.imageProvider.apiKey;
  }
  return firstConfiguredEnv(["IMAGE_API_KEY", "OPENAI_API_KEY", "YYBB_API_KEY", "SAVED_YYBB_API_KEY", "SAVED_MXOU_API_KEY"])
    || config.imageProvider.apiKey;
}

function imageProviderKeySource(baseUrl) {
  if (runtimeImageProviderForBaseUrl(baseUrl)) return "runtime";
  if (isYybbBaseUrl(baseUrl)) return firstConfiguredEnv(["YYBB_API_KEY", "SAVED_YYBB_API_KEY"]) ? "yybb" : "image";
  if (isFhlBaseUrl(baseUrl)) return firstConfiguredEnv(["FHL_API_KEY"]) ? "fhl" : "image";
  if (firstConfiguredEnv(["SAVED_MXOU_BASE_URL"]) && normalizeBaseUrl(baseUrl) === normalizeBaseUrl(process.env.SAVED_MXOU_BASE_URL)) return "mxou";
  return firstConfiguredEnv(["OPENAI_API_KEY"]) ? "openai" : "image";
}

function runtimeImageEndpointSources() {
  return runtimeSettings.imageEndpoints
    .filter((endpoint) => endpoint?.enabled !== false)
    .map((endpoint) => ({
      ...endpoint,
      runtimeId: endpoint.id,
      kind: imageProviderKind(endpoint.baseUrl),
      keySource: "runtime",
      apiMode: endpoint.apiMode || config.imageApiMode,
      responsesTransport: endpoint.responsesTransport || config.imageStudioEngine.responsesTransport,
      requestPolicy: endpoint.requestPolicy || config.imageStudioEngine.requestPolicy,
      imagesNewApiCompat: parseBooleanEnv(endpoint.imagesNewApiCompat, config.imageStudioEngine.imagesNewApiCompat),
      reasoningEffort: endpoint.reasoningEffort || config.imageStudioEngine.reasoningEffort,
      model: endpoint.model || config.imageModel,
      responsesPath: normalizeResponsesPathForBaseUrl(endpoint.baseUrl, endpoint.responsesPath)
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
    model: config.imageModel,
    imageGenerationPath: config.imageProvider.imageGenerationPath,
    imageEditPath: config.imageProvider.imageEditPath,
    providerManifest: config.imageProvider.providerManifest || null,
    apiMode: config.imageApiMode,
    responsesTransport: config.imageStudioEngine.responsesTransport,
    requestPolicy: config.imageStudioEngine.requestPolicy,
    imagesNewApiCompat: config.imageStudioEngine.imagesNewApiCompat,
    reasoningEffort: config.imageStudioEngine.reasoningEffort,
    responsesPath: normalizeResponsesPathForBaseUrl(baseUrl, isFhlBaseUrl(baseUrl)
      ? (process.env.FHL_RESPONSES_PATH || config.imageProvider.responsesPath)
      : config.imageProvider.responsesPath)
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
  const child = trackChildProcess(spawn("curl", [
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
  ]));

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
      const providerApiMode = normalizeImageApiMode(provider.apiMode || config.imageApiMode);
      imageProbeSource = {
        ...source,
        responsesPath,
        imageGenerationPath: provider.imageGenerationPath || source.imageGenerationPath || config.imageProvider.imageGenerationPath,
        imageEditPath: provider.imageEditPath || source.imageEditPath || config.imageProvider.imageEditPath,
        providerManifest: provider.providerManifest || source.providerManifest || null,
        model,
        apiMode: providerApiMode,
        responsesTransport: provider.responsesTransport || config.imageStudioEngine.responsesTransport,
        requestPolicy: provider.requestPolicy || config.imageStudioEngine.requestPolicy,
        imagesNewApiCompat: parseBooleanEnv(provider.imagesNewApiCompat, config.imageStudioEngine.imagesNewApiCompat),
        reasoningEffort: provider.reasoningEffort || config.imageStudioEngine.reasoningEffort,
        keySource: "runtime",
        label: shortRuntimeEndpointLabel(source.baseUrl)
      };
      const engineStatus = imageStudioEngineStatus();
      const useNativeAdapter = imageProviderNeedsNativeAdapter(imageProbeSource);
      const nativeApiMode = imageProbeSource.providerManifest ? "images" : providerApiMode;
      const generated = engineStatus.enabled && engineStatus.available && !useNativeAdapter
        ? await runImageStudioEngine({
            prompt: "A tiny clean test image: a simple modern wooden chair on a white background. No text, no watermark.",
            inputImages: [],
            size: "1024x1024",
            quality: "low",
            sourceOverride: imageProbeSource,
            imageModelOverride: model || config.imageModel,
            textModelOverride: config.reasoningModel || "gpt-5.5"
          })
        : nativeApiMode === "responses"
        ? await openaiResponsesImageDirect({
            prompt: "A tiny clean test image: a simple modern wooden chair on a white background. No text, no watermark.",
            inputImages: [],
            size: "1024x1024",
            quality: "low",
            useProviderPool: false,
            source: imageProbeSource
          })
        : await openaiCompatibleImagesFromSource({
            prompt: "A tiny clean test image: a simple modern wooden chair on a white background. No text, no watermark.",
            inputImages: [],
            size: "1024x1024",
              quality: "low"
            }, { timeoutMs, source: imageProbeSource });
      imageBytes = generated.buffer?.length || 0;
      message = `${generated.imageApi === "image-studio-cli" ? "Image Studio CLI" : generated.imageApi === "responses" ? "Responses Image Gen" : "Images API"} 检测成功，已返回图片数据 ${formatBytes(imageBytes)}。`;
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

async function openaiResponsesImageDirect({ prompt, inputImages, size, quality, useProviderPool = true, source = null }) {
  const providerSource = source || activeImageProviderSource();
  const imageModel = providerSource?.model || config.imageModel;
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
        model: imageModel,
        action: inputImages.length ? "edit" : "generate",
        size,
        quality: normalizeImageToolQuality(quality),
        output_format: "png",
        partial_images: 0
      }
    ],
    tool_choice: { type: "image_generation" },
    reasoning: {
      effort: normalizeImageStudioReasoningEffort(providerSource?.reasoningEffort || config.imageStudioEngine.reasoningEffort)
    },
    store: false,
    stream: true,
    instructions: "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave."
  };
  if (useProviderPool) {
    return openaiResponsesImageStreamWithProviderPool(payload, { timeoutMs: 420000, provider: "image" });
  }
  return openaiResponsesImageStreamFromSource(payload, {
    timeoutMs: 420000,
    source: providerSource
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

function imageProviderNeedsNativeAdapter(source) {
  if (!source) return false;
  const apiMode = normalizeImageApiMode(source?.apiMode || config.imageApiMode);
  if (source?.providerManifest || apiMode === "auto") return true;
  if (apiMode === "images") {
    return providerImageApiPath(source, "generation") !== "/v1/images/generations"
      || providerImageApiPath(source, "edit") !== "/v1/images/edits";
  }
  return apiMode === "responses" && providerResponsesPath(source) !== "/v1/responses";
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
      model: source?.model || config.imageModel,
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
    model: source?.model || config.imageModel,
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

function imageBufferToDataUrl(buffer, mime = "image/png") {
  return `data:${mime};base64,${Buffer.from(buffer || []).toString("base64")}`;
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

function ipv4Parts(address) {
  const parts = String(address || "").split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function isBlockedIpv4(address) {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isBlockedIpv6(address) {
  const normalized = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized || normalized === "::" || normalized === "::1") return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);
  return normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:");
}

function isBlockedNetworkAddress(address) {
  const normalized = String(address || "").replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

function downloadContentTypeFromPath(urlPath = "") {
  const ext = path.extname(urlPath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".svg": "image/svg+xml"
  }[ext] || "";
}

async function assertPublicDownloadUrl(parsed) {
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw httpError(400, "Only HTTP(S) image URLs can be downloaded");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopbackHostname(hostname)) {
    throw httpError(400, "Local image URLs are not allowed");
  }
  if (isIP(hostname)) {
    if (isBlockedNetworkAddress(hostname)) throw httpError(400, "Private or reserved image URLs are not allowed");
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some((entry) => isBlockedNetworkAddress(entry.address))) {
    throw httpError(400, "Private or reserved image URLs are not allowed");
  }
}

async function fetchPublicImage(url) {
  let current = new URL(url);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertPublicDownloadUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.downloadImageTimeoutMs);
    let response;
    try {
      response = await fetch(current.href, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw httpError(502, "Image URL redirect is missing a location");
      current = new URL(location, current);
      continue;
    }
    return { response, url: current };
  }
  throw httpError(508, "Image URL redirected too many times");
}

async function readLimitedResponseBuffer(response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > config.downloadImageMaxBytes) {
    throw httpError(413, `Image is too large; limit is ${Math.round(config.downloadImageMaxBytes / 1024 / 1024)}MB`);
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > config.downloadImageMaxBytes) {
      throw httpError(413, `Image is too large; limit is ${Math.round(config.downloadImageMaxBytes / 1024 / 1024)}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function downloadImageUrlBuffer(url) {
  const result = await downloadImageUrlResult(url);
  return result.buffer;
}

async function downloadImageUrlResult(url) {
  const parsed = new URL(url);
  const { response, url: finalUrl } = await fetchPublicImage(parsed.href);
  if (!response.ok) throw httpError(502, `Image URL download failed: ${response.status}`);
  const headerType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const extensionType = downloadContentTypeFromPath(finalUrl.pathname);
  const type = headerType.startsWith("image/") ? headerType : extensionType;
  if (!type || !type.startsWith("image/")) {
    throw httpError(415, "Downloaded URL did not return an image");
  }
  return {
    buffer: await readLimitedResponseBuffer(response),
    type
  };
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
  } catch (error) {
    const jsonText = extractFirstJsonObject(cleaned);
    if (!jsonText) {
      const next = new Error("gpt-5.5 did not return JSON");
      next.rawText = truncateLogText(cleaned, 12000);
      throw next;
    }
    try {
      return JSON.parse(jsonText);
    } catch (innerError) {
      const next = new Error(`gpt-5.5 returned invalid JSON: ${innerError.message || error.message || innerError}`);
      next.rawText = truncateLogText(jsonText, 12000);
      throw next;
    }
  }
}

async function parseModelJsonWithRepair(text, purpose = "model output JSON") {
  try {
    return parseModelJson(text);
  } catch (error) {
    const rawText = String(error.rawText || text || "").trim();
    if (!rawText) throw error;
    const payload = {
      model: config.reasoningModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Repair the following assistant output into one valid JSON object.",
                `Purpose: ${purpose}.`,
                "Do not add new facts. Preserve keys and values as much as possible.",
                "Use double-quoted JSON strings only. Escape line breaks inside strings. Remove comments, markdown, trailing commas, and unfinished fragments.",
                "Return valid JSON only.",
                rawText
              ].join("\n\n")
            }
          ]
        }
      ],
      max_output_tokens: 5200
    };
    const repaired = await openaiResponsesTextStream(payload, { timeoutMs: 120000, provider: "reasoning" });
    return parseModelJson(repaired);
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

const whiteModelObjectTypes = new Set([
  "floor",
  "wall",
  "ceiling",
  "column",
  "beam",
  "opening",
  "stair",
  "box",
  "counter",
  "table",
  "seat",
  "shelf",
  "fixture",
  "plant",
  "generic"
]);

const model3DShapeTypes = new Set(["box", "cylinder", "sphere", "plane"]);

const whiteModelMaterialPalette = {
  floor: "#b89f7a",
  wall: "#eadfce",
  ceiling: "#f0eadf",
  column: "#c9c1b4",
  beam: "#9a8064",
  opening: "#86b9cf",
  stair: "#b8a083",
  box: "#b78b65",
  counter: "#7f654f",
  table: "#8b6f55",
  seat: "#586f7c",
  shelf: "#8a715c",
  fixture: "#d4a94f",
  plant: "#5c8f5c",
  generic: "#a99986"
};

const whiteModelLayerDefinitions = [
  ["shell", "空间壳体"],
  ["openings", "门窗开口"],
  ["structure", "结构构件"],
  ["fixed_furniture", "固定家具"],
  ["loose_furniture", "活动家具"],
  ["lighting", "灯光设备"],
  ["context", "绿植/环境"]
];

const whiteModelLayerKeys = new Set(whiteModelLayerDefinitions.map(([key]) => key));

function asFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeVector(value, fallback, { min = -100, max = 100 } = {}) {
  const source = Array.isArray(value) ? value : [];
  return fallback.map((fallbackValue, index) => clampNumber(asFiniteNumber(source[index], fallbackValue), min, max));
}

function whiteModelLayerForObject(type, item = {}) {
  const explicit = String(item?.layer || item?.category || "").trim().toLowerCase();
  if (whiteModelLayerKeys.has(explicit)) return explicit;
  const text = `${item?.id || ""} ${item?.label || ""} ${item?.name || ""} ${item?.material || ""} ${item?.note || ""}`.toLowerCase();
  if (/(window|door|opening|glass|门|窗|开口|玻璃|入口)/i.test(text)) return "openings";
  if (/(roof|eave|gable|canopy|parapet|chimney|屋顶|屋面|檐|山墙|雨棚|女儿墙|烟囱)/i.test(text)) return "structure";
  if (/(stair|step|column|beam|post|plinth|base|slab|terrace|balcony|cornice|retaining|台阶|楼梯|柱|梁|立柱|基座|勒脚|台基|楼板|露台|阳台|檐口|挡墙)/i.test(text)) return "structure";
  if (/(building|facade|façade|front wall|side wall|rear wall|mass|volume|wing|envelope|exterior wall|建筑|立面|外墙|侧墙|后墙|主楼体|体量|翼体|围护)/i.test(text)) return "shell";
  if (/(site|ground|landscape|tree|plant|场地|地面|景观|绿化|树|植栽)/i.test(text)) return "context";
  if (["floor", "wall", "ceiling"].includes(type)) return "shell";
  if (type === "opening") return "openings";
  if (["column", "beam", "stair"].includes(type)) return "structure";
  if (type === "plant") return "context";
  if (type === "fixture" && /(light|lamp|pendant|sconce|spot|track|灯|吊灯|壁灯|射灯|灯带)/i.test(text)) return "lighting";
  if (["counter", "shelf", "fixture"].includes(type)) return "fixed_furniture";
  if (["table", "seat", "box"].includes(type)) return "loose_furniture";
  return "fixed_furniture";
}

function normalizeWhiteModelObject(item, index) {
  const rawType = String(item?.type || "").trim().toLowerCase();
  const type = whiteModelObjectTypes.has(rawType) ? rawType : "generic";
  const rawShape = String(item?.shape || item?.primitive || "").trim().toLowerCase();
  const shape = model3DShapeTypes.has(rawShape)
    ? rawShape
    : type === "column" || type === "plant"
      ? "cylinder"
      : "box";
  const sizeFallback = type === "floor"
    ? [8, 6, 0.08]
    : type === "wall"
      ? [4, 0.18, 3]
      : type === "column"
        ? [0.35, 0.35, 3]
        : [1, 1, 1];
  const sizeMin = type === "generic" ? 0.003 : type === "fixture" || type === "plant" ? 0.01 : 0.03;
  const size = normalizeVector(item?.size, sizeFallback, { min: sizeMin, max: 80 });
  const position = normalizeVector(item?.position, [0, size[2] / 2, 0], { min: -80, max: 80 });
  const rotation = normalizeVector(item?.rotation, [0, 0, 0], { min: -360, max: 360 });
  const color = isHex(item?.color) ? item.color : whiteModelMaterialPalette[type] || whiteModelMaterialPalette.generic;
  const material = String(item?.material || "").slice(0, 40);
  return {
    id: slugify(item?.id || item?.label || `${type}-${index + 1}`),
    type,
    shape,
    label: String(item?.label || item?.name || `${type} ${index + 1}`).slice(0, 40),
    size: size.map((value) => Number(value.toFixed(3))),
    position: position.map((value) => Number(value.toFixed(3))),
    rotation: rotation.map((value) => Number(value.toFixed(3))),
    color,
    layer: whiteModelLayerForObject(type, item),
    material,
    roughness: clampNumber(asFiniteNumber(item?.roughness, 0.68), 0.05, 1),
    metalness: clampNumber(asFiniteNumber(item?.metalness, type === "fixture" ? 0.35 : 0.02), 0, 1),
    opacity: clampNumber(asFiniteNumber(item?.opacity, type === "opening" ? 0.42 : 1), 0.18, 1),
    note: String(item?.note || "").slice(0, 180)
  };
}

function uniqueWhiteModelObjects(objects) {
  const counts = new Map();
  return objects.map((object, index) => {
    const base = slugify(object.id || object.label || `${object.type}-${index + 1}`) || `${object.type}-${index + 1}`;
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    return {
      ...object,
      id: seen ? `${base}-${seen + 1}` : base,
      layer: whiteModelLayerKeys.has(object.layer) ? object.layer : whiteModelLayerForObject(object.type, object)
    };
  });
}

function whiteModelBounds(objects) {
  if (!objects.length) return { width: 8, depth: 6, height: 3 };
  const xs = [];
  const ys = [];
  const zs = [];
  objects.forEach((object) => {
    const [w, d, h] = object.size;
    const [x, y, z] = object.position;
    xs.push(x - w / 2, x + w / 2);
    ys.push(y - h / 2, y + h / 2);
    zs.push(z - d / 2, z + d / 2);
  });
  return {
    width: Number((Math.max(...xs) - Math.min(...xs)).toFixed(3)),
    depth: Number((Math.max(...zs) - Math.min(...zs)).toFixed(3)),
    height: Number((Math.max(...ys) - Math.min(...ys)).toFixed(3))
  };
}

function whiteModelPrimaryFloor(objects) {
  return objects
    .filter((object) => object.type === "floor")
    .sort((a, b) => (b.size?.[0] || 0) * (b.size?.[1] || 0) - (a.size?.[0] || 0) * (a.size?.[1] || 0))[0] || null;
}

function addWhiteModelFallbackObject(objects, object) {
  objects.push(normalizeWhiteModelObject({
    ...object,
    note: object.note || "Completeness fallback inferred from overall spatial envelope."
  }, objects.length));
}

function whiteModelHasObjectText(objects = [], pattern) {
  return objects.some((object) => pattern.test(whiteModelObjectSearchText(object)));
}

function completeWhiteModelEnvelope(objects, sourceType = "") {
  const normalizedSource = String(sourceType || "").toLowerCase();
  if (/(object|product|architecture)/.test(normalizedSource)) return objects;
  const floor = whiteModelPrimaryFloor(objects) || { size: [8, 6, 0.08], position: [0, 0.04, 0] };
  const [width = 8, depth = 6] = floor.size || [];
  const [cx = 0, , cz = 0] = floor.position || [];
  const wallHeight = Math.max(2.7, Math.min(5.2, Math.max(width, depth) * 0.42));
  const wallThickness = 0.16;
  const hasRearWall = whiteModelHasObjectText(objects, /(rear|back|后墙|主墙|背景墙|墙面)/i);
  const hasLeftWall = whiteModelHasObjectText(objects, /(left|side wall|左墙|左侧墙|侧墙)/i);
  const hasRightWall = whiteModelHasObjectText(objects, /(right|side wall|右墙|右侧墙|侧墙)/i);
  const wallCount = objects.filter((object) => object.type === "wall").length;
  const hasCeiling = objects.some((object) => object.type === "ceiling");
  const hasOpening = objects.some((object) => object.type === "opening");
  const hasLighting = objects.some((object) => object.layer === "lighting");

  if (!hasRearWall || wallCount < 1) {
    addWhiteModelFallbackObject(objects, {
      type: "wall",
      layer: "shell",
      label: "inferred rear wall",
      size: [width, wallThickness, wallHeight],
      position: [cx, wallHeight / 2, cz - depth / 2],
      color: whiteModelMaterialPalette.wall,
      material: "inferred plaster or painted wall"
    });
  }
  if (!hasLeftWall || wallCount < 2) {
    addWhiteModelFallbackObject(objects, {
      type: "wall",
      layer: "shell",
      label: "inferred left wall",
      size: [wallThickness, depth, wallHeight],
      position: [cx - width / 2, wallHeight / 2, cz],
      color: whiteModelMaterialPalette.wall,
      material: "inferred plaster or painted wall"
    });
  }
  if (!hasRightWall || wallCount < 3) {
    addWhiteModelFallbackObject(objects, {
      type: "wall",
      layer: "shell",
      label: "inferred right wall",
      size: [wallThickness, depth, wallHeight],
      position: [cx + width / 2, wallHeight / 2, cz],
      color: whiteModelMaterialPalette.wall,
      material: "inferred plaster or painted wall"
    });
  }

  if (!hasCeiling && !normalizedSource.includes("floor-plan")) {
    addWhiteModelFallbackObject(objects, {
      type: "ceiling",
      layer: "shell",
      label: "inferred ceiling plane",
      size: [width, depth, 0.08],
      position: [cx, wallHeight + 0.04, cz],
      color: whiteModelMaterialPalette.ceiling,
      material: "inferred ceiling finish",
      opacity: 0.78
    });
  }

  if (!hasOpening && !normalizedSource.includes("object")) {
    addWhiteModelFallbackObject(objects, {
      type: "opening",
      layer: "openings",
      label: "inferred main window or opening",
      size: [Math.max(1.2, width * 0.36), 0.05, Math.max(1.6, wallHeight * 0.62)],
      position: [cx, wallHeight * 0.48, cz - depth / 2 - 0.02],
      color: whiteModelMaterialPalette.opening,
      material: "translucent inferred glass or opening",
      opacity: 0.32
    });
  }

  if (!hasLighting && !normalizedSource.includes("floor-plan")) {
    addWhiteModelFallbackObject(objects, {
      type: "fixture",
      shape: "cylinder",
      layer: "lighting",
      label: "inferred ceiling light",
      size: [0.42, 0.42, 0.12],
      position: [cx, Math.max(2.35, wallHeight - 0.18), cz],
      color: whiteModelMaterialPalette.fixture,
      material: "warm ceiling light",
      roughness: 0.35,
      metalness: 0.25
    });
  }

  return objects;
}

function ensureInteriorModelDetail(objects = [], sourceType = "", { modelingAnalysis = {}, brief = {}, intent = "" } = {}) {
  if (!/interior|room|space|floor-plan|室内|空间|房间/i.test(String(sourceType || ""))) return objects;
  const floor = whiteModelPrimaryFloor(objects) || { size: [7.2, 5.2, 0.08], position: [0, 0.04, 0] };
  const [width = 7.2, depth = 5.2] = floor.size || [];
  const [cx = 0, , cz = 0] = floor.position || [];
  const text = imageModelingSubjectText(modelingAnalysis, brief, intent, objects);
  const wallHeight = Math.max(2.7, Math.min(4.6, Math.max(width, depth) * 0.42));
  const additions = [];
  const add = (object) => additions.push(object);
  const has = (pattern) => whiteModelHasObjectText(objects, pattern) || additions.some((object) => pattern.test(whiteModelObjectSearchText(object)));

  if (!has(/ceiling|天花|吊顶|顶面/i)) {
    add({ id: "interior-ceiling-edge", type: "ceiling", layer: "shell", label: "室内顶面", size: [width, depth, 0.07], position: [cx, wallHeight + 0.035, cz], color: whiteModelMaterialPalette.ceiling, material: "ceiling plane", opacity: 0.48 });
  }
  if (!has(/baseboard|skirting|踢脚|墙脚/i)) {
    add({ id: "rear-wall-skirting", type: "beam", layer: "structure", label: "后墙踢脚线", size: [width * 0.92, 0.045, 0.09], position: [cx, 0.16, cz - depth / 2 + 0.03], color: "#9a8064", material: "skirting line" });
    add({ id: "left-wall-skirting", type: "beam", layer: "structure", label: "左墙踢脚线", size: [0.045, depth * 0.84, 0.09], position: [cx - width / 2 + 0.03, 0.16, cz], color: "#9a8064", material: "skirting line" });
  }
  if (!has(/window|opening|door|glass|门|窗|开口|玻璃/i)) {
    add({ id: "reference-main-window", type: "opening", layer: "openings", label: "参考图主开口/窗", size: [Math.max(1.4, width * 0.34), 0.05, Math.max(1.4, wallHeight * 0.52)], position: [cx + width * 0.18, wallHeight * 0.54, cz - depth / 2 - 0.035], color: whiteModelMaterialPalette.opening, material: "inferred glass/opening", opacity: 0.34 });
    add({ id: "reference-window-frame-top", type: "beam", layer: "structure", label: "开口上框", size: [Math.max(1.5, width * 0.36), 0.06, 0.08], position: [cx + width * 0.18, wallHeight * 0.82, cz - depth / 2 - 0.055], color: "#5e5850", material: "window frame" });
    add({ id: "reference-window-frame-side", type: "beam", layer: "structure", label: "开口侧框", size: [0.07, 0.06, Math.max(1.25, wallHeight * 0.48)], position: [cx + width * 0.01, wallHeight * 0.54, cz - depth / 2 - 0.055], color: "#5e5850", material: "window frame" });
  }
  if (!has(/counter|cabinet|island|bar|柜|台|吧台|橱|前台|收银/i)) {
    add({ id: "reference-cabinet-run", type: "counter", layer: "fixed_furniture", label: "参考图柜体/吧台", size: [Math.max(2.0, width * 0.34), 0.58, 0.9], position: [cx - width * 0.22, 0.45, cz - depth * 0.18], color: whiteModelMaterialPalette.counter, material: "visible/inferred millwork" });
    add({ id: "reference-countertop", type: "counter", layer: "fixed_furniture", label: "柜体台面", size: [Math.max(2.05, width * 0.35), 0.64, 0.08], position: [cx - width * 0.22, 0.94, cz - depth * 0.18], color: "#b8a083", material: "countertop" });
  }
  if (!has(/table|desk|coffee|餐桌|桌|茶几|书桌/i)) {
    add({ id: "reference-table-top", type: "table", layer: "loose_furniture", label: "参考图桌面", size: [1.32, 0.86, 0.08], position: [cx + width * 0.12, 0.72, cz + depth * 0.1], color: whiteModelMaterialPalette.table, material: "tabletop" });
    [[-0.5, -0.28], [0.5, -0.28], [-0.5, 0.28], [0.5, 0.28]].forEach(([ox, oz], index) => {
      add({ id: `reference-table-leg-${index + 1}`, type: "column", shape: "cylinder", layer: "loose_furniture", label: `桌腿 ${index + 1}`, size: [0.06, 0.06, 0.68], position: [cx + width * 0.12 + ox, 0.34, cz + depth * 0.1 + oz], color: "#5d4a3b", material: "table leg" });
    });
  }
  if (!has(/sofa|chair|seat|bench|椅|沙发|座|卡座|凳/i)) {
    add({ id: "reference-seat-base", type: "seat", layer: "loose_furniture", label: "参考图座椅坐垫", size: [1.05, 0.78, 0.22], position: [cx - width * 0.08, 0.44, cz + depth * 0.34], color: whiteModelMaterialPalette.seat, material: "seat cushion" });
    add({ id: "reference-seat-back", type: "seat", layer: "loose_furniture", label: "参考图座椅靠背", size: [1.05, 0.12, 0.62], position: [cx - width * 0.08, 0.78, cz + depth * 0.72], color: whiteModelMaterialPalette.seat, material: "seat back" });
    add({ id: "reference-seat-side", type: "seat", layer: "loose_furniture", label: "参考图座椅侧扶手", size: [0.12, 0.66, 0.46], position: [cx - width * 0.08 - 0.58, 0.62, cz + depth * 0.36], color: whiteModelMaterialPalette.seat, material: "seat side" });
  }
  if (!has(/shelf|storage|display|架|柜|陈列|展示|收纳/i) && /(shelf|storage|display|架|柜|陈列|展示|收纳|retail|store|门店|展厅)/i.test(text)) {
    add({ id: "reference-wall-shelf-body", type: "shelf", layer: "fixed_furniture", label: "墙面陈列/收纳", size: [Math.max(1.4, width * 0.24), 0.32, 1.65], position: [cx + width * 0.24, 0.98, cz - depth * 0.42], color: whiteModelMaterialPalette.shelf, material: "shelving" });
    add({ id: "reference-wall-shelf-tier", type: "shelf", layer: "fixed_furniture", label: "陈列层板", size: [Math.max(1.35, width * 0.23), 0.36, 0.06], position: [cx + width * 0.24, 1.25, cz - depth * 0.42], color: "#a98f75", material: "shelf tier" });
  }
  if (!has(/light|lamp|pendant|track|灯|吊灯|灯带|射灯/i)) {
    add({ id: "reference-light-strip", type: "fixture", layer: "lighting", label: "顶面灯带/线性灯", size: [Math.max(2.0, width * 0.38), 0.06, 0.06], position: [cx, Math.max(2.45, wallHeight - 0.12), cz - depth * 0.08], color: whiteModelMaterialPalette.fixture, material: "warm linear light", roughness: 0.28, metalness: 0.2 });
    add({ id: "reference-ceiling-spot", type: "fixture", shape: "cylinder", layer: "lighting", label: "顶面射灯", size: [0.22, 0.22, 0.08], position: [cx + width * 0.2, Math.max(2.45, wallHeight - 0.1), cz + depth * 0.08], color: whiteModelMaterialPalette.fixture, material: "ceiling spotlight", roughness: 0.28, metalness: 0.2 });
  }
  const minimumInteriorObjects = 24;
  const needed = Math.max(0, minimumInteriorObjects - objects.length);
  const selectedAdditions = additions.slice(0, Math.max(needed, objects.length < 18 ? additions.length : needed));
  if (!selectedAdditions.length) return objects;
  return uniqueWhiteModelObjects([
    ...objects,
    ...selectedAdditions.map((object, index) => normalizeWhiteModelObject(object, objects.length + index))
  ]).slice(0, 96);
}

function whiteModelObjectSearchText(object = {}) {
  return [
    object.id,
    object.label,
    object.type,
    object.shape,
    object.layer,
    object.material,
    object.note
  ].filter(Boolean).join(" ").toLowerCase();
}

function whiteModelObjectVolume(object = {}) {
  const [width = 0, depth = 0, height = 0] = object.size || [];
  return Math.max(0, width) * Math.max(0, depth) * Math.max(0, height);
}

function primaryObjectPhotoBody(objects = []) {
  const candidates = objects
    .filter((object) => object.shape === "sphere" && !/(stem|stalk|peduncle|果梗|柄|dimple|depression|果窝|凹陷)/i.test(whiteModelObjectSearchText(object)))
    .sort((a, b) => {
      const aText = whiteModelObjectSearchText(a);
      const bText = whiteModelObjectSearchText(b);
      const aBoost = /(main|body|subject|主体|果身|苹果)/i.test(aText) ? 1 : 0;
      const bBoost = /(main|body|subject|主体|果身|苹果)/i.test(bText) ? 1 : 0;
      return bBoost - aBoost || whiteModelObjectVolume(b) - whiteModelObjectVolume(a);
    });
  return candidates[0] || objects.slice().sort((a, b) => whiteModelObjectVolume(b) - whiteModelObjectVolume(a))[0] || null;
}

function sizedNumber(value) {
  return Number(Number(value).toFixed(3));
}

function refineObjectPhotoWhiteModelObjects(objects = [], sourceType = "") {
  if (!/(object|product)/i.test(sourceType)) return objects;
  const body = primaryObjectPhotoBody(objects);
  if (!body?.size || !body?.position) return objects;
  const [bodyWidth = 1, bodyDepth = bodyWidth, bodyHeight = bodyWidth] = body.size;
  const [bodyX = 0, bodyY = bodyHeight / 2, bodyZ = 0] = body.position;
  const bodyTop = bodyY + bodyHeight / 2;
  const bodyBottom = bodyY - bodyHeight / 2;
  const lateral = Math.max(0.02, Math.min(bodyWidth, bodyDepth));

  return objects.map((object) => {
    const text = whiteModelObjectSearchText(object);
    const next = { ...object };
    if (/(stem|stalk|peduncle|果梗|苹果柄)/i.test(text)) {
      const stemDiameter = clampNumber(lateral * 0.12, 0.006, lateral * 0.18);
      const stemHeight = clampNumber(bodyHeight * 0.42, bodyHeight * 0.24, bodyHeight * 0.62);
      next.shape = "cylinder";
      next.size = [sizedNumber(stemDiameter), sizedNumber(stemDiameter), sizedNumber(stemHeight)];
      next.position = [
        sizedNumber(object.position?.[0] ?? bodyX),
        sizedNumber(bodyTop + stemHeight / 2 - bodyHeight * 0.03),
        sizedNumber(object.position?.[2] ?? bodyZ)
      ];
      next.color = isHex(next.color) ? next.color : "#7a3f16";
      return next;
    }
    if (/(dimple|depression|果窝|凹陷|top-depression)/i.test(text)) {
      const dimpleHeight = clampNumber(bodyHeight * 0.045, 0.004, bodyHeight * 0.09);
      next.size = [
        sizedNumber(lateral * 0.34),
        sizedNumber(lateral * 0.3),
        sizedNumber(dimpleHeight)
      ];
      next.position = [
        sizedNumber(object.position?.[0] ?? bodyX),
        sizedNumber(bodyTop - bodyHeight * 0.08),
        sizedNumber(object.position?.[2] ?? bodyZ)
      ];
      return next;
    }
    if (/(yellow|green|黄绿|过渡区|top-yellow)/i.test(text)) {
      const zoneHeight = clampNumber(bodyHeight * 0.035, 0.003, bodyHeight * 0.07);
      next.size = [
        sizedNumber(lateral * 0.38),
        sizedNumber(lateral * 0.34),
        sizedNumber(zoneHeight)
      ];
      next.position = [
        sizedNumber(object.position?.[0] ?? bodyX),
        sizedNumber(bodyTop - bodyHeight * 0.055),
        sizedNumber(object.position?.[2] ?? bodyZ)
      ];
      return next;
    }
    if (/(bottom|contact|flatten|底部|接触|压平)/i.test(text)) {
      const contactHeight = clampNumber(bodyHeight * 0.06, 0.004, bodyHeight * 0.12);
      next.size = [
        sizedNumber(lateral * 0.58),
        sizedNumber(lateral * 0.5),
        sizedNumber(contactHeight)
      ];
      next.position = [
        sizedNumber(object.position?.[0] ?? bodyX),
        sizedNumber(bodyBottom + contactHeight / 2),
        sizedNumber(object.position?.[2] ?? bodyZ)
      ];
      return next;
    }
    return next;
  });
}

function imageModelingSubjectText(...items) {
  return items
    .flatMap((item) => {
      if (!item) return [];
      if (Array.isArray(item)) return item.map((value) => imageModelingSubjectText(value));
      if (typeof item === "object") {
        const compact = [
          item.subject,
          item.title,
          item.summary,
          item.label,
          item.role,
          item.material,
          item.primitiveHint,
          item.notes,
          item.silhouette,
          item.viewAngle,
          ...(Array.isArray(item.geometryHints) ? item.geometryHints : []),
          ...(Array.isArray(item.characteristicFeatures) ? item.characteristicFeatures : []),
          ...(Array.isArray(item.materialZones) ? item.materialZones : []),
          ...(Array.isArray(item.nonGeometry) ? item.nonGeometry : []),
          ...(Array.isArray(item.layers) ? item.layers.map((layer) => imageModelingSubjectText(layer)) : []),
          item.visualProfile ? imageModelingSubjectText(item.visualProfile) : "",
          ...(Array.isArray(item.excludedRegions) ? item.excludedRegions : [])
        ];
        return compact;
      }
      return [item];
    })
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function objectPhotoLooksLikeApple(sourceType = "", ...items) {
  if (!/(object|product)/i.test(sourceType)) return false;
  const text = imageModelingSubjectText(...items);
  if (/(iphone|ipad|macbook|电脑|手机|公司|logo|标志)/i.test(text)) return false;
  return /(红苹果|苹果|apple|red apple|fruit|果实)/i.test(text);
}

function architectureExteriorLooksLikeBuilding(sourceType = "", ...items) {
  const text = imageModelingSubjectText(...items);
  if (/(interior|room|室内|房间|大堂|办公室|展厅|客厅|卧室)/i.test(text) && !/(exterior|facade|façade|front elevation|building exterior|外观|外立面|立面|建筑外部)/i.test(text)) {
    return false;
  }
  return /(architecture-photo|building-exterior|facade|façade|front elevation|exterior|building|house|villa|church|museum|tower|apartment|建筑|建筑外观|外观|外立面|立面|楼体|房屋|住宅|别墅|教堂|博物馆|公寓|塔楼)/i.test(`${sourceType} ${text}`);
}

function architectureDimensionSwapReason(object = {}) {
  const [width = 0, depth = 0, height = 0] = object.size || [];
  const [, y = height / 2] = object.position || [];
  if (![width, depth, height, y].every(Number.isFinite)) return "";
  const text = whiteModelObjectSearchText(object);
  const currentBottom = y - height / 2;
  const swappedBottom = y - depth / 2;
  const isOpeningOrPanel = object.type === "opening"
    || object.layer === "openings"
    || /(window|door|glass|railing|panel|cladding|facade|mullion|shutter|门|窗|玻璃|栏杆|面板|饰面|立面|百叶)/i.test(text);
  const isVerticalMember = object.type === "column"
    || /(column|post|pier|mullion|柱|立柱|墙垛|栏杆柱)/i.test(text);
  const isThinHorizontal = /(roof|slope|slab|floor|terrace|balcony|eave|ridge|cornice|beam|step|stair|plinth|base|屋顶|屋面|坡面|楼板|露台|阳台|檐|屋脊|檐口|梁|台阶|楼梯|基座|台基|勒脚)/i.test(text);
  const isMass = /(building|mass|volume|wing|level|story|main body|主体|主楼体|楼体|体量|翼体|层|别墅)/i.test(text);
  const isWallPanel = object.type === "wall" || /(wall|retaining|facade|墙|挡墙|立面)/i.test(text);

  if (isVerticalMember && depth > Math.max(width, height, 0.08) * 1.6 && depth > 0.45) return "vertical-member";
  if (isOpeningOrPanel && height <= 0.24 && depth > Math.max(0.42, height * 3)) return "vertical-opening-panel";
  if (isOpeningOrPanel && width <= 0.24 && depth > 0.45 && height > depth * 1.25) return "side-opening-panel";
  if (isWallPanel && height < 0.75 && depth > Math.max(0.72, height * 1.8)) return "vertical-wall-panel";
  if (isThinHorizontal && depth <= 0.9 && height > Math.max(0.9, depth * 2.2)) return "thin-horizontal-slab";
  if (isMass && depth >= 1.2 && depth <= 5.4 && height > depth * 1.65) return "story-mass-height-depth-order";
  if (height > depth * 1.6 && currentBottom < -0.2 && swappedBottom >= -0.2 && depth >= 0.08) return "below-ground-height-depth-order";
  return "";
}

function repairArchitectureObjectDimensions(object = {}) {
  const reason = architectureDimensionSwapReason(object);
  if (!reason) return object;
  const [width = 1, depth = 1, height = 1] = object.size || [];
  return {
    ...object,
    size: [sizedNumber(width), sizedNumber(height), sizedNumber(depth)],
    note: String(object.note || "").includes("轴向纠偏")
      ? object.note
      : String(`${object.note || ""}${object.note ? " " : ""}轴向纠偏：识别到模型输出更像 [宽,高,深]，已转换为 [宽,深,高]。`).slice(0, 180)
  };
}

function architectureExteriorFootprint(objects = []) {
  const xs = [];
  const zs = [];
  objects.forEach((object) => {
    const text = whiteModelObjectSearchText(object);
    if (object.type === "floor" || (object.layer === "context" && /(site|ground|场地|地面)/i.test(text))) return;
    const [width = 0, depth = 0] = object.size || [];
    const [x = 0, , z = 0] = object.position || [];
    if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    xs.push(x - width / 2, x + width / 2);
    zs.push(z - depth / 2, z + depth / 2);
  });
  if (!xs.length || !zs.length) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2
  };
}

function ensureArchitectureSiteBaseCoversModel(objects = []) {
  const footprint = architectureExteriorFootprint(objects);
  if (!footprint) return objects;
  const pad = clampNumber(Math.max(1.2, Math.max(footprint.width, footprint.depth) * 0.08), 1.2, 4.2);
  const targetWidth = sizedNumber(footprint.width + pad * 2);
  const targetDepth = sizedNumber(footprint.depth + pad * 2);
  const siteIndex = objects.findIndex((object) => {
    const text = whiteModelObjectSearchText(object);
    return object.type === "floor" || (object.layer === "context" && /(site|ground|base|场地|地面|基底)/i.test(text));
  });
  const sitePatch = {
    size: [targetWidth, targetDepth, 0.08],
    position: [sizedNumber(footprint.centerX), 0.04, sizedNumber(footprint.centerZ)],
    layer: "context",
    material: "neutral site slab",
    note: "自动按建筑投影放大场地基底，避免主体悬空或超出底板。"
  };
  if (siteIndex >= 0) {
    return objects.map((object, index) => index === siteIndex
      ? {
          ...object,
          ...sitePatch,
          type: "floor",
          shape: "box",
          label: object.label || "建筑场地基底",
          color: isHex(object.color) ? object.color : "#9a9588"
        }
      : object);
  }
  return [
    normalizeWhiteModelObject({
      id: "architecture-site-base",
      type: "floor",
      shape: "box",
      label: "建筑场地基底",
      color: "#9a9588",
      ...sitePatch
    }, 0),
    ...objects
  ];
}

function repairArchitectureExteriorModelObjects(objects = [], sourceType = "", ...items) {
  if (!architectureExteriorLooksLikeBuilding(sourceType, ...items, objects)) return objects;
  const repaired = objects.map(repairArchitectureObjectDimensions);
  return ensureArchitectureSiteBaseCoversModel(repaired);
}

function architectureGeometrySanityReport(objects = []) {
  const roofObjects = objects.filter((object) => /(roof|slope|eave|ridge|屋顶|屋面|坡面|檐|屋脊)/i.test(whiteModelObjectSearchText(object)));
  const openings = objects.filter((object) => object.type === "opening" || object.layer === "openings");
  const solidObjects = objects.filter((object) => {
    const text = whiteModelObjectSearchText(object);
    return object.type !== "floor"
      && object.layer !== "openings"
      && !/(roof|eave|ridge|屋顶|屋面|檐|屋脊)/i.test(text);
  });
  const belowGround = solidObjects.filter((object) => {
    const [, y = 0] = object.position || [];
    const [, , height = 0] = object.size || [];
    return y - height / 2 < -0.25;
  });
  const verticalOpenings = openings.filter((object) => {
    const [, depth = 0, height = 0] = object.size || [];
    return height >= 0.45 && height > depth * 1.6;
  });
  const thinRoofs = roofObjects.filter((object) => {
    const [, depth = 0, height = 0] = object.size || [];
    const text = whiteModelObjectSearchText(object);
    return height <= 0.9 || /eave|ridge|檐|屋脊/.test(text) || height <= Math.max(0.35, depth * 0.22);
  });
  const grounded = belowGround.length === 0;
  const openingsOk = !openings.length || verticalOpenings.length >= Math.min(4, Math.ceil(openings.length * 0.55));
  const roofsOk = !roofObjects.length || thinRoofs.length >= Math.ceil(roofObjects.length * 0.55);
  return {
    passed: grounded && openingsOk && roofsOk,
    grounded,
    openingsOk,
    roofsOk,
    belowGroundCount: belowGround.length,
    verticalOpeningCount: verticalOpenings.length,
    openingCount: openings.length,
    thinRoofCount: thinRoofs.length,
    roofCount: roofObjects.length
  };
}

function architectureDimensionProfile(modelingAnalysis = {}) {
  const bounds = modelingAnalysis?.targetBounds || {};
  const aspect = clampNumber(
    Number(bounds.width || 0.78) / Math.max(Number(bounds.height || 0.62), 0.001),
    0.45,
    2.6
  );
  const text = imageModelingSubjectText(modelingAnalysis);
  let floorCount = /(five|5|五层|五楼)/i.test(text) ? 5
    : /(four|4|四层|四楼)/i.test(text) ? 4
      : /(three|3|三层|三楼)/i.test(text) ? 3
        : /(one|1|一层|单层|single.?story)/i.test(text) ? 1
          : 2;
  if (/(tower|high.?rise|高层|塔楼)/i.test(text)) floorCount = Math.max(floorCount, 5);
  const width = floorCount >= 5 ? 18 : 12;
  const wallHeight = clampNumber(floorCount * 3.1, 3.2, 18);
  const depth = clampNumber(width * (aspect > 1.35 ? 0.42 : 0.52), 4.2, 9.5);
  const roofHeight = /(flat roof|parapet|modern|幕墙|女儿墙|平屋顶|现代)/i.test(text) ? 0.45 : 1.4;
  const columns = clampNumber(Math.round(width / 2.4), 3, 7);
  return { width, depth, wallHeight, roofHeight, floorCount, columns };
}

function architectureTemplateObject({ id, label, type = "box", shape = "box", size, position, rotation = [0, 0, 0], color, material, layer, note, opacity = 1 }) {
  return {
    id,
    type,
    shape,
    label,
    size: size.map(sizedNumber),
    position: position.map(sizedNumber),
    rotation,
    color,
    layer,
    material,
    roughness: 0.72,
    metalness: 0.02,
    opacity,
    note
  };
}

function buildArchitectureExteriorFallbackObjects(modelingAnalysis = {}) {
  const { width: w, depth: d, wallHeight: h, roofHeight, floorCount, columns } = architectureDimensionProfile(modelingAnalysis);
  const frontZ = -d / 2 - 0.04;
  const backZ = d / 2 + 0.04;
  const roofY = h + roofHeight * 0.45;
  const text = imageModelingSubjectText(modelingAnalysis);
  const flatRoof = /(flat roof|parapet|modern|幕墙|女儿墙|平屋顶|现代)/i.test(text);
  const objects = [
    architectureTemplateObject({
      id: "site-base",
      label: "建筑场地基底",
      type: "floor",
      size: [w + 4.5, d + 4.2, 0.08],
      position: [0, 0.04, 0.35],
      color: "#9a9588",
      layer: "context",
      material: "neutral site slab",
      note: "用于承托整栋建筑，不把道路、树木和天空作为主体几何。"
    }),
    architectureTemplateObject({
      id: "main-building-volume",
      label: "整栋建筑主楼体",
      type: "box",
      size: [w, d, h],
      position: [0, h / 2 + 0.08, 0],
      color: "#b28b68",
      layer: "shell",
      material: "masonry or plaster facade",
      note: "根据正面照片推断的完整建筑深度体量。"
    }),
    architectureTemplateObject({
      id: "front-facade-plane",
      label: "正立面墙面",
      type: "wall",
      size: [w + 0.08, 0.12, h],
      position: [0, h / 2 + 0.1, frontZ],
      color: "#c59672",
      layer: "shell",
      material: "front facade finish",
      note: "可见正立面，门窗贴附在这一面。"
    }),
    architectureTemplateObject({
      id: "left-side-wall",
      label: "左侧墙体推断",
      type: "wall",
      size: [0.14, d, h],
      position: [-w / 2 - 0.04, h / 2 + 0.1, 0],
      color: "#9f7b5f",
      layer: "shell",
      material: "inferred side facade",
      note: "单张正面照片推断出的侧墙深度。"
    }),
    architectureTemplateObject({
      id: "right-side-wall",
      label: "右侧墙体推断",
      type: "wall",
      size: [0.14, d, h],
      position: [w / 2 + 0.04, h / 2 + 0.1, 0],
      color: "#9f7b5f",
      layer: "shell",
      material: "inferred side facade",
      note: "单张正面照片推断出的侧墙深度。"
    }),
    architectureTemplateObject({
      id: "rear-mass-marker",
      label: "背立面推断面",
      type: "wall",
      size: [w, 0.1, h * 0.94],
      position: [0, h * 0.47 + 0.1, backZ],
      color: "#8c735c",
      layer: "shell",
      material: "inferred rear facade",
      opacity: 0.72,
      note: "背面不可见，作为 CAD 白模的体量闭合。"
    }),
    architectureTemplateObject({
      id: "entry-door",
      label: "主入口门洞",
      type: "opening",
      size: [1.35, 0.08, 2.1],
      position: [0, 1.12, frontZ - 0.05],
      color: "#2f4858",
      layer: "openings",
      material: "dark entry glazing or door",
      opacity: 0.62,
      note: "入口是整栋建筑的尺度参照。"
    }),
    architectureTemplateObject({
      id: "entry-steps",
      label: "入口台阶",
      type: "stair",
      size: [2.6, 1.25, 0.28],
      position: [0, 0.22, frontZ - 0.75],
      color: "#8f897f",
      layer: "structure",
      material: "stone entry steps",
      note: "用低矮盒体表达入口高差。"
    })
  ];

  if (flatRoof) {
    objects.push(
      architectureTemplateObject({
        id: "flat-roof-slab",
        label: "平屋顶板",
        type: "beam",
        size: [w + 0.55, d + 0.45, 0.22],
        position: [0, h + 0.22, 0],
        color: "#7f7b72",
        layer: "structure",
        material: "flat roof slab",
        note: "现代建筑或平屋顶的顶部收口。"
      }),
      architectureTemplateObject({
        id: "roof-parapet",
        label: "女儿墙收边",
        type: "beam",
        size: [w + 0.65, 0.18, 0.55],
        position: [0, h + 0.55, frontZ],
        color: "#6f6a62",
        layer: "structure",
        material: "parapet cap",
        note: "顶部轮廓控制，避免只有一个盒子。"
      })
    );
  } else {
    objects.push(
      architectureTemplateObject({
        id: "left-sloped-roof-plane",
        label: "左坡屋面",
        type: "beam",
        size: [w * 0.58, d + 0.7, 0.24],
        position: [-w * 0.24, roofY, 0],
        rotation: [0, 0, 18],
        color: "#5f5146",
        layer: "structure",
        material: "dark pitched roof",
        note: "用倾斜盒体近似坡屋顶一侧。"
      }),
      architectureTemplateObject({
        id: "right-sloped-roof-plane",
        label: "右坡屋面",
        type: "beam",
        size: [w * 0.58, d + 0.7, 0.24],
        position: [w * 0.24, roofY, 0],
        rotation: [0, 0, -18],
        color: "#55483f",
        layer: "structure",
        material: "dark pitched roof",
        note: "用倾斜盒体近似坡屋顶另一侧。"
      }),
      architectureTemplateObject({
        id: "roof-ridge",
        label: "屋脊线",
        type: "beam",
        size: [0.22, d + 0.82, 0.2],
        position: [0, h + roofHeight + 0.05, 0],
        color: "#403833",
        layer: "structure",
        material: "roof ridge",
        note: "保持屋顶有可读的最高线。"
      })
    );
  }

  objects.push(
    architectureTemplateObject({
      id: "front-eave-band",
      label: "正立面檐口线",
      type: "beam",
      size: [w + 0.55, 0.18, 0.18],
      position: [0, h + 0.05, frontZ - 0.12],
      color: "#6c6258",
      layer: "structure",
      material: "eave or cornice band",
      note: "立面顶部水平收口。"
    }),
    architectureTemplateObject({
      id: "base-plinth",
      label: "建筑勒脚基座",
      type: "beam",
      size: [w + 0.18, 0.18, 0.42],
      position: [0, 0.31, frontZ - 0.08],
      color: "#756d64",
      layer: "structure",
      material: "stone or darker base plinth",
      note: "底部勒脚让整栋建筑不是悬浮盒体。"
    })
  );

  const windowWidth = clampNumber(w / (columns * 3.1), 0.78, 1.18);
  const windowHeight = clampNumber(h / (floorCount * 4.2), 0.85, 1.25);
  const floorStep = h / Math.max(floorCount, 1);
  const usableWidth = w * 0.78;
  for (let floor = 0; floor < floorCount; floor += 1) {
    const y = 1.55 + floor * floorStep;
    for (let column = 0; column < columns; column += 1) {
      const x = columns === 1 ? 0 : -usableWidth / 2 + (usableWidth * column) / (columns - 1);
      if (floor === 0 && Math.abs(x) < windowWidth * 0.8) continue;
      objects.push(architectureTemplateObject({
        id: `front-window-${floor + 1}-${column + 1}`,
        label: `正立面窗 ${floor + 1}-${column + 1}`,
        type: "opening",
        size: [windowWidth, 0.07, windowHeight],
        position: [x, y, frontZ - 0.06],
        color: "#5d8792",
        layer: "openings",
        material: "blue gray glass",
        opacity: 0.56,
        note: "按立面节奏推断的规则窗洞。"
      }));
      objects.push(architectureTemplateObject({
        id: `front-window-sill-${floor + 1}-${column + 1}`,
        label: `窗台线 ${floor + 1}-${column + 1}`,
        type: "beam",
        size: [windowWidth + 0.28, 0.08, 0.08],
        position: [x, y - windowHeight / 2 - 0.12, frontZ - 0.09],
        color: "#e1d3bd",
        layer: "structure",
        material: "light sill trim",
        note: "窗洞的水平细节，便于设计师理解立面比例。"
      }));
    }
  }

  const sideWindowRows = Math.min(2, floorCount);
  for (let floor = 0; floor < sideWindowRows; floor += 1) {
    const y = 1.55 + floor * floorStep;
    [-1, 1].forEach((side) => {
      objects.push(architectureTemplateObject({
        id: `${side < 0 ? "left" : "right"}-side-window-${floor + 1}`,
        label: `${side < 0 ? "左" : "右"}侧窗 ${floor + 1}`,
        type: "opening",
        size: [0.08, 0.92, windowHeight * 0.86],
        position: [side * (w / 2 + 0.08), y, -d * 0.15],
        color: "#4f7680",
        layer: "openings",
        material: "side inferred glass",
        opacity: 0.5,
        note: "侧立面窗口由正面节奏推断。"
      }));
    });
  }

  return objects;
}

function architectureExteriorModelNeedsDetail(objects = [], sourceType = "", ...items) {
  if (!architectureExteriorLooksLikeBuilding(sourceType, ...items, objects)) return false;
  const hasMass = objects.some((object) => /(building|main|mass|volume|facade|楼体|主楼体|体量|立面|外墙)/i.test(whiteModelObjectSearchText(object)) || ["wall", "box"].includes(object.type));
  const hasOpenings = objects.filter((object) => object.layer === "openings" || object.type === "opening").length >= 3;
  const hasRoofOrTop = objects.some((object) => /(roof|eave|gable|parapet|屋顶|屋面|檐|女儿墙|屋脊)/i.test(whiteModelObjectSearchText(object)));
  return objects.length < 18 || !hasMass || !hasOpenings || !hasRoofOrTop;
}

function ensureArchitectureExteriorModelDetail(objects = [], sourceType = "", { source = {}, parsed = {}, modelingAnalysis = {}, intent = "", primaryImage = null } = {}) {
  if (!architectureExteriorModelNeedsDetail(objects, sourceType, source, parsed, modelingAnalysis, intent, primaryImage?.name)) return objects;
  return buildArchitectureExteriorFallbackObjects(modelingAnalysis).map(normalizeWhiteModelObject);
}

function appleDimensionProfile(modelingAnalysis = {}) {
  const bounds = modelingAnalysis?.targetBounds || {};
  const aspect = clampNumber(
    Number(bounds.width || 0.72) / Math.max(Number(bounds.height || 0.84), 0.001),
    0.68,
    1.12
  );
  const fruitHeight = 0.096;
  const width = clampNumber(fruitHeight * aspect * 1.04, 0.078, 0.112);
  const depth = clampNumber(width * 0.94, 0.072, 0.108);
  return { width, depth, fruitHeight };
}

function appleTemplateObject({ id, label, shape = "sphere", size, position, rotation = [0, 0, 0], color, material, note, opacity = 1 }) {
  return {
    id,
    type: "generic",
    shape,
    label,
    size: size.map(sizedNumber),
    position: position.map(sizedNumber),
    rotation,
    color,
    layer: "fixed_furniture",
    material,
    roughness: 0.72,
    metalness: 0.01,
    opacity,
    note
  };
}

function buildAppleWhiteModelObjects(modelingAnalysis = {}) {
  const { width: w, depth: d, fruitHeight: h } = appleDimensionProfile(modelingAnalysis);
  const top = h;
  const stemHeight = clampNumber(h * 0.34, 0.024, 0.04);
  return [
    appleTemplateObject({
      id: "apple-main-envelope",
      label: "苹果整体椭球轮廓",
      size: [w, d, h * 0.96],
      position: [0, h * 0.48, 0],
      color: "#b72a22",
      material: "red apple skin",
      note: "主体外轮廓：近似椭球，不使用矩形体块。"
    }),
    appleTemplateObject({
      id: "apple-left-shoulder",
      label: "左上肩部鼓包",
      size: [w * 0.52, d * 0.48, h * 0.32],
      position: [-w * 0.18, h * 0.75, d * 0.02],
      color: "#cf352a",
      material: "red apple shoulder",
      note: "补出顶部不对称肩部，让轮廓不像普通圆球。"
    }),
    appleTemplateObject({
      id: "apple-right-shoulder",
      label: "右上肩部鼓包",
      size: [w * 0.54, d * 0.48, h * 0.31],
      position: [w * 0.16, h * 0.73, -d * 0.01],
      color: "#9f211e",
      material: "darker red apple shoulder",
      note: "轻微不对称，模拟照片中苹果自然偏心。"
    }),
    appleTemplateObject({
      id: "apple-lower-belly",
      label: "下腹圆钝体量",
      size: [w * 0.78, d * 0.72, h * 0.36],
      position: [0, h * 0.28, 0],
      color: "#c9342b",
      material: "rounded lower apple body",
      note: "底部圆钝并稍微压低。"
    }),
    appleTemplateObject({
      id: "apple-front-bulge",
      label: "正面可见鼓面",
      size: [w * 0.78, d * 0.28, h * 0.62],
      position: [0, h * 0.49, d * 0.28],
      color: "#d84335",
      material: "front visible apple skin",
      note: "从单张照片推断的正面曲率。"
    }),
    appleTemplateObject({
      id: "apple-rear-bulge",
      label: "背面推断体量",
      size: [w * 0.72, d * 0.22, h * 0.56],
      position: [0, h * 0.49, -d * 0.26],
      color: "#8f211d",
      material: "inferred rear apple skin",
      note: "背面不可见，按对称但略收的苹果体量推断。"
    }),
    appleTemplateObject({
      id: "apple-top-dimple",
      label: "顶部果窝凹陷标记",
      shape: "cylinder",
      size: [w * 0.36, d * 0.31, h * 0.05],
      position: [0, top - h * 0.08, 0],
      color: "#6e2d20",
      material: "recessed red-brown top dimple",
      note: "CAD 预览用薄圆盘标出凹陷区域，后续 STEP 可替换为布尔扣减。"
    }),
    appleTemplateObject({
      id: "apple-yellow-green-transition",
      label: "果梗周围黄绿过渡",
      shape: "cylinder",
      size: [w * 0.26, d * 0.22, h * 0.028],
      position: [w * 0.03, top - h * 0.045, -d * 0.02],
      color: "#9b8f42",
      material: "yellow green apple skin near stem",
      note: "保留照片中果梗附近的颜色分区，但不把高光当几何。"
    }),
    appleTemplateObject({
      id: "apple-stem-cap",
      label: "果梗根部收口",
      shape: "cylinder",
      size: [w * 0.16, d * 0.13, h * 0.035],
      position: [w * 0.04, top - h * 0.025, -d * 0.03],
      color: "#4f2b19",
      material: "stem socket",
      note: "果梗连接处的收口。"
    }),
    appleTemplateObject({
      id: "apple-stem",
      label: "倾斜果梗",
      shape: "cylinder",
      size: [w * 0.085, w * 0.075, stemHeight],
      position: [w * 0.065, top + stemHeight / 2 - h * 0.035, -d * 0.05],
      rotation: [14, 0, 18],
      color: "#6a4122",
      material: "brown apple stem",
      note: "顶部真实附属结构，按照片透视做轻微倾斜。"
    }),
    appleTemplateObject({
      id: "apple-bottom-flattening",
      label: "底部轻微压平",
      shape: "cylinder",
      size: [w * 0.52, d * 0.44, h * 0.055],
      position: [0, h * 0.03, 0],
      color: "#84231f",
      material: "flattened lower skin",
      opacity: 0.86,
      note: "用于表达苹果底部不是完美球面。"
    }),
    appleTemplateObject({
      id: "apple-bottom-dimple",
      label: "底部果脐",
      shape: "cylinder",
      size: [w * 0.24, d * 0.2, h * 0.022],
      position: [0, h * 0.012, 0],
      color: "#581d1a",
      material: "bottom calyx dimple",
      opacity: 0.82,
      note: "底部小凹点，提升物体识别度。"
    })
  ];
}

function commonObjectTemplateSceneFromAnalysis(modelingAnalysis = {}, { intent = "", primaryImage = null } = {}) {
  const sourceType = modelingAnalysis.sourceType || "object-photo";
  if (!objectPhotoLooksLikeApple(sourceType, modelingAnalysis, intent, primaryImage?.name)) return null;
  return {
    title: "红苹果参数白模",
    sourceType: "object-photo",
    commonObjectTemplate: "red-apple",
    units: "meters",
    summary: "已按单个红苹果生成参数化白模：保留椭球果身、非对称肩部、顶部果窝、果梗、底部压平与果脐；白底、阴影、高光和摄影留白不建模。",
    confidence: Math.max(0.78, Number(modelingAnalysis.confidence || 0.78) || 0.78),
    assumptions: ["单张图片无法获取背面轮廓，背面体量按苹果常见对称关系推断。", "顶部和底部凹陷先用薄圆盘标记，后续可在 CAD 中改成布尔扣减。"],
    limitations: ["不是摄影测量网格，细微果皮纹理和高光不会转成几何。"],
    spacePlan: {
      roomType: "object-photo",
      envelope: "single apple object envelope",
      keyZones: ["果身", "顶部果窝", "果梗", "底部果脐"],
      circulation: "",
      scaleAssumptions: ["苹果直径约 80-110mm，单位按米保存，导出时转换为毫米。"],
      modelingStrategy: "multi-ellipsoid body + cylinder dimple/stem markers; CAD-friendly primitives"
    },
    objects: buildAppleWhiteModelObjects(modelingAnalysis)
  };
}

function knownObjectTemplateAnalysis(modelingAnalysis = {}, { intent = "", primaryImage = null } = {}) {
  if (objectPhotoLooksLikeApple(modelingAnalysis.sourceType || "", modelingAnalysis, intent, primaryImage?.name)) {
    return modelingAnalysis;
  }
  if (!objectPhotoLooksLikeApple("object-photo", modelingAnalysis, intent, primaryImage?.name)) return null;
  return {
    ...modelingAnalysis,
    subject: modelingAnalysis.subject || "红苹果",
    sourceType: "object-photo",
    summary: modelingAnalysis.summary || "按单个苹果产品/物体照片处理，排除背景、阴影和摄影高光。"
  };
}

function fallbackInteriorModelDimensions(text = "") {
  if (/(lobby|hotel|hospitality|民宿|酒店|大堂|接待|公共)/i.test(text)) return { width: 9.2, depth: 6.4, height: 3.4 };
  if (/(office|workplace|办公|会议|工位)/i.test(text)) return { width: 8.4, depth: 5.6, height: 3.1 };
  if (/(retail|store|shop|display|展厅|门店|零售|商业|陈列)/i.test(text)) return { width: 8.8, depth: 5.8, height: 3.3 };
  if (/(kitchen|dining|cafe|餐|厨|咖啡|吧台)/i.test(text)) return { width: 6.8, depth: 4.8, height: 3.0 };
  if (/(bedroom|suite|客房|卧室|套房)/i.test(text)) return { width: 5.6, depth: 4.4, height: 2.9 };
  return { width: 7.2, depth: 5.2, height: 3.0 };
}

function shouldFallbackToSpatialWhiteModel(modelingAnalysis = {}, { brief = {}, intent = "", primaryImage = null } = {}) {
  const sourceType = String(modelingAnalysis.sourceType || modelingAnalysis.source_type || "").toLowerCase();
  const briefText = [
    brief.projectName,
    brief.spaceType,
    brief.projectType,
    brief.functions,
    brief.style,
    brief.preserveNotes
  ].filter(Boolean).join(" ");
  const text = imageModelingSubjectText(modelingAnalysis, briefText, intent, primaryImage?.name);
  const spatialText = `${sourceType} ${text}`;
  const looksLikeSpatial = /(interior|room|space|floor[-_\s]?plan|plan[-_\s]?reference|architecture|building|facade|lobby|hotel|retail|office|cafe|restaurant|residential|commercial|室内|空间|房间|客厅|卧室|餐厅|厨房|平面|户型|建筑|立面|外立面|大堂|酒店|民宿|门店|商店|零售|办公|咖啡|餐饮|商业)/i.test(spatialText);
  const explicitlyObjectOnly = /(object|product)/i.test(sourceType) && !looksLikeSpatial;
  return looksLikeSpatial && !explicitlyObjectOnly;
}

function shouldFallbackToSpatialImageModelingRequest(body = {}, providedAnalysis = {}, { brief = {}, intent = "", primaryImage = null } = {}) {
  if (shouldFallbackToSpatialWhiteModel(providedAnalysis, { brief, intent, primaryImage })) return true;
  const hasCadReference = Boolean(
    providedAnalysis?.cadReferenceImage ||
    providedAnalysis?.cad_reference_image ||
    providedAnalysis?.modelingCadPrepass?.image ||
    providedAnalysis?.modeling_cad_prepass?.image
  );
  if (hasCadReference) return true;
  return shouldFallbackToSpatialWhiteModel({
    sourceType: primaryImage?.sourceType || body.primaryImage?.sourceType || body.sourceType || "",
    subject: body.subject || "",
    summary: body.summary || ""
  }, { brief, intent, primaryImage });
}

function fallbackSpatialImageModelingAnalysis({ body = {}, brief = {}, intent = "", primaryImage = null, providedAnalysis = null, error = null } = {}) {
  const text = imageModelingSubjectText(providedAnalysis, brief, intent, primaryImage?.name);
  const sourceType = /(building|facade|architecture|建筑|立面|外立面)/i.test(text)
    ? "architecture-photo"
    : /(floor[-_\s]?plan|plan[-_\s]?reference|平面|户型)/i.test(text)
      ? "floor-plan-reference"
      : "interior-photo";
  const layers = Array.isArray(providedAnalysis?.layers) && providedAnalysis.layers.length
    ? providedAnalysis.layers
    : [
        { id: "spatial-shell", label: "空间壳体/主要墙面", role: "interior shell envelope", includeInModel: true, priority: 1, primitiveHint: "box", material: "wall finish", notes: "端点超时兜底识别" },
        { id: "main-opening", label: "主要门窗/玻璃开口", role: "opening", includeInModel: true, priority: 2, primitiveHint: "box", material: "glass/opening", notes: "按参考图位置后续可手动校正" },
        { id: "main-counter", label: "主要柜台/固定柜体", role: "counter or cabinet", includeInModel: true, priority: 3, primitiveHint: "box", material: "millwork", notes: "按室内常见尺度生成" },
        { id: "central-table", label: "中央桌面", role: "table", includeInModel: true, priority: 4, primitiveHint: "box", material: "tabletop", notes: "按室内常见尺度生成" },
        { id: "main-seat", label: "主要座椅/沙发", role: "seat or sofa", includeInModel: true, priority: 5, primitiveHint: "box", material: "upholstery", notes: "按室内常见尺度生成" },
        { id: "wall-shelf", label: "墙面收纳/陈列", role: "shelf display storage", includeInModel: true, priority: 6, primitiveHint: "box", material: "shelving", notes: "按室内常见尺度生成" },
        { id: "ceiling-feature", label: "顶面/灯带构件", role: "beam ceiling feature light", includeInModel: true, priority: 7, primitiveHint: "box", material: "ceiling/light", notes: "按室内常见尺度生成" }
      ];
  return normalizeImageModelingAnalysis({
    ...(providedAnalysis || {}),
    subject: providedAnalysis?.subject || brief.projectName || primaryImage?.name || "室内空间",
    sourceType: /^(object|product|image-reference)?$/i.test(String(providedAnalysis?.sourceType || "")) ? sourceType : providedAnalysis?.sourceType || sourceType,
    summary: providedAnalysis?.summary || `reasoning 端点未完成分析：${reasoningFallbackReason(error)}。已生成空间类兜底分析用于继续 3D 建模。`,
    confidence: Math.min(0.58, Number(providedAnalysis?.confidence || 0.58) || 0.58),
    completeness: {
      isComplete: true,
      score: 0.58,
      label: "兜底可建模",
      missingParts: [],
      edgeContact: [],
      recommendation: "端点超时，先生成可编辑基础模型；后续通过选择对象校正尺寸、位置和角度。",
      reason: reasoningFallbackReason(error)
    },
    targetBounds: providedAnalysis?.targetBounds || { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    targetShape: providedAnalysis?.targetShape || {
      type: "polygon",
      points: [[0.08, 0.88], [0.2, 0.18], [0.78, 0.12], [0.92, 0.88]],
      note: "fallback spatial envelope, not a precise silhouette"
    },
    modelingScope: providedAnalysis?.modelingScope || "fallback interior/architectural space envelope and major editable layers",
    scaleStrategy: providedAnalysis?.scaleStrategy || "meters, approximate room envelope inferred from single image",
    primitiveStrategy: providedAnalysis?.primitiveStrategy || "floor/walls/openings/furniture as editable boxes and cylinders",
    visualProfile: providedAnalysis?.visualProfile || {
      silhouette: "fallback spatial envelope",
      viewAngle: "single image perspective",
      characteristicFeatures: ["floor plate", "walls", "main openings", "major furniture"],
      materialZones: [],
      nonGeometry: ["photo shadows", "highlights", "texture noise"]
    },
    depthRelations: asStringArray(providedAnalysis?.depthRelations).length ? providedAnalysis.depthRelations : ["depth inferred from single image"],
    excludedRegions: asStringArray(providedAnalysis?.excludedRegions).length ? providedAnalysis.excludedRegions : ["photo shadows", "specular highlights", "background noise"],
    layers,
    fallbackAnalysis: true,
    fallbackReason: reasoningFallbackReason(error)
  }, body);
}

function fallbackInteriorObjectFromLayer(layer = {}, index = 0, dims = fallbackInteriorModelDimensions()) {
  const text = imageModelingSubjectText(layer);
  const material = String(layer.material || layer.role || layer.label || "").slice(0, 40);
  const x = [-0.28, 0.18, -0.08, 0.34, -0.36, 0.38][index % 6] * dims.width;
  const z = [-0.22, 0.1, 0.28, -0.04, 0.34, -0.32][index % 6] * dims.depth;
  if (/(wall|envelope|shell|facade|墙|围护|壳体|立面)/i.test(text)) {
    return {
      type: "wall",
      shape: "box",
      label: layer.label || "主要墙面/空间壳体",
      size: [Math.max(2.4, dims.width * 0.62), 0.12, dims.height],
      position: [x * 0.35, dims.height / 2, -dims.depth / 2],
      color: whiteModelMaterialPalette.wall,
      material: material || "inferred wall finish"
    };
  }
  if (/(ceiling|天花|吊顶|顶面)/i.test(text)) {
    return {
      type: "ceiling",
      shape: "box",
      label: layer.label || "顶面/吊顶",
      size: [Math.max(2.4, dims.width * 0.5), Math.max(1.2, dims.depth * 0.34), 0.08],
      position: [x * 0.25, dims.height - 0.04, z * 0.25],
      color: whiteModelMaterialPalette.ceiling,
      material: material || "inferred ceiling"
    };
  }
  if (/(window|door|opening|glass|门|窗|开口|玻璃|推拉门)/i.test(text)) {
    return {
      type: "opening",
      shape: "box",
      label: layer.label || "主要门窗开口",
      size: [Math.max(1.2, dims.width * 0.28), 0.05, Math.max(1.4, dims.height * 0.52)],
      position: [Math.max(-dims.width * 0.25, Math.min(dims.width * 0.25, x)), dims.height * 0.52, -dims.depth / 2 - 0.03],
      color: whiteModelMaterialPalette.opening,
      material: material || "glass/opening",
      opacity: 0.36
    };
  }
  if (/(counter|cabinet|island|bar|reception|柜|台|吧台|橱|前台|收银)/i.test(text)) {
    return {
      type: "counter",
      shape: "box",
      label: layer.label || "主要柜台/固定柜体",
      size: [Math.max(1.4, dims.width * 0.26), 0.58, 0.92],
      position: [x, 0.46, Math.max(-dims.depth * 0.32, Math.min(dims.depth * 0.3, z))],
      color: whiteModelMaterialPalette.counter,
      material: material || "inferred millwork"
    };
  }
  if (/(shelf|storage|display|bookcase|架|柜|陈列|展示|收纳)/i.test(text)) {
    return {
      type: "shelf",
      shape: "box",
      label: layer.label || "主要收纳/陈列体",
      size: [Math.max(1.2, dims.width * 0.22), 0.38, Math.max(1.5, dims.height * 0.62)],
      position: [x, Math.max(0.75, dims.height * 0.31), -dims.depth * 0.42],
      color: whiteModelMaterialPalette.shelf,
      material: material || "inferred shelving"
    };
  }
  if (/(sofa|chair|seat|bench|椅|沙发|座|卡座|凳)/i.test(text)) {
    return {
      type: "seat",
      shape: "box",
      label: layer.label || "主要座椅",
      size: [1.05, 0.82, 0.72],
      position: [x, 0.36, z],
      color: whiteModelMaterialPalette.seat,
      material: material || "inferred upholstery"
    };
  }
  if (/(table|desk|coffee|餐桌|桌|茶几|书桌)/i.test(text)) {
    return {
      type: "table",
      shape: "box",
      label: layer.label || "主要桌面",
      size: [1.35, 0.86, 0.42],
      position: [x, 0.21, z],
      color: whiteModelMaterialPalette.table,
      material: material || "inferred tabletop"
    };
  }
  if (/(column|post|pillar|柱|立柱)/i.test(text)) {
    return {
      type: "column",
      shape: "cylinder",
      label: layer.label || "结构柱",
      size: [0.36, 0.36, dims.height],
      position: [x, dims.height / 2, z],
      color: whiteModelMaterialPalette.column,
      material: material || "inferred column"
    };
  }
  if (/(beam|梁|吊顶|ceiling feature)/i.test(text)) {
    return {
      type: "beam",
      shape: "box",
      label: layer.label || "梁/吊顶构件",
      size: [Math.max(1.8, dims.width * 0.34), 0.22, 0.24],
      position: [x, dims.height - 0.22, z],
      color: whiteModelMaterialPalette.beam,
      material: material || "inferred ceiling structure"
    };
  }
  if (/(light|lamp|pendant|track|灯|吊灯|灯带|射灯)/i.test(text)) {
    return {
      type: "fixture",
      shape: "cylinder",
      label: layer.label || "主要灯具",
      size: [0.42, 0.42, 0.18],
      position: [x, dims.height - 0.22, z],
      color: whiteModelMaterialPalette.fixture,
      material: material || "warm light"
    };
  }
  return null;
}

function fallbackInteriorWhiteModelSceneFromAnalysis(modelingAnalysis = {}, { brief = {}, intent = "", primaryImage = null, cadReferenceMeta = null, error = null } = {}) {
  const text = imageModelingSubjectText(modelingAnalysis, brief, intent, primaryImage?.name);
  const dims = fallbackInteriorModelDimensions(text);
  const layers = Array.isArray(modelingAnalysis.layers)
    ? modelingAnalysis.layers.filter((layer) => layer?.includeInModel !== false).slice(0, 16)
    : [];
  const objects = [
    {
      id: "fallback-floor-plate",
      type: "floor",
      shape: "box",
      label: "空间地面基底",
      size: [dims.width, dims.depth, 0.08],
      position: [0, 0.04, 0],
      color: whiteModelMaterialPalette.floor,
      material: "inferred floor finish",
      note: "端点超时兜底：按室内空间包络生成。"
    },
    {
      id: "fallback-back-wall",
      type: "wall",
      shape: "box",
      label: "后侧主墙面",
      size: [dims.width, 0.12, dims.height],
      position: [0, dims.height / 2, -dims.depth / 2],
      color: whiteModelMaterialPalette.wall,
      material: "inferred wall finish",
      opacity: 0.88
    },
    {
      id: "fallback-left-wall",
      type: "wall",
      shape: "box",
      label: "左侧墙面",
      size: [0.12, dims.depth, dims.height],
      position: [-dims.width / 2, dims.height / 2, 0],
      color: whiteModelMaterialPalette.wall,
      material: "inferred side wall",
      opacity: 0.58
    },
    {
      id: "fallback-right-wall",
      type: "wall",
      shape: "box",
      label: "右侧墙面",
      size: [0.12, dims.depth, dims.height],
      position: [dims.width / 2, dims.height / 2, 0],
      color: whiteModelMaterialPalette.wall,
      material: "inferred side wall",
      opacity: 0.42
    }
  ];
  layers
    .map((layer, index) => fallbackInteriorObjectFromLayer(layer, index, dims))
    .filter(Boolean)
    .forEach((object) => objects.push(object));
  if (objects.length < 6) {
    objects.push(
      { type: "counter", shape: "box", label: "主要固定柜体", size: [2.2, 0.56, 0.9], position: [-dims.width * 0.24, 0.45, -dims.depth * 0.18], color: whiteModelMaterialPalette.counter, material: "inferred millwork" },
      { type: "table", shape: "box", label: "中央桌面", size: [1.35, 0.9, 0.42], position: [0.35, 0.21, 0.18], color: whiteModelMaterialPalette.table, material: "inferred table" },
      { type: "seat", shape: "box", label: "座椅/沙发体块", size: [1.08, 0.82, 0.72], position: [-0.9, 0.36, 0.72], color: whiteModelMaterialPalette.seat, material: "inferred seating" },
      { type: "shelf", shape: "box", label: "墙面收纳/陈列", size: [1.7, 0.34, 1.65], position: [dims.width * 0.22, 0.825, -dims.depth * 0.42], color: whiteModelMaterialPalette.shelf, material: "inferred shelving" }
    );
  }
  return {
    title: `${brief.projectName || primaryImage?.name || "室内空间"} · 兜底3D模型`,
    sourceType: modelingAnalysis.sourceType || "interior-photo",
    units: "meters",
    summary: `reasoning 端点超时/中止，已先根据${cadReferenceMeta ? "CAD结构参考图和" : ""}图片分析生成可编辑基础室内模型；可继续拖拽校正位置、尺寸和角度后导出。`,
    confidence: 0.54,
    assumptions: [
      "这是端点超时后的本地参数化兜底模型，不是完整 AI 推理结果。",
      "单张室内图背面、遮挡区域和真实尺寸需要人工复核。"
    ],
    limitations: [
      `原始建模请求未完成：${reasoningFallbackReason(error)}`,
      "细部造型、复杂异形构件和精确家具尺寸需要继续编辑。"
    ],
    spacePlan: {
      roomType: modelingAnalysis.sourceType || "interior-photo",
      envelope: `${dims.width}m x ${dims.depth}m x ${dims.height}m inferred editable interior envelope`,
      keyZones: asStringArray(modelingAnalysis.layers?.map?.((layer) => layer.label || layer.role)).slice(0, 8),
      circulation: "fallback circulation inferred from visible interior perspective",
      scaleAssumptions: ["meters, approximate room envelope", "major objects are CAD-friendly primitives"],
      modelingStrategy: "fallback envelope + layer-derived boxes/cylinders; user-editable in viewer"
    },
    objects
  };
}

function objectPhotoModelNeedsDetail(objects = [], sourceType = "", ...items) {
  if (!/(object|product)/i.test(sourceType)) return false;
  const text = imageModelingSubjectText(...items, objects);
  const hasPrimaryBody = objects.some((object) => /(主体|main|body|果身|苹果|product)/i.test(whiteModelObjectSearchText(object)));
  const hasAttachedDetail = /(stem|stalk|peduncle|handle|leg|果梗|柄|支脚|把手|凹陷|dimple|opening)/i.test(text);
  return objects.length < 8 || !hasPrimaryBody || !hasAttachedDetail;
}

function ensureObjectPhotoModelDetail(objects = [], sourceType = "", { source = {}, parsed = {}, modelingAnalysis = {}, intent = "", primaryImage = null } = {}) {
  if (!/(object|product)/i.test(sourceType)) return objects;
  if (objectPhotoLooksLikeApple(sourceType, source, parsed, modelingAnalysis, intent, primaryImage?.name)) {
    const hasStem = objects.some((object) => /(stem|stalk|peduncle|果梗|苹果柄)/i.test(whiteModelObjectSearchText(object)));
    const hasDimple = objects.some((object) => /(dimple|depression|果窝|果脐|凹陷)/i.test(whiteModelObjectSearchText(object)));
    if (objects.length < 10 || !hasStem || !hasDimple) {
      return buildAppleWhiteModelObjects(modelingAnalysis).map(normalizeWhiteModelObject);
    }
  }
  if (!objectPhotoModelNeedsDetail(objects, sourceType, source, parsed, modelingAnalysis, intent)) return objects;
  const body = primaryObjectPhotoBody(objects);
  if (!body?.size || !body?.position) return objects;
  const [w = 1, d = 1, h = 1] = body.size;
  const [x = 0, y = h / 2, z = 0] = body.position;
  const top = y + h / 2;
  const bottom = y - h / 2;
  const additions = [
    {
      type: body.type || "generic",
      shape: "sphere",
      label: "front curvature detail",
      size: [w * 0.72, d * 0.28, h * 0.62],
      position: [x, y, z + d * 0.28],
      color: body.color,
      layer: body.layer,
      material: body.material || "front visible surface",
      note: "自动补充：单张物体照的正面曲率表达。"
    },
    {
      type: body.type || "generic",
      shape: "sphere",
      label: "rear inferred curvature",
      size: [w * 0.68, d * 0.22, h * 0.56],
      position: [x, y, z - d * 0.25],
      color: body.color,
      layer: body.layer,
      material: body.material || "inferred rear surface",
      opacity: 0.88,
      note: "自动补充：背面不可见，按主体轮廓推断。"
    },
    {
      type: body.type || "generic",
      shape: "sphere",
      label: "top contour control",
      size: [w * 0.5, d * 0.48, h * 0.18],
      position: [x, top - h * 0.08, z],
      color: body.color,
      layer: body.layer,
      material: body.material || "upper contour",
      note: "自动补充：避免物体顶部过于简单。"
    },
    {
      type: body.type || "generic",
      shape: "cylinder",
      label: "bottom contact control",
      size: [w * 0.48, d * 0.42, h * 0.05],
      position: [x, bottom + h * 0.025, z],
      color: body.color,
      layer: body.layer,
      material: body.material || "bottom contact",
      opacity: 0.82,
      note: "自动补充：底部接触面/压平关系。"
    }
  ].map((object, index) => normalizeWhiteModelObject(object, objects.length + index));
  return uniqueWhiteModelObjects([...objects, ...additions]).slice(0, 96);
}

function whiteModelLayerCounts(objects) {
  const counts = Object.fromEntries(whiteModelLayerDefinitions.map(([key]) => [key, 0]));
  objects.forEach((object) => {
    const layer = whiteModelLayerKeys.has(object.layer) ? object.layer : whiteModelLayerForObject(object.type, object);
    counts[layer] = (counts[layer] || 0) + 1;
  });
  return counts;
}

function whiteModelCompletenessReport(objects, sourceType = "") {
  const normalizedSource = String(sourceType || "").toLowerCase();
  const counts = whiteModelLayerCounts(objects);
  const materialCount = new Set(objects.map((object) => String(object.material || object.color || "")).filter(Boolean)).size;
  const architectureInput = architectureExteriorLooksLikeBuilding(sourceType, objects);
  const spatialInput = !/(object|product)/.test(normalizedSource);
  const interiorInput = /interior|room|space|室内|空间|房间/i.test(normalizedSource) && !architectureInput;
  const hasText = (pattern) => objects.some((object) => pattern.test(whiteModelObjectSearchText(object)));
  const openingCount = objects.filter((object) => object.layer === "openings" || object.type === "opening").length;
  const architectureGeometry = architectureInput ? architectureGeometrySanityReport(objects) : { passed: true };
  const checks = architectureInput
    ? [
      { id: "building_mass", label: "整栋建筑体量", weight: 18, passed: counts.shell >= 3 || hasText(/building|facade|mass|volume|建筑|楼体|体量|立面|外墙/i) },
      { id: "roof_top", label: "屋顶/顶部收口", weight: 14, passed: counts.structure >= 2 && hasText(/roof|eave|gable|parapet|屋顶|屋面|檐|女儿墙|屋脊/i) },
      { id: "openings", label: "立面门窗", weight: 16, passed: openingCount >= 4 },
      { id: "entry_base", label: "入口/台基", weight: 10, passed: hasText(/door|entry|stair|step|plinth|base|门|入口|台阶|基座|勒脚|台基/i) },
      { id: "depth", label: "侧墙/深度推断", weight: 10, passed: hasText(/side|rear|depth|侧墙|后墙|背立面|深度/i) || counts.shell >= 4 },
      { id: "facade_rhythm", label: "立面节奏", weight: 10, passed: openingCount >= 8 || objects.length >= 24 },
      { id: "geometry_axes", label: "尺寸轴向/落地关系", weight: 14, passed: architectureGeometry.passed },
      { id: "materials", label: "材质/颜色区分", weight: 8, passed: materialCount >= 4 },
      { id: "density", label: "对象密度", weight: 10, passed: objects.length >= 18 }
    ]
    : [
      { id: "shell", label: "地墙顶/空间壳体", weight: 22, passed: spatialInput ? counts.shell >= 3 : true },
      { id: "openings", label: "门窗/开口", weight: spatialInput ? 14 : 4, passed: !spatialInput || counts.openings >= 1 },
      { id: "structure", label: "柱梁/楼梯/结构", weight: 8, passed: spatialInput ? (counts.structure >= 1 || objects.length >= 16) : true },
      { id: "fixed_furniture", label: "固定家具/柜体", weight: 12, passed: counts.fixed_furniture >= 1 || !spatialInput },
      { id: "loose_furniture", label: "活动家具", weight: 14, passed: counts.loose_furniture >= 2 || !spatialInput },
      { id: "lighting", label: "灯光设备", weight: 10, passed: spatialInput ? (counts.lighting >= 1 || normalizedSource.includes("floor-plan")) : true },
      { id: "context", label: "绿植/环境线索", weight: 6, passed: spatialInput ? (counts.context >= 1 || normalizedSource.includes("floor-plan")) : true },
      { id: "materials", label: "材质/颜色区分", weight: 8, passed: materialCount >= 5 },
      { id: "density", label: "对象密度", weight: 6, passed: objects.length >= (interiorInput ? 24 : spatialInput ? 18 : 8) }
    ];
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = totalWeight ? Math.round((passedWeight / totalWeight) * 100) : 0;
  const missing = checks.filter((check) => !check.passed).map((check) => check.label);
  return {
    score,
    label: score >= 86 ? "完整" : score >= 70 ? "可用" : "偏简略",
    missing,
    layerCounts: counts,
    checks: checks.map((check) => ({
      id: check.id,
      label: check.label,
      passed: Boolean(check.passed)
    }))
  };
}

function normalizeWhiteModelSpacePlan(source = {}, parsed = {}) {
  const plan = source.spacePlan || parsed.spacePlan || {};
  return {
    roomType: String(plan.roomType || plan.room_type || source.sourceType || "unknown").slice(0, 80),
    envelope: String(plan.envelope || "").slice(0, 220),
    keyZones: asStringArray(plan.keyZones || plan.key_zones).slice(0, 8),
    circulation: String(plan.circulation || "").slice(0, 220),
    scaleAssumptions: asStringArray(plan.scaleAssumptions || plan.scale_assumptions).slice(0, 6),
    modelingStrategy: String(plan.modelingStrategy || plan.modeling_strategy || "").slice(0, 260)
  };
}

function normalizeWhiteModelPreviewCamera(source = {}, sourceType = "") {
  const camera = source.previewCamera || source.preview_camera || source.camera || {};
  const normalizeCameraVector = (value, fallback) => {
    if (!Array.isArray(value)) return fallback;
    return fallback.map((fallbackValue, index) => {
      const number = Number(value[index]);
      return Number.isFinite(number) ? Number(number.toFixed(3)) : fallbackValue;
    });
  };
  const interior = /interior|room|space|室内|空间|房间/i.test(String(sourceType || source.sourceType || ""));
  const fallbackPosition = interior ? [2.2, 1.55, 3.2] : [6, 4.5, 6];
  const fallbackTarget = interior ? [0, 1.32, -1.2] : [0, 1.2, 0];
  return {
    mode: String(camera.mode || (interior ? "interior" : "orbit")).slice(0, 40),
    position: normalizeCameraVector(camera.position || camera.eye || camera.cameraPosition, fallbackPosition),
    target: normalizeCameraVector(camera.target || camera.lookAt || camera.look_at, fallbackTarget),
    note: String(camera.note || "").slice(0, 180)
  };
}

function normalizeWhiteModelScene(parsed, { brief = {}, intent = "", primaryImage = null, modelingAnalysis = null } = {}) {
  const source = parsed?.whiteModelScene || parsed?.scene || parsed || {};
  const sourceType = String(source.sourceType || source.source_type || "image-to-colored-3d-model").slice(0, 60);
  const objectInput = /(object|product)/i.test(sourceType);
  const architectureExteriorInput = architectureExteriorLooksLikeBuilding(sourceType, source, modelingAnalysis, intent, primaryImage?.name);
  const commonObjectTemplate = String(source.commonObjectTemplate || source.common_object_template || "").trim();
  let objects = Array.isArray(source.objects) ? source.objects : [];
  objects = objects.slice(0, 96).map(normalizeWhiteModelObject);
  if (!objectInput && !objects.some((object) => object.type === "floor")) {
    objects.unshift(normalizeWhiteModelObject({
      type: "floor",
      layer: architectureExteriorInput ? "context" : "shell",
      label: architectureExteriorInput ? "site base" : "floor plate",
      size: [8, 6, 0.08],
      position: [0, 0.04, 0],
      color: whiteModelMaterialPalette.floor
    }, 0));
  }
  objects = completeWhiteModelEnvelope(objects, sourceType);
  objects = ensureInteriorModelDetail(objects, sourceType, { modelingAnalysis, brief, intent });
  if (architectureExteriorInput) {
    objects = repairArchitectureExteriorModelObjects(objects, sourceType, source, parsed, modelingAnalysis, intent, primaryImage?.name);
  }
  if (!commonObjectTemplate) {
    objects = refineObjectPhotoWhiteModelObjects(objects, sourceType);
    objects = ensureObjectPhotoModelDetail(objects, sourceType, {
      source,
      parsed,
      modelingAnalysis,
      intent,
      primaryImage
    });
  }
  if (!commonObjectTemplate && architectureExteriorInput) {
    objects = ensureArchitectureExteriorModelDetail(objects, sourceType, {
      source,
      parsed,
      modelingAnalysis,
      intent,
      primaryImage
    });
    objects = repairArchitectureExteriorModelObjects(objects, sourceType, source, parsed, modelingAnalysis, intent, primaryImage?.name);
  }
  if (!objectInput && objects.length < 2) {
    objects.push(
      normalizeWhiteModelObject({ type: "wall", layer: "shell", label: "back wall", size: [8, 0.18, 3], position: [0, 1.5, -3] }, 1),
      normalizeWhiteModelObject({ type: "wall", layer: "shell", label: "side wall", size: [0.18, 6, 3], position: [-4, 1.5, 0] }, 2)
    );
  } else if (objectInput && !objects.length) {
    objects.push(normalizeWhiteModelObject({
      type: "generic",
      shape: "box",
      label: "main subject placeholder",
      size: [1, 1, 1],
      position: [0, 0.5, 0],
      material: "inferred main object"
    }, 0));
  }
  objects = uniqueWhiteModelObjects(objects).slice(0, 96);
  const completeness = whiteModelCompletenessReport(objects, sourceType);
  const title = String(source.title || parsed?.title || brief.projectName || primaryImage?.name || "已移除模型").slice(0, 80);
  return {
    id: `removed-model-${Date.now()}`,
    title,
    mode: "removed-model",
    units: String(source.units || "meters").slice(0, 24),
    sourceType,
    summary: String(source.summary || parsed?.summary || "已根据上传图片生成可旋转的彩色 3D 概念模型。").slice(0, 600),
    assumptions: asStringArray(source.assumptions || parsed?.assumptions).slice(0, 8),
    limitations: asStringArray(source.limitations || parsed?.limitations).concat(completeness.missing.length ? [`完整度仍需人工复核：${completeness.missing.join("、")}。`] : []).slice(0, 8),
    confidence: clampNumber(asFiniteNumber(source.confidence ?? parsed?.confidence, 0.62), 0.05, 0.95),
    objectCount: objects.length,
    bounds: whiteModelBounds(objects),
    spacePlan: normalizeWhiteModelSpacePlan(source, parsed),
    previewCamera: normalizeWhiteModelPreviewCamera(source, sourceType),
    layers: whiteModelLayerCounts(objects),
    completeness,
    completionScore: completeness.score,
    objects,
    intent: String(intent || "").slice(0, 1200),
    sourceImage: primaryImage ? {
      name: primaryImage.name || null,
      type: primaryImage.type || null,
      sourceType: primaryImage.sourceType || null
    } : null,
    reasoningModel: config.reasoningModel,
    createdAt: new Date().toISOString()
  };
}

function scadString(value) {
  return JSON.stringify(String(value || "").replace(/[^\w\s#.,:+/-]/g, "").slice(0, 120));
}

function scadNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(4)) : fallback;
}

function scadVector(values = [], fallback = [0, 0, 0]) {
  return fallback.map((fallbackValue, index) => scadNumber(values[index], fallbackValue));
}

function whiteModelToScad(model) {
  const title = String(model?.title || "ai-image-model");
  const objects = Array.isArray(model?.objects) ? model.objects : [];
  const lines = [
    `// ${title}`,
    "// Generated by Laogui AI image modeling. Units: millimeters.",
    "// Open in OpenSCAD or import via FreeCAD/compatible CAD workflows.",
    "unit_scale = 1000;",
    "$fn = 48;",
    "",
    "module obj_box(size_m, pos_m, rot_deg, color_hex) {",
    "  color(color_hex)",
    "    translate([pos_m[0] * unit_scale, pos_m[2] * unit_scale, pos_m[1] * unit_scale])",
    "      rotate([rot_deg[0], rot_deg[2], rot_deg[1]])",
    "        cube([max(size_m[0] * unit_scale, 1), max(size_m[1] * unit_scale, 1), max(size_m[2] * unit_scale, 1)], center=true);",
    "}",
    "",
    "module obj_cylinder(size_m, pos_m, rot_deg, color_hex) {",
    "  radius = max(max(size_m[0], size_m[1]) * unit_scale / 2, 1);",
    "  color(color_hex)",
    "    translate([pos_m[0] * unit_scale, pos_m[2] * unit_scale, pos_m[1] * unit_scale])",
    "      rotate([rot_deg[0], rot_deg[2], rot_deg[1]])",
    "        cylinder(h=max(size_m[2] * unit_scale, 1), r=radius, center=true);",
    "}",
    "",
    "module obj_sphere(size_m, pos_m, rot_deg, color_hex) {",
    "  color(color_hex)",
    "    translate([pos_m[0] * unit_scale, pos_m[2] * unit_scale, pos_m[1] * unit_scale])",
    "      rotate([rot_deg[0], rot_deg[2], rot_deg[1]])",
    "        scale([max(size_m[0] * unit_scale, 1), max(size_m[1] * unit_scale, 1), max(size_m[2] * unit_scale, 1)])",
    "          sphere(r=0.5);",
    "}",
    "",
    "union() {"
  ];

  objects.forEach((object, index) => {
    const shape = String(object?.shape || "box").toLowerCase();
    const moduleName = shape === "cylinder" ? "obj_cylinder" : shape === "sphere" ? "obj_sphere" : "obj_box";
    const size = scadVector(object?.size, [1, 1, 1]);
    const position = scadVector(object?.position, [0, size[2] / 2, 0]);
    const rotation = scadVector(object?.rotation, [0, 0, 0]);
    const color = isHex(object?.color) ? object.color : whiteModelMaterialPalette[object?.type] || whiteModelMaterialPalette.generic;
    lines.push(`  // ${index + 1}. ${String(object?.label || object?.id || object?.type || "object").slice(0, 80)}`);
    lines.push(`  ${moduleName}([${size.join(", ")}], [${position.join(", ")}], [${rotation.join(", ")}], ${scadString(color)});`);
  });

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function dxfPair(code, value) {
  return `${code}\n${value}\n`;
}

function whiteModelFootprintLines(model) {
  const objects = Array.isArray(model?.objects) ? model.objects : [];
  const lines = [];
  objects.forEach((object) => {
    if (object.type === "ceiling" || object.layer === "lighting") return;
    const [width = 1, depth = 1] = object.size || [];
    const [x = 0, , z = 0] = object.position || [];
    const halfW = Math.max(0.01, Number(width) || 1) / 2;
    const halfD = Math.max(0.01, Number(depth) || 1) / 2;
    const left = (x - halfW) * 1000;
    const right = (x + halfW) * 1000;
    const top = (z - halfD) * 1000;
    const bottom = (z + halfD) * 1000;
    lines.push([left, top, right, top]);
    lines.push([right, top, right, bottom]);
    lines.push([right, bottom, left, bottom]);
    lines.push([left, bottom, left, top]);
  });
  return lines.slice(0, 1200);
}

function whiteModelToDxf(model) {
  const lines = whiteModelFootprintLines(model);
  let dxf = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  for (const [x1, y1, x2, y2] of lines) {
    dxf += "0\nLINE\n8\nAI_MODEL_FOOTPRINT\n";
    dxf += dxfPair(10, scadNumber(x1));
    dxf += dxfPair(20, scadNumber(y1));
    dxf += dxfPair(30, 0);
    dxf += dxfPair(11, scadNumber(x2));
    dxf += dxfPair(21, scadNumber(y2));
    dxf += dxfPair(31, 0);
  }
  dxf += "0\nENDSEC\n0\nEOF\n";
  return dxf;
}

function whiteModelToFootprintSvg(model) {
  const lines = whiteModelFootprintLines(model);
  if (!lines.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><text x="40" y="60" fill="#333">No footprint</text></svg>`;
  }
  const xs = lines.flatMap((line) => [line[0], line[2]]);
  const ys = lines.flatMap((line) => [line[1], line[3]]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const pad = Math.max(width, height) * 0.08;
  const viewBox = `${scadNumber(minX - pad)} ${scadNumber(minY - pad)} ${scadNumber(width + pad * 2)} ${scadNumber(height + pad * 2)}`;
  const segments = lines.map(([x1, y1, x2, y2]) => `<line x1="${scadNumber(x1)}" y1="${scadNumber(y1)}" x2="${scadNumber(x2)}" y2="${scadNumber(y2)}" />`).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="${viewBox}">`,
    `<rect x="${scadNumber(minX - pad)}" y="${scadNumber(minY - pad)}" width="${scadNumber(width + pad * 2)}" height="${scadNumber(height + pad * 2)}" fill="#f7f3ea"/>`,
    `<g fill="none" stroke="#161616" stroke-width="${Math.max(20, Math.max(width, height) * 0.004)}" stroke-linecap="square">${segments}</g>`,
    "</svg>"
  ].join("");
}

function meaningfulSlug(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const slug = slugify(raw);
  return slug && slug !== "item" ? slug : "";
}

function deriveWhiteModelFileBase(model = {}) {
  const direct = meaningfulSlug(model.fileBase);
  if (direct) return direct;
  const sourceName = model.sourceImage?.name || model.primaryImage?.name || "";
  const imageBase = meaningfulSlug(sourceName ? path.basename(sourceName, path.extname(sourceName)) : "");
  if (imageBase) return imageBase;
  const subjectText = imageModelingSubjectText(model.title, model.modelingAnalysis, model.summary);
  if (/(红苹果|苹果|apple|red apple)/i.test(subjectText)) return "red-apple-parametric-model";
  return meaningfulSlug(model.title || model.id) || "ai-image-model";
}

function attachWhiteModelCadArtifacts(model) {
  const fileBase = deriveWhiteModelFileBase(model);
  return {
    ...model,
    fileBase,
    scadCode: whiteModelToScad(model),
    dxfText: whiteModelToDxf(model),
    footprintSvg: whiteModelToFootprintSvg(model),
    cadImport: {
      recommended: "SCAD",
      formats: ["GLB", "SCAD", "DXF footprint", "JSON"],
      notes: [
        "SCAD contains parametric 3D primitives in millimeters and can be opened in OpenSCAD or converted through FreeCAD.",
        "DXF is a top-view footprint for CAD tracing and layout coordination.",
        "GLB keeps the colored preview mesh for DCC or presentation workflows."
      ]
    }
  };
}

function assertWhiteModelForCadIntegration(input) {
  const model = input?.model || input?.whiteModelScene || input?.scene || input;
  if (!model || !Array.isArray(model.objects) || !model.objects.length) {
    throw httpError(400, "缺少可导出的 3D 参数模型对象");
  }
  const sourceType = String(model.sourceType || model.source_type || "image-to-colored-3d-model").slice(0, 60);
  const objects = repairArchitectureExteriorModelObjects(model.objects.slice(0, 240), sourceType, model.modelingAnalysis, model.summary, model.intent);
  return {
    ...model,
    title: String(model.title || "图片建模模型").slice(0, 120),
    units: model.units || "meters",
    sourceType,
    objects
  };
}

function generatedFileUrl(filePath) {
  const relativePath = path.relative(generatedDirectory(), filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw httpError(500, "Generated artifact path is outside generated directory");
  }
  return `/generated/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

async function createCadIntegrationWorkspace(model, engine) {
  const fileBase = slugify(model.fileBase || model.title || model.id || "ai-3d-model") || "ai-3d-model";
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dir = path.join(generatedDirectory(), "cad-integrations", `${fileBase}-${engine}-${runId}`);
  await fs.mkdir(dir, { recursive: true });
  return { dir, fileBase };
}

function cadObjectLabel(object, index) {
  return String(object?.label || object?.id || object?.type || `part-${index + 1}`)
    .replace(/[^\w\s#.,:+/-]/g, "")
    .trim()
    .slice(0, 80) || `part-${index + 1}`;
}

function cadObjectColor(object) {
  return isHex(object?.color)
    ? object.color
    : whiteModelMaterialPalette[object?.type] || whiteModelMaterialPalette.generic;
}

function jsArray(values, fallback) {
  return JSON.stringify(scadVector(values, fallback));
}

function whiteModelToForgeCadScript(model) {
  const title = String(model?.title || "AI 3D model");
  const objects = Array.isArray(model?.objects) ? model.objects : [];
  const lines = [
    `// ${title}`,
    "// Generated by Laogui AI image modeling for ForgeCAD.",
    "// Units: millimeters. Source coordinates are meters: [x, vertical-y, depth-z].",
    "// ForgeCAD uses Z-up: [x, depth-y, vertical-z].",
    "",
    "const mm = 1000;",
    "",
    "function placeModelShape(shape, positionM, rotationDeg) {",
    "  let result = shape.placeReference('center', [0, 0, 0]);",
    "  if (rotationDeg[0]) result = result.rotateX(rotationDeg[0]);",
    "  if (rotationDeg[2]) result = result.rotateY(rotationDeg[2]);",
    "  if (rotationDeg[1]) result = result.rotateZ(rotationDeg[1]);",
    "  return result.translate(positionM[0] * mm, positionM[2] * mm, positionM[1] * mm);",
    "}",
    "",
    "function modelBox(sizeM, positionM, rotationDeg) {",
    "  return placeModelShape(box(Math.max(sizeM[0] * mm, 1), Math.max(sizeM[1] * mm, 1), Math.max(sizeM[2] * mm, 1)), positionM, rotationDeg);",
    "}",
    "",
    "function modelCylinder(sizeM, positionM, rotationDeg) {",
    "  const radius = Math.max(sizeM[0] * mm, sizeM[1] * mm, 2) / 2;",
    "  return placeModelShape(cylinder(Math.max(sizeM[2] * mm, 1), radius), positionM, rotationDeg);",
    "}",
    "",
    "function modelSphere(sizeM, positionM, rotationDeg) {",
    "  const maxSize = Math.max(sizeM[0], sizeM[1], sizeM[2], 0.001);",
    "  const radius = Math.max(maxSize * mm / 2, 1);",
    "  return placeModelShape(sphere(radius).scale([sizeM[0] / maxSize, sizeM[1] / maxSize, sizeM[2] / maxSize]), positionM, rotationDeg);",
    "}",
    "",
    "const parts = [];"
  ];

  objects.forEach((object, index) => {
    const shape = String(object?.shape || "box").toLowerCase();
    const factory = shape === "cylinder" ? "modelCylinder" : shape === "sphere" ? "modelSphere" : "modelBox";
    const label = cadObjectLabel(object, index);
    const size = jsArray(object?.size, [1, 1, 1]);
    const position = jsArray(object?.position, [0, 0.5, 0]);
    const rotation = jsArray(object?.rotation, [0, 0, 0]);
    const color = JSON.stringify(cadObjectColor(object));
    lines.push("");
    lines.push(`// ${index + 1}. ${label}`);
    lines.push(`parts.push({ name: ${JSON.stringify(label)}, shape: ${factory}(${size}, ${position}, ${rotation}).color(${color}) });`);
  });

  lines.push("");
  lines.push("return {");
  lines.push("  parts,");
  lines.push("  source: { generator: 'laogui-ai', units: 'mm', coordinateSystem: 'Z-up' },");
  lines.push(`  title: ${JSON.stringify(title)}`);
  lines.push("};");
  return `${lines.join("\n")}\n`;
}

function pythonLiteral(value) {
  return JSON.stringify(value);
}

function whiteModelToBuild123dPython(model) {
  const title = String(model?.title || "AI 3D model");
  const label = slugify(title) || "ai_3d_model";
  const objects = Array.isArray(model?.objects) ? model.objects : [];
  const lines = [
    `# ${title}`,
    "# Generated by Laogui AI image modeling for earthtojake/text-to-cad.",
    "# Units: millimeters. Source coordinates are meters: [x, vertical-y, depth-z].",
    "",
    "import build123d as bd",
    "",
    "MM_PER_M = 1000.0",
    "",
    "def _vec(values, fallback):",
    "    raw = list(values or [])",
    "    out = []",
    "    for index, default in enumerate(fallback):",
    "        try:",
    "            out.append(float(raw[index]))",
    "        except Exception:",
    "            out.append(float(default))",
    "    return out",
    "",
    "def _location(position_m, rotation_deg):",
    "    x, y, z = _vec(position_m, [0, 0, 0])",
    "    rx, ry, rz = _vec(rotation_deg, [0, 0, 0])",
    "    return bd.Location((x * MM_PER_M, z * MM_PER_M, y * MM_PER_M), (rx, rz, ry))",
    "",
    "def _solid(shape, size_m):",
    "    w, d, h = [max(value * MM_PER_M, 1.0) for value in _vec(size_m, [1, 1, 1])]",
    "    if shape == 'cylinder':",
    "        return bd.Cylinder(max(w, d) / 2.0, h, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.CENTER))",
    "    if shape == 'sphere':",
    "        radius = max(w, d, h) / 2.0",
    "        return bd.Sphere(radius)",
    "    return bd.Box(w, d, h, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.CENTER))",
    "",
    "def _part(shape, size_m, position_m, rotation_deg, label):",
    "    solid = _solid(shape, size_m).moved(_location(position_m, rotation_deg))",
    "    solid.label = label",
    "    return solid",
    "",
    "def gen_step():",
    "    parts = []"
  ];

  objects.forEach((object, index) => {
    const shape = String(object?.shape || "box").toLowerCase();
    const safeShape = ["box", "cylinder", "sphere", "plane"].includes(shape) ? shape : "box";
    const labelText = cadObjectLabel(object, index);
    lines.push(
      `    parts.append(_part(${pythonLiteral(safeShape === "plane" ? "box" : safeShape)}, ${pythonLiteral(scadVector(object?.size, [1, 1, 1]))}, ${pythonLiteral(scadVector(object?.position, [0, 0.5, 0]))}, ${pythonLiteral(scadVector(object?.rotation, [0, 0, 0]))}, ${pythonLiteral(labelText)}))`
    );
  });

  lines.push("    if not parts:");
  lines.push("        return bd.Box(1, 1, 1)");
  lines.push(`    return bd.Compound(obj=parts, children=parts, label=${pythonLiteral(label)})`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function commandPreview(command, args = []) {
  return [command, ...args].map((part) => /\s/.test(String(part)) ? JSON.stringify(String(part)) : String(part)).join(" ");
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 60000));
    const child = trackChildProcess(spawn(command, args, {
      cwd: options.cwd || __dirname,
      env: { ...process.env, ...(options.env || {}) },
      shell: false
    }));
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: commandPreview(command, args),
        stdout: stdout.slice(-12000),
        stderr: stderr.slice(-12000),
        ...result
      });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, timedOut: true, code: null, error: `Command timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ ok: false, code: null, error: error.message || String(error) });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, code, error: code === 0 ? "" : `Command exited with code ${code}` });
    });
  });
}

function normalizeImageStudioFhlEnabled(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled", "disable"].includes(normalized)) return "disabled";
  if (["1", "true", "yes", "on", "enabled", "enable"].includes(normalized)) return "enabled";
  return "auto";
}

function normalizeImageStudioFhlProvider(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return ["auto", "fhl", "yybb"].includes(normalized) ? normalized : "auto";
}

function normalizeImageStudioEngineMode(value) {
  const normalized = String(value || "required").trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled", "disable"].includes(normalized)) return "disabled";
  if (["optional", "auto", "fallback"].includes(normalized)) return "optional";
  return "required";
}

function imageStudioRuntimePlatformId(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function imageStudioCliExecutableName(platform = process.platform) {
  return platform === "win32" ? "gptcodex-image.exe" : "gptcodex-image";
}

function bundledImageStudioCliCandidates() {
  const executable = imageStudioCliExecutableName();
  const platformId = imageStudioRuntimePlatformId();
  const resourcesPath = process.resourcesPath || "";
  return [
    path.join(__dirname, "engines", "image-studio", platformId, executable),
    path.join(__dirname, "engines", "image-studio", executable),
    path.join(__dirname, "bin", executable),
    resourcesPath ? path.join(resourcesPath, "engines", "image-studio", platformId, executable) : "",
    resourcesPath ? path.join(resourcesPath, "engines", "image-studio", executable) : "",
    resourcesPath ? path.join(resourcesPath, "bin", executable) : "",
    config.imageStudioEngine.cliPath
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
}

function resolveImageStudioCliPath() {
  return bundledImageStudioCliCandidates().find((candidate) => existsSync(candidate)) || path.resolve(bundledImageStudioCliCandidates()[0] || "");
}

function imageStudioEngineStatus() {
  const mode = normalizeImageStudioEngineMode(config.imageStudioEngine.mode);
  const cliPath = resolveImageStudioCliPath();
  const available = Boolean(cliPath && existsSync(cliPath));
  const desktop = imageStudioDesktopState();
  return {
    mode,
    enabled: mode !== "disabled" && (mode === "required" || available),
    required: mode === "required",
    available,
    cliPath,
    platform: imageStudioRuntimePlatformId(),
    outputDir: path.resolve(config.imageStudioEngine.outputDir),
    timeoutSeconds: config.imageStudioEngine.timeoutSeconds,
    responsesTransport: normalizeResponsesTransport(config.imageStudioEngine.responsesTransport || desktop.responsesTransport || "sse"),
    requestPolicy: normalizeImageStudioRequestPolicy(config.imageStudioEngine.requestPolicy || desktop.requestPolicy || "openai"),
    imagesNewApiCompat: parseBooleanEnv(config.imageStudioEngine.imagesNewApiCompat, true),
    reasoningEffort: normalizeImageStudioReasoningEffort(config.imageStudioEngine.reasoningEffort || desktop.reasoningEffort || "xhigh"),
    fastReasoningEffort: normalizeImageStudioReasoningEffort(config.imageStudioEngine.fastReasoningEffort || "low"),
    partialImages: clampNumber(Number(config.imageStudioEngine.partialImages ?? desktop.partialImages ?? 0), 0, 3),
    autoRetryCount: clampNumber(Number(config.imageStudioEngine.autoRetryCount ?? desktop.autoRetryCount ?? 1), 0, 8),
    allowNativeFallback: Boolean(config.imageStudioEngine.allowNativeFallback),
    desktop: publicImageStudioDesktopState(desktop)
  };
}

function normalizeResponsesTransport(value) {
  return String(value || "").trim().toLowerCase() === "websocket" ? "websocket" : "sse";
}

function normalizeImageStudioRequestPolicy(value) {
  return String(value || "").trim().toLowerCase() === "compat" ? "compat" : "openai";
}

function normalizeImageStudioReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["low", "medium", "high", "xhigh"].includes(normalized) ? normalized : "xhigh";
}

function imageStudioFhlSkillStatus() {
  const mode = normalizeImageStudioFhlEnabled(config.imageStudioFhlSkill.enabled);
  const script = path.resolve(config.imageStudioFhlSkill.script);
  const available = existsSync(script);
  const cliPath = resolveImageStudioCliPath();
  const desktop = imageStudioDesktopState();
  return {
    mode,
    enabled: mode === "enabled" || (mode === "auto" && available),
    available,
    script,
    cliPath,
    cliAvailable: existsSync(cliPath),
    provider: normalizeImageStudioFhlProvider(config.imageStudioFhlSkill.provider),
    outputDir: path.resolve(config.imageStudioFhlSkill.outputDir),
    timeoutSeconds: config.imageStudioFhlSkill.timeoutSeconds,
    desktop: publicImageStudioDesktopState(desktop)
  };
}

function publicImageStudioDesktopState(desktop = {}) {
  return {
    installed: Boolean(desktop.installed),
    statePath: desktop.statePath || "",
    profileCount: Number(desktop.profileCount || 0),
    lastReadAt: desktop.lastReadAt || ""
  };
}

function imageStudioDesktopState() {
  const statePath = imageStudioCompatStatePath;
  const base = {
    installed: existsSync(statePath),
    statePath,
    activeProfileId: "",
    activeProfileLabel: "",
    baseUrl: "",
    apiMode: "",
    responsesTransport: "",
    imageModel: "",
    textModel: "",
    requestPolicy: "",
    reasoningEffort: "",
    partialImages: null,
    autoRetryCount: null,
    profileCount: 0,
    lastReadAt: new Date().toISOString()
  };
  if (!base.installed) return base;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    const activeProfileId = String(parsed.activeProfileId || "");
    const activeProfile = profiles.find((profile) => profile?.id === activeProfileId)
      || profiles.find((profile) => profile?.baseURL === config.imageProvider.baseUrl)
      || profiles[0]
      || {};
    return {
      ...base,
      activeProfileId,
      activeProfileLabel: String(activeProfile.label || activeProfile.name || activeProfileId || ""),
      baseUrl: normalizeBaseUrl(activeProfile.baseURL || activeProfile.baseUrl || ""),
      apiMode: String(activeProfile.apiMode || ""),
      responsesTransport: String(activeProfile.responsesTransport || ""),
      imageModel: String(activeProfile.imageModelID || activeProfile.imageModel || ""),
      textModel: String(activeProfile.textModelID || activeProfile.textModel || ""),
      requestPolicy: String(activeProfile.requestPolicy || ""),
      reasoningEffort: String(activeProfile.reasoningEffort || ""),
      partialImages: settings.partialImages ?? null,
      autoRetryCount: settings.autoRetryCount ?? null,
      profileCount: profiles.length
    };
  } catch (error) {
    return {
      ...base,
      error: String(error.message || error)
    };
  }
}

function imageStudioFhlEndpointLabel(status = imageStudioFhlSkillStatus()) {
  return `image-studio-fhl:${status.provider}`;
}

function imageStudioEngineEndpointLabel(source) {
  return `image-studio-cli:${shortRuntimeEndpointLabel(source?.baseUrl || "")}`;
}

function imageStudioFhlResultLine(output, key) {
  const prefix = `${key}=`;
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || "";
}

function imageStudioFhlResultLines(output, key) {
  const prefix = `${key}=`;
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

function imageStudioFhlTaggedLines(output, tag) {
  const pattern = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[[^\\]]+\\]=(.*)$`);
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(pattern)?.[1]?.trim() || "")
    .filter(Boolean);
}

function imageStudioCliOutputLine(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*[:：]\\s*(.+)$`);
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(pattern)?.[1]?.trim() || "")
    .filter(Boolean)
    .at(-1) || "";
}

async function newestImageFile(outputDir) {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(outputDir, entry.name);
        return { filePath, stat: await fs.stat(filePath) };
      }));
    return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || "";
  } catch {
    return "";
  }
}

async function newestRawResponseFile(outputDir) {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && /(response|raw).*\.(json|txt)$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(outputDir, entry.name);
        return { filePath, stat: await fs.stat(filePath) };
      }));
    return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || "";
  } catch {
    return "";
  }
}

function imageStudioEffectiveModel(source = {}, requestedModel = "") {
  const model = String(requestedModel || source.model || config.imageModel || "gpt-image-2");
  if (isFhlBaseUrl(source.baseUrl) && normalizeImageApiMode(source.apiMode || config.imageApiMode) === "responses" && model === "gpt-image-2") {
    return "gpt-image-2-codex";
  }
  return model;
}

function imageStudioCliSize(size) {
  const text = String(size || "").trim();
  if (!text || text === "auto") return closestStandardImageSize(text);
  return closestStandardImageSize(text);
}

function imageStudioCliDiagnostics(output, rawPath = "") {
  const text = String(output || "");
  const lower = text.toLowerCase();
  const diagnoses = imageStudioFhlTaggedLines(text, "DIAGNOSIS");
  if (/invalid_api_key|401/.test(lower)) diagnoses.push("Provider rejected the API key; update the saved Image Studio engine key.");
  if (/524/.test(lower)) diagnoses.push("Cloudflare 524 timeout; retry or reduce reference image size.");
  if (/sync_wait_expired|running|queued/.test(lower)) diagnoses.push("Image task was still running or queued when the sync wait expired; retry is usually safe.");
  return {
    rawResponses: [...new Set([rawPath, ...imageStudioFhlTaggedLines(text, "RAW_RESPONSE")].filter(Boolean))],
    diagnoses: [...new Set(diagnoses)]
  };
}

async function writeImageStudioFhlReferences(inputImages = [], outputDir) {
  const files = [];
  const validImages = inputImages.filter((image) => image?.dataUrl);
  for (let index = 0; index < validImages.length; index += 1) {
    const image = validImages[index];
    const blob = imageDataUrlToBlob(image.dataUrl);
    const ext = imageExtensionFromMime(blob.type || image.type || "image/png");
    const filePath = path.join(outputDir, `reference-${index + 1}.${ext}`);
    await fs.writeFile(filePath, Buffer.from(await blob.arrayBuffer()));
    files.push(filePath);
  }
  return files;
}

async function runImageStudioEngine({ prompt, inputImages = [], size = "auto", quality = "medium", sourceOverride = null, imageModelOverride = "", textModelOverride = "", fastMode = false } = {}) {
  const status = imageStudioEngineStatus();
  if (!status.enabled || !status.available) {
    const error = new Error(status.available
      ? "Image Studio engine is disabled"
      : `Image Studio CLI not found: ${status.cliPath}`);
    error.status = 503;
    error.details = { status };
    throw error;
  }

  const source = sourceOverride || activeImageProviderSource();
  if (!source?.apiKey || !source?.baseUrl) {
    const error = new Error("Image Studio engine requires a configured image Base URL and API Key.");
    error.status = 503;
    error.details = { source: source?.baseUrl || "" };
    throw error;
  }

  const outputDir = path.join(status.outputDir, `${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(outputDir, { recursive: true });
  const references = await writeImageStudioFhlReferences(inputImages, outputDir);
  const apiMode = normalizeImageApiMode(source.apiMode || config.imageApiMode);
  const responsesTransport = normalizeResponsesTransport(source.responsesTransport || status.responsesTransport);
  const requestPolicy = normalizeImageStudioRequestPolicy(source.requestPolicy || status.requestPolicy);
  const imagesNewApiCompat = parseBooleanEnv(source.imagesNewApiCompat, status.imagesNewApiCompat);
  const reasoningEffort = normalizeImageStudioReasoningEffort(fastMode
    ? status.fastReasoningEffort
    : source.reasoningEffort || status.reasoningEffort);
  const args = [
    "--base-url", source.baseUrl,
    "--api-key", source.apiKey,
    "--api-mode", apiMode === "images" ? "images" : "responses",
    "--responses-transport", responsesTransport,
    "--mode", references.length ? "edit" : "generate",
    "--size", imageStudioCliSize(size),
    "--quality", normalizeImageToolQuality(quality),
    "--output-format", "png",
    "--image-model", imageStudioEffectiveModel(source, imageModelOverride),
    "--text-model", textModelOverride || config.reasoningModel || "gpt-5.5",
    "--request-policy", requestPolicy,
    "--reasoning-effort", reasoningEffort,
    "--partial-images", String(status.partialImages),
    "--auto-retry-count", String(status.autoRetryCount),
    "--prompt", String(prompt || ""),
    "--out-dir", outputDir,
    "--disable-preview"
  ];
  if (apiMode === "images" && imagesNewApiCompat) args.push("--images-new-api-compat");
  for (const filePath of references) args.push("--reference-image", filePath);

  const result = await runCommand(status.cliPath, args, {
    cwd: outputDir,
    timeoutMs: (status.timeoutSeconds + 30) * 1000
  });
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const parsedImagePath = imageStudioCliOutputLine(combinedOutput, "图片已保存")
    || imageStudioFhlResultLine(combinedOutput, "RESULT_IMAGE");
  const rawPath = imageStudioCliOutputLine(combinedOutput, "原始返回已保存")
    || imageStudioFhlTaggedLines(combinedOutput, "RAW_RESPONSE").at(-1)
    || await newestRawResponseFile(outputDir);
  const resultImage = parsedImagePath || await newestImageFile(outputDir);
  const diagnostics = imageStudioCliDiagnostics(combinedOutput, rawPath);

  if (!result.ok || !resultImage) {
    const error = new Error([
      "Image Studio engine failed",
      result.error || "",
      combinedOutput.slice(-2000)
    ].filter(Boolean).join(": "));
    error.status = result.timedOut ? 504 : 502;
    error.details = {
      command: redactImageStudioCommand(result.command),
      outputDir,
      endpoint: source.baseUrl,
      diagnostics,
      stdout: result.stdout,
      stderr: result.stderr
    };
    throw error;
  }

  const imagePath = path.resolve(resultImage);
  if (!existsSync(imagePath)) {
    const error = new Error(`Image Studio engine reported a missing image: ${imagePath}`);
    error.status = 502;
    error.details = { outputDir, endpoint: source.baseUrl, diagnostics };
    throw error;
  }

  return {
    buffer: await fs.readFile(imagePath),
    thinking: `Image Studio CLI engine completed through ${shortRuntimeEndpointLabel(source.baseUrl)}.`,
    imageApi: "image-studio-cli",
    endpoint: imageStudioEngineEndpointLabel(source),
    actualParams: {
      size: imageStudioCliSize(size),
      quality: normalizeImageToolQuality(quality),
      output_format: "png",
      api_mode: apiMode === "images" ? "images" : "responses",
      responses_transport: responsesTransport,
      request_policy: requestPolicy,
      images_new_api_compat: apiMode === "images" && imagesNewApiCompat,
      reasoning_effort: reasoningEffort,
      fast_mode: Boolean(fastMode)
    },
    diagnostics: {
      ...diagnostics,
      desktopProfile: status.desktop,
      cliPath: status.cliPath
    },
    skill: {
      name: "image-studio-cli",
      provider: imageProviderKind(source.baseUrl),
      cliPath: status.cliPath,
      outputDir,
      resultImage: imagePath,
      rawResponse: rawPath || ""
    }
  };
}

function redactImageStudioCommand(command = "") {
  return String(command || "").replace(/(--api-key\s+)(?:"[^"]+"|\S+)/g, "$1<redacted>");
}

async function runImageStudioFhlSkill({ prompt, inputImages = [], size = "auto", quality = "medium" } = {}) {
  const status = imageStudioFhlSkillStatus();
  if (!status.enabled) {
    const error = new Error(status.available
      ? "Image Studio FHL skill is disabled"
      : `Image Studio FHL skill script not found: ${status.script}`);
    error.status = 503;
    throw error;
  }

  const outputDir = path.join(status.outputDir, `${Date.now()}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(outputDir, { recursive: true });
  const references = await writeImageStudioFhlReferences(inputImages, outputDir);
  const args = [
    status.script,
    "--provider",
    status.provider,
    "--prompt",
    String(prompt || ""),
    "--output-dir",
    outputDir,
    "--size",
    String(size || "auto"),
    "--quality",
    normalizeImageToolQuality(quality),
    "--output-format",
    "png",
    "--provider-timeout-seconds",
    String(status.timeoutSeconds)
  ];
  for (const filePath of references) args.push("--reference-image", filePath);

  const result = await runCommand("python3", args, {
    cwd: outputDir,
    timeoutMs: (status.timeoutSeconds + 30) * 1000
  });
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const resultImage = imageStudioFhlResultLine(combinedOutput, "RESULT_IMAGE");
  const resultProvider = imageStudioFhlResultLine(combinedOutput, "RESULT_PROVIDER") || status.provider;
  const rawResponses = imageStudioFhlTaggedLines(combinedOutput, "RAW_RESPONSE");
  const diagnoses = imageStudioFhlTaggedLines(combinedOutput, "DIAGNOSIS");

  if (!result.ok || !resultImage) {
    const error = new Error([
      "Image Studio FHL skill failed",
      result.error || "",
      combinedOutput.slice(-2000)
    ].filter(Boolean).join(": "));
    error.status = result.timedOut ? 504 : 502;
    error.details = {
      command: result.command,
      outputDir,
      provider: status.provider,
      rawResponses,
      diagnoses: [...new Set(diagnoses)],
      desktopProfile: status.desktop,
      stdout: result.stdout,
      stderr: result.stderr
    };
    throw error;
  }

  const imagePath = path.resolve(resultImage);
  if (!existsSync(imagePath)) {
    const error = new Error(`Image Studio FHL skill reported a missing image: ${imagePath}`);
    error.status = 502;
    error.details = { outputDir, provider: resultProvider };
    throw error;
  }

  return {
    buffer: await fs.readFile(imagePath),
    thinking: `Image Studio FHL skill completed through provider ${resultProvider}.`,
    imageApi: "image-studio-fhl",
    endpoint: imageStudioFhlEndpointLabel({ provider: resultProvider }),
    actualParams: {
      size: String(size || "auto"),
      quality: normalizeImageToolQuality(quality),
      output_format: "png"
    },
    diagnostics: {
      rawResponses,
      diagnoses: [...new Set(diagnoses)],
      desktopProfile: status.desktop,
      cliPath: status.cliPath
    },
    skill: {
      name: "image-studio-fhl",
      provider: resultProvider,
      script: status.script,
      outputDir,
      resultImage: imagePath
    }
  };
}

function launchDetachedCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd || __dirname,
      env: { ...process.env, ...(options.env || {}) },
      detached: true,
      stdio: "ignore",
      shell: false
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: commandPreview(command, args),
        pid: child.pid || null,
        ...result
      });
    };
    const timer = setTimeout(() => {
      child.unref();
      finish({ ok: true });
    }, Math.max(300, Number(options.settleMs || 1200)));
    child.on("error", (error) => {
      finish({ ok: false, error: error.message || String(error) });
    });
    child.on("exit", (code) => {
      if (code === 0) finish({ ok: true, code });
      else finish({ ok: false, code, error: `Command exited with code ${code}` });
    });
  });
}

async function createForgeCadIntegration(body = {}) {
  const model = assertWhiteModelForCadIntegration(body);
  const action = String(body.action || "script").toLowerCase();
  const workspace = await createCadIntegrationWorkspace(model, "forgecad");
  const source = whiteModelToForgeCadScript(model);
  const scriptPath = path.join(workspace.dir, `${workspace.fileBase}.forge.js`);
  const readmePath = path.join(workspace.dir, "README.md");
  await fs.writeFile(scriptPath, source, "utf8");
  await fs.writeFile(readmePath, [
    `# ${model.title || "ForgeCAD model"}`,
    "",
    "Generated from 老鬼AI 图片建模.",
    "",
    "```bash",
    "forgecad studio .",
    `forgecad run ${path.basename(scriptPath)}`,
    "```",
    ""
  ].join("\n"), "utf8");

  const forgecadBin = process.env.FORGECAD_BIN || "forgecad";
  const result = {
    action,
    configured: Boolean(forgecadBin),
    projectDir: workspace.dir,
    projectUrl: generatedFileUrl(readmePath),
    script: {
      fileName: path.basename(scriptPath),
      path: scriptPath,
      url: generatedFileUrl(scriptPath),
      source
    },
    setup: {
      install: "npm install -g forgecad",
      env: "FORGECAD_BIN=/absolute/path/to/forgecad"
    }
  };

  if (action === "studio" || action === "open") {
    const launch = await launchDetachedCommand(forgecadBin, ["studio", workspace.dir], { cwd: workspace.dir });
    return {
      ...result,
      launched: launch.ok,
      command: launch.command,
      error: launch.ok ? "" : launch.error,
      message: launch.ok
        ? "ForgeCAD Studio 已尝试打开。"
        : "ForgeCAD CLI 未启动；脚本已生成，可安装 ForgeCAD 后打开。"
    };
  }

  if (action === "validate" || action === "run") {
    const validation = await runCommand(forgecadBin, ["run", scriptPath], { cwd: workspace.dir, timeoutMs: 60000 });
    return {
      ...result,
      validated: validation.ok,
      validation,
      message: validation.ok ? "ForgeCAD 脚本校验通过。" : "ForgeCAD 脚本已生成，但 CLI 校验未通过或未安装。"
    };
  }

  return {
    ...result,
    message: "ForgeCAD 脚本已生成。"
  };
}

function resolveCadSkillDir() {
  const direct = process.env.TEXT_TO_CAD_CAD_SKILL_DIR || process.env.CAD_SKILL_DIR;
  if (direct) return path.resolve(direct);
  const repoDir = process.env.TEXT_TO_CAD_DIR || process.env.TEXT_TO_CAD_REPO;
  if (repoDir) return path.join(path.resolve(repoDir), "skills", "cad");
  return "";
}

async function fileRecordIfExists(filePath, source = "") {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const record = {
      fileName: path.basename(filePath),
      path: filePath,
      url: generatedFileUrl(filePath),
      bytes: stat.size
    };
    if (source) record.source = source;
    return record;
  } catch {
    return null;
  }
}

async function createTextToCadExport(body = {}) {
  const model = assertWhiteModelForCadIntegration(body);
  const formats = new Set(asStringArray(body.formats || ["step", "stl", "glb"]).map((item) => item.toLowerCase()));
  const workspace = await createCadIntegrationWorkspace(model, "text-to-cad");
  const source = whiteModelToBuild123dPython(model);
  const pythonPath = path.join(workspace.dir, `${workspace.fileBase}.py`);
  const stepPath = path.join(workspace.dir, `${workspace.fileBase}.step`);
  const stlName = `${workspace.fileBase}.stl`;
  const glbName = `${workspace.fileBase}.glb`;
  const threeMfName = `${workspace.fileBase}.3mf`;
  await fs.writeFile(pythonPath, source, "utf8");

  const cadSkillDir = resolveCadSkillDir();
  const pythonBin = process.env.TEXT_TO_CAD_PYTHON || process.env.PYTHON_BIN || "python3";
  const scriptPath = cadSkillDir ? path.join(cadSkillDir, "scripts", "step", "cli.py") : "";
  const files = {
    python: await fileRecordIfExists(pythonPath, source)
  };
  const setup = {
    env: [
      "TEXT_TO_CAD_DIR=/absolute/path/to/text-to-cad",
      "TEXT_TO_CAD_PYTHON=/absolute/path/to/python"
    ],
    install: [
      "git clone https://github.com/earthtojake/text-to-cad.git",
      "cd text-to-cad/skills/cad",
      "python -m pip install -r requirements.txt"
    ]
  };

  if (!scriptPath || !existsSync(scriptPath)) {
    return {
      configured: false,
      projectDir: workspace.dir,
      files,
      setup,
      command: scriptPath ? commandPreview(pythonBin, [scriptPath, pythonPath, "-o", stepPath]) : "",
      message: "text-to-cad 引擎尚未配置；已生成 build123d Python 源码，可配置 TEXT_TO_CAD_DIR 后自动导出 STEP。"
    };
  }

  const args = [scriptPath, pythonPath, "-o", stepPath];
  if (formats.has("stl")) args.push("--stl", stlName);
  if (formats.has("glb")) args.push("--glb", glbName);
  if (formats.has("3mf") || formats.has("threemf")) args.push("--3mf", threeMfName);

  const command = await runCommand(pythonBin, args, { cwd: workspace.dir, timeoutMs: 180000 });
  files.step = await fileRecordIfExists(stepPath);
  files.stl = await fileRecordIfExists(path.join(workspace.dir, stlName));
  files.glb = await fileRecordIfExists(path.join(workspace.dir, glbName));
  files.threeMf = await fileRecordIfExists(path.join(workspace.dir, threeMfName));
  Object.keys(files).forEach((key) => {
    if (!files[key]) delete files[key];
  });

  return {
    configured: true,
    projectDir: workspace.dir,
    files,
    command,
    setup,
    message: command.ok && files.step
      ? "text-to-cad 已导出 STEP，并按需生成 STL/GLB sidecar。"
      : "text-to-cad 已调用，但未得到完整 STEP 输出；请查看命令日志。"
  };
}

function normalizeModelingSourceType(value = "") {
  const text = String(value || "").toLowerCase();
  const hasPlan = /(floor.?plan|plan|cad|drawing|blueprint|图纸|平面|施工图)/i.test(text);
  const hasExteriorArchitecture = /(architecture|building|facade|façade|front elevation|villa|house|exterior|建筑外观|外观|外立面|立面|楼体|房屋|别墅|住宅外观)/i.test(text);
  const hasInterior = /(interior|room|lobby|office|retail|hotel|restaurant|cafe|workspace|living room|bedroom|kitchen|dining|space|indoor|室内|空间|房间|大堂|办公室|办公|展厅|门店|客厅|卧室|厨房|餐厅|咖啡|商铺|商业空间)/i.test(text);
  if (hasPlan && !hasExteriorArchitecture) return "floor-plan-reference";
  if (hasInterior && !hasExteriorArchitecture) return "interior-photo";
  if (hasExteriorArchitecture) return "architecture-photo";
  if (hasInterior) return "interior-photo";
  if (hasPlan) return "floor-plan-reference";
  if (/(product|object|furniture|chair|table|lamp|apple|主体|产品|物体|家具|椅|桌|灯|苹果)/i.test(text)) return "object-photo";
  return "object-photo";
}

function normalizeModelingLayer(layer = {}, index = 0, body = {}) {
  const bounds = normalizeCutoutBounds(layer.bounds || layer.bounding_box || layer.box || {}, body.imageWidth || body.primaryImage?.width || 0, body.imageHeight || body.primaryImage?.height || 0);
  return {
    id: slugify(layer.id || layer.label || `layer-${index + 1}`) || `layer-${index + 1}`,
    label: String(layer.label || layer.name || `图层 ${index + 1}`).slice(0, 80),
    role: String(layer.role || layer.type || layer.category || "subject").slice(0, 60),
    includeInModel: layer.includeInModel !== false && layer.include !== false,
    priority: clampNumber(Number(layer.priority ?? index + 1) || index + 1, 1, 20),
    bounds: bounds || { x: 0, y: 0, width: 1, height: 1 },
    depthOrder: clampNumber(Number(layer.depthOrder ?? layer.depth_order ?? index + 1) || index + 1, 1, 50),
    primitiveHint: String(layer.primitiveHint || layer.primitive || layer.shape || "").slice(0, 80),
    geometryHints: asStringArray(layer.geometryHints || layer.geometry_hints || layer.hints).slice(0, 8),
    material: String(layer.material || "").slice(0, 100),
    scaleRole: String(layer.scaleRole || layer.scale_role || "").slice(0, 100),
    notes: String(layer.notes || layer.note || "").slice(0, 220)
  };
}

function normalizeModelingPoint(point) {
  const rawX = Array.isArray(point) ? point[0] : point?.x;
  const rawY = Array.isArray(point) ? point[1] : point?.y;
  const x = clampNumber(Number(rawX), 0, 1);
  const y = clampNumber(Number(rawY), 0, 1);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function ellipseShapeFromBounds(bounds = {}) {
  return {
    type: "ellipse",
    centerX: clampNumber(Number(bounds.x || 0) + Number(bounds.width || 1) / 2, 0, 1),
    centerY: clampNumber(Number(bounds.y || 0) + Number(bounds.height || 1) / 2, 0, 1),
    radiusX: clampNumber(Number(bounds.width || 1) / 2, 0.001, 1),
    radiusY: clampNumber(Number(bounds.height || 1) / 2, 0.001, 1)
  };
}

function normalizeModelingTargetShape(source = {}, targetBounds = {}, sourceType = "object-photo") {
  const rawShape = source.targetShape || source.target_shape || source.shape || source.silhouette || source.mask || {};
  const rawType = String(rawShape.type || rawShape.shapeType || rawShape.kind || "").toLowerCase();
  const rawPoints = rawShape.points || rawShape.polygon || source.targetPolygon || source.target_polygon || source.polygon;
  const points = Array.isArray(rawPoints)
    ? rawPoints.map(normalizeModelingPoint).filter(Boolean).slice(0, 48)
    : [];
  if (points.length >= 3) {
    return { type: "polygon", points };
  }
  if (rawType === "ellipse" || rawType === "oval" || rawType === "circle") {
    const centerX = clampNumber(Number(rawShape.centerX ?? rawShape.cx ?? rawShape.center?.x ?? targetBounds.x + targetBounds.width / 2), 0, 1);
    const centerY = clampNumber(Number(rawShape.centerY ?? rawShape.cy ?? rawShape.center?.y ?? targetBounds.y + targetBounds.height / 2), 0, 1);
    const radiusX = clampNumber(Number(rawShape.radiusX ?? rawShape.rx ?? rawShape.radius ?? targetBounds.width / 2), 0.001, 1);
    const radiusY = clampNumber(Number(rawShape.radiusY ?? rawShape.ry ?? rawShape.radius ?? targetBounds.height / 2), 0.001, 1);
    return { type: "ellipse", centerX, centerY, radiusX, radiusY };
  }
  if (sourceType === "object-photo") return ellipseShapeFromBounds(targetBounds);
  return {
    type: "box",
    bounds: targetBounds
  };
}

function modelingLayerSearchText(layer = {}) {
  return [
    layer.id,
    layer.label,
    layer.role,
    layer.primitiveHint,
    layer.material,
    layer.scaleRole,
    layer.notes,
    ...(Array.isArray(layer.geometryHints) ? layer.geometryHints : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function userExplicitlyWantsDisplaySupport(body = {}) {
  const text = [
    body.intent,
    body.userPrompt,
    body.prompt,
    body.brief?.projectName,
    body.brief?.projectType,
    body.brief?.style,
    body.brief?.audience
  ].filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return false;
  if (/(不要|不需要|排除|忽略|只要|仅|only|exclude|without|no)\s*(底座|托盘|圆盘|承托|plate|tray|base|plinth|platform|stand)/i.test(text)) {
    return false;
  }
  return /(底座|托盘|圆盘|承托|展示台|台座|plate|tray|plinth|platform|stand|pedestal|turntable|display base)/i.test(text);
}

function isDisplayPropModelingLayer(layer = {}) {
  const text = modelingLayerSearchText(layer);
  if (/(背景|阴影|高光|反光|纹理|background|shadow|highlight|specular|texture)/i.test(text)) return true;
  return /(摄影|拍摄|展示|承托|托盘|圆盘|盘子|台面|桌面|黑色圆形底座|圆形底座|底座前缘|底座厚度|display|photo prop|plate|tray|plinth|turntable|tabletop|table surface|pedestal|display base|circular base)/i.test(text);
}

function isPrimaryObjectModelingLayer(layer = {}) {
  const text = modelingLayerSearchText(layer);
  if (isDisplayPropModelingLayer(layer)) return false;
  return /(主体|主物体|主对象|产品主体|苹果|果实|fruit|apple|main subject|main body|product body|object body|foreground object)/i.test(text);
}

function shouldPreferPrimaryObjectBounds(targetBounds = {}, primaryBounds = {}) {
  const targetArea = Number(targetBounds.width || 0) * Number(targetBounds.height || 0);
  const primaryArea = Number(primaryBounds.width || 0) * Number(primaryBounds.height || 0);
  if (!targetArea || !primaryArea) return false;
  if (targetArea > primaryArea * 1.35) return true;
  if (Number(targetBounds.width || 0) > Number(primaryBounds.width || 0) * 1.25) return true;
  if ((Number(targetBounds.y || 0) + Number(targetBounds.height || 0)) > (Number(primaryBounds.y || 0) + Number(primaryBounds.height || 0) + 0.08)) return true;
  return false;
}

function modelingShapeBounds(shape = {}) {
  if (shape.type === "ellipse") {
    const x = clampNumber(Number(shape.centerX || 0.5) - Number(shape.radiusX || 0.5), 0, 1);
    const y = clampNumber(Number(shape.centerY || 0.5) - Number(shape.radiusY || 0.5), 0, 1);
    const x2 = clampNumber(Number(shape.centerX || 0.5) + Number(shape.radiusX || 0.5), 0, 1);
    const y2 = clampNumber(Number(shape.centerY || 0.5) + Number(shape.radiusY || 0.5), 0, 1);
    return { x, y, width: x2 - x, height: y2 - y };
  }
  if (shape.type === "polygon" && Array.isArray(shape.points) && shape.points.length) {
    const xs = shape.points.map((point) => Number(point[0])).filter(Number.isFinite);
    const ys = shape.points.map((point) => Number(point[1])).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return shape.bounds || null;
}

function shapeIsLooserThanBounds(shape = {}, bounds = {}) {
  const shapeBounds = modelingShapeBounds(shape);
  if (!shapeBounds) return false;
  return shouldPreferPrimaryObjectBounds(shapeBounds, bounds);
}

function modelingAnalysisLooksLikeObjectPhoto(source = {}, layers = [], body = {}) {
  const text = imageModelingSubjectText(source, layers, body.primaryImage?.name, body.inputAnalysis);
  if (/(floor.?plan|cad|drawing|图纸|平面)/i.test(String(source.sourceType || source.source_type || "")) && !/(苹果|apple|product|object|产品|物体|主体|果实|家具|椅|桌|灯)/i.test(text)) {
    return false;
  }
  if (/(苹果|apple|fruit|果实|product body|object body|产品主体|主物体|主对象|foreground object|前景主体)/i.test(text)) return true;
  return layers.some((layer) => {
    const layerText = modelingLayerSearchText(layer);
    return /(product|object|产品|物体|主体|attached detail|附属|果梗|柄)/i.test(layerText);
  });
}

function modelingAnalysisLooksLikeArchitecturePhoto(source = {}, layers = [], body = {}) {
  const text = imageModelingSubjectText(source, layers, body.primaryImage?.name, body.inputAnalysis, body.intent, body.userPrompt);
  if (/(floor.?plan|cad|drawing|blueprint|图纸|平面|施工图)/i.test(String(source.sourceType || source.source_type || "")) && !/(exterior|facade|façade|building|house|villa|外观|外立面|立面|建筑|楼体|房屋|住宅|别墅)/i.test(text)) {
    return false;
  }
  if (/(interior|室内|房间|空间|客厅|卧室|厨房|餐厅|大堂|办公室|办公|展厅|门店)/i.test(text) && !/(exterior|facade|façade|front elevation|building exterior|外观|外立面|立面|建筑外观)/i.test(text)) {
    return false;
  }
  if (/(exterior|facade|façade|front elevation|building envelope|building mass|building exterior|house exterior|villa exterior|外观|外立面|立面|建筑外观|建筑主体|楼体|主楼体|房屋外观|住宅外观|别墅外观)/i.test(text)) return true;
  return layers.some((layer) => {
    const layerText = modelingLayerSearchText(layer);
    return /(facade|façade|exterior|building|roof|window|door|立面|外墙|建筑|楼体|屋顶|屋面|窗|门|入口)/i.test(layerText);
  });
}

function modelingAnalysisLooksLikeInteriorPhoto(source = {}, layers = [], body = {}) {
  const text = imageModelingSubjectText(source, layers, body.primaryImage?.name, body.inputAnalysis, body.intent, body.userPrompt);
  if (/(exterior|facade|façade|front elevation|building exterior|house exterior|villa exterior|外观|外立面|立面|建筑外观|楼体外观|住宅外观|别墅外观)/i.test(text)) return false;
  if (/(interior|indoor|room|lobby|office|workspace|retail interior|store interior|restaurant|cafe|living room|bedroom|kitchen|dining|corridor|室内|空间|房间|大堂|办公室|办公|展厅|门店|客厅|卧室|厨房|餐厅|走廊|商铺|商业空间)/i.test(text)) return true;
  const interiorLayerCount = layers.filter((layer) => /(floor|wall|ceiling|counter|cabinet|shelf|seat|sofa|chair|table|fixture|light|地面|墙|墙面|天花|吊顶|柜|台|沙发|座椅|椅|桌|灯|陈列|收纳)/i.test(modelingLayerSearchText(layer))).length;
  return interiorLayerCount >= 3;
}

function normalizeImageModelingCompleteness(value = {}) {
  const source = value.completeness || value.completenessAssessment || value.subjectCompleteness || value.subject_completeness || {};
  const rawScore = Number(source.score ?? source.completeness ?? source.confidence ?? NaN);
  const hasExplicitScore = Number.isFinite(rawScore) || Number.isFinite(Number(source.percent));
  const score = Number.isFinite(rawScore)
    ? clampNumber(rawScore > 1 ? rawScore / 100 : rawScore, 0, 1)
    : Number.isFinite(Number(source.percent))
      ? clampNumber(Number(source.percent) / 100, 0, 1)
      : 0;
  const inferredComplete = typeof source.isComplete === "boolean"
    ? source.isComplete
    : typeof source.complete === "boolean"
      ? source.complete
      : typeof source.is_complete === "boolean"
        ? source.is_complete
        : typeof source.completeSubject === "boolean"
          ? source.completeSubject
          : typeof source.complete_subject === "boolean"
            ? source.complete_subject
            : score > 0 ? score >= 0.72 : /完整/.test(String(source.label || source.status || "")) && !/不完整|未完整|缺失/.test(String(source.label || source.status || ""));
  const missingParts = asStringArray(source.missingParts || source.missing_parts || source.missing || source.missingRegions || source.missing_regions).slice(0, 8);
  const edgeContact = asStringArray(source.edgeContact || source.edge_contact || source.touchesEdges || source.touches_edges || source.edgeHits || source.edge_hits).slice(0, 8);
  const label = String(source.label || source.status || (inferredComplete ? "完整" : "不完整")).slice(0, 80);
  return {
    isComplete: inferredComplete,
    score: hasExplicitScore ? score : (inferredComplete ? 0.86 : 0.58),
    label,
    missingParts,
    edgeContact,
    recommendation: String(source.recommendation || source.suggestion || source.nextStep || source.next_step || (inferredComplete ? "直接生成白底主体图" : "建议扩图补全后再生成白底主体图")).slice(0, 240),
    reason: String(source.reason || source.explanation || source.note || "").slice(0, 300)
  };
}

function normalizeImageModelingAnalysis(value = {}, body = {}) {
  const source = value.modelingAnalysis || value.analysis || value;
  const layers = Array.isArray(source.layers)
    ? source.layers
    : Array.isArray(source.subjectLayers)
      ? source.subjectLayers
      : Array.isArray(source.subject_layers)
        ? source.subject_layers
        : [];
  let sourceType = normalizeModelingSourceType([
    source.sourceType,
    source.source_type,
    source.modelingMode,
    source.modeling_mode,
    source.subjectType,
    source.subject_type,
    source.subject,
    body.primaryImage?.inputAnalysis?.label,
    body.inputAnalysis?.label,
    body.inputAnalysis?.title,
    body.inputAnalysis?.summary,
    body.inputAnalysis?.project_type,
    body.inputAnalysis?.project_type_visual,
    body.primaryImage?.sourceType,
    body.brief?.spaceType,
    body.brief?.projectType,
    body.brief?.functions,
    body.intent,
    body.userPrompt
  ].filter(Boolean).join(" "));
  const completeness = normalizeImageModelingCompleteness(source);
  const includeDisplaySupport = userExplicitlyWantsDisplaySupport(body);
  const normalizedLayers = layers
    .slice(0, 16)
    .map((layer, index) => normalizeModelingLayer(layer, index, body))
    .map((layer) => {
      if (sourceType !== "object-photo" || includeDisplaySupport || !isDisplayPropModelingLayer(layer)) return layer;
      return {
        ...layer,
        includeInModel: false,
        role: layer.role === "subject" ? "excluded-display-prop" : layer.role,
        notes: [layer.notes, "对象照片默认排除摄影道具/承托底座；如需建模底座，请在需求中明确说明。"].filter(Boolean).join(" ")
      };
    })
    .sort((a, b) => a.priority - b.priority);
  if (sourceType === "floor-plan-reference" && modelingAnalysisLooksLikeObjectPhoto(source, normalizedLayers, body)) {
    sourceType = "object-photo";
  }
  if (sourceType === "floor-plan-reference" && modelingAnalysisLooksLikeArchitecturePhoto(source, normalizedLayers, body)) {
    sourceType = "architecture-photo";
  }
  if (modelingAnalysisLooksLikeInteriorPhoto(source, normalizedLayers, body)) {
    sourceType = "interior-photo";
  }
  let targetBounds = normalizeCutoutBounds(
    source.targetBounds || source.target_bounds || source.bounds || source.bounding_box || {},
    body.imageWidth || body.primaryImage?.width || 0,
    body.imageHeight || body.primaryImage?.height || 0
  ) || normalizedLayers.find((layer) => layer.includeInModel)?.bounds || { x: 0, y: 0, width: 1, height: 1 };

  const primaryObjectLayer = sourceType === "object-photo" && !includeDisplaySupport
    ? normalizedLayers.find((layer) => layer.includeInModel && isPrimaryObjectModelingLayer(layer))
      || normalizedLayers.find((layer) => layer.includeInModel && !isDisplayPropModelingLayer(layer))
    : null;
  const preferredPrimaryBounds = Boolean(primaryObjectLayer && shouldPreferPrimaryObjectBounds(targetBounds, primaryObjectLayer.bounds));
  if (preferredPrimaryBounds) {
    targetBounds = primaryObjectLayer.bounds;
  }
  let targetShape = normalizeModelingTargetShape(source, targetBounds, sourceType);
  if (preferredPrimaryBounds && shapeIsLooserThanBounds(targetShape, targetBounds)) {
    targetShape = ellipseShapeFromBounds(targetBounds);
  }
  const excludedRegions = [
    ...asStringArray(source.excludedRegions || source.excluded_regions || source.ignore),
    ...normalizedLayers
      .filter((layer) => !layer.includeInModel && isDisplayPropModelingLayer(layer))
      .map((layer) => layer.label)
  ];
  const subject = sourceType === "object-photo" && primaryObjectLayer && /苹果|apple|fruit/i.test(modelingLayerSearchText(primaryObjectLayer))
    ? "红苹果"
    : String(source.subject || source.mainSubject || source.main_subject || "主体").slice(0, 100);

  return {
    subject,
    sourceType,
    summary: String(source.summary || source.selectionReason || source.selection_reason || completeness.reason || "").slice(0, 700),
    confidence: clampNumber(Number(source.confidence ?? 0.72) || 0.72, 0.05, 0.98),
    targetBounds,
    targetShape,
    completeness,
    layers: normalizedLayers,
    excludedRegions: [...new Set(excludedRegions.filter(Boolean))].slice(0, 10),
    depthRelations: asStringArray(source.depthRelations || source.depth_relations).slice(0, 10),
    scaleStrategy: String(source.scaleStrategy || source.scale_strategy || "").slice(0, 360),
    modelingScope: String(source.modelingScope || source.modeling_scope || "").slice(0, 360),
    primitiveStrategy: String(source.primitiveStrategy || source.primitive_strategy || "").slice(0, 360),
    visualProfile: {
      silhouette: String(source.visualProfile?.silhouette || source.visual_profile?.silhouette || "").slice(0, 220),
      viewAngle: String(source.visualProfile?.viewAngle || source.visual_profile?.view_angle || source.visual_profile?.viewAngle || "").slice(0, 120),
      characteristicFeatures: asStringArray(source.visualProfile?.characteristicFeatures || source.visual_profile?.characteristic_features).slice(0, 10),
      materialZones: asStringArray(source.visualProfile?.materialZones || source.visual_profile?.material_zones).slice(0, 8),
      nonGeometry: asStringArray(source.visualProfile?.nonGeometry || source.visual_profile?.non_geometry).slice(0, 8)
    },
    cadReferenceImage: source.cadReferenceImage || source.cad_reference_image || source.modelingCadPrepass?.image || source.modeling_cad_prepass?.image || null,
    cadReferenceParameters: source.cadReferenceParameters || source.cad_reference_parameters || null,
    source: "gpt-5.5-vision-layer-analysis",
    model: config.reasoningModel
  };
}

function shouldUseImageModelingWhiteBackgroundPrepass(body = {}) {
  if (body.skipWhiteBackgroundPrepass === true || body.disableWhiteBackgroundPrepass === true) return false;
  return parseBooleanEnv(process.env.IMAGE_MODELING_WHITE_BACKGROUND_PREPASS, true);
}

function shouldUseImageModelingCadReferencePrepass(body = {}) {
  if (body.skipCadReferencePrepass === true || body.disableCadReferencePrepass === true) return false;
  return parseBooleanEnv(process.env.IMAGE_MODELING_CAD_REFERENCE_PREPASS, true);
}

function normalizeImageModelingPreprocessAction(value = "") {
  const action = String(value || "").trim().toLowerCase();
  if (!action) return "";
  if (["white", "white-background", "white_background", "subject-white", "generate-white", "direct-white"].includes(action)) return "white-background";
  if (["outpaint", "expand", "expanded", "subject-outpaint", "subject-expand", "complete-subject"].includes(action)) return "outpaint";
  if (["white-from-expanded", "white_from_expanded", "expanded-to-white", "outpaint-to-white"].includes(action)) return "white-from-expanded";
  if (["cad-reference", "cad_reference", "cad-guide", "cad_guide", "structure-guide", "structure_guide", "cad-structure", "cad_structure"].includes(action)) return "cad-reference";
  return "";
}

function imageModelingIntegratedCadPromptLines(stage = "model", sourceType = "") {
  const normalizedSourceType = String(sourceType || "").toLowerCase();
  const lines = [
    "Honor the user's intent exactly. Do not redesign the subject, do not add unrelated constraints, and do not chase mood or spectacle over geometric fidelity."
  ];

  if (stage === "analysis") {
    lines.push(
      "Think like a parametric CAD editor preparing downstream modeling scope, not like a concept artist describing vibes.",
      "Focus on geometry-bearing evidence: masses, envelopes, seams, openings, joints, roof edges, slab lines, thickness cues, repeated modules, structural supports and part boundaries.",
      "Prefer conservative interpretation. If something is ambiguous, identify it as inferred instead of inventing decorative detail."
    );
  } else if (stage === "white-background" || stage === "outpaint" || stage === "cad-reference") {
    lines.push(
      "Prepare the subject for downstream parametric CAD editors such as OpenSCAD, ForgeCAD and build123d/text-to-cad.",
      "Keep major part boundaries, openings, seams, roof lines, slab/eave edges, joints and thickness cues legible so later structural recognition stays stable.",
      "Remove atmosphere, photographic styling, decorative clutter and graphic treatment that would confuse a CAD-focused model."
    );
    if (stage === "cad-reference") {
      lines.push(
        "This guide image should read like a restrained engineering / CAD aid, not a marketing render or fantasy concept sheet.",
        "Use simplification only to clarify structure. Never simplify away geometry that changes the editable CAD result."
      );
    }
  } else {
    lines.push(
      "Behave like a parametric CAD editor that must produce an editable downstream model, not a loose concept sculptor.",
      "Prefer connected, manifold, export-friendly solids with readable thickness and clean part separation so the result survives ForgeCAD and build123d/text-to-cad export.",
      "Use stable descriptive snake_case object ids for major parts whenever possible, and separate repeated systems into individually editable objects instead of one giant generic mass.",
      "If geometry is uncertain from the image, simplify conservatively and record the inference in assumptions or limitations instead of inventing decorative detail."
    );
  }

  if (normalizedSourceType === "architecture-photo") {
    lines.push(
      "Architectural priority: preserve building massing, floor stack, roof profile, facade rhythm, side returns, entry hierarchy, major openings and base condition before texture or ornament."
    );
  } else if (normalizedSourceType === "interior-photo") {
    lines.push(
      "Interior priority: preserve the reference photo's real interior camera, envelope, floor/wall/ceiling planes, openings, fixed joinery, counters, seating, circulation structure and major furniture before atmosphere or lighting effects.",
      "Interior source lock: if the uploaded reference is an interior room/space, never reinterpret it as an exterior building, facade box, object-only product, or generic cutaway. Model the inside of the room from the photo evidence."
    );
  } else if (normalizedSourceType === "object-photo") {
    lines.push(
      "Object priority: preserve the real silhouette, separable parts, joints, seams, sockets, supports and functional geometry of the object itself; remove display props unless explicitly requested."
    );
  }

  return lines;
}

function imageModelingWhiteBackgroundSize(primaryImage = {}, body = {}) {
  const requested = body.whiteBackgroundSize || process.env.IMAGE_MODELING_WHITE_BACKGROUND_SIZE;
  if (requested) return closestStandardImageSize(String(requested));
  const sourceImage = body.subjectImage || primaryImage;
  const width = Number(sourceImage.width || 0);
  const height = Number(sourceImage.height || 0);
  if (width > 0 && height > 0) return closestStandardImageSize(`${width}x${height}`);
  return "1024x1024";
}

function buildImageModelingWhiteBackgroundPrompt({ brief = {}, intent = "", primaryImage = {}, subjectImage = {}, subjectSelection = null, analysis = null } = {}) {
  const completeness = analysis?.completeness || {};
  const complete = completeness.isComplete !== false;
  const selectionText = subjectSelection
    ? `User-boxed subject region on the original image: x=${Number(subjectSelection.x || 0).toFixed(4)}, y=${Number(subjectSelection.y || 0).toFixed(4)}, width=${Number(subjectSelection.width || 0).toFixed(4)}, height=${Number(subjectSelection.height || 0).toFixed(4)}.`
    : "No manual subject box was provided.";
  const cropNote = subjectImage?.dataUrl
    ? "Input image 2 is a zoomed crop of the user-selected subject region."
    : "No subject crop is available; use the original image only.";
  return [
    "You are preparing one reference image for a CAD-friendly image-to-3D modeling pipeline.",
    "Input image 1 is the original uploaded reference image.",
    cropNote,
    selectionText,
    ...imageModelingIntegratedCadPromptLines("white-background", analysis?.sourceType || primaryImage?.sourceType || ""),
    complete
      ? "The subject appears complete. Isolate the real object/building/space cleanly onto white and preserve the current geometry without inventing new parts."
      : "The subject appears incomplete or cut off. Use the original image context to outpaint and reconstruct the missing parts first, then isolate the completed subject onto white.",
    "Output exactly one finished image: the selected subject centered on a pure white (#ffffff) background with a small margin.",
    "Preserve the subject's real geometry, proportions, visible silhouette, view angle, facade/opening positions, roof form, product parts, material color zones and depth clues.",
    "Do not stylize, redesign, simplify into an icon, add labels, add watermarks, add readable text, add extra decorative parts or change the camera into a fantasy view.",
    "Remove everything that is not part of the modeling subject: sky, trees, grass, people, cars, roads, photo studio surfaces, display plates, trays, plinths, tabletops, shadows, reflections and background clutter.",
    "For an architectural exterior, keep the whole building as the subject, including roof/parapet, facade, side depth clues, openings, entry, steps/columns/balcony/base when visible. Remove landscape and street context.",
    "For a product/object photo, keep only the physical object itself. Keep attached structural parts; remove props and supports that are merely photographic staging.",
    "For an interior/room photo, keep the architectural envelope and major fixed/furniture forms as a clean cutaway reference on white; remove atmospheric background noise and lighting glare.",
    `Original image name: ${primaryImage.name || "uploaded image"}.`,
    subjectImage?.name ? `Selected subject crop name: ${subjectImage.name}.` : "",
    `Project brief: ${JSON.stringify(brief)}`,
    completeness.reason ? `Vision completeness note: ${completeness.reason}` : "",
    completeness.recommendation ? `Vision recommendation: ${completeness.recommendation}` : "",
    `User modeling request: ${intent || "Create a CAD-friendly 3D model from this image."}`
  ].filter(Boolean).join("\n");
}

async function createImageModelingWhiteBackgroundPrepass({ body = {}, primaryImage = {}, subjectImage = {}, brief = {}, intent = "", analysis = null } = {}) {
  const cropImage = subjectImage?.dataUrl ? subjectImage : primaryImage;
  const dataUrl = String(cropImage.dataUrl || primaryImage.dataUrl || body.imageDataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) return null;
  const completeness = analysis?.completeness || {};
  const shouldOutpaint = completeness.isComplete === false;
  const hasSubjectCrop = Boolean(subjectImage?.dataUrl && subjectImage.dataUrl !== primaryImage.dataUrl);
  const prompt = buildImageModelingWhiteBackgroundPrompt({ brief, intent, primaryImage, subjectImage: hasSubjectCrop ? subjectImage : {}, subjectSelection: body.subjectSelection || body.selection || null, analysis });
  const inputImages = [{
    dataUrl: cropImage.dataUrl,
    label: hasSubjectCrop
      ? "optional user subject crop; isolate or complete this subject onto pure white"
      : "source reference image; isolate the main subject onto pure white"
  }];
  if (shouldOutpaint && primaryImage?.dataUrl && primaryImage.dataUrl !== cropImage.dataUrl) {
    inputImages.push({
      dataUrl: primaryImage.dataUrl,
      label: "original full image; use it to recover missing parts while outpainting"
    });
  }
  const generated = await generateImageWithImageProvider({
    prompt,
    inputImages,
    size: imageModelingWhiteBackgroundSize(cropImage, { ...body, subjectImage: cropImage }),
    quality: body.whiteBackgroundQuality || process.env.IMAGE_MODELING_WHITE_BACKGROUND_QUALITY || "low",
    preferReferenceEdit: true,
    mode: shouldOutpaint ? "image-modeling-white-background-outpaint" : "image-modeling-white-background"
  });
  const createdAt = new Date().toISOString();
  const dataUrlOut = imageBufferToDataUrl(generated.buffer, "image/png");
  const title = shouldOutpaint ? "白底主体图（扩图补全）" : "白底建模参考图";
  const saved = await saveGeneratedImage({
    buffer: generated.buffer,
    slug: `image-modeling-white-${slugify(primaryImage.name || brief.projectName || "subject")}`,
    meta: {
      reasoning_model: generated.reasoningModel || config.reasoningModel,
      image_model: config.imageModel,
      prompt_library_version: promptLibraryVersion,
      mode: shouldOutpaint ? "image-modeling-white-background-outpaint" : "image-modeling-white-background",
      source_image_name: primaryImage.name || null,
      prompt,
      created_at: createdAt
    },
    extra: {
      id: `image-modeling-white-${Date.now()}`,
      title,
      mode: "image-modeling",
      stepMode: shouldOutpaint ? "image-modeling-white-background-outpaint" : "image-modeling-white-background",
      inputImageType: "white-background-subject-reference",
      prompt,
      sourcePrompt: prompt,
      intent: shouldOutpaint
        ? "主体不完整，先用生图模式扩图补全并生成白底主体图，再进入 3D 建模。"
        : "先用生图模式识别主体并生成白底标准图，再进入 3D 建模。",
      endpoint: generated.endpoint,
      attempt: generated.attempt,
      attempts: generated.attempts,
      imageApi: generated.imageApi,
      actualParams: generated.actualParams,
      revisedPrompt: generated.revisedPrompt,
      completeness,
      createdAt
    }
  });

  return {
    used: true,
    image: {
      name: `${slugify(primaryImage.name || "modeling-subject") || "modeling-subject"}-white-background.png`,
      title,
      type: "image/png",
      dataUrl: dataUrlOut,
      width: 0,
      height: 0,
      url: saved.url,
      sourceType: "image-generation-white-background",
      originalName: primaryImage.name || null
    },
    record: {
      ...saved,
      dataUrl: dataUrlOut,
      createdAt,
      originalImageName: primaryImage.name || null
    },
    prompt,
    originalImageName: primaryImage.name || null
  };
}

function buildImageModelingOutpaintPrompt({ brief = {}, intent = "", primaryImage = {} } = {}) {
  return [
    "You are preparing an intermediate expanded subject reference for an image-to-3D modeling pipeline.",
    "Input image 1 is the user's original uploaded reference image.",
    ...imageModelingIntegratedCadPromptLines("outpaint", primaryImage?.sourceType || ""),
    "Complete the main architectural/object subject before white-background extraction. If the subject is cropped, cut off, too tight, or missing roof/sides/base/depth clues, plausibly outpaint and reconstruct those missing parts from the visible evidence.",
    "Output exactly one image of the completed subject with enough margin around the whole form. Keep the same view angle, perspective, lens feel, materials, facade/opening rhythm, roof/parapet/eaves, entry/base/plinth, product parts, proportions and design identity.",
    "This is an expansion/completion step, not the final white-background cutout. Do not convert to a 3D render, CAD drawing, icon, line drawing, diagram, labeled graphic, or fantasy redesign.",
    "Keep the background simple and unobtrusive; it may be neutral or naturally extended from the source, but the completed subject must be clear and fully visible for the next white-background step.",
    "Remove or suppress distractions where possible: people, cars, messy foreground clutter, text overlays, watermarks and unrelated objects. Do not invent new decorative architecture that contradicts the source.",
    `Original image name: ${primaryImage.name || "uploaded image"}.`,
    `Project brief: ${JSON.stringify(brief)}`,
    `User modeling request: ${intent || "Complete the main subject before image-to-3D modeling."}`
  ].filter(Boolean).join("\n");
}

async function createImageModelingOutpaintPrepass({ body = {}, primaryImage = {}, brief = {}, intent = "" } = {}) {
  const dataUrl = String(primaryImage.dataUrl || body.imageDataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) return null;
  const prompt = buildImageModelingOutpaintPrompt({ brief, intent, primaryImage });
  const generated = await generateImageWithImageProvider({
    prompt,
    inputImages: [{
      dataUrl,
      label: "original reference image; complete and outpaint the main subject before white-background extraction"
    }],
    size: imageModelingWhiteBackgroundSize(primaryImage, body),
    quality: body.outpaintQuality || body.whiteBackgroundQuality || process.env.IMAGE_MODELING_WHITE_BACKGROUND_QUALITY || "low",
    preferReferenceEdit: true,
    mode: "image-modeling-subject-outpaint"
  });
  const createdAt = new Date().toISOString();
  const dataUrlOut = imageBufferToDataUrl(generated.buffer, "image/png");
  const title = "主体建筑扩图";
  const saved = await saveGeneratedImage({
    buffer: generated.buffer,
    slug: `image-modeling-outpaint-${slugify(primaryImage.name || brief.projectName || "subject")}`,
    meta: {
      reasoning_model: generated.reasoningModel || config.reasoningModel,
      image_model: config.imageModel,
      prompt_library_version: promptLibraryVersion,
      mode: "image-modeling-subject-outpaint",
      source_image_name: primaryImage.name || null,
      prompt,
      created_at: createdAt
    },
    extra: {
      id: `image-modeling-outpaint-${Date.now()}`,
      title,
      mode: "image-modeling",
      stepMode: "image-modeling-subject-outpaint",
      inputImageType: "expanded-subject-reference",
      prompt,
      sourcePrompt: prompt,
      intent: "先用生图模式完善主体建筑扩图；扩图结果可直接进入 3D 建模，也可选再生成白底主体图。",
      endpoint: generated.endpoint,
      attempt: generated.attempt,
      attempts: generated.attempts,
      imageApi: generated.imageApi,
      actualParams: generated.actualParams,
      revisedPrompt: generated.revisedPrompt,
      createdAt
    }
  });

  return {
    used: true,
    image: {
      name: `${slugify(primaryImage.name || "modeling-subject") || "modeling-subject"}-outpaint.png`,
      title,
      type: "image/png",
      dataUrl: dataUrlOut,
      width: 0,
      height: 0,
      url: saved.url,
      sourceType: "image-generation-subject-outpaint",
      originalName: primaryImage.name || null
    },
    record: {
      ...saved,
      dataUrl: dataUrlOut,
      createdAt,
      originalImageName: primaryImage.name || null
    },
    prompt,
    originalImageName: primaryImage.name || null
  };
}

function buildImageModelingCadReferenceParameters(analysis = {}, cadReferenceImage = null) {
  const layers = Array.isArray(analysis?.layers) ? analysis.layers : [];
  const includeLayers = layers
    .filter((layer) => layer?.includeInModel !== false)
    .slice(0, 12)
    .map((layer) => ({
      id: String(layer.id || "").slice(0, 60),
      label: String(layer.label || layer.role || "").slice(0, 80),
      role: String(layer.role || "").slice(0, 60),
      primitiveHint: String(layer.primitiveHint || layer.primitive_hint || "").slice(0, 60),
      depthOrder: Number(layer.depthOrder || layer.depth_order || 0) || 0,
      scaleRole: String(layer.scaleRole || layer.scale_role || "").slice(0, 60),
      geometryHints: asStringArray(layer.geometryHints || layer.geometry_hints).slice(0, 4),
      notes: String(layer.notes || "").slice(0, 160)
    }));
  return {
    sourceType: String(analysis?.sourceType || "").slice(0, 60),
    subject: String(analysis?.subject || "").slice(0, 100),
    completeness: String(analysis?.completeness?.label || "").slice(0, 60),
    recommendation: String(analysis?.completeness?.recommendation || "").slice(0, 180),
    targetShape: String(analysis?.targetShape?.type || "").slice(0, 40),
    viewAngle: String(analysis?.visualProfile?.viewAngle || "").slice(0, 80),
    silhouette: String(analysis?.visualProfile?.silhouette || "").slice(0, 180),
    characteristicFeatures: asStringArray(analysis?.visualProfile?.characteristicFeatures).slice(0, 8),
    materialZones: asStringArray(analysis?.visualProfile?.materialZones).slice(0, 6),
    primitiveStrategy: String(analysis?.primitiveStrategy || "").slice(0, 200),
    scaleStrategy: String(analysis?.scaleStrategy || "").slice(0, 200),
    depthRelations: asStringArray(analysis?.depthRelations).slice(0, 8),
    excludedRegions: asStringArray(analysis?.excludedRegions).slice(0, 8),
    includeLayers,
    cadReferenceTitle: String(cadReferenceImage?.title || "").slice(0, 80)
  };
}

function buildImageModelingCadReferencePrompt({ brief = {}, intent = "", primaryImage = {}, analysis = null, sourceRole = "" } = {}) {
  const sourceRoleText = sourceRole
    ? `Source image role: ${String(sourceRole).slice(0, 120)}.`
    : "Source image role: current modeling subject reference.";
  const sourceType = String(analysis?.sourceType || "").toLowerCase();
  const objectSubject = /object|product/i.test(sourceType)
    || objectPhotoLooksLikeApple(sourceType, analysis, intent, primaryImage?.name)
    || /object|product|产品|物体|主体|apple|苹果|fruit|果实/i.test(imageModelingSubjectText(analysis, intent, primaryImage?.name));
  return [
    "You are preparing one CAD-friendly structure reference image for a downstream image-to-3D modeling pipeline.",
    "Convert the selected subject into a clean architectural / industrial line-and-mass guide image that stabilizes silhouette, openings, roof profile, side depth, floor lines, repeated modules and main part boundaries.",
    sourceRoleText,
    ...imageModelingIntegratedCadPromptLines("cad-reference", sourceType),
    "Output exactly one image.",
    "Use a pure white or near-white background. Use dark gray or black edge lines, flat light fills, and restrained monochrome shading only where it clarifies depth. Keep the subject centered with a small margin.",
    "Do not add readable text, dimensions, arrows, labels, title blocks, watermarks, logos, UI, or graphic decorations. The geometry hints will be provided separately as JSON parameters.",
    objectSubject
      ? [
          "PRODUCT/OBJECT CAD GUIDE HARD RULES:",
          "Output exactly one depiction of the single foreground object, not a product blueprint sheet.",
          "Use one single three-quarter or source-matching view of the object, centered large on the canvas.",
          "Do not create multiple views, exploded views, orthographic front/side/top views, sections, cutaways, repeated thumbnails, comparison panels, construction diagrams, labels, dimension rings, crosshair grids, or background layout sheets.",
          "Preserve one continuous outer silhouette and only the visible/inferable structural features attached to the object.",
          "For an apple or round fruit, draw one apple only: one rounded body, one top dimple/stem socket, one attached stem if visible, subtle bottom flattening if inferable, and a few contour/part-boundary lines on that same single apple. Do not add top-view circles, split sections, extra apples, plates, trays or tabletop geometry."
        ].join("\n")
      : "",
    sourceType === "architecture-photo"
      ? "For an architectural exterior, preserve the whole building, same view angle, overall massing, side returns, roof/parapet/eaves, facade rhythm, openings, entry, steps, balcony/columns/base and major material bands. Remove trees, sky, road, cars and context clutter."
      : sourceType === "interior-photo"
        ? "For an interior/space subject, preserve the same interior camera logic plus envelope, floor/wall/ceiling planes, openings, counters, seats, tables, shelves, columns, stairs and major fixed forms. Do not turn the room into an outside building box. Remove glare, atmosphere, clutter and non-structural background noise."
        : "For a product/object subject, preserve the real silhouette, seams, break lines, main parts, joints and base geometry that belongs to the object itself. Remove photographic props and display surfaces.",
    "Do not turn the subject into a fantasy redesign or photoreal render. This should look like a CAD-friendly guide image derived from the real subject.",
    analysis?.visualProfile?.characteristicFeatures?.length
      ? `Must preserve these characteristic features: ${analysis.visualProfile.characteristicFeatures.join(", ")}.`
      : "",
    analysis?.completeness?.reason ? `Completeness note: ${analysis.completeness.reason}` : "",
    `Original image name: ${primaryImage.name || "uploaded image"}.`,
    `Project brief: ${JSON.stringify(brief)}`,
    `User modeling request: ${intent || "Generate a CAD-friendly structure guide for image-to-3D modeling."}`
  ].filter(Boolean).join("\n");
}

async function createImageModelingCadReferencePrepass({ body = {}, primaryImage = {}, brief = {}, intent = "", analysis = null, sourceRole = "" } = {}) {
  const dataUrl = String(primaryImage.dataUrl || body.imageDataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) return null;
  const cadReferenceAnalysis = knownObjectTemplateAnalysis(analysis || {}, { intent, primaryImage }) || analysis;
  const prompt = buildImageModelingCadReferencePrompt({ brief, intent, primaryImage, analysis: cadReferenceAnalysis, sourceRole });
  const generated = await generateImageWithImageProvider({
    prompt,
    inputImages: [{
      dataUrl,
      label: "subject reference image; convert it into a CAD-friendly structure guide"
    }],
    size: imageModelingWhiteBackgroundSize(primaryImage, { ...body, whiteBackgroundSize: body.cadReferenceSize || body.whiteBackgroundSize }),
    quality: body.cadReferenceQuality || body.whiteBackgroundQuality || process.env.IMAGE_MODELING_CAD_REFERENCE_QUALITY || "low",
    preferReferenceEdit: true,
    mode: "image-modeling-cad-reference"
  });
  const createdAt = new Date().toISOString();
  const dataUrlOut = imageBufferToDataUrl(generated.buffer, "image/png");
  const title = "CAD结构参考图";
  const saved = await saveGeneratedImage({
    buffer: generated.buffer,
    slug: `image-modeling-cad-reference-${slugify(primaryImage.name || brief.projectName || "subject")}`,
    meta: {
      reasoning_model: generated.reasoningModel || config.reasoningModel,
      image_model: config.imageModel,
      prompt_library_version: promptLibraryVersion,
      mode: "image-modeling-cad-reference",
      source_image_name: primaryImage.name || null,
      prompt,
      created_at: createdAt
    },
    extra: {
      id: `image-modeling-cad-reference-${Date.now()}`,
      title,
      mode: "image-modeling",
      stepMode: "image-modeling-cad-reference",
      inputImageType: "cad-structure-reference",
      prompt,
      sourcePrompt: prompt,
      intent: "生成 CAD 友好的结构参考图，帮助 gpt-5.5 在正式建模时稳定识别体块、开口、屋顶和层级。",
      endpoint: generated.endpoint,
      attempt: generated.attempt,
      attempts: generated.attempts,
      imageApi: generated.imageApi,
      actualParams: generated.actualParams,
      revisedPrompt: generated.revisedPrompt,
      createdAt
    }
  });

  return {
    used: true,
    image: {
      name: `${slugify(primaryImage.name || "modeling-subject") || "modeling-subject"}-cad-reference.png`,
      title,
      type: "image/png",
      dataUrl: dataUrlOut,
      width: 0,
      height: 0,
      url: saved.url,
      sourceType: "image-generation-cad-reference",
      originalName: primaryImage.name || null
    },
    record: {
      ...saved,
      dataUrl: dataUrlOut,
      createdAt,
      originalImageName: primaryImage.name || null
    },
    parameters: buildImageModelingCadReferenceParameters(analysis, { title }),
    prompt,
    originalImageName: primaryImage.name || null
  };
}

function imageModelingWhiteBackgroundImageFromAnalysis(analysis = {}) {
  const prepassImage = analysis?.modelingPrepass?.image || null;
  const prepassText = `${prepassImage?.stepMode || ""} ${prepassImage?.title || ""} ${prepassImage?.sourceType || ""}`.toLowerCase();
  const image = analysis?.whiteBackgroundImage || (/white-background|white background|白底/.test(prepassText) ? prepassImage : null);
  const dataUrl = String(image?.dataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) return null;
  return {
    name: image.name || "image-modeling-white-background.png",
    title: image.title || "白底建模参考图",
    type: image.type || "image/png",
    dataUrl,
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    url: image.url || "",
    sourceType: "image-generation-white-background",
    originalName: image.originalImageName || image.originalName || null
  };
}

function imageModelingCadReferenceImageFromAnalysis(analysis = {}) {
  const direct = analysis?.cadReferenceImage || null;
  if (direct?.dataUrl) return direct;
  const prepassImage = analysis?.modelingCadPrepass?.image || null;
  const dataUrl = String(prepassImage?.dataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) return null;
  return prepassImage;
}

function imageModelingPrepassForClient(prepass = null, options = {}) {
  if (!prepass?.image?.dataUrl) return null;
  const record = prepass.record || {};
  const defaultTitle = options.defaultTitle || "白底建模参考图";
  const defaultStepMode = options.defaultStepMode || "image-modeling-white-background";
  const defaultSourceType = options.defaultSourceType || "image-generation-white-background";
  const defaultInputImageType = options.defaultInputImageType || "white-background-subject-reference";
  return {
    used: true,
    reused: Boolean(prepass.reused),
    title: prepass.image.title || record.title || defaultTitle,
    name: prepass.image.name || "image-modeling-white-background.png",
    type: prepass.image.type || "image/png",
    url: record.url || prepass.image.url || "",
    dataUrl: prepass.image.dataUrl,
    stepMode: record.stepMode || prepass.stepMode || defaultStepMode,
    sourceType: defaultSourceType,
    inputImageType: record.inputImageType || defaultInputImageType,
    originalImageName: prepass.originalImageName || prepass.image.originalName || record.originalImageName || null,
    createdAt: record.createdAt || new Date().toISOString(),
    endpoint: record.endpoint || prepass.endpoint || "",
    attempt: record.attempt || prepass.attempt || "",
    imageApi: record.imageApi || "",
    prompt: record.prompt || prepass.prompt || "",
    intent: record.intent || prepass.intent || "",
    completeness: record.completeness || prepass.completeness || null
  };
}

function attachImageModelingPrepassMeta(target = {}, prepass = null, originalPrimaryImage = {}) {
  const whiteBackgroundImage = imageModelingPrepassForClient(prepass, {
    defaultTitle: "白底建模参考图",
    defaultStepMode: "image-modeling-white-background",
    defaultSourceType: "image-generation-white-background",
    defaultInputImageType: "white-background-subject-reference"
  });
  if (!whiteBackgroundImage && prepass?.error) {
    return {
      ...target,
      modelingPrepass: {
        used: false,
        error: String(prepass.error || "").slice(0, 240)
      }
    };
  }
  if (!whiteBackgroundImage) return target;
  return {
    ...target,
    whiteBackgroundImage,
    modelingPrepass: {
      used: true,
      reused: Boolean(prepass?.reused),
      image: whiteBackgroundImage,
      originalImageName: originalPrimaryImage?.name || whiteBackgroundImage.originalImageName || null
    }
  };
}

function attachImageModelingOutpaintMeta(target = {}, prepass = null, originalPrimaryImage = {}) {
  const expandedSubjectImage = imageModelingPrepassForClient(prepass, {
    defaultTitle: "主体建筑扩图",
    defaultStepMode: "image-modeling-subject-outpaint",
    defaultSourceType: "image-generation-subject-outpaint",
    defaultInputImageType: "expanded-subject-reference"
  });
  if (!expandedSubjectImage && prepass?.error) {
    return {
      ...target,
      requiresWhiteBackground: false,
      modelingPrepass: {
        used: false,
        error: String(prepass.error || "").slice(0, 240)
      }
    };
  }
  if (!expandedSubjectImage) return target;
  return {
    ...target,
    requiresWhiteBackground: false,
    expandedSubjectImage,
    modelingPrepass: {
      used: true,
      reused: Boolean(prepass?.reused),
      image: expandedSubjectImage,
      originalImageName: originalPrimaryImage?.name || expandedSubjectImage.originalImageName || null
    }
  };
}

function attachImageModelingCadReferenceMeta(target = {}, prepass = null, originalPrimaryImage = {}) {
  const cadReferenceImage = imageModelingPrepassForClient(prepass, {
    defaultTitle: "CAD结构参考图",
    defaultStepMode: "image-modeling-cad-reference",
    defaultSourceType: "image-generation-cad-reference",
    defaultInputImageType: "cad-structure-reference"
  });
  if (!cadReferenceImage && prepass?.error) {
    return {
      ...target,
      modelingCadPrepass: {
        used: false,
        error: String(prepass.error || "").slice(0, 240)
      }
    };
  }
  if (!cadReferenceImage) return target;
  return {
    ...target,
    cadReferenceImage,
    cadReferenceParameters: prepass?.parameters || buildImageModelingCadReferenceParameters(target, cadReferenceImage),
    modelingCadPrepass: {
      used: true,
      reused: Boolean(prepass?.reused),
      image: cadReferenceImage,
      originalImageName: originalPrimaryImage?.name || cadReferenceImage.originalImageName || null
    }
  };
}

async function createImageModelingPreprocessAnalysis(body = {}, action = "") {
  const sourcePrimaryImage = body.primaryImage || body.image || {};
  const sourceDataUrl = String(sourcePrimaryImage.dataUrl || body.imageDataUrl || "").trim();
  if (!sourceDataUrl.startsWith("data:image/")) {
    const error = new Error("请先上传一张用于建模的图片");
    error.status = 400;
    throw error;
  }
  const brief = body.brief || {};
  const intent = String(body.intent || body.userPrompt || "").trim();
  const previousAnalysis = body.modelingAnalysis || body.analysis || null;
  const expandedSubjectImage = body.expandedSubjectImage || body.outpaintImage || body.expandedImage || {};
  const expandedDataUrl = String(expandedSubjectImage.dataUrl || "").trim();
  const base = {
    subject: action === "outpaint" ? "主体建筑扩图" : action === "cad-reference" ? "CAD结构参考图" : "主体建筑白底图",
    sourceType: "architecture-photo",
    summary: action === "outpaint"
      ? "已选择先完善主体建筑扩图；扩图结果可直接进入 3D 建模，白底主体图为可选清洁化步骤。"
      : action === "cad-reference"
        ? "已生成 CAD 友好的结构参考图。正式建模时会把这张结构图和主体输入一起交给 gpt-5.5，帮助稳定识别体块、开口、屋顶和层级。"
      : action === "white-from-expanded"
        ? "已选择从主体建筑扩图结果生成白底主体图，作为 3D 建模输入。"
        : "已选择从原始参考图直接生成主体建筑白底图，作为 3D 建模输入。",
    confidence: 0.72,
    targetBounds: { x: 0, y: 0, width: 1, height: 1 },
    targetShape: { type: "bounds", bounds: { x: 0, y: 0, width: 1, height: 1 }, note: "preprocess action selected by user" },
    completeness: {
      isComplete: action !== "outpaint",
      score: action === "outpaint" ? 0.58 : 0.86,
      label: action === "outpaint" ? "扩图可建模" : action === "cad-reference" ? "CAD参考就绪" : "白底图就绪",
      missingParts: [],
      edgeContact: [],
      recommendation: action === "outpaint"
        ? "可以直接进入 3D 建模，也可选生成白底主体图"
        : action === "cad-reference"
          ? "建议保留当前主体输入，并把 CAD 结构参考图一起用于正式建模"
          : "可以进入 3D 建模",
      reason: "当前判断来自用户选择的图片建模预处理路径。"
    },
    modelingScope: action === "outpaint"
      ? "final modeling may use the expanded subject image directly; white-background extraction is optional"
      : action === "cad-reference"
        ? "final modeling should use the prepared subject image together with the generated CAD structure guide"
      : "final modeling should use the generated white-background subject image",
    scaleStrategy: "",
    primitiveStrategy: "",
    visualProfile: { silhouette: "", viewAngle: "", characteristicFeatures: [], materialZones: [], nonGeometry: [] },
    depthRelations: [],
    excludedRegions: [],
    layers: [],
    preprocessAction: action,
    source: "user-selected-image-modeling-preprocess",
    model: config.imageModel
  };

  if (action === "outpaint") {
    let outpaintPrepass = null;
    try {
      outpaintPrepass = await createImageModelingOutpaintPrepass({ body, primaryImage: sourcePrimaryImage, brief, intent });
    } catch (error) {
      console.warn(`[image-modeling] subject outpaint failed: ${error.status || "ERR"} ${error.message || error}`);
      outpaintPrepass = { used: false, error: error.message || "主体建筑扩图失败" };
    }
    return attachImageModelingOutpaintMeta(base, outpaintPrepass, sourcePrimaryImage);
  }

  if (action === "cad-reference") {
    const cadReferenceSourceImage = body.cadReferenceSourceImage || expandedSubjectImage || sourcePrimaryImage;
    const sourceRole = String(body.cadReferenceSourceRole || "").trim();
    let cadReferencePrepass = null;
    try {
      cadReferencePrepass = await createImageModelingCadReferencePrepass({
        body,
        primaryImage: cadReferenceSourceImage?.dataUrl ? cadReferenceSourceImage : sourcePrimaryImage,
        brief,
        intent,
        analysis: previousAnalysis,
        sourceRole
      });
    } catch (error) {
      console.warn(`[image-modeling] cad reference preprocess failed: ${error.status || "ERR"} ${error.message || error}`);
      cadReferencePrepass = { used: false, error: error.message || "CAD结构参考图生成失败" };
    }
    return attachImageModelingCadReferenceMeta(base, cadReferencePrepass, sourcePrimaryImage);
  }

  if (action === "white-from-expanded" && !expandedDataUrl.startsWith("data:image/")) {
    const error = new Error("请先完成主体建筑扩图，再生成白底图");
    error.status = 400;
    throw error;
  }
  const whiteSourceImage = action === "white-from-expanded" ? expandedSubjectImage : sourcePrimaryImage;
  const whiteBody = action === "white-from-expanded"
    ? { ...body, subjectImage: whiteSourceImage, subjectSelection: null }
    : { ...body, subjectImage: null, subjectSelection: null };
  let whiteBackgroundPrepass = null;
  try {
    whiteBackgroundPrepass = await createImageModelingWhiteBackgroundPrepass({
      body: whiteBody,
      primaryImage: whiteSourceImage,
      subjectImage: {},
      brief,
      intent,
      analysis: { completeness: { isComplete: true, recommendation: "可以进入 3D 建模" } }
    });
  } catch (error) {
    console.warn(`[image-modeling] white-background preprocess failed: ${error.status || "ERR"} ${error.message || error}`);
    whiteBackgroundPrepass = { used: false, error: error.message || "白底主体图生成失败" };
  }
  return {
    ...attachImageModelingPrepassMeta(base, whiteBackgroundPrepass, sourcePrimaryImage),
    expandedSubjectImage: action === "white-from-expanded" && expandedDataUrl.startsWith("data:image/") ? expandedSubjectImage : null,
    requiresWhiteBackground: false
  };
}

async function analyzeImageModelingSubject(body = {}) {
  const sourcePrimaryImage = body.primaryImage || body.image || {};
  const sourceDataUrl = String(sourcePrimaryImage.dataUrl || body.imageDataUrl || "").trim();
  if (!sourceDataUrl.startsWith("data:image/")) {
    const error = new Error("请先上传一张用于建模的图片");
    error.status = 400;
    throw error;
  }

  const brief = body.brief || {};
  const intent = String(body.intent || body.userPrompt || "").trim();
  const preprocessAction = normalizeImageModelingPreprocessAction(body.preprocessAction || body.modelingPreprocessAction || body.imageModelingAction || body.action);
  if (preprocessAction) {
    return createImageModelingPreprocessAnalysis(body, preprocessAction);
  }
  const subjectImage = body.subjectImage || body.subject_image || {};
  const subjectDataUrl = String(subjectImage.dataUrl || "").trim();
  const subjectSelection = body.subjectSelection || body.selection || null;
  const analysisInputImages = [{
    type: "input_image",
    image_url: sourceDataUrl
  }];
  if (subjectDataUrl && subjectDataUrl !== sourceDataUrl) {
    analysisInputImages.push({
      type: "input_image",
      image_url: subjectDataUrl
    });
  }

  const prompt = [
    "You are gpt-5.5 vision acting as a pre-modeling subject and layer recognition assistant.",
    "Inspect the boxed subject before any 3D generation. Decide exactly what should become geometry and what should be ignored.",
    ...imageModelingIntegratedCadPromptLines("analysis", sourcePrimaryImage?.sourceType || body.primaryImage?.sourceType || ""),
    body.modelingInputRole
      ? `Input image note: ${String(body.modelingInputRole).slice(0, 360)}`
      : subjectDataUrl && subjectDataUrl !== sourceDataUrl
        ? "Input image 1 is the original uploaded image and input image 2 is the user's boxed subject crop. Analyze the boxed subject crop, but return all normalized coordinates relative to the original image."
        : "Input image note: this is the original uploaded image.",
    subjectSelection
      ? `User boxed subject selection on the original image: x=${Number(subjectSelection.x || 0).toFixed(4)}, y=${Number(subjectSelection.y || 0).toFixed(4)}, width=${Number(subjectSelection.width || 0).toFixed(4)}, height=${Number(subjectSelection.height || 0).toFixed(4)}.`
      : "No manual subject box was provided.",
    "Return a real subject silhouette/shape, normalized bounding boxes, visible modeling features, and layer roles so the next CAD-friendly modeling step can stay focused.",
    "Coordinate rules: bounds use x, y, width, height from 0 to 1 relative to the full image.",
    "Shape rules: targetShape is what the user will visually confirm. It must follow the visible subject silhouette, not a square/rectangular selection box.",
    "Completeness rules:",
    "- Judge whether the boxed subject is complete or cut off.",
    "- If the subject is incomplete, identify the missing sides or missing parts and recommend outpainting before white-background generation.",
    "- If the subject is complete, say that no outpaint is needed.",
    "Selection rules:",
    "- If this is a product/object photo, select the actual foreground object as the main subject. Exclude display props such as plates, trays, plinths, turntables, tabletops, shadows and background surfaces unless the user explicitly asks to model them.",
    "- Include a base/support only when it is physically attached to the object or essential to the object's real structure, not merely something the object sits on for photography.",
    "- For a round fruit/object such as an apple, identify the exact object class and the characteristic geometry: ellipsoid body, asymmetric shoulders, top dimple/stem socket, attached stem if visible, bottom flattening/calyx if inferable. Use targetShape.type='ellipse' or a 12-32 point polygon tightly around the fruit body. Do not include the display plate/base in targetBounds, targetShape, or includeInModel layers unless explicitly requested.",
    "- Do not describe a common object with only one generic layer. Add separate includeInModel layers for any visible/inferable structural feature that materially changes the 3D silhouette.",
    "- If this is an architectural exterior photo, select the whole building as the modeling subject. Exclude sky, trees, people, cars, road, signage, lens distortion and background unless they are explicitly requested.",
    "- For a building exterior, split the whole building into includeInModel layers: main mass/envelope, front facade, side-depth/rear inferred mass, roof or parapet, eaves/cornice, windows, doors/entry, balcony/columns/steps/base/plinth, and major material bands.",
    "- If this is an interior image, select the built space envelope and major furniture/structure layers, not random texture, highlights, shadows, UI or background blur.",
    "- Split the selected subject into modeling layers: shell/envelope, openings, structure, major furniture/product parts, base/support, key repeated elements.",
    "- Mark decorative texture, specular highlights, shadows, labels, watermarks, sky/background and image frame as excluded regions unless the user explicitly asks to model them.",
    "- The next stage will model only includeInModel=true layers.",
    "- Write layer ids in stable descriptive snake_case when practical. Avoid vague ids like part1, obj2 or thing.",
    "- Prefer identifying editable systems the downstream CAD model can preserve: facade bays, roof masses, columns, rails, slabs, shelves, brackets, sockets, lids, handles, supports and repeated modules.",
    "Return valid JSON only, no markdown, in this exact shape:",
    JSON.stringify({
      modelingAnalysis: {
        subject: "short Chinese subject name",
        sourceType: "object-photo | interior-photo | architecture-photo | floor-plan-reference",
        summary: "what is selected and why",
        confidence: 0.78,
        completeness: {
          isComplete: true,
          score: 0.86,
          label: "完整 or 不完整",
          missingParts: ["top edge"],
          edgeContact: ["top"],
          recommendation: "直接生成白底主体图 or 建议扩图补全后再生成白底主体图",
          reason: "why the subject is or is not complete"
        },
        targetBounds: { x: 0.12, y: 0.08, width: 0.76, height: 0.84 },
        targetShape: {
          type: "ellipse",
          centerX: 0.5,
          centerY: 0.52,
          radiusX: 0.26,
          radiusY: 0.31,
          note: "visible subject silhouette, not a rectangular box"
        },
        modelingScope: "only the selected object/building/space; exclude photographic background unless explicitly requested",
        scaleStrategy: "scale assumptions for meters",
        primitiveStrategy: "boxes/cylinders/spheres/planes strategy",
        visualProfile: {
          silhouette: "specific visible outline and asymmetry",
          viewAngle: "front / three-quarter / side / top",
          characteristicFeatures: ["features that must become geometry"],
          materialZones: ["major color/material zones that help recognition but are not highlights"],
          nonGeometry: ["highlights and shadows that must not become geometry"]
        },
        depthRelations: ["front object in front of ignored display surface", "rear wall behind furniture"],
        excludedRegions: ["display plate/tray/plinth", "shadow", "specular highlight", "background blur"],
        layers: [
          {
            id: "main-body",
            label: "main subject body",
            role: "product body or spatial shell",
            includeInModel: true,
            priority: 1,
            bounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
            depthOrder: 1,
            primitiveHint: "sphere",
            geometryHints: ["rounded main mass", "slightly flattened top"],
            material: "visible material/color",
            scaleRole: "primary scale reference",
            notes: "visible/inferred"
          }
        ]
      }
    }, null, 2),
    `Project brief: ${JSON.stringify(brief)}`,
    `User modeling request: ${intent || "Create a CAD-friendly 3D model from this image."}`
  ].join("\n");

  const payload = {
    model: config.reasoningModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...analysisInputImages
        ]
      }
    ],
    max_output_tokens: 3600
  };

  const text = await openaiResponsesTextStream(payload, { timeoutMs: 240000, provider: "reasoning" });
  const analysis = normalizeImageModelingAnalysis(await parseModelJsonWithRepair(text, "image-modeling subject analysis"), body);
  let whiteBackgroundPrepass = null;
  if (shouldUseImageModelingWhiteBackgroundPrepass(body)) {
    try {
      whiteBackgroundPrepass = await createImageModelingWhiteBackgroundPrepass({
        body,
        primaryImage: sourcePrimaryImage,
        subjectImage: subjectImage?.dataUrl ? subjectImage : {},
        brief,
        intent,
        analysis
      });
    } catch (error) {
      console.warn(`[image-modeling] white-background prepass failed after analysis: ${error.status || "ERR"} ${error.message || error}`);
      whiteBackgroundPrepass = {
        used: false,
        error: error.message || "白底主体图生成失败"
      };
    }
  }
  return attachImageModelingPrepassMeta(analysis, whiteBackgroundPrepass, sourcePrimaryImage);
}

async function generateImageModel(body = {}) {
  const primaryImage = body.primaryImage || body.image || {};
  const dataUrl = String(primaryImage.dataUrl || body.imageDataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) {
    const error = new Error("请先上传一张用于建模的图片");
    error.status = 400;
    throw error;
  }

  const brief = body.brief || {};
  const intent = String(body.intent || body.userPrompt || "").trim();
  const providedAnalysis = body.modelingAnalysis || body.analysis || null;
  const reusableWhiteImage = imageModelingWhiteBackgroundImageFromAnalysis(providedAnalysis);
  const subjectImage = body.subjectImage || body.subject_image || {};
  let whiteBackgroundPrepass = reusableWhiteImage
    ? {
        used: true,
        reused: true,
        image: reusableWhiteImage,
        record: providedAnalysis.whiteBackgroundImage || providedAnalysis.modelingPrepass?.image || {},
        originalImageName: primaryImage.name || reusableWhiteImage.originalName || null
      }
    : null;
  if (!whiteBackgroundPrepass && shouldUseImageModelingWhiteBackgroundPrepass(body)) {
    try {
      whiteBackgroundPrepass = await createImageModelingWhiteBackgroundPrepass({
        body,
        primaryImage,
        subjectImage,
        brief,
        intent,
        analysis: providedAnalysis
      });
    } catch (error) {
      console.warn(`[image-modeling] white-background prepass failed during modeling: ${error.status || "ERR"} ${error.message || error}`);
      whiteBackgroundPrepass = {
        used: false,
        error: error.message || "白底主体图生成失败"
      };
    }
  }
  const modelingPrimaryImage = whiteBackgroundPrepass?.image?.dataUrl ? whiteBackgroundPrepass.image : primaryImage;
  const modelingDataUrl = String(modelingPrimaryImage.dataUrl || dataUrl).trim();
  let modelingAnalysis;
  try {
    modelingAnalysis = whiteBackgroundPrepass?.image?.dataUrl && !whiteBackgroundPrepass.reused
      ? await analyzeImageModelingSubject({
          ...body,
          primaryImage: modelingPrimaryImage,
          skipWhiteBackgroundPrepass: true,
          modelingInputRole: "This is the generated white-background subject reference. Analyze only the isolated subject; pure white is background and must not become geometry."
        })
      : Array.isArray(providedAnalysis?.layers) && providedAnalysis.layers.length > 0
        ? normalizeImageModelingAnalysis(providedAnalysis, body)
        : await analyzeImageModelingSubject({
            ...body,
            primaryImage: modelingPrimaryImage,
            skipWhiteBackgroundPrepass: true,
            modelingInputRole: whiteBackgroundPrepass?.image?.dataUrl
              ? "This is the generated white-background subject reference. Analyze only the isolated subject; pure white is background and must not become geometry."
              : providedAnalysis?.preprocessAction === "outpaint"
                ? "This is the generated expanded/completed subject reference. Analyze the completed subject directly; background is context and should not become geometry unless it is part of the subject."
                : "This is the original uploaded image."
          });
  } catch (error) {
    if (!isReasoningFallbackError(error) || !shouldFallbackToSpatialImageModelingRequest(body, providedAnalysis, { brief, intent, primaryImage: modelingPrimaryImage })) throw error;
    console.warn(`[image-modeling] analysis reasoning fallback: ${reasoningFallbackReason(error)}`);
    modelingAnalysis = fallbackSpatialImageModelingAnalysis({
      body,
      brief,
      intent,
      primaryImage: modelingPrimaryImage,
      providedAnalysis,
      error
    });
  }
  const reusableCadReferenceImage = imageModelingCadReferenceImageFromAnalysis(providedAnalysis);
  let cadReferencePrepass = reusableCadReferenceImage
    ? {
        used: true,
        reused: true,
        image: reusableCadReferenceImage,
        record: providedAnalysis?.cadReferenceImage || providedAnalysis?.modelingCadPrepass?.image || {},
        parameters: providedAnalysis?.cadReferenceParameters || buildImageModelingCadReferenceParameters(modelingAnalysis, reusableCadReferenceImage),
        originalImageName: primaryImage.name || reusableCadReferenceImage.originalName || null
      }
    : null;
  if (!cadReferencePrepass && shouldUseImageModelingCadReferencePrepass(body)) {
    try {
      cadReferencePrepass = await createImageModelingCadReferencePrepass({
        body,
        primaryImage: modelingPrimaryImage,
        brief,
        intent,
        analysis: modelingAnalysis,
        sourceRole: whiteBackgroundPrepass?.image?.dataUrl
          ? "generated white-background subject reference"
          : providedAnalysis?.preprocessAction === "outpaint"
            ? "generated expanded/completed subject reference"
            : "original uploaded reference image"
      });
    } catch (error) {
      console.warn(`[image-modeling] cad reference prepass failed during modeling: ${error.status || "ERR"} ${error.message || error}`);
      cadReferencePrepass = {
        used: false,
        error: error.message || "CAD结构参考图生成失败"
      };
    }
  }
  const commonObjectAnalysis = knownObjectTemplateAnalysis(modelingAnalysis, { intent, primaryImage: modelingPrimaryImage });
  const hasDirectCadReference = Boolean(cadReferencePrepass?.image?.dataUrl);
  const templateScene = parseBooleanEnv(process.env.IMAGE_MODELING_COMMON_OBJECT_TEMPLATES, true) && commonObjectAnalysis && !hasDirectCadReference
    ? commonObjectTemplateSceneFromAnalysis(commonObjectAnalysis, { intent, primaryImage: modelingPrimaryImage })
    : null;
  const prepassMeta = imageModelingPrepassForClient(whiteBackgroundPrepass, {
    defaultTitle: "白底建模参考图",
    defaultStepMode: "image-modeling-white-background",
    defaultSourceType: "image-generation-white-background",
    defaultInputImageType: "white-background-subject-reference"
  });
  const cadReferenceMeta = imageModelingPrepassForClient(cadReferencePrepass, {
    defaultTitle: "CAD结构参考图",
    defaultStepMode: "image-modeling-cad-reference",
    defaultSourceType: "image-generation-cad-reference",
    defaultInputImageType: "cad-structure-reference"
  });
  const cadReferenceParameters = cadReferencePrepass?.parameters || providedAnalysis?.cadReferenceParameters || buildImageModelingCadReferenceParameters(modelingAnalysis, cadReferenceMeta);
  const enrichedModelingAnalysis = cadReferenceMeta
    ? {
        ...(commonObjectAnalysis || modelingAnalysis),
        cadReferenceImage: cadReferenceMeta,
        cadReferenceParameters
      }
    : (commonObjectAnalysis || modelingAnalysis);
  const summaryPrefix = [
    prepassMeta
      ? modelingAnalysis?.completeness?.isComplete === false
        ? "主体不完整时已按扩图建议补全白底主体图，再基于白底图完成识别与参数化建模。"
        : "已先用生图模式生成白底主体标准图，再基于白底图完成识别与参数化建模。"
      : "",
    cadReferenceMeta ? "已按 CAD 结构参考图作为主几何依据建模，原图仅用于校验主体、颜色和材质分区。" : ""
  ].filter(Boolean).join("");
  if (templateScene) {
    const model = normalizeWhiteModelScene({ whiteModelScene: templateScene }, { brief, intent, primaryImage: modelingPrimaryImage, modelingAnalysis: enrichedModelingAnalysis });
    return attachWhiteModelCadArtifacts({
      ...model,
      id: `image-model-${Date.now()}`,
      mode: "image-modeling",
      modelingAnalysis: enrichedModelingAnalysis,
      originalSourceImage: primaryImage ? {
        name: primaryImage.name || null,
        type: primaryImage.type || null,
        sourceType: primaryImage.sourceType || null
      } : null,
      whiteBackgroundImage: prepassMeta,
      cadReferenceImage: cadReferenceMeta,
      cadReferenceParameters,
      modelingPrepass: prepassMeta
        ? { used: true, reused: Boolean(whiteBackgroundPrepass?.reused), image: prepassMeta }
        : { used: false, error: whiteBackgroundPrepass?.error || "" },
      modelingCadPrepass: cadReferenceMeta
        ? { used: true, reused: Boolean(cadReferencePrepass?.reused), image: cadReferenceMeta }
        : { used: false, error: cadReferencePrepass?.error || "" },
      summary: `${summaryPrefix}${model.summary || "已根据图片生成可旋转预览的参数化 3D 模型。"}`
    });
  }
  const cadReferenceDrivesModeling = Boolean(cadReferenceMeta?.dataUrl);
  const modelingInputNotes = cadReferenceDrivesModeling
    ? [
        "Input image 1 is the generated CAD structure reference. It is the PRIMARY geometry source for this modeling step. Follow its cleaned silhouette, part boundaries, proportions, openings, seams, axes and simplified depth cues when constructing CAD primitives.",
        "Input image 2 is the original or prepared subject photo. Use it only as secondary evidence for subject identity, view angle, color/material zones and details that the CAD guide preserves. Do not let photographic background, props, shadows, highlights, texture noise or display surfaces override the CAD structure reference.",
        primaryImage?.dataUrl && primaryImage.dataUrl !== modelingDataUrl
          ? "Input image 3 is the original uploaded photo. Use it only to resolve ambiguity after the CAD structure reference and prepared subject input."
          : "",
        "When CAD structure reference and original photo conflict, prefer the CAD structure reference for geometry, object count, footprint, major silhouette and editable part separation."
      ]
    : [
        "Input image 1 is the main modeling subject reference and should drive the final massing, silhouette and scale relationships.",
        primaryImage?.dataUrl && primaryImage.dataUrl !== modelingDataUrl
          ? "Input image 2 is the original uploaded photo. Use it to preserve real view angle cues, material zones and visible depth evidence; do not reintroduce removed background clutter."
          : ""
      ];
  const prompt = [
    "You are gpt-5.5 acting as a pragmatic image-to-CAD modeling assistant for architects and designers.",
    cadReferenceDrivesModeling
      ? "Reference fidelity contract: the CAD structure reference image is the source of truth for geometry. The original upload is secondary evidence for subject identity and color/material zones. Do not redesign, restyle, add ignored props, or convert the subject into another category."
      : "Reference fidelity contract: the uploaded image is the source of truth. First honor whether it is an interior, exterior, floor plan, or object photo; then model only that kind of subject. Do not redesign, restyle, simplify into a generic room, or change an interior photo into an exterior/cutaway box.",
    "Use the pre-modeling vision analysis as the binding scope. Convert only the selected subject/layers into a lightweight parametric 3D scene made from CAD-friendly primitives that match the reference photo's visible camera, layout, major planes and object positions.",
    ...imageModelingIntegratedCadPromptLines("model", enrichedModelingAnalysis?.sourceType || modelingAnalysis?.sourceType || ""),
    ...modelingInputNotes.filter(Boolean),
    "Treat targetShape as the confirmed silhouette. Do not model the rectangular targetBounds as geometry; it is only a rough locator.",
    "This is not photogrammetry. Build a clean editable approximation that preserves the main silhouette, masses, proportions, openings, repeated elements, material zones, and useful CAD footprint.",
    "Prefer boxes, cylinders, spheres and planes. Use meters. Size order is [width, depth, height]. Coordinate system: x = width, y = vertical height, z = depth. Put object centers in position [x,y,z].",
    "CRITICAL SIZE RULE: object.size must always be [width, depth, height], never [width, height, depth]. A facade panel 4m wide x 2.6m high x 0.08m thick must be size [4, 0.08, 2.6]. A roof slab 8m wide x 10m deep x 0.24m thick must be size [8, 10, 0.24]. A column 0.5m x 0.5m x 3m high must be size [0.5, 0.5, 3].",
    "Interior-photo mandatory behavior: if sourceType is interior-photo or the image visibly shows a room, the output MUST be an inside-the-room model. Return sourceType='interior-photo'. Include floor, back/side walls, ceiling or ceiling edge when visible, doors/windows/openings, built-in cabinetry/counters, tables, seats/sofas, shelves, lighting/ceiling features, columns/beams if visible, and the main furniture positions according to the reference image.",
    "Interior-photo camera rule: preserve the reference image's eye-level or near eye-level interior perspective in spacePlan and previewCamera. Do not use an exterior axonometric as the conceptual model. If depth is uncertain, infer conservatively from the photo's floor lines, wall corners, ceiling lines and furniture scale.",
    "Interior-photo quality floor: normally use 24-80 purposeful primitives. A floor plus a few walls and boxes is not acceptable. Separate walls, openings, cabinet runs, countertops, table tops, legs, sofa/seat bases/backs, shelves, ceiling bands and light strips when they are visible or strongly implied.",
    "For interiors: include floor, walls, openings, counters, tables, seats, shelves, fixtures, columns, beams and main furniture if selected by the analysis.",
    "For architectural exterior photos: model the whole building, not a flat poster. Include main mass, side/rear inferred depth, front facade, roof/parapet/eaves, entry, windows/doors, columns/balconies/steps/base/plinth and major material bands. Do not add interior ceiling lights, room furniture, sky, trees, cars, roads or people unless selected by the analysis.",
    "Architecture-exterior quality floor: normally use 32-96 purposeful primitives. A single block with a few window rectangles is not acceptable for a whole building model.",
    "For architecture, separate the model into legible systems: site/base, stacked masses, side depth returns, roof planes or parapets, floor slabs/eaves, facade openings, entry/steps, railings/columns, and major material zones. Use thin depth for facade glass/railings and thin height for roof/slab/eave plates.",
    "For product/object photos: model the confirmed foreground object only. Do not add display props, plates, trays, tabletops, plinths, room floor/walls/background, or generic supports unless the confirmed analysis explicitly marks them includeInModel=true as physically attached structural parts.",
    "For rounded product subjects such as an apple, use multiple ellipsoid/sphere/cylinder primitives to approximate curved body lobes, shoulders, dimples, stem sockets, attached stems and bottom flattening. Never turn the silhouette into a box-shaped room, tray, or open container.",
    "Object-photo quality floor: common products must normally use 8-24 purposeful primitives. One generic body plus one accessory is not acceptable unless the subject is truly that simple.",
    "Every object-photo result must include notes explaining which parts are visible and which are inferred from the single image.",
    "Do not turn shadows, specular highlights, photographic noise, logos, labels or decorative texture patches into standalone geometry unless the analysis explicitly marks them includeInModel=true.",
    "Use 8-24 objects for simple products, 24-80 objects for interiors, and 32-96 objects for architectural exteriors when useful. Add enough objects for a readable model, but avoid noisy tiny decoration.",
    "Every object must use a descriptive, stable snake_case id where practical, and labels should stay human-readable for downstream CAD/export tools.",
    "Do not collapse all geometry into one boolean blob. Keep major editable systems separate: base/site, main masses, roof planes, facade openings, rails, steps, furniture bodies, supports, handles, brackets and repeated modules.",
    "Prefer explicit thickness over infinitely thin decoration. If a detail is only graphic texture, keep it out of geometry.",
    "Return valid JSON only, no markdown. Shape:",
    JSON.stringify({
      whiteModelScene: {
        title: "short Chinese model title",
        sourceType: "object-photo or interior-photo or architecture-photo or floor-plan-reference",
        units: "meters",
        summary: "what was modeled and what remains approximate",
        confidence: 0.72,
        assumptions: ["depth inferred from single image"],
        limitations: ["back side is inferred"],
        spacePlan: {
          roomType: "detected type",
          envelope: "overall envelope or subject envelope",
          keyZones: ["zone"],
          circulation: "if spatial",
          scaleAssumptions: ["scale notes"],
          modelingStrategy: "primitive strategy"
        },
        previewCamera: {
          mode: "interior or orbit",
          position: [2.2, 1.55, 3.2],
          target: [0, 1.35, -1.2],
          note: "interior eye-level preview matching the reference photo when sourceType is interior-photo"
        },
        objects: [
          {
            id: "floor_plate",
            type: "floor",
            shape: "box",
            label: "floor plate",
            size: [8, 6, 0.08],
            position: [0, 0.04, 0],
            rotation: [0, 0, 0],
            color: "#b89f7a",
            layer: "shell",
            material: "wood or stone",
            roughness: 0.7,
            metalness: 0.02,
            opacity: 1,
            note: "visible/inferred"
          }
        ]
      }
    }, null, 2),
    "",
    "Allowed object types: floor, wall, ceiling, column, beam, opening, stair, box, counter, table, seat, shelf, fixture, plant, generic.",
    "Allowed shapes: box, cylinder, sphere, plane.",
    "Keep colors as hex values. Keep all sizes positive. Object count must be at least 24 for interiors, at least 32 for architectural exteriors, and at least 8 for products.",
    "Pre-modeling vision analysis, binding scope:",
    JSON.stringify(enrichedModelingAnalysis, null, 2),
    cadReferenceMeta ? "CAD reference parameters JSON:" : "",
    cadReferenceMeta ? JSON.stringify(cadReferenceParameters, null, 2) : "",
    `Project brief: ${JSON.stringify(brief)}`,
    `User modeling request: ${intent || "Create a CAD-friendly 3D model from this image."}`
  ].join("\n");

  const modelingInputImages = cadReferenceDrivesModeling
    ? [
        { type: "input_image", image_url: cadReferenceMeta.dataUrl },
        { type: "input_image", image_url: modelingDataUrl }
      ]
    : [
        { type: "input_image", image_url: modelingDataUrl }
      ];
  if (primaryImage?.dataUrl && primaryImage.dataUrl !== modelingDataUrl) {
    modelingInputImages.push({ type: "input_image", image_url: primaryImage.dataUrl });
  }
  const payload = {
    model: config.reasoningModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...modelingInputImages
        ]
      }
    ],
    max_output_tokens: 5200
  };

  try {
    const text = await openaiResponsesTextStream(payload, { timeoutMs: 420000, provider: "reasoning" });
    const parsed = await parseModelJsonWithRepair(text, "image-to-CAD model scene");
    const parsedScene = parsed?.whiteModelScene || parsed?.scene || parsed || {};
    const scopedParsed = {
      whiteModelScene: {
        ...parsedScene,
        sourceType: parsedScene.sourceType || parsedScene.source_type || modelingAnalysis.sourceType
      }
    };
    const model = normalizeWhiteModelScene(scopedParsed, { brief, intent, primaryImage: modelingPrimaryImage, modelingAnalysis: enrichedModelingAnalysis });
    return attachWhiteModelCadArtifacts({
      ...model,
      id: `image-model-${Date.now()}`,
      mode: "image-modeling",
      modelingAnalysis: enrichedModelingAnalysis,
      originalSourceImage: primaryImage ? {
        name: primaryImage.name || null,
        type: primaryImage.type || null,
        sourceType: primaryImage.sourceType || null
      } : null,
      whiteBackgroundImage: prepassMeta,
      cadReferenceImage: cadReferenceMeta,
      cadReferenceParameters,
      modelingPrepass: prepassMeta
        ? { used: true, reused: Boolean(whiteBackgroundPrepass?.reused), image: prepassMeta }
        : { used: false, error: whiteBackgroundPrepass?.error || "" },
      modelingCadPrepass: cadReferenceMeta
        ? { used: true, reused: Boolean(cadReferencePrepass?.reused), image: cadReferenceMeta }
        : { used: false, error: cadReferencePrepass?.error || "" },
      summary: `${summaryPrefix}${model.summary || "已根据图片生成可旋转预览的参数化 3D 模型。"}`
    });
  } catch (error) {
    const fallbackObjectAnalysis = knownObjectTemplateAnalysis(enrichedModelingAnalysis, { intent, primaryImage: modelingPrimaryImage });
    if (isReasoningFallbackError(error) && fallbackObjectAnalysis) {
      console.warn(`[image-modeling] final known-object fallback: ${reasoningFallbackReason(error)}`);
      const fallbackScene = commonObjectTemplateSceneFromAnalysis(fallbackObjectAnalysis, { intent, primaryImage: modelingPrimaryImage });
      if (fallbackScene) {
        const model = normalizeWhiteModelScene({ whiteModelScene: fallbackScene }, { brief, intent, primaryImage: modelingPrimaryImage, modelingAnalysis: fallbackObjectAnalysis });
        return attachWhiteModelCadArtifacts({
          ...model,
          id: `image-model-${Date.now()}`,
          mode: "image-modeling",
          modelingAnalysis: {
            ...fallbackObjectAnalysis,
            fallbackModel: true,
            fallbackReason: reasoningFallbackReason(error)
          },
          originalSourceImage: primaryImage ? {
            name: primaryImage.name || null,
            type: primaryImage.type || null,
            sourceType: primaryImage.sourceType || null
          } : null,
          whiteBackgroundImage: prepassMeta,
          cadReferenceImage: cadReferenceMeta,
          cadReferenceParameters,
          modelingPrepass: prepassMeta
            ? { used: true, reused: Boolean(whiteBackgroundPrepass?.reused), image: prepassMeta }
            : { used: false, error: whiteBackgroundPrepass?.error || "" },
          modelingCadPrepass: cadReferenceMeta
            ? { used: true, reused: Boolean(cadReferencePrepass?.reused), image: cadReferenceMeta }
            : { used: false, error: cadReferencePrepass?.error || "" },
          summary: `${summaryPrefix}${model.summary || "端点未返回建模规划，已按已知物体模板生成可编辑基础模型。"}`
        });
      }
    }
    if (!isReasoningFallbackError(error) || !shouldFallbackToSpatialWhiteModel(enrichedModelingAnalysis, { brief, intent, primaryImage: modelingPrimaryImage })) throw error;
    console.warn(`[image-modeling] final model reasoning fallback: ${reasoningFallbackReason(error)}`);
    const fallbackScene = fallbackInteriorWhiteModelSceneFromAnalysis(enrichedModelingAnalysis, {
      brief,
      intent,
      primaryImage: modelingPrimaryImage,
      cadReferenceMeta,
      error
    });
    const model = normalizeWhiteModelScene({ whiteModelScene: fallbackScene }, { brief, intent, primaryImage: modelingPrimaryImage, modelingAnalysis: enrichedModelingAnalysis });
    return attachWhiteModelCadArtifacts({
      ...model,
      id: `image-model-${Date.now()}`,
      mode: "image-modeling",
      modelingAnalysis: {
        ...enrichedModelingAnalysis,
        fallbackModel: true,
        fallbackReason: reasoningFallbackReason(error)
      },
      originalSourceImage: primaryImage ? {
        name: primaryImage.name || null,
        type: primaryImage.type || null,
        sourceType: primaryImage.sourceType || null
      } : null,
      whiteBackgroundImage: prepassMeta,
      cadReferenceImage: cadReferenceMeta,
      cadReferenceParameters,
      modelingPrepass: prepassMeta
        ? { used: true, reused: Boolean(whiteBackgroundPrepass?.reused), image: prepassMeta }
        : { used: false, error: whiteBackgroundPrepass?.error || "" },
      modelingCadPrepass: cadReferenceMeta
        ? { used: true, reused: Boolean(cadReferencePrepass?.reused), image: cadReferenceMeta }
        : { used: false, error: cadReferencePrepass?.error || "" },
      summary: `${summaryPrefix}${model.summary || "端点超时，已先生成可编辑基础室内模型。"}`
    });
  }
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

  const useReasoning = body.thinkingEnabled === true;
  const prompt = useReasoning
    ? [
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
      ].join("\n")
    : buildFastRenderPrompt({
        mode: "plan-render",
        brief,
        intent: imagePrompt,
        referenceCount: 0,
        references: []
      });

  const generated = await thinkThenGenerateImage({
    prompt,
    inputImages: [],
    size: body.size || "1024x1536",
    quality: body.quality || "low",
    title: direction.name || brief.projectName || "space concept",
    mode: "plan-render",
    useReasoning
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
  const requestedMode = normalizeRenderMode(body.mode);
  const allowedRenderModes = new Set([
    "custom",
    "plan-axonometric",
    "plan-axonometric-view",
    "plan-render",
    "panorama",
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
  ]);
  const mode = allowedRenderModes.has(requestedMode) ? requestedMode : body.mode ? "custom" : "plan-render";
  const brief = body.brief || {};
  const intent = String(body.intent || "").trim();
  const primary = body.primaryImage;
  const references = activeReferenceImagesFromBody(body);
  const viewAngleReference = isPlanPaperRenderMode(mode) && body.viewAngleReference?.dataUrl
    ? body.viewAngleReference
    : null;

  if (!primary?.dataUrl && !["custom", "panorama"].includes(mode)) {
    const error = new Error("Missing primary image");
    error.status = 400;
    throw error;
  }

  const requestedSize = body.size || "1024x1536";
  const requestedQuality = body.quality || "low";
  const useReasoning = body.thinkingEnabled === true;
  const useColoredPlanPipeline = false;
  const planInputColorKind = mode === "plan-axonometric"
    ? (isColoredPlanInput(primary, body) ? "colored-floor-plan" : "black-white-line-plan")
    : "";
  let coloredPlanRecord = null;

  if (mode === "plan-axonometric") {
    const viewAngleLine = viewAnglePromptLine(body.planPaperView, mode);
    const viewAngleReferenceLine = viewAngleReferencePromptLine(viewAngleReference, mode);
    const hasPaperViewControl = Boolean(viewAngleReference?.dataUrl || viewAngleLine);
    const coloredPrompt = buildColoredFloorPlanPrompt({
      brief,
      intent,
      planPaperView: body.planPaperView || null,
      viewControlled: hasPaperViewControl
    });
    const coloredGenerated = await thinkThenGenerateImage({
      prompt: [
        coloredPrompt,
        viewAngleLine,
        viewAngleReferenceLine,
        hasPaperViewControl
          ? [
              "VIEW_CONTROLLED_COLORED_PLAN:",
              "The paper-drag control is part of this selected floor-plan workflow step.",
              "Generate the colored floor plan in the selected dragged-paper orientation, preserving the source aspect ratio, crop feeling, projected paper silhouette, yaw, tilt, zoom and pan.",
              "The result must still be a flat colored architectural plan surface: add color semantics and material zones only; do not extrude walls, do not invent wall height, do not make a full axonometric model, and do not make an eye-level render."
            ].join("\n")
          : "",
        "",
        "WORKFLOW_RECOMMENDATION_ONLY:",
        PLAN_WORKFLOW_RECOMMENDATION
      ].filter(Boolean).join("\n"),
      inputImages: viewAngleReference?.dataUrl
        ? [
            {
              dataUrl: viewAngleReference.dataUrl,
              label: "IMAGE 1 PAPER DRAG VIEW LOCK: high-resolution dragged paper view generated from the uploaded plan; final colored floor plan must keep this exact projected paper angle, crop, page placement, silhouette, foreshortening, yaw/tilt, zoom and pan."
            },
            {
              dataUrl: primary.dataUrl,
              label: "IMAGE 2 ORIGINAL LOCKED PLAN: high-resolution floor plan; preserve exact layout, walls, openings, labels, door swings, room relationships and major furniture footprints while adding flat color semantics in the selected paper-drag view."
            }
          ]
        : [{
            dataUrl: primary.dataUrl,
            label: "IMAGE 1 ORIGINAL LOCKED PLAN: high-resolution black-and-white floor plan; preserve exact layout while adding flat top-down color semantics only"
          }],
      size: requestedSize,
      quality: requestedQuality,
      title: "colored floor plan",
      mode: "plan-color",
      preferReferenceEdit: true,
      finalPromptFooter: [
        "INTERMEDIATE_OUTPUT_LOCK:",
        hasPaperViewControl
          ? "Return a clean colored floor plan in the selected paper-drag view only. Keep it as a flat colored plan surface: no wall extrusion, no wall height, no axonometric model and no eye-level render."
          : "Return a clean top-down colored floor plan only. No 3D, no tilt, no perspective, no wall extrusion, no camera change.",
        viewAngleReferenceFinalPromptFooter(viewAngleReference, mode),
        PLAN_WORKFLOW_RECOMMENDATION
      ].filter(Boolean).join("\n"),
      useReasoning
    });
    const colorRecord = await saveGeneratedImage({
      buffer: coloredGenerated.buffer,
      slug: `plan-color-${slugify(brief.projectName || "colored-plan")}`,
      meta: {
        reasoning_model: coloredGenerated.reasoningModel || "preset-only",
        image_model: config.imageModel,
        prompt_library_version: promptLibraryVersion,
        mode: "plan-axonometric",
        workflowId: body.workflowId || null,
        parentImageId: body.parentImageId || null,
        stepMode: "plan-axonometric",
        inputImageType: body.inputImageType || null,
        source_prompt: coloredPrompt,
        prompt: coloredGenerated.prompt || coloredPrompt,
        thinking: coloredGenerated.thinking,
        planPaperView: body.planPaperView || null,
        viewAngleReference: viewAngleReference ? {
          name: viewAngleReference.name || null,
          type: viewAngleReference.type || null,
          viewAngle: viewAngleReference.viewAngle || null,
          targetQuadrilateral: viewAngleReference.targetQuadrilateral || null,
          perspectiveMetrics: viewAngleReference.perspectiveMetrics || null,
          prompt: viewAngleReference.prompt || null
        } : null,
        multiAngleView: null,
        created_at: new Date().toISOString()
      },
      extra: {
        title: "彩色平面图",
        mode: "plan-axonometric",
        prompt: coloredGenerated.prompt || coloredPrompt,
        sourcePrompt: coloredPrompt,
        thinking: coloredGenerated.thinking,
        endpoint: coloredGenerated.endpoint,
        attempt: coloredGenerated.attempt,
        attempts: coloredGenerated.attempts,
        imageApi: coloredGenerated.imageApi,
        actualParams: coloredGenerated.actualParams,
        revisedPrompt: coloredGenerated.revisedPrompt,
        workflowId: body.workflowId || null,
        parentImageId: body.parentImageId || null,
        stepMode: "plan-axonometric",
        inputImageType: body.inputImageType || null,
        pipelineStage: "colored-floor-plan",
        planInputColorKind,
        planPaperView: body.planPaperView || null,
        viewAngleReference: viewAngleReference ? {
          name: viewAngleReference.name || null,
          type: viewAngleReference.type || null,
          viewAngle: viewAngleReference.viewAngle || null,
          targetQuadrilateral: viewAngleReference.targetQuadrilateral || null,
          perspectiveMetrics: viewAngleReference.perspectiveMetrics || null,
          prompt: viewAngleReference.prompt || null
        } : null,
        multiAngleView: null,
        planColorDecision: { recommended: true, reason: PLAN_WORKFLOW_RECOMMENDATION },
        input_count: 1,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      }
    });
    return colorRecord;
  }

  const coloredPlanDirect = false;
  const renderInputImages = mode === "plan-axonometric-view" && viewAngleReference?.dataUrl
    ? [
        {
          dataUrl: viewAngleReference.dataUrl,
          label: "IMAGE 1 PRIMARY COMPOSITION LOCK: high-resolution dragged colored-plan camera base; final output must keep this exact camera, projected quadrilateral, page placement, silhouette, foreshortening, zoom/pan crop and visible frame, as if re-expressing the colored floor plan as a high-precision axonometric view"
        },
        ...(primary?.dataUrl ? [{
          dataUrl: primary.dataUrl,
          label: "IMAGE 2 COLORED FLOOR PLAN SOURCE: high-resolution colored floor plan or plan source; preserve room relationships, wall/opening/furniture footprints, scale, cut-wall logic and material zones while improving axonometric readability"
        }] : [])
      ]
    : mode === "plan-render" && viewAngleReference?.dataUrl
      ? [
          {
            dataUrl: viewAngleReference.dataUrl,
            label: "IMAGE 1 PAPER DRAG REGION LOCK: high-resolution dragged axonometric/plan camera base; use this exact visible crop, projected paper angle, near/far relationship, yaw/tilt, zoom and pan to determine the target zone and camera direction for the final human-eye render"
          },
          ...(primary?.dataUrl ? [{
            dataUrl: primary.dataUrl,
            label: "IMAGE 2 AXONOMETRIC OR PLAN SOURCE: high-resolution spatial guide; preserve the selected or inferred zone, spatial relationships, openings, circulation, furniture/display logic and scale cues while translating it into a realistic effect render"
          }] : [])
        ]
    : [
        ...(coloredPlanRecord ? [{
          dataUrl: imageBufferToDataUrl(await fs.readFile(coloredPlanRecord.file), "image/png"),
          label: "IMAGE 1 COLORED FLOOR PLAN INTERMEDIATE: generated semantic/material top-down plan from step 1; use as the main axonometric source"
        }] : []),
        ...(primary?.dataUrl ? [{
          dataUrl: primary.dataUrl,
          label: coloredPlanDirect
            ? "colored floor plan source, direct-to-3D layout/material reference"
            : firstInputLabel(mode)
        }] : [])
      ];
  const inputCount = renderInputImages.filter((image) => image?.dataUrl).length + references.filter((reference) => reference?.dataUrl).length;

  const prompt = useReasoning
    ? buildRenderPrompt({
        mode,
        brief,
        intent,
        selection: body.selection,
        planPaperView: body.planPaperView,
        multiAngleView: body.multiAngleView,
        viewAngleReference,
        referenceCount: references.length,
        references,
        coloredPlanPipeline: Boolean(coloredPlanRecord),
        coloredPlanRecord,
        coloredPlanDirect
      })
    : buildFastRenderPrompt({
        mode,
        brief,
        intent,
        selection: body.selection,
        planPaperView: body.planPaperView,
        multiAngleView: body.multiAngleView,
        viewAngleReference,
        referenceCount: references.length,
        references,
        coloredPlanPipeline: Boolean(coloredPlanRecord),
        coloredPlanRecord,
        coloredPlanDirect
      });

  const generated = await thinkThenGenerateImage({
    prompt,
    inputImages: [
      ...renderInputImages,
      ...references.map((reference, index) => ({ dataUrl: reference.dataUrl, label: `reference ${index + 1} (${referenceWeightMeta(reference.weight).label}; ${referenceUsageMeta(reference.usage).label})` }))
    ],
    size: requestedSize,
    quality: requestedQuality,
    title: `${mode} render`,
    mode,
    finalPromptFooter: [
      viewAngleReferenceFinalPromptFooter(viewAngleReference, mode, {
        coloredPlanPipeline: Boolean(coloredPlanRecord),
        coloredPlanDirect
      }),
      coloredPlanRecord ? [
        "TWO_STAGE_PIPELINE_FINAL_LOCK:",
        "The advisory chain is: original floor plan -> colored top-down plan -> high-precision axonometric view.",
        "The final image should behave like the colored plan has been re-expressed as an axonometric model from the dragged camera angle."
      ].join("\n") : ""
    ].filter(Boolean).join("\n\n"),
    useReasoning
  });

  const pipeline = coloredPlanRecord ? {
    enabled: true,
    strategy: "先把黑白线稿平面图转成彩色语义平面图，再用彩平、原始线稿和拖拽视角生成高精度轴测图。",
    steps: [
      {
        id: "source-plan",
        title: "原始平面图",
        kind: "Input",
        status: "input",
        description: "锁定原始线稿、房间关系、门窗、家具脚印和文字细节。",
        name: primary?.name || ""
      },
      {
        id: "colored-plan",
        title: "彩色平面图",
        kind: "Intermediate",
        status: "done",
        stepMode: "plan-color",
        url: coloredPlanRecord.url,
        file: coloredPlanRecord.file,
        bytes: coloredPlanRecord.bytes,
        prompt: coloredPlanRecord.prompt || "",
        sourcePrompt: coloredPlanRecord.sourcePrompt || "",
        thinking: coloredPlanRecord.thinking || "",
        endpoint: coloredPlanRecord.endpoint || "",
        imageApi: coloredPlanRecord.imageApi || "",
        actualParams: coloredPlanRecord.actualParams || null,
        revisedPrompt: coloredPlanRecord.revisedPrompt || "",
        createdAt: coloredPlanRecord.createdAt || ""
      },
      {
        id: "axonometric-plan",
        title: "高精度轴测图",
        kind: "Final",
        status: "done",
        stepMode: mode,
        description: "用彩平作为语义图、原图作为细节图、拖拽视角作为镜头锁定生成。"
      }
    ]
  } : null;

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
      planPaperView: body.planPaperView || null,
      viewAngleReference: viewAngleReference ? {
        name: viewAngleReference.name || null,
        type: viewAngleReference.type || null,
        viewAngle: viewAngleReference.viewAngle || null,
        targetQuadrilateral: viewAngleReference.targetQuadrilateral || null,
        perspectiveMetrics: viewAngleReference.perspectiveMetrics || null,
        prompt: viewAngleReference.prompt || null
      } : null,
      multiAngleView: body.multiAngleView || null,
      pipeline,
      planInputColorKind,
      planColorDecision: body.planColorDecision || null,
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
      planPaperView: body.planPaperView || null,
      viewAngleReference: viewAngleReference ? {
        name: viewAngleReference.name || null,
        type: viewAngleReference.type || null,
        viewAngle: viewAngleReference.viewAngle || null,
        targetQuadrilateral: viewAngleReference.targetQuadrilateral || null,
        perspectiveMetrics: viewAngleReference.perspectiveMetrics || null,
        prompt: viewAngleReference.prompt || null
      } : null,
      multiAngleView: body.multiAngleView || null,
      pipeline,
      planInputColorKind,
      planColorDecision: body.planColorDecision || null
    }
  });
}

function firstInputLabel(mode) {
  mode = normalizeRenderMode(mode);
  const labels = {
    custom: "optional primary image",
    "plan-axonometric": "black-and-white or colored floor plan hard layout reference for colored-plan generation",
    "plan-axonometric-view": "colored floor plan or axonometric floor-plan reference",
    "plan-render": "axonometric view or selected plan-based spatial guide",
    panorama: "optional panorama or spatial reference image",
    photo: "site photo",
    whitemodel: "white model screenshot",
    sketch: "concept sketch",
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
  if (/(empty planning result|did not return json|empty model|empty response|no output|空规划|空结果|空响应)/.test(message)) return true;
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

  const generateWithPresetPrompt = async ({ fallbackReason = "", directFast = false } = {}) => {
    const presetPrompt = directFast
      ? [prompt, String(finalPromptFooter || "").trim()].filter(Boolean).join("\n\n")
      : [
          hardenFinalPromptForMode({
            mode: normalizedMode,
            finalPrompt: prompt,
            promptGuard,
            audit: directPromptAudit
          }),
          String(finalPromptFooter || "").trim()
        ].filter(Boolean).join("\n\n");
    const imagePrompt = compactFastImagePrompt({
      mode: normalizedMode,
      prompt: presetPrompt,
      requestedSize,
      quality,
      title
    });
    const generated = await generateImageWithImageProvider({
      prompt: imagePrompt,
      inputImages,
      size: requestedSize,
      quality,
      preferReferenceEdit,
      mode: normalizedMode,
      fastMode: true
    });

    return {
      ...generated,
      prompt: imagePrompt,
      reasoningModel: "preset-only",
      thinking: [
        fallbackReason
          ? `思考融合暂时不可用，已自动使用快速预设提示词继续生图。原因：${fallbackReason}`
          : "已关闭思考模式：本次未做单独的 gpt-5.5 提示词融合，使用快速预设提示词和用户描述直接交给 Image Gen。",
        directFast
          ? "Image-Studio 快速直连：主动关闭思考时不注入长工作流守卫，只发送短预设提示词和输入图片。"
          : "快速兜底：思考融合失败后保留必要工作流守卫并压缩提示词。",
        presetPrompt.length > imagePrompt.length
          ? `快速生图压缩：最终提示词已从 ${presetPrompt.length} 字符压缩到 ${imagePrompt.length} 字符。`
          : `快速生图压缩：最终提示词 ${imagePrompt.length} 字符，未超过快速模式上限。`,
        directPromptAudit.length
          ? `预设提示词加固：已补回 ${directPromptAudit.length} 项关键约束：${directPromptAudit.join("；")}`
          : "预设提示词加固：最终提示词已覆盖当前功能的关键输出边界。"
      ].join("\n")
    };
  };

  if (!useReasoning) {
    return generateWithPresetPrompt({ directFast: true });
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

  let reasoning;
  try {
    const reasoningText = await openaiResponsesTextStream(reasoningPayload, {
      timeoutMs: 240000,
      provider: "reasoning"
    });
    reasoning = parsePromptFusion(reasoningText);
  } catch (error) {
    if (!isReasoningFallbackError(error)) throw error;
    const reason = reasoningFallbackReason(error);
    console.warn(`[image] prompt fusion fallback: ${reason}`);
    return generateWithPresetPrompt({ fallbackReason: reason });
  }
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

function normalizeCutoutCoordinate(value, axisSize = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = numeric > 1 && axisSize > 1 ? numeric / axisSize : numeric;
  return clampNumber(normalized, 0, 1);
}

function normalizeCutoutPoint(point, imageWidth = 0, imageHeight = 0) {
  const rawX = Array.isArray(point) ? point[0] : point?.x;
  const rawY = Array.isArray(point) ? point[1] : point?.y;
  const x = normalizeCutoutCoordinate(rawX, imageWidth);
  const y = normalizeCutoutCoordinate(rawY, imageHeight);
  return x === null || y === null ? null : [x, y];
}

function boundsFromCutoutPoints(points = []) {
  const valid = points.filter((point) => Array.isArray(point) && point.length >= 2);
  if (!valid.length) return null;
  const xs = valid.map((point) => point[0]);
  const ys = valid.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: clampNumber(minX, 0, 1),
    y: clampNumber(minY, 0, 1),
    width: clampNumber(maxX - minX, 0, 1),
    height: clampNumber(maxY - minY, 0, 1)
  };
}

function normalizeCutoutBounds(bounds = {}, imageWidth = 0, imageHeight = 0) {
  const x = normalizeCutoutCoordinate(bounds.x ?? bounds.left ?? bounds.x1, imageWidth);
  const y = normalizeCutoutCoordinate(bounds.y ?? bounds.top ?? bounds.y1, imageHeight);
  const rawWidth = bounds.width ?? (Number.isFinite(Number(bounds.x2)) && Number.isFinite(Number(bounds.x1)) ? Number(bounds.x2) - Number(bounds.x1) : null);
  const rawHeight = bounds.height ?? (Number.isFinite(Number(bounds.y2)) && Number.isFinite(Number(bounds.y1)) ? Number(bounds.y2) - Number(bounds.y1) : null);
  const width = normalizeCutoutCoordinate(rawWidth, imageWidth);
  const height = normalizeCutoutCoordinate(rawHeight, imageHeight);
  if (x === null || y === null || width === null || height === null) return null;
  return {
    x: clampNumber(x, 0, 1),
    y: clampNumber(y, 0, 1),
    width: clampNumber(width, 0.001, 1 - x),
    height: clampNumber(height, 0.001, 1 - y)
  };
}

function polygonFromCutoutBounds(bounds) {
  if (!bounds) return [];
  const x1 = bounds.x;
  const y1 = bounds.y;
  const x2 = clampNumber(bounds.x + bounds.width, 0, 1);
  const y2 = clampNumber(bounds.y + bounds.height, 0, 1);
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

function normalizeAiCutoutAnalysis(value = {}, body = {}) {
  const imageWidth = Number(body.imageWidth || body.primaryImage?.width || 0) || 0;
  const imageHeight = Number(body.imageHeight || body.primaryImage?.height || 0) || 0;
  const rawPolygons = Array.isArray(value.polygons)
    ? value.polygons
    : Array.isArray(value.foreground_polygons)
      ? value.foreground_polygons
      : Array.isArray(value.points)
        ? [{ label: value.subject || "主体", points: value.points }]
        : [];
  const polygons = rawPolygons.slice(0, 6).map((polygon, index) => {
    const rawPoints = Array.isArray(polygon) ? polygon : polygon?.points;
    const points = Array.isArray(rawPoints)
      ? rawPoints.map((point) => normalizeCutoutPoint(point, imageWidth, imageHeight)).filter(Boolean).slice(0, 80)
      : [];
    return {
      label: String(polygon?.label || value.subject || `主体 ${index + 1}`),
      points
    };
  }).filter((polygon) => polygon.points.length >= 3);
  const explicitBounds = normalizeCutoutBounds(value.bounds || value.bounding_box || value.box || {}, imageWidth, imageHeight);
  if (!polygons.length && explicitBounds) {
    polygons.push({ label: String(value.subject || "主体"), points: polygonFromCutoutBounds(explicitBounds) });
  }
  const allPoints = polygons.flatMap((polygon) => polygon.points);
  const bounds = explicitBounds || boundsFromCutoutPoints(allPoints) || { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const holes = Array.isArray(value.holes)
    ? value.holes.map((hole) => {
        const rawPoints = Array.isArray(hole) ? hole : hole?.points;
        return Array.isArray(rawPoints)
          ? rawPoints.map((point) => normalizeCutoutPoint(point, imageWidth, imageHeight)).filter(Boolean).slice(0, 80)
          : [];
      }).filter((points) => points.length >= 3).slice(0, 6)
    : [];
  return {
    subject: String(value.subject || value.subject_label || value.main_subject || "主体"),
    summary: String(value.summary || value.reason || value.selection_reason || ""),
    confidence: clampNumber(Number(value.confidence ?? value.score ?? 0.72) || 0.72, 0, 1),
    bounds,
    polygons,
    holes,
    source: "gpt-5.5-vision",
    model: config.reasoningModel
  };
}

async function analyzeCutoutSubject(body = {}) {
  const primaryImage = body.primaryImage || body.image || {};
  const dataUrl = String(primaryImage.dataUrl || body.dataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) {
    const error = new Error("Missing image data for AI cutout analysis");
    error.status = 400;
    throw error;
  }

  const prompt = [
    "You are a vision segmentation assistant for a design image editor.",
    "Inspect the uploaded image and identify the single main visual subject that should be cut out from the background.",
    "Return a coarse but useful subject silhouette, not a full-scene caption.",
    "Coordinate rules:",
    "- Use normalized coordinates from 0 to 1 relative to the full image.",
    "- x grows left to right, y grows top to bottom.",
    "- Provide one to six polygons. Each polygon should have 12 to 40 points when possible.",
    "- Trace around the visible outer silhouette of the subject. Include protrusions, balconies, arms, furniture legs, plants, roof lines, product edges or other visible subject details.",
    "- Do not include background sky, walls, floor, checkerboard transparency, empty canvas, UI, shadows, or large blank areas unless they are physically part of the subject.",
    "- If the subject has holes, return them in holes as polygons.",
    "Selection rule:",
    "- Choose the dominant foreground object/product/person/building/furniture/space element a designer would naturally want as a transparent cutout.",
    "- If the image is an interior or architecture scene, choose the main foreground built subject or object mass, not the whole rectangular image.",
    "Return valid JSON only, no markdown, in this exact shape:",
    JSON.stringify({
      subject: "short Chinese subject label",
      summary: "one sentence why this subject was selected",
      confidence: 0.0,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      polygons: [
        { label: "主体", points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] }
      ],
      holes: []
    })
  ].join("\n");

  const payload = {
    model: config.reasoningModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ],
    max_output_tokens: 2200
  };

  const text = await openaiResponsesTextStream(payload, { timeoutMs: 180000, provider: "reasoning" });
  const parsed = parseModelJson(text);
  return normalizeAiCutoutAnalysis(parsed, body);
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
    "plan-color": [
      ["彩色平面图输出", /(colored floor plan|彩色平面|彩平|色彩平面)/i],
      ["保持俯视二维", /(top-down|orthographic|2d|俯视|二维|正交)/i],
      ["锁定原始布局", /(preserve|locked|保留|锁定).{0,120}(linework|layout|wall|room|opening|footprint|线稿|布局|墙|房间|开口|脚印)/i],
      ["禁止3D透视", /(no|avoid|不要|禁止).{0,100}(3d|tilt|perspective|extrusion|eye-level|三维|倾斜|透视|挤出|人视角)/i]
    ],
    "plan-axonometric": [
      ["彩色平面图输出", /(colored floor plan|彩色平面|彩平|色彩平面)/i],
      ["锁定原平面线条布局", /(locked|hard|preserve|保留|锁定).{0,140}(linework|layout|room|wall|opening|footprint|plan|线条|布局|房间|墙|开口|脚印)/i],
      ["严格俯视二维", /(top-down|orthographic|2d|俯视|二维|正交)/i],
      ["禁止3D透视/人视角/改布局", /(no|avoid|不要|禁止).{0,160}(3d|extrusion|tilt|perspective|eye-level|human-eye|layout drift|moved|redesigned|三维|挤出|倾斜|透视|人视角|改布局|布局漂移)/i]
    ],
    "plan-axonometric-view": [
      ["轴测图输出", /(axonometric|isometric|axonometric view|轴测|3d floor plan|3d平面)/i],
      ["锁定彩色平面图布局", /(locked|hard|preserve|保留|锁定).{0,140}(colored floor plan|layout|room|wall|opening|footprint|plan|线条|布局|房间|墙|开口|脚印|彩色平面)/i],
      ["正交/弱透视/拖拽视角相机", /(orthographic|isometric|weak-perspective|dragged|view-angle|yaw|pitch|foreshortening|轴测|拖拽|视角)/i],
      ["禁止人视角/改布局/二维平面", /(no|avoid|不要|禁止).{0,160}(eye-level|human-eye|layout drift|moved|redesigned|flat 2d|colored plan|人视角|改布局|布局漂移|二维平面)/i]
    ],
    "plan-render": [
      ["人视角效果图输出", /(eye-level|human-eye|effect render|效果图|人视角)/i],
      ["保留空间关系/选区", /(preserve|保留).{0,100}(spatial|circulation|selected|zone|空间|动线|选区|功能)/i],
      ["前中后景与材料灯光", /(foreground|midground|background|materials|lighting|前景|中景|背景|材料|灯光)/i]
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

function compactFastImagePrompt({ mode, prompt, requestedSize, quality, title }) {
  const text = String(prompt || "").replace(/\n{3,}/g, "\n\n").trim();
  const maxChars = config.fastImagePromptMaxChars;
  if (!text || text.length <= maxChars) return text || "Generate the requested spatial design image.";
  const normalizedMode = normalizeRenderMode(mode);
  const header = [
    "FAST_IMAGE_GENERATION_MODE:",
    `Request title: ${title || "spatial design generation"}.`,
    `Canvas and quality: ${requestedSize}; ${quality}.`,
    finalOutputRuleForMode(normalizedMode)
  ].join("\n");
  const footer = [
    "Fast-mode compression: long hidden workflow templates were intentionally omitted because thinking mode is off.",
    "Use the uploaded input image as the primary visual evidence and follow the selected workflow boundary.",
    "Avoid: no watermark, no logo, no UI overlay, no random readable text, no distorted geometry, no unrelated collage."
  ].join("\n");
  const budget = Math.max(800, maxChars - header.length - footer.length - 4);
  return [header, truncateLogText(text, budget), footer].join("\n");
}

async function generateImageWithImageProvider({ prompt, inputImages, size, quality, preferReferenceEdit = true, mode = "", fastMode = false }) {
  const attempts = [];
  const attemptEvents = [];
  const standardSize = closestStandardImageSize(size);
  const skillAttempts = imageGenSkillMaxAttempts();
  const source = activeImageProviderSource();
  const apiMode = normalizeImageApiMode(source?.apiMode || config.imageApiMode);
  const useNativeAdapter = imageProviderNeedsNativeAdapter(source);
  const nativeApiMode = source?.providerManifest ? "images" : apiMode;
  let nativeEndpointRefreshPromise = null;
  const refreshNativeImageEndpoints = async () => {
    nativeEndpointRefreshPromise ||= refreshImageEndpointSpeeds();
    return nativeEndpointRefreshPromise;
  };
  const engineStatus = imageStudioEngineStatus();
  if (engineStatus.enabled && !useNativeAdapter) {
    attempts.push({
      name: `Image Studio CLI engine ${size}`,
      endpoint: engineStatus.available ? `image-studio-cli:${path.basename(engineStatus.cliPath)}` : "image-studio-cli:missing",
      run: () => runImageStudioEngine({
        prompt,
        inputImages,
        size,
        quality,
        fastMode
      })
    });
  }
  if (useNativeAdapter && nativeApiMode !== "responses") {
    attempts.push({
      name: `Configured Images API adapter ${size}`,
      endpoint: source.baseUrl,
      run: () => openaiCompatibleImagesFromSource({
        prompt,
        inputImages: preferReferenceEdit ? inputImages : [],
        size,
        quality
      }, { timeoutMs: 420000, source })
    });
  }
  if (useNativeAdapter && nativeApiMode !== "images") {
    attempts.push({
      name: `Configured Responses API adapter ${size}`,
      endpoint: source.baseUrl,
      run: () => openaiResponsesImageDirect({
        prompt,
        inputImages,
        size,
        quality,
        useProviderPool: false,
        source
      })
    });
  }
  const fhlSkillStatus = imageStudioFhlSkillStatus();
  if (fhlSkillStatus.enabled && (!engineStatus.required || !engineStatus.available)) {
    attempts.push({
      name: `Image Studio FHL skill ${size}`,
      endpoint: imageStudioFhlEndpointLabel(fhlSkillStatus),
      run: () => runImageStudioFhlSkill({
        prompt,
        inputImages,
        size,
        quality
      })
    });
  }
  const addImageGenerationAttempts = (candidateSize) => {
    if (useNativeAdapter || (engineStatus.required && !engineStatus.allowNativeFallback)) return;
    if (apiMode !== "responses") {
      attempts.push({
        name: `OpenAI-compatible Images API ${candidateSize}`,
        run: async () => {
          await refreshNativeImageEndpoints();
          return openaiCompatibleImagesDirect({
            prompt,
            inputImages: preferReferenceEdit ? inputImages : [],
            size: candidateSize,
            quality
          });
        }
      });
    }
    if (apiMode !== "images") {
      for (let attempt = 1; attempt <= skillAttempts; attempt += 1) {
        attempts.push({
          name: `Responses image_generation tool ${candidateSize} (${attempt}/${skillAttempts})`,
          run: async () => {
            await refreshNativeImageEndpoints();
            return openaiResponsesImageDirect({
              prompt,
              inputImages,
              size: candidateSize,
              quality,
              useProviderPool: false
            });
          }
        });
      }
    } else {
      attempts.push({
        name: `Responses image_generation fallback ${candidateSize}`,
        run: async () => {
          await refreshNativeImageEndpoints();
          return openaiResponsesImageDirect({
            prompt,
            inputImages,
            size: candidateSize,
            quality,
            useProviderPool: false
          });
        }
      });
    }
    if (parseBooleanEnv(process.env.IMAGE_ALLOW_LEGACY_FALLBACK, false)) {
      attempts.push({
        name: `Legacy app image generation ${candidateSize}`,
        run: async () => {
          await refreshNativeImageEndpoints();
          return openaiImagesGenerationDirect({ prompt, size: candidateSize, quality });
        }
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
      endpoint: attempt.endpoint || config.imageProvider.baseUrl,
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
      event.endpoint = result.endpoint || attempt.endpoint || config.imageProvider.baseUrl;
      event.durationMs = Date.now() - started;
      return {
        ...result,
        endpoint: result.endpoint || attempt.endpoint || config.imageProvider.baseUrl,
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
      event.endpoint = attempt.endpoint || config.imageProvider.baseUrl;
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
  const value = String(mode || "").trim();
  if (!value) return "plan-render";
  if (value === "floorplan") return "plan-render";
  if (value === "plan-viewer" || value === "plan-3d-view" || value === "plan-viewer-3d" || value === "floorplan-viewer") return "plan-axonometric";
  if (value === "axonometric-view" || value === "floorplan-axonometric") return "plan-axonometric-view";
  if (value === "design-logic" || value === "design-derivation-plan") return "design-derivation";
  if (value === "360-panorama" || value === "panoramic" || value === "equirectangular") return "panorama";
  if (value === "viewpoint" || value === "camera-viewpoint" || value === "view-transform") return "custom";
  if (value === "white-model-3d" || value === "ai-3d-model" || value === "colored-3d-model" || value === "model-3d") return "image-modeling";
  if (value === "colored-plan" || value === "color-plan" || value === "colored-floor-plan" || value === "color-floor-plan") return "plan-color";
  return value;
}

function isPlanPaperRenderMode(mode) {
  const normalized = normalizeRenderMode(mode);
  return ["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(normalized);
}

const PLAN_WORKFLOW_RECOMMENDATION = "Recommended workflow, advisory only: floor plan -> colored floor plan -> high-precision axonometric view -> selected axonometric region to eye-level effect render. This is a suggestion, not a forced chain; the current selected mode may still be executed directly.";

const PLAN_TO_COLORED_PLAN_FIXED_PROMPT = [
  "FIXED PLAN-TO-COLORED-FLOOR-PLAN PROMPT:",
  "Generate a clean colored architectural floor plan from the uploaded black-and-white floor plan line drawing or existing plan.",
  "Treat the uploaded plan as locked base geometry, not as loose inspiration.",
  "Do not move, delete, simplify, redraw, add or remove any room, wall, opening, door swing, window, stair, fixed fixture or major furniture footprint.",
  "Preserve the original outer contour, wall linework/thickness, room shapes, room adjacency, circulation, zoning, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation.",
  "Add only restrained semantic color fills, room/material/function zones, wet-area cues, circulation clarity, furniture color hierarchy and light flat-shadow readability.",
  "Keep it as a flat colored plan surface. By default use strict top-down orthographic plan view; if a paper-drag / multi-angle view control is provided, present that same flat colored plan surface in the selected paper view.",
  "Do not extrude, render wall height, create an axonometric wall model, create a human-eye render, redesign the layout or turn the result into a realistic 3D floor-plan model."
].join("\n");

const PLAN_TO_AXONOMETRIC_VIEW_PROMPT = [
  "FIXED COLORED-FLOOR-PLAN-TO-AXONOMETRIC PROMPT:",
  "Generate a high-precision axonometric view from the uploaded colored floor plan, floor plan, or existing axonometric floor-plan reference.",
  "Treat the uploaded colored floor plan as locked spatial geometry and semantic material/zoning source, not as loose inspiration.",
  "Do not move, delete, simplify, redraw, add or remove any room, wall, opening, door swing, window, stair, fixed fixture or major furniture footprint; do not crop or rotate away from the supplied dragged view-angle reference when it exists.",
  "Preserve the original outer contour, wall/opening/furniture footprints, room shapes, adjacency, circulation, zoning, visible labels/dimensions when useful, fixed fixtures, relative scale, plan orientation and material zones.",
  "Only re-express the same locked plan geometry as a cleaner high-precision axonometric image: stable orthographic or weak-perspective projection, readable wall height, visible wall thickness, proportional furniture volumes, material clarity, crisp cut walls, controlled shadows, near/far scale and strong spatial depth.",
  "Default camera is a standard architectural axonometric floor-plan view with weak 3D perspective depth: clear near/far scale, slight foreshortening, visible wall thickness and furniture volume while retaining axonometric discipline.",
  "If a dragged paper view-angle reference image is provided, it overrides the default camera: match that reference image's yaw, pitch, crop, rotation, silhouette, foreshortening and near/far edge relationship while still producing a clean high-precision axonometric view in the same visible frame.",
  "Final image must not be an eye-level interior render, not a flat 2D plan, not a redesigned layout, not a default-camera drift and not a decorative scene over geometry."
].join("\n");

const PLAN_TO_COLORED_FLOOR_PLAN_PROMPT = [
  "FIXED PLAN-TO-COLORED-FLOOR-PLAN INTERMEDIATE PROMPT:",
  "Generate a clean colored architectural floor plan from the uploaded black-and-white floor plan line drawing.",
  "This is an intermediate semantic map for a later high-precision axonometric view, not the final axonometric or render output.",
  "Keep a strict top-down orthographic plan view by default; if a dragged paper view control/reference is provided, use that same flat-paper yaw/tilt/crop without extruding, rendering wall height, or creating an eye-level scene.",
  "Preserve the original outer contour, wall linework/thickness, room shapes, room adjacency, openings, door swings, windows, stairs, fixed fixtures, main furniture footprints, labels/dimensions when legible, relative scale and plan orientation exactly.",
  "Add restrained color fills and material cues to clarify room functions, floors, walls, fixed furniture, loose furniture, planting, wet areas and circulation without hiding the original linework.",
  "Use professional interior-plan coloring: light warm floors, neutral walls, subtle material zones, readable furniture colors and low-saturation accents.",
  "Do not redraw, simplify, invent rooms, change furniture layout, remove labels, crop the plan, rotate the plan, add perspective shadows, or turn it into an eye-level render."
].join("\n");

function buildColoredFloorPlanPrompt({ brief = {}, intent = "", planPaperView = null, viewControlled = false } = {}) {
  return [
    PLAN_TO_COLORED_FLOOR_PLAN_PROMPT,
    "",
    "Recommended workflow step 1: floor plan -> colored floor plan.",
    "Purpose of this intermediate: make room functions, furniture zones, wet areas, circulation, wall/door/window logic and material regions easier for the later axonometric step to understand.",
    viewControlled
      ? "The colored plan must remain an accurate flat 2D plan surface, but it should be presented in the selected dragged-paper camera/view. It must not already become a wall-height axonometric model."
      : "The colored plan must remain an accurate top-down 2D plan. It must not already become the axonometric image.",
    planPaperView
      ? viewControlled
        ? "Use the dragged camera angle only as a flat-paper presentation angle; do not extrude walls or create an eye-level scene."
        : "A dragged camera angle may be used later, but ignore it for this intermediate: keep the colored plan top-down so it can serve as a clean semantic layout map."
      : "",
    `Project: ${brief.projectName || "spatial design project"}.`,
    `Space type: ${brief.spaceType || "unspecified"}. Area: ${brief.area || "unspecified"}.`,
    `Designer notes: ${intent || brief.constraints || "lock the uploaded plan layout and clarify it with color only"}.`,
    viewControlled
      ? "Output only the colored floor plan in the selected paper view on a clean neutral background; no UI, no arrows, no mockup frame, no watermark."
      : "Output only the colored floor plan on a clean neutral background; no UI, no arrows, no mockup frame, no watermark."
  ].filter(Boolean).join("\n");
}

function planColorPipelinePromptLine(coloredPlanRecord = null, { hasViewAngleReference = true } = {}) {
  if (!coloredPlanRecord?.url) return "";
  const coloredIndex = hasViewAngleReference ? "2" : "1";
  const originalIndex = hasViewAngleReference ? "3" : "2";
  return [
    "TWO_STAGE_PLAN_PIPELINE:",
    "- The final axonometric view should use the colored floor-plan intermediate as the semantic/material map.",
    `- Input image ${coloredIndex} is the generated colored floor plan from step 1. It locks room functions, material zones, furniture zones, wet areas and circulation readability.`,
    `- Input image ${originalIndex} is the original black-and-white plan and remains available only to verify linework and fine detail.`,
    "- Do not ignore the colored intermediate and jump directly from black-and-white linework to a generic axonometric view."
  ].join("\n");
}

function isColoredPlanInput(primary = {}, body = {}) {
  const analysis = primary.inputAnalysis || body.inputAnalysis || body.primaryImageAnalysis || {};
  const text = [
    primary.sourceType,
    primary.stepMode,
    analysis.key,
    analysis.sourceType,
    analysis.stepMode,
    analysis.label,
    analysis.reason,
    primary.name
  ].filter(Boolean).join(" ").toLowerCase();
  return /(^|[^a-z])(colored-plan|plan-color|color-plan)([^a-z]|$)|彩平|彩色平面|colored.?floor.?plan|colored.?plan|color.?floor.?plan/i.test(text);
}

function needsPlanColorIntermediate(primary = {}, body = {}) {
  if (!primary?.dataUrl) return false;
  if (body.planColorPipeline === true) return true;
  if (body.planColorPipeline === false) return false;
  if (isColoredPlanInput(primary, body)) return false;
  const analysis = primary.inputAnalysis || body.inputAnalysis || body.primaryImageAnalysis || {};
  const text = [
    primary.sourceType,
    analysis.key,
    analysis.label,
    analysis.reason,
    primary.name
  ].filter(Boolean).join(" ").toLowerCase();
  if (/line-plan|cad-screenshot|black.?white|b.?w|黑白|线稿|施工图|图纸线稿/.test(text)) return true;
  return true;
}

function planWorkflowPromptConfig(mode) {
  mode = normalizeRenderMode(mode);
  const map = {
    "plan-axonometric": {
      step: 1,
      label: "平面图转彩色平面图",
      input: "black-and-white architectural floor plan line drawing or colored architectural floor plan",
      output: "clean colored architectural floor plan intermediate, default top-down orthographic view or selected dragged-paper view when provided",
      preserve: "the original outer contour, wall linework/thickness, room shapes, room adjacency, openings, door swings, windows, stairs, circulation, zoning, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation exactly",
      transform: "add restrained semantic color fills, room/function/material zones, wet-area cues, circulation readability and furniture color hierarchy without changing linework",
      camera: "strict top-down orthographic 2D plan camera by default; when a dragged paper view-angle reference is attached, match that same flat-paper yaw/pitch/crop/foreshortening without wall extrusion",
      avoid: "no moved/deleted/simplified/redrawn rooms, no moved walls/openings/door swings, no eye-level render, no axonometric wall model, no 3D extrusion, no unrelated perspective, no layout drift, no invented room arrangement"
    },
    "plan-axonometric-view": {
      step: 2,
      label: "彩色平面图转轴测图",
      input: "colored architectural floor plan, clean floor plan, axonometric floor-plan reference or dragged view-angle base",
      output: "high-precision axonometric floor-plan view with 3D perspective depth",
      preserve: "the original outer contour, wall/opening/furniture footprints, room adjacency, circulation, cut-wall logic, visible labels/dimensions when useful, fixed fixtures, relative scale, plan orientation and material zones",
      transform: "re-express the locked plan geometry as a cleaner high-precision axonometric view with readable wall height, visible wall thickness, proportional furniture volumes, floor/wall material clarity, subtle shadows, near/far depth, spatial hierarchy and a controlled 3D perspective impression",
      camera: "orthographic or weak-perspective axonometric camera with controlled 3D perspective depth; when a dragged paper view-angle reference is attached, match that reference's yaw/pitch/crop/rotation/silhouette/foreshortening instead of a default isometric angle; otherwise keep the full visible plan readable with minimal distortion",
      avoid: "no moved/deleted/simplified/redrawn rooms, no moved walls/openings/door swings, no eye-level render, no flat 2D-only plan, no layout drift, no default-camera drift, no invented room arrangement"
    },
    "plan-render": {
      step: 3,
      label: "轴测图转效果图",
      input: "axonometric view, selected axonometric region, or legacy plan-based spatial reference when explicitly provided",
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
    return "The final result must be a clean colored architectural floor plan: default top-down orthographic view, or the selected dragged-paper flat view when a paper view reference is attached; preserve plan-faithful layout and restrained material/function color zones; not a 3D extrusion, not an axonometric wall model and not an eye-level render.";
  }
  if (normalizedMode === "panorama") {
    return "The final result must be a 2:1 equirectangular 360-degree panorama with seamless horizontal wrap, stable horizon and continuous surrounding space; not a normal single-camera wide-angle render, not a cropped scene and not a visible seam.";
  }
  if (normalizedMode === "materialboard") {
    return "The final result must be a polished visual material/color/FF&E board, not a single eye-level spatial render.";
  }
  if (normalizedMode === "custom") {
    return "The final result must match the artifact type implied by the latest user request, such as render, board, product/mockup, UI/mockup, poster, diagram, edit, outpaint, facade, concept image or design series; do not force an architectural/interior render unless the request is clearly spatial.";
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
      label: "平面图转彩色平面图",
      purpose: "Use the fixed plan-to-colored-floor-plan prompt: treat the black-and-white floor plan or existing plan as locked base geometry and create a clean colored semantic floor plan for later axonometric work.",
      referenceFocus: "Use references only for restrained material/color zoning after the input plan layout is locked; references must never override walls, openings or furniture footprints.",
      preserve: "Preserve the original outer contour, wall linework/thickness, room shapes, adjacency, openings, door swings, windows, stairs, circulation, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation exactly.",
      transform: "Only add colored room/function/material zones, furniture color hierarchy, wet-area cues and circulation readability while keeping a strict top-down orthographic 2D plan."
    },
    "plan-axonometric-view": {
      label: "彩色平面图转轴测图",
      purpose: "Use the fixed colored-plan-to-axonometric prompt: treat the uploaded colored floor plan as locked spatial geometry and semantic zoning, then re-express it as a high-precision axonometric view with 3D perspective depth; when a dragged paper view-angle reference is provided, match that camera angle.",
      referenceFocus: "Use references only for presentation quality, material clarity and readability after the colored floor-plan geometry is locked; references must never override walls, openings, furniture footprints or cut-wall logic.",
      preserve: "Preserve the visible outer contour, wall/opening/furniture footprints, room shapes, adjacency, circulation, cut-wall logic, labels/dimensions when useful, fixed fixtures, relative scale and plan orientation exactly.",
      transform: "Only re-express the original colored floor-plan geometry into a clearer high-precision axonometric view with readable wall height, proportional furniture volumes, floor/wall materials, subtle shadows, near/far depth and readable spatial hierarchy, viewed from the dragged angle when supplied."
    },
    "plan-render": {
      label: "轴测图转效果图",
      purpose: "Generate the final eye-level architecture/interior effect render from a selected axonometric zone or, when no selection exists, from the clearest inferred functional zone.",
      referenceFocus: "Use references for materials, lighting, furniture, display language, palette and atmosphere, without overriding the axonometric spatial guide or target-zone location.",
      preserve: "Preserve the input image's spatial relationship, selected or inferred target zone, circulation, functional logic, key furniture/display arrangement, room adjacency and scale cues.",
      transform: "Translate only that target zone into a realistic human-eye render with a believable camera position, detailed foreground/midground/background, materials, lighting and presentation quality."
    },
    panorama: {
      label: "全景图生成",
      purpose: "Generate a 2:1 equirectangular 360-degree panorama that can be viewed in Pannellum or similar panorama viewers.",
      referenceFocus: "Use references to infer spatial continuity, eye level, material system, lighting mood and wrap-safe composition; they must not be treated as single-view camera references.",
      preserve: "Preserve spatial continuity, major openings, ceiling/floor logic, horizon stability, material language and the sense of one continuous surround environment.",
      transform: "Expand the scene into a seamless 360-degree panorama with wrap-safe left/right edges, stable horizon and continuous architecture or interior environment."
    },
    "plan-color": {
      label: "彩色平面图中间稿",
      purpose: "Convert a black-and-white floor plan into a top-down colored semantic floor plan as an intermediate map for later axonometric generation.",
      referenceFocus: "No style-reference override; the uploaded line drawing is the hard layout source.",
      preserve: "Preserve outer contour, walls, openings, doors, windows, stairs, labels, fixtures, furniture footprints, room adjacency, relative scale and plan orientation exactly.",
      transform: "Add flat restrained color fills and material/function zones only; keep top-down 2D plan grammar."
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
      "Mode optimization - floor plan to colored floor plan:",
      "- Use the fixed plan-to-colored-floor-plan prompt. Treat the uploaded floor plan as locked base geometry, not as loose inspiration.",
      "- Preserve outer contour, wall linework/thickness, room shapes, adjacency, openings, door swings, windows, stairs, circulation, visible labels/dimensions, fixed fixtures and main furniture footprints.",
      "- Keep a strict top-down orthographic plan camera by default; when a dragged paper view is attached, keep that same flat-paper yaw/tilt/crop without extrusion.",
      "- Only add colored room/function/material zones, wet-area cues, furniture color hierarchy and circulation readability.",
      "- Reject any moved wall/opening/furniture, added or missing room, cropped plan, human-eye render, axonometric view, 3D extrusion or redesigned layout."
    ],
    "plan-axonometric-view": [
      "Mode optimization - colored floor plan to high-precision axonometric view:",
      "- Use the fixed colored-plan-to-axonometric prompt. Treat the uploaded colored floor plan as locked spatial geometry and semantic zoning, not as loose inspiration.",
      "- Preserve wall/opening/furniture footprints, room shapes, adjacency, circulation, cut-wall logic, visible labels/dimensions when useful, fixed fixtures and material zones.",
      "- Use an orthographic or weak-perspective axonometric camera by default; if a dragged paper view-angle reference is attached, match that reference's yaw, pitch, foreshortening and visible outline instead.",
      "- Add high-precision axonometric depth: readable wall height, proportional furniture volumes, floor/wall materials, subtle shadows, near/far scale and crisp spatial hierarchy.",
      "- Reject eye-level render, flat 2D plan, cropped or redrawn layout, moved wall/opening/furniture and default-camera drift."
    ],
    "plan-render": [
      "Mode optimization - axonometric guide to final effect render:",
      "- This is step 3 of the current floor-plan workflow: axonometric view or selected axonometric zone to finished human-eye spatial render.",
      "- Use the selected region as the target zone when present; without a selection, infer one clear functional zone and state why it was chosen.",
      "- Preserve room relationships, target-zone location, circulation, adjacency, scale cues and main display/furniture logic.",
      "- Improve success rate by naming camera standing point, view direction, foreground, midground, background, furniture systems, materials, fixtures, lighting and clutter limits.",
      "- The output must make it clear which area of the axonometric guide it represents; avoid full-plan views and leftover diagram symbols."
    ],
    panorama: [
      "Mode optimization - 360 panorama generation:",
      "- Output must be a 2:1 equirectangular panorama for web panorama viewing, not a standard wide-angle or single-camera render.",
      "- Keep the horizon level and continuous; the left and right image edges must wrap seamlessly without visible stitch marks.",
      "- Define viewer eye height, full-surround spatial logic, continuous ceiling/floor/wall planes, and consistent material scale around the entire environment.",
      "- If references exist, use them for spatial language, materials, lighting and atmosphere, then expand them into a coherent surround scene instead of copying one camera angle.",
      "- Avoid fisheye single frames, duplicated doors/windows at the seam, warped verticals, pinched zenith/nadir poles, black borders, labels, UI and watermarks."
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
  if (mode === "custom") {
    return [
      "8) ARTIFACT DECISION: name the exact artifact implied by the latest user request before adding visual details.",
      "9) MODE BOUNDARY: this is open custom generation; do not silently convert product, UI, poster, diagram, board, logo, composite or edit requests into a generic spatial render.",
      "10) PRESERVE: if a primary image exists, preserve only the subject, composition, structure, text, layout or identity the requested artifact depends on.",
      "11) TRANSFORM: apply only the operation the user asked for: generate, edit, expand, mock up, diagram, board, product scene, facade, concept image or spatial render.",
      "12) ARTIFACT GRAMMAR: use the correct grammar for the chosen artifact, such as type hierarchy for posters, component layout for UI, samples for boards, material/contact shadow for products or camera/lens for renders.",
      "13) REFERENCES: read references as evidence and quality direction; do not copy exact compositions, brands, watermarks or accidental artifacts.",
      "14) QUALITY: crisp geometry or layout, readable hierarchy, clean silhouette, believable material or interface behavior and professional finish for the chosen artifact.",
      "15) AVOID: no hidden workflow drift, no forced floor plan/render language, no extra slogans/text, no logos/watermarks and no unrelated narrative objects."
    ];
  }
  if (mode === "plan-axonometric") {
    return [
      "8) LOCKED PLAN GEOMETRY: preserve outer contour, wall linework/thickness, room shapes, room adjacency, openings, door swings, windows, stairs, circulation, visible labels/dimensions, fixed fixtures, main furniture footprints, relative scale and plan orientation.",
      "9) CAMERA: strict top-down orthographic colored floor-plan camera by default; if a dragged paper view is attached, match that flat-paper yaw/tilt/crop, with no extrusion and no human-eye camera.",
      "10) MATERIALS: add restrained color/material/function zones only on the original locked footprints.",
      "11) LIGHTING: use flat plan readability and very subtle shadow cues only; avoid volumetric render lighting.",
      "12) PALETTE: restrained coordinated material palette that supports plan readability without hiding the original layout.",
      "13) DETAIL DENSITY: enough colored furniture, fixtures and surface zones to read scale, but no clutter or new objects that alter circulation.",
      "14) QUALITY: clean colored floor plan intermediate, stable geometry, plan-faithful layout, readable room/material/function zones and no layout drift.",
      "15) AVOID: no moved walls/openings/furniture, no added or missing rooms, no simplified/redesigned plan, no 3D extrusion, no axonometric wall model, no final eye-level render, no unrelated perspective."
    ];
  }
  if (mode === "plan-axonometric-view") {
    return [
      "8) LOCKED COLORED FLOOR-PLAN GEOMETRY: preserve outer contour, wall/opening/furniture footprints, room shapes, room adjacency, circulation, cut-wall logic, visible labels/dimensions when useful, fixed fixtures, relative scale, material zones and plan orientation.",
      "9) CAMERA: orthographic or weak-perspective axonometric floor-plan view with controlled 3D perspective depth; no human-eye camera. If a dragged paper view-angle reference is attached, its yaw, pitch, crop, silhouette, rotation, foreshortening and near/far edge scale override the default isometric angle; otherwise keep the complete visible plan readable.",
      "10) MATERIALS: keep believable floor, wall, furniture and built-in material cues on the original locked footprints.",
      "11) LIGHTING: clean even render lighting that clarifies volumes; subtle shadows only; avoid dramatic eye-level lighting or strong sun glare.",
      "12) PALETTE: restrained coordinated material palette that supports axonometric readability without hiding the original structure.",
      "13) DETAIL DENSITY: enough proportional furniture volume, fixtures and surface detail to read scale, but no clutter or new objects that alter circulation.",
      "14) QUALITY: high-precision axonometric floor-plan view, crisp cut walls, stable projected footprint, readable wall height, controlled near/far depth and no layout drift.",
      "15) AVOID: no moved walls/openings/furniture, no added or missing rooms, no simplified/redesigned plan, no flat 2D-only plan, no final eye-level render and no default-camera drift."
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
      "8) TARGET ZONE: use the selected red-box area when present; otherwise infer one clear functional zone from the axonometric guide and make that source area explicit.",
      "9) CAMERA: human-eye architectural/interior camera from a believable standing point inside or just outside the target zone; no full-plan or top-down camera.",
      "10) SPATIAL FIDELITY: preserve room adjacency, circulation, openings, major furniture/display logic and scale cues from the axonometric guide.",
      "11) SCENE GRAMMAR: translate the zone into foreground, midground and background with clear view direction and depth.",
      "12) MATERIALS: use references for finish language only after target-zone geometry is stable.",
      "13) LIGHTING: controlled render lighting that clarifies the selected space and does not conflict with visible openings.",
      "14) QUALITY: realistic client-presentation effect render with crisp geometry and no plan-symbol residue.",
      "15) AVOID: no blueprint strokes, no plan labels, no diagram symbols, no unclear source zone, no copied reference room, no distorted perspective."
    ];
  }
  if (mode === "panorama") {
    return [
      "8) PANORAMA FORMAT: output a 2:1 equirectangular 360-degree panorama for panorama viewers.",
      "9) CAMERA: maintain a stable eye-level or intentionally stated viewpoint with full surround continuity; do not render a normal single-view wide-angle frame.",
      "10) SPATIAL CONTINUITY: wrap the room or environment continuously around the viewer with seamless left/right edges and a level horizon.",
      "11) MATERIALS: preserve coherent material scale and edge logic all around the surround space.",
      "12) LIGHTING: keep lighting direction, exposure and atmosphere continuous across the full 360-degree wrap.",
      "13) DETAIL DENSITY: enough contextual detail to read the environment from every direction, but no duplicated seam objects or accidental repeated doors/windows.",
      "14) QUALITY: seamless panorama with stable horizon, no stitch seam, no pinched poles, no black borders and no cropped normal camera look.",
      "15) AVOID: no fisheye single frame, no standard wide render, no visible stitch lines, no UI, no text overlays."
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
  if (mode === "custom") {
    return "Required visual controls: identify the requested artifact type first, then set the relevant controls for that artifact. Use layout and typography controls for posters/UI/diagrams, material and shadow controls for products/boards, camera and perspective controls for renders, and preserve/transform boundaries that match the user request; avoid forcing a spatial-render grammar when the artifact is not spatial.";
  }
  if (mode === "plan-color") {
    return "Required visual controls: strict top-down orthographic colored floor plan, locked original linework/layout, preserved labels/dimensions where legible, low-saturation material/function color fills, readable furniture/wet-area/circulation zones and avoid-lines for no 3D/no tilt/no perspective/no layout drift.";
  }
  if (mode === "plan-axonometric") {
    return "Required visual controls: locked input plan invariants, original linework/layout preservation, default top-down or attached dragged-paper colored-plan camera, room/function/material color zones, wet-area and circulation readability, preserved labels/dimensions where legible and avoid-lines for no moved walls/no missing rooms/no 3D extrusion/no axonometric wall model/no eye-level view/no layout drift.";
  }
  if (mode === "plan-axonometric-view") {
    return "Required visual controls: locked colored floor-plan invariants, wall/opening/furniture footprint preservation, orthographic/weak-perspective axonometric camera, dragged view-angle reference matching when provided, stable projected footprint, readable wall height, proportional furniture volumes, material cues, controlled near/far 3D perspective depth, even render lighting and avoid-lines for no moved walls/no missing rooms/no eye-level view/no layout drift/no default-camera drift.";
  }
  if (mode === "materialboard") {
    return "Required visual controls: board composition, material samples, texture close-ups, color swatches, lighting mood, FF&E references, visual hierarchy and avoid-lines for no text/logos/watermarks.";
  }
  if (mode === "designseries") {
    return "Required visual controls: project DNA, spatial sequence, field/function matrix, per-image role, adjacency cues, recurring signatures, shared material system, shared palette, shared lighting logic, camera rhythm, render finish and avoid-lines for no unrelated style drift/no same-angle variations/no repeated hero composition.";
  }
  if (mode === "plan-render") {
    return "Required visual controls: target zone selection or inferred functional zone, explicit source-area note, believable eye-level camera standing point, preserved axonometric adjacency/circulation/scale cues, foreground/midground/background, material and lighting system, and avoid-lines for no full-plan view/no plan symbols/no unclear source zone.";
  }
  if (mode === "panorama") {
    return "Required visual controls: 2:1 equirectangular panorama, stable horizon, seamless left/right wrap, continuous 360-degree spatial logic, consistent material scale around the full surround, and avoid-lines for no fisheye single frame/no visible stitch seam/no black borders/no standard wide render.";
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
    ? "clean colored architectural floor plan"
    : mode === "plan-axonometric-view"
    ? "high-precision axonometric view of the colored floor plan"
    : mode === "plan-render"
    ? "final eye-level architecture/interior effect render"
    : mode === "panorama"
    ? "2:1 equirectangular 360-degree panorama"
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
  const outputDir = generatedDirectory();
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `${Date.now()}-${slug}-${randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(outputDir, fileName);
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
  if (mode === "custom") {
    return "Output must match the artifact type implied by the latest user request, such as render, product/mockup, UI/mockup, poster, diagram, board, edit, outpaint, facade, concept image or design series; do not force a spatial render unless the request is clearly spatial.";
  }
  if (mode === "plan-color") {
    return "Output must be a clean top-down colored architectural floor plan intermediate: preserve the uploaded linework layout exactly, add flat material/function color zones, and do not create 3D, tilt, perspective, wall extrusion or an eye-level render.";
  }
  if (mode === "plan-axonometric") {
    return "Output must be a clean colored architectural floor plan from the locked uploaded plan geometry: default top-down orthographic view, or the selected dragged-paper flat view when a paper view reference is attached; preserve linework/layout relationships, restrained semantic material/function color zones and readable furniture/wet-area/circulation zones; not a 3D extrusion, not an axonometric wall model, not an eye-level render and not a redesigned layout.";
  }
  if (mode === "plan-axonometric-view") {
    return "Output must be a high-precision axonometric view from the locked uploaded colored floor-plan geometry: orthographic/weak-perspective view with controlled 3D perspective depth, preserved visible crop range, preserved wall/opening/furniture footprints, readable wall height, proportional furniture volumes and materials; use the dragged paper view-angle reference when attached instead of a default isometric camera; not a flat 2D plan, not an eye-level render and not a redesigned layout.";
  }
  if (mode === "plan-render") {
    return "Output must be a final human-eye architecture/interior effect render derived from the selected or inferred zone of an axonometric view or plan-based spatial guide; it must be clear which area it represents; not a diagram, not a floor plan, not a collage.";
  }
  if (mode === "panorama") {
    return "Output must be a 2:1 equirectangular 360-degree panorama with stable horizon, seamless horizontal wrap and continuous surrounding space for Pannellum-style viewing; not a normal single-camera wide-angle render, not a cropped scene and not a visible seam.";
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
  if (mode === "plan-color") return "Create a clean top-down colored architectural floor plan intermediate from the uploaded black-and-white plan.";
  if (mode === "plan-axonometric") return "Create a clean colored architectural floor plan intermediate for a professional spatial designer.";
  if (mode === "plan-axonometric-view") return "Create a polished high-precision axonometric view from the provided colored floor plan for a professional spatial designer.";
  if (mode === "plan-render") return "Create a realistic human-eye architecture/interior effect render from the provided axonometric view or plan-based spatial guide.";
  if (mode === "panorama") return "Create a seamless 2:1 equirectangular 360-degree panorama suitable for Pannellum-style viewing.";
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
  if (mode === "custom") {
    return "Quality target: artifact-appropriate finish with the correct grammar for the requested output type; if the user asked for a board, poster, UI, product, diagram or mockup, optimize layout, hierarchy, legibility and visual clarity instead of spatial-render polish.";
  }
  if (mode === "plan-color") {
    return "Quality target: accurate colored floor plan intermediate, top-down only, original linework readable, room/material/function zones clear, no 3D, no tilted camera, no redesigned layout and no lost labels.";
  }
  if (mode === "plan-axonometric") {
    return "Quality target: clean colored architectural floor plan, locked plan-faithful layout, unchanged wall/opening/furniture footprints, default top-down or attached dragged-paper flat view, readable room/material/function zones, legible furniture and wet-area cues, no 3D extrusion, no axonometric wall model, no eye-level render and no layout drift.";
  }
  if (mode === "plan-axonometric-view") {
    return "Quality target: high-precision axonometric floor-plan view, locked colored-plan layout, unchanged wall/opening/furniture footprints, orthographic/weak-perspective projection with controlled 3D perspective depth, dragged-angle matching when provided, visible-plan/cropped-range readability, readable wall height, visible wall thickness, proportional furniture volumes, believable material cues, clean lighting, near/far hierarchy, no layout drift and no default-camera drift.";
  }
  if (mode === "plan-render") {
    return "Quality target: final human-eye architecture/interior effect render, faithful to the input axonometric view or plan guide, clear target zone, believable camera standing point, believable scale, detailed foreground/midground/background, controlled lighting, no plan-symbol residue and crisp client-presentation finish.";
  }
  if (mode === "panorama") {
    return "Quality target: seamless 2:1 equirectangular 360-degree panorama with stable horizon, wrap-safe edges, continuous surround space, no visible stitch seam, no fisheye single-frame look, no black borders and no accidental seam duplicates.";
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

function normalizedViewAngle(view = null) {
  const wrap = (value, fallback) => {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : fallback;
    return Math.round(((base % 360) + 360) % 360);
  };
  const zoom = Number(view?.zoom);
  const panX = Number(view?.panX);
  const panY = Number(view?.panY);
  return {
    yaw: wrap(view?.yaw, 332),
    pitch: wrap(view?.pitch, 56),
    zoom: Number.isFinite(zoom) ? Math.max(0.45, Math.min(3.2, zoom)) : 1,
    panX: Number.isFinite(panX) ? Math.round(Math.max(-80, Math.min(80, panX))) : 0,
    panY: Number.isFinite(panY) ? Math.round(Math.max(-80, Math.min(80, panY))) : 0
  };
}

function viewAnglePromptLine(planPaperView = null, mode = "custom") {
  if (!isPlanPaperRenderMode(mode)) return "";
  if (!planPaperView || typeof planPaperView !== "object") return "";
  const view = normalizedViewAngle(planPaperView);
  const normalizedMode = normalizeRenderMode(mode);
  const operation = normalizedMode === "plan-render"
    ? "axonometric-view region to human-eye effect-render conversion"
    : normalizedMode === "plan-axonometric-view"
      ? "colored-floor-plan to axonometric-view conversion"
      : "plan-to-colored-floor-plan conversion";
  const target = normalizedMode === "plan-render"
    ? "translating the selected or inferred axonometric/plan zone into a final human-eye render"
    : normalizedMode === "plan-axonometric-view"
      ? "re-expressing the locked colored floor plan as a clear axonometric view"
      : "converting the locked floor plan into the colored floor plan";
  const finalImage = normalizedMode === "plan-render"
    ? "a realistic eye-level effect render of the corresponding visible zone"
    : normalizedMode === "plan-axonometric-view"
      ? "a cleaner axonometric view of the same colored floor plan"
      : "a clean colored floor plan in the same flat paper view";
  if (normalizedMode === "plan-render") {
    return `PLAN_PAPER_VIEW_CONTROL: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}. This control is only for ${operation}: use this exact paper/camera angle, zoom and crop offset when ${target}. The dragged view determines the source zone, near/far direction and composition bias for ${finalImage}; it must not be ignored in favor of a generic full-plan or default isometric view. Never render the control itself, arrows, markers, UI overlays or labels.`;
  }
  return `PLAN_PAPER_VIEW_CONTROL: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}. This control is only for ${operation}: use this exact paper/camera angle, zoom and crop offset when ${target}. The final image should look like the dragged flat paper view after the printed plan has been replaced by ${finalImage}. This dragged view overrides any generic/default isometric, top-down, complete-plan or auto-centered camera language. Never render the control itself, arrows, markers, UI overlays or labels.`;
}

function viewAngleReferencePromptLine(viewAngleReference = null, mode = "custom", options = {}) {
  const normalizedMode = normalizeRenderMode(mode);
  if (!isPlanPaperRenderMode(normalizedMode) || !viewAngleReference?.dataUrl) return "";
  if (normalizedMode === "plan-render") {
    const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
    const clientPrompt = String(viewAngleReference.prompt || "").trim();
    const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
    const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
    const referenceWidth = Number(viewAngleReference.viewAngle?.referenceWidth || 0);
    const referenceHeight = Number(viewAngleReference.viewAngle?.referenceHeight || 0);
    const sourceWidth = Number(viewAngleReference.viewAngle?.sourceWidth || 0);
    const sourceHeight = Number(viewAngleReference.viewAngle?.sourceHeight || 0);
    const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
    return [
      "PLAN_RENDER_PAPER_VIEW_REFERENCE_IMAGE:",
      "- Treat this as a reference-image edit/composition-lock task, not a loose style-reference task.",
      "- Input image 1 is the system-rendered high-resolution dragged axonometric/plan view. It is the source-zone/crop/near-far authority for the final eye-level effect render.",
      "- Input image 2 is the original axonometric view or plan-based spatial guide. It is the geometry/detail authority: zone location, room relationships, openings, circulation, main furniture/display logic and scale cues.",
      referenceWidth && referenceHeight ? `- Input image 1 resolution: ${referenceWidth}x${referenceHeight}${frameText ? `, output crop frame ${frameText}` : ""}. Preserve the same visible crop range when deciding the target zone.` : "",
      sourceWidth && sourceHeight ? `- Original spatial guide resolution available to verify details: ${sourceWidth}x${sourceHeight}. Use this detail source whenever the dragged base is visually compressed.` : "",
      `- Paper view lock from input image 1: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}. Use its visible crop, near/far edge relationship, rotation and vertical compression to infer the render's source zone and camera direction.`,
      quadText ? `- Target visible area from input image 1: ${quadText}. Do not render zones outside this visible/cropped source area unless the user selected them with a red box.` : "",
      perspectiveText ? `- Perspective scale cue from paper view: ${perspectiveText}. Use it to decide foreground/background relationship in the final render.` : "",
      "- Required visual operation: translate the selected or inferred zone from the dragged axonometric/plan view into a realistic human-eye architecture/interior effect render.",
      "- Priority order if constraints conflict: 1) red-box selection when present, 2) visible source zone/crop from input image 1, 3) spatial/detail logic from input image 2, 4) materials and render polish.",
      "- Do not output the flat paper view, blueprint lines, plan symbols, UI arrows, control handles or an entire full-plan camera.",
      clientPrompt ? `- Client angle note: ${clientPrompt}` : ""
    ].filter(Boolean).join("\n");
  }
  if (normalizedMode === "plan-axonometric-view") {
    const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
    const clientPrompt = String(viewAngleReference.prompt || "").trim();
    const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
    const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
    const referenceWidth = Number(viewAngleReference.viewAngle?.referenceWidth || 0);
    const referenceHeight = Number(viewAngleReference.viewAngle?.referenceHeight || 0);
    const sourceWidth = Number(viewAngleReference.viewAngle?.sourceWidth || 0);
    const sourceHeight = Number(viewAngleReference.viewAngle?.sourceHeight || 0);
    const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
    return [
      "PLAN_AXONOMETRIC_VIEW_REFERENCE_IMAGE:",
      "- Treat this as a reference-image edit/composition-lock task, not a loose style-reference task.",
      "- Input image 1 is the system-rendered high-resolution dragged colored-floor-plan view-angle base. It is the NON-NEGOTIABLE camera/crop/silhouette authority for the final axonometric image.",
      "- Input image 2 is the original high-resolution colored floor plan or plan source. It is the geometry/material/detail authority: room relationships, walls, openings, cut-wall logic, furniture footprints, material zones and circulation.",
      referenceWidth && referenceHeight ? `- Input image 1 resolution: ${referenceWidth}x${referenceHeight}${frameText ? `, output crop frame ${frameText}` : ""}. Preserve the same visible crop range.` : "",
      sourceWidth && sourceHeight ? `- Original colored-plan resolution available to verify details: ${sourceWidth}x${sourceHeight}. Use this detail source whenever the angled base is visually compressed.` : "",
      `- Camera lock from input image 1: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}. Match its apparent paper silhouette, crop offset, near/far edge relationship, foreshortening, rotation and vertical compression in the final axonometric output.`,
      quadText ? `- Target projected silhouette from input image 1: ${quadText}. Align the final floor slab/base-wall footprint to this quadrilateral; do not use a default rectangle as the final silhouette.` : "",
      perspectiveText ? `- Forced perspective scale cue: ${perspectiveText}. The near edge, near walls and near furniture must be visibly larger/thicker; the far edge must be visibly smaller/shorter.` : "",
      "- Required visual operation: keep input image 1 as the camera plate and re-render the same colored floor-plan geometry into a clearer axonometric view. Do not choose a new camera because it looks clearer or more complete.",
      "- Priority order if constraints conflict: 1) camera/crop/silhouette from input image 1, 2) colored floor-plan geometry from input image 2, 3) materials and render polish. Never sacrifice item 1 to improve item 2 or 3.",
      "- Do not recentre, unrotate, unskew, auto-zoom-out, show the full plan, flatten into a 2D plan, or expand the plan beyond the visible range in input image 1.",
      "- Do not render the UI, arrow buttons, control handles, labels, sliders, dotted canvas or the flat paper reference itself as the final subject.",
      clientPrompt ? `- Client angle note: ${clientPrompt}` : ""
    ].filter(Boolean).join("\n");
  }
  const coloredPlanPipeline = Boolean(options.coloredPlanPipeline);
  const coloredPlanDirect = Boolean(options.coloredPlanDirect);
  const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
  const clientPrompt = String(viewAngleReference.prompt || "").trim();
  const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
  const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
  const referenceWidth = Number(viewAngleReference.viewAngle?.referenceWidth || 0);
  const referenceHeight = Number(viewAngleReference.viewAngle?.referenceHeight || 0);
  const sourceWidth = Number(viewAngleReference.viewAngle?.sourceWidth || 0);
  const sourceHeight = Number(viewAngleReference.viewAngle?.sourceHeight || 0);
  const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
  return [
    "PLAN_PAPER_VIEW_REFERENCE_IMAGE:",
    "- Treat this as a reference-image edit/composition-lock task, not a loose style-reference task.",
    "- Input image 1 is the system-rendered high-resolution dragged paper view-angle base. It is the NON-NEGOTIABLE camera/crop/silhouette authority for the final colored floor-plan image.",
    coloredPlanPipeline
      ? "- Input image 2 is the generated colored top-down floor-plan intermediate. It is the semantic/material/room-function authority and should be re-presented in the selected dragged paper view."
      : coloredPlanDirect
        ? "- Input image 2 is the uploaded colored top-down floor plan. It is already the semantic/material/room-function authority and should be re-presented directly in the selected dragged paper view."
      : "- Input image 2 is the original high-resolution clean top-down floor plan. It is the layout-detail authority only: linework clarity, labels, room relationships, walls, openings, door swings and major furniture footprints.",
    coloredPlanPipeline
      ? "- Input image 3 is the original high-resolution clean top-down floor plan. It is the fine linework/detail authority only and must not reset the final camera."
      : "",
    referenceWidth && referenceHeight ? `- Input image 1 resolution: ${referenceWidth}x${referenceHeight}${frameText ? `, output crop frame ${frameText}` : ""}. Preserve the same visible crop range.` : "",
    sourceWidth && sourceHeight ? `- Original layout resolution available to verify details: ${sourceWidth}x${sourceHeight}. Use this detail source whenever the angled base is visually compressed.` : "",
    `- Camera lock from input image 1: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}. Match its apparent paper silhouette, crop offset, near/far edge relationship, foreshortening, rotation and vertical compression in the final colored floor-plan output.`,
    quadText ? `- Target projected silhouette from input image 1: ${quadText}. Align the final colored plan sheet to this quadrilateral; do not use the unprojected rectangle from input image 2 as the final silhouette.` : "",
    perspectiveText ? `- Forced perspective scale cue: ${perspectiveText}. The near edge and nearby printed linework/material zones should read larger; the far edge should read smaller/shorter.` : "",
    "- Required visual operation: keep input image 1 as the camera plate and replace the flat printed black-and-white plan content on that plate with a clean colored floor-plan surface. Do not choose a new camera because it looks clearer or more complete.",
    "- Generate by recoloring and clarifying the same plan content inside input image 1, driven by input image 2. Keep the same camera, same crop, same page placement and same outer projected quadrilateral as input image 1.",
    "- Priority order if constraints conflict: 1) camera/crop/silhouette from input image 1, 2) visible wall/opening/furniture layout from input image 2, 3) materials and render polish. Never sacrifice item 1 to improve item 2 or 3.",
    "- Do not let input image 2 reset the camera back to default top-down/isometric. Do not recentre, unrotate, unskew, auto-zoom-out, show the full plan, or expand the plan beyond the visible range in input image 1.",
    "- Do not render the UI, arrow buttons, control handles, labels, sliders, dotted canvas or the flat paper reference itself as the final subject.",
    clientPrompt ? `- Client angle note: ${clientPrompt}` : ""
  ].filter(Boolean).join("\n");
}

function targetQuadrilateralPromptText(quad = null) {
  if (!quad || typeof quad !== "object") return "";
  const keys = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  const points = keys.map((key) => {
    const point = quad[key];
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
    return `${key}=(${x.toFixed(3)},${y.toFixed(3)})`;
  }).filter(Boolean);
  return points.length === keys.length ? points.join(", ") : "";
}

function perspectiveMetricsPromptText(metrics = null) {
  if (!metrics || typeof metrics !== "object") return "";
  const nearEdge = String(metrics.nearEdge || "").trim();
  const farEdge = String(metrics.farEdge || "").trim();
  const nearFarScaleRatio = Number(metrics.nearFarScaleRatio);
  const sideScaleRatio = Number(metrics.sideScaleRatio);
  const parts = [];
  if (nearEdge && farEdge) parts.push(`nearEdge=${nearEdge}, farEdge=${farEdge}`);
  if (Number.isFinite(nearFarScaleRatio)) parts.push(`near/far edge scale ratio about ${nearFarScaleRatio.toFixed(2)}x`);
  if (Number.isFinite(sideScaleRatio)) parts.push(`side depth ratio about ${sideScaleRatio.toFixed(2)}x`);
  return parts.join("; ");
}

function viewAngleReferenceFinalPromptFooter(viewAngleReference = null, mode = "custom", options = {}) {
  const normalizedMode = normalizeRenderMode(mode);
  if (!isPlanPaperRenderMode(normalizedMode) || !viewAngleReference?.dataUrl) return "";
  if (normalizedMode === "plan-render") {
    const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
    const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
    const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
    const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
    return [
      "NON_NEGOTIABLE_PLAN_RENDER_VIEW_LOCK:",
      "Input image 1 is the high-resolution dragged axonometric/plan paper view and must control source-zone crop, near/far direction, visible area and composition bias for the final human-eye effect render.",
      "Input image 2 is the original axonometric or plan-based spatial guide and must control spatial logic, room/zone relationships, openings, circulation, furniture/display arrangement and scale cues.",
      `Match input image 1 paper view when inferring the source zone: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}.`,
      frameText ? `Keep the output crop/frame ratio from the current generation setting: ${frameText}.` : "",
      quadText ? `Use this projected visible area as the source-zone boundary unless a red-box selection overrides it: ${quadText}.` : "",
      perspectiveText ? `Use this paper-view perspective cue for foreground/background relationship: ${perspectiveText}.` : "",
      "If any earlier prompt text says default full-plan camera, full axonometric view, or unrelated render angle, ignore that text whenever it conflicts with input image 1 or the user's red-box selection.",
      "Final image must be a realistic human-eye architecture/interior effect render of the selected or inferred zone. It must not reproduce the flat paper view, blueprint lines, UI arrows, whole plan or diagram symbols."
    ].filter(Boolean).join("\n");
  }
  if (normalizedMode === "plan-axonometric-view") {
    const coloredPlanPipeline = Boolean(options.coloredPlanPipeline);
    const coloredPlanDirect = Boolean(options.coloredPlanDirect);
    const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
    const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
    const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
    const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
    return [
      "NON_NEGOTIABLE_VIEW_LOCK:",
      "Input image 1 is the high-resolution axonometric/camera base and must control the final camera angle, crop, silhouette, page placement, projected quadrilateral and foreshortening.",
      coloredPlanPipeline
        ? "Input image 2 is the generated colored floor-plan intermediate and must control room/material/furniture semantic reading; input image 3 is the clean original floor-plan reference only and must preserve readable details without pulling the result back to a default isometric view."
        : coloredPlanDirect
          ? "Input image 2 is the uploaded colored floor-plan reference and must directly control layout, room/material/furniture semantic reading and fine detail without pulling the result back to a default isometric view."
          : "Input image 2 is the high-resolution clean colored floor-plan reference only and must preserve readable details without pulling the result back to a default isometric view.",
      `Match input image 1 camera: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}.`,
      frameText ? `Keep the output crop/frame ratio from the current generation setting: ${frameText}.` : "",
      quadText ? `Align the floor slab and wall-base footprint to this projected quadrilateral: ${quadText}.` : "",
      perspectiveText ? `Preserve perspective scale: ${perspectiveText}; near side larger, far side smaller.` : "",
      "If any earlier prompt text says complete plan, default isometric, top-down, no crop or no rotation, ignore that earlier text whenever it conflicts with input image 1.",
      "Final image must be a clean high-precision axonometric floor-plan view occupying the same projected angle and visible crop as input image 1, with walls/furniture re-expressed from input image 2. It should read as input image 1 transformed into a clearer axonometric model, not as a newly composed scene."
    ].filter(Boolean).join("\n");
  }
  if (normalizedMode === "plan-axonometric") {
    const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
    const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
    const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
    const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
    return [
      "NON_NEGOTIABLE_COLORED_PLAN_VIEW_LOCK:",
      "Input image 1 is the high-resolution dragged paper view and must control the final colored floor plan's flat-paper angle, crop, silhouette, page placement, projected quadrilateral and foreshortening.",
      "Input image 2 is the high-resolution original plan and must control room relationships, walls, openings, labels, door swings, furniture footprints and all layout details.",
      `Match input image 1 camera: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}.`,
      frameText ? `Keep the output crop/frame ratio from the current generation setting: ${frameText}.` : "",
      quadText ? `Align the colored plan sheet to this projected quadrilateral: ${quadText}.` : "",
      perspectiveText ? `Preserve flat-paper perspective scale: ${perspectiveText}; near side larger, far side smaller.` : "",
      "If any earlier prompt text says strict top-down, complete plan, no crop or no rotation, ignore that earlier text whenever it conflicts with input image 1.",
      "Final image must be a clean colored floor-plan surface occupying the same projected paper angle and visible crop as input image 1. Do not extrude walls, do not generate an axonometric wall model, and do not create an eye-level render."
    ].filter(Boolean).join("\n");
  }
  const coloredPlanPipeline = Boolean(options.coloredPlanPipeline);
  const coloredPlanDirect = Boolean(options.coloredPlanDirect);
  const view = normalizedViewAngle(viewAngleReference.viewAngle || viewAngleReference);
  const quadText = targetQuadrilateralPromptText(viewAngleReference.targetQuadrilateral);
  const perspectiveText = perspectiveMetricsPromptText(viewAngleReference.perspectiveMetrics);
  const frameText = String(viewAngleReference.viewAngle?.frame || "").trim();
  return [
    "NON_NEGOTIABLE_VIEW_LOCK:",
    "Input image 1 is the high-resolution view/camera base and must control the final camera angle, crop, silhouette, page placement, projected quadrilateral and foreshortening.",
    coloredPlanPipeline
      ? "Input image 2 is the generated colored floor-plan intermediate and must control room/material/furniture semantic reading; input image 3 is the clean original layout reference only and must preserve readable details without pulling the result back to a default top-down/isometric view."
      : coloredPlanDirect
        ? "Input image 2 is the uploaded colored floor plan and must directly control layout, room/material/furniture semantic reading and fine detail without pulling the result back to a default top-down/isometric view."
      : "Input image 2 is the high-resolution clean layout reference only and must preserve readable details without pulling the result back to a default top-down/isometric view.",
    `Match input image 1 camera: yaw=${view.yaw}deg, pitch=${view.pitch}deg, zoom=${view.zoom.toFixed(2)}, panX=${view.panX}, panY=${view.panY}.`,
    frameText ? `Keep the output crop/frame ratio from the current generation setting: ${frameText}.` : "",
    quadText ? `Align the floor slab and wall-base footprint to this projected quadrilateral: ${quadText}.` : "",
    perspectiveText ? `Preserve perspective scale: ${perspectiveText}; near side larger, far side smaller.` : "",
    "If any earlier prompt text says complete plan, default isometric, top-down, no crop or no rotation, ignore that earlier text whenever it conflicts with input image 1.",
    "Final image must be a high-precision axonometric floor-plan view occupying the same projected angle and visible crop as input image 1, with walls/furniture re-expressed from input image 2. It should read as input image 1 transformed into an axonometric model, not as a newly composed plan."
  ].filter(Boolean).join("\n");
}

function normalizedMultiAngleView(view = null) {
  const mode = view?.mode === "camera" ? "camera" : "subject";
  const number = (value, fallback, min, max) => {
    const numeric = Number(value);
    return Math.round(Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : fallback)));
  };
  const signedDegrees = (value, fallback) => {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : fallback;
    const wrapped = Math.round(((base % 360) + 360) % 360);
    return wrapped > 180 ? wrapped - 360 : wrapped;
  };
  const sourceWidth = number(view?.sourceWidth, 0, 0, 20000);
  const sourceHeight = number(view?.sourceHeight, 0, 0, 20000);
  const aspectNumeric = Number(view?.sourceAspect);
  const inferredAspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
  const sourceAspect = Math.max(0.2, Math.min(5, Number.isFinite(aspectNumeric) && aspectNumeric > 0 ? aspectNumeric : inferredAspect));
  return {
    mode,
    subjectX: number(view?.subjectX, 0, -100, 100),
    subjectY: number(view?.subjectY, 0, -100, 100),
    subjectRotate: signedDegrees(view?.subjectRotate, -45),
    cameraX: signedDegrees(view?.cameraX, -45),
    cameraY: number(view?.cameraY, 35, -90, 90),
    cameraDistance: number(view?.cameraDistance, 0, -100, 100),
    sourceWidth,
    sourceHeight,
    sourceAspect
  };
}

function cameraDistanceLabel(value = 0) {
  if (value <= -42) return "near shot / close view";
  if (value >= 42) return "far shot / distant view";
  return "medium shot";
}

function multiAnglePromptLine(multiAngleView = null) {
  if (!multiAngleView || typeof multiAngleView !== "object") return "";
  const view = normalizedMultiAngleView(multiAngleView);
  const sourceSizeText = view.sourceWidth > 0 && view.sourceHeight > 0
    ? `${view.sourceWidth}x${view.sourceHeight}`
    : "unknown source size";
  return [
    `MULTI_ANGLE_PLAN_PAPER_CONTROL: active=${view.mode}. This control is only for the floor-plan workflow family: floor plan to colored floor plan, colored floor plan to axonometric view, and axonometric region to final render. Do not apply this control to non-plan modes.`,
    `Source aspect recognition: source=${sourceSizeText}, aspect=${view.sourceAspect.toFixed(2)}. First imagine/generate a 3D cuboid whose front face preserves this aspect ratio; place the input image on the foremost face. Do not force it into a square cube unless the source image is square.`,
    `Subject transform: x=${view.subjectX}, y=${view.subjectY}, subjectTurn=${view.subjectRotate}deg. Treat the uploaded image's main subject like a standing person or object turning in place around its vertical axis. This is a 3D body/object facing-direction change, not a flat 2D sticker/image rotation.`,
    `Camera orbit: orbitX=${view.cameraX}deg, orbitY=${view.cameraY}deg, distance=${view.cameraDistance} (${cameraDistanceLabel(view.cameraDistance)}). orbitX means the camera moves left/right around the subject; orbitY means the camera moves above/below around the subject; distance controls near/mid/far lens placement.`,
    "Never render the UI panel, sliders, axes, camera icon, cube, orbit guide, labels or overlay. Preserve the selected mode's structural and visual constraints."
  ].join(" ");
}

function compactPromptField(value, max = 360) {
  return truncateLogText(String(value || "").replace(/\s+/g, " ").trim(), max);
}

function fastPresetLinesForMode(mode) {
  mode = normalizeRenderMode(mode);
  const map = {
    custom: [
      "Output: create the visual image requested by the latest user instruction; classify the artifact from the user text instead of forcing a floor-plan or interior-render workflow.",
      "Preserve/transform boundary: preserve only what the user or uploaded image requires; transform the rest toward the requested visual result."
    ],
    "plan-axonometric": [
      "Output: clean colored floor plan, top-down orthographic 2D view.",
      "Preserve locked original linework, layout, walls, rooms, openings and furniture footprints.",
      "Add restrained material/function color zones only; avoid 3D, tilt, perspective, extrusion, eye-level view and layout drift."
    ],
    "plan-axonometric-view": [
      "Output: high-precision axonometric 3D floor plan from the colored floor plan.",
      "Preserve locked colored floor plan layout, rooms, walls, openings, furniture footprints and visible crop.",
      "Use orthographic or weak-perspective axonometric camera; avoid eye-level view, flat 2D plan and layout drift."
    ],
    "plan-render": [
      "Output: final eye-level human-eye architecture/interior effect render.",
      "Preserve spatial relationships, circulation, selected or inferred functional zone and scale cues from the input guide.",
      "Describe foreground, midground, background, materials and lighting clearly; avoid floor-plan symbols, collage and unclear source zone."
    ],
    panorama: [
      "Output: 2:1 equirectangular 360-degree panorama visual image with stable horizon and seamless horizontal wrap.",
      "Preserve continuous spatial logic, material scale and lighting around the full surround.",
      "Avoid normal wide-angle render, fisheye single frame, visible seam and black borders."
    ],
    photo: [
      "Output: renovated site-photo-based effect render.",
      "Preserve site photo perspective, envelope, openings, columns, ceiling height and major structure.",
      "Change finishes, furniture, lighting and atmosphere only; avoid shifted vanishing points or impossible structure."
    ],
    whitemodel: [
      "Output: polished realistic visualization from the white model.",
      "Preserve white model massing, camera, openings, levels, proportions and spatial hierarchy.",
      "Add realistic materials, lighting, context and scale cues; avoid raw viewport or gray clay look."
    ],
    sketch: [
      "Output: realistic buildable architecture/interior render translated from the sketch.",
      "Preserve sketch composition, perspective, main volumes, intended openings, gesture and design intent.",
      "Resolve ambiguous lines into plausible surfaces, materials, lighting and scale; avoid generic room substitution, impossible construction and leftover sketch strokes unless requested."
    ],
    cadrender: [
      "Output: realistic architecture/interior render derived from CAD linework.",
      "Preserve CAD axes, linework, walls, openings, room adjacency and scale logic as hard constraints.",
      "Add height, materials, furniture and lighting; avoid visible CAD strokes, technical lines and layout drift."
    ],
    upscale: [
      "Output: enhanced same image.",
      "Preserve composition, geometry, content, materials, objects and camera.",
      "Improve clarity, denoise, local contrast, resolution feel and material readability only; avoid redesign or new objects."
    ],
    sharpen: [
      "Output: controlled sharpened same image.",
      "Preserve composition, geometry, content and color relationships exactly.",
      "Improve edge clarity, crispness and local contrast only; avoid halos, fake detail and color shift."
    ],
    detail: [
      "Output: detail-enhanced same scene.",
      "Preserve layout, camera, walls, openings, main objects and non-target areas.",
      "Enhance texture, joints, fixtures, lighting layers and styling scale cues; avoid clutter or structural changes."
    ],
    materialreplace: [
      "Output: targeted material replacement edit.",
      "Preserve geometry, perspective, lighting direction, object placement and non-target areas.",
      "Replace material texture, color, reflectivity, pattern scale and junction details only; avoid full redesign."
    ],
    lightingadjust: [
      "Output: lighting adjustment edit.",
      "Preserve space, materials, camera, furniture and object placement.",
      "Adjust exposure, shadow softness, color temperature, indirect light and fixture glow; avoid blown highlights and conflicting light directions."
    ],
    styletransfer: [
      "Output: coherent style transfer edit.",
      "Preserve architecture, camera, scale, circulation, openings and main object positions.",
      "Transform material system, furniture language, fixtures, palette and styling; avoid filter-only recolor or unrecognizable structure."
    ],
    materialboard: [
      "Output: professional visual material board with swatches, samples, textures, lighting mood and FF&E references.",
      "Preserve design direction, palette and material logic from references.",
      "Avoid text labels, logos, watermark and random collage clutter."
    ],
    outpaint: [
      "Output: natural outpaint expansion.",
      "Preserve original subject, vanishing points, perspective, lighting, material scale and camera height.",
      "Extend surrounding architecture/interior context outside the frame; avoid seams, repeated objects and distorted geometry."
    ]
  };
  return map[mode] || map.custom;
}

function buildFastRenderPrompt({ mode, brief = {}, intent = "", selection = null, planPaperView = null, multiAngleView = null, viewAngleReference = null, referenceCount = 0, references = [], coloredPlanPipeline = false, coloredPlanRecord = null, coloredPlanDirect = false }) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  const projectBits = [
    compactPromptField(brief.projectName, 120),
    compactPromptField(brief.spaceType, 120),
    compactPromptField(brief.area, 80),
    compactPromptField(brief.location, 120),
    compactPromptField(brief.audience, 160),
    compactPromptField(brief.style, 180)
  ].filter(Boolean);
  const userIntent = compactPromptField(intent || brief.constraints || brief.functions || "", 720);
  const controlLines = [
    selection ? `Selected area: focus on normalized region x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}; preserve whole-space logic.` : "",
    viewAngleReference?.dataUrl ? "View-angle reference attached: keep its visible camera/crop/projection when it conflicts with generic defaults." : "",
    planPaperView ? `Plan paper view control: ${compactPromptField(JSON.stringify(planPaperView), 220)}` : "",
    multiAngleView ? `Multi-angle view control: ${compactPromptField(JSON.stringify(multiAngleView), 220)}` : "",
    coloredPlanPipeline ? "Two-stage input: use the colored floor-plan intermediate as semantic/material source while preserving original plan constraints." : "",
    coloredPlanDirect ? "Direct colored-plan input: preserve the uploaded colored plan as the locked layout/material source." : "",
    coloredPlanRecord ? "Colored plan intermediate is already generated; use it as a guide, not as permission to redesign." : ""
  ].filter(Boolean);

  return [
    "MANDATORY_GPT_IMAGE_2_MODE_GUARD:",
    "FAST_DIRECT_PRESET_PROMPT:",
    `Selected workflow: ${modeInfo.label}.`,
    `Task: ${modeInfo.purpose}`,
    `Primary image role: ${firstInputLabel(mode)}.`,
    projectBits.length ? `Project: ${projectBits.join(" / ")}.` : "",
    userIntent ? `User intent: ${userIntent}` : "",
    referenceCount
      ? `Use ${referenceCount} extra reference image(s) as open visual references: ${referenceIntentSummary(references)}.`
      : "No extra reference images; infer a coherent material, lighting and composition direction.",
    ...controlLines,
    ...fastPresetLinesForMode(mode),
    "Quality: clean professional designer presentation, believable geometry, coherent materials, controlled scene density.",
    "Avoid: no watermark, no logo, no UI overlay, no random readable text, no distorted geometry, no unrelated collage."
  ].filter(Boolean).join("\n");
}

function buildRenderPrompt({ mode, brief, intent, selection, planPaperView = null, multiAngleView = null, viewAngleReference = null, referenceCount, references = [], coloredPlanPipeline = false, coloredPlanRecord = null, coloredPlanDirect = false }) {
  mode = normalizeRenderMode(mode);
  const modeInfo = renderModeKnowledge(mode);
  const workflowConfig = planWorkflowPromptConfig(mode);
  const fusionGuide = gptImage2PromptFusionGuide({ mode, referenceCount, references });
  const spatialSchema = architectureInteriorPromptSchema({ mode, brief, intent, referenceCount, references, selection });
  const designerThinking = designerAgentThinkingModel({ mode, brief, intent, referenceCount, references, selection });
  const viewAngleLine = viewAnglePromptLine(planPaperView, mode);
  const viewAngleReferenceLine = viewAngleReferencePromptLine(viewAngleReference, mode, {
    coloredPlanPipeline,
    coloredPlanDirect
  });
  const multiAngleLine = workflowConfig && !isPlanPaperRenderMode(mode)
    ? multiAnglePromptLine(multiAngleView)
    : "";
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
    viewAngleLine,
    viewAngleReferenceLine,
    multiAngleLine,
    "No watermark, no readable text, no logos, no UI overlay."
  ].filter(Boolean);

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
      PLAN_TO_COLORED_PLAN_FIXED_PROMPT,
      "",
      `Workflow config: step ${workflowConfig.step}, ${workflowConfig.label}; input ${workflowConfig.input}; output ${workflowConfig.output}.`,
      `Preserve from config: ${workflowConfig.preserve}.`,
      `Transform from config: ${workflowConfig.transform}.`,
      `Camera/output rule from config: ${workflowConfig.camera}. Avoid: ${workflowConfig.avoid}.`,
      viewAngleReference?.dataUrl
        ? "The first input image is the dragged view-angle base generated from the uploaded plan. This mode outputs a clean colored floor plan in that selected flat paper view; preserve the dragged camera tilt, crop and projected silhouette without extruding walls."
        : "The first input image is a black-and-white architectural floor plan line drawing or a colored floor plan.",
      viewAngleReference?.dataUrl
        ? coloredPlanPipeline
          ? "The second input image is the generated colored top-down floor-plan intermediate. Use it as the main room/material/function semantic map."
          : coloredPlanDirect
            ? "The second input image is already a colored top-down floor plan. Use it directly as the locked layout, room/material/function semantic map and furniture-zone source; do not run a color-plan intermediate."
            : "The second input image is the clean original top-down floor plan. Use it only to recover exact room/wall/opening/furniture layout details; do not use its top-down view as the final camera, crop or silhouette."
        : "No dragged view-angle reference is attached, so use the default strict top-down orthographic colored-plan camera.",
      viewAngleReference?.dataUrl && coloredPlanPipeline
        ? "The third input image is the clean original top-down floor plan. Use it only to recover exact linework, labels, room/wall/opening/furniture layout details; do not use its top-down view as the final camera, crop or silhouette."
        : "",
      "This workflow converts the input plan into a clean colored floor plan intermediate, not an axonometric view and not an eye-level render.",
      viewAngleReference?.dataUrl
        ? coloredPlanPipeline
          ? "Use input image 1 as the visible camera scaffold, input image 2 as the colored semantic/material floor-plan map, and input image 3 as the fine-detail layout verifier. Preserve all visible linework relationships, room relationships, wall boundaries, door/window openings, door swings, circulation, zoning and major furniture/display footprints while keeping the projected angle, crop and silhouette from input image 1. If these compete, camera/crop from input image 1 wins; do not zoom out to recover hidden areas."
          : coloredPlanDirect
            ? "Use input image 1 as the visible camera scaffold and input image 2 as the already-colored locked layout/material source. Preserve all colored plan zones, room relationships, wall boundaries, door/window openings, door swings, circulation, zoning and major furniture/display footprints from input image 2, while keeping the projected angle, crop and silhouette from input image 1. If these compete, camera/crop from input image 1 wins; do not zoom out to recover hidden areas."
            : "Use input image 1 as the visible camera scaffold and input image 2 as the locked layout source. Preserve all visible linework relationships, room relationships, wall boundaries, door/window openings, door swings, circulation, zoning and major furniture/display footprints from input image 2, while keeping the projected angle, crop and silhouette from input image 1. If these compete, camera/crop from input image 1 wins; do not zoom out to recover hidden areas."
        : "Use the input plan as a hard locked layout reference. Preserve all visible linework relationships, room relationships, wall boundaries, door/window openings, door swings, circulation, zoning and major furniture/display footprints.",
      coloredPlanDirect ? "DIRECT_COLORED_PLAN_ROUTE: the uploaded original is already a colored floor plan, so preserve it as the colored-plan intermediate and only improve readability without changing layout." : "",
      coloredPlanPipeline ? planColorPipelinePromptLine(coloredPlanRecord, { hasViewAngleReference: Boolean(viewAngleReference?.dataUrl) }) : "",
      viewAngleReference?.dataUrl
        ? "Use the selected dragged-paper colored-plan camera from input image 1; keep it flat as a plan surface and do not extrude walls or invent wall height."
        : "Use a strict top-down orthographic colored-plan camera with clear full-layout readability.",
      "Add restrained colored room/function/material zones, wet-area cues, furniture color hierarchy and circulation clarity while keeping every footprint plan-faithful.",
      "Do not make a human-eye view render; do not rotate or crop the space into perspective; do not make an axonometric view in this step; do not invent, simplify or redesign the floor plan.",
      ...common
    ].join("\n");
  }

  if (mode === "plan-axonometric-view") {
    const selectionText = selection
      ? `The user selected a normalized region x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}. Generate the clean axonometric view for this zone while preserving its relationship to the surrounding colored floor plan.`
      : "No region was selected. Use the full colored floor plan or the clearest inferred axonometric composition, then generate a clean high-precision axonometric view and state the source area in the prompt.";
    return [
      PLAN_TO_AXONOMETRIC_VIEW_PROMPT,
      "",
      `Workflow config: step ${workflowConfig.step}, ${workflowConfig.label}; input ${workflowConfig.input}; output ${workflowConfig.output}.`,
      `Preserve from config: ${workflowConfig.preserve}.`,
      `Transform from config: ${workflowConfig.transform}.`,
      `Camera/output rule from config: ${workflowConfig.camera}. Avoid: ${workflowConfig.avoid}.`,
      viewAngleReference?.dataUrl
        ? "The first input image is the dragged view-angle base generated from the uploaded colored floor plan. Treat its camera angle, crop, projected silhouette, page placement, foreshortening and rotation as mandatory; the final image should be this exact view re-expressed as a high-precision axonometric floor-plan image."
        : "The input image is the uploaded colored floor plan, floor plan or axonometric floor-plan source. Use it to recover exact room/wall/opening/furniture relationships, cut-wall logic and material zones while generating a high-precision axonometric view.",
      viewAngleReference?.dataUrl
        ? "The second input image is the original colored floor plan or axonometric floor-plan source. Use it to recover exact room/wall/opening/furniture relationships, cut-wall logic and material zones; do not use it as permission to change the final camera."
        : "",
      selectionText,
      "This workflow converts the colored floor-plan geometry into a high-precision axonometric view, not an eye-level render and not a flat 2D plan.",
      viewAngleReference?.dataUrl
        ? "Use input image 1 as the visible camera scaffold and input image 2 as the geometry/detail source. Preserve all visible wall/opening/furniture footprints, room relationships, circulation, cut-wall logic and material zones while keeping the projected angle, crop and silhouette from input image 1. If these compete, camera/crop from input image 1 wins; do not zoom out to recover hidden areas."
        : "Preserve all visible wall/opening/furniture footprints, room relationships, circulation, cut-wall logic and material zones while keeping the axonometric projection stable and readable.",
      "Use an orthographic or weak-perspective axonometric camera with controlled perspective depth, clear near/far scale and high 3D readability.",
      "Add plausible wall height, proportional furniture volumes, floor materials, surface finishes, ceiling/lighting cues and spatial depth while keeping every footprint plan-faithful.",
      "Do not make a human-eye view render; do not rotate or crop the space into an unrelated perspective; do not revert to a default isometric camera; do not flatten it into a 2D plan; do not invent, simplify or redesign the floor plan.",
      ...common
    ].join("\n");
  }

  if (mode === "plan-render") {
    const selectionText = selection
      ? `The user selected a normalized region x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}. Generate the final eye-level render for this zone while preserving its relationship to the surrounding axonometric view or plan-based spatial guide.`
      : "No region was selected. Infer one clear functional zone from the axonometric view or plan-based spatial guide, then generate a final eye-level render for that zone and state the area source in the prompt.";
    return [
      `Workflow config: step ${workflowConfig.step}, ${workflowConfig.label}; input ${workflowConfig.input}; output ${workflowConfig.output}.`,
      `Preserve from config: ${workflowConfig.preserve}.`,
      `Transform from config: ${workflowConfig.transform}.`,
      `Camera/output rule from config: ${workflowConfig.camera}. Avoid: ${workflowConfig.avoid}.`,
      viewAngleReference?.dataUrl
        ? "The first input image is the dragged axonometric/plan paper view reference and must control the source-zone crop, near/far relationship and composition bias for the final render."
        : "The first input image is an axonometric view or selected plan-based spatial reference; legacy flat or colored plans may be used only when explicitly uploaded.",
      viewAngleReference?.dataUrl
        ? "The second input image is the original axonometric view or plan-based spatial guide; use it to preserve spatial relationships, openings, circulation, furniture/display logic and scale cues."
        : "",
      "This is step 3 of the current floor-plan workflow: axonometric spatial guide to final human-eye architecture/interior effect render.",
      selectionText,
      "Preserve the spatial relationship, target-zone location, circulation, functional logic, main display/furniture arrangement, room adjacency and scale cues from the input image.",
      "Improve success rate by describing the target scene in concrete elements: camera standing point, view direction, foreground, midground, background, furniture systems, display objects, wall/ceiling/floor materials, lighting fixtures, color temperature and clutter limits.",
      "Do not reproduce blueprint lines, plan symbols or a full-plan camera in the final image. The output must be a realistic client-presentation effect render with a clear source zone.",
      ...common
    ].join("\n");
  }

  if (mode === "panorama") {
    return [
      "If a primary input image is provided, treat it as a spatial/material reference for 360-degree panorama generation; if no primary image exists, generate directly from the brief and references.",
      "Generate a 2:1 equirectangular panorama with a stable horizon and seamless left/right wrap for panorama viewers such as Pannellum.",
      "Preserve spatial continuity, opening logic, ceiling/floor flow, material scale and lighting continuity across the full surround image.",
      "Do not output a normal single-camera wide render, a fisheye single frame, a cropped scene or a panorama with visible stitch seams.",
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
    "Use the selected workflow semantics to decide whether this should become a colored floor plan, a high-precision axonometric view or a final human-eye spatial render.",
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
    analysisTitle: body.analysis?.title || body.modelingAnalysis?.subject || null,
    analysisSummary: truncateLogText(body.analysis?.summary || body.analysis?.series_strategy || body.modelingAnalysis?.summary || "", 2000)
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
    outputFile: render?.file || render?.outputFile || render?.fileBase || null,
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
    thinking: truncateLogText(render?.thinking || result.thinking || render?.summary || "", 6000),
    objectCount: render?.objectCount || (Array.isArray(render?.objects) ? render.objects.length : null),
    analysisTitle: result.analysisTitle || result.analysis?.title || render?.modelingAnalysis?.subject || null,
    analysisSummary: truncateLogText(
      result.analysisSummary || result.analysis?.summary || result.analysis?.series_strategy || render?.modelingAnalysis?.summary || "",
      3000
    )
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
  const fallbackResponsesPath = kind === "image" ? defaultResponsesPathForBaseUrl(baseUrl) : "/v1/responses";
  const responsesPath = String(provider.responsesPath || provider.path || existing?.responsesPath || fallbackResponsesPath).trim();
  const normalized = {
    baseUrl,
    apiKey,
    model: String(provider.model || existing?.model || fallbackModel).trim() || fallbackModel,
    responsesPath: normalizeResponsesPathForBaseUrl(baseUrl, responsesPath),
    updatedAt: new Date().toISOString()
  };
  if (kind === "image") {
    const providerManifest = providerManifestFromInput(provider, existing);
    normalized.apiMode = normalizeImageApiMode(provider.apiMode || provider.imageApiMode || existing?.apiMode || config.imageApiMode || "responses");
    normalized.responsesTransport = normalizeResponsesTransport(provider.responsesTransport || existing?.responsesTransport || config.imageStudioEngine.responsesTransport || "sse");
    normalized.requestPolicy = normalizeImageStudioRequestPolicy(provider.requestPolicy || existing?.requestPolicy || config.imageStudioEngine.requestPolicy || "openai");
    normalized.imagesNewApiCompat = parseBooleanEnv(
      provider.imagesNewApiCompat,
      existing?.imagesNewApiCompat ?? config.imageStudioEngine.imagesNewApiCompat ?? true
    );
    normalized.reasoningEffort = normalizeImageStudioReasoningEffort(provider.reasoningEffort || existing?.reasoningEffort || config.imageStudioEngine.reasoningEffort || "xhigh");
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

function publicRuntimeProvider(provider, { source = "" } = {}) {
  return {
    configured: Boolean(provider?.apiKey),
    baseUrl: provider?.baseUrl || "",
    model: provider?.model || "",
    source,
    apiMode: provider?.apiMode || "",
    responsesTransport: provider?.responsesTransport || "",
    requestPolicy: provider?.requestPolicy || "",
    imagesNewApiCompat: provider?.imagesNewApiCompat ?? true,
    reasoningEffort: provider?.reasoningEffort || "",
    responsesPath: provider?.responsesPath || "",
    imageGenerationPath: provider?.imageGenerationPath || "",
    imageEditPath: provider?.imageEditPath || "",
    providerManifest: provider?.providerManifest || null,
    providerManifestName: provider?.providerManifest?.name || "",
    updatedAt: provider?.updatedAt || ""
  };
}

function effectivePublicProvider(kind) {
  const runtimeProvider = runtimeSettings.providers[kind];
  if (runtimeProvider?.apiKey && runtimeProvider.baseUrl) {
    return publicRuntimeProvider(runtimeProvider, { source: "runtime" });
  }
  if (kind === "image") {
    const source = activeImageProviderSource();
    return publicRuntimeProvider({
      ...source,
      model: source?.model || config.imageModel,
      apiMode: source?.apiMode || config.imageApiMode,
      responsesTransport: source?.responsesTransport || config.imageStudioEngine.responsesTransport,
      requestPolicy: source?.requestPolicy || config.imageStudioEngine.requestPolicy,
      imagesNewApiCompat: parseBooleanEnv(source?.imagesNewApiCompat, config.imageStudioEngine.imagesNewApiCompat),
      reasoningEffort: source?.reasoningEffort || config.imageStudioEngine.reasoningEffort,
      responsesPath: source ? providerResponsesPath(source) : "",
      imageGenerationPath: source ? providerImageApiPath(source, "generation") : "",
      imageEditPath: source ? providerImageApiPath(source, "edit") : ""
    }, { source: source?.keySource || "env" });
  }
  return publicRuntimeProvider({
    ...config.reasoningProvider,
    model: config.reasoningModel,
    responsesPath: providerResponsesPath(config.reasoningProvider)
  }, { source: "env" });
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
    config.imageApiMode = normalizeImageApiMode(image.apiMode || config.imageApiMode);
    config.imageStudioEngine.responsesTransport = normalizeResponsesTransport(image.responsesTransport || config.imageStudioEngine.responsesTransport);
    config.imageStudioEngine.requestPolicy = normalizeImageStudioRequestPolicy(image.requestPolicy || config.imageStudioEngine.requestPolicy);
    config.imageStudioEngine.imagesNewApiCompat = parseBooleanEnv(image.imagesNewApiCompat, config.imageStudioEngine.imagesNewApiCompat);
    config.imageStudioEngine.reasoningEffort = normalizeImageStudioReasoningEffort(image.reasoningEffort || config.imageStudioEngine.reasoningEffort);
    config.imageProvider.baseUrls = uniqueBaseUrls([image.baseUrl, ...config.imageProvider.baseUrls]);
  }
}

function publicRuntimeImageEndpoint(endpoint) {
  return {
    id: endpoint.id,
    label: endpoint.label,
    baseUrl: endpoint.baseUrl,
    responsesPath: endpoint.responsesPath,
    apiMode: endpoint.apiMode || "",
    responsesTransport: endpoint.responsesTransport || "",
    requestPolicy: endpoint.requestPolicy || "",
    imagesNewApiCompat: endpoint.imagesNewApiCompat ?? true,
    reasoningEffort: endpoint.reasoningEffort || "",
    imageGenerationPath: endpoint.imageGenerationPath,
    imageEditPath: endpoint.imageEditPath,
    providerManifest: endpoint.providerManifest || null,
    providerManifestName: endpoint.providerManifest?.name || "",
    enabled: endpoint.enabled,
    keyConfigured: Boolean(endpoint.apiKey),
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt
  };
}

function publicStorageSettings() {
  const storage = ensureRuntimeStorage();
  return {
    outputDir: storage.outputDir,
    defaultOutputDir: defaultGeneratedDir,
    promptOnFirstRun: Boolean(storage.promptOnFirstRun),
    firstRunStoragePrompted: Boolean(storage.firstRunStoragePrompted),
    needsFirstRunPrompt: Boolean(storage.promptOnFirstRun && !storage.firstRunStoragePrompted),
    savePromptMode: storage.savePromptMode || "ask",
    externalDataDir: externalDataDirEnabled,
    updatedAt: storage.updatedAt || ""
  };
}

async function updateStorageSettings(body = {}) {
  const existing = ensureRuntimeStorage();
  const next = normalizeStorageSettings({
    outputDir: body.outputDir ?? existing.outputDir,
    promptOnFirstRun: body.promptOnFirstRun ?? existing.promptOnFirstRun,
    firstRunStoragePrompted: body.firstRunStoragePrompted ?? existing.firstRunStoragePrompted,
    savePromptMode: body.savePromptMode ?? existing.savePromptMode
  }, existing);
  await fs.mkdir(next.outputDir, { recursive: true });
  runtimeSettings.storage = next;
  await saveRuntimeSettings();
  return next;
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
    const hadLegacyProviderProfiles = Array.isArray(parsed.providerProfiles) && parsed.providerProfiles.length > 0;
    const hadLegacyImageEndpoints = Array.isArray(parsed.imageEndpoints) && parsed.imageEndpoints.length > 0;
    runtimeSettings.imageEndpoints = [];
    runtimeSettings.storage = normalizeStorageSettings(parsed.storage || {}, parsed.storage || null);
    applyRuntimeProviders();
    if (hadLegacyImageEndpoints || hadLegacyProviderProfiles) await saveRuntimeSettings();
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`[settings] load failed: ${error.message || error}`);
    runtimeSettings.providers = { reasoning: null, image: null };
    runtimeSettings.imageEndpoints = [];
    runtimeSettings.storage = normalizeStorageSettings();
  }
}

async function saveRuntimeSettings() {
  runtimeSettings.imageEndpoints = [];
  await fs.mkdir(logsDir, { recursive: true });
  const tmpPath = `${runtimeSettingsPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(runtimeSettings, null, 2)}\n`);
  await fs.rename(tmpPath, runtimeSettingsPath);
}

function runtimeSettingsBody(req = null) {
  const owner = req ? isOwnerRequest(req) : true;
  return {
    ok: true,
    settings: {
      dataDir: appDataDir,
      externalDataDir: externalDataDirEnabled,
      storage: publicStorageSettings(),
      providers: {
        reasoning: effectivePublicProvider("reasoning"),
        image: effectivePublicProvider("image")
      },
      providerProbes: {
        reasoning: publicProviderProbe("reasoning"),
        image: publicProviderProbe("image")
      },
      activeImageBaseUrl: config.imageProvider.baseUrl,
      imageStudioEngine: imageStudioEngineStatus(),
      imageStudioFhlSkill: imageStudioFhlSkillStatus(),
      imageBackend: "image-studio-cli-engine",
      imageGenContract: "Standard OpenAI-compatible paths use the bundled Image Studio go-cli engine. Providers with custom paths or a Provider Manifest use the native HTTP adapter. Other native fallbacks remain disabled unless IMAGE_STUDIO_ALLOW_NATIVE_FALLBACK=1.",
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
  const outputDir = generatedDirectory();
  const archiveDir = generatedArchiveDirectory();
  const [generated, archive, logs] = await Promise.all([
    directoryStats(outputDir),
    directoryStats(archiveDir),
    directoryStats(logsDir)
  ]);
  return {
    outputDir,
    defaultOutputDir: defaultGeneratedDir,
    externalDataDir: externalDataDirEnabled,
    firstRunStoragePrompted: Boolean(ensureRuntimeStorage().firstRunStoragePrompted),
    savePromptMode: ensureRuntimeStorage().savePromptMode,
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
  const outputDir = generatedDirectory();
  const archiveDir = generatedArchiveDirectory();
  const cutoff = Date.now() - Math.max(0, Number(olderThanDays) || 0) * DAY_MS;
  const entries = await listFilesRecursive(outputDir);
  const selected = entries.filter((file) => generatedFileTimestamp(file.name, file.stat) < cutoff);
  let moved = 0;
  let bytes = 0;
  for (const file of selected) {
    bytes += file.stat.size;
    if (dryRun) continue;
    const timestamp = new Date(generatedFileTimestamp(file.name, file.stat));
    const folder = timestamp.toISOString().slice(0, 7);
    await moveFileSafe(file.path, path.join(archiveDir, folder, file.name));
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
  const entries = await listFilesRecursive(generatedDirectory());
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
  const reasoningConfigured = Boolean(config.reasoningProvider.baseUrl && config.reasoningProvider.apiKey);
  const fhlSkillStatus = imageStudioFhlSkillStatus();
  const engineStatus = imageStudioEngineStatus();
  const imageConfigured = imageProviderSources().some((source) => source.baseUrl && source.apiKey)
    && (engineStatus.available || !engineStatus.required);
  return {
    ok: true,
    keyConfigured: reasoningConfigured && imageConfigured,
    reasoningConfigured,
    imageConfigured,
    reasoningBaseUrl: config.reasoningProvider.baseUrl,
    imageBaseUrl: config.imageProvider.baseUrl,
    imageBaseUrls: config.imageProvider.baseUrls,
    imageStudioEngine: engineStatus,
    imageStudioFhlSkill: fhlSkillStatus,
    imageQueue: imageGenerationQueueState(),
    reasoningModel: config.reasoningModel,
    imageModel: config.imageModel,
    imageBackend: "image-studio-cli-engine",
    dataDir: appDataDir,
    externalDataDir: externalDataDirEnabled,
    storage: publicStorageSettings(),
    runtimeProviders: {
      reasoning: effectivePublicProvider("reasoning"),
      image: effectivePublicProvider("image")
    },
    publicApi: {
      version: "v1",
      authenticationRequired: Boolean(config.publicApi.token) || !config.publicApi.allowUnauthenticatedRemote,
      tokenConfigured: Boolean(config.publicApi.token),
      unauthenticatedRemoteAllowed: config.publicApi.allowUnauthenticatedRemote,
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
      path: "/api/v1/modeling/3d-model",
      description: "使用已经生成的白底主体图作为输入，把上传图片主体生成可预览、可导入 CAD 的参数化 3D 模型。"
    },
    {
      method: "POST",
      path: "/api/v1/modeling/forgecad",
      description: "把图片建模结果生成 ForgeCAD 可交互项目脚本，或尝试打开 ForgeCAD Studio。"
    },
    {
      method: "POST",
      path: "/api/v1/modeling/cad-export",
      description: "把图片建模结果转换为 text-to-cad/build123d 源码，并在配置引擎后导出 STEP/STL/GLB。"
    },
    {
      method: "POST",
      path: "/api/v1/modeling/analyze-subject",
      description: "执行图片建模预处理：直接生成主体白底图，或先扩图完善主体；扩图结果可直接建模，白底图是可选步骤。"
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
      description: "读取运行时 API 和存储设置。"
    },
    {
      method: "POST",
      path: "/api/v1/settings/providers",
      description: "保存当前思考或生图 API 配置。"
    },
    {
      method: "POST",
      path: "/api/v1/settings/providers/probe",
      description: "检测当前思考或生图 API 连接。"
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
      required: Boolean(config.publicApi.token) || !config.publicApi.allowUnauthenticatedRemote,
      tokenConfigured: Boolean(config.publicApi.token),
      unauthenticatedRemoteAllowed: config.publicApi.allowUnauthenticatedRemote,
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
      "/modeling/forgecad": {
        post: {
          summary: "生成或打开 ForgeCAD 项目",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("CadIntegrationRequest")) },
          responses: { 200: okJson(jsonSchemaRef("CadIntegrationResponse")), 400: errorResponse, 401: errorResponse, 500: errorResponse }
        }
      },
      "/modeling/cad-export": {
        post: {
          summary: "用 text-to-cad 导出 CAD",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("CadIntegrationRequest")) },
          responses: { 200: okJson(jsonSchemaRef("CadIntegrationResponse")), 400: errorResponse, 401: errorResponse, 500: errorResponse }
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
      "/settings/providers": {
        post: {
          summary: "保存模型 API 配置",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("RuntimeProviderRequest")) },
          responses: { 200: okJson(jsonSchemaRef("RuntimeSettingsResponse")), 400: errorResponse, 401: errorResponse }
        }
      },
      "/settings/providers/probe": {
        post: {
          summary: "检测模型 API 配置",
          security: auth,
          requestBody: { required: true, content: jsonContent(jsonSchemaRef("RuntimeProviderRequest")) },
          responses: { 200: okJson({ type: "object", additionalProperties: true }), 400: errorResponse, 401: errorResponse }
        }
      },
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
        CadIntegrationRequest: {
          type: "object",
          required: ["model"],
          properties: {
            model: {
              type: "object",
              required: ["objects"],
              properties: {
                title: { type: "string" },
                units: { type: "string", default: "meters" },
                objects: { type: "array", items: { type: "object", additionalProperties: true } }
              },
              additionalProperties: true
            },
            action: { type: "string", enum: ["script", "studio", "validate"], default: "script" },
            formats: { type: "array", items: { type: "string", enum: ["step", "stl", "glb", "3mf"] } }
          },
          additionalProperties: true
        },
        CadIntegrationResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            ok: { type: "boolean" },
            forgecad: { type: "object", additionalProperties: true },
            cadExport: { type: "object", additionalProperties: true }
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
            keyConfigured: { type: "boolean" }
          }
        },
        RuntimeProviderRequest: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["reasoning", "image"] },
            baseUrl: { type: "string" },
            model: { type: "string" },
            apiKey: { type: "string" },
            apiMode: { type: "string", enum: ["responses", "images", "auto"] },
            responsesTransport: { type: "string" },
            requestPolicy: { type: "string" },
            imagesNewApiCompat: { type: "boolean", default: true, description: "Images API 使用普通 JSON 返回，不发送流式参数。" },
            reasoningEffort: { type: "string" },
            responsesPath: { type: "string" },
            imageGenerationPath: { type: "string" },
            imageEditPath: { type: "string" },
            providerManifest: { type: "object", additionalProperties: true }
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
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  if (requested.startsWith("/generated/")) {
    await serveGeneratedStatic(req, res, requested.replace(/^\/generated\/?/, ""));
    return;
  }

  const filePath = staticFilePath(publicDir, requested);

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
      ".json": "application/json; charset=utf-8",
      ".glb": "model/gltf-binary",
      ".gltf": "model/gltf+json; charset=utf-8",
      ".dxf": "application/dxf",
      ".scad": "text/plain; charset=utf-8",
      ".step": "model/step",
      ".stl": "model/stl",
      ".py": "text/x-python; charset=utf-8"
    }[ext] || "application/octet-stream";
    await writeStaticResponse(req, res, filePath, stat, contentType, {
      compressible: COMPRESSIBLE_STATIC_EXTENSIONS.has(ext)
    });
  } catch {
    sendText(res, 404, "Not found");
  }
}

function generatedStaticContentType(ext) {
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".svg": "image/svg+xml; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json; charset=utf-8",
    ".dxf": "application/dxf",
    ".scad": "text/plain; charset=utf-8",
    ".step": "model/step",
    ".stl": "model/stl",
    ".3mf": "model/3mf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime"
  }[ext] || "application/octet-stream";
}

function generatedStaticExtraHeaders(ext) {
  if (ext !== ".svg") return {};
  return {
    "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
  };
}

async function serveGeneratedStatic(req, res, requestedPath) {
  const filePath = staticFilePath(generatedDirectory(), requestedPath || "");

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!PUBLIC_GENERATED_EXTENSIONS.has(ext)) {
      sendText(res, 404, "Not found");
      return;
    }
    await writeStaticResponse(req, res, filePath, stat, generatedStaticContentType(ext), {
      compressible: COMPRESSIBLE_STATIC_EXTENSIONS.has(ext),
      extraHeaders: generatedStaticExtraHeaders(ext)
    });
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function serveStaticFromDir(req, res, baseDir, requestedPath) {
  const filePath = staticFilePath(baseDir, requestedPath || "");

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
      ".svg": "image/svg+xml; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".glb": "model/gltf-binary",
      ".gltf": "model/gltf+json; charset=utf-8",
      ".dxf": "application/dxf",
      ".scad": "text/plain; charset=utf-8",
      ".step": "model/step",
      ".stl": "model/stl",
      ".py": "text/x-python; charset=utf-8"
    }[ext] || "application/octet-stream";
    await writeStaticResponse(req, res, filePath, stat, contentType, {
      compressible: COMPRESSIBLE_STATIC_EXTENSIONS.has(ext)
    });
  } catch {
    sendText(res, 404, "Not found");
  }
}

function sendRedirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

async function fetchWechatJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errcode) {
    const message = data.errmsg || `WeChat request failed: ${response.status}`;
    throw httpError(502, message);
  }
  return data;
}

async function wechatTokenFromCode(code) {
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", config.wechatLogin.appId);
  url.searchParams.set("secret", config.wechatLogin.appSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");
  return fetchWechatJson(url);
}

async function wechatUserInfo(accessToken, openid) {
  const url = new URL("https://api.weixin.qq.com/sns/userinfo");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("openid", openid);
  url.searchParams.set("lang", "zh_CN");
  return fetchWechatJson(url);
}

async function authStatusBody(req) {
  const auth = await authSessionFromRequest(req);
  const isAdmin = await isAdminRequest(req);
  return {
    ok: true,
    configured: wechatLoginConfigured(),
    redirectUri: wechatRedirectUri(req),
    authenticated: Boolean(auth?.user),
    clientId: auth?.session?.clientId || "",
    user: publicAuthUser(auth?.user || null),
    isAdmin
  };
}

async function handleAuthApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(res, 200, await authStatusBody(req));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/users") {
    if (!await isAdminRequest(req)) {
      sendJson(res, 403, { ok: false, error: "只有本机或管理员可以查看用户生成记录。" });
      return;
    }
    await loadAuthStorage();
    const users = await Promise.all(authUsers.map(async (user) => {
      const logs = await readTaskLogs(200, user.clientId);
      const successful = logs.filter((log) => log.status === "success").length;
      const failed = logs.filter((log) => log.status === "failed").length;
      const latest = logs[0] || null;
      return {
        ...publicAuthUser(user),
        stats: {
          total: logs.length,
          successful,
          failed,
          latestAt: latest?.completedAt || latest?.startedAt || ""
        }
      };
    }));
    sendJson(res, 200, { ok: true, users });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await loadAuthStorage();
    const sessionId = parseCookies(req).laogui_session || "";
    if (sessionId) authSessions.delete(sessionId);
    await saveAuthSessions();
    clearAuthCookie(req, res, "laogui_session");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/wechat/login") {
    if (!wechatLoginConfigured()) {
      sendJson(res, 400, {
        ok: false,
        error: "微信扫码登录还未配置。请设置 WECHAT_LOGIN_APP_ID 和 WECHAT_LOGIN_APP_SECRET。"
      });
      return;
    }
    const state = randomBytes(18).toString("base64url");
    const returnTo = url.searchParams.get("returnTo") || "/";
    setAuthCookie(req, res, "laogui_oauth_state", state, { maxAge: AUTH_OAUTH_STATE_TTL_SECONDS });
    setAuthCookie(req, res, "laogui_oauth_return", returnTo.startsWith("/") ? returnTo : "/", { maxAge: AUTH_OAUTH_STATE_TTL_SECONDS });
    const loginUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
    loginUrl.searchParams.set("appid", config.wechatLogin.appId);
    loginUrl.searchParams.set("redirect_uri", wechatRedirectUri(req));
    loginUrl.searchParams.set("response_type", "code");
    loginUrl.searchParams.set("scope", "snsapi_login");
    loginUrl.searchParams.set("state", state);
    sendRedirect(res, `${loginUrl.toString()}#wechat_redirect`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/wechat/callback") {
    const code = String(url.searchParams.get("code") || "").trim();
    const state = String(url.searchParams.get("state") || "").trim();
    const cookies = parseCookies(req);
    const expectedState = cookies.laogui_oauth_state || "";
    const returnTo = cookies.laogui_oauth_return || "/";
    clearAuthCookie(req, res, "laogui_oauth_state");
    clearAuthCookie(req, res, "laogui_oauth_return");
    if (!code || !state || !expectedState || state !== expectedState) {
      sendText(res, 400, "微信登录状态校验失败，请返回老鬼AI重新扫码。");
      return;
    }
    const token = await wechatTokenFromCode(code);
    const profile = await wechatUserInfo(token.access_token, token.openid);
    const user = await upsertWechatUser(profile);
    await createAuthSession(req, res, user);
    sendRedirect(res, returnTo.startsWith("/") ? returnTo : "/");
    return;
  }

  sendJson(res, 404, { ok: false, error: "Unknown auth route" });
}

async function handleExternalApi(req, res, routePath) {
  if (!externalApiAuthorized(req) && !await authSessionFromRequest(req)) {
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
    const clientId = await clientIdFromRequest(req, url);
    const logs = await readTaskLogs(limit, clientId);
    sendJson(res, 200, { ok: true, clientId, logs });
    return;
  }

  const taskLogMatch = routePath.match(/^\/task-logs\/([^/]+)$/);
  if (taskLogMatch && req.method === "DELETE") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const result = await deleteTaskLog(decodeURIComponent(taskLogMatch[1]), clientId);
    sendJson(res, 200, { ok: true, clientId, ...result });
    return;
  }

  if (req.method === "GET" && routePath === "/task-result") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
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
    const clientId = await clientIdFromRequest(req, url);
    const state = await readCanvasState(clientId);
    sendJson(res, 200, { ok: true, clientId, state });
    return;
  }

  if (req.method === "POST" && routePath === "/canvas-state") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const body = await readJson(req);
    const state = await writeCanvasState(body, clientId);
    sendJson(res, 200, { ok: true, clientId, savedAt: state.savedAt });
    return;
  }

  if (req.method === "POST" && routePath === "/image-endpoints/probe") {
    if (!requireOwnerWriteRequest(req, res)) return;
    const body = await readJson(req);
    sendJson(res, 200, await imageEndpointProbeBody(body));
    return;
  }

  if (req.method === "GET" && routePath === "/settings") {
    sendJson(res, 200, runtimeSettingsBody(req));
    return;
  }

  if (req.method === "POST" && routePath === "/settings/providers") {
    if (!requireOwnerWriteRequest(req, res)) return;
    const body = await readJson(req);
    const provider = await updateRuntimeProvider(String(body.kind || ""), body);
    sendJson(res, 200, { ok: true, provider: publicRuntimeProvider(provider), settings: runtimeSettingsBody(req).settings });
    return;
  }

  if (req.method === "POST" && routePath === "/settings/providers/probe") {
    if (!requireOwnerWriteRequest(req, res)) return;
    const body = await readJson(req);
    sendJson(res, 200, await providerProbeBody(body));
    return;
  }

  if (routePath.startsWith("/settings/provider-profiles")) {
    sendJson(res, 410, { ok: false, error: "旧版 API 组合管理已移除，请分别保存思考模型 API 和生图模型 API。" });
    return;
  }

  if (req.method === "GET" && routePath === "/storage") {
    sendJson(res, 200, { ok: true, summary: await generatedStorageSummary() });
    return;
  }

  if (req.method === "POST" && routePath === "/storage/maintenance") {
    if (!requireOwnerWriteRequest(req, res)) return;
    const body = await readJson(req);
    sendJson(res, 200, await runStorageMaintenance(body));
    return;
  }

  if (req.method === "POST" && routePath === "/settings/storage") {
    if (!requireOwnerWriteRequest(req, res)) return;
    const body = await readJson(req);
    const storage = await updateStorageSettings(body);
    sendJson(res, 200, { ok: true, storage: publicStorageSettings(storage), settings: runtimeSettingsBody(req).settings });
    return;
  }

  if (routePath === "/image-endpoints/probe" || routePath.startsWith("/settings/image-endpoints")) {
    sendJson(res, 410, { ok: false, error: "备用 Image Gen API 已移除，请在 API 设置中保存生图模型 API。" });
    return;
  }

  if (req.method === "POST" && routePath === "/plan") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
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
    const clientId = await clientIdFromRequest(req, url);
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
    const clientId = await clientIdFromRequest(req, url);
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
    const clientId = await clientIdFromRequest(req, url);
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

  if (req.method === "POST" && routePath === "/images/cutout-analysis") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const body = await readJson(req);
    const analysis = await runLoggedTask({
      type: "api-v1-ai-cutout-analysis",
      body,
      clientId,
      run: () => analyzeCutoutSubject(body)
    });
    sendJson(res, 200, { ok: true, analysis });
    return;
  }

  if (req.method === "POST" && routePath === "/modeling/analyze-subject") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const body = await readJson(req);
    const analysis = await runLoggedTask({
      type: "api-v1-image-modeling-analysis",
      body,
      clientId,
      run: () => analyzeImageModelingSubject(body)
    });
    sendJson(res, 200, { ok: true, analysis });
    return;
  }

  if (req.method === "POST" && routePath === "/modeling/3d-model") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const body = await readJson(req);
    const model = await runLoggedTask({
      type: "api-v1-image-modeling",
      body,
      clientId,
      run: () => generateImageModel(body)
    });
    sendJson(res, 200, { ok: true, model });
    return;
  }

  if (req.method === "POST" && routePath === "/modeling/forgecad") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const body = await readJson(req);
    const forgecad = await runLoggedTask({
      type: "api-v1-forgecad-integration",
      body,
      clientId,
      run: () => createForgeCadIntegration(body)
    });
    sendJson(res, 200, { ok: true, forgecad });
    return;
  }

  if (req.method === "POST" && routePath === "/modeling/cad-export") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
    const body = await readJson(req);
    const cadExport = await runLoggedTask({
      type: "api-v1-text-to-cad-export",
      body,
      clientId,
      run: () => createTextToCadExport(body)
    });
    sendJson(res, 200, { ok: true, cadExport });
    return;
  }

  if (req.method === "POST" && routePath === "/design-series/generate") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = await clientIdFromRequest(req, url);
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

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
      await handleAuthApi(req, res, url);
      return;
    }

    if (!await requireRemoteApiAuthorization(req, res)) return;

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
      const clientId = await clientIdFromRequest(req, url);
      const state = await readCanvasState(clientId);
      sendJson(res, 200, { ok: true, clientId, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/canvas-state") {
      const clientId = await clientIdFromRequest(req, url);
      const body = await readJson(req);
      const state = await writeCanvasState(body, clientId);
      sendJson(res, 200, { ok: true, clientId, savedAt: state.savedAt });
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/api/task-logs")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = clampNumber(Number(url.searchParams.get("limit") || 80), 1, 200);
      const clientId = await clientIdFromRequest(req, url);
      const logs = await readTaskLogs(limit, clientId);
      sendJson(res, 200, { ok: true, clientId, logs });
      return;
    }

    const taskLogUrl = new URL(req.url, `http://${req.headers.host}`);
    const taskLogMatch = taskLogUrl.pathname.match(/^\/api\/task-logs\/([^/]+)$/);
    if (taskLogMatch && req.method === "DELETE") {
      const clientId = await clientIdFromRequest(req, taskLogUrl);
      const result = await deleteTaskLog(decodeURIComponent(taskLogMatch[1]), clientId);
      sendJson(res, 200, { ok: true, clientId, ...result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/task-result") {
      const clientId = await clientIdFromRequest(req, url);
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

    if (req.method === "GET" && url.pathname === "/api/download-image") {
      const sourceUrl = String(url.searchParams.get("url") || "");
      if (!sourceUrl) {
        sendJson(res, 400, { ok: false, error: "Missing url" });
        return;
      }
      const image = await downloadImageUrlResult(sourceUrl);
      sendBuffered(res, 200, image.buffer, {
        "content-type": image.type,
        "cache-control": "no-store"
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, healthBody());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/image-endpoints/probe") {
      if (!requireOwnerWriteRequest(req, res)) return;
      const body = await readJson(req);
      sendJson(res, 200, await imageEndpointProbeBody(body));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, runtimeSettingsBody(req));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/providers") {
      if (!requireOwnerWriteRequest(req, res)) return;
      const body = await readJson(req);
      const provider = await updateRuntimeProvider(String(body.kind || ""), body);
      sendJson(res, 200, { ok: true, provider: publicRuntimeProvider(provider), settings: runtimeSettingsBody(req).settings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/providers/probe") {
      if (!requireOwnerWriteRequest(req, res)) return;
      const body = await readJson(req);
      sendJson(res, 200, await providerProbeBody(body));
      return;
    }

    if (url.pathname.startsWith("/api/settings/provider-profiles")) {
      sendJson(res, 410, { ok: false, error: "旧版 API 组合管理已移除，请分别保存思考模型 API 和生图模型 API。" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/storage") {
      sendJson(res, 200, { ok: true, summary: await generatedStorageSummary() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/storage/maintenance") {
      if (!requireOwnerWriteRequest(req, res)) return;
      const body = await readJson(req);
      sendJson(res, 200, await runStorageMaintenance(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/storage") {
      if (!requireOwnerWriteRequest(req, res)) return;
      const body = await readJson(req);
      const storage = await updateStorageSettings(body);
      sendJson(res, 200, { ok: true, storage: publicStorageSettings(storage), settings: runtimeSettingsBody(req).settings });
      return;
    }

    if (url.pathname === "/api/image-endpoints/probe" || url.pathname.startsWith("/api/settings/image-endpoints")) {
      sendJson(res, 410, { ok: false, error: "备用 Image Gen API 已移除，请在 API 设置中保存生图模型 API。" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/task-log-event") {
      const clientId = await clientIdFromRequest(req, url);
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
      const clientId = await clientIdFromRequest(req, url);
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
      const clientId = await clientIdFromRequest(req, url);
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
      const clientId = await clientIdFromRequest(req, url);
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
      const clientId = await clientIdFromRequest(req, url);
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

    if (req.method === "POST" && url.pathname === "/api/ai-cutout-analysis") {
      const clientId = await clientIdFromRequest(req, url);
      const body = await readJson(req);
      const analysis = await runLoggedTask({
        type: "ai-cutout-analysis",
        body,
        clientId,
        run: () => analyzeCutoutSubject(body)
      });
      sendJson(res, 200, { ok: true, analysis });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/image-modeling/analyze" || url.pathname === "/api/modeling/analyze-subject")) {
      const clientId = await clientIdFromRequest(req, url);
      const body = await readJson(req);
      const analysis = await runLoggedTask({
        type: "image-modeling-analysis",
        body,
        clientId,
        run: () => analyzeImageModelingSubject(body)
      });
      sendJson(res, 200, { ok: true, analysis });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/image-modeling" || url.pathname === "/api/modeling/3d-model")) {
      const clientId = await clientIdFromRequest(req, url);
      const body = await readJson(req);
      const model = await runLoggedTask({
        type: "image-modeling",
        body,
        clientId,
        run: () => generateImageModel(body)
      });
      sendJson(res, 200, { ok: true, model });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/modeling/forgecad") {
      const clientId = await clientIdFromRequest(req, url);
      const body = await readJson(req);
      const forgecad = await runLoggedTask({
        type: "forgecad-integration",
        body,
        clientId,
        run: () => createForgeCadIntegration(body)
      });
      sendJson(res, 200, { ok: true, forgecad });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/modeling/cad-export") {
      const clientId = await clientIdFromRequest(req, url);
      const body = await readJson(req);
      const cadExport = await runLoggedTask({
        type: "text-to-cad-export",
        body,
        clientId,
        run: () => createTextToCadExport(body)
      });
      sendJson(res, 200, { ok: true, cadExport });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design-series") {
      const clientId = await clientIdFromRequest(req, url);
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
  try {
    res.laoguiRequest = req;
    const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${config.port}`}`);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const status = error.status || 500;
    const logMethod = status >= 500 ? console.error : console.warn;
    logMethod(`[static] ${req.method} ${req.url} failed: ${status} ${error.message || "Server error"}`);
    if (res.writableEnded || res.destroyed) return;
    sendText(res, status, status >= 500 ? "Server error" : error.message || "Bad request");
  }
});

export function closeLaoguiServer({ timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let serverClosed = false;
    let childrenClosed = false;
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve();
    };
    const finishIfReady = () => {
      if (serverClosed && childrenClosed) finish();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      terminateActiveChildProcesses({ forceAfterMs: 500 }).finally(finish);
    }, timeoutMs);
    timer.unref?.();

    terminateActiveChildProcesses({ forceAfterMs: Math.min(1200, Math.max(300, timeoutMs - 500)) })
      .finally(() => {
        childrenClosed = true;
        finishIfReady();
      });
    try {
      server.close(() => {
        serverClosed = true;
        finishIfReady();
      });
    } catch {
      serverClosed = true;
      finishIfReady();
    }
    server.closeIdleConnections?.();
  });
}

server.listen(config.port, config.host, async () => {
  await loadRuntimeSettings().catch((error) => {
    console.warn(`[settings] runtime settings load failed: ${error.message || error}`);
  });
  const runtimeCount = runtimeSettings.imageEndpoints.filter((endpoint) => endpoint.enabled).length;
  if (runtimeCount) {
    const active = activeImageProviderSource();
    if (active?.baseUrl) config.imageProvider.baseUrl = active.baseUrl;
  }
  hydrateImageEndpointStatsFromTaskLogs();
  console.log(`老鬼AI running at http://${config.host}:${config.port}`);
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
