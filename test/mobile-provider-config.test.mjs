import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateMobileProviderConfig } from "../scripts/generate-mobile-provider-config.mjs";

test("手机版接口配置始终来自最新聚合生图脚本", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "laogui-mobile-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, "provider-config.json");
  const config = generateMobileProviderConfig(target);
  assert.deepEqual(config.providers.map((item) => item.id), ["fhl", "yybb", "aiwanwu"]);
  assert.equal(config.model, "gpt-image-2");
  assert.equal(config.endpoints.generation, "/v1/images/generations");
  assert.equal(config.endpoints.edit, "/v1/images/edits");
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), config);
});
