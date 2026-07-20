export const LAYER_BLEND_MODES = [
  ["source-over", "正常"],
  ["multiply", "正片叠底"],
  ["screen", "滤色"],
  ["overlay", "叠加"],
  ["soft-light", "柔光"],
  ["hard-light", "强光"],
  ["darken", "变暗"],
  ["lighten", "变亮"],
  ["color-dodge", "颜色减淡"],
  ["color-burn", "颜色加深"],
  ["difference", "差值"]
];

const validBlendModes = new Set(LAYER_BLEND_MODES.map(([value]) => value));

export function createLayer({ id, name = "新图层", type = "pixel", visible = true, locked = false, opacity = 1, blendMode = "source-over", x = 0, y = 0, canvas = null, text = "", fontSize = 48, color = "#ffffff" } = {}) {
  return {
    id: String(id || `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name: String(name || "新图层").slice(0, 80),
    type: ["pixel", "text", "base"].includes(type) ? type : "pixel",
    visible: visible !== false,
    locked: Boolean(locked),
    opacity: Math.max(0, Math.min(1, Number(opacity) || 0)),
    blendMode: validBlendModes.has(blendMode) ? blendMode : "source-over",
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    canvas,
    text: String(text || "").slice(0, 500),
    fontSize: Math.max(6, Math.min(600, Math.round(Number(fontSize) || 48))),
    color: /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : "#ffffff"
  };
}

export function activeLayer(layers = [], activeId = "") {
  return layers.find((layer) => layer.id === activeId) || layers.at(-1) || null;
}

export function insertLayer(layers = [], layer, afterId = "") {
  const next = [...layers];
  const index = next.findIndex((item) => item.id === afterId);
  next.splice(index >= 0 ? index + 1 : next.length, 0, layer);
  return next;
}

export function removeLayer(layers = [], id = "") {
  const target = layers.find((layer) => layer.id === id);
  if (!target || target.type === "base" || target.locked) return layers;
  return layers.filter((layer) => layer.id !== id);
}

export function moveLayer(layers = [], id = "", direction = 1) {
  const index = layers.findIndex((layer) => layer.id === id);
  const target = index + (direction > 0 ? 1 : -1);
  if (index < 0 || target < 0 || target >= layers.length) return layers;
  const next = [...layers];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function updateLayer(layers = [], id = "", changes = {}) {
  return layers.map((layer) => layer.id === id ? createLayer({ ...layer, ...changes, id: layer.id, canvas: changes.canvas ?? layer.canvas }) : layer);
}

export function serializableLayer(layer = {}) {
  const { canvas: _canvas, ...metadata } = layer;
  return { ...metadata };
}
