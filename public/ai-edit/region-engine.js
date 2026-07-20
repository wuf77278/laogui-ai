import { createMask, maskHasSelection } from "../deep-edit/mask-engine.js";

export const AI_EDIT_OPERATIONS = new Set(["remove", "replace", "material", "detail", "custom"]);

export function createNumberedRegions(width, height) {
  return [
    { number: 1, label: "框选编号 1", color: [72, 164, 255], operation: "replace", prompt: "", feather: 2, selectionMode: "semantic", mask: createMask(width, height) },
    { number: 2, label: "框选编号 2", color: [240, 167, 72], operation: "replace", prompt: "", feather: 2, selectionMode: "semantic", mask: createMask(width, height) }
  ];
}

export function numberedRegionJobs(regions = []) {
  const jobs = regions
    .filter((region) => region?.mask && maskHasSelection(region.mask))
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
  if (!jobs.length) throw new Error("请至少创建一个编号选区");
  for (const region of jobs) {
    if (!AI_EDIT_OPERATIONS.has(region.operation)) throw new Error(`${region.label}的编辑类型无效`);
    if (region.operation !== "remove" && !String(region.prompt || "").trim()) {
      throw new Error(`请填写${region.label}的修改要求`);
    }
  }
  return jobs;
}

const WORK_FORMATS = [
  { ratio: 1, outputSize: "1024x1024" },
  { ratio: 1.5, outputSize: "1536x1024" },
  { ratio: 2 / 3, outputSize: "1024x1536" }
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createAiEditWorkArea(bounds, imageWidth, imageHeight, selectionMode = "precise") {
  if (!bounds || imageWidth <= 0 || imageHeight <= 0) throw new Error("框选范围无效");
  const semantic = selectionMode === "semantic";
  const context = clamp(
    Math.round(Math.max(bounds.width, bounds.height) * (semantic ? 0.58 : 0.34)),
    48,
    semantic ? 320 : 220
  );
  const sourceWidth = clamp(Math.round(bounds.width + context * 2), bounds.width, imageWidth);
  const sourceHeight = clamp(Math.round(bounds.height + context * 2), bounds.height, imageHeight);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const sourceX = clamp(Math.round(centerX - sourceWidth / 2), 0, imageWidth - sourceWidth);
  const sourceY = clamp(Math.round(centerY - sourceHeight / 2), 0, imageHeight - sourceHeight);
  const sourceRatio = sourceWidth / sourceHeight;
  const format = WORK_FORMATS.reduce((best, item) => (
    Math.abs(Math.log(sourceRatio / item.ratio)) < Math.abs(Math.log(sourceRatio / best.ratio)) ? item : best
  ), WORK_FORMATS[0]);
  let canvasWidth = sourceWidth;
  let canvasHeight = sourceHeight;
  if (canvasWidth / canvasHeight > format.ratio) canvasHeight = Math.ceil(canvasWidth / format.ratio);
  else canvasWidth = Math.ceil(canvasHeight * format.ratio);
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    canvasWidth,
    canvasHeight,
    offsetX: Math.floor((canvasWidth - sourceWidth) / 2),
    offsetY: Math.floor((canvasHeight - sourceHeight) / 2),
    outputSize: format.outputSize
  };
}

export function maskForAiEditWorkArea(mask, imageWidth, workArea) {
  const output = new Uint8Array(workArea.canvasWidth * workArea.canvasHeight);
  for (let y = 0; y < workArea.sourceHeight; y += 1) {
    const sourceStart = (workArea.sourceY + y) * imageWidth + workArea.sourceX;
    const targetStart = (workArea.offsetY + y) * workArea.canvasWidth + workArea.offsetX;
    output.set(mask.subarray(sourceStart, sourceStart + workArea.sourceWidth), targetStart);
  }
  return output;
}

export function semanticWorkAreaBlendMask(workArea, imageWidth, imageHeight) {
  const output = new Uint8Array(workArea.canvasWidth * workArea.canvasHeight);
  const feather = clamp(Math.round(Math.min(workArea.sourceWidth, workArea.sourceHeight) * 0.08), 24, 72);
  const fadeLeft = workArea.sourceX > 0;
  const fadeTop = workArea.sourceY > 0;
  const fadeRight = workArea.sourceX + workArea.sourceWidth < imageWidth;
  const fadeBottom = workArea.sourceY + workArea.sourceHeight < imageHeight;
  for (let y = 0; y < workArea.sourceHeight; y += 1) {
    for (let x = 0; x < workArea.sourceWidth; x += 1) {
      let strength = 1;
      if (fadeLeft) strength = Math.min(strength, (x + 1) / feather);
      if (fadeTop) strength = Math.min(strength, (y + 1) / feather);
      if (fadeRight) strength = Math.min(strength, (workArea.sourceWidth - x) / feather);
      if (fadeBottom) strength = Math.min(strength, (workArea.sourceHeight - y) / feather);
      const normalized = clamp(strength, 0, 1);
      const smooth = normalized * normalized * (3 - 2 * normalized);
      const target = (workArea.offsetY + y) * workArea.canvasWidth + workArea.offsetX + x;
      output[target] = Math.round(smooth * 255);
    }
  }
  return output;
}
