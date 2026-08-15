import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("桌面安装包包含服务端直接引用的诊断模块", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.files.includes("task-diagnostics.mjs"));
  assert.ok(packageJson.build.files.includes("task-diagnostics.mjs"));
});

test("Windows 主进程记录启动、页面和崩溃诊断", async () => {
  const source = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(source, /desktop-events\.jsonl/);
  assert.match(source, /did-fail-load/);
  assert.match(source, /render-process-gone/);
  assert.match(source, /uncaughtExceptionMonitor/);
  assert.equal((source.match(/writeDesktopEvent\("render-process-gone"/g) || []).length, 1);
});

test("Mac 和 Windows 安装包所需的四套图片内核都已准备", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.build.extraResources.some((resource) => resource.from === "engines" && resource.to === "engines"));
  const engines = [
    "../engines/image-studio/darwin-arm64/gptcodex-image",
    "../engines/image-studio/darwin-x64/gptcodex-image",
    "../engines/image-studio/win32-x64/gptcodex-image.exe",
    "../engines/image-studio/win32-arm64/gptcodex-image.exe"
  ];
  for (const engine of engines) {
    const info = await stat(new URL(engine, import.meta.url));
    assert.ok(info.isFile() && info.size > 0, `${engine} 缺失或为空`);
  }
});

test("安装包只保留当前平台图片内核并删除旧兼容文件", async () => {
  const source = await readFile(new URL("../scripts/after-pack.cjs", import.meta.url), "utf8");
  assert.match(source, /gptcodex-image"\), \{ force: true \}/);
  assert.match(source, /gptcodex-image\.exe"\), \{ force: true \}/);
});

test("Windows 安装验收会真实执行内置内核 AI 编辑", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test-windows-installer.yml", import.meta.url), "utf8");
  const verifier = await readFile(new URL("../scripts/verify-installed-ai-edit.mjs", import.meta.url), "utf8");
  assert.match(workflow, /真实执行一次 AI 编辑/);
  assert.match(workflow, /verify-installed-ai-edit\.mjs/);
  assert.match(verifier, /\/api\/ai-edit/);
  assert.match(verifier, /image-studio-cli/);
});

test("首页循环视频经过桌面安装包体积优化", async () => {
  for (const index of [1, 2, 3]) {
    const info = await stat(new URL(`../public/assets/home/architectural-sketch-home-${index}-4k.mp4`, import.meta.url));
    assert.ok(info.size < 8 * 1024 * 1024, `首页视频 ${index} 仍然过大`);
  }
});
