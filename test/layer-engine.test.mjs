import test from "node:test";
import assert from "node:assert/strict";
import { createLayer, insertLayer, moveLayer, removeLayer, updateLayer } from "../public/deep-edit/layer-engine.js";

test("图层可以新增、排序和删除", () => {
  const base = createLayer({ id: "base", type: "base", locked: true });
  const paint = createLayer({ id: "paint", name: "绘画" });
  const text = createLayer({ id: "text", type: "text", text: "老鬼AI" });
  let layers = insertLayer([base], paint, "base");
  layers = insertLayer(layers, text, "paint");
  assert.deepEqual(layers.map((layer) => layer.id), ["base", "paint", "text"]);
  layers = moveLayer(layers, "text", -1);
  assert.deepEqual(layers.map((layer) => layer.id), ["base", "text", "paint"]);
  assert.equal(removeLayer(layers, "base").length, 3);
  assert.deepEqual(removeLayer(layers, "text").map((layer) => layer.id), ["base", "paint"]);
});

test("图层属性会被限制在安全范围", () => {
  const layer = createLayer({ id: "a", opacity: 2, blendMode: "unknown", fontSize: 9999 });
  const [updated] = updateLayer([layer], "a", { opacity: 0.35, blendMode: "multiply" });
  assert.equal(layer.opacity, 1);
  assert.equal(layer.blendMode, "source-over");
  assert.equal(layer.fontSize, 600);
  assert.equal(updated.opacity, 0.35);
  assert.equal(updated.blendMode, "multiply");
});
