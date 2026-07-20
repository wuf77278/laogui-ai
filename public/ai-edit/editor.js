import {
  cloneMask,
  combineMasks,
  ellipseMask,
  featherMask,
  maskBounds,
  maskHasSelection,
  polygonMask,
  rectangleMask,
  strokeMask
} from "../deep-edit/mask-engine.js";
import {
  AI_EDIT_OPERATION_LABELS,
  aiEditIntentKind
} from "./prompt-engine.js";
import {
  createAiEditWorkArea,
  createNumberedRegions,
  maskForAiEditWorkArea,
  numberedRegionJobs,
  semanticWorkAreaBlendMask
} from "./region-engine.js";

const TOOLS = [
  ["move", "icon-focus", "抓手"],
  ["rect", "icon-box-select", "矩形框选"],
  ["ellipse", "icon-focus", "椭圆框选"],
  ["lasso", "icon-vector", "自由套索"],
  ["polygon", "icon-vector", "多边形套索"],
  ["brush-add", "icon-brush", "画笔补选"],
  ["brush-subtract", "icon-eraser", "画笔减选"]
];

const OPERATION_LABELS = {
  remove: "局部消除",
  replace: "局部替换",
  material: "材质替换",
  detail: "细节增强",
  custom: "自定义编辑"
};

const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"></use></svg>`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const selectionModeForTool = (tool) => ["rect", "ellipse"].includes(tool) ? "semantic" : "precise";
const selectionModeLabel = (mode) => mode === "semantic" ? "智能范围" : "精准蒙版";
const AI_PROMPT_PRESETS = {
  remove: {
    operation: "remove",
    label: "自然清除",
    prompt: "清除框选中的目标，并根据周围地面、墙体、材质和光影自然补全，不留下原目标存在过的痕迹。"
  },
  material: {
    operation: "material",
    label: "材质替换",
    prompt: "只替换框选目标的表面材质，保持原有结构、透视、光线、阴影和相邻区域自然一致。"
  },
  custom: {
    operation: "custom",
    label: "自定义描述",
    prompt: ""
  }
};

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片载入失败"));
    image.src = url;
  });
}

function maskDataUrl(mask, width, height, feather = 0) {
  const editable = feather > 0 ? featherMask(mask, width, height, feather) : mask;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  for (let index = 0; index < editable.length; index += 1) {
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = 255 - editable[index];
  }
  ctx.putImageData(imageData, 0, 0);
  return { dataUrl: canvas.toDataURL("image/png"), editable };
}

function sourceCanvasForWorkArea(source, area) {
  const canvas = makeCanvas(area.canvasWidth, area.canvasHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#77736b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    source,
    area.sourceX,
    area.sourceY,
    area.sourceWidth,
    area.sourceHeight,
    area.offsetX,
    area.offsetY,
    area.sourceWidth,
    area.sourceHeight
  );
  return canvas;
}

async function compositeAiWorkArea(source, generatedUrl, mask, area) {
  const edited = await loadImage(generatedUrl);
  const expectedRatio = area.canvasWidth / area.canvasHeight;
  const actualRatio = (edited.naturalWidth || edited.width) / Math.max(1, edited.naturalHeight || edited.height);
  if (Math.abs(expectedRatio - actualRatio) > 0.04) {
    throw new Error("图片大模型返回的比例与框选工作区不一致，已停止回填以避免错位，请重试");
  }
  const out = makeCanvas(source.width, source.height);
  const ctx = out.getContext("2d");
  ctx.drawImage(source, 0, 0);
  const layer = makeCanvas(area.canvasWidth, area.canvasHeight);
  const layerCtx = layer.getContext("2d", { willReadFrequently: true });
  layerCtx.drawImage(edited, 0, 0, layer.width, layer.height);
  const pixels = layerCtx.getImageData(0, 0, layer.width, layer.height);
  for (let index = 0; index < mask.length; index += 1) {
    pixels.data[index * 4 + 3] = Math.round(pixels.data[index * 4 + 3] * mask[index] / 255);
  }
  layerCtx.putImageData(pixels, 0, 0);
  ctx.drawImage(
    layer,
    area.offsetX,
    area.offsetY,
    area.sourceWidth,
    area.sourceHeight,
    area.sourceX,
    area.sourceY,
    area.sourceWidth,
    area.sourceHeight
  );
  return out;
}

export function createAiEditor({ onEditRegion, onCommit, notify = () => {} } = {}) {
  const state = {
    open: false,
    busy: false,
    selected: null,
    image: null,
    sourceCanvas: null,
    previewCanvas: null,
    regions: [],
    activeRegion: 0,
    tool: "rect",
    combine: "replace",
    brushSize: 36,
    zoom: 1,
    panX: 0,
    panY: 0,
    view: null,
    gesture: null,
    polygonPoints: [],
    history: [],
    future: [],
    promptOptimizationEnabled: false,
    status: "就绪"
  };
  let overlay = null;

  const activeRegion = () => state.regions[state.activeRegion];

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "deep-workspace-overlay ai-edit-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="deep-workspace ai-edit-workspace" role="dialog" aria-modal="true" aria-label="AI 编辑工作区">
        <header class="deep-workspace-head">
          <button class="icon-button icon-only" type="button" data-ai-command="close" title="返回画布" aria-label="返回画布">${icon("icon-close")}</button>
          <div class="deep-workspace-title"><span>AI 编辑</span><strong data-ai-title>选中图片</strong></div>
          <div class="deep-head-actions" role="toolbar" aria-label="查看与历史">
            <button class="text-button" type="button" data-ai-command="undo" title="撤销">${icon("icon-history")}<span>撤销</span></button>
            <button class="text-button" type="button" data-ai-command="redo" title="恢复">${icon("icon-refresh")}<span>恢复</span></button>
            <button class="text-button" type="button" data-ai-command="zoom-out" title="缩小">−</button>
            <button class="text-button ai-zoom-readout" type="button" data-ai-command="fit">100%</button>
            <button class="text-button" type="button" data-ai-command="zoom-in" title="放大">＋</button>
            <button class="primary-button" type="button" data-ai-command="submit">${icon("icon-spark")}<span data-ai-submit-label>开始 AI 编辑</span></button>
          </div>
        </header>
        <div class="deep-workspace-body ai-edit-body">
          <aside class="deep-tool-rail" aria-label="AI 编辑选区工具">
            ${TOOLS.map(([id, iconId, label]) => `<button type="button" data-ai-tool="${id}" title="${label}" aria-label="${label}" aria-pressed="false">${icon(iconId)}<span>${label}</span></button>`).join("")}
          </aside>
          <main class="deep-stage ai-edit-stage" data-ai-stage>
            <canvas data-ai-canvas tabindex="0" aria-label="AI 编辑框选画布"></canvas>
            <div class="deep-stage-hint" data-ai-hint>先选择编号，再在图片上框选</div>
            <div class="deep-busy" data-ai-busy hidden><span class="icon-busy-dot"></span><strong data-ai-busy-text>处理中</strong></div>
          </main>
          <aside class="deep-inspector ai-edit-inspector">
            <div class="ai-edit-panel">
              <div class="deep-panel-heading"><h3>编号选区</h3><span>最多 2 个</span></div>
              <div class="ai-region-switch" role="tablist" aria-label="选择框选编号">
                <button type="button" role="tab" data-ai-region="0" aria-selected="true"><b>1</b><span>框选编号 1</span><small data-ai-region-status="0">未框选</small></button>
                <button type="button" role="tab" data-ai-region="1" aria-selected="false"><b>2</b><span>框选编号 2</span><small data-ai-region-status="1">未框选</small></button>
              </div>
              <p class="ai-active-guide" data-ai-active-guide>正在编辑框选编号 1</p>
              <div class="ai-selection-mode" data-ai-selection-mode data-mode="semantic" title="矩形和椭圆会识别范围内目标；套索和画笔会严格限制编辑边界">
                <span>选区方式</span><strong>智能范围</strong>
              </div>
              <div class="deep-segmented ai-combine-types" role="group" aria-label="选区组合方式">
                <button type="button" data-ai-combine="replace">新建</button><button type="button" data-ai-combine="add">增加</button><button type="button" data-ai-combine="subtract">减去</button>
              </div>
              <label class="ai-slider-label">画笔大小 <output data-ai-brush-value>36</output><input type="range" min="4" max="220" value="36" data-ai-brush-size></label>
              <label class="ai-slider-label">边缘羽化 <output data-ai-feather-value>2</output><input type="range" min="0" max="24" value="2" data-ai-feather></label>
              <button class="text-button ai-clear-region" type="button" data-ai-command="clear-region">清空当前编号选区</button>
              <h3 class="ai-prompt-heading" data-ai-prompt-heading>框选编号 1 的修改要求</h3>
              <div class="ai-operation-types" role="group" aria-label="AI 编辑方式">
                ${Object.entries(OPERATION_LABELS).map(([value, label]) => `<button type="button" data-ai-operation="${value}" aria-pressed="${value === "replace"}">${label}</button>`).join("")}
              </div>
              <label class="ai-prompt-label" for="aiRegionPrompt">提示词</label>
              <textarea id="aiRegionPrompt" rows="6" data-ai-region-prompt placeholder="例如：把这个区域改成浅色天然石材，保持光线和透视不变"></textarea>
              <div class="ai-execution-summary" data-ai-execution-summary aria-live="polite">
                <div><span>实际能力</span><strong data-ai-effective-operation>局部替换</strong></div>
                <p data-ai-scope-hint>请先框选需要编辑的目标。</p>
              </div>
              <div class="ai-prompt-presets" role="group" aria-label="常用提示词模板">
                <span>快速模板</span>
                <button type="button" data-ai-preset="remove">自然清除</button>
                <button type="button" data-ai-preset="material">材质替换</button>
                <button type="button" data-ai-preset="custom">自定义描述</button>
              </div>
              <div class="ai-prompt-optimization" data-ai-prompt-optimization>
                <div>
                  <strong>提示词优化</strong>
                  <span data-ai-prompt-optimization-status>关闭 · 快速直出</span>
                  <small data-ai-prompt-optimization-hint>直接使用你的原始提示词交给图片大模型</small>
                </div>
                <button class="ai-prompt-toggle" type="button" role="switch" aria-checked="false" aria-label="提示词优化" data-ai-command="toggle-prompt-optimization">
                  <span data-ai-prompt-toggle-label>关</span><i aria-hidden="true"></i>
                </button>
              </div>
              <div class="ai-region-summary" aria-live="polite">
                <div><b>1</b><span data-ai-summary="0">未框选</span></div>
                <div><b>2</b><span data-ai-summary="1">未框选</span></div>
              </div>
              <p>系统会按编号 1 → 2 依次编辑。若两个选区重叠，以编号 2 的要求为准。</p>
              <p class="ai-inline-error" data-ai-error role="alert" hidden></p>
              <button class="primary-button" type="button" data-ai-command="submit">${icon("icon-spark")}<span data-ai-submit-label>按编号生成结果</span></button>
            </div>
          </aside>
        </div>
        <footer class="deep-statusbar"><span data-ai-size>0 × 0</span><span data-ai-region-label>框选编号 1</span><span data-ai-tool-status>矩形框选</span><span data-ai-status>就绪</span></footer>
      </section>`;
    document.body.appendChild(overlay);
    bindEvents();
    return overlay;
  }

  function snapshot() {
    return state.regions.map((region) => ({
      mask: cloneMask(region.mask),
      selectionMode: region.selectionMode
    }));
  }

  function pushHistory() {
    state.history.push(snapshot());
    state.future = [];
    if (state.history.length > 30) state.history.shift();
  }

  function restoreMasks(snapshots) {
    snapshots.forEach((snapshot, index) => {
      state.regions[index].mask = cloneMask(snapshot.mask);
      state.regions[index].selectionMode = snapshot.selectionMode;
      updateRegionOverlay(state.regions[index]);
    });
  }

  function undo() {
    const previous = state.history.pop();
    if (!previous) return;
    state.future.push(snapshot());
    restoreMasks(previous);
    render();
  }

  function redo() {
    const next = state.future.pop();
    if (!next) return;
    state.history.push(snapshot());
    restoreMasks(next);
    render();
  }

  function setBusy(busy, text = "处理中") {
    state.busy = busy;
    const layer = overlay?.querySelector("[data-ai-busy]");
    if (layer) layer.hidden = !busy;
    const label = overlay?.querySelector("[data-ai-busy-text]");
    if (label) label.textContent = text;
    overlay?.querySelectorAll("button, input, textarea").forEach((element) => {
      element.disabled = busy;
    });
  }

  function setError(message = "") {
    const element = overlay?.querySelector("[data-ai-error]");
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }

  function sourcePoint(event) {
    const canvas = overlay.querySelector("[data-ai-canvas]");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (event.clientX - rect.left) * dpr;
    const py = (event.clientY - rect.top) * dpr;
    if (!state.view) return null;
    const x = (px - state.view.dx) / state.view.scale;
    const y = (py - state.view.dy) / state.view.scale;
    if (x < 0 || y < 0 || x >= state.sourceCanvas.width || y >= state.sourceCanvas.height) return null;
    return { x, y };
  }

  function applyIncoming(incoming, mode = state.combine, tool = state.tool) {
    const region = activeRegion();
    if (!region) return;
    pushHistory();
    region.mask = combineMasks(region.mask, incoming, mode);
    const incomingSelectionMode = selectionModeForTool(tool);
    region.selectionMode = mode === "replace"
      ? incomingSelectionMode
      : (region.selectionMode === "precise" || incomingSelectionMode === "precise" ? "precise" : "semantic");
    updateRegionOverlay(region);
    state.status = `${region.label}已更新 · ${selectionModeLabel(region.selectionMode)}`;
    setError("");
    render();
  }

  function updateRegionOverlay(region) {
    const maskCanvas = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
    const maskCtx = maskCanvas.getContext("2d");
    const imageData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
    for (let index = 0; index < region.mask.length; index += 1) {
      if (!region.mask[index]) continue;
      const offset = index * 4;
      imageData.data[offset] = region.color[0];
      imageData.data[offset + 1] = region.color[1];
      imageData.data[offset + 2] = region.color[2];
      imageData.data[offset + 3] = Math.round(region.mask[index] * .5);
    }
    maskCtx.putImageData(imageData, 0, 0);
    region.overlayCanvas = maskCanvas;
  }

  function drawMask(ctx, region, active) {
    if (!maskHasSelection(region.mask)) return;
    if (!region.overlayCanvas) updateRegionOverlay(region);
    ctx.save();
    ctx.globalAlpha = active ? 1 : .56;
    ctx.drawImage(region.overlayCanvas, state.view.dx, state.view.dy, state.sourceCanvas.width * state.view.scale, state.sourceCanvas.height * state.view.scale);
    ctx.restore();
    const bounds = maskBounds(region.mask, state.sourceCanvas.width, state.sourceCanvas.height);
    if (!bounds) return;
    const dpr = window.devicePixelRatio || 1;
    const x = state.view.dx + bounds.x * state.view.scale;
    const y = state.view.dy + bounds.y * state.view.scale;
    const radius = 12 * dpr;
    ctx.save();
    ctx.fillStyle = `rgb(${region.color.join(",")})`;
    ctx.strokeStyle = "rgba(17,17,15,.9)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${12 * dpr}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(region.number), x + radius, y + radius);
    ctx.restore();
  }

  function drawGesture(ctx) {
    const points = state.gesture?.points || state.polygonPoints;
    if (!points?.length || !state.view) return;
    const region = activeRegion();
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.strokeStyle = `rgb(${region.color.join(",")})`;
    ctx.fillStyle = `rgba(${region.color.join(",")},.16)`;
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.setLineDash([7 * dpr, 5 * dpr]);
    const first = points[0];
    const last = points.at(-1);
    ctx.beginPath();
    if (["rect", "ellipse"].includes(state.gesture?.type) && points.length > 1) {
      const x = state.view.dx + Math.min(first.x, last.x) * state.view.scale;
      const y = state.view.dy + Math.min(first.y, last.y) * state.view.scale;
      const width = Math.abs(last.x - first.x) * state.view.scale;
      const height = Math.abs(last.y - first.y) * state.view.scale;
      if (state.gesture.type === "ellipse") ctx.ellipse(x + width / 2, y + height / 2, Math.max(.5, width / 2), Math.max(.5, height / 2), 0, 0, Math.PI * 2);
      else ctx.rect(x, y, width, height);
    } else {
      points.forEach((point, index) => {
        const x = state.view.dx + point.x * state.view.scale;
        const y = state.view.dy + point.y * state.view.scale;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (state.gesture?.type === "lasso") ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!overlay || overlay.hidden || !state.sourceCanvas) return;
    const canvas = overlay.querySelector("[data-ai-canvas]");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(240, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const checker = Math.max(10, Math.round(14 * dpr));
    for (let y = 0; y < height; y += checker) for (let x = 0; x < width; x += checker) {
      ctx.fillStyle = ((x / checker + y / checker) % 2) ? "#242421" : "#30302b";
      ctx.fillRect(x, y, checker, checker);
    }
    const fit = Math.min((width * .9) / state.sourceCanvas.width, (height * .9) / state.sourceCanvas.height);
    const scale = fit * state.zoom;
    const drawWidth = state.sourceCanvas.width * scale;
    const drawHeight = state.sourceCanvas.height * scale;
    const dx = (width - drawWidth) / 2 + state.panX * dpr;
    const dy = (height - drawHeight) / 2 + state.panY * dpr;
    state.view = { dx, dy, scale, fit };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.previewCanvas || state.sourceCanvas, dx, dy, drawWidth, drawHeight);
    state.regions.forEach((region, index) => drawMask(ctx, region, index === state.activeRegion));
    drawGesture(ctx);
    updateUi();
  }

  function updateUi() {
    if (!overlay || !state.sourceCanvas) return;
    const region = activeRegion();
    overlay.querySelector("[data-ai-title]").textContent = state.selected?.title || "选中图片";
    overlay.querySelectorAll("[data-ai-tool]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.aiTool === state.tool)));
    overlay.querySelectorAll("[data-ai-combine]").forEach((button) => button.classList.toggle("active", button.dataset.aiCombine === state.combine));
    overlay.querySelectorAll("[data-ai-region]").forEach((button) => button.setAttribute("aria-selected", String(Number(button.dataset.aiRegion) === state.activeRegion)));
    overlay.querySelectorAll("[data-ai-operation]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.aiOperation === region.operation)));
    state.regions.forEach((item, index) => {
      const bounds = maskBounds(item.mask, state.sourceCanvas.width, state.sourceCanvas.height);
      const percent = bounds ? Math.max(1, Math.round(bounds.area / item.mask.length * 100)) : 0;
      const status = bounds ? `${selectionModeLabel(item.selectionMode)} · ${percent}%` : "未框选";
      overlay.querySelector(`[data-ai-region-status="${index}"]`).textContent = status;
      const summary = item.prompt.trim() ? `${status} · ${item.prompt.trim().slice(0, 28)}` : status;
      overlay.querySelector(`[data-ai-summary="${index}"]`).textContent = summary;
    });
    overlay.querySelector("[data-ai-active-guide]").textContent = `正在编辑${region.label}`;
    const hasSelection = maskHasSelection(region.mask);
    const displayedSelectionMode = hasSelection ? region.selectionMode : selectionModeForTool(state.tool);
    const selectionMode = overlay.querySelector("[data-ai-selection-mode]");
    selectionMode.dataset.mode = displayedSelectionMode;
    selectionMode.querySelector("strong").textContent = selectionModeLabel(displayedSelectionMode);
    selectionMode.title = displayedSelectionMode === "semantic"
      ? "矩形或椭圆是智能范围：AI 会结合提示词识别范围内真正要修改的目标"
      : "套索或画笔是精准蒙版：AI 结果会被严格限制在选区内部";
    overlay.querySelector("[data-ai-prompt-heading]").textContent = `${region.label}：修改要求`;
    const prompt = overlay.querySelector("[data-ai-region-prompt]");
    if (document.activeElement !== prompt) prompt.value = region.prompt;
    prompt.placeholder = region.operation === "custom"
      ? "直接描述你想要的变化，例如：在泳池底部增加暖白色隐藏灯带"
      : "例如：把这个区域改成浅色天然石材，保持光线和透视不变";
    const intentKind = aiEditIntentKind(region.operation, region.prompt);
    const effectiveLabel = AI_EDIT_OPERATION_LABELS[intentKind] || "局部编辑";
    overlay.querySelector("[data-ai-effective-operation]").textContent = effectiveLabel;
    const scopeHint = overlay.querySelector("[data-ai-scope-hint]");
    scopeHint.textContent = !hasSelection
      ? "请先框选需要编辑的目标。"
      : displayedSelectionMode === "semantic"
        ? "智能范围：AI 会结合周边环境自然重建，框选外的目标不会被指定修改。请确认目标完整包含在范围内。"
        : "精准蒙版：只允许修改套索或画笔选区内部，选区外保持原图。";
    overlay.querySelectorAll("[data-ai-submit-label]").forEach((label) => {
      label.textContent = state.status.startsWith("AI 编辑失败") ? "重新生成" : (label.closest("header") ? "开始 AI 编辑" : "按编号生成结果");
    });
    overlay.querySelector("[data-ai-feather]").value = region.feather;
    overlay.querySelector("[data-ai-feather-value]").value = region.feather;
    overlay.querySelector("[data-ai-brush-value]").value = state.brushSize;
    const optimization = overlay.querySelector("[data-ai-prompt-optimization]");
    const optimizationToggle = overlay.querySelector("[data-ai-command='toggle-prompt-optimization']");
    optimization?.classList.toggle("active", state.promptOptimizationEnabled);
    optimizationToggle?.setAttribute("aria-checked", String(state.promptOptimizationEnabled));
    overlay.querySelector("[data-ai-prompt-toggle-label]").textContent = state.promptOptimizationEnabled ? "开" : "关";
    overlay.querySelector("[data-ai-prompt-optimization-status]").textContent = state.promptOptimizationEnabled ? "开启 · 优化后生成" : "关闭 · 快速直出";
    overlay.querySelector("[data-ai-prompt-optimization-hint]").textContent = state.promptOptimizationEnabled
      ? "先优化简单要求，再交给图片大模型，生成时间会更长"
      : "直接使用你的原始提示词交给图片大模型";
    overlay.querySelector(".ai-zoom-readout").textContent = `${Math.round(state.zoom * 100)}%`;
    overlay.querySelector("[data-ai-size]").textContent = `${state.sourceCanvas.width} × ${state.sourceCanvas.height}`;
    overlay.querySelector("[data-ai-region-label]").textContent = `${region.label} · ${selectionModeLabel(displayedSelectionMode)}`;
    overlay.querySelector("[data-ai-tool-status]").textContent = TOOLS.find(([id]) => id === state.tool)?.[2] || state.tool;
    overlay.querySelector("[data-ai-status]").textContent = state.status;
    overlay.querySelector("[data-ai-command='undo']").disabled = state.busy || !state.history.length;
    overlay.querySelector("[data-ai-command='redo']").disabled = state.busy || !state.future.length;
    const hint = overlay.querySelector("[data-ai-hint]");
    hint.textContent = state.tool === "polygon"
      ? `逐点单击，为“${region.label}”双击闭合`
      : `正在为“${region.label}”创建${selectionModeLabel(selectionModeForTool(state.tool))}`;
  }

  function handlePointerDown(event) {
    if (state.busy || !state.sourceCanvas) return;
    const point = sourcePoint(event);
    if (!point && state.tool !== "move") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (state.tool === "move") {
      state.gesture = { type: "move", startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY };
      return;
    }
    if (state.tool === "polygon") {
      const first = state.polygonPoints[0];
      const closeRadius = 12 / Math.max(.01, state.view?.scale || 1);
      if (state.polygonPoints.length >= 3 && first && Math.hypot(point.x - first.x, point.y - first.y) <= closeRadius) {
        finishPolygon();
        return;
      }
      state.polygonPoints.push(point);
      render();
      return;
    }
    const type = ["rect", "ellipse", "lasso"].includes(state.tool) ? state.tool : "brush";
    state.gesture = { type, points: [point] };
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
    const point = sourcePoint(event);
    if (!point) return;
    const last = gesture.points.at(-1);
    if (["rect", "ellipse"].includes(gesture.type)) gesture.points[1] = point;
    else if (!last || Math.hypot(point.x - last.x, point.y - last.y) > Math.max(1, state.sourceCanvas.width / 800)) gesture.points.push(point);
    render();
  }

  function handlePointerUp(event) {
    const gesture = state.gesture;
    if (!gesture || state.busy) return;
    if (gesture.type === "move") { state.gesture = null; return; }
    const point = sourcePoint(event);
    if (point && ["rect", "ellipse"].includes(gesture.type)) gesture.points[1] = point;
    let incoming = null;
    if (gesture.type === "rect" && gesture.points.length > 1) incoming = rectangleMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points[0], gesture.points[1]);
    else if (gesture.type === "ellipse" && gesture.points.length > 1) incoming = ellipseMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points[0], gesture.points[1]);
    else if (gesture.type === "lasso" && gesture.points.length > 2) incoming = polygonMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points);
    else if (gesture.type === "brush") incoming = strokeMask(state.sourceCanvas.width, state.sourceCanvas.height, gesture.points, state.brushSize);
    state.gesture = null;
    if (incoming) {
      const mode = state.tool === "brush-add" ? "add" : state.tool === "brush-subtract" ? "subtract" : state.combine;
      applyIncoming(incoming, mode, state.tool);
    } else render();
  }

  function finishPolygon() {
    if (state.polygonPoints.length < 3) return;
    const incoming = polygonMask(state.sourceCanvas.width, state.sourceCanvas.height, state.polygonPoints);
    state.polygonPoints = [];
    applyIncoming(incoming, state.combine, "polygon");
  }

  async function submit() {
    setError("");
    let jobs;
    try {
      jobs = numberedRegionJobs(state.regions);
    } catch (error) {
      setError(error.message);
      notify(error.message);
      return;
    }
    setBusy(true, "正在准备 AI 编辑");
    state.previewCanvas = null;
    try {
      let current = makeCanvas(state.sourceCanvas.width, state.sourceCanvas.height);
      current.getContext("2d").drawImage(state.sourceCanvas, 0, 0);
      const optimizedPrompts = [];
      for (let index = 0; index < jobs.length; index += 1) {
        const region = jobs[index];
        const progress = `${index + 1}/${jobs.length}`;
        const progressText = state.promptOptimizationEnabled
          ? `正在优化${region.label}提示词并交给图片大模型（${progress}）`
          : `正在将${region.label}和原始提示词交给图片大模型（${progress}）`;
        state.status = progressText;
        setBusy(true, progressText);
        const fullMask = maskDataUrl(region.mask, current.width, current.height, region.feather);
        const fullBounds = maskBounds(fullMask.editable, current.width, current.height);
        const workArea = createAiEditWorkArea(fullBounds, current.width, current.height, region.selectionMode);
        const workSource = sourceCanvasForWorkArea(current, workArea);
        const workMaskData = maskForAiEditWorkArea(fullMask.editable, current.width, workArea);
        const workMask = maskDataUrl(workMaskData, workArea.canvasWidth, workArea.canvasHeight);
        const workBounds = maskBounds(workMask.editable, workArea.canvasWidth, workArea.canvasHeight);
        const generated = await onEditRegion?.({
          selected: state.selected,
          regionNumber: region.number,
          operation: region.operation,
          selectionMode: region.selectionMode,
          prompt: region.prompt.trim(),
          sourceDataUrl: workSource.toDataURL("image/png"),
          maskDataUrl: workMask.dataUrl,
          maskWidth: workArea.canvasWidth,
          maskHeight: workArea.canvasHeight,
          bounds: workBounds,
          outputSize: workArea.outputSize,
          promptOptimizationEnabled: state.promptOptimizationEnabled
        });
        if (!generated?.url) throw new Error(`${region.label}没有返回图片`);
        optimizedPrompts.push({
          regionNumber: region.number,
          selectionMode: region.selectionMode,
          originalPrompt: region.prompt.trim(),
          optimizedPrompt: generated.optimizedPrompt || region.prompt.trim(),
          optimizer: generated.reasoningModel || "",
          promptOptimizationEnabled: state.promptOptimizationEnabled
        });
        const blendMask = region.selectionMode === "semantic"
          ? semanticWorkAreaBlendMask(workArea, current.width, current.height)
          : workMask.editable;
        current = await compositeAiWorkArea(current, generated.url, blendMask, workArea);
        state.previewCanvas = current;
        render();
      }
      await onCommit?.({
        dataUrl: current.toDataURL("image/png"),
        title: "AI 编辑结果",
        mode: "ai-edit",
        selected: state.selected,
        width: current.width,
        height: current.height,
        regionCount: jobs.length,
        optimizedPrompts
      });
      setBusy(false);
      close();
    } catch (error) {
      state.previewCanvas = null;
      state.status = "AI 编辑失败，编号选区和提示词已保留";
      setError(error.message || "AI 编辑失败，请重试");
      notify(error.message || "AI 编辑失败，请重试");
      render();
    } finally {
      setBusy(false);
      render();
    }
  }

  function handleCommand(command) {
    if (command === "close") close();
    else if (command === "undo") undo();
    else if (command === "redo") redo();
    else if (command === "fit") { state.zoom = 1; state.panX = 0; state.panY = 0; render(); }
    else if (command === "zoom-in") { state.zoom = clamp(state.zoom * 1.2, .1, 8); render(); }
    else if (command === "zoom-out") { state.zoom = clamp(state.zoom / 1.2, .1, 8); render(); }
    else if (command === "toggle-prompt-optimization") {
      state.promptOptimizationEnabled = !state.promptOptimizationEnabled;
      state.status = state.promptOptimizationEnabled ? "提示词优化已开启，生成时间会更长" : "提示词优化已关闭，将快速直出";
      render();
    }
    else if (command === "clear-region") {
      pushHistory();
      activeRegion().mask.fill(0);
      activeRegion().selectionMode = selectionModeForTool(state.tool);
      updateRegionOverlay(activeRegion());
      state.polygonPoints = [];
      state.status = `${activeRegion().label}已清空`;
      render();
    } else if (command === "submit") submit();
  }

  function bindEvents() {
    overlay.addEventListener("click", (event) => {
      const regionIndex = event.target.closest("[data-ai-region]")?.dataset.aiRegion;
      if (regionIndex != null) {
        state.activeRegion = clamp(Number(regionIndex), 0, 1);
        state.polygonPoints = [];
        setError("");
        render();
        return;
      }
      const tool = event.target.closest("[data-ai-tool]")?.dataset.aiTool;
      if (tool) { state.tool = tool; state.polygonPoints = []; render(); return; }
      const combine = event.target.closest("[data-ai-combine]")?.dataset.aiCombine;
      if (combine) { state.combine = combine; render(); return; }
      const operation = event.target.closest("[data-ai-operation]")?.dataset.aiOperation;
      if (operation) { activeRegion().operation = operation; render(); return; }
      const preset = event.target.closest("[data-ai-preset]")?.dataset.aiPreset;
      if (preset && AI_PROMPT_PRESETS[preset]) {
        const item = AI_PROMPT_PRESETS[preset];
        activeRegion().operation = item.operation;
        activeRegion().prompt = item.prompt;
        setError("");
        render();
        overlay.querySelector("[data-ai-region-prompt]")?.focus();
        return;
      }
      const command = event.target.closest("[data-ai-command]")?.dataset.aiCommand;
      if (command) handleCommand(command);
    });
    overlay.addEventListener("input", (event) => {
      if (event.target.matches("[data-ai-region-prompt]")) {
        activeRegion().prompt = event.target.value;
        setError("");
        updateUi();
      }
      if (event.target.matches("[data-ai-brush-size]")) { state.brushSize = Number(event.target.value); updateUi(); }
      if (event.target.matches("[data-ai-feather]")) { activeRegion().feather = Number(event.target.value); updateUi(); }
    });
    const canvas = overlay.querySelector("[data-ai-canvas]");
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("dblclick", () => { if (state.tool === "polygon") finishPolygon(); });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * .001), .1, 8);
      render();
    }, { passive: false });
    window.addEventListener("resize", render);
    window.addEventListener("keydown", (event) => {
      if (!state.open || event.target.matches("input, textarea, select")) return;
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (commandKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key.toLowerCase() === "r") { state.tool = "rect"; render(); }
      else if (event.key.toLowerCase() === "l") { state.tool = "lasso"; render(); }
      else if (event.key.toLowerCase() === "p") { state.tool = "polygon"; render(); }
      else if (event.key.toLowerCase() === "b") { state.tool = "brush-add"; render(); }
    });
  }

  async function open(selected) {
    ensureOverlay();
    if (!selected?.url) throw new Error("没有可以编辑的图片");
    state.selected = selected;
    state.tool = "rect";
    state.combine = "replace";
    state.activeRegion = 0;
    state.brushSize = 36;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.gesture = null;
    state.polygonPoints = [];
    state.history = [];
    state.future = [];
    state.promptOptimizationEnabled = false;
    state.previewCanvas = null;
    state.status = "正在载入图片";
    setError("");
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    state.open = true;
    document.body.classList.add("ai-editor-open");
    setBusy(true, "正在载入原图");
    try {
      state.image = await loadImage(selected.url);
      const pixelCount = state.image.naturalWidth * state.image.naturalHeight;
      const scale = pixelCount > 40_000_000 ? Math.min(1, 4096 / Math.max(state.image.naturalWidth, state.image.naturalHeight)) : 1;
      state.sourceCanvas = makeCanvas(state.image.naturalWidth * scale, state.image.naturalHeight * scale);
      state.sourceCanvas.getContext("2d", { willReadFrequently: true }).drawImage(state.image, 0, 0, state.sourceCanvas.width, state.sourceCanvas.height);
      state.regions = createNumberedRegions(state.sourceCanvas.width, state.sourceCanvas.height);
      state.status = scale < 1 ? "原图超过 40MP，已创建 4K 工作副本" : "请选择编号并框选区域";
      requestAnimationFrame(render);
      overlay.querySelector("[data-ai-canvas]")?.focus();
    } finally {
      setBusy(false);
      render();
    }
  }

  function close() {
    if (!overlay) return;
    if (state.busy) {
      notify("AI 编辑正在处理中，请稍候");
      return;
    }
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("ai-editor-open");
    state.open = false;
    state.busy = false;
    state.gesture = null;
    state.polygonPoints = [];
  }

  return { open, close, getState: () => state };
}
