const referenceImageLimit = 8;
const CANVAS_LAYOUT_VERSION = 3;
const CANVAS_WORKSPACE_WIDTH = 3200;
const CANVAS_WORKSPACE_HEIGHT = 2900;
const IMAGE_UPLOAD_PRIMARY_MAX_EDGE = 2400;
const IMAGE_UPLOAD_REFERENCE_MAX_EDGE = 1800;
const IMAGE_PERSISTENCE_MAX_EDGE = 1800;
const IMAGE_UPLOAD_PRIMARY_TARGET_BYTES = 2800 * 1024;
const IMAGE_UPLOAD_REFERENCE_TARGET_BYTES = 1500 * 1024;
const IMAGE_PERSISTENCE_TARGET_BYTES = 1600 * 1024;
const IMAGE_OPTIMIZE_THRESHOLD_BYTES = 900 * 1024;
const imageOptimizationCache = new Map();

const state = {
  clientId: "",
  canvases: [],
  activeCanvasId: "",
  nextCanvasIndex: 1,
  plan: null,
  selectedId: null,
  loadingPlan: false,
  loadingImages: new Set(),
  brief: null,
  mode: "custom",
  primaryImage: null,
  primaryBitmap: null,
  primaryImageAnalysis: null,
  referenceImages: [],
  assets: [],
  selection: null,
  dragStart: null,
  render: null,
  renders: [],
  imageToolResults: [],
  cadResult: null,
  cadResults: [],
  designSeriesAnalysis: null,
  designSeriesResults: [],
  activeTask: null,
  taskTimer: null,
  taskLogs: [],
  taskLogFilter: "all",
  historyPanelOpen: false,
  statusPanelOpen: false,
  imageEndpointHealth: [],
  activeImageBaseUrl: "",
  recommendedImageEndpoint: null,
  runtimeImageEndpoints: [],
  canManageApiSettings: true,
  endpointProbeBusyIds: new Set(),
  endpointAutoProbeAt: 0,
  theme: "night",
  favoriteOutputIds: new Set(),
  compareOutputIds: new Set(),
  selectedScenePreset: null,
  selectedStylePreset: null,
  agentPanelCollapsed: false,
  canvasFloatingCollapsed: false,
  canvasCommandUserEdited: false,
  promptContext: {
    modePreset: "",
    scenePreset: "",
    stylePreset: "",
    panelContext: "",
    quickIntent: ""
  },
  generation: {
    aspect: "source",
    quality: "1k",
    count: 1
  },
  thinkingModeEnabled: true,
  analyzingDesignSeries: false,
  thinking: {
    status: "idle",
    target: "",
    text: "每次生成前，gpt-5.5 会先综合读取参考图、空间约束、材料灯光、构图策略和审美自检，再交给 Image Gen 出图。"
  },
  canvas: {
    layoutVersion: CANVAS_LAYOUT_VERSION,
    x: 48,
    y: 28,
    zoom: 0.86,
    positions: {},
    selectedImage: null,
    imageActionBusy: "",
    panning: null,
    nodeDrag: null,
    panelDropDrag: null
  },
  deepEdit: {
    open: false,
    tool: "box",
    selectedImage: null,
    outputItem: null,
    image: null,
    imageBox: null,
    selection: null,
    strokes: [],
    activeStroke: null,
    dragStart: null,
    prompt: "",
    busy: false
  }
};

const referenceWeightOptions = [
  { value: "default", label: "默认参考", prompt: "正常参考：让 Agent 根据画面内容自由判断用途。" },
  { value: "strong", label: "重点参考", prompt: "重点参考：优先吸收这张图的设计语言和审美判断。" },
  { value: "soft", label: "弱参考", prompt: "弱参考：只取少量可用线索，不覆盖其他输入。" },
  { value: "ignore", label: "忽略这张", prompt: "忽略：不参与本次生成。" }
];

const referenceUsageOptions = [
  { value: "auto", label: "自动判断", prompt: "用户未指定用途，Agent 先整体观察后自行判断可贡献的信息。" },
  { value: "space", label: "空间/构图", prompt: "用户希望重点参考空间组织、镜头构图、尺度和动线关系。" },
  { value: "material", label: "材料/肌理", prompt: "用户希望重点参考材料、纹理、反射、粗糙度和工艺感。" },
  { value: "lighting", label: "灯光/氛围", prompt: "用户希望重点参考光照时段、色温、明暗层次和空间情绪。" },
  { value: "color", label: "色彩/软装", prompt: "用户希望重点参考色彩关系、家具软装、陈列密度和搭配。" },
  { value: "detail", label: "细部/工艺", prompt: "用户希望重点参考节点、收口、装置、家具细节和完成度。" }
];

function normalizeClientMode(mode) {
  return mode === "floorplan" ? "plan-render" : (mode || "custom");
}

const planWorkflowSteps = {
  "plan-axonometric": {
    index: 1,
    label: "平面图转3D平面图",
    outputLabel: "3D平面图",
    inputType: "平面图 / 图纸截图",
    nextModes: ["plan-render"]
  },
  "plan-render": {
    index: 2,
    label: "3D平面图转效果图",
    outputLabel: "人视角效果图",
    inputType: "3D平面图 / 选区",
    nextModes: []
  }
};

const canvasSelectableModes = [
  { mode: "custom", label: "自定义" },
  { mode: "plan-axonometric", label: "平面图转3D" },
  { mode: "plan-render", label: "3D平面转效果图" },
  { mode: "photo", label: "现场图转效果图" },
  { mode: "whitemodel", label: "白模润色" },
  { mode: "sketch", label: "手稿生成实景" },
  { mode: "materialreplace", label: "材质替换" },
  { mode: "lightingadjust", label: "灯光调整" },
  { mode: "styletransfer", label: "风格迁移" }
];

function isPlanWorkflowMode(mode) {
  return Boolean(planWorkflowSteps[normalizeClientMode(mode)]);
}

function nextPlanWorkflowModes(mode) {
  return planWorkflowSteps[normalizeClientMode(mode)]?.nextModes || [];
}

function workflowStepLabel(mode) {
  return planWorkflowSteps[normalizeClientMode(mode)]?.label || workflowButtonMeanings[normalizeClientMode(mode)]?.label || mode;
}

function suggestedModeLabel(mode) {
  return planWorkflowSteps[normalizeClientMode(mode)]?.label || workflowButtonMeanings[normalizeClientMode(mode)]?.label || modeConfig(mode).sourceTitle;
}

function createWorkflowId(mode) {
  return isPlanWorkflowMode(mode) ? `planflow-${Date.now()}-${Math.random().toString(16).slice(2, 7)}` : "";
}

const $ = (id) => document.getElementById(id);

const els = {
  modelStatus: $("modelStatus"),
  homeButton: $("homeButton"),
  settingsButton: $("settingsButton"),
  workspaceHomeButton: $("workspaceHomeButton"),
  workspaceSettingsButton: $("workspaceSettingsButton"),
  appSettingsOverlay: $("appSettingsOverlay"),
  appSettingsModal: document.querySelector(".app-settings-modal"),
  settingsCloseButton: $("settingsCloseButton"),
  homeView: $("homeView"),
  workspaceView: $("workspaceView"),
  workspaceHistoryButton: $("workspaceHistoryButton"),
  workspaceHistoryPanel: $("workspaceHistoryPanel"),
  workspaceHistoryList: $("workspaceHistoryList"),
  workspaceHistoryRefreshButton: $("workspaceHistoryRefreshButton"),
  workspaceHistoryCloseButton: $("workspaceHistoryCloseButton"),
  workspaceStatusButton: $("workspaceStatusButton"),
  workspaceStatusPanel: $("workspaceStatusPanel"),
  workspaceStatusCloseButton: $("workspaceStatusCloseButton"),
  canvasListPanel: $("canvasListPanel"),
  canvasList: $("canvasList"),
  newCanvasButton: $("newCanvasButton"),
  renameCanvasButton: $("renameCanvasButton"),
  deleteCanvasButton: $("deleteCanvasButton"),
  toggleAgentPanelButton: $("toggleAgentPanelButton"),
  agentPanelRailButton: $("agentPanelRailButton"),
  agentPanelContent: $("agentPanelContent"),
  canvasFloatingComposer: $("canvasFloatingComposer"),
  canvasFloatingCollapseButton: $("canvasFloatingCollapseButton"),
  canvasFloatingRestoreButton: $("canvasFloatingRestoreButton"),
  canvasFloatingExpandButton: $("canvasFloatingExpandButton"),
  floatingModeSelect: $("floatingModeSelect"),
  floatingPrimaryUploadButton: $("floatingPrimaryUploadButton"),
  floatingReferenceUploadButton: $("floatingReferenceUploadButton"),
  floatingCanvasCommand: $("floatingCanvasCommand"),
  floatingAspectRatioSelect: $("floatingAspectRatioSelect"),
  floatingQualitySelect: $("floatingQualitySelect"),
  floatingImageCountSelect: $("floatingImageCountSelect"),
  floatingGenerateButton: $("floatingGenerateButton"),
  floatingThinkingModeButton: $("floatingThinkingModeButton"),
  floatingContinueEditButton: $("floatingContinueEditButton"),
  floatingQuickIterationButtons: Array.from(document.querySelectorAll("[data-floating-quick-iteration]")),
  startButtons: Array.from(document.querySelectorAll("[data-start-mode]")),
  projectTitle: $("projectTitle"),
  summaryBlock: $("summaryBlock"),
  directionGrid: $("directionGrid"),
  inspectorContent: $("inspectorContent"),
  selectedName: $("selectedName"),
  nextQuestions: $("nextQuestions"),
  planButton: $("planButton"),
  sampleButton: $("sampleButton"),
  modeTabs: Array.from(document.querySelectorAll(".mode-tab")),
  primaryUploadLabel: $("primaryUploadLabel"),
  referenceUploadLabel: $("referenceUploadLabel"),
  primaryImageInput: $("primaryImageInput"),
  referenceImageInput: $("referenceImageInput"),
  removePrimaryImageButton: $("removePrimaryImageButton"),
  activeModeLabel: $("activeModeLabel"),
  agentBriefInsight: $("agentBriefInsight"),
  agentUploadZone: $("agentUploadZone"),
  uploadPreviewBlock: $("uploadPreviewBlock"),
  presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
  stylePresetButtons: Array.from(document.querySelectorAll("[data-style-preset]")),
  themeButtons: Array.from(document.querySelectorAll("[data-theme-choice]")),
  securitySettingsSummary: $("securitySettingsSummary"),
  storageSummary: $("storageSummary"),
  storageMaintenanceHint: $("storageMaintenanceHint"),
  refreshStorageButton: $("refreshStorageButton"),
  cleanupTestGeneratedButton: $("cleanupTestGeneratedButton"),
  archiveGeneratedButton: $("archiveGeneratedButton"),
  pruneLogsButton: $("pruneLogsButton"),
  refreshApiSettingsButton: $("refreshApiSettingsButton"),
  imageApiLabel: $("imageApiLabel"),
  imageApiBaseUrl: $("imageApiBaseUrl"),
  imageApiKey: $("imageApiKey"),
  imageApiResponsesPath: $("imageApiResponsesPath"),
  saveImageApiEndpointButton: $("saveImageApiEndpointButton"),
  probeImageApiEndpointButton: $("probeImageApiEndpointButton"),
  currentImageEndpointName: $("currentImageEndpointName"),
  currentImageEndpointUrl: $("currentImageEndpointUrl"),
  currentImageEndpointStatus: $("currentImageEndpointStatus"),
  currentImageEndpointMeta: $("currentImageEndpointMeta"),
  imageApiEndpointList: $("imageApiEndpointList"),
  imageOptionsPanel: $("imageOptionsPanel"),
  imageCountOptions: $("imageCountOptions"),
  generationSummaryLabel: $("generationSummaryLabel"),
  aspectRatioSelect: $("aspectRatioSelect"),
  aspectRatioButtons: Array.from(document.querySelectorAll("[data-aspect-ratio]")),
  qualityTierButtons: Array.from(document.querySelectorAll("[data-quality-tier]")),
  imageCountButtons: Array.from(document.querySelectorAll("[data-image-count]")),
  outputWidth: $("outputWidth"),
  outputHeight: $("outputHeight"),
  structureStrength: $("structureStrength"),
  outputType: $("outputType"),
  canvasCommand: $("canvasCommand"),
  canvasGenerateButton: $("canvasGenerateButton"),
  thinkingModeButton: $("thinkingModeButton"),
  continueEditButton: $("continueEditButton"),
  quickIterationButtons: Array.from(document.querySelectorAll("[data-quick-iteration]")),
  assetCount: $("assetCount"),
  resourceLibrary: $("resourceLibrary"),
  selectionCanvas: $("selectionCanvas"),
  emptyCanvasHint: $("emptyCanvasHint"),
  referenceStrip: $("referenceStrip"),
  renderIntent: $("renderIntent"),
  renderButton: $("renderButton"),
  renderResult: $("renderResult"),
  renderResultTitle: $("renderResultTitle"),
  renderResultImage: $("renderResultImage"),
  renderResultLink: $("renderResultLink"),
  infiniteCanvas: $("infiniteCanvas"),
  canvasEmptyState: $("canvasEmptyState"),
  canvasViewport: $("canvasViewport"),
  canvasLinks: $("canvasLinks"),
  canvasNodes: $("canvasNodes"),
  canvasFitButton: $("canvasFitButton"),
  canvasFocusResultsButton: $("canvasFocusResultsButton"),
  canvasMinimap: $("canvasMinimap"),
  zoomOutButton: $("zoomOutButton"),
  zoomInButton: $("zoomInButton"),
  zoomLabel: $("zoomLabel"),
  taskProgressPanel: $("taskProgressPanel"),
  taskProgressTitle: $("taskProgressTitle"),
  taskProgressStatus: $("taskProgressStatus"),
  taskProgressBar: $("taskProgressBar"),
  taskProgressCount: $("taskProgressCount"),
  taskProgressEndpoint: $("taskProgressEndpoint"),
  taskProgressElapsed: $("taskProgressElapsed"),
  taskProgressEvents: $("taskProgressEvents"),
  taskProgressReview: $("taskProgressReview"),
  taskProgressPrompt: $("taskProgressPrompt"),
  outputManagerList: $("outputManagerList"),
  exportOutputsButton: $("exportOutputsButton"),
  taskLogList: $("taskLogList"),
  refreshTaskLogsButton: $("refreshTaskLogsButton"),
  taskLogFilterButtons: Array.from(document.querySelectorAll("[data-task-log-filter]")),
  toast: $("toast")
};

let workflowCanvasFrame = 0;
let canvasLinksFrame = 0;
let pendingCanvasLinkNodes = null;
let canvasMinimapFrame = 0;
let pendingCanvasMinimapNodes = null;
let selectionCanvasFrame = 0;
let settingsReturnFocus = null;
const overlayFocusReturn = new WeakMap();
let restoringCanvasState = false;
let canvasStateSaveTimer = 0;
let loadingCanvasState = false;
let canvasStateSaveInFlight = false;
let canvasStateSavePending = false;
const CANVAS_MIN_ZOOM = 0.35;
const CANVAS_MAX_ZOOM = 1.65;
const CANVAS_BUTTON_ZOOM_STEP = 0.05;
const CANVAS_WHEEL_ZOOM_INTENSITY = 0.00035;
const CANVAS_WHEEL_DELTA_LIMIT = 160;
const CANVAS_STATE_VERSION = 1;
const CLIENT_ID_STORAGE_KEY = "laogui-client-id";
const ENDPOINT_AUTO_PROBE_INTERVAL_MS = 90000;
const RECOVERABLE_API_PATHS = new Set(["/api/generate-image", "/api/render-from-images", "/api/design-series"]);
const TASK_RESULT_POLL_INTERVAL_MS = 2500;
const TASK_RESULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const TASK_RESULT_MISSING_TIMEOUT_MS = 15000;
let endpointAutoProbePromise = null;

function createClientId() {
  if (window.crypto?.randomUUID) return `client-${window.crypto.randomUUID()}`;
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createClientTaskId(path) {
  const slug = String(path || "task").replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "task";
  if (window.crypto?.randomUUID) return `${slug}-${window.crypto.randomUUID()}`;
  return `${slug}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const clientId = createClientId();
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    return clientId;
  } catch {
    return createClientId();
  }
}

function cloneValue(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function dataUrlByteLength(dataUrl = "") {
  const raw = String(dataUrl || "");
  if (!raw) return 0;
  const commaIndex = raw.indexOf(",");
  const payload = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function imageCacheKey(dataUrl = "", label = "") {
  const raw = String(dataUrl || "");
  return `${label}:${raw.length}:${raw.slice(0, 48)}:${raw.slice(-48)}`;
}

function imageMimeFromDataUrl(dataUrl = "") {
  return String(dataUrl).match(/^data:([^;,]+)/)?.[1] || "image/png";
}

function canvasToDataUrlWithinBudget(canvas, { mime = "image/jpeg", targetBytes = 1600 * 1024 } = {}) {
  const outputMime = mime === "image/png" ? "image/png" : "image/jpeg";
  if (outputMime === "image/png") return canvas.toDataURL("image/png");
  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (quality > 0.56 && dataUrlByteLength(dataUrl) > targetBytes) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return dataUrl;
}

async function optimizeImageDataUrl(dataUrl, {
  maxEdge = IMAGE_UPLOAD_REFERENCE_MAX_EDGE,
  targetBytes = IMAGE_UPLOAD_REFERENCE_TARGET_BYTES,
  force = false,
  cacheLabel = "image"
} = {}) {
  const raw = String(dataUrl || "");
  if (!raw.startsWith("data:image")) return raw;
  if (!force && dataUrlByteLength(raw) <= Math.min(targetBytes, IMAGE_OPTIMIZE_THRESHOLD_BYTES)) return raw;
  const key = imageCacheKey(raw, `${cacheLabel}:${maxEdge}:${targetBytes}:${force ? 1 : 0}`);
  if (imageOptimizationCache.has(key)) return imageOptimizationCache.get(key);

  try {
    const image = await loadImage(raw);
    const sourceWidth = image.naturalWidth || image.width || 0;
    const sourceHeight = image.naturalHeight || image.height || 0;
    if (!sourceWidth || !sourceHeight) return raw;

    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);
    const transparent = imageMimeFromDataUrl(raw).includes("png") && hasTransparentPixels(ctx, width, height);
    const optimized = canvasToDataUrlWithinBudget(canvas, {
      mime: transparent ? "image/png" : "image/jpeg",
      targetBytes
    });
    const result = optimized.length < raw.length ? optimized : raw;
    imageOptimizationCache.set(key, result);
    return result;
  } catch {
    return raw;
  }
}

function hasTransparentPixels(ctx, width, height) {
  try {
    const sampleWidth = Math.min(width, 480);
    const sampleHeight = Math.min(height, 480);
    const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 250) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function fileToOptimizedImage(file, options = {}) {
  const originalDataUrl = await fileToDataUrl(file);
  const dataUrl = await optimizeImageDataUrl(originalDataUrl, {
    ...options,
    force: dataUrlByteLength(originalDataUrl) > IMAGE_OPTIMIZE_THRESHOLD_BYTES
  });
  const bitmap = await loadImage(dataUrl);
  return {
    dataUrl,
    bitmap,
    width: bitmap.naturalWidth || bitmap.width || 0,
    height: bitmap.naturalHeight || bitmap.height || 0,
    type: imageMimeFromDataUrl(dataUrl) || file.type || "image/png",
    originalBytes: dataUrlByteLength(originalDataUrl),
    bytes: dataUrlByteLength(dataUrl)
  };
}

function compactPersistedImage(image, role = "reference") {
  if (!image || typeof image !== "object") return image;
  const next = { ...image };
  if (!next.dataUrl && next.url?.startsWith("data:image")) next.dataUrl = next.url;
  const targetBytes = role === "primary" ? IMAGE_UPLOAD_PRIMARY_TARGET_BYTES : IMAGE_PERSISTENCE_TARGET_BYTES;
  if (next.dataUrl && dataUrlByteLength(next.dataUrl) > targetBytes) {
    next.persistenceWarning = "image data is large; optimize upload before remote use";
  }
  return next;
}

function compactCanvasSnapshotForSave(snapshot = {}) {
  const compact = cloneValue(snapshot, {}) || {};
  compact.primaryImage = compactPersistedImage(compact.primaryImage, "primary");
  compact.referenceImages = Array.isArray(compact.referenceImages)
    ? compact.referenceImages.map((image) => compactPersistedImage(image, "reference"))
    : [];
  compact.render = compact.render ? { ...compact.render } : null;
  compact.renders = Array.isArray(compact.renders) ? compact.renders.map((render) => ({ ...render })) : [];
  compact.designSeriesResults = Array.isArray(compact.designSeriesResults)
    ? compact.designSeriesResults.map((render) => ({ ...render }))
    : [];
  compact.imageToolResults = Array.isArray(compact.imageToolResults)
    ? compact.imageToolResults.map((render) => ({ ...render }))
    : [];
  return compact;
}

async function optimizeCanvasSnapshotImages(snapshot = {}) {
  const next = compactCanvasSnapshotForSave(snapshot);
  if (next.primaryImage?.dataUrl) {
    next.primaryImage.dataUrl = await optimizeImageDataUrl(next.primaryImage.dataUrl, {
      maxEdge: IMAGE_PERSISTENCE_MAX_EDGE,
      targetBytes: IMAGE_UPLOAD_PRIMARY_TARGET_BYTES,
      cacheLabel: "persist-primary"
    });
    next.primaryImage.type = imageMimeFromDataUrl(next.primaryImage.dataUrl) || next.primaryImage.type;
  }
  next.referenceImages = await Promise.all((next.referenceImages || []).map(async (image, index) => {
    if (!image?.dataUrl) return image;
    const dataUrl = await optimizeImageDataUrl(image.dataUrl, {
      maxEdge: IMAGE_PERSISTENCE_MAX_EDGE,
      targetBytes: IMAGE_PERSISTENCE_TARGET_BYTES,
      cacheLabel: `persist-reference-${index}`
    });
    return {
      ...image,
      dataUrl,
      type: imageMimeFromDataUrl(dataUrl) || image.type
    };
  }));
  return next;
}

async function canvasStatePayloadForSave() {
  captureActiveCanvasState();
  const canvases = await Promise.all(state.canvases.map(async (record) => ({
    ...record,
    snapshot: await optimizeCanvasSnapshotImages(record.snapshot || blankCanvasSnapshot(record.snapshot?.mode || "custom"))
  })));
  return {
    version: CANVAS_STATE_VERSION,
    clientId: state.clientId,
    activeCanvasId: state.activeCanvasId,
    nextCanvasIndex: state.nextCanvasIndex,
    canvases,
    savedAt: new Date().toISOString()
  };
}

async function compactImageForApi(image, role = "reference", index = 0) {
  if (!image?.dataUrl) return image;
  const isPrimary = role === "primary";
  const dataUrl = await optimizeImageDataUrl(image.dataUrl, {
    maxEdge: isPrimary ? IMAGE_UPLOAD_PRIMARY_MAX_EDGE : IMAGE_UPLOAD_REFERENCE_MAX_EDGE,
    targetBytes: isPrimary ? IMAGE_UPLOAD_PRIMARY_TARGET_BYTES : IMAGE_UPLOAD_REFERENCE_TARGET_BYTES,
    cacheLabel: `api-${role}-${index}`
  });
  return {
    ...image,
    dataUrl,
    type: imageMimeFromDataUrl(dataUrl) || image.type
  };
}

async function prepareApiPayload(payload = {}) {
  const next = cloneValue(payload, {}) || {};
  if (next.primaryImage?.dataUrl) {
    next.primaryImage = await compactImageForApi(next.primaryImage, "primary");
  }
  if (Array.isArray(next.referenceImages)) {
    next.referenceImages = await Promise.all(next.referenceImages.map((image, index) => compactImageForApi(image, "reference", index)));
  }
  return next;
}

function defaultThinkingState() {
  return {
    status: "idle",
    target: "",
    text: "每次生成前，gpt-5.5 会先综合读取参考图、空间约束、材料灯光、构图策略和审美自检，再交给 Image Gen 出图。"
  };
}

function defaultPromptContextForMode(mode = "custom") {
  return {
    modePreset: defaultCanvasCommands?.[mode] || defaultCanvasCommands?.default || "",
    scenePreset: "",
    stylePreset: "",
    panelContext: "",
    quickIntent: ""
  };
}

function defaultCanvasViewState() {
  return {
    layoutVersion: CANVAS_LAYOUT_VERSION,
    x: 48,
    y: 28,
    zoom: 0.86,
    positions: {},
    selectedImage: null,
    imageActionBusy: "",
    panning: null,
    nodeDrag: null,
    panelDropDrag: null
  };
}

function blankCanvasSnapshot(mode = state.mode || "custom") {
  const normalizedMode = normalizeClientMode(mode);
  const config = modeConfig(normalizedMode);
  return {
    plan: null,
    selectedId: null,
    brief: null,
    mode: normalizedMode,
    primaryImage: null,
    primaryImageAnalysis: null,
    referenceImages: [],
    assets: [],
    selection: null,
    render: null,
    renders: [],
    imageToolResults: [],
    cadResult: null,
    cadResults: [],
    designSeriesAnalysis: null,
    designSeriesResults: [],
    favoriteOutputIds: [],
    compareOutputIds: [],
    selectedScenePreset: null,
    selectedStylePreset: null,
    canvasCommandUserEdited: false,
    commandValue: "",
    renderIntentValue: config.intent || "",
    outputTypeValue: config.outputType || "overall render",
    structureStrengthValue: els.structureStrength?.value || "0.82",
    promptContext: defaultPromptContextForMode(normalizedMode),
    generation: { aspect: "source", quality: "1k", count: 1 },
    thinkingModeEnabled: true,
    analyzingDesignSeries: false,
    thinking: defaultThinkingState(),
    canvas: defaultCanvasViewState()
  };
}

function createCanvasRecord(mode = state.mode || "custom") {
  const index = state.nextCanvasIndex;
  state.nextCanvasIndex += 1;
  const createdAt = new Date().toISOString();
  return {
    id: `canvas-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    index,
    title: `画布 ${index}`,
    customTitle: false,
    createdAt,
    updatedAt: createdAt,
    snapshot: blankCanvasSnapshot(mode)
  };
}

function activeCanvasRecord() {
  return state.canvases.find((canvas) => canvas.id === state.activeCanvasId) || null;
}

function activeCanvasFallbackTitle() {
  return activeCanvasRecord()?.title || "画布 1";
}

function ensureCanvasCollection(mode = state.mode || "custom") {
  if (!state.canvases.length) {
    const record = createCanvasRecord(mode);
    state.canvases.push(record);
    state.activeCanvasId = record.id;
  } else if (!activeCanvasRecord()) {
    state.activeCanvasId = state.canvases[0].id;
  }
}

function normalizePersistedCanvasState(savedState) {
  if (!savedState || !Array.isArray(savedState.canvases) || !savedState.canvases.length) return false;
  const canvases = savedState.canvases.map((record, index) => {
    const canvasIndex = Number(record.index || index + 1);
    return {
      id: String(record.id || `canvas-${Date.now()}-${index}`),
      index: canvasIndex,
      title: String(record.title || `画布 ${canvasIndex}`),
      customTitle: Boolean(record.customTitle),
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
      snapshot: record.snapshot || blankCanvasSnapshot(record.snapshot?.mode || "custom")
    };
  });
  state.canvases = canvases;
  state.activeCanvasId = canvases.some((canvas) => canvas.id === savedState.activeCanvasId)
    ? savedState.activeCanvasId
    : canvases[0].id;
  const maxIndex = Math.max(...canvases.map((canvas) => Number(canvas.index) || 0), 0);
  state.nextCanvasIndex = Math.max(Number(savedState.nextCanvasIndex || 1), maxIndex + 1);
  return true;
}

function canvasStatePayload() {
  captureActiveCanvasState();
  return {
    version: CANVAS_STATE_VERSION,
    clientId: state.clientId,
    activeCanvasId: state.activeCanvasId,
    nextCanvasIndex: state.nextCanvasIndex,
    canvases: cloneValue(state.canvases, []),
    savedAt: new Date().toISOString()
  };
}

function canvasStateApiPath() {
  return `/api/canvas-state?clientId=${encodeURIComponent(state.clientId)}`;
}

async function saveCanvasStateNow() {
  if (restoringCanvasState || loadingCanvasState) return;
  if (!state.canvases.length) return;
  if (canvasStateSaveInFlight) {
    canvasStateSavePending = true;
    return;
  }
  canvasStateSaveInFlight = true;
  try {
    const payload = await canvasStatePayloadForSave();
    const response = await fetch(canvasStateApiPath(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "画布自动保存失败");
    }
  } finally {
    canvasStateSaveInFlight = false;
    if (canvasStateSavePending) {
      canvasStateSavePending = false;
      scheduleCanvasStateSave({ delay: 1200 });
    }
  }
}

function scheduleCanvasStateSave({ delay = 700 } = {}) {
  if (restoringCanvasState || loadingCanvasState) return;
  if (state.activeTask?.status === "running") delay = Math.max(delay, 2500);
  clearTimeout(canvasStateSaveTimer);
  canvasStateSaveTimer = setTimeout(() => {
    saveCanvasStateNow().catch(() => {});
  }, delay);
}

async function loadPersistedCanvasState() {
  loadingCanvasState = true;
  try {
    const response = await fetch(canvasStateApiPath());
    const data = await response.json().catch(() => ({}));
    if (data.clientId && data.clientId !== state.clientId) return false;
    if (data.state?.clientId && data.state.clientId !== state.clientId) return false;
    if (!response.ok || !normalizePersistedCanvasState(data.state)) return false;
    await restoreCanvasRecord(activeCanvasRecord());
    scheduleCanvasStateSave({ delay: 120 });
    return true;
  } catch {
    return false;
  } finally {
    loadingCanvasState = false;
  }
}

function captureCanvasSnapshot() {
  const brief = readBrief();
  return {
    plan: cloneValue(state.plan),
    selectedId: state.selectedId,
    brief: cloneValue(brief || state.brief),
    mode: normalizeClientMode(state.mode),
    primaryImage: cloneValue(state.primaryImage),
    primaryImageAnalysis: cloneValue(state.primaryImageAnalysis),
    referenceImages: cloneValue(state.referenceImages, []),
    assets: cloneValue(state.assets, []),
    selection: cloneValue(state.selection),
    render: cloneValue(state.render),
    renders: cloneValue(state.renders, []),
    imageToolResults: cloneValue(state.imageToolResults, []),
    cadResult: cloneValue(state.cadResult),
    cadResults: cloneValue(state.cadResults, []),
    designSeriesAnalysis: cloneValue(state.designSeriesAnalysis),
    designSeriesResults: cloneValue(state.designSeriesResults, []),
    favoriteOutputIds: Array.from(state.favoriteOutputIds || []),
    compareOutputIds: Array.from(state.compareOutputIds || []),
    selectedScenePreset: state.selectedScenePreset,
    selectedStylePreset: state.selectedStylePreset,
    canvasCommandUserEdited: state.canvasCommandUserEdited,
    commandValue: els.canvasCommand?.value || "",
    renderIntentValue: els.renderIntent?.value || "",
    outputTypeValue: els.outputType?.value || "",
    structureStrengthValue: els.structureStrength?.value || "",
    promptContext: cloneValue(state.promptContext, defaultPromptContextForMode(state.mode)),
    generation: cloneValue(state.generation, { aspect: "source", quality: "1k", count: 1 }),
    thinkingModeEnabled: state.thinkingModeEnabled,
    analyzingDesignSeries: state.analyzingDesignSeries,
    thinking: cloneValue(state.thinking, defaultThinkingState()),
    canvas: {
      layoutVersion: state.canvas.layoutVersion || CANVAS_LAYOUT_VERSION,
      x: state.canvas.x,
      y: state.canvas.y,
      zoom: state.canvas.zoom,
      positions: cloneValue(state.canvas.positions, {}),
      selectedImage: cloneValue(state.canvas.selectedImage),
      imageActionBusy: state.canvas.imageActionBusy || "",
      panning: null,
      nodeDrag: null,
      panelDropDrag: null
    }
  };
}

function canvasTitleFromSnapshot(snapshot, record) {
  if (record?.customTitle && String(record.title || "").trim()) return String(record.title).trim();
  const briefName = String(snapshot?.brief?.projectName || "").trim();
  if (briefName) return briefName;
  const renderTitle = String(snapshot?.render?.title || snapshot?.renders?.at?.(-1)?.title || "").trim();
  if (renderTitle) return renderTitle;
  return record?.title || `画布 ${record?.index || state.canvases.length || 1}`;
}

function activeCanvasDisplayTitle() {
  return canvasTitleFromSnapshot({ brief: readBrief(), render: state.render, renders: state.renders }, activeCanvasRecord());
}

function captureActiveCanvasState() {
  if (restoringCanvasState) return;
  const record = activeCanvasRecord();
  if (!record) return;
  record.snapshot = captureCanvasSnapshot();
  record.title = canvasTitleFromSnapshot(record.snapshot, record);
  record.updatedAt = new Date().toISOString();
}

function currentCanvasSummary(record) {
  const snapshot = record?.snapshot;
  const mode = normalizeClientMode(snapshot?.mode || state.mode);
  const resultCount = (snapshot?.renders || []).length + (snapshot?.render?.url ? 1 : 0) + (snapshot?.designSeriesResults || []).length;
  const inputCount = (snapshot?.primaryImage ? 1 : 0) + (snapshot?.referenceImages || []).length;
  const parts = [
    workflowStepLabel(mode),
    inputCount ? `${inputCount} 图` : "空白",
    resultCount ? `${resultCount} 结果` : ""
  ].filter(Boolean);
  return {
    title: canvasTitleFromSnapshot(snapshot, record),
    detail: parts.join(" · ")
  };
}

function liveCanvasSummary(record) {
  const mode = normalizeClientMode(state.mode);
  const brief = readBrief();
  const resultCount = (state.renders.length || 0) + (state.render?.url ? 1 : 0) + (state.designSeriesResults.length || 0);
  const inputCount = (state.primaryImage ? 1 : 0) + state.referenceImages.length;
  return {
    title: canvasTitleFromSnapshot({ brief, render: state.render, renders: state.renders }, record),
    detail: [
      workflowStepLabel(mode),
      inputCount ? `${inputCount} 图` : "空白",
      resultCount ? `${resultCount} 结果` : ""
    ].filter(Boolean).join(" · ")
  };
}

function renderCanvasList() {
  if (!els.canvasList) return;
  if (els.workspaceView?.hidden && !state.canvases.length) return;
  ensureCanvasCollection();
  els.canvasList.innerHTML = state.canvases.map((record) => {
    const active = record.id === state.activeCanvasId;
    const summary = active ? liveCanvasSummary(record) : currentCanvasSummary(record);
    return `
      <button class="canvas-list-item ${active ? "active" : ""}" type="button" role="option" aria-selected="${active}" tabindex="${active ? 0 : -1}" data-canvas-id="${escapeAttr(record.id)}" title="点击切换，双击重命名：${escapeAttr(summary.title)}" aria-label="画布 ${escapeAttr(summary.title)}，${escapeAttr(summary.detail || "空白")}">
        <span class="canvas-list-index">${escapeHtml(record.index)}</span>
        <span class="canvas-list-text">
          <strong>${escapeHtml(summary.title)}</strong>
          <small>${escapeHtml(summary.detail)}</small>
        </span>
      </button>
    `;
  }).join("");
  const taskRunning = state.activeTask?.status === "running";
  if (els.deleteCanvasButton) {
    els.deleteCanvasButton.disabled = state.canvases.length <= 1 || taskRunning;
  }
  if (els.newCanvasButton) {
    els.newCanvasButton.disabled = taskRunning;
  }
  if (els.renameCanvasButton) {
    els.renameCanvasButton.disabled = taskRunning || !activeCanvasRecord();
  }
}

function restoreBriefFields(brief) {
  const nextBrief = cloneValue(brief, {}) || {};
  state.brief = nextBrief;
  [
    "projectName",
    "spaceType",
    "area",
    "location",
    "projectStage",
    "deliveryPurpose",
    "reviewAudience",
    "audience",
    "style",
    "functions",
    "constraints",
    "preserveNotes"
  ].forEach((key) => {
    const input = $(key);
    if (input) input.value = nextBrief[key] || "";
  });
}

async function restoreCanvasRecord(record) {
  if (!record) return;
  const snapshot = record.snapshot || blankCanvasSnapshot();
  restoringCanvasState = true;
  state.loadingPlan = false;
  state.loadingImages = new Set();
  state.selectedId = snapshot.selectedId || null;
  state.plan = cloneValue(snapshot.plan);
  state.mode = normalizeClientMode(snapshot.mode || "custom");
  state.primaryImage = cloneValue(snapshot.primaryImage);
  state.primaryImageAnalysis = cloneValue(snapshot.primaryImageAnalysis);
  state.referenceImages = cloneValue(snapshot.referenceImages, []);
  state.assets = cloneValue(snapshot.assets, []);
  state.selection = cloneValue(snapshot.selection);
  state.render = cloneValue(snapshot.render);
  state.renders = cloneValue(snapshot.renders, []);
  state.imageToolResults = cloneValue(snapshot.imageToolResults, []);
  state.cadResult = cloneValue(snapshot.cadResult);
  state.cadResults = cloneValue(snapshot.cadResults, []);
  state.designSeriesAnalysis = cloneValue(snapshot.designSeriesAnalysis);
  state.designSeriesResults = cloneValue(snapshot.designSeriesResults, []);
  state.favoriteOutputIds = new Set(snapshot.favoriteOutputIds || []);
  state.compareOutputIds = new Set(snapshot.compareOutputIds || []);
  state.selectedScenePreset = snapshot.selectedScenePreset || null;
  state.selectedStylePreset = snapshot.selectedStylePreset || null;
  state.canvasCommandUserEdited = Boolean(snapshot.canvasCommandUserEdited);
  state.promptContext = cloneValue(snapshot.promptContext, defaultPromptContextForMode(state.mode));
  state.generation = {
    aspect: snapshot.generation?.aspect || "source",
    quality: snapshot.generation?.quality || "1k",
    count: clampImageCount(snapshot.generation?.count || 1, state.mode)
  };
  state.thinkingModeEnabled = snapshot.thinkingModeEnabled ?? true;
  state.analyzingDesignSeries = Boolean(snapshot.analyzingDesignSeries);
  state.thinking = cloneValue(snapshot.thinking, defaultThinkingState());
  const snapshotCanvas = cloneValue(snapshot.canvas, {});
  state.canvas = {
    ...defaultCanvasViewState(),
    ...snapshotCanvas
  };
  state.canvas.layoutVersion = Number(snapshotCanvas?.layoutVersion || 1);
  state.canvas.panning = null;
  state.canvas.nodeDrag = null;
  state.canvas.panelDropDrag = null;
  normalizeCanvasLayoutPositions();
  restoreBriefFields(snapshot.brief);

  if (state.primaryImage?.dataUrl) {
    try {
      state.primaryBitmap = await loadImage(state.primaryImage.dataUrl);
    } catch {
      state.primaryBitmap = null;
    }
  } else {
    state.primaryBitmap = null;
  }

  if (els.canvasCommand) els.canvasCommand.value = snapshot.commandValue || "";
  syncModeControls(state.mode);
  if (els.outputType) els.outputType.value = snapshot.outputTypeValue || modeConfig(state.mode).outputType || "overall render";
  if (els.renderIntent) els.renderIntent.value = snapshot.renderIntentValue || withSelectedStyle(modeConfig(state.mode).intent);
  if (els.structureStrength && snapshot.structureStrengthValue) els.structureStrength.value = snapshot.structureStrengthValue;
  els.projectTitle.textContent = activeCanvasDisplayTitle();

  renderReferenceStrip();
  renderGeneratedResult();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  renderCanvasList();
  restoringCanvasState = false;
}

function canvasSwitchBlocked() {
  if (state.activeTask?.status !== "running") return false;
  toast("当前任务进行中，完成后再切换画布");
  return true;
}

async function switchCanvas(id) {
  if (!id || id === state.activeCanvasId) return;
  if (canvasSwitchBlocked()) return;
  const target = state.canvases.find((canvas) => canvas.id === id);
  if (!target) return;
  captureActiveCanvasState();
  state.activeCanvasId = target.id;
  await restoreCanvasRecord(target);
  scheduleCanvasStateSave({ delay: 80 });
  toast(`已切换到 ${target.title}`);
}

async function createNewCanvas() {
  if (canvasSwitchBlocked()) return;
  captureActiveCanvasState();
  const record = createCanvasRecord(state.mode || "custom");
  state.canvases.push(record);
  state.activeCanvasId = record.id;
  await restoreCanvasRecord(record);
  scheduleCanvasStateSave({ delay: 80 });
  toast(`已新建 ${record.title}`);
}

function renameCanvas(id, nextTitle) {
  const record = state.canvases.find((canvas) => canvas.id === id);
  if (!record) return;
  const title = String(nextTitle || "").trim().replace(/\s+/g, " ").slice(0, 36);
  if (!title) {
    toast("画布名称不能为空");
    return;
  }
  record.title = title;
  record.customTitle = true;
  record.updatedAt = new Date().toISOString();
  if (record.id === state.activeCanvasId) {
    els.projectTitle.textContent = title;
  }
  renderCanvasList();
  renderWorkflowCanvas();
  scheduleCanvasStateSave({ delay: 80 });
  toast(`已重命名为 ${title}`);
}

function promptRenameCanvas(id = state.activeCanvasId) {
  const record = state.canvases.find((canvas) => canvas.id === id);
  if (!record || canvasSwitchBlocked()) return;
  const currentTitle = canvasTitleFromSnapshot(record.id === state.activeCanvasId
    ? { brief: readBrief(), render: state.render, renders: state.renders }
    : record.snapshot, record);
  const nextTitle = window.prompt("重命名画布", currentTitle);
  if (nextTitle === null) return;
  renameCanvas(record.id, nextTitle);
}

async function deleteActiveCanvas() {
  if (canvasSwitchBlocked()) return;
  if (state.canvases.length <= 1) {
    toast("至少保留一个画布");
    return;
  }
  const index = state.canvases.findIndex((canvas) => canvas.id === state.activeCanvasId);
  if (index < 0) return;
  const current = state.canvases[index];
  const currentTitle = canvasTitleFromSnapshot({ brief: readBrief(), render: state.render, renders: state.renders }, current);
  if (!window.confirm(`删除「${currentTitle}」？这个画布的输入、参考图和画布组织状态会从当前项目中移除。`)) return;
  const [removed] = state.canvases.splice(index, 1);
  const next = state.canvases[Math.max(0, index - 1)] || state.canvases[0];
  state.activeCanvasId = next.id;
  await restoreCanvasRecord(next);
  scheduleCanvasStateSave({ delay: 80 });
  toast(`已删除 ${removed.title}`);
}

function isFocusableTarget(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element === document.body || element === document.documentElement) return false;
  if (!element.isConnected || element.hidden || element.closest("[hidden]")) return false;
  if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) return false;
  return typeof element.focus === "function";
}

function focusElement(element) {
  if (!isFocusableTarget(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

function focusPanel(panel) {
  if (!panel || panel.hidden) return;
  requestAnimationFrame(() => {
    if (!focusElement(panel)) focusFirstControl(panel);
  });
}

function focusFirstControl(root) {
  if (!root) return false;
  const control = root.querySelector("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
  return focusElement(control);
}

function focusFallbackControl() {
  return focusElement(els.canvasFocusResultsButton)
    || focusElement(els.workspaceStatusButton)
    || focusElement(els.workspaceHistoryButton)
    || focusElement(els.workspaceHomeButton)
    || focusElement(els.homeButton);
}

function syncExpandedState(control, panel, expanded) {
  control?.setAttribute("aria-expanded", String(Boolean(expanded)));
  panel?.setAttribute("aria-hidden", String(!expanded));
}

function isOverlayOpen(id) {
  const overlay = document.getElementById(id);
  return Boolean(overlay && !overlay.hidden);
}

function syncOverlayOpenClass() {
  document.body.classList.toggle(
    "image-preview-open",
    isOverlayOpen("imagePreviewOverlay") || isOverlayOpen("imageCompareOverlay") || isOverlayOpen("deepEditOverlay")
  );
}

function rememberOverlayFocus(overlay) {
  if (!overlay) return;
  const active = document.activeElement;
  if (!overlayFocusReturn.has(overlay) && isFocusableTarget(active) && !overlay.contains(active)) {
    overlayFocusReturn.set(overlay, active);
  }
  overlay.setAttribute("aria-hidden", "false");
}

function restoreOverlayFocus(overlay) {
  if (!overlay) return;
  overlay.setAttribute("aria-hidden", "true");
  const target = overlayFocusReturn.get(overlay);
  overlayFocusReturn.delete(overlay);
  requestAnimationFrame(() => {
    if (target && focusElement(target)) return;
    focusFallbackControl();
  });
}

function focusOverlayControl(overlay, selector) {
  if (!overlay) return;
  requestAnimationFrame(() => {
    if (!focusElement(overlay.querySelector(selector))) focusFirstControl(overlay);
  });
}

function syncModeTabs(mode = state.mode) {
  mode = normalizeClientMode(mode);
  els.modeTabs.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-pressed", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function handleModeTabKeydown(event) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const tabs = els.modeTabs.filter((button) => !button.disabled && !button.hidden);
  const index = tabs.indexOf(event.currentTarget);
  if (index === -1) return;
  event.preventDefault();
  let nextIndex = index;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else nextIndex = (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  focusElement(nextTab);
  setMode(nextTab.dataset.mode);
}

function handleCanvasListKeydown(event) {
  const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End", "Enter", " ", "F2"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(els.canvasList?.querySelectorAll("[data-canvas-id]") || []);
  const index = items.indexOf(event.target.closest("[data-canvas-id]"));
  if (index < 0) return;
  event.preventDefault();
  if (event.key === "F2") {
    promptRenameCanvas(items[index].dataset.canvasId);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    switchCanvas(items[index].dataset.canvasId).catch((error) => toast(error.message));
    return;
  }
  let nextIndex = index;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else nextIndex = (index + (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1) + items.length) % items.length;
  items.forEach((item, itemIndex) => {
    item.tabIndex = itemIndex === nextIndex ? 0 : -1;
  });
  focusElement(items[nextIndex]);
}

const legacyNodePositions = {
  brief: { x: 72, y: 96, w: 320 },
  resources: { x: 72, y: 440, w: 320 },
  source: { x: 72, y: 360, w: 320 },
  selection: { x: 440, y: 420, w: 300 },
  references: { x: 440, y: 96, w: 320 },
  seriesAdvice: { x: 780, y: 96, w: 360 },
  planWorkflow: { x: 780, y: 96, w: 360 },
  command: { x: 780, y: 390, w: 360 },
  think: { x: 1180, y: 96, w: 360 },
  render: { x: 1580, y: 96, w: 420 },
  cad: { x: 1580, y: 96, w: 420 },
  plan: { x: 1180, y: 390, w: 360 },
  direction0: { x: 780, y: 760, w: 320 },
  direction1: { x: 1140, y: 760, w: 320 },
  direction2: { x: 1500, y: 760, w: 320 }
};

const layoutV2NodePositions = {
  brief: { x: 96, y: 96, w: 340 },
  resources: { x: 96, y: 820, w: 340 },
  source: { x: 96, y: 126, w: 340 },
  selection: { x: 96, y: 540, w: 340 },
  references: { x: 476, y: 126, w: 320 },
  seriesAdvice: { x: 820, y: 126, w: 380 },
  planWorkflow: { x: 820, y: 126, w: 380 },
  command: { x: 820, y: 500, w: 380 },
  think: { x: 1240, y: 260, w: 380 },
  render: { x: 1660, y: 126, w: 430 },
  cad: { x: 1660, y: 126, w: 430 },
  plan: { x: 1240, y: 620, w: 380 },
  direction0: { x: 820, y: 940, w: 330 },
  direction1: { x: 1180, y: 940, w: 330 },
  direction2: { x: 1540, y: 940, w: 330 }
};

const defaultNodePositions = {
  brief: { x: 96, y: 96, w: 340 },
  resources: { x: 96, y: 820, w: 340 },
  source: { x: 96, y: 126, w: 340 },
  selection: { x: 96, y: 540, w: 340 },
  references: { x: 476, y: 126, w: 320 },
  seriesAdvice: { x: 1100, y: 126, w: 380 },
  planWorkflow: { x: 1100, y: 126, w: 380 },
  command: { x: 1100, y: 500, w: 380 },
  think: { x: 1520, y: 260, w: 380 },
  render: { x: 1940, y: 126, w: 430 },
  cad: { x: 1940, y: 126, w: 430 },
  plan: { x: 1520, y: 620, w: 380 },
  direction0: { x: 1100, y: 940, w: 330 },
  direction1: { x: 1460, y: 940, w: 330 },
  direction2: { x: 1820, y: 940, w: 330 }
};

function sameCanvasPosition(a, b) {
  if (!a || !b) return false;
  return ["x", "y", "w"].every((key) => Math.round(Number(a[key] || 0)) === Math.round(Number(b[key] || 0)));
}

function defaultDynamicNodePosition(id) {
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item.stepMode || item.mode) === normalizedMode).length;
      return { x: 1940 + (stepIndex - 1) * 470, y: 126 + sameStepIndex * 520, w: 430 };
    }
    return { x: 1940 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1940 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 476 + (index % 2) * 290, y: 126 + Math.floor(index / 2) * 310, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return { x: 1940 + (index % 2) * 470, y: 940 + Math.floor(index / 2) * 560, w: 430 };
  }
  return null;
}

function layoutV2DynamicNodePosition(id) {
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item.stepMode || item.mode) === normalizedMode).length;
      return { x: 1660 + (stepIndex - 1) * 470, y: 126 + sameStepIndex * 520, w: 430 };
    }
    return { x: 1660 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1660 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 476 + (index % 2) * 300, y: 126 + Math.floor(index / 2) * 310, w: 260 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return { x: 1660 + (index % 2) * 470, y: 940 + Math.floor(index / 2) * 560, w: 430 };
  }
  return null;
}

function legacyDynamicNodePosition(id) {
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item.stepMode || item.mode) === normalizedMode).length;
      return { x: 1180 + (stepIndex - 1) * 470, y: 520 + sameStepIndex * 520, w: 420 };
    }
    return { x: 1580 + (index % 2) * 455, y: 96 + Math.floor(index / 2) * 560, w: 420 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1580 + (index % 2) * 455, y: 96 + Math.floor(index / 2) * 560, w: 420 };
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 440 + (index % 2) * 280, y: 96 + Math.floor(index / 2) * 300, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return { x: 1580 + (index % 2) * 455, y: 760 + Math.floor(index / 2) * 560, w: 420 };
  }
  return null;
}

function defaultPositionForNode(id) {
  return defaultDynamicNodePosition(id) || defaultNodePositions[id] || { x: 96, y: 96, w: 340 };
}

function previousPositionsForNode(id) {
  return [
    legacyDynamicNodePosition(id) || legacyNodePositions[id] || null,
    layoutV2DynamicNodePosition(id) || layoutV2NodePositions[id] || null
  ].filter(Boolean);
}

function normalizeCanvasLayoutPositions() {
  if (state.canvas.layoutVersion === CANVAS_LAYOUT_VERSION) return;
  Object.keys(state.canvas.positions || {}).forEach((id) => {
    const current = state.canvas.positions[id];
    if (previousPositionsForNode(id).some((position) => sameCanvasPosition(current, position))) {
      state.canvas.positions[id] = { ...defaultPositionForNode(id) };
    }
  });
  state.canvas.layoutVersion = CANVAS_LAYOUT_VERSION;
}

const sampleBrief = {
  projectName: "城市精品咖啡与买手店",
  spaceType: "咖啡店 + 买手店",
  area: "180 平米",
  location: "上海街角一层临街铺",
  projectStage: "概念提案",
  deliveryPurpose: "甲方汇报",
  reviewAudience: "品牌业主与招商团队",
  audience: "25-40 岁设计从业者、城市白领、内容创作者",
  style: "克制、艺术、可拍照、不过度网红",
  functions: "咖啡吧台、零售展示、快闪陈列、小型沙龙区、可拍摄的主视觉墙、隐藏储物。",
  constraints: "预算中等偏上，避免大面积金色、廉价仿石材、复杂异形施工。",
  preserveNotes: "保留临街通透界面和主要入口动线，避免遮挡橱窗视线。"
};

const sampleAlt = {
  projectName: "山地度假民宿公共区",
  spaceType: "精品民宿大堂 + 餐吧 + 休息区",
  area: "320 平米",
  location: "浙江山地景区，老建筑改造",
  projectStage: "材料方向",
  deliveryPurpose: "客户沟通",
  reviewAudience: "民宿业主与运营团队",
  audience: "周末度假客、亲子家庭、小型企业团建",
  style: "自然、安静、有记忆点，避免网红化",
  functions: "接待前台、早餐区、壁炉休息区、文创零售、亲子阅读角、户外露台连接。",
  constraints: "保留原木梁和石墙，控制施工难度，避免过度做旧和廉价乡村风。",
  preserveNotes: "保留原木梁、石墙和面向山景的开口，把新材料控制为轻介入。"
};

state.brief = {};

const presets = {
  cafe: {
    spaceType: "咖啡店 + 零售展示",
    style: "克制、温暖、可拍照、有消费转化",
    functions: "咖啡吧台、零售陈列、等候区、社交座位、主视觉墙、隐藏储物。",
    command: "生成一版咖啡零售空间效果图，强调吧台转化、陈列层次、自然材质和可传播的主视觉角落。"
  },
  hotel: {
    spaceType: "精品酒店 / 民宿公共区",
    style: "自然、安静、有地域材料记忆点",
    functions: "接待、休息、早餐、壁炉/景观位、文创零售、户外衔接。",
    command: "生成一版精品民宿公共区效果图，保留建筑结构，强调地域材料、低照度灯光和度假停留感。"
  },
  office: {
    spaceType: "办公展厅 / 企业接待",
    style: "专业、克制、技术感、可展示品牌实力",
    functions: "前厅、产品展示、会议、洽谈、开放办公、品牌墙。",
    command: "生成一版办公展厅效果图，强调动线清晰、展示界面、会议洽谈和高质感低饱和材料。"
  },
  residential: {
    spaceType: "住宅改造",
    style: "舒适、自然、收纳友好、长期耐看",
    functions: "客餐厅、厨房、阅读/亲子、收纳、可变工作区。",
    command: "生成一版住宅改造效果图，保留原有空间架构，优化采光、收纳、软装和家庭生活尺度。"
  }
};

const stylePresetDescriptions = {
  "现代简约": "干净线条、少量装饰、清晰收纳、低饱和材料，强调空间比例和秩序。",
  "奶油风": "柔和奶油色、圆润边角、温暖漫反射灯光、轻软家具和低对比材质。",
  "侘寂风": "粗粝肌理、手工感、留白、自然瑕疵、低照度和安静的空间情绪。",
  "新中式": "现代比例结合东方格栅、木作、石材、留白和克制的文化符号。",
  "工业风": "裸露结构、金属、混凝土、轨道灯、粗粝表面和开放空间气质。",
  "复古风": "温暖木色、怀旧家具、复古灯具、织物纹理和有年代感的色彩。",
  "自然原木": "原木、棉麻、自然光、植物、低饱和白灰底和放松的居住气息。",
  "极简主义": "极少元素、隐藏收纳、纯净界面、精确细节和高质量材料接缝。",
  "轻奢风": "石材、金属线条、精致灯光、软包和更高完成度的商业/住宅质感。",
  "未来科技感": "发光界面、金属/玻璃、模块化体块、冷暖对比灯光和流线细节。",
  "商业潮流": "强记忆点、可拍照装置、鲜明材料组合、零售陈列和社交传播场景。",
  "北欧风": "浅木色、白灰基底、舒适家具、自然采光和简洁实用的空间组织。",
  "地中海": "白墙、拱形、陶土、蓝白色彩、粗糙抹灰和度假感光线。",
  "日式": "榻榻米尺度、木格栅、纸感灯光、低家具、自然材料和安静秩序。",
  "东方禅意": "留白、石木水景、低照度、自然肌理和沉静的仪式感。",
  "低饱和高级灰": "灰阶层次、低彩度材料、精确灯光、克制家具和高级商业质感。",
  "艺术展厅风": "白盒子空间、重点照明、艺术陈列、大尺度留白和展览动线。",
  "品牌零售风": "品牌墙、橱窗、陈列岛、强主视觉、灯光引导和转化动线。",
  "度假民宿风": "地域材料、景观面、自然肌理、低节奏休息区和温暖夜间氛围。",
  "城市更新风": "保留旧结构、裸露肌理、新旧材料对比、社区商业和街区记忆。"
};

const aspectRatioMap = {
  "1:1": [1, 1],
  "4:5": [4, 5],
  "3:4": [3, 4],
  "2:3": [2, 3],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "16:9": [16, 9]
};

const qualitySizeMap = {
  "1k": 1024,
  "2k": 2048,
  "4k": 3840
};

const apiQualityMap = {
  "1k": "low",
  "2k": "medium",
  "4k": "high"
};

const planTo3DFixedPrompt = [
  "固定提示词：把上传的平面图生成真实 3D 平面图。",
  "原图是硬布局底图，不是灵感参考；外轮廓、墙体线条/厚度、房间形状、房间相邻关系、门窗开口、门扇方向、楼梯、固定洁具、主要家具脚印、文字尺寸和图纸朝向都不能移动、删除、简化或重画。",
  "只允许在原有二维脚印上向上生成墙体高度、家具体块、地面材质、墙面材质、轻微阴影和空间层次。",
  "镜头必须是完整上帝视角/正交或弱透视轴测 3D 平面图，整张平面完整可读，不要做人视角效果图，不要二维彩平，不要重新设计布局。"
].join("\n");

const workflowButtonMeanings = {
  custom: {
    label: "自定义",
    meaning: "不绑定固定工作流，先判断用户真正需要的产物类型，再根据文字、主图、参考图和画布资源组织生成。",
    referenceUse: "参考图可以作为空间、材料、家具、灯光、色彩、氛围、构图、产品、立面或细节灵感，由 Agent 先整体观察后判断用途。",
    preserve: "没有固定保留对象；如果上传主图，则只保留用户明确要求保留的主体、构图、空间关系或设计信息。",
    change: "根据用户聊天指令生成最合适的产物：效果图、设计系列、材料板、局部编辑、扩图、概念图、产品图或其他视觉方案。"
  },
  "plan-axonometric": {
    label: "平面图转3D平面图",
    meaning: "使用固定提示词，把平面图作为不可改动的硬布局底图，生成真实 3D 平面图。",
    referenceUse: "参考图只可用于材料、色彩和渲染质感，不得覆盖、替换或重新解释原始平面布局。",
    preserve: "严格保留外轮廓、墙体线条/厚度、房间形状、相邻关系、门窗开口、门扇方向、楼梯、固定洁具、主要家具脚印、文字尺寸和图纸朝向。",
    change: "只在原有二维脚印上生成墙体高度、家具体块、地面/墙面材质、轻微阴影和空间层次，输出完整上帝视角/正交或弱透视轴测 3D 平面图。"
  },
  "plan-render": {
    label: "3D平面图转效果图",
    meaning: "把 3D 平面图里的指定区域转成人视角效果图；优先按红框选区生成，未框选时自动选择最适合表达的明确功能区。",
    referenceUse: "参考图用于材料、色彩、灯光、家具语言、陈列和氛围，不覆盖 3D 平面图建立的空间关系和功能区位置。",
    preserve: "保留 3D 平面图的整体空间关系、红框选区或自动选定区域、功能区、主要陈列/家具逻辑和动线。",
    change: "只把选定区域翻译成人视角室内/建筑效果图，明确前中后景和镜头位置，并在输出记录里标明对应区域。"
  },
  floorplan: {
    label: "3D平面图转效果图",
    meaning: "旧版图纸入口已拆分；旧任务自动按“3D平面图转效果图”处理。",
    referenceUse: "参考图用于材料、色彩、灯光、家具语言、陈列和氛围。",
    preserve: "保留输入图中的空间关系、选区、功能区、主要陈列/家具逻辑和动线。",
    change: "生成真实人视角室内/建筑效果图。"
  },
  cad: {
    label: "平面图转CAD",
    meaning: "从平面图图片里提取可复用线段，输出 DXF/SVG。",
    referenceUse: "参考图不参与本地 CAD 提取。",
    preserve: "保留主要水平/垂直墙线、门洞和图纸轮廓。",
    change: "把图片线稿转换为结构化 CAD 线段。"
  },
  cadrender: {
    label: "CAD转效果图",
    meaning: "把 CAD/DXF/SVG 线稿作为硬性空间约束，生成真实建筑或室内效果图。",
    referenceUse: "参考图用于补充材质、家具、灯光、陈列和商业调性。",
    preserve: "保留 CAD 的轴线、墙体、开口、房间关系和尺度逻辑。",
    change: "把线稿转译成可汇报的真实空间画面。"
  },
  designseries: {
    label: "生成设计系列",
    meaning: "从参考图提炼同一个项目的设计DNA，生成统一风格下的深层设计系列：多场域、多角度、多视角、多功能分区设计效果图。",
    referenceUse: "参考图是主要输入，需要判断每张图贡献的空间秩序、材料系统、灯光逻辑、家具语言、色彩、构图、母题和项目气质，再扩展成完整项目场域。",
    preserve: "保留参考图中可复用的设计语言，不直接复制具体画面。",
    change: "生成同一项目下的不同场域、不同功能区、不同机位和不同视距：图片之间必须像入口、公共区、次级功能区、安静区、过渡区、细节节点等连续项目图集，而不是同一个角度的多风格变体。"
  },
  photo: {
    label: "现场图转效果图",
    meaning: "把现场照片作为现状空间，保留真实结构并重新设计材料、灯光、家具和陈列。",
    referenceUse: "参考图用于指导改造方向、材料组合、灯光情绪和软装语言。",
    preserve: "保留现场透视、窗洞、柱网、层高、墙面边界和主要空间体量。",
    change: "替换完成面、家具、灯光和空间氛围。"
  },
  whitemodel: {
    label: "白模润色",
    meaning: "把白模截图转成真实渲染，补充材质、光照、环境和尺度细节。",
    referenceUse: "参考图用于判断目标材料、灯光、家具密度和场景氛围。",
    preserve: "保留白模体块、视角、开口、层级和比例。",
    change: "补全真实材质、灯光、家具和环境。"
  },
  sketch: {
    label: "手稿生成实景",
    meaning: "把草图里的构图和空间意图翻译成真实效果图。",
    referenceUse: "参考图用于补足草图未表达的材料、家具、灯光和风格。",
    preserve: "保留草图的主构图、透视、体块关系和设计意图。",
    change: "把手绘表达转译成真实空间。"
  },
  upscale: {
    label: "画质增强",
    meaning: "算法增强优先，增强已有图片的清晰度、质感、噪点控制和整体观感。",
    referenceUse: "参考图只作为质感/清晰度方向，不改变原图设计。",
    preserve: "保留原图构图、空间、家具、材料和主体内容。",
    change: "通过本地自动色阶、白平衡、降噪、局部对比、锐化和轻量放大提升完成度。"
  },
  detail: {
    label: "细节增强",
    meaning: "在保留原图基础上增强已有空间的材料、灯光、陈列和工艺细节。",
    referenceUse: "参考图用于决定细节密度、材料质感、陈列方式、软装语言和完成度，不改变原空间结构。",
    preserve: "保留原布局、镜头、墙体、开口、主要对象和非选区内容。",
    change: "优先增强选中区域或用户点名对象的细部真实感；未选区时全图克制增强，不新增无关主体。"
  },
  materialreplace: {
    label: "材质替换",
    meaning: "只替换用户指定区域、选区或明确材质系统，不改变空间结构和对象位置。",
    referenceUse: "参考图优先作为新材料、纹理、颜色、反射和工艺节点方向。",
    preserve: "保留几何、透视、物体位置、灯光方向、阴影、空间关系和非目标区域。",
    change: "只替换墙面、地面、顶面、家具或局部材料的颜色、纹理、反射、粗糙度和收口细节。"
  },
  lightingadjust: {
    label: "灯光调整",
    meaning: "只调整光照时段、色温、亮暗层次和空间氛围，不重新设计空间。",
    referenceUse: "参考图用于判断白天、黄昏、夜景、洗墙、重点照明或商业氛围。",
    preserve: "保留空间、材料、家具、构图、结构、对象位置和非灯光内容。",
    change: "调整曝光、阴影、高光、色温、间接光和灯具效果，保持光向物理合理。"
  },
  styletransfer: {
    label: "风格迁移",
    meaning: "保持结构和构图，把整体风格系统迁移到新方向，而不是简单滤镜换色。",
    referenceUse: "参考图用于定义新风格的材料、色彩、家具、灯光和陈列语法。",
    preserve: "保留核心空间结构、镜头、尺度、开口、动线和主要对象位置。",
    change: "系统替换材料、家具、灯具、软装、陈列和色彩语法，并保持新风格可落地。"
  },
  materialboard: {
    label: "材料板生成",
    meaning: "把参考图和空间图归纳为材料、色彩、灯光和软装搭配板。",
    referenceUse: "参考图是材料板的主要来源，需要拆解材质、色彩、纹理、灯光和家具语言。",
    preserve: "保留参考图的设计方向和色彩材质逻辑。",
    change: "输出视觉化材料/色彩/软装提案板，而不是单张空间渲染。"
  },
  sharpen: {
    label: "提高锐化",
    meaning: "本地增强边缘和局部对比，改善模糊或低清截图。",
    referenceUse: "参考图不参与本地锐化。",
    preserve: "保留原图所有空间内容。",
    change: "提高边缘清晰度和局部对比。"
  },
  outpaint: {
    label: "扩图",
    meaning: "保持原图主体、镜头和风格，向外自然扩展画面边界。",
    referenceUse: "参考图用于约束扩展区域的材料、灯光、构图和环境连续性。",
    preserve: "保留原图主体、视角、消失点、风格、材料尺度和光照逻辑。",
    change: "只在画面外补全连续建筑或室内上下文，避免接缝、重复物和透视错位。"
  }
};

const featureOptimizationNotes = {
  custom: "专项优化：这是默认自由预设，不强行套用任何工作流；先判断用户需要的产物类型，再读用户指令、主图、参考图和画布资源。参考图先整体观察，再判断它贡献的是空间、材料、家具、灯光、色彩、氛围、构图、产品、立面还是细节；没有主图时可以直接按参考图和文字生成。",
  "plan-axonometric": `专项优化：${planTo3DFixedPrompt}`,
  "plan-render": "专项优化：基于 3D 平面图的明确区域生成人视角效果图；优先使用红框选区，未框选时自动选择最适合表达且与参考图最接近的功能区；必须标明结果来自哪个区域，并详细描述镜头位置、前景/中景/背景、陈列、灯具、材料和动线关系。",
  floorplan: "专项优化：旧版图纸入口已拆分，旧任务按“3D平面图转效果图”处理；建议先生成3D平面图，再做最终人视角效果图。",
  cad: "专项优化：优先提取长直结构线和主要轮廓，降低文字、家具符号、阴影和纹理干扰；输出作为可描底的第一版 CAD 线稿。",
  cadrender: "专项优化：CAD 线稿作为硬约束，先守住轴线、墙体、开口和房间关系，再补充高度、材质、灯光和家具；最终不能残留 CAD 线。",
  designseries: "专项优化：先把参考图归纳成一个项目的“系列圣经”：项目DNA、空间动线、场域清单、功能分区、材质系统、灯光系统、重复母题、镜头节奏和渲染质感；再把每张图分配为不同场域/功能/机位，例如入口主视觉、公共核心区、次级功能区、安静/私密空间、走廊过渡、材料节点。统一的是风格、材质、灯光、色彩、家具年代和渲染品质；变化的是空间场域、功能分区、镜头方向、视角距离和画面焦点。每张图必须有相邻空间衔接线索，比如门洞、走廊、窗景、同款家具、同一吊顶/墙地材/灯具语言；禁止同一个角度反复变体，禁止一张图换多种风格，禁止每张图重新发明一个新项目。",
  photo: "专项优化：保留现场透视、结构、窗洞、柱网和层高，只改完成面、家具、灯光、陈列和氛围，避免把现场空间改到不成立。",
  whitemodel: "专项优化：保留白模体块、视角、层级和开口，补足材料、灯光、环境和尺度；不要做成灰模截图或随机装饰。",
  sketch: "专项优化：保留草图的构图、透视、体块和设计意图，把模糊线条解析为可建造空间，而不是简单美化线稿。",
  upscale: "专项优化：算法增强优先，只提升清晰度、噪声、局部对比和质感，严格不改变主体、空间、家具、材料和构图。",
  detail: "专项优化：优先增强选区或用户点名对象；未选区时在原布局和镜头不变的前提下克制补充材料纹理、节点、灯光层次、陈列和尺度细节，非目标区域保持不变，避免堆满无意义装饰。",
  materialreplace: "专项优化：优先替换选区或用户点名材料；只替换材料、颜色、纹理、反射和工艺节点，保留几何、透视、光向、阴影、物体位置和非目标区域。",
  lightingadjust: "专项优化：定义单一清晰光照场景，只调整曝光、阴影、色温、间接光和灯具辉光；保留空间、材料、家具、构图和非灯光内容。",
  styletransfer: "专项优化：保留结构、镜头、尺度、开口、动线和主要对象位置，系统替换材料、家具、灯具、软装和陈列语法，不做表面滤镜式换色。",
  materialboard: "专项优化：把参考图拆成材料样、色卡、纹理、灯光氛围和 FF&E 语言，形成有层次的视觉提案板，避免文字和品牌标识。",
  sharpen: "专项优化：本地边缘增强要克制，保留原图内容，避免光晕、颗粒噪声、色偏和过度锐化。",
  outpaint: "专项优化：保持原图主体、透视、消失点、灯光、材料尺度和相机逻辑，只自然补全画面外空间，避免接缝、重复物、透视错位和风格漂移。"
};

const defaultCanvasCommands = {
  default: "生成所需视觉产物。可直接上传参考图，也可以补充输出类型、风格、比例和需要保留的内容。",
  custom: "自由创作默认预设：先判断我需要的是效果图、设计系列、材料板、局部编辑、扩图、概念图、产品图还是其他视觉产物；再结合参考图、画布资源和我的描述生成。不要强行套平面图、现场图或固定室内模板；画面需要干净、清晰、有设计判断。",
  "plan-axonometric": planTo3DFixedPrompt,
  "plan-render": "目标：从3D平面图的明确区域生成人视角效果图。优先使用我框选的红框区域；如果我没有框选，请自动选择与参考图最接近、最适合出图的一个功能区，并标明效果图来自哪个区域。保留整体空间关系、功能区位置、动线和主要家具/陈列逻辑；明确镜头站位、视线方向、前景/中景/背景、家具系统、墙顶地材料、灯具、色温和陈列密度；避免残留平面符号、不合理透视、整张平面图视角和无法判断区域来源。",
  designseries: "目标：从参考图生成同一项目的一套深层设计系列图。先识别每张参考图贡献的空间、材料、灯光、家具、色彩、构图和氛围，再建立同一套项目DNA、空间动线、场域清单、功能分区、重复母题和渲染语言；每张图必须承担不同场域/功能/机位，例如入口主视觉、公共核心区、次级功能区、安静/私密空间、走廊过渡、材料节点。统一的是风格、材质、灯光、色彩、家具年代、设计团队语言和渲染品质；变化的是空间场景、功能分区、视角距离、镜头方向和焦点内容。避免同一个角度反复变体、单一主视觉多版本、拼贴感、单张孤立感和风格漂移。",
  cad: "目标：平面图图片转CAD/SVG底图。优先提取墙体主线、房间边界、开口和长直轮廓；忽略阴影、纹理、家具装饰、照片噪点和无关文字；输出适合继续描底的第一版结构线稿。",
  cadrender: "目标：CAD或图纸线稿转真实空间效果图。把轴线、墙体、开口、房间关系和尺度作为硬约束，再补充层高、材料、灯光、家具和陈列；最终画面不能保留CAD线条或图纸符号。",
  photo: "目标：现场图改造效果图。保留现场透视、结构、窗洞、柱网、层高、墙面边界和主要空间体量；只改完成面、家具、灯光、陈列和氛围；避免移动开口、改变消失点或把现场替换成另一间房。",
  whitemodel: "目标：白模润色成真实设计表现。保留白模体块、视角、层级、开口、比例和空间关系；补充真实材质、灯光、环境、家具和尺度细节；避免灰模截图感、随机装饰和不合理构造。",
  sketch: "目标：手稿/草图转真实空间。保留草图构图、透视、主要体块、开口和设计意图；把含糊线条解析成可建造的建筑/室内元素，并补充材料、光线和尺度；避免只美化线稿或丢失原设计想法。",
  upscale: "目标：本地算法画质增强。保留原图构图、空间、主体、家具、材料和色彩关系；只提升清晰度、白平衡、轻度降噪、局部对比和分辨率观感；避免新增物体、改设计、过度锐化和塑料质感。",
  detail: "目标：细节增强。优先增强选区或用户点名对象；保留原图布局、镜头、墙体、开口、主要对象、非选区和设计方向；补充材质纹理、边缘收口、灯光层次、家具陈列、软装和尺度细节；避免无意义堆满装饰或改变核心结构。",
  materialreplace: "目标：材质替换。只改变用户指定、选区或参考图指向的墙面、地面、顶面、家具或局部材料；保留几何、透视、光向、阴影、物体位置、空间关系和非目标区域；避免变成整体风格重做。",
  lightingadjust: "目标：灯光调整。保留空间、材料、家具、镜头、构图、对象位置和非灯光内容；明确单一光照场景，如白天、阴天、黄昏、夜景、商业展示或民宿氛围；控制曝光、阴影、色温、间接光和灯具辉光；避免窗边过曝、阴影发脏和光向冲突。",
  styletransfer: "目标：风格迁移。保留建筑结构、镜头、尺度、开口、动线和主要对象位置；系统替换材料、家具、灯具、软装、陈列和色彩语法；避免只做滤镜换色、表面换皮或让空间不可识别。",
  materialboard: "目标：材料板生成。把当前图和参考图拆解为材料样、色卡、纹理近景、灯光氛围、家具/灯具/软装语言，并组织成有层级的视觉提案板；避免文字标签、品牌logo、水印和随机拼贴。",
  sharpen: "目标：提高锐化。保留原图所有内容和色彩关系；克制增强边缘清晰度、局部对比和材质纹理；避免光晕、颗粒噪声、色偏、脏边和假细节。",
  outpaint: "目标：扩图。保留原图主体、透视、消失点、镜头高度、材料尺度、灯光方向和风格；只向画面外自然补全建筑/室内上下文、墙顶地延续、家具延伸和环境边界；避免接缝、重复物、透视错位和风格漂移。"
};

function currentCanvasUserPrompt() {
  return els.canvasCommand?.value.trim() || "";
}

function knownSystemCanvasCommands() {
  return new Set([
    ...Object.values(defaultCanvasCommands),
    ...Object.values(state.promptContext || {}).filter(Boolean)
  ]);
}

function clearSystemCanvasCommand() {
  if (!els.canvasCommand) return;
  const current = currentCanvasUserPrompt();
  if (!current || !state.canvasCommandUserEdited || knownSystemCanvasCommands().has(current)) {
    els.canvasCommand.value = "";
    state.canvasCommandUserEdited = false;
  }
}

function setHiddenPromptContext(key, text = "") {
  if (!state.promptContext || !(key in state.promptContext)) return;
  state.promptContext[key] = String(text || "").trim();
  clearSystemCanvasCommand();
}

function clearHiddenPromptContext(key) {
  if (!state.promptContext || !(key in state.promptContext)) return;
  state.promptContext[key] = "";
}

function hiddenCanvasPromptText(overrides = {}) {
  return [
    overrides.modePreset ?? state.promptContext?.modePreset,
    state.promptContext?.scenePreset,
    state.promptContext?.stylePreset,
    state.promptContext?.panelContext,
    state.promptContext?.quickIntent
  ].filter(Boolean).join("\n");
}

function hiddenCanvasPromptBlock(overrides = {}) {
  const hidden = hiddenCanvasPromptText(overrides);
  return hidden
    ? [
        "内部预设提示词（用户界面不显示，但生成时生效）：",
        hidden
      ].join("\n")
    : "";
}

function userPromptPriorityBlock(prompt = currentCanvasUserPrompt(), label = "用户描述") {
  const value = String(prompt || "").trim();
  return value
    ? `${label}（最高优先级；如与任何内部预设、模式模板或参考图推断冲突，以这里为准）：${value}`
    : "";
}

function composeIntentWithPromptContext(parts = [], options = {}) {
  const blocks = Array.isArray(parts) ? parts : [parts];
  return [
    ...blocks,
    hiddenCanvasPromptBlock({ modePreset: options.modePresetOverride }),
    options.includeRenderIntent === false ? "" : els.renderIntent?.value.trim(),
    userPromptPriorityBlock(),
    options.extraUserPrompt ? userPromptPriorityBlock(options.extraUserPrompt, "当前操作用户指令") : ""
  ].filter(Boolean).join("\n");
}

const resourceLibrary = [
  {
    id: "scene-retail-frontage",
    type: "场景",
    title: "临街零售界面",
    image: "/assets/library/scene-retail-frontage.png",
    text: "强化橱窗、入口吸引、第一视线陈列和可拍照主视觉。",
    prompt: "prioritize storefront transparency, entry magnet, layered retail display, hero photo corner"
  },
  {
    id: "scene-hospitality-lounge",
    type: "场景",
    title: "度假休息厅",
    image: "/assets/library/scene-hospitality-lounge.png",
    text: "低节奏停留、景观面、软性座位、壁炉或中心聚集点。",
    prompt: "create a quiet hospitality lounge with landscape-facing seating, soft gathering zones, warm focal point"
  },
  {
    id: "material-microcement-oak",
    type: "材料",
    title: "微水泥 + 橡木",
    image: "/assets/library/material-microcement-oak.png",
    text: "低饱和、耐看、施工友好，适合咖啡、住宅、民宿。",
    prompt: "use warm microcement, natural oak veneer, subtle tactile plaster, restrained beige-gray palette"
  },
  {
    id: "material-stone-metal",
    type: "材料",
    title: "石材 + 拉丝金属",
    image: "/assets/library/material-stone-metal.png",
    text: "更高端的商业质感，适合展厅、买手店、酒店前厅。",
    prompt: "use honed stone, brushed stainless steel, precise shadow gaps, premium commercial detailing"
  },
  {
    id: "lighting-warm-track",
    type: "灯光",
    title: "暖轨道洗墙",
    image: "/assets/library/lighting-warm-track.png",
    text: "轨道灯、洗墙、柜内灯和低位氛围光形成层次。",
    prompt: "use warm track lighting, wall washing, integrated shelf lighting, low ambient glow, clear lighting hierarchy"
  },
  {
    id: "lighting-evening-hospitality",
    type: "灯光",
    title: "夜间酒廊氛围",
    image: "/assets/library/lighting-evening-hospitality.png",
    text: "更暗、更沉浸，强调桌面、吧台、背景墙的重点照明。",
    prompt: "evening hospitality mood, darker ambient light, focused bar and tabletop highlights, cinematic contrast"
  },
  {
    id: "output-client-board",
    type: "输出",
    title: "甲方提案板",
    image: "/assets/library/output-client-board.png",
    text: "画面需要有主视觉、材料逻辑和可汇报的完整度。",
    prompt: "compose as a client presentation hero image with clear design intent and polished proposal quality"
  },
  {
    id: "output-detail-closeup",
    type: "输出",
    title: "节点特写",
    image: "/assets/library/output-detail-closeup.png",
    text: "聚焦材料交接、灯光、家具陈列或局部空间节点。",
    prompt: "generate a close-up detail view emphasizing material junction, lighting, furniture styling and craft"
  }
];

function readBrief() {
  const fallback = state.brief || {};
  const readField = (id, key) => {
    const input = $(id);
    return input ? input.value.trim() : fallback[key] || "";
  };

  return {
    projectName: readField("projectName", "projectName"),
    spaceType: readField("spaceType", "spaceType"),
    area: readField("area", "area"),
    location: readField("location", "location"),
    projectStage: readField("projectStage", "projectStage"),
    deliveryPurpose: readField("deliveryPurpose", "deliveryPurpose"),
    reviewAudience: readField("reviewAudience", "reviewAudience"),
    audience: readField("audience", "audience"),
    style: readField("style", "style"),
    functions: readField("functions", "functions"),
    constraints: readField("constraints", "constraints"),
    preserveNotes: readField("preserveNotes", "preserveNotes")
  };
}

function writeBrief(brief) {
  state.brief = { ...(state.brief || {}), ...brief };
  for (const [key, value] of Object.entries(brief)) {
    const input = $(key);
    if (input) input.value = value;
  }
  els.projectTitle.textContent = activeCanvasDisplayTitle();
  renderWorkflowCanvas();
}

function requestJson(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const detail = data?.details?.error?.message || data?.details?.message || data?.error || "请求失败";
      const error = new Error(detail);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  });
}

function clientScopedApiPath(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}clientId=${encodeURIComponent(state.clientId)}`;
}

function normalizeRecoverableApiResult(path, result) {
  if (path === "/api/generate-image") return { ok: true, image: result };
  if (path === "/api/render-from-images") return { ok: true, render: result };
  if (path === "/api/design-series") return { ok: true, ...(result || {}) };
  return { ok: true, result };
}

function isMissingTaskResultError(error) {
  const message = String(error?.message || "");
  return error?.status === 404 || /not found|missing|404/i.test(message);
}

async function pollTaskResult(path, clientTaskId) {
  const started = Date.now();
  let firstMissingAt = 0;
  while (Date.now() - started < TASK_RESULT_POLL_TIMEOUT_MS) {
    const pollPath = clientScopedApiPath(`/api/task-result?taskId=${encodeURIComponent(clientTaskId)}`);
    try {
      const data = await requestJson(pollPath);
      if (data.status === "success") return normalizeRecoverableApiResult(path, data.result);
      if (data.status === "failed") {
        const detail = data.error?.details?.error?.message || data.error?.details?.message || data.error?.message || "后台任务失败";
        throw new Error(detail);
      }
      firstMissingAt = 0;
    } catch (error) {
      if (isMissingTaskResultError(error)) {
        firstMissingAt ||= Date.now();
        if (Date.now() - firstMissingAt > TASK_RESULT_MISSING_TIMEOUT_MS) throw error;
      } else if (Number(error?.status || 0) >= 500 || isRecoverableApiError(error)) {
        firstMissingAt = 0;
      } else {
        throw error;
      }
    }
    await sleep(TASK_RESULT_POLL_INTERVAL_MS);
  }
  throw new Error("后台任务仍在运行，请稍后打开任务日志查看结果");
}

function isRecoverableApiError(error) {
  const message = String(error?.message || "");
  return !message
    || message === "Failed to fetch"
    || message === "Load failed"
    || message === "NetworkError when attempting to fetch resource."
    || message === "请求失败"
    || /network|fetch|aborted|abort|timeout|连接|断开|请求失败/i.test(message);
}

async function api(path, payload) {
  const compactPayload = await prepareApiPayload(payload);
  const recoverable = RECOVERABLE_API_PATHS.has(path);
  const clientTaskId = recoverable ? createClientTaskId(path) : "";
  const requestPayload = recoverable ? { ...compactPayload, clientTaskId } : compactPayload;
  try {
    const data = await requestJson(clientScopedApiPath(path), {
      method: "POST",
      body: JSON.stringify(requestPayload)
    });
    refreshHealth();
    refreshTaskLogs({ silent: true });
    return data;
  } catch (error) {
    if (!recoverable || !clientTaskId || !isRecoverableApiError(error)) throw error;
    updateActiveTask({
      status: "running",
      event: "连接中断，正在等待后台生成结果"
    });
    toast("连接中断，正在等待后台结果");
    const data = await pollTaskResult(path, clientTaskId);
    refreshHealth();
    refreshTaskLogs({ silent: true });
    return data;
  }
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.imageEndpointHealth = Array.isArray(data.imageEndpointHealth) ? data.imageEndpointHealth : [];
    state.activeImageBaseUrl = data.imageBaseUrl || "";
    state.runtimeImageEndpoints = Array.isArray(data.runtimeImageEndpoints) ? data.runtimeImageEndpoints : state.runtimeImageEndpoints;
    state.recommendedImageEndpoint = data.recommendedImageEndpoint || null;
    const reasoningReady = data.reasoningConfigured ?? data.keyConfigured;
    const imageReady = data.imageConfigured ?? data.keyConfigured;
    const endpointLabel = shortEndpoint(data.imageBaseUrl || data.recommendedImageEndpoint?.baseUrl || "");
    const imageBackendLabel = data.imageBackend === "responses-image-generation-tool" ? "Image Gen" : "Image";
    els.modelStatus.textContent = reasoningReady && imageReady
      ? `${data.reasoningModel} → ${imageBackendLabel}${endpointLabel ? ` · ${endpointLabel}` : ""}`
      : reasoningReady
        ? "未配置生图 Key"
        : imageReady
          ? "未配置思考 Key"
          : "未配置 API Key";
    els.modelStatus.title = reasoningReady && imageReady
      ? `思考：${data.reasoningBaseUrl || "--"}；生图：${data.imageBaseUrl || "--"}；后端：${data.imageBackend || imageBackendLabel}`
      : els.modelStatus.textContent;
    els.modelStatus.className = `status-pill ${reasoningReady && imageReady ? "ready" : "error"}`;
    renderApiSettings();
    renderTaskProgressPanel();
  } catch {
    els.modelStatus.textContent = "服务未连接";
    els.modelStatus.title = "服务未连接";
    els.modelStatus.className = "status-pill error";
  }
}

async function refreshApiSettings({ silent = false } = {}) {
  try {
    const data = await requestJson("/api/settings");
    const settings = data.settings || {};
    state.runtimeImageEndpoints = Array.isArray(settings.imageEndpoints) ? settings.imageEndpoints : [];
    state.imageEndpointHealth = Array.isArray(settings.imageEndpointHealth) ? settings.imageEndpointHealth : state.imageEndpointHealth;
    state.activeImageBaseUrl = settings.activeImageBaseUrl || state.activeImageBaseUrl;
    state.recommendedImageEndpoint = settings.recommendedImageEndpoint || state.recommendedImageEndpoint;
    state.canManageApiSettings = settings.canManageSettings !== false;
    renderSecuritySettings(settings);
    renderApiSettings();
    renderStorageAccess();
    if (!silent) toast("API 设置已刷新");
  } catch (error) {
    if (!silent) toast(error.message);
  }
}

function normalizeEndpointValue(value) {
  return String(value || "").replace(/\/+$/, "");
}

function endpointHealthFor(baseUrl) {
  const normalized = normalizeEndpointValue(baseUrl);
  return state.imageEndpointHealth.find((item) => normalizeEndpointValue(item.baseUrl) === normalized) || null;
}

function endpointLabelFor(baseUrl) {
  const endpoint = (state.runtimeImageEndpoints || []).find((item) => normalizeEndpointValue(item.baseUrl) === normalizeEndpointValue(baseUrl));
  const health = endpointHealthFor(baseUrl);
  return endpoint?.label || health?.label || shortEndpoint(baseUrl) || "--";
}

function endpointStatusInfo(health, { active = false, enabled = true } = {}) {
  if (!enabled) return { label: "已停用", className: "disabled" };
  if (active && health?.status === "available") return { label: "当前连接", className: "available" };
  const status = health?.status || "unknown";
  if (status === "available") return { label: active ? "当前连接" : "可用", className: "available" };
  if (status === "missing_api_key") return { label: "缺少 Key", className: "warning" };
  if (status === "cooling") return { label: "冷却中", className: "warning" };
  if (status === "image_unsupported") return { label: "生图不可用", className: "error" };
  return { label: "未检测", className: "unknown" };
}

function formatEndpointCheckedAt(value) {
  if (!value) return "未检测";
  const time = Number(value);
  const timestamp = Number.isFinite(time) ? time : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "未检测";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "刚刚检测";
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前检测`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前检测`;
  return `${Math.round(seconds / 86400)} 天前检测`;
}

function endpointMetaText(health) {
  if (!health) return "还没有检测记录";
  const parts = [];
  if (health.probeMs) parts.push(`检测 ${Math.round(health.probeMs)}ms`);
  parts.push(`成功 ${health.successes || 0}`);
  parts.push(`失败 ${health.failures || 0}`);
  parts.push(formatEndpointCheckedAt(health.lastProbeAt));
  const errorText = health.lastProbeError || health.lastError || health.imageUnsupportedReason || "";
  if (errorText && health.status !== "available") parts.push(`原因：${errorText}`);
  return parts.join(" · ");
}

function renderCurrentImageEndpoint() {
  if (!els.currentImageEndpointName) return;
  const activeBaseUrl = state.activeImageBaseUrl || state.recommendedImageEndpoint?.baseUrl || "";
  const health = endpointHealthFor(activeBaseUrl) || state.recommendedImageEndpoint || null;
  const statusInfo = endpointStatusInfo(health, { active: Boolean(activeBaseUrl), enabled: true });
  els.currentImageEndpointName.textContent = endpointLabelFor(activeBaseUrl);
  els.currentImageEndpointUrl.textContent = activeBaseUrl ? `${shortEndpoint(activeBaseUrl)} · ${health?.responsesPath || "/v1/responses"}` : "未连接生图端点";
  els.currentImageEndpointUrl.title = activeBaseUrl || "";
  els.currentImageEndpointStatus.textContent = statusInfo.label;
  els.currentImageEndpointStatus.className = `api-endpoint-status ${statusInfo.className}`;
  els.currentImageEndpointMeta.textContent = endpointMetaText(health);
}

function apiSettingsManageMessage() {
  return "公网访问不能修改 API 设置，请在本机 localhost 打开后修改。";
}

function ensureCanManageApiSettings() {
  if (state.canManageApiSettings) return true;
  toast(apiSettingsManageMessage());
  return false;
}

function renderSecuritySettings(settings = {}) {
  if (!els.securitySettingsSummary) return;
  const tokenConfigured = Boolean(settings.publicApiTokenConfigured);
  const corsOrigin = settings.publicApiCorsOrigin || "";
  els.securitySettingsSummary.innerHTML = `
    <div><span>访问口令</span><strong class="${tokenConfigured ? "is-ok" : "is-warn"}">${tokenConfigured ? "已配置" : "未配置"}</strong></div>
    <div><span>CORS</span><strong class="${corsOrigin ? "is-ok" : "is-warn"}">${corsOrigin ? escapeHtml(shortEndpoint(corsOrigin)) : "未限制"}</strong></div>
    <div><span>设置权限</span><strong class="${state.canManageApiSettings ? "is-ok" : "is-readonly"}">${state.canManageApiSettings ? "本机可管理" : "公网只读"}</strong></div>
  `;
}

function renderApiSettingsAccess() {
  const disabled = !state.canManageApiSettings;
  [
    els.imageApiLabel,
    els.imageApiBaseUrl,
    els.imageApiKey,
    els.imageApiResponsesPath,
    els.saveImageApiEndpointButton,
    els.probeImageApiEndpointButton
  ].forEach((control) => {
    if (control) control.disabled = disabled;
  });
  if (els.currentImageEndpointMeta && disabled) {
    const meta = els.currentImageEndpointMeta.textContent || "";
    if (!meta.includes("公网只读")) {
      els.currentImageEndpointMeta.textContent = `${meta} · 公网只读`;
    }
  }
}

function renderStorageSummary(summary = null) {
  if (!els.storageSummary) return;
  if (!summary) {
    els.storageSummary.innerHTML = `
      <div><span>生成图</span><strong>--</strong></div>
      <div><span>归档</span><strong>--</strong></div>
      <div><span>日志</span><strong>--</strong></div>
    `;
    return;
  }
  els.storageSummary.innerHTML = `
    <div><span>生成图</span><strong>${escapeHtml(summary.generated?.formatted || "--")}</strong><small>${escapeHtml(String(summary.generated?.files || 0))} 文件</small></div>
    <div><span>归档</span><strong>${escapeHtml(summary.archive?.formatted || "--")}</strong><small>${escapeHtml(String(summary.archive?.files || 0))} 文件</small></div>
    <div><span>日志</span><strong>${escapeHtml(summary.logs?.formatted || "--")}</strong><small>${escapeHtml(String(summary.logs?.files || 0))} 文件</small></div>
  `;
}

function renderStorageAccess() {
  const disabled = !state.canManageApiSettings;
  [els.cleanupTestGeneratedButton, els.archiveGeneratedButton, els.pruneLogsButton].forEach((button) => {
    if (button) button.disabled = disabled;
  });
  if (els.storageMaintenanceHint) {
    els.storageMaintenanceHint.textContent = disabled
      ? "公网访问为只读；清理、归档和日志裁剪只能在本机 localhost 执行。"
      : "维护操作只允许本机 localhost 执行；归档会移动文件到 archive/generated，不会删除正式作品。";
  }
}

async function refreshStorageSummary({ silent = false } = {}) {
  try {
    const data = await requestJson("/api/storage");
    renderStorageSummary(data.summary);
    renderStorageAccess();
    if (!silent) toast("存储占用已刷新");
  } catch (error) {
    renderStorageSummary(null);
    if (!silent) toast(error.message);
  }
}

async function runStorageMaintenance(action, payload = {}, button = null) {
  if (!ensureCanManageApiSettings()) return;
  setBusy(button, true, "处理中");
  try {
    const data = await requestJson("/api/storage/maintenance", {
      method: "POST",
      body: JSON.stringify({ action, ...payload })
    });
    const detail = data.formattedBytes
      ? `${data.action || action} · ${data.formattedBytes}`
      : data.removed != null
        ? `已移除 ${data.removed} 条日志`
        : "维护完成";
    await refreshStorageSummary({ silent: true });
    toast(detail);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function renderApiSettings() {
  renderCurrentImageEndpoint();
  renderApiSettingsAccess();
  if (!els.imageApiEndpointList) return;
  const endpoints = state.runtimeImageEndpoints || [];
  if (!endpoints.length) {
    const readonlyHint = state.canManageApiSettings ? "" : "公网访问为只读，朋友不能修改 API 配置。";
    els.imageApiEndpointList.innerHTML = `<p class="settings-hint">还没有自定义 Image Gen API，当前使用环境变量里的端点池。${readonlyHint}</p>`;
    return;
  }

  els.imageApiEndpointList.innerHTML = endpoints.map((endpoint) => {
    const health = endpointHealthFor(endpoint.baseUrl);
    const active = normalizeEndpointValue(state.activeImageBaseUrl) === normalizeEndpointValue(endpoint.baseUrl) || health?.active;
    const statusInfo = endpointStatusInfo(health, { active, enabled: endpoint.enabled });
    const probing = state.endpointProbeBusyIds.has(endpoint.id);
    const disabled = !state.canManageApiSettings;
    return `
      <article class="api-endpoint-item ${active ? "active" : ""}">
        <div class="api-endpoint-main">
          <div class="api-endpoint-title-row">
            <strong>${escapeHtml(endpoint.label || endpoint.baseUrl)}</strong>
            <span class="api-endpoint-status ${escapeAttr(statusInfo.className)}">${escapeHtml(statusInfo.label)}</span>
          </div>
          <span title="${escapeAttr(endpoint.baseUrl)}">${escapeHtml(shortEndpoint(endpoint.baseUrl))} · ${escapeHtml(endpoint.responsesPath || "/v1/responses")}</span>
          <small>${escapeHtml(endpoint.keyPreview || "已保存 Key")} · ${escapeHtml(endpointMetaText(health))}</small>
        </div>
        <div class="api-endpoint-actions">
          <button class="text-button" type="button" data-api-endpoint-probe="${escapeAttr(endpoint.id)}" ${probing || disabled ? "disabled" : ""}>${probing ? "检测中" : "检测"}</button>
          <button class="text-button" type="button" data-api-endpoint-activate="${escapeAttr(endpoint.id)}" ${active || disabled ? "disabled" : ""}>启用</button>
          <button class="text-button icon-only" type="button" data-api-endpoint-delete="${escapeAttr(endpoint.id)}" title="删除端点" aria-label="删除端点" ${disabled ? "disabled" : ""}><svg><use href="#icon-trash"></use></svg></button>
        </div>
      </article>
    `;
  }).join("");
}

async function saveImageApiEndpoint() {
  if (!ensureCanManageApiSettings()) return;
  const payload = {
    label: els.imageApiLabel?.value.trim() || "",
    baseUrl: els.imageApiBaseUrl?.value.trim() || "",
    apiKey: els.imageApiKey?.value.trim() || "",
    responsesPath: els.imageApiResponsesPath?.value.trim() || "/v1/responses",
    enabled: true
  };
  setBusy(els.saveImageApiEndpointButton, true, "保存中");
  try {
    const data = await requestJson("/api/settings/image-endpoints", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.runtimeImageEndpoints = data.settings?.imageEndpoints || state.runtimeImageEndpoints;
    state.imageEndpointHealth = data.settings?.imageEndpointHealth || state.imageEndpointHealth;
    state.activeImageBaseUrl = data.settings?.activeImageBaseUrl || payload.baseUrl;
    state.recommendedImageEndpoint = data.settings?.recommendedImageEndpoint || state.recommendedImageEndpoint;
    if (els.imageApiKey) els.imageApiKey.value = "";
    renderApiSettings();
    setBusy(els.saveImageApiEndpointButton, true, "检测中");
    await probeImageApiEndpoints({ silent: true, controlButton: false });
    toast("已保存并完成端点检测");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(els.saveImageApiEndpointButton, false);
  }
}

async function activateImageApiEndpoint(id) {
  if (!ensureCanManageApiSettings()) return;
  try {
    const data = await requestJson(`/api/settings/image-endpoints/${encodeURIComponent(id)}/activate`, { method: "POST" });
    state.runtimeImageEndpoints = data.settings?.imageEndpoints || state.runtimeImageEndpoints;
    state.imageEndpointHealth = data.settings?.imageEndpointHealth || state.imageEndpointHealth;
    state.activeImageBaseUrl = data.settings?.activeImageBaseUrl || state.activeImageBaseUrl;
    state.recommendedImageEndpoint = data.settings?.recommendedImageEndpoint || state.recommendedImageEndpoint;
    renderApiSettings();
    await probeImageApiEndpoint(id, { silent: true });
    refreshHealth();
    toast("已切换生图 API，并完成检测");
  } catch (error) {
    toast(error.message);
  }
}

async function deleteImageApiEndpoint(id) {
  if (!ensureCanManageApiSettings()) return;
  if (!window.confirm("删除这个自定义生图 API 配置？删除后本机不再保存这个端点和 Key。")) return;
  try {
    const data = await requestJson(`/api/settings/image-endpoints/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.runtimeImageEndpoints = data.settings?.imageEndpoints || [];
    state.imageEndpointHealth = data.settings?.imageEndpointHealth || state.imageEndpointHealth;
    state.activeImageBaseUrl = data.settings?.activeImageBaseUrl || state.activeImageBaseUrl;
    state.recommendedImageEndpoint = data.settings?.recommendedImageEndpoint || state.recommendedImageEndpoint;
    renderApiSettings();
    refreshHealth();
    toast("已删除自定义生图 API");
  } catch (error) {
    toast(error.message);
  }
}

async function probeImageApiEndpoints({ silent = false, controlButton = true } = {}) {
  if (!state.canManageApiSettings) {
    if (!silent) toast(apiSettingsManageMessage());
    return false;
  }
  if (controlButton) setBusy(els.probeImageApiEndpointButton, true, "检测中");
  try {
    const data = await requestJson("/api/image-endpoints/probe", {
      method: "POST",
      body: JSON.stringify({ autoActivate: true })
    });
    state.imageEndpointHealth = Array.isArray(data.imageEndpointHealth) ? data.imageEndpointHealth : [];
    state.activeImageBaseUrl = data.imageBaseUrl || state.activeImageBaseUrl;
    state.recommendedImageEndpoint = data.recommendedImageEndpoint || state.recommendedImageEndpoint;
    state.endpointAutoProbeAt = Date.now();
    renderApiSettings();
    refreshHealth();
    if (!silent) toast("端点检测完成");
    return true;
  } catch (error) {
    if (!silent) toast(error.message);
    return false;
  } finally {
    if (controlButton) setBusy(els.probeImageApiEndpointButton, false);
  }
}

async function probeImageApiEndpoint(id, { silent = false } = {}) {
  if (!id) return false;
  if (!state.canManageApiSettings) {
    if (!silent) toast(apiSettingsManageMessage());
    return false;
  }
  state.endpointProbeBusyIds.add(id);
  renderApiSettings();
  try {
    const data = await requestJson("/api/image-endpoints/probe", {
      method: "POST",
      body: JSON.stringify({ endpointId: id, autoActivate: false })
    });
    state.imageEndpointHealth = Array.isArray(data.imageEndpointHealth) ? data.imageEndpointHealth : state.imageEndpointHealth;
    state.activeImageBaseUrl = data.imageBaseUrl || state.activeImageBaseUrl;
    state.recommendedImageEndpoint = data.recommendedImageEndpoint || state.recommendedImageEndpoint;
    renderApiSettings();
    refreshHealth();
    if (!silent) toast("端点检测完成");
    return true;
  } catch (error) {
    if (!silent) toast(error.message);
    return false;
  } finally {
    state.endpointProbeBusyIds.delete(id);
    renderApiSettings();
  }
}

function maybeAutoProbeImageEndpoints({ force = false } = {}) {
  if (endpointAutoProbePromise) return endpointAutoProbePromise;
  if (!state.canManageApiSettings) return Promise.resolve(false);
  const hasConfiguredEndpoint = state.imageEndpointHealth.some((endpoint) => endpoint.configured)
    || state.runtimeImageEndpoints.some((endpoint) => endpoint.keyConfigured || endpoint.keyPreview);
  if (!hasConfiguredEndpoint) return Promise.resolve(false);
  const now = Date.now();
  const stale = state.imageEndpointHealth.some((endpoint) => endpoint.configured && (!endpoint.lastProbeAt || now - Number(endpoint.lastProbeAt) > ENDPOINT_AUTO_PROBE_INTERVAL_MS));
  if (!force && !stale && now - state.endpointAutoProbeAt < ENDPOINT_AUTO_PROBE_INTERVAL_MS) {
    return Promise.resolve(false);
  }
  state.endpointAutoProbeAt = now;
  endpointAutoProbePromise = probeImageApiEndpoints({ silent: true, controlButton: false })
    .catch(() => false)
    .finally(() => {
      endpointAutoProbePromise = null;
    });
  return endpointAutoProbePromise;
}

async function refreshTaskLogs({ silent = false } = {}) {
  if (!els.taskLogList) return;
  try {
    const response = await fetch(clientScopedApiPath("/api/task-logs?limit=80"));
    const data = await response.json();
    const logs = Array.isArray(data.logs) ? data.logs : [];
    state.taskLogs = logs;
    renderWorkspaceHistoryPanel();
    const visibleLogs = state.taskLogFilter === "failed"
      ? logs.filter((log) => log.status === "failed")
      : logs;
    els.taskLogList.innerHTML = visibleLogs.length
      ? visibleLogs.map(renderTaskLogItem).join("")
      : `<p class="muted">暂无任务日志。</p>`;
    bindTaskLogEvents();
    els.taskLogFilterButtons.forEach((button) => {
      const active = button.dataset.taskLogFilter === state.taskLogFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  } catch (error) {
    if (!silent) toast("任务日志读取失败");
  }
}

function generatedHistoryLogs() {
  const seen = new Set();
  return state.taskLogs
    .filter((log) => log.status === "success" && log.result?.outputUrl)
    .filter((log) => {
      const key = log.result.outputUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderWorkspaceHistoryPanel() {
  if (!els.workspaceHistoryPanel || !els.workspaceHistoryList) return;
  const open = state.historyPanelOpen;
  els.workspaceHistoryPanel.hidden = !open;
  els.workspaceHistoryButton?.classList.toggle("active", open);
  syncExpandedState(els.workspaceHistoryButton, els.workspaceHistoryPanel, open);
  if (!state.historyPanelOpen) return;

  const logs = generatedHistoryLogs();
  if (!logs.length) {
    els.workspaceHistoryList.innerHTML = `<p class="muted">还没有可加入画布的历史生成图。</p>`;
    return;
  }
  els.workspaceHistoryList.innerHTML = logs.map((log) => {
    const mode = normalizeClientMode(log.input?.stepMode || log.input?.mode || log.result?.mode || "");
    const title = log.result?.title || taskTypeLabel(log.type);
    const endpoint = log.result?.endpoint || log.activeImageBaseUrl || "--";
    return `
      <article class="workspace-history-item">
        <button class="history-thumb" type="button" data-history-action="preview" data-log-id="${escapeAttr(log.id)}">
          <img src="${escapeAttr(log.result.outputUrl)}" alt="${escapeAttr(title)}" />
        </button>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(formatTaskTime(log.completedAt || log.startedAt))} · ${escapeHtml(workflowStepLabel(mode))} · ${escapeHtml(shortEndpoint(endpoint))}</span>
          <div class="workspace-history-actions">
            ${uiIconButton({ icon: "icon-pin", label: "加入画布", attrs: `data-history-action="add" data-log-id="${escapeAttr(log.id)}"` })}
            ${uiIconButton({ icon: "icon-reference", label: "设为输入", attrs: `data-history-action="input" data-log-id="${escapeAttr(log.id)}"` })}
            ${uiIconButton({ icon: "icon-copy", label: "复制提示词", attrs: `data-history-action="copy" data-log-id="${escapeAttr(log.id)}"` })}
            ${uiIconLink({ href: log.result.outputUrl, icon: "icon-export", label: "打开原图", attrs: `target="_blank" rel="noreferrer"` })}
          </div>
        </div>
      </article>
    `;
  }).join("");
  bindWorkspaceHistoryEvents();
}

function renderWorkspaceStatusPanel() {
  if (!els.workspaceStatusPanel) return;
  const open = state.statusPanelOpen;
  els.workspaceStatusPanel.hidden = !open;
  els.workspaceStatusButton?.classList.toggle("active", open);
  syncExpandedState(els.workspaceStatusButton, els.workspaceStatusPanel, open);
}

function bindWorkspaceHistoryEvents() {
  if (!els.workspaceHistoryList) return;
  els.workspaceHistoryList.querySelectorAll("[data-history-action]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      const log = state.taskLogs.find((item) => item.id === control.dataset.logId);
      if (!log) return;
      handleWorkspaceHistoryAction(control.dataset.historyAction, log);
    });
  });
}

function historyLogToOutputRecord(log) {
  const mode = normalizeClientMode(log.input?.stepMode || log.input?.mode || log.result?.mode || "custom");
  return {
    id: `history-${log.id}`,
    title: log.result?.title || taskTypeLabel(log.type),
    url: log.result?.outputUrl,
    file: log.result?.outputFile || "",
    mode,
    stepMode: mode,
    workflowId: log.input?.workflowId || "",
    parentImageId: log.input?.parentImageId || "",
    parentNodeId: "",
    inputImageType: log.input?.inputImageType || log.input?.primaryImage?.sourceType || "",
    renderRegion: log.input?.renderRegion || log.result?.renderRegion || "",
    endpoint: log.result?.endpoint || log.activeImageBaseUrl || "",
    attempts: log.result?.attempts || [],
    prompt: log.result?.prompt || "",
    sourcePrompt: log.result?.sourcePrompt || "",
    intent: log.input?.intent || log.result?.intent || "",
    createdAt: formatTaskTime(log.completedAt || log.startedAt)
  };
}

async function handleWorkspaceHistoryAction(action, log) {
  if (action === "preview") {
    openImagePreview({
      url: log.result.outputUrl,
      title: log.result?.title || taskTypeLabel(log.type),
      caption: formatTaskTime(log.completedAt || log.startedAt)
    });
    return;
  }
  if (action === "copy") {
    await copyText(log.result?.prompt || log.result?.sourcePrompt || log.input?.intent || "");
    return;
  }
  if (action === "add") {
    addHistoryLogToCanvas(log);
    return;
  }
  if (action === "input") {
    await useHistoryLogAsInput(log);
  }
}

function addHistoryLogToCanvas(log) {
  const record = historyLogToOutputRecord(log);
  if (!record.url) return;
  const exists = state.renders.some((item) => item.url === record.url);
  if (!exists) state.renders.push(record);
  state.render = exists ? state.renders.find((item) => item.url === record.url) : record;
  state.canvas.selectedImage = {
    id: `render${Math.max(0, state.renders.findIndex((item) => item.url === record.url))}`,
    url: record.url,
    title: record.title,
    caption: record.intent,
    outputId: record.id
  };
  renderGeneratedResult();
  renderWorkflowCanvas();
  focusCanvasToResults();
  toast("历史图已加入画布");
}

async function useHistoryLogAsInput(log) {
  addHistoryLogToCanvas(log);
  const record = historyLogToOutputRecord(log);
  await useCanvasImageWithMode(record.stepMode || record.mode || "custom");
}

function renderTaskLogItem(log) {
  const statusText = log.status === "success" ? "成功" : "失败";
  const typeText = taskTypeLabel(log.type);
  const timeText = log.completedAt || log.startedAt || "";
  const duration = log.durationMs ? `${Math.round(log.durationMs / 1000)}s` : "--";
  const mode = log.input?.mode ? ` · ${log.input.mode}` : "";
  const logMode = normalizeClientMode(log.input?.stepMode || log.input?.mode || log.result?.mode || "");
  const refCount = Number(log.input?.referenceCount || 0);
  const logAttempts = Array.isArray(log.result?.attempts) && log.result.attempts.length
    ? log.result.attempts
    : (Array.isArray(log.error?.attempts) ? log.error.attempts : []);
  const endpoint = log.result?.endpoint || log.error?.endpoint || log.activeImageBaseUrl || "--";
  const finalPrompt = log.result?.prompt || "";
  const sourcePrompt = log.result?.sourcePrompt || log.input?.intent || "";
  const userPrompt = log.input?.userPrompt || "";
  const workflowId = log.input?.workflowId || "";
  const parentImageId = log.input?.parentImageId || "";
  const inputType = log.input?.inputImageType || log.input?.primaryImage?.sourceType || "";
  const renderRegion = log.input?.renderRegion || log.result?.renderRegion || "";
  const retryCount = Number(log.result?.retryCount ?? log.error?.retryCount ?? logAttempts.filter((attempt) => attempt?.status === "failed").length);
  const nextMode = nextPlanWorkflowModes(logMode)[0];
  const output = log.result?.outputUrl
    ? uiIconLink({ href: log.result.outputUrl, icon: "icon-export", label: "打开结果", attrs: `target="_blank" rel="noreferrer"` })
    : "";
  const outputFile = log.result?.outputFile
    ? `<span title="${escapeAttr(log.result.outputFile)}">${escapeHtml(shortPath(log.result.outputFile))}</span>`
    : "";
  const error = log.error?.message ? `<p class="task-log-error">${escapeHtml(log.error.message)}</p>` : "";
  const attempts = logAttempts.length
    ? `<details><summary>端点尝试 / 重试</summary><ul class="compact-list">${logAttempts.map((attempt) => `
        <li>${escapeHtml(attempt.status || "")} · ${escapeHtml(attempt.name || "")} · ${escapeHtml(attempt.endpoint || "")}${attempt.error ? ` · ${escapeHtml(attempt.error)}` : ""}</li>
      `).join("")}</ul></details>`
    : "";
  const prompt = finalPrompt
    ? `<details><summary>最终提示词</summary><p>${escapeHtml(finalPrompt)}</p></details>`
    : "";
  const sourcePromptBlock = sourcePrompt && sourcePrompt !== finalPrompt
    ? `<details><summary>Agent 融合输入</summary><p>${escapeHtml(sourcePrompt)}</p></details>`
    : "";
  return `
    <article class="task-log-item ${log.status === "success" ? "success" : "failed"}">
      <div class="task-log-row">
        <strong>${escapeHtml(typeText)}${escapeHtml(mode)}</strong>
        <span>${escapeHtml(statusText)} · ${escapeHtml(duration)}</span>
      </div>
      <p>${escapeHtml(formatTaskTime(timeText))} · 参考图 ${refCount} 张 · 端点 ${escapeHtml(endpoint)}${retryCount ? ` · 重试 ${retryCount} 次` : ""}</p>
      ${workflowId || inputType || parentImageId || renderRegion ? `<p>${workflowId ? `工作流：${escapeHtml(workflowId)}` : ""}${inputType ? ` · 输入类型：${escapeHtml(inputType)}` : ""}${renderRegion ? ` · 区域：${escapeHtml(renderRegion)}` : ""}${parentImageId ? ` · 父图：${escapeHtml(parentImageId)}` : ""}</p>` : ""}
      ${userPrompt ? `<p>用户原始指令：${escapeHtml(userPrompt)}</p>` : ""}
      ${log.input?.intent ? `<p>任务意图：${escapeHtml(log.input.intent)}</p>` : ""}
      ${log.result?.analysisSummary ? `<p>分析：${escapeHtml(log.result.analysisSummary)}</p>` : ""}
      ${error}
      <div class="task-log-actions">
        ${output}
        ${outputFile}
        ${finalPrompt ? uiIconButton({ icon: "icon-copy", label: "复制提示词", attrs: `data-log-action="copy-prompt" data-log-id="${escapeAttr(log.id)}"` }) : ""}
        ${nextMode && log.result?.outputUrl ? uiIconButton({ icon: "icon-continue", label: "继续下一步", attrs: `data-log-action="continue-next" data-next-mode="${escapeAttr(nextMode)}" data-log-id="${escapeAttr(log.id)}"` }) : ""}
        ${uiIconButton({ icon: "icon-refresh", label: "复跑", attrs: `data-log-action="rerun" data-log-id="${escapeAttr(log.id)}"` })}
      </div>
      ${attempts}
      ${prompt}
      ${sourcePromptBlock}
    </article>
  `;
}

function bindTaskLogEvents() {
  if (!els.taskLogList) return;
  els.taskLogList.querySelectorAll("[data-log-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const log = state.taskLogs.find((item) => item.id === button.dataset.logId);
      if (!log) return;
      if (button.dataset.logAction === "copy-prompt") {
        copyText(log.result?.prompt || "");
      } else if (button.dataset.logAction === "rerun") {
        rerunFromLog(log);
      } else if (button.dataset.logAction === "continue-next") {
        continueFromLogOutput(log, button.dataset.nextMode);
      }
    });
  });
}

function taskTypeLabel(type) {
  const labels = {
    plan: "方案推理",
    "generate-image": "方向出图",
    "render-from-images": "图片生成",
    "analyze-design-series": "参考图分析",
    "design-series": "设计系列",
    "local-upscale": "本地高清增强",
    "local-sharpen": "本地锐化",
    "local-cad": "本地 CAD",
    "canvas-upscale": "画布高清增强",
    "canvas-sharpen": "画布锐化",
    "canvas-detail": "画布细节增强",
    "canvas-outpaint": "画布扩图"
  };
  return labels[type] || type || "任务";
}

function formatTaskTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function logClientTask(type, { input = {}, result = {}, status = "success", startedAt = null, durationMs = 0 } = {}) {
  fetch(clientScopedApiPath("/api/task-log-event"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type,
      status,
      startedAt: startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs,
      clientId: state.clientId,
      input,
      result
    })
  })
    .then(() => refreshTaskLogs({ silent: true }))
    .catch(() => {});
}

function startActiveTask({ type, label, total = 1, userPrompt = "", referenceCount = 0, workflowId = "", parentImageId = "", inputImageType = "", renderRegion = "", endpoint = "" } = {}) {
  if (state.taskTimer) clearInterval(state.taskTimer);
  state.activeTask = {
    id: `task-${Date.now()}`,
    type,
    label: label || taskTypeLabel(type),
    status: "running",
    total: Math.max(1, Number(total) || 1),
    current: 0,
    success: 0,
    failed: 0,
    retries: 0,
    startedAt: Date.now(),
    elapsedMs: 0,
    endpoint: endpoint || getActiveImageEndpoint(),
    userPrompt,
    referenceCount,
    workflowId,
    parentImageId,
    inputImageType,
    renderRegion,
    finalPrompt: "",
    error: "",
    outputs: [],
    events: [
      {
        time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        text: "任务开始"
      }
    ]
  };
  state.taskTimer = setInterval(() => {
    if (!state.activeTask || state.activeTask.status !== "running") return;
    state.activeTask.elapsedMs = Date.now() - state.activeTask.startedAt;
    renderTaskProgressPanel();
  }, 1000);
  renderTaskProgressPanel();
}

function updateActiveTask(patch = {}) {
  if (!state.activeTask) return;
  Object.assign(state.activeTask, patch);
  state.activeTask.elapsedMs = Date.now() - state.activeTask.startedAt;
  if (patch.event) pushTaskEvent(patch.event);
  if (Array.isArray(patch.attempts)) appendTaskAttemptEvents(patch.attempts);
  renderTaskProgressPanel();
}

function completeActiveTask(status = "success", eventText = "") {
  if (!state.activeTask) return;
  state.activeTask.status = status;
  state.activeTask.elapsedMs = Date.now() - state.activeTask.startedAt;
  if (eventText) pushTaskEvent(eventText);
  if (state.taskTimer) clearInterval(state.taskTimer);
  state.taskTimer = null;
  renderTaskProgressPanel();
}

function pushTaskEvent(text) {
  if (!state.activeTask || !text) return;
  state.activeTask.events.push({
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    text
  });
  state.activeTask.events = state.activeTask.events.slice(-8);
}

function appendTaskAttemptEvents(attempts) {
  if (!state.activeTask) return;
  attempts.forEach((attempt) => {
    if (!attempt?.name || attempt._seenInProgress) return;
    attempt._seenInProgress = true;
    if (attempt.endpoint) state.activeTask.endpoint = attempt.endpoint;
    if (attempt.status === "failed") state.activeTask.retries += 1;
    const label = attempt.status === "success" ? "成功" : attempt.status === "skipped" ? "跳过" : "尝试";
    pushTaskEvent(`${label} · ${attempt.name}${attempt.endpoint ? ` · ${attempt.endpoint}` : ""}${attempt.error ? ` · ${attempt.error}` : ""}`);
  });
}

function renderTaskProgressPanel() {
  if (!els.taskProgressPanel) return;
  const task = state.activeTask;
  if (!task) {
    if (els.workspaceStatusButton) {
      els.workspaceStatusButton.innerHTML = `<svg><use href="#icon-status"></use></svg>`;
      els.workspaceStatusButton.title = "状态：空闲";
      els.workspaceStatusButton.setAttribute("aria-label", "状态：空闲");
      els.workspaceStatusButton.className = `icon-button icon-only ${state.statusPanelOpen ? "active" : ""}`;
    }
    els.taskProgressTitle.textContent = "待命";
    els.taskProgressStatus.textContent = "空闲";
    els.taskProgressStatus.className = "status-pill";
    els.taskProgressBar.style.width = "0%";
    els.taskProgressCount.textContent = "0/0";
    els.taskProgressEndpoint.textContent = getActiveImageEndpoint() || "--";
    els.taskProgressElapsed.textContent = "0s";
    els.taskProgressEvents.innerHTML = `<span>等待新的生成任务。</span>`;
    renderTaskFailureReview(null);
    els.taskProgressPrompt.textContent = "任务完成后显示。";
    return;
  }

  const done = Math.min(task.total, task.success + task.failed);
  const percent = Math.round((done / Math.max(1, task.total)) * 100);
  if (els.workspaceStatusButton) {
    const endpoint = shortEndpoint(task.endpoint || getActiveImageEndpoint() || "--");
    const elapsed = formatElapsed(task.elapsedMs);
    const statusLabel = task.status === "running"
      ? `生成中 ${done}/${task.total} · ${endpoint} · ${elapsed}`
      : task.status === "success"
        ? `已完成 ${done}/${task.total} · ${endpoint} · ${elapsed}`
        : `有失败 ${done}/${task.total} · ${endpoint}`;
    els.workspaceStatusButton.innerHTML = `<svg><use href="#icon-status"></use></svg>`;
    els.workspaceStatusButton.setAttribute("aria-label", statusLabel);
    els.workspaceStatusButton.title = `${task.label} · ${done}/${task.total} · ${endpoint} · ${elapsed}`;
    els.workspaceStatusButton.className = `icon-button icon-only ${state.statusPanelOpen ? "active" : ""} ${task.status === "failed" ? "error" : task.status === "success" ? "ready" : ""}`;
  }
  els.taskProgressTitle.textContent = task.label;
  els.taskProgressStatus.textContent = task.status === "running" ? "进行中" : task.status === "success" ? "已完成" : "有失败";
  els.taskProgressStatus.className = `status-pill ${task.status === "failed" ? "error" : task.status === "success" ? "ready" : ""}`;
  els.taskProgressBar.style.width = `${percent}%`;
  els.taskProgressCount.textContent = `${done}/${task.total}`;
  els.taskProgressEndpoint.textContent = shortEndpoint(task.endpoint || getActiveImageEndpoint() || "--");
  els.taskProgressElapsed.textContent = formatElapsed(task.elapsedMs);
  const contextEvents = [
    task.workflowId ? { time: "链路", text: task.workflowId } : null,
    task.inputImageType ? { time: "输入", text: task.inputImageType } : null,
    task.renderRegion ? { time: "区域", text: task.renderRegion } : null
  ].filter(Boolean);
  const events = [...contextEvents, ...task.events];
  els.taskProgressEvents.innerHTML = events.length
    ? events.map((event) => `<span>${escapeHtml(event.time)} · ${escapeHtml(event.text)}</span>`).join("")
    : `<span>等待进度事件。</span>`;
  renderTaskFailureReview(task);
  els.taskProgressPrompt.textContent = task.finalPrompt || task.userPrompt || "任务完成后显示。";
}

function renderTaskFailureReview(task) {
  if (!els.taskProgressReview) return;
  if (!task || task.status !== "failed") {
    els.taskProgressReview.hidden = true;
    els.taskProgressReview.innerHTML = "";
    return;
  }
  const review = buildTaskFailureReview(task);
  els.taskProgressReview.hidden = false;
  els.taskProgressReview.innerHTML = `
    <strong>失败复盘</strong>
    <p>${escapeHtml(review.summary)}</p>
    <div class="task-review-grid">
      ${review.actions.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function buildTaskFailureReview(task) {
  const rawError = [
    task.error || "",
    ...(task.events || []).map((event) => event.text || "")
  ].join(" ").toLowerCase();
  const attemptedEndpoints = [...new Set((task.events || [])
    .map((event) => event.text || "")
    .filter((text) => /https?:\/\//i.test(text))
    .map((text) => text.match(/https?:\/\/[^\s·]+/i)?.[0])
    .filter(Boolean))];
  const referenceCount = Number(task.referenceCount || 0);
  const actions = [];
  let summary = "生成任务没有完成，需要根据失败原因缩小变量后再复跑。";

  if (/timeout|timed out|abort|socket|econn|network|fetch failed|504|502|503/.test(rawError)) {
    summary = "更像是端点超时或网络不稳定。";
    actions.push("下一次会继续先测速再选端点");
    actions.push("建议先用 1K 和 1-2 张图测试");
  } else if (/401|403|unauthorized|forbidden|api key|apikey|认证|鉴权/.test(rawError)) {
    summary = "更像是 API 鉴权或密钥权限问题。";
    actions.push("检查生图端点密钥是否支持 Image Gen 工具调用");
    actions.push("确认端点地址和模型权限一致");
  } else if (/429|rate|quota|limit|余额|额度/.test(rawError)) {
    summary = "更像是频率、额度或并发限制。";
    actions.push("等待一段时间后复跑");
    actions.push("减少单次出图数量");
  } else if (/image|file|upload|base64|mime|format|图片|格式|尺寸/.test(rawError)) {
    summary = "更像是输入图片、格式或尺寸导致的问题。";
    actions.push("换 PNG/JPG 重新上传");
    actions.push("先减少参考图数量再生成");
  } else if (/prompt|content|policy|invalid|参数|请求/.test(rawError)) {
    summary = "更像是提示词或请求参数冲突。";
    actions.push("复制最终提示词后删掉互相冲突的要求");
    actions.push("优先保留一个明确输出目标");
  }

  if (referenceCount >= 6) actions.push("参考图较多，可先保留 2-4 张重点参考");
  if (state.generation.count > 2) actions.push("排障时可先降到 1 张，确认端点稳定后再批量出图");
  if (attemptedEndpoints.length) actions.push(`已尝试端点 ${attemptedEndpoints.length} 个`);
  if (!actions.length) actions.push("复制最终提示词后复跑", "切换更少参考图再试");

  return {
    summary,
    actions: actions.slice(0, 5)
  };
}

function inputWorkflowAdvice(analysis, mode = state.mode) {
  if (!analysis) return null;
  const suggestedMode = normalizeClientMode(analysis.suggestedMode || mode);
  const currentMode = normalizeClientMode(mode);
  const suggestedLabel = suggestedModeLabel(suggestedMode);
  const currentLabel = suggestedModeLabel(currentMode);
  const confident = Number(analysis.confidence || 0) >= 0.58;
  const compatible = isInputCompatibleWithMode(analysis, currentMode);
  const mismatch = confident && !compatible && suggestedMode !== currentMode && !["custom", "designseries"].includes(currentMode);
  const actionText = mismatch
    ? `建议先使用「${suggestedLabel}」，当前是「${currentLabel}」。`
    : compatible && suggestedMode !== currentMode
      ? `当前「${currentLabel}」可用，后续也可继续「${suggestedLabel}」。`
    : `建议下一步使用「${suggestedLabel}」。`;
  return {
    mode: suggestedMode,
    label: suggestedLabel,
    text: `Agent 识别：${analysis.label}。${actionText}`,
    reason: analysis.reason || "",
    mismatch
  };
}

function isInputCompatibleWithMode(analysis, mode = state.mode) {
  const key = analysis?.key || "";
  const normalizedMode = normalizeClientMode(mode);
  const compatibleModes = {
    "line-plan": ["plan-axonometric", "cad", "cadrender"],
    "cad-screenshot": ["cad", "cadrender", "plan-axonometric"],
    "colored-plan": ["plan-axonometric"],
    axonometric: ["plan-render"],
    "site-photo": ["photo", "styletransfer", "materialreplace", "lightingadjust"],
    "white-model": ["whitemodel"],
    sketch: ["sketch"],
    "style-reference": ["custom", "designseries", "styletransfer", "materialboard"]
  };
  return (compatibleModes[key] || []).includes(normalizedMode);
}

function setInputAdviceThinking(analysis) {
  const advice = inputWorkflowAdvice(analysis);
  if (!advice) return;
  state.thinking = {
    status: "done",
    target: advice.label,
    text: [
      advice.text,
      advice.reason ? `判断依据：${advice.reason}` : "",
      "不会强制切换模式，生成前会把图片类型、当前按钮含义和用户指令一起融合进最终提示词。"
    ].filter(Boolean).join("\n")
  };
}

function getActiveImageEndpoint() {
  const active = state.imageEndpointHealth.find((endpoint) => endpoint.active);
  return active?.baseUrl || state.activeImageBaseUrl || "";
}

async function createPlan() {
  const brief = readBrief();
  state.loadingPlan = true;
  startActiveTask({
    type: "plan",
    label: "生成三套方向",
    total: 1,
    userPrompt: brief.projectName || brief.spaceType || "",
    referenceCount: 0
  });
  setBusy(els.planButton, true, "思考中");
  toast("gpt-5.5 正在生成空间概念方向");
  try {
    const data = await api("/api/plan", { brief });
    state.plan = data.plan;
    state.selectedId = data.plan.directions?.[0]?.id || null;
    updateActiveTask({
      success: 1,
      finalPrompt: data.plan?.design_read || data.plan?.project_summary || "",
      event: "三套方向生成完成"
    });
    render();
    completeActiveTask("success", "方案推理完成");
    toast("已生成三套设计方向");
  } catch (error) {
    updateActiveTask({
      status: "failed",
      failed: 1,
      error: error.message,
      event: `方案推理失败：${error.message}`
    });
    state.thinking = {
      status: "idle",
      target: "生成三套方向",
      text: `生成未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    state.loadingPlan = false;
    setBusy(els.planButton, false);
  }
}

async function generateImage(directionId) {
  if (!state.plan) return;
  const direction = state.plan.directions.find((item) => item.id === directionId);
  if (!direction || state.loadingImages.has(directionId)) return;

  state.loadingImages.add(directionId);
  startActiveTask({
    type: "generate-image",
    label: `方向出图 · ${direction.name}`,
    total: 1,
    userPrompt: direction.image_prompt || currentCanvasUserPrompt(),
    referenceCount: 0
  });
  state.thinking = {
    status: "active",
    target: direction.name,
    text: state.thinkingModeEnabled
      ? `正在为「${direction.name}」推理空间镜头、材料表达、灯光层次和画面风险。`
      : `思考模式已关闭，正在使用预设提示词直接生成「${direction.name}」。`
  };
  render();
  toast(`${thinkingPipelineLabel()} 正在生成「${direction.name}」`);
  try {
    const data = await api("/api/generate-image", {
      brief: readBrief(),
      direction,
      imagePrompt: direction.image_prompt,
      userPrompt: direction.image_prompt || currentCanvasUserPrompt(),
      size: selectedGenerationSize(),
      quality: selectedGenerationQuality(),
      thinkingEnabled: state.thinkingModeEnabled
    });
    direction.image = data.image;
    updateActiveTask({
      success: 1,
      endpoint: data.image?.endpoint || state.activeTask.endpoint,
      finalPrompt: data.image?.prompt || direction.image_prompt,
      outputs: [data.image],
      attempts: data.image?.attempts || [],
      event: "方向视觉生成完成"
    });
    state.thinking = {
      status: "done",
      target: direction.name,
      text: data.image?.thinking || (state.thinkingModeEnabled
        ? `gpt-5.5 已完成「${direction.name}」的生成策略推理，并调用 Image Gen 输出视觉。`
        : `已使用预设提示词调用 Image Gen 输出「${direction.name}」。`)
    };
    render();
    completeActiveTask("success", "方向出图完成");
    toast(`视觉已生成：${direction.name}`);
  } catch (error) {
    updateActiveTask({
      status: "failed",
      failed: 1,
      error: error.message,
      event: `方向出图失败：${error.message}`
    });
    state.thinking = {
      status: "idle",
      target: ["plan-axonometric", "plan-render"].includes(state.mode) ? workflowButtonMeanings[state.mode].label : "现场图转效果图",
      text: `生成未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    state.loadingImages.delete(directionId);
    render();
  }
}

async function generateAllImages() {
  if (!state.plan) return;
  for (const direction of state.plan.directions) {
    if (!direction.image) {
      await generateImage(direction.id);
    }
  }
}

function selectionRegionLabel(selection) {
  if (!selection) return "";
  const centerX = selection.x + selection.width / 2;
  const centerY = selection.y + selection.height / 2;
  const horizontal = centerX < 0.34 ? "左侧" : centerX > 0.66 ? "右侧" : "中部";
  const vertical = centerY < 0.34 ? "上方" : centerY > 0.66 ? "下方" : "中段";
  const size = `${Math.round(selection.width * 100)}% x ${Math.round(selection.height * 100)}%`;
  return `${horizontal}${vertical}红框区域（约 ${size}）`;
}

function planRenderRegionInfo(mode = state.mode, selection = state.selection, referenceImages = activeReferenceImages()) {
  if (normalizeClientMode(mode) !== "plan-render") return null;
  if (selection) {
    const label = selectionRegionLabel(selection);
    return {
      type: "selected",
      label,
      prompt: [
        `效果图区域：用户已框选 ${label}。`,
        `红框坐标：x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}。`,
        "最终人视角效果图必须聚焦这个红框区域，不要生成整套平面图，也不要转到其他房间；允许根据整体3D平面图补足该区域可见的前景、中景、背景和相邻空间关系。",
        "生成完成后，结果应被标记为来自这个红框区域。"
      ].join("\n")
    };
  }
  const hasReferences = referenceImages.length > 0;
  const label = hasReferences
    ? "自动区域：与参考图最接近的功能区"
    : "自动区域：最适合表达的明确功能区";
  return {
    type: "auto",
    label,
    prompt: [
      "效果图区域：用户没有框选区域。",
      hasReferences
        ? "请先观察所有参考图的空间类型、材料氛围、家具尺度和灯光特征，再从3D平面图中自动选择一个与参考图最接近、最适合做人视角效果图的明确功能区。"
        : "请从3D平面图中自动选择一个最清晰、最适合做人视角效果图的明确主要空间区，但必须只选择一个区域，不要把整张3D平面图都转成效果图。",
      "选定区域后，最终画面只表现该区域的人视角效果，并在提示词逻辑中说明选择的是哪个区域、为什么选择它。",
      "如果无法识别房间名称，就用空间位置描述，例如左侧卧室区、中部公共区、右下角卫生间附近、入口过渡区等。"
    ].join("\n")
  };
}

async function renderFromImages(options = {}) {
  const primaryImage = options.ignorePrimaryImage ? null : (options.primaryImage || state.primaryImage);
  const mode = normalizeClientMode(options.mode || state.mode);
  const config = modeConfig(mode);
  const referenceImages = options.referenceImages || activeReferenceImages();
  const renderSelection = options.selection === undefined ? state.selection : options.selection;
  const regionInfo = planRenderRegionInfo(mode, renderSelection, referenceImages);
  const intent = options.intent
    ? composeIntentWithPromptContext([options.intent, regionInfo?.prompt || ""], {
        modePresetOverride: defaultCanvasCommands[mode] || defaultCanvasCommands.default,
        extraUserPrompt: options.userPromptOverride || ""
      })
    : buildCurrentIntent();
  const requestUserPrompt = options.userPromptOverride || currentCanvasUserPrompt();
  const outputCount = clampImageCount(options.count || state.generation.count, mode);
  const outputSize = options.size || selectedGenerationSize();
  const outputQuality = options.quality || selectedGenerationQuality();
  const workflowId = isPlanWorkflowMode(mode)
    ? (options.workflowId || primaryImage?.workflowId || createWorkflowId(mode))
    : (options.workflowId || primaryImage?.workflowId || "");
  const parentImageId = options.parentImageId || primaryImage?.parentImageId || primaryImage?.id || "";
  const parentNodeId = options.parentNodeId || primaryImage?.parentNodeId || (primaryImage?.dataUrl && primaryImage === state.primaryImage ? "source" : "");
  const inputAnalysis = options.inputAnalysis || primaryImage?.inputAnalysis || state.primaryImageAnalysis || null;
  const inputImageType = inputAnalysis?.label || primaryImage?.sourceType || "";

  if (!primaryImage && !options.allowNoPrimary) {
    toast(config.missing);
    return;
  }

  const busyButton = options.busyButton || els.renderButton;
  startActiveTask({
    type: "render-from-images",
    label: outputCount > 1 ? `${primaryActionLabel(mode)} · ${outputCount} 张` : primaryActionLabel(mode),
    total: outputCount,
    userPrompt: requestUserPrompt,
    referenceCount: referenceImages.length,
    workflowId,
    parentImageId,
    inputImageType,
    renderRegion: regionInfo?.label || "",
    endpoint: generationEndpointLabel(mode)
  });
  setBusy(busyButton, true, "生成中");
  state.thinking = {
    status: "active",
    target: config.sourceTitle,
    text: generationThinkingText(mode)
  };
  renderWorkflowCanvas();
  const engineLabel = generationEngineLabel(mode);
  const pipelineLabel = state.thinkingModeEnabled ? `gpt-5.5 → ${engineLabel}` : `预设提示词 → ${engineLabel}`;
  toast(outputCount > 1 ? `${pipelineLabel}正在生成 ${outputCount} 张${config.resultTitle}` : `${pipelineLabel}正在生成${config.resultTitle}`);
  try {
    for (let index = 0; index < outputCount; index += 1) {
      updateActiveTask({
        current: index + 1,
        status: "running",
        endpoint: generationEndpointLabel(mode),
        event: `开始生成第 ${index + 1}/${outputCount} 张`
      });
      const variantIntent = outputCount > 1
        ? `${intent}\n本次输出为第 ${index + 1}/${outputCount} 张变体，保持同一设计约束，但构图、陈列或灯光细节应有可比较差异。`
        : intent;
      const data = await api("/api/render-from-images", {
        mode,
        workflowId,
        parentImageId,
        stepMode: mode,
        inputImageType,
        brief: readBrief(),
        intent: variantIntent,
        userPrompt: requestUserPrompt,
        primaryImage,
        referenceImages,
        selection: renderSelection,
        renderRegion: regionInfo,
        size: outputSize,
        quality: outputQuality,
        thinkingEnabled: state.thinkingModeEnabled
      });
      const record = {
        ...data.render,
        id: `render-${Date.now()}-${index}`,
        title: outputCount > 1 ? `${options.title || config.resultTitle} ${index + 1}` : options.title || config.resultTitle,
        mode,
        stepMode: mode,
        workflowId,
        parentImageId,
        parentNodeId,
        inputImageType,
        inputAnalysis,
        selection: renderSelection,
        renderRegion: regionInfo?.label || "",
        renderRegionPrompt: regionInfo?.prompt || "",
        intent: variantIntent,
        endpoint: data.render?.endpoint || "",
        referenceCount: data.render?.referenceCount ?? referenceImages.length,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      };
      state.render = record;
      state.renders.push(record);
      updateActiveTask({
        success: state.activeTask.success + 1,
        endpoint: data.render?.endpoint || state.activeTask.endpoint,
        finalPrompt: data.render?.prompt || state.activeTask.finalPrompt,
        outputs: [...state.activeTask.outputs, record],
        attempts: data.render?.attempts || [],
        event: `${regionInfo?.label ? `区域：${regionInfo.label} · ` : ""}第 ${index + 1}/${outputCount} 张完成`
      });
      state.thinking = {
        status: "done",
        target: record.title,
        text: data.render?.thinking || `已完成生成策略，并调用${generationEngineLabel(mode)}输出${config.resultTitle}。`
      };
      renderGeneratedResult();
      renderWorkflowCanvas();
    }
    renderGeneratedResult();
    renderWorkflowCanvas();
    completeActiveTask("success", outputCount > 1 ? `已完成 ${outputCount} 张输出` : "输出完成");
    toast(outputCount > 1 ? `已生成 ${outputCount} 张${config.resultTitle}` : `${config.resultTitle}已生成`);
  } catch (error) {
    updateActiveTask({
      status: "failed",
      failed: Math.min(outputCount, (state.activeTask?.failed || 0) + 1),
      error: error.message,
      event: `任务失败：${error.message}`
    });
    state.thinking = {
      status: "idle",
      target: config.sourceTitle,
      text: `生成未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    setBusy(busyButton, false);
    renderWorkflowCanvas();
  }
}

async function analyzeDesignSeriesReferences() {
  const referenceImages = activeReferenceImages();
  if (state.mode !== "designseries" || !referenceImages.length) return;

  state.analyzingDesignSeries = true;
  startActiveTask({
    type: "analyze-design-series",
    label: "识别参考图",
    total: 1,
    userPrompt: currentCanvasUserPrompt(),
    referenceCount: referenceImages.length
  });
  state.thinking = {
    status: "active",
    target: "生成设计系列",
    text: "正在识别参考图类型：空间、材料、家具、灯光、色彩、氛围与构图，并整理成套设计建议。"
  };
  renderWorkflowCanvas();
  toast("gpt-5.5 正在识别参考图");
  try {
    const data = await api("/api/analyze-design-series", {
      brief: readBrief(),
      intent: buildCurrentIntent(),
      userPrompt: currentCanvasUserPrompt(),
      referenceImages,
      seriesCount: state.generation.count
    });
    state.designSeriesAnalysis = data.analysis;
    const fallbackReason = data.analysis?.fallback_reason || "";
    updateActiveTask({
      success: 1,
      finalPrompt: data.analysis?.image_prompt || data.analysis?.series_strategy || "",
      event: fallbackReason ? `参考图分析降级，已用预设继续：${fallbackReason}` : "参考图识别完成"
    });
    applySeriesReferenceRoles(data.analysis);
    renderReferenceStrip();
    renderDesignSeriesAnalysisView();
    renderWorkflowCanvas();
    completeActiveTask("success", fallbackReason ? "已用预设系列建议继续" : "已生成系列建议");
    toast(fallbackReason ? "FHL 分析暂不可用，已用预设系列建议继续" : "已识别参考图并生成设计系列建议");
  } catch (error) {
    updateActiveTask({
      status: "failed",
      failed: 1,
      error: error.message,
      event: `参考图识别失败：${error.message}`
    });
    state.thinking = {
      status: "idle",
      target: "生成设计系列",
      text: `参考图识别未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    state.analyzingDesignSeries = false;
    renderWorkflowCanvas();
  }
}

async function generateDesignSeries(options = {}) {
  const referenceImages = options.referenceImages || activeReferenceImages();
  if (!referenceImages.length) {
    toast("请先上传参考图");
    return;
  }

  const busyButton = options.busyButton || els.renderButton;
  const outputCount = clampImageCount(options.count || state.generation.count, "designseries", { allowSingle: options.allowSingle });
  startActiveTask({
    type: "design-series",
    label: `生成设计系列 · ${outputCount} 张`,
    total: outputCount,
    userPrompt: currentCanvasUserPrompt(),
    referenceCount: referenceImages.length
  });
  setBusy(busyButton, true, "生成中");
  state.thinking = {
    status: "active",
    target: "生成设计系列",
    text: outputCount > 1
      ? `${state.thinkingModeEnabled ? "正在根据参考图识别结果组织成套设计策略" : "思考模式已关闭，正在使用设计系列预设"}，并调用 Image Gen 生成 ${outputCount} 张设计系列图。`
      : `${state.thinkingModeEnabled ? "正在根据参考图识别结果组织成套设计策略" : "思考模式已关闭，正在使用设计系列预设"}，并调用 Image Gen 生成一套设计图。`
  };
  renderWorkflowCanvas();
  toast(outputCount > 1 ? `${thinkingPipelineLabel()} 正在生成 ${outputCount} 张设计系列图` : `${thinkingPipelineLabel()} 正在生成设计系列图`);
  try {
    let latestRecord = null;
    let reusableAnalysis = state.thinkingModeEnabled ? state.designSeriesAnalysis : null;
    if (reusableAnalysis && !reusableAnalysis.project_dna && !reusableAnalysis.spatial_sequence && !reusableAnalysis.scene_briefs?.length) {
      reusableAnalysis = null;
      state.designSeriesAnalysis = null;
    }
    const baseIntent = [
      buildCurrentIntent(),
      outputCount > 1 && outputCount !== state.generation.count ? designSeriesCountPrompt(outputCount) : ""
    ].filter(Boolean).join("\n");
    let analysisFallbackNotified = Boolean(reusableAnalysis?.fallback_reason);
    for (let index = 0; index < outputCount; index += 1) {
      updateActiveTask({
        current: index + 1,
        endpoint: getActiveImageEndpoint(),
        event: `开始生成第 ${index + 1}/${outputCount} 张设计系列图`
      });
      const scenePrompt = designSeriesScenePrompt(index + 1, outputCount, reusableAnalysis);
      const variantIntent = outputCount > 1
        ? [
            baseIntent,
            scenePrompt,
            `本次输出为第 ${index + 1}/${outputCount} 张设计系列图。请让它承担这一套系列中的明确空间角色，并保持参考图风格、材质、元素、空间动线和项目DNA统一。`,
            "图片之间必须存在空间衔接关联：像同一个项目中的入口、公共区、私密区、过渡空间和细节节点，而不是同风格但互不相关的房间。",
            "统一风格不等于重复同一个角度；本张必须是多场域、多角度、多视角、多功能分区系列中的一个明确节点。",
            "本张需要和前后张共享可识别元素：连续墙地面材料、门洞/走廊/窗景、重复灯具、同款家具、木作/金属/石材节点、相同色彩分级或同一室外环境线索。",
            "构图、视角、陈列或灯光细节可以变化，但不能改变项目预算等级、家具年代、材质体系、灯光哲学、渲染风格和设计团队气质。",
            "必须按当前项目类型和出图数量执行空间排布；例如民宿/酒店项目不能只反复生成大堂或沙发区，必须覆盖大堂、公共客厅、主卧/客房、工区/茶室/餐吧、卫浴/泡池/走廊/材料节点等合适组合。",
            "禁止把同一个主视觉、同一个圆形大厅、同一个沙发区、同一个门头或同一个机位反复生成多张。"
          ].filter(Boolean).join("\n")
        : baseIntent;
      const data = await api("/api/design-series", {
        brief: readBrief(),
        intent: variantIntent,
        userPrompt: currentCanvasUserPrompt(),
        referenceImages,
        analysis: reusableAnalysis,
        seriesIndex: index + 1,
        seriesCount: outputCount,
        size: selectedGenerationSize(),
        quality: selectedGenerationQuality(),
        thinkingEnabled: state.thinkingModeEnabled
      });
      reusableAnalysis = data.analysis;
      state.designSeriesAnalysis = data.analysis;
      if (data.analysis?.fallback_reason && !analysisFallbackNotified) {
        analysisFallbackNotified = true;
        updateActiveTask({
          event: `参考图分析降级，已用预设继续：${data.analysis.fallback_reason}`
        });
      }
      const record = {
        ...data.render,
        id: `series-${Date.now()}-${index}`,
        title: outputCount > 1
          ? `${data.render?.sceneBrief?.title || data.analysis?.title || "设计系列图"} ${index + 1}`
          : data.render?.sceneBrief?.title || data.analysis?.title || "设计系列图",
        mode: "designseries",
        intent: [data.render?.sceneBrief?.title, data.analysis?.series_strategy || variantIntent].filter(Boolean).join(" · "),
        sceneBrief: data.render?.sceneBrief || null,
        seriesIndex: index + 1,
        seriesCount: outputCount,
        referenceCount: referenceImages.length,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      };
      state.designSeriesResults.push(record);
      state.render = record;
      state.renders.push(record);
      latestRecord = record;
      updateActiveTask({
        success: state.activeTask.success + 1,
        endpoint: data.render?.endpoint || state.activeTask.endpoint,
        finalPrompt: data.render?.prompt || state.activeTask.finalPrompt,
        outputs: [...state.activeTask.outputs, record],
        attempts: data.render?.attempts || [],
        event: `第 ${index + 1}/${outputCount} 张设计系列图完成`
      });
      renderWorkflowCanvas();
    }
    state.thinking = {
      status: "done",
      target: latestRecord?.title || "生成设计系列",
      text: outputCount > 1
        ? `${state.designSeriesAnalysis?.fallback_reason ? "参考图分析已降级为内置预设" : state.thinkingModeEnabled ? "gpt-5.5 已完成参考图识别、系列建议和出图策略" : "已使用设计系列内置预设"}，并调用 Image Gen 生成 ${outputCount} 张设计系列图。`
        : `${state.designSeriesAnalysis?.fallback_reason ? "参考图分析已降级为内置预设" : state.thinkingModeEnabled ? "gpt-5.5 已完成参考图识别、系列建议和出图策略" : "已使用设计系列内置预设"}，并调用 Image Gen 生成设计系列图。`
    };
    renderGeneratedResult();
    renderDesignSeriesAnalysisView();
    renderWorkflowCanvas();
    completeActiveTask("success", outputCount > 1 ? `已完成 ${outputCount} 张设计系列图` : "设计系列图完成");
    toast(outputCount > 1 ? `已生成 ${outputCount} 张设计系列图` : "设计系列已生成");
  } catch (error) {
    updateActiveTask({
      status: "failed",
      failed: Math.min(outputCount, (state.activeTask?.failed || 0) + 1),
      error: error.message,
      event: `设计系列生成失败：${error.message}`
    });
    state.thinking = {
      status: "idle",
      target: "生成设计系列",
      text: `生成未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    setBusy(busyButton, false);
    renderWorkflowCanvas();
  }
}

async function runPrimaryAction(options = {}) {
  if (state.mode === "custom") {
    await renderFromImages({ ...options, allowNoPrimary: true, ignorePrimaryImage: !state.primaryImage });
    return;
  }
  if (state.mode === "cad") {
    await convertPlanToCad(options);
    return;
  }
  if (state.mode === "designseries") {
    await generateDesignSeries(options);
    return;
  }
  if (state.mode === "upscale") {
    await enhanceQualityCurrentImage(options);
    return;
  }
  if (state.mode === "sharpen") {
    await sharpenCurrentImage(options);
    return;
  }
  if (state.mode === "materialboard" && !state.primaryImage && activeReferenceImages().length) {
    const [primaryReference, ...restReferences] = activeReferenceImages();
    await renderFromImages({
      ...options,
      primaryImage: primaryReference,
      referenceImages: restReferences,
      selection: null,
      title: "材料板"
    });
    return;
  }
  await renderFromImages(options);
}

async function enhanceQualityCurrentImage(options = {}) {
  if (!state.primaryBitmap || !state.primaryImage) {
    toast(modeConfig(state.mode).missing);
    return;
  }

  const busyButton = options.busyButton || els.renderButton;
  startActiveTask({
    type: "local-upscale",
    label: "画质增强",
    total: 1,
    userPrompt: currentCanvasUserPrompt(),
    referenceCount: activeReferenceImages().length
  });
  setBusy(busyButton, true, "增强中");
  const startedAt = new Date();
  try {
    const result = localEnhanceQualityImage(state.primaryBitmap, state.primaryImage.name || "enhanced");
    state.imageToolResults.push(result);
    state.render = result;
    state.renders.push(result);
    state.thinking = {
      status: "done",
      target: "画质增强",
      text: `已完成本地算法增强：自动色阶、白平衡、轻度降噪、局部对比、锐化和轻量放大，不消耗模型生成。${featureOptimizationNotes.upscale}`
    };
    updateActiveTask({
      success: 1,
      finalPrompt: result.intent,
      outputs: [result],
      event: "本地画质增强完成"
    });
    renderGeneratedResult();
    renderWorkflowCanvas();
    logClientTask("local-upscale", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: {
        mode: "upscale",
        primaryImage: { name: state.primaryImage.name, type: state.primaryImage.type }
      },
      result: {
        title: result.title,
        mode: result.mode,
        intent: result.intent
      }
    });
    toast("画质增强完成");
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `画质增强失败：${error.message}` });
    toast(error.message);
  } finally {
    completeActiveTask(state.activeTask?.failed ? "failed" : "success");
    setBusy(busyButton, false);
  }
}

async function sharpenCurrentImage(options = {}) {
  if (!state.primaryBitmap || !state.primaryImage) {
    toast(modeConfig(state.mode).missing);
    return;
  }

  const busyButton = options.busyButton || els.renderButton;
  startActiveTask({
    type: "local-sharpen",
    label: "提高锐化",
    total: 1,
    userPrompt: currentCanvasUserPrompt(),
    referenceCount: activeReferenceImages().length
  });
  setBusy(busyButton, true, "锐化中");
  const startedAt = new Date();
  try {
    const result = localSharpenImage(state.primaryBitmap, state.primaryImage.name || "sharpened");
    state.imageToolResults.push(result);
    state.render = result;
    state.renders.push(result);
    state.thinking = {
      status: "done",
      target: "提高锐化",
      text: `已完成本地锐化处理：增强边缘、局部对比和整体清晰度，不消耗模型生成。${featureOptimizationNotes.sharpen}`
    };
    updateActiveTask({
      success: 1,
      finalPrompt: result.intent,
      outputs: [result],
      event: "本地锐化完成"
    });
    renderGeneratedResult();
    renderWorkflowCanvas();
    logClientTask("local-sharpen", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: {
        mode: "sharpen",
        primaryImage: { name: state.primaryImage.name, type: state.primaryImage.type }
      },
      result: {
        title: result.title,
        mode: result.mode,
        intent: result.intent
      }
    });
    toast("锐化完成");
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `锐化失败：${error.message}` });
    toast(error.message);
  } finally {
    completeActiveTask(state.activeTask?.failed ? "failed" : "success");
    setBusy(busyButton, false);
  }
}

async function convertPlanToCad(options = {}) {
  if (!state.primaryBitmap || !state.primaryImage) {
    toast("请先上传平面图图片");
    return;
  }

  const busyButton = options.busyButton || els.renderButton;
  startActiveTask({
    type: "local-cad",
    label: "平面图转 CAD",
    total: 1,
    userPrompt: currentCanvasUserPrompt(),
    referenceCount: 0
  });
  setBusy(busyButton, true, "提取中");
  const startedAt = new Date();
  state.thinking = {
    status: "active",
    target: "平面图转CAD",
    text: `正在识别图纸里的深色墙线、水平/垂直线段和主要轮廓，并生成 DXF / SVG 文件。${featureOptimizationNotes.cad}`
  };
  renderWorkflowCanvas();

  try {
    const result = extractCadFromBitmap(state.primaryBitmap, readBrief().projectName || "plan");
    state.cadResult = result;
    state.cadResults.push(result);
    state.thinking = {
      status: "done",
      target: "平面图转CAD",
      text: `已提取 ${result.lineCount} 条 CAD 线段。第一版采用轻量图像矢量化，适合快速描底；后续可叠加 AI 识别墙、门、窗、房间。`
    };
    updateActiveTask({
      success: 1,
      finalPrompt: `${result.lineCount} 条线段 · ${result.fileBase}.dxf`,
      outputs: [result],
      event: "CAD 线段提取完成"
    });
    renderWorkflowCanvas();
    logClientTask("local-cad", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: {
        mode: "cad",
        primaryImage: { name: state.primaryImage.name, type: state.primaryImage.type }
      },
      result: {
        title: result.title,
        outputUrl: result.svgUrl,
        outputFile: result.fileBase,
        thinking: `${result.lineCount} 条线段`
      }
    });
    toast(`已生成 CAD：${result.lineCount} 条线段`);
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `CAD 提取失败：${error.message}` });
    state.thinking = {
      status: "idle",
      target: "平面图转CAD",
      text: `CAD 提取未完成：${error.message}`
    };
    toast(error.message);
  } finally {
    completeActiveTask(state.activeTask?.failed ? "failed" : "success");
    setBusy(busyButton, false);
    renderWorkflowCanvas();
  }
}

function buildCurrentIntent() {
  const resourceText = state.assets.length
    ? `画布资源：${state.assets.map((asset) => `${asset.type}:${asset.title}(${asset.prompt})`).join("；")}`
    : "";
  const size = generationDimensions();
  const referenceOnly = isReferenceOnlyMode();
  const meaning = workflowButtonMeanings[normalizeClientMode(state.mode)] || workflowButtonMeanings.custom;
  const referenceImages = activeReferenceImages();
  const referenceWeightText = state.referenceImages.length
    ? state.referenceImages.map((image, index) => {
        const weightOption = referenceWeightOptions.find((item) => item.value === (image.weight || "default")) || referenceWeightOptions[0];
        const usageOption = referenceUsageOptions.find((item) => item.value === (image.usage || "auto")) || referenceUsageOptions[0];
        return `参考图 ${index + 1}：${weightOption.label}；${weightOption.prompt} 使用意图：${usageOption.label}；${usageOption.prompt}`;
      }).join(" ")
    : "";
  const referenceText = referenceImages.length
    ? `参考图读取：当前有 ${referenceImages.length} 张参与生成的参考图。不要把参考图硬分类为“材料、家具、灯光、色彩”等固定角色；请先把每张图作为完整参考自由综合读取，再把用户显式选择的使用意图当作优先观察线索，并按参考权重判断可用信息。${referenceWeightText}`
    : "参考图读取：未上传参考图。";
  const structureText = referenceOnly
    ? "参考图融合方式：不强制保留某一张参考图的几何结构，优先抽取空间语言、材料、灯光、构图、色彩和审美标准；如果用户明确指定主参考，以用户指令为准。"
    : `底图符合度：${els.structureStrength.value}`;
  const generationText = state.mode === "designseries"
    ? `图片比例：${selectedGenerationAspectLabel()}；画质：${state.generation.quality.toUpperCase()}；尺寸：${size.width}x${size.height}；出图数量：${state.generation.count}；生成形式：设计系列图`
    : `图片比例：${selectedGenerationAspectLabel()}；画质：${state.generation.quality.toUpperCase()}；尺寸：${size.width}x${size.height}；出图数量：${state.generation.count}`;
  const designSeriesCountText = state.mode === "designseries" ? designSeriesCountPrompt(state.generation.count) : "";
  const inputAnalysisText = state.primaryImageAnalysis
    ? `输入图识别：${state.primaryImageAnalysis.label}；建议模式：${suggestedModeLabel(state.primaryImageAnalysis.suggestedMode)}；判断理由：${state.primaryImageAnalysis.reason}。如果用户当前选择的按钮不同，不强制拦截，但最终提示词必须显式处理这种风险。`
    : "";
  const workflowText = state.primaryImage?.workflowId
    ? `连续工作流：workflowId=${state.primaryImage.workflowId}；parentImageId=${state.primaryImage.parentImageId || ""}；当前阶段=${workflowStepLabel(state.mode)}。`
    : isPlanWorkflowMode(state.mode)
      ? `连续工作流：当前阶段=${workflowStepLabel(state.mode)}；本次输出需要可作为下一步输入。`
      : "";
  const selectionText = state.selection
    ? `红框选区：x=${state.selection.x}, y=${state.selection.y}, width=${state.selection.width}, height=${state.selection.height}。如果当前是“3D平面图转效果图”，最终人视角画面必须聚焦这个区域，同时保留整体空间逻辑。`
    : "";
  const planRenderRegionText = normalizeClientMode(state.mode) === "plan-render"
    ? planRenderRegionInfo(state.mode, state.selection, referenceImages)?.prompt || ""
    : "";
  const scenePresetText = state.selectedScenePreset && presets[state.selectedScenePreset]
    ? `场景模板：${presets[state.selectedScenePreset].spaceType}；${presets[state.selectedScenePreset].command}`
    : "";
  const styleText = state.selectedStylePreset && stylePresetDescriptions[state.selectedStylePreset]
    ? `风格按钮：${state.selectedStylePreset}；${stylePresetDescriptions[state.selectedStylePreset]}`
    : "";
  const hiddenPrompt = hiddenCanvasPromptBlock();
  const userPrompt = userPromptPriorityBlock();
  return [
    `当前能力按钮：${meaning.label}`,
    `按钮意义：${meaning.meaning}`,
    state.thinkingModeEnabled
      ? "思考模式：开启。先用 gpt-5.5 读取输入图、参考图、当前按钮功能、用户描述和预设模板，再优化最终提示词交给 Image Gen。"
      : "思考模式：关闭。不做额外提示词融合，只把当前网页预设提示词、隐藏模板和用户描述作为直接生图提示词。",
    featureOptimizationNotes[normalizeClientMode(state.mode)],
    `保留重点：${meaning.preserve}`,
    `变化重点：${meaning.change}`,
    inputAnalysisText,
    workflowText,
    selectionText,
    planRenderRegionText,
    referenceText,
    `输出类型：${els.outputType.value}`,
    structureText,
    generationText,
    designSeriesCountText,
    scenePresetText,
    styleText,
    resourceText,
    hiddenPrompt,
    els.renderIntent.value.trim(),
    userPrompt
  ].filter(Boolean).join("\n");
}

function activeReferenceImages(images = state.referenceImages) {
  return images
    .filter((image) => (image.weight || "default") !== "ignore")
    .map((image) => ({ ...image, weight: image.weight || "default", usage: image.usage || "auto" }));
}

function sourceAspectRatio() {
  if (state.primaryBitmap?.naturalWidth && state.primaryBitmap?.naturalHeight) {
    return [state.primaryBitmap.naturalWidth, state.primaryBitmap.naturalHeight];
  }
  const reference = activeReferenceImages()[0] || state.referenceImages[0];
  if (reference?.width && reference?.height) return [reference.width, reference.height];
  return aspectRatioMap["1:1"];
}

function selectedGenerationAspectLabel() {
  return state.generation.aspect === "source" ? "参考原图比例" : state.generation.aspect;
}

function selectedGenerationAspectShortLabel() {
  return state.generation.aspect === "source" ? "原图比例" : state.generation.aspect;
}

function imageCountOptionsForMode(mode = state.mode) {
  return normalizeClientMode(mode) === "designseries" ? [4, 6, 8] : [1, 2, 3, 4];
}

function clampImageCount(value, mode = state.mode, options = {}) {
  const numeric = Number(value) || 0;
  if (options.allowSingle && numeric === 1) return 1;
  const allowed = imageCountOptionsForMode(mode);
  if (allowed.includes(numeric)) return numeric;
  return allowed.find((count) => count >= numeric) || allowed[allowed.length - 1];
}

function designSeriesContextText(analysis = state.designSeriesAnalysis) {
  const brief = readBrief();
  return [
    brief.projectName,
    brief.spaceType,
    brief.functions,
    brief.style,
    brief.deliveryPurpose,
    brief.reviewAudience,
    brief.location,
    brief.constraints,
    brief.preserveNotes,
    currentCanvasUserPrompt(),
    els.renderIntent?.value?.trim?.() || "",
    analysis?.project_type,
    analysis?.title,
    analysis?.summary,
    analysis?.series_strategy,
    analysis?.spatial_sequence,
    ...(Array.isArray(analysis?.suggested_outputs) ? analysis.suggested_outputs : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function detectDesignSeriesProjectType(analysis = state.designSeriesAnalysis) {
  const text = designSeriesContextText(analysis);
  const definitions = [
    { key: "hospitality", label: "民宿/酒店/度假住宿", keywords: ["民宿", "酒店", "旅宿", "旅馆", "宾馆", "客房", "套房", "大堂", "接待大堂", "度假", "度假村", "主卧", "泡池", "hotel", "resort", "homestay", "guesthouse", "hospitality", "lobby", "suite", "bnb", "b&b"] },
    { key: "foodbeverage", label: "餐饮/咖啡/酒吧", keywords: ["咖啡", "餐厅", "餐饮", "酒吧", "茶饮", "茶室", "烘焙", "面包店", "小酒馆", "餐吧", "cafe", "coffee", "restaurant", "bar", "bistro", "bakery", "tearoom"] },
    { key: "office", label: "办公/企业接待", keywords: ["办公", "办公室", "企业", "会议", "工区", "开放办公", "接待区", "workplace", "office", "workspace", "cowork", "meeting", "reception"] },
    { key: "retail", label: "零售/展厅/品牌空间", keywords: ["零售", "店铺", "商店", "买手店", "展厅", "展示", "陈列", "快闪", "品牌空间", "体验店", "retail", "shop", "store", "showroom", "display", "boutique", "pop-up"] },
    { key: "residential", label: "住宅/居住空间", keywords: ["住宅", "公寓", "别墅", "家装", "居住", "客厅", "餐厨", "厨房", "卧室", "主卧", "书房", "阳台", "residential", "apartment", "villa", "home", "living room", "bedroom", "kitchen"] }
  ];
  let best = { key: "generic", label: "通用空间项目", score: 0 };
  definitions.forEach((definition) => {
    const score = definition.keywords.reduce((total, keyword) => total + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { key: definition.key, label: definition.label, score };
  });
  return best;
}

function designSeriesPlanCount(count = state.generation.count) {
  const outputCount = clampImageCount(count, "designseries");
  if (outputCount >= 8) return 8;
  if (outputCount >= 6) return 6;
  return 4;
}

function designSeriesRole(title, role, camera) {
  return [title, role, camera];
}

function designSeriesScenePlan(count = state.generation.count, analysis = state.designSeriesAnalysis) {
  const planCount = designSeriesPlanCount(count);
  const projectType = detectDesignSeriesProjectType(analysis).key;
  const catalog = {
    hospitality: {
      4: [
        designSeriesRole("大堂/到达接待主视觉", "建立民宿/酒店第一印象：入口、接待、大堂记忆点和通往公共区的动线", "广角或中广角人视角，必须看到接待/门厅/等候锚点和空间入口关系"),
        designSeriesRole("公共客厅/共享休闲区", "展示客人公共生活核心：会客、休闲、家具分组、墙顶地系统和完整材质灯光语言", "换一个轴线的人视角宽画幅，显示沙发/休闲座、通道、顶面和墙地面连续性"),
        designSeriesRole("主卧/客房套房", "展示私密住宿空间：主卧、客房或套房，把同一项目DNA转译到更安静的尺度", "安静人视角，包含床、窗景或坐榻/休息角，不能重复大堂和公共客厅机位"),
        designSeriesRole("工区/茶歇/餐吧或材料节点", "补足使用场景：工区、阅读、茶室、早餐餐吧，或一个能串联前面空间的材料/灯光节点", "中景功能视角或近景节点，强调同款灯具、木作、石材、肌理和收口")
      ],
      6: [
        designSeriesRole("室外/到达入口", "从场地、街巷、庭院或门头建立民宿/酒店外部识别度", "室外或半室外广角，显示路径、入口、立面/院落和项目气质"),
        designSeriesRole("大堂/接待", "第一处室内接待空间，承接入口并明确酒店/民宿运营功能", "宽阔人视角，显示接待台、等候区、主灯光层次和进入公共区的动线"),
        designSeriesRole("公共客厅/休闲会客区", "主要公共生活空间，让客人停留、交流、休闲", "新轴线宽画幅，显示家具分组、通道、墙顶地材料和氛围"),
        designSeriesRole("工区/茶室/餐吧/活动区", "第二公共功能：工作、阅读、茶饮、早餐、餐吧或小型活动，和客厅形成用途差异", "中广角运营视角，桌面/吧台/书架/活动家具清晰可见"),
        designSeriesRole("主卧/客房套房", "安静私密空间，展示住宿舒适度和同一材质灯光系统在客房里的表达", "安静人视角，床、床头灯、窗景或坐榻形成焦点"),
        designSeriesRole("卫浴/泡池/走廊材料节点", "支持空间或记忆节点：卫浴、泡池、走廊、楼梯、门洞或材料收口", "更窄或更近的受控视角，强调水、石材、木作、灯带、肌理和空间连续性")
      ],
      8: [
        designSeriesRole("外观/场地入口", "项目外部第一印象：院落、街巷、景观、门头或入口立面", "室外广角，建立环境、入口路径和项目识别度"),
        designSeriesRole("门厅/大堂接待", "第一处室内阈值和接待功能", "入口人视角，显示接待、等候、灯光和进入公共区的方向"),
        designSeriesRole("公共客厅/共享休闲区", "主公共区，承载会客、休闲和空间气质", "宽画幅室内视角，显示沙发/休闲座、通道和完整材料系统"),
        designSeriesRole("茶室/餐吧/早餐区", "餐饮或茶歇功能，补足民宿酒店运营场景", "中广角活动视角，桌面、吧台、餐椅、灯光和服务细节清晰"),
        designSeriesRole("工区/阅读/活动区", "工作、阅读、小会客或活动区，形成另一种公共使用方式", "中景功能视角，桌面、书架、工作灯或活动家具成为焦点"),
        designSeriesRole("主卧/客房套房", "住宿核心空间：主卧、客房或套房", "安静人视角，床、坐榻、窗景和床头灯光完整"),
        designSeriesRole("卫浴/泡池/更衣支持空间", "湿区或支持空间，证明设计语言不只停留在公共区", "受控视角，突出水、石、木作、柔光和细腻收口"),
        designSeriesRole("走廊/楼梯/材料节点特写", "串联空间的走廊、楼梯、门洞、墙地收口或灯光节点", "线性透视或近景细节，重复前面出现的材料和灯具语言")
      ]
    },
    residential: {
      4: [
        designSeriesRole("玄关/客厅主视觉", "建立住宅入户到客厅的整体气质", "宽画幅人视角，显示玄关线索、客厅家具和墙顶地系统"),
        designSeriesRole("餐厨/家庭活动区", "展示餐厅、厨房或家庭活动空间", "中广角，桌面/岛台/柜体和动线清晰"),
        designSeriesRole("主卧/书房安静区", "展示卧室、主卧套房或书房的安静尺度", "安静人视角，床/书桌/窗景/收纳形成焦点"),
        designSeriesRole("卫浴/阳台/收纳材料节点", "补足支持空间或材料节点", "近景或中景，显示灯光、收口、墙地面材质和功能细节")
      ],
      6: [
        designSeriesRole("玄关/入户收纳", "入户、收纳和第一材料线索", "入口视角，柜体、灯光和通向客厅的关系清晰"),
        designSeriesRole("客厅/家庭核心区", "家庭主要生活空间", "宽画幅客厅视角，显示家具分组和空间尺度"),
        designSeriesRole("餐厨/岛台/家庭活动", "餐厅、厨房、岛台或家庭活动区", "中广角，餐桌/岛台/柜体和操作关系清晰"),
        designSeriesRole("书房/儿童/多功能房", "不同功能房间，拉开空间用途", "中景房间视角，桌面/书架/灵活家具清晰"),
        designSeriesRole("主卧/套房", "私密卧室尺度", "安静人视角，床、床头、窗景和储物逻辑可读"),
        designSeriesRole("卫浴/阳台/材料节点", "支持空间或细节节点", "受控视角，显示湿区/阳台/收口和材料连续性")
      ],
      8: [
        designSeriesRole("玄关/门厅", "住宅入口和收纳系统", "入口视角"),
        designSeriesRole("客厅", "主要生活空间", "宽画幅客厅视角"),
        designSeriesRole("餐厅", "家庭用餐空间", "中广角餐厅视角"),
        designSeriesRole("厨房/岛台", "操作和储物空间", "厨房运营视角"),
        designSeriesRole("书房/多功能房", "工作、学习或弹性功能", "桌面/书架视角"),
        designSeriesRole("主卧/套房", "私密休息空间", "安静卧室视角"),
        designSeriesRole("卫浴/衣帽间", "私密支持功能", "受控支持空间视角"),
        designSeriesRole("阳台/走廊/材料节点", "过渡或记忆节点", "线性或近景细节视角")
      ]
    },
    office: {
      4: [
        designSeriesRole("前台/企业接待", "企业入口和接待形象", "宽画幅前台视角，避免可读文字和logo"),
        designSeriesRole("开放工区/协作区", "主要工作空间", "宽画幅工位/协作视角，显示桌面节奏和通道"),
        designSeriesRole("会议/洽谈/专注空间", "正式或半私密办公功能", "中广角会议/专注视角"),
        designSeriesRole("茶水/走廊/材料节点", "支持空间和材料连续性", "受控支持或节点视角")
      ],
      6: [
        designSeriesRole("入口/前台接待", "企业到达与接待", "宽画幅接待视角"),
        designSeriesRole("开放工区", "主要工位空间", "宽画幅工位节奏视角"),
        designSeriesRole("协作/项目讨论区", "团队讨论功能", "中广角协作视角"),
        designSeriesRole("会议室/洽谈室", "正式会议或客户沟通", "受控会议视角"),
        designSeriesRole("独立办公室/专注间/电话间", "私密或专注尺度", "安静小空间视角"),
        designSeriesRole("茶水区/走廊/材料节点", "支持和过渡空间", "线性或近景节点视角")
      ],
      8: [
        designSeriesRole("前台/品牌入口", "到达与接待", "宽画幅前台视角"),
        designSeriesRole("开放工区", "工位空间", "宽画幅工区视角"),
        designSeriesRole("协作区", "团队讨论", "中广角协作视角"),
        designSeriesRole("会议室", "正式会议", "会议室视角"),
        designSeriesRole("主管/独立办公室", "私密办公", "安静办公室视角"),
        designSeriesRole("专注间/电话间", "小尺度专注支持", "紧凑空间视角"),
        designSeriesRole("茶水/休息区", "支持休息", "支持空间视角"),
        designSeriesRole("走廊/材料节点", "过渡与材料记忆", "线性或近景节点视角")
      ]
    },
    foodbeverage: {
      4: [
        designSeriesRole("门头/入口主视觉", "店铺到达和第一识别度", "外立面或入口广角"),
        designSeriesRole("点单/吧台/核心运营区", "服务和运营核心", "吧台/点单人视角"),
        designSeriesRole("堂食/休闲座位区", "主要客座体验", "宽画幅堂食视角"),
        designSeriesRole("包间/卡座/材料氛围节点", "次级座位或细节记忆", "中景座位或近景节点")
      ],
      6: [
        designSeriesRole("外立面/入口", "街边或场地到达", "外部广角"),
        designSeriesRole("点单/接待吧台", "服务核心", "吧台运营视角"),
        designSeriesRole("主堂食区", "主要用餐空间", "宽画幅堂食视角"),
        designSeriesRole("卡座/包间/多人桌", "第二座位类型", "中广角卡座/包间视角"),
        designSeriesRole("开放厨房/展示/零售陈列", "运营或陈列细节", "运营/展示视角"),
        designSeriesRole("灯光/材料/餐具氛围特写", "餐饮记忆节点", "近景氛围细节")
      ],
      8: [
        designSeriesRole("外立面/门头", "店铺识别", "外立面视角"),
        designSeriesRole("入口/等候", "到达和等候", "入口视角"),
        designSeriesRole("点单/吧台", "服务核心", "吧台视角"),
        designSeriesRole("主堂食区", "主要客座", "宽画幅堂食视角"),
        designSeriesRole("卡座/包间", "第二座位类型", "卡座视角"),
        designSeriesRole("露台/窗边/外摆", "边界座位氛围", "窗边或外摆视角"),
        designSeriesRole("厨房/陈列/运营细节", "运营细节", "运营节点视角"),
        designSeriesRole("材料/灯光/餐具特写", "记忆节点", "近景细节")
      ]
    },
    retail: {
      4: [
        designSeriesRole("门头/入口展示", "品牌入口和第一陈列", "门头或入口广角"),
        designSeriesRole("主陈列/销售核心区", "主要销售陈列空间", "宽画幅陈列视角"),
        designSeriesRole("体验/洽谈/试衣/产品场景", "客户体验功能", "中广角体验视角"),
        designSeriesRole("收银/橱窗/材料节点", "交易、橱窗或展具细节", "支持或近景节点")
      ],
      6: [
        designSeriesRole("外立面/橱窗", "店铺外部识别", "橱窗外观视角"),
        designSeriesRole("入口/迎宾陈列", "第一室内陈列", "入口陈列视角"),
        designSeriesRole("主陈列区", "主要销售空间", "宽画幅陈列视角"),
        designSeriesRole("体验/试衣/洽谈区", "客户体验空间", "中景体验视角"),
        designSeriesRole("收银/包装/后场支持", "交易和支持功能", "受控支持空间视角"),
        designSeriesRole("展具/材料/灯光节点", "展具和材料记忆", "近景节点视角")
      ],
      8: [
        designSeriesRole("外立面/橱窗", "外部识别", "外观视角"),
        designSeriesRole("入口迎宾", "入口阈值", "入口视角"),
        designSeriesRole("主陈列区", "主要销售陈列", "宽画幅陈列视角"),
        designSeriesRole("重点产品岛/艺术装置", "主推产品节点", "重点陈列视角"),
        designSeriesRole("体验/试衣/洽谈", "客户体验", "体验区视角"),
        designSeriesRole("收银/包装", "交易功能", "收银视角"),
        designSeriesRole("后场/走廊/仓储入口", "支持过渡", "受控过渡视角"),
        designSeriesRole("展具/材料/灯光特写", "材料和展具记忆", "近景节点")
      ]
    },
    generic: {
      4: [
        designSeriesRole("到达/入口/项目主视觉", "建立项目第一印象，连接到公共核心空间", "广角主视觉，显示入口、门厅、第一处空间锚点和通往公共区的动线"),
        designSeriesRole("公共核心/主要功能区", "承接入口，展示主要公共活动区和动线", "人视角宽画幅，显示家具分组、通道、墙顶地系统和主要功能场景"),
        designSeriesRole("次级功能/安静场域", "从公共区进入另一种功能尺度", "换一个人视角或更安静的镜头，展示套房、办公、餐厨、洽谈、休息、展示或其他不同功能区"),
        designSeriesRole("过渡空间/材料节点", "把材料节点和前面空间连接起来", "近景或中景，强调走廊、门洞、楼梯、收口、灯光节点或重复材质细节")
      ],
      6: [
        designSeriesRole("室外/入口", "从场地进入项目", "竖向主视觉或入口视角，建立项目外部语言"),
        designSeriesRole("接待/公共主空间", "从入口进入公共核心", "宽阔人视角，显示主空间、动线和第一组材料系统"),
        designSeriesRole("休闲/餐厨/办公/展示等次级功能区", "公共空间的延伸功能区", "中广角，展示第二个功能场景但复用同一材质和灯光"),
        designSeriesRole("安静/私密/套房/会议等不同尺度空间", "从公共区过渡到更安静或更聚焦的功能尺度", "安静人视角，展示同一设计语言在不同尺度中的表达"),
        designSeriesRole("走廊/楼梯/卫浴/服务等过渡或支持空间", "连接前后空间和细节节点", "更窄或更聚焦的过渡空间视角，证明空间连续性"),
        designSeriesRole("材料节点/氛围特写", "收束整个项目的记忆点", "近景/中景，重复核心材料、灯具、木作或肌理")
      ],
      8: [
        designSeriesRole("外观/入口", "场地到项目入口", "建立外部识别度"),
        designSeriesRole("门厅/接待", "入口到公共区", "显示第一处室内阈值"),
        designSeriesRole("公共休闲区", "公共区主体", "展示主要活动空间"),
        designSeriesRole("餐厨/吧台/办公/展示/活动区", "公共区的功能延伸", "展示运营、办公、陈列或生活场景"),
        designSeriesRole("安静/私密/客房/会议区", "公共到安静或私密尺度", "展示更克制的空间尺度"),
        designSeriesRole("卫浴/泡池/更衣/服务空间", "支持空间", "展示湿区、服务区或支持空间的材质和灯光"),
        designSeriesRole("走廊/楼梯/过渡", "串联空间", "展示动线、门洞、楼梯或廊道"),
        designSeriesRole("材料节点/氛围特写", "项目记忆点", "展示收口、家具、灯具或材质细节")
      ]
    }
  };
  return (catalog[projectType] || catalog.generic)[planCount] || catalog.generic[4];
}

function designSeriesAllocationSummary(count = state.generation.count, analysis = state.designSeriesAnalysis) {
  const outputCount = clampImageCount(count, "designseries");
  const projectType = detectDesignSeriesProjectType(analysis);
  const plan = designSeriesScenePlan(outputCount, analysis).slice(0, outputCount);
  return [
    `项目类型识别：${projectType.label}。`,
    `本次数量排布：${plan.map((item, index) => `${index + 1}.${item[0]}`).join("；")}。`,
    "如果用户文字明确点名空间，优先覆盖用户点名空间；未点名时按项目类型自动选择最能形成完整设计提案的空间组合。"
  ].join("\n");
}

function designSeriesCountPrompt(count = state.generation.count) {
  const outputCount = clampImageCount(count, "designseries");
  const scenePlan = designSeriesAllocationSummary(outputCount);
  return [
    `设计系列数量规划：本次固定生成 ${outputCount} 张，不使用普通单图数量逻辑。`,
    "功能本意：从参考图生成同一项目的一套设计效果图，重点参考图片中的风格、材质、元素、色彩、灯光氛围、构图、空间关系和设计语言。",
    scenePlan,
    "数量策略：4张时优先覆盖最能说明项目的入口/公共核心/关键私密或重点功能/节点；6张时补足室外到达、支持空间和更完整动线；8张时拆出更多真实使用场景，形成完整项目图集。",
    "先建立系列圣经：项目DNA、空间动线、材质系统、灯光系统、重复母题、家具语言、镜头节奏、渲染质感。",
    "所有图片必须像同一个项目、同一套材质系统、同一个设计团队、同一次渲染输出；每张图空间或视角不同，但风格、材料、元素和审美 DNA 保持一致。",
    "深层设计系列定义：统一风格不是重复同一张图；必须把参考图扩展为多场域、多视角、多角度、多功能分区的项目图集。",
    "空间衔接硬性要求：每张图至少出现一个可连接其他图片的线索，例如相同墙地面材料、同款灯具、重复吊顶/格栅/拱形/木作节点、连续门洞/走廊/窗景、同一家具语言或相同室外景观。",
    "禁止：每张图像来自不同项目、不同预算等级、不同渲染风格、不同色彩分级、不同家具年代；禁止孤立单图、拼贴感、风格漂移、同一角度多风格变体和无空间关系的随机美图。"
  ].join("\n");
}

function designSeriesScenePrompt(index, count, analysis = state.designSeriesAnalysis) {
  const projectType = detectDesignSeriesProjectType(analysis);
  const plan = designSeriesScenePlan(count, analysis);
  const fallback = plan[Math.max(0, index - 1)] || plan[0];
  const scene = analysis?.scene_briefs?.find?.((item) => Number(item.index) === index) || analysis?.scene_briefs?.[index - 1] || {};
  const title = fallback[0];
  const role = [fallback[1], scene.spatial_role ? `参考图扩展方向：${scene.spatial_role}` : ""].filter(Boolean).join("；");
  const camera = [fallback[2], scene.camera ? `参考图建议镜头：${scene.camera}` : ""].filter(Boolean).join("；");
  const repeat = [
    ...(scene.must_repeat || []),
    ...(analysis?.recurring_signatures || [])
  ].filter(Boolean).slice(0, 8).join("；");
  return [
    `项目类型：${analysis?.project_type || projectType.label}。`,
    `本张分镜：第 ${index}/${count} 张，空间角色为「${title}」。`,
    `空间衔接：${scene.connects_from ? `来自 ${scene.connects_from}，` : ""}${role}${scene.connects_to ? `，并连接到 ${scene.connects_to}` : ""}。`,
    `镜头任务：${camera}。`,
    `整套排布：${designSeriesScenePlan(count, analysis).slice(0, count).map((item, itemIndex) => `${itemIndex + 1}.${item[0]}`).join("；")}。`,
    "深层系列要求：本张必须是不同场域、不同功能分区或不同机位的独立空间画面，不是同一个角度/同一个主视觉的轻微变体，也不是同一空间换不同风格。",
    repeat ? `必须重复的系列线索：${repeat}。` : "必须重复同一套墙地面材料、灯具语言、家具年代、木作/金属/石材节点、色彩分级和渲染质感。",
    scene.must_vary ? `本张允许变化：${scene.must_vary}。` : "本张只允许变化空间功能、镜头位置、焦点区域和陈列细节，不允许变化项目风格。"
  ].join("\n");
}

function generationDimensions() {
  if (state.generation.aspect !== "source" && !aspectRatioMap[state.generation.aspect]) state.generation.aspect = "source";
  if (!qualitySizeMap[state.generation.quality]) state.generation.quality = "1k";
  state.generation.count = clampImageCount(state.generation.count, state.mode);
  const ratio = state.generation.aspect === "source" ? sourceAspectRatio() : (aspectRatioMap[state.generation.aspect] || aspectRatioMap["1:1"]);
  const maxEdge = qualitySizeMap[state.generation.quality] || qualitySizeMap["1k"];
  const [ratioWidth, ratioHeight] = ratio;
  let width;
  let height;
  if (ratioWidth >= ratioHeight) {
    width = maxEdge;
    height = Math.max(640, Math.round(maxEdge * ratioHeight / ratioWidth));
  } else {
    width = Math.max(640, Math.round(maxEdge * ratioWidth / ratioHeight));
    height = maxEdge;
  }
  return {
    ...normalizeImageDimensions(width, height)
  };
}

function roundToImageMultiple(value) {
  return clamp(Math.round(value / 16) * 16, 640, 3840);
}

function normalizeImageDimensions(width, height) {
  let nextWidth = roundToImageMultiple(width);
  let nextHeight = roundToImageMultiple(height);
  const minPixels = 655360;
  const maxPixels = 8294400;
  if (nextWidth * nextHeight < minPixels) {
    const scale = Math.sqrt(minPixels / (nextWidth * nextHeight));
    nextWidth = roundToImageMultiple(nextWidth * scale);
    nextHeight = roundToImageMultiple(nextHeight * scale);
  }
  if (nextWidth * nextHeight > maxPixels) {
    const scale = Math.sqrt(maxPixels / (nextWidth * nextHeight));
    nextWidth = roundToImageMultiple(nextWidth * scale);
    nextHeight = roundToImageMultiple(nextHeight * scale);
  }
  if (Math.max(nextWidth, nextHeight) / Math.min(nextWidth, nextHeight) > 3) {
    if (nextWidth > nextHeight) nextHeight = roundToImageMultiple(nextWidth / 3);
    else nextWidth = roundToImageMultiple(nextHeight / 3);
  }
  return { width: nextWidth, height: nextHeight };
}

function selectedGenerationSize() {
  const size = generationDimensions();
  return `${size.width}x${size.height}`;
}

function selectedGenerationQuality() {
  return apiQualityMap[state.generation.quality] || "low";
}

function thinkingPipelineLabel() {
  return state.thinkingModeEnabled ? "gpt-5.5 → Image Gen" : "预设提示词 → Image Gen";
}

function refreshThinkingModeButtons() {
  [els.thinkingModeButton, els.floatingThinkingModeButton].filter(Boolean).forEach((button) => {
    const enabled = state.thinkingModeEnabled;
    const label = enabled ? "思考模式已开启" : "思考模式已关闭";
    const visibleText = enabled ? "思考模式：开" : "思考模式：关";
    const accessibleLabel = button.classList.contains("icon-only")
      ? label
      : `${visibleText}，${enabled ? "已开启" : "已关闭"}`;
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = label;
    button.setAttribute("aria-label", accessibleLabel);
    if (!button.classList.contains("icon-only")) {
      button.textContent = visibleText;
    }
  });
}

function setThinkingModeEnabled(enabled) {
  state.thinkingModeEnabled = Boolean(enabled);
  state.thinking = {
    status: "idle",
    target: state.thinkingModeEnabled ? "思考模式" : "预设模式",
    text: state.thinkingModeEnabled
      ? "思考模式已开启：生成前会先调用 gpt-5.5 读取输入图、参考图、当前按钮意义和用户描述，优化最终提示词后再交给 Image Gen。"
      : "思考模式已关闭：不做额外提示词融合，只使用网页内置预设提示词、隐藏模板和用户描述直接交给 Image Gen。"
  };
  refreshThinkingModeButtons();
  renderWorkflowCanvas();
  toast(state.thinkingModeEnabled ? "思考模式已开启" : "思考模式已关闭");
}

function toggleThinkingMode() {
  setThinkingModeEnabled(!state.thinkingModeEnabled);
}

function isReferenceOnlyMode(mode = state.mode) {
  mode = normalizeClientMode(mode);
  return mode === "designseries" || (mode === "custom" && !state.primaryImage);
}

function hasVisiblePrimaryInput(mode = state.mode) {
  return !isReferenceOnlyMode(mode) && Boolean(state.primaryImage);
}

function refreshGenerationControls() {
  const size = generationDimensions();
  const referenceOnly = isReferenceOnlyMode();
  const hasVisibleInput = referenceOnly ? state.referenceImages.length : (state.primaryImage || state.referenceImages.length);
  if (els.outputWidth) els.outputWidth.value = String(size.width);
  if (els.outputHeight) els.outputHeight.value = String(size.height);
  if (els.agentUploadZone) {
    els.agentUploadZone.classList.toggle("reference-only", referenceOnly);
  }
  if (els.referenceUploadLabel) {
    const baseLabel = referenceOnly ? "上传参考图" : "素材参考图";
    const countText = state.referenceImages.length
      ? `（${state.referenceImages.length}/${referenceImageLimit}）`
      : `（最多 ${referenceImageLimit} 张）`;
    els.referenceUploadLabel.textContent = `${baseLabel}${countText}`;
  }
  document.body.classList.toggle("reference-only-mode", referenceOnly);
  if (els.imageOptionsPanel) els.imageOptionsPanel.hidden = false;
  if (els.uploadPreviewBlock) {
    els.uploadPreviewBlock.hidden = !hasVisibleInput;
  }
  if (els.removePrimaryImageButton) {
    els.removePrimaryImageButton.hidden = !state.primaryImage;
  }
  els.aspectRatioButtons.forEach((button) => {
    const active = button.dataset.aspectRatio === state.generation.aspect;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.aspectRatioSelect) els.aspectRatioSelect.value = state.generation.aspect;
  if (els.generationSummaryLabel) {
    els.generationSummaryLabel.textContent = `${selectedGenerationAspectShortLabel()} · ${state.generation.quality.toUpperCase()} · ${state.generation.count}张`;
  }
  els.qualityTierButtons.forEach((button) => {
    const active = button.dataset.qualityTier === state.generation.quality;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const countOptions = imageCountOptionsForMode();
  els.imageCountButtons.forEach((button, index) => {
    const value = countOptions[index];
    button.hidden = !value;
    if (value) {
      button.dataset.imageCount = String(value);
      button.textContent = String(value);
    }
    const active = value === state.generation.count;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  refreshThinkingModeButtons();
  syncFloatingComposer();
}

function syncFloatingComposer() {
  if (els.floatingModeSelect) els.floatingModeSelect.value = normalizeClientMode(state.mode);
  if (els.floatingAspectRatioSelect) els.floatingAspectRatioSelect.value = state.generation.aspect;
  if (els.floatingQualitySelect) els.floatingQualitySelect.value = state.generation.quality;
  if (els.floatingImageCountSelect) {
    const countOptions = imageCountOptionsForMode();
    const currentOptions = Array.from(els.floatingImageCountSelect.options).map((option) => Number(option.value)).join(",");
    if (currentOptions !== countOptions.join(",")) {
      els.floatingImageCountSelect.innerHTML = countOptions.map((count) => `<option value="${count}">${count}张</option>`).join("");
    }
    els.floatingImageCountSelect.value = String(state.generation.count);
  }
  if (els.floatingCanvasCommand && document.activeElement !== els.floatingCanvasCommand) {
    els.floatingCanvasCommand.value = currentCanvasUserPrompt();
  }
  if (els.floatingContinueEditButton) {
    els.floatingContinueEditButton.disabled = !state.render || state.mode === "cad";
  }
}

function applyCanvasFloatingCollapsed(collapsed = state.canvasFloatingCollapsed) {
  state.canvasFloatingCollapsed = Boolean(collapsed);
  document.body.classList.toggle("canvas-floating-collapsed", state.canvasFloatingCollapsed);
  if (els.canvasFloatingComposer) {
    els.canvasFloatingComposer.setAttribute("aria-hidden", String(state.canvasFloatingCollapsed));
  }
  if (els.canvasFloatingCollapseButton) {
    els.canvasFloatingCollapseButton.setAttribute("aria-expanded", String(!state.canvasFloatingCollapsed));
  }
  if (els.canvasFloatingRestoreButton) {
    els.canvasFloatingRestoreButton.hidden = !state.canvasFloatingCollapsed;
    els.canvasFloatingRestoreButton.setAttribute("aria-expanded", String(!state.canvasFloatingCollapsed));
  }
  if (state.canvasFloatingCollapsed && els.canvasFloatingComposer?.contains(document.activeElement)) {
    focusElement(els.canvasFloatingRestoreButton) || focusElement(els.canvasFocusResultsButton);
  }
  if (!state.canvasFloatingCollapsed && document.activeElement === els.canvasFloatingRestoreButton) {
    focusElement(els.canvasFloatingCollapseButton);
  }
  if (state.canvasFloatingCollapsed) {
    document.querySelector(".canvas-floating-quick")?.removeAttribute("open");
  }
}

function applyAgentPanelCollapsed(collapsed = state.agentPanelCollapsed) {
  const activeBefore = document.activeElement;
  state.agentPanelCollapsed = Boolean(collapsed);
  document.body.classList.toggle("agent-panel-collapsed", state.agentPanelCollapsed);
  if (els.toggleAgentPanelButton) {
    const label = state.agentPanelCollapsed ? "展开创作面板" : "隐藏创作面板";
    const icon = state.agentPanelCollapsed ? "icon-panel-show" : "icon-panel-hide";
    els.toggleAgentPanelButton.innerHTML = `<svg><use href="#${icon}"></use></svg>`;
    els.toggleAgentPanelButton.title = label;
    els.toggleAgentPanelButton.setAttribute("aria-label", label);
    els.toggleAgentPanelButton.setAttribute("aria-pressed", String(state.agentPanelCollapsed));
    els.toggleAgentPanelButton.setAttribute("aria-expanded", String(!state.agentPanelCollapsed));
  }
  if (els.agentPanelRailButton) {
    els.agentPanelRailButton.hidden = !state.agentPanelCollapsed;
    els.agentPanelRailButton.setAttribute("aria-expanded", String(!state.agentPanelCollapsed));
    const railLabel = state.agentPanelCollapsed ? "展开创作面板" : "创作面板已展开";
    els.agentPanelRailButton.title = railLabel;
    els.agentPanelRailButton.setAttribute("aria-label", railLabel);
  }
  if (els.canvasFloatingExpandButton) {
    els.canvasFloatingExpandButton.setAttribute("aria-expanded", String(!state.agentPanelCollapsed));
    const floatingLabel = state.agentPanelCollapsed ? "展开创作面板" : "创作面板已展开";
    els.canvasFloatingExpandButton.title = floatingLabel;
    els.canvasFloatingExpandButton.setAttribute("aria-label", floatingLabel);
  }
  if (els.agentPanelContent) {
    els.agentPanelContent.setAttribute("aria-hidden", String(state.agentPanelCollapsed));
  }
  if (state.agentPanelCollapsed && els.agentPanelContent?.contains(document.activeElement)) {
    focusElement(els.agentPanelRailButton) || focusElement(els.toggleAgentPanelButton);
  }
  if (!state.agentPanelCollapsed && (activeBefore === els.agentPanelRailButton || activeBefore === els.canvasFloatingExpandButton)) {
    focusPanel(els.agentPanelContent);
  }
  if (!state.agentPanelCollapsed) {
    document.querySelector(".canvas-floating-quick")?.removeAttribute("open");
  }
  syncFloatingComposer();
  applyCanvasFloatingCollapsed(state.canvasFloatingCollapsed);
  requestAnimationFrame(() => {
    applyCanvasTransform();
    renderCanvasImageToolbar();
  });
}

function toggleAgentPanel(forceValue = !state.agentPanelCollapsed) {
  applyAgentPanelCollapsed(forceValue);
}

function setCanvasCommandFromFloating(value) {
  if (!els.canvasCommand) return;
  els.canvasCommand.value = value;
  state.canvasCommandUserEdited = Boolean(value.trim());
  syncFloatingComposer();
  renderWorkflowCanvas();
}

function setGenerationAspect(value) {
  state.generation.aspect = value || "source";
  refreshGenerationControls();
  renderWorkflowCanvas();
}

function setGenerationQuality(value) {
  state.generation.quality = value || "1k";
  refreshGenerationControls();
  renderWorkflowCanvas();
}

function setGenerationCount(value) {
  state.generation.count = clampImageCount(value, state.mode);
  refreshGenerationControls();
  renderWorkflowCanvas();
}

async function continueEditFromLatest() {
  if (!state.render?.url) {
    toast("还没有可继续编辑的效果图");
    return;
  }
  const command = currentCanvasUserPrompt();
  if (!command) {
    toast("请先写一条画布指令");
    return;
  }

  try {
    const primaryImage = await localImageUrlToDataUrl(state.render.url, `${state.render.id || "latest-render"}.png`);
    await renderFromImages({
      mode: "photo",
      primaryImage,
      selection: null,
      title: "继续编辑结果",
      intent: `基于最新效果图继续编辑：${command}`,
      busyButton: els.continueEditButton
    });
  } catch (error) {
    toast(error.message);
  }
}

function render() {
  if (!state.plan) {
    renderWorkflowCanvas();
    return;
  }

  els.projectTitle.textContent = state.plan.project_title;
  els.summaryBlock.innerHTML = `
    <p>${escapeHtml(state.plan.project_summary)}</p>
    <p class="summary-read">${escapeHtml(state.plan.design_read)}</p>
  `;
  renderDirections();
  renderInspector();
  renderQuestions();
  renderWorkflowCanvas();
}

function useDirectionInCanvas(directionId) {
  const direction = state.plan?.directions?.find((item) => item.id === directionId);
  if (!direction) return;
  state.selectedId = direction.id;
  setHiddenPromptContext("panelContext", [
    `使用方向「${direction.name}」继续画布生成。`,
    direction.image_prompt,
    direction.spatial_strategy,
    direction.plan_moves?.length ? `关键动作：${direction.plan_moves.slice(0, 4).join("；")}` : ""
  ].filter(Boolean).join("\n"));
  render();
  toast("已把方向提示词放入后台上下文");
}

async function copyDirectionPrompt(directionId) {
  const direction = state.plan?.directions?.find((item) => item.id === directionId);
  if (!direction?.image_prompt) return;
  try {
    await navigator.clipboard.writeText(direction.image_prompt);
    toast("已复制方向提示词");
  } catch {
    els.canvasCommand.value = direction.image_prompt;
    state.canvasCommandUserEdited = Boolean(direction.image_prompt);
    toast("无法访问剪贴板，已填入画布输入框");
  }
}

function renderDirections() {
  els.directionGrid.innerHTML = state.plan.directions.map((direction) => {
    const selected = direction.id === state.selectedId;
    const loading = state.loadingImages.has(direction.id);
    const swatches = direction.palette.map((item) => `<span class="swatch" title="${escapeHtml(item.name)}" style="background:${escapeAttr(item.hex)}"></span>`).join("");
    const tags = direction.materials.slice(0, 3).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
    const moves = direction.plan_moves.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const moments = direction.signature_moments.slice(0, 2).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
    const risks = direction.risks.slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const image = direction.image?.url
      ? `<img src="${escapeAttr(direction.image.url)}" alt="${escapeAttr(direction.name)} 概念视觉" />`
      : loading
        ? `<div class="image-loading" aria-label="生成中"></div>`
        : `<div class="image-placeholder">等待生成空间视觉</div>`;

    return `
      <article class="direction-card ${selected ? "selected" : ""}" data-id="${escapeAttr(direction.id)}">
        <div class="image-stage">${image}</div>
        <div class="card-body">
          <h3>${escapeHtml(direction.name)}</h3>
          <p>${escapeHtml(direction.concept)}</p>
          <div class="swatch-row">${swatches}</div>
          <div class="tag-row">${tags}</div>
        </div>
        <div class="card-body direction-decision-layer">
          <p><strong>空间策略：</strong>${escapeHtml(direction.spatial_strategy)}</p>
          <div>
            <strong>关键动作</strong>
            <ul class="compact-list">${moves}</ul>
          </div>
          ${moments ? `<div class="tag-row direction-moments">${moments}</div>` : ""}
          ${risks ? `<details class="direction-risks"><summary>风险提示</summary><ul class="compact-list">${risks}</ul></details>` : ""}
          <p>${escapeHtml(direction.client_pitch)}</p>
        </div>
        <div class="card-actions direction-card-actions">
          ${uiIconButton({ className: "secondary-button", icon: "icon-pin", label: "选中方向", attrs: `data-select-id="${escapeAttr(direction.id)}"` })}
          ${uiIconButton({ className: "secondary-button image-button", icon: direction.image ? "icon-refresh" : "icon-image", label: direction.image ? "重新生成" : "生成视觉", attrs: `data-image-id="${escapeAttr(direction.id)}" ${loading ? "disabled" : ""}` })}
          ${uiIconButton({ icon: "icon-copy", label: "复制提示词", attrs: `data-copy-prompt-id="${escapeAttr(direction.id)}"` })}
          ${uiIconButton({ className: "primary-button", icon: "icon-continue", label: "继续画布生成", attrs: `data-use-direction-id="${escapeAttr(direction.id)}"` })}
        </div>
      </article>
    `;
  }).join("");

  els.directionGrid.querySelectorAll("[data-select-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.selectId;
      render();
    });
  });
  els.directionGrid.querySelectorAll("[data-image-id]").forEach((button) => {
    button.addEventListener("click", () => generateImage(button.dataset.imageId));
  });
  els.directionGrid.querySelectorAll("[data-copy-prompt-id]").forEach((button) => {
    button.addEventListener("click", () => copyDirectionPrompt(button.dataset.copyPromptId));
  });
  els.directionGrid.querySelectorAll("[data-use-direction-id]").forEach((button) => {
    button.addEventListener("click", () => useDirectionInCanvas(button.dataset.useDirectionId));
  });
}

function renderInspector() {
  if (!els.selectedName || !els.inspectorContent) return;
  const direction = state.plan.directions.find((item) => item.id === state.selectedId) || state.plan.directions[0];
  if (!direction) return;
  els.selectedName.textContent = direction.name;

  const palette = direction.palette.map((item) => `
    <span class="tag"><span class="swatch" style="background:${escapeAttr(item.hex)}"></span>${escapeHtml(item.name)}</span>
  `).join("");

  els.inspectorContent.innerHTML = `
    <div class="detail-block">
      <h3>空间策略</h3>
      <p>${escapeHtml(direction.spatial_strategy)}</p>
    </div>
    <div class="detail-block">
      <h3>平面动作</h3>
      <ul class="compact-list">${direction.plan_moves.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="detail-block">
      <h3>材料</h3>
      <div class="tag-row">${direction.materials.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
    </div>
    <div class="detail-block">
      <h3>色彩</h3>
      <div class="tag-row">${palette}</div>
    </div>
    <div class="detail-block">
      <h3>灯光</h3>
      <p>${escapeHtml(direction.lighting)}</p>
    </div>
    <div class="detail-block">
      <h3>视觉提示词</h3>
      <p>${escapeHtml(direction.image_prompt)}</p>
    </div>
  `;
}

function renderQuestions() {
  if (!els.nextQuestions) return;
  const questions = state.plan.next_questions || [];
  els.nextQuestions.innerHTML = questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function applySeriesReferenceRoles(analysis) {
  return analysis;
}

function renderDesignSeriesAnalysisView() {
  const analysis = state.designSeriesAnalysis;
  if (!analysis) return;
  els.projectTitle.textContent = analysis.title || "设计系列";
  els.summaryBlock.innerHTML = `
    <p>${escapeHtml(analysis.summary || "")}</p>
    ${analysis.fallback_reason ? `<p class="summary-read">分析降级：${escapeHtml(analysis.fallback_reason)}；生图仍会优先走当前 Image Gen 端点。</p>` : ""}
    <p class="summary-read">${escapeHtml(analysis.series_strategy || "")}</p>
  `;
  if (els.selectedName) els.selectedName.textContent = "系列建议";
  if (els.inspectorContent) els.inspectorContent.innerHTML = renderSeriesAdviceHtml(analysis);
  if (els.nextQuestions) {
    els.nextQuestions.innerHTML = (analysis.suggested_outputs || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }
}

function renderSeriesAdviceHtml(analysis) {
  const referenceRead = analysis.reference_read || [];
  return `
    ${analysis.fallback_reason ? `
      <div class="detail-block">
        <h3>端点降级</h3>
        <p>FHL 参考图分析暂时不可用，已自动使用内置系列预设继续。原因：${escapeHtml(analysis.fallback_reason)}</p>
      </div>
    ` : ""}
    <div class="detail-block">
      <h3>参考图识别</h3>
      <ul class="compact-list">
        ${referenceRead.map((item, index) => `<li>参考图 ${index + 1}：${escapeHtml(item.observation || item.usable_design_language || "")}</li>`).join("")}
      </ul>
    </div>
    <div class="detail-block">
      <h3>系列策略</h3>
      <p>${escapeHtml(analysis.series_strategy || "")}</p>
    </div>
    ${analysis.project_dna || analysis.spatial_sequence ? `
      <div class="detail-block">
        <h3>系列圣经</h3>
        ${analysis.project_dna ? `<p>${escapeHtml(analysis.project_dna)}</p>` : ""}
        ${analysis.spatial_sequence ? `<p>${escapeHtml(analysis.spatial_sequence)}</p>` : ""}
      </div>
    ` : ""}
    ${analysis.continuity_rules?.length || analysis.recurring_signatures?.length ? `
      <div class="detail-block">
        <h3>衔接规则</h3>
        <div class="tag-row">
          ${(analysis.continuity_rules || []).slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          ${(analysis.recurring_signatures || []).slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    ` : ""}
    ${analysis.scene_briefs?.length ? `
      <div class="detail-block">
        <h3>空间分镜</h3>
        <ul class="compact-list">
          ${analysis.scene_briefs.map((item, index) => `<li>${index + 1}. ${escapeHtml(item.title || item.spatial_role || "")}${item.connects_to ? ` → ${escapeHtml(item.connects_to)}` : ""}</li>`).join("")}
        </ul>
      </div>
    ` : ""}
    <div class="detail-block">
      <h3>建议输出</h3>
      <div class="tag-row">${(analysis.suggested_outputs || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
    </div>
    <div class="detail-block">
      <h3>材料 / 色彩</h3>
      <div class="tag-row">
        ${(analysis.materials || []).slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        ${(analysis.palette || []).slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderWorkflowCanvas() {
  normalizeCanvasLayoutPositions();
  renderAgentBriefInsight();
  renderResourceLibrary();
  renderAssetCount();
  const nodes = buildCanvasNodes();
  if (els.canvasEmptyState) els.canvasEmptyState.hidden = nodes.length > 0;
  els.canvasNodes.innerHTML = nodes.map(renderCanvasNode).join("");
  bindCanvasNodeEvents();
  renderCanvasImageToolbar();
  renderOutputManager();
  renderTaskProgressPanel();
  renderCanvasList();
  scheduleCanvasLinksRender(nodes);
  scheduleCanvasMinimapRender(nodes);
  applyCanvasTransform({ refreshMinimap: false });
  scheduleCanvasStateSave();
}

function scheduleWorkflowCanvasRender() {
  if (workflowCanvasFrame) return;
  workflowCanvasFrame = requestAnimationFrame(() => {
    workflowCanvasFrame = 0;
    renderWorkflowCanvas();
  });
}

function compactInsightText(value, max = 92) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function agentNextStepSuggestions(analysis, advice) {
  const mode = normalizeClientMode(state.mode);
  if (analysis && advice?.mismatch) {
    return [`切换到「${advice.label}」`, "保留当前图片作为输入", "再生成测试图"];
  }
  const planNext = nextPlanWorkflowModes(mode);
  if (planNext.length) {
    return planNext.map((item) => `下一步：${suggestedModeLabel(item)}`);
  }
  if (mode === "plan-render") {
    return state.selection
      ? ["确认红框区域", "补充想要的空间氛围", "生成该区域效果图"]
      : ["建议先框选区域", "不框选则自动选相近区域", "生成后查看区域标记"];
  }
  if (state.render?.url || state.renders.length) {
    return ["选中结果继续优化", "对比收藏最佳图", "必要时高清/锐化"];
  }
  if (state.mode === "designseries") {
    return activeReferenceImages().length ? ["先识别参考图", "确认系列空间清单", "生成 4/6/8 张成套图"] : ["上传 2-8 张参考图", "让 Agent 识别设计语言"];
  }
  if (!state.primaryImage && !isReferenceOnlyMode()) {
    return ["上传主图", "Agent 判断输入类型", "按推荐模式生成"];
  }
  return ["上传参考图或主图", "描述想要的结果", "点击生成图片"];
}

function agentRiskNotes(analysis, advice) {
  const notes = [];
  if (state.activeTask?.status === "failed") notes.push("最近任务失败，先看状态面板复盘再复跑");
  if (analysis && advice?.mismatch) notes.push(`当前模式与识别结果不一致，建议先试「${advice.label}」`);
  if (!state.primaryImage && !isReferenceOnlyMode()) notes.push("当前能力需要主图输入");
  if (state.mode === "plan-render" && state.primaryImage && !state.selection) notes.push("未框选区域，将自动选择与参考图最接近的区域生成");
  if (state.mode === "designseries" && activeReferenceImages().length < 2) notes.push("设计系列建议至少 2 张参考图");
  if (activeReferenceImages().length >= 6) notes.push("参考图较多，建议用权重控制主次");
  if (state.generation.count > 2) notes.push("多张生成更耗时，排障时可先用 1 张");
  return notes.length ? notes : ["暂无明显冲突"];
}

function renderAgentBriefInsight() {
  if (!els.agentBriefInsight) return;
  const mode = normalizeClientMode(state.mode);
  const meaning = workflowButtonMeanings[mode] || workflowButtonMeanings.custom;
  const analysis = state.primaryImageAnalysis || state.primaryImage?.inputAnalysis;
  const advice = inputWorkflowAdvice(analysis, mode);
  const activeReferences = activeReferenceImages();
  if (!analysis && !activeReferences.length && !state.render && !state.activeTask) {
    els.agentBriefInsight.innerHTML = `
      <div class="agent-brief-simple">
        <strong>先上传参考图，也可以直接输入需求。</strong>
        <p>系统会自动识别图片类型，并把按钮能力和你的描述融合成最终提示词。</p>
      </div>
    `;
    return;
  }
  const inputText = analysis
    ? `${analysis.label} · ${advice?.mismatch ? `建议切换 ${advice.label}` : `建议 ${advice?.label || meaning.label}`}`
    : activeReferences.length
      ? `${activeReferences.length} 张参考图参与生成，按权重自由综合读取`
      : "等待上传主图或参考图";
  const selectedStyleText = state.selectedStylePreset ? `风格：${state.selectedStylePreset}` : "";
  const selectedPresetText = state.selectedScenePreset && presets[state.selectedScenePreset]
    ? `模板：${presets[state.selectedScenePreset].spaceType}`
    : "";
  const strategyText = [
    state.thinking?.status === "active" ? state.thinking.text : meaning.change,
    selectedPresetText,
    selectedStyleText
  ].filter(Boolean).join(" ");
  const nextSteps = agentNextStepSuggestions(analysis, advice);
  const risks = agentRiskNotes(analysis, advice);
  els.agentBriefInsight.innerHTML = `
    <div>
      <span>当前能力</span>
      <strong>${escapeHtml(meaning.label)}</strong>
    </div>
    <div>
      <span>输入判断</span>
      <p>${escapeHtml(inputText)}</p>
    </div>
    <div>
      <span>生成逻辑</span>
      <p>${escapeHtml(compactInsightText(strategyText))}</p>
    </div>
    <div>
      <span>下一步</span>
      <p class="agent-insight-chips">${nextSteps.map((item) => `<b>${escapeHtml(item)}</b>`).join("")}</p>
    </div>
    <div>
      <span>风险检查</span>
      <p class="agent-insight-chips ${risks.length === 1 && risks[0] === "暂无明显冲突" ? "is-clear" : "has-risk"}">${risks.slice(0, 3).map((item) => `<b>${escapeHtml(item)}</b>`).join("")}</p>
    </div>
  `;
}

function showHome() {
  captureActiveCanvasState();
  scheduleCanvasStateSave({ delay: 80 });
  document.body.classList.remove("workspace-active", "reference-only-mode", "agent-panel-collapsed");
  state.historyPanelOpen = false;
  state.statusPanelOpen = false;
  renderWorkspaceHistoryPanel();
  renderWorkspaceStatusPanel();
  els.homeView.hidden = false;
  els.workspaceView.hidden = true;
}

async function showWorkspace(mode = "canvas") {
  const enteringFromHome = els.workspaceView.hidden;
  document.body.classList.add("workspace-active");
  applyAgentPanelCollapsed(state.agentPanelCollapsed);
  els.homeView.hidden = true;
  els.workspaceView.hidden = false;
  const hadCanvases = state.canvases.length > 0;
  ensureCanvasCollection(mode === "canvas" ? state.mode || "custom" : mode);
  const activeMode = normalizeClientMode(activeCanvasRecord()?.snapshot?.mode || state.mode || "custom");
  const requestedMode = normalizeClientMode(mode);
  if (mode !== "canvas" && hadCanvases && (!enteringFromHome || requestedMode !== activeMode)) {
    captureActiveCanvasState();
    const record = createCanvasRecord(mode);
    state.canvases.push(record);
    state.activeCanvasId = record.id;
    await restoreCanvasRecord(record);
  } else {
    await restoreCanvasRecord(activeCanvasRecord());
  }
  requestAnimationFrame(() => {
    drawSelectionCanvas();
    renderWorkflowCanvas();
  });
  scheduleCanvasStateSave({ delay: 120 });
}

function renderResourceLibrary() {
  if (!els.resourceLibrary || els.resourceLibrary.dataset.rendered === "true") return;
  if (els.resourceLibrary.closest(".canvas-resource-drawer")?.hidden) return;
  els.resourceLibrary.innerHTML = resourceLibrary.map((resource) => `
    <article class="resource-card" draggable="true" data-resource-id="${escapeAttr(resource.id)}">
      <img class="resource-thumb" src="${escapeAttr(resource.image)}" alt="${escapeAttr(resource.title)}" />
      <span class="tag">${escapeHtml(resource.type)}</span>
      <strong>${escapeHtml(resource.title)}</strong>
      <p>${escapeHtml(resource.text)}</p>
      ${uiIconButton({ className: "secondary-button", icon: "icon-pin", label: "加入画布", attrs: `data-add-resource="${escapeAttr(resource.id)}"` })}
    </article>
  `).join("");
  els.resourceLibrary.dataset.rendered = "true";

  els.resourceLibrary.querySelectorAll("[data-add-resource]").forEach((button) => {
    button.addEventListener("click", () => addResourceToCanvas(button.dataset.addResource));
  });
  els.resourceLibrary.querySelectorAll("[data-resource-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", card.dataset.resourceId);
      event.dataTransfer.effectAllowed = "copy";
    });
  });
}

function removePrimaryImage() {
  if (!state.primaryImage && !state.primaryBitmap) return;
  state.primaryImage = null;
  state.primaryBitmap = null;
  state.primaryImageAnalysis = null;
  state.selection = null;
  if (state.canvas.selectedImage?.id === "source") {
    state.canvas.selectedImage = null;
  }
  if (els.primaryImageInput) els.primaryImageInput.value = "";
  state.thinking = defaultThinkingState();
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  toast("已删除原图");
}

function removeReferenceImage(index) {
  const referenceIndex = Number(index);
  if (!Number.isInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= state.referenceImages.length) return;
  state.referenceImages.splice(referenceIndex, 1);
  state.designSeriesAnalysis = null;
  if (state.canvas.selectedImage?.id === `reference${referenceIndex}` || state.canvas.selectedImage?.id?.startsWith("reference")) {
    state.canvas.selectedImage = null;
  }
  Object.keys(state.canvas.positions).forEach((key) => {
    if (/^reference\d+$/.test(key)) delete state.canvas.positions[key];
  });
  if (els.referenceImageInput) els.referenceImageInput.value = "";
  refreshGenerationControls();
  renderReferenceStrip();
  renderWorkflowCanvas();
  toast("已移除参考图");
}

function renderAssetCount() {
  if (els.assetCount) els.assetCount.textContent = `${state.assets.length} 个资源`;
}

function addResourceToCanvas(resourceId, point) {
  const resource = resourceLibrary.find((item) => item.id === resourceId);
  if (!resource) return;
  const asset = {
    ...resource,
    instanceId: `asset-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`
  };
  const index = state.assets.length;
  state.assets.push(asset);
  state.canvas.positions[asset.instanceId] = point || { x: 476 + (index % 2) * 290, y: 780 + Math.floor(index / 2) * 280, w: 250 };
  renderWorkflowCanvas();
  toast(`已加入画布：${resource.title}`);
}

function quickIterationConfig(action) {
  const map = {
    "lock-layout": {
      mode: "photo",
      title: "保留布局优化",
      command: (item) => [
        `基于「${item?.title || "当前输入"}」保留布局继续优化。`,
        "严格保持空间结构、镜头构图、主要家具/陈列、动线和尺度不变，只提升材料完成度、灯光层次、细节密度和画面质量。"
      ].join("\n")
    },
    materialreplace: {
      mode: "materialreplace",
      title: "换材料",
      command: (item) => [
        `基于「${item?.title || "当前输入"}」替换材料系统。`,
        "保留空间结构、透视、光向和物体位置，重点调整墙地面、柜体、家具或指定区域材质，让材料语言更统一、更适合当前项目定位。"
      ].join("\n")
    },
    lightingadjust: {
      mode: "lightingadjust",
      title: "调灯光",
      command: (item) => [
        `基于「${item?.title || "当前输入"}」调整灯光氛围。`,
        "保留空间结构和材料关系，优化主光、辅助光、色温、明暗层次、曝光和空间情绪，让画面更适合提案展示。"
      ].join("\n")
    },
    detail: {
      mode: "detail",
      title: "加细节",
      command: (item) => [
        `基于「${item?.title || "当前输入"}」增加完成度细节。`,
        "保持布局、构图、材料方向和灯光逻辑不变，补充真实节点、收口、陈列、软装、纹理和尺度线索。"
      ].join("\n")
    },
    designseries: {
      mode: "designseries",
      title: "生成系列",
      command: (item) => [
        `围绕「${item?.title || "当前方案"}」生成同一设计 DNA 的系列图。`,
        "保持材料家族、色温、画面密度和设计语言一致，变化空间角色、镜头距离、焦点区域或细部尺度。"
      ].join("\n")
    }
  };
  return map[action] || null;
}

async function applyQuickIteration(action, busyButton = null, baseItem = null) {
  const config = quickIterationConfig(action);
  if (!config) return;
  const latestItem = baseItem || latestOutputItem();
  if (action === "lock-layout" && latestItem?.url) {
    await lockLayoutFromOutput(latestItem);
    return;
  }
  if (action === "designseries") {
    setMode("designseries");
    setHiddenPromptContext("quickIntent", config.command(latestItem));
    refreshGenerationControls();
    renderWorkflowCanvas();
    if (activeReferenceImages().length) {
      await generateDesignSeries({ busyButton: busyButton || els.canvasGenerateButton, count: state.generation.count || 4 });
    } else {
      toast("已切换到生成系列，请先上传参考图");
    }
    return;
  }
  if (latestItem?.url) {
    const primaryImage = await imageSourceToPrimaryImage({
      id: latestItem.id,
      url: latestItem.url,
      title: latestItem.title
    });
    const inferredAnalysis = inputTypeForGeneratedMode(latestItem.stepMode || latestItem.mode);
    primaryImage.id = latestItem.id;
    primaryImage.parentImageId = latestItem.id;
    primaryImage.parentNodeId = latestItem.nodeId;
    primaryImage.workflowId = latestItem.workflowId || "";
    primaryImage.sourceType = inferredAnalysis.key;
    primaryImage.inputAnalysis = inferredAnalysis;
    state.primaryImage = primaryImage;
    state.primaryBitmap = await loadImage(primaryImage.dataUrl);
    state.primaryImageAnalysis = inferredAnalysis;
    state.selection = null;
    setMode(config.mode);
    setHiddenPromptContext("quickIntent", config.command(latestItem));
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();
    await renderFromImages({
      mode: config.mode,
      primaryImage,
      workflowId: latestItem.workflowId || "",
      parentImageId: latestItem.id,
      parentNodeId: latestItem.nodeId,
      inputAnalysis: inferredAnalysis,
      count: 1,
      title: config.title,
      intent: config.command(latestItem),
      busyButton: busyButton || els.canvasGenerateButton
    });
    return;
  }
  setMode(config.mode);
  setHiddenPromptContext("quickIntent", config.command(null));
  refreshGenerationControls();
  renderWorkflowCanvas();
  toast("已把快速迭代要求放入后台上下文，上传主图或参考图后可生成。");
}

function latestOutputItem() {
  return getOutputItems().at(-1) || null;
}
function getOutputItems() {
  const renderItems = state.renders.map((render, index) => ({
    id: render.id || `render-${index}`,
    nodeId: `render${index}`,
    source: "render",
    index,
    render,
    url: render.url,
    title: render.title || `效果图 ${index + 1}`,
    mode: render.mode || state.mode,
    stepMode: render.stepMode || render.mode || state.mode,
    workflowId: render.workflowId || "",
    parentImageId: render.parentImageId || "",
    parentNodeId: render.parentNodeId || "",
    inputImageType: render.inputImageType || "",
    inputAnalysis: render.inputAnalysis || null,
    selection: render.selection || null,
    renderRegion: render.renderRegion || "",
    renderRegionPrompt: render.renderRegionPrompt || "",
    endpoint: render.endpoint || "",
    attempts: render.attempts || [],
    intent: render.intent || "",
    prompt: render.prompt || "",
    sourcePrompt: render.sourcePrompt || "",
    createdAt: render.createdAt || "",
    referenceCount: render.referenceCount ?? 0
  })).filter((item) => item.url);

  const directionItems = (state.plan?.directions || [])
    .filter((direction) => direction.image?.url)
    .map((direction, index) => ({
      id: `direction-${direction.id}`,
      nodeId: `directionImage${index}`,
      source: "direction",
      directionId: direction.id,
      index,
      render: direction.image,
      url: direction.image.url,
      title: direction.name,
      mode: "direction",
      stepMode: "direction",
      workflowId: "",
      parentImageId: "",
      parentNodeId: "",
    inputImageType: "",
    inputAnalysis: null,
    renderRegion: "",
      referenceCount: direction.image?.referenceCount ?? activeReferenceImages().length,
      intent: direction.image_prompt || direction.concept || "",
      prompt: direction.image?.prompt || direction.image_prompt || "",
      sourcePrompt: direction.image?.sourcePrompt || "",
      createdAt: direction.image?.createdAt || ""
    }));

  const seen = new Set();
  return [...renderItems, ...directionItems].filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function outputNextWorkflowButtons(item) {
  const nextModes = nextPlanWorkflowModes(item.stepMode || item.mode);
  return nextModes.map((nextMode) => {
    const label = nextMode === "plan-axonometric" ? "用这张生成3D平面图" : nextMode === "plan-render" ? "用这张生成效果图" : `用这张继续${suggestedModeLabel(nextMode)}`;
    return outputActionButton({
      action: "plan-next",
      outputId: item.id,
      nextMode,
      icon: "icon-continue",
      label
    });
  }).join("");
}

function outputMetaLine(item) {
  const parts = [
    item.createdAt || "",
    workflowStepLabel(item.stepMode || item.mode),
    item.inputImageType ? `输入：${item.inputImageType}` : "",
    item.renderRegion ? `区域：${item.renderRegion}` : item.selection ? `区域：${selectionRegionLabel(item.selection) || "红框选区"}` : "",
    item.workflowId ? "工作流已记录" : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

function outputManagerChips(item, index, total) {
  const chips = [
    workflowStepLabel(item.stepMode || item.mode),
    item.inputImageType ? `输入：${item.inputImageType}` : "",
    item.renderRegion ? `区域：${item.renderRegion}` : item.selection ? `区域：${selectionRegionLabel(item.selection) || "红框选区"}` : "",
    state.favoriteOutputIds.has(item.id) ? "已收藏" : "",
    state.compareOutputIds.has(item.id) ? "对比中" : "",
    index === total - 1 ? "最新" : ""
  ].filter(Boolean);
  return chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
}

function renderOutputManager() {
  if (!els.outputManagerList) return;
  const items = getOutputItems();
  const validIds = new Set(items.map((item) => item.id));
  [...state.favoriteOutputIds].forEach((id) => { if (!validIds.has(id)) state.favoriteOutputIds.delete(id); });
  [...state.compareOutputIds].forEach((id) => { if (!validIds.has(id)) state.compareOutputIds.delete(id); });
  if (!items.length) {
    els.outputManagerList.innerHTML = `
      <article class="output-manager-empty">
        <strong>还没有生成结果</strong>
        <span>生成后的效果图、设计系列和局部编辑会在这里汇总，可直接预览、收藏、对比或继续编辑。</span>
      </article>
    `;
    if (els.exportOutputsButton) els.exportOutputsButton.disabled = true;
    return;
  }

  if (els.exportOutputsButton) els.exportOutputsButton.disabled = false;
  els.outputManagerList.innerHTML = items.map((item, index) => {
    const favorite = state.favoriteOutputIds.has(item.id);
    const compare = state.compareOutputIds.has(item.id);
    const latest = index === items.length - 1;
    const meta = outputMetaLine(item) || item.mode || "Output";
    const note = String(item.intent || item.prompt || item.sourcePrompt || "可作为下一轮创作输入继续迭代。");
    const notePreview = `${note.slice(0, 140)}${note.length > 140 ? "…" : ""}`;
    return `
      <article class="output-manager-item ${favorite ? "is-favorite" : ""} ${compare ? "is-compared" : ""} ${latest ? "is-latest" : ""}" data-output-id="${escapeAttr(item.id)}">
        <button class="output-manager-thumb" type="button" data-output-action="preview" data-output-id="${escapeAttr(item.id)}" title="预览 ${escapeAttr(item.title)}" aria-label="预览 ${escapeAttr(item.title)}">
          <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.title)}" />
          <span>${latest ? "Latest" : "Preview"}</span>
        </button>
        <div class="output-manager-copy">
          <div class="output-manager-title-row">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.createdAt || workflowStepLabel(item.stepMode || item.mode))}</small>
          </div>
          <div class="output-manager-chips">${outputManagerChips(item, index, items.length)}</div>
          <p>${escapeHtml(notePreview)}</p>
          <span>${escapeHtml(meta)}</span>
        </div>
        <div class="output-manager-buttons" aria-label="结果操作">
          ${outputActionButton({ action: "preview", outputId: item.id, icon: "icon-focus", label: "预览", className: "secondary-button" })}
          ${outputActionButton({ action: "favorite", outputId: item.id, icon: "icon-star", label: favorite ? "已收藏" : "收藏", className: "secondary-button", attrs: `aria-pressed="${favorite ? "true" : "false"}"` })}
          ${outputActionButton({ action: "compare", outputId: item.id, icon: "icon-compare", label: compare ? "移出对比" : "对比", className: "secondary-button", attrs: `aria-pressed="${compare ? "true" : "false"}"` })}
          ${outputActionButton({ action: "continue", outputId: item.id, icon: "icon-continue", label: "继续编辑", className: "secondary-button" })}
          ${outputActionButton({ action: "promote", outputId: item.id, icon: "icon-pin", label: "设为最新", className: "text-button" })}
          ${outputActionButton({ action: "copy-prompt", outputId: item.id, icon: "icon-copy", label: "复制提示词", className: "text-button" })}
          ${outputActionButton({ action: "download", outputId: item.id, icon: "icon-export", label: "下载", className: "text-button" })}
        </div>
      </article>
    `;
  }).join("");
  bindOutputActionEvents(els.outputManagerList);
}

function outputNodeActions(outputId, url, item = null) {
  const favorite = state.favoriteOutputIds.has(outputId);
  const compare = state.compareOutputIds.has(outputId);
  const workflowButtons = item ? outputNextWorkflowButtons(item) : "";
  return `
    ${uiIconLink({ href: url, icon: "icon-export", label: "打开原图", attrs: `target="_blank" rel="noreferrer"` })}
    ${outputActionButton({ action: "send-to-panel", outputId, icon: "icon-reference", label: "创作需求" })}
    ${workflowButtons}
    ${outputActionButton({ action: "favorite", outputId, icon: "icon-star", label: favorite ? "已收藏" : "收藏", attrs: `aria-pressed="${favorite ? "true" : "false"}"` })}
    ${outputActionButton({ action: "compare", outputId, icon: "icon-compare", label: compare ? "移出对比" : "对比", attrs: `aria-pressed="${compare ? "true" : "false"}"` })}
    ${outputActionButton({ action: "tool-upscale", outputId, icon: "icon-focus", label: "高清" })}
    ${outputActionButton({ action: "tool-sharpen", outputId, icon: "icon-detail", label: "锐化" })}
    ${outputActionButton({ action: "tool-detail", outputId, icon: "icon-zoom-in", label: "细节增强" })}
    ${outputActionButton({ action: "tool-outpaint", outputId, icon: "icon-panel-show", label: "扩图" })}
    ${outputActionButton({ action: "promote", outputId, icon: "icon-pin", label: "设为最新" })}
    ${outputActionButton({ action: "copy-prompt", outputId, icon: "icon-copy", label: "复制提示词" })}
    ${outputActionButton({ action: "regenerate", outputId, icon: "icon-refresh", label: "重新生成这一步" })}
    ${outputActionButton({ action: "lock-layout", outputId, icon: "icon-lock", label: "锁定布局继续优化" })}
    ${outputActionButton({ action: "continue", outputId, icon: "icon-continue", label: "继续编辑" })}
  `;
}

function bindOutputActionEvents(root) {
  root.querySelectorAll("[data-output-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleOutputAction(button.dataset.outputAction, button.dataset.outputId, button.dataset.nextMode)
        .catch((error) => toast(error.message));
    });
  });
}

function findOutputItem(outputId) {
  const items = getOutputItems();
  return items.find((item) => item.id === outputId) || items.find((item) => item.nodeId === outputId);
}

async function handleOutputAction(action, outputId, nextMode = "") {
  const item = findOutputItem(outputId);
  if (!item) return;
  if (action === "download") {
    await downloadOutputItem(item, getOutputItems().findIndex((entry) => entry.id === item.id));
    return;
  }
  if (action?.startsWith("quick-")) {
    await applyQuickIteration(action.replace("quick-", ""), null, item);
    return;
  }
  if (action === "plan-next") {
    await continuePlanWorkflowFromOutput(item, nextMode);
    return;
  }
  if (action === "favorite") {
    toggleSetValue(state.favoriteOutputIds, item.id);
    renderWorkflowCanvas();
    return;
  }
  if (action === "compare") {
    if (!state.compareOutputIds.has(item.id) && state.compareOutputIds.size >= 4) {
      toast("最多同时对比 4 张图");
      return;
    }
    toggleSetValue(state.compareOutputIds, item.id);
    renderWorkflowCanvas();
    return;
  }
  if (action === "preview") {
    openImagePreview({ url: item.url, title: item.title, caption: item.intent || item.mode });
    return;
  }
  if (action === "send-to-panel") {
    await syncOutputItemToCreativePanel(item);
    return;
  }
  if (action?.startsWith("tool-")) {
    await runOutputImageTool(item, action.replace("tool-", ""));
    return;
  }
  if (action === "promote") {
    promoteOutputItem(item);
    return;
  }
  if (action === "regenerate") {
    await regenerateOutputItem(item);
    return;
  }
  if (action === "copy-prompt") {
    await copyText(item.prompt || item.sourcePrompt || item.intent || "");
    return;
  }
  if (action === "lock-layout") {
    await lockLayoutFromOutput(item);
    return;
  }
  if (action === "continue") {
    await continueEditFromOutput(item);
    return;
  }
  if (action === "delete") {
    deleteOutputItem(item);
  }
}

async function runOutputImageTool(item, toolMode) {
  if (!["upscale", "sharpen", "detail", "outpaint"].includes(toolMode)) return;
  state.canvas.selectedImage = {
    id: item.nodeId || item.id,
    outputId: item.id,
    url: item.url,
    title: item.title,
    caption: item.intent || item.mode
  };
  state.canvas.imageActionBusy = toolMode;
  renderCanvasImageToolbar();
  await handleCanvasImageTool(toolMode);
}

function promoteOutputItem(item) {
  if (item.source === "render") {
    state.render = item.render;
  } else {
    state.render = {
      ...item.render,
      id: item.id,
      title: item.title,
      mode: item.mode,
      intent: item.intent,
      createdAt: item.createdAt
    };
  }
  renderGeneratedResult();
  renderWorkflowCanvas();
  toast("已设为最新图");
}

async function regenerateOutputItem(item) {
  if (item.source === "direction" && item.directionId) {
    await generateImage(item.directionId);
    return;
  }
  if (["upscale", "sharpen"].includes(normalizeClientMode(item.mode)) && !item.endpoint) {
    state.canvas.selectedImage = outputItemToSelectedImage(item);
    await handleCanvasImageTool(normalizeClientMode(item.mode));
    return;
  }
  if (item.mode === "designseries") {
    await generateDesignSeries({ count: 1, allowSingle: true, title: item.title });
    return;
  }
  const parentPrimary = await primaryImageForOutputRegeneration(item);
  await renderFromImages({
    mode: item.mode === "direction" ? state.mode : (item.stepMode || item.mode),
    primaryImage: parentPrimary || undefined,
    workflowId: item.workflowId || "",
    parentImageId: item.parentImageId || "",
    parentNodeId: item.parentNodeId || "",
    inputAnalysis: parentPrimary?.inputAnalysis || null,
    count: 1,
    allowNoPrimary: isReferenceOnlyMode(item.mode) || item.mode === "custom",
    ignorePrimaryImage: item.mode === "custom" && !parentPrimary && !state.primaryImage,
    title: item.title,
    intent: [
      `重新生成这一张：${item.title}`,
      item.intent || currentCanvasUserPrompt(),
      "保持当前参考图和画布语境，输出一张更稳定、更完整的版本。"
    ].filter(Boolean).join("\n")
  });
}

async function primaryImageForOutputRegeneration(item) {
  if (!isPlanWorkflowMode(item.stepMode || item.mode)) return null;
  if (item.parentNodeId && item.parentNodeId !== "source") {
    const parentItem = getOutputItems().find((entry) => entry.nodeId === item.parentNodeId || entry.id === item.parentImageId);
    if (parentItem?.url) {
      const primary = await imageSourceToPrimaryImage({ id: parentItem.id, url: parentItem.url, title: parentItem.title });
      primary.id = parentItem.id;
      primary.parentNodeId = parentItem.nodeId;
      primary.workflowId = item.workflowId || parentItem.workflowId || "";
      primary.inputAnalysis = inputTypeForGeneratedMode(parentItem.stepMode || parentItem.mode);
      primary.sourceType = primary.inputAnalysis.key;
      return primary;
    }
  }
  return state.primaryImage || null;
}

async function continueEditFromOutput(item) {
  state.render = {
    ...item.render,
    id: item.id,
    title: item.title,
    mode: item.mode,
    intent: item.intent,
    createdAt: item.createdAt
  };
  renderGeneratedResult();
  await continueEditFromLatest();
}

async function continuePlanWorkflowFromOutput(item, nextMode) {
  const normalizedNext = normalizeClientMode(nextMode);
  if (!nextPlanWorkflowModes(item.stepMode || item.mode).includes(normalizedNext)) {
    toast("这张图没有匹配的下一步工作流");
    return;
  }
  const primaryImage = await imageSourceToPrimaryImage({
    id: item.id,
    url: item.url,
    title: item.title
  });
  const inferredAnalysis = inputTypeForGeneratedMode(item.stepMode || item.mode);
  primaryImage.id = item.id;
  primaryImage.parentImageId = item.id;
  primaryImage.parentNodeId = item.nodeId;
  primaryImage.workflowId = item.workflowId || createWorkflowId(normalizedNext);
  primaryImage.sourceType = inferredAnalysis.key;
  primaryImage.inputAnalysis = inferredAnalysis;

  state.primaryImage = primaryImage;
  state.primaryBitmap = await loadImage(primaryImage.dataUrl);
  state.primaryImageAnalysis = inferredAnalysis;
  state.selection = null;
  setMode(normalizedNext);
  setHiddenPromptContext("panelContext", canvasModeCommand(normalizedNext, outputItemToSelectedImage(item), item));
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  toast(`已把「${item.title}」设为输入，进入“${suggestedModeLabel(normalizedNext)}”。`);
}

function modeForOutputPanelSync(item, preferredMode = "") {
  const preferred = preferredMode ? normalizeClientMode(preferredMode) : "";
  if (preferred && canvasSelectableModes.some((entry) => entry.mode === preferred)) return preferred;
  const nextMode = nextPlanWorkflowModes(item.stepMode || item.mode)[0];
  if (nextMode) return nextMode;
  return "custom";
}

function outputItemToSelectedImage(item) {
  return {
    id: item.nodeId || item.id,
    outputId: item.id,
    url: item.url,
    title: item.title,
    caption: item.intent || item.mode || ""
  };
}

function creativePanelCommandFromOutput(item, mode) {
  const selected = outputItemToSelectedImage(item);
  const normalizedMode = normalizeClientMode(mode);
  const workflowCommand = isPlanWorkflowMode(normalizedMode)
    ? canvasModeCommand(normalizedMode, selected, item)
    : "";
  const previousPrompt = item.prompt || item.sourcePrompt || item.intent || "";
  return [
    `基于画布作品「${item.title || "选中图片"}」继续创作。`,
    workflowCommand,
    item.intent ? `上一轮创作需求：${compactInsightText(item.intent, 180)}` : "",
    previousPrompt && previousPrompt !== item.intent ? `上一轮最终提示词摘要：${compactInsightText(previousPrompt, 180)}` : "",
    "请先理解这张图的空间关系、材料、灯光、构图和当前完成度，再结合我接下来输入的需求继续生成。",
    normalizedMode === "custom" ? "不要套用固定模板；只把这张图作为当前主输入，并综合右侧参考图。" : ""
  ].filter(Boolean).join("\n");
}

async function syncOutputItemToCreativePanel(item, preferredMode = "") {
  if (!item?.url) return;
  const nextMode = modeForOutputPanelSync(item, preferredMode);
  state.canvas.imageActionBusy = "send-to-panel";
  state.canvas.selectedImage = outputItemToSelectedImage(item);
  renderCanvasImageToolbar();
  try {
    const primaryImage = await imageSourceToPrimaryImage({
      id: item.id,
      url: item.url,
      title: item.title
    });
    const bitmap = await loadImage(primaryImage.dataUrl);
    const generatedAnalysis = isPlanWorkflowMode(item.stepMode || item.mode)
      ? inputTypeForGeneratedMode(item.stepMode || item.mode)
      : null;
    const analysis = generatedAnalysis || classifyUploadedImage(bitmap, { name: primaryImage.name, type: primaryImage.type });

    primaryImage.id = item.id;
    primaryImage.parentImageId = item.id;
    primaryImage.parentNodeId = item.nodeId;
    primaryImage.workflowId = isPlanWorkflowMode(nextMode)
      ? (item.workflowId || createWorkflowId(nextMode))
      : (item.workflowId || "");
    primaryImage.sourceType = analysis.key;
    primaryImage.inputAnalysis = analysis;

    state.primaryImage = primaryImage;
    state.primaryBitmap = bitmap;
    state.primaryImageAnalysis = analysis;
    state.selection = null;
    state.render = item.render || {
      id: item.id,
      title: item.title,
      url: item.url,
      mode: item.mode,
      stepMode: item.stepMode || item.mode,
      intent: item.intent,
      prompt: item.prompt,
      sourcePrompt: item.sourcePrompt,
      createdAt: item.createdAt
    };

    setMode(nextMode);
    setHiddenPromptContext("panelContext", creativePanelCommandFromOutput(item, nextMode));
    setInputAdviceThinking(analysis);
    refreshGenerationControls();
    drawSelectionCanvas();
    renderGeneratedResult();
    renderWorkflowCanvas();

    const message = nextMode === "custom"
      ? `已把「${item.title}」加入创作面板，可继续写需求。`
      : `已把「${item.title}」加入创作面板，并切到“${suggestedModeLabel(nextMode)}”。`;
    toast(message);
  } catch (error) {
    toast(error.message);
  } finally {
    state.canvas.imageActionBusy = "";
    renderCanvasImageToolbar();
  }
}

async function useCanvasImageWithMode(mode) {
  const selected = state.canvas.selectedImage;
  if (!selected?.url) {
    toast("请先在画布中选择一张图片");
    return;
  }
  const normalizedMode = normalizeClientMode(mode);
  const allowed = canvasSelectableModes.some((item) => item.mode === normalizedMode);
  if (!allowed) return;

  state.canvas.imageActionBusy = "use-mode";
  renderCanvasImageToolbar();
  try {
    const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
    const primaryImage = await imageSourceToPrimaryImage(selected);
    const generatedAnalysis = outputItem && isPlanWorkflowMode(outputItem.stepMode || outputItem.mode)
      ? inputTypeForGeneratedMode(outputItem.stepMode || outputItem.mode)
      : null;
    const bitmap = await loadImage(primaryImage.dataUrl);
    const analysis = generatedAnalysis || classifyUploadedImage(bitmap, { name: primaryImage.name, type: primaryImage.type });

    primaryImage.id = outputItem?.id || selected.id || `canvas-${Date.now()}`;
    primaryImage.parentImageId = outputItem?.id || selected.id || "";
    primaryImage.parentNodeId = outputItem?.nodeId || selected.id || "";
    primaryImage.workflowId = isPlanWorkflowMode(normalizedMode)
      ? (outputItem?.workflowId || createWorkflowId(normalizedMode))
      : (outputItem?.workflowId || "");
    primaryImage.sourceType = analysis.key;
    primaryImage.inputAnalysis = analysis;

    state.primaryImage = primaryImage;
    state.primaryBitmap = bitmap;
    state.primaryImageAnalysis = analysis;
    state.selection = null;
    setMode(normalizedMode);
    setHiddenPromptContext("panelContext", canvasModeCommand(normalizedMode, selected, outputItem));
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();

    const mismatch = shouldWarnInputModeMismatch(analysis, normalizedMode);
    toast(mismatch
      ? `已用这张图进入“${suggestedModeLabel(normalizedMode)}”。识别结果更像${analysis.label}，建议也可试试“${suggestedModeLabel(analysis.suggestedMode)}”。`
      : `已用这张图进入“${suggestedModeLabel(normalizedMode)}”。`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.canvas.imageActionBusy = "";
    renderCanvasImageToolbar();
  }
}

function canvasModeCommand(mode, selected, outputItem) {
  const title = selected?.title || outputItem?.title || "选中图片";
  const normalizedMode = normalizeClientMode(mode);
  const base = {
    custom: `基于画布中选中的「${title}」自由创作：先判断需要生成的是效果图、设计系列、材料板、局部编辑、扩图、概念图、产品图还是其他视觉产物，再结合右侧参考图和文字要求生成。`,
    "plan-axonometric": `使用画布中选中的「${title}」作为不可改动的平面底图。\n${planTo3DFixedPrompt}`,
    "plan-render": `使用画布中选中的「${title}」作为3D平面图：优先框选要生成效果图的区域；如果没有框选，则自动选择一个与参考图最接近的明确功能区生成人视角效果图，并在输出中标明对应区域。`,
    cad: `使用画布中选中的「${title}」提取主要墙线、开口、轮廓和图纸线段，忽略阴影纹理和装饰噪点，生成可下载的 CAD / SVG 描底文件。`,
    cadrender: `使用画布中选中的「${title}」作为 CAD 或图纸底图：先锁定轴线、墙体、开口和空间关系，再生成真实空间效果图，最终不保留 CAD 线。`,
    photo: `使用画布中选中的「${title}」作为现场或现状图：保留结构、透视、开口、柱网和层高，只重新设计材料、灯光、家具和陈列。`,
    whitemodel: `使用画布中选中的「${title}」作为白模或建模截图：保留体块、视角、开口、层级和比例，补充真实材质、灯光、环境和尺度细节。`,
    sketch: `使用画布中选中的「${title}」作为手稿或草图：保留构图、透视、体块和设计意图，把线条转译成可建造的真实空间。`,
    materialreplace: `使用画布中选中的「${title}」做材质替换：优先替换选区或用户点名材料，只改变颜色、纹理、反射和工艺细节，保留几何、透视、光向、阴影、物体位置和非目标区域。`,
    lightingadjust: `使用画布中选中的「${title}」做灯光调整：保留空间、材料、家具、镜头、构图和非灯光内容，明确一个光照场景并控制曝光、阴影、色温和灯具辉光。`,
    styletransfer: `使用画布中选中的「${title}」做风格迁移：保留结构、镜头、尺度、开口、动线和主要对象位置，系统替换材料、家具、灯具、软装和色彩语法。`,
    materialboard: `使用画布中选中的「${title}」提取材料、色彩、灯光、家具和软装语言，生成有层级的材料提案板，避免文字标签、品牌logo和随机拼贴。`,
    upscale: `使用画布中选中的「${title}」做画质增强：只提升清晰度、白平衡、噪声控制、局部对比和分辨率观感，不新增物体或改变设计。`,
    detail: `使用画布中选中的「${title}」做细节增强：优先增强选区或用户点名对象，保留布局、镜头、墙体、开口、主要对象和非选区，补充材质纹理、边缘收口、灯光层次、软装陈列和尺度细节。`,
    sharpen: `使用画布中选中的「${title}」做克制锐化：保留所有内容和色彩关系，只增强边缘清晰度与局部对比，避免光晕、噪声和假细节。`,
    outpaint: `使用画布中选中的「${title}」做扩图：保留主体、透视、消失点、镜头高度、材料尺度、灯光方向和风格，只向画面外自然补全建筑或室内上下文。`
  };
  return base[normalizedMode] || defaultCanvasCommands[normalizedMode] || defaultCanvasCommands.default;
}

async function lockLayoutFromOutput(item) {
  const primaryImage = await imageSourceToPrimaryImage({
    id: item.id,
    url: item.url,
    title: item.title
  });
  const lockedMode = isPlanWorkflowMode(item.stepMode || item.mode) ? "plan-render" : "photo";
  const inferredAnalysis = inputTypeForGeneratedMode(item.stepMode || item.mode);
  primaryImage.id = item.id;
  primaryImage.parentImageId = item.id;
  primaryImage.parentNodeId = item.nodeId;
  primaryImage.workflowId = item.workflowId || "";
  primaryImage.sourceType = inferredAnalysis.key;
  primaryImage.inputAnalysis = inferredAnalysis;
  state.primaryImage = primaryImage;
  state.primaryBitmap = await loadImage(primaryImage.dataUrl);
  state.primaryImageAnalysis = inferredAnalysis;
  state.selection = null;
  setMode(lockedMode);
  setHiddenPromptContext("panelContext", [
    `锁定这张图的布局继续优化：${item.title}`,
    "保持空间关系、构图、主要家具/陈列和尺度不变，只优化材料、灯光、细节、画质和完成度。",
    item.intent || ""
  ].filter(Boolean).join("\n"));
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  toast("已锁定布局，可继续写优化要求后生成。");
}

function deleteOutputItem(item) {
  const ok = window.confirm(`删除「${item.title}」在当前画布中的记录？本地生成文件不会被删除。`);
  if (!ok) return;
  state.favoriteOutputIds.delete(item.id);
  state.compareOutputIds.delete(item.id);
  if (item.source === "render") {
    state.renders.splice(item.index, 1);
    Object.keys(state.canvas.positions).forEach((key) => {
      if (/^render\d+$/.test(key)) delete state.canvas.positions[key];
    });
    state.render = state.renders[state.renders.length - 1] || null;
  } else if (item.source === "direction") {
    const direction = (state.plan?.directions || []).find((entry) => entry.id === item.directionId);
    if (direction) direction.image = null;
  }
  if (state.canvas.selectedImage?.url === item.url) state.canvas.selectedImage = null;
  renderGeneratedResult();
  renderWorkflowCanvas();
  toast("已从画布记录中移除");
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function imageCanvasNode({ id, kind, title, url, width = 320, caption = "", contain = false, actions = "", outputId = "", advice = "" }) {
  return {
    id,
    kind,
    title,
    width,
    directImage: true,
    selected: state.canvas.selectedImage?.id === id,
    imageUrl: url,
    outputId,
    contain,
    caption,
    advice,
    actions
  };
}

function buildCanvasNodes() {
  const brief = readBrief();
  const nodes = [];
  const briefSummary = [
    brief.spaceType,
    brief.area,
    brief.location,
    brief.audience
  ].filter(Boolean).join(" / ");
  const visiblePrimary = hasVisiblePrimaryInput();
  const visibleSelection = visiblePrimary && state.selection;

  const hasCanvasContent = Boolean(
    visiblePrimary ||
    isPlanWorkflowMode(state.mode) ||
    state.referenceImages.length ||
    state.assets.length ||
    visibleSelection ||
    state.render ||
    state.renders.length ||
    state.cadResults.length ||
    state.plan ||
    state.designSeriesAnalysis
  );
  if (!hasCanvasContent) return nodes;

  if (state.assets.length) {
    nodes.push({
      id: "resources",
      kind: "Resources",
      title: "资源 / 模板库",
      width: 330,
      html: `
        <p>已选资源会参与 gpt-5.5 的生成策略。</p>
        <div class="asset-list">
          ${state.assets.map((asset) => `
            <div class="asset-row">
              <img src="${escapeAttr(asset.image)}" alt="${escapeAttr(asset.title)}" />
              <strong>${escapeHtml(asset.title)}</strong>
              <span>${escapeHtml(asset.type)} · ${escapeHtml(asset.text)}</span>
            </div>
          `).join("")}
        </div>
      `
    });
  }

  state.assets.forEach((asset) => {
    nodes.push(imageCanvasNode({
      id: asset.instanceId,
      kind: asset.type,
      title: asset.title,
      width: 320,
      url: asset.image,
      caption: `${asset.type} · ${asset.text}`,
      actions: uiIconButton({ icon: "icon-trash", label: "移除", attrs: `data-remove-asset="${escapeAttr(asset.instanceId)}"` })
    }));
  });

  const sourceTitle = modeConfig(state.mode).sourceTitle;
  if (visiblePrimary) {
    const inputAnalysis = state.primaryImageAnalysis || state.primaryImage.inputAnalysis;
    const advice = inputWorkflowAdvice(inputAnalysis);
    const recommendedMode = advice?.mode || inputAnalysis?.suggestedMode || "";
    const canSwitchToRecommended = recommendedMode && normalizeClientMode(recommendedMode) !== normalizeClientMode(state.mode);
    nodes.push(imageCanvasNode({
      id: "source",
      kind: "Input",
      title: sourceTitle,
      width: 320,
      url: state.primaryImage.dataUrl,
      contain: true,
      caption: [
        state.primaryImage.name || sourceTitle,
        inputAnalysis ? `识别：${inputAnalysis.label}` : "",
        advice ? `建议：${advice.label}` : ""
      ].filter(Boolean).join(" · "),
      advice: advice?.text || "",
      actions: `
          ${uiIconButton({ className: "text-button", icon: "icon-trash", label: "删除原图", attrs: `data-remove-primary-image="true"` })}
          ${advice ? `
          ${canSwitchToRecommended ? uiIconButton({ icon: "icon-refresh", label: "使用推荐模式", attrs: `data-switch-suggested-mode="${escapeAttr(advice.mode)}"` }) : ""}
          ${uiIconButton({ className: "secondary-button", icon: "icon-spark", label: primaryActionLabel(state.mode), attrs: `data-render-trigger="true"` })}
          ` : ""}
        `
    }));
  }

  if (visibleSelection) {
    nodes.push({
      id: "selection",
      kind: "Region",
      title: "局部框选",
      width: 320,
      html: `
        <p>已框选局部区域，生成时会优先输出该区域的特写效果。</p>
        <div class="tag-row">
          <span class="tag">x ${Math.round(state.selection.x * 100)}%</span>
          <span class="tag">y ${Math.round(state.selection.y * 100)}%</span>
          <span class="tag">w ${Math.round(state.selection.width * 100)}%</span>
          <span class="tag">h ${Math.round(state.selection.height * 100)}%</span>
        </div>
      `
    });
  }

  if (state.referenceImages.length) {
    state.referenceImages.slice(0, referenceImageLimit).forEach((image, index) => {
      const weightOption = referenceWeightOptions.find((item) => item.value === (image.weight || "default")) || referenceWeightOptions[0];
      nodes.push(imageCanvasNode({
        id: `reference${index}`,
        kind: "Reference",
        title: `参考图 ${index + 1}`,
        width: 260,
        url: image.dataUrl,
        contain: true,
        caption: `${weightOption.label} · ${image.name || `参考图 ${index + 1}`}`,
        actions: uiIconButton({ className: "text-button", icon: "icon-trash", label: "移除参考图", attrs: `data-remove-reference-node="${index}"` })
      }));
    });
  }

  if (state.mode === "designseries" || state.designSeriesAnalysis) {
    const analysis = state.designSeriesAnalysis;
    nodes.push({
      id: "seriesAdvice",
      kind: state.analyzingDesignSeries ? "Analyzing" : "Series",
      title: analysis?.title || "参考图识别与系列建议",
      width: 360,
      html: analysis
        ? `
          <p>${escapeHtml(analysis.summary || analysis.series_strategy || "")}</p>
          <div class="tag-row">
            ${(analysis.suggested_outputs || []).slice(0, state.generation.count || 8).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          </div>
          <div class="node-actions wrap">
            ${uiIconButton({ className: "secondary-button", icon: "icon-series", label: "生成设计系列", attrs: `data-render-trigger="true"` })}
          </div>
        `
        : `
          <p>上传参考图后，gpt-5.5 会自动识别参考图类型，并给出成套设计建议。</p>
          <div class="node-actions wrap">
            ${uiIconButton({ className: "secondary-button", icon: "icon-spark", label: "识别参考图", attrs: `data-analyze-series="true" ${state.referenceImages.length ? "" : "disabled"}` })}
          </div>
        `
    });
  }

  const hasPlanWorkflow = isPlanWorkflowMode(state.mode) || state.renders.some((render) => isPlanWorkflowMode(render.stepMode || render.mode));
  if (hasPlanWorkflow) {
    const completedModes = new Set(state.renders.map((render) => normalizeClientMode(render.stepMode || render.mode)));
    nodes.push({
      id: "planWorkflow",
      kind: "Workflow",
      title: "平面工作流链路",
      width: 360,
      html: `
        <div class="workflow-step-list">
          ${Object.entries(planWorkflowSteps).map(([mode, step]) => `
            <div class="workflow-step-row ${normalizeClientMode(state.mode) === mode ? "is-current" : ""} ${completedModes.has(mode) ? "is-done" : ""}">
              <span>${step.index}</span>
              <strong>${escapeHtml(step.label)}</strong>
              <em>${completedModes.has(mode) ? "已生成" : normalizeClientMode(state.mode) === mode ? "当前阶段" : "待生成"}</em>
            </div>
          `).join("")}
        </div>
      `
    });
  }

  nodes.push({
    id: "command",
    kind: "Command",
    title: "画布指令",
    width: 360,
    html: `
      <p>${escapeHtml(currentCanvasUserPrompt() || "描述框为空，系统会使用当前能力的后台预设；你也可以补充一句需求。")}</p>
      <div class="node-actions wrap">
        ${uiIconButton({ className: "secondary-button", icon: "icon-spark", label: state.thinkingModeEnabled ? "思考并生成" : "直接生成", attrs: `data-canvas-generate="true"` })}
        ${uiIconButton({ icon: "icon-continue", label: "继续编辑最新图", attrs: `data-continue-edit="true" ${state.render ? "" : "disabled"}` })}
      </div>
    `
  });

  nodes.push({
    id: "think",
    kind: state.thinking.status === "active" ? "Thinking" : "Agent",
    title: state.thinkingModeEnabled
      ? (state.thinking.status === "active" ? "gpt-5.5 正在思考" : "gpt-5.5 思考节点")
      : "预设提示词节点",
    width: 360,
    html: `
      <p>${escapeHtml(state.thinking.text)}</p>
      <div class="tag-row">
        <span class="tag">${state.thinking.status === "active" ? (state.thinkingModeEnabled ? "推理中" : "生成中") : state.thinking.status === "done" ? "已完成" : "待命"}</span>
        <span class="tag">${state.thinkingModeEnabled ? "先思考" : "跳过思考"}</span>
        <span class="tag">再调用 ${escapeHtml(generationEngineLabel(state.mode))}</span>
      </div>
      ${state.thinking.target ? `<p>目标：${escapeHtml(state.thinking.target)}</p>` : ""}
    `
  });

  if (state.renders.length) {
    state.renders.forEach((render, index) => {
      const outputId = render.id || `render-${index}`;
      const outputItem = getOutputItems().find((item) => item.id === outputId) || {
        id: outputId,
        nodeId: `render${index}`,
        mode: render.mode || state.mode,
        stepMode: render.stepMode || render.mode || state.mode,
        workflowId: render.workflowId || "",
        inputImageType: render.inputImageType || "",
        title: render.title || `效果图 ${index + 1}`,
        url: render.url,
        prompt: render.prompt || "",
        sourcePrompt: render.sourcePrompt || "",
        intent: render.intent || ""
      };
      nodes.push(imageCanvasNode({
        id: `render${index}`,
        outputId,
        kind: index === state.renders.length - 1 ? "Latest Output" : "Output",
        title: render.title || `效果图 ${index + 1}`,
        width: 420,
        url: render.url,
        caption: `${outputMetaLine(outputItem)}${render.intent ? ` · ${render.intent}` : ""}`,
        actions: outputNodeActions(outputId, render.url, outputItem)
      }));
    });
  } else {
    const actionLabel = primaryActionLabel(state.mode);
    const resultTitle = modeConfig(state.mode).resultTitle || "结果";
    nodes.push({
      id: "render",
      kind: "Output",
      title: outputSlotTitle(state.mode),
      width: 420,
      html: state.mode === "cad"
        ? `<p>点击生成按钮，系统会提取平面图线段并生成 DXF / SVG。</p>
           <div class="node-actions">${uiIconButton({ className: "secondary-button", icon: "icon-spark", label: "生成 CAD", attrs: `data-render-trigger="true"` })}</div>`
        : `<p>${escapeHtml(state.thinkingModeEnabled ? `点击生成后，gpt-5.5 会先做当前阶段策略，再调用 ${generationEngineLabel(state.mode)} 生成${resultTitle}。` : `点击生成后，会使用网页预设提示词直接调用 ${generationEngineLabel(state.mode)} 生成${resultTitle}。`)}</p>
           <div class="node-actions">${uiIconButton({ className: "secondary-button", icon: "icon-image", label: actionLabel, attrs: `data-render-trigger="true"` })}</div>`
    });
  }

  state.cadResults.forEach((cad, index) => {
    nodes.push(imageCanvasNode({
      id: `cad${index}`,
      kind: index === state.cadResults.length - 1 ? "Latest CAD" : "CAD",
      title: cad.title || `CAD ${index + 1}`,
      width: 420,
      url: cad.svgUrl,
      contain: true,
      caption: `${cad.createdAt || ""} · ${cad.lineCount} 条线段 · SVG / DXF`,
      actions: `
        ${uiIconLink({ href: cad.dxfUrl, icon: "icon-export", label: "下载 DXF", attrs: `download="${escapeAttr(cad.fileBase)}.dxf"` })}
        ${uiIconLink({ href: cad.svgUrl, icon: "icon-image", label: "下载 SVG", attrs: `download="${escapeAttr(cad.fileBase)}.svg"` })}
      `
    }));
  });

  if (state.plan) {
    nodes.push({
      id: "plan",
      kind: "Reasoning",
      title: state.plan.project_title,
      width: 360,
      html: `<p>${escapeHtml(state.plan.project_summary || state.plan.design_read)}</p>`
    });
  }

  if (state.plan?.directions?.length) {
    state.plan.directions.forEach((direction, index) => {
      const loading = state.loadingImages.has(direction.id);
      nodes.push({
        id: `direction${index}`,
        kind: "Direction",
        title: direction.name,
        width: 320,
        selected: direction.id === state.selectedId,
        directionId: direction.id,
        html: `
          <p>${escapeHtml(direction.concept)}</p>
          <div class="swatch-row">
            ${direction.palette.map((item) => `<span class="swatch" title="${escapeHtml(item.name)}" style="background:${escapeAttr(item.hex)}"></span>`).join("")}
          </div>
          <div class="tag-row">
            ${direction.materials.slice(0, 4).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          </div>
          <div class="node-actions">
            ${uiIconButton({ className: "secondary-button", icon: direction.image ? "icon-refresh" : "icon-image", label: direction.image ? "重新生成" : "生成视觉", attrs: `data-image-id="${escapeAttr(direction.id)}" ${loading ? "disabled" : ""}` })}
            ${uiIconButton({ icon: "icon-focus", label: "查看", attrs: `data-select-id="${escapeAttr(direction.id)}"` })}
          </div>
        `
      });
      if (direction.image?.url) {
        const outputId = `direction-${direction.id}`;
        nodes.push(imageCanvasNode({
          id: `directionImage${index}`,
          outputId,
          kind: "Direction Image",
          title: direction.name,
          width: 420,
          url: direction.image.url,
          caption: direction.client_pitch || direction.concept || "方向视觉图",
          actions: `
            ${outputNodeActions(outputId, direction.image.url, {
              id: outputId,
              nodeId: `directionImage${index}`,
              mode: "direction",
              stepMode: "direction",
              url: direction.image.url,
              title: direction.name,
              prompt: direction.image?.prompt || direction.image_prompt || "",
              intent: direction.image_prompt || direction.concept || ""
            })}
            ${uiIconButton({ icon: "icon-focus", label: "查看方向", attrs: `data-select-id="${escapeAttr(direction.id)}"` })}
          `
        }));
      }
    });
  }

  return nodes;
}

function renderCanvasNode(node) {
  const pos = getNodePosition(node.id);
  const width = node.width || pos.w || 320;
  if (node.directImage) {
    return `
      <figure class="workflow-node canvas-image-object ${node.selected ? "selected" : ""}" data-node-id="${escapeAttr(node.id)}" style="left:${pos.x}px; top:${pos.y}px; width:${width}px;">
        <div class="canvas-image-stage ${node.contain ? "contain" : ""}" data-node-drag-handle="true" data-preview-url="${escapeAttr(node.imageUrl)}" data-preview-title="${escapeAttr(node.title)}" data-preview-caption="${escapeAttr(node.caption || node.kind)}" data-output-id="${escapeAttr(node.outputId || "")}" title="单击打开底部工具，双击放大；按住 Option/Alt 拖到创作面板可设为底图或参考图">
          <img src="${escapeAttr(node.imageUrl)}" alt="${escapeAttr(node.title)}" />
          <span class="canvas-image-zoom-hint" aria-hidden="true">单击工具 / Option拖到面板</span>
        </div>
        <figcaption class="canvas-image-meta">
          <div>
            <strong>${escapeHtml(node.title)}</strong>
            <span>${escapeHtml(node.kind)}</span>
          </div>
          ${node.caption ? `<p>${escapeHtml(node.caption)}</p>` : ""}
          ${node.advice ? `<p class="canvas-image-advice">${escapeHtml(node.advice)}</p>` : ""}
          ${node.actions && !node.outputId ? `<div class="node-actions wrap">${node.actions}</div>` : ""}
        </figcaption>
      </figure>
    `;
  }
  return `
    <article class="workflow-node ${node.selected ? "selected" : ""}" data-node-id="${escapeAttr(node.id)}" style="left:${pos.x}px; top:${pos.y}px; width:${width}px;">
      <div class="node-head" data-node-drag-handle="true">
        <strong>${escapeHtml(node.title)}</strong>
        <span class="node-kind">${escapeHtml(node.kind)}</span>
      </div>
      <div class="node-body">${node.html}</div>
    </article>
  `;
}

function ensureImagePreviewOverlay() {
  let overlay = document.getElementById("imagePreviewOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "imagePreviewOverlay";
  overlay.className = "image-preview-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="image-preview-dialog" role="dialog" aria-modal="true" aria-label="图片预览">
      <div class="image-preview-head">
        <div>
          <strong data-preview-title></strong>
          <span data-preview-caption></span>
        </div>
        <button class="icon-button icon-only" type="button" data-preview-close title="关闭" aria-label="关闭">
          <svg><use href="#icon-close"></use></svg>
        </button>
      </div>
      <div class="image-preview-stage">
        <img alt="放大预览" data-preview-image />
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-preview-close]")) closeImagePreview();
  });
  return overlay;
}

function openImagePreview({ url, title = "", caption = "" }) {
  if (!url) return;
  const overlay = ensureImagePreviewOverlay();
  overlay.querySelector("[data-preview-image]").src = url;
  overlay.querySelector("[data-preview-title]").textContent = title || "图片预览";
  overlay.querySelector("[data-preview-caption]").textContent = caption || "点击空白处关闭";
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  focusOverlayControl(overlay, "[data-preview-close]");
}

function closeImagePreview() {
  const overlay = document.getElementById("imagePreviewOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  overlay.querySelector("[data-preview-image]").removeAttribute("src");
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function ensureCompareOverlay() {
  let overlay = document.getElementById("imageCompareOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "imageCompareOverlay";
  overlay.className = "image-preview-overlay image-compare-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="image-preview-dialog image-compare-dialog" role="dialog" aria-modal="true" aria-label="图片对比">
      <div class="image-preview-head">
        <div>
          <strong>对比查看</strong>
          <span>最多同时对比 4 张输出图</span>
        </div>
        <button class="icon-button icon-only" type="button" data-compare-close title="关闭" aria-label="关闭">
          <svg><use href="#icon-close"></use></svg>
        </button>
      </div>
      <div class="image-compare-grid" data-compare-grid></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-compare-close]")) closeCompareOverlay();
  });
  return overlay;
}

function openCompareOverlay() {
  const items = getOutputItems().filter((item) => state.compareOutputIds.has(item.id));
  if (items.length < 2) {
    toast("请至少选择 2 张图加入对比");
    return;
  }
  const overlay = ensureCompareOverlay();
  overlay.querySelector("[data-compare-grid]").innerHTML = items.map((item) => `
    <figure>
      <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.title)}" />
      <figcaption>${escapeHtml(item.title)}</figcaption>
    </figure>
  `).join("");
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  focusOverlayControl(overlay, "[data-compare-close]");
}

function closeCompareOverlay() {
  const overlay = document.getElementById("imageCompareOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  overlay.querySelector("[data-compare-grid]").innerHTML = "";
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function ensureDeepEditOverlay() {
  let overlay = document.getElementById("deepEditOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "deepEditOverlay";
  overlay.className = "deep-edit-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="deep-edit-dialog" role="dialog" aria-modal="true" aria-label="深度编辑">
      <header class="deep-edit-head">
        <div>
          <span>局部深度编辑</span>
          <strong data-deep-edit-title>选中图片</strong>
        </div>
        <button class="icon-button icon-only" type="button" data-deep-edit-action="cancel" title="关闭" aria-label="关闭">
          <svg><use href="#icon-close"></use></svg>
        </button>
      </header>
      <div class="deep-edit-tools" aria-label="编辑工具">
        ${uiIconButton({ className: "secondary-button active", icon: "icon-box-select", label: "框选", attrs: `data-deep-edit-tool="box"` })}
        ${uiIconButton({ className: "secondary-button", icon: "icon-brush", label: "涂鸦", attrs: `data-deep-edit-tool="brush"` })}
        ${uiIconButton({ icon: "icon-eraser", label: "清除标记", attrs: `data-deep-edit-action="clear"` })}
      </div>
      <div class="deep-edit-stage">
        <canvas data-deep-edit-canvas></canvas>
        <span data-deep-edit-hint>在图上框选或涂鸦需要修改的区域</span>
      </div>
      <footer class="deep-edit-agent">
        <textarea data-deep-edit-prompt rows="2" placeholder="告诉 Agent：需要把选中区域调整成什么样？"></textarea>
        <button class="primary-button icon-only" type="button" data-deep-edit-action="submit" title="生成局部编辑" aria-label="生成局部编辑">
          <svg><use href="#icon-spark"></use></svg>
        </button>
      </footer>
    </section>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) closeDeepEditOverlay();
  });
  overlay.querySelectorAll("[data-deep-edit-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.deepEdit.tool = button.dataset.deepEditTool || "box";
      renderDeepEditOverlay();
    });
  });
  overlay.querySelector("[data-deep-edit-action='clear']").addEventListener("click", () => {
    state.deepEdit.selection = null;
    state.deepEdit.strokes = [];
    state.deepEdit.activeStroke = null;
    drawDeepEditCanvas();
    renderDeepEditOverlay();
  });
  overlay.querySelector("[data-deep-edit-action='cancel']").addEventListener("click", closeDeepEditOverlay);
  overlay.querySelector("[data-deep-edit-action='submit']").addEventListener("click", () => {
    submitDeepEdit().catch((error) => toast(error.message));
  });
  const prompt = overlay.querySelector("[data-deep-edit-prompt]");
  prompt.addEventListener("input", () => {
    state.deepEdit.prompt = prompt.value;
  });
  const canvas = overlay.querySelector("[data-deep-edit-canvas]");
  canvas.addEventListener("pointerdown", startDeepEditPointer);
  canvas.addEventListener("pointermove", moveDeepEditPointer);
  canvas.addEventListener("pointerup", endDeepEditPointer);
  canvas.addEventListener("pointercancel", endDeepEditPointer);
  return overlay;
}

async function openDeepEdit(selected) {
  if (!selected?.url) return;
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url) || null;
  state.deepEdit = {
    ...state.deepEdit,
    open: true,
    tool: "box",
    selectedImage: selected,
    outputItem,
    image: null,
    imageBox: null,
    selection: null,
    strokes: [],
    activeStroke: null,
    dragStart: null,
    prompt: "",
    busy: false
  };
  const overlay = ensureDeepEditOverlay();
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  renderDeepEditOverlay();
  focusOverlayControl(overlay, "[data-deep-edit-prompt]");
  try {
    state.deepEdit.image = await loadImage(selected.url);
    drawDeepEditCanvas();
  } catch {
    closeDeepEditOverlay();
    toast("无法载入这张图片进行深度编辑");
  }
}

function closeDeepEditOverlay() {
  const overlay = document.getElementById("deepEditOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  state.deepEdit.open = false;
  state.deepEdit.image = null;
  state.deepEdit.imageBox = null;
  state.deepEdit.activeStroke = null;
  state.deepEdit.dragStart = null;
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function renderDeepEditOverlay() {
  const overlay = ensureDeepEditOverlay();
  const selected = state.deepEdit.selectedImage;
  overlay.querySelector("[data-deep-edit-title]").textContent = selected?.title || "选中图片";
  overlay.querySelectorAll("[data-deep-edit-tool]").forEach((button) => {
    const active = button.dataset.deepEditTool === state.deepEdit.tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const prompt = overlay.querySelector("[data-deep-edit-prompt]");
  if (document.activeElement !== prompt) prompt.value = state.deepEdit.prompt || "";
  const submit = overlay.querySelector("[data-deep-edit-action='submit']");
  submit.disabled = state.deepEdit.busy;
  submit.title = state.deepEdit.busy ? "生成中" : "生成局部编辑";
  submit.setAttribute("aria-label", submit.title);
  submit.innerHTML = state.deepEdit.busy
    ? `<span class="icon-busy-dot" aria-hidden="true"></span>`
    : `<svg><use href="#icon-spark"></use></svg>`;
  const hint = overlay.querySelector("[data-deep-edit-hint]");
  const markCount = (state.deepEdit.selection ? 1 : 0) + state.deepEdit.strokes.length;
  hint.textContent = markCount
    ? state.deepEdit.tool === "brush"
      ? "已记录涂鸦区域，可继续补充修改要求"
      : "已记录框选区域，可继续补充修改要求"
    : "在图上框选或涂鸦需要修改的区域";
}

function drawDeepEditCanvas() {
  const overlay = ensureDeepEditOverlay();
  const canvas = overlay.querySelector("[data-deep-edit-canvas]");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(360, Math.round(rect.width * dpr));
  const height = Math.max(300, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10100f";
  ctx.fillRect(0, 0, width, height);
  const image = state.deepEdit.image;
  if (!image) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  state.deepEdit.imageBox = { dx, dy, drawWidth, drawHeight, width, height };
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(dx, dy, drawWidth, drawHeight);

  if (state.deepEdit.selection) {
    const { x, y, width: sw, height: sh } = state.deepEdit.selection;
    const px = dx + x * drawWidth;
    const py = dy + y * drawHeight;
    const pw = sw * drawWidth;
    const ph = sh * drawHeight;
    ctx.fillStyle = "rgba(214, 180, 87, 0.24)";
    ctx.strokeStyle = "#d6b457";
    ctx.lineWidth = 2 * dpr;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeRect(px, py, pw, ph);
  }

  const strokes = state.deepEdit.activeStroke
    ? [...state.deepEdit.strokes, state.deepEdit.activeStroke]
    : state.deepEdit.strokes;
  strokes.forEach((stroke) => {
    if (!stroke.points?.length) return;
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const px = dx + point.x * drawWidth;
      const py = dy + point.y * drawHeight;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(74, 167, 255, 0.88)";
    ctx.lineWidth = 12 * dpr;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();
  });
}

function deepEditCanvasPoint(event) {
  const canvas = ensureDeepEditOverlay().querySelector("[data-deep-edit-canvas]");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (event.clientX - rect.left) * dpr,
    y: (event.clientY - rect.top) * dpr
  };
}

function normalizeDeepEditPoint(point) {
  const box = state.deepEdit.imageBox;
  if (!box) return null;
  const x = clamp((point.x - box.dx) / box.drawWidth, 0, 1);
  const y = clamp((point.y - box.dy) / box.drawHeight, 0, 1);
  return { x: round4(x), y: round4(y) };
}

function updateDeepEditBoxSelection(from, to) {
  const box = state.deepEdit.imageBox;
  if (!box) return;
  const x1 = clamp(Math.min(from.x, to.x), box.dx, box.dx + box.drawWidth);
  const y1 = clamp(Math.min(from.y, to.y), box.dy, box.dy + box.drawHeight);
  const x2 = clamp(Math.max(from.x, to.x), box.dx, box.dx + box.drawWidth);
  const y2 = clamp(Math.max(from.y, to.y), box.dy, box.dy + box.drawHeight);
  const width = x2 - x1;
  const height = y2 - y1;
  state.deepEdit.selection = width < 8 || height < 8
    ? null
    : {
        x: round4((x1 - box.dx) / box.drawWidth),
        y: round4((y1 - box.dy) / box.drawHeight),
        width: round4(width / box.drawWidth),
        height: round4(height / box.drawHeight)
      };
  drawDeepEditCanvas();
}

function startDeepEditPointer(event) {
  if (!state.deepEdit.open || !state.deepEdit.imageBox || state.deepEdit.busy) return;
  event.preventDefault();
  event.stopPropagation();
  const canvas = event.currentTarget;
  canvas.setPointerCapture(event.pointerId);
  const point = deepEditCanvasPoint(event);
  if (state.deepEdit.tool === "brush") {
    const normalized = normalizeDeepEditPoint(point);
    if (!normalized) return;
    state.deepEdit.activeStroke = { points: [normalized] };
  } else {
    state.deepEdit.dragStart = point;
    updateDeepEditBoxSelection(point, point);
  }
}

function moveDeepEditPointer(event) {
  if (!state.deepEdit.open || state.deepEdit.busy) return;
  if (!state.deepEdit.activeStroke && !state.deepEdit.dragStart) return;
  event.preventDefault();
  event.stopPropagation();
  const point = deepEditCanvasPoint(event);
  if (state.deepEdit.tool === "brush" && state.deepEdit.activeStroke) {
    const normalized = normalizeDeepEditPoint(point);
    if (normalized) {
      const points = state.deepEdit.activeStroke.points;
      const last = points[points.length - 1];
      if (!last || Math.hypot(normalized.x - last.x, normalized.y - last.y) > 0.004) {
        points.push(normalized);
      }
    }
    drawDeepEditCanvas();
    return;
  }
  if (state.deepEdit.dragStart) updateDeepEditBoxSelection(state.deepEdit.dragStart, point);
}

function endDeepEditPointer(event) {
  if (!state.deepEdit.open) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.deepEdit.tool === "brush" && state.deepEdit.activeStroke) {
    if (state.deepEdit.activeStroke.points.length > 1) {
      state.deepEdit.strokes.push(state.deepEdit.activeStroke);
    }
    state.deepEdit.activeStroke = null;
  }
  if (state.deepEdit.dragStart) {
    updateDeepEditBoxSelection(state.deepEdit.dragStart, deepEditCanvasPoint(event));
    state.deepEdit.dragStart = null;
  }
  drawDeepEditCanvas();
  renderDeepEditOverlay();
}

function deepEditStrokeBounds() {
  const points = state.deepEdit.strokes.flatMap((stroke) => stroke.points || []);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 0.025;
  return {
    x: round4(clamp(minX - padding, 0, 1)),
    y: round4(clamp(minY - padding, 0, 1)),
    width: round4(clamp(maxX - minX + padding * 2, 0.01, 1)),
    height: round4(clamp(maxY - minY + padding * 2, 0.01, 1))
  };
}

function deepEditSelectionSummary() {
  if (state.deepEdit.selection) {
    const s = state.deepEdit.selection;
    return `框选区域：x=${s.x}, y=${s.y}, width=${s.width}, height=${s.height}`;
  }
  if (state.deepEdit.strokes.length) {
    const bounds = deepEditStrokeBounds();
    return `涂鸦区域：${state.deepEdit.strokes.length} 条笔迹；近似包围盒 x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`;
  }
  return "";
}

async function submitDeepEdit() {
  const prompt = String(state.deepEdit.prompt || "").trim();
  if (!prompt) {
    toast("请先写清楚选中区域要怎么调整");
    return;
  }
  const selection = state.deepEdit.selection || deepEditStrokeBounds();
  if (!selection) {
    toast("请先在图上框选或涂鸦需要修改的区域");
    return;
  }
  const selected = state.deepEdit.selectedImage;
  const outputItem = state.deepEdit.outputItem;
  const primaryImage = await imageSourceToPrimaryImage(selected);
  primaryImage.id = outputItem?.id || selected.id || `deep-edit-${Date.now()}`;
  primaryImage.parentImageId = outputItem?.id || selected.id || "";
  primaryImage.parentNodeId = outputItem?.nodeId || selected.id || "";
  primaryImage.workflowId = outputItem?.workflowId || "";
  primaryImage.sourceType = "deep-edit-source";
  primaryImage.inputAnalysis = outputItem
    ? inputTypeForGeneratedMode(outputItem.stepMode || outputItem.mode)
    : null;

  const beforeCount = state.renders.length;
  state.deepEdit.busy = true;
  renderDeepEditOverlay();
  try {
    await renderFromImages({
      mode: "detail",
      primaryImage,
      selection,
      count: 1,
      title: "深度编辑结果",
      parentImageId: primaryImage.parentImageId,
      parentNodeId: primaryImage.parentNodeId,
      workflowId: primaryImage.workflowId,
      inputAnalysis: primaryImage.inputAnalysis,
      userPromptOverride: prompt,
      intent: [
        `深度编辑画布图片：${selected.title || "选中图片"}`,
        "编辑方式：局部 P 图式编辑。",
        deepEditSelectionSummary(),
        "硬性约束：只修改用户框选或涂鸦标记的区域；未选中的空间结构、透视、材料、灯光、家具位置、边缘关系和画面风格尽量保持不变。",
        "如果选区边缘需要融合，请只做自然过渡，不要扩散到未选区域。",
        `用户对选中区域的修改要求：${prompt}`
      ].filter(Boolean).join("\n")
    });
    if (state.renders.length > beforeCount) {
      const latestIndex = state.renders.length - 1;
      const latest = state.renders[latestIndex];
      state.canvas.selectedImage = {
        id: `render${latestIndex}`,
        outputId: latest.id,
        url: latest.url,
        title: latest.title,
        kind: "Output",
        caption: latest.intent
      };
    }
    closeDeepEditOverlay();
    renderWorkflowCanvas();
  } finally {
    state.deepEdit.busy = false;
    renderDeepEditOverlay();
  }
}

function ensureCanvasImageToolbar() {
  let toolbar = document.getElementById("canvasImageToolbar");
  if (toolbar) return toolbar;
  toolbar = document.createElement("div");
  toolbar.id = "canvasImageToolbar";
  toolbar.className = "canvas-image-toolbar";
  toolbar.hidden = true;
  toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());
  els.infiniteCanvas.appendChild(toolbar);
  return toolbar;
}

function renderCanvasImageToolbar() {
  const toolbar = ensureCanvasImageToolbar();
  const selected = state.canvas.selectedImage;
  if (!selected) {
    toolbar.hidden = true;
    toolbar.innerHTML = "";
    return;
  }

  const busy = state.canvas.imageActionBusy;
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
  const favorite = outputItem ? state.favoriteOutputIds.has(outputItem.id) : false;
  const compare = outputItem ? state.compareOutputIds.has(outputItem.id) : false;
  const nextModes = outputItem ? nextPlanWorkflowModes(outputItem.stepMode || outputItem.mode) : [];
  const selectedAnalysis = selected.id === "source" ? state.primaryImageAnalysis : null;
  const selectedAdvice = nextModes.length
    ? {
        text: `这张图处在「${workflowStepLabel(outputItem.stepMode || outputItem.mode)}」之后，建议继续下一步。`,
        label: nextModes.map((mode) => suggestedModeLabel(mode)).join(" / ")
      }
    : inputWorkflowAdvice(selectedAnalysis);
  const primaryActions = nextModes.length
    ? nextModes.map((nextMode) => iconActionButton({
        action: "plan-next",
        icon: "icon-continue",
        label: nextMode === "plan-axonometric" ? "用这张生成3D平面图" : "用这张生成效果图",
        attrs: `data-next-mode="${escapeAttr(nextMode)}"`
      })).join("")
    : selectedAdvice?.mode
      ? iconActionButton({
          action: "use-mode",
          icon: "icon-spark",
          label: `按推荐：${selectedAdvice.label}`,
          attrs: `data-mode="${escapeAttr(selectedAdvice.mode)}" ${busy ? "disabled" : ""}`
        })
      : outputItem
        ? iconActionButton({ action: "continue", icon: "icon-continue", label: "基于这张继续优化" })
        : iconActionButton({
            action: "use-mode",
            icon: "icon-panel-show",
            label: "设为输入继续创作",
            attrs: `data-mode="custom" ${busy ? "disabled" : ""}`
          });
  toolbar.hidden = false;
  toolbar.innerHTML = `
    <div class="canvas-image-toolbar-info">
      <span>已选图片</span>
      <strong>${escapeHtml(selected.title || "画布图片")}</strong>
      <p>${escapeHtml(selectedAdvice?.text || "这张图可以继续生成、增强、对比或作为下一次创作输入。")}</p>
    </div>
    <div class="canvas-image-toolbar-primary">
      <span>推荐下一步</span>
      <div class="canvas-toolbar-group-actions">
        ${primaryActions}
        ${iconActionButton({ action: "send-to-panel", icon: "icon-panel-show", label: "加入创作面板", attrs: busy ? "disabled" : "" })}
        ${iconActionButton({ action: "deep-edit", icon: "icon-detail", label: "深度编辑", attrs: busy ? "disabled" : "" })}
        ${iconActionButton({ className: "text-button", action: "open-original", icon: "icon-image", label: "打开原图" })}
        ${iconActionButton({ className: "text-button", action: "preview", icon: "icon-focus", label: "放大查看" })}
      </div>
    </div>
    <details class="canvas-image-toolbar-modes">
      <summary>切换能力</summary>
      <div class="canvas-mode-grid" aria-label="基于选中图片使用能力">
        ${canvasSelectableModes.map((item) => `
          <button class="${normalizeClientMode(state.mode) === item.mode ? "active" : ""}" type="button" data-canvas-image-tool="use-mode" data-mode="${escapeAttr(item.mode)}" aria-pressed="${normalizeClientMode(state.mode) === item.mode ? "true" : "false"}" ${busy ? "disabled" : ""}>
            ${escapeHtml(item.label)}
          </button>
        `).join("")}
      </div>
    </details>
    <div class="canvas-image-toolbar-actions">
      ${outputItem ? `
        <div class="canvas-toolbar-group">
          <span>作品管理</span>
          <div class="canvas-toolbar-group-actions">
            ${iconActionButton({ action: "favorite", icon: "icon-star", label: favorite ? "已收藏" : "收藏", attrs: `aria-pressed="${favorite ? "true" : "false"}"` })}
            ${iconActionButton({ action: "compare", icon: "icon-compare", label: compare ? "移出对比" : "对比", attrs: `aria-pressed="${compare ? "true" : "false"}"` })}
            ${iconActionButton({ action: "promote", icon: "icon-pin", label: "设为最新" })}
            ${iconActionButton({ action: "copy-prompt", icon: "icon-copy", label: "复制提示词" })}
            ${iconActionButton({ action: "regenerate", icon: "icon-refresh", label: "重新生成这一步" })}
            ${iconActionButton({ action: "lock-layout", icon: "icon-lock", label: "锁定布局" })}
            ${iconActionButton({ action: "continue", icon: "icon-continue", label: "继续编辑" })}
          </div>
        </div>
      ` : ""}
      ${iconActionButton({ className: "text-button", action: "close", icon: "icon-close", label: "关闭" })}
    </div>
  `;
  toolbar.querySelectorAll("[data-canvas-image-tool]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleCanvasImageTool(button.dataset.canvasImageTool, button.dataset.nextMode, button.dataset.mode);
    });
  });
}

function selectCanvasImage(image) {
  state.canvas.selectedImage = image?.url ? image : null;
  state.canvas.imageActionBusy = "";
  renderWorkflowCanvas();
}

async function handleCanvasImageTool(action, nextMode = "", targetMode = "") {
  const selected = state.canvas.selectedImage;
  if (!selected) return;
  if (action === "close") {
    state.canvas.selectedImage = null;
    renderCanvasImageToolbar();
    renderWorkflowCanvas();
    return;
  }
  if (action === "preview") {
    openImagePreview(selected);
    return;
  }
  if (action === "open-original") {
    window.open(selected.url, "_blank", "noreferrer");
    return;
  }
  if (action === "deep-edit") {
    await openDeepEdit(selected);
    return;
  }
  if (action === "use-mode") {
    await useCanvasImageWithMode(targetMode);
    return;
  }
  if (["favorite", "compare", "promote", "regenerate", "continue", "plan-next", "send-to-panel", "copy-prompt", "lock-layout"].includes(action)) {
    const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
    if (!outputItem) {
      if (action === "send-to-panel") await useCanvasImageWithMode("custom");
      return;
    }
    if (action === "favorite") handleOutputAction("favorite", outputItem.id);
    if (action === "compare") handleOutputAction("compare", outputItem.id);
    if (action === "promote") handleOutputAction("promote", outputItem.id);
    if (action === "regenerate") await handleOutputAction("regenerate", outputItem.id);
    if (action === "continue") await handleOutputAction("continue", outputItem.id);
    if (action === "plan-next") await handleOutputAction("plan-next", outputItem.id, nextMode);
    if (action === "send-to-panel") await handleOutputAction("send-to-panel", outputItem.id);
    if (action === "copy-prompt") await handleOutputAction("copy-prompt", outputItem.id);
    if (action === "lock-layout") await handleOutputAction("lock-layout", outputItem.id);
    return;
  }

  state.canvas.imageActionBusy = action;
  renderCanvasImageToolbar();
  try {
    if (action === "upscale") {
      await runLocalCanvasImageTool({
        mode: "upscale",
        title: "画质增强结果",
        toastText: "画质增强完成",
        run: (image, name) => localEnhanceQualityImage(image, name)
      });
    } else if (action === "sharpen") {
      await runLocalCanvasImageTool({
        mode: "sharpen",
        title: "锐化结果",
        toastText: "锐化完成",
        run: (image, name) => localSharpenImage(image, name)
      });
    } else if (["detail", "outpaint"].includes(action)) {
      await runAiCanvasImageTool(action);
    }
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `图片工具失败：${error.message}` });
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    state.canvas.imageActionBusy = "";
    renderCanvasImageToolbar();
  }
}

async function runLocalCanvasImageTool({ mode, title, toastText, run }) {
  const selected = state.canvas.selectedImage;
  const startedAt = new Date();
  startActiveTask({
    type: `canvas-${mode}`,
    label: title,
    total: 1,
    userPrompt: `画布选中图片：${selected.title || selected.id || "canvas image"}`,
    referenceCount: activeReferenceImages().length
  });
  const primary = await imageSourceToPrimaryImage(selected);
  const image = await loadImage(primary.dataUrl);
  const result = run(image, primary.name);
  result.title = title;
  state.imageToolResults.push(result);
  state.render = result;
  state.renders.push(result);
  state.canvas.selectedImage = {
    id: `render${state.renders.length - 1}`,
    url: result.url,
    title: result.title,
    kind: "Output",
    caption: result.intent
  };
  state.thinking = {
    status: "done",
    target: title,
    text: `${title}已完成。${featureOptimizationNotes[mode]}`
  };
  updateActiveTask({
    success: 1,
    finalPrompt: result.intent,
    outputs: [result],
    event: `${title}完成`
  });
  renderGeneratedResult();
  renderWorkflowCanvas();
  logClientTask(`canvas-${mode}`, {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    input: {
      mode,
      intent: `画布选中图片：${selected.title || selected.id || "canvas image"}`,
      primaryImage: { name: primary.name, type: primary.type }
    },
    result: {
      url: result.url,
      title: result.title,
      mode: result.mode,
      intent: result.intent
    }
  });
  completeActiveTask("success");
  toast(toastText);
}

async function runAiCanvasImageTool(mode) {
  const selected = state.canvas.selectedImage;
  const primaryImage = await imageSourceToPrimaryImage(selected);
  const config = modeConfig(mode);
  const toolCommand = canvasModeCommand(mode, selected);
  const currentCommand = currentCanvasUserPrompt();
  await renderFromImages({
    mode,
    primaryImage,
    selection: null,
    count: 1,
    title: config.resultTitle,
    intent: [
      `画布选中图片：${selected.title || "画布图片"}`,
      `当前操作：${workflowButtonMeanings[mode]?.label || config.resultTitle}`,
      workflowButtonMeanings[mode]?.meaning || config.intent,
      featureOptimizationNotes[mode],
      toolCommand,
      currentCommand && currentCommand !== toolCommand ? `用户补充：${currentCommand}` : ""
    ].filter(Boolean).join("\n")
  });
  const latestIndex = state.renders.length - 1;
  const latest = state.renders[latestIndex];
  if (latest?.url) {
    state.canvas.selectedImage = {
      id: `render${latestIndex}`,
      url: latest.url,
      title: latest.title,
      kind: "Output",
      caption: latest.intent
    };
    renderWorkflowCanvas();
  }
}

async function imageSourceToPrimaryImage(image) {
  if (!image?.url) throw new Error("请先在画布中选择一张图片");
  if (image.url.startsWith("data:image")) {
    return {
      name: `${slugForFile(image.title || image.id || "canvas-image")}.png`,
      type: "image/png",
      dataUrl: image.url
    };
  }
  return localImageUrlToDataUrl(image.url, `${slugForFile(image.title || image.id || "canvas-image")}.png`);
}

function imageAnalysisFromOutputLabel(label = "") {
  const text = String(label || "");
  if (!text) return null;
  if (/3D平面|三维平面|轴测|axon|isometric/i.test(text)) {
    return imageAnalysisResult({ key: "axonometric", label: "3D平面图", suggestedMode: "plan-render", confidence: 0.9 }, {}, "由画布输出记录识别为 3D 平面图");
  }
  if (/黑白平面|线稿|户型|平面图/i.test(text)) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.84 }, {}, "由画布输出记录识别为平面图线稿");
  }
  if (/CAD|施工图|图纸/i.test(text)) {
    return imageAnalysisResult({ key: "cad-screenshot", label: "CAD 截图 / 图纸线稿", suggestedMode: "cadrender", confidence: 0.84 }, {}, "由画布输出记录识别为 CAD 或图纸");
  }
  if (/白模|灰模|建模|模型/i.test(text)) {
    return imageAnalysisResult({ key: "white-model", label: "白模 / 建模截图", suggestedMode: "whitemodel", confidence: 0.84 }, {}, "由画布输出记录识别为白模或建模截图");
  }
  if (/手稿|草图|sketch/i.test(text)) {
    return imageAnalysisResult({ key: "sketch", label: "手稿 / 草图", suggestedMode: "sketch", confidence: 0.8 }, {}, "由画布输出记录识别为手稿或草图");
  }
  if (/现场|实拍|照片|photo/i.test(text)) {
    return imageAnalysisResult({ key: "site-photo", label: "现场照片", suggestedMode: "photo", confidence: 0.8 }, {}, "由画布输出记录识别为现场照片");
  }
  if (/效果图|渲染|人视角|render/i.test(text)) {
    return imageAnalysisResult({ key: "render", label: "效果图 / 渲染图", suggestedMode: "photo", confidence: 0.76 }, {}, "由画布输出记录识别为效果图");
  }
  return null;
}

function canvasOutputAnalysis(item, bitmap, primaryImage) {
  if (item && isPlanWorkflowMode(item.stepMode || item.mode)) {
    return inputTypeForGeneratedMode(item.stepMode || item.mode);
  }
  if (item?.inputAnalysis) return item.inputAnalysis;
  const fromInputType = imageAnalysisFromOutputLabel(item?.inputImageType);
  if (fromInputType) return fromInputType;
  const fromModeLabel = imageAnalysisFromOutputLabel(workflowStepLabel(item?.stepMode || item?.mode || ""));
  if (fromModeLabel) return fromModeLabel;
  return classifyUploadedImage(bitmap, { name: primaryImage.name, type: primaryImage.type });
}

function primaryDropCompatibility(analysis, mode = state.mode) {
  const normalizedMode = normalizeClientMode(mode);
  if (!analysis || ["custom", "designseries"].includes(normalizedMode)) return { ok: true };
  if (isInputCompatibleWithMode(analysis, normalizedMode)) return { ok: true };
  if (Number(analysis.confidence || 0) < 0.55) return { ok: true, lowConfidence: true };
  const imageEditModes = ["materialreplace", "lightingadjust", "styletransfer", "upscale", "detail", "sharpen", "outpaint"];
  const extraCompatibleModes = {
    "line-plan": ["plan-axonometric", "cad", "cadrender", "upscale", "sharpen"],
    "cad-screenshot": ["cad", "cadrender", "plan-axonometric", "upscale", "sharpen"],
    "colored-plan": ["plan-axonometric", "upscale", "detail", "sharpen"],
    axonometric: ["plan-render", ...imageEditModes],
    render: ["photo", "materialboard", ...imageEditModes],
    "generated-output": ["photo", "materialboard", ...imageEditModes],
    "site-photo": ["photo", "materialboard", ...imageEditModes],
    "white-model": ["whitemodel", ...imageEditModes],
    sketch: ["sketch", ...imageEditModes],
    "style-reference": ["styletransfer", "materialboard"]
  };
  if ((extraCompatibleModes[analysis.key] || []).includes(normalizedMode)) return { ok: true };
  return {
    ok: false,
    suggestedMode: normalizeClientMode(analysis.suggestedMode || "custom")
  };
}

function primaryDropMismatchMessage(analysis, mode = state.mode) {
  const current = suggestedModeLabel(mode);
  const suggested = suggestedModeLabel(analysis?.suggestedMode || "custom");
  return `这张图识别为「${analysis?.label || "未知图片"}」，当前能力是「${current}」。它更适合「${suggested}」。已阻止设为底图；可以切换能力，或拖到“素材参考图”。`;
}

async function setCanvasImageAsPrimaryInput(selectedImage, outputItem = null) {
  const primaryImage = await imageSourceToPrimaryImage(selectedImage);
  const bitmap = await loadImage(primaryImage.dataUrl);
  const analysis = canvasOutputAnalysis(outputItem, bitmap, primaryImage);
  const compatibility = primaryDropCompatibility(analysis);
  if (!compatibility.ok) {
    const message = primaryDropMismatchMessage(analysis);
    state.thinking = {
      status: "done",
      target: "底图类型不匹配",
      text: `${message}\n如果只是想参考它的风格、构图或材料，可以拖到“素材参考图”。`
    };
    renderAgentBriefInsight();
    toast(message);
    return false;
  }

  primaryImage.id = outputItem?.id || selectedImage.id || `canvas-${Date.now()}`;
  primaryImage.parentImageId = outputItem?.id || selectedImage.id || "";
  primaryImage.parentNodeId = outputItem?.nodeId || selectedImage.id || "";
  primaryImage.workflowId = isPlanWorkflowMode(state.mode)
    ? (outputItem?.workflowId || createWorkflowId(state.mode))
    : (outputItem?.workflowId || "");
  primaryImage.sourceType = analysis.key;
  primaryImage.inputAnalysis = analysis;
  state.primaryImage = primaryImage;
  state.primaryBitmap = bitmap;
  state.primaryImageAnalysis = analysis;
  state.selection = null;
  setInputAdviceThinking(analysis);
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();

  const warning = compatibility.lowConfidence ? "，识别置信度较低，请生成前再确认模式" : "";
  toast(`已添加为底图：${analysis.label}${warning}`);
  return true;
}

async function addCanvasImageAsReference(selectedImage, outputItem = null) {
  if (state.referenceImages.length >= referenceImageLimit) {
    toast(`参考图最多上传 ${referenceImageLimit} 张`);
    return false;
  }
  const primaryImage = await imageSourceToPrimaryImage(selectedImage);
  const bitmap = await loadImage(primaryImage.dataUrl);
  const analysis = canvasOutputAnalysis(outputItem, bitmap, primaryImage);
  state.referenceImages = [
    ...state.referenceImages,
    {
      name: primaryImage.name,
      type: primaryImage.type,
      dataUrl: primaryImage.dataUrl,
      width: bitmap.naturalWidth || bitmap.width || 0,
      height: bitmap.naturalHeight || bitmap.height || 0,
      weight: "default",
      usage: "auto",
      sourceOutputId: outputItem?.id || selectedImage.outputId || "",
      inputAnalysis: analysis
    }
  ].slice(0, referenceImageLimit);
  state.designSeriesAnalysis = null;
  refreshGenerationControls();
  renderReferenceStrip();
  renderWorkflowCanvas();
  toast(`已添加为参考图：${analysis.label}`);
  if (state.mode === "designseries" && state.referenceImages.length) {
    analyzeDesignSeriesReferences();
  }
  return true;
}

function panelDropCards() {
  return {
    primary: els.agentUploadZone?.querySelector(".primary-upload") || null,
    reference: els.agentUploadZone?.querySelector(".secondary-upload") || null
  };
}

function isVisibleElement(element) {
  return Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
}

function panelDropTargetAt(clientX, clientY) {
  const cards = panelDropCards();
  for (const [target, card] of Object.entries(cards)) {
    if (!isVisibleElement(card)) continue;
    const rect = card.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return target;
    }
  }
  return "";
}

function markPanelDropTarget(target = "") {
  const cards = panelDropCards();
  Object.entries(cards).forEach(([key, card]) => {
    card?.classList.toggle("is-drop-target", key === target);
  });
}

function ensureCanvasPanelDragGhost() {
  let ghost = document.getElementById("canvasPanelDragGhost");
  if (ghost) return ghost;
  ghost = document.createElement("div");
  ghost.id = "canvasPanelDragGhost";
  ghost.className = "canvas-panel-drag-ghost";
  ghost.hidden = true;
  ghost.innerHTML = `
    <img alt="" />
    <span>拖到创作面板</span>
  `;
  document.body.appendChild(ghost);
  return ghost;
}

function updateCanvasPanelDragGhost(event) {
  const drag = state.canvas.panelDropDrag;
  if (!drag) return;
  const ghost = ensureCanvasPanelDragGhost();
  ghost.hidden = false;
  ghost.style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 16}px)`;
  const label = drag.target === "primary"
    ? "松手：添加为底图"
    : drag.target === "reference"
      ? "松手：添加为参考图"
      : "拖到主图或参考图";
  ghost.querySelector("span").textContent = label;
}

function startCanvasPanelDropDrag(event, nodeEl, previewStage) {
  const selectedImage = {
    id: nodeEl.dataset.nodeId || "",
    url: previewStage.dataset.previewUrl,
    title: previewStage.dataset.previewTitle,
    caption: previewStage.dataset.previewCaption,
    outputId: previewStage.dataset.outputId || ""
  };
  const outputItem = findOutputItem(selectedImage.outputId) || getOutputItems().find((item) => item.url === selectedImage.url);
  state.canvas.selectedImage = selectedImage;
  state.canvas.nodeDrag = null;
  state.canvas.panelDropDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    selectedImage,
    outputItem,
    target: ""
  };
  document.body.classList.add("canvas-panel-drop-active");
  els.agentUploadZone?.classList.add("panel-dragging");
  const ghost = ensureCanvasPanelDragGhost();
  ghost.querySelector("img").src = selectedImage.url;
  ghost.hidden = false;
  updateCanvasPanelDropDrag(event);
  nodeEl.setPointerCapture(event.pointerId);
  renderCanvasImageToolbar();
}

function updateCanvasPanelDropDrag(event) {
  const drag = state.canvas.panelDropDrag;
  if (!drag) return;
  if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
  drag.target = panelDropTargetAt(event.clientX, event.clientY);
  markPanelDropTarget(drag.target);
  updateCanvasPanelDragGhost(event);
}

function cleanupCanvasPanelDropDrag() {
  state.canvas.panelDropDrag = null;
  document.body.classList.remove("canvas-panel-drop-active");
  els.agentUploadZone?.classList.remove("panel-dragging");
  markPanelDropTarget("");
  const ghost = document.getElementById("canvasPanelDragGhost");
  if (ghost) {
    ghost.hidden = true;
    ghost.querySelector("img")?.removeAttribute("src");
  }
}

async function finishCanvasPanelDropDrag(event) {
  const drag = state.canvas.panelDropDrag;
  if (!drag) return;
  const target = drag.target || panelDropTargetAt(event.clientX, event.clientY);
  const selectedImage = drag.selectedImage;
  const outputItem = drag.outputItem;
  const moved = drag.moved;
  cleanupCanvasPanelDropDrag();
  if (!target) {
    if (!moved) {
      selectCanvasImage(selectedImage);
    } else {
      toast("按住 Option/Alt 拖到“上传底图”或“素材参考图”区域后松手。");
      renderCanvasImageToolbar();
    }
    return;
  }
  if (target === "primary") {
    await setCanvasImageAsPrimaryInput(selectedImage, outputItem);
    return;
  }
  if (target === "reference") {
    await addCanvasImageAsReference(selectedImage, outputItem);
  }
}

function getNodePosition(id) {
  if (!state.canvas.positions[id]) {
    state.canvas.positions[id] = { ...defaultPositionForNode(id) };
  }
  return state.canvas.positions[id];
}

function bindCanvasNodeEvents() {
  els.canvasNodes.querySelectorAll("[data-select-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedId = button.dataset.selectId;
      render();
    });
  });
  els.canvasNodes.querySelectorAll("[data-image-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      generateImage(button.dataset.imageId);
    });
  });
  els.canvasNodes.querySelectorAll("[data-render-trigger]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runPrimaryAction();
    });
  });
  els.canvasNodes.querySelectorAll("[data-analyze-series]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      analyzeDesignSeriesReferences();
    });
  });
  els.canvasNodes.querySelectorAll("[data-canvas-generate]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runPrimaryAction({ busyButton: els.canvasGenerateButton });
    });
  });
  els.canvasNodes.querySelectorAll("[data-continue-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      continueEditFromLatest();
    });
  });
  els.canvasNodes.querySelectorAll("[data-promote-render]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const render = state.renders[Number(button.dataset.promoteRender)];
      if (!render) return;
      state.render = render;
      renderGeneratedResult();
      renderWorkflowCanvas();
    });
  });
  els.canvasNodes.querySelectorAll("[data-remove-asset]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.removeAsset;
      state.assets = state.assets.filter((asset) => asset.instanceId !== id);
      delete state.canvas.positions[id];
      renderWorkflowCanvas();
    });
  });
  els.canvasNodes.querySelectorAll("[data-remove-primary-image]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removePrimaryImage();
    });
  });
  els.canvasNodes.querySelectorAll("[data-remove-reference-node]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeReferenceImage(button.dataset.removeReferenceNode);
    });
  });
  els.canvasNodes.querySelectorAll("[data-plan-trigger]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      createPlan();
    });
  });
  els.canvasNodes.querySelectorAll("[data-switch-suggested-mode]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setMode(button.dataset.switchSuggestedMode);
      toast(`已切换到“${suggestedModeLabel(button.dataset.switchSuggestedMode)}”`);
    });
  });
  bindOutputActionEvents(els.canvasNodes);
  els.canvasNodes.querySelectorAll("[data-preview-url]").forEach((stage) => {
    stage.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview({
        url: stage.dataset.previewUrl,
        title: stage.dataset.previewTitle,
        caption: stage.dataset.previewCaption
      });
    });
    stage.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.canvas.nodeDrag = null;
      const nodeId = stage.closest("[data-node-id]")?.dataset.nodeId || "";
      const selectedImage = {
        id: nodeId,
        url: stage.dataset.previewUrl,
        title: stage.dataset.previewTitle,
        caption: stage.dataset.previewCaption,
        outputId: stage.dataset.outputId || ""
      };
      state.canvas.selectedImage = selectedImage;
      const outputItem = findOutputItem(selectedImage.outputId) || getOutputItems().find((item) => item.url === selectedImage.url);
      if (outputItem) {
        await syncOutputItemToCreativePanel(outputItem);
      } else {
        await useCanvasImageWithMode("custom");
      }
    });
  });
  els.canvasNodes.querySelectorAll(".workflow-node").forEach((nodeEl) => {
    nodeEl.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-node-drag-handle]");
      if (!handle) return;
      const previewStage = event.target.closest("[data-preview-url]");
      if (previewStage && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        startCanvasPanelDropDrag(event, nodeEl, previewStage);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const nodeId = nodeEl.dataset.nodeId;
      const pos = getNodePosition(nodeId);
      state.canvas.nodeDrag = {
        nodeId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: pos.x,
        originY: pos.y,
        moved: false,
        preview: previewStage
          ? {
              url: previewStage.dataset.previewUrl,
              title: previewStage.dataset.previewTitle,
              caption: previewStage.dataset.previewCaption,
              outputId: previewStage.dataset.outputId || ""
            }
          : null
      };
      nodeEl.setPointerCapture(event.pointerId);
    });
  });
}

function renderCanvasLinks(nodes) {
  const visibleIds = new Set(nodes.map((node) => node.id));
  const renderLinks = state.renders.length
    ? state.renders.flatMap((render, index) => {
        const outputNode = `render${index}`;
        const parent = render.parentNodeId && visibleIds.has(render.parentNodeId) ? render.parentNodeId : "";
        return parent ? [["think", outputNode], [parent, outputNode]] : [["think", outputNode]];
      })
    : [["think", "render"]];
  const cadLinks = state.cadResults.map((_, index) => ["think", `cad${index}`]);
  const assetLinks = state.assets.map((asset) => [asset.instanceId, "command"]);
  const referenceIds = nodes.map((node) => node.id).filter((id) => /^reference\d+$/.test(id));
  const referenceLinks = referenceIds.flatMap((id) => [
    [id, "command"],
    [id, "seriesAdvice"]
  ]);
  const directionImageLinks = (state.plan?.directions || []).map((_, index) => [`direction${index}`, `directionImage${index}`]);
  const links = [
    ["resources", "command"],
    ...assetLinks,
    ["source", state.selection ? "selection" : "command"],
    ["selection", "command"],
    ["source", "planWorkflow"],
    ["planWorkflow", "command"],
    ...referenceLinks,
    ["seriesAdvice", "command"],
    ["command", "think"],
    ...renderLinks,
    ...cadLinks,
    ["plan", "direction0"],
    ["plan", "direction1"],
    ["plan", "direction2"],
    ["think", "direction0"],
    ["think", "direction1"],
    ["think", "direction2"],
    ...directionImageLinks
  ].filter(([from, to]) => visibleIds.has(from) && visibleIds.has(to));

  els.canvasLinks.innerHTML = links.map(([from, to]) => {
    const a = getNodeAnchor(from, "right");
    const b = getNodeAnchor(to, "left");
    return `
      <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"></line>
      <circle cx="${a.x}" cy="${a.y}" r="4"></circle>
      <circle cx="${b.x}" cy="${b.y}" r="4"></circle>
    `;
  }).join("");
}

function scheduleCanvasLinksRender(nodes = null) {
  if (nodes !== null) pendingCanvasLinkNodes = nodes;
  if (canvasLinksFrame) return;
  canvasLinksFrame = requestAnimationFrame(() => {
    canvasLinksFrame = 0;
    const nodesToRender = pendingCanvasLinkNodes || buildCanvasNodes();
    pendingCanvasLinkNodes = null;
    renderCanvasLinks(nodesToRender);
  });
}

function getNodeAnchor(id, side) {
  const pos = getNodePosition(id);
  const nodeEl = els.canvasNodes.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  const width = nodeEl?.offsetWidth || pos.w || 320;
  const height = nodeEl?.offsetHeight || 150;
  return {
    x: side === "left" ? pos.x : pos.x + width,
    y: pos.y + height / 2
  };
}

function applyCanvasTransform({ refreshMinimap = true } = {}) {
  const { x, y, zoom } = state.canvas;
  els.canvasViewport.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  if (refreshMinimap) scheduleCanvasMinimapRender();
}

function resetCanvasView() {
  state.canvas.x = 48;
  state.canvas.y = 28;
  state.canvas.zoom = 0.86;
  applyCanvasTransform();
}

function focusCanvasToNodes(nodeIds = []) {
  const ids = nodeIds.length ? nodeIds : buildCanvasNodes().map((node) => node.id);
  const boxes = ids.map((id) => {
    const pos = getNodePosition(id);
    const nodeEl = els.canvasNodes.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    return {
      x: pos.x,
      y: pos.y,
      w: nodeEl?.offsetWidth || pos.w || 320,
      h: nodeEl?.offsetHeight || 180
    };
  }).filter((box) => box.w && box.h);
  if (!boxes.length) return resetCanvasView();
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  const rect = els.infiniteCanvas.getBoundingClientRect();
  const pad = 120;
  const zoom = clamp(Math.min((rect.width - 64) / Math.max(1, maxX - minX + pad), (rect.height - 120) / Math.max(1, maxY - minY + pad)), 0.35, 1.25);
  state.canvas.zoom = zoom;
  state.canvas.x = (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom;
  state.canvas.y = Math.max(84, (rect.height - (maxY - minY) * zoom) / 2) - minY * zoom;
  applyCanvasTransform();
}

function focusCanvasToResults() {
  const resultIds = getOutputItems().map((item) => item.nodeId).filter(Boolean);
  focusCanvasToNodes(resultIds.length ? resultIds : []);
}

function zoomCanvas(delta, originClientX, originClientY) {
  const oldZoom = state.canvas.zoom;
  const nextZoom = clamp(oldZoom * delta, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM);
  if (nextZoom === oldZoom) return;
  const rect = els.infiniteCanvas.getBoundingClientRect();
  const originX = originClientX == null ? rect.left + rect.width / 2 : originClientX;
  const originY = originClientY == null ? rect.top + rect.height / 2 : originClientY;
  const canvasX = (originX - rect.left - state.canvas.x) / oldZoom;
  const canvasY = (originY - rect.top - state.canvas.y) / oldZoom;
  state.canvas.x = originX - rect.left - canvasX * nextZoom;
  state.canvas.y = originY - rect.top - canvasY * nextZoom;
  state.canvas.zoom = nextZoom;
  applyCanvasTransform();
}

function wheelDeltaPixels(event) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * 240;
  return event.deltaY;
}

function zoomCanvasByWheel(event) {
  const delta = clamp(wheelDeltaPixels(event), -CANVAS_WHEEL_DELTA_LIMIT, CANVAS_WHEEL_DELTA_LIMIT);
  if (!delta) return;
  zoomCanvas(Math.exp(-delta * CANVAS_WHEEL_ZOOM_INTENSITY), event.clientX, event.clientY);
}

function renderCanvasMinimap(nodes = buildCanvasNodes()) {
  if (!els.canvasMinimap) return;
  if (!nodes.length) {
    els.canvasMinimap.hidden = true;
    els.canvasMinimap.innerHTML = "";
    return;
  }
  els.canvasMinimap.hidden = false;
  const canvasWidth = CANVAS_WORKSPACE_WIDTH;
  const canvasHeight = CANVAS_WORKSPACE_HEIGHT;
  const items = nodes.map((node) => {
    const pos = getNodePosition(node.id);
    const w = node.width || pos.w || 320;
    const h = node.directImage ? 260 : 160;
    const isOutput = /^(render|directionImage|cad)/.test(node.id);
    return `<i class="${isOutput ? "is-output" : ""}" style="left:${(pos.x / canvasWidth) * 100}%;top:${(pos.y / canvasHeight) * 100}%;width:${(w / canvasWidth) * 100}%;height:${(h / canvasHeight) * 100}%;"></i>`;
  }).join("");
  const rect = els.infiniteCanvas.getBoundingClientRect();
  const viewX = (-state.canvas.x / state.canvas.zoom / canvasWidth) * 100;
  const viewY = (-state.canvas.y / state.canvas.zoom / canvasHeight) * 100;
  const viewW = (rect.width / state.canvas.zoom / canvasWidth) * 100;
  const viewH = (rect.height / state.canvas.zoom / canvasHeight) * 100;
  els.canvasMinimap.innerHTML = `${items}<b style="left:${viewX}%;top:${viewY}%;width:${viewW}%;height:${viewH}%;"></b>`;
}

function scheduleCanvasMinimapRender(nodes = null) {
  if (nodes !== null) pendingCanvasMinimapNodes = nodes;
  if (canvasMinimapFrame) return;
  canvasMinimapFrame = requestAnimationFrame(() => {
    canvasMinimapFrame = 0;
    const nodesToRender = pendingCanvasMinimapNodes || buildCanvasNodes();
    pendingCanvasMinimapNodes = null;
    renderCanvasMinimap(nodesToRender);
  });
}

function clientPointToCanvas(clientX, clientY) {
  const rect = els.infiniteCanvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.canvas.x) / state.canvas.zoom,
    y: (clientY - rect.top - state.canvas.y) / state.canvas.zoom
  };
}

function syncModeControls(mode) {
  mode = normalizeClientMode(mode);
  syncModeTabs(mode);
  if (els.activeModeLabel) {
    const activeButton = els.modeTabs.find((button) => button.dataset.mode === mode);
    els.activeModeLabel.textContent = activeButton?.dataset.label || activeButton?.textContent.trim() || modeConfig(mode).sourceTitle;
  }
  const config = modeConfig(mode);
  els.primaryUploadLabel.textContent = config.uploadLabel;
  if (els.referenceUploadLabel) {
    els.referenceUploadLabel.textContent = isReferenceOnlyMode(mode) ? "上传参考图" : "素材参考图";
  }
  els.primaryImageInput.accept = mode === "cadrender" ? ".dxf,.svg,image/*" : "image/*";
  els.outputType.value = config.outputType || "overall render";
  els.renderIntent.value = withSelectedStyle(config.intent);
  els.renderButton.innerHTML = els.renderButton.classList.contains("icon-only")
    ? primaryActionIconButtonHtml(mode)
    : primaryActionButtonHtml(mode);
  els.renderButton.title = primaryActionLabel(mode);
  els.renderButton.setAttribute("aria-label", primaryActionLabel(mode));
  if (els.canvasGenerateButton && !els.canvasGenerateButton.classList.contains("icon-only")) {
    const label = primaryActionLabel(mode);
    els.canvasGenerateButton.textContent = label;
    els.canvasGenerateButton.title = label;
    els.canvasGenerateButton.setAttribute("aria-label", label);
  }
  els.continueEditButton.disabled = mode === "cad" || !state.render;
  refreshPresetSelection();
  refreshGenerationControls();
}

function setMode(mode) {
  mode = normalizeClientMode(mode);
  state.mode = mode;
  state.selection = null;
  state.generation.count = clampImageCount(state.generation.count, mode);
  const modeSwitcher = document.querySelector(".mode-switcher");
  const restoreModeSwitcherFocus = modeSwitcher?.open && modeSwitcher.contains(document.activeElement);
  modeSwitcher?.removeAttribute("open");
  if (restoreModeSwitcherFocus) {
    requestAnimationFrame(() => focusElement(modeSwitcher.querySelector("summary")));
  }
  syncDefaultCanvasCommand(mode);
  syncModeControls(mode);
  drawSelectionCanvas();
  renderWorkflowCanvas();
  if (mode === "designseries" && state.referenceImages.length && !state.designSeriesAnalysis) {
    analyzeDesignSeriesReferences();
  }
}

function primaryActionLabel(mode) {
  mode = normalizeClientMode(mode);
  if (mode === "custom") return "生成图片";
  if (mode === "plan-axonometric") return "生成3D平面图";
  if (mode === "plan-render") return "生成效果图";
  if (mode === "cad") return "生成CAD";
  if (mode === "designseries") return "生成设计系列";
  if (mode === "upscale") return "算法增强";
  if (mode === "sharpen") return "提高锐化";
  if (mode === "materialreplace") return "替换材质";
  if (mode === "lightingadjust") return "调整灯光";
  if (mode === "styletransfer") return "迁移风格";
  if (mode === "materialboard") return "生成材料板";
  if (mode === "detail") return "细节增强";
  if (mode === "outpaint") return "扩图";
  return "生成效果图";
}

function primaryActionButtonHtml(mode) {
  const icon = mode === "cad" || mode === "sharpen" ? "icon-spark" : "icon-image";
  return `<svg><use href="#${icon}"></use></svg>${primaryActionLabel(mode)}`;
}

function primaryActionIconButtonHtml(mode) {
  const icon = mode === "cad" || mode === "sharpen" ? "icon-spark" : "icon-image";
  return `<svg><use href="#${icon}"></use></svg>`;
}

function uiIconButton({ className = "text-button", icon = "icon-spark", label = "", attrs = "" }) {
  return `<button class="${className} icon-only" type="button" ${attrs} title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><svg><use href="#${icon}"></use></svg></button>`;
}

function uiIconLink({ className = "secondary-link", href = "#", icon = "icon-export", label = "", attrs = "" }) {
  return `<a class="${className} icon-only" href="${escapeAttr(href)}" ${attrs} title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><svg><use href="#${icon}"></use></svg></a>`;
}

function iconActionButton({ className = "secondary-button", action = "", icon = "icon-spark", label = "", attrs = "" }) {
  const actionAttr = action ? `data-canvas-image-tool="${escapeAttr(action)}"` : "";
  return `<button class="${className}" type="button" ${actionAttr} ${attrs} title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><svg><use href="#${icon}"></use></svg>${escapeHtml(label)}</button>`;
}

function outputActionButton({ action, outputId, icon = "icon-spark", label = "", className = "text-button", attrs = "", nextMode = "" }) {
  const nextAttr = nextMode ? `data-next-mode="${escapeAttr(nextMode)}"` : "";
  return uiIconButton({
    className,
    icon,
    label,
    attrs: `data-output-action="${escapeAttr(action)}" data-output-id="${escapeAttr(outputId)}" ${nextAttr} ${attrs}`
  });
}

function outputSlotTitle(mode) {
  mode = normalizeClientMode(mode);
  if (mode === "custom") return "自定义生成位";
  if (mode === "plan-axonometric") return "3D平面图生成位";
  if (mode === "plan-render") return "效果图生成位";
  if (mode === "cad") return "CAD 生成位";
  if (mode === "designseries") return "设计系列生成位";
  if (mode === "materialboard") return "材料板生成位";
  if (["materialreplace", "lightingadjust", "styletransfer"].includes(mode)) return "AI 编辑生成位";
  if (["upscale", "detail", "sharpen", "outpaint"].includes(mode)) return "图片处理位";
  return "效果图生成位";
}

function generationEngineLabel(mode = state.mode) {
  return "Image Gen";
}

function generationEndpointLabel(mode = state.mode) {
  return getActiveImageEndpoint();
}

function generationThinkingText(mode = state.mode) {
  const normalizedMode = normalizeClientMode(mode);
  if (!state.thinkingModeEnabled) return "思考模式已关闭：本次不做额外提示词融合，直接使用当前功能预设、隐藏提示词和用户描述交给 Image Gen。";
  if (normalizedMode === "plan-render") {
    return state.selection
      ? `正在读取3D平面图，并锁定${selectionRegionLabel(state.selection)}生成人视角效果图。`
      : "正在读取3D平面图和参考图，未框选时会自动选择与参考图最接近的明确区域生成人视角效果图。";
  }
  return "正在读取输入图的空间结构、参考图的材料氛围，并组织 Image Gen 的出图策略。";
}

function modeConfig(mode) {
  mode = normalizeClientMode(mode);
  const map = {
    custom: {
      uploadLabel: "可选上传主图",
      sourceTitle: "自定义输入",
      resultTitle: "自定义生成",
      missing: "可以直接写指令，或上传参考图后生成",
      intent: "自由模式：这是默认预设，不预设图纸、现场、风格或功能限制。先判断用户需要的产物类型，再根据文字指令、主图、参考图和画布资源生成符合设计师审美的空间/产品/材料/氛围/编辑/扩图/设计系列视觉。"
    },
    "plan-axonometric": {
      uploadLabel: "上传平面图",
      sourceTitle: "平面图",
      resultTitle: "3D平面图",
      missing: "请先上传平面图",
      outputType: "realistic 3D floor plan",
      intent: `平面图转真实 3D 平面图。\n${planTo3DFixedPrompt}`
    },
    "plan-render": {
      uploadLabel: "上传3D平面图",
      sourceTitle: "3D平面图",
      resultTitle: "人视角效果图",
      missing: "请先上传3D平面图或带选区的空间参考图",
      outputType: "eye-level interior render",
      intent: "基于 3D 平面图生成最终人视角室内/建筑效果图。优先要求用户在预览图上框选要生成的区域；如果没有框选，Agent 必须自动选择一个与参考图最接近、最适合出图的明确功能区，并在提示词和输出记录里标明效果图来自哪个区域。"
    },
    cad: {
      uploadLabel: "上传平面图图片",
      sourceTitle: "平面图图片",
      resultTitle: "CAD 结果",
      missing: "请先上传平面图图片",
      intent: "提取平面图中的水平/垂直墙线、图纸线段和主要轮廓，生成 DXF 与 SVG 预览。"
    },
    cadrender: {
      uploadLabel: "上传 CAD 文件 / CAD截图",
      sourceTitle: "CAD 底图",
      resultTitle: "CAD 效果图",
      missing: "请先上传 DXF、SVG 或 CAD 截图",
      intent: "读取 CAD 线稿中的墙体、房间关系、开口、尺度和动线，结合参考图生成真实空间效果图。"
    },
    designseries: {
      uploadLabel: "可选上传项目底图",
      sourceTitle: "参考图设计系列",
      resultTitle: "设计系列图",
      missing: "请先上传参考图",
      intent: "根据上传参考图自动识别空间、材料、灯光、家具、色彩和构图语言，生成一套统一风格、多场域、多角度、多视角、多功能分区的深层设计系列图。"
    },
    photo: {
      uploadLabel: "上传现场实拍图",
      sourceTitle: "现场实拍图",
      resultTitle: "现场图效果图",
      missing: "请先上传现场实拍图",
      intent: "保留现场空间架构、开窗、柱网和透视关系，根据参考图重塑材料、灯光、家具和陈列。"
    },
    whitemodel: {
      uploadLabel: "上传白模截图",
      sourceTitle: "白模截图",
      resultTitle: "白模润色结果",
      missing: "请先上传白模截图",
      intent: "保留白模体块、尺度、空间关系和视角，补充真实材料、灯光、环境和细部层次。"
    },
    sketch: {
      uploadLabel: "上传手稿 / 草图",
      sourceTitle: "手稿草图",
      resultTitle: "手稿实景图",
      missing: "请先上传手稿或草图",
      intent: "保留手稿的空间构图、主要体块和设计意图，生成真实建筑或室内空间效果图。"
    },
    upscale: {
      uploadLabel: "上传需要增强的图片",
      sourceTitle: "待增强图片",
      resultTitle: "画质增强结果",
      missing: "请先上传需要画质增强的图片",
      intent: "本地算法提升图片观感：自动色阶、白平衡、轻度降噪、局部对比、锐化和轻量放大，保持原有空间构图和设计内容。"
    },
    detail: {
      uploadLabel: "上传需要增强细节的图片",
      sourceTitle: "待细节增强图片",
      resultTitle: "细节增强结果",
      missing: "请先上传需要细节增强的图片",
      intent: "优先增强选区或用户点名对象；增强材料纹理、灯光层次、家具陈列、软装和空间细节，保持原图布局、镜头、非选区和设计方向。"
    },
    materialreplace: {
      uploadLabel: "上传需要替换材质的图片",
      sourceTitle: "材质替换原图",
      resultTitle: "材质替换结果",
      missing: "请先上传需要替换材质的图片",
      intent: "保留空间结构、透视、光影关系、对象位置和非目标区域，只替换墙面、地面、家具或指定区域材质。可上传参考图作为新材质方向。"
    },
    lightingadjust: {
      uploadLabel: "上传需要调整灯光的图片",
      sourceTitle: "灯光调整原图",
      resultTitle: "灯光调整结果",
      missing: "请先上传需要调整灯光的图片",
      intent: "保留空间结构、材质关系、家具位置和构图，只改变白天、黄昏、夜景或灯光氛围。"
    },
    styletransfer: {
      uploadLabel: "上传需要迁移风格的图片",
      sourceTitle: "风格迁移原图",
      resultTitle: "风格迁移结果",
      missing: "请先上传需要迁移风格的图片",
      intent: "保持空间结构、构图、尺度、开口、动线和主要对象位置，替换整体空间风格、材料语言、软装和陈列氛围。"
    },
    materialboard: {
      uploadLabel: "可选上传空间图",
      sourceTitle: "材料板输入",
      resultTitle: "材料板",
      missing: "请先上传空间图或参考图",
      intent: "根据上传图片和参考图生成材料、色彩、灯光和软装搭配板。",
      outputType: "material board"
    },
    sharpen: {
      uploadLabel: "上传需要锐化的图片",
      sourceTitle: "待锐化图片",
      resultTitle: "锐化结果",
      missing: "请先上传需要锐化的图片",
      intent: "本地提高锐化和局部对比，适合模糊截图或低清效果图。"
    },
    outpaint: {
      uploadLabel: "上传需要扩图的图片",
      sourceTitle: "待扩图图片",
      resultTitle: "扩图结果",
      missing: "请先上传需要扩图的图片",
      intent: "在保持原图主体、风格、空间透视、消失点和光照逻辑的基础上，只向画面外扩展边界，补全更大的建筑/室内场景。"
    }
  };
  return map[mode] || map.custom;
}

function withSelectedStyle(intent) {
  if (!state.selectedStylePreset) return intent;
  const description = stylePresetDescriptions[state.selectedStylePreset];
  if (!description) return intent;
  return `${intent}\n指定风格：${state.selectedStylePreset}：${description}`;
}

function refreshPresetSelection() {
  els.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset !== "none" && button.dataset.preset === state.selectedScenePreset);
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
  });
  els.stylePresetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.stylePreset !== "none" && button.dataset.stylePreset === state.selectedStylePreset);
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
  });
}

function syncDefaultCanvasCommand(mode) {
  setHiddenPromptContext("modePreset", defaultCanvasCommands[mode] || defaultCanvasCommands.default);
}

function applyPreset(name) {
  if (name === "none") {
    state.selectedScenePreset = null;
    clearHiddenPromptContext("scenePreset");
    refreshPresetSelection();
    renderWorkflowCanvas();
    toast("已取消场景模板");
    return;
  }
  const preset = presets[name];
  if (!preset) return;
  state.selectedScenePreset = name;
  refreshPresetSelection();
  writeBrief({
    spaceType: preset.spaceType,
    style: preset.style,
    functions: preset.functions
  });
  setHiddenPromptContext("scenePreset", preset.command);
  renderWorkflowCanvas();
  toast("已套用场景模板，预设会在后台生效");
}

function applyStylePreset(styleName) {
  if (styleName === "none") {
    state.selectedStylePreset = null;
    clearHiddenPromptContext("stylePreset");
    refreshPresetSelection();
    els.renderIntent.value = modeConfig(state.mode).intent;
    renderWorkflowCanvas();
    toast("已取消风格预设");
    return;
  }
  const description = stylePresetDescriptions[styleName];
  if (!description) return;
  state.selectedStylePreset = styleName;
  refreshPresetSelection();
  const styleText = `${styleName}：${description}`;
  writeBrief({ style: styleText });
  els.renderIntent.value = withSelectedStyle(modeConfig(state.mode).intent);
  setHiddenPromptContext("stylePreset", `基于当前输入图和参考素材，按「${styleName}」生成空间方案。${description}`);
  renderWorkflowCanvas();
  toast(`已选择风格：${styleName}`);
}

function classifyUploadedImage(image, file) {
  const metrics = image ? computeImageMetrics(image) : {};
  const name = String(file?.name || "").toLowerCase();
  const ext = name.split(".").pop() || "";
  const aspect = image ? (image.naturalWidth || 1) / Math.max(1, image.naturalHeight || 1) : 1;
  const byName = [
    { test: /(dxf|dwg|cad|施工图|施工|图纸|平面cad)/i, key: "cad-screenshot", label: "CAD 截图 / 图纸线稿", suggestedMode: "cadrender", confidence: 0.84 },
    { test: /(彩平|color.?plan|colored.?plan)/i, key: "colored-plan", label: "彩平图", suggestedMode: "plan-axonometric", confidence: 0.88 },
    { test: /(3d平面|三维平面|轴测|axon|axo|isometric)/i, key: "axonometric", label: "3D平面图（含轴测图）", suggestedMode: "plan-render", confidence: 0.9 },
    { test: /(白模|灰模|模型|建模|sketchup|rhino|revit|white.?model|clay.?render|mass.?model)/i, key: "white-model", label: "白模 / 建模截图", suggestedMode: "whitemodel", confidence: 0.82 },
    { test: /(手稿|手绘|草图|概念线稿|sketch|draft|drawing)/i, key: "sketch", label: "手稿 / 草图", suggestedMode: "sketch", confidence: 0.8 },
    { test: /(现场|实拍|photo|site|before|现状)/i, key: "site-photo", label: "现场照片", suggestedMode: "photo", confidence: 0.82 },
    { test: /(线稿|黑白|平面|plan|户型)/i, key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.78 }
  ].find((item) => item.test.test(name));
  if (byName) return imageAnalysisResult(byName, metrics, `文件名包含 ${byName.label} 线索`);
  if (["dxf", "dwg", "svg"].includes(ext)) {
    return imageAnalysisResult({ key: "cad-screenshot", label: "CAD 截图 / 图纸线稿", suggestedMode: "cadrender", confidence: 0.9 }, metrics, "文件扩展名更接近 CAD 或矢量图纸");
  }

  const saturation = metrics.avgSaturation || 0;
  const whiteRatio = metrics.whiteRatio || 0;
  const darkRatio = metrics.darkRatio || 0;
  const edgeRatio = metrics.edgeRatio || 0;
  const textureRatio = metrics.textureRatio || 0;
  const colorfulness = metrics.colorfulness || 0;

  if (saturation < 0.025 && whiteRatio > 0.58 && edgeRatio > 0.045 && colorfulness < 0.012 && aspect > 1.45) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.86 }, metrics, "超宽白底图纸截图，低饱和且细线边缘密集，更像黑白平面线稿");
  }
  if (saturation < 0.08 && whiteRatio > 0.46 && darkRatio > 0.015 && edgeRatio > 0.055) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.82 }, metrics, "高白底、低饱和、线条边缘密度高，建议直接生成真实 3D 平面图");
  }
  if (saturation < 0.06 && whiteRatio > 0.52 && darkRatio > 0.004 && edgeRatio > 0.024 && textureRatio < 0.18) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.78 }, metrics, "大面积白底、低饱和、细黑线和标注密集，更像黑白平面线稿，建议直接生成真实 3D 平面图");
  }
  if (saturation < 0.1 && darkRatio > 0.08 && edgeRatio > 0.07) {
    return imageAnalysisResult({ key: "cad-screenshot", label: "CAD 截图 / 图纸线稿", suggestedMode: "cadrender", confidence: 0.72 }, metrics, "低饱和且深色线段密集，更像 CAD 或施工图");
  }
  if (saturation > 0.12 && whiteRatio > 0.24 && edgeRatio > 0.06 && textureRatio < 0.24) {
    return imageAnalysisResult({ key: "colored-plan", label: "彩平图", suggestedMode: "plan-axonometric", confidence: 0.72 }, metrics, "色块明显、白底占比较高、纹理复杂度低");
  }
  if (edgeRatio > 0.08 && textureRatio < 0.32 && colorfulness > 0.08 && whiteRatio > 0.12) {
    return imageAnalysisResult({ key: "axonometric", label: "3D平面图（含轴测图）", suggestedMode: "plan-render", confidence: 0.62 }, metrics, "空间边缘和色块都有，但不像真实照片纹理");
  }
  if (textureRatio > 0.26 && whiteRatio < 0.34 && saturation > 0.08) {
    return imageAnalysisResult({ key: "site-photo", label: "现场照片", suggestedMode: "photo", confidence: 0.7 }, metrics, "纹理和光影复杂度较高，更像现场或效果图照片");
  }
  return imageAnalysisResult({ key: "style-reference", label: "参考风格图", suggestedMode: "custom", confidence: 0.48 }, metrics, "未检测到明确图纸结构，按开放参考图处理更稳妥");
}

function imageAnalysisResult(base, metrics, reason) {
  return {
    key: base.key,
    label: base.label,
    suggestedMode: base.suggestedMode,
    confidence: base.confidence,
    reason,
    metrics: {
      avgSaturation: round4(metrics.avgSaturation || 0),
      whiteRatio: round4(metrics.whiteRatio || 0),
      darkRatio: round4(metrics.darkRatio || 0),
      edgeRatio: round4(metrics.edgeRatio || 0),
      textureRatio: round4(metrics.textureRatio || 0),
      colorfulness: round4(metrics.colorfulness || 0)
    }
  };
}

function computeImageMetrics(image) {
  const maxSide = 180;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(24, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(24, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  let saturationSum = 0;
  let white = 0;
  let dark = 0;
  let colorful = 0;
  let edge = 0;
  let texture = 0;
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const y = r * 0.299 + g * 0.587 + b * 0.114;
    luma[p] = y;
    saturationSum += sat;
    if (y > 232 && sat < 0.12) white += 1;
    if (y < 82) dark += 1;
    if (sat > 0.22 && max - min > 24) colorful += 1;
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const current = luma[y * width + x];
      const diff = Math.abs(current - luma[y * width + x - 1]) + Math.abs(current - luma[(y - 1) * width + x]);
      if (diff > 56) edge += 1;
      if (diff > 22) texture += 1;
    }
  }
  const count = width * height;
  const edgeCount = Math.max(1, (width - 1) * (height - 1));
  return {
    avgSaturation: saturationSum / count,
    whiteRatio: white / count,
    darkRatio: dark / count,
    colorfulness: colorful / count,
    edgeRatio: edge / edgeCount,
    textureRatio: texture / edgeCount
  };
}

function shouldWarnInputModeMismatch(analysis, mode = state.mode) {
  const normalizedMode = normalizeClientMode(mode);
  if (!analysis?.suggestedMode || analysis.suggestedMode === normalizedMode) return false;
  if (isInputCompatibleWithMode(analysis, normalizedMode)) return false;
  if (["custom", "designseries"].includes(normalizedMode)) return false;
  if (analysis.confidence < 0.58) return false;
  return true;
}

function inputTypeForGeneratedMode(mode) {
  const normalizedMode = normalizeClientMode(mode);
  const map = {
    "plan-axonometric": { key: "axonometric", label: "3D平面图", suggestedMode: "plan-render", confidence: 0.92, reason: "由 3D 平面图生成结果传递而来" },
    "plan-render": { key: "render", label: "人视角效果图", suggestedMode: "photo", confidence: 0.8, reason: "由最终效果图结果传递而来" }
  };
  return map[normalizedMode] || { key: "generated-output", label: "生成结果", suggestedMode: normalizedMode, confidence: 0.7, reason: "由画布输出图传递而来" };
}

async function handlePrimaryUpload(file) {
  if (!file) return;
  const lowerName = file.name.toLowerCase();

  if (state.mode === "cadrender" && lowerName.endsWith(".dwg")) {
    toast("浏览器端暂不直接解析 DWG，请先导出 DXF / SVG / PNG");
    return;
  }

  if (state.mode === "cadrender" && lowerName.endsWith(".dxf")) {
    const text = await file.text();
    const converted = dxfTextToImageDataUrl(text);
    state.primaryImageAnalysis = imageAnalysisResult({ key: "cad-screenshot", label: "CAD / DXF 图纸", suggestedMode: "cadrender", confidence: 0.95 }, {}, "DXF 文件已转换为可视化图纸");
    state.primaryImage = { name: file.name, type: "image/png", dataUrl: converted.dataUrl, sourceType: "dxf", lineCount: converted.lineCount, inputAnalysis: state.primaryImageAnalysis };
    state.primaryBitmap = await loadImage(converted.dataUrl);
    state.selection = null;
    setInputAdviceThinking(state.primaryImageAnalysis);
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();
    toast(`已解析 DXF：${converted.lineCount} 条线段`);
    return;
  }

  if (state.mode === "cadrender" && lowerName.endsWith(".svg")) {
    const text = await file.text();
    const dataUrl = await svgTextToPngDataUrl(text);
    state.primaryImageAnalysis = imageAnalysisResult({ key: "cad-screenshot", label: "CAD / SVG 图纸", suggestedMode: "cadrender", confidence: 0.92 }, {}, "SVG 图纸已转换为可视化底图");
    state.primaryImage = { name: file.name, type: "image/png", dataUrl, sourceType: "svg", inputAnalysis: state.primaryImageAnalysis };
    state.primaryBitmap = await loadImage(dataUrl);
    state.selection = null;
    setInputAdviceThinking(state.primaryImageAnalysis);
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();
    toast("已载入 SVG CAD 底图");
    return;
  }

  const image = await fileToOptimizedImage(file, {
    maxEdge: IMAGE_UPLOAD_PRIMARY_MAX_EDGE,
    targetBytes: IMAGE_UPLOAD_PRIMARY_TARGET_BYTES,
    cacheLabel: `primary-${file.name}`
  });
  state.primaryBitmap = image.bitmap;
  state.primaryImageAnalysis = classifyUploadedImage(state.primaryBitmap, file);
  state.primaryImage = {
    name: file.name,
    type: image.type || file.type,
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    sourceType: state.primaryImageAnalysis.key,
    inputAnalysis: state.primaryImageAnalysis
  };
  state.selection = null;
  setInputAdviceThinking(state.primaryImageAnalysis);
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  if (shouldWarnInputModeMismatch(state.primaryImageAnalysis)) {
    toast(`当前图片更像${state.primaryImageAnalysis.label}，建议使用“${suggestedModeLabel(state.primaryImageAnalysis.suggestedMode)}”。`);
  } else {
    toast(`已识别为：${state.primaryImageAnalysis.label}`);
  }
}

async function handleReferenceUpload(files) {
  const incoming = Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));
  const remainingSlots = Math.max(0, referenceImageLimit - state.referenceImages.length);
  if (!incoming.length) {
    toast("请选择图片作为参考图");
    return;
  }
  if (!remainingSlots) {
    toast(`参考图最多上传 ${referenceImageLimit} 张`);
    return;
  }

  const selected = incoming.slice(0, remainingSlots);
  const startIndex = state.referenceImages.length;
  state.designSeriesAnalysis = null;
  const nextImages = await Promise.all(selected.map(async (file) => {
    const optimized = await fileToOptimizedImage(file, {
      maxEdge: IMAGE_UPLOAD_REFERENCE_MAX_EDGE,
      targetBytes: IMAGE_UPLOAD_REFERENCE_TARGET_BYTES,
      cacheLabel: `reference-${file.name}`
    });
    return {
      name: file.name,
      type: optimized.type || file.type,
      dataUrl: optimized.dataUrl,
      width: optimized.width,
      height: optimized.height,
      weight: "default",
      usage: "auto"
    };
  }));
  state.referenceImages = [...state.referenceImages, ...nextImages].slice(0, referenceImageLimit);
  refreshGenerationControls();
  renderReferenceStrip();
  renderWorkflowCanvas();
  toast(incoming.length > selected.length
    ? `已添加 ${selected.length} 张，参考图最多 ${referenceImageLimit} 张`
    : `已添加 ${selected.length} 张参考图`);
  if (state.mode === "designseries" && state.referenceImages.length) {
    analyzeDesignSeriesReferences();
  }
}

function renderReferenceStrip() {
  els.referenceStrip.innerHTML = state.referenceImages
    .map((image, index) => {
      const weight = image.weight || "default";
      const usage = image.usage || "auto";
      return `
      <div class="reference-card ${weight === "ignore" ? "is-muted" : ""}">
        <button class="reference-remove" type="button" data-remove-reference="${index}" title="移除参考图" aria-label="移除参考图">
          <svg><use href="#icon-trash"></use></svg>
        </button>
        <img src="${escapeAttr(image.dataUrl)}" alt="${escapeAttr(image.name)}" title="${escapeAttr(image.name)}" />
        <span class="reference-free-label">参考图 ${index + 1}</span>
        <select class="reference-weight-select" data-reference-weight="${index}" aria-label="参考图 ${index + 1} 权重">
          ${referenceWeightOptions.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === weight ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
        <select class="reference-usage-select" data-reference-usage="${index}" aria-label="参考图 ${index + 1} 使用意图">
          ${referenceUsageOptions.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === usage ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </div>
    `;
    })
    .join("");
  els.referenceStrip.querySelectorAll("[data-remove-reference]").forEach((button) => {
    button.addEventListener("click", () => {
      removeReferenceImage(button.dataset.removeReference);
    });
  });
  els.referenceStrip.querySelectorAll("[data-reference-weight]").forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.referenceWeight);
      if (!state.referenceImages[index]) return;
      state.referenceImages[index].weight = select.value || "default";
      state.designSeriesAnalysis = null;
      refreshGenerationControls();
      renderReferenceStrip();
      renderWorkflowCanvas();
      toast("已更新参考图权重");
    });
  });
  els.referenceStrip.querySelectorAll("[data-reference-usage]").forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.referenceUsage);
      if (!state.referenceImages[index]) return;
      state.referenceImages[index].usage = select.value || "auto";
      state.designSeriesAnalysis = null;
      renderWorkflowCanvas();
      toast("已更新参考图使用意图");
    });
  });
}

function drawSelectionCanvas() {
  const canvas = els.selectionCanvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(220, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f1f1f1";
  ctx.fillRect(0, 0, width, height);

  if (!state.primaryBitmap) {
    els.emptyCanvasHint.hidden = false;
    els.emptyCanvasHint.textContent = normalizeClientMode(state.mode) === "plan-render"
      ? "上传3D平面图后，请框选要生成效果图的区域"
      : "上传图片后可拖拽框选局部区域";
    return;
  }

  const showRegionHint = normalizeClientMode(state.mode) === "plan-render" && !state.selection;
  els.emptyCanvasHint.hidden = !showRegionHint;
  if (showRegionHint) {
    els.emptyCanvasHint.textContent = "建议框选要生成效果图的区域；不框选则自动选择与参考图最接近的区域";
  }
  const image = state.primaryBitmap;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  state.canvasImageBox = { dx, dy, drawWidth, drawHeight, width, height };
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);

  if (state.selection) {
    const x = dx + state.selection.x * drawWidth;
    const y = dy + state.selection.y * drawHeight;
    const w = state.selection.width * drawWidth;
    const h = state.selection.height * drawHeight;
    ctx.fillStyle = "rgba(212, 175, 55, 0.16)";
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 2 * dpr;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
}

function scheduleSelectionCanvasDraw() {
  if (selectionCanvasFrame) return;
  selectionCanvasFrame = requestAnimationFrame(() => {
    selectionCanvasFrame = 0;
    drawSelectionCanvas();
  });
}

function canvasPoint(event) {
  const rect = els.selectionCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (event.clientX - rect.left) * dpr,
    y: (event.clientY - rect.top) * dpr
  };
}

function updateSelection(from, to) {
  const box = state.canvasImageBox;
  if (!box) return;
  const x1 = clamp(Math.min(from.x, to.x), box.dx, box.dx + box.drawWidth);
  const y1 = clamp(Math.min(from.y, to.y), box.dy, box.dy + box.drawHeight);
  const x2 = clamp(Math.max(from.x, to.x), box.dx, box.dx + box.drawWidth);
  const y2 = clamp(Math.max(from.y, to.y), box.dy, box.dy + box.drawHeight);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < 8 || height < 8) {
    state.selection = null;
  } else {
    state.selection = {
      x: round4((x1 - box.dx) / box.drawWidth),
      y: round4((y1 - box.dy) / box.drawHeight),
      width: round4(width / box.drawWidth),
      height: round4(height / box.drawHeight)
    };
  }
  scheduleSelectionCanvasDraw();
  scheduleWorkflowCanvasRender();
}

function renderGeneratedResult() {
  if (!state.render?.url) {
    els.renderResult.hidden = true;
    els.renderResultImage.removeAttribute("src");
    els.renderResultLink.href = "#";
    els.continueEditButton.disabled = true;
    refreshGenerationControls();
    return;
  }
  els.renderResult.hidden = false;
  els.continueEditButton.disabled = false;
  els.renderResultTitle.textContent = state.render.title || modeConfig(state.mode).resultTitle || `${modeConfig(state.mode).sourceTitle}生成结果`;
  els.renderResultImage.src = state.render.url;
  els.renderResultLink.href = state.render.url;
  refreshGenerationControls();
  renderWorkflowCanvas();
}

function extractCadFromBitmap(image, projectName) {
  const maxDim = 1200;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const dark = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      dark[y * width + x] = luma < 150 && pixels[i + 3] > 20 ? 1 : 0;
    }
  }

  const minRun = Math.max(32, Math.round(Math.min(width, height) * 0.055));
  const horizontal = findRuns(dark, width, height, "h", minRun);
  const vertical = findRuns(dark, width, height, "v", minRun);
  const lines = mergeLines([...horizontal, ...vertical], 6).slice(0, 1400);
  if (!lines.length) throw new Error("没有识别到足够清晰的图纸线段");

  const svg = buildCadSvg(lines, width, height);
  const dxf = buildDxf(lines, width, height);
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const dxfUrl = URL.createObjectURL(new Blob([dxf], { type: "application/dxf" }));
  const id = `cad-${Date.now()}`;
  return {
    id,
    title: "平面图 CAD",
    svg,
    svgUrl,
    dxfUrl,
    lineCount: lines.length,
    width,
    height,
    fileBase: slugForFile(projectName || "plan"),
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  };
}

function localSharpenImage(image, name) {
  const maxDim = 1800;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(image, 0, 0, width, height);
  const src = srcCtx.getImageData(0, 0, width, height);
  const out = srcCtx.createImageData(width, height);
  const kernel = [0, -1, 0, -1, 5.25, -1, 0, -1, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = clamp(x + kx, 0, width - 1);
            const py = clamp(y + ky, 0, height - 1);
            const srcIdx = (py * width + px) * 4 + c;
            const k = kernel[(ky + 1) * 3 + (kx + 1)];
            sum += src.data[srcIdx] * k;
          }
        }
        out.data[(y * width + x) * 4 + c] = clamp(Math.round(sum), 0, 255);
      }
      out.data[(y * width + x) * 4 + 3] = src.data[(y * width + x) * 4 + 3];
    }
  }
  srcCtx.putImageData(out, 0, 0);
  const url = srcCanvas.toDataURL("image/png");
  return {
    id: `sharpen-${Date.now()}`,
    title: "锐化结果",
    url,
    mode: "sharpen",
    intent: "本地锐化与局部对比增强",
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    fileBase: slugForFile(name || "sharpened")
  };
}

function localEnhanceQualityImage(image, name) {
  const maxDim = 2400;
  const upscale = Math.min(1.45, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const scale = Math.max(1, upscale);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  const src = ctx.getImageData(0, 0, width, height);
  const data = src.data;
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue;
    histR[data[i]] += 1;
    histG[data[i + 1]] += 1;
    histB[data[i + 2]] += 1;
    meanR += data[i];
    meanG += data[i + 1];
    meanB += data[i + 2];
    count += 1;
  }

  if (!count) throw new Error("图片像素为空，无法增强");
  meanR /= count;
  meanG /= count;
  meanB /= count;
  const grayMean = (meanR + meanG + meanB) / 3;
  const whiteBalance = [
    clamp(grayMean / Math.max(1, meanR), 0.82, 1.18),
    clamp(grayMean / Math.max(1, meanG), 0.82, 1.18),
    clamp(grayMean / Math.max(1, meanB), 0.82, 1.18)
  ];
  const levels = [
    [histPercentile(histR, count, 0.01), histPercentile(histR, count, 0.99)],
    [histPercentile(histG, count, 0.01), histPercentile(histG, count, 0.99)],
    [histPercentile(histB, count, 0.01), histPercentile(histB, count, 0.99)]
  ].map(([low, high]) => high - low < 24 ? [Math.max(0, low - 8), Math.min(255, high + 8)] : [low, high]);

  const corrected = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    let r = stretchChannel(data[i] * whiteBalance[0], levels[0][0], levels[0][1]);
    let g = stretchChannel(data[i + 1] * whiteBalance[1], levels[1][0], levels[1][1]);
    let b = stretchChannel(data[i + 2] * whiteBalance[2], levels[2][0], levels[2][1]);
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    r = luma + (r - luma) * 1.07;
    g = luma + (g - luma) * 1.07;
    b = luma + (b - luma) * 1.07;
    r = (r - 128) * 1.05 + 128;
    g = (g - 128) * 1.05 + 128;
    b = (b - 128) * 1.05 + 128;
    corrected[i] = clampByte(r);
    corrected[i + 1] = clampByte(g);
    corrected[i + 2] = clampByte(b);
    corrected[i + 3] = data[i + 3];
  }

  const denoised = smoothImageData(corrected, width, height, 0.18);
  const sharpened = unsharpImageData(denoised, width, height, 0.58);
  src.data.set(sharpened);
  ctx.putImageData(src, 0, 0);

  return {
    id: `enhance-${Date.now()}`,
    title: "画质增强结果",
    url: canvas.toDataURL("image/png"),
    mode: "upscale",
    intent: "本地算法增强：自动色阶、白平衡、轻度降噪、局部对比、锐化、轻量放大",
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    fileBase: slugForFile(name || "enhanced")
  };
}

function histPercentile(hist, total, percentile) {
  const target = Math.max(1, Math.round(total * percentile));
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

function stretchChannel(value, low, high) {
  return ((value - low) / Math.max(1, high - low)) * 255;
}

function smoothImageData(data, width, height, amount) {
  const out = new Uint8ClampedArray(data.length);
  const neighborWeight = amount / 8;
  const centerWeight = 1 - amount;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let value = data[idx + c] * centerWeight;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            if (kx === 0 && ky === 0) continue;
            const px = clamp(x + kx, 0, width - 1);
            const py = clamp(y + ky, 0, height - 1);
            value += data[(py * width + px) * 4 + c] * neighborWeight;
          }
        }
        out[idx + c] = clampByte(value);
      }
      out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

function unsharpImageData(data, width, height, amount) {
  const blur = smoothImageData(data, width, height, 0.55);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = clampByte(data[i] + (data[i] - blur[i]) * amount);
    out[i + 1] = clampByte(data[i + 1] + (data[i + 1] - blur[i + 1]) * amount);
    out[i + 2] = clampByte(data[i + 2] + (data[i + 2] - blur[i + 2]) * amount);
    out[i + 3] = data[i + 3];
  }
  return out;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function dxfTextToImageDataUrl(text) {
  const lines = parseDxfLines(text);
  if (!lines.length) throw new Error("DXF 中没有识别到 LINE 线段");
  const bounds = lineBounds(lines);
  const pad = 40;
  const width = 1200;
  const height = 900;
  const sx = (width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX);
  const sy = (height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(sx, sy);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#151a1c";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const line of lines) {
    const x1 = pad + (line.x1 - bounds.minX) * scale;
    const y1 = height - pad - (line.y1 - bounds.minY) * scale;
    const x2 = pad + (line.x2 - bounds.minX) * scale;
    const y2 = height - pad - (line.y2 - bounds.minY) * scale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  return { dataUrl: canvas.toDataURL("image/png"), lineCount: lines.length };
}

function parseDxfLines(text) {
  const raw = text.split(/\r?\n/).map((line) => line.trim());
  const pairs = [];
  for (let i = 0; i < raw.length - 1; i += 2) pairs.push([raw[i], raw[i + 1]]);
  const lines = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] !== "0" || pairs[i][1].toUpperCase() !== "LINE") continue;
    const values = {};
    for (let j = i + 1; j < pairs.length && pairs[j][0] !== "0"; j++) {
      values[pairs[j][0]] = Number(pairs[j][1]);
    }
    if ([values["10"], values["20"], values["11"], values["21"]].every(Number.isFinite)) {
      lines.push({ x1: values["10"], y1: values["20"], x2: values["11"], y2: values["21"] });
    }
  }
  return lines.slice(0, 3000);
}

function lineBounds(lines) {
  const xs = lines.flatMap((line) => [line.x1, line.x2]);
  const ys = lines.flatMap((line) => [line.y1, line.y2]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

async function svgTextToPngDataUrl(text) {
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(1600, image.naturalWidth || 1200);
  canvas.height = Math.min(1200, image.naturalHeight || 900);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function findRuns(dark, width, height, orientation, minRun) {
  const lines = [];
  const outer = orientation === "h" ? height : width;
  const inner = orientation === "h" ? width : height;
  for (let o = 0; o < outer; o++) {
    let start = -1;
    let misses = 0;
    for (let i = 0; i < inner; i++) {
      const x = orientation === "h" ? i : o;
      const y = orientation === "h" ? o : i;
      const isDark = dark[y * width + x] === 1;
      if (isDark && start < 0) {
        start = i;
        misses = 0;
      } else if (!isDark && start >= 0) {
        misses += 1;
        if (misses > 2) {
          const end = i - misses;
          if (end - start >= minRun) {
            lines.push(orientation === "h"
              ? { x1: start, y1: o, x2: end, y2: o }
              : { x1: o, y1: start, x2: o, y2: end });
          }
          start = -1;
          misses = 0;
        }
      } else if (isDark) {
        misses = 0;
      }
    }
    if (start >= 0 && inner - start >= minRun) {
      lines.push(orientation === "h"
        ? { x1: start, y1: o, x2: inner - 1, y2: o }
        : { x1: o, y1: start, x2: o, y2: inner - 1 });
    }
  }
  return lines;
}

function mergeLines(lines, tolerance) {
  const sorted = lines
    .map((line) => normalizeLine(line))
    .sort((a, b) => (a.orientation === b.orientation ? a.axis - b.axis || a.start - b.start : a.orientation.localeCompare(b.orientation)));
  const merged = [];
  for (const line of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.orientation === line.orientation &&
      Math.abs(last.axis - line.axis) <= tolerance &&
      line.start <= last.end + tolerance
    ) {
      last.axis = Math.round((last.axis + line.axis) / 2);
      last.end = Math.max(last.end, line.end);
      continue;
    }
    merged.push({ ...line });
  }
  return merged.map((line) => line.orientation === "h"
    ? { x1: line.start, y1: line.axis, x2: line.end, y2: line.axis }
    : { x1: line.axis, y1: line.start, x2: line.axis, y2: line.end });
}

function normalizeLine(line) {
  const horizontal = Math.abs(line.y2 - line.y1) <= Math.abs(line.x2 - line.x1);
  return horizontal
    ? { orientation: "h", axis: Math.round((line.y1 + line.y2) / 2), start: Math.min(line.x1, line.x2), end: Math.max(line.x1, line.x2) }
    : { orientation: "v", axis: Math.round((line.x1 + line.x2) / 2), start: Math.min(line.y1, line.y2), end: Math.max(line.y1, line.y2) };
}

function buildCadSvg(lines, width, height) {
  const body = lines.map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" />`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#101820"/><g stroke="#f8faf7" stroke-width="1.4" stroke-linecap="round">${body}</g></svg>`;
}

function buildDxf(lines, width, height) {
  const header = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  const entities = [];
  for (const line of lines) {
    entities.push(
      "0", "LINE", "8", "WALL_LINES",
      "10", String(line.x1), "20", String(height - line.y1), "30", "0",
      "11", String(line.x2), "21", String(height - line.y2), "31", "0"
    );
  }
  return [...header, ...entities, "0", "ENDSEC", "0", "EOF"].join("\n");
}

function slugForFile(value) {
  return String(value || "plan").trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "plan";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function localImageUrlToDataUrl(url, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取最新效果图");
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    name,
    type: blob.type || "image/png",
    dataUrl
  };
}

async function copyText(text) {
  if (!text) {
    toast("没有可复制的内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制提示词");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("已复制提示词");
  }
}

function rerunFromLog(log) {
  const prompt = log.input?.userPrompt || log.input?.intent || log.result?.sourcePrompt || log.result?.prompt || "";
  if (prompt && els.canvasCommand) {
    els.canvasCommand.value = prompt;
    state.canvasCommandUserEdited = true;
  }
  if (log.input?.mode && workflowButtonMeanings[log.input.mode]) setMode(log.input.mode);
  toast("已恢复日志指令，将使用当前上传图和参考图复跑");
  runPrimaryAction({ busyButton: els.canvasGenerateButton });
}

function continueFromLogOutput(log, nextMode) {
  if (!log.result?.outputUrl) {
    toast("这条日志没有可继续的输出图");
    return;
  }
  continuePlanWorkflowFromOutput({
    id: `log-${log.id}`,
    nodeId: "",
    url: log.result.outputUrl,
    title: log.result.title || taskTypeLabel(log.type),
    mode: normalizeClientMode(log.input?.stepMode || log.input?.mode || "plan-axonometric"),
    prompt: log.result.prompt || "",
    intent: log.input?.intent || "",
    workflowId: log.input?.workflowId || "",
    render: {
      url: log.result.outputUrl,
      prompt: log.result.prompt || "",
      sourcePrompt: log.result.sourcePrompt || ""
    }
  }, nextMode).catch((error) => toast(error.message));
}

function shortPath(value) {
  const text = String(value || "");
  if (text.length <= 38) return text;
  const parts = text.split("/");
  return parts.slice(-2).join("/");
}

function shortEndpoint(value) {
  return String(value || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function normalizeTheme(value) {
  return value === "day" ? "day" : "night";
}

function applyTheme(theme) {
  state.theme = normalizeTheme(theme);
  document.body.dataset.theme = state.theme;
  document.documentElement.dataset.theme = state.theme;
  try {
    localStorage.setItem("laogui-theme", state.theme);
  } catch {}
  renderThemeControls();
}

function loadThemePreference() {
  let stored = "";
  try {
    stored = localStorage.getItem("laogui-theme") || "";
  } catch {}
  applyTheme(normalizeTheme(stored || window.__LAOGUI_INITIAL_THEME__ || document.documentElement.dataset.theme || "night"));
}

function renderThemeControls() {
  els.themeButtons?.forEach((button) => {
    const active = normalizeTheme(button.dataset.themeChoice) === state.theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function isSettingsOpen() {
  return Boolean(els.appSettingsOverlay && !els.appSettingsOverlay.hidden);
}

function setSettingsButtonState(open) {
  [els.settingsButton, els.workspaceSettingsButton].forEach((button) => {
    button?.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function openSettings(trigger = document.activeElement) {
  if (!els.appSettingsOverlay) return;
  settingsReturnFocus = isFocusableTarget(trigger) ? trigger : els.workspaceSettingsButton || els.settingsButton;
  els.appSettingsOverlay.hidden = false;
  els.appSettingsOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("settings-open");
  setSettingsButtonState(true);
  renderStorageAccess();
  refreshStorageSummary({ silent: true });
  refreshApiSettings({ silent: true }).then(() => {
    maybeAutoProbeImageEndpoints();
  });
  requestAnimationFrame(() => {
    if (!focusElement(els.appSettingsModal)) focusFirstControl(els.appSettingsOverlay);
  });
}

function closeSettings({ restoreFocus = true } = {}) {
  if (!isSettingsOpen()) return false;
  els.appSettingsOverlay.hidden = true;
  els.appSettingsOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("settings-open");
  setSettingsButtonState(false);
  const returnTarget = settingsReturnFocus;
  settingsReturnFocus = null;
  if (restoreFocus) focusElement(returnTarget);
  return true;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function downloadCurrentCanvasOutputs(button = null) {
  const items = getOutputItems();
  if (!items.length) {
    toast("暂无可下载的图片");
    return;
  }
  setBusy(button, true, "下载中");
  try {
    for (const [index, item] of items.entries()) {
      await downloadOutputItem(item, index);
      if (index < items.length - 1) await sleep(220);
    }
    toast(`已开始下载 ${items.length} 张图片`);
  } finally {
    setBusy(button, false);
  }
}

async function downloadOutputItem(item, index = -1) {
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`无法读取图片：${item.title}`);
  const blob = await response.blob();
  downloadBlob(blob, outputDownloadFileName(item, index, blob));
}

function outputDownloadFileName(item, index = -1, blob = null) {
  const prefix = index >= 0 ? `${String(index + 1).padStart(2, "0")}-` : "";
  return `${prefix}${slugForFile(item.title || item.id || "output")}.${outputFileExtension(item, blob)}`;
}

function outputFileExtension(item, blob = null) {
  const urlExtension = outputUrlExtension(item?.url);
  if (urlExtension) return urlExtension;
  const type = String(blob?.type || "").split(";")[0].toLowerCase();
  const typeMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  return typeMap[type] || "png";
}

function outputUrlExtension(url) {
  try {
    const match = new URL(url, window.location.href).pathname.match(/\.([a-z0-9]{2,5})$/i);
    const extension = match?.[1]?.toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return extension === "jpeg" ? "jpg" : extension;
  } catch {}
  return "";
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function setBusy(button, busy, label = "处理中") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
    if (!button.dataset.originalTitle) button.dataset.originalTitle = button.title || button.getAttribute("aria-label") || button.textContent.trim();
    button.disabled = true;
    if (button.classList.contains("icon-only")) {
      button.innerHTML = `<span class="icon-busy-dot" aria-hidden="true"></span>`;
      button.title = label;
      button.setAttribute("aria-label", label);
    } else {
      button.textContent = label;
    }
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
    if (button.id === "renderButton") {
      button.innerHTML = button.classList.contains("icon-only")
        ? primaryActionIconButtonHtml(state.mode)
        : primaryActionButtonHtml(state.mode);
      button.title = primaryActionLabel(state.mode);
      button.setAttribute("aria-label", primaryActionLabel(state.mode));
    } else {
      const title = button.dataset.originalTitle || button.dataset.originalText;
      if (title) {
        button.title = title;
        button.setAttribute("aria-label", title);
      }
    }
    delete button.dataset.originalText;
    delete button.dataset.originalTitle;
  }
}

function toast(message) {
  if (!els.toast) return;
  const text = String(message ?? "");
  const token = (toast.token = (toast.token || 0) + 1);
  els.toast.setAttribute("aria-live", "polite");
  els.toast.setAttribute("aria-atomic", "true");
  if (els.toast.textContent === text) {
    els.toast.textContent = "";
    requestAnimationFrame(() => {
      if (toast.token === token) els.toast.textContent = text;
    });
  } else {
    els.toast.textContent = text;
  }
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3600);
}

function targetElement(target) {
  return target instanceof Element ? target : target?.parentElement || null;
}

function closeTransientDetails(target) {
  const element = targetElement(target);
  if (!element) return false;
  const selectors = [
    ".mode-switcher",
    "#imageOptionsPanel",
    ".canvas-image-toolbar-modes",
    ".canvas-floating-quick",
    ".agent-drawer",
    ".task-progress-prompt",
    ".direction-risks"
  ];
  let closed = false;
  document.querySelectorAll(selectors.map((selector) => `${selector}[open]`).join(",")).forEach((details) => {
    if (!details.contains(element)) {
      details.removeAttribute("open");
      closed = true;
    }
  });
  return closed;
}

function closeWorkspaceFloatingPanels(target) {
  const element = targetElement(target);
  if (!element) return;
  let changed = false;
  if (
    state.historyPanelOpen &&
    !els.workspaceHistoryPanel?.contains(element) &&
    !els.workspaceHistoryButton?.contains(element)
  ) {
    state.historyPanelOpen = false;
    changed = true;
  }
  if (
    state.statusPanelOpen &&
    !els.workspaceStatusPanel?.contains(element) &&
    !els.workspaceStatusButton?.contains(element)
  ) {
    state.statusPanelOpen = false;
    changed = true;
  }
  if (changed) {
    renderWorkspaceHistoryPanel();
    renderWorkspaceStatusPanel();
  }
}

function closeCanvasImageToolbarFromOutside(target) {
  const element = targetElement(target);
  if (!element || !state.canvas.selectedImage) return;
  if (element.closest("#canvasImageToolbar") || element.closest("#deepEditOverlay") || element.closest("[data-preview-url]")) return;
  state.canvas.selectedImage = null;
  renderCanvasImageToolbar();
  renderWorkflowCanvas();
}

function closeTransientUiFromOutside(event) {
  const element = targetElement(event.target);
  if (!element) return;
  if (state.canvas.panelDropDrag || state.canvas.nodeDrag) return;
  closeTransientDetails(element);
  closeWorkspaceFloatingPanels(element);
  closeCanvasImageToolbarFromOutside(element);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

els.planButton?.addEventListener("click", createPlan);
els.homeButton.addEventListener("click", showHome);
els.workspaceHomeButton.addEventListener("click", showHome);
els.workspaceHistoryButton?.addEventListener("click", () => {
  state.historyPanelOpen = !state.historyPanelOpen;
  if (state.historyPanelOpen) state.statusPanelOpen = false;
  renderWorkspaceHistoryPanel();
  renderWorkspaceStatusPanel();
  if (state.historyPanelOpen) {
    refreshTaskLogs({ silent: true });
    focusPanel(els.workspaceHistoryPanel);
  }
});
els.workspaceHistoryRefreshButton?.addEventListener("click", () => refreshTaskLogs());
els.workspaceHistoryCloseButton?.addEventListener("click", () => {
  state.historyPanelOpen = false;
  renderWorkspaceHistoryPanel();
  focusElement(els.workspaceHistoryButton);
});
els.workspaceStatusButton?.addEventListener("click", () => {
  state.statusPanelOpen = !state.statusPanelOpen;
  if (state.statusPanelOpen) state.historyPanelOpen = false;
  renderWorkspaceStatusPanel();
  renderWorkspaceHistoryPanel();
  if (state.statusPanelOpen) focusPanel(els.workspaceStatusPanel);
});
els.workspaceStatusCloseButton?.addEventListener("click", () => {
  state.statusPanelOpen = false;
  renderWorkspaceStatusPanel();
  focusElement(els.workspaceStatusButton);
});
els.settingsButton?.addEventListener("click", () => openSettings(els.settingsButton));
els.workspaceSettingsButton?.addEventListener("click", () => openSettings(els.workspaceSettingsButton));
els.settingsCloseButton?.addEventListener("click", () => closeSettings());
els.appSettingsOverlay?.addEventListener("click", (event) => {
  if (event.target.closest("[data-settings-close]")) closeSettings();
});
els.canvasList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-canvas-id]");
  if (!button) return;
  switchCanvas(button.dataset.canvasId).catch((error) => toast(error.message));
});
els.canvasList?.addEventListener("dblclick", (event) => {
  const button = event.target.closest("[data-canvas-id]");
  if (!button) return;
  const id = button.dataset.canvasId;
  const renameAfterSwitch = () => promptRenameCanvas(id);
  if (id === state.activeCanvasId) {
    renameAfterSwitch();
    return;
  }
  switchCanvas(id).then(renameAfterSwitch).catch((error) => toast(error.message));
});
els.canvasList?.addEventListener("keydown", handleCanvasListKeydown);
els.newCanvasButton?.addEventListener("click", () => {
  createNewCanvas().catch((error) => toast(error.message));
});
els.renameCanvasButton?.addEventListener("click", () => promptRenameCanvas());
els.deleteCanvasButton?.addEventListener("click", () => {
  deleteActiveCanvas().catch((error) => toast(error.message));
});
els.toggleAgentPanelButton?.addEventListener("click", () => toggleAgentPanel());
els.agentPanelRailButton?.addEventListener("click", () => toggleAgentPanel(false));
els.canvasFloatingExpandButton?.addEventListener("click", () => toggleAgentPanel(false));
els.canvasFloatingCollapseButton?.addEventListener("click", () => applyCanvasFloatingCollapsed(true));
els.canvasFloatingRestoreButton?.addEventListener("click", () => applyCanvasFloatingCollapsed(false));
els.startButtons.forEach((button) => button.addEventListener("click", () => {
  showWorkspace(button.dataset.startMode).catch((error) => toast(error.message));
}));
els.renderButton.addEventListener("click", () => runPrimaryAction());
els.canvasGenerateButton.addEventListener("click", () => runPrimaryAction({ busyButton: els.canvasGenerateButton }));
els.floatingGenerateButton?.addEventListener("click", () => runPrimaryAction({ busyButton: els.floatingGenerateButton }));
els.thinkingModeButton?.addEventListener("click", toggleThinkingMode);
els.floatingThinkingModeButton?.addEventListener("click", toggleThinkingMode);
els.continueEditButton.addEventListener("click", continueEditFromLatest);
els.floatingContinueEditButton?.addEventListener("click", continueEditFromLatest);
els.modeTabs.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
  button.addEventListener("keydown", handleModeTabKeydown);
});
els.floatingModeSelect?.addEventListener("change", () => setMode(els.floatingModeSelect.value));
els.presetButtons.forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
els.stylePresetButtons.forEach((button) => button.addEventListener("click", () => applyStylePreset(button.dataset.stylePreset)));
els.themeButtons.forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.themeChoice)));
els.refreshApiSettingsButton?.addEventListener("click", () => refreshApiSettings());
els.refreshStorageButton?.addEventListener("click", () => refreshStorageSummary());
els.cleanupTestGeneratedButton?.addEventListener("click", () => runStorageMaintenance("cleanup-test-generated", {}, els.cleanupTestGeneratedButton));
els.archiveGeneratedButton?.addEventListener("click", () => runStorageMaintenance("archive-generated", { olderThanDays: 30 }, els.archiveGeneratedButton));
els.pruneLogsButton?.addEventListener("click", () => runStorageMaintenance("prune-task-logs", { keepDays: 30 }, els.pruneLogsButton));
els.saveImageApiEndpointButton?.addEventListener("click", saveImageApiEndpoint);
els.probeImageApiEndpointButton?.addEventListener("click", () => probeImageApiEndpoints());
els.imageApiEndpointList?.addEventListener("click", (event) => {
  const probeButton = event.target.closest("[data-api-endpoint-probe]");
  const activateButton = event.target.closest("[data-api-endpoint-activate]");
  const deleteButton = event.target.closest("[data-api-endpoint-delete]");
  if (probeButton) probeImageApiEndpoint(probeButton.dataset.apiEndpointProbe);
  if (activateButton) activateImageApiEndpoint(activateButton.dataset.apiEndpointActivate);
  if (deleteButton) deleteImageApiEndpoint(deleteButton.dataset.apiEndpointDelete);
});
els.aspectRatioButtons.forEach((button) => button.addEventListener("click", () => {
  setGenerationAspect(button.dataset.aspectRatio || "source");
}));
els.aspectRatioSelect?.addEventListener("change", () => {
  setGenerationAspect(els.aspectRatioSelect.value || "source");
});
els.floatingAspectRatioSelect?.addEventListener("change", () => setGenerationAspect(els.floatingAspectRatioSelect.value || "source"));
els.qualityTierButtons.forEach((button) => button.addEventListener("click", () => {
  setGenerationQuality(button.dataset.qualityTier || "1k");
}));
els.floatingQualitySelect?.addEventListener("change", () => setGenerationQuality(els.floatingQualitySelect.value || "1k"));
els.imageCountButtons.forEach((button) => button.addEventListener("click", () => {
  setGenerationCount(button.dataset.imageCount);
}));
els.floatingImageCountSelect?.addEventListener("change", () => setGenerationCount(els.floatingImageCountSelect.value));
els.quickIterationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyQuickIteration(button.dataset.quickIteration, button).catch((error) => toast(error.message));
  });
});
els.floatingQuickIterationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyQuickIteration(button.dataset.floatingQuickIteration, button).catch((error) => toast(error.message));
  });
});
els.floatingPrimaryUploadButton?.addEventListener("click", () => els.primaryImageInput?.click());
els.floatingReferenceUploadButton?.addEventListener("click", () => els.referenceImageInput?.click());
els.floatingCanvasCommand?.addEventListener("input", () => setCanvasCommandFromFloating(els.floatingCanvasCommand.value));
els.canvasFloatingComposer?.addEventListener("pointerdown", (event) => event.stopPropagation());
els.canvasFloatingComposer?.addEventListener("click", (event) => event.stopPropagation());
els.canvasFloatingComposer?.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
els.primaryImageInput.addEventListener("change", (event) => handlePrimaryUpload(event.target.files?.[0]));
els.removePrimaryImageButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  removePrimaryImage();
});
els.referenceImageInput.addEventListener("change", (event) => {
  handleReferenceUpload(event.target.files)
    .catch((error) => toast(error.message))
    .finally(() => {
      event.target.value = "";
    });
});
document.addEventListener("pointerdown", closeTransientUiFromOutside);
els.selectionCanvas.addEventListener("pointerdown", (event) => {
  if (!state.primaryBitmap) return;
  state.dragStart = canvasPoint(event);
  els.selectionCanvas.setPointerCapture(event.pointerId);
});
els.selectionCanvas.addEventListener("pointermove", (event) => {
  if (!state.dragStart) return;
  updateSelection(state.dragStart, canvasPoint(event));
});
els.selectionCanvas.addEventListener("pointerup", (event) => {
  if (!state.dragStart) return;
  updateSelection(state.dragStart, canvasPoint(event));
  state.dragStart = null;
});
els.infiniteCanvas.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".workflow-node, .canvas-floating-composer, .canvas-minimap")) return;
  event.preventDefault();
  if (state.canvas.selectedImage) {
    state.canvas.selectedImage = null;
    renderCanvasImageToolbar();
  }
  state.canvas.panning = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: state.canvas.x,
    originY: state.canvas.y
  };
  els.infiniteCanvas.classList.add("is-panning");
  els.infiniteCanvas.setPointerCapture(event.pointerId);
});
els.infiniteCanvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomCanvasByWheel(event);
}, { passive: false });
els.infiniteCanvas.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
els.infiniteCanvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const resourceId = event.dataTransfer.getData("text/plain");
  const point = clientPointToCanvas(event.clientX, event.clientY);
  addResourceToCanvas(resourceId, { x: point.x, y: point.y, w: 320 });
});
window.addEventListener("pointermove", (event) => {
  if (state.canvas.panelDropDrag) {
    event.preventDefault();
    updateCanvasPanelDropDrag(event);
    return;
  }

  if (state.canvas.panning) {
    const pan = state.canvas.panning;
    state.canvas.x = pan.originX + event.clientX - pan.startX;
    state.canvas.y = pan.originY + event.clientY - pan.startY;
    applyCanvasTransform();
  }

  if (state.canvas.nodeDrag) {
    const drag = state.canvas.nodeDrag;
    const pos = getNodePosition(drag.nodeId);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    pos.x = drag.originX + dx / state.canvas.zoom;
    pos.y = drag.originY + dy / state.canvas.zoom;
    const nodeEl = els.canvasNodes.querySelector(`[data-node-id="${CSS.escape(drag.nodeId)}"]`);
    if (nodeEl) {
      nodeEl.style.left = `${pos.x}px`;
      nodeEl.style.top = `${pos.y}px`;
    }
    scheduleCanvasLinksRender();
  }
});
window.addEventListener("pointerup", (event) => {
  if (state.canvas.panelDropDrag) {
    finishCanvasPanelDropDrag(event).catch((error) => toast(error.message));
    return;
  }
  const drag = state.canvas.nodeDrag;
  state.canvas.panning = null;
  state.canvas.nodeDrag = null;
  els.infiniteCanvas.classList.remove("is-panning");
  if (drag?.preview && !drag.moved) {
    selectCanvasImage({
      id: drag.nodeId,
      ...drag.preview
    });
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (closeSettings()) return;
    if (state.deepEdit.open) {
      closeDeepEditOverlay();
      return;
    }
    if (isOverlayOpen("imageCompareOverlay")) {
      closeCompareOverlay();
      return;
    }
    if (isOverlayOpen("imagePreviewOverlay")) {
      closeImagePreview();
      return;
    }
    if (closeTransientDetails(document.body)) return;
    if (state.historyPanelOpen) {
      state.historyPanelOpen = false;
      renderWorkspaceHistoryPanel();
      focusElement(els.workspaceHistoryButton);
      return;
    }
    if (state.statusPanelOpen) {
      state.statusPanelOpen = false;
      renderWorkspaceStatusPanel();
      focusElement(els.workspaceStatusButton);
      return;
    }
    if (state.canvas.selectedImage) {
      state.canvas.selectedImage = null;
      renderCanvasImageToolbar();
      renderWorkflowCanvas();
    }
  }
});
els.canvasFitButton.addEventListener("click", resetCanvasView);
els.canvasFocusResultsButton?.addEventListener("click", focusCanvasToResults);
els.canvasMinimap?.addEventListener("click", () => focusCanvasToNodes());
els.zoomOutButton.addEventListener("click", () => zoomCanvas(1 - CANVAS_BUTTON_ZOOM_STEP));
els.zoomInButton.addEventListener("click", () => zoomCanvas(1 + CANVAS_BUTTON_ZOOM_STEP));
els.refreshTaskLogsButton?.addEventListener("click", () => refreshTaskLogs());
els.taskLogFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.taskLogFilter = button.dataset.taskLogFilter || "all";
    refreshTaskLogs({ silent: true });
  });
});
els.exportOutputsButton?.addEventListener("click", () => {
  downloadCurrentCanvasOutputs(els.exportOutputsButton).catch((error) => toast(error.message));
});
document.querySelectorAll("input, textarea, select").forEach((field) => {
  field.addEventListener("input", () => {
    if (field.type === "file") return;
    if (field === els.canvasCommand) {
      state.canvasCommandUserEdited = Boolean(field.value.trim());
      syncFloatingComposer();
    }
    if (!state.plan) {
      els.projectTitle.textContent = activeCanvasDisplayTitle();
    }
    scheduleWorkflowCanvasRender();
  });
  field.addEventListener("change", () => {
    if (field.type === "file") return;
    scheduleWorkflowCanvasRender();
  });
});
els.sampleButton?.addEventListener("click", () => {
  const current = readBrief().projectName;
  writeBrief(current === sampleBrief.projectName ? sampleAlt : sampleBrief);
});

state.clientId = getOrCreateClientId();
loadThemePreference();
const restoredPersistedCanvasState = await loadPersistedCanvasState();
syncDefaultCanvasCommand(state.mode);
applyAgentPanelCollapsed(false);
applyCanvasFloatingCollapsed(false);
refreshHealth();
refreshApiSettings({ silent: true });
refreshStorageSummary({ silent: true });
refreshTaskLogs({ silent: true });
refreshPresetSelection();
refreshGenerationControls();
renderTaskProgressPanel();
renderOutputManager();
if (!restoredPersistedCanvasState) {
  ensureCanvasCollection(state.mode);
  drawSelectionCanvas();
  renderWorkflowCanvas();
}
window.addEventListener("resize", () => {
  scheduleSelectionCanvasDraw();
  applyCanvasTransform();
});
