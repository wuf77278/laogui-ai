const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"></use></svg>`;

const CATEGORIES = [
  ["crop", "i-crop", "裁剪"],
  ["adjust", "i-compare", "调整"],
  ["filter", "i-image", "滤镜"],
  ["markup", "i-edit", "标记"],
  ["more", "i-tasks", "更多"],
];

const RATIOS = [["free", "自由"], ["original", "原图"], ["1:1", "1:1"], ["4:3", "4:3"], ["3:4", "3:4"], ["4:5", "4:5"], ["9:16", "9:16"], ["16:9", "16:9"]];
const ADJUSTMENTS = [
  ["exposure", "亮度"], ["contrast", "对比度"], ["highlights", "高光"],
  ["shadows", "阴影"], ["saturation", "饱和度"], ["temperature", "色温"],
  ["clarity", "清晰度"], ["sharpen", "锐化"], ["vignette", "暗角"],
];
const FILTERS = [
  ["original", "原图", {}],
  ["natural", "自然", { exposure: 8, contrast: 6, saturation: 5, vibrance: 8 }],
  ["clear", "通透", { exposure: 10, contrast: 12, highlights: -12, shadows: 16, clarity: 12 }],
  ["warm", "暖阳", { exposure: 7, temperature: 22, saturation: 10, highlights: -8 }],
  ["cool", "冷调", { temperature: -22, tint: 4, contrast: 7, saturation: -4 }],
  ["cinema", "电影", { contrast: 18, highlights: -22, shadows: 12, saturation: -12, vignette: 20 }],
  ["mono", "黑白", { saturation: -100, contrast: 16, clarity: 10 }],
  ["architecture", "建筑", { contrast: 12, highlights: -18, shadows: 15, clarity: 22, sharpen: 14 }],
  ["interior", "室内", { exposure: 9, highlights: -25, shadows: 24, temperature: 8, clarity: 9 }],
];

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function copyCanvas(source) {
  const canvas = makeCanvas(source.width, source.height);
  canvas.getContext("2d").drawImage(source, 0, 0);
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

function parseRatio(value, originalWidth, originalHeight) {
  if (value === "free") return null;
  if (value === "original") return originalWidth / originalHeight;
  const [width, height] = value.split(":").map(Number);
  return width / height;
}

export function createBasicEditor({ onCommit, notify = () => {} } = {}) {
  let overlay;
  let previewTimer;
  let workerId = 0;
  const workerJobs = new Map();
  let worker;

  function imageWorker() {
    if (worker) return worker;
    try {
      worker = new Worker(new URL("./deep-edit/image-ops.worker.js", import.meta.url), { type: "module" });
    } catch (error) {
      throw new Error(location.protocol === "file:"
        ? "基础编辑不能从本地文件直接打开，请使用 4178 网页地址"
        : `图片处理模块加载失败：${error.message || "请重新打开页面"}`);
    }
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const error = new Error("图片处理模块运行失败，请重新打开基础编辑");
      workerJobs.forEach((job) => job.reject(error));
      workerJobs.clear();
      worker?.terminate();
      worker = null;
      notify(error.message);
    };
    return worker;
  }

  function handleWorkerMessage({ data }) {
    const job = workerJobs.get(data.id);
    if (!job) return;
    workerJobs.delete(data.id);
    data.ok ? job.resolve(new Uint8ClampedArray(data.pixels)) : job.reject(new Error(data.error || "图片处理失败"));
  }

  const state = {
    open: false,
    selected: null,
    original: null,
    working: null,
    markup: null,
    preview: null,
    category: "crop",
    ratio: "free",
    cropRect: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    view: null,
    pointers: new Map(),
    gesture: null,
    history: [],
    future: [],
    compare: false,
    busy: false,
    adjustments: Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])),
    filter: "original",
    filterStrength: 100,
    straighten: 0,
    perspectiveX: 0,
    perspectiveY: 0,
    markupTool: "pen",
    markupColor: "#f4c34d",
    markupSize: 20,
    text: "",
    resizeWidth: 0,
    resizeHeight: 0,
    outputFormat: "image/png",
    outputQuality: 92,
    previewIncludesMarkup: false,
    dirty: false,
    previewRevision: 0,
  };

  function runWorker(adjustments, source = state.working) {
    const context = source.getContext("2d", { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, source.width, source.height).data.slice();
    const id = ++workerId;
    return new Promise((resolve, reject) => {
      workerJobs.set(id, { resolve, reject });
      try {
        imageWorker().postMessage({ id, pixels: pixels.buffer, width: source.width, height: source.height, adjustments }, [pixels.buffer]);
      } catch (error) {
        workerJobs.delete(id);
        reject(error);
      }
    });
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "basic-editor-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="basic-editor" role="dialog" aria-modal="true" aria-label="基础编辑">
        <header class="basic-editor-head">
          <button type="button" data-basic-command="close" aria-label="返回">${icon("i-back")}</button>
          <div><span>基础编辑</span><strong data-basic-title>图片</strong></div>
          <button type="button" data-basic-command="undo" aria-label="撤销">${icon("i-back")}</button>
          <button type="button" data-basic-command="redo" aria-label="恢复">${icon("i-share")}</button>
          <button class="basic-save" type="button" data-basic-command="save">完成</button>
        </header>
        <main class="basic-editor-stage" data-basic-stage>
          <canvas data-basic-canvas aria-label="基础编辑画布"></canvas>
          <output class="basic-zoom">100%</output>
          <div class="basic-editor-busy" data-basic-busy hidden><span></span><strong>处理中</strong></div>
        </main>
        <section class="basic-control-panel">
          <div class="basic-panel" data-basic-panel="crop">
            <div class="basic-ratio-row">${RATIOS.map(([id, label]) => `<button type="button" data-basic-ratio="${id}">${label}</button>`).join("")}</div>
            <div class="basic-action-row">
              <button type="button" data-basic-action="rotate-left">${icon("i-back")}<span>左转</span></button>
              <button type="button" data-basic-action="rotate-right">${icon("i-share")}<span>右转</span></button>
              <button type="button" data-basic-action="flip-x">${icon("i-compare")}<span>水平翻转</span></button>
              <button type="button" data-basic-action="flip-y">${icon("i-compare")}<span>垂直翻转</span></button>
              <button class="primary" type="button" data-basic-action="apply-crop">应用裁剪</button>
            </div>
            <div class="basic-geometry-sliders">
              <label>拉直 <output data-basic-geometry-output="straighten">0°</output><input type="range" min="-20" max="20" value="0" data-basic-geometry="straighten"></label>
              <label>横向透视 <output data-basic-geometry-output="perspectiveX">0</output><input type="range" min="-40" max="40" value="0" data-basic-geometry="perspectiveX"></label>
              <label>纵向透视 <output data-basic-geometry-output="perspectiveY">0</output><input type="range" min="-40" max="40" value="0" data-basic-geometry="perspectiveY"></label>
              <button type="button" data-basic-action="apply-geometry">应用校正</button>
            </div>
          </div>
          <div class="basic-panel" data-basic-panel="adjust" hidden>
            <div class="basic-adjust-tools"><button type="button" data-basic-action="auto-adjust">自动优化</button>${ADJUSTMENTS.map(([id, label]) => `<button type="button" data-basic-adjust-select="${id}">${label}</button>`).join("")}</div>
            <label class="basic-main-slider"><span data-basic-adjust-label>亮度</span><output data-basic-adjust-value>0</output><input type="range" min="-100" max="100" value="0" data-basic-adjustment="exposure"></label>
            <button class="basic-apply-button" type="button" data-basic-action="apply-adjust">应用调整</button>
          </div>
          <div class="basic-panel" data-basic-panel="filter" hidden>
            <div class="basic-filter-row">${FILTERS.map(([id, label]) => `<button type="button" data-basic-filter="${id}"><i></i><span>${label}</span></button>`).join("")}</div>
            <label class="basic-main-slider"><span>滤镜强度</span><output data-basic-filter-value>100</output><input type="range" min="0" max="100" value="100" data-basic-filter-strength></label>
            <button class="basic-apply-button" type="button" data-basic-action="apply-filter">应用滤镜</button>
          </div>
          <div class="basic-panel" data-basic-panel="markup" hidden>
            <div class="basic-markup-tools">
              <button type="button" data-basic-markup="pen">画笔</button><button type="button" data-basic-markup="highlight">荧光笔</button><button type="button" data-basic-markup="mosaic">马赛克</button><button type="button" data-basic-markup="erase">橡皮擦</button><button type="button" data-basic-markup="text">文字</button>
            </div>
            <div class="basic-markup-settings"><input type="color" value="#f4c34d" data-basic-color aria-label="标记颜色"><input type="range" min="4" max="100" value="20" data-basic-markup-size aria-label="标记粗细"><input type="text" maxlength="80" placeholder="输入文字后点图片放置" data-basic-text></div>
          </div>
          <div class="basic-panel" data-basic-panel="more" hidden>
            <div class="basic-resize-controls"><label>宽度<input type="number" min="1" max="16384" data-basic-width></label><span>×</span><label>高度<input type="number" min="1" max="16384" data-basic-height></label><button type="button" data-basic-action="resize">修改尺寸</button></div>
            <div class="basic-export-controls"><label>格式<select data-basic-format><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></label><label>质量 <output data-basic-quality-value>92%</output><input type="range" min="40" max="100" value="92" data-basic-quality></label></div>
            <p data-basic-info></p>
          </div>
        </section>
        <nav class="basic-category-bar" aria-label="基础编辑工具">${CATEGORIES.map(([id, iconId, label]) => `<button type="button" data-basic-category="${id}">${icon(iconId)}<span>${label}</span></button>`).join("")}</nav>
      </section>`;
    document.body.appendChild(overlay);
    bindEvents();
  }

  function setBusy(value) {
    state.busy = value;
    const busy = overlay?.querySelector("[data-basic-busy]");
    if (busy) busy.hidden = !value;
  }

  function snapshot() {
    return { working: copyCanvas(state.working), markup: copyCanvas(state.markup) };
  }

  function pushHistory() {
    state.history.push(snapshot());
    const pixels = state.working.width * state.working.height;
    const limit = pixels > 12_000_000 ? 2 : pixels > 4_000_000 ? 4 : 8;
    while (state.history.length > limit) state.history.shift();
    state.future = [];
    state.dirty = true;
  }

  function restore(item) {
    state.working = copyCanvas(item.working);
    state.markup = copyCanvas(item.markup);
    state.preview = null;
    state.previewIncludesMarkup = false;
    state.cropRect = null;
    state.resizeWidth = state.working.width;
    state.resizeHeight = state.working.height;
    render();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshot());
    restore(state.history.pop());
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshot());
    restore(state.future.pop());
  }

  function displayedCanvas() {
    if (state.compare) return state.original;
    return state.preview || state.working;
  }

  function compositeCanvas() {
    const canvas = copyCanvas(state.preview || state.working);
    if (!state.previewIncludesMarkup) canvas.getContext("2d").drawImage(state.markup, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function render() {
    if (!overlay || overlay.hidden || !state.working) return;
    const canvas = overlay.querySelector("[data-basic-canvas]");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(240, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#20211f"; ctx.fillRect(0, 0, width, height);
    const source = displayedCanvas();
    const fit = Math.min(width / source.width, height / source.height) * .94;
    const scale = fit * state.zoom;
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    const dx = (width - drawWidth) / 2 + state.panX * dpr;
    const dy = (height - drawHeight) / 2 + state.panY * dpr;
    state.view = { dx, dy, scale, width, height, dpr };
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
    if (!state.compare && !state.previewIncludesMarkup) ctx.drawImage(state.markup, dx, dy, drawWidth, drawHeight);
    if (state.cropRect && state.category === "crop" && !state.compare) drawCropOverlay(ctx);
    updateUi();
  }

  function drawCropOverlay(ctx) {
    const { x, y, width, height } = state.cropRect;
    const view = state.view;
    const left = view.dx + x * view.scale;
    const top = view.dy + y * view.scale;
    const cropWidth = width * view.scale;
    const cropHeight = height * view.scale;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.beginPath(); ctx.rect(0, 0, view.width, view.height); ctx.rect(left, top, cropWidth, cropHeight); ctx.fill("evenodd");
    ctx.strokeStyle = "#f1c45c"; ctx.lineWidth = 2 * view.dpr; ctx.strokeRect(left, top, cropWidth, cropHeight);
    ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1 * view.dpr;
    for (let i = 1; i < 3; i += 1) {
      ctx.beginPath(); ctx.moveTo(left + cropWidth * i / 3, top); ctx.lineTo(left + cropWidth * i / 3, top + cropHeight); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, top + cropHeight * i / 3); ctx.lineTo(left + cropWidth, top + cropHeight * i / 3); ctx.stroke();
    }
    ctx.restore();
  }

  function updateUi() {
    overlay.querySelector("[data-basic-title]").textContent = state.selected?.title || "图片";
    overlay.querySelector(".basic-zoom").textContent = `${Math.round(state.zoom * 100)}%`;
    overlay.querySelectorAll("[data-basic-category]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.basicCategory === state.category)));
    overlay.querySelectorAll("[data-basic-panel]").forEach((panel) => { panel.hidden = panel.dataset.basicPanel !== state.category; });
    overlay.querySelectorAll("[data-basic-ratio]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.basicRatio === state.ratio)));
    overlay.querySelectorAll("[data-basic-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.basicFilter === state.filter)));
    overlay.querySelectorAll("[data-basic-markup]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.basicMarkup === state.markupTool)));
    overlay.querySelector("[data-basic-command='undo']").disabled = !state.history.length || state.busy;
    overlay.querySelector("[data-basic-command='redo']").disabled = !state.future.length || state.busy;
    const widthInput = overlay.querySelector("[data-basic-width]");
    const heightInput = overlay.querySelector("[data-basic-height]");
    if (widthInput && document.activeElement !== widthInput) widthInput.value = state.resizeWidth;
    if (heightInput && document.activeElement !== heightInput) heightInput.value = state.resizeHeight;
    const info = overlay.querySelector("[data-basic-info]");
    if (info) info.textContent = `${state.working.width} × ${state.working.height} · 保存为新图片，不覆盖原图`;
  }

  function sourcePoint(event) {
    if (!state.view) return null;
    const canvas = overlay.querySelector("[data-basic-canvas]");
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * state.view.dpr;
    const py = (event.clientY - rect.top) * state.view.dpr;
    const x = (px - state.view.dx) / state.view.scale;
    const y = (py - state.view.dy) / state.view.scale;
    if (x < 0 || y < 0 || x > state.working.width || y > state.working.height) return null;
    return { x: clamp(x, 0, state.working.width), y: clamp(y, 0, state.working.height) };
  }

  function cropRectFromPoints(first, last) {
    let width = Math.abs(last.x - first.x);
    let height = Math.abs(last.y - first.y);
    const ratio = parseRatio(state.ratio, state.original.width, state.original.height);
    if (ratio) {
      if (width / Math.max(1, height) > ratio) height = width / ratio; else width = height * ratio;
    }
    const fit = Math.min(1, state.working.width / Math.max(1, width), state.working.height / Math.max(1, height));
    width *= fit; height *= fit;
    const x = clamp(first.x < last.x ? first.x : first.x - width, 0, Math.max(0, state.working.width - width));
    const y = clamp(first.y < last.y ? first.y : first.y - height, 0, Math.max(0, state.working.height - height));
    return { x, y, width, height };
  }

  function beginPinch() {
    const points = [...state.pointers.values()];
    if (points.length < 2) return;
    state.gesture = { type: "pinch", distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), centerX: (points[0].x + points[1].x) / 2, centerY: (points[0].y + points[1].y) / 2, zoom: state.zoom, panX: state.panX, panY: state.panY };
  }

  function pointerDown(event) {
    if (state.busy) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (state.pointers.size >= 2) { beginPinch(); render(); return; }
    const point = sourcePoint(event);
    if (!point) return;
    if (state.category === "crop") state.gesture = { type: "crop", pointerId: event.pointerId, points: [point] };
    else if (state.category === "markup") {
      if (state.markupTool === "text") return placeText(point);
      pushHistory();
      state.gesture = { type: "markup", pointerId: event.pointerId, points: [point] };
      drawMarkupStroke([point]);
    } else state.gesture = { type: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
  }

  function pointerMove(event) {
    if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = state.gesture;
    if (!gesture) return;
    if (gesture.type === "pinch") {
      const points = [...state.pointers.values()]; if (points.length < 2) return;
      const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      state.zoom = clamp(gesture.zoom * distance / Math.max(1, gesture.distance), 1, 6);
      state.panX = gesture.panX + (points[0].x + points[1].x) / 2 - gesture.centerX;
      state.panY = gesture.panY + (points[0].y + points[1].y) / 2 - gesture.centerY;
      render(); return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    const point = sourcePoint(event);
    if (gesture.type === "pan") { state.panX = gesture.panX + event.clientX - gesture.x; state.panY = gesture.panY + event.clientY - gesture.y; render(); return; }
    if (!point) return;
    if (gesture.type === "crop") { gesture.points[1] = point; state.cropRect = cropRectFromPoints(gesture.points[0], point); }
    if (gesture.type === "markup") {
      const last = gesture.points.at(-1);
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1) { gesture.points.push(point); drawMarkupStroke([last, point]); }
    }
    render();
  }

  function pointerUp(event) {
    state.pointers.delete(event.pointerId);
    if (state.gesture?.type === "pinch") { if (state.pointers.size < 2) state.gesture = null; render(); return; }
    if (state.gesture?.pointerId === event.pointerId) state.gesture = null;
    render();
  }

  function drawMarkupStroke(points) {
    const ctx = state.markup.getContext("2d");
    const tool = state.markupTool;
    if (tool === "mosaic") return drawMosaic(points.at(-1));
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = state.markupSize;
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.globalAlpha = tool === "highlight" ? .32 : 1;
    ctx.strokeStyle = state.markupColor;
    if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0].x, points[0].y, state.markupSize / 2, 0, Math.PI * 2); ctx.fillStyle = state.markupColor; ctx.fill(); }
    else { ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke(); }
    ctx.restore();
  }

  function drawMosaic(point) {
    const size = Math.max(6, state.markupSize);
    const block = Math.max(5, Math.round(size / 3));
    const ctx = state.markup.getContext("2d");
    const source = compositeCanvas();
    ctx.save(); ctx.beginPath(); ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    for (let y = point.y - size / 2; y < point.y + size / 2; y += block) for (let x = point.x - size / 2; x < point.x + size / 2; x += block) {
      ctx.drawImage(source, clamp(x, 0, source.width - 1), clamp(y, 0, source.height - 1), block, block, x, y, block, block);
    }
    ctx.restore();
  }

  function placeText(point) {
    const value = state.text.trim();
    if (!value) return notify("请先输入文字");
    pushHistory();
    const ctx = state.markup.getContext("2d");
    ctx.save(); ctx.fillStyle = state.markupColor; ctx.font = `700 ${Math.max(18, state.markupSize * 1.5)}px sans-serif`; ctx.textBaseline = "middle"; ctx.fillText(value, point.x, point.y); ctx.restore();
    render();
  }

  function replaceWorking(canvas) {
    state.working = canvas;
    state.markup = makeCanvas(canvas.width, canvas.height);
    state.preview = null; state.previewIncludesMarkup = false; state.cropRect = null; state.zoom = 1; state.panX = 0; state.panY = 0;
    state.resizeWidth = canvas.width; state.resizeHeight = canvas.height;
  }

  function transform(action) {
    pushHistory();
    const source = compositeCanvas();
    const rotate = action.startsWith("rotate");
    const output = makeCanvas(rotate ? source.height : source.width, rotate ? source.width : source.height);
    const ctx = output.getContext("2d");
    ctx.translate(output.width / 2, output.height / 2);
    if (action === "rotate-left") ctx.rotate(-Math.PI / 2);
    if (action === "rotate-right") ctx.rotate(Math.PI / 2);
    if (action === "flip-x") ctx.scale(-1, 1);
    if (action === "flip-y") ctx.scale(1, -1);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    replaceWorking(output); render();
  }

  function applyCrop() {
    if (!state.cropRect || state.cropRect.width < 2 || state.cropRect.height < 2) return notify("请先在图片上拖动裁剪范围");
    pushHistory();
    const source = compositeCanvas();
    const rect = state.cropRect;
    const output = makeCanvas(rect.width, rect.height);
    output.getContext("2d").drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
    replaceWorking(output); render();
  }

  function updateGeometryPreview() {
    const source = compositeCanvas();
    const output = makeCanvas(source.width, source.height);
    const ctx = output.getContext("2d");
    ctx.translate(output.width / 2, output.height / 2);
    ctx.rotate(state.straighten * Math.PI / 180);
    ctx.transform(1, state.perspectiveY / 180, state.perspectiveX / 180, 1, 0, 0);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    state.preview = output; state.previewIncludesMarkup = true; render();
  }

  function applyGeometry() {
    if (!state.preview) return notify("请先调整拉直或透视");
    pushHistory(); replaceWorking(copyCanvas(state.preview));
    state.straighten = 0; state.perspectiveX = 0; state.perspectiveY = 0;
    overlay.querySelectorAll("[data-basic-geometry]").forEach((input) => { input.value = 0; });
    render();
  }

  async function buildAdjustedPreview(adjustments) {
    const pixels = await runWorker(adjustments);
    const canvas = makeCanvas(state.working.width, state.working.height);
    canvas.getContext("2d").putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
    return canvas;
  }

  function schedulePreview(type) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const revision = ++state.previewRevision;
      const adjustments = type === "filter" ? scaledFilterAdjustments() : state.adjustments;
      try {
        const preview = await buildAdjustedPreview(adjustments);
        if (!state.open || revision !== state.previewRevision) return;
        state.preview = preview;
        state.previewIncludesMarkup = false;
        render();
      } catch (error) { notify(error.message || "预览失败"); }
    }, 120);
  }

  function scaledFilterAdjustments() {
    const preset = FILTERS.find(([id]) => id === state.filter)?.[2] || {};
    const amount = state.filterStrength / 100;
    return Object.fromEntries(Object.entries(preset).map(([key, value]) => [key, value * amount]));
  }

  function applyPreview(label) {
    if (!state.preview) return notify(`请先选择${label}`);
    pushHistory();
    state.working = copyCanvas(state.preview);
    state.preview = null; state.previewIncludesMarkup = false;
    if (label === "调整参数") {
      state.adjustments = Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0]));
      const input = overlay.querySelector("[data-basic-adjustment]");
      if (input) { input.value = 0; overlay.querySelector("[data-basic-adjust-value]").value = 0; }
    }
    render();
  }

  function resizeImage() {
    const width = clamp(Math.round(state.resizeWidth), 1, 16384);
    const height = clamp(Math.round(state.resizeHeight), 1, 16384);
    if (!width || !height) return notify("请输入有效尺寸");
    pushHistory();
    const source = compositeCanvas(); const output = makeCanvas(width, height); const ctx = output.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(source, 0, 0, width, height);
    replaceWorking(output); render();
  }

  async function save() {
    setBusy(true);
    try {
      let output = compositeCanvas();
      const quality = state.outputQuality / 100;
      if (state.outputFormat === "image/jpeg") {
        const flattened = makeCanvas(output.width, output.height);
        const context = flattened.getContext("2d");
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, flattened.width, flattened.height); context.drawImage(output, 0, 0);
        output = flattened;
      }
      const dataUrl = output.toDataURL(state.outputFormat, quality);
      await onCommit?.({ dataUrl, title: "基础编辑结果", mode: "basic", selected: state.selected, width: output.width, height: output.height, format: state.outputFormat, quality: state.outputQuality });
      state.dirty = false;
      close(true);
    } finally { setBusy(false); }
  }

  function command(value) {
    if (value === "close") close();
    if (value === "undo") undo();
    if (value === "redo") redo();
    if (value === "save") save();
  }

  function action(value) {
    if (["rotate-left", "rotate-right", "flip-x", "flip-y"].includes(value)) transform(value);
    if (value === "apply-crop") applyCrop();
    if (value === "apply-geometry") applyGeometry();
    if (value === "auto-adjust") { state.adjustments = { ...state.adjustments, exposure: 9, contrast: 8, highlights: -18, shadows: 20, saturation: 6, temperature: 3, clarity: 8, sharpen: 10 }; schedulePreview("adjust"); }
    if (value === "apply-adjust") applyPreview("调整参数");
    if (value === "apply-filter") applyPreview("滤镜");
    if (value === "resize") resizeImage();
  }

  function bindEvents() {
    overlay.addEventListener("click", (event) => {
      const category = event.target.closest("[data-basic-category]")?.dataset.basicCategory;
      if (category) { state.category = category; state.previewRevision += 1; state.preview = null; state.previewIncludesMarkup = false; render(); return; }
      const commandValue = event.target.closest("[data-basic-command]")?.dataset.basicCommand;
      if (commandValue) { command(commandValue); return; }
      const actionValue = event.target.closest("[data-basic-action]")?.dataset.basicAction;
      if (actionValue) { action(actionValue); return; }
      const ratio = event.target.closest("[data-basic-ratio]")?.dataset.basicRatio;
      if (ratio) { state.ratio = ratio; state.cropRect = null; render(); return; }
      const adjustment = event.target.closest("[data-basic-adjust-select]")?.dataset.basicAdjustSelect;
      if (adjustment) {
        const input = overlay.querySelector("[data-basic-adjustment]"); input.dataset.basicAdjustment = adjustment; input.value = state.adjustments[adjustment];
        overlay.querySelector("[data-basic-adjust-label]").textContent = ADJUSTMENTS.find(([id]) => id === adjustment)?.[1] || adjustment;
        overlay.querySelector("[data-basic-adjust-value]").value = state.adjustments[adjustment]; return;
      }
      const filter = event.target.closest("[data-basic-filter]")?.dataset.basicFilter;
      if (filter) { state.filter = filter; schedulePreview("filter"); render(); return; }
      const markup = event.target.closest("[data-basic-markup]")?.dataset.basicMarkup;
      if (markup) { state.markupTool = markup; render(); }
    });
    overlay.addEventListener("input", (event) => {
      if (event.target.matches("[data-basic-adjustment]")) { const key = event.target.dataset.basicAdjustment; state.adjustments[key] = Number(event.target.value); overlay.querySelector("[data-basic-adjust-value]").value = event.target.value; schedulePreview("adjust"); }
      if (event.target.matches("[data-basic-filter-strength]")) { state.filterStrength = Number(event.target.value); overlay.querySelector("[data-basic-filter-value]").value = event.target.value; schedulePreview("filter"); }
      if (event.target.matches("[data-basic-geometry]")) { const key = event.target.dataset.basicGeometry; state[key] = Number(event.target.value); overlay.querySelector(`[data-basic-geometry-output="${key}"]`).value = key === "straighten" ? `${event.target.value}°` : event.target.value; updateGeometryPreview(); }
      if (event.target.matches("[data-basic-color]")) state.markupColor = event.target.value;
      if (event.target.matches("[data-basic-markup-size]")) state.markupSize = Number(event.target.value);
      if (event.target.matches("[data-basic-text]")) state.text = event.target.value;
      if (event.target.matches("[data-basic-width]")) state.resizeWidth = Number(event.target.value);
      if (event.target.matches("[data-basic-height]")) state.resizeHeight = Number(event.target.value);
      if (event.target.matches("[data-basic-format]")) state.outputFormat = event.target.value;
      if (event.target.matches("[data-basic-quality]")) { state.outputQuality = Number(event.target.value); overlay.querySelector("[data-basic-quality-value]").value = `${event.target.value}%`; }
    });
    const canvas = overlay.querySelector("[data-basic-canvas]");
    canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("dblclick", () => { state.zoom = 1; state.panX = 0; state.panY = 0; render(); });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    const stage = overlay.querySelector("[data-basic-stage]");
    stage.addEventListener("pointerdown", (event) => { if (event.pointerType !== "mouse" && state.category !== "crop" && state.category !== "markup") { clearTimeout(stage._compareTimer); stage._compareStart = { x: event.clientX, y: event.clientY }; stage._compareTimer = setTimeout(() => { state.compare = true; render(); }, 420); } });
    stage.addEventListener("pointermove", (event) => { const start = stage._compareStart; if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) clearTimeout(stage._compareTimer); });
    ["pointerup", "pointercancel", "pointerleave"].forEach((name) => stage.addEventListener(name, () => { clearTimeout(stage._compareTimer); if (state.compare) { state.compare = false; render(); } }));
    window.addEventListener("resize", render);
  }

  async function open(selected) {
    ensureOverlay();
    if (location.protocol === "file:") throw new Error("基础编辑不能从本地文件直接打开，请使用 4178 网页地址");
    if (!selected?.url) throw new Error("没有可以编辑的图片");
    state.selected = selected; state.open = true; overlay.hidden = false; document.body.classList.add("basic-editor-open"); setBusy(true);
    try {
      const image = await loadImage(selected.url);
      const scale = image.naturalWidth * image.naturalHeight > 40_000_000 ? Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
      const source = makeCanvas(image.naturalWidth * scale, image.naturalHeight * scale); source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
      state.original = copyCanvas(source); state.working = source; state.markup = makeCanvas(source.width, source.height); state.preview = null; state.previewIncludesMarkup = false;
      state.category = "crop"; state.ratio = "free"; state.cropRect = null; state.zoom = 1; state.panX = 0; state.panY = 0; state.history = []; state.future = []; state.dirty = false; state.previewRevision += 1; state.pointers.clear(); state.adjustments = Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])); state.filter = "original"; state.resizeWidth = source.width; state.resizeHeight = source.height;
      overlay.querySelector("[data-basic-width]").value = source.width; overlay.querySelector("[data-basic-height]").value = source.height;
      overlay.querySelectorAll("[data-basic-filter] i").forEach((thumbnail) => { thumbnail.style.backgroundImage = `url(${JSON.stringify(selected.url)})`; });
      requestAnimationFrame(render);
    } catch (error) {
      notify(error.message || "基础编辑打开失败");
      throw error;
    } finally { setBusy(false); render(); }
  }

  function close(force = false) {
    if (!overlay) return;
    if (!force && state.open && state.dirty && !globalThis.confirm("还有未保存的修改，确定退出吗？")) return;
    clearTimeout(previewTimer); state.previewRevision += 1; overlay.hidden = true; state.open = false; state.pointers.clear(); state.gesture = null; document.body.classList.remove("basic-editor-open");
  }

  return { open, close, state };
}
