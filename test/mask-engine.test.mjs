import test from "node:test";
import assert from "node:assert/strict";
import {
  combineMasks,
  createMask,
  colorRangeMask,
  ellipseMask,
  featherMask,
  growMask,
  invertMask,
  magicWandMask,
  maskBounds,
  polygonMask,
  rectangleMask,
  shrinkMask,
  strokeMask
} from "../public/deep-edit/mask-engine.js";

test("椭圆选区和全图颜色选择正确", () => {
  const ellipse = ellipseMask(9, 9, { x: 1, y: 1 }, { x: 7, y: 7 });
  assert.equal(ellipse[4 * 9 + 4], 255);
  assert.equal(ellipse[1 * 9 + 1], 0);
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < 16; index += 1) {
    pixels[index * 4] = index % 2 ? 240 : 20;
    pixels[index * 4 + 3] = 255;
  }
  const selected = colorRangeMask(pixels, 4, 4, 0, 0, 5);
  assert.equal([...selected].filter(Boolean).length, 8);
});

test("矩形和多边形蒙版生成正确区域", () => {
  const rectangle = rectangleMask(10, 10, { x: 2, y: 2 }, { x: 5, y: 5 });
  assert.deepEqual(maskBounds(rectangle, 10, 10), { x: 2, y: 2, width: 4, height: 4, area: 16 });
  const polygon = polygonMask(10, 10, [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 4, y: 8 }]);
  assert.ok(maskBounds(polygon, 10, 10).area > 20);
});

test("蒙版增加、减去、相交和反选正确", () => {
  const a = rectangleMask(8, 8, { x: 1, y: 1 }, { x: 4, y: 4 });
  const b = rectangleMask(8, 8, { x: 3, y: 3 }, { x: 6, y: 6 });
  assert.ok(maskBounds(combineMasks(a, b, "add"), 8, 8).area > maskBounds(a, 8, 8).area);
  assert.equal(maskBounds(combineMasks(a, b, "intersect"), 8, 8).area, 4);
  assert.equal(maskBounds(combineMasks(a, b, "subtract"), 8, 8).area, 12);
  assert.equal(maskBounds(invertMask(createMask(8, 8)), 8, 8).area, 64);
});

test("连续画笔不会留下断点", () => {
  const mask = strokeMask(30, 10, [{ x: 2, y: 5 }, { x: 27, y: 5 }], 2);
  for (let x = 2; x <= 27; x += 1) assert.equal(mask[5 * 30 + x], 255);
});

test("魔棒被明显颜色边缘阻挡", () => {
  const width = 12;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x < 6 ? 30 : 230;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const mask = magicWandMask(data, width, height, 2, 3, 20);
  assert.equal(mask[3 * width + 2], 255);
  assert.equal(mask[3 * width + 9], 0);
});

test("扩大、收缩和羽化保持合理边缘", () => {
  const base = rectangleMask(20, 20, { x: 6, y: 6 }, { x: 13, y: 13 });
  const grown = growMask(base, 20, 20, 2);
  const shrunk = shrinkMask(base, 20, 20, 2);
  assert.ok(maskBounds(grown, 20, 20).area > maskBounds(base, 20, 20).area);
  assert.ok(maskBounds(shrunk, 20, 20).area < maskBounds(base, 20, 20).area);
  const feathered = featherMask(base, 20, 20, 2);
  assert.ok(feathered.some((value) => value > 0 && value < 255));
});
