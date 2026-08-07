import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("手机版和电脑端使用同一份通用接口解析规则", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const shared = readFileSync(path.join(root, "shared", "mobile-api-config.mjs"), "utf8");
  const mobile = readFileSync(path.join(root, "mobile", "api-config-parser.js"), "utf8");
  assert.equal(mobile, shared);
  assert.match(mobile, /baseUrl/);
  assert.doesNotMatch(mobile, /provider-config\.json/);
});
