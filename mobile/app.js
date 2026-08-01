const CapacitorRuntime = globalThis.Capacitor || {};
const Plugins = CapacitorRuntime.Plugins || {};
const isNative = Boolean(CapacitorRuntime.isNativePlatform?.());

const tools = [
  { id: "custom", name: "自定义生图", desc: "自由描述设计目标", prompt: "根据输入图片和设计要求生成专业建筑空间效果图" },
  { id: "plan-axonometric", name: "平面图转彩平", desc: "保留格局，生成彩色平面图", prompt: "把输入平面图转换成专业彩色平面图，严格保持墙体、门窗、功能分区和家具位置" },
  { id: "plan-axonometric-view", name: "彩平转轴测图", desc: "生成清晰空间轴测图", prompt: "把输入彩色平面图转换成高精度建筑轴测图，保持房间关系、墙体开口、家具和材质分区" },
  { id: "plan-render", name: "轴测图转效果图", desc: "从空间图生成实景效果", prompt: "把输入轴测图转换成真实室内效果图，保持空间结构、开口、动线和主要家具关系" },
  { id: "design-derivation", name: "设计推导", desc: "推导材料、灯光和空间方向", prompt: "依据输入空间进行设计推导，形成具有完整材料、灯光、色彩和空间秩序的效果图" },
  { id: "designseries", name: "生成设计系列", desc: "统一语言生成系列图", prompt: "依据输入与参考图片建立统一设计语言，生成同一项目的专业设计系列画面" },
  { id: "photo", name: "现场图转效果图", desc: "拍摄现场直接改造", prompt: "把现场照片改造成可落地的专业空间效果图，严格保持原始结构、视角、门窗和空间尺度" },
  { id: "whitemodel", name: "白模润色", desc: "白模生成真实材质效果", prompt: "把白模图片润色为真实建筑效果图，保持几何结构和相机视角，补充可信材质与灯光" },
  { id: "panorama", name: "全景图生成", desc: "生成2:1全景空间图", prompt: "生成完整连续的2:1等距柱状全景空间效果图，左右边缘无缝衔接" },
  { id: "sketch", name: "手稿生成实景", desc: "保留设计线稿关系", prompt: "把设计手稿转换为真实建筑空间效果图，保持草图表达的构图、结构和核心设计元素" },
  { id: "materialreplace", name: "材质替换", desc: "更换墙地顶或家具材质", prompt: "替换用户指定区域或对象的材质，保持结构、形状、光影和其他区域不变" },
  { id: "lightingadjust", name: "灯光调整", desc: "修改时间和灯光氛围", prompt: "调整空间灯光与时间氛围，保持空间结构、材质和物体位置不变" },
  { id: "styletransfer", name: "风格迁移", desc: "嫁接参考图设计风格", prompt: "把参考图的材料、色彩、灯光和设计语言迁移到输入空间，严格保持输入空间结构和视角" },
  { id: "remove", name: "局部消除", desc: "涂抹后自然移除物体", prompt: "移除选中区域内的物体并自然重建背景，保持未选区域完全不变", edit: true },
  { id: "replace", name: "局部替换", desc: "涂抹后替换指定内容", prompt: "只替换选中区域内容，保持未选区域、构图、视角和光影不变", edit: true },
  { id: "outpaint", name: "智能扩图", desc: "延伸画面和空间", prompt: "自然扩展输入图片边界，延续原有空间、材质、透视和光影" },
  { id: "cutout", name: "智能抠图", desc: "提取建筑或物体主体", prompt: "准确提取主要建筑、家具或物体主体，输出干净透明背景图片" },
  { id: "detail", name: "细节增强", desc: "增强材料与施工细节", prompt: "增强图片的材料纹理、边缘、接缝和真实细节，保持原始设计不变" },
  { id: "upscale", name: "清晰放大", desc: "提升分辨率与清晰度", prompt: "提高图片清晰度和分辨率，修复压缩细节，保持原始画面内容不变" },
  { id: "sharpen", name: "智能锐化", desc: "修复轻微模糊", prompt: "自然修复图片轻微模糊，增强合理边缘，不产生过度锐化和光晕" },
  { id: "colorgrade", name: "专业调色", desc: "统一色彩和质感", prompt: "对图片进行专业建筑摄影调色，统一白平衡、层次和色彩，保持设计内容不变" },
  { id: "multiangle", name: "多角度生成", desc: "同一空间生成其他机位", prompt: "依据输入图生成同一空间的全新合理机位，保持设计、材料、尺度和空间关系一致" }
];

const styles = ["不限定", "现代简约", "奶油风", "侘寂风", "新中式", "工业风", "自然原木", "轻奢风", "北欧风", "日式", "东方禅意", "度假民宿风", "艺术展厅风", "品牌零售风"];
const referenceRoles = ["自动判断", "空间结构", "设计风格", "材料色彩", "灯光氛围", "家具陈设"];
const state = {
  page: "home",
  tool: tools[6],
  selectedStyle: "不限定",
  maskDataUrl: "",
  primary: null,
  references: [],
  currentProjectId: null,
  projects: [],
  assets: [],
  tasks: [],
  settings: { fhlKey: "", yybbKey: "", aiwanwuKey: "" },
  providerConfig: null,
  selectedAssetId: null,
  panoramaViewer: null,
  taskPayloads: new Map(),
  objectUrls: new Map()
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const els = {
  pages: $$(".page"), navs: $$("[data-nav]"), toolGrid: $("#toolGrid"),
  projectList: $("#projectList"), taskList: $("#taskList"), taskBadge: $("#taskBadge"),
  composer: $("#composerDialog"), composerTitle: $("#composerTitle"), primaryPreview: $("#primaryPreview"),
  referencePreviews: $("#referencePreviews"), referenceCount: $("#referenceCount"), styleChips: $("#styleChips"),
  prompt: $("#promptInput"), structure: $("#structureSelect"), ratio: $("#ratioSelect"), strategy: $("#strategyContent"),
  maskControls: $("#maskEditorControls"), maskBrush: $("#maskBrushSize"), clearMask: $("#clearMaskButton"),
  angleControls: $("#angleControls"), yaw: $("#yawRange"), pitch: $("#pitchRange"), yawValue: $("#yawValue"), pitchValue: $("#pitchValue"),
  generate: $("#generateButton"), galleryPrimary: $("#galleryPrimaryInput"), galleryReference: $("#galleryReferenceInput"),
  settingsForm: $("#settingsForm"), fhlKey: $("#fhlKey"), yybbKey: $("#yybbKey"), aiwanwuKey: $("#aiwanwuKey"), settingsStatus: $("#settingsStatus"),
  projectDialog: $("#projectDialog"), projectDialogTitle: $("#projectDialogTitle"), projectTimeline: $("#projectTimeline"),
  imageDialog: $("#imageDialog"), imageDialogImage: $("#imageDialogImage"), panorama: $("#panoramaViewer"),
  compareDialog: $("#compareDialog"), compareOriginal: $("#compareOriginal"), compareResult: $("#compareResult"), toast: $("#toast")
};

function id(prefix) { return `${prefix}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`; }
function escapeHtml(value = "") { const el = document.createElement("span"); el.textContent = String(value); return el.innerHTML; }
function formatTime(value) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function toast(message) { els.toast.textContent = message; els.toast.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2400); }

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("laogui-mobile", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets", { keyPath: "id" });
      if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

function assetUrl(asset) {
  if (!asset) return "";
  if (asset.blob) {
    if (!state.objectUrls.has(asset.id)) state.objectUrls.set(asset.id, URL.createObjectURL(asset.blob));
    return state.objectUrls.get(asset.id);
  }
  return asset.dataUrl || asset.webPath || asset.uri || "";
}

async function secureSet(settings) {
  if (Plugins.LaoguiNative?.saveSecrets) return Plugins.LaoguiNative.saveSecrets(settings);
  if (Plugins.Preferences?.set) return Plugins.Preferences.set({ key: "laogui-mobile-settings", value: JSON.stringify(settings) });
  localStorage.setItem("laogui-mobile-settings", JSON.stringify(settings));
}

async function secureGet() {
  try {
    if (Plugins.LaoguiNative?.loadSecrets) return (await Plugins.LaoguiNative.loadSecrets()).value || {};
    if (Plugins.Preferences?.get) {
      const result = await Plugins.Preferences.get({ key: "laogui-mobile-settings" });
      return result.value ? JSON.parse(result.value) : {};
    }
    return JSON.parse(localStorage.getItem("laogui-mobile-settings") || "{}");
  } catch { return {}; }
}

async function ensureProject() {
  let project = state.projects.find((item) => item.id === state.currentProjectId);
  if (project) return project;
  const now = new Date();
  project = { id: id("project"), name: `${now.toLocaleDateString("zh-CN").replaceAll("/", "-")} ${state.tool.name}`, createdAt: now.toISOString(), updatedAt: now.toISOString(), coverAssetId: null };
  state.projects.unshift(project);
  state.currentProjectId = project.id;
  await dbPut("projects", project);
  renderProjects();
  return project;
}

async function dataUrlToBlob(dataUrl) { return fetch(dataUrl).then((response) => response.blob()); }
function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }

function imageSizeForRatio(value = "auto") {
  return ({ "1:1": "1024x1024", "3:4": "1024x1536", "4:5": "1024x1536", "16:9": "1536x1024", "2:1": "1536x1024" })[value] || "auto";
}

async function compressDataUrl(dataUrl, maxEdge = 2048, quality = .9) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function saveToGallery(dataUrl, projectName, fileName) {
  if (Plugins.LaoguiNative?.saveImage) return Plugins.LaoguiNative.saveImage({ dataUrl, projectName, fileName });
  return { uri: "", webPath: dataUrl };
}

async function addAsset({ dataUrl, name, kind, mode = state.tool.id, parentId = null, prompt = "", projectId = null }) {
  const project = state.projects.find((item) => item.id === projectId) || await ensureProject();
  const safeName = name || `${kind}-${Date.now()}.jpg`;
  const saved = await saveToGallery(dataUrl, project.name, safeName).catch(() => ({ uri: "" }));
  const asset = {
    id: id("asset"), projectId: project.id, kind, mode, parentId, name: safeName,
    blob: await dataUrlToBlob(dataUrl), uri: saved.uri || "", webPath: saved.webPath || "",
    prompt, createdAt: new Date().toISOString()
  };
  state.assets.push(asset);
  project.updatedAt = asset.createdAt;
  if (!project.coverAssetId || ["generated", "edited"].includes(kind)) project.coverAssetId = asset.id;
  await Promise.all([dbPut("assets", asset), dbPut("projects", project)]);
  renderProjects();
  return asset;
}

async function captureImage(kind) {
  if (!Plugins.Camera?.getPhoto) {
    (kind === "primary" ? els.galleryPrimary : els.galleryReference).click();
    return;
  }
  try {
    const photo = await Plugins.Camera.getPhoto({ quality: 92, allowEditing: false, resultType: "dataUrl", source: "CAMERA", correctOrientation: true, saveToGallery: false });
    if (!photo.dataUrl) throw new Error("没有读取到照片");
    await acceptImages([await dataUrlToBlob(photo.dataUrl)], kind, { cameraDataUrl: photo.dataUrl });
  } catch (error) {
    if (!/cancel/i.test(error.message || "")) toast(error.message || "相机打开失败");
  }
}

async function acceptImages(files, kind, options = {}) {
  if (kind === "reference" && state.references.length >= 8) return toast("参考图最多8张");
  for (const [index, file] of [...files].entries()) {
    if (!file.type?.startsWith("image/") && !options.cameraDataUrl) continue;
    const raw = options.cameraDataUrl && index === 0 ? options.cameraDataUrl : await blobToDataUrl(file);
    const dataUrl = await compressDataUrl(raw);
    const name = file.name || `现场拍摄-${Date.now()}.jpg`;
    if (kind === "primary") {
      const saved = await addAsset({ dataUrl: raw, name, kind: "source" });
      state.primary = { dataUrl, name, assetId: saved.id };
      break;
    }
    if (state.references.length >= 8) break;
    const saved = await addAsset({ dataUrl: raw, name, kind: "reference" });
    state.references.push({ dataUrl, name, assetId: saved.id, role: "自动判断" });
  }
  renderComposer();
}

function renderTools() {
  els.toolGrid.innerHTML = tools.map((tool) => `<button class="tool-card" data-tool="${tool.id}"><span class="tool-icon"><svg><use href="#${tool.edit ? "i-edit" : "i-spark"}"/></svg></span><strong>${escapeHtml(tool.name)}</strong><span>${escapeHtml(tool.desc)}</span></button>`).join("");
}

function navigate(page) {
  state.page = page;
  els.pages.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  els.navs.forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openComposer(tool = state.tool, { asset = null } = {}) {
  state.tool = tool;
  state.selectedStyle = "不限定";
  state.references = [];
  state.primary = asset ? { dataUrl: asset._dataUrl || assetUrl(asset), name: asset.name, assetId: asset.id } : null;
  state.maskDataUrl = "";
  state.currentProjectId = asset?.projectId || null;
  els.prompt.value = "";
  els.ratio.value = tool.id === "panorama" ? "2:1" : "auto";
  renderComposer();
  els.composer.showModal();
}

function strategyMarkup() {
  const style = state.selectedStyle === "不限定" ? "根据参考图和现场判断" : state.selectedStyle;
  return [
    ["空间策略", state.tool.id.includes("plan") ? "保持图纸结构、功能关系和主要动线，避免擅自改格局。" : "先保留现场结构和尺度，再优化视觉焦点与空间层次。"],
    ["材料策略", `${style}方向，控制主材料数量，强调真实纹理、收口和施工可信度。`],
    ["灯光策略", "保留自然采光逻辑，增加柔和环境光与少量重点照明，避免过曝。"]
  ].map(([title, text]) => `<article><strong>${title}</strong><p>${text}</p></article>`).join("");
}

function renderComposer() {
  els.composerTitle.textContent = state.tool.name;
  els.primaryPreview.classList.toggle("empty", !state.primary);
  els.primaryPreview.classList.toggle("mask-mode", Boolean(state.primary && state.tool.edit));
  els.primaryPreview.innerHTML = state.primary ? `<img src="${state.primary.dataUrl}" alt="已选择底图">${state.tool.edit ? '<canvas id="maskDrawCanvas" aria-label="手指涂抹编辑选区"></canvas>' : ""}` : "<span>添加现场图、图纸、白模或手稿</span>";
  els.maskControls.hidden = !(state.primary && state.tool.edit);
  els.referencePreviews.innerHTML = state.references.map((item, index) => `<div class="reference-thumb"><img src="${item.dataUrl}" alt="参考图 ${index + 1}"><button data-remove-reference="${index}" aria-label="删除参考图"><svg><use href="#i-close"/></svg></button><button class="reference-role" data-reference-role="${index}" title="点击切换参考内容">${escapeHtml(item.role || "自动判断")}</button></div>`).join("");
  els.referenceCount.textContent = `${state.references.length} / 8`;
  els.styleChips.innerHTML = styles.map((style) => `<button class="${style === state.selectedStyle ? "active" : ""}" data-style="${style}">${style}</button>`).join("");
  els.strategy.innerHTML = strategyMarkup();
  els.angleControls.hidden = !["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(state.tool.id);
  els.generate.innerHTML = `<svg><use href="#i-spark"/></svg>${state.tool.id === "designseries" ? "生成4张设计系列" : "生成1张图片"}`;
  if (state.primary && state.tool.edit) requestAnimationFrame(setupMaskEditor);
}

function setupMaskEditor() {
  const canvas = $("#maskDrawCanvas");
  const image = $("img", els.primaryPreview);
  if (!canvas || !image) return;
  const initialize = () => {
    canvas.width = Math.max(1, image.naturalWidth || 1024);
    canvas.height = Math.max(1, image.naturalHeight || 1024);
    const visible = canvas.getContext("2d");
    const mask = document.createElement("canvas");
    mask.width = canvas.width; mask.height = canvas.height;
    const maskContext = mask.getContext("2d");
    maskContext.fillStyle = "#000";
    maskContext.fillRect(0, 0, mask.width, mask.height);
    let drawing = false;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
    };
    const draw = (event) => {
      if (!drawing) return;
      const { x, y } = point(event);
      const radius = Number(els.maskBrush.value || 48) * canvas.width / Math.max(canvas.clientWidth, 1) / 2;
      visible.fillStyle = "rgba(226, 185, 70, .48)";
      visible.beginPath(); visible.arc(x, y, radius, 0, Math.PI * 2); visible.fill();
      maskContext.globalCompositeOperation = "destination-out";
      maskContext.beginPath(); maskContext.arc(x, y, radius, 0, Math.PI * 2); maskContext.fill();
      state.maskDataUrl = mask.toDataURL("image/png");
    };
    canvas.addEventListener("pointerdown", (event) => { drawing = true; canvas.setPointerCapture(event.pointerId); draw(event); });
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", () => { drawing = false; });
    canvas.addEventListener("pointercancel", () => { drawing = false; });
    els.clearMask.onclick = () => { visible.clearRect(0, 0, canvas.width, canvas.height); maskContext.globalCompositeOperation = "source-over"; maskContext.fillStyle = "#000"; maskContext.fillRect(0, 0, mask.width, mask.height); state.maskDataUrl = ""; };
  };
  if (image.complete) initialize(); else image.addEventListener("load", initialize, { once: true });
}

function renderProjects() {
  const sorted = [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  els.projectList.innerHTML = sorted.map((project) => {
    const assets = state.assets.filter((asset) => asset.projectId === project.id);
    const cover = state.assets.find((asset) => asset.id === project.coverAssetId) || assets.at(-1);
    return `<button class="project-card" data-project="${project.id}">${cover ? `<img src="${assetUrl(cover)}" alt="${escapeHtml(project.name)}封面" loading="lazy">` : "<span class=\"project-placeholder\"></span>"}<div><strong>${escapeHtml(project.name)}</strong><p>${assets.length} 张图片</p><small>${formatTime(project.updatedAt)}</small></div></button>`;
  }).join("");
}

function renderTasks() {
  const sorted = [...state.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const statusText = (task) => task.status === "running" ? "正在生成，请保持网络连接" : task.status === "success" ? `生成完成并已保存${task.provider ? ` · ${task.provider.toUpperCase()}` : ""}` : task.status === "uncertain" ? "网络中断，状态未知；为避免重复扣费，没有自动重试" : task.error || "生成失败";
  els.taskList.innerHTML = sorted.map((task) => `<article class="task-card"><span class="task-state ${task.status}"><svg><use href="#${task.status === "success" ? "i-check" : task.status === "failed" ? "i-close" : "i-spark"}"/></svg></span><div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(statusText(task))}</p><small>${formatTime(task.createdAt)}</small></div></article>`).join("");
  els.taskBadge.hidden = !state.tasks.some((task) => task.status === "running");
}

function renderSettings() {
  els.fhlKey.value = state.settings.fhlKey || "";
  els.yybbKey.value = state.settings.yybbKey || "";
  els.aiwanwuKey.value = state.settings.aiwanwuKey || "";
}

function openProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.currentProjectId = project.id;
  els.projectDialogTitle.textContent = project.name;
  const assets = state.assets.filter((asset) => asset.projectId === project.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  els.projectTimeline.innerHTML = assets.map((asset) => `<article class="timeline-card"><button data-preview-asset="${asset.id}" style="all:unset;display:block;width:100%;cursor:pointer"><img src="${assetUrl(asset)}" alt="${escapeHtml(asset.name)}" loading="lazy"></button><div class="timeline-card-copy"><strong>${escapeHtml(asset.name)}</strong><p>${escapeHtml(tools.find((item) => item.id === asset.mode)?.name || ({ source: "现场原图", reference: "参考图", edited: "AI编辑结果" }[asset.kind] || "生成图片"))} · ${formatTime(asset.createdAt)}</p></div><div class="timeline-card-actions"><button data-asset-action="edit" data-asset-id="${asset.id}">AI编辑</button><button data-asset-action="reuse" data-asset-id="${asset.id}">继续生成</button><button data-asset-action="share" data-asset-id="${asset.id}">分享</button></div></article>`).join("") || "<div class=\"empty-state\"></div>";
  els.projectDialog.showModal();
}

function buildPrompt() {
  const style = state.selectedStyle === "不限定" ? "" : `目标风格：${state.selectedStyle}。`;
  const strength = { high: "严格保持输入图片的结构、视角、尺度、门窗和主要物体位置。", medium: "保持主要结构与空间关系，允许优化局部设计。", creative: "保持可识别的空间基础，允许更明显的概念设计发挥。" }[els.structure.value];
  const user = els.prompt.value.trim();
  const references = state.references.length ? `参考图使用说明：${state.references.map((item, index) => `第${index + 1}张重点参考${item.role || "自动判断"}`).join("；")}。` : "";
  const angle = ["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(state.tool.id) ? `目标视角：水平旋转${els.yaw.value}度，俯视角${els.pitch.value}度。` : "";
  return [state.tool.prompt, style, strength, references, angle, user, "输出专业、真实、可落地的建筑设计图片。画面中不要出现人物、动物、文字、水印或标志。"].filter(Boolean).join("\n");
}

async function createTask() {
  if (!state.primary && !["custom", "design-derivation"].includes(state.tool.id)) return toast("请先添加底图");
  if (state.tool.edit && !state.maskDataUrl) return toast("请先用手指涂抹需要编辑的位置");
  if (![state.settings.fhlKey, state.settings.yybbKey, state.settings.aiwanwuKey].some(Boolean)) { navigate("settings"); els.composer.close(); return toast("请至少填写一套API密钥"); }
  if (!state.providerConfig) return toast("手机版生图配置读取失败，请重新安装最新版");
  if (Plugins.Network?.getStatus && !(await Plugins.Network.getStatus()).connected) return toast("当前没有网络，请联网后再生成");
  if (!Plugins.LaoguiNative?.generateImage) return toast("直接生图只能在安卓安装包中使用");
  const task = { id: id("task"), requestId: crypto.randomUUID(), title: state.tool.name, mode: state.tool.id, projectId: (await ensureProject()).id, status: "running", createdAt: new Date().toISOString(), error: "" };
  state.taskPayloads.set(task.id, {
    prompt: buildPrompt(), size: els.ratio.value, count: state.tool.id === "designseries" ? 4 : 1,
    primaryImage: state.primary?.dataUrl || "", maskImage: state.maskDataUrl || "",
    referenceImages: state.references.map((item) => item.dataUrl), parentId: state.primary?.assetId || null,
    keys: { fhl: state.settings.fhlKey, yybb: state.settings.yybbKey, aiwanwu: state.settings.aiwanwuKey }
  });
  state.tasks.push(task);
  await dbPut("tasks", task);
  renderTasks();
  els.composer.close();
  navigate("tasks");
  navigator.vibrate?.(12);
  runTask(task).catch(() => {});
}

async function runTask(task) {
  const payload = state.taskPayloads.get(task.id);
  try {
    if (!payload) throw new Error("本次任务数据已丢失，请重新提交");
    const result = await Plugins.LaoguiNative.generateImage({
      requestId: task.requestId,
      prompt: payload.prompt,
      size: imageSizeForRatio(payload.size),
      count: payload.count,
      inputImages: [payload.primaryImage, ...payload.referenceImages].filter(Boolean),
      maskImage: payload.maskImage,
      keys: payload.keys,
      model: state.providerConfig.model,
      endpoints: state.providerConfig.endpoints,
      providers: state.providerConfig.providers
    });
    const images = result.imageDataUrls?.length ? result.imageDataUrls : result.imageDataUrl ? [result.imageDataUrl] : [];
    if (!images.length) throw new Error("接口没有返回图片");
    let asset = null;
    for (const [index, imageDataUrl] of images.entries()) {
      asset = await addAsset({ dataUrl: imageDataUrl, name: `${task.title}-${Date.now()}-${index + 1}.png`, kind: task.mode === "remove" || task.mode === "replace" ? "edited" : "generated", mode: task.mode, parentId: payload.parentId, prompt: payload.prompt, projectId: task.projectId });
    }
    task.status = "success";
    task.assetId = asset.id;
    task.provider = result.provider || "";
    navigator.vibrate?.([18, 40, 18]);
  } catch (error) {
    task.status = error.code === "REQUEST_UNCERTAIN" || error.data?.uncertain ? "uncertain" : "failed";
    task.error = error.message || "生成失败";
  }
  await dbPut("tasks", task);
  state.taskPayloads.delete(task.id);
  renderTasks();
  renderProjects();
}

async function handleAssetAction(action, assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  if (action === "share") {
    if (Plugins.Share?.share && asset.uri) await Plugins.Share.share({ title: asset.name, url: asset.uri, dialogTitle: "分享设计图片" });
    else toast("当前环境暂不支持系统分享");
    return;
  }
  if (action === "compare") {
    const original = state.assets.find((item) => item.id === asset.parentId) || state.assets.find((item) => item.projectId === asset.projectId && item.kind === "source");
    if (!original) return toast("这个结果没有找到可对比的原图");
    els.compareOriginal.src = assetUrl(original);
    els.compareResult.src = assetUrl(asset);
    els.imageDialog.close();
    els.compareDialog.showModal();
    return;
  }
  els.projectDialog.close();
  const dataUrl = asset.blob ? await blobToDataUrl(asset.blob) : asset.dataUrl || asset.webPath || asset.uri;
  openComposer(action === "edit" ? tools.find((tool) => tool.id === "replace") : tools.find((tool) => tool.id === "custom"), { asset: { ...asset, _dataUrl: dataUrl } });
}

async function saveSettings(event) {
  event.preventDefault();
  const next = { fhlKey: els.fhlKey.value.trim(), yybbKey: els.yybbKey.value.trim(), aiwanwuKey: els.aiwanwuKey.value.trim() };
  els.settingsStatus.className = "form-status";
  if (![next.fhlKey, next.yybbKey, next.aiwanwuKey].some(Boolean)) { els.settingsStatus.textContent = "请至少填写一套API密钥"; els.settingsStatus.classList.add("error"); return; }
  state.settings = next;
  await secureSet(next);
  els.settingsStatus.textContent = "保存成功，生图时会直接连接接口";
  els.settingsStatus.classList.add("success");
}

function bindEvents() {
  els.navs.forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  document.addEventListener("click", (event) => {
    const toolButton = event.target.closest("[data-tool]");
    if (toolButton) openComposer(tools.find((tool) => tool.id === toolButton.dataset.tool));
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.preventDefault();
      const action = actionButton.dataset.action;
      if (action === "quick-camera") { openComposer(tools.find((tool) => tool.id === "photo")); setTimeout(() => captureImage("primary"), 120); }
      if (action === "quick-gallery") { openComposer(tools.find((tool) => tool.id === "photo")); setTimeout(() => els.galleryPrimary.click(), 120); }
      if (action === "camera-primary") captureImage("primary");
      if (action === "gallery-primary") els.galleryPrimary.click();
      if (action === "camera-reference") captureImage("reference");
      if (action === "gallery-reference") els.galleryReference.click();
      if (action === "new-project") { state.currentProjectId = null; openComposer(tools.find((tool) => tool.id === "custom")); }
    }
    const styleButton = event.target.closest("[data-style]");
    if (styleButton) { state.selectedStyle = styleButton.dataset.style; renderComposer(); }
    const removeButton = event.target.closest("[data-remove-reference]");
    if (removeButton) { state.references.splice(Number(removeButton.dataset.removeReference), 1); renderComposer(); }
    const roleButton = event.target.closest("[data-reference-role]");
    if (roleButton) {
      const reference = state.references[Number(roleButton.dataset.referenceRole)];
      if (reference) reference.role = referenceRoles[(referenceRoles.indexOf(reference.role || "自动判断") + 1) % referenceRoles.length];
      renderComposer();
    }
    const projectButton = event.target.closest("[data-project]");
    if (projectButton) openProject(projectButton.dataset.project);
    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      const asset = state.assets.find((item) => item.id === previewButton.dataset.previewAsset);
      state.selectedAssetId = asset?.id || null;
      const url = assetUrl(asset);
      const isPanorama = asset?.mode === "panorama";
      els.imageDialogImage.hidden = isPanorama;
      els.panorama.hidden = !isPanorama;
      if (isPanorama && globalThis.pannellum) {
        state.panoramaViewer?.destroy?.();
        state.panoramaViewer = globalThis.pannellum.viewer(els.panorama, { type: "equirectangular", panorama: url, autoLoad: true, showControls: true, compass: false });
      } else {
        els.imageDialogImage.src = url;
      }
      els.imageDialog.showModal();
    }
    const assetAction = event.target.closest("[data-asset-action]");
    if (assetAction) handleAssetAction(assetAction.dataset.assetAction, assetAction.dataset.assetId);
  });
  els.galleryPrimary.addEventListener("change", () => acceptImages(els.galleryPrimary.files, "primary").finally(() => { els.galleryPrimary.value = ""; }));
  els.galleryReference.addEventListener("change", () => acceptImages(els.galleryReference.files, "reference").finally(() => { els.galleryReference.value = ""; }));
  els.generate.addEventListener("click", createTask);
  els.settingsForm.addEventListener("submit", saveSettings);
  [els.yaw, els.pitch].forEach((input) => input.addEventListener("input", () => { els.yawValue.value = `${els.yaw.value}°`; els.pitchValue.value = `${els.pitch.value}°`; }));
  $$('[data-image-action]').forEach((button) => button.addEventListener("click", () => { els.imageDialog.close(); handleAssetAction(button.dataset.imageAction, state.selectedAssetId); }));
  els.imageDialog.addEventListener("close", () => { state.panoramaViewer?.destroy?.(); state.panoramaViewer = null; els.panorama.textContent = ""; });
}

async function init() {
  renderTools();
  bindEvents();
  const [projects, assets, tasks, settings, providerConfig] = await Promise.all([
    dbAll("projects"), dbAll("assets"), dbAll("tasks"), secureGet(),
    fetch("./provider-config.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("接口配置读取失败")))
  ]);
  state.projects = projects;
  state.assets = assets;
  state.tasks = tasks.map((task) => task.status === "running" ? { ...task, status: "uncertain", error: "应用在生成期间被关闭，无法确认接口是否已经完成" } : task);
  state.settings = { ...state.settings, ...settings };
  state.providerConfig = providerConfig;
  await Promise.all(state.tasks.filter((task) => task.status === "uncertain").map((task) => dbPut("tasks", task)));
  renderProjects(); renderTasks(); renderSettings(); renderComposer();
  if (![state.settings.fhlKey, state.settings.yybbKey, state.settings.aiwanwuKey].some(Boolean)) navigate("settings");
}

init().catch((error) => toast(error.message || "应用初始化失败"));
