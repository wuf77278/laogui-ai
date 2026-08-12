import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagnosticSummary, buildFailureLogMarkdown, diagnosticJsonLines, recentDiagnosticEntries, recentFailureLogs, redactDiagnosticText, sanitizeDiagnosticValue } from "../task-diagnostics.mjs";

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

test("诊断日志只保留最近七天并隐藏图片和密钥", () => {
  const entries = [
    { time: "2026-08-05T10:00:00.000Z", action: "ai-edit", details: { dataUrl: "data:image/png;base64,abc", apiKey: "sk-secret-123456", file: "客厅.png" } },
    { time: "2026-07-20T10:00:00.000Z", action: "old" }
  ];
  assert.equal(recentDiagnosticEntries(entries, { days: 7, now }).length, 1);
  const exported = diagnosticJsonLines(entries, { days: 7, now });
  assert.match(exported, /客厅\.png/);
  assert.match(exported, /图片内容已省略/);
  assert.doesNotMatch(exported, /sk-secret|base64,abc/);
  assert.equal(sanitizeDiagnosticValue({ token: "private" }).token, "已隐藏");
});

test("诊断摘要包含操作任务和异常数量", () => {
  const summary = buildDiagnosticSummary({
    events: [{ time: "2026-08-05T10:00:00.000Z", action: "ai-edit-open", status: "failed", level: "error", message: "图片载入失败" }],
    tasks: [{ startedAt: "2026-08-05T10:01:00.000Z", type: "ai-edit", status: "failed", error: { message: "生成失败" } }],
    system: { version: "2.3.10", platform: "win32-x64" },
    days: 7,
    now
  });
  assert.match(summary, /2\.3\.10/);
  assert.match(summary, /win32-x64/);
  assert.match(summary, /图片载入失败/);
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
