import { describe, expect, it } from "vitest";
import { getChinaBoundaryRings } from "../../src/map/chinaBoundary";

describe("中国地图边界", () => {
  it("包含中国大陆、海南相关岛屿和台湾轮廓", () => {
    const rings = getChinaBoundaryRings();
    expect(rings.length).toBeGreaterThanOrEqual(3);
    expect(rings.every((ring) => ring.length >= 3)).toBe(true);
  });

  it("统一使用 Cesium 裁剪需要的逆时针方向", () => {
    const orientations = getChinaBoundaryRings().map((ring) => {
      let value = 0;
      for (let index = 0; index < ring.length - 1; index += 1) {
        value += (ring[index + 1][0] - ring[index][0]) * (ring[index + 1][1] + ring[index][1]);
      }
      return value;
    });
    expect(orientations.every((orientation) => orientation <= 0)).toBe(true);
  });
});
