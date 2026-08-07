import assert from "node:assert/strict";
import test from "node:test";
import { runSettledTaskBatch, summarizeTaskBatch } from "../public/task-batch.js";

test("多图任务最多同时运行两张并保留部分成功结果", async () => {
  let active = 0;
  let peak = 0;
  const results = await runSettledTaskBatch([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (value === 2) throw new Error("第二张失败");
    return value;
  });
  assert.equal(peak, 2);
  assert.deepEqual(summarizeTaskBatch(results), { success: 3, failed: 1, canceled: 0 });
});

test("停止整批后不再启动排队图片", async () => {
  const controller = new AbortController();
  const started = [];
  const results = await runSettledTaskBatch([1, 2, 3, 4], 2, async (value) => {
    started.push(value);
    controller.abort();
    const error = new Error("用户停止生成");
    error.canceled = true;
    throw error;
  }, { signal: controller.signal });
  assert.deepEqual(started, [1]);
  assert.deepEqual(summarizeTaskBatch(results), { success: 0, failed: 0, canceled: 4 });
});
