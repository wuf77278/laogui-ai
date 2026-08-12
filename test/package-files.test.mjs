import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("桌面安装包包含服务端直接引用的诊断模块", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.files.includes("task-diagnostics.mjs"));
  assert.ok(packageJson.build.files.includes("task-diagnostics.mjs"));
});
