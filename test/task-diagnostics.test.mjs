import assert from "node:assert/strict";
import test from "node:test";
import { buildFailureLogMarkdown, recentFailureLogs, redactDiagnosticText } from "../task-diagnostics.mjs";

const now = Date.parse("2026-08-06T10:00:00.000Z");

test("失败日志只导出最近三十天的失败和取消记录", () => {
  const logs = [
    { status: "failed", startedAt: "2026-08-05T10:00:00.000Z" },
    { status: "canceled", startedAt: "2026-07-20T10:00:00.000Z" },
    { status: "success", startedAt: "2026-08-05T10:00:00.000Z" },
    { status: "failed", startedAt: "2026-06-01T10:00:00.000Z" }
  ];
  assert.equal(recentFailureLogs(logs, { days: 30, now }).length, 2);
});

test("导出文件隐藏密钥并保留诊断信息", () => {
  const markdown = buildFailureLogMarkdown([{
    id: "task-1",
    type: "render-from-images",
    status: "failed",
    startedAt: "2026-08-05T10:00:00.000Z",
    input: { userPrompt: "暖色灯光", batchId: "batch-1", batchIndex: 1, batchCount: 2 },
    error: { status: 401, message: "Authorization: Bearer sk-secret-123456", details: "apiKey=sk-another-123456" }
  }], { days: 30, now, version: "2.3.6", platform: "darwin-arm64" });
  assert.match(markdown, /暖色灯光/);
  assert.match(markdown, /1\/2/);
  assert.doesNotMatch(markdown, /sk-secret|sk-another/);
  assert.match(markdown, /已隐藏/);
  assert.equal(redactDiagnosticText("--api-key secret-value"), "--api-key 已隐藏");
});
