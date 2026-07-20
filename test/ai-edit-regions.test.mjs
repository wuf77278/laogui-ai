import test from "node:test";
import assert from "node:assert/strict";
import { rectangleMask } from "../public/deep-edit/mask-engine.js";
import {
  createAiEditWorkArea,
  createNumberedRegions,
  maskForAiEditWorkArea,
  numberedRegionJobs,
  semanticWorkAreaBlendMask
} from "../public/ai-edit/region-engine.js";

test("两个编号选区分别保留自己的提示词并按编号处理", () => {
  const regions = createNumberedRegions(8, 8);
  regions[1].mask = rectangleMask(8, 8, { x: 4, y: 4 }, { x: 8, y: 8 });
  regions[1].prompt = "把右侧改成木材";
  regions[0].mask = rectangleMask(8, 8, { x: 0, y: 0 }, { x: 4, y: 4 });
  regions[0].prompt = "把左侧改成石材";
  const jobs = numberedRegionJobs([regions[1], regions[0]]);
  assert.deepEqual(jobs.map((job) => job.number), [1, 2]);
  assert.deepEqual(jobs.map((job) => job.prompt), ["把左侧改成石材", "把右侧改成木材"]);
});

test("局部替换缺少对应提示词时会指出具体编号", () => {
  const regions = createNumberedRegions(8, 8);
  regions[1].mask = rectangleMask(8, 8, { x: 1, y: 1 }, { x: 7, y: 7 });
  assert.throws(() => numberedRegionJobs(regions), /框选编号 2/);
});

test("局部消除允许使用空提示词", () => {
  const regions = createNumberedRegions(8, 8);
  regions[0].operation = "remove";
  regions[0].mask = rectangleMask(8, 8, { x: 1, y: 1 }, { x: 7, y: 7 });
  assert.equal(numberedRegionJobs(regions).length, 1);
});

test("编号选区支持智能范围和自定义编辑", () => {
  const regions = createNumberedRegions(8, 8);
  assert.equal(regions[0].selectionMode, "semantic");
  regions[0].operation = "custom";
  regions[0].prompt = "增加暖白色灯光";
  regions[0].mask = rectangleMask(8, 8, { x: 1, y: 1 }, { x: 6, y: 6 });
  assert.equal(numberedRegionJobs(regions)[0].operation, "custom");
});

test("横向分散选区会生成横版大模型工作区", () => {
  const area = createAiEditWorkArea({ x: 546, y: 700, width: 643, height: 100, area: 16500 }, 1674, 940);
  assert.equal(area.outputSize, "1536x1024");
  assert.ok(Math.abs(area.canvasWidth / area.canvasHeight - 1.5) < 0.01);
  assert.ok(area.sourceX <= 546);
  assert.ok(area.sourceY <= 700);
  assert.ok(area.sourceX + area.sourceWidth >= 1189);
  assert.ok(area.sourceY + area.sourceHeight >= 800);
});

test("工作区蒙版保留原选区且不选择补边", () => {
  const width = 100;
  const height = 60;
  const mask = rectangleMask(width, height, { x: 40, y: 25 }, { x: 60, y: 35 });
  const area = createAiEditWorkArea({ x: 40, y: 25, width: 21, height: 11, area: 231 }, width, height);
  const workMask = maskForAiEditWorkArea(mask, width, area);
  assert.equal(workMask.filter((value) => value > 0).length, mask.filter((value) => value > 0).length);
  assert.equal(workMask[0], 0);
});

test("智能范围比精准蒙版保留更多识别上下文", () => {
  const bounds = { x: 400, y: 300, width: 120, height: 80, area: 9600 };
  const precise = createAiEditWorkArea(bounds, 1200, 800, "precise");
  const semantic = createAiEditWorkArea(bounds, 1200, 800, "semantic");
  assert.ok(semantic.sourceWidth >= precise.sourceWidth);
  assert.ok(semantic.sourceHeight >= precise.sourceHeight);
});

test("智能范围使用连贯工作区回填而不是小矩形贴片", () => {
  const full = {
    sourceX: 0, sourceY: 0, sourceWidth: 8, sourceHeight: 6,
    canvasWidth: 8, canvasHeight: 6, offsetX: 0, offsetY: 0
  };
  assert.ok(semanticWorkAreaBlendMask(full, 8, 6).every((value) => value === 255));

  const partial = {
    sourceX: 20, sourceY: 20, sourceWidth: 80, sourceHeight: 60,
    canvasWidth: 80, canvasHeight: 60, offsetX: 0, offsetY: 0
  };
  const blended = semanticWorkAreaBlendMask(partial, 200, 160);
  assert.ok(blended[0] < 20);
  assert.equal(blended[30 * 80 + 40], 255);
});
