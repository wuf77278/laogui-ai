import {
  cloneMask,
  colorRangeMask,
  combineMasks,
  createMask,
  ellipseMask,
  featherMask,
  growMask,
  invertMask,
  magicWandMask,
  maskBounds,
  maskHasSelection,
  polygonMask,
  rectangleMask,
  shrinkMask,
  strokeMask
} from "./mask-engine.js";
import {
  LAYER_BLEND_MODES,
  activeLayer,
  createLayer,
  insertLayer,
  moveLayer,
  removeLayer,
  serializableLayer,
  updateLayer
} from "./layer-engine.js";
import { loadLayerProject, saveLayerProject } from "./project-store.js";

const TOOL_META = [
  ["move", "icon-focus", "抓手"],
  ["select-shape", "icon-box-select", "形状选区"],
  ["lasso", "icon-vector", "套索"],
  ["wand", "icon-spark", "颜色选择"],
  ["brush-add", "icon-brush", "修边画笔"],
  ["paint", "icon-brush", "画笔"],
  ["fill", "icon-material", "填充"],
  ["eyedropper", "icon-focus", "吸管"],
  ["text", "icon-rename", "文字"]
];

const ADJUSTMENTS = [
  ["exposure", "曝光"], ["contrast", "对比度"], ["highlights", "高光"],
  ["shadows", "阴影"], ["whites", "白色色阶"], ["blacks", "黑色色阶"],
  ["temperature", "色温"], ["tint", "色调"], ["hue", "色相"],
  ["saturation", "饱和度"], ["vibrance", "自然饱和度"],
  ["curveShadows", "曲线暗部"], ["curveMidtones", "曲线中间调"], ["curveHighlights", "曲线亮部"],
  ["clarity", "清晰度"], ["denoise", "降噪"], ["sharpen", "锐化"],
  ["dehaze", "去雾"], ["vignette", "暗角"], ["grain", "颗粒"]
];

const ADJUSTMENT_GROUPS = [
  ["光线", ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"]],
  ["色彩", ["temperature", "tint", "hue", "saturation", "vibrance"]],
  ["曲线", ["curveShadows", "curveMidtones", "curveHighlights"]],
  ["细节", ["clarity", "denoise", "sharpen", "dehaze"]],
  ["效果", ["vignette", "grain"]]
];
const adjustmentLabels = Object.fromEntries(ADJUSTMENTS);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"></use></svg>`;

function shortHash(value = "") {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += Math.max(1, Math.floor(text.length / 2000))) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片载入失败"));
    image.src = url;
  });
}

function canvasToDataUrl(canvas, type = "image/png") {
  return canvas.toDataURL(type);
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图层保存失败")), type));
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function createDeepEditor({ onCommit, notify = () => {} } = {}) {
  const state = {
    open: false,
    selected: null,
    image: null,
    sourceCanvas: null,
    originalCanvas: null,
    sourceData: null,
    previewCanvas: null,
    previewRevision: 0,
    mask: null,
    maskCanvas: null,
    layers: [],
    activeLayerId: "",
    projectKey: "",
    projectDirty: false,
    tool: "select-shape",
    shapeMode: "rect",
    lassoMode: "free",
    wandContiguous: true,
    selectionBrushMode: "add",
    paintMode: "paint",
    fillMode: "bucket",
    combine: "replace",
    zoom: 1,
    panX: 0,
    panY: 0,
    view: null,
    gesture: null,
    polygonPoints: [],
    history: [],
    future: [],
    historyBytes: 0,
    brushSize: 36,
    tolerance: 28,
    paintColor: "#f0c978",
    secondaryColor: "#2b6dd8",
    textValue: "老鬼AI",
    textSize: 64,
    feather: 2,
    resizeWidth: 0,
    resizeHeight: 0,
    adjustments: Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])),
    busy: false,
    compare: false,
    status: "就绪"
  };
  let overlay = null;
  let worker = null;
  let workerId = 0;
  let previewTimer = 0;
  let projectTimer = 0;
  let layerUiSignature = "";
  let toolOptionsSignature = "";
  const workerJobs = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("./deep-edit/image-ops.worker.js", { type: "module" });
    worker.onmessage = (event) => {
      const job = workerJobs.get(event.data?.id);
      if (!job) return;
      workerJobs.delete(event.data.id);
      if (event.data.ok) job.resolve(new Uint8ClampedArray(event.data.pixels));
      else job.reject(new Error(event.data.error || "图片处理失败"));
    };
    return worker;
  }

  function runWorker(payload, transfers = []) {
    const id = ++workerId;
    return new Promise((resolve, reject) => {
      workerJobs.set(id, { resolve, reject });
      ensureWorker().postMessage({ ...payload, id }, transfers);
    });
  }

  function selectedLayer() {
    return activeLayer(state.layers, state.activeLayerId);
  }

  function compositeLayers() {
    if (!state.originalCanvas) return null;
    const out = makeCanvas(state.originalCanvas.width, state.originalCanvas.height);
    const ctx = out.getContext("2d");
    for (const layer of state.layers) {
      if (!layer.visible || !layer.canvas || layer.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.drawImage(layer.canvas, layer.x, layer.y);
      ctx.restore();
    }
    return out;
  }

  function refreshComposite({ keepPreview = false } = {}) {
    const composite = compositeLayers();
    if (!composite) return;
    state.sourceCanvas = composite;
    state.sourceData = composite.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, composite.width, composite.height);
    if (!keepPreview) {
      state.previewCanvas = null;
      state.previewRevision += 1;
    }
  }

  function createBlankLayer(name = "空白图层", type = "pixel") {
    const canvas = makeCanvas(state.originalCanvas.width, state.originalCanvas.height);
    canvas.getContext("2d", { willReadFrequently: true });
    return createLayer({ name, type, canvas });
  }

  function renderTextLayer(layer) {
    if (!layer?.canvas) return;
    const ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.fillStyle = layer.color;
    ctx.font = `600 ${layer.fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    ctx.textBaseline = "top";
    const lines = String(layer.text || "文字").split(/\r?\n/).slice(0, 12);
    lines.forEach((line, index) => ctx.fillText(line || " ", 0, index * layer.fontSize * 1.25));
  }

  function updateLayerList() {
    const list = overlay?.querySelector("[data-layer-list]");
    if (!list) return;
    const signature = state.layers.map((layer) => `${layer.id}:${layer.name}:${layer.visible}:${layer.opacity}:${layer.blendMode}:${layer.x}:${layer.y}`).join("|") + `@${state.activeLayerId}`;
    if (signature !== layerUiSignature) list.innerHTML = [...state.layers].reverse().map((layer) => `
      <button class="deep-layer-row" type="button" role="option" data-layer-id="${layer.id}" aria-selected="${layer.id === state.activeLayerId}">
        <span class="deep-layer-visible" data-layer-visible="${layer.id}" role="checkbox" aria-checked="${layer.visible}" title="显示或隐藏图层">${icon(layer.visible ? "icon-panel-show" : "icon-panel-hide")}</span>
        <span class="deep-layer-thumb">${icon(layer.type === "text" ? "icon-rename" : layer.type === "base" ? "icon-image" : "icon-brush")}</span>
        <span class="deep-layer-name"><strong>${layer.name.replace(/[<>&"]/g, "")}</strong><small>${layer.type === "text" ? "文字" : layer.type === "base" ? "原图" : "像素"}${layer.locked ? " · 已锁定" : ""}</small></span>
        <span class="deep-layer-opacity-label">${Math.round(layer.opacity * 100)}%</span>
      </button>`).join("");
    layerUiSignature = signature;
    const layer = selectedLayer();
    const opacity = overlay.querySelector("[data-layer-opacity]");
    if (opacity) opacity.value = Math.round((layer?.opacity ?? 1) * 100);
    const opacityValue = overlay.querySelector("[data-layer-opacity-value]");
    if (opacityValue) opacityValue.value = `${opacity?.value || 100}%`;
    const blend = overlay.querySelector("[data-layer-blend]");
    if (blend) blend.value = layer?.blendMode || "source-over";
    const x = overlay.querySelector("[data-layer-x]");
    const y = overlay.querySelector("[data-layer-y]");
    if (x) x.value = layer?.x || 0;
    if (y) y.value = layer?.y || 0;
  }

  function updateToolOptions() {
    const panel = overlay?.querySelector("[data-tool-options]");
    if (!panel) return;
    const signature = [state.tool, state.shapeMode, state.lassoMode, state.wandContiguous, state.selectionBrushMode, state.paintMode, state.fillMode, state.brushSize, state.tolerance, state.paintColor, state.secondaryColor, state.textValue, state.textSize, state.activeLayerId].join("|");
    if (signature === toolOptionsSignature) return;
    toolOptionsSignature = signature;
    const segment = (setting, options) => `<div class="deep-tool-option-segment">${options.map(([value, label]) => `<button type="button" data-tool-option="${setting}:${value}" aria-pressed="${String(state[setting]) === String(value)}">${label}</button>`).join("")}</div>`;
    let html = "";
    if (state.tool === "select-shape") html = `<strong>形状选区</strong>${segment("shapeMode", [["rect", "矩形"], ["ellipse", "椭圆"]])}`;
    else if (state.tool === "lasso") html = `<strong>套索方式</strong>${segment("lassoMode", [["free", "自由套索"], ["polygon", "多边形"]])}`;
    else if (state.tool === "wand") html = `<strong>颜色选择</strong>${segment("wandContiguous", [["true", "仅相连"], ["false", "全图同色"]])}<label>容差 <output data-deep-tolerance-value>${state.tolerance}</output><input type="range" min="0" max="100" value="${state.tolerance}" data-deep-tolerance></label>`;
    else if (state.tool === "brush-add") html = `<strong>修边画笔</strong>${segment("selectionBrushMode", [["add", "增加选区"], ["subtract", "减去选区"]])}<label>大小 <output data-deep-brush-value>${state.brushSize}</output><input type="range" min="2" max="180" value="${state.brushSize}" data-deep-brush></label>`;
    else if (state.tool === "paint") html = `<strong>画笔</strong>${segment("paintMode", [["paint", "绘画"], ["erase", "擦除"]])}<div class="deep-tool-option-row"><label>颜色<input type="color" value="${state.paintColor}" data-paint-color></label><label>大小 <output data-deep-brush-value>${state.brushSize}</output><input type="range" min="2" max="180" value="${state.brushSize}" data-deep-brush></label></div>`;
    else if (state.tool === "fill") html = `<strong>填充</strong>${segment("fillMode", [["bucket", "油漆桶"], ["gradient", "渐变"]])}<div class="deep-tool-option-row"><label>起始色<input type="color" value="${state.paintColor}" data-paint-color></label>${state.fillMode === "gradient" ? `<label>结束色<input type="color" value="${state.secondaryColor}" data-secondary-color></label>` : ""}</div>`;
    else if (state.tool === "text") html = `<strong>文字</strong><label>内容<textarea rows="2" maxlength="500" data-layer-text>${state.textValue.replace(/[<>&]/g, "")}</textarea></label><div class="deep-tool-option-row"><label>颜色<input type="color" value="${state.paintColor}" data-paint-color></label><label>大小 <output data-text-size-value>${state.textSize}</output><input type="range" min="8" max="300" value="${state.textSize}" data-text-size></label></div><button type="button" data-layer-action="update-text">更新选中文字</button>`;
    panel.innerHTML = html;
    panel.hidden = !html;
  }

  function markProjectDirty() {
    state.projectDirty = true;
    const label = overlay?.querySelector("[data-layer-save-status]");
    if (label) label.textContent = "未保存";
    clearTimeout(projectTimer);
    projectTimer = setTimeout(() => persistProject(false), 900);
  }

  async function persistProject(showNotice = true) {
    if (!state.projectKey || !state.originalCanvas || !state.layers.length) return;
    const label = overlay?.querySelector("[data-layer-save-status]");
    if (label) label.textContent = "保存中";
    try {
      const storedLayers = [];
      for (const layer of state.layers) {
        if (layer.type === "base") {
          storedLayers.push({ metadata: serializableLayer(layer), blob: null });
        } else {
          storedLayers.push({ metadata: serializableLayer(layer), blob: await canvasToBlob(layer.canvas) });
        }
      }
      await saveLayerProject({
        key: state.projectKey,
        width: state.originalCanvas.width,
        height: state.originalCanvas.height,
        activeLayerId: state.activeLayerId,
        layers: storedLayers,
        mask: new Uint8Array(state.mask)
      });
      state.projectDirty = false;
      if (label) label.textContent = "已保存";
      if (showNotice) notify("图层工程已保存");
    } catch (error) {
      if (label) label.textContent = "保存失败";
      if (showNotice) notify(error.message || "工程保存失败");
    }
  }

  async function restoreProject() {
    let project = null;
    try { project = await loadLayerProject(state.projectKey); } catch { return false; }
    if (!project || project.width !== state.originalCanvas.width || project.height !== state.originalCanvas.height || !Array.isArray(project.layers)) return false;
    const restored = [];
    for (const item of project.layers) {
      if (item.metadata?.type === "base") {
        restored.push(createLayer({ ...item.metadata, canvas: state.originalCanvas, type: "base", locked: true }));
        continue;
      }
      if (!item.blob) continue;
      const url = URL.createObjectURL(item.blob);
      try {
        const image = await loadImage(url);
        const canvas = makeCanvas(project.width, project.height);
        canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
        restored.push(createLayer({ ...item.metadata, canvas }));
      } finally { URL.revokeObjectURL(url); }
    }
    if (!restored.length) return false;
    state.layers = restored;
    state.activeLayerId = restored.some((layer) => layer.id === project.activeLayerId) ? project.activeLayerId : restored.at(-1).id;
    if (project.mask?.length === project.width * project.height) state.mask = new Uint8Array(project.mask);
    refreshComposite();
    state.status = "已恢复上次的图层工程";
    return true;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "deep-workspace-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="deep-workspace" role="dialog" aria-modal="true" aria-label="深度编辑工作区">
        <header class="deep-workspace-head">
          <button class="icon-button icon-only" type="button" data-deep-command="close" title="返回画布" aria-label="返回画布">${icon("icon-close")}</button>
          <div class="deep-workspace-title"><span>深度编辑</span><strong data-deep-title>选中图片</strong></div>
          <div class="deep-head-actions" role="toolbar" aria-label="查看与历史">
            <button class="text-button" type="button" data-deep-command="undo" title="撤销">${icon("icon-history")}<span>撤销</span></button>
            <button class="text-button" type="button" data-deep-command="redo" title="恢复">${icon("icon-refresh")}<span>恢复</span></button>
            <button class="text-button" type="button" data-deep-command="zoom-out" title="缩小">−</button>
            <button class="text-button deep-zoom-readout" type="button" data-deep-command="fit">100%</button>
            <button class="text-button" type="button" data-deep-command="zoom-in" title="放大">＋</button>
            <button class="text-button" type="button" data-deep-command="compare" aria-pressed="false">${icon("icon-compare")}<span>原图</span></button>
            <button class="primary-button" type="button" data-deep-command="save">${icon("icon-check")}完成并生成结果</button>
          </div>
        </header>
        <div class="deep-workspace-body">
          <aside class="deep-tool-rail" aria-label="选区工具">
            ${TOOL_META.map(([id, iconId, label]) => `<button type="button" data-deep-tool="${id}" title="${label}" aria-label="${label}" aria-pressed="false">${icon(iconId)}<span>${label}</span></button>`).join("")}
          </aside>
          <main class="deep-stage" data-deep-stage>
            <canvas data-deep-canvas tabindex="0" aria-label="图片编辑画布"></canvas>
            <div class="deep-stage-hint" data-deep-hint>拖动创建选区</div>
            <div class="deep-busy" data-deep-busy hidden><span class="icon-busy-dot"></span><strong data-deep-busy-text>处理中</strong></div>
          </main>
          <aside class="deep-inspector">
            <section class="deep-tool-options" data-tool-options aria-label="当前工具选项" hidden></section>
            <div class="deep-inspector-tabs" role="tablist" aria-label="编辑分类">
              <button type="button" role="tab" data-deep-tab="layers" aria-selected="false">图层</button>
              <button type="button" role="tab" data-deep-tab="selection" aria-selected="true">选区</button>
              <button type="button" role="tab" data-deep-tab="basic">基础</button>
              <button type="button" role="tab" data-deep-tab="adjust">调色</button>
            </div>
            <div class="deep-inspector-panel" data-deep-panel="layers" hidden>
              <div class="deep-panel-heading"><h3>图层</h3><span data-layer-save-status>自动保存</span></div>
              <div class="deep-layer-actions" role="toolbar" aria-label="图层操作">
                <button type="button" data-layer-action="add" title="新建空白图层" aria-label="新建空白图层">${icon("icon-plus")}</button>
                <button type="button" data-layer-action="duplicate" title="复制图层" aria-label="复制图层">${icon("icon-copy")}</button>
                <button type="button" data-layer-action="up" title="上移图层" aria-label="上移图层">${icon("icon-upload")}</button>
                <button type="button" data-layer-action="down" title="下移图层" aria-label="下移图层">${icon("icon-export")}</button>
                <button type="button" data-layer-action="delete" title="删除图层" aria-label="删除图层">${icon("icon-trash")}</button>
              </div>
              <div class="deep-layer-list" data-layer-list role="listbox" aria-label="图片图层"></div>
              <label>不透明度 <output data-layer-opacity-value>100%</output><input type="range" min="0" max="100" value="100" data-layer-opacity></label>
              <label>混合模式<select data-layer-blend>${LAYER_BLEND_MODES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
              <div class="deep-layer-position"><label>横向位置<input type="number" data-layer-x value="0"></label><label>纵向位置<input type="number" data-layer-y value="0"></label></div>
              <p>工程会自动保存。绘画、文字和调色都会进入独立图层，关闭后仍可继续编辑。</p>
            </div>
            <div class="deep-inspector-panel" data-deep-panel="selection">
              <h3>选区组合</h3>
              <div class="deep-segmented" role="group" aria-label="选区组合方式">
                <button type="button" data-deep-combine="replace">新建</button><button type="button" data-deep-combine="add">增加</button><button type="button" data-deep-combine="subtract">减去</button><button type="button" data-deep-combine="intersect">相交</button>
              </div>
              <label>边缘羽化 <output data-deep-feather-value>2</output><input type="range" min="0" max="24" value="2" data-deep-feather></label>
              <div class="deep-action-grid"><button type="button" data-deep-command="invert">反选</button><button type="button" data-deep-command="grow">扩大 2px</button><button type="button" data-deep-command="shrink">收缩 2px</button><button type="button" data-deep-command="smooth">平滑</button><button type="button" data-deep-command="clear">清空选区</button></div>
              <h3 class="deep-subheading">透明抠图</h3>
              <label class="deep-check"><input type="checkbox" data-trim-cutout checked> 自动裁掉透明边缘</label>
              <button class="primary-button" type="button" data-local-action="cutout">生成透明 PNG</button>
            </div>
            <div class="deep-inspector-panel" data-deep-panel="basic" hidden>
              <h3>基础处理</h3>
              <div class="deep-resize-row"><label>宽度<input type="number" min="1" max="16384" data-resize-width></label><span>×</span><label>高度<input type="number" min="1" max="16384" data-resize-height></label></div>
              <button class="primary-button" type="button" data-local-action="resize">调整尺寸</button>
              <div class="deep-action-grid"><button type="button" data-local-action="crop">裁切到选区</button><button type="button" data-local-action="rotate-left">左转 90°</button><button type="button" data-local-action="rotate-right">右转 90°</button><button type="button" data-local-action="flip-x">水平翻转</button><button type="button" data-local-action="flip-y">垂直翻转</button></div>
              <p>基础处理会生成新结果，不会覆盖原图。</p>
            </div>
            <div class="deep-inspector-panel" data-deep-panel="adjust" hidden>
              <h3>调色与质感</h3>
              ${ADJUSTMENT_GROUPS.map(([group, keys], index) => `<details class="deep-adjust-group" ${index === 0 ? "open" : ""}><summary>${group}</summary><div>${keys.map((key) => `<label>${adjustmentLabels[key]}<output data-adjust-output="${key}">0</output><input type="range" min="-100" max="100" value="0" data-adjustment="${key}"></label>`).join("")}</div></details>`).join("")}
              <button class="primary-button" type="button" data-local-action="adjust">作为新图层应用</button>
            </div>
          </aside>
        </div>
        <footer class="deep-statusbar"><span data-deep-size>0 × 0</span><span data-deep-selection>未选择区域</span><span data-deep-tool-status>矩形</span><span data-deep-status>就绪</span></footer>
      </section>`;
    document.body.appendChild(overlay);
    bindEvents();
    return overlay;
  }

  function setBusy(busy, text = "处理中") {
    state.busy = busy;
    const layer = overlay?.querySelector("[data-deep-busy]");
    if (layer) layer.hidden = !busy;
    const label = overlay?.querySelector("[data-deep-busy-text]");
    if (label) label.textContent = text;
    overlay?.querySelectorAll("button, input, textarea").forEach((element) => {
      if (element.matches("[data-deep-command='close']")) return;
      element.disabled = busy;
    });
  }

  function updateMaskCanvas() {
    if (!state.mask || !state.sourceCanvas) return;
    const canvas = state.maskCanvas || makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
    if (canvas.width !== state.sourceCanvas.width || canvas.height !== state.sourceCanvas.height) {
      canvas.width = state.sourceCanvas.width;
      canvas.height = state.sourceCanvas.height;
    }
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < state.mask.length; index += 1) {
      const offset = index * 4;
      imageData.data[offset] = 72;
      imageData.data[offset + 1] = 164;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = Math.round(state.mask[index] * 0.52);
    }
    ctx.putImageData(imageData, 0, 0);
    state.maskCanvas = canvas;
  }

  function captureHistory(kind = "mask") {
    if (kind === "mask") return { kind, mask: cloneMask(state.mask), bytes: state.mask.byteLength };
    const layers = state.layers.map((layer) => {
      const metadata = serializableLayer(layer);
      if (layer.type === "base" || !layer.canvas) return { metadata, pixels: null };
      const pixels = new Uint8ClampedArray(layer.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, layer.canvas.width, layer.canvas.height).data);
      return { metadata, pixels };
    });
    return { kind: "document", layers, activeLayerId: state.activeLayerId, bytes: layers.reduce((total, item) => total + (item.pixels?.byteLength || 0), 0) };
  }

  function restoreHistory(snapshot) {
    if (snapshot.kind === "mask") {
      state.mask = cloneMask(snapshot.mask);
      updateMaskCanvas();
      return;
    }
    state.layers = snapshot.layers.map(({ metadata, pixels }) => {
      if (metadata.type === "base") return createLayer({ ...metadata, type: "base", locked: true, canvas: state.originalCanvas });
      const canvas = makeCanvas(state.originalCanvas.width, state.originalCanvas.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (pixels) ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), canvas.width, canvas.height), 0, 0);
      return createLayer({ ...metadata, canvas });
    });
    state.activeLayerId = state.layers.some((layer) => layer.id === snapshot.activeLayerId) ? snapshot.activeLayerId : state.layers.at(-1)?.id || "";
    refreshComposite();
    markProjectDirty();
  }

  function pushHistory(kind = "mask") {
    if (!state.mask) return;
    const snapshot = captureHistory(kind);
    state.history.push(snapshot);
    state.historyBytes += snapshot.bytes;
    state.future = [];
    while (state.history.length > 30 || state.historyBytes > 256 * 1024 * 1024) {
      const removed = state.history.shift();
      state.historyBytes -= removed?.bytes || 0;
    }
  }

  function applyIncomingMask(incoming, mode = state.combine) {
    pushHistory();
    state.mask = combineMasks(state.mask, incoming, mode);
    updateMaskCanvas();
    render();
  }

  function undo() {
    const previous = state.history.pop();
    if (!previous) return;
    state.historyBytes -= previous.bytes;
    state.future.push(captureHistory(previous.kind));
    restoreHistory(previous);
    render();
  }

  function redo() {
    const next = state.future.pop();
    if (!next) return;
    const current = captureHistory(next.kind);
    state.history.push(current);
    state.historyBytes += current.bytes;
    restoreHistory(next);
    render();
  }

  function sourcePointFromEvent(event) {
    const canvas = overlay.querySelector("[data-deep-canvas]");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (event.clientX - rect.left) * dpr;
    const py = (event.clientY - rect.top) * dpr;
    const view = state.view;
    if (!view) return null;
    const x = (px - view.dx) / view.scale;
    const y = (py - view.dy) / view.scale;
    if (x < 0 || y < 0 || x >= state.sourceCanvas.width || y >= state.sourceCanvas.height) return null;
    return { x, y, px, py };
  }

  function drawGesture(ctx) {
    const points = state.gesture?.points || state.polygonPoints;
    if (!points?.length || !state.view) return;
    ctx.save();
    ctx.strokeStyle = "#f0c978";
    ctx.fillStyle = "rgba(240,201,120,.16)";
    ctx.lineWidth = Math.max(1.5, (window.devicePixelRatio || 1) * 1.5);
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = state.view.dx + point.x * state.view.scale;
      const y = state.view.dy + point.y * state.view.scale;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (["rect", "ellipse"].includes(state.gesture?.type) && points.length > 1) {
      const first = points[0];
      const last = points.at(-1);
      ctx.beginPath();
      const x = state.view.dx + Math.min(first.x, last.x) * state.view.scale;
      const y = state.view.dy + Math.min(first.y, last.y) * state.view.scale;
      const width = Math.abs(last.x - first.x) * state.view.scale;
      const height = Math.abs(last.y - first.y) * state.view.scale;
      if (state.gesture.type === "ellipse") ctx.ellipse(x + width / 2, y + height / 2, Math.max(.5, width / 2), Math.max(.5, height / 2), 0, 0, Math.PI * 2);
      else ctx.rect(x, y, width, height);
    }
    if (state.gesture?.type === "lasso") ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!overlay || overlay.hidden || !state.sourceCanvas) return;
    const canvas = overlay.querySelector("[data-deep-canvas]");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(240, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const checker = Math.max(10, Math.round(14 * dpr));
    for (let y = 0; y < height; y += checker) {
      for (let x = 0; x < width; x += checker) {
        ctx.fillStyle = ((x / checker + y / checker) % 2) ? "#242421" : "#30302b";
        ctx.fillRect(x, y, checker, checker);
      }
    }
    const fit = Math.min((width * 0.9) / state.sourceCanvas.width, (height * 0.9) / state.sourceCanvas.height);
    const scale = fit * state.zoom;
    const drawWidth = state.sourceCanvas.width * scale;
    const drawHeight = state.sourceCanvas.height * scale;
    const dx = (width - drawWidth) / 2 + state.panX * dpr;
    const dy = (height - drawHeight) / 2 + state.panY * dpr;
    state.view = { dx, dy, scale, width, height, fit };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const displayed = state.compare ? state.originalCanvas || state.sourceCanvas : state.previewCanvas || state.sourceCanvas;
    ctx.drawImage(displayed, dx, dy, drawWidth, drawHeight);
    if (!state.compare && state.maskCanvas) ctx.drawImage(state.maskCanvas, dx, dy, drawWidth, drawHeight);
    drawGesture(ctx);
    updateUi();
  }

  function updateUi() {
    if (!overlay) return;
    overlay.querySelector("[data-deep-title]").textContent = state.selected?.title || "选中图片";
    overlay.querySelectorAll("[data-deep-tool]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.deepTool === state.tool)));
    overlay.querySelectorAll("[data-deep-combine]").forEach((button) => button.classList.toggle("active", button.dataset.deepCombine === state.combine));
    const zoom = overlay.querySelector(".deep-zoom-readout");
    if (zoom) zoom.textContent = `${Math.round(state.zoom * 100)}%`;
    const bounds = state.mask ? maskBounds(state.mask, state.sourceCanvas.width, state.sourceCanvas.height) : null;
    overlay.querySelector("[data-deep-size]").textContent = `${state.sourceCanvas.width} × ${state.sourceCanvas.height}`;
    overlay.querySelector("[data-deep-selection]").textContent = bounds ? `选区 ${Math.round(bounds.area / state.mask.length * 100)}%` : "未选择区域";
    overlay.querySelector("[data-deep-tool-status]").textContent = TOOL_META.find(([id]) => id === state.tool)?.[2] || state.tool;
    overlay.querySelector("[data-deep-status]").textContent = state.status;
    overlay.querySelector("[data-deep-command='undo']").disabled = state.busy || !state.history.length;
    overlay.querySelector("[data-deep-command='redo']").disabled = state.busy || !state.future.length;
    overlay.querySelector("[data-deep-command='compare']").setAttribute("aria-pressed", String(state.compare));
    updateLayerList();
    updateToolOptions();
    const hint = overlay.querySelector("[data-deep-hint]");
    hint.textContent = state.tool === "lasso" && state.lassoMode === "polygon" ? "逐点单击，双击闭合" : state.tool === "wand" ? (state.wandContiguous ? "单击选择相连的相近颜色" : "单击选择全图相近颜色") : state.tool === "paint" ? (state.paintMode === "erase" ? "在当前图层上拖动擦除" : "在当前图层上拖动绘画") : state.tool === "fill" && state.fillMode === "gradient" ? "拖动确定渐变方向" : state.tool === "eyedropper" ? "单击图片吸取颜色" : state.tool === "text" ? "单击图片放置文字" : "在图上拖动创建或修整选区";
  }

  function ensureEditablePixelLayer(name = "绘画图层") {
    let layer = selectedLayer();
    if (!layer || layer.locked || layer.type !== "pixel") {
      layer = createBlankLayer(name);
      state.layers = insertLayer(state.layers, layer, state.activeLayerId);
      state.activeLayerId = layer.id;
    }
    return layer;
  }

  function selectionClipCanvas() {
    if (!maskHasSelection(state.mask)) return null;
    const canvas = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
    const ctx = canvas.getContext("2d");
    const data = ctx.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < state.mask.length; index += 1) {
      const offset = index * 4;
      data.data[offset] = 255;
      data.data[offset + 1] = 255;
      data.data[offset + 2] = 255;
      data.data[offset + 3] = state.mask[index];
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  function applyTemporaryToLayer(layer, temporary, erase = false) {
    const clip = selectionClipCanvas();
    if (clip) {
      const tempCtx = temporary.getContext("2d");
      tempCtx.globalCompositeOperation = "destination-in";
      tempCtx.drawImage(clip, 0, 0);
      tempCtx.globalCompositeOperation = "source-over";
    }
    const ctx = layer.canvas.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.drawImage(temporary, 0, 0);
    ctx.restore();
    refreshComposite();
    markProjectDirty();
    state.status = erase ? "已擦除当前图层" : "已更新当前图层";
    render();
  }

  function paintLayerStroke(points, erase = false) {
    if (!points?.length) return;
    pushHistory("document");
    const layer = ensureEditablePixelLayer(erase ? "擦除图层" : "绘画图层");
    const temporary = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
    const ctx = temporary.getContext("2d");
    ctx.strokeStyle = erase ? "#ffffff" : state.paintColor;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(1, state.brushSize);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
    ctx.stroke();
    applyTemporaryToLayer(layer, temporary, erase);
  }

  function fillLayerAt(point) {
    pushHistory("document");
    const layer = ensureEditablePixelLayer("填充图层");
    let region = magicWandMask(state.sourceData.data, state.sourceCanvas.width, state.sourceCanvas.height, point.x, point.y, state.tolerance);
    if (maskHasSelection(state.mask)) region = combineMasks(region, state.mask, "intersect");
    const ctx = layer.canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const [r, g, b] = state.paintColor.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16));
    for (let index = 0; index < region.length; index += 1) {
      if (!region[index]) continue;
      const offset = index * 4;
      data.data[offset] = r;
      data.data[offset + 1] = g;
      data.data[offset + 2] = b;
      data.data[offset + 3] = region[index];
    }
    ctx.putImageData(data, 0, 0);
    refreshComposite();
    markProjectDirty();
    state.status = "颜色填充完成";
    render();
  }

  function applyGradient(from, to) {
    pushHistory("document");
    const layer = ensureEditablePixelLayer("渐变图层");
    const temporary = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
    const ctx = temporary.getContext("2d");
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, state.paintColor);
    gradient.addColorStop(1, state.secondaryColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, temporary.width, temporary.height);
    applyTemporaryToLayer(layer, temporary, false);
  }

  function placeText(point) {
    pushHistory("document");
    const layer = createBlankLayer(`文字：${state.textValue.slice(0, 12) || "文字"}`, "text");
    layer.text = state.textValue || "文字";
    layer.fontSize = state.textSize;
    layer.color = state.paintColor;
    layer.x = Math.round(point.x);
    layer.y = Math.round(point.y);
    renderTextLayer(layer);
    state.layers = insertLayer(state.layers, layer, state.activeLayerId);
    state.activeLayerId = layer.id;
    refreshComposite();
    markProjectDirty();
    state.status = "文字图层已创建";
    render();
  }

  function pickColor(point) {
    const offset = (Math.floor(point.y) * state.sourceCanvas.width + Math.floor(point.x)) * 4;
    const data = state.sourceData.data;
    state.paintColor = `#${[data[offset], data[offset + 1], data[offset + 2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    overlay.querySelector("[data-paint-color]").value = state.paintColor;
    state.status = `已吸取颜色 ${state.paintColor.toUpperCase()}`;
    render();
  }

  function handlePointerDown(event) {
    if (state.busy || !state.sourceCanvas) return;
    const point = sourcePointFromEvent(event);
    if (!point && state.tool !== "move") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (state.tool === "move") {
      state.gesture = { type: "move", startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY };
      return;
    }
    if (state.tool === "wand") {
      const incoming = state.wandContiguous
        ? magicWandMask(state.sourceData.data, state.sourceCanvas.width, state.sourceCanvas.height, point.x, point.y, state.tolerance)
        : colorRangeMask(state.sourceData.data, state.sourceCanvas.width, state.sourceCanvas.height, point.x, point.y, state.tolerance);
      applyIncomingMask(incoming);
      return;
    }
    if (state.tool === "eyedropper") { pickColor(point); return; }
    if (state.tool === "fill" && state.fillMode === "bucket") { fillLayerAt(point); return; }
    if (state.tool === "text") { placeText(point); return; }
    if (state.tool === "lasso" && state.lassoMode === "polygon") {
      const first = state.polygonPoints[0];
      const closeRadius = 12 / Math.max(0.01, state.view?.scale || 1);
      if (state.polygonPoints.length >= 3 && first && Math.hypot(point.x - first.x, point.y - first.y) <= closeRadius) {
        finishPolygon();
        return;
      }
      state.polygonPoints.push({ x: point.x, y: point.y });
      render();
      return;
    }
    const type = state.tool === "select-shape" ? state.shapeMode : state.tool === "lasso" ? "lasso" : state.tool === "paint" ? "layer-stroke" : state.tool === "fill" && state.fillMode === "gradient" ? "gradient" : "brush";
    state.gesture = { type, points: [{ x: point.x, y: point.y }] };
  }

  function handlePointerMove(event) {
    const gesture = state.gesture;
    if (!gesture || state.busy) return;
    if (gesture.type === "move") {
      state.panX = gesture.panX + event.clientX - gesture.startX;
      state.panY = gesture.panY + event.clientY - gesture.startY;
      render();
      return;
    }
    const point = sourcePointFromEvent(event);
    if (!point) return;
    const points = gesture.points;
    const last = points.at(-1);
    if (["rect", "ellipse", "gradient"].includes(gesture.type)) points[1] = { x: point.x, y: point.y };
    else if (!last || Math.hypot(point.x - last.x, point.y - last.y) > Math.max(1, state.sourceCanvas.width / 800)) points.push({ x: point.x, y: point.y });
    render();
  }

  function handlePointerUp(event) {
    const gesture = state.gesture;
    if (!gesture || state.busy) return;
    if (gesture.type === "move") { state.gesture = null; return; }
    const point = sourcePointFromEvent(event);
    if (point && ["rect", "ellipse", "gradient"].includes(gesture.type)) gesture.points[1] = { x: point.x, y: point.y };
    let incoming = null;
    if (gesture.type === "rect" && gesture.points.length > 1) incoming = rectangleMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points[0], gesture.points[1]);
    else if (gesture.type === "ellipse" && gesture.points.length > 1) incoming = ellipseMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points[0], gesture.points[1]);
    else if (gesture.type === "lasso" && gesture.points.length > 2) incoming = polygonMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points);
    else if (gesture.type === "brush") incoming = strokeMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points, state.brushSize);
    else if (gesture.type === "layer-stroke") paintLayerStroke(gesture.points, state.paintMode === "erase");
    else if (gesture.type === "gradient" && gesture.points.length > 1) applyGradient(gesture.points[0], gesture.points[1]);
    state.gesture = null;
    if (incoming) applyIncomingMask(incoming, state.tool === "brush-add" ? state.selectionBrushMode : state.combine);
    else render();
  }

  function finishPolygon() {
    if (state.polygonPoints.length < 3) return;
    const incoming = polygonMask(state.sourceCanvas.width, state.sourceCanvas.height, state.polygonPoints);
    state.polygonPoints = [];
    applyIncomingMask(incoming);
  }

  function maskForOutput() {
    return state.feather > 0 ? featherMask(state.mask, state.sourceCanvas.width, state.sourceCanvas.height, state.feather) : state.mask;
  }

  async function commitResult(canvas, title, mode) {
    if (state.projectDirty) await persistProject(false);
    const dataUrl = canvasToDataUrl(canvas);
    await onCommit?.({ dataUrl, title, mode, selected: state.selected, width: canvas.width, height: canvas.height });
    close();
  }

  async function applyAdjustment() {
    if (!Object.values(state.adjustments).some((value) => Math.abs(Number(value) || 0) > 0.001)) {
      notify("请先调整至少一个参数");
      return;
    }
    setBusy(true, "正在处理原始像素");
    try {
      const ctx = state.sourceCanvas.getContext("2d", { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, state.sourceCanvas.width, state.sourceCanvas.height);
      const pixels = imageData.data.slice();
      const mask = maskHasSelection(state.mask) ? maskForOutput().slice() : null;
      const outputPixels = await runWorker({ pixels: pixels.buffer, mask: null, width: state.sourceCanvas.width, height: state.sourceCanvas.height, adjustments: state.adjustments }, [pixels.buffer]);
      const out = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
      const outCtx = out.getContext("2d", { willReadFrequently: true });
      const outputData = new ImageData(outputPixels, out.width, out.height);
      if (mask) {
        for (let index = 0; index < mask.length; index += 1) outputData.data[index * 4 + 3] = mask[index];
      }
      outCtx.putImageData(outputData, 0, 0);
      pushHistory("document");
      const layer = createLayer({ name: mask ? "局部调色" : "全图调色", type: "pixel", canvas: out });
      state.layers = insertLayer(state.layers, layer, state.activeLayerId);
      state.activeLayerId = layer.id;
      refreshComposite();
      markProjectDirty();
      state.status = "调色已作为独立图层应用";
      render();
    } finally { setBusy(false); }
  }

  async function updateAdjustmentPreview() {
    if (!state.sourceCanvas || state.busy) return;
    const revision = ++state.previewRevision;
    state.status = "正在预览调色";
    render();
    try {
      const pixels = state.sourceData.data.slice();
      const mask = maskHasSelection(state.mask) ? maskForOutput().slice() : null;
      const outputPixels = await runWorker({ pixels: pixels.buffer, mask: mask?.buffer || null, width: state.sourceCanvas.width, height: state.sourceCanvas.height, adjustments: state.adjustments }, mask ? [pixels.buffer, mask.buffer] : [pixels.buffer]);
      if (revision !== state.previewRevision || !state.open) return;
      const preview = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
      preview.getContext("2d").putImageData(new ImageData(outputPixels, preview.width, preview.height), 0, 0);
      state.previewCanvas = preview;
      state.status = "调色预览已更新";
      render();
    } catch (error) {
      if (revision === state.previewRevision) state.status = error.message || "调色预览失败";
    }
  }

  function scheduleAdjustmentPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updateAdjustmentPreview, 140);
  }

  function transformedCanvas(action) {
    const source = state.sourceCanvas;
    if (action === "resize") {
      const width = clamp(Math.round(Number(state.resizeWidth || 0)), 1, 16384);
      const height = clamp(Math.round(Number(state.resizeHeight || 0)), 1, 16384);
      if (!width || !height) throw new Error("请输入有效的图片宽度和高度");
      const out = makeCanvas(width, height);
      const ctx = out.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, width, height);
      return out;
    }
    if (action === "crop") {
      const bounds = maskBounds(state.mask, source.width, source.height);
      if (!bounds) throw new Error("请先创建选区再裁切");
      const out = makeCanvas(bounds.width, bounds.height);
      out.getContext("2d").drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      return out;
    }
    const rotate = action === "rotate-left" || action === "rotate-right";
    const out = makeCanvas(rotate ? source.height : source.width, rotate ? source.width : source.height);
    const ctx = out.getContext("2d");
    ctx.translate(out.width / 2, out.height / 2);
    if (action === "rotate-left") ctx.rotate(-Math.PI / 2);
    if (action === "rotate-right") ctx.rotate(Math.PI / 2);
    if (action === "flip-x") ctx.scale(-1, 1);
    if (action === "flip-y") ctx.scale(1, -1);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return out;
  }

  async function localAction(action) {
    try {
      if (action === "adjust") return await applyAdjustment();
      if (action === "cutout") {
        if (!maskHasSelection(state.mask)) throw new Error("请先选择要保留的主体");
        const soft = maskForOutput();
        const bounds = overlay.querySelector("[data-trim-cutout]")?.checked ? maskBounds(soft, state.sourceCanvas.width, state.sourceCanvas.height) : { x: 0, y: 0, width: state.sourceCanvas.width, height: state.sourceCanvas.height };
        const out = makeCanvas(bounds.width, bounds.height);
        const ctx = out.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(state.sourceCanvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        const data = ctx.getImageData(0, 0, out.width, out.height);
        for (let y = 0; y < out.height; y += 1) for (let x = 0; x < out.width; x += 1) data.data[(y * out.width + x) * 4 + 3] = soft[(bounds.y + y) * state.sourceCanvas.width + bounds.x + x];
        ctx.putImageData(data, 0, 0);
        return await commitResult(out, "透明抠图结果", "cutout");
      }
      const canvas = transformedCanvas(action);
      return await commitResult(canvas, action === "crop" ? "裁切结果" : action === "resize" ? "调整尺寸结果" : "基础编辑结果", action === "crop" ? "crop" : action === "resize" ? "resize" : "transform");
    } catch (error) { notify(error.message); }
  }

  async function layerAction(action) {
    const layer = selectedLayer();
    pushHistory("document");
    if (action === "add") {
      const added = createBlankLayer(`图层 ${state.layers.length}`);
      state.layers = insertLayer(state.layers, added, state.activeLayerId);
      state.activeLayerId = added.id;
    } else if (action === "duplicate") {
      if (!layer) return;
      const copy = createBlankLayer(`${layer.name} 副本`, layer.type === "base" ? "pixel" : layer.type);
      copy.opacity = layer.opacity;
      copy.blendMode = layer.blendMode;
      copy.x = layer.x;
      copy.y = layer.y;
      copy.text = layer.text;
      copy.fontSize = layer.fontSize;
      copy.color = layer.color;
      copy.canvas.getContext("2d").drawImage(layer.canvas, 0, 0);
      state.layers = insertLayer(state.layers, copy, layer.id);
      state.activeLayerId = copy.id;
    } else if (action === "up" || action === "down") {
      if (!layer) return;
      state.layers = moveLayer(state.layers, layer.id, action === "up" ? 1 : -1);
    } else if (action === "delete") {
      if (!layer || layer.type === "base" || layer.locked) { notify("原图层不能删除"); return; }
      state.layers = removeLayer(state.layers, layer.id);
      state.activeLayerId = state.layers.at(-1)?.id || "";
    } else if (action === "update-text") {
      if (!layer || layer.type !== "text") { notify("请先选择一个文字图层"); return; }
      layer.text = state.textValue || "文字";
      layer.fontSize = state.textSize;
      layer.color = state.paintColor;
      layer.name = `文字：${layer.text.slice(0, 12)}`;
      renderTextLayer(layer);
    } else return;
    refreshComposite();
    markProjectDirty();
    state.status = "图层已更新";
    render();
  }

  function handleCommand(command) {
    if (command === "close") close();
    else if (command === "undo") undo();
    else if (command === "redo") redo();
    else if (command === "zoom-in") { state.zoom = clamp(state.zoom * 1.2, 0.1, 8); render(); }
    else if (command === "zoom-out") { state.zoom = clamp(state.zoom / 1.2, 0.1, 8); render(); }
    else if (command === "fit") { state.zoom = 1; state.panX = 0; state.panY = 0; render(); }
    else if (command === "compare") { state.compare = !state.compare; render(); }
    else if (command === "invert") { pushHistory(); state.mask = invertMask(state.mask); updateMaskCanvas(); render(); }
    else if (command === "clear") { pushHistory(); state.mask = createMask(state.sourceCanvas.width, state.sourceCanvas.height); updateMaskCanvas(); render(); }
    else if (command === "grow") { pushHistory(); state.mask = growMask(state.mask, state.sourceCanvas.width, state.sourceCanvas.height, 2); updateMaskCanvas(); render(); }
    else if (command === "shrink") { pushHistory(); state.mask = shrinkMask(state.mask, state.sourceCanvas.width, state.sourceCanvas.height, 2); updateMaskCanvas(); render(); }
    else if (command === "smooth") { pushHistory(); state.mask = featherMask(state.mask, state.sourceCanvas.width, state.sourceCanvas.height, 1); updateMaskCanvas(); render(); }
    else if (command === "save") commitResult(compositeLayers(), "深度编辑结果", "deep-edit");
  }

  function bindEvents() {
    const canvas = overlay.querySelector("[data-deep-canvas]");
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("dblclick", () => state.tool === "lasso" && state.lassoMode === "polygon" && finishPolygon());
    canvas.addEventListener("wheel", (event) => { event.preventDefault(); state.zoom = clamp(state.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.1, 8); render(); }, { passive: false });
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target.matches("[data-layer-opacity], [data-layer-blend]")) pushHistory("document");
    });
    overlay.addEventListener("focusin", (event) => {
      if (event.target.matches("[data-layer-x], [data-layer-y]")) pushHistory("document");
    });
    overlay.addEventListener("click", (event) => {
      const visibility = event.target.closest("[data-layer-visible]")?.dataset.layerVisible;
      if (visibility) {
        const layer = state.layers.find((item) => item.id === visibility);
        if (layer) {
          pushHistory("document");
          state.layers = updateLayer(state.layers, visibility, { visible: !layer.visible });
          refreshComposite();
          markProjectDirty();
          render();
        }
        return;
      }
      const layerId = event.target.closest("[data-layer-id]")?.dataset.layerId;
      if (layerId) {
        state.activeLayerId = layerId;
        const layer = selectedLayer();
        if (layer?.type === "text") {
          state.textValue = layer.text;
          state.textSize = layer.fontSize;
          state.paintColor = layer.color;
          state.tool = "text";
        }
        toolOptionsSignature = "";
        render();
        return;
      }
      const layerCommand = event.target.closest("[data-layer-action]")?.dataset.layerAction;
      if (layerCommand) { layerAction(layerCommand); return; }
      const toolOption = event.target.closest("[data-tool-option]")?.dataset.toolOption;
      if (toolOption) {
        const [setting, value] = toolOption.split(":");
        state[setting] = value === "true" ? true : value === "false" ? false : value;
        state.polygonPoints = [];
        toolOptionsSignature = "";
        render();
        return;
      }
      const tool = event.target.closest("[data-deep-tool]")?.dataset.deepTool;
      if (tool) {
        state.tool = tool;
        state.polygonPoints = [];
        if (["paint", "fill", "eyedropper", "text"].includes(tool)) {
          overlay.querySelectorAll("[data-deep-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.deepTab === "layers")));
          overlay.querySelectorAll("[data-deep-panel]").forEach((panel) => panel.hidden = panel.dataset.deepPanel !== "layers");
        }
        render();
        return;
      }
      const combine = event.target.closest("[data-deep-combine]")?.dataset.deepCombine;
      if (combine) { state.combine = combine; updateUi(); return; }
      const command = event.target.closest("[data-deep-command]")?.dataset.deepCommand;
      if (command) { handleCommand(command); return; }
      const tab = event.target.closest("[data-deep-tab]")?.dataset.deepTab;
      if (tab) {
        overlay.querySelectorAll("[data-deep-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.deepTab === tab)));
        overlay.querySelectorAll("[data-deep-panel]").forEach((panel) => panel.hidden = panel.dataset.deepPanel !== tab);
        return;
      }
      const local = event.target.closest("[data-local-action]")?.dataset.localAction;
      if (local) localAction(local);
    });
    overlay.addEventListener("input", (event) => {
      if (event.target.matches("[data-deep-brush]")) { state.brushSize = Number(event.target.value); overlay.querySelector("[data-deep-brush-value]").value = state.brushSize; }
      if (event.target.matches("[data-deep-tolerance]")) { state.tolerance = Number(event.target.value); overlay.querySelector("[data-deep-tolerance-value]").value = state.tolerance; }
      if (event.target.matches("[data-deep-feather]")) { state.feather = Number(event.target.value); overlay.querySelector("[data-deep-feather-value]").value = state.feather; }
      if (event.target.matches("[data-paint-color]")) { state.paintColor = event.target.value; }
      if (event.target.matches("[data-secondary-color]")) { state.secondaryColor = event.target.value; }
      if (event.target.matches("[data-layer-text]")) { state.textValue = event.target.value; }
      if (event.target.matches("[data-text-size]")) { state.textSize = Number(event.target.value); overlay.querySelector("[data-text-size-value]").value = state.textSize; }
      if (event.target.matches("[data-layer-opacity]")) {
        const layer = selectedLayer();
        if (layer) {
          state.layers = updateLayer(state.layers, layer.id, { opacity: Number(event.target.value) / 100 });
          overlay.querySelector("[data-layer-opacity-value]").value = `${event.target.value}%`;
          refreshComposite();
          markProjectDirty();
          render();
        }
      }
      if (event.target.matches("[data-layer-blend]")) {
        const layer = selectedLayer();
        if (layer) { state.layers = updateLayer(state.layers, layer.id, { blendMode: event.target.value }); refreshComposite(); markProjectDirty(); render(); }
      }
      if (event.target.matches("[data-layer-x], [data-layer-y]")) {
        const layer = selectedLayer();
        if (layer && !layer.locked) {
          state.layers = updateLayer(state.layers, layer.id, { x: Number(overlay.querySelector("[data-layer-x]").value), y: Number(overlay.querySelector("[data-layer-y]").value) });
          refreshComposite();
          markProjectDirty();
          render();
        }
      }
      if (event.target.matches("[data-resize-width]")) state.resizeWidth = Number(event.target.value);
      if (event.target.matches("[data-resize-height]")) state.resizeHeight = Number(event.target.value);
      const adjustment = event.target.dataset.adjustment;
      if (adjustment) {
        state.adjustments[adjustment] = Number(event.target.value);
        overlay.querySelector(`[data-adjust-output="${adjustment}"]`).value = event.target.value;
        scheduleAdjustmentPreview();
      }
    });
    window.addEventListener("resize", render);
    window.addEventListener("keydown", (event) => {
      if (!state.open || event.target.matches("input, textarea, select")) return;
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (commandKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key.toLowerCase() === "m") { state.tool = "select-shape"; state.shapeMode = "rect"; render(); }
      else if (event.key.toLowerCase() === "o") { state.tool = "select-shape"; state.shapeMode = "ellipse"; render(); }
      else if (event.key.toLowerCase() === "l") { state.tool = "lasso"; render(); }
      else if (event.key.toLowerCase() === "w") { state.tool = "wand"; render(); }
      else if (event.key.toLowerCase() === "b") { state.tool = "paint"; render(); }
      else if (event.key.toLowerCase() === "e") { state.tool = "paint"; state.paintMode = "erase"; render(); }
      else if (event.key.toLowerCase() === "g") { state.tool = "fill"; state.fillMode = "gradient"; render(); }
      else if (event.key.toLowerCase() === "i") { state.tool = "eyedropper"; render(); }
      else if (event.key.toLowerCase() === "t") { state.tool = "text"; render(); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const layer = selectedLayer();
        if (!layer || layer.locked) return;
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        state.layers = updateLayer(state.layers, layer.id, { x: layer.x + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0), y: layer.y + (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0) });
        refreshComposite();
        markProjectDirty();
        render();
      }
    });
  }

  async function open(selected, { initialTool = "select-shape", initialTab = "selection" } = {}) {
    ensureOverlay();
    if (!selected?.url) throw new Error("没有可以编辑的图片");
    state.selected = selected;
    state.tool = ["rect", "ellipse"].includes(initialTool) ? "select-shape" : initialTool === "polygon" ? "lasso" : initialTool === "brush-subtract" ? "brush-add" : initialTool === "eraser" ? "paint" : initialTool === "gradient" ? "fill" : initialTool;
    if (["rect", "ellipse"].includes(initialTool)) state.shapeMode = initialTool;
    if (initialTool === "polygon") state.lassoMode = "polygon";
    if (initialTool === "brush-subtract") state.selectionBrushMode = "subtract";
    if (initialTool === "eraser") state.paintMode = "erase";
    if (initialTool === "gradient") state.fillMode = "gradient";
    state.combine = "replace";
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.history = [];
    state.future = [];
    state.historyBytes = 0;
    state.polygonPoints = [];
    state.compare = false;
    state.status = "正在载入图片";
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    state.open = true;
    document.body.classList.add("deep-editor-open");
    setBusy(true, "正在载入原图");
    try {
      state.image = await loadImage(selected.url);
      const pixelCount = state.image.naturalWidth * state.image.naturalHeight;
      const maxPixels = 40_000_000;
      const scale = pixelCount > maxPixels ? Math.min(1, 4096 / Math.max(state.image.naturalWidth, state.image.naturalHeight)) : 1;
      state.sourceCanvas = makeCanvas(state.image.naturalWidth * scale, state.image.naturalHeight * scale);
      const ctx = state.sourceCanvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(state.image, 0, 0, state.sourceCanvas.width, state.sourceCanvas.height);
      state.originalCanvas = state.sourceCanvas;
      state.sourceData = ctx.getImageData(0, 0, state.sourceCanvas.width, state.sourceCanvas.height);
      const baseLayer = createLayer({ id: "base", name: "原图", type: "base", locked: true, canvas: state.originalCanvas });
      state.layers = [baseLayer];
      state.activeLayerId = baseLayer.id;
      state.projectKey = `deep-edit:${selected.id || "image"}:${shortHash(selected.url)}:${state.sourceCanvas.width}x${state.sourceCanvas.height}`;
      state.projectDirty = false;
      state.previewCanvas = null;
      state.previewRevision += 1;
      state.adjustments = Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0]));
      overlay.querySelectorAll("[data-adjustment]").forEach((input) => {
        input.value = 0;
        overlay.querySelector(`[data-adjust-output="${input.dataset.adjustment}"]`).value = 0;
      });
      state.mask = createMask(state.sourceCanvas.width, state.sourceCanvas.height);
      state.resizeWidth = state.sourceCanvas.width;
      state.resizeHeight = state.sourceCanvas.height;
      overlay.querySelector("[data-resize-width]").value = state.resizeWidth;
      overlay.querySelector("[data-resize-height]").value = state.resizeHeight;
      await restoreProject();
      updateMaskCanvas();
      if (!state.status.startsWith("已恢复")) state.status = scale < 1 ? "原图超过 40MP，已创建 4K 工作副本" : "就绪";
      overlay.querySelectorAll("[data-deep-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.deepTab === initialTab)));
      overlay.querySelectorAll("[data-deep-panel]").forEach((panel) => panel.hidden = panel.dataset.deepPanel !== initialTab);
      requestAnimationFrame(render);
      overlay.querySelector("[data-deep-canvas]")?.focus();
    } finally { setBusy(false); render(); }
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("deep-editor-open");
    state.open = false;
    if (state.projectDirty) persistProject(false);
    clearTimeout(previewTimer);
    state.previewRevision += 1;
    state.gesture = null;
    state.polygonPoints = [];
  }

  return { open, close, state };
}
