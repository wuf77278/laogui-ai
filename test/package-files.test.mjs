import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
});
