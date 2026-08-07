import test from "node:test";
import assert from "node:assert/strict";
import { parseApiConfigText, normalizeApiProfiles } from "../shared/mobile-api-config.mjs";

test("解析 JSON 多接口并按优先级排序", () => {
  const result = parseApiConfigText(JSON.stringify({ imageEndpoints: [
    { name: "后备", baseUrl: "https://backup.example", apiKey: "sk-backup-123456", model: "model-b", priority: 2 },
    { name: "主线路", baseUrl: "https://primary.example/", apiKey: "sk-primary-123456", model: "model-a", priority: 1 }
  ]}));
  assert.deepEqual(result.errors, []);
  assert.equal(result.profiles[0].label, "主线路");
  assert.equal(result.profiles[0].baseUrl, "https://primary.example");
  assert.equal(result.profiles[1].priority, 2);
});

test("解析多段文本并拒绝只有密钥的配置", () => {
  const result = parseApiConfigText("接口地址=https://one.example\nAPI Key=sk-one-123456\n模型=img-a\n\nsk-only-123456789");
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].model, "img-a");
  assert.ok(result.errors.some((message) => message.includes("缺少接口地址")));
});

test("重复接口保留后一次完整配置并重新编号", () => {
  const profiles = normalizeApiProfiles([
    { baseUrl: "https://same.example", apiKey: "sk-old-123456", model: "old", priority: 1 },
    { baseUrl: "https://same.example/", apiKey: "sk-new-123456", model: "new", priority: 2 }
  ]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].apiKey, "sk-new-123456");
  assert.equal(profiles[0].priority, 1);
});

test("文字模型和对话路径为可选配置", () => {
  const result = parseApiConfigText("接口地址=https://text.example\nAPI Key=sk-text-123456\n模型=image-v1\n文字模型=text-v1\n对话路径=/v1/responses");
  assert.equal(result.profiles[0].textModel, "text-v1");
  assert.equal(result.profiles[0].responsesPath, "/v1/responses");
});
