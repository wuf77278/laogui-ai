import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const envPath = path.join(rootDir, ".env");
loadDotEnv(envPath);

const appDataDir = process.env.LAOGUI_DATA_DIR ? path.resolve(process.env.LAOGUI_DATA_DIR) : rootDir;
const externalDataDirEnabled = Boolean(process.env.LAOGUI_DATA_DIR);
const generatedDir = externalDataDirEnabled ? path.join(appDataDir, "generated") : path.join(rootDir, "public", "generated");
const logsDir = path.join(appDataDir, "logs");
const runtimeSettingsPath = path.join(logsDir, "runtime-settings.json");
const imageStudioEngineDir = path.join(rootDir, "engines", "image-studio");
const releaseImageStudioPlatforms = ["darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64"];

const checks = [];

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

function add(status, title, detail = "") {
  checks.push({ status, title, detail });
}

function hasValue(key) {
  return Boolean(String(process.env[key] || "").trim());
}

async function loadRuntimeSettings() {
  try {
    return JSON.parse(await fs.readFile(runtimeSettingsPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      add("warn", "运行时设置", `无法读取 ${path.relative(rootDir, runtimeSettingsPath)}: ${error.message}`);
    }
    return {};
  }
}

function runtimeProviderConfigured(settings, kind) {
  const provider = settings?.providers?.[kind];
  return Boolean(
    provider
      && String(provider.baseUrl || "").trim()
      && String(provider.apiKey || "").trim()
  );
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
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

function imageStudioBundledCliCandidates() {
  const executable = imageStudioCliExecutableName();
  return [
    path.join(imageStudioEngineDir, imageStudioRuntimePlatformId(), executable),
    path.join(imageStudioEngineDir, executable)
  ].map((candidate) => path.resolve(candidate));
}

function imageStudioCliCandidates() {
  return [
    ...imageStudioBundledCliCandidates(),
    path.join(rootDir, "bin", imageStudioCliExecutableName()),
    process.env.IMAGE_STUDIO_CLI_PATH || process.env.GPTCODEX_IMAGE_CLI || ""
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
}

function resolveImageStudioCliPath() {
  return imageStudioCliCandidates().find((candidate) => existsSync(candidate)) || "";
}

function canExecute(filePath) {
  if (!filePath || !existsSync(filePath)) return false;
  if (process.platform === "win32") return true;
  try {
    execFileSync("test", ["-x", filePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function imageStudioCliHelpText(filePath) {
  const result = spawnSync(filePath, ["--help"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

async function packagedImageStudioPlatforms() {
  try {
    const entries = await fs.readdir(imageStudioEngineDir, { withFileTypes: true });
    const platforms = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-z0-9]+-[a-z0-9_]+$/i.test(entry.name)) continue;
      const executable = entry.name.startsWith("win32-") ? "gptcodex-image.exe" : "gptcodex-image";
      const candidate = path.join(imageStudioEngineDir, entry.name, executable);
      if (existsSync(candidate)) platforms.push(entry.name);
    }
    return platforms.sort();
  } catch {
    return [];
  }
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

async function ensureWritableDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const testPath = path.join(dirPath, `.doctor-${Date.now()}.tmp`);
  await fs.writeFile(testPath, "ok");
  await fs.unlink(testPath);
}

async function dirSize(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let bytes = 0;
    let files = 0;
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = await dirSize(fullPath);
        bytes += nested.bytes;
        files += nested.files;
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        bytes += stat.size;
        files += 1;
      }
    }
    return { bytes, files };
  } catch (error) {
    if (error.code === "ENOENT") return { bytes: 0, files: 0 };
    throw error;
  }
}

function nodeVersionOk() {
  const major = Number(process.versions.node.split(".")[0]);
  return Number.isFinite(major) && major >= 18;
}

function diskFreeText() {
  try {
    return execFileSync("df", ["-h", rootDir], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1) || "";
  } catch {
    return "";
  }
}

async function main() {
  const runtimeSettings = await loadRuntimeSettings();
  add(nodeVersionOk() ? "ok" : "fail", "Node 版本", process.version);
  add(existsSync(envPath) ? "ok" : "fail", ".env 文件", existsSync(envPath) ? ".env 已存在" : "缺少 .env，请复制 .env.example 后填写");

  const reasoningEnvKey = hasValue("REASONING_API_KEY") || hasValue("OPENAI_API_KEY") || hasValue("YYBB_API_KEY");
  const imageEnvKey = hasValue("IMAGE_API_KEY") || hasValue("YYBB_API_KEY") || hasValue("OPENAI_API_KEY");
  const reasoningRuntimeKey = runtimeProviderConfigured(runtimeSettings, "reasoning");
  const imageRuntimeKey = runtimeProviderConfigured(runtimeSettings, "image");
  const reasoningKey = reasoningEnvKey || reasoningRuntimeKey;
  const imageKey = imageEnvKey || imageRuntimeKey;
  add(
    reasoningKey ? "ok" : "fail",
    "思考 API Key",
    reasoningEnvKey ? "已通过 .env 配置" : reasoningRuntimeKey ? "已通过设置面板保存" : "缺少 REASONING_API_KEY / OPENAI_API_KEY / YYBB_API_KEY"
  );
  add(
    imageKey ? "ok" : "fail",
    "生图 API Key",
    imageEnvKey ? "已通过 .env 配置" : imageRuntimeKey ? "已通过设置面板保存" : "缺少 IMAGE_API_KEY / YYBB_API_KEY / OPENAI_API_KEY"
  );

  const engineMode = normalizeImageStudioEngineMode(process.env.IMAGE_STUDIO_ENGINE || process.env.IMAGE_ENGINE);
  const platformId = imageStudioRuntimePlatformId();
  const bundledCliPaths = imageStudioBundledCliCandidates();
  const bundledCliPath = bundledCliPaths.find((candidate) => existsSync(candidate)) || bundledCliPaths[0];
  const resolvedCliPath = resolveImageStudioCliPath();
  const bundledCliExists = existsSync(bundledCliPath);
  const resolvedCliExists = Boolean(resolvedCliPath && existsSync(resolvedCliPath));
  const packagedPlatforms = await packagedImageStudioPlatforms();
  add("ok", "当前运行平台", platformId);
  add(engineMode === "disabled" ? "warn" : "ok", "Image Studio 引擎模式", `IMAGE_STUDIO_ENGINE=${engineMode}`);
  add(
    bundledCliExists ? "ok" : engineMode === "required" ? "warn" : "warn",
    "打包内置 Image Studio CLI",
    bundledCliExists
      ? path.relative(rootDir, bundledCliPath)
      : `未找到 ${path.relative(rootDir, bundledCliPath)}；分发给朋友前需要放入 gptcodex-image`
  );
  add(
    packagedPlatforms.length ? "ok" : "warn",
    "已打包内核平台",
    packagedPlatforms.length ? packagedPlatforms.join(", ") : "未找到平台目录；将只依赖旧版扁平路径"
  );
  const missingReleasePlatforms = releaseImageStudioPlatforms.filter((platform) => !packagedPlatforms.includes(platform));
  add(
    missingReleasePlatforms.length ? "warn" : "ok",
    "macOS/Windows 内核覆盖",
    missingReleasePlatforms.length
      ? `缺少 ${missingReleasePlatforms.join(", ")}；发布前运行 npm run engine:image-studio:all`
      : "darwin-arm64, darwin-x64, win32-x64, win32-arm64 已齐全"
  );
  add(
    resolvedCliExists || engineMode !== "required" ? "ok" : "fail",
    "Image Studio CLI 可用",
    resolvedCliExists ? resolvedCliPath : "required 模式下未找到 gptcodex-image"
  );
  if (resolvedCliExists) {
    const executable = canExecute(resolvedCliPath);
    const helpText = executable ? imageStudioCliHelpText(resolvedCliPath) : "";
    const looksLikeImageStudioCli = /api-mode|responses-transport|reference-image|gptcodex/i.test(helpText);
    add(executable ? "ok" : "fail", "Image Studio CLI 可执行", executable ? "可以执行" : "文件存在但不可执行，请 chmod +x");
    add(
      looksLikeImageStudioCli ? "ok" : "warn",
      "Image Studio CLI 参数",
      looksLikeImageStudioCli ? "检测到 api-mode / responses-transport / reference-image 支持" : "未从 --help 中识别到预期参数"
    );
    const usingBundled = bundledCliPaths.some((candidate) => path.resolve(resolvedCliPath) === path.resolve(candidate));
    add(
      usingBundled ? "ok" : "warn",
      "朋友版引擎来源",
      usingBundled ? "使用 engines/image-studio 内置引擎" : `当前使用外部引擎：${resolvedCliPath}`
    );
  }

  try {
    await ensureWritableDir(logsDir);
    add("ok", "logs 可写", path.relative(rootDir, logsDir));
  } catch (error) {
    add("fail", "logs 可写", error.message);
  }

  try {
    await ensureWritableDir(generatedDir);
    add("ok", "public/generated 可写", path.relative(rootDir, generatedDir));
  } catch (error) {
    add("fail", "public/generated 可写", error.message);
  }

  const generated = await dirSize(generatedDir);
  const logs = await dirSize(logsDir);
  add(generated.bytes > 1024 ** 3 ? "warn" : "ok", "生成图占用", `${formatBytes(generated.bytes)} / ${generated.files} 文件`);
  add(logs.bytes > 200 * 1024 ** 2 ? "warn" : "ok", "日志占用", `${formatBytes(logs.bytes)} / ${logs.files} 文件`);

  const host = String(process.env.HOST || process.env.LAOGUI_HOST || "127.0.0.1").trim();
  const networkHost = !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
  const tokenConfigured = hasValue("LAOGUI_API_TOKEN") || hasValue("API_ACCESS_TOKEN");
  const corsConfigured = hasValue("API_CORS_ORIGIN");
  const unauthenticatedRemoteAllowed = parseBooleanEnv(process.env.LAOGUI_ALLOW_UNAUTHENTICATED_REMOTE || process.env.API_ALLOW_UNAUTHENTICATED_REMOTE, false);
  add(networkHost ? "warn" : "ok", "服务监听地址", networkHost ? `${host} 会暴露到网络，请确认已配置口令` : `${host}（仅本机）`);
  add(!networkHost || tokenConfigured ? "ok" : "warn", "外部访问口令", tokenConfigured ? "已配置" : "局域网/内网穿透时请配置 LAOGUI_API_TOKEN");
  add(!networkHost || corsConfigured ? "ok" : "warn", "外部访问 CORS", corsConfigured ? process.env.API_CORS_ORIGIN : "局域网/内网穿透时建议固定 API_CORS_ORIGIN");
  add(unauthenticatedRemoteAllowed ? "warn" : "ok", "远程无口令访问", unauthenticatedRemoteAllowed ? "已显式允许，请仅用于受控内网" : "默认拒绝");

  const disk = diskFreeText();
  add(disk ? "ok" : "warn", "磁盘空间", disk || "无法读取 df 输出");

  const icon = { ok: "OK", warn: "WARN", fail: "FAIL" };
  for (const check of checks) {
    console.log(`[${icon[check.status]}] ${check.title}: ${check.detail}`);
  }

  const failed = checks.some((check) => check.status === "fail");
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(`[FAIL] doctor: ${error.message || error}`);
  process.exit(1);
});
