import { parseApiConfigText, normalizeApiProfiles } from "./api-config-parser.js";
import { createAiEditor } from "./ai-edit/editor.js?v=20260812-mobile-lasso";
import { createDeepEditor } from "./deep-edit/editor.js?v=20260812-simple-crop";
import { createBasicEditor } from "./basic-editor.js?v=20260812-basic-editor-final";

const CapacitorRuntime = globalThis.Capacitor || {};
const Plugins = CapacitorRuntime.Plugins || {};
const isNative = Boolean(CapacitorRuntime.isNativePlatform?.());
document.documentElement.classList.toggle("native-runtime", isNative);

const tools = [
  { id: "custom", name: "自定义生图", desc: "自由描述设计目标", prompt: "根据输入图片和设计要求生成专业建筑空间效果图" },
  { id: "plan-axonometric", name: "平面图转彩平", desc: "保留格局，生成彩色平面图", prompt: "把输入平面图转换成专业彩色平面图，严格保持墙体、门窗、功能分区和家具位置" },
  { id: "plan-axonometric-view", name: "彩平转轴测图", desc: "生成清晰空间轴测图", prompt: "把输入彩色平面图转换成高精度建筑轴测图，保持房间关系、墙体开口、家具和材质分区" },
  { id: "plan-render", name: "轴测图转效果图", desc: "从空间图生成实景效果", prompt: "把输入轴测图转换成真实室内效果图，保持空间结构、开口、动线和主要家具关系" },
  { id: "designseries", name: "生成设计系列", desc: "统一语言生成系列图", prompt: "依据输入与参考图片建立统一设计语言，生成同一项目的专业设计系列画面" },
  { id: "photo", name: "现场图转效果图", desc: "拍摄现场直接改造", prompt: "把现场照片改造成可落地的专业空间效果图，严格保持原始结构、视角、门窗和空间尺度" },
  { id: "whitemodel", name: "白模润色", desc: "白模生成真实材质效果", prompt: "把白模图片润色为真实建筑效果图，保持几何结构和相机视角，补充可信材质与灯光" },
  { id: "sketch", name: "手稿生成实景", desc: "保留设计线稿关系", prompt: "把设计手稿转换为真实建筑空间效果图，保持草图表达的构图、结构和核心设计元素" },
  { id: "styletransfer", name: "风格迁移", desc: "嫁接参考图设计风格", prompt: "把参考图的材料、色彩、灯光和设计语言迁移到输入空间，严格保持输入空间结构和视角" }
];

const styles = ["不限定", "现代简约", "奶油风", "侘寂风", "新中式", "工业风", "自然原木", "轻奢风", "北欧风", "日式", "东方禅意", "度假民宿风", "艺术展厅风", "品牌零售风"];
const referenceRoles = ["自动判断", "空间结构", "设计风格", "材料色彩", "灯光氛围", "家具陈设"];
const toolGroupById = {
  custom: "brief",
  "plan-axonometric": "drawing", "plan-axonometric-view": "drawing", "plan-render": "drawing", whitemodel: "drawing", sketch: "drawing",
  photo: "edit", styletransfer: "edit",
  designseries: "series"
};
const CANVAS_LAYOUT_VERSION = 4;
const state = {
  page: "home",
  tool: tools[0],
  selectedStyle: "不限定",
  maskDataUrl: "",
  primary: null,
  references: [],
  currentProjectId: null,
  projects: [],
  assets: [],
  tasks: [],
  settings: { profiles: [], theme: "system" },
  resolution: "2K",
  count: 1,
  promptOptimize: true,
  selectedAssetId: null,
  panoramaViewer: null,
  taskPayloads: new Map(),
  objectUrls: new Map(),
  newResultsPending: false,
  editorZoom: 1,
  editorX: 0,
  editorY: 0,
  canvasTool: "move",
  maskHistory: [],
  maskHistoryIndex: -1,
  selection: null,
  selectedCanvasAssetId: null,
  pendingReplaceAssetId: null,
  canvas: { mode: "flow", x: 24, y: 72, zoom: 1, flowScrollTop: 0, pointers: new Map(), gesture: null },
  historyScope: "current",
  toolSelected: true,
  generationSubmitting: false,
  workbenchCollapsed: localStorage.getItem("laogui-mobile-workbench-collapsed") === "true",
  lastToolId: localStorage.getItem("laogui-mobile-last-tool") || "photo"
};
let mobileAiEditor;
let mobileDeepEditor;
let mobileBasicEditor;
let localEditorMode = "basic";
let flowScrollSaveTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const els = {
  pages: $$(".page"), navs: $$("[data-nav]"), toolGrid: $("#toolGrid"), recentProject: $("#recentProjectCard"), themeButton: $("#themeButton"),
  canvasMenuButton: $("#canvasMenuButton"), canvasMenu: $("#canvasMenu"), canvasList: $("#canvasList"), currentProjectLabel: $("#currentProjectLabel"), canvasModeSwitch: $("#canvasModeSwitch"), toolPopover: $("#toolPopover"), workspaceComposer: $("#workspaceComposer"), workspaceMenuButton: $("#workspaceMoreButton"), workspaceMenu: $("#workspaceMenu"), taskStatusButton: $("#taskStatusButton"), taskStatusPanel: $("#taskStatusPanel"), canvasTaskList: $("#canvasTaskList"), canvasZoomLabel: $("#canvasZoomLabel"), addImageMenu: $("#addImageMenu"), quickParameterPanel: $("#quickParameterPanel"), parameterSummary: $("#parameterSummary"), quickRatioChoices: $("#quickRatioChoices"), quickResolutionChoices: $("#quickResolutionChoices"), quickCountChoices: $("#quickCountChoices"), quickPromptOptimize: $("#quickPromptOptimize"),
  projectList: $("#projectList"), taskList: $("#taskList"), taskBadge: $("#taskBadge"),
  composer: $("#composerDialog"), composerTitle: $("#composerTitle"), creationWorkbench: $("#creationWorkbench"), toggleWorkbench: $("#toggleWorkbenchButton"), workbenchDetails: $("#workbenchDetails"), workbenchCollapsedSummary: $("#workbenchCollapsedSummary"), collapsedCapabilityLabel: $("#collapsedCapabilityLabel"), collapsedMediaSummary: $("#collapsedMediaSummary"), collapsedParameterSummary: $("#collapsedParameterSummary"), infiniteCanvas: $("#infiniteCanvas"), creationFeed: $("#infiniteCanvas"), emptyCanvasHint: $("#emptyCanvasHint"), canvasWorld: $("#canvasWorld"), canvasConnections: $("#canvasConnections"), canvasNodes: $("#canvasNodes"), canvasEditDock: $("#canvasEditDock"), canvasBrushControl: $("#canvasBrushControl"), applyCrop: $("#applyCropButton"), newResults: $("#newResultsButton"), openParameters: $("#openParametersButton"), selectCapability: $("#selectCapabilityButton"), selectedCapabilityLabel: $("#selectedCapabilityLabel"), quickGenerate: $("#quickGenerateButton"), workspacePrompt: $("#workspacePromptInput"), workspacePromptCount: $("#workspacePromptCount"), workbenchMediaList: $("#workbenchMediaList"), generationConfirm: $("#generationConfirmDialog"), generationConfirmContent: $("#generationConfirmContent"), browserGenerationNotice: $("#browserGenerationNotice"), confirmGenerate: $("#confirmGenerateButton"), backToEdit: $("#backToEditButton"),
  parameter: $("#parameterDialog"), parameterTitle: $("#parameterTitle"), toolSelect: $("#toolSelect"), capabilityChips: $("#capabilityChips"), apiProfileSelect: $("#apiProfileSelect"), currentApiStatus: $("#currentApiStatus"), resolutionChips: $("#resolutionChips"), countChips: $("#countChips"), promptOptimizeToggle: $("#promptOptimizeToggle"), promptCount: $("#promptCount"), requiredReferencePreviews: $("#requiredReferencePreviews"), optionalReferencePreviews: $("#optionalReferencePreviews"), requiredReferenceCount: $("#requiredReferenceCount"), optionalReferenceCount: $("#optionalReferenceCount"), primaryPreview: $("#primaryPreview"),
  referencePreviews: $("#requiredReferencePreviews"), referenceCount: $("#requiredReferenceCount"), styleChips: $("#styleChips"),
  prompt: $("#promptInput"), structure: $("#structureSelect"), ratio: $("#ratioSelect"), strategy: $("#strategyContent"),
  maskControls: $("#maskEditorControls"), maskBrush: $("#maskBrushSize"), clearMask: $("#clearMaskButton"), canvasToolHint: $("#canvasToolHint"),
  angleControls: $("#angleControls"), yaw: $("#yawRange"), pitch: $("#pitchRange"), yawValue: $("#yawValue"), pitchValue: $("#pitchValue"),
  generate: $("#generateButton"), galleryPrimary: $("#galleryPrimaryInput"), galleryReference: $("#galleryReferenceInput"), replaceImage: $("#replaceImageInput"), objectMoreDrawer: $("#objectMoreDrawer"),
  settingsForm: $("#settingsForm"), apiConfigInput: $("#apiConfigInput"), apiConfigFile: $("#apiConfigFileInput"), apiProfileList: $("#apiProfileList"), legacyConfigNotice: $("#legacyConfigNotice"), settingsStatus: $("#settingsStatus"),
  imageDialog: $("#imageDialog"), imageDialogImage: $("#imageDialogImage"), imageEditorStage: $("#imageEditorStage"), editorZoomValue: $("#editorZoomValue"), editorAssetLabel: $("#editorAssetLabel"), panorama: $("#panoramaViewer"),
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

async function dbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
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

function defaultCanvasPlacement(kind, projectId, parentId = null) {
  const existing = state.assets.filter((item) => item.projectId === projectId && !item.hidden);
  const parent = existing.find((item) => item.id === parentId);
  if (parent?.canvas) {
    const siblings = existing.filter((item) => item.parentId === parentId).length;
    const width = kind === "reference" ? Math.max(190, parent.canvas.width - 30) : 250;
    const gap = kind === "reference" ? 42 : 96;
    return { x: parent.canvas.x + parent.canvas.width / 2 - width / 2, y: parent.canvas.y + parent.canvas.width * .75 + 34 + gap + siblings * (width * .75 + 76), width, rotation: 0, locked: false, hidden: false };
  }
  const index = existing.filter((item) => !item.parentId).length;
  const width = kind === "reference" ? 190 : 250;
  return { x: 72 + (index % 2 ? 28 : -28), y: 100 + index * 330, width, rotation: 0, locked: false, hidden: false };
}

function normalizeCanvasAsset(asset) {
  if (!asset.canvas) asset.canvas = defaultCanvasPlacement(asset.kind, asset.projectId, asset.parentId);
  asset.canvas.width = Math.max(140, Math.min(620, Number(asset.canvas.width) || 240));
  asset.canvas.x = Number(asset.canvas.x) || 0;
  asset.canvas.y = Number(asset.canvas.y) || 0;
  asset.canvas.rotation = Number(asset.canvas.rotation) || 0;
  asset.canvas.locked = Boolean(asset.canvas.locked);
  asset.canvas.hidden = Boolean(asset.canvas.hidden);
  return asset;
}

function selectedCanvasAsset() {
  return state.assets.find((item) => item.id === state.selectedCanvasAssetId) || null;
}

async function migrateVerticalLayout(project, projectAssets) {
  if (!project || Number(project.layoutVersion || 0) >= CANVAS_LAYOUT_VERSION) return;
  const ordered = [...projectAssets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const source = ordered.find((asset) => asset.kind === "source") || ordered[0];
  if (source) {
    source.canvas = { ...normalizeCanvasAsset(source).canvas, x: 72, y: 90, width: 260, rotation: 0 };
    let cursorY = source.canvas.y + source.canvas.width * .75 + 34 + 42;
    for (const asset of ordered.filter((item) => item.id !== source.id)) {
      if (asset.kind === "reference" && !asset.parentId) asset.parentId = source.id;
      const parent = ordered.find((item) => item.id === asset.parentId) || source;
      const width = asset.kind === "reference" ? Math.max(190, parent.canvas.width - 30) : 250;
      const gap = asset.kind === "reference" ? 42 : 96;
      asset.canvas = { ...normalizeCanvasAsset(asset).canvas, x: parent.canvas.x + parent.canvas.width / 2 - width / 2, y: Math.max(cursorY, parent.canvas.y + parent.canvas.width * .75 + 34 + gap), width, rotation: 0 };
      cursorY = asset.canvas.y + width * .75 + 76;
    }
    await Promise.all(ordered.map((asset) => dbPut("assets", asset)));
  }
  project.layoutVersion = CANVAS_LAYOUT_VERSION;
  await dbPut("projects", project);
}

async function secureSet(settings) {
  const value = { profilesJson: JSON.stringify(settings.profiles || []), theme: settings.theme || "system" };
  if (Plugins.LaoguiNative?.saveSecrets) return Plugins.LaoguiNative.saveSecrets(value);
  if (Plugins.Preferences?.set) return Plugins.Preferences.set({ key: "laogui-mobile-settings", value: JSON.stringify(value) });
  localStorage.setItem("laogui-mobile-settings", JSON.stringify(value));
}

async function secureGet() {
  try {
    if (Plugins.LaoguiNative?.loadSecrets) {
      const value = (await Plugins.LaoguiNative.loadSecrets()).value || {};
      return { ...value, profiles: JSON.parse(value.profilesJson || "[]") };
    }
    if (Plugins.Preferences?.get) {
      const result = await Plugins.Preferences.get({ key: "laogui-mobile-settings" });
      const value = result.value ? JSON.parse(result.value) : {};
      return { ...value, profiles: JSON.parse(value.profilesJson || "[]") };
    }
    const value = JSON.parse(localStorage.getItem("laogui-mobile-settings") || "{}");
    return { ...value, profiles: JSON.parse(value.profilesJson || "[]") };
  } catch { return {}; }
}

async function ensureProject() {
  let project = state.projects.find((item) => item.id === state.currentProjectId);
  if (project) return project;
  const now = new Date();
  project = { id: id("project"), name: `${now.toLocaleDateString("zh-CN").replaceAll("/", "-")} ${state.tool.name}`, createdAt: now.toISOString(), updatedAt: now.toISOString(), coverAssetId: null, layoutVersion: CANVAS_LAYOUT_VERSION, canvasMode: "flow", flowScrollTop: 0, selectedToolId: null, designConversation: [], designBrief: null };
  state.projects.unshift(project);
  state.currentProjectId = project.id;
  await dbPut("projects", project);
  renderProjects();
  return project;
}

function resolvedTheme(theme = state.settings.theme || "system") {
  if (theme !== "system") return theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0d13" : "#eef2f6");
  els.themeButton?.setAttribute("aria-label", theme === "dark" ? "切换到白天主题" : "切换到黑夜主题");
  Plugins.LaoguiNative?.setSystemBars?.({ theme }).catch(() => {});
}

function syncSystemTheme() {
  if ((state.settings.theme || "system") === "system") applyTheme();
}

async function toggleTheme() {
  state.settings = { ...state.settings, theme: resolvedTheme() === "dark" ? "light" : "dark" };
  applyTheme();
  await secureSet(state.settings);
}

async function dataUrlToBlob(dataUrl) { return fetch(dataUrl).then((response) => response.blob()); }
function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }

function imageSizeForRatio(value = "auto") {
  return ({ "1:1": "1024x1024", "3:4": "1024x1536", "4:5": "1024x1536", "16:9": "1536x1024", "2:1": "1536x1024" })[value] || "auto";
}
function qualityForResolution(value = "2K") { return value === "4K" ? "high" : value === "1K" ? "low" : "medium"; }

function resolutionRank(value = "1K") { return ({ "1K": 1, "2K": 2, "4K": 4 })[value] || 1; }

async function inspectImageResolution(dataUrl) {
  try {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const edge = Math.max(image.naturalWidth, image.naturalHeight);
    return { width: image.naturalWidth, height: image.naturalHeight, tier: edge >= 3000 ? "4K" : edge >= 1500 ? "2K" : "1K" };
  } catch { return { width: 0, height: 0, tier: "" }; }
}

async function persistGenerationSettings() {
  const project = state.projects.find((item) => item.id === state.currentProjectId);
  if (!project) return;
  project.generationSettings = { ratio: els.ratio.value, resolution: state.resolution, count: state.count, promptOptimize: state.promptOptimize, toolId: state.tool.id };
  await dbPut("projects", project);
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

async function addAsset({ dataUrl, name, kind, mode = state.tool.id, parentId = null, prompt = "", projectId = null, taskId = null }) {
  const project = state.projects.find((item) => item.id === projectId) || await ensureProject();
  const safeName = name || `${kind}-${Date.now()}.jpg`;
  const saved = await saveToGallery(dataUrl, project.name, safeName).catch(() => ({ uri: "" }));
  const asset = {
    id: id("asset"), projectId: project.id, kind, mode, parentId, name: safeName,
    blob: await dataUrlToBlob(dataUrl), uri: saved.uri || "", webPath: saved.webPath || "",
    prompt, taskId, favorite: false, createdAt: new Date().toISOString(),
    canvas: defaultCanvasPlacement(kind, project.id, parentId)
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
  if (kind === "primary" && state.primary && !confirm("把新图片设为当前底图吗？原来的底图会继续保留在画布中。")) return;
  for (const [index, file] of [...files].entries()) {
    if (!file.type?.startsWith("image/") && !options.cameraDataUrl) continue;
    const raw = options.cameraDataUrl && index === 0 ? options.cameraDataUrl : await blobToDataUrl(file);
    const dataUrl = await compressDataUrl(raw);
    const name = file.name || `现场拍摄-${Date.now()}.jpg`;
    if (kind === "primary") {
      const saved = await addAsset({ dataUrl: raw, name, kind: "source" });
      state.primary = { dataUrl, name, assetId: saved.id };
      state.selectedCanvasAssetId = saved.id;
      state.toolSelected = true;
      break;
    }
    if (state.references.length >= 8) break;
    const saved = await addAsset({ dataUrl: raw, name, kind: "reference", parentId: state.primary?.assetId || null });
    saved.role = "自动判断"; await dbPut("assets", saved);
    state.references.push({ dataUrl, name, assetId: saved.id, role: "自动判断" });
    state.selectedCanvasAssetId = saved.id;
  }
  renderComposer();
}

function renderTools() {
  els.toolGrid.innerHTML = tools.map((tool) => `<button class="tool-card" data-tool="${tool.id}"><span class="tool-icon"><svg><use href="#${toolGroupById[tool.id] === "drawing" ? "i-image" : "i-spark"}"/></svg></span><span class="tool-copy"><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.desc)}</small></span><svg class="tool-arrow"><use href="#i-back"/></svg></button>`).join("");
  renderRecentProject();
}

function renderRecentProject() {
  if (!els.recentProject) return;
  const project = [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  els.recentProject.hidden = !project;
  if (!project) return;
  const assets = state.assets.filter((asset) => asset.projectId === project.id);
  const cover = state.assets.find((asset) => asset.id === project.coverAssetId) || assets.at(-1);
  const running = state.tasks.some((task) => task.projectId === project.id && task.status === "running");
  els.recentProject.dataset.project = project.id;
  els.recentProject.innerHTML = `<span class="recent-project-copy"><small>继续最近项目</small><strong>${escapeHtml(project.name)}</strong><em>${running ? "正在生成" : `${assets.length} 张图片 · ${formatTime(project.updatedAt)}`}</em></span>${cover ? `<img src="${assetUrl(cover)}" alt="${escapeHtml(project.name)}封面" loading="lazy">` : `<span class="recent-project-placeholder"><svg><use href="#i-image"/></svg></span>`}<svg class="recent-project-arrow"><use href="#i-back"/></svg>`;
}

function navigate(page) {
  state.page = page;
  els.pages.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  els.navs.forEach((item) => item.classList.toggle("active", item.dataset.nav === page));
  closeCanvasMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeCanvasMenu() {
  if (!els.canvasMenu) return;
  els.canvasMenu.hidden = true;
  els.canvasMenuButton.setAttribute("aria-expanded", "false");
}

function resetCanvas() {
  state.currentProjectId = null;
  state.tool = tools[0];
  state.primary = null;
  state.references = [];
  state.maskDataUrl = "";
  state.selection = null;
  state.selectedCanvasAssetId = null;
  state.canvas = { mode: "flow", x: 24, y: 72, zoom: 1, flowScrollTop: 0, pointers: new Map(), gesture: null };
  state.toolSelected = true;
  state.selectedStyle = "不限定";
  els.prompt.value = "";
  els.toolPopover.hidden = true;
  navigate("home");
  renderComposer();
  renderCanvasList();
}

async function selectTool(tool, { openParameters = false } = {}) {
  if (!tool) return;
  state.tool = tool;
  state.toolSelected = true;
  state.lastToolId = tool.id;
  localStorage.setItem("laogui-mobile-last-tool", tool.id);
  state.count = tool.id === "designseries" ? 4 : 1;
  if (tool.id === "panorama") els.ratio.value = "2:1";
  const project = state.projects.find((item) => item.id === state.currentProjectId) || await ensureProject();
  project.selectedToolId = tool.id;
  await dbPut("projects", project);
  renderComposer();
  els.toolPopover.hidden = true;
  if (openParameters && !els.parameter.open) els.parameter.showModal();
}

function currentProject() {
  return state.projects.find((item) => item.id === state.currentProjectId) || null;
}

function directPrompt(project = currentProject()) {
  return project?.designBrief?.finalPrompt || project?.designBrief?.summary || "";
}

async function updateDirectPrompt(value) {
  const project = currentProject() || await ensureProject();
  const prompt = value.trimStart().slice(0, 800);
  project.designBrief = { ready: Boolean(prompt.trim()), summary: prompt, finalPrompt: prompt, source: "direct" };
  project.updatedAt = new Date().toISOString();
  els.prompt.value = prompt;
  await dbPut("projects", project);
  renderGenerationControls();
}

function toolRequiresPrimary(tool = state.tool) { return tool.id !== "custom"; }

function generationReadiness() {
  const running = state.tasks.some((task) => task.projectId === state.currentProjectId && task.status === "running");
  if (state.generationSubmitting || running) return { action: "busy", label: "正在生成…", disabled: true };
  if (toolRequiresPrimary() && !state.primary) return { action: "image", label: "添加底图", disabled: false };
  if (!directPrompt().trim() && !state.primary && !state.references.length) return { action: "prompt", label: "输入要求开始", disabled: false };
  return { action: "ready", label: `生成 ${state.count} 张图片`, disabled: false };
}

function renderGenerationControls() {
  const readiness = generationReadiness();
  els.quickGenerate.dataset.actionState = readiness.action;
  els.quickGenerate.disabled = readiness.disabled;
  els.quickGenerate.innerHTML = `<svg><use href="#i-spark"/></svg><span>${readiness.label}</span>`;
  els.selectedCapabilityLabel.textContent = state.tool.name;
  els.selectCapability.classList.toggle("active", state.tool.id !== "custom");
  els.workspacePromptCount.textContent = String(els.workspacePrompt.value.length);
}

function renderWorkbenchMedia() {
  const media = [];
  if (state.primary) media.push(`<article class="workbench-media-thumb primary"><img src="${state.primary.dataUrl}" alt="底图"><span>底图</span><button type="button" data-remove-primary aria-label="删除底图"><svg><use href="#i-close"/></svg></button></article>`);
  state.references.forEach((item, index) => media.push(`<article class="workbench-media-thumb"><img src="${item.dataUrl}" alt="参考图 ${index + 1}"><span>参考 ${index + 1}</span><button type="button" data-remove-reference="${index}" aria-label="删除参考图"><svg><use href="#i-close"/></svg></button></article>`));
  els.workbenchMediaList.innerHTML = media.join("");
  els.workbenchMediaList.hidden = media.length === 0;
}

function renderWorkbenchVisibility() {
  const collapsed = state.workbenchCollapsed;
  const imageCount = Number(Boolean(state.primary)) + state.references.length;
  els.creationWorkbench.classList.toggle("collapsed", collapsed);
  els.workbenchDetails.hidden = collapsed;
  els.workbenchCollapsedSummary.hidden = !collapsed;
  els.toggleWorkbench.setAttribute("aria-expanded", String(!collapsed));
  els.toggleWorkbench.querySelector("span").textContent = collapsed ? "展开" : "收起";
  els.collapsedCapabilityLabel.textContent = state.tool.name;
  els.collapsedMediaSummary.textContent = imageCount ? `${imageCount} 张图片` : "未添加图片";
  els.collapsedParameterSummary.textContent = els.parameterSummary.textContent;
}

function setWorkbenchCollapsed(collapsed) {
  state.workbenchCollapsed = Boolean(collapsed);
  localStorage.setItem("laogui-mobile-workbench-collapsed", String(state.workbenchCollapsed));
  renderWorkbenchVisibility();
}

function renderGenerationConfirmation() {
  const prompt = directPrompt().trim() || "根据已上传图片进行专业设计";
  const images = [state.primary && { ...state.primary, label: "底图" }, ...state.references.map((item, index) => ({ ...item, label: `参考图 ${index + 1}` }))].filter(Boolean);
  const ratio = els.ratio.value === "auto" ? "参考原图" : els.ratio.value;
  els.generationConfirmContent.innerHTML = `<section><small>文字要求</small><p>${escapeHtml(prompt)}</p></section>${images.length ? `<section><small>图片</small><div class="confirm-media-row">${images.map((item) => `<figure><img src="${item.dataUrl}" alt="${item.label}"><figcaption>${item.label}</figcaption></figure>`).join("")}</div></section>` : ""}<section class="confirm-summary-grid"><div><small>创作能力</small><strong>${escapeHtml(state.tool.name)}</strong></div><div><small>生成参数</small><strong>${ratio} · ${state.resolution} · ${state.count}张</strong></div><div><small>提示词优化</small><strong>${state.promptOptimize ? "开启" : "关闭"}</strong></div></section>`;
  els.browserGenerationNotice.hidden = isNative;
}

function openGenerationConfirmation() {
  const readiness = generationReadiness();
  if (readiness.action === "prompt") { els.workspacePrompt.focus(); return toast("请先输入要求或添加图片"); }
  if (readiness.action === "image") { els.galleryPrimary.click(); return; }
  if (readiness.action !== "ready") return;
  renderGenerationConfirmation();
  if (!els.generationConfirm.open) els.generationConfirm.showModal();
}

async function openComposer(tool = state.tool, { asset = null, reset = true, openParameters = true } = {}) {
  state.tool = tool;
  if (reset) {
    state.selectedStyle = "不限定";
    state.references = [];
    state.primary = asset ? { dataUrl: asset._dataUrl || assetUrl(asset), name: asset.name, assetId: asset.id } : null;
    state.maskDataUrl = "";
    els.prompt.value = "";
    els.ratio.value = tool.id === "panorama" ? "2:1" : "auto";
    state.count = tool.id === "designseries" ? 4 : 1;
    state.resolution = "2K";
  }
  state.currentProjectId = asset?.projectId || state.currentProjectId;
  state.toolSelected = true;
  state.lastToolId = tool.id;
  localStorage.setItem("laogui-mobile-last-tool", tool.id);
  navigate("home");
  renderComposer();
  if (openParameters && state.primary && !els.parameter.open) els.parameter.showModal();
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
  const project = state.projects.find((item) => item.id === state.currentProjectId);
  els.composerTitle.textContent = project?.name || "新建空间设计";
  els.currentProjectLabel.textContent = project?.name || "新画布";
  els.workspaceComposer.hidden = false;
  els.parameterTitle.textContent = state.tool.name;
  els.toolSelect.innerHTML = tools.map((tool) => `<option value="${tool.id}" ${tool.id === state.tool.id ? "selected" : ""}>${escapeHtml(tool.name)}</option>`).join("");
  const capabilityTools = ["custom", "photo", "plan-axonometric", "whitemodel", "designseries"].map((id) => tools.find((tool) => tool.id === id)).filter(Boolean);
  els.capabilityChips.innerHTML = capabilityTools.map((tool) => `<button type="button" class="${tool.id === state.tool.id ? "active" : ""}" data-capability="${tool.id}">${escapeHtml(tool.name.replace("现场图转效果图", "空间方案"))}</button>`).join("");
  const profiles = state.settings.profiles || [];
  els.apiProfileSelect.innerHTML = profiles.length ? profiles.map((profile, index) => `<option value="${profile.id}">#${index + 1} ${escapeHtml(profile.label || `接口 ${index + 1}`)}</option>`).join("") : `<option value="">请先在设置导入配置</option>`;
  els.currentApiStatus.textContent = profiles.length ? `正常 · ${profiles[0].label || `接口 ${1}`} · 自动切换` : "未配置 · 请先导入完整配置";
  els.resolutionChips.innerHTML = ["1K", "2K", "4K"].map((value) => `<button type="button" class="${value === state.resolution ? "active" : ""}" data-resolution="${value}">${value}</button>`).join("");
  els.countChips.innerHTML = [1, 2, 3, 4].map((value) => `<button type="button" class="${value === state.count ? "active" : ""}" data-count="${value}">${value}</button>`).join("");
  const ratioLabel = els.ratio.value === "auto" ? "参考原图" : els.ratio.value;
  els.parameterSummary.textContent = `${ratioLabel} · ${state.resolution} · ${state.count}张`;
  els.quickRatioChoices.innerHTML = [["auto", "参考原图"], ["1:1", "1:1"], ["3:4", "3:4"], ["4:5", "4:5"], ["16:9", "16:9"], ["2:1", "2:1"]].map(([value, label]) => `<button type="button" class="${els.ratio.value === value ? "active" : ""}" data-quick-ratio="${value}">${label}</button>`).join("");
  els.quickResolutionChoices.innerHTML = ["1K", "2K", "4K"].map((value) => `<button type="button" class="${state.resolution === value ? "active" : ""}" data-resolution="${value}">${value}</button>`).join("");
  els.quickCountChoices.innerHTML = [1, 2, 3, 4].map((value) => `<button type="button" class="${state.count === value ? "active" : ""}" data-count="${value}">${value}张</button>`).join("");
  els.quickPromptOptimize.checked = state.promptOptimize;
  els.promptOptimizeToggle.checked = state.promptOptimize;
  const designBrief = project?.designBrief;
  const prompt = designBrief?.finalPrompt || designBrief?.summary || "";
  if (document.activeElement !== els.prompt) els.prompt.value = prompt;
  if (document.activeElement !== els.workspacePrompt) els.workspacePrompt.value = prompt;
  els.promptCount.textContent = `${els.prompt.value.length} / 800`;
  els.primaryPreview.classList.toggle("empty", !state.primary);
  els.primaryPreview.classList.remove("mask-mode");
  els.primaryPreview.innerHTML = state.primary ? `<img src="${state.primary.dataUrl}" alt="已选择底图">` : "<span>请返回画布选择一张图片</span>";
  if (els.maskControls) els.maskControls.hidden = true;
  renderWorkbenchMedia();
  renderGenerationControls();
  renderWorkbenchVisibility();
  $$("[data-canvas-tool]").forEach((button) => button.classList.toggle("active", button.dataset.canvasTool === state.canvasTool));
  els.referencePreviews.innerHTML = state.references.map((item, index) => `<div class="reference-thumb"><img src="${item.dataUrl}" alt="参考图 ${index + 1}"><button data-remove-reference="${index}" aria-label="删除参考图"><svg><use href="#i-close"/></svg></button><button class="reference-role" data-reference-role="${index}" title="点击切换参考内容">${escapeHtml(item.role || "自动判断")}</button></div>`).join("");
  els.referenceCount.textContent = `${state.references.length} / 8`;
  els.optionalReferenceCount.textContent = "0 / 8";
  els.optionalReferencePreviews.innerHTML = "";
  els.styleChips.innerHTML = styles.map((style) => `<button class="${style === state.selectedStyle ? "active" : ""}" data-style="${style}">${style}</button>`).join("");
  els.strategy.innerHTML = strategyMarkup();
  els.angleControls.hidden = !["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(state.tool.id);
  els.generate.innerHTML = `<svg><use href="#i-spark"/></svg>生成${state.count}张图片`;
  renderWorkbenchMedia();
  renderGenerationControls();
  renderCreationFeed();
  renderCanvasList();
}

function taskStatusText(task) {
  if (task.status === "running") return "正在生成，请保持网络连接";
  if (task.status === "success") return "已完成";
  if (task.status === "uncertain") return "状态未知，为避免重复扣费没有自动重试";
  return task.error || "生成失败";
}

function feedAssetMarkup(asset) {
  const title = tools.find((item) => item.id === asset.mode)?.name || "设计图片";
  return `<article class="feed-image-card"><button class="feed-image" data-preview-asset="${asset.id}" aria-label="打开${escapeHtml(title)}的全屏编辑画布"><img src="${assetUrl(asset)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async"></button><div class="feed-image-meta"><span>${escapeHtml(title)}</span><time>${formatTime(asset.createdAt)}</time></div><div class="feed-image-actions"><button data-asset-action="edit" data-asset-id="${asset.id}"><svg><use href="#i-edit"/></svg>编辑</button><button data-asset-action="reuse" data-asset-id="${asset.id}"><svg><use href="#i-spark"/></svg>继续</button><button data-asset-action="compare" data-asset-id="${asset.id}"><svg><use href="#i-compare"/></svg>对比</button><button data-asset-action="share" data-asset-id="${asset.id}"><svg><use href="#i-share"/></svg>分享</button><button class="${asset.favorite ? "active" : ""}" data-asset-action="favorite" data-asset-id="${asset.id}">收藏</button><button class="danger" data-asset-action="delete" data-asset-id="${asset.id}">删除</button></div></article>`;
}

function recommendedTools() {
  const ids = [state.lastToolId, "photo", "plan-axonometric", "whitemodel", "replace"];
  return [...new Set(ids)].map((toolId) => tools.find((tool) => tool.id === toolId)).filter(Boolean).slice(0, 4);
}

function toolRecommendationsMarkup() {
  if (!state.primary) return "";
  return `<section class="canvas-tool-recommendations"><div class="recommendation-heading"><div><strong>图片已就绪</strong><small>${state.toolSelected ? `已选择：${escapeHtml(state.tool.name)}` : "选择接下来要做什么"}</small></div><button type="button" data-action="more-tools">更多功能</button></div><div class="recommended-tools">${recommendedTools().map((tool) => `<button type="button" class="${state.toolSelected && tool.id === state.tool.id ? "active" : ""}" data-recommended-tool="${tool.id}"><svg><use href="#${tool.edit ? "i-edit" : toolGroupById[tool.id] === "drawing" ? "i-image" : "i-spark"}"/></svg><span>${escapeHtml(tool.name)}</span></button>`).join("")}</div></section>`;
}

function renderCreationFeed() {
  renderInfiniteCanvas();
}

async function requestMobileAiEdit({ selected, prompt, sourceDataUrl, maskDataUrl, maskWidth, maskHeight, outputSize, operation }) {
  if (!Plugins.LaoguiNative?.generateImage) throw new Error("当前环境没有可用的图片生成接口");
  const profiles = (state.settings.profiles || []).filter((profile) => profile.enabled !== false);
  const result = await Plugins.LaoguiNative.generateImage({
    requestId: id("ai-edit"),
    prompt: prompt || (operation === "remove" ? "清除选区内的内容并自然补全周围区域" : "按要求编辑选区内容"),
    size: /\d+x\d+/.test(String(outputSize || "")) ? outputSize : imageSizeForRatio(outputSize || "auto"),
    quality: qualityForResolution(state.resolution),
    resolution: state.resolution,
    count: 1,
    inputImages: [sourceDataUrl || selected?.url].filter(Boolean),
    maskImage: maskDataUrl,
    profiles
  });
  const url = result.imageDataUrls?.[0] || result.imageDataUrl;
  if (!url) throw new Error("图片接口没有返回编辑结果");
  return { url, optimizedPrompt: prompt, reasoningModel: result.provider || "" };
}

async function commitMobileLocalEdit({ dataUrl, title, selected, format = "image/png" }) {
  const parent = state.assets.find((asset) => asset.id === selected?.assetId) || selectedCanvasAsset();
  const label = localEditorMode === "adjust" ? "调色" : "基础编辑";
  const extension = format === "image/jpeg" ? "jpg" : format === "image/webp" ? "webp" : "png";
  const result = await addAsset({ dataUrl, name: `${parent?.name || "图片"}-${label}-${Date.now()}.${extension}`, kind: "edited", mode: localEditorMode === "adjust" ? "local-colorgrade" : "local-basic-edit", parentId: parent?.id || null, prompt: title || label, projectId: parent?.projectId || state.currentProjectId });
  if (parent) {
    normalizeCanvasAsset(parent); normalizeCanvasAsset(result);
    result.canvas.x = parent.canvas.x + parent.canvas.width + 34;
    result.canvas.y = parent.canvas.y + 18;
    result.canvas.width = parent.canvas.width;
    await dbPut("assets", result);
  }
  state.selectedCanvasAssetId = result.id; state.selectedAssetId = result.id; renderComposer();
  toast(`${label}完成，新图片已加入画布`);
}

function mobileDeepEditorInstance() {
  if (!mobileDeepEditor) mobileDeepEditor = createDeepEditor({ onCommit: commitMobileLocalEdit, notify: toast });
  return mobileDeepEditor;
}

function mobileBasicEditorInstance() {
  if (!mobileBasicEditor) mobileBasicEditor = createBasicEditor({ onCommit: commitMobileLocalEdit, notify: toast });
  return mobileBasicEditor;
}

async function openMobileLocalEdit(asset, mode) {
  if (!asset) return toast("请先选择一张图片");
  localEditorMode = mode;
  document.body.dataset.localEditorMode = mode;
  try {
    if (mode === "basic") {
      await mobileBasicEditorInstance().open({ id: asset.id, assetId: asset.id, title: asset.name, url: assetUrl(asset) });
      return;
    }
    await mobileDeepEditorInstance().open({ id: asset.id, assetId: asset.id, title: asset.name, url: assetUrl(asset) }, { initialTab: mode, initialTool: "move" });
  } catch (error) {
    const editor = mode === "basic" ? mobileBasicEditor : mobileDeepEditor;
    editor?.close?.(true);
    toast(error.message || "无法打开本地编辑，请从网页地址进入");
  }
}

async function commitMobileAiEdit({ dataUrl, selected, optimizedPrompts = [] }) {
  const parent = state.assets.find((asset) => asset.id === selected?.assetId) || selectedCanvasAsset();
  const result = await addAsset({
    dataUrl,
    name: `${parent?.name || "图片"}-AI编辑-${Date.now()}.png`,
    kind: "edited",
    mode: "ai-edit",
    parentId: parent?.id || null,
    prompt: optimizedPrompts.map((item) => item.originalPrompt || item.optimizedPrompt).filter(Boolean).join("；"),
    projectId: parent?.projectId || state.currentProjectId
  });
  if (parent) {
    normalizeCanvasAsset(parent); normalizeCanvasAsset(result);
    result.canvas.x = parent.canvas.x + parent.canvas.width + 34;
    result.canvas.y = parent.canvas.y + 18;
    result.canvas.width = parent.canvas.width;
    await dbPut("assets", result);
  }
  state.selectedCanvasAssetId = result.id;
  state.selectedAssetId = result.id;
  renderComposer();
  toast("AI 编辑完成，结果已加入画布");
}

function mobileAiEditorInstance() {
  if (mobileAiEditor) return mobileAiEditor;
  mobileAiEditor = createAiEditor({
    notify: toast,
    onEditRegion: requestMobileAiEdit,
    onCommit: commitMobileAiEdit
  });
  return mobileAiEditor;
}

async function openMobileAiEdit(asset) {
  if (!asset) return toast("请先选择一张图片");
  try {
    setSelectedAssetAsPrimary(asset, "custom");
    await mobileAiEditorInstance().open({ id: asset.id, assetId: asset.id, title: asset.name, url: assetUrl(asset) });
  } catch (error) {
    mobileAiEditorInstance().close();
    toast(error.message || "无法打开 AI 编辑");
  }
}

function canvasNodeMarkup(asset, index) {
  normalizeCanvasAsset(asset);
  const selected = asset.id === state.selectedCanvasAssetId;
  const task = state.tasks.find((item) => item.assetId === asset.id || item.id === asset.taskId);
  const title = asset.kind === "source" ? "底图" : asset.kind === "reference" ? `参考图 · ${asset.role || "自动判断"}` : tools.find((item) => item.id === asset.mode)?.name || (asset.mode === "local-colorgrade" ? "本地调色" : asset.mode === "local-basic-edit" ? "基础编辑" : "设计图片");
  const editor = false;
  const common = [["ai-edit", "AI 编辑", "i-spark"], ["basic-edit", "基础编辑", "i-crop"], ["download", "下载", "i-download"], ["delete", "删除", "i-trash"]];
  const toolsMarkup = selected ? `<div class="canvas-node-context">${common.map(([action, label, icon]) => `<button type="button" data-object-action="${action}" data-asset-id="${asset.id}" class="${state.canvasTool === action ? "active" : ""}"><svg><use href="#${icon}"/></svg><span>${label}</span></button>`).join("")}</div>` : "";
  const maskMarkup = editor ? `<canvas class="canvas-node-mask" data-mask-asset="${asset.id}" aria-label="在图片上选择编辑区域"></canvas>` : "";
  const resize = selected && !asset.canvas.locked ? `<span class="canvas-node-handle resize" data-handle="resize" data-asset-id="${asset.id}" aria-label="调整大小"></span><span class="canvas-node-handle rotate" data-handle="rotate" data-asset-id="${asset.id}" aria-label="旋转图片"></span>` : "";
  return `<article class="canvas-node ${selected ? "selected" : ""} ${asset.canvas.locked ? "locked" : ""}" data-asset-id="${asset.id}" data-kind="${asset.kind}" data-context-side="right" style="left:${asset.canvas.x}px;top:${asset.canvas.y}px;width:${asset.canvas.width}px;--node-rotation:${asset.canvas.rotation}deg"><img src="${assetUrl(asset)}" alt="${escapeHtml(asset.name)}" draggable="false"><div class="canvas-node-copy"><strong>${escapeHtml(title)}</strong><span class="canvas-node-status ${task?.status || ""}"></span></div>${maskMarkup}${toolsMarkup}${resize}</article>`;
}

function canvasTaskMarkup(task, index) {
  const status = task.status === "success" ? "success" : task.status === "failed" ? "failed" : "running";
  if (status === "success") return "";
  return `<article class="canvas-node canvas-node-task" data-task-id="${task.id}" style="left:${120 + index * 310}px;top:${780 + (index % 2) * 220}px;width:230px"><div class="spinner"></div><strong>${escapeHtml(task.title)}</strong><small class="${status === "failed" ? "canvas-node-error" : ""}">${escapeHtml(taskStatusText(task))}</small></article>`;
}

function renderCanvasTasks() {
  if (!els.canvasTaskList) return;
  const inScope = (item) => state.historyScope === "all" || item.projectId === state.currentProjectId;
  const taskItems = state.tasks.filter(inScope).map((task) => ({ type: "task", createdAt: task.createdAt, task }));
  const localItems = state.assets.filter((asset) => inScope(asset) && ["local-basic-edit", "local-colorgrade", "ai-edit"].includes(asset.mode) && !asset.taskId).map((asset) => ({ type: "asset", createdAt: asset.createdAt, asset }));
  const items = [...taskItems, ...localItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  els.canvasTaskList.innerHTML = items.length ? items.map((item) => {
    const task = item.task; const asset = item.asset || state.assets.find((entry) => entry.id === task?.assetId);
    const title = task?.title || (asset.mode === "ai-edit" ? "AI 编辑" : asset.mode === "local-colorgrade" ? "本地调色" : "基础编辑");
    const details = task ? [task.ratio === "auto" ? "参考原图" : task.ratio, task.actualResolution || task.resolution, task.downgradeNotice].filter(Boolean).join(" · ") : "本机处理 · 不消耗接口";
    return `<article class="canvas-task-item ${task?.status || "success"}">${asset ? `<button class="history-thumb" type="button" data-history-asset="${asset.id}"><img src="${assetUrl(asset)}" alt="${escapeHtml(title)}"></button>` : `<span class="history-placeholder"><i></i></span>`}<button class="history-copy" type="button" ${asset ? `data-history-asset="${asset.id}"` : "disabled"}><strong>${escapeHtml(title)}</strong><small>${escapeHtml(task ? taskStatusText(task) : "已完成")}</small><em>${escapeHtml(details)} · ${formatTime(item.createdAt)}</em></button>${task && ["failed", "uncertain"].includes(task.status) ? `<button class="history-retry" type="button" data-retry-task="${task.id}">重新生成</button>` : ""}</article>`;
  }).join("") : `<div class="list-empty-message">当前没有生成记录</div>`;
}

function applyCanvasView() {
  if (!els.canvasWorld) return;
  els.canvasWorld.style.transform = state.canvas.mode === "flow" ? "none" : `translate3d(${state.canvas.x}px, ${state.canvas.y}px, 0) scale(${state.canvas.zoom})`;
  els.canvasZoomLabel.textContent = `${Math.round(state.canvas.zoom * 100)}%`;
}

function positionContextTools() {
  els.canvasNodes?.querySelectorAll(".canvas-node.selected").forEach((node) => {
    const rect = node.getBoundingClientRect();
    const side = rect.right + 300 < window.innerWidth ? "right" : rect.left > 300 ? "left" : "bottom";
    node.dataset.contextSide = side;
  });
}

function renderCanvasConnections(assets) {
  if (!els.canvasConnections) return;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  els.canvasConnections.setAttribute("viewBox", "0 0 3200 2600");
  els.canvasConnections.innerHTML = assets.map((asset) => {
    const parent = byId.get(asset.parentId);
    if (!parent?.canvas || !asset.canvas) return "";
    const x1 = parent.canvas.x + parent.canvas.width / 2;
    const y1 = parent.canvas.y + parent.canvas.width * .75 + 34;
    const x2 = asset.canvas.x + asset.canvas.width / 2;
    const y2 = asset.canvas.y;
    const middle = y1 + Math.max(54, (y2 - y1) / 2);
    const active = [asset.id, parent.id].includes(state.selectedCanvasAssetId) ? " active" : "";
    return `<g class="canvas-connection${active}"><path d="M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}"/><circle cx="${x1}" cy="${y1}" r="5"/><circle cx="${x2}" cy="${y2}" r="5"/></g>`;
  }).join("");
}

function showToolPopover(asset = selectedCanvasAsset()) {
  if (asset) setSelectedAssetAsPrimary(asset, state.tool.id);
  renderTools();
  els.toolPopover.hidden = false;
  const node = asset ? els.canvasNodes.querySelector(`[data-asset-id="${CSS.escape(asset.id)}"]`) : null;
  const rect = node?.getBoundingClientRect();
  if (rect) {
    const width = Math.min(344, window.innerWidth - 24);
    els.toolPopover.style.width = `${width}px`;
    els.toolPopover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2))}px`;
    const safeTop = window.innerHeight - 138 - Math.min(window.innerHeight * .6, 620);
    els.toolPopover.style.top = `${Math.max(72, Math.min(rect.bottom + 12, safeTop))}px`;
  }
}

async function focusCanvasAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  if (asset.projectId !== state.currentProjectId) await openProject(asset.projectId);
  normalizeCanvasAsset(asset);
  const rect = els.infiniteCanvas.getBoundingClientRect();
  const zoom = Math.max(.55, Math.min(1.15, state.canvas.zoom));
  state.canvas.zoom = zoom;
  state.canvas.x = rect.width / 2 - (asset.canvas.x + asset.canvas.width / 2) * zoom;
  state.canvas.y = rect.height / 2 - (asset.canvas.y + asset.canvas.width * .4) * zoom;
  state.selectedCanvasAssetId = asset.id;
  setSelectedAssetAsPrimary(asset, state.tool.id);
  els.taskStatusPanel.hidden = true;
  if (state.canvas.mode === "flow") {
    renderInfiniteCanvas();
    requestAnimationFrame(() => els.canvasNodes.querySelector(`[data-asset-id="${CSS.escape(asset.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    await persistCanvasState();
    return;
  }
  await persistCanvasState();
  renderInfiniteCanvas();
}

async function setCanvasMode(mode) {
  const next = mode === "canvas" ? "canvas" : "flow";
  if (state.canvas.mode === next) return;
  state.canvas.mode = next;
  const project = currentProject();
  if (project) {
    project.canvasMode = next;
    project.flowScrollTop = state.canvas.flowScrollTop || 0;
    await dbPut("projects", project);
  }
  renderInfiniteCanvas();
}

function renderCanvasModeSwitch() {
  els.canvasModeSwitch?.querySelectorAll("[data-canvas-mode]").forEach((button) => {
    const active = button.dataset.canvasMode === state.canvas.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  els.canvasZoomLabel.hidden = state.canvas.mode === "flow";
  els.infiniteCanvas.setAttribute("aria-label", state.canvas.mode === "flow" ? "设计动态流" : "设计无限画布");
  els.emptyCanvasHint.textContent = state.canvas.mode === "flow" ? "底图和参考图会按上下关系排列" : "自由移动、缩放并整理所有图片";
  els.infiniteCanvas?.classList.toggle("mode-flow", state.canvas.mode === "flow");
  els.infiniteCanvas?.classList.toggle("mode-canvas", state.canvas.mode === "canvas");
  if (els.infiniteCanvas && state.canvas.mode === "flow") els.infiniteCanvas.scrollTop = state.canvas.flowScrollTop || 0;
}

function flowNodeMarkup(asset, assets, seen = new Set()) {
  if (seen.has(asset.id)) return "";
  seen.add(asset.id);
  normalizeCanvasAsset(asset);
  const selected = asset.id === state.selectedCanvasAssetId;
  const task = state.tasks.find((item) => item.assetId === asset.id || item.id === asset.taskId);
  const title = asset.kind === "source" ? "底图" : asset.kind === "reference" ? `参考图 · ${asset.role || "自动判断"}` : tools.find((item) => item.id === asset.mode)?.name || (asset.mode === "local-colorgrade" ? "本地调色" : asset.mode === "local-basic-edit" ? "基础编辑" : "设计图片");
  const common = [["ai-edit", "AI 编辑", "i-spark"], ["basic-edit", "基础编辑", "i-crop"], ["download", "下载", "i-download"], ["delete", "删除", "i-trash"]];
  const children = assets.filter((item) => item.parentId === asset.id && !item.canvas?.hidden);
  const related = selected || asset.parentId === state.selectedCanvasAssetId || children.some((child) => child.id === state.selectedCanvasAssetId);
  const toolsMarkup = selected ? `<div class="canvas-node-context flow-node-context">${common.map(([action, label, icon]) => `<button type="button" data-object-action="${action}" data-asset-id="${asset.id}"><svg><use href="#${icon}"/></svg><span>${label}</span></button>`).join("")}</div>` : "";
  return `<article class="flow-node ${selected ? "selected" : ""} ${related ? "relation-active" : ""}" data-asset-id="${asset.id}" data-kind="${asset.kind}"><div class="flow-node-card"><img src="${assetUrl(asset)}" alt="${escapeHtml(asset.name)}" draggable="false"><div class="canvas-node-copy"><strong>${escapeHtml(title)}</strong><span class="canvas-node-status ${task?.status || ""}"></span></div>${toolsMarkup}</div>${children.length ? `<div class="flow-node-children">${children.map((child) => flowNodeMarkup(child, assets, new Set(seen))).join("")}</div>` : ""}</article>`;
}

function renderFlowCanvas(assets, pendingTasks) {
  const roots = assets.filter((asset) => !assets.some((item) => item.id === asset.parentId));
  els.canvasNodes.innerHTML = `<div class="flow-tree">${roots.map((asset) => flowNodeMarkup(asset, assets)).join("")}</div>${pendingTasks.map((task) => `<article class="flow-task-card"><div class="spinner"></div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(taskStatusText(task))}</small></article>`).join("")}`;
  els.canvasConnections.innerHTML = "";
  applyCanvasView();
}

function renderInfiniteCanvas() {
  if (!els.canvasNodes || !els.infiniteCanvas) return;
  const assets = state.assets.filter((asset) => asset.projectId === state.currentProjectId && !asset.canvas?.hidden);
  const pendingTasks = state.tasks.filter((task) => task.projectId === state.currentProjectId && ["running", "failed", "uncertain"].includes(task.status));
  assets.forEach(normalizeCanvasAsset);
  els.infiniteCanvas.classList.toggle("has-nodes", assets.length > 0 || pendingTasks.length > 0);
  if (state.canvas.mode === "flow") renderFlowCanvas(assets, pendingTasks);
  else {
    els.canvasNodes.innerHTML = assets.map(canvasNodeMarkup).join("");
    els.canvasNodes.insertAdjacentHTML("beforeend", pendingTasks.map(canvasTaskMarkup).join(""));
    renderCanvasConnections(assets);
    applyCanvasView();
  }
  renderCanvasModeSwitch();
  renderCanvasTasks();
  requestAnimationFrame(positionContextTools);
  if (state.selectedCanvasAssetId && state.canvasTool !== "move" && state.canvasTool !== "preview") requestAnimationFrame(setupCanvasMaskEditor);
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
    let selectionStart = null;
    const history = state.maskHistory;
    const snapshot = () => {
      const data = { visible: visible.getImageData(0, 0, canvas.width, canvas.height), mask: maskContext.getImageData(0, 0, mask.width, mask.height) };
      history.splice(state.maskHistoryIndex + 1);
      history.push(data);
      if (history.length > 12) history.shift();
      state.maskHistoryIndex = history.length - 1;
    };
    const restore = (index) => {
      const data = history[index];
      if (!data) return;
      visible.putImageData(data.visible, 0, 0);
      maskContext.putImageData(data.mask, 0, 0);
      state.maskHistoryIndex = index;
      state.maskDataUrl = mask.toDataURL("image/png");
    };
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
    };
    const draw = (event) => {
      if (!drawing || state.canvasTool !== "mask") return;
      const { x, y } = point(event);
      const radius = Number(els.maskBrush.value || 48) * canvas.width / Math.max(canvas.clientWidth, 1) / 2;
      visible.fillStyle = "rgba(226, 185, 70, .48)";
      visible.beginPath(); visible.arc(x, y, radius, 0, Math.PI * 2); visible.fill();
      maskContext.globalCompositeOperation = "destination-out";
      maskContext.beginPath(); maskContext.arc(x, y, radius, 0, Math.PI * 2); maskContext.fill();
      state.maskDataUrl = mask.toDataURL("image/png");
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!["mask", "select", "note"].includes(state.canvasTool)) return;
      drawing = true;
      selectionStart = point(event);
      canvas.setPointerCapture(event.pointerId);
      draw(event);
    });
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", (event) => {
      if (!drawing) return;
      const end = point(event);
      if (state.canvasTool === "select" && selectionStart) {
        const left = Math.min(selectionStart.x, end.x); const top = Math.min(selectionStart.y, end.y);
        const width = Math.abs(end.x - selectionStart.x); const height = Math.abs(end.y - selectionStart.y);
        if (width > 8 && height > 8) {
          visible.fillStyle = "rgba(226,185,70,.34)"; visible.fillRect(left, top, width, height);
          maskContext.globalCompositeOperation = "destination-out"; maskContext.fillRect(left, top, width, height);
          state.maskDataUrl = mask.toDataURL("image/png");
        }
      }
      if (state.canvasTool === "note" && selectionStart) {
        const note = prompt("输入这处需要修改的说明");
        if (note?.trim()) {
          const number = (els.prompt.value.match(/标注\d+：/g) || []).length + 1;
          els.prompt.value = [els.prompt.value.trim(), `标注${number}：${note.trim()}`].filter(Boolean).join("\n");
          els.promptCount.textContent = `${els.prompt.value.length} / 800`;
          visible.fillStyle = "#d6b457"; visible.beginPath(); visible.arc(selectionStart.x, selectionStart.y, 18, 0, Math.PI * 2); visible.fill();
          visible.fillStyle = "#171207"; visible.font = "bold 22px sans-serif"; visible.textAlign = "center"; visible.textBaseline = "middle"; visible.fillText(String(number), selectionStart.x, selectionStart.y + 1);
        }
      }
      drawing = false;
      selectionStart = null;
      snapshot();
    });
    canvas.addEventListener("pointercancel", () => { drawing = false; });
    els.clearMask.onclick = () => { visible.clearRect(0, 0, canvas.width, canvas.height); maskContext.globalCompositeOperation = "source-over"; maskContext.fillStyle = "#000"; maskContext.fillRect(0, 0, mask.width, mask.height); state.maskDataUrl = ""; snapshot(); };
    canvas._maskHistory = { restore, snapshot };
    snapshot();
  };
  if (image.complete) initialize(); else image.addEventListener("load", initialize, { once: true });
}

function setupCanvasMaskEditor() {
  const asset = selectedCanvasAsset();
  const canvas = asset ? $(`[data-mask-asset="${CSS.escape(asset.id)}"]`) : null;
  const node = canvas?.closest(".canvas-node");
  const image = node?.querySelector("img");
  if (!canvas || !node || !image) return;
  const initialize = () => {
    canvas.width = image.naturalWidth || 1024;
    canvas.height = image.naturalHeight || 1024;
    const visible = canvas.getContext("2d");
    const mask = document.createElement("canvas");
    mask.width = canvas.width; mask.height = canvas.height;
    const maskContext = mask.getContext("2d");
    maskContext.fillStyle = "#000"; maskContext.fillRect(0, 0, mask.width, mask.height);
    let drawing = false; let start = null; let selectionBox = null;
    const history = state.maskHistory;
    const snapshot = () => {
      history.splice(state.maskHistoryIndex + 1);
      history.push({ visible: visible.getImageData(0, 0, canvas.width, canvas.height), mask: maskContext.getImageData(0, 0, mask.width, mask.height) });
      if (history.length > 12) history.shift();
      state.maskHistoryIndex = history.length - 1;
    };
    const restore = (index) => {
      const item = history[index]; if (!item) return;
      visible.putImageData(item.visible, 0, 0); maskContext.putImageData(item.mask, 0, 0); state.maskHistoryIndex = index; state.maskDataUrl = mask.toDataURL("image/png");
    };
    const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    const draw = (event) => {
      if (!drawing) return;
      const p = point(event);
      if (state.canvasTool === "mask" || state.canvasTool === "brush") {
        const radius = Number(els.maskBrush?.value || 48) * canvas.width / Math.max(canvas.clientWidth, 1) / 2;
        visible.fillStyle = "rgba(226,185,70,.46)"; visible.beginPath(); visible.arc(p.x, p.y, radius, 0, Math.PI * 2); visible.fill();
        maskContext.globalCompositeOperation = "destination-out"; maskContext.beginPath(); maskContext.arc(p.x, p.y, radius, 0, Math.PI * 2); maskContext.fill();
        state.maskDataUrl = mask.toDataURL("image/png");
      }
      if (["select", "crop"].includes(state.canvasTool) && start) {
        const left = Math.min(start.x, p.x); const top = Math.min(start.y, p.y); const width = Math.abs(p.x - start.x); const height = Math.abs(p.y - start.y);
        visible.clearRect(0, 0, canvas.width, canvas.height); visible.fillStyle = "rgba(214,180,87,.16)"; visible.fillRect(left, top, width, height);
        state.selection = { x: left / canvas.width, y: top / canvas.height, width: width / canvas.width, height: height / canvas.height };
        if (selectionBox) selectionBox.remove();
        selectionBox = document.createElement("div"); selectionBox.className = "canvas-node-selection"; selectionBox.style.left = `${left / canvas.width * 100}%`; selectionBox.style.top = `${top / canvas.height * 100}%`; selectionBox.style.width = `${width / canvas.width * 100}%`; selectionBox.style.height = `${height / canvas.height * 100}%`; node.append(selectionBox);
      }
    };
    canvas.addEventListener("pointerdown", (event) => { drawing = true; start = point(event); canvas.setPointerCapture(event.pointerId); draw(event); });
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", (event) => {
      if (!drawing) return;
      draw(event);
      if (state.canvasTool === "select" && state.selection) {
        maskContext.globalCompositeOperation = "destination-out";
        maskContext.fillRect(state.selection.x * canvas.width, state.selection.y * canvas.height, state.selection.width * canvas.width, state.selection.height * canvas.height);
        state.maskDataUrl = mask.toDataURL("image/png");
      }
      drawing = false; start = null; snapshot();
    });
    canvas.addEventListener("pointercancel", () => { drawing = false; start = null; });
    els.clearMask.onclick = () => { visible.clearRect(0, 0, canvas.width, canvas.height); maskContext.globalCompositeOperation = "source-over"; maskContext.fillStyle = "#000"; maskContext.fillRect(0, 0, mask.width, mask.height); state.maskDataUrl = ""; state.selection = null; selectionBox?.remove(); snapshot(); };
    canvas._maskHistory = { restore, snapshot };
    snapshot();
  };
  if (image.complete) initialize(); else image.addEventListener("load", initialize, { once: true });
}

function renderProjects() {
  const sorted = [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  els.projectList.innerHTML = sorted.map((project) => {
    const assets = state.assets.filter((asset) => asset.projectId === project.id);
    const cover = state.assets.find((asset) => asset.id === project.coverAssetId) || assets.at(-1);
    const tasks = state.tasks.filter((task) => task.projectId === project.id);
    const running = tasks.some((task) => task.status === "running");
    const uncertain = tasks.some((task) => task.status === "uncertain");
    return `<button class="project-card" data-project="${project.id}">${cover ? `<img src="${assetUrl(cover)}" alt="${escapeHtml(project.name)}封面" loading="lazy">` : "<span class=\"project-placeholder\"></span>"}<div><strong>${escapeHtml(project.name)}</strong><p>${assets.length} 张图片 · ${tasks.length} 个任务</p><small>${running ? "正在生成" : uncertain ? "有任务状态未知" : formatTime(project.updatedAt)}</small></div></button>`;
  }).join("");
  if (!sorted.length) els.projectList.innerHTML = `<div class="list-empty-message">还没有历史项目，回到画布添加第一张图片即可创建。</div>`;
  renderRecentProject();
  renderCanvasList();
}

function renderCanvasList() {
  if (!els.canvasList) return;
  const sorted = [...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  els.canvasList.innerHTML = sorted.length ? sorted.map((project) => {
    const cover = state.assets.find((asset) => asset.id === project.coverAssetId) || state.assets.filter((asset) => asset.projectId === project.id).at(-1);
    return `<article class="canvas-list-item ${project.id === state.currentProjectId ? "active" : ""}"><button type="button" class="canvas-switch" data-project="${project.id}">${cover ? `<img src="${assetUrl(cover)}" alt="">` : `<span><svg><use href="#i-image"/></svg></span>`}<div><strong>${escapeHtml(project.name)}</strong><small>${formatTime(project.updatedAt)}</small></div></button><div class="canvas-item-actions"><button type="button" data-canvas-action="rename" data-canvas-id="${project.id}">重命名</button><button type="button" data-canvas-action="duplicate" data-canvas-id="${project.id}">复制</button><button type="button" class="danger" data-canvas-action="delete" data-canvas-id="${project.id}">删除</button></div></article>`;
  }).join("") : `<div class="list-empty-message">还没有保存的画布</div>`;
}

async function manageCanvas(action, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  if (action === "rename") {
    const name = prompt("输入新的画布名称", project.name)?.trim();
    if (!name || name === project.name) return;
    project.name = name.slice(0, 40);
    project.updatedAt = new Date().toISOString();
    await dbPut("projects", project);
    renderProjects(); renderComposer();
    return toast("画布名称已修改");
  }
  if (action === "delete") {
    if (!confirm(`确定删除“${project.name}”吗？\n项目内的图片和任务也会从本机删除。`)) return;
    const assets = state.assets.filter((item) => item.projectId === projectId);
    const tasks = state.tasks.filter((item) => item.projectId === projectId);
    await Promise.all([dbDelete("projects", projectId), ...assets.map((item) => dbDelete("assets", item.id)), ...tasks.map((item) => dbDelete("tasks", item.id))]);
    assets.forEach((asset) => { const url = state.objectUrls.get(asset.id); if (url) URL.revokeObjectURL(url); state.objectUrls.delete(asset.id); });
    state.projects = state.projects.filter((item) => item.id !== projectId);
    state.assets = state.assets.filter((item) => item.projectId !== projectId);
    state.tasks = state.tasks.filter((item) => item.projectId !== projectId);
    if (state.currentProjectId === projectId) resetCanvas();
    renderProjects(); renderTasks(); renderComposer();
    toast("画布已删除");
  }
  if (action === "duplicate") {
    const copyProjectId = crypto.randomUUID();
    const copyProject = { ...project, id: copyProjectId, name: `${project.name} 副本`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverAssetId: null };
    const originals = state.assets.filter((item) => item.projectId === projectId);
    const idMap = new Map(originals.map((item) => [item.id, crypto.randomUUID()]));
    const copies = originals.map((item) => ({ ...item, id: idMap.get(item.id), projectId: copyProjectId, taskId: null, parentId: item.parentId ? (idMap.get(item.parentId) || null) : null, canvas: item.canvas ? { ...item.canvas } : defaultCanvasPlacement(item.kind, copyProjectId, item.parentId) }));
    const cover = copies.find((item) => item.id === idMap.get(project.coverAssetId));
    copyProject.coverAssetId = cover?.id || copies.at(-1)?.id || null;
    await Promise.all([dbPut("projects", copyProject), ...copies.map((item) => dbPut("assets", item))]);
    state.projects.unshift(copyProject); state.assets.push(...copies);
    renderProjects(); renderCanvasList();
    await openProject(copyProjectId);
    toast("画布副本已创建");
  }
}

function renderTasks() {
  const sorted = [...state.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const statusText = (task) => task.status === "running" ? "正在生成，请保持网络连接" : task.status === "success" ? `生成完成并已保存${task.provider ? ` · ${task.provider.toUpperCase()}` : ""}` : task.status === "uncertain" ? "网络中断，状态未知；为避免重复扣费，没有自动重试" : task.error || "生成失败";
  els.taskList.innerHTML = sorted.map((task) => `<article class="task-card"><span class="task-state ${task.status}"><svg><use href="#${task.status === "success" ? "i-check" : task.status === "failed" ? "i-close" : "i-spark"}"/></svg></span><div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(statusText(task))}</p><small>${formatTime(task.createdAt)}</small></div></article>`).join("");
  els.taskBadge.hidden = !state.tasks.some((task) => task.status === "running");
}

function renderSettings() {
  const profiles = state.settings.profiles || [];
  $$('[data-theme-choice]').forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === (state.settings.theme || "system")));
  els.apiProfileList.innerHTML = profiles.map((profile, index) => `<article class="api-profile ${profile.enabled === false ? "disabled" : ""}"><div class="api-profile-main"><span class="priority-number">${index + 1}</span><div><strong>${escapeHtml(profile.label || `接口 ${index + 1}`)}</strong><p>${escapeHtml(profile.baseUrl)}</p><small>${escapeHtml(profile.model || "未填写模型")} · ${profile.apiKey ? `${profile.apiKey.slice(0, 4)}••••${profile.apiKey.slice(-4)}` : "未填写密钥"}</small></div></div><div class="api-profile-actions"><button type="button" data-profile-action="toggle" data-profile-id="${profile.id}">${profile.enabled === false ? "启用" : "停用"}</button><button type="button" data-profile-action="up" data-profile-id="${profile.id}" ${index === 0 ? "disabled" : ""}>上移</button><button type="button" data-profile-action="test" data-profile-id="${profile.id}">测试</button><button type="button" data-profile-action="delete" data-profile-id="${profile.id}">删除</button></div></article>`).join("");
  els.legacyConfigNotice.hidden = !state.settings.legacy;
}

async function openProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.currentProjectId = project.id;
  const lastTask = state.tasks.filter((task) => task.projectId === project.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const selectedTool = tools.find((tool) => tool.id === project.selectedToolId);
  if (project.selectedToolId && !selectedTool) {
    project.selectedToolId = null;
    project.designConversation = [];
    project.designBrief = null;
    await dbPut("projects", project);
  }
  state.tool = selectedTool || tools.find((tool) => tool.id === lastTask?.mode) || tools[0];
  state.count = Number(lastTask?.count) || (state.tool.id === "designseries" ? 4 : 1);
  state.resolution = lastTask?.resolution || "2K";
  const projectAssets = state.assets.filter((asset) => asset.projectId === project.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  await migrateVerticalLayout(project, projectAssets);
  projectAssets.forEach(normalizeCanvasAsset);
  if (!project.canvasView) project.canvasView = { x: 24, y: 72, zoom: 1 };
  state.canvas = { ...state.canvas, mode: project.canvasMode || "flow", flowScrollTop: Number(project.flowScrollTop) || 0, ...project.canvasView, pointers: new Map(), gesture: null };
  const source = projectAssets.find((asset) => asset.kind === "source");
  state.primary = source ? { dataUrl: assetUrl(source), name: source.name, assetId: source.id } : null;
  state.selectedCanvasAssetId = source?.id || projectAssets.find((asset) => asset.kind === "reference")?.id || null;
  state.toolSelected = true;
  state.references = projectAssets.filter((asset) => asset.kind === "reference").slice(0, 8).map((asset) => ({ dataUrl: assetUrl(asset), name: asset.name, assetId: asset.id, role: asset.role || "自动判断" }));
  state.maskDataUrl = "";
  els.prompt.value = project.designBrief?.finalPrompt || "";
  els.ratio.value = project.generationSettings?.ratio || lastTask?.ratio || (state.tool.id === "panorama" ? "2:1" : "auto");
  navigate("home");
  renderComposer();
}

function buildPrompt() {
  const style = state.selectedStyle === "不限定" ? "" : `目标风格：${state.selectedStyle}。`;
  const strength = { high: "严格保持输入图片的结构、视角、尺度、门窗和主要物体位置。", medium: "保持主要结构与空间关系，允许优化局部设计。", creative: "保持可识别的空间基础，允许更明显的概念设计发挥。" }[els.structure.value];
  const project = currentProject();
  const user = project?.designBrief?.finalPrompt || project?.designBrief?.summary || "";
  const references = state.references.length ? `参考图使用说明：${state.references.map((item, index) => `第${index + 1}张重点参考${item.role || "自动判断"}`).join("；")}。` : "";
  const angle = ["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(state.tool.id) ? `目标视角：水平旋转${els.yaw.value}度，俯视角${els.pitch.value}度。` : "";
  return [state.tool.prompt, style, strength, references, angle, user, "输出专业、真实、可落地的建筑设计图片。画面中不要出现人物、动物、文字、水印或标志。"].filter(Boolean).join("\n");
}

async function createTask() {
  if (!state.primary && !["custom", "design-derivation"].includes(state.tool.id)) return toast("请先添加底图");
  const project = currentProject();
  if (!directPrompt(project).trim() && !state.primary && !state.references.length) return toast("请先输入要求或添加图片");
  const profiles = (state.settings.profiles || []).filter((profile) => profile.enabled !== false && profile.baseUrl && profile.apiKey && profile.model);
  if (!profiles.length) { if (els.parameter.open) els.parameter.close(); navigate("settings"); return toast("生成前请先导入至少一套完整接口配置"); }
  if (Plugins.Network?.getStatus && !(await Plugins.Network.getStatus()).connected) return toast("当前没有网络，请联网后再生成");
  if (!Plugins.LaoguiNative?.generateImage) return toast("直接生图只能在安卓安装包中使用");
  state.generationSubmitting = true;
  renderGenerationControls();
  const task = {
    id: id("task"), requestId: crypto.randomUUID(), title: state.tool.name, mode: state.tool.id,
    projectId: (await ensureProject()).id, status: "running", createdAt: new Date().toISOString(), error: "",
    prompt: directPrompt(project) || state.tool.prompt,
    sourceAssetId: state.primary?.assetId || null, referenceAssetIds: state.references.map((item) => item.assetId),
    ratio: els.ratio.value, resolution: state.resolution, count: state.count
  };
  state.taskPayloads.set(task.id, {
    prompt: buildPrompt(), size: els.ratio.value, count: state.count, resolution: state.resolution,
    primaryImage: state.primary?.dataUrl || "", maskImage: state.maskDataUrl || "",
    referenceImages: state.references.map((item) => item.dataUrl), parentId: state.primary?.assetId || null,
    profiles
  });
  state.tasks.push(task);
  state.generationSubmitting = false;
  await dbPut("tasks", task);
  renderTasks();
  if (els.parameter.open) els.parameter.close();
  renderCreationFeed();
  requestAnimationFrame(scrollFeedToEnd);
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
      quality: qualityForResolution(payload.resolution),
      resolution: payload.resolution,
      count: payload.count,
      inputImages: [payload.primaryImage, ...payload.referenceImages].filter(Boolean),
      maskImage: payload.maskImage,
      profiles: payload.profiles
    });
    const images = result.imageDataUrls?.length ? result.imageDataUrls : result.imageDataUrl ? [result.imageDataUrl] : [];
    if (!images.length) throw new Error("接口没有返回图片");
    const actual = await inspectImageResolution(images[0]);
    let asset = null;
    for (const [index, imageDataUrl] of images.entries()) {
      asset = await addAsset({ dataUrl: imageDataUrl, name: `${task.title}-${Date.now()}-${index + 1}.png`, kind: task.mode === "remove" || task.mode === "replace" ? "edited" : "generated", mode: task.mode, parentId: payload.parentId, prompt: payload.prompt, projectId: task.projectId, taskId: task.id });
    }
    task.status = "success";
    task.assetId = asset.id;
    task.provider = result.provider || "";
    task.actualResolution = result.actualResolution || actual.tier || task.resolution;
    task.actualQuality = result.actualQuality || qualityForResolution(task.resolution);
    task.downgradeNotice = resolutionRank(task.actualResolution) < resolutionRank(task.resolution) ? `已从 ${task.resolution} 降为 ${task.actualResolution}` : "";
    navigator.vibrate?.([18, 40, 18]);
  } catch (error) {
    task.status = error.code === "REQUEST_UNCERTAIN" || error.data?.uncertain ? "uncertain" : "failed";
    task.error = error.message || "生成失败";
  }
  await dbPut("tasks", task);
  state.taskPayloads.delete(task.id);
  state.generationSubmitting = false;
  renderTasks();
  renderProjects();
  renderComposer();
  if (state.page === "home" && !isFeedNearBottom()) {
    state.newResultsPending = true;
    els.newResults.hidden = false;
  } else if (state.page === "home") {
    scrollFeedToEnd();
  }
}

function isFeedNearBottom() {
  return els.creationFeed.scrollHeight - els.creationFeed.scrollTop - els.creationFeed.clientHeight < 160;
}

function scrollFeedToEnd() {
  els.creationFeed.scrollTo({ top: els.creationFeed.scrollHeight, behavior: "smooth" });
  state.newResultsPending = false;
  els.newResults.hidden = true;
}

function applyEditorTransform() {
  els.imageDialogImage.style.transform = `translate3d(${state.editorX}px, ${state.editorY}px, 0) scale(${state.editorZoom})`;
  els.editorZoomValue.textContent = `${Math.round(state.editorZoom * 100)}%`;
}

function resetEditorTransform() {
  state.editorZoom = 1;
  state.editorX = 0;
  state.editorY = 0;
  applyEditorTransform();
}

function setupImageEditor() {
  const pointers = new Map();
  let gesture = null;
  let lastTouchTap = 0;
  let lastTouchToggle = 0;
  const distance = () => { const points = [...pointers.values()]; return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); };
  const toggleZoom = () => {
    state.editorZoom = state.editorZoom > 1.05 ? 1 : 2;
    if (state.editorZoom === 1) { state.editorX = 0; state.editorY = 0; }
    applyEditorTransform();
  };
  els.imageEditorStage.addEventListener("pointerdown", (event) => {
    if (els.imageDialogImage.hidden) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    els.imageEditorStage.setPointerCapture(event.pointerId);
    if (pointers.size === 2) gesture = { type: "pinch", distance: distance(), zoom: state.editorZoom };
    else gesture = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: state.editorX, y: state.editorY };
  });
  els.imageEditorStage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.type === "pinch") {
      const nextDistance = distance();
      if (!nextDistance) return;
      state.editorZoom = Math.max(1, Math.min(5, gesture.zoom * nextDistance / Math.max(gesture.distance, 1)));
    } else if (gesture.pointerId === event.pointerId && state.editorZoom > 1) {
      state.editorX = gesture.x + event.clientX - gesture.startX;
      state.editorY = gesture.y + event.clientY - gesture.startY;
    }
    applyEditorTransform();
  });
  const finish = (event) => {
    const moved = gesture?.type === "pan" ? Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) : 99;
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      if (event.pointerType === "touch" && moved < 8) {
        const now = Date.now();
        if (now - lastTouchTap < 330) { toggleZoom(); lastTouchToggle = now; lastTouchTap = 0; }
        else lastTouchTap = now;
      }
      gesture = null;
    } else if (pointers.size === 1) {
      const [pointerId, point] = pointers.entries().next().value;
      gesture = { type: "pan", pointerId, startX: point.x, startY: point.y, x: state.editorX, y: state.editorY };
    }
  };
  els.imageEditorStage.addEventListener("pointerup", finish);
  els.imageEditorStage.addEventListener("pointercancel", finish);
  els.imageEditorStage.addEventListener("dblclick", () => { if (Date.now() - lastTouchToggle > 420) toggleZoom(); });
}

async function downloadAsset(asset) {
  if (!asset) return;
  try {
    const project = state.projects.find((item) => item.id === asset.projectId);
    if (isNative && Plugins.LaoguiNative?.saveImage) {
      const dataUrl = asset.blob ? await blobToDataUrl(asset.blob) : asset.dataUrl || asset.webPath || asset.uri;
      await saveToGallery(dataUrl, project?.name || "老鬼AI", asset.name || `老鬼AI-${Date.now()}.png`);
      navigator.vibrate?.(12);
      return toast("图片已保存到手机相册");
    }
    const link = document.createElement("a");
    link.href = assetUrl(asset);
    link.download = asset.name || `老鬼AI-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast("图片已下载");
  } catch (error) {
    toast(`图片保存失败：${error.message || "请检查相册权限或存储空间"}`);
  }
}

async function handleAssetAction(action, assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  if (action === "share") {
    if (Plugins.Share?.share && asset.uri) await Plugins.Share.share({ title: asset.name, url: asset.uri, dialogTitle: "分享设计图片" });
    else toast("当前环境暂不支持系统分享");
    return;
  }
  if (action === "download") return downloadAsset(asset);
  if (action === "compare") {
    const original = state.assets.find((item) => item.id === asset.parentId) || state.assets.find((item) => item.projectId === asset.projectId && item.kind === "source");
    if (!original) return toast("这个结果没有找到可对比的原图");
    els.compareOriginal.src = assetUrl(original);
    els.compareResult.src = assetUrl(asset);
    if (els.imageDialog.open) els.imageDialog.close();
    els.compareDialog.showModal();
    return;
  }
  if (action === "favorite") {
    asset.favorite = !asset.favorite;
    await dbPut("assets", asset);
    renderCreationFeed();
    return;
  }
  if (action === "delete") {
    if (!confirm("只会删除这个项目里的图片，是否继续？")) return;
    state.assets = state.assets.filter((item) => item.id !== asset.id);
    const url = state.objectUrls.get(asset.id);
    if (url) URL.revokeObjectURL(url);
    state.objectUrls.delete(asset.id);
    await dbDelete("assets", asset.id);
    if (state.primary?.assetId === asset.id) state.primary = null;
    state.references = state.references.filter((item) => item.assetId !== asset.id);
    if (state.selectedCanvasAssetId === asset.id) state.selectedCanvasAssetId = null;
    if (state.selectedAssetId === asset.id) state.selectedAssetId = null;
    const project = state.projects.find((item) => item.id === asset.projectId);
    if (project?.coverAssetId === asset.id) {
      project.coverAssetId = state.assets.filter((item) => item.projectId === project.id).at(-1)?.id || null;
      project.updatedAt = new Date().toISOString();
      await dbPut("projects", project);
    }
    renderProjects(); renderComposer();
    toast("已从本地项目中删除");
    return;
  }
  const dataUrl = asset.blob ? await blobToDataUrl(asset.blob) : asset.dataUrl || asset.webPath || asset.uri;
  state.currentProjectId = asset.projectId;
  await openComposer(action === "edit" ? tools.find((tool) => tool.id === "replace") : tools.find((tool) => tool.id === "custom"), { asset: { ...asset, _dataUrl: dataUrl }, reset: true, openParameters: true });
}

function setSelectedAssetAsPrimary(asset, toolId = "custom") {
  if (!asset) return;
  state.selectedCanvasAssetId = asset.id;
  state.selectedAssetId = asset.id;
  state.primary = { dataUrl: assetUrl(asset), name: asset.name, assetId: asset.id };
  state.tool = tools.find((item) => item.id === toolId) || state.tool;
  state.currentProjectId = asset.projectId;
  state.toolSelected = Boolean(currentProject()?.selectedToolId);
}

async function persistCanvasState(asset = null) {
  if (asset) await dbPut("assets", asset);
  const project = state.projects.find((item) => item.id === state.currentProjectId);
  if (!project) return;
  project.canvasView = { x: state.canvas.x, y: state.canvas.y, zoom: state.canvas.zoom };
  project.canvasMode = state.canvas.mode;
  project.flowScrollTop = state.canvas.flowScrollTop || 0;
  project.updatedAt = new Date().toISOString();
  await dbPut("projects", project);
}

function enterCanvasEdit(asset, mode, toolId = "replace") {
  setSelectedAssetAsPrimary(asset, toolId);
  state.canvasTool = mode;
  state.maskDataUrl = "";
  state.selection = null;
  state.maskHistory = [];
  state.maskHistoryIndex = -1;
  els.canvasEditDock.hidden = false;
  els.canvasBrushControl.hidden = !["mask", "brush"].includes(mode);
  els.applyCrop.hidden = mode !== "crop";
  els.canvasToolHint.textContent = mode === "crop" ? "拖出裁剪范围，再点击应用裁剪" : mode === "select" ? "拖出矩形范围，只修改框内内容" : "用手指涂抹需要修改或消除的位置";
  renderComposer();
}

async function applySelectedCrop() {
  const asset = selectedCanvasAsset();
  if (!asset || !state.selection || state.selection.width < .02 || state.selection.height < .02) return toast("请先拖出裁剪范围");
  const image = new Image(); image.src = assetUrl(asset); await image.decode();
  const sx = Math.round(state.selection.x * image.naturalWidth); const sy = Math.round(state.selection.y * image.naturalHeight);
  const sw = Math.max(1, Math.round(state.selection.width * image.naturalWidth)); const sh = Math.max(1, Math.round(state.selection.height * image.naturalHeight));
  const canvas = document.createElement("canvas"); canvas.width = sw; canvas.height = sh; canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = canvas.toDataURL("image/jpeg", .94);
  asset.blob = await dataUrlToBlob(dataUrl); asset.webPath = ""; asset.uri = ""; asset.canvas.width = Math.max(150, Math.round(asset.canvas.width * state.selection.width));
  const oldUrl = state.objectUrls.get(asset.id); if (oldUrl) URL.revokeObjectURL(oldUrl); state.objectUrls.delete(asset.id);
  await dbPut("assets", asset);
  state.primary = { dataUrl, name: asset.name, assetId: asset.id };
  state.canvasTool = "move"; state.selection = null; state.maskDataUrl = ""; els.canvasEditDock.hidden = true;
  renderComposer(); toast("裁剪已应用");
}

async function duplicateCanvasAsset(asset) {
  const copy = await addAsset({ dataUrl: assetUrl(asset), name: `副本-${asset.name}`, kind: asset.kind, mode: asset.mode, parentId: asset.parentId, prompt: asset.prompt, projectId: asset.projectId });
  copy.canvas = { ...normalizeCanvasAsset(asset).canvas, x: asset.canvas.x + 36, y: asset.canvas.y + 36, locked: false };
  await dbPut("assets", copy); state.selectedCanvasAssetId = copy.id; renderComposer(); toast("已复制到画布");
}

async function replaceCanvasImage(file) {
  const asset = state.assets.find((item) => item.id === state.pendingReplaceAssetId);
  if (!asset || !file?.type?.startsWith("image/")) return;
  const raw = await blobToDataUrl(file); asset.blob = await dataUrlToBlob(raw); asset.webPath = ""; asset.uri = ""; asset.name = file.name || asset.name;
  const oldUrl = state.objectUrls.get(asset.id); if (oldUrl) URL.revokeObjectURL(oldUrl); state.objectUrls.delete(asset.id);
  await dbPut("assets", asset); state.pendingReplaceAssetId = null; setSelectedAssetAsPrimary(asset); renderComposer(); toast("图片已替换");
}

async function handleObjectAction(action, assetId = state.selectedCanvasAssetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  if (action === "ai-edit") {
    state.canvasTool = "move"; renderComposer(); await openMobileAiEdit(asset); return;
  }
  if (action === "basic-edit") return openMobileLocalEdit(asset, "basic");
  if (action === "download") return downloadAsset(asset);
  if (action === "more") { if (!els.objectMoreDrawer.open) els.objectMoreDrawer.showModal(); return; }
  if (action === "duplicate") await duplicateCanvasAsset(asset);
  if (action === "compare") await handleAssetAction("compare", asset.id);
  if (action === "share") await handleAssetAction("share", asset.id);
  if (action === "delete") await handleAssetAction("delete", asset.id);
  if (action === "lock") { asset.canvas.locked = !asset.canvas.locked; await dbPut("assets", asset); renderInfiniteCanvas(); toast(asset.canvas.locked ? "图片已锁定" : "图片已解锁"); }
  if (action === "info") alert([asset.name, `类型：${asset.kind}`, asset.prompt ? `生成要求：${asset.prompt}` : "没有生成说明", `创建时间：${formatTime(asset.createdAt)}`].join("\n"));
  if (action === "replace-image") { state.pendingReplaceAssetId = asset.id; els.replaceImage.click(); }
  if (els.objectMoreDrawer.open) els.objectMoreDrawer.close();
}

function openAssetPreview(asset) {
  if (!asset) return;
  state.selectedAssetId = asset.id;
  const url = assetUrl(asset);
  const isPanorama = asset.mode === "panorama";
  els.editorAssetLabel.textContent = asset.name || "双指缩放，拖动查看细节";
  resetEditorTransform();
  els.imageDialogImage.hidden = isPanorama;
  els.panorama.hidden = !isPanorama;
  if (isPanorama && globalThis.pannellum) {
    state.panoramaViewer?.destroy?.();
    state.panoramaViewer = globalThis.pannellum.viewer(els.panorama, { type: "equirectangular", panorama: url, autoLoad: true, showControls: true, compass: false });
  } else {
    els.imageDialogImage.src = url;
  }
  if (!els.imageDialog.open) els.imageDialog.showModal();
}

function setupInfiniteCanvas() {
  if (!els.infiniteCanvas) return;
  let longPressTimer = null;
  let lastTap = { assetId: null, at: 0 };
  const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = null; };
  const pointerDistance = () => { const points = [...state.canvas.pointers.values()]; return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); };
  els.infiniteCanvas.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,textarea,select,.canvas-node-mask")) return;
    if (state.canvas.mode === "flow") {
      const flowNode = event.target.closest(".flow-node[data-asset-id]");
      const flowAsset = flowNode ? state.assets.find((item) => item.id === flowNode.dataset.assetId) : null;
      if (flowAsset && event.pointerType === "touch") {
        const now = Date.now();
        if (lastTap.assetId === flowAsset.id && now - lastTap.at < 340) { openAssetPreview(flowAsset); lastTap = { assetId: null, at: 0 }; return; }
        lastTap = { assetId: flowAsset.id, at: now };
      }
      state.selectedCanvasAssetId = flowAsset?.id || null;
      if (flowAsset) setSelectedAssetAsPrimary(flowAsset, state.tool.id);
      renderInfiniteCanvas();
      return;
    }
    state.canvas.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    els.infiniteCanvas.setPointerCapture(event.pointerId);
    if (state.canvas.pointers.size === 2) {
      cancelLongPress(); state.canvas.gesture = { type: "pinch", distance: pointerDistance(), zoom: state.canvas.zoom, x: state.canvas.x, y: state.canvas.y }; return;
    }
    const node = event.target.closest(".canvas-node[data-asset-id]"); const asset = node ? state.assets.find((item) => item.id === node.dataset.assetId) : null; const handle = event.target.closest("[data-handle]");
    if (asset) {
      state.selectedCanvasAssetId = asset.id; setSelectedAssetAsPrimary(asset, state.tool.id); renderInfiniteCanvas();
      if (asset.canvas.locked) return;
      const type = handle?.dataset.handle || "node";
      state.canvas.gesture = { type, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, asset, x: asset.canvas.x, y: asset.canvas.y, width: asset.canvas.width, rotation: asset.canvas.rotation };
      longPressTimer = setTimeout(() => { if (state.canvas.gesture?.type === "node") handleObjectAction("more", asset.id); }, 560);
      return;
    }
    state.selectedCanvasAssetId = null; state.canvasTool = "move"; renderInfiniteCanvas();
    state.canvas.gesture = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: state.canvas.x, y: state.canvas.y };
  });
  els.infiniteCanvas.addEventListener("pointermove", (event) => {
    if (state.canvas.mode === "flow") return;
    if (!state.canvas.pointers.has(event.pointerId)) return;
    state.canvas.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = state.canvas.gesture; if (!gesture) return;
    if (gesture.type === "pinch") { const distance = pointerDistance(); if (!distance) return; state.canvas.zoom = Math.max(.35, Math.min(2.5, gesture.zoom * distance / Math.max(gesture.distance, 1))); applyCanvasView(); return; }
    if (event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX; const dy = event.clientY - gesture.startY; if (Math.hypot(dx, dy) > 7) cancelLongPress();
    if (gesture.type === "pan") { state.canvas.x = gesture.x + dx; state.canvas.y = gesture.y + dy; applyCanvasView(); return; }
    if (!gesture.asset) return;
    if (gesture.type === "node") { gesture.asset.canvas.x = gesture.x + dx / state.canvas.zoom; gesture.asset.canvas.y = gesture.y + dy / state.canvas.zoom; }
    if (gesture.type === "resize") gesture.asset.canvas.width = Math.max(140, Math.min(620, gesture.width + dx / state.canvas.zoom));
    if (gesture.type === "rotate") gesture.asset.canvas.rotation = gesture.rotation + dx * .45;
    const node = els.canvasNodes.querySelector(`[data-asset-id="${CSS.escape(gesture.asset.id)}"]`); if (node) { node.style.left = `${gesture.asset.canvas.x}px`; node.style.top = `${gesture.asset.canvas.y}px`; node.style.width = `${gesture.asset.canvas.width}px`; node.style.setProperty("--node-rotation", `${gesture.asset.canvas.rotation}deg`); }
    renderCanvasConnections(state.assets.filter((asset) => asset.projectId === state.currentProjectId && !asset.canvas?.hidden));
  });
  const finish = async (event) => {
    if (state.canvas.mode === "flow") return;
    cancelLongPress(); state.canvas.pointers.delete(event.pointerId); const gesture = state.canvas.gesture;
    if (!state.canvas.pointers.size) {
      state.canvas.gesture = null;
      const distance = gesture ? Math.hypot(event.clientX - (gesture.startX || event.clientX), event.clientY - (gesture.startY || event.clientY)) : 99;
      if (gesture?.type === "node" && distance < 8 && event.pointerType === "touch") {
        const now = Date.now();
        if (lastTap.assetId === gesture.asset.id && now - lastTap.at < 340) { openAssetPreview(gesture.asset); lastTap = { assetId: null, at: 0 }; }
        else lastTap = { assetId: gesture.asset.id, at: now };
      }
      await persistCanvasState(gesture?.asset || null); positionContextTools();
    }
  };
  els.infiniteCanvas.addEventListener("pointerup", finish); els.infiniteCanvas.addEventListener("pointercancel", finish);
  els.infiniteCanvas.addEventListener("dblclick", (event) => {
    const node = event.target.closest(".canvas-node[data-asset-id],.flow-node[data-asset-id]");
    if (!node) return;
    event.preventDefault();
    openAssetPreview(state.assets.find((asset) => asset.id === node.dataset.assetId));
  });
  els.infiniteCanvas.addEventListener("wheel", (event) => { if (state.canvas.mode === "flow") return; event.preventDefault(); state.canvas.zoom = Math.max(.35, Math.min(2.5, state.canvas.zoom * (event.deltaY > 0 ? .9 : 1.1))); applyCanvasView(); persistCanvasState(); }, { passive: false });
}

async function saveSettings(event) {
  event.preventDefault();
  const parsed = parseApiConfigText(els.apiConfigInput.value, "导入接口");
  els.settingsStatus.className = "form-status";
  if (!parsed.profiles.length) { els.settingsStatus.textContent = parsed.errors[0] || "没有识别到完整配置，请检查接口地址和 API Key"; els.settingsStatus.classList.add("error"); return; }
  state.settings = { ...state.settings, profiles: normalizeApiProfiles([...(state.settings.profiles || []), ...parsed.profiles]), legacy: false };
  await secureSet(state.settings);
  els.apiConfigInput.value = "";
  renderSettings();
  els.settingsStatus.textContent = `已保存 ${parsed.profiles.length} 套配置，密钥已加密`;
  els.settingsStatus.classList.add("success");
}

async function updateProfile(action, profileId) {
  const profiles = [...(state.settings.profiles || [])];
  const index = profiles.findIndex((item) => item.id === profileId);
  if (index < 0) return;
  if (action === "delete") profiles.splice(index, 1);
  if (action === "toggle") profiles[index] = { ...profiles[index], enabled: profiles[index].enabled === false };
  if (action === "up" && index > 0) [profiles[index - 1], profiles[index]] = [profiles[index], profiles[index - 1]];
  if (action === "test") {
    if (!Plugins.LaoguiNative?.testApiProfile) return toast("接口测试需要在安卓安装包中使用");
    toast("正在测试接口连接");
    try { await Plugins.LaoguiNative.testApiProfile(profiles[index]); toast("接口连接正常"); }
    catch (error) { toast(error.message || "接口连接失败"); }
    return;
  }
  state.settings = { ...state.settings, profiles: profiles.map((item, order) => ({ ...item, priority: order + 1 })), legacy: false };
  await secureSet(state.settings);
  renderSettings();
}

function bindEvents() {
  els.themeButton.addEventListener("click", toggleTheme);
  els.toggleWorkbench.addEventListener("click", () => setWorkbenchCollapsed(!state.workbenchCollapsed));
  els.workspaceMenuButton.addEventListener("click", (event) => { event.stopPropagation(); els.workspaceMenu.hidden = !els.workspaceMenu.hidden; els.taskStatusPanel.hidden = true; });
  els.taskStatusButton.addEventListener("click", (event) => { event.stopPropagation(); els.taskStatusPanel.hidden = !els.taskStatusPanel.hidden; els.workspaceMenu.hidden = true; renderCanvasTasks(); });
  els.canvasMenuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    els.canvasMenu.hidden = !els.canvasMenu.hidden;
    els.canvasMenuButton.setAttribute("aria-expanded", String(!els.canvasMenu.hidden));
    if (!els.canvasMenu.hidden) renderCanvasList();
  });
  els.navs.forEach((button) => button.addEventListener("click", () => { els.workspaceMenu.hidden = true; navigate(button.dataset.nav); }));
  els.canvasModeSwitch?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-canvas-mode]");
    if (button) setCanvasMode(button.dataset.canvasMode);
  });
  document.addEventListener("click", async (event) => {
    if (!event.target.closest("#workspaceMenu,#workspaceMoreButton")) els.workspaceMenu.hidden = true;
    if (!event.target.closest("#taskStatusPanel,#taskStatusButton")) els.taskStatusPanel.hidden = true;
    if (!event.target.closest("#addImageMenu,[data-action='toggle-add-menu']")) els.addImageMenu.hidden = true;
    if (!event.target.closest("#quickParameterPanel,#openParametersButton")) { els.quickParameterPanel.hidden = true; els.openParameters.setAttribute("aria-expanded", "false"); }
    if (!event.target.closest("#toolPopover,#selectCapabilityButton,[data-action='more-tools']")) els.toolPopover.hidden = true;
    const toolButton = event.target.closest("[data-tool]");
    if (toolButton) selectTool(tools.find((tool) => tool.id === toolButton.dataset.tool));
    const recommendedButton = event.target.closest("[data-recommended-tool]");
    if (recommendedButton) selectTool(tools.find((tool) => tool.id === recommendedButton.dataset.recommendedTool));
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.preventDefault();
      const action = actionButton.dataset.action;
      if (action === "toggle-add-menu") {
        els.addImageMenu.hidden = !els.addImageMenu.hidden;
        els.quickParameterPanel.hidden = true;
      }
      if (action === "quick-camera") { await openComposer(tools.find((tool) => tool.id === "photo")); setTimeout(() => captureImage("primary"), 120); }
      if (action === "quick-gallery") { await openComposer(tools.find((tool) => tool.id === "photo")); setTimeout(() => els.galleryPrimary.click(), 120); }
      if (action === "camera-primary") captureImage("primary");
      if (action === "gallery-primary") { els.addImageMenu.hidden = true; els.galleryPrimary.click(); }
      if (action === "camera-reference") captureImage("reference");
      if (action === "gallery-reference") { els.addImageMenu.hidden = true; els.galleryReference.click(); }
      if (action === "new-project") resetCanvas();
      if (action === "more-tools") showToolPopover(selectedCanvasAsset());
      if (action === "close-quick-parameters") { els.quickParameterPanel.hidden = true; els.openParameters.setAttribute("aria-expanded", "false"); }
      if (action === "import-config-file") els.apiConfigFile.click();
    }
    const styleButton = event.target.closest("[data-style]");
    if (styleButton) { state.selectedStyle = styleButton.dataset.style; renderComposer(); }
    const capabilityButton = event.target.closest("[data-capability]");
    if (capabilityButton) {
      selectTool(tools.find((tool) => tool.id === capabilityButton.dataset.capability) || state.tool);
    }
    const resolutionButton = event.target.closest("[data-resolution]");
    if (resolutionButton) { state.resolution = resolutionButton.dataset.resolution; renderComposer(); await persistGenerationSettings(); }
    const countButton = event.target.closest("[data-count]");
    if (countButton) { state.count = Number(countButton.dataset.count); renderComposer(); await persistGenerationSettings(); }
    const ratioButton = event.target.closest("[data-quick-ratio]");
    if (ratioButton) { els.ratio.value = ratioButton.dataset.quickRatio; renderComposer(); await persistGenerationSettings(); }
    const historyScopeButton = event.target.closest("[data-history-scope]");
    if (historyScopeButton) {
      state.historyScope = historyScopeButton.dataset.historyScope;
      document.querySelectorAll("[data-history-scope]").forEach((button) => button.classList.toggle("active", button === historyScopeButton));
      renderCanvasTasks();
    }
    const historyAssetButton = event.target.closest("[data-history-asset]");
    if (historyAssetButton) await focusCanvasAsset(historyAssetButton.dataset.historyAsset);
    const removeButton = event.target.closest("[data-remove-reference]");
    if (removeButton) { state.references.splice(Number(removeButton.dataset.removeReference), 1); renderComposer(); }
    const removePrimaryButton = event.target.closest("[data-remove-primary]");
    if (removePrimaryButton) { state.primary = null; state.selectedCanvasAssetId = null; renderComposer(); }
    const roleButton = event.target.closest("[data-reference-role]");
    if (roleButton) {
      const reference = state.references[Number(roleButton.dataset.referenceRole)];
      if (reference) reference.role = referenceRoles[(referenceRoles.indexOf(reference.role || "自动判断") + 1) % referenceRoles.length];
      renderComposer();
    }
    const projectButton = event.target.closest("[data-project]");
    if (projectButton) await openProject(projectButton.dataset.project);
    const objectAction = event.target.closest("[data-object-action]");
    if (objectAction) await handleObjectAction(objectAction.dataset.objectAction, objectAction.dataset.assetId);
    const canvasAction = event.target.closest("[data-canvas-action]");
    if (canvasAction) await manageCanvas(canvasAction.dataset.canvasAction, canvasAction.dataset.canvasId);
    const themeChoice = event.target.closest("[data-theme-choice]");
    if (themeChoice) {
      state.settings = { ...state.settings, theme: themeChoice.dataset.themeChoice };
      applyTheme(); await secureSet(state.settings); renderSettings();
    }
    const workspaceAction = event.target.closest("[data-workspace-action]");
    if (workspaceAction?.dataset.workspaceAction === "share") {
      const project = state.projects.find((item) => item.id === state.currentProjectId);
      const cover = state.assets.find((item) => item.id === project?.coverAssetId);
      if (project && cover) await handleAssetAction("share", cover.id);
      else toast("项目生成图片后即可分享");
    }
    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      const asset = state.assets.find((item) => item.id === previewButton.dataset.previewAsset);
      openAssetPreview(asset);
    }
    const assetAction = event.target.closest("[data-asset-action]");
    if (assetAction) await handleAssetAction(assetAction.dataset.assetAction, assetAction.dataset.assetId);
    const profileAction = event.target.closest("[data-profile-action]");
    if (profileAction) updateProfile(profileAction.dataset.profileAction, profileAction.dataset.profileId);
    const canvasTool = event.target.closest("[data-canvas-tool]");
    if (canvasTool) {
      if (canvasTool.dataset.canvasTool === "preview" && state.primary) {
        els.imageDialogImage.hidden = false; els.panorama.hidden = true; els.imageDialogImage.src = state.primary.dataUrl; els.imageDialog.showModal();
      } else if (["undo", "redo"].includes(canvasTool.dataset.canvasTool)) {
        const history = $("[data-mask-asset]")?._maskHistory || $("#maskDrawCanvas")?._maskHistory;
        if (!history) return;
        const next = state.maskHistoryIndex + (canvasTool.dataset.canvasTool === "undo" ? -1 : 1);
        if (next < 0 || next >= state.maskHistory.length) toast(canvasTool.dataset.canvasTool === "undo" ? "没有更早的操作" : "没有可重做的操作");
        else history.restore(next);
      } else {
        state.canvasTool = canvasTool.dataset.canvasTool;
        document.querySelectorAll("[data-canvas-tool]").forEach((item) => item.classList.toggle("active", item === canvasTool));
        els.canvasToolHint.textContent = { move: "双指缩放或进入全屏画布查看细节。", select: "拖出矩形范围，生成时只修改范围内内容。", mask: "用手指涂抹需要消除或替换的位置。", note: "点按图片位置并输入修改说明。" }[state.canvasTool] || "";
      }
    }
    const editorAction = event.target.closest("[data-editor-action]");
    if (editorAction) {
      if (editorAction.dataset.editorAction === "reset") resetEditorTransform();
      if (editorAction.dataset.editorAction === "zoom-in") state.editorZoom = Math.min(4, state.editorZoom + .25);
      if (editorAction.dataset.editorAction === "zoom-out") state.editorZoom = Math.max(1, state.editorZoom - .25);
      if (state.editorZoom === 1) { state.editorX = 0; state.editorY = 0; }
      applyEditorTransform();
    }
  });
  els.galleryPrimary.addEventListener("change", () => acceptImages(els.galleryPrimary.files, "primary").finally(() => { els.galleryPrimary.value = ""; }));
  els.galleryReference.addEventListener("change", () => acceptImages(els.galleryReference.files, "reference").finally(() => { els.galleryReference.value = ""; }));
  els.replaceImage.addEventListener("change", () => replaceCanvasImage(els.replaceImage.files?.[0]).finally(() => { els.replaceImage.value = ""; }));
  els.apiConfigFile.addEventListener("change", async () => {
    const file = els.apiConfigFile.files?.[0];
    if (file) els.apiConfigInput.value = await file.text();
    els.apiConfigFile.value = "";
  });
  els.generate.addEventListener("click", createTask);
  els.openParameters.addEventListener("click", (event) => {
    event.stopPropagation();
    els.quickParameterPanel.hidden = !els.quickParameterPanel.hidden;
    els.addImageMenu.hidden = true;
    els.openParameters.setAttribute("aria-expanded", String(!els.quickParameterPanel.hidden));
  });
  els.quickGenerate.addEventListener("click", openGenerationConfirmation);
  els.selectCapability.addEventListener("click", () => showToolPopover(selectedCanvasAsset()));
  els.workspacePrompt.addEventListener("input", () => { els.workspacePromptCount.textContent = String(els.workspacePrompt.value.length); updateDirectPrompt(els.workspacePrompt.value); });
  els.backToEdit.addEventListener("click", () => els.generationConfirm.close());
  els.confirmGenerate.addEventListener("click", async () => {
    if (!isNative || !Plugins.LaoguiNative?.generateImage) {
      els.browserGenerationNotice.hidden = false;
      return toast("浏览器用于界面测试，请在安卓端正式生成");
    }
    els.generationConfirm.close();
    await createTask();
  });
  els.newResults.addEventListener("click", scrollFeedToEnd);
  els.creationFeed.addEventListener("scroll", () => {
    if (state.canvas.mode === "flow") {
      state.canvas.flowScrollTop = els.creationFeed.scrollTop;
      clearTimeout(flowScrollSaveTimer);
      flowScrollSaveTimer = setTimeout(() => {
        const project = currentProject();
        if (project) { project.flowScrollTop = state.canvas.flowScrollTop; dbPut("projects", project); }
      }, 180);
    }
    if (isFeedNearBottom()) { state.newResultsPending = false; els.newResults.hidden = true; }
  });
  els.toolSelect.addEventListener("change", () => {
    selectTool(tools.find((tool) => tool.id === els.toolSelect.value) || state.tool);
  });
  els.prompt.addEventListener("input", () => { els.promptCount.textContent = `${els.prompt.value.length} / 800`; els.workspacePrompt.value = els.prompt.value; updateDirectPrompt(els.prompt.value); });
  els.promptOptimizeToggle.addEventListener("change", () => { state.promptOptimize = els.promptOptimizeToggle.checked; els.quickPromptOptimize.checked = state.promptOptimize; persistGenerationSettings(); });
  els.quickPromptOptimize.addEventListener("change", () => { state.promptOptimize = els.quickPromptOptimize.checked; els.promptOptimizeToggle.checked = state.promptOptimize; persistGenerationSettings(); });
  els.settingsForm.addEventListener("submit", saveSettings);
  [els.yaw, els.pitch].forEach((input) => input.addEventListener("input", () => { els.yawValue.value = `${els.yaw.value}°`; els.pitchValue.value = `${els.pitch.value}°`; }));
  $$('[data-image-action]').forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.imageAction;
    const asset = state.assets.find((item) => item.id === state.selectedAssetId);
    els.imageDialog.close();
    if (action === "edit") await openMobileAiEdit(asset);
    else if (action === "basic-edit") await openMobileLocalEdit(asset, "basic");
    else await handleAssetAction(action, state.selectedAssetId);
  }));
  els.imageDialog.addEventListener("close", () => { state.panoramaViewer?.destroy?.(); state.panoramaViewer = null; els.panorama.textContent = ""; });
  setupImageEditor();
  setupInfiniteCanvas();
  Plugins.App?.addListener?.("backButton", () => {
    if (document.body.classList.contains("basic-editor-open")) return mobileBasicEditor?.close();
    if (document.body.classList.contains("ai-editor-open")) return mobileAiEditor?.close();
    if (document.body.classList.contains("deep-editor-open")) return mobileDeepEditor?.close();
    if (els.imageDialog.open) return els.imageDialog.close();
    if (els.compareDialog.open) return els.compareDialog.close();
    if (els.generationConfirm.open) return els.generationConfirm.close();
    if (!els.toolPopover.hidden) { els.toolPopover.hidden = true; return; }
    if (!els.quickParameterPanel.hidden) { els.quickParameterPanel.hidden = true; return; }
    if (els.parameter.open) return els.parameter.close();
    if (els.objectMoreDrawer.open) return els.objectMoreDrawer.close();
    if (!els.workspaceMenu.hidden) { els.workspaceMenu.hidden = true; return; }
    if (!els.taskStatusPanel.hidden) { els.taskStatusPanel.hidden = true; return; }
    if (!els.canvasMenu.hidden) return closeCanvasMenu();
    if (state.page !== "home") return navigate("home");
    Plugins.App.exitApp?.();
  });
}

async function init() {
  renderTools();
  bindEvents();
  const [projects, assets, tasks, settings] = await Promise.all([
    dbAll("projects"), dbAll("assets"), dbAll("tasks"), secureGet()
  ]);
  state.projects = projects;
  state.assets = assets;
  state.tasks = tasks.map((task) => task.status === "running" ? { ...task, status: "uncertain", error: "应用在生成期间被关闭，无法确认接口是否已经完成" } : task);
  const legacy = Boolean(settings.fhlKey || settings.yybbKey || settings.aiwanwuKey);
  state.settings = { profiles: normalizeApiProfiles(settings.profiles || []), legacy, theme: settings.theme || "system" };
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", syncSystemTheme);
  await Promise.all(state.tasks.filter((task) => task.status === "uncertain").map((task) => dbPut("tasks", task)));
  renderProjects(); renderTasks(); renderSettings(); renderComposer();
  navigate("home");
}

init().catch((error) => toast(error.message || "应用初始化失败"));
