import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectStore } from "./projectStore.mjs";
import { hasValidImageSignature } from "./uploadValidation.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(rootDir, "server", "local-db", "projects.json");
const uploadDir = join(rootDir, "public", "uploads");
const port = Number(process.env.PORT || 4178);
const isProduction = process.env.NODE_ENV === "production";
const store = createProjectStore(dataPath);
const app = express();

await mkdir(uploadDir, { recursive: true });
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const allowedMimeTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"]
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(allowedMimeTypes.has(file.mimetype) ? null : new Error("只支持 JPG、PNG、WebP 或 AVIF 图片"), allowedMimeTypes.has(file.mimetype));
  }
});
const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const ok = (response, data) => response.json({ success: true, data });
const fail = (response, status, error, details) => response.status(status).json({ success: false, error, details });

app.get("/api/health", (_request, response) => ok(response, { status: "ok", mode: isProduction ? "production" : "development" }));
app.get("/api/projects", async (request, response, next) => {
  try {
    const projects = await store.list();
    ok(response, request.query.includeHidden === "1" ? projects : projects.filter((project) => project.isPublished));
  } catch (error) { next(error); }
});
app.get("/api/projects/:id", async (request, response, next) => {
  try {
    const project = await store.get(request.params.id);
    if (!project) return fail(response, 404, "没有找到这个项目");
    return ok(response, project);
  } catch (error) { return next(error); }
});
app.post("/api/projects", async (request, response, next) => {
  try { return response.status(201).json({ success: true, data: await store.create(request.body) }); }
  catch (error) { return next(error); }
});
app.put("/api/projects/:id", async (request, response, next) => {
  try {
    const project = await store.update(request.params.id, request.body);
    if (!project) return fail(response, 404, "没有找到这个项目");
    return ok(response, project);
  } catch (error) { return next(error); }
});
app.delete("/api/projects/:id", async (request, response, next) => {
  try {
    if (!await store.remove(request.params.id)) return fail(response, 404, "没有找到这个项目");
    return ok(response, { id: request.params.id });
  } catch (error) { return next(error); }
});
app.post("/api/uploads", upload.single("image"), async (request, response, next) => {
  try {
    if (!request.file) return fail(response, 400, "请选择需要上传的图片");
    if (!hasValidImageSignature(request.file.buffer, request.file.mimetype)) {
      return fail(response, 400, "图片内容与文件格式不一致");
    }
    const extension = allowedMimeTypes.get(request.file.mimetype) || extname(request.file.originalname).toLowerCase();
    const filename = `${Date.now()}-${randomUUID()}${extension}`;
    await writeFile(join(uploadDir, filename), request.file.buffer);
    return ok(response, { url: `/map-portfolio/uploads/${filename}` });
  } catch (error) { return next(error); }
});
app.get("/api/backup", async (_request, response, next) => {
  try {
    const content = await readFile(dataPath, "utf8");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="design-map-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    response.send(content);
  } catch (error) { next(error); }
});
app.post("/api/restore", backupUpload.single("backup"), async (request, response, next) => {
  try {
    if (!request.file) return fail(response, 400, "请选择 JSON 备份文件");
    const projects = JSON.parse(request.file.buffer.toString("utf8"));
    return ok(response, await store.replaceAll(projects));
  } catch (error) { return next(error); }
});

app.use("/map-portfolio/uploads", express.static(uploadDir, { fallthrough: false, immutable: false }));
if (!isProduction) {
  app.use("/map-portfolio/cesium", express.static(join(rootDir, "node_modules", "cesium", "Build", "Cesium")));
}

if (isProduction) {
  const distDir = join(rootDir, "dist");
  app.use("/map-portfolio", express.static(distDir));
  app.get(["/map-portfolio", "/map-portfolio/*path"], (_request, response) => response.sendFile(join(distDir, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: rootDir, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.get("/", (_request, response) => response.redirect("/map-portfolio/"));
app.use((error, _request, response, _next) => {
  const isUploadError = error instanceof multer.MulterError;
  const status = isUploadError || error instanceof SyntaxError ? 400 : 422;
  fail(response, status, isUploadError && error.code === "LIMIT_FILE_SIZE" ? "图片不能超过 8MB" : error.message || "本地服务发生错误");
});

app.listen(port, "127.0.0.1", () => {
  console.log(`设计行迹已启动：http://127.0.0.1:${port}/map-portfolio/`);
});
