#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));

loadDotEnv(path.join(rootDir, ".env"));

const DEFAULT_BASE_URL = process.env.LAOGUI_API_BASE_URL
  || `http://127.0.0.1:${process.env.PORT || 4177}/api/v1`;
const DEFAULT_CLIENT_ID = process.env.LAOGUI_CLIENT_ID || "codex";
const DEFAULT_TIMEOUT_MS = Number(process.env.LAOGUI_API_TIMEOUT_MS || 10 * 60 * 1000);

async function main() {
  const { command, opts, positionals } = parseArgs(process.argv.slice(2));
  if (!command || ["help", "-h", "--help"].includes(command)) {
    printHelp();
    return;
  }

  const api = createApiClient(opts);
  let result;

  if (command === "health") {
    result = await api.request("/health");
  } else if (command === "settings") {
    result = await api.request("/settings");
  } else if (command === "logs") {
    result = await api.request("/task-logs", {
      search: { limit: opts.limit || 20 }
    });
  } else if (command === "plan") {
    const body = await buildPlanBody(opts);
    result = await api.request("/plan", { method: "POST", body });
  } else if (["image", "generate", "images/generate"].includes(command)) {
    const body = await buildImageBody(opts);
    result = await api.request("/images/generate", { method: "POST", body });
  } else if (["render", "render-from-images"].includes(command)) {
    const body = await buildRenderBody(opts);
    result = await api.request("/images/render-from-images", { method: "POST", body });
  } else if (["series-analyze", "analyze-design-series"].includes(command)) {
    const body = await buildSeriesAnalyzeBody(opts);
    result = await api.request("/design-series/analyze", { method: "POST", body });
  } else if (["series-generate", "design-series"].includes(command)) {
    const body = await buildSeriesGenerateBody(opts);
    result = await api.request("/design-series/generate", { method: "POST", body });
  } else if (["series", "series-run", "design-series-run"].includes(command)) {
    result = await runDesignSeriesBatch(api, opts);
  } else if (command === "probe") {
    const body = await buildProbeBody(opts);
    result = await api.request("/image-endpoints/probe", { method: "POST", body });
  } else if (["endpoint-add", "endpoint-upsert"].includes(command)) {
    result = await api.request("/settings/image-endpoints", {
      method: "POST",
      body: buildEndpointBody(opts)
    });
  } else if (command === "endpoint-activate") {
    const id = requireOption(opts, "id", "endpoint-activate requires --id");
    result = await api.request(`/settings/image-endpoints/${encodeURIComponent(id)}/activate`, {
      method: "POST",
      body: {}
    });
  } else if (command === "endpoint-delete") {
    const id = requireOption(opts, "id", "endpoint-delete requires --id");
    result = await api.request(`/settings/image-endpoints/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  } else if (command === "request") {
    const route = opts.path || positionals[0];
    if (!route) throw new Error("request requires --path or a positional path");
    const body = opts.body || opts.json ? await loadJson(opts.body || opts.json) : null;
    result = await api.request(route, {
      method: String(opts.method || (body ? "POST" : "GET")).toUpperCase(),
      body
    });
  } else if (command === "openapi") {
    result = await api.rawRequest("/api/openapi.json");
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  const imageOut = opts["image-out"];
  if (imageOut && !result?.codexBridge?.batch) {
    const savedImage = await saveImageFromResult(result, imageOut, api.origin);
    result = {
      ...result,
      codexBridge: {
        ...(result.codexBridge || {}),
        savedImage
      }
    };
  }

  if (opts.output) {
    await writeJsonFile(opts.output, result);
  }

  writeResult(result, opts);
}

function printHelp() {
  console.log(`Laogui AI API bridge

Usage:
  npm run api -- <command> [options]
  node scripts/laogui-api.mjs <command> [options]

Commands:
  health                         Check local service status.
  settings                       Read runtime settings and image endpoints.
  logs --limit 20                Read recent task logs.
  plan --brief brief.json        Generate design directions.
  image --prompt "..."           Generate one image from text.
  render --primary in.png        Render or edit from a primary image.
  series-analyze --ref a.jpg     Analyze references for a design series.
  series-generate --analysis a.json --index 1 --count 6
  series --count 6 --out-dir dir Analyze references, then generate a full series.
  probe                          Probe configured image endpoints.
  endpoint-add --base-url URL --api-key KEY [--label NAME]
  endpoint-activate --id ID
  endpoint-delete --id ID
  request --method POST --path /images/generate --body body.json
  openapi                        Print the OpenAPI document.

Common options:
  --base-url URL                 Default: ${DEFAULT_BASE_URL}
  --token TOKEN                  Defaults to LAOGUI_API_TOKEN / API_ACCESS_TOKEN.
  --client-id ID                 Default: ${DEFAULT_CLIENT_ID}
  --body file.json|-             Start from a full JSON request body.
  --brief file.json|-            Merge brief JSON into request body.
  --prompt TEXT                  Image prompt or design intent.
  --prompt-file file.txt         Read prompt text from a file.
  --primary image.png            Primary image for render workflows.
  --ref image.jpg                Reference image; repeat for multiple refs.
  --mode plan-render             Render mode. Also supports custom, photo, etc.
  --size 1024x1536               Image size.
  --quality low|medium|high|auto Image quality.
  --no-thinking                  Skip reasoning prompt fusion when supported.
  --task-id ID                   Idempotent task id for recoverable generation.
  --image-out image.png          Copy or download the generated image there.
  --out-dir dir                  Batch series image output directory.
  --analysis-out file.json       Write series analysis JSON there.
  --manifest-out file.json       Write batch series manifest there.
  --start-index 1                Batch series start index.
  --file-prefix NAME             Batch series output file prefix.
  --output result.json           Also write the JSON response to a file.
  --field image.file             Print only one dot-path field.
  --compact                      Print compact JSON.

Examples:
  npm run api -- image --prompt "quiet boutique hotel lobby, warm stone, brass details" --image-out /tmp/lobby.png
  npm run api -- render --mode plan-render --primary plan.png --prompt "turn this zone into an eye-level render"
  npm run api -- series-analyze --brief brief.json --ref ref-a.jpg --ref ref-b.jpg --output analysis.json
  npm run api -- series --brief brief.json --ref ref-a.jpg --ref ref-b.jpg --count 6 --out-dir /tmp/series
`);
}

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

function parseArgs(argv) {
  const [rawCommand, ...rest] = argv;
  const opts = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const key = arg.slice(2, eq > -1 ? eq : undefined);
    let value;
    if (eq > -1) {
      value = arg.slice(eq + 1);
    } else if (rest[index + 1] && !rest[index + 1].startsWith("--")) {
      value = rest[index + 1];
      index += 1;
    } else {
      value = true;
    }
    appendOption(opts, key, value);
  }

  return {
    command: String(rawCommand || "").trim(),
    opts,
    positionals
  };
}

function appendOption(opts, key, value) {
  if (opts[key] === undefined) {
    opts[key] = value;
    return;
  }
  if (!Array.isArray(opts[key])) opts[key] = [opts[key]];
  opts[key].push(value);
}

function createApiClient(opts) {
  const baseUrl = normalizeApiBase(opts["base-url"] || DEFAULT_BASE_URL);
  const origin = apiOrigin(baseUrl);
  const token = opts.token ?? process.env.LAOGUI_API_TOKEN ?? process.env.API_ACCESS_TOKEN ?? "";
  const clientId = opts["no-client-id"] ? "" : String(opts["client-id"] || DEFAULT_CLIENT_ID || "");
  const timeoutMs = Number(opts.timeout || opts["timeout-ms"] || DEFAULT_TIMEOUT_MS);

  return {
    origin,
    request: (route, options = {}) => requestJson({
      url: apiUrl(baseUrl, route),
      token,
      clientId,
      timeoutMs,
      ...options
    }),
    rawRequest: (route, options = {}) => requestJson({
      url: rawUrl(origin, route),
      token,
      clientId: "",
      timeoutMs,
      ...options
    })
  };
}

function normalizeApiBase(value) {
  const raw = String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const parsed = new URL(raw);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname) return `${origin}/api/v1`;
  if (raw.endsWith("/api/v1")) return raw;
  if (raw.endsWith("/api")) return `${raw}/v1`;
  return raw;
}

function apiOrigin(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function apiUrl(baseUrl, route) {
  if (/^https?:\/\//i.test(route)) return route;
  let cleanRoute = String(route || "/").trim();
  cleanRoute = cleanRoute.replace(/^\/api\/v1(?=\/|$)/, "");
  if (!cleanRoute.startsWith("/")) cleanRoute = `/${cleanRoute}`;
  return `${baseUrl}${cleanRoute}`;
}

function rawUrl(origin, route) {
  if (/^https?:\/\//i.test(route)) return route;
  const cleanRoute = String(route || "/").startsWith("/") ? route : `/${route}`;
  return `${origin}${cleanRoute}`;
}

async function requestJson({ url, method = "GET", body = null, token = "", clientId = "", search = {}, timeoutMs }) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(search || {})) {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  }
  if (clientId && !target.searchParams.has("clientId")) {
    target.searchParams.set("clientId", clientId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== null && body !== undefined) headers["content-type"] = "application/json";

  try {
    const response = await fetch(target, {
      method,
      headers,
      body: body === null || body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    const data = parseJsonText(text);
    if (!response.ok) {
      const message = data?.error || data?.message || response.statusText || "Request failed";
      const error = new Error(`${response.status} ${message}`);
      error.details = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function runDesignSeriesBatch(api, opts) {
  const commonBody = await buildSeriesAnalyzeBody(opts);
  const references = commonBody.referenceImages || [];
  if (!references.length) {
    throw new Error("series requires at least one --ref image; --analysis only reuses the strategy, not the reference images");
  }

  const count = clampInteger(opts.count || opts["series-count"] || commonBody.seriesCount || commonBody.count || 6, 1, 8);
  const startIndex = clampInteger(opts["start-index"] || opts.start || 1, 1, count);
  const endIndex = clampInteger(opts["end-index"] || opts.end || count, startIndex, count);
  const outputDir = opts["out-dir"] ? resolvePath(opts["out-dir"]) : "";
  const taskPrefix = slugFile(opts["task-prefix"] || opts["task-id"] || opts["workflow-id"] || "design-series");
  const filePrefix = slugFile(opts["file-prefix"] || taskPrefix || "design-series");

  let analysis;
  let analysisResponse = null;
  if (opts.analysis) {
    analysis = unwrapAnalysis(await loadJson(opts.analysis));
  } else {
    analysisResponse = await api.request("/design-series/analyze", {
      method: "POST",
      body: commonBody
    });
    analysis = unwrapAnalysis(analysisResponse);
  }

  const analysisOut = opts["analysis-out"]
    ? resolvePath(opts["analysis-out"])
    : outputDir
      ? path.join(outputDir, "analysis.json")
      : "";
  if (analysisOut) {
    await writeJsonFile(analysisOut, analysis);
  }

  const images = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const pad = String(index).padStart(2, "0");
    const taskId = `${taskPrefix}-${pad}`;
    const body = {
      ...commonBody,
      analysis,
      seriesIndex: index,
      seriesCount: count,
      clientTaskId: taskId
    };
    applyGenerationOptions(body, {
      ...opts,
      "task-id": taskId
    });

    process.stderr.write(`[series] generating ${index}/${count} (${taskId})\n`);
    const response = await api.request("/design-series/generate", {
      method: "POST",
      body
    });

    const savedImage = outputDir
      ? await saveImageFromResult(response, path.join(outputDir, `${filePrefix}-${pad}.png`), api.origin)
      : null;

    images.push({
      index,
      count,
      taskId,
      savedImage,
      file: response.render?.file || null,
      url: response.render?.url || null,
      prompt: response.render?.prompt || "",
      endpoint: response.render?.endpoint || null
    });
  }

  const manifest = {
    ok: true,
    command: "series",
    count,
    startIndex,
    endIndex,
    analysisFile: analysisOut || null,
    outputDir: outputDir || null,
    images: images.map((image) => ({
      index: image.index,
      count: image.count,
      taskId: image.taskId,
      savedImage: image.savedImage,
      file: image.file,
      url: image.url
    })),
    createdAt: new Date().toISOString()
  };
  const manifestOut = opts["manifest-out"]
    ? resolvePath(opts["manifest-out"])
    : outputDir
      ? path.join(outputDir, "manifest.json")
      : "";
  if (manifestOut) {
    await writeJsonFile(manifestOut, manifest);
  }

  return {
    ok: true,
    analysis,
    analysisResponse,
    manifest: manifestOut || null,
    images,
    codexBridge: {
      batch: true,
      outputDir: outputDir || null,
      analysisFile: analysisOut || null,
      manifest: manifestOut || null,
      savedImages: images.map((image) => image.savedImage).filter(Boolean)
    }
  };
}

function parseJsonText(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function buildPlanBody(opts) {
  const body = await baseBody(opts);
  if (opts.brief) body.brief = await loadJson(opts.brief);
  return body;
}

async function buildImageBody(opts) {
  const body = await baseBody(opts);
  if (opts.brief) body.brief = await loadJson(opts.brief);
  if (opts.direction) body.direction = await loadJson(opts.direction);
  const prompt = await promptFromOptions(opts);
  if (prompt) body.imagePrompt = prompt;
  applyGenerationOptions(body, opts);
  return body;
}

async function buildRenderBody(opts) {
  const body = await baseBody(opts);
  if (opts.brief) body.brief = await loadJson(opts.brief);
  if (opts.mode) body.mode = String(opts.mode);
  const prompt = await promptFromOptions(opts);
  if (prompt) body.intent = prompt;
  if (opts.primary) body.primaryImage = await inputImageFromOption(opts.primary, { sourceType: "primary" });
  const refs = await referenceImagesFromOptions(opts);
  if (refs.length) body.referenceImages = refs;
  if (opts.selection) body.selection = await loadJson(opts.selection);
  applyGenerationOptions(body, opts);
  return body;
}

async function buildSeriesAnalyzeBody(opts) {
  const body = await baseBody(opts);
  if (opts.brief) body.brief = await loadJson(opts.brief);
  const prompt = await promptFromOptions(opts);
  if (prompt) body.intent = prompt;
  const refs = await referenceImagesFromOptions(opts);
  if (refs.length) body.referenceImages = refs;
  return body;
}

async function buildSeriesGenerateBody(opts) {
  const body = await buildSeriesAnalyzeBody(opts);
  if (opts.analysis) body.analysis = unwrapAnalysis(await loadJson(opts.analysis));
  if (opts.index) body.seriesIndex = Number(opts.index);
  if (opts.count) body.seriesCount = Number(opts.count);
  applyGenerationOptions(body, opts);
  return body;
}

async function buildProbeBody(opts) {
  const body = await baseBody(opts);
  if (opts["endpoint-id"]) body.endpointId = String(opts["endpoint-id"]);
  if (opts["base-url"]) body.baseUrl = String(opts["base-url"]);
  if (opts["api-key"]) body.apiKey = String(opts["api-key"]);
  if (opts.label) body.label = String(opts.label);
  if (opts["responses-path"]) body.responsesPath = String(opts["responses-path"]);
  if (opts.timeout || opts["timeout-ms"]) body.timeoutMs = Number(opts.timeout || opts["timeout-ms"]);
  if (opts["auto-activate"] !== undefined) body.autoActivate = parseBoolean(opts["auto-activate"]);
  return body;
}

function buildEndpointBody(opts) {
  return {
    label: opts.label ? String(opts.label) : undefined,
    baseUrl: requireOption(opts, "base-url", "endpoint-add requires --base-url"),
    apiKey: requireOption(opts, "api-key", "endpoint-add requires --api-key"),
    responsesPath: opts["responses-path"] ? String(opts["responses-path"]) : undefined,
    enabled: opts.disabled ? false : opts.enabled === undefined ? true : parseBoolean(opts.enabled)
  };
}

async function baseBody(opts) {
  if (opts.body || opts.json) return loadJson(opts.body || opts.json);
  return {};
}

function unwrapAnalysis(value) {
  if (value?.analysis && typeof value.analysis === "object") return value.analysis;
  return value;
}

function applyGenerationOptions(body, opts) {
  if (opts.size) body.size = String(opts.size);
  if (opts.quality) body.quality = String(opts.quality);
  if (opts["task-id"]) body.clientTaskId = String(opts["task-id"]);
  if (opts["workflow-id"]) body.workflowId = String(opts["workflow-id"]);
  if (opts["parent-image-id"]) body.parentImageId = String(opts["parent-image-id"]);
  if (opts["step-mode"]) body.stepMode = String(opts["step-mode"]);
  if (opts["input-image-type"]) body.inputImageType = String(opts["input-image-type"]);
  if (opts["no-thinking"]) body.thinkingEnabled = false;
  if (opts.thinking !== undefined) body.thinkingEnabled = parseBoolean(opts.thinking);
}

async function promptFromOptions(opts) {
  if (opts["prompt-file"]) return (await fs.readFile(resolvePath(opts["prompt-file"]), "utf8")).trim();
  if (opts.prompt !== undefined) return String(opts.prompt).trim();
  if (opts.intent !== undefined) return String(opts.intent).trim();
  return "";
}

async function referenceImagesFromOptions(opts) {
  const refs = [
    ...optionArray(opts.ref),
    ...optionArray(opts.reference),
    ...optionArray(opts["reference-image"])
  ];
  const images = [];
  for (const ref of refs) {
    images.push(await inputImageFromOption(ref, { sourceType: "reference" }));
  }
  return images;
}

async function inputImageFromOption(value, defaults = {}) {
  const raw = String(value || "");
  if (raw.startsWith("data:image/")) {
    return {
      name: defaults.name || `inline-${randomUUID().slice(0, 8)}.png`,
      type: raw.match(/^data:([^;]+)/)?.[1] || "image/png",
      sourceType: defaults.sourceType || "reference",
      dataUrl: raw
    };
  }

  const filePath = resolvePath(raw);
  const buffer = await fs.readFile(filePath);
  const type = mimeTypeForPath(filePath);
  return {
    name: path.basename(filePath),
    type,
    sourceType: defaults.sourceType || "reference",
    dataUrl: `data:${type};base64,${buffer.toString("base64")}`
  };
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif"
  }[ext] || "image/png";
}

async function loadJson(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  if (raw === "-") return JSON.parse(await readStdin());
  if (raw.startsWith("{") || raw.startsWith("[")) return JSON.parse(raw);
  return JSON.parse(await fs.readFile(resolvePath(raw), "utf8"));
}

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function optionArray(value) {
  if (value === undefined || value === null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

function requireOption(opts, key, message) {
  const value = opts[key];
  if (value === undefined || value === null || value === "") throw new Error(message);
  return String(value);
}

function resolvePath(value) {
  const raw = String(value || "");
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), raw);
}

function slugFile(value) {
  return String(value || "item")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "-")
    .slice(0, 80) || "item";
}

async function saveImageFromResult(result, outputPath, origin) {
  const image = result?.image || result?.render || result?.result || result;
  const targetPath = resolvePath(outputPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (image?.file && existsSync(image.file)) {
    await fs.copyFile(image.file, targetPath);
    return targetPath;
  }

  const imageUrl = image?.url || image?.imageUrl || image?.href;
  if (!imageUrl) throw new Error("Response did not include an image file or URL");
  const absoluteUrl = imageUrl.startsWith("http") ? imageUrl : `${origin}${imageUrl}`;
  const response = await fetch(absoluteUrl);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  return targetPath;
}

async function writeJsonFile(filePath, value) {
  const targetPath = resolvePath(filePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeResult(result, opts) {
  if (opts.field) {
    const value = getField(result, String(opts.field));
    if (typeof value === "string") {
      process.stdout.write(`${value}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(value, null, opts.compact ? 0 : 2)}\n`);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, opts.compact ? 0 : 2)}\n`);
}

function getField(value, fieldPath) {
  return fieldPath
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => current?.[key], value);
}

main().catch((error) => {
  console.error(`[laogui-api] ${error.message || error}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
