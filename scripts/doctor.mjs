import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const envPath = path.join(rootDir, ".env");
const generatedDir = path.join(rootDir, "public", "generated");
const logsDir = path.join(rootDir, "logs");

loadDotEnv(envPath);

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
  add(nodeVersionOk() ? "ok" : "fail", "Node 版本", process.version);
  add(existsSync(envPath) ? "ok" : "fail", ".env 文件", existsSync(envPath) ? ".env 已存在" : "缺少 .env，请复制 .env.example 后填写");

  const reasoningKey = hasValue("REASONING_API_KEY") || hasValue("OPENAI_API_KEY") || hasValue("YYBB_API_KEY");
  const imageKey = hasValue("IMAGE_API_KEY") || hasValue("YYBB_API_KEY") || hasValue("OPENAI_API_KEY");
  add(reasoningKey ? "ok" : "fail", "思考 API Key", reasoningKey ? "已配置" : "缺少 REASONING_API_KEY / OPENAI_API_KEY / YYBB_API_KEY");
  add(imageKey ? "ok" : "fail", "生图 API Key", imageKey ? "已配置" : "缺少 IMAGE_API_KEY / YYBB_API_KEY / OPENAI_API_KEY");

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

  const tokenConfigured = hasValue("LAOGUI_API_TOKEN") || hasValue("API_ACCESS_TOKEN");
  const corsConfigured = hasValue("API_CORS_ORIGIN");
  add(tokenConfigured ? "ok" : "warn", "外部访问口令", tokenConfigured ? "已配置" : "外部访问建议强制配置 LAOGUI_API_TOKEN");
  add(corsConfigured ? "ok" : "warn", "外部访问 CORS", corsConfigured ? process.env.API_CORS_ORIGIN : "外部访问建议固定 API_CORS_ORIGIN");

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
