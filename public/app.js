import * as THREE from "./vendor/three.module.js";
import { GLTFExporter } from "./vendor/GLTFExporter.js";

const referenceImageLimit = 8;
const CANVAS_LAYOUT_VERSION = 16;
const CANVAS_WORKSPACE_WIDTH = 4200;
const CANVAS_WORKSPACE_HEIGHT = 3200;
const IMAGE_UPLOAD_PRIMARY_MAX_EDGE = 2400;
const IMAGE_UPLOAD_REFERENCE_MAX_EDGE = 1800;
const IMAGE_UPLOAD_VIEW_REFERENCE_MAX_EDGE = 2400;
const IMAGE_PERSISTENCE_MAX_EDGE = 1800;
const IMAGE_UPLOAD_PRIMARY_TARGET_BYTES = 2800 * 1024;
const IMAGE_UPLOAD_REFERENCE_TARGET_BYTES = 1500 * 1024;
const IMAGE_UPLOAD_VIEW_REFERENCE_TARGET_BYTES = 2800 * 1024;
const IMAGE_PERSISTENCE_TARGET_BYTES = 1600 * 1024;
const IMAGE_OPTIMIZE_THRESHOLD_BYTES = 900 * 1024;
const imageOptimizationCache = new Map();
const whiteModelViewers = new Map();
const panoramaViewers = new Map();
const IMAGE_CACHE_DB_NAME = "laogui-ai-image-cache";
const IMAGE_CACHE_DB_VERSION = 1;
const IMAGE_CACHE_THUMBNAIL_VERSION = 1;
const IMAGE_CACHE_THUMBNAIL_MAX_EDGE = 720;
const IMAGE_CACHE_THUMBNAIL_QUALITY = 0.9;
const PANORAMA_CANVAS_HINT = "拖拽查看全景 / 滚轮缩放";
const PANORAMA_PREVIEW_HINT = "拖拽查看 / 滚轮缩放";
const DEFAULT_THINKING_MODE_ENABLED = false;
const defaultColorGradeAdjustments = Object.freeze({
  light: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0
});
const colorGradeTabs = [
  { id: "light", label: "光线", icon: "icon-light" },
  { id: "color", label: "色彩", icon: "icon-filter" },
  { id: "detail", label: "质感", icon: "icon-detail" }
];
const colorGradeFields = {
  light: ["light", "exposure", "contrast", "highlights", "shadows", "whites", "blacks"],
  color: ["temperature", "tint", "vibrance", "saturation"],
  detail: ["clarity"]
};
const colorGradeFieldLabels = {
  light: "光线",
  exposure: "曝光",
  contrast: "对比度",
  highlights: "高光",
  shadows: "阴影",
  whites: "白色",
  blacks: "黑色",
  temperature: "色温",
  tint: "色调",
  vibrance: "自然饱和度",
  saturation: "饱和度",
  clarity: "清晰度"
};

const cropAspectOptions = [
  { value: "source", label: "原图" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" }
];

const state = {
  clientId: "",
  anonymousClientId: "",
  auth: {
    configured: false,
    authenticated: false,
    user: null,
    isAdmin: false,
    users: [],
    viewingClientId: ""
  },
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
  imageModelingAnalysis: null,
  imageModelingAnalysisConfirmed: false,
  referenceImages: [],
  assets: [],
  selection: null,
  dragStart: null,
  render: null,
  renders: [],
  imageToolResults: [],
  cadResult: null,
  cadResults: [],
  whiteModelResult: null,
  whiteModelResults: [],
  designSeriesAnalysis: null,
  designSeriesResults: [],
  activeTask: null,
  taskTimer: null,
  taskLogs: [],
  taskLogFilter: "all",
  projectLibraryFilter: "images",
  historyPanelOpen: false,
  statusPanelOpen: false,
  activeImageBaseUrl: "",
  runtimeProviders: { reasoning: null, image: null },
  storageSettings: null,
  imageStudioEngine: null,
  imageStudioFhlSkill: null,
  providerProbes: { reasoning: null, image: null },
  providerProbeBusy: { reasoning: false, image: false },
  imageApiProbeFeedback: null,
  canManageApiSettings: false,
  storagePromptShown: false,
  apiReady: false,
  theme: window.__LAOGUI_INITIAL_THEME__ || "day",
  canvasBackground: null,
  workspaceGlass: null,
  outputSearch: "",
  outputFavoritesOnly: false,
  favoriteOutputIds: new Set(),
  compareOutputIds: new Set(),
  thumbnailUrlCache: new Map(),
  selectedScenePreset: null,
  selectedProjectTemplate: null,
  selectedStylePreset: null,
  planPaperView: {
    yaw: 332,
    pitch: 56,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: null
  },
  viewControlOpen: false,
  multiAngleView: {
    mode: "subject",
    subjectX: 0,
    subjectY: 0,
    subjectRotate: -45,
    cameraX: -45,
    cameraY: 35,
    cameraDistance: 0,
    dragging: null
  },
  multiAnglePanel: {
    open: false,
    selectedImage: null,
    outputItem: null,
    sourceImage: null,
    busy: false
  },
  agentPanelCollapsed: false,
  canvasFloatingCollapsed: false,
  canvasListCollapsed: false,
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
    count: 1,
    customSize: ""
  },
  thinkingModeEnabled: DEFAULT_THINKING_MODE_ENABLED,
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
    zoom: 1,
    positions: {},
    selectedImage: null,
    imageActionBusy: "",
    branchAnchorNodeId: "",
    branchAnchorOutputId: "",
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
  },
  crop: {
    open: false,
    selectedImage: null,
    outputItem: null,
    image: null,
    imageBox: null,
    aspect: "source",
    cropBox: null,
    dragStart: null,
    dragOffset: null,
    busy: false
  },
  colorGrade: {
    open: false,
    tab: "light",
    selectedImage: null,
    outputItem: null,
    image: null,
    adjustments: { ...defaultColorGradeAdjustments },
    previewUrl: "",
    previewBusy: false,
    busy: false
  },
  cutout: {
    open: false,
    selectedImage: null,
    outputItem: null,
    image: null,
    imageBox: null,
    analysis: null,
    aiAnalysis: null,
    analysisMethod: "",
    analysisError: "",
    selectedCandidateId: "",
    hoverCandidateId: "",
    busy: false,
    analyzing: false
  }
};

let primaryUploadProcessing = false;
let referenceUploadProcessing = false;

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

const friendExperienceMode = true;
const friendExperienceModes = new Set([
  "custom",
  "plan-axonometric",
  "plan-axonometric-view",
  "plan-render",
  "photo",
  "whitemodel",
  "panorama",
  "sketch",
  "styletransfer",
  "designseries"
]);
const hiddenClientModes = new Set(["image-modeling"]);

function normalizeClientMode(mode) {
  if (mode === "floorplan") return "plan-render";
  if (mode === "plan-viewer" || mode === "plan-3d-view" || mode === "plan-viewer-3d" || mode === "floorplan-viewer") return "plan-axonometric";
  if (mode === "plan-axonometric-view" || mode === "axonometric-view" || mode === "floorplan-axonometric") return "plan-axonometric-view";
  if (mode === "design-logic" || mode === "design-derivation-plan") return "design-derivation";
  if (mode === "360-panorama" || mode === "panoramic" || mode === "equirectangular") return "panorama";
  if (mode === "viewpoint" || mode === "camera-viewpoint" || mode === "view-transform") return "custom";
  if (mode === "white-model-3d" || mode === "ai-3d-model" || mode === "colored-3d-model" || mode === "model-3d") return "image-modeling";
  return mode || "custom";
}

function publicModeOrFallback(mode) {
  const normalized = normalizeClientMode(mode);
  if (hiddenClientModes.has(normalized)) return "custom";
  if (friendExperienceMode && !friendExperienceModes.has(normalized)) return "custom";
  return normalized;
}

function isFriendVisibleMode(mode) {
  return !friendExperienceMode || friendExperienceModes.has(normalizeClientMode(mode));
}

function isPlanPaperMode(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  return ["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(normalized);
}

function isPlanSeriesDynamicMode(mode = state.mode) {
  return ["plan-axonometric", "plan-axonometric-view", "plan-render"].includes(normalizeClientMode(mode));
}

function isPlanMultiAngleMode(mode = state.mode) {
  return isPlanSeriesDynamicMode(mode) && !isPlanPaperMode(mode);
}

function sanitizeLegacyPlanDisplayText(text = "") {
  return String(text || "")
    .replace(/平面图转\s*3D\s*平面图/g, "平面图转彩色平面图")
    .replace(/3D\s*平面图转轴测图/g, "彩色平面图转轴测图")
    .replace(/3D\s*平面图转效果图/g, "轴测图转效果图")
    .replace(/目标：平面图转彩色平面图/g, "目标：平面图转彩色平面图");
}

const planWorkflowRecommendationText = "推荐链路提示：平面图先转为彩色平面图，再由彩色平面图转高精度轴测图，最后在轴测图上框选区域生成人视角效果图。这个链路只作为提示，不会强制切换或自动执行。";
const imageModelingWorkflowRecommendationText = "推荐链路提示：图片转 CAD 建议先生成白底主体图，再生成 CAD 结构参考图，最后导出 DXF / SVG；3D 建模和 GLB / SCAD 暂时不进入主流程。";

function isPlanGuidanceMode(mode = state.mode) {
  return isPlanSeriesDynamicMode(mode);
}

const planWorkflowSteps = {
  "plan-axonometric": {
    index: 1,
    label: "平面图转彩色平面图",
    outputLabel: "彩色平面图",
    inputType: "平面图 / 图纸截图",
    nextModes: ["plan-axonometric-view", "plan-render"]
  },
  "plan-axonometric-view": {
    index: 2,
    label: "彩色平面图转轴测图",
    outputLabel: "轴测图",
    inputType: "彩色平面图 / 平面图 / 轴测图",
    nextModes: ["plan-render"]
  },
  "plan-render": {
    index: 3,
    label: "轴测图转效果图",
    outputLabel: "人视角效果图",
    inputType: "轴测图 / 选区",
    nextModes: []
  }
};

const canvasSelectableModes = [
  { mode: "custom", label: "自定义" },
  { mode: "plan-axonometric", label: "平面图转彩平" },
  { mode: "plan-axonometric-view", label: "彩平转轴测图" },
  { mode: "plan-render", label: "轴测图转效果图" },
  { mode: "design-derivation", label: "设计推导" },
  { mode: "photo", label: "现场图转效果图" },
  { mode: "whitemodel", label: "白模润色" },
  { mode: "panorama", label: "全景图生成" },
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
  if (normalizeClientMode(mode) === "plan-color") return "彩色平面图";
  return planWorkflowSteps[normalizeClientMode(mode)]?.label || workflowButtonMeanings[normalizeClientMode(mode)]?.label || mode;
}

function suggestedModeLabel(mode) {
  if (normalizeClientMode(mode) === "plan-color") return "彩色平面图";
  return planWorkflowSteps[normalizeClientMode(mode)]?.label || workflowButtonMeanings[normalizeClientMode(mode)]?.label || modeConfig(mode).sourceTitle;
}

function planPaperWorkflowOutputLabel(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (normalized === "plan-render") return "效果图";
  if (normalized === "plan-axonometric-view") return "轴测图";
  return "彩色平面图";
}

function planPaperWorkflowSourceLabel(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (normalized === "plan-render") return "轴测图";
  if (normalized === "plan-axonometric-view") return "彩色平面图";
  return "平面图";
}

function planPaperWorkflowControlLabel(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (normalized === "plan-render") return "效果图区域视角控制器";
  if (normalized === "plan-axonometric-view") return "轴测图视角控制器";
  return "彩平视图控制器";
}

function createWorkflowId(mode) {
  return isPlanWorkflowMode(mode) ? `planflow-${Date.now()}-${Math.random().toString(16).slice(2, 7)}` : "";
}

function isColoredPlanAnalysis(analysis = null) {
  const key = normalizeClientMode(analysis?.key || analysis?.sourceType || analysis?.stepMode || "");
  const text = `${analysis?.label || ""} ${analysis?.reason || ""}`.toLowerCase();
  return key === "colored-plan" || key === "plan-color" || /彩平|彩色平面|colored.?plan|color.?plan/.test(text);
}

function needsColorPlanIntermediate(analysis = null) {
  const key = normalizeClientMode(analysis?.key || analysis?.sourceType || "");
  if (isColoredPlanAnalysis(analysis)) return false;
  return ["line-plan", "cad-screenshot"].includes(key);
}

function planColorPipelineDecision(primaryImage = state.primaryImage, mode = state.mode) {
  if (normalizeClientMode(mode) !== "plan-axonometric" || !primaryImage?.dataUrl) {
    return { enabled: false, reason: "", label: "" };
  }
  const analysis = primaryImage.inputAnalysis || state.primaryImageAnalysis || null;
  if (isColoredPlanAnalysis(analysis)) {
    return {
      enabled: false,
      label: "彩色平面图",
      reason: "已识别为彩色平面图，可直接进入轴测图生成。"
    };
  }
  if (needsColorPlanIntermediate(analysis)) {
    return {
      enabled: true,
      label: "黑白平面线稿",
      reason: "已识别为黑白线稿，建议先生成彩色平面图，再生成轴测图。"
    };
  }
  return {
    enabled: true,
    label: analysis?.label || "未确认平面图类型",
    reason: "未确认是否为彩平，建议先生成彩色平面图中间稿，以提高后续轴测图识别稳定性。"
  };
}

function planGenerationPreflight(mode = state.mode, primaryImage = state.primaryImage, analysis = state.primaryImageAnalysis) {
  const normalizedMode = normalizeClientMode(mode);
  if (!isPlanGuidanceMode(normalizedMode)) return null;
  const items = [];
  const warnings = [];
  const viewText = primaryImage ? planPaperReadoutText() : "";
  if (!primaryImage?.dataUrl) {
    warnings.push(`请先上传${planPaperWorkflowSourceLabel(normalizedMode)}。`);
  } else {
    items.push(`输入：${analysis?.label || planPaperWorkflowSourceLabel(normalizedMode)}`);
    items.push(`纸张视角：${viewText}`);
  }
  if (normalizedMode === "plan-axonometric") {
    items.push("输出：彩色平面图中间稿，不做墙体挤出或人视角渲染");
    if (isColoredPlanAnalysis(analysis)) warnings.push("当前图像已像彩色平面图，可直接进入“彩平转轴测图”。");
  } else if (normalizedMode === "plan-axonometric-view") {
    items.push("输出：高精度轴测图，保留彩平布局并强化 3D 透视深度");
    if (needsColorPlanIntermediate(analysis)) warnings.push("当前更像黑白线稿，建议先生成彩色平面图后再转轴测。");
  } else if (normalizedMode === "plan-render") {
    items.push("输出：选定区域的人视角效果图");
    if (state.selection) items.push(`选区：${selectionRegionLabel(state.selection)}`);
    else warnings.push("未框选区域时会自动选择一个明确功能区生成效果图。");
  }
  return {
    ok: warnings.length === 0,
    items,
    warnings,
    text: [...items, ...warnings.map((item) => `提示：${item}`)].join("\n")
  };
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
  appSettingsBody: document.querySelector(".app-settings-body"),
  settingsCloseButton: $("settingsCloseButton"),
  themeChoiceButtons: Array.from(document.querySelectorAll("[data-theme-choice]")),
  themeSettingsStatus: $("themeSettingsStatus"),
  workspaceGlassTransparencyInput: $("workspaceGlassTransparencyInput"),
  workspaceGlassTransparencyValue: $("workspaceGlassTransparencyValue"),
  workspaceGlassBlurInput: $("workspaceGlassBlurInput"),
  workspaceGlassBlurValue: $("workspaceGlassBlurValue"),
  canvasBackgroundStatus: $("canvasBackgroundStatus"),
  canvasBackgroundPreview: $("canvasBackgroundPreview"),
  canvasBackgroundPresetButtons: Array.from(document.querySelectorAll("[data-canvas-background-preset]")),
  canvasBackgroundImageInput: $("canvasBackgroundImageInput"),
  uploadCanvasBackgroundButton: $("uploadCanvasBackgroundButton"),
  clearCanvasBackgroundButton: $("clearCanvasBackgroundButton"),
  canvasBackgroundColorInput: $("canvasBackgroundColorInput"),
  canvasGridColorInput: $("canvasGridColorInput"),
  canvasGridOpacityInput: $("canvasGridOpacityInput"),
  canvasGridSizeInput: $("canvasGridSizeInput"),
  canvasBackgroundImageOpacityInput: $("canvasBackgroundImageOpacityInput"),
  homeView: $("homeView"),
  workspaceView: $("workspaceView"),
  assetLibraryView: $("assetLibraryView"),
  assetLibraryBackButton: $("assetLibraryBackButton"),
  assetLibraryDownloadAllButton: $("assetLibraryDownloadAllButton"),
  assetLibraryRefreshButton: $("assetLibraryRefreshButton"),
  assetLibraryStats: $("assetLibraryStats"),
  assetLibraryCount: $("assetLibraryCount"),
  assetLibraryList: $("assetLibraryList"),
  workspaceHistoryButton: $("workspaceHistoryButton"),
  workspaceHistoryPanel: $("workspaceHistoryPanel"),
  workspaceHistoryList: $("workspaceHistoryList"),
  projectLibraryFilterButtons: Array.from(document.querySelectorAll("[data-project-library-filter]")),
  workspaceHistoryRefreshButton: $("workspaceHistoryRefreshButton"),
  workspaceHistoryCloseButton: $("workspaceHistoryCloseButton"),
  workspaceStatusButton: $("workspaceStatusButton"),
  workspaceStatusPanel: $("workspaceStatusPanel"),
  workspaceStatusCloseButton: $("workspaceStatusCloseButton"),
  canvasListPanel: $("canvasListPanel"),
  canvasList: $("canvasList"),
  newCanvasButton: $("newCanvasButton"),
  topNewCanvasButton: $("topNewCanvasButton"),
  renameCanvasButton: $("renameCanvasButton"),
  deleteCanvasButton: $("deleteCanvasButton"),
  clearAllCanvasesButton: $("clearAllCanvasesButton"),
  toggleCanvasListButton: $("toggleCanvasListButton"),
  agentPanel: document.querySelector(".brief-panel.agent-panel"),
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
  homeToolSearch: $("homeToolSearch"),
  homeToolFilterButtons: Array.from(document.querySelectorAll("[data-home-tool-filter]")),
  homeToolCards: Array.from(document.querySelectorAll("[data-home-tool-card]")),
  homeToolEmpty: $("homeToolEmpty"),
  homeTemplateButtons: Array.from(document.querySelectorAll("[data-home-template]")),
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
  uploadStatusBar: $("uploadStatusBar"),
  uploadStatusState: $("uploadStatusState"),
  uploadStatusText: $("uploadStatusText"),
  removePrimaryImageButton: $("removePrimaryImageButton"),
  imageModelingSubjectPanel: $("imageModelingSubjectPanel"),
  imageModelingSubjectStatus: $("imageModelingSubjectStatus"),
  imageModelingSubjectTitle: $("imageModelingSubjectTitle"),
  imageModelingSubjectSummary: $("imageModelingSubjectSummary"),
  imageModelingCadReferenceButton: $("imageModelingCadReferenceButton"),
  imageModelingLayerList: $("imageModelingLayerList"),
  imageModelingAnalyzeButton: $("imageModelingAnalyzeButton"),
  imageModelingConfirmButton: $("imageModelingConfirmButton"),
  imageModelingFlowBlock: $("imageModelingFlowBlock"),
  activeModeLabel: $("activeModeLabel"),
  agentBriefInsight: $("agentBriefInsight"),
  planAngleSyncBlock: $("planAngleSyncBlock"),
  agentUploadZone: $("agentUploadZone"),
  uploadPreviewBlock: $("uploadPreviewBlock"),
  presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
  projectTemplateButtons: Array.from(document.querySelectorAll("[data-project-template]")),
  stylePresetButtons: Array.from(document.querySelectorAll("[data-style-preset]")),
  storageSummary: $("storageSummary"),
  storageMaintenanceHint: $("storageMaintenanceHint"),
  storageOutputDir: $("storageOutputDir"),
  storagePathHint: $("storagePathHint"),
  chooseStorageDirButton: $("chooseStorageDirButton"),
  saveStorageSettingsButton: $("saveStorageSettingsButton"),
  resetStorageDirButton: $("resetStorageDirButton"),
  storagePromptButtons: Array.from(document.querySelectorAll("[data-storage-prompt-mode]")),
  refreshStorageButton: $("refreshStorageButton"),
  cleanupTestGeneratedButton: $("cleanupTestGeneratedButton"),
  archiveGeneratedButton: $("archiveGeneratedButton"),
  pruneLogsButton: $("pruneLogsButton"),
  imageStudioKernelStatus: $("imageStudioKernelStatus"),
  imageStudioKernelSummary: $("imageStudioKernelSummary"),
  imageStudioKernelHint: $("imageStudioKernelHint"),
  refreshApiSettingsButton: $("refreshApiSettingsButton"),
  reasoningApiBaseUrl: $("reasoningApiBaseUrl"),
  reasoningApiModel: $("reasoningApiModel"),
  reasoningApiKey: $("reasoningApiKey"),
  primaryImageApiBaseUrl: $("primaryImageApiBaseUrl"),
  primaryImageApiModel: $("primaryImageApiModel"),
  primaryImageApiMode: $("primaryImageApiMode"),
  primaryImageImagesNewApiCompat: $("primaryImageImagesNewApiCompat"),
  primaryImageResponsesTransport: $("primaryImageResponsesTransport"),
  primaryImageRequestPolicy: $("primaryImageRequestPolicy"),
  primaryImageReasoningEffort: $("primaryImageReasoningEffort"),
  primaryImageApiResponsesPath: $("primaryImageApiResponsesPath"),
  primaryImageApiGenerationPath: $("primaryImageApiGenerationPath"),
  primaryImageApiEditPath: $("primaryImageApiEditPath"),
  primaryImageApiKey: $("primaryImageApiKey"),
  primaryImageProviderManifest: $("primaryImageProviderManifest"),
  probeReasoningApiButton: $("probeReasoningApiButton"),
  probePrimaryImageApiButton: $("probePrimaryImageApiButton"),
  localApiConnectionStatus: $("localApiConnectionStatus"),
  localApiProbeFeedback: $("localApiProbeFeedback"),
  localApiSettingsSummary: $("localApiSettingsSummary"),
  saveReasoningApiSettingsButton: $("saveReasoningApiSettingsButton"),
  saveImageApiSettingsButton: $("saveImageApiSettingsButton"),
  imageApiProbeFeedback: $("imageApiProbeFeedback"),
  imageOptionsPanel: $("imageOptionsPanel"),
  imageCountOptions: $("imageCountOptions"),
  generationSummaryLabel: $("generationSummaryLabel"),
  aspectRatioSelect: $("aspectRatioSelect"),
  aspectRatioButtons: Array.from(document.querySelectorAll("[data-aspect-ratio]")),
  qualityTierButtons: Array.from(document.querySelectorAll("[data-quality-tier]")),
  imageCountButtons: Array.from(document.querySelectorAll("[data-image-count]")),
  sizePickerButton: $("sizePickerButton"),
  sizePickerOverlay: $("sizePickerOverlay"),
  sizePickerCloseButton: $("sizePickerCloseButton"),
  sizePickerTier: $("sizePickerTier"),
  sizePickerRatio: $("sizePickerRatio"),
  sizePickerWidth: $("sizePickerWidth"),
  sizePickerHeight: $("sizePickerHeight"),
  sizePickerApplyButton: $("sizePickerApplyButton"),
  outputWidth: $("outputWidth"),
  outputHeight: $("outputHeight"),
  structureStrength: $("structureStrength"),
  outputType: $("outputType"),
  canvasCommand: $("canvasCommand"),
  canvasFloatingParams: document.querySelector(".canvas-floating-params"),
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
  renderResultStage: $("renderResultStage"),
  renderResultPanorama: $("renderResultPanorama"),
  renderResultLink: $("renderResultLink"),
  infiniteCanvas: $("infiniteCanvas"),
  canvasViewport: $("canvasViewport"),
  canvasZoomLayer: $("canvasZoomLayer"),
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
  taskProgressPhase: $("taskProgressPhase"),
  taskProgressEndpoint: $("taskProgressEndpoint"),
  taskProgressElapsed: $("taskProgressElapsed"),
  taskProgressEvents: $("taskProgressEvents"),
  taskProgressReview: $("taskProgressReview"),
  taskProgressPrompt: $("taskProgressPrompt"),
  outputManagerList: $("outputManagerList"),
  outputManagerSearch: $("outputManagerSearch"),
  outputFavoritesOnlyButton: $("outputFavoritesOnlyButton"),
  exportOutputsButton: $("exportOutputsButton"),
  taskLogList: $("taskLogList"),
  refreshTaskLogsButton: $("refreshTaskLogsButton"),
  taskLogFilterButtons: Array.from(document.querySelectorAll("[data-task-log-filter]")),
  toast: $("toast")
};

let workflowCanvasFrame = 0;
let canvasLinksFrame = 0;
let pendingCanvasLinkNodes = null;
let canvasPreviewClickTimer = 0;
let canvasPreviewClickPayload = null;
let canvasNodeResizeObserver = null;
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
const PLAN_PAPER_MIN_ZOOM = 0.45;
const PLAN_PAPER_MAX_ZOOM = 3.2;
const PLAN_PAPER_MAX_PAN = 80;
const PLAN_PAPER_PAN_STEP = 8;
const CANVAS_STATE_VERSION = 1;
const CLIENT_ID_STORAGE_KEY = "laogui-client-id";
const CANVAS_LIST_COLLAPSED_STORAGE_KEY = "laogui-canvas-list-collapsed";
const CANVAS_BACKGROUND_STORAGE_KEY = "laogui-canvas-background";
const WORKSPACE_GLASS_STORAGE_KEY = "laogui-workspace-glass";
const RECOVERABLE_API_PATHS = new Set(["/api/generate-image", "/api/render-from-images", "/api/design-series", "/api/image-modeling", "/api/image-modeling/analyze"]);
const TASK_RESULT_POLL_INTERVAL_MS = 2500;
const TASK_RESULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const TASK_RESULT_MISSING_TIMEOUT_MS = 15000;
const DESIGN_SERIES_PARALLEL_LIMIT = 2;
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

function asStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value == null) return fallback;
  if (typeof value === "string") {
    return value ? [value] : fallback;
  }
  return [String(value)].filter(Boolean);
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
  const isViewReference = role === "view-angle";
  const dataUrl = await optimizeImageDataUrl(image.dataUrl, {
    maxEdge: isPrimary
      ? IMAGE_UPLOAD_PRIMARY_MAX_EDGE
      : isViewReference
        ? IMAGE_UPLOAD_VIEW_REFERENCE_MAX_EDGE
        : IMAGE_UPLOAD_REFERENCE_MAX_EDGE,
    targetBytes: isPrimary
      ? IMAGE_UPLOAD_PRIMARY_TARGET_BYTES
      : isViewReference
        ? IMAGE_UPLOAD_VIEW_REFERENCE_TARGET_BYTES
        : IMAGE_UPLOAD_REFERENCE_TARGET_BYTES,
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
  if (next.viewAngleReference?.dataUrl) {
    next.viewAngleReference = await compactImageForApi(next.viewAngleReference, "view-angle");
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
    text: "思考模式默认关闭；需要 gpt-5.5 先做提示词融合时，请在本次生成前手动开启一次。"
  };
}

function defaultPlanPaperViewState() {
  return {
    yaw: 332,
    pitch: 56,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: null
  };
}

function defaultMultiAngleViewState() {
  return {
    mode: "subject",
    subjectX: 0,
    subjectY: 0,
    subjectRotate: -45,
    cameraX: -45,
    cameraY: 35,
    cameraDistance: 0,
    dragging: null
  };
}

function defaultCanvasBackgroundSettings() {
  return {
    preset: "default",
    backgroundColor: "#f7f7f4",
    gridColor: "#7f5d21",
    gridOpacity: 8,
    gridSize: 144,
    imageDataUrl: "",
    imageUrl: "",
    imageOpacity: 18
  };
}

function defaultWorkspaceGlassSettings() {
  return {
    transparency: 58,
    blur: 68
  };
}

const canvasBackgroundPresets = {
  default: {
    backgroundColor: "#f7f7f4",
    gridColor: "#7f5d21",
    gridOpacity: 8,
    gridSize: 144,
    imageOpacity: 18
  },
  "rice-paper": {
    backgroundColor: "#fbfaf4",
    gridColor: "#b88a42",
    gridOpacity: 7,
    gridSize: 160,
    imageOpacity: 12
  },
  "ink-wash": {
    backgroundColor: "#f4f3ee",
    gridColor: "#5f665d",
    gridOpacity: 9,
    gridSize: 156,
    imageOpacity: 16
  },
  "paper-map-xuan": {
    backgroundColor: "#f7f3e9",
    gridColor: "#b88a42",
    gridOpacity: 5,
    gridSize: 160,
    imageUrl: "assets/canvas-backgrounds/laogui-paper-map-01-xuan-paper.png",
    imageOpacity: 82
  },
  "paper-map-contour": {
    backgroundColor: "#f7f0e2",
    gridColor: "#9a8463",
    gridOpacity: 4,
    gridSize: 172,
    imageUrl: "assets/canvas-backgrounds/laogui-paper-map-02-contour-lines.png",
    imageOpacity: 78
  },
  "paper-map-cloth": {
    backgroundColor: "#f4eddf",
    gridColor: "#927b5c",
    gridOpacity: 4,
    gridSize: 168,
    imageUrl: "assets/canvas-backgrounds/laogui-paper-map-03-white-cloth.png",
    imageOpacity: 76
  },
  "paper-map-mist": {
    backgroundColor: "#f7f4ee",
    gridColor: "#8c9287",
    gridOpacity: 4,
    gridSize: 176,
    imageUrl: "assets/canvas-backgrounds/laogui-paper-map-04-ink-mist.png",
    imageOpacity: 72
  },
  "paper-map-route": {
    backgroundColor: "#f8f1e2",
    gridColor: "#b88a42",
    gridOpacity: 4,
    gridSize: 164,
    imageUrl: "assets/canvas-backgrounds/laogui-paper-map-05-route-traces.png",
    imageOpacity: 78
  },
  "paper-map-bamboo": {
    backgroundColor: "#f4efe4",
    gridColor: "#8f876f",
    gridOpacity: 3,
    gridSize: 168,
    imageUrl: "assets/canvas-backgrounds/laogui-paper-map-06-bamboo-mountain.png",
    imageOpacity: 54
  },
  plain: {
    backgroundColor: "#fbfbf8",
    gridColor: "#11110f",
    gridOpacity: 3,
    gridSize: 144,
    imageOpacity: 0
  }
};

const canvasBackgroundNightPresets = {
  default: {
    backgroundColor: "#080b10",
    gridColor: "#d6b57c",
    gridOpacity: 13,
    imageOpacity: 12
  },
  "rice-paper": {
    backgroundColor: "#11100c",
    gridColor: "#d8b66f",
    gridOpacity: 12,
    imageOpacity: 10
  },
  "ink-wash": {
    backgroundColor: "#0c1112",
    gridColor: "#93a08f",
    gridOpacity: 14,
    imageOpacity: 12
  },
  "paper-map-xuan": {
    backgroundColor: "#0e0d0a",
    gridColor: "#d8b66f",
    gridOpacity: 9,
    imageOpacity: 16
  },
  "paper-map-contour": {
    backgroundColor: "#0e0c08",
    gridColor: "#d0b07a",
    gridOpacity: 8,
    imageOpacity: 15
  },
  "paper-map-cloth": {
    backgroundColor: "#100d08",
    gridColor: "#d0b07a",
    gridOpacity: 8,
    imageOpacity: 14
  },
  "paper-map-mist": {
    backgroundColor: "#0c0e0e",
    gridColor: "#a9b4a7",
    gridOpacity: 9,
    imageOpacity: 15
  },
  "paper-map-route": {
    backgroundColor: "#0e0c08",
    gridColor: "#d8b66f",
    gridOpacity: 8,
    imageOpacity: 15
  },
  "paper-map-bamboo": {
    backgroundColor: "#0d0d0b",
    gridColor: "#bcc1b2",
    gridOpacity: 8,
    imageOpacity: 12
  },
  plain: {
    backgroundColor: "#07090d",
    gridColor: "#d9e2ef",
    gridOpacity: 6,
    imageOpacity: 0
  },
  custom: {
    backgroundColor: "#080b10",
    gridColor: "#d6b57c",
    gridOpacity: 12,
    imageOpacity: 12
  }
};

function resetImageViewStates() {
  state.planPaperView = defaultPlanPaperViewState();
  state.multiAngleView = defaultMultiAngleViewState();
  state.viewControlOpen = false;
}

function openPlanDynamicControlForCurrentMode() {
  if (isPlanSeriesDynamicMode(state.mode) && state.primaryImage?.dataUrl) {
    state.viewControlOpen = true;
  }
}

function imageModelingSourceKey(image = state.primaryImage) {
  if (!image) return "";
  return [
    image.name || "",
    image.type || "",
    image.width || "",
    image.height || "",
    String(image.dataUrl || "").length
  ].join("|");
}

function imageModelingSelectionKey(selection = state.selection) {
  if (!selection) return "selection:none";
  return [
    round4(selection.x || 0),
    round4(selection.y || 0),
    round4(selection.width || 0),
    round4(selection.height || 0)
  ].join(",");
}

async function createImageModelingSubjectCropImage({ image = state.primaryBitmap, source = state.primaryImage, selection = state.selection } = {}) {
  if (!image || !source || !selection) return null;
  const width = Number(image.naturalWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.height || 0);
  if (!width || !height) return null;

  const padX = Math.max(8, Math.round(width * 0.04));
  const padY = Math.max(8, Math.round(height * 0.04));
  const left = clamp(Math.floor((selection.x || 0) * width) - padX, 0, Math.max(0, width - 1));
  const top = clamp(Math.floor((selection.y || 0) * height) - padY, 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil(((selection.x || 0) + (selection.width || 0)) * width) + padX, left + 1, width);
  const bottom = clamp(Math.ceil(((selection.y || 0) + (selection.height || 0)) * height) + padY, top + 1, height);
  const cropWidth = Math.max(1, right - left);
  const cropHeight = Math.max(1, bottom - top);
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const dataUrl = await optimizeImageDataUrl(canvas.toDataURL("image/png"), {
    maxEdge: IMAGE_UPLOAD_PRIMARY_MAX_EDGE,
    targetBytes: IMAGE_UPLOAD_PRIMARY_TARGET_BYTES,
    force: true,
    cacheLabel: "image-modeling-subject-crop"
  });
  return {
    name: `${slugForFile(source.name || "modeling-subject")}-subject-crop.png`,
    type: imageMimeFromDataUrl(dataUrl) || "image/png",
    dataUrl,
    width: cropWidth,
    height: cropHeight,
    sourceType: "image-modeling-subject-crop",
    originalName: source.name || null,
    selection: cloneValue(selection),
    cropBounds: { x: left, y: top, width: cropWidth, height: cropHeight }
  };
}

function resetImageModelingAnalysis() {
  state.imageModelingAnalysis = null;
  state.imageModelingAnalysisConfirmed = false;
}

function currentImageModelingAnalysis() {
  const analysis = state.imageModelingAnalysis;
  if (!analysis) return null;
  if (analysis.sourceKey && analysis.sourceKey !== imageModelingSourceKey()) return null;
  return analysis;
}

function isImageModelingWhiteBackgroundMeta(meta = null) {
  if (!meta || typeof meta !== "object") return false;
  const text = `${meta.stepMode || ""} ${meta.title || ""} ${meta.sourceType || ""} ${meta.inputImageType || ""}`.toLowerCase();
  return /white-background|white background|白底/.test(text);
}

function currentImageModelingWhiteBackgroundImage(analysis = currentImageModelingAnalysis()) {
  if (!analysis) return null;
  const direct = analysis.whiteBackgroundImage || null;
  if (direct?.dataUrl) return direct;
  const prepassImage = analysis.modelingPrepass?.image || null;
  return isImageModelingWhiteBackgroundMeta(prepassImage) && prepassImage?.dataUrl ? prepassImage : null;
}

function currentImageModelingExpandedImage(analysis = currentImageModelingAnalysis()) {
  if (!analysis) return null;
  const direct = analysis.expandedSubjectImage || analysis.outpaintImage || null;
  if (direct?.dataUrl) return direct;
  const prepassImage = analysis.modelingPrepass?.image || null;
  return prepassImage?.dataUrl && !isImageModelingWhiteBackgroundMeta(prepassImage) ? prepassImage : null;
}

function currentImageModelingPreparedImage(analysis = currentImageModelingAnalysis()) {
  return currentImageModelingWhiteBackgroundImage(analysis) || currentImageModelingExpandedImage(analysis);
}

function currentImageModelingCadReferenceImage(analysis = currentImageModelingAnalysis()) {
  if (!analysis) return null;
  const direct = analysis.cadReferenceImage || null;
  if (direct?.dataUrl) return direct;
  const prepassImage = analysis.modelingCadPrepass?.image || null;
  return prepassImage?.dataUrl ? prepassImage : null;
}

function hasConfirmedImageModelingSubject() {
  return Boolean(state.primaryImage);
}

function hasImageModelingModelResult() {
  return normalizeClientMode(state.mode) === "image-modeling" && state.whiteModelResults.length > 0;
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
    zoom: 1,
    positions: {},
    selectedImage: null,
    imageActionBusy: "",
    branchAnchorNodeId: "",
    branchAnchorOutputId: "",
    panning: null,
    nodeDrag: null,
    panelDropDrag: null
  };
}

function blankCanvasSnapshot(mode = state.mode || "custom") {
  const normalizedMode = publicModeOrFallback(mode);
  const config = modeConfig(normalizedMode);
  return {
    plan: null,
    selectedId: null,
    brief: null,
    mode: normalizedMode,
    primaryImage: null,
    primaryImageAnalysis: null,
    imageModelingAnalysis: null,
    imageModelingAnalysisConfirmed: false,
    referenceImages: [],
    assets: [],
    selection: null,
    render: null,
    renders: [],
    imageToolResults: [],
    cadResult: null,
    cadResults: [],
    whiteModelResult: null,
    whiteModelResults: [],
    designSeriesAnalysis: null,
    designSeriesResults: [],
    outputSearch: "",
    outputFavoritesOnly: false,
    favoriteOutputIds: [],
    compareOutputIds: [],
    selectedScenePreset: null,
    selectedProjectTemplate: null,
    selectedStylePreset: null,
    planPaperView: defaultPlanPaperViewState(),
    viewControlOpen: false,
    multiAngleView: defaultMultiAngleViewState(),
    canvasCommandUserEdited: false,
    commandValue: "",
    renderIntentValue: config.intent || "",
    outputTypeValue: config.outputType || "overall render",
    structureStrengthValue: els.structureStrength?.value || "0.82",
    promptContext: defaultPromptContextForMode(normalizedMode),
    generation: { aspect: "source", quality: "1k", count: 1, customSize: "" },
    thinkingModeEnabled: DEFAULT_THINKING_MODE_ENABLED,
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
    imageModelingAnalysis: cloneValue(state.imageModelingAnalysis),
    imageModelingAnalysisConfirmed: Boolean(state.imageModelingAnalysisConfirmed),
    referenceImages: cloneValue(state.referenceImages, []),
    assets: cloneValue(state.assets, []),
    selection: cloneValue(state.selection),
    render: cloneValue(state.render),
    renders: cloneValue(state.renders, []),
    imageToolResults: cloneValue(state.imageToolResults, []),
    cadResult: cloneValue(state.cadResult),
    cadResults: cloneValue(state.cadResults, []),
    whiteModelResult: cloneValue(state.whiteModelResult),
    whiteModelResults: cloneValue(state.whiteModelResults, []),
    designSeriesAnalysis: cloneValue(state.designSeriesAnalysis),
    designSeriesResults: cloneValue(state.designSeriesResults, []),
    outputSearch: state.outputSearch || "",
    outputFavoritesOnly: Boolean(state.outputFavoritesOnly),
    favoriteOutputIds: Array.from(state.favoriteOutputIds || []),
    compareOutputIds: Array.from(state.compareOutputIds || []),
    selectedScenePreset: state.selectedScenePreset,
    selectedProjectTemplate: state.selectedProjectTemplate,
    selectedStylePreset: state.selectedStylePreset,
    planPaperView: {
      ...normalizedPlanPaperViewState(state.planPaperView),
      dragging: null
    },
    viewControlOpen: Boolean(state.viewControlOpen),
    multiAngleView: {
      ...normalizedMultiAngleViewState(state.multiAngleView),
      dragging: null
    },
    canvasCommandUserEdited: state.canvasCommandUserEdited,
    commandValue: els.canvasCommand?.value || "",
    renderIntentValue: els.renderIntent?.value || "",
    outputTypeValue: els.outputType?.value || "",
    structureStrengthValue: els.structureStrength?.value || "",
    promptContext: cloneValue(state.promptContext, defaultPromptContextForMode(state.mode)),
    generation: cloneValue(state.generation, { aspect: "source", quality: "1k", count: 1, customSize: "" }),
    thinkingModeEnabled: DEFAULT_THINKING_MODE_ENABLED,
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
      branchAnchorNodeId: state.canvas.branchAnchorNodeId || "",
      branchAnchorOutputId: state.canvas.branchAnchorOutputId || "",
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
  const mode = publicModeOrFallback(snapshot?.mode || state.mode);
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
  const mode = publicModeOrFallback(state.mode);
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
  if (els.topNewCanvasButton) {
    els.topNewCanvasButton.disabled = taskRunning;
  }
  if (els.renameCanvasButton) {
    els.renameCanvasButton.disabled = taskRunning || !activeCanvasRecord();
  }
  if (els.clearAllCanvasesButton) {
    els.clearAllCanvasesButton.disabled = taskRunning || !state.canvases.length;
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
  state.mode = publicModeOrFallback(snapshot.mode || "custom");
  state.primaryImage = cloneValue(snapshot.primaryImage);
  state.primaryImageAnalysis = cloneValue(snapshot.primaryImageAnalysis);
  state.imageModelingAnalysis = cloneValue(snapshot.imageModelingAnalysis);
  state.imageModelingAnalysisConfirmed = Boolean(snapshot.imageModelingAnalysisConfirmed);
  state.referenceImages = cloneValue(snapshot.referenceImages, []);
  state.assets = cloneValue(snapshot.assets, []);
  state.selection = cloneValue(snapshot.selection);
  state.render = cloneValue(snapshot.render);
  state.renders = cloneValue(snapshot.renders, []);
  state.imageToolResults = cloneValue(snapshot.imageToolResults, []);
  state.cadResult = cloneValue(snapshot.cadResult);
  state.cadResults = cloneValue(snapshot.cadResults, []);
  state.whiteModelResult = cloneValue(snapshot.whiteModelResult);
  state.whiteModelResults = cloneValue(snapshot.whiteModelResults, []);
  state.designSeriesAnalysis = cloneValue(snapshot.designSeriesAnalysis);
  state.designSeriesResults = cloneValue(snapshot.designSeriesResults, []);
  state.outputSearch = String(snapshot.outputSearch || "");
  state.outputFavoritesOnly = Boolean(snapshot.outputFavoritesOnly);
  state.favoriteOutputIds = new Set(snapshot.favoriteOutputIds || []);
  state.compareOutputIds = new Set(snapshot.compareOutputIds || []);
  state.selectedScenePreset = snapshot.selectedScenePreset || null;
  state.selectedProjectTemplate = snapshot.selectedProjectTemplate || null;
  state.selectedStylePreset = snapshot.selectedStylePreset || null;
  state.planPaperView = {
    ...normalizedPlanPaperViewState({
      ...defaultPlanPaperViewState(),
      ...(cloneValue(snapshot.planPaperView, {}) || {})
    }),
    dragging: null
  };
  state.viewControlOpen = Boolean(snapshot.viewControlOpen);
  state.multiAngleView = {
    ...normalizedMultiAngleViewState({
      ...defaultMultiAngleViewState(),
      ...(cloneValue(snapshot.multiAngleView, {}) || {})
    }),
    dragging: null
  };
  state.canvasCommandUserEdited = Boolean(snapshot.canvasCommandUserEdited);
  state.promptContext = cloneValue(snapshot.promptContext, defaultPromptContextForMode(state.mode));
  state.generation = {
    aspect: snapshot.generation?.aspect || "source",
    quality: snapshot.generation?.quality || "1k",
    count: clampImageCount(snapshot.generation?.count || 1, state.mode),
    customSize: snapshot.generation?.customSize || ""
  };
  state.thinkingModeEnabled = DEFAULT_THINKING_MODE_ENABLED;
  state.analyzingDesignSeries = Boolean(snapshot.analyzingDesignSeries);
  state.thinking = cloneValue(snapshot.thinking, defaultThinkingState());
  const snapshotCanvas = cloneValue(snapshot.canvas, {});
  state.canvas = {
    ...defaultCanvasViewState(),
    ...snapshotCanvas
  };
  if (Math.abs(Number(state.canvas.zoom) - 0.86) < 0.001) state.canvas.zoom = 1;
  state.canvas.layoutVersion = Number(snapshotCanvas?.layoutVersion || 1);
  state.canvas.panning = null;
  state.canvas.nodeDrag = null;
  state.canvas.panelDropDrag = null;
  const restoredLayoutMigrated = normalizeCanvasLayoutPositions();
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
  if (restoredLayoutMigrated) focusCanvasToNodes();
  renderCanvasList();
  restoringCanvasState = false;
  if (restoredLayoutMigrated) scheduleCanvasStateSave({ delay: 120 });
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

async function clearAllCanvases() {
  if (canvasSwitchBlocked()) return;
  const count = Math.max(1, state.canvases.length);
  if (!window.confirm(`清空所有画布？当前 ${count} 个画布里的输入、参考图、结果和画布布局都会被移除，并重新建立一个空白画布。`)) return;
  const mode = normalizeClientMode(state.mode || "custom");
  state.nextCanvasIndex = 1;
  const record = createCanvasRecord(mode);
  state.canvases = [record];
  state.activeCanvasId = record.id;
  await restoreCanvasRecord(record);
  scheduleCanvasStateSave({ delay: 80 });
  toast("已清空所有画布");
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
    isOverlayOpen("imagePreviewOverlay") ||
      isOverlayOpen("imageCompareOverlay") ||
      isOverlayOpen("panoramaPreviewOverlay") ||
      isOverlayOpen("deepEditOverlay") ||
      isOverlayOpen("colorGradeOverlay") ||
      isOverlayOpen("multiAngleOverlay") ||
      isOverlayOpen("cutoutOverlay") ||
      isOverlayOpen("cropOverlay")
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
    button.hidden = !isFriendVisibleMode(button.dataset.mode);
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

const layoutV4NodePositions = {
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

const layoutV5NodePositions = {
  brief: { x: 112, y: 112, w: 340 },
  resources: { x: 112, y: 850, w: 340 },
  source: { x: 112, y: 126, w: 340 },
  selection: { x: 112, y: 515, w: 340 },
  references: { x: 540, y: 126, w: 320 },
  seriesAdvice: { x: 1100, y: 126, w: 360 },
  planWorkflow: { x: 1100, y: 126, w: 360 },
  command: { x: 1100, y: 430, w: 360 },
  think: { x: 1500, y: 260, w: 360 },
  render: { x: 1900, y: 126, w: 420 },
  cad: { x: 1900, y: 126, w: 420 },
  plan: { x: 1500, y: 620, w: 360 },
  direction0: { x: 1100, y: 940, w: 330 },
  direction1: { x: 1460, y: 940, w: 330 },
  direction2: { x: 1820, y: 940, w: 330 }
};

const layoutV8NodePositions = {
  brief: { x: 112, y: 112, w: 340 },
  resources: { x: 112, y: 850, w: 340 },
  source: { x: 112, y: 126, w: 340 },
  selection: { x: 112, y: 515, w: 340 },
  references: { x: 540, y: 126, w: 320 },
  seriesAdvice: { x: 900, y: 126, w: 360 },
  planWorkflow: { x: 900, y: 126, w: 360 },
  command: { x: 900, y: 440, w: 360 },
  think: { x: 1300, y: 440, w: 360 },
  render: { x: 1700, y: 440, w: 420 },
  cad: { x: 1700, y: 440, w: 420 },
  plan: { x: 1300, y: 760, w: 360 },
  direction0: { x: 900, y: 980, w: 330 },
  direction1: { x: 1260, y: 980, w: 330 },
  direction2: { x: 1620, y: 980, w: 330 }
};

const layoutV9NodePositions = {
  brief: { x: 112, y: 112, w: 340 },
  resources: { x: 112, y: 850, w: 340 },
  source: { x: 112, y: 126, w: 340 },
  selection: { x: 112, y: 515, w: 340 },
  references: { x: 540, y: 126, w: 320 },
  seriesAdvice: { x: 540, y: 126, w: 360 },
  planWorkflow: { x: 540, y: 126, w: 360 },
  command: { x: 540, y: 440, w: 360 },
  think: { x: 940, y: 440, w: 360 },
  render: { x: 1340, y: 440, w: 420 },
  cad: { x: 1340, y: 440, w: 420 },
  plan: { x: 940, y: 760, w: 360 },
  direction0: { x: 540, y: 980, w: 330 },
  direction1: { x: 900, y: 980, w: 330 },
  direction2: { x: 1260, y: 980, w: 330 }
};

const layoutV10NodePositions = {
  brief: { x: 112, y: 112, w: 340 },
  resources: { x: 112, y: 980, w: 340 },
  source: { x: 112, y: 126, w: 340 },
  selection: { x: 112, y: 585, w: 340 },
  references: { x: 112, y: 805, w: 320 },
  seriesAdvice: { x: 540, y: 126, w: 360 },
  planWorkflow: { x: 540, y: 126, w: 360 },
  command: { x: 540, y: 460, w: 360 },
  think: { x: 540, y: 690, w: 360 },
  render: { x: 960, y: 690, w: 420 },
  cad: { x: 960, y: 690, w: 420 },
  plan: { x: 540, y: 935, w: 360 },
  direction0: { x: 960, y: 935, w: 330 },
  direction1: { x: 960, y: 1165, w: 330 },
  direction2: { x: 1310, y: 935, w: 330 }
};

const layoutV11NodePositions = {
  brief: { x: 112, y: 112, w: 340 },
  source: { x: 112, y: 126, w: 340 },
  selection: { x: 112, y: 760, w: 340 },
  references: { x: 112, y: 980, w: 320 },
  resources: { x: 112, y: 1280, w: 340 },
  seriesAdvice: { x: 760, y: 126, w: 360 },
  planWorkflow: { x: 760, y: 126, w: 360 },
  command: { x: 760, y: 480, w: 360 },
  think: { x: 760, y: 735, w: 360 },
  render: { x: 1220, y: 735, w: 420 },
  cad: { x: 1220, y: 735, w: 420 },
  plan: { x: 760, y: 1010, w: 360 },
  direction0: { x: 1220, y: 1010, w: 330 },
  direction1: { x: 1580, y: 1010, w: 330 },
  direction2: { x: 1220, y: 1240, w: 330 }
};

const layoutV12NodePositions = {
  brief: { x: 740, y: 120, w: 360 },
  source: { x: 220, y: 650, w: 340 },
  selection: { x: 220, y: 1110, w: 340 },
  references: { x: 220, y: 1360, w: 320 },
  resources: { x: 220, y: 1760, w: 340 },
  seriesAdvice: { x: 740, y: 120, w: 360 },
  planWorkflow: { x: 740, y: 120, w: 360 },
  command: { x: 740, y: 405, w: 360 },
  think: { x: 740, y: 675, w: 360 },
  render: { x: 1220, y: 590, w: 420 },
  cad: { x: 1760, y: 150, w: 420 },
  plan: { x: 740, y: 970, w: 360 },
  direction0: { x: 1220, y: 1010, w: 330 },
  direction1: { x: 1580, y: 1010, w: 330 },
  direction2: { x: 1220, y: 1240, w: 330 }
};

const defaultNodePositions = {
  brief: { x: 120, y: 120, w: 360 },
  source: { x: 120, y: 430, w: 340 },
  selection: { x: 120, y: 860, w: 340 },
  references: { x: 120, y: 1120, w: 320 },
  resources: { x: 120, y: 1460, w: 340 },
  seriesAdvice: { x: 540, y: 120, w: 360 },
  planWorkflow: { x: 540, y: 120, w: 360 },
  command: { x: 540, y: 430, w: 360 },
  think: { x: 540, y: 700, w: 360 },
  plan: { x: 540, y: 1010, w: 360 },
  render: { x: 980, y: 430, w: 420 },
  cad: { x: 1420, y: 430, w: 420 },
  direction0: { x: 980, y: 1010, w: 330 },
  direction1: { x: 1340, y: 1010, w: 330 },
  direction2: { x: 980, y: 1260, w: 330 }
};

function sameCanvasPosition(a, b) {
  if (!a || !b) return false;
  return ["x", "y", "w"].every((key) => Math.round(Number(a[key] || 0)) === Math.round(Number(b[key] || 0)));
}

function layoutV4DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return { x: 1500 + pipelineIndex * 450, y: 126 + renderIndex * 520, w: 410 };
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode).length;
      return { x: 1940 + (stepIndex - 1) * 470, y: 126 + sameStepIndex * 520, w: 430 };
    }
    return { x: 1940 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1940 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return { x: 1940 + (index % 2) * 500, y: 126 + Math.floor(index / 2) * 600, w: 460 };
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
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return { x: 1240 + pipelineIndex * 440, y: 126 + renderIndex * 520, w: 410 };
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode).length;
      return { x: 1660 + (stepIndex - 1) * 470, y: 126 + sameStepIndex * 520, w: 430 };
    }
    return { x: 1660 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1660 + (index % 2) * 470, y: 126 + Math.floor(index / 2) * 560, w: 430 };
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return { x: 1660 + (index % 2) * 500, y: 126 + Math.floor(index / 2) * 600, w: 460 };
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
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return { x: 1180 + pipelineIndex * 430, y: 96 + renderIndex * 520, w: 400 };
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode).length;
      return { x: 1180 + (stepIndex - 1) * 470, y: 520 + sameStepIndex * 520, w: 420 };
    }
    return { x: 1580 + (index % 2) * 455, y: 96 + Math.floor(index / 2) * 560, w: 420 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1580 + (index % 2) * 455, y: 96 + Math.floor(index / 2) * 560, w: 420 };
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return { x: 1580 + (index % 2) * 490, y: 96 + Math.floor(index / 2) * 600, w: 460 };
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

function estimatedCanvasNodeWidth(id, fallback = 320) {
  if (!id) return fallback;
  if (id === "source") return hasVisiblePrimaryInput() && isPlanPaperMode(state.mode) ? planPaperFrameNodeWidth() : 320;
  if (/^reference\d+$/.test(id)) return 260;
  if (/^render\d+Pipeline\d+$/.test(id)) return 410;
  if (/^render\d+$/.test(id)) return 420;
  if (/^directionImage\d+$/.test(id)) return 420;
  if (/^cad\d+$/.test(id)) return 420;
  if (/^whiteModel\d+$/.test(id)) return 470;
  return defaultNodePositions[id]?.w || fallback;
}

function branchParentForRender(render) {
  const parentNodeId = String(render?.parentNodeId || "");
  if (!parentNodeId) return "";
  return parentNodeId;
}

function branchSiblingIndex(renderIndex, parentNodeId) {
  return state.renders
    .slice(0, renderIndex)
    .filter((render) => branchParentForRender(render) === parentNodeId)
    .length;
}

function branchNodePosition(parentNodeId, childId, { width = 420, row = 0, step = 0 } = {}) {
  if (!parentNodeId || parentNodeId === childId) return null;
  const parentPos = state.canvas.positions[parentNodeId] || defaultPositionForNode(parentNodeId);
  if (!parentPos) return null;
  const parentWidth = estimatedCanvasNodeWidth(parentNodeId, parentPos.w || 320);
  const sourceBranch = parentNodeId === "source";
  const gapX = sourceBranch ? 112 : 72;
  const gapY = sourceBranch ? 34 : 28;
  const rowHeight = sourceBranch ? 520 : 470;
  const stepX = width + (sourceBranch ? 40 : 34);
  const sourceMinX = Math.max(
    defaultNodePositions.command.x + defaultNodePositions.command.w + 96,
    defaultNodePositions.think.x + defaultNodePositions.think.w + 96
  );
  const baseX = sourceBranch
    ? Math.max(parentPos.x + parentWidth + gapX, sourceMinX)
    : parentPos.x + parentWidth + gapX;
  const baseY = sourceBranch ? parentPos.y - 18 : parentPos.y;
  return {
    x: Math.round(baseX + step * stepX),
    y: Math.round(baseY + row * rowHeight + (row ? gapY : 0)),
    w: width
  };
}

function layoutV12DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return compactOutputGridPosition(pipelineIndex, renderIndex, {
      width: 410,
      baseX: 980,
      baseY: 520,
      colGap: 440,
      rowGap: 470,
      groupGap: 610
    });
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return compactOutputGridPosition(stepIndex - 1 + pipelineStepCount, sameStepIndex, {
        baseX: 980,
        baseY: 520,
        colGap: 440,
        rowGap: 470,
        groupGap: 610
      });
    }
    return compactOutputGridPosition(pipelineStepCount, index, {
      baseX: 980,
      baseY: 520,
      colGap: 440,
      rowGap: 470,
      groupGap: 610
    });
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return compactOutputGridPosition(index, 0, {
      baseX: 1430,
      baseY: 120,
      colGap: 420,
      rowGap: 210,
      groupGap: 520
    });
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return compactOutputGridPosition(index, 0, {
      width: 470,
      baseX: 980,
      baseY: 1180,
      colGap: 490,
      rowGap: 560,
      groupGap: 620
    });
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 120 + (index % 2) * 270, y: 1130 + Math.floor(index / 2) * 260, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return compactOutputGridPosition(index, 0, {
      baseX: 1340,
      baseY: 1180,
      colGap: 430,
      rowGap: 470
    });
  }
  return null;
}

function branchDynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    const render = state.renders[renderIndex];
    const parentNodeId = branchParentForRender(render);
    if (!parentNodeId) return null;
    return branchNodePosition(parentNodeId, id, {
      width: 410,
      row: branchSiblingIndex(renderIndex, parentNodeId),
      step: pipelineIndex
    });
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const parentNodeId = branchParentForRender(render);
    if (!parentNodeId) return null;
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    return branchNodePosition(parentNodeId, id, {
      width: 420,
      row: branchSiblingIndex(index, parentNodeId),
      step: pipelineStepCount
    });
  }
  return null;
}

function layoutV5DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return { x: 1500 + pipelineIndex * 430, y: 126 + renderIndex * 500, w: 410 };
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return { x: 1900 + (stepIndex - 1) * 440, y: 126 + sameStepIndex * 500, w: 420 };
    }
    return { x: 1900 + (index % 2) * 440, y: 126 + Math.floor(index / 2) * 530, w: 420 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1900 + (index % 2) * 440, y: 126 + Math.floor(index / 2) * 530, w: 420 };
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return { x: 1900 + (index % 2) * 500, y: 126 + Math.floor(index / 2) * 580, w: 470 };
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 540 + (index % 2) * 270, y: 126 + Math.floor(index / 2) * 300, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return { x: 1900 + (index % 2) * 440, y: 940 + Math.floor(index / 2) * 530, w: 420 };
  }
  return null;
}

function layoutV8DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return { x: 1700 + pipelineIndex * 430, y: 440 + renderIndex * 520, w: 410 };
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return { x: 1700 + (stepIndex - 1) * 440 + pipelineStepCount * 430, y: 440 + sameStepIndex * 520, w: 420 };
    }
    return { x: 1700 + pipelineStepCount * 430 + (index % 2) * 440, y: 440 + Math.floor(index / 2) * 540, w: 420 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1700 + (index % 2) * 440, y: 440 + Math.floor(index / 2) * 540, w: 420 };
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return { x: 1700 + (index % 2) * 500, y: 440 + Math.floor(index / 2) * 600, w: 470 };
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 540 + (index % 2) * 270, y: 126 + Math.floor(index / 2) * 300, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return { x: 1700 + (index % 2) * 440, y: 980 + Math.floor(index / 2) * 540, w: 420 };
  }
  return null;
}

function layoutV9DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return { x: 1340 + pipelineIndex * 430, y: 440 + renderIndex * 520, w: 410 };
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return { x: 1340 + (stepIndex - 1) * 440 + pipelineStepCount * 430, y: 440 + sameStepIndex * 520, w: 420 };
    }
    return { x: 1340 + pipelineStepCount * 430 + (index % 2) * 440, y: 440 + Math.floor(index / 2) * 540, w: 420 };
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return { x: 1340 + (index % 2) * 440, y: 440 + Math.floor(index / 2) * 540, w: 420 };
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return { x: 1340 + (index % 2) * 500, y: 440 + Math.floor(index / 2) * 600, w: 470 };
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 540 + (index % 2) * 270, y: 126 + Math.floor(index / 2) * 300, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return { x: 1340 + (index % 2) * 440, y: 980 + Math.floor(index / 2) * 540, w: 420 };
  }
  return null;
}

function compactOutputGridPosition(slot, group = 0, { width = 420, baseX = 960, baseY = 690, colGap = 470, rowGap = 540, groupGap = 1120 } = {}) {
  return {
    x: baseX + (slot % 2) * colGap,
    y: baseY + group * groupGap + Math.floor(slot / 2) * rowGap,
    w: width
  };
}

function compactCanvasOutputPosition(slot, group = 0, options = {}) {
  return compactOutputGridPosition(slot, group, {
    width: options.width || 420,
    baseX: options.baseX || 960,
    baseY: options.baseY || 430,
    colGap: options.colGap || 450,
    rowGap: options.rowGap || 360,
    groupGap: options.groupGap || 440
  });
}

function layoutV11DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return compactOutputGridPosition(pipelineIndex, renderIndex, { width: 410, baseX: 1220, baseY: 735, colGap: 450 });
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return compactOutputGridPosition(stepIndex - 1 + pipelineStepCount, sameStepIndex, { baseX: 1220, baseY: 735 });
    }
    return compactOutputGridPosition(pipelineStepCount, index, { baseX: 1220, baseY: 735 });
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return compactOutputGridPosition(index, 0, { baseX: 1220, baseY: 735 });
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return compactOutputGridPosition(index, 0, { width: 470, baseX: 1220, baseY: 735, colGap: 520, rowGap: 620 });
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 112 + (index % 2) * 270, y: 980 + Math.floor(index / 2) * 300, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return compactOutputGridPosition(index, 0, { baseX: 1580, baseY: 1010 });
  }
  return null;
}

function layoutV10DynamicNodePosition(id) {
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return compactOutputGridPosition(pipelineIndex, renderIndex, { width: 410, colGap: 450 });
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return compactOutputGridPosition(stepIndex - 1 + pipelineStepCount, sameStepIndex);
    }
    return compactOutputGridPosition(pipelineStepCount, index);
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return compactOutputGridPosition(index, 0);
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return compactOutputGridPosition(index, 0, { width: 470, colGap: 520, rowGap: 620 });
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 112 + (index % 2) * 270, y: 805 + Math.floor(index / 2) * 300, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return compactOutputGridPosition(index, 0, { baseY: 935 });
  }
  return null;
}

function defaultDynamicNodePosition(id) {
  const branchPosition = branchDynamicNodePosition(id);
  if (branchPosition) return branchPosition;
  const renderPipelineMatch = id.match(/^render(\d+)Pipeline(\d+)$/);
  const renderMatch = id.match(/^render(\d+)$/);
  const cadMatch = id.match(/^cad(\d+)$/);
  const whiteModelMatch = id.match(/^whiteModel(\d+)$/);
  const referenceMatch = id.match(/^reference(\d+)$/);
  const directionImageMatch = id.match(/^directionImage(\d+)$/);
  if (renderPipelineMatch) {
    const renderIndex = Number(renderPipelineMatch[1]);
    const pipelineIndex = Number(renderPipelineMatch[2]);
    return compactCanvasOutputPosition(pipelineIndex, renderIndex, {
      width: 410,
      baseX: 980,
      baseY: 430,
      colGap: 450,
      rowGap: 540,
      groupGap: 680
    });
  }
  if (renderMatch) {
    const index = Number(renderMatch[1]);
    const render = state.renders[index];
    const pipelineStepCount = renderPipelineImageSteps(render).length;
    if (isPlanWorkflowMode(render?.stepMode || render?.mode)) {
      const normalizedMode = normalizeClientMode(render.stepMode || render.mode);
      const stepIndex = planWorkflowSteps[normalizedMode]?.index || 1;
      const sameStepIndex = state.renders
        .slice(0, index)
        .filter((item) => normalizeClientMode(item?.stepMode || item?.mode) === normalizedMode && !branchParentForRender(item)).length;
      return compactCanvasOutputPosition(stepIndex - 1 + pipelineStepCount, sameStepIndex, {
        baseX: 980,
        baseY: 430,
        colGap: 450,
        rowGap: 540,
        groupGap: 680
      });
    }
    if (pipelineStepCount > 0) {
      return compactCanvasOutputPosition(pipelineStepCount, index, {
        baseX: 980,
        baseY: 430,
        colGap: 450,
        rowGap: 540,
        groupGap: 680
      });
    }
    return compactCanvasOutputPosition(index, 0, {
      baseX: 980,
      baseY: 430,
      colGap: 450,
      rowGap: 540,
      groupGap: 680
    });
  }
  if (cadMatch) {
    const index = Number(cadMatch[1]);
    return compactCanvasOutputPosition(index, 0, {
      baseX: 1420,
      baseY: 430,
      colGap: 450,
      rowGap: 500,
      groupGap: 600
    });
  }
  if (whiteModelMatch) {
    const index = Number(whiteModelMatch[1]);
    return compactCanvasOutputPosition(index, 0, {
      width: 470,
      baseX: 980,
      baseY: 1220,
      colGap: 510,
      rowGap: 600,
      groupGap: 700
    });
  }
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return { x: 120 + (index % 2) * 270, y: 1120 + Math.floor(index / 2) * 280, w: 250 };
  }
  if (directionImageMatch) {
    const index = Number(directionImageMatch[1]);
    return compactCanvasOutputPosition(index, 0, {
      baseX: 1340,
      baseY: 1260,
      colGap: 450,
      rowGap: 540,
      groupGap: 650
    });
  }
  return null;
}

function defaultPositionForNode(id) {
  return defaultDynamicNodePosition(id) || defaultNodePositions[id] || { x: 96, y: 96, w: 340 };
}

function previousPositionsForNode(id) {
  return [
    legacyDynamicNodePosition(id) || legacyNodePositions[id] || null,
    layoutV2DynamicNodePosition(id) || layoutV2NodePositions[id] || null,
    layoutV4DynamicNodePosition(id) || layoutV4NodePositions[id] || null,
    layoutV5DynamicNodePosition(id) || layoutV5NodePositions[id] || null,
    layoutV8DynamicNodePosition(id) || layoutV8NodePositions[id] || null,
    layoutV9DynamicNodePosition(id) || layoutV9NodePositions[id] || null,
    layoutV10DynamicNodePosition(id) || layoutV10NodePositions[id] || null,
    layoutV11DynamicNodePosition(id) || layoutV11NodePositions[id] || null,
    layoutV12DynamicNodePosition(id) || layoutV12NodePositions[id] || null
  ].filter(Boolean);
}

function shouldResetForCompactCanvasLayout(id) {
  return /^(brief|source|selection|references|resources|seriesAdvice|planWorkflow|command|think|render|cad|plan|direction\d+|render\d+(?:Pipeline\d+)?|cad\d+|whiteModel\d+|reference\d+|directionImage\d+)$/.test(String(id || ""));
}

function estimatedCanvasNodeHeight(id) {
  if (/^whiteModel\d+$/.test(String(id || ""))) return 560;
  if (/^(render\d+|directionImage\d+|cad\d+|render\d+Pipeline\d+)$/.test(String(id || ""))) return 390;
  if (/^reference\d+$/.test(String(id || ""))) return 230;
  if (id === "source") return hasVisiblePrimaryInput() && isPlanPaperMode(state.mode) ? 390 : 330;
  if (id === "resources") return 260;
  if (id === "references") return 250;
  if (id === "plan") return 210;
  if (/^direction\d+$/.test(String(id || ""))) return 190;
  return 180;
}

function sortCanvasPositionIds(ids) {
  return [...ids].sort((a, b) => {
    const posA = state.canvas.positions[a] || defaultPositionForNode(a);
    const posB = state.canvas.positions[b] || defaultPositionForNode(b);
    return (posA.x - posB.x) || (posA.y - posB.y) || String(a).localeCompare(String(b));
  });
}

function resolveDefaultCanvasPositionCollisions(ids) {
  const columns = [];
  let moved = false;
  sortCanvasPositionIds(ids).forEach((id) => {
    const pos = state.canvas.positions[id];
    if (!pos) return;
    const width = estimatedCanvasNodeWidth(id, pos.w || 320);
    const height = estimatedCanvasNodeHeight(id);
    let column = columns.find((item) => Math.abs(item.x - pos.x) < 90);
    if (!column) {
      column = { x: pos.x, bottom: -Infinity };
      columns.push(column);
    }
    const minY = column.bottom + 34;
    if (pos.y < minY) {
      pos.y = Math.round(minY);
      moved = true;
    }
    pos.x = Math.max(40, Math.min(pos.x, CANVAS_WORKSPACE_WIDTH - width - 40));
    pos.y = Math.max(40, Math.min(pos.y, CANVAS_WORKSPACE_HEIGHT - height - 40));
    column.bottom = pos.y + height;
  });
  return moved;
}

function normalizeCanvasLayoutPositions() {
  if (state.canvas.layoutVersion === CANVAS_LAYOUT_VERSION) return false;
  const shouldForceCompactLayout = Number(state.canvas.layoutVersion || 0) < 16;
  const migratedIds = [];
  Object.keys(state.canvas.positions || {}).forEach((id) => {
    const current = state.canvas.positions[id];
    if (
      (shouldForceCompactLayout && shouldResetForCompactCanvasLayout(id)) ||
      previousPositionsForNode(id).some((position) => sameCanvasPosition(current, position))
    ) {
      state.canvas.positions[id] = { ...defaultPositionForNode(id) };
      migratedIds.push(id);
    }
  });
  resolveDefaultCanvasPositionCollisions(migratedIds);
  state.canvas.layoutVersion = CANVAS_LAYOUT_VERSION;
  return true;
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

const projectTemplates = {
  "homestay-lobby": {
    mode: "designseries",
    spaceType: "精品民宿 / 小型酒店大堂",
    style: "地域材料、安静度假感、低照度灯光、可停留的公共空间",
    functions: "接待前台、等候休息、早餐/咖啡、行李暂存、壁炉或景观位、文创小陈列、通往客房和庭院的过渡。",
    constraints: "避免网红化和廉价装饰；保留建筑结构、开口、层高和在地材料线索。",
    command: "常用模板：民宿大堂。按一个完整精品民宿项目组织：入口抵达、接待前台、休息会客、早餐/咖啡、走廊过渡、材料节点。若生成多张图，必须分配为不同功能区和不同机位，统一地域材料、灯光和家具语言。"
  },
  "guest-suite": {
    mode: "designseries",
    spaceType: "精品酒店 / 民宿客房套房",
    style: "安静、舒适、自然材料、长住友好、细节完成度高",
    functions: "睡眠区、窗边休闲、书桌/工区、衣柜收纳、洗漱干区、浴室或泡池、入户行李区。",
    constraints: "避免过满软装；保持酒店运营可落地，动线清楚，清洁维护方便。",
    command: "常用模板：客房套房。生成同一套房的完整设计组图：卧室主视觉、窗边休息、书桌工区、卫浴/洗漱、入户收纳、细节节点。按出图数量自动选择最能表达空间价值的视角。"
  },
  "tea-room": {
    mode: "designseries",
    spaceType: "茶室 / 东方会客空间",
    style: "东方禅意、留白、木石纸感、低照度、克制仪式感",
    functions: "茶席、备水、收纳陈列、会客坐席、窗景/庭院、水景或端景。",
    constraints: "避免符号堆砌和古装化；用现代比例表达东方气质。",
    command: "常用模板：茶室。优先表达茶席、备水区、会客区、窗景/庭院、材料节点和灯光氛围；统一木、石、纸感、织物和器物陈列，镜头干净克制。"
  },
  restaurant: {
    mode: "designseries",
    spaceType: "餐厅 / 餐饮商业空间",
    style: "有品牌记忆点、动线清晰、照明分层、材料耐用",
    functions: "门头/入口、等候区、散座、卡座、包间、吧台/出餐、服务台、洗手间过渡。",
    constraints: "避免只做漂亮空场；必须体现运营动线、座位密度和服务效率。",
    command: "常用模板：餐厅。按餐饮项目完整表达：入口识别、主就餐区、卡座/包间、吧台或出餐口、服务动线、灯光材料节点。多张图必须覆盖不同消费场景。"
  },
  "retail-display": {
    mode: "designseries",
    spaceType: "商业展示 / 品牌零售",
    style: "品牌识别强、陈列清晰、重点照明、可转化",
    functions: "橱窗、入口主视觉、陈列岛、墙面展架、试用/体验、收银、仓储隐藏。",
    constraints: "避免展品杂乱；展示层级、客流动线和品牌墙必须明确。",
    command: "常用模板：商业展示。生成一个完整品牌零售/展厅系列：橱窗入口、主陈列、体验洽谈、收银服务、细节节点。统一品牌材料、灯光和陈列节奏。"
  },
  "plan-color": {
    mode: "plan-axonometric",
    spaceType: "平面图上色 / 彩平中间稿",
    style: "图纸清晰、材料分区明确、低饱和语义色块",
    functions: "保留原平面结构，表达墙体、地面、家具、开口和功能分区。",
    constraints: "不得移动、删除、重画或简化原图布局；不能生成无关人视角效果图。",
    command: "常用模板：平面图上色。把上传平面图作为硬约束底图，保持外轮廓、墙体、门窗、楼梯、固定洁具和主要家具脚印不变，只增加材料、色块、功能分区和可读性。"
  },
  "white-model-render": {
    mode: "whitemodel",
    spaceType: "白模转真实效果图",
    style: "真实材质、自然光、完整软装、建筑尺度准确",
    functions: "保留白模体块、视角、开口、层级和比例，补全材料、灯光、家具、环境和细节。",
    constraints: "不要改变模型体块和镜头；不要做成灰模截图或随机装饰。",
    command: "常用模板：白模转效果图。以白模截图为硬结构，保留体块、开口、层级、视角和比例，补充真实材质、光照、家具、绿化、软装和尺度细节。"
  },
  "material-replace": {
    mode: "materialreplace",
    spaceType: "材质替换 / 材料方案测试",
    style: "保留原空间，只替换指定材料系统",
    functions: "墙面、地面、顶面、柜体、家具、金属、石材、木饰面、织物等材质替换。",
    constraints: "不得改变几何、透视、物体位置、灯光方向和非目标区域。",
    command: "常用模板：材质替换。只替换用户点名或选区的材料、颜色、纹理、反射和工艺细节；保留空间几何、构图、家具位置、光向、阴影和非目标区域。"
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
  "2:1": [2, 1],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "16:9": [16, 9]
};
const PANORAMA_ASPECT_RATIO = "2:1";

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

const planToColoredPlanFixedPrompt = [
  "固定提示词：把上传的平面图生成彩色平面图。",
  "原图是硬布局底图，不是灵感参考；外轮廓、墙体线条/厚度、房间形状、房间相邻关系、门窗开口、门扇方向、楼梯、固定洁具、主要家具脚印、文字尺寸和图纸朝向都不能移动、删除、简化或重画。",
  "只允许在原有二维脚印上补充平面语义色块、功能分区、材质分区、轻量家具色彩、低饱和阴影和清晰标注感。",
  "默认保持严格俯视或正交；如果用户拖拽了纸张视角控制器，则按该纸张视角输出同一张平面彩平。无论视角如何，都不要做墙体挤出、轴测墙高模型或人视角效果图。彩色平面图要作为后续轴测图的输入中间稿。"
].join("\n");

const planToAxonometricViewFixedPrompt = [
  "固定提示词：把彩色平面图整理成高精度轴测图。",
  "原图是已经建立好空间语义的彩色平面图，不是重新设计的灵感参考；外轮廓、墙体、房间形状、门窗开口、楼梯、固定洁具、主要家具脚印、比例、尺度和空间层级都不能移动、删除、简化或重画。",
  "只允许在原有空间结构上重建为高精度轴测表达，重新组织镜头、正交/弱透视投影、体块层次、墙体高度、家具体量、材质和阴影，让结构更清晰，同时保留明确的三维透视纵深、近远关系、垂直墙面、厚度和体块压缩感。",
  "镜头必须使用稳定的轴测或弱透视斜俯视角；如果有拖拽视角控制器，就沿该角度整理画面，并匹配纸张的 yaw、tilt、裁切、近远边比例和取景偏移。整张图要完整可读，不要做人视角效果图，不要退回二维平面图，不要重新设计布局。"
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
    label: "平面图转彩色平面图",
    meaning: "使用固定提示词把平面图整理成彩色平面语义图，作为后续高精度轴测图和效果图链路的第一步。",
    referenceUse: "参考图只可用于材料、色彩和功能分区的表达，不得覆盖、替换或重新解释原始平面布局。",
    preserve: "严格保留外轮廓、墙体线条/厚度、房间形状、相邻关系、门窗开口、门扇方向、楼梯、固定洁具、主要家具脚印、文字尺寸和图纸朝向。",
    change: "只在原有二维脚印上生成彩色语义分区、材质分区、功能分区和轻量材质提示，输出可继续进入轴测图阶段的彩色平面图。"
  },
  "plan-axonometric-view": {
    label: "彩色平面图转轴测图",
    meaning: "把彩色平面图整理成高精度轴测图，保留布局、墙体、开口、家具脚印和空间层级，同时强化 3D 透视纵深。",
    referenceUse: "参考图可用于轴测图的材质、阴影、色彩和表达密度，但不得改变平面图的硬布局。",
    preserve: "保留彩色平面图的空间关系、墙体、开口、楼梯、家具脚印、比例和动线。",
    change: "把彩色平面图转成高精度轴测图，让结构层次、体块关系、材料、近大远小和空间秩序更清晰。"
  },
  "plan-render": {
    label: "轴测图转效果图",
    meaning: "把轴测图里的指定区域转成人视角效果图；优先按红框选区生成，未框选时自动选择最适合表达的明确功能区。",
    referenceUse: "参考图用于材料、色彩、灯光、家具语言、陈列和氛围，不覆盖轴测图建立的空间关系和功能区位置。",
    preserve: "保留轴测图的整体空间关系、红框选区或自动选定区域、功能区、主要陈列/家具逻辑和动线。",
    change: "只把选定区域翻译成人视角室内/建筑效果图，明确前中后景和镜头位置，并在输出记录里标明对应区域。"
  },
  "image-modeling": {
    label: "图片转CAD",
    meaning: "上传平面图、图纸截图或清晰线稿后，推荐先做白底图和 CAD 结构参考图，再导出可下载 CAD 线稿。",
    referenceUse: "原始图片是主输入；白底图用于清理背景，CAD 结构参考图用于让最终线稿更稳定。",
    preserve: "保留主要墙线、房间边界、开口、长直轮廓和图纸朝向。",
    change: "把图片或 CAD 结构参考图里的深色线段转换成可继续描底和清理的 DXF / SVG 文件。"
  },
  floorplan: {
    label: "轴测图转效果图",
    meaning: "旧版图纸入口已拆分；旧任务会提示推荐链路：平面图、彩色平面图、轴测图、效果图。",
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
  "design-derivation": {
    label: "设计元素推演与方案推导",
    meaning: "不急着出单张图，而是先把项目条件、参考图和画布素材拆解成可复用设计元素，再推导多套空间方案方向。",
    referenceUse: "参考图用于提炼元素来源：空间秩序、材料家族、灯光策略、色彩、家具语言、立面节奏、细部母题和项目气质。",
    preserve: "保留用户给定的项目目标、功能边界、预算/施工限制、品牌调性和关键参考图贡献点。",
    change: "输出元素谱系、设计逻辑、方案分叉、材料/灯光/动线组合和可继续出图的方向卡。"
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
  panorama: {
    label: "全景图生成",
    meaning: "生成 2:1 的 360 度环景图，优先保证水平连续、地平线稳定和无缝闭合，可直接用于 Pannellum 交互查看。",
    referenceUse: "参考图用于提炼空间结构、视高、材质系统、灯光情绪和全景连续性，不应把它们当成普通单视角照片。",
    preserve: "保留空间气质、主要开口、视高逻辑、材质语言和连续的环境关系。",
    change: "把空间扩展为可拖拽查看的无缝全景，而不是普通广角图。"
  },
  sketch: {
    label: "手稿生成实景",
    meaning: "把草图里的构图和空间意图翻译成真实效果图。",
    referenceUse: "参考图用于补足草图未表达的材料、家具、灯光和风格。",
    preserve: "保留草图的主构图、透视、体块关系和设计意图。",
    change: "把手绘表达转译成真实空间。"
  },
  colorgrade: {
    label: "调色",
    meaning: "本地像素级调色，不重新生成画面内容。",
    referenceUse: "参考图不参与本地调色。",
    preserve: "保留原图内容、构图、空间和对象。",
    change: "调整曝光、对比、高光、阴影、白场、黑场、色温、色调、饱和度和清晰度。"
  },
  cutout: {
    label: "抠图",
    meaning: "本地智能抠图，先识别候选主体图层，再由用户点击确认。",
    referenceUse: "参考图不参与本地抠图。",
    preserve: "保留被选中主体区域的原始像素。",
    change: "移除未选中区域并输出透明背景 PNG。"
  },
  crop: {
    label: "裁切",
    meaning: "本地裁切图片，先选比例，再拖动裁切框调整构图。",
    referenceUse: "参考图不参与本地裁切。",
    preserve: "保留裁切框内的像素内容。",
    change: "按选定比例裁切并输出新的图片版本。"
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
  "plan-axonometric": `专项优化：${planToColoredPlanFixedPrompt} ${planWorkflowRecommendationText}`,
  "plan-axonometric-view": `专项优化：${planToAxonometricViewFixedPrompt} ${planWorkflowRecommendationText}`,
  "plan-render": `专项优化：基于轴测图的明确区域生成人视角效果图；优先使用红框选区，未框选时自动选择最适合表达且与参考图最接近的功能区；必须标明结果来自哪个区域，并详细描述镜头位置、前景/中景/背景、陈列、灯具、材料和动线关系。${planWorkflowRecommendationText}`,
  "image-modeling": "专项优化：先识别主体/空间的大轮廓、比例、厚度、开口、重复构件和材料分区，再用参数化基础几何生成可旋转 3D 白模；输出优先可编辑和可导入 CAD，不追求照片级 mesh 复刻。",
  floorplan: `专项优化：旧版图纸入口已拆分。${planWorkflowRecommendationText}`,
  cad: "专项优化：优先提取长直结构线和主要轮廓，降低文字、家具符号、阴影和纹理干扰；输出作为可描底的第一版 CAD 线稿。",
  cadrender: "专项优化：CAD 线稿作为硬约束，先守住轴线、墙体、开口和房间关系，再补充高度、材质、灯光和家具；最终不能残留 CAD 线。",
  "design-derivation": "专项优化：先做设计元素推演和方案推导，不直接追求单图效果；把参考图和项目条件拆成元素谱系、设计逻辑、方案分叉、材料/灯光/动线组合、可落地风险和后续出图建议。",
  designseries: "专项优化：先把参考图归纳成一个项目的“系列圣经”：项目DNA、空间动线、场域清单、功能分区、材质系统、灯光系统、重复母题、镜头节奏和渲染质感；再把每张图分配为不同场域/功能/机位，例如入口主视觉、公共核心区、次级功能区、安静/私密空间、走廊过渡、材料节点。统一的是风格、材质、灯光、色彩、家具年代和渲染品质；变化的是空间场域、功能分区、镜头方向、视角距离和画面焦点。每张图必须有相邻空间衔接线索，比如门洞、走廊、窗景、同款家具、同一吊顶/墙地材/灯具语言；禁止同一个角度反复变体，禁止一张图换多种风格，禁止每张图重新发明一个新项目。",
  photo: "专项优化：保留现场透视、结构、窗洞、柱网和层高，只改完成面、家具、灯光、陈列和氛围，避免把现场空间改到不成立。",
  whitemodel: "专项优化：保留白模体块、视角、层级和开口，补足材料、灯光、环境和尺度；不要做成灰模截图或随机装饰。",
  panorama: "专项优化：输出 2:1 的 360 度 equirectangular 全景图，要求水平连续、地平线稳定、无缝闭合、没有重复接缝和拉伸极点；如果有参考图，重点吸收空间结构、视高、材料系统和灯光情绪。",
  sketch: "专项优化：保留草图的构图、透视、体块和设计意图，把模糊线条解析为可建造空间，而不是简单美化线稿。",
  colorgrade: "专项优化：本地调色只改变色彩和明暗观感，不改变内容、构图、材质结构或对象位置；适合做曝光、对比、高光、阴影、黑白场、色温、色调、饱和度和清晰度修正。",
  cutout: "专项优化：优先用 AI 视觉识别主体轮廓并生成淡蓝蒙版，再让用户点选确认；输出透明背景 PNG，保留选中主体原始细节。AI 不可用时自动回退本地候选。",
  crop: "专项优化：提供多种常用裁切比例，先锁定比例，再拖动裁切框调整画面重心，输出新的构图版本，适合做封面、社媒和版式前裁切。",
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
  "plan-axonometric": `${planToColoredPlanFixedPrompt}\n${planWorkflowRecommendationText}\n当前步骤先输出彩色平面图中间稿，不要提前做成轴测图或人视角效果图。`,
  "plan-axonometric-view": `${planToAxonometricViewFixedPrompt}\n${planWorkflowRecommendationText}\n当前步骤优先从彩色平面图整理成高精度轴测图，也可以兼容平面图作为输入，但不要直接做成人视角效果图。`,
  "plan-render": `目标：从轴测图的明确区域生成人视角效果图。优先使用我框选的红框区域；如果我没有框选，请自动选择与参考图最接近、最适合出图的一个功能区，并标明效果图来自哪个区域。保留整体空间关系、功能区位置、动线和主要家具/陈列逻辑；明确镜头站位、视线方向、前景/中景/背景、家具系统、墙顶地材料、灯具、色温和陈列密度；避免残留平面符号、不合理透视、整张平面图视角和无法判断区域来源。${planWorkflowRecommendationText}`,
  "image-modeling": "目标：图片转CAD。推荐链路是先生成白底主体图，再生成 CAD 结构参考图，最后从 CAD 结构参考图或原图提取墙线、房间边界、开口和长直轮廓，输出可下载的 DXF / SVG 描底文件。暂时不做 3D 建模、GLB、SCAD 或参数化模型。",
  "design-derivation": "目标：设计元素推演与方案推导。先读取项目条件、用户描述、主图、参考图和画布素材，把可用设计元素拆成空间秩序、材料家族、灯光策略、色彩关系、家具语言、立面节奏、细部母题和情绪关键词；再推导 3 套可落地方案方向，每套都要说明核心概念、元素来源、设计动作、材料/灯光/动线组合、适合生成的画面和风险控制。",
  designseries: "目标：从参考图生成同一项目的一套深层设计系列图。先识别每张参考图贡献的空间、材料、灯光、家具、色彩、构图和氛围，再建立同一套项目DNA、空间动线、场域清单、功能分区、重复母题和渲染语言；每张图必须承担不同场域/功能/机位，例如入口主视觉、公共核心区、次级功能区、安静/私密空间、走廊过渡、材料节点。统一的是风格、材质、灯光、色彩、家具年代、设计团队语言和渲染品质；变化的是空间场景、功能分区、视角距离、镜头方向和焦点内容。避免同一个角度反复变体、单一主视觉多版本、拼贴感、单张孤立感和风格漂移。",
  cad: "目标：平面图图片转CAD/SVG底图。优先提取墙体主线、房间边界、开口和长直轮廓；忽略阴影、纹理、家具装饰、照片噪点和无关文字；输出适合继续描底的第一版结构线稿。",
  cadrender: "目标：CAD或图纸线稿转真实空间效果图。把轴线、墙体、开口、房间关系和尺度作为硬约束，再补充层高、材料、灯光、家具和陈列；最终画面不能保留CAD线条或图纸符号。",
  photo: "目标：现场图改造效果图。保留现场透视、结构、窗洞、柱网、层高、墙面边界和主要空间体量；只改完成面、家具、灯光、陈列和氛围；避免移动开口、改变消失点或把现场替换成另一间房。",
  whitemodel: "目标：白模润色成真实设计表现。保留白模体块、视角、层级、开口、比例和空间关系；补充真实材质、灯光、环境、家具和尺度细节；避免灰模截图感、随机装饰和不合理构造。",
  panorama: "目标：生成 2:1 的 360 度全景图，保证连续环绕、无缝拼接、地平线稳定和空间逻辑一致；避免单视角照片感、极端拉伸和重复接缝。",
  sketch: "目标：手稿/草图转真实空间。保留草图构图、透视、主要体块、开口和设计意图；把含糊线条解析成可建造的建筑/室内元素，并补充材料、光线和尺度；避免只美化线稿或丢失原设计想法。",
  colorgrade: "目标：调色。保留原图所有内容、构图和对象，只调整曝光、对比、高光、阴影、白色、黑色、色温、色调、饱和度和清晰度，输出更适合提案展示的观感版本。",
  cutout: "目标：抠图。先用 AI 视觉识别主体并描绘大致轮廓，再让用户点击确认要抠出的区域，最终输出透明背景 PNG。",
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

function hasCustomGenerationInput() {
  return Boolean(
    (state.canvasCommandUserEdited && currentCanvasUserPrompt()) ||
    state.primaryImage ||
    activeReferenceImages().length ||
    state.selectedScenePreset ||
    state.selectedProjectTemplate ||
    state.selectedStylePreset
  );
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

const promptPresetUnsupportedModes = new Set(["cad", "colorgrade", "cutout", "image-modeling", "sharpen", "upscale"]);
const customNonSpatialArtifactPattern = /(产品|包装|海报|广告图|banner|封面|主视觉|字体|字形|排版|logo|标志|图标|icon|ui|界面|网页|小程序|app|信息图|流程图|图表|diagram|infographic|ppt|slide|名片|菜单|画册|社媒|角色|character|贴纸|表情包|mockup|poster|typography|product)/i;
const customSpatialArtifactPattern = /(空间|室内|建筑|景观|立面|外立面|效果图|渲染图|平面|户型|轴测|鸟瞰|全景|房间|客厅|卧室|餐厅|厨房|卫生间|门厅|展厅|店铺|门店|零售|商业|酒店|民宿|办公|办公室|住宅|公寓|别墅|样板间|施工|cad|white model|白模|sketch|草图|render|interior|architecture)/i;
const customAntiSpatialArtifactPattern = /(无|不要|不需要|不用|非|不是|避免|禁止|不要做|不做).{0,8}(空间|室内|建筑|场景|效果图|渲染图)|(空间|室内|建筑|场景|效果图|渲染图).{0,8}(无|不要|不需要|不用|非|不是|避免|禁止|不要做|不做)/i;

function customPromptRequestsNonSpatialArtifact(mode = state.mode) {
  if (normalizeClientMode(mode) !== "custom") return false;
  const brief = readBrief();
  const userPrompt = state.canvasCommandUserEdited ? currentCanvasUserPrompt() : "";
  const text = [
    userPrompt,
    brief.spaceType,
    brief.functions,
    brief.deliveryPurpose
  ].filter(Boolean).join(" ");
  const antiSpatial = customAntiSpatialArtifactPattern.test(text);
  return customNonSpatialArtifactPattern.test(text) && (!customSpatialArtifactPattern.test(text) || antiSpatial);
}

function modeAllowsScenePreset(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (promptPresetUnsupportedModes.has(normalized)) return false;
  if (customPromptRequestsNonSpatialArtifact(normalized)) return false;
  return true;
}

function modeAllowsStylePreset(mode = state.mode) {
  return !promptPresetUnsupportedModes.has(normalizeClientMode(mode));
}

function promptPresetRiskNotes(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  const notes = [];
  const hasScenePrompt = Boolean(state.selectedScenePreset || state.selectedProjectTemplate || state.promptContext?.scenePreset);
  const hasStylePrompt = Boolean(state.selectedStylePreset || state.promptContext?.stylePreset);
  if (promptPresetUnsupportedModes.has(normalized) && hasScenePrompt) {
    notes.push("当前能力不使用场景模板，旧场景/项目模板已从最终提示词过滤");
  }
  if (promptPresetUnsupportedModes.has(normalized) && hasStylePrompt) {
    notes.push("当前能力不使用风格预设，旧风格预设已从最终提示词过滤");
  }
  if (customPromptRequestsNonSpatialArtifact(normalized) && hasScenePrompt) {
    notes.push("自定义需求更像非空间产物，已忽略场景/项目模板，避免变成室内效果图");
  }
  if (customPromptRequestsNonSpatialArtifact(normalized) && hasStylePrompt) {
    notes.push("风格预设仅按低优先级审美参考使用，不覆盖当前产物类型");
  }
  return notes;
}

function clearPromptPresetStateForModeChange() {
  state.selectedScenePreset = null;
  state.selectedProjectTemplate = null;
  state.selectedStylePreset = null;
  clearHiddenPromptContext("scenePreset");
  clearHiddenPromptContext("stylePreset");
  clearHiddenPromptContext("panelContext");
  clearHiddenPromptContext("quickIntent");
  clearSystemCanvasCommand();
}

function hiddenCanvasPromptText(overrides = {}) {
  const mode = normalizeClientMode(overrides.mode || state.mode);
  return [
    overrides.modePreset ?? state.promptContext?.modePreset,
    modeAllowsScenePreset(mode) ? state.promptContext?.scenePreset : "",
    modeAllowsStylePreset(mode) ? state.promptContext?.stylePreset : "",
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
    hiddenCanvasPromptBlock({ mode: options.mode || state.mode, modePreset: options.modePresetOverride }),
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

function taskLogScopedApiPath(path) {
  const selectedClientId = state.auth?.viewingClientId || "";
  const separator = path.includes("?") ? "&" : "?";
  const base = `${path}${separator}clientId=${encodeURIComponent(state.clientId)}`;
  return selectedClientId ? `${base}&userClientId=${encodeURIComponent(selectedClientId)}` : base;
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
      if (data.status === "success") {
        updateActiveTask({ phase: "保存结果", event: "后台生成完成，正在同步结果" });
        return normalizeRecoverableApiResult(path, data.result);
      }
      if (data.status === "failed") {
        const detail = data.error?.details?.error?.message || data.error?.details?.message || data.error?.message || "后台任务失败";
        throw new Error(detail);
      }
      updateActiveTask({ phase: "后台生图中" });
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
      phase: "后台生图中",
      event: "连接中断，正在等待后台生成结果"
    });
    toast("连接中断，正在等待后台结果");
    const data = await pollTaskResult(path, clientTaskId);
    refreshHealth();
    refreshTaskLogs({ silent: true });
    return data;
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.activeImageBaseUrl = data.imageBaseUrl || "";
    state.runtimeProviders = data.runtimeProviders || state.runtimeProviders;
    state.storageSettings = data.storage || state.storageSettings;
    state.imageStudioEngine = data.imageStudioEngine || state.imageStudioEngine;
    state.imageStudioFhlSkill = data.imageStudioFhlSkill || state.imageStudioFhlSkill;
    const reasoningReady = data.reasoningConfigured ?? data.keyConfigured;
    const imageReady = data.imageConfigured ?? data.keyConfigured;
    const apiDisplayLabel = [
      data.reasoningBaseUrl ? `思考 ${shortEndpoint(data.reasoningBaseUrl)}` : "",
      data.imageBaseUrl ? `生图 ${shortEndpoint(data.imageBaseUrl)}` : ""
    ].filter(Boolean).join(" / ");
    const imageBackendLabel = data.imageBackend === "responses-image-generation-tool"
      ? "Image Gen"
      : data.imageBackend === "openai-compatible-images-api"
        ? "Images API"
        : "Image";
    state.apiReady = Boolean(reasoningReady && imageReady);
    els.modelStatus.textContent = reasoningReady && imageReady
      ? (apiDisplayLabel ? `AI · ${apiDisplayLabel}` : "AI 就绪")
      : reasoningReady || imageReady
        ? "服务配置待检查"
        : "服务未配置";
    els.modelStatus.title = reasoningReady && imageReady
      ? (friendExperienceMode ? `AI 服务已连接：${apiDisplayLabel || "--"}` : `思考：${data.reasoningBaseUrl || "--"}；生图：${data.imageBaseUrl || "--"}；后端：${data.imageBackend || imageBackendLabel}`)
      : els.modelStatus.textContent;
    els.modelStatus.className = `status-pill ${reasoningReady && imageReady ? "ready" : "error"}`;
    renderApiSettings();
    renderTaskProgressPanel();
    applyFriendExperienceUi();
  } catch {
    state.apiReady = false;
    els.modelStatus.textContent = "服务未连接";
    els.modelStatus.title = "服务未连接";
    els.modelStatus.className = "status-pill error";
    applyFriendExperienceUi();
  }
}

async function refreshApiSettings({ silent = false } = {}) {
  try {
    const data = await requestJson("/api/settings");
    const settings = data.settings || {};
    state.runtimeProviders = settings.providers || state.runtimeProviders;
    state.storageSettings = settings.storage || state.storageSettings;
    state.providerProbes = settings.providerProbes || state.providerProbes;
    state.activeImageBaseUrl = settings.activeImageBaseUrl || state.activeImageBaseUrl;
    state.imageStudioEngine = settings.imageStudioEngine || state.imageStudioEngine;
    state.imageStudioFhlSkill = settings.imageStudioFhlSkill || state.imageStudioFhlSkill;
    state.canManageApiSettings = settings.canManageSettings !== false;
    renderLocalApiSettings(settings);
    renderApiSettings();
    renderStorageSettings(settings.storage);
    renderStorageAccess();
    maybeShowFirstRunStoragePrompt();
    if (!silent) toast("API 设置已刷新");
  } catch (error) {
    if (!silent) toast(error.message);
  }
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

function apiSettingsManageMessage() {
  return "公网访问不能修改 API 设置，请在本机 localhost 打开后修改。";
}

function ensureCanManageApiSettings() {
  if (state.canManageApiSettings) return true;
  toast(apiSettingsManageMessage());
  return false;
}

function renderApiSettingsAccess() {
  const disabled = !state.canManageApiSettings;
  [
    els.reasoningApiBaseUrl,
    els.reasoningApiModel,
    els.reasoningApiKey,
    els.primaryImageApiBaseUrl,
    els.primaryImageApiModel,
    els.primaryImageApiMode,
    els.primaryImageImagesNewApiCompat,
    els.primaryImageResponsesTransport,
    els.primaryImageRequestPolicy,
    els.primaryImageReasoningEffort,
    els.primaryImageApiResponsesPath,
    els.primaryImageApiGenerationPath,
    els.primaryImageApiEditPath,
    els.primaryImageProviderManifest,
    els.primaryImageApiKey,
    els.saveReasoningApiSettingsButton,
    els.saveImageApiSettingsButton,
    els.probeReasoningApiButton,
    els.probePrimaryImageApiButton
  ].forEach((control) => {
    if (control) control.disabled = disabled;
  });
}

function apiProviderLabel(kind) {
  return kind === "image" ? "生图" : "思考";
}

function compactApiProbeMessage(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function apiProbeElapsedText(probe) {
  const ms = Number(probe?.ms);
  return Number.isFinite(ms) && ms > 0 ? `${Math.round(ms)}ms` : "";
}

function apiProviderProbeSummary(kind, probe) {
  if (!probe) return "";
  const label = apiProviderLabel(kind);
  const elapsed = apiProbeElapsedText(probe);
  const status = probe.ok ? "连接成功" : "检测失败";
  const message = probe.modelListed === false
    ? `模型列表未看到 ${probe.model || "当前模型"}`
    : probe.message || "";
  return [
    `${label}${status}`,
    elapsed,
    compactApiProbeMessage(message, probe.ok ? 48 : 64)
  ].filter(Boolean).join(" · ");
}

function apiProviderProbeToast(kind, probe) {
  const label = apiProviderLabel(kind);
  const elapsed = apiProbeElapsedText(probe);
  if (probe?.ok) {
    const modelHint = probe.modelListed === false ? "，但模型未出现在列表中" : "";
    return `${label} API 连接成功${elapsed ? ` · ${elapsed}` : ""}${modelHint}`;
  }
  return `${label} API 检测失败${elapsed ? ` · ${elapsed}` : ""}：${compactApiProbeMessage(probe?.message || "请求失败", 96)}`;
}

function apiProbeStatusInfo(probe, busy = false) {
  if (busy) return { label: "检测中", className: "warning" };
  if (probe?.ok) return { label: "连接成功", className: "available" };
  if (probe) return { label: "检测失败", className: "error" };
  return { label: "未检测", className: "unknown" };
}

function localApiProbeFallbackBaseUrl(kind) {
  if (kind === "image") {
    return els.primaryImageApiBaseUrl?.value.trim() || state.runtimeProviders?.image?.baseUrl || "";
  }
  return els.reasoningApiBaseUrl?.value.trim() || state.runtimeProviders?.reasoning?.baseUrl || "";
}

function apiProviderProbeDetail(kind, probe, busy = false) {
  const baseUrl = probe?.baseUrl || localApiProbeFallbackBaseUrl(kind);
  if (busy) return baseUrl ? `正在连接 ${shortEndpoint(baseUrl)}` : "正在检测连接";
  if (!probe) return "点击检测后会在这里显示连接结果";
  const parts = [
    baseUrl ? shortEndpoint(baseUrl) : "",
    probe.model || "",
    apiProbeElapsedText(probe),
    formatEndpointCheckedAt(probe.checkedAt),
    probe.modelListed === false ? `模型列表未看到 ${probe.model || "当前模型"}` : compactApiProbeMessage(probe.message || "", 72)
  ].filter(Boolean);
  return parts.join(" · ");
}

function runtimeProviderConnectionDetail(kind, provider = {}, probe = null) {
  const baseUrl = provider.baseUrl || "";
  const model = provider.model || (kind === "image" ? "gpt-image-2" : "gpt-5.5");
  const keyText = provider.configured ? "Key 已保存" : "未保存 Key";
  const probeText = probe
    ? apiProviderProbeDetail(kind, probe, false)
    : "尚未检测连接";
  return [
    baseUrl ? shortEndpoint(baseUrl) : "未填写 Base URL",
    model,
    keyText,
    probeText
  ].filter(Boolean).join(" · ");
}

function imageStudioKernelStatusInfo(skill = null) {
  if (!skill) return { label: "未读取", className: "unknown" };
  if (!skill.enabled) return { label: "已停用", className: "disabled" };
  if (!skill.available && skill.required) return { label: "引擎缺失", className: "error" };
  if (!skill.available) return { label: "引擎未找到", className: "warning" };
  return { label: "内置可用", className: "available" };
}

function renderImageStudioKernel() {
  if (!els.imageStudioKernelSummary && !els.imageStudioKernelStatus) return;
  const engine = state.imageStudioEngine || state.imageStudioFhlSkill || null;
  const imageProvider = state.runtimeProviders?.image || {};
  const reasoningProvider = state.runtimeProviders?.reasoning || {};
  const statusInfo = imageStudioKernelStatusInfo(engine);
  const modeLabel = engine?.mode === "required" ? "软件内核必经" : engine?.mode === "optional" ? "可选引擎" : engine?.mode || "--";
  const providerLabel = engine?.required ? "required" : "optional";
  const configLabel = imageProvider.baseUrl ? shortEndpoint(imageProvider.baseUrl) : "--";
  const routeLabel = [
    imageProvider.apiMode || "",
    imageProvider.responsesTransport || ""
  ].filter(Boolean).join(" · ") || "--";
  const modelLabel = [
    imageProvider.model || "gpt-image-2",
    reasoningProvider.model || ""
  ].filter(Boolean).join(" / ");
  if (els.imageStudioKernelStatus) {
    els.imageStudioKernelStatus.textContent = statusInfo.label;
    els.imageStudioKernelStatus.className = `api-endpoint-status ${statusInfo.className}`;
  }
  if (els.imageStudioKernelSummary) {
    els.imageStudioKernelSummary.innerHTML = `
      <div><span>调用模式</span><strong>${escapeHtml(modeLabel)}</strong><small>${escapeHtml(`engine ${providerLabel}`)}</small></div>
      <div><span>项目 API 配置</span><strong>${escapeHtml(configLabel)}</strong><small>${escapeHtml(routeLabel)}</small></div>
      <div><span>模型</span><strong>${escapeHtml(modelLabel)}</strong><small>${escapeHtml(engine?.available ? "go-cli 已找到" : "go-cli 未找到")}</small></div>
    `;
  }
  if (els.imageStudioKernelHint) {
    if (!engine?.available && engine?.required) {
      els.imageStudioKernelHint.textContent = "未找到 Image Studio go-cli 引擎；当前软件生图中枢不可用，请检查打包资源或 IMAGE_STUDIO_CLI_PATH。";
    } else if (!engine?.available) {
      els.imageStudioKernelHint.textContent = "未找到 Image Studio go-cli；可选模式下会使用开发后备或原生通道。";
    } else {
      els.imageStudioKernelHint.textContent = "已找到 Image Studio go-cli；朋友电脑上会使用老鬼AI设置中保存的 Base URL、Key 和模型驱动这个引擎。";
    }
  }
}

function renderLocalApiConnectionStatus() {
  if (!els.localApiConnectionStatus) return;
  const providers = state.runtimeProviders || {};
  els.localApiConnectionStatus.innerHTML = ["reasoning", "image"].map((kind) => {
    const provider = providers[kind] || {};
    const probe = state.providerProbes?.[kind] || null;
    const configured = Boolean(provider.configured);
    const statusInfo = probe
      ? apiProbeStatusInfo(probe, false)
      : configured
        ? { label: "已保存，未检测", className: "warning" }
        : { label: "未配置", className: "unknown" };
    return `
      <div class="api-probe-card ${escapeAttr(statusInfo.className)}">
        <div>
          <strong>${escapeHtml(apiProviderLabel(kind))} API</strong>
          <small>${escapeHtml(runtimeProviderConnectionDetail(kind, provider, probe))}</small>
        </div>
        <span class="api-endpoint-status ${escapeAttr(statusInfo.className)}">${escapeHtml(statusInfo.label)}</span>
      </div>
    `;
  }).join("");
}

function renderLocalApiProbeFeedback() {
  if (!els.localApiProbeFeedback) return;
  els.localApiProbeFeedback.innerHTML = ["reasoning", "image"].map((kind) => {
    const probe = state.providerProbes?.[kind] || null;
    const busy = Boolean(state.providerProbeBusy?.[kind]);
    const statusInfo = apiProbeStatusInfo(probe, busy);
    return `
      <div class="api-probe-card ${escapeAttr(statusInfo.className)}">
        <div>
          <strong>${escapeHtml(apiProviderLabel(kind))} API</strong>
          <small>${escapeHtml(apiProviderProbeDetail(kind, probe, busy))}</small>
        </div>
        <span class="api-endpoint-status ${escapeAttr(statusInfo.className)}">${escapeHtml(statusInfo.label)}</span>
      </div>
    `;
  }).join("");
}

function setImageApiProbeFeedback(feedback = null) {
  state.imageApiProbeFeedback = feedback;
  renderImageApiProbeFeedback();
}

function renderImageApiProbeFeedback() {
  if (!els.imageApiProbeFeedback) return;
  const feedback = state.imageApiProbeFeedback;
  if (!feedback) {
    els.imageApiProbeFeedback.innerHTML = "";
    return;
  }
  const statusInfo = apiProbeStatusInfo(feedback.ok === true ? { ok: true } : feedback.ok === false ? { ok: false } : null, feedback.busy);
  els.imageApiProbeFeedback.innerHTML = `
    <div class="api-probe-card ${escapeAttr(statusInfo.className)}">
      <div>
        <strong>${escapeHtml(feedback.title || "端点检测")}</strong>
        <small>${escapeHtml(feedback.detail || "")}</small>
      </div>
      <span class="api-endpoint-status ${escapeAttr(statusInfo.className)}">${escapeHtml(feedback.status || statusInfo.label)}</span>
    </div>
  `;
}

function manifestToTextareaValue(manifest) {
  return manifest ? JSON.stringify(manifest, null, 2) : "";
}

function readManifestTextareaValue(control) {
  const raw = control?.value.trim() || "";
  if (!raw) return { providerManifest: null };
  try {
    return { providerManifest: JSON.parse(raw) };
  } catch {
    throw new Error("Provider Manifest 不是有效 JSON");
  }
}

function renderLocalApiSettings(settings = {}) {
  const providers = settings.providers || state.runtimeProviders || {};
  state.runtimeProviders = providers;
  if (settings.storage) state.storageSettings = settings.storage;
  if (settings.imageStudioEngine) state.imageStudioEngine = settings.imageStudioEngine;
  if (settings.imageStudioFhlSkill) state.imageStudioFhlSkill = settings.imageStudioFhlSkill;
  state.providerProbes = settings.providerProbes || state.providerProbes || {};
  const reasoning = providers.reasoning || {};
  const image = providers.image || {};
  if (els.reasoningApiBaseUrl && !els.reasoningApiBaseUrl.value) els.reasoningApiBaseUrl.value = reasoning.baseUrl || "";
  if (els.reasoningApiModel && !els.reasoningApiModel.value) els.reasoningApiModel.value = reasoning.model || "";
  if (els.primaryImageApiBaseUrl && !els.primaryImageApiBaseUrl.value) els.primaryImageApiBaseUrl.value = image.baseUrl || "";
  if (els.primaryImageApiModel && !els.primaryImageApiModel.value) els.primaryImageApiModel.value = image.model || "";
  if (els.primaryImageApiMode) els.primaryImageApiMode.value = image.apiMode || "responses";
  if (els.primaryImageImagesNewApiCompat) els.primaryImageImagesNewApiCompat.value = image.imagesNewApiCompat === false ? "false" : "true";
  if (els.primaryImageResponsesTransport) els.primaryImageResponsesTransport.value = image.responsesTransport || "sse";
  if (els.primaryImageRequestPolicy) els.primaryImageRequestPolicy.value = image.requestPolicy || "openai";
  if (els.primaryImageReasoningEffort) els.primaryImageReasoningEffort.value = image.reasoningEffort || "xhigh";
  if (els.primaryImageApiResponsesPath && !els.primaryImageApiResponsesPath.value) {
    els.primaryImageApiResponsesPath.value = image.responsesPath || defaultImageResponsesPathForBaseUrl(image.baseUrl);
  }
  if (els.primaryImageApiGenerationPath && !els.primaryImageApiGenerationPath.value) els.primaryImageApiGenerationPath.value = image.imageGenerationPath || "/v1/images/generations";
  if (els.primaryImageApiEditPath && !els.primaryImageApiEditPath.value) els.primaryImageApiEditPath.value = image.imageEditPath || "/v1/images/edits";
  if (els.primaryImageProviderManifest && !els.primaryImageProviderManifest.value) els.primaryImageProviderManifest.value = manifestToTextareaValue(image.providerManifest);
  if (els.localApiSettingsSummary) {
    const dataDir = settings.dataDir ? ` · 数据目录：${settings.dataDir}` : "";
    const reasoningText = reasoning.configured ? "思考 Key 已保存" : "未保存思考 Key";
    const imageText = image.configured ? "生图 Key 已保存" : "未保存生图 Key";
    const probeText = ["reasoning", "image"]
      .map((kind) => apiProviderProbeSummary(kind, state.providerProbes?.[kind]))
      .filter(Boolean)
      .join("；");
    els.localApiSettingsSummary.textContent = [reasoningText, imageText, probeText]
      .filter(Boolean)
      .join("；") + dataDir;
  }
  renderLocalApiProbeFeedback();
  renderLocalApiConnectionStatus();
  renderImageStudioKernel();
}

async function saveRuntimeProvider(kind, payload) {
  const data = await requestJson("/api/settings/providers", {
    method: "POST",
    body: JSON.stringify({ kind, ...payload })
  });
  state.runtimeProviders = data.settings?.providers || state.runtimeProviders;
  state.providerProbes = data.settings?.providerProbes || state.providerProbes;
  state.activeImageBaseUrl = data.settings?.activeImageBaseUrl || state.activeImageBaseUrl;
  renderLocalApiSettings(data.settings || {});
  renderApiSettings();
  return data;
}

function runtimeProviderProbePayload(kind) {
  const saved = state.runtimeProviders?.[kind] || {};
  if (kind === "image") {
    const apiKey = els.primaryImageApiKey?.value.trim() || "";
    return {
      kind,
      baseUrl: els.primaryImageApiBaseUrl?.value.trim() || saved.baseUrl || "",
      model: els.primaryImageApiModel?.value.trim() || saved.model || "gpt-image-2",
      apiMode: els.primaryImageApiMode?.value || saved.apiMode || "responses",
      imagesNewApiCompat: els.primaryImageImagesNewApiCompat?.value !== "false",
      responsesTransport: els.primaryImageResponsesTransport?.value || saved.responsesTransport || "sse",
      requestPolicy: els.primaryImageRequestPolicy?.value || saved.requestPolicy || "openai",
      reasoningEffort: els.primaryImageReasoningEffort?.value || saved.reasoningEffort || "xhigh",
      responsesPath: els.primaryImageApiResponsesPath?.value.trim() || saved.responsesPath || defaultImageResponsesPathForBaseUrl(els.primaryImageApiBaseUrl?.value.trim() || saved.baseUrl),
      imageGenerationPath: els.primaryImageApiGenerationPath?.value.trim() || saved.imageGenerationPath || "/v1/images/generations",
      imageEditPath: els.primaryImageApiEditPath?.value.trim() || saved.imageEditPath || "/v1/images/edits",
      ...readManifestTextareaValue(els.primaryImageProviderManifest),
      ...(apiKey ? { apiKey } : {})
    };
  }
  const apiKey = els.reasoningApiKey?.value.trim() || "";
  return {
    kind,
    baseUrl: els.reasoningApiBaseUrl?.value.trim() || saved.baseUrl || "",
    model: els.reasoningApiModel?.value.trim() || saved.model || "gpt-5.5",
    ...(apiKey ? { apiKey } : {})
  };
}

function currentReasoningApiPayload() {
  return {
    baseUrl: els.reasoningApiBaseUrl?.value.trim() || "",
    model: els.reasoningApiModel?.value.trim() || "gpt-5.5",
    apiKey: els.reasoningApiKey?.value.trim() || ""
  };
}

function currentImageApiPayload() {
  const payload = {
    baseUrl: els.primaryImageApiBaseUrl?.value.trim() || "",
    model: els.primaryImageApiModel?.value.trim() || "gpt-image-2",
    apiMode: els.primaryImageApiMode?.value || "responses",
    imagesNewApiCompat: els.primaryImageImagesNewApiCompat?.value !== "false",
    responsesTransport: els.primaryImageResponsesTransport?.value || "sse",
    requestPolicy: els.primaryImageRequestPolicy?.value || "openai",
    reasoningEffort: els.primaryImageReasoningEffort?.value || "xhigh",
    responsesPath: els.primaryImageApiResponsesPath?.value.trim() || defaultImageResponsesPathForBaseUrl(els.primaryImageApiBaseUrl?.value.trim()),
    imageGenerationPath: els.primaryImageApiGenerationPath?.value.trim() || "/v1/images/generations",
    imageEditPath: els.primaryImageApiEditPath?.value.trim() || "/v1/images/edits",
    apiKey: els.primaryImageApiKey?.value.trim() || ""
  };
  Object.assign(payload, readManifestTextareaValue(els.primaryImageProviderManifest));
  return payload;
}

function runtimeProviderProbeReady(kind, payload) {
  const saved = state.runtimeProviders?.[kind] || {};
  return Boolean(payload.baseUrl && (payload.apiKey || saved.configured));
}

async function postRuntimeProviderProbe(payload) {
  const response = await fetch("/api/settings/providers/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details?.error?.message || data?.details?.message || data?.error || "请求失败";
    const error = new Error(detail);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function applyProbeSettings(data = {}) {
  const settings = data.settings || {};
  if (settings.providers) state.runtimeProviders = settings.providers;
  if (settings.imageStudioEngine) state.imageStudioEngine = settings.imageStudioEngine;
  if (settings.imageStudioFhlSkill) state.imageStudioFhlSkill = settings.imageStudioFhlSkill;
  if (settings.providerProbes) state.providerProbes = settings.providerProbes;
  state.activeImageBaseUrl = settings.activeImageBaseUrl || data.imageBaseUrl || state.activeImageBaseUrl;
  if ("canManageSettings" in settings) state.canManageApiSettings = settings.canManageSettings !== false;
}

async function probeRuntimeProvider(kind) {
  if (!ensureCanManageApiSettings()) return false;
  const label = apiProviderLabel(kind);
  const button = kind === "image" ? els.probePrimaryImageApiButton : els.probeReasoningApiButton;
  let payload;
  try {
    payload = runtimeProviderProbePayload(kind);
  } catch (error) {
    toast(error.message);
    return false;
  }
  if (!runtimeProviderProbeReady(kind, payload)) {
    toast(`请先填写${label} API Base URL 和 Key，或先保存已配置的 Key`);
    if (els.localApiSettingsSummary) els.localApiSettingsSummary.textContent = `${label} API 等待 Base URL 和 Key 后再检测。`;
    state.providerProbes = {
      ...(state.providerProbes || {}),
      [kind]: {
        ok: false,
        kind,
        status: "error",
        baseUrl: payload.baseUrl,
        model: payload.model,
        responsesPath: payload.responsesPath || "",
        checkedAt: new Date().toISOString(),
        message: "缺少 Base URL 或 API Key"
      }
    };
    renderLocalApiProbeFeedback();
    return false;
  }

  setBusy(button, true, "检测中");
  state.providerProbeBusy = { ...(state.providerProbeBusy || {}), [kind]: true };
  renderLocalApiProbeFeedback();
  if (els.localApiSettingsSummary) els.localApiSettingsSummary.textContent = `${label} API 正在检测连接...`;
  toast(`${label} API 开始检测`);
  try {
    const data = await postRuntimeProviderProbe(payload);
    const probe = data.probe || {
      ok: false,
      kind,
      status: "error",
      baseUrl: payload.baseUrl,
      model: payload.model,
      responsesPath: payload.responsesPath || "",
      checkedAt: new Date().toISOString(),
      message: data.error || "检测失败"
    };
    applyProbeSettings(data);
    state.providerProbes = { ...(state.providerProbes || {}), [kind]: probe };
    renderLocalApiSettings(data.settings || {});
    renderApiSettings();
    refreshHealth();
    toast(apiProviderProbeToast(kind, probe));
    return Boolean(probe.ok);
  } catch (error) {
    const probe = {
      ok: false,
      kind,
      status: "error",
      baseUrl: payload.baseUrl,
      model: payload.model,
      responsesPath: payload.responsesPath || "",
      checkedAt: new Date().toISOString(),
      message: error.message || "检测失败"
    };
    state.providerProbes = { ...(state.providerProbes || {}), [kind]: probe };
    renderLocalApiSettings({ providers: state.runtimeProviders, providerProbes: state.providerProbes });
    toast(apiProviderProbeToast(kind, probe));
    return false;
  } finally {
    state.providerProbeBusy = { ...(state.providerProbeBusy || {}), [kind]: false };
    renderLocalApiProbeFeedback();
    setBusy(button, false);
    renderApiSettingsAccess();
  }
}

async function saveReasoningApiSettings() {
  if (!ensureCanManageApiSettings()) return;
  const reasoningPayload = currentReasoningApiPayload();
  const savedReasoning = state.runtimeProviders?.reasoning || {};
  if (!reasoningPayload.baseUrl || (!reasoningPayload.apiKey && !savedReasoning.configured)) {
    toast("请填写思考 API 的 Base URL 和 Key");
    return;
  }
  setBusy(els.saveReasoningApiSettingsButton, true, "保存中");
  try {
    if (!reasoningPayload.apiKey && savedReasoning.configured) delete reasoningPayload.apiKey;
    await saveRuntimeProvider("reasoning", reasoningPayload);
    if (els.reasoningApiKey) els.reasoningApiKey.value = "";
    await refreshHealth();
    toast("思考 API 已保存");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(els.saveReasoningApiSettingsButton, false);
  }
}

async function saveImageApiSettings() {
  if (!ensureCanManageApiSettings()) return;
  let imagePayload;
  try {
    imagePayload = currentImageApiPayload();
  } catch (error) {
    toast(error.message);
    return;
  }
  const savedImage = state.runtimeProviders?.image || {};
  if (!imagePayload.baseUrl || (!imagePayload.apiKey && !savedImage.configured)) {
    toast("请填写生图 API 的 Base URL 和 Key");
    return;
  }
  setBusy(els.saveImageApiSettingsButton, true, "保存中");
  try {
    if (!imagePayload.apiKey && savedImage.configured) delete imagePayload.apiKey;
    await saveRuntimeProvider("image", imagePayload);
    if (els.primaryImageApiKey) els.primaryImageApiKey.value = "";
    await refreshHealth();
    toast("生图 API 已保存");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(els.saveImageApiSettingsButton, false);
  }
}

async function saveLocalApiSettings() {
  await saveReasoningApiSettings();
  await saveImageApiSettings();
}

function renderStorageSummary(summary = null) {
  if (!els.storageSummary) return;
  if (summary?.outputDir) {
    state.storageSettings = {
      ...(state.storageSettings || {}),
      outputDir: summary.outputDir,
      defaultOutputDir: summary.defaultOutputDir || state.storageSettings?.defaultOutputDir || "",
      firstRunStoragePrompted: summary.firstRunStoragePrompted ?? state.storageSettings?.firstRunStoragePrompted,
      savePromptMode: summary.savePromptMode || state.storageSettings?.savePromptMode || "ask"
    };
    renderStorageSettings(state.storageSettings);
  }
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

function renderStorageSettings(storage = state.storageSettings) {
  if (!storage) return;
  state.storageSettings = storage;
  if (els.storageOutputDir && !els.storageOutputDir.matches(":focus")) {
    els.storageOutputDir.value = storage.outputDir || "";
  }
  const mode = storage.savePromptMode === "never" || storage.promptOnFirstRun === false ? "never" : "ask";
  els.storagePromptButtons.forEach((button) => {
    const active = button.dataset.storagePromptMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (els.storagePathHint) {
    const defaultText = storage.defaultOutputDir && storage.defaultOutputDir !== storage.outputDir
      ? `默认：${storage.defaultOutputDir}`
      : "当前使用默认目录";
    els.storagePathHint.textContent = `${storage.outputDir || "未设置保存位置"} · ${mode === "ask" ? "首次使用会提醒选择位置" : "首次使用不再提醒"} · ${defaultText}`;
  }
}

async function saveStorageSettings({ outputDir = null, promptMode = null, markPrompted = false } = {}) {
  if (!ensureCanManageApiSettings()) return false;
  const current = state.storageSettings || {};
  const nextOutputDir = outputDir ?? els.storageOutputDir?.value.trim() ?? current.outputDir ?? "";
  if (!nextOutputDir) {
    toast("请填写或选择输出目录");
    return false;
  }
  const mode = promptMode || (current.savePromptMode === "never" ? "never" : "ask");
  setBusy(els.saveStorageSettingsButton, true, "保存中");
  try {
    const data = await requestJson("/api/settings/storage", {
      method: "POST",
      body: JSON.stringify({
        outputDir: nextOutputDir,
        promptOnFirstRun: mode !== "never",
        firstRunStoragePrompted: markPrompted || current.firstRunStoragePrompted || false,
        savePromptMode: mode
      })
    });
    state.storageSettings = data.settings?.storage || data.storage || state.storageSettings;
    renderStorageSettings(state.storageSettings);
    await refreshStorageSummary({ silent: true });
    toast("输出目录已保存");
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  } finally {
    setBusy(els.saveStorageSettingsButton, false);
  }
}

async function chooseStorageDirectory() {
  if (!ensureCanManageApiSettings()) return;
  const picker = window.laoguiDesktop?.selectDirectory;
  if (typeof picker !== "function") {
    toast("当前浏览器不能直接选择目录，请手动填写完整路径后保存。");
    focusElement(els.storageOutputDir);
    return;
  }
  try {
    const dir = await picker();
    if (!dir) return;
    if (els.storageOutputDir) els.storageOutputDir.value = dir;
    await saveStorageSettings({ outputDir: dir, markPrompted: true });
  } catch (error) {
    toast(error.message || "选择目录失败");
  }
}

async function resetStorageDirectory() {
  const defaultDir = state.storageSettings?.defaultOutputDir || "";
  if (!defaultDir) {
    toast("未读取到默认目录");
    return;
  }
  if (els.storageOutputDir) els.storageOutputDir.value = defaultDir;
  await saveStorageSettings({ outputDir: defaultDir });
}

async function setStoragePromptMode(mode) {
  const safeMode = mode === "never" ? "never" : "ask";
  await saveStorageSettings({ promptMode: safeMode, markPrompted: safeMode === "never" });
}

function maybeShowFirstRunStoragePrompt() {
  const storage = state.storageSettings;
  if (state.storagePromptShown) return;
  if (!storage?.needsFirstRunPrompt || !state.canManageApiSettings) return;
  state.storagePromptShown = true;
  openSettings(els.settingsButton || els.workspaceSettingsButton);
  setTimeout(() => {
    els.storageOutputDir?.focus();
    toast("第一次使用请确认生成图片保存位置");
  }, 180);
}

function renderStorageAccess() {
  const disabled = !state.canManageApiSettings;
  [
    els.storageOutputDir,
    els.chooseStorageDirButton,
    els.saveStorageSettingsButton,
    els.resetStorageDirButton,
    ...els.storagePromptButtons,
    els.cleanupTestGeneratedButton,
    els.archiveGeneratedButton,
    els.pruneLogsButton
  ].forEach((button) => {
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
  renderApiSettingsAccess();
  renderImageApiProbeFeedback();
  renderImageStudioKernel();
}

async function refreshTaskLogs({ silent = false } = {}) {
  if (!els.taskLogList) return;
  try {
    const response = await fetch(taskLogScopedApiPath("/api/task-logs?limit=200"));
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "任务日志读取失败");
    }
    const logs = Array.isArray(data.logs) ? data.logs : [];
    state.taskLogs = logs;
    renderWorkspaceHistoryPanel();
    renderAssetLibraryPage();
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
    els.taskLogList.innerHTML = `<p class="muted">任务日志读取失败，请稍后重试。</p>`;
    if (state.historyPanelOpen && els.workspaceHistoryList) {
      els.workspaceHistoryList.innerHTML = `<p class="muted">方案资产库读取失败，请稍后重试。</p>`;
    }
    if (!silent) toast("任务日志读取失败");
  }
}

let deferredStartupRefreshScheduled = false;

function scheduleDeferredStartupRefresh() {
  if (deferredStartupRefreshScheduled) return;
  deferredStartupRefreshScheduled = true;

  const run = () => {
    refreshHealth();
    refreshApiSettings({ silent: true });
    refreshStorageSummary({ silent: true });
    refreshTaskLogs({ silent: true });
    renderOutputManager();
  };

  const runWhenIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1200 });
      return;
    }

    run();
  };

  setTimeout(runWhenIdle, 1200);
}

function generatedHistoryLogs() {
  const seen = new Set();
  return state.taskLogs
    .filter((log) => log.status === "success" && log.result?.outputUrl)
    .filter((log) => {
      const key = [log.result.outputUrl, log.result?.prompt || log.input?.intent || "", log.input?.stepMode || log.input?.mode || log.result?.mode || ""].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function previewRecordFromOutputItem(item, source = "outputs") {
  if (!item?.url) return null;
  return {
    id: `${source}-${item.id || item.url}`,
    source,
    url: item.url,
    title: item.title || workflowStepLabel(item.stepMode || item.mode) || "生成图片",
    caption: outputMetaLine(item) || item.intent || item.mode || "生成结果"
  };
}

function previewRecordFromHistoryLog(log) {
  if (!log?.result?.outputUrl) return null;
  const mode = normalizeClientMode(log.input?.stepMode || log.input?.mode || log.result?.mode || "");
  return {
    id: `history-${log.id || log.result.outputUrl}`,
    source: "history",
    url: log.result.outputUrl,
    title: log.result?.title || taskTypeLabel(log.type) || "历史生成图",
    caption: [
      formatTaskTime(log.completedAt || log.startedAt),
      workflowStepLabel(mode),
      shortEndpoint(log.result?.endpoint || log.activeImageBaseUrl || "")
    ].filter(Boolean).join(" · ")
  };
}

function uniquePreviewRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (!record?.url || seen.has(record.url)) return false;
    seen.add(record.url);
    return true;
  });
}

function getPreviewRecords(source = "all") {
  if (source === "history") {
    return uniquePreviewRecords(generatedHistoryLogs().map(previewRecordFromHistoryLog));
  }
  if (source === "outputs") {
    return uniquePreviewRecords(getFilteredOutputItems(getOutputItems()).map((item) => previewRecordFromOutputItem(item, "outputs")));
  }
  const records = [
    ...getOutputItems().map((item) => previewRecordFromOutputItem(item, "outputs")),
    ...generatedHistoryLogs().map(previewRecordFromHistoryLog)
  ];
  return uniquePreviewRecords(records);
}

function renderWorkspaceHistoryPanel() {
  if (!els.workspaceHistoryPanel || !els.workspaceHistoryList) return;
  const open = state.historyPanelOpen;
  els.workspaceHistoryPanel.hidden = !open;
  els.workspaceHistoryButton?.classList.toggle("active", open);
  syncExpandedState(els.workspaceHistoryButton, els.workspaceHistoryPanel, open);
  if (!state.historyPanelOpen) return;

  const { allItems, visibleItems, counts } = projectLibraryItemsForFilter(state.projectLibraryFilter);
  renderProjectLibraryTabs(counts);
  if (!allItems.length) {
    els.workspaceHistoryList.innerHTML = `
      <article class="project-library-empty">
        <strong>方案资产库还是空的</strong>
        <span>${friendExperienceMode ? "生成图片后会自动沉淀在这里；点击收藏会进入“收藏”分类。" : "生成图片、全景图或 CAD 后会自动沉淀在这里；点击收藏会进入“收藏”分类。"}</span>
      </article>
    `;
    return;
  }
  if (!visibleItems.length) {
    els.workspaceHistoryList.innerHTML = `
      <article class="project-library-empty">
        <strong>${escapeHtml(projectLibraryFilterLabel(state.projectLibraryFilter))}里还没有内容</strong>
        <span>换个分类看看，或先把喜欢的生成结果点成收藏。</span>
      </article>
    `;
    return;
  }
  els.workspaceHistoryList.innerHTML = visibleItems.map(renderProjectLibraryItem).join("");
  hydrateCachedThumbnails(els.workspaceHistoryList);
  bindProjectLibraryEvents();
}

function assetLibraryImageItems() {
  const { allItems } = projectLibraryItemsForFilter("images");
  return allItems.filter((item) => item?.url && (item.kind === "output" || item.kind === "history"));
}

function renderAssetLibraryPage() {
  if (!els.assetLibraryList) return;
  const items = assetLibraryImageItems();
  const currentCount = items.filter((item) => item.kind === "output").length;
  const historyCount = items.filter((item) => item.kind === "history").length;
  const panoramaCount = items.filter((item) => item.group === "panorama").length;

  if (els.assetLibraryCount) {
    els.assetLibraryCount.textContent = `${items.length} 张创作图`;
  }
  if (els.assetLibraryDownloadAllButton) {
    els.assetLibraryDownloadAllButton.disabled = !items.length;
  }
  if (els.assetLibraryStats) {
    els.assetLibraryStats.innerHTML = [
      ["全部", items.length],
      ["当前画布", currentCount],
      ["历史创作", historyCount],
      ["全景图", panoramaCount]
    ].map(([label, count]) => `<span>${escapeHtml(label)} <strong>${Number(count || 0)}</strong></span>`).join("");
  }

  if (!items.length) {
    els.assetLibraryList.innerHTML = `
      <article class="project-library-empty asset-library-empty">
        <strong>方案资产库还是空的</strong>
        <span>生成图片后，创作结果会自动展示在这里。</span>
      </article>
    `;
    return;
  }

  els.assetLibraryList.innerHTML = items.map(renderAssetLibraryImageCard).join("");
  hydrateCachedThumbnails(els.assetLibraryList);
  bindAssetLibraryPageEvents();
}

function renderAssetLibraryImageCard(entry) {
  const isOutput = entry.kind === "output";
  const previewAttrs = isOutput
    ? `data-output-action="preview" data-output-id="${escapeAttr(entry.outputId)}"`
    : `data-history-action="preview" data-log-id="${escapeAttr(entry.logId)}"`;
  const sourceLabel = isOutput ? "当前画布" : "历史创作";
  const typeLabel = entry.group === "panorama" ? "全景图" : "普通图";
  const note = entry.note ? String(entry.note).slice(0, 110) : "";
  const actions = isOutput
    ? `
      ${outputActionButton({ action: "preview", outputId: entry.outputId, icon: "icon-focus", label: "预览" })}
      ${outputActionButton({ action: "send-to-panel", outputId: entry.outputId, icon: "icon-reference", label: "加入创作面板" })}
      ${outputActionButton({ action: "download", outputId: entry.outputId, icon: "icon-export", label: "下载" })}
    `
    : `
      ${uiIconButton({ icon: "icon-focus", label: "预览", attrs: `data-history-action="preview" data-log-id="${escapeAttr(entry.logId)}"` })}
      ${uiIconButton({ icon: "icon-pin", label: "加入画布", attrs: `data-history-action="add" data-log-id="${escapeAttr(entry.logId)}"` })}
      ${uiIconButton({ icon: "icon-export", label: "下载", attrs: `data-history-action="download" data-log-id="${escapeAttr(entry.logId)}"` })}
    `;

  return `
    <article class="asset-library-card ${entry.favorite ? "is-favorite" : ""}" data-asset-kind="${escapeAttr(entry.kind)}">
      <button class="asset-library-thumb" type="button" ${previewAttrs} title="预览 ${escapeAttr(entry.title)}" aria-label="预览 ${escapeAttr(entry.title)}">
        <img src="${escapeAttr(entry.url)}" data-cache-thumbnail="true" alt="${escapeAttr(entry.title)}" />
      </button>
      <div class="asset-library-card-body">
        <div class="asset-library-card-title">
          <strong>${escapeHtml(entry.title)}</strong>
          <span>${escapeHtml(typeLabel)}</span>
        </div>
        <p>${escapeHtml(entry.meta || sourceLabel)}</p>
        ${note ? `<small>${escapeHtml(note)}</small>` : ""}
        <div class="workspace-history-actions asset-library-card-actions">
          ${actions}
        </div>
      </div>
    </article>
  `;
}

function bindAssetLibraryPageEvents() {
  if (!els.assetLibraryList) return;
  bindOutputActionEvents(els.assetLibraryList);
  els.assetLibraryList.querySelectorAll("[data-history-action]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.stopPropagation();
      const log = state.taskLogs.find((item) => item.id === control.dataset.logId);
      if (!log) return;
      handleWorkspaceHistoryAction(control.dataset.historyAction, log).catch((error) => toast(error.message));
    });
  });
}

function projectLibraryFilterLabel(filter) {
  return {
    images: "普通图",
    panorama: "全景图",
    cad: "3D / CAD",
    favorites: "收藏"
  }[filter] || "普通图";
}

function isHiddenLibraryMode(mode = "") {
  const normalized = normalizeClientMode(mode);
  return friendExperienceMode && (hiddenClientModes.has(normalized) || normalized === "cad" || !friendExperienceModes.has(normalized));
}

function shouldHideLibraryHistoryLog(log = {}) {
  if (!friendExperienceMode) return false;
  const mode = normalizeClientMode(log.input?.stepMode || log.input?.mode || log.result?.mode || log.type || "");
  if (isHiddenLibraryMode(mode)) return true;
  const text = [
    log.result?.title,
    log.input?.intent,
    log.result?.prompt,
    log.result?.sourcePrompt,
    log.type
  ].filter(Boolean).join(" ");
  return /图片转\s*CAD|平面图转\s*CAD|生成\s*CAD|CAD\s*线稿/i.test(text);
}

function renderProjectLibraryTabs(counts = {}) {
  els.projectLibraryFilterButtons.forEach((button) => {
    const filter = button.dataset.projectLibraryFilter || "images";
    button.hidden = friendExperienceMode && filter === "cad";
    const active = filter === state.projectLibraryFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.innerHTML = `${escapeHtml(projectLibraryFilterLabel(filter))}<span>${Number(counts[filter] || 0)}</span>`;
  });
}

function projectLibraryItemsForFilter(filter = "images") {
  const outputItems = getOutputItems();
  const outputUrls = new Set(outputItems.map((item) => item.url).filter(Boolean));
  const outputLibraryItems = outputItems.filter((item) => {
    return !isHiddenLibraryMode(item.stepMode || item.mode);
  }).map((item, index) => {
    const panorama = isPanoramaOutput(item);
    const favorite = state.favoriteOutputIds.has(item.id);
    return {
      key: `output-${item.id || item.url}`,
      kind: "output",
      group: panorama ? "panorama" : "images",
      favorite,
      outputId: item.id,
      url: item.url,
      title: item.title || workflowStepLabel(item.stepMode || item.mode) || "生成图片",
      meta: outputMetaLine(item) || workflowStepLabel(item.stepMode || item.mode),
      note: item.intent || item.prompt || item.sourcePrompt || "当前画布生成结果",
      item,
      index
    };
  });
  const historyLibraryItems = generatedHistoryLogs()
    .filter((log) => !shouldHideLibraryHistoryLog(log))
    .filter((log) => !outputUrls.has(log.result?.outputUrl))
    .map((log) => {
      const mode = normalizeClientMode(log.input?.stepMode || log.input?.mode || log.result?.mode || "");
      const panorama = mode === "panorama";
      return {
        key: `history-${log.id || log.result.outputUrl}`,
        kind: "history",
        group: panorama ? "panorama" : "images",
        favorite: false,
        logId: log.id,
        url: log.result.outputUrl,
        title: log.result?.title || taskTypeLabel(log.type) || "历史生成图",
        meta: [
          formatTaskTime(log.completedAt || log.startedAt),
          workflowStepLabel(mode),
          shortEndpoint(log.result?.endpoint || log.activeImageBaseUrl || "")
        ].filter(Boolean).join(" · "),
        note: log.input?.intent || log.result?.prompt || log.result?.sourcePrompt || ""
      };
    });
  const cadLibraryItems = state.cadResults.map((cad, index) => ({
    key: `cad-${cad.id || index}`,
    kind: "cad",
    group: "cad",
    favorite: false,
    cadIndex: index,
    url: cad.previewSvgUrl || cad.svgUrl,
    title: cad.title || `CAD ${index + 1}`,
    meta: `${cad.createdAt || ""} · ${cad.lineCount || 0} 条线段 · SVG / DXF`,
    note: "可下载 SVG / DXF，或在画布中继续查看。",
    cad
  }));
  const whiteModelLibraryItems = state.whiteModelResults.map((model, index) => {
    const displayModel = normalizeWhiteModelForPreview(model) || model;
    return {
      key: `white-model-${displayModel.id || index}`,
      kind: "white-model",
      group: "cad",
      favorite: false,
      modelIndex: index,
      modelId: String(displayModel.id || `white-model-${index}`),
      title: displayModel.title || `图片建模 ${index + 1}`,
      meta: `${displayModel.createdAt || ""} · ${displayModel.objectCount || displayModel.objects?.length || 0} 个对象 · GLB / SCAD / DXF`,
      note: displayModel.summary || "可旋转预览的参数化 3D / CAD 资产。",
      model: displayModel
    };
  });
  const allItems = [
    ...outputLibraryItems,
    ...historyLibraryItems,
    ...(friendExperienceMode ? [] : whiteModelLibraryItems),
    ...(friendExperienceMode ? [] : cadLibraryItems)
  ];
  const counts = {
    images: allItems.filter((item) => item.group === "images").length,
    panorama: allItems.filter((item) => item.group === "panorama").length,
    cad: allItems.filter((item) => item.group === "cad").length,
    favorites: allItems.filter((item) => item.favorite).length
  };
  return {
    allItems,
    visibleItems: filter === "favorites"
      ? allItems.filter((item) => item.favorite)
      : allItems.filter((item) => item.group === filter),
    counts
  };
}

function renderProjectLibraryItem(entry) {
  if (entry.kind === "white-model") {
    return `
      <article class="workspace-history-item project-library-file-item" data-library-kind="white-model">
        <button class="history-thumb project-library-file-thumb" type="button" data-library-action="focus-white" data-model-index="${escapeAttr(entry.modelIndex)}">
          <svg><use href="#icon-cube"></use></svg>
          <span>3D</span>
        </button>
        <div>
          <strong>${escapeHtml(entry.title)}</strong>
          <span>${escapeHtml(entry.meta)}</span>
          ${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}
          <div class="workspace-history-actions">
            ${uiIconButton({ icon: "icon-focus", label: "定位画布", attrs: `data-library-action="focus-white" data-model-index="${escapeAttr(entry.modelIndex)}"` })}
            ${uiIconButton({ icon: "icon-export", label: "导出 GLB", attrs: `data-library-action="white-glb" data-model-id="${escapeAttr(entry.modelId)}"` })}
            ${uiIconButton({ icon: "icon-cube", label: "下载 SCAD", attrs: `data-library-action="white-scad" data-model-id="${escapeAttr(entry.modelId)}"` })}
            ${uiIconButton({ icon: "icon-reference", label: "导入 CAD", attrs: `data-library-action="white-import-cad" data-model-id="${escapeAttr(entry.modelId)}"` })}
            ${uiIconButton({ icon: "icon-export", label: "下载 DXF", attrs: `data-library-action="white-dxf" data-model-id="${escapeAttr(entry.modelId)}"` })}
            ${uiIconButton({ icon: "icon-copy", label: "下载 JSON", attrs: `data-library-action="white-json" data-model-id="${escapeAttr(entry.modelId)}"` })}
          </div>
        </div>
      </article>
    `;
  }
  if (entry.kind === "cad") {
    return `
      <article class="workspace-history-item project-library-file-item" data-library-kind="cad">
        <button class="history-thumb" type="button" data-library-action="preview-cad" data-cad-index="${escapeAttr(entry.cadIndex)}">
          ${entry.url ? `<img src="${escapeAttr(entry.url)}" data-cache-thumbnail="true" alt="${escapeAttr(entry.title)}" />` : `<svg><use href="#icon-vector"></use></svg>`}
        </button>
        <div>
          <strong>${escapeHtml(entry.title)}</strong>
          <span>${escapeHtml(entry.meta)}</span>
          ${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}
          <div class="workspace-history-actions">
            ${uiIconButton({ icon: "icon-focus", label: "定位画布", attrs: `data-library-action="focus-cad" data-cad-index="${escapeAttr(entry.cadIndex)}"` })}
            ${uiIconButton({ icon: "icon-focus", label: "预览", attrs: `data-library-action="preview-cad" data-cad-index="${escapeAttr(entry.cadIndex)}"` })}
            ${entry.cad?.dxfUrl ? uiIconLink({ href: entry.cad.dxfUrl, icon: "icon-export", label: "下载 DXF", attrs: `download="${escapeAttr(entry.cad.fileBase || entry.title)}.dxf"` }) : ""}
            ${entry.cad?.svgUrl ? uiIconLink({ href: entry.cad.svgUrl, icon: "icon-image", label: "下载 SVG", attrs: `download="${escapeAttr(entry.cad.fileBase || entry.title)}.svg"` }) : ""}
          </div>
        </div>
      </article>
    `;
  }
  if (entry.kind === "output") {
    const previewLabel = entry.group === "panorama" ? "全景预览" : "预览";
    return `
      <article class="workspace-history-item ${entry.favorite ? "is-favorite" : ""}" data-library-kind="output">
        <button class="history-thumb" type="button" data-output-action="preview" data-output-id="${escapeAttr(entry.outputId)}">
          <img src="${escapeAttr(entry.url)}" data-cache-thumbnail="true" alt="${escapeAttr(entry.title)}" />
        </button>
        <div>
          <strong>${escapeHtml(entry.title)}</strong>
          <span>${escapeHtml(entry.meta || "当前画布输出")}</span>
          ${entry.note ? `<p>${escapeHtml(String(entry.note).slice(0, 150))}</p>` : ""}
          <div class="workspace-history-actions">
            ${outputActionButton({ action: "preview", outputId: entry.outputId, icon: "icon-focus", label: previewLabel })}
            ${outputActionButton({ action: "send-to-panel", outputId: entry.outputId, icon: "icon-reference", label: "加入创作面板" })}
            ${outputActionButton({ action: "favorite", outputId: entry.outputId, icon: "icon-star", label: entry.favorite ? "已收藏" : "收藏", attrs: `aria-pressed="${entry.favorite ? "true" : "false"}"` })}
            ${outputActionButton({ action: "download", outputId: entry.outputId, icon: "icon-export", label: "下载" })}
          </div>
        </div>
      </article>
    `;
  }
  return `
    <article class="workspace-history-item" data-library-kind="history">
      <button class="history-thumb" type="button" data-history-action="preview" data-log-id="${escapeAttr(entry.logId)}">
        <img src="${escapeAttr(entry.url)}" data-cache-thumbnail="true" alt="${escapeAttr(entry.title)}" />
      </button>
      <div>
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(entry.meta || "生成记录")}</span>
        ${entry.note ? `<p>${escapeHtml(String(entry.note).slice(0, 150))}</p>` : ""}
        <div class="workspace-history-actions">
          ${uiIconButton({ icon: "icon-focus", label: "预览", attrs: `data-history-action="preview" data-log-id="${escapeAttr(entry.logId)}"` })}
          ${uiIconButton({ icon: "icon-pin", label: "加入画布", attrs: `data-history-action="add" data-log-id="${escapeAttr(entry.logId)}"` })}
          ${uiIconButton({ icon: "icon-reference", label: "设为输入", attrs: `data-history-action="input" data-log-id="${escapeAttr(entry.logId)}"` })}
          ${uiIconButton({ icon: "icon-copy", label: "复制提示词", attrs: `data-history-action="copy" data-log-id="${escapeAttr(entry.logId)}"` })}
          ${uiIconButton({ icon: "icon-trash", label: "删除记录", attrs: `data-history-action="delete" data-log-id="${escapeAttr(entry.logId)}"` })}
          ${uiIconButton({ icon: "icon-export", label: "下载", attrs: `data-history-action="download" data-log-id="${escapeAttr(entry.logId)}"` })}
        </div>
      </div>
    </article>
  `;
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
      handleWorkspaceHistoryAction(control.dataset.historyAction, log).catch((error) => toast(error.message));
    });
  });
}

function bindProjectLibraryEvents() {
  bindWorkspaceHistoryEvents();
  bindOutputActionEvents(els.workspaceHistoryList);
  els.workspaceHistoryList.querySelectorAll("[data-library-action]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleProjectLibraryAction(control.dataset.libraryAction, control)
        .catch((error) => toast(error.message));
    });
  });
}

async function handleProjectLibraryAction(action, control) {
  if (action === "focus-white") {
    focusCanvasToNodes([`whiteModel${Number(control.dataset.modelIndex || 0)}`]);
    return;
  }
  if (action === "focus-cad") {
    focusCanvasToNodes([`cad${Number(control.dataset.cadIndex || 0)}`]);
    return;
  }
  if (action === "preview-cad") {
    const cad = state.cadResults[Number(control.dataset.cadIndex || 0)];
    if (!cad?.svgUrl && !cad?.previewSvgUrl) return;
    openImagePreview({
      url: cad.previewSvgUrl || cad.svgUrl,
      title: cad.title || "CAD",
      caption: `${cad.createdAt || ""} · ${cad.lineCount || 0} 条线段 · CAD 环境预览 · 下载仍为干净 SVG / DXF`,
      items: []
    });
    return;
  }
  if (action?.startsWith("white-")) return handleWhiteModelAssetAction(action, control);
}

async function handleWhiteModelAssetAction(action, control) {
  const modelId = control.dataset.modelId || "";
  if (action === "white-glb") return downloadWhiteModelGlb(modelId);
  if (action === "white-scad") return downloadWhiteModelScad(modelId);
  if (action === "white-import-cad") return importWhiteModelFootprintToCad(modelId);
  if (action === "white-dxf") return downloadWhiteModelDxf(modelId);
  if (action === "white-json") return downloadWhiteModelJson(modelId);
  if (action === "white-forgecad") return createWhiteModelForgeCad(modelId, "script", control);
  if (action === "white-forgecad-studio") return createWhiteModelForgeCad(modelId, "studio", control);
  if (action === "white-cad-export") return exportWhiteModelWithTextToCad(modelId, control);
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
    imageApi: log.result?.imageApi || "",
    actualParams: log.result?.actualParams || null,
    revisedPrompt: log.result?.revisedPrompt || "",
    prompt: log.result?.prompt || "",
    sourcePrompt: log.result?.sourcePrompt || "",
    intent: log.input?.intent || log.result?.intent || "",
    createdAt: formatTaskTime(log.completedAt || log.startedAt)
  };
}

async function handleWorkspaceHistoryAction(action, log) {
  if (action === "preview") {
    const record = previewRecordFromHistoryLog(log);
    openImagePreview({
      url: record?.url || log.result.outputUrl,
      title: record?.title || log.result?.title || taskTypeLabel(log.type),
      caption: record?.caption || formatTaskTime(log.completedAt || log.startedAt),
      items: getPreviewRecords("history")
    });
    return;
  }
  if (action === "copy") {
    await copyText(log.result?.prompt || log.result?.sourcePrompt || log.input?.intent || "");
    return;
  }
  if (action === "delete") {
    await deleteTaskLogRecord(log);
    return;
  }
  if (action === "add") {
    addHistoryLogToCanvas(log);
    return;
  }
  if (action === "download") {
    await downloadHistoryLogImage(log);
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
  toast("资产已加入画布");
}

async function useHistoryLogAsInput(log) {
  addHistoryLogToCanvas(log);
  const record = historyLogToOutputRecord(log);
  await useCanvasImageWithMode(record.stepMode || record.mode || "custom");
}

function formatActualImageParams(params = null, imageApi = "") {
  const parts = [];
  if (imageApi) parts.push(imageApi);
  if (params?.size) parts.push(params.size);
  if (params?.quality) parts.push(`quality ${params.quality}`);
  if (params?.output_format) parts.push(params.output_format);
  if (params?.moderation) parts.push(`moderation ${params.moderation}`);
  if (params?.n) parts.push(`${params.n}张`);
  return parts.join(" · ");
}

function compactTaskLogText(value, maxLength = 128) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
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
  const actualParams = log.result?.actualParams || null;
  const imageApi = log.result?.imageApi || "";
  const revisedPrompt = log.result?.revisedPrompt || "";
  const actualParamText = formatActualImageParams(actualParams, imageApi);
  const outputFilePath = log.result?.outputFile || "";
  const primaryMetaItems = [
    formatTaskTime(timeText),
    `参考图 ${refCount} 张`,
    shortEndpoint(endpoint)
  ].filter(Boolean);
  const secondaryMetaItems = [
    retryCount ? `重试 ${retryCount} 次` : "",
    actualParamText
  ].filter(Boolean);
  const contextItems = [
    workflowId ? `工作流 ${workflowId}` : "",
    inputType ? `输入 ${inputType}` : "",
    renderRegion ? `区域 ${renderRegion}` : "",
    parentImageId ? `父图 ${parentImageId}` : "",
    outputFilePath ? `文件 ${shortPath(outputFilePath)}` : ""
  ].filter(Boolean);
  const intentSummary = log.input?.intent || userPrompt || log.result?.analysisSummary || sourcePrompt || "";
  const promptSummary = finalPrompt || sourcePrompt || userPrompt || "";
  const nextMode = nextPlanWorkflowModes(logMode)[0];
  const output = log.result?.outputUrl
    ? uiIconLink({ href: log.result.outputUrl, icon: "icon-export", label: "打开结果", attrs: `target="_blank" rel="noreferrer"` })
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
      <div class="task-log-row task-log-title-row">
        <div>
          <strong>${escapeHtml(typeText)}${escapeHtml(mode)}</strong>
        </div>
        <span class="task-log-status ${log.status === "success" ? "success" : "failed"}">${escapeHtml(statusText)} · ${escapeHtml(duration)}</span>
      </div>
      ${primaryMetaItems.length ? `<div class="task-log-meta">${primaryMetaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${secondaryMetaItems.length ? `<div class="task-log-context task-log-params">${secondaryMetaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${intentSummary ? `<p class="task-log-summary">${escapeHtml(intentSummary)}</p>` : ""}
      ${promptSummary ? `<p class="task-log-prompt-preview">${escapeHtml(promptSummary)}</p>` : ""}
      ${contextItems.length ? `<div class="task-log-context">${contextItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${error}
      <div class="task-log-actions">
        ${output}
        ${finalPrompt ? uiIconButton({ icon: "icon-copy", label: "复制提示词", attrs: `data-log-action="copy-prompt" data-log-id="${escapeAttr(log.id)}"` }) : ""}
        ${nextMode && log.result?.outputUrl ? uiIconButton({ icon: "icon-continue", label: "继续下一步", attrs: `data-log-action="continue-next" data-next-mode="${escapeAttr(nextMode)}" data-log-id="${escapeAttr(log.id)}"` }) : ""}
        ${uiIconButton({ icon: "icon-refresh", label: "复跑", attrs: `data-log-action="rerun" data-log-id="${escapeAttr(log.id)}"` })}
        ${uiIconButton({ icon: "icon-trash", label: "删除记录", attrs: `data-log-action="delete-log" data-log-id="${escapeAttr(log.id)}"` })}
      </div>
      ${userPrompt ? `<details><summary>用户原始指令</summary><p>${escapeHtml(userPrompt)}</p></details>` : ""}
      ${log.input?.intent ? `<details><summary>任务意图</summary><p>${escapeHtml(log.input.intent)}</p></details>` : ""}
      ${log.result?.analysisSummary ? `<details><summary>分析摘要</summary><p>${escapeHtml(log.result.analysisSummary)}</p></details>` : ""}
      ${attempts}
      ${revisedPrompt ? `<details><summary>API 改写提示词</summary><p>${escapeHtml(revisedPrompt)}</p></details>` : ""}
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
      } else if (button.dataset.logAction === "delete-log") {
        deleteTaskLogRecord(log).catch((error) => toast(error.message));
      }
    });
  });
}

async function deleteTaskLogRecord(log) {
  if (!log?.id) return;
  if (!window.confirm("从方案资产库删除这条生成记录？生成图片文件不会被删除。")) return;
  await requestJson(taskLogScopedApiPath(`/api/task-logs/${encodeURIComponent(log.id)}`), { method: "DELETE" });
  state.taskLogs = state.taskLogs.filter((item) => item.id !== log.id);
  renderWorkspaceHistoryPanel();
  renderAssetLibraryPage();
  await refreshTaskLogs({ silent: true });
  toast("方案资产库记录已删除");
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
    "local-colorgrade": "本地调色",
    "local-cutout": "本地抠图",
    "local-cad": "本地 CAD",
    "image-modeling": "图片转CAD",
    "white-model": "图片转CAD",
    "3d-model": "图片转CAD",
    "canvas-upscale": "画布高清增强",
    "canvas-sharpen": "画布锐化",
    "canvas-colorgrade": "画布调色",
    "canvas-cutout": "画布抠图",
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
    phase: "准备中",
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
    if (attempt.status === "success") state.activeTask.phase = "保存结果";
    if (attempt.status === "failed") state.activeTask.phase = "端点重试";
    const label = attempt.status === "success" ? "成功" : attempt.status === "skipped" ? "跳过" : "尝试";
    const duration = attempt.durationMs ? ` · ${formatElapsed(attempt.durationMs)}` : "";
    pushTaskEvent(`${label} · ${attempt.name}${duration}${attempt.endpoint ? ` · ${attempt.endpoint}` : ""}${attempt.error ? ` · ${attempt.error}` : ""}`);
  });
}

function inferTaskPhase(task) {
  if (!task) return "待命";
  if (task.status === "success") return "完成";
  if (task.status === "failed") return "失败";
  if (task.retries > 0) return "端点重试";
  if (task.current > 0) return "生图中";
  return "准备中";
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
    if (els.taskProgressPhase) els.taskProgressPhase.textContent = "待命";
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
  if (els.taskProgressPhase) els.taskProgressPhase.textContent = task.phase || inferTaskPhase(task);
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
  const mismatch = confident && !compatible && suggestedMode !== currentMode && !["custom", "design-derivation", "designseries"].includes(currentMode);
  const planDecision = isPlanGuidanceMode(currentMode)
    ? { reason: planWorkflowRecommendationText }
    : null;
  const actionText = planDecision?.reason
    ? planDecision.reason
    : mismatch
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
  if (normalizedMode === "image-modeling") return true;
  const compatibleModes = {
    "line-plan": ["plan-axonometric", "plan-axonometric-view", "plan-render", "cad", "cadrender"],
    "cad-screenshot": ["cad", "cadrender", "plan-axonometric", "plan-axonometric-view", "plan-render"],
    "colored-plan": ["plan-axonometric", "plan-axonometric-view", "plan-render"],
    axonometric: ["plan-axonometric-view", "plan-render"],
    panorama: ["panorama", "photo", "materialboard", "styletransfer", "materialreplace", "lightingadjust", "upscale", "detail", "sharpen", "outpaint"],
    "site-photo": ["photo", "styletransfer", "materialreplace", "lightingadjust"],
    "white-model": ["whitemodel"],
    sketch: ["sketch"],
    "style-reference": ["custom", "design-derivation", "designseries", "styletransfer", "materialboard"]
  };
  return (compatibleModes[key] || []).includes(normalizedMode);
}

function setInputAdviceThinking(analysis) {
  const advice = inputWorkflowAdvice(analysis);
  if (!advice) return;
  const planDecision = isPlanGuidanceMode(state.mode)
    ? { reason: planWorkflowRecommendationText }
    : null;
  state.thinking = {
    status: "done",
    target: normalizeClientMode(state.mode) === "image-modeling"
      ? suggestedModeLabel(state.mode)
      : advice.label,
    text: [
      advice.text,
      advice.reason ? `判断依据：${advice.reason}` : "",
      planDecision?.reason ? `平面图链路：${planDecision.reason}` : "",
      "不会强制切换模式，生成前会把图片类型、当前按钮含义和用户指令一起融合进最终提示词。"
    ].filter(Boolean).join("\n")
  };
}

function getActiveImageEndpoint() {
  return state.runtimeProviders?.image?.baseUrl || state.activeImageBaseUrl || "";
}

function getReasoningEndpointLabel() {
  return state.runtimeProviders?.reasoning?.baseUrl || "gpt-5.5";
}

async function createPlan(options = {}) {
  const brief = readBrief();
  const mode = normalizeClientMode(options.mode || state.mode);
  const userPrompt = currentCanvasUserPrompt();
  if (userPrompt) {
    brief.constraints = [brief.constraints, userPrompt].filter(Boolean).join("\n");
  }
  if (mode === "design-derivation") {
    brief.deliveryPurpose = brief.deliveryPurpose || "方案推导 / 设计元素推演";
    brief.preserveNotes = [brief.preserveNotes, "优先拆分设计元素、母题和可推导的方案方向，再输出可继续出图的提案逻辑。"].filter(Boolean).join("\n");
    const primarySummary = state.primaryImageAnalysis
      ? `主图识别：${state.primaryImageAnalysis.label}。${state.primaryImageAnalysis.reason || ""}`
      : "";
    const seriesSummary = state.designSeriesAnalysis?.series_strategy || state.designSeriesAnalysis?.summary || "";
    const referenceSummary = activeReferenceImages().length
      ? `${activeReferenceImages().length} 张参考图参与方案推导；${seriesSummary ? `参考图识别摘要：${seriesSummary}` : "请在方案中预留参考图贡献的空间、材料、灯光、色彩、构图和细部母题。"}`
      : "";
    const visualSummary = [primarySummary, referenceSummary].filter(Boolean).join("\n");
    if (visualSummary) {
      brief.constraints = [brief.constraints, visualSummary].filter(Boolean).join("\n");
    }
  }
  const busyButton = options.busyButton || els.planButton || els.canvasGenerateButton;
  state.loadingPlan = true;
  startActiveTask({
    type: "plan",
    label: "设计元素推演",
    total: 1,
    userPrompt: userPrompt || brief.projectName || brief.spaceType || "",
    referenceCount: activeReferenceImages().length
  });
  setBusy(busyButton, true, "推导中");
  toast("gpt-5.5 正在推导设计元素与方案方向");
  try {
    const data = await api("/api/plan", { brief });
    state.plan = data.plan;
    state.selectedId = data.plan.directions?.[0]?.id || null;
    updateActiveTask({
      success: 1,
      finalPrompt: data.plan?.design_read || data.plan?.project_summary || "",
      event: "设计元素推演完成"
    });
    render();
    completeActiveTask("success", "方案推导完成");
    toast("已完成设计元素推演与方案推导");
  } catch (error) {
    updateActiveTask({
      status: "failed",
      failed: 1,
      error: error.message,
      event: `方案推导失败：${error.message}`
    });
    state.thinking = {
      status: "idle",
      target: "设计元素推演",
      text: `生成未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    state.loadingPlan = false;
    setBusy(busyButton, false);
  }
}

async function generateImage(directionId) {
  if (!state.plan) return;
  const direction = state.plan.directions.find((item) => item.id === directionId);
  if (!direction || state.loadingImages.has(directionId)) return;

  const useThinkingMode = Boolean(state.thinkingModeEnabled);
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
    text: useThinkingMode
      ? `正在为「${direction.name}」推理空间镜头、材料表达、灯光层次和画面风险。`
      : `思考模式已关闭，正在使用快速预设直接生成「${direction.name}」。`
  };
  render();
  toast(`${useThinkingMode ? "gpt-5.5 → Image Gen" : "快速预设 → Image Gen"} 正在生成「${direction.name}」`);
  try {
    const data = await api("/api/generate-image", {
      brief: readBrief(),
      direction,
      imagePrompt: direction.image_prompt,
      userPrompt: direction.image_prompt || currentCanvasUserPrompt(),
      size: selectedGenerationSize(),
      quality: selectedGenerationQuality(),
      thinkingEnabled: useThinkingMode
    });
    direction.image = data.image;
    updateActiveTask({
      success: 1,
      phase: "保存结果",
      endpoint: data.image?.endpoint || state.activeTask.endpoint,
      finalPrompt: data.image?.prompt || direction.image_prompt,
      outputs: [data.image],
      attempts: data.image?.attempts || [],
      event: "方向视觉生成完成"
    });
    state.thinking = {
      status: "done",
      target: direction.name,
      text: data.image?.thinking || (useThinkingMode
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
      target: workflowButtonMeanings[normalizeClientMode(state.mode)]?.label || "现场图转效果图",
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
        "最终人视角效果图必须聚焦这个红框区域，不要生成整套平面图，也不要转到其他房间；允许根据整体轴测图补足该区域可见的前景、中景、背景和相邻空间关系。",
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
        ? "请先观察所有参考图的空间类型、材料氛围、家具尺度和灯光特征，再从轴测图中自动选择一个与参考图最接近、最适合做人视角效果图的明确功能区。"
        : "请从轴测图中自动选择一个最清晰、最适合做人视角效果图的明确主要空间区，但必须只选择一个区域，不要把整张轴测图都转成效果图。",
      "选定区域后，最终画面只表现该区域的人视角效果，并在提示词逻辑中说明选择的是哪个区域、为什么选择它。",
      "如果无法识别房间名称，就用空间位置描述，例如左侧卧室区、中部公共区、右下角卫生间附近、入口过渡区等。"
    ].join("\n")
  };
}

function normalizedPlanPaperViewState(view = state.planPaperView) {
  const fallback = defaultPlanPaperViewState();
  const yaw = Number(view?.yaw);
  const pitch = Number(view?.pitch);
  const zoom = Number(view?.zoom);
  const panX = Number(view?.panX);
  const panY = Number(view?.panY);
  return {
    yaw: wrapDegrees(Number.isFinite(yaw) ? yaw : fallback.yaw),
    pitch: wrapDegrees(Number.isFinite(pitch) ? pitch : fallback.pitch),
    zoom: round4(clamp(Number.isFinite(zoom) ? zoom : fallback.zoom, PLAN_PAPER_MIN_ZOOM, PLAN_PAPER_MAX_ZOOM)),
    panX: Math.round(clamp(Number.isFinite(panX) ? panX : fallback.panX, -PLAN_PAPER_MAX_PAN, PLAN_PAPER_MAX_PAN)),
    panY: Math.round(clamp(Number.isFinite(panY) ? panY : fallback.panY, -PLAN_PAPER_MAX_PAN, PLAN_PAPER_MAX_PAN)),
    dragging: view?.dragging || null
  };
}

function planPaperPanOffset(view = state.planPaperView) {
  const next = normalizedPlanPaperViewState(view);
  return {
    x: round4(next.panX * 0.5),
    y: round4(next.panY * 0.5)
  };
}

function planPaperFrameAspectState() {
  const size = generationDimensions();
  const width = Math.max(1, Number(size.width) || 1024);
  const height = Math.max(1, Number(size.height) || 1024);
  return {
    width,
    height,
    ratio: width / height,
    css: `${width} / ${height}`,
    label: `${width}×${height}`
  };
}

function planPaperFrameNodeWidth() {
  const frame = planPaperFrameAspectState();
  if (frame.ratio >= 1.65) return 560;
  if (frame.ratio >= 1.16) return 500;
  if (frame.ratio <= 0.7) return 360;
  if (frame.ratio <= 0.9) return 400;
  return 440;
}

function planPaperReferenceCanvasSize(frame = planPaperFrameAspectState()) {
  const ratio = clamp(frame.ratio, 0.34, 3);
  const longSide = Math.round(clamp(Math.max(frame.width, frame.height), 1600, 2400));
  let width;
  let height;
  if (ratio >= 1) {
    width = longSide;
    height = Math.round(width / ratio);
  } else {
    height = longSide;
    width = Math.round(height * ratio);
  }
  return { width, height };
}

function planPaperYawLabel(view = state.planPaperView) {
  const yaw = normalizedPlanPaperViewState(view).yaw;
  if (yaw < 23 || yaw >= 338) return "正向";
  if (yaw < 68) return "右前";
  if (yaw < 113) return "右侧";
  if (yaw < 158) return "右后";
  if (yaw < 203) return "反向";
  if (yaw < 248) return "左后";
  if (yaw < 293) return "左侧";
  return "左前";
}

function planPaperPitchLabel(view = state.planPaperView) {
  const pitch = normalizedPlanPaperViewState(view).pitch;
  if (pitch < 23 || pitch >= 338) return "平视";
  if (pitch < 68) return "低位斜视";
  if (pitch < 113) return "高位俯视";
  if (pitch < 158) return "上翻背侧";
  if (pitch < 203) return "背面倒转";
  if (pitch < 248) return "下翻背侧";
  if (pitch < 293) return "低位仰视";
  return "回正低位";
}

function planPaperReadoutText(view = state.planPaperView) {
  const next = normalizedPlanPaperViewState(view);
  return `${planPaperYawLabel(next)} · ${planPaperPitchLabel(next)} · yaw ${next.yaw}° / tilt ${next.pitch}°`;
}

function planPaperPanReadoutText(view = state.planPaperView) {
  const next = normalizedPlanPaperViewState(view);
  const signed = (value) => value > 0 ? `+${value}` : String(value);
  return `取景偏移 X ${signed(next.panX)} / Y ${signed(next.panY)}`;
}

function planPaperPrompt(view = state.planPaperView, mode = state.mode) {
  const next = normalizedPlanPaperViewState(view);
  const normalizedMode = normalizeClientMode(mode);
  const frame = planPaperFrameAspectState();
  const outputLabel = planPaperWorkflowOutputLabel(mode);
  const sourceLabel = planPaperWorkflowSourceLabel(mode);
  const controlLabel = planPaperWorkflowControlLabel(mode);
  const transformationLine = normalizedMode === "plan-render"
    ? `生成时请以拖拽后的${sourceLabel}可见范围、红框选区和近远关系作为区域定位依据，再把该区域翻译成人视角${outputLabel}：镜头站位、视线方向、前景/中景/背景、材料、灯光和陈列必须对应这个区域。`
    : `生成时请想象先把原始${sourceLabel}按这个角度倾斜，再在同一角度上把墙体、门窗、家具脚印和地面材质整理成真实${outputLabel}。`;
  const finalImageLine = normalizedMode === "plan-render"
    ? `最终画面要从第一张视角参考图里的可见区域继续推导：纸张四角投影、近端大远端小、画面裁切边界和被切出画框的部分用于判断效果图对应哪个空间区域。`
    : `最终画面应像把第一张视角参考图里的白色平面纸直接替换成真实${outputLabel}：纸张四角投影、近端大远端小、画面裁切边界、被切出画框的部分都保持一致。`;
  const finalConstraintLine = normalizedMode === "plan-render"
    ? `最终必须是人视角${outputLabel}，不是整张平面图、不是整张轴测图、不是图纸符号复刻；如果有红框选区，红框选区优先于拖拽取景。可见范围内的空间关系、功能区、开口、动线和主要家具/陈列逻辑不能改变。`
    : `不得固定为纯俯视视角；也不要变成人视角效果图。可见范围内的外轮廓、墙体、房间关系、开口、门扇方向和主要家具脚印不能移动；不可见或超出取景框的部分不要为了完整性补回画面。`;
  return [
    `${controlLabel}：用户把上传的${sourceLabel}当作一张平面纸张拖拽，当前角度就是最终${outputLabel}的镜头角度；控件本身不要生成到画面中。`,
    `当前纸张角度：${planPaperReadoutText(next)}；缩放 ${next.zoom.toFixed(2)}；${planPaperPanReadoutText(next)}。`,
    `当前取景框/输出画幅：${frame.label}，拖拽和缩放后的纸张只能在这个画框内取景，超出画框的部分按裁切处理。`,
    `生成时系统会把按当前拖拽角度渲染出的纸张图作为第一输入图，把原始${sourceLabel}作为第二输入图；第一张锁视角，第二张锁布局细节。`,
    `第一张视角参考图会以接近输出画幅的高清尺寸生成；第二张原始${sourceLabel}仍按高清原图传入，用于校验所有线稿、文字、房间关系和家具脚印。`,
    finalImageLine,
    transformationLine,
    `如果“完整${outputLabel}可读”和“拖拽后的取景/角度”冲突，优先服从拖拽视角：不要重新居中、不要自动展开到完整默认轴测、不要把视角拉回纯俯视。`,
    finalConstraintLine
  ].join("\n");
}

function lerpPlanPaperPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function planPaperProjectionCorners({ view, aspect, canvasWidth, canvasHeight }) {
  const next = normalizedPlanPaperViewState(view);
  const sourceAspect = clamp(Number(aspect) || 1.4, 0.35, 4.4);
  const yaw = (wrapSignedDegrees(next.yaw) * Math.PI) / 180;
  const pitch = (wrapSignedDegrees(next.pitch) * Math.PI) / 180;
  const cosZ = Math.cos(yaw);
  const sinZ = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const planeWidth = sourceAspect;
  const planeHeight = 1;
  const focal = 2.55;
  const perspectiveDepth = 1.08;
  const sourceCorners = [
    { x: -planeWidth / 2, y: -planeHeight / 2 },
    { x: planeWidth / 2, y: -planeHeight / 2 },
    { x: planeWidth / 2, y: planeHeight / 2 },
    { x: -planeWidth / 2, y: planeHeight / 2 }
  ];
  const projected = sourceCorners.map((point) => {
    const rotatedX = point.x * cosZ - point.y * sinZ;
    const rotatedY = point.x * sinZ + point.y * cosZ;
    const tiltedY = rotatedY * cosPitch;
    const tiltedZ = rotatedY * sinPitch;
    const scale = focal / Math.max(0.95, focal - tiltedZ * perspectiveDepth);
    return {
      x: rotatedX * scale,
      y: tiltedY * scale
    };
  });
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rawWidth = Math.max(0.12, maxX - minX);
  const rawHeight = Math.max(0.1, maxY - minY);
  const targetScale = Math.min(
    (canvasWidth * 0.78) / rawWidth,
    (canvasHeight * 0.68) / rawHeight
  ) * next.zoom;
  const pan = planPaperPanOffset(next);
  const centerX = canvasWidth / 2 + (pan.x / 100) * canvasWidth;
  const centerY = canvasHeight * 0.52 + (pan.y / 100) * canvasHeight;
  const toScreen = (point) => ({
    x: centerX + (point.x - (minX + maxX) / 2) * targetScale,
    y: centerY + (point.y - (minY + maxY) / 2) * targetScale
  });

  return {
    topLeft: toScreen(projected[0]),
    topRight: toScreen(projected[1]),
    bottomRight: toScreen(projected[2]),
    bottomLeft: toScreen(projected[3])
  };
}

function pointInProjectedPaper(corners, xRatio, yRatio) {
  const top = lerpPlanPaperPoint(corners.topLeft, corners.topRight, xRatio);
  const bottom = lerpPlanPaperPoint(corners.bottomLeft, corners.bottomRight, xRatio);
  return lerpPlanPaperPoint(top, bottom, yRatio);
}

function drawProjectedImageByGrid(ctx, image, corners, columnCount = 96, rowCount = 48) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return;
  const columns = Math.max(24, Math.min(160, columnCount));
  const rows = Math.max(12, Math.min(84, rowCount));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.topLeft.x, corners.topLeft.y);
  ctx.lineTo(corners.topRight.x, corners.topRight.y);
  ctx.lineTo(corners.bottomRight.x, corners.bottomRight.y);
  ctx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y);
  ctx.closePath();
  ctx.clip();

  for (let row = 0; row < rows; row += 1) {
    const y0 = row / rows;
    const y1 = (row + 1) / rows;
    const sourceY = y0 * height;
    const sourceHeight = Math.max(1, (y1 - y0) * height + 1);
    for (let column = 0; column < columns; column += 1) {
      const x0 = column / columns;
      const x1 = (column + 1) / columns;
      const topLeft = pointInProjectedPaper(corners, x0, y0);
      const topRight = pointInProjectedPaper(corners, x1, y0);
      const bottomRight = pointInProjectedPaper(corners, x1, y1);
      const bottomLeft = pointInProjectedPaper(corners, x0, y1);
      const sourceX = x0 * width;
      const sourceWidth = Math.max(1, (x1 - x0) * width + 1);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(topLeft.x, topLeft.y);
      ctx.lineTo(topRight.x, topRight.y);
      ctx.lineTo(bottomRight.x, bottomRight.y);
      ctx.lineTo(bottomLeft.x, bottomLeft.y);
      ctx.closePath();
      ctx.clip();
      ctx.transform(
        (topRight.x - topLeft.x) / sourceWidth,
        (topRight.y - topLeft.y) / sourceWidth,
        (bottomLeft.x - topLeft.x) / sourceHeight,
        (bottomLeft.y - topLeft.y) / sourceHeight,
        topLeft.x,
        topLeft.y
      );
      ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      ctx.restore();
    }
  }

  ctx.restore();
}

function projectedPaperPerspectiveMetrics(corners) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const topWidth = distance(corners.topLeft, corners.topRight);
  const bottomWidth = distance(corners.bottomLeft, corners.bottomRight);
  const leftHeight = distance(corners.topLeft, corners.bottomLeft);
  const rightHeight = distance(corners.topRight, corners.bottomRight);
  const topBottomRatio = bottomWidth && topWidth ? Math.max(topWidth, bottomWidth) / Math.max(1, Math.min(topWidth, bottomWidth)) : 1;
  const sideRatio = leftHeight && rightHeight ? Math.max(leftHeight, rightHeight) / Math.max(1, Math.min(leftHeight, rightHeight)) : 1;
  return {
    nearEdge: bottomWidth >= topWidth ? "bottom" : "top",
    farEdge: bottomWidth >= topWidth ? "top" : "bottom",
    nearFarScaleRatio: round4(topBottomRatio),
    sideScaleRatio: round4(sideRatio),
    topWidth: Math.round(topWidth),
    bottomWidth: Math.round(bottomWidth)
  };
}

function planPaperPerspectiveStyle(view = state.planPaperView) {
  const next = normalizedPlanPaperViewState(view);
  const pitchDepth = Math.abs(Math.sin((wrapSignedDegrees(next.pitch) * Math.PI) / 180));
  const perspective = Math.round(820 - pitchDepth * 310);
  const translateZ = Math.round(18 + pitchDepth * 44);
  return {
    perspective,
    translateZ,
    shadowOpacity: round4(0.42 + pitchDepth * 0.34),
    shadowScaleX: round4(1.08 + pitchDepth * 0.42),
    shadowScaleY: round4(0.72 + pitchDepth * 0.18),
    perspectiveOriginY: `${Math.round(54 + pitchDepth * 12)}%`
  };
}

function planPaperStyleAttr(view = state.planPaperView) {
  const next = normalizedPlanPaperViewState(view);
  const perspective = planPaperPerspectiveStyle(next);
  const frame = planPaperFrameAspectState();
  const pan = planPaperPanOffset(next);
  return [
    `--plan-yaw:${next.yaw}deg`,
    `--plan-pitch:${next.pitch}deg`,
    `--plan-zoom:${next.zoom}`,
    `--plan-pan-x:${pan.x}%`,
    `--plan-pan-y:${pan.y}%`,
    `--plan-frame-aspect:${frame.css}`,
    `--plan-perspective:${perspective.perspective}px`,
    `--plan-translate-z:${perspective.translateZ}px`,
    `--plan-shadow-opacity:${perspective.shadowOpacity}`,
    `--plan-shadow-scale-x:${perspective.shadowScaleX}`,
    `--plan-shadow-scale-y:${perspective.shadowScaleY}`,
    `--plan-perspective-origin-y:${perspective.perspectiveOriginY}`
  ].join(";");
}

function drawPlanPaperReferenceBorder(ctx, corners, { shadow = false } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.topLeft.x, corners.topLeft.y);
  ctx.lineTo(corners.topRight.x, corners.topRight.y);
  ctx.lineTo(corners.bottomRight.x, corners.bottomRight.y);
  ctx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y);
  ctx.closePath();
  if (shadow) {
    ctx.fillStyle = "rgba(248, 245, 238, 0.96)";
    ctx.fill();
  } else {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(227, 213, 184, 0.78)";
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(93, 88, 76, 0.18)";
    ctx.stroke();
  }
  ctx.restore();
}

function planPaperViewReferencePrompt(view = state.planPaperView, mode = state.mode) {
  const next = normalizedPlanPaperViewState(view);
  const normalizedMode = normalizeClientMode(mode);
  const frame = planPaperFrameAspectState();
  const outputLabel = planPaperWorkflowOutputLabel(mode);
  const sourceLabel = planPaperWorkflowSourceLabel(mode);
  const operationLine = normalizedMode === "plan-render"
    ? `生成目标不是重新选择一个无关空间，而是从第一张图的相机、裁切和可见区域里判断${outputLabel}来自哪个${sourceLabel}区域，再翻译成人视角画面。`
    : `生成目标不是重新选一个好看的${outputLabel}角度，而是在第一张图的相机和裁切里，把原始图层替换/整理成同角度的${outputLabel}。`;
  const finalLine = normalizedMode === "plan-render"
    ? `最终${outputLabel}必须体现被选区域的人视角空间关系；第一张图的近大远小、裁切和纸张朝向用于约束区域来源、镜头方向和构图，不要输出整张图纸或整张轴测图。`
    : `最终${outputLabel}必须体现近大远小：靠近镜头的边缘、墙体和家具体块更大更厚，远离镜头的边缘更短更小。`;
  return [
    `拖拽视角参考：yaw=${next.yaw}deg, pitch=${next.pitch}deg, zoom=${next.zoom.toFixed(2)}, panX=${next.panX}, panY=${next.panY}；${planPaperReadoutText(next)}。`,
    `取景框比例：${frame.label}，参考图已经按该画幅裁切；最终${outputLabel}也必须保持这个输出画幅和纸张在框内的可见范围。`,
    `第一张输入图是拖拽后视角底图，锁定最终${outputLabel}的相机角度、画面倾斜、透视压缩、外轮廓比例和远近关系。`,
    `第二张输入图是原始高清${sourceLabel}，只用于补全线稿清晰度、文字、房间关系、门窗、家具脚印等布局细节，不能把视角拉回默认俯视。`,
    operationLine,
    finalLine,
    "优先级：第一张图的相机/裁切/外轮廓 > 第二张图的布局细节 > 材质和渲染美化；任何默认轴测、重新居中、自动缩小到全图或完整展开都不能覆盖第一张视角参考。"
  ].join("\n");
}

function normalizePlanPaperQuad(corners, width, height) {
  const normalizePoint = (point) => ({
    x: round4(point.x / width),
    y: round4(point.y / height)
  });
  return {
    topLeft: normalizePoint(corners.topLeft),
    topRight: normalizePoint(corners.topRight),
    bottomRight: normalizePoint(corners.bottomRight),
    bottomLeft: normalizePoint(corners.bottomLeft)
  };
}

async function createPlanPaperViewReference(primaryImage, view = state.planPaperView, mode = state.mode) {
  if (!primaryImage?.dataUrl) return null;
  try {
    const image = await loadImage(primaryImage.dataUrl);
    const sourceWidth = image.naturalWidth || image.width || 0;
    const sourceHeight = image.naturalHeight || image.height || 0;
    if (!sourceWidth || !sourceHeight) return null;

    const aspect = sourceWidth / sourceHeight;
    const canvas = document.createElement("canvas");
    const frame = planPaperFrameAspectState();
    const canvasSize = planPaperReferenceCanvasSize(frame);
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, "#fbfaf6");
    background.addColorStop(0.5, "#ffffff");
    background.addColorStop(1, "#f1eee6");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const corners = planPaperProjectionCorners({
      view,
      aspect,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    });
    drawPlanPaperReferenceBorder(ctx, corners, { shadow: true });
    drawProjectedImageByGrid(
      ctx,
      image,
      corners,
      Math.round(clamp(sourceWidth / 28, 72, 132)),
      Math.round(clamp(sourceHeight / 28, 28, 72))
    );
    drawPlanPaperReferenceBorder(ctx, corners);
    const targetQuadrilateral = normalizePlanPaperQuad(corners, canvas.width, canvas.height);
    const perspectiveMetrics = projectedPaperPerspectiveMetrics(corners);

    const dataUrl = canvasToDataUrlWithinBudget(canvas, {
      mime: "image/jpeg",
      targetBytes: IMAGE_UPLOAD_VIEW_REFERENCE_TARGET_BYTES
    });
    const next = normalizedPlanPaperViewState(view);
    return {
      name: "plan-dragged-view-reference.jpg",
      type: imageMimeFromDataUrl(dataUrl) || "image/jpeg",
      dataUrl,
      role: "view-angle-reference",
      usage: "camera-angle",
      weight: "strong",
      viewAngle: {
        yaw: next.yaw,
        pitch: next.pitch,
        zoom: next.zoom,
        panX: next.panX,
        panY: next.panY,
        frame: frame.label,
        referenceWidth: canvas.width,
        referenceHeight: canvas.height,
        sourceWidth,
        sourceHeight,
        label: planPaperReadoutText(next)
      },
      targetQuadrilateral,
      perspectiveMetrics,
      prompt: planPaperViewReferencePrompt(next, mode),
      sourceName: primaryImage.name || ""
    };
  } catch (error) {
    console.warn("Failed to create plan paper view reference", error);
    return null;
  }
}

function planPaperInlineControlHtml() {
  const view = normalizedPlanPaperViewState();
  const frame = planPaperFrameAspectState();
  const outputLabel = planPaperWorkflowOutputLabel(state.mode);
  return `
    <div class="plan-paper-inline-control">
      <div class="plan-paper-readout">
        <strong data-plan-paper-readout>${escapeHtml(planPaperReadoutText(view))}</strong>
        <span>拖拽纸张调整角度，点框边箭头平移镜头；取景框 <b data-plan-paper-frame-size>${escapeHtml(frame.label)}</b>，<b data-plan-paper-pan-readout>${escapeHtml(planPaperPanReadoutText(view))}</b>。</span>
      </div>
      <div class="node-actions wrap">
        ${uiIconButton({ className: "text-button", icon: "icon-refresh", label: "重置角度", attrs: `data-plan-paper-action="reset"` })}
        ${uiIconButton({ className: "secondary-button", icon: "icon-cube", label: `按此角度生成${outputLabel}`, attrs: `data-plan-paper-action="generate" ${state.primaryImage ? "" : "disabled"}` })}
      </div>
    </div>
  `;
}

function planPaperPanControlsHtml() {
  const buttons = [
    ["up", "向上平移取景", "is-up"],
    ["right", "向右平移取景", "is-right"],
    ["down", "向下平移取景", "is-down"],
    ["left", "向左平移取景", "is-left"]
  ];
  return `
    <div class="plan-paper-pan-controls" aria-label="平移取景">
      ${buttons.map(([direction, label, className]) => `
        <button type="button" class="plan-paper-pan-button ${className}" data-plan-paper-pan="${direction}" title="${label}" aria-label="${label}">
          <svg aria-hidden="true"><use href="#icon-continue"></use></svg>
        </button>
      `).join("")}
    </div>
  `;
}

function updateRenderedPlanPaperControls(root = els.canvasNodes) {
  if (!root) return;
  const view = normalizedPlanPaperViewState();
  const perspective = planPaperPerspectiveStyle(view);
  const frame = planPaperFrameAspectState();
  const pan = planPaperPanOffset(view);
  const outputLabel = planPaperWorkflowOutputLabel(state.mode);
  root.querySelectorAll("[data-plan-paper-stage]").forEach((stage) => {
    stage.style.setProperty("--plan-yaw", `${view.yaw}deg`);
    stage.style.setProperty("--plan-pitch", `${view.pitch}deg`);
    stage.style.setProperty("--plan-zoom", String(view.zoom));
    stage.style.setProperty("--plan-pan-x", `${pan.x}%`);
    stage.style.setProperty("--plan-pan-y", `${pan.y}%`);
    stage.style.setProperty("--plan-frame-aspect", frame.css);
    stage.style.setProperty("--plan-perspective", `${perspective.perspective}px`);
    stage.style.setProperty("--plan-translate-z", `${perspective.translateZ}px`);
    stage.style.setProperty("--plan-shadow-opacity", String(perspective.shadowOpacity));
    stage.style.setProperty("--plan-shadow-scale-x", String(perspective.shadowScaleX));
    stage.style.setProperty("--plan-shadow-scale-y", String(perspective.shadowScaleY));
    stage.style.setProperty("--plan-perspective-origin-y", perspective.perspectiveOriginY);
    stage.setAttribute("aria-label", `${outputLabel}视角：${planPaperReadoutText(view)}`);
  });
  root.querySelectorAll("[data-plan-paper-readout]").forEach((element) => {
    element.textContent = planPaperReadoutText(view);
  });
  root.querySelectorAll("[data-plan-paper-frame-size]").forEach((element) => {
    element.textContent = frame.label;
  });
  root.querySelectorAll("[data-plan-paper-pan-readout]").forEach((element) => {
    element.textContent = planPaperPanReadoutText(view);
  });
}

function renderPlanAngleSyncBlock() {
  const block = els.planAngleSyncBlock;
  if (!block) return;
  const mode = normalizeClientMode(state.mode);
  const visible = Boolean(state.primaryImage?.dataUrl) && isPlanPaperMode(mode);
  block.hidden = !visible;
  if (!visible) {
    block.innerHTML = "";
    return;
  }
  const view = normalizedPlanPaperViewState();
  const frame = planPaperFrameAspectState();
  const outputLabel = planPaperWorkflowOutputLabel(mode);
  block.innerHTML = `
    <div class="plan-angle-sync-head">
      <span>视角同步</span>
      <strong data-plan-paper-readout>${escapeHtml(planPaperReadoutText(view))}</strong>
    </div>
    <div class="plan-paper-stage plan-angle-sync-stage" data-plan-paper-stage style="${planPaperStyleAttr(view)}" aria-label="${escapeAttr(`${outputLabel}视角：${planPaperReadoutText(view)}`)}">
      <div class="plan-paper-grid" aria-hidden="true"></div>
      <div class="plan-paper-camera-plane" aria-hidden="true">
        <div class="plan-paper-shadow"></div>
        <img class="plan-paper-sheet" src="${escapeAttr(state.primaryImage.dataUrl)}" alt="" />
      </div>
    </div>
    <p>右侧生成会按这个角度输出${escapeHtml(outputLabel)}；取景框 <b data-plan-paper-frame-size>${escapeHtml(frame.label)}</b>，<b data-plan-paper-pan-readout>${escapeHtml(planPaperPanReadoutText(view))}</b>。</p>
  `;
}

function normalizedMultiAngleViewState(view = state.multiAngleView) {
  const fallback = defaultMultiAngleViewState();
  const mode = view?.mode === "camera" ? "camera" : "subject";
  return {
    mode,
    subjectX: Math.round(clamp(Number.isFinite(Number(view?.subjectX)) ? Number(view.subjectX) : fallback.subjectX, -100, 100)),
    subjectY: Math.round(clamp(Number.isFinite(Number(view?.subjectY)) ? Number(view.subjectY) : fallback.subjectY, -100, 100)),
    subjectRotate: wrapSignedDegrees(Number.isFinite(Number(view?.subjectRotate)) ? Number(view.subjectRotate) : fallback.subjectRotate),
    cameraX: wrapSignedDegrees(Number.isFinite(Number(view?.cameraX)) ? Number(view.cameraX) : fallback.cameraX),
    cameraY: Math.round(clamp(Number.isFinite(Number(view?.cameraY)) ? Number(view.cameraY) : fallback.cameraY, -90, 90)),
    cameraDistance: Math.round(clamp(Number.isFinite(Number(view?.cameraDistance)) ? Number(view.cameraDistance) : fallback.cameraDistance, -100, 100)),
    dragging: view?.dragging || null
  };
}

function multiAngleDistanceLabel(value = normalizedMultiAngleViewState().cameraDistance) {
  const distance = Number(value) || 0;
  if (distance <= -42) return "近景";
  if (distance >= 42) return "远景";
  return "中景";
}

function multiAngleCameraModel(view = state.multiAngleView) {
  const next = normalizedMultiAngleViewState(view);
  const yaw = (next.cameraX * Math.PI) / 180;
  const pitch = (next.cameraY * Math.PI) / 180;
  const radius = Math.round(clamp(88 + next.cameraDistance * 0.28, 58, 122));
  const x = Math.round(Math.sin(yaw) * radius);
  const y = Math.round(-Math.sin(pitch) * radius * 0.72);
  const depth = Math.cos(yaw) * Math.cos(pitch);
  const depth01 = (depth + 1) / 2;
  const lineLength = Math.max(34, Math.round(Math.hypot(x, y)));
  const lineAngle = Math.round((Math.atan2(y, x) * 180) / Math.PI);
  const inFront = depth >= -0.12;
  return {
    x,
    y,
    radius,
    orbitSize: radius * 2,
    lineLength,
    lineAngle,
    faceAngle: wrapSignedDegrees(lineAngle + 180),
    cameraScale: round4(clamp(0.76 + depth01 * 0.34, 0.72, 1.12)),
    cameraOpacity: round4(clamp(0.54 + depth01 * 0.38, 0.48, 0.96)),
    lineOpacity: round4(inFront ? 0.58 : 0.24),
    shadowOpacity: round4(clamp(0.18 + depth01 * 0.22, 0.14, 0.42)),
    cameraLayer: inFront ? 5 : 1,
    lineLayer: inFront ? 4 : 1,
    subjectLensScale: round4(clamp(1 - next.cameraDistance * 0.0012, 0.88, 1.12))
  };
}

function multiAngleSourceDimensions(image = state.multiAnglePanel.open ? state.multiAnglePanel.sourceImage : state.primaryImage) {
  const width = Number(image?.width || state.primaryBitmap?.naturalWidth || state.primaryBitmap?.width || 0);
  const height = Number(image?.height || state.primaryBitmap?.naturalHeight || state.primaryBitmap?.height || 0);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 1, height: 1 };
}

function multiAngleCubeMetrics(image = state.primaryImage) {
  const source = multiAngleSourceDimensions(image);
  const rawAspect = source.width / source.height;
  const aspect = round4(clamp(rawAspect || 1, 0.56, 1.9));
  const baseArea = 118 * 118;
  const width = Math.round(clamp(Math.sqrt(baseArea * aspect), 88, 158));
  const height = Math.round(clamp(Math.sqrt(baseArea / aspect), 82, 158));
  const depth = Math.round(clamp(Math.min(width, height) * 0.38 + 20, 46, 66));
  return {
    sourceWidth: Math.round(source.width),
    sourceHeight: Math.round(source.height),
    aspect,
    width,
    height,
    depth,
    label: source.width > 1 && source.height > 1 ? `${Math.round(source.width)}×${Math.round(source.height)}` : "1:1"
  };
}

function multiAngleAspectReadoutText(image = state.primaryImage) {
  const metrics = multiAngleCubeMetrics(image);
  return `识别比例 ${metrics.label} · 盒体 ${metrics.width}×${metrics.height}`;
}

function multiAngleCubeStyleVars(image = state.primaryImage) {
  const metrics = multiAngleCubeMetrics(image);
  return [
    `--ma-cube-w:${metrics.width}px`,
    `--ma-cube-h:${metrics.height}px`,
    `--ma-cube-d:${metrics.depth}px`,
    `--ma-cube-half-w:${round4(metrics.width / 2)}px`,
    `--ma-cube-half-h:${round4(metrics.height / 2)}px`,
    `--ma-cube-half-d:${round4(metrics.depth / 2)}px`,
    `--ma-image-aspect:${metrics.aspect}`
  ].join(";");
}

function multiAngleReadoutText(view = state.multiAngleView) {
  const next = normalizedMultiAngleViewState(view);
  if (next.mode === "camera") {
    return `摄像头 · 左右环绕 ${next.cameraX}° / 上下环绕 ${next.cameraY}° / ${multiAngleDistanceLabel(next.cameraDistance)}`;
  }
  return `主体 · X ${next.subjectX} / Y ${next.subjectY} / 转身 ${next.subjectRotate}°`;
}

function multiAnglePrompt(view = state.multiAngleView, image = state.multiAnglePanel.open ? state.multiAnglePanel.sourceImage : state.primaryImage) {
  const next = normalizedMultiAngleViewState(view);
  const metrics = multiAngleCubeMetrics(image);
  const mode = normalizeClientMode(state.mode);
  const planMode = isPlanWorkflowMode(mode);
  const stageControl = planMode
    ? mode === "plan-axonometric"
      ? "当前阶段是平面图转彩色平面图：最终图仍必须保持平面彩平的线稿结构和功能分区；可按纸张拖拽角度呈现纸面取景，但不允许挤出墙体、生成轴测模型或变成人视角效果图。"
      : mode === "plan-render"
        ? "当前阶段是轴测图转效果图：该动态只辅助理解轴测图区域、镜头远近和构图倾向；如果有红框选区，红框选区优先。"
        : "当前阶段属于平面图链路：该动态只作为纸张、取景和镜头倾向的辅助控制。"
    : "当前功能是普通图片多角度：把当前图当作同一主体/同一项目的强参考，根据用户调节的主体方位或摄像头机位生成新的角度；不要输出控制器界面本身。";
  return [
    planMode
      ? "多角度纸张动态控制器：该控件只用于平面图系列功能，包括平面图转彩色平面图、彩色平面图转轴测图、轴测图转效果图；普通效果图、材质替换、调色等非平面图功能不要出现或引用该控件。"
      : "多角度动态控制器：该控件用于普通图片的主体方位和摄像头方位调整，帮助生成同一对象、同一空间或同一项目的不同角度画面。",
    "控件本身、坐标、滑杆、边框、摄像头图标都不要生成到画面中。",
    stageControl,
    `原图比例识别：${metrics.label}，宽高比约 ${metrics.aspect.toFixed(2)}。控件会先按这个比例生成立体盒体，图片贴在盒体最前面；生成时也必须保留主体正面比例，不要强行变成正方形贴纸。`,
    `主体控制：X=${next.subjectX}, Y=${next.subjectY}, subjectTurn=${next.subjectRotate}deg。主体 X/Y 表示用户拖拽主体在画面里的位置偏移；subjectTurn 表示把图片主体想象成一个站立的人或物体后原地转身的角度，是 3D 身体/物体朝向变化，不是把整张图片当平面贴纸做 2D 旋转。`,
    `摄像头控制：cameraOrbitX=${next.cameraX}deg, cameraOrbitY=${next.cameraY}deg, distance=${next.cameraDistance}（${multiAngleDistanceLabel(next.cameraDistance)}）。cameraOrbitX 表示镜头左右绕主体环绕，cameraOrbitY 表示镜头上下抬高/压低环绕主体，distance 表示近景/中景/远景镜头距离。`,
    next.mode === "camera"
      ? "当前用户正在调整摄像头机位：优先按相机左右环绕、上下环绕、镜头距离和视线方向生成多角度视角图，同时保留当前功能要求的结构、材质、灯光或风格约束。"
      : "当前用户正在调整主体：优先按主体 X/Y 偏移和主体转身角度理解构图方向，同时保留当前功能要求的结构、材质、灯光或风格约束。"
  ].join("\n");
}

function multiAngleSliderHtml({ label, value, min, max, action, display = value }) {
  return `
    <label class="multi-angle-slider">
      <span>${escapeHtml(label)}</span>
      <strong data-multi-angle-value="${escapeAttr(action)}">${escapeHtml(String(display))}</strong>
      <input type="range" name="${escapeAttr(`multi-angle-${action}`)}" min="${min}" max="${max}" value="${escapeAttr(value)}" data-multi-angle-range="${escapeAttr(action)}" aria-label="${escapeAttr(label)}" />
    </label>
  `;
}

function multiAngleControlHtml({ title = "纸张多角度", actions = "node", image = state.multiAnglePanel.open ? state.multiAnglePanel.sourceImage : state.primaryImage, className = "" } = {}) {
  const view = normalizedMultiAngleViewState();
  const imageUrl = image?.dataUrl || image?.url || state.primaryImage?.dataUrl || "";
  const activeSubject = view.mode !== "camera";
  const modalActions = actions === "modal";
  const sliders = activeSubject
    ? modalActions
      ? [
          multiAngleSliderHtml({ label: "旋转", value: view.subjectRotate, min: -180, max: 180, action: "subjectRotate", display: view.subjectRotate }),
          multiAngleSliderHtml({ label: "倾斜", value: view.subjectY, min: -100, max: 100, action: "subjectY" }),
          multiAngleSliderHtml({ label: "缩放", value: view.cameraDistance, min: -100, max: 100, action: "cameraDistance", display: multiAngleDistanceLabel(view.cameraDistance) })
        ].join("")
      : [
          multiAngleSliderHtml({ label: "X轴位移", value: view.subjectX, min: -100, max: 100, action: "subjectX" }),
          multiAngleSliderHtml({ label: "Y轴位移", value: view.subjectY, min: -100, max: 100, action: "subjectY" }),
          multiAngleSliderHtml({ label: "主体转身", value: view.subjectRotate, min: -180, max: 180, action: "subjectRotate", display: view.subjectRotate })
        ].join("")
    : [
        multiAngleSliderHtml({ label: modalActions ? "旋转" : "左右环绕", value: view.cameraX, min: -180, max: 180, action: "cameraX" }),
        multiAngleSliderHtml({ label: modalActions ? "倾斜" : "上下环绕", value: view.cameraY, min: -90, max: 90, action: "cameraY" }),
        multiAngleSliderHtml({ label: modalActions ? "缩放" : "近景/远景", value: view.cameraDistance, min: -100, max: 100, action: "cameraDistance", display: multiAngleDistanceLabel(view.cameraDistance) })
      ].join("");
  const subjectViewYaw = wrapSignedDegrees(view.subjectRotate - view.cameraX);
  const subjectCameraPitch = Math.round(clamp(-view.cameraY * 0.42, -42, 42));
  const cameraModel = multiAngleCameraModel(view);
  const cubeStyle = multiAngleCubeStyleVars();
  return `
    <div class="multi-angle-control ${escapeAttr(className)}">
      <div class="multi-angle-head">
        <strong>${escapeHtml(title)}</strong>
        ${uiIconButton({ className: "text-button", icon: "icon-refresh", label: modalActions ? "重置角度" : "重置纸张角度", attrs: `data-multi-angle-action="reset"` })}
      </div>
      <div class="multi-angle-tabs" role="tablist" aria-label="纸张多角度控制">
        <button type="button" class="${activeSubject ? "active" : ""}" data-multi-angle-tab="subject" aria-pressed="${activeSubject ? "true" : "false"}">主体</button>
        <button type="button" class="${!activeSubject ? "active" : ""}" data-multi-angle-tab="camera" aria-pressed="${!activeSubject ? "true" : "false"}">摄像头</button>
      </div>
      <div class="multi-angle-stage" data-multi-angle-stage tabindex="0" style="${cubeStyle};--ma-subject-x:${view.subjectX}px;--ma-subject-y:${view.subjectY}px;--ma-subject-turn:${view.subjectRotate}deg;--ma-subject-view-yaw:${subjectViewYaw}deg;--ma-subject-camera-pitch:${subjectCameraPitch}deg;--ma-subject-lens-scale:${cameraModel.subjectLensScale};--ma-camera-x:${view.cameraX}deg;--ma-camera-y:${view.cameraY}deg;--ma-camera-distance:${view.cameraDistance};--ma-camera-pos-x:${cameraModel.x}px;--ma-camera-pos-y:${cameraModel.y}px;--ma-camera-scale:${cameraModel.cameraScale};--ma-camera-opacity:${cameraModel.cameraOpacity};--ma-camera-shadow-opacity:${cameraModel.shadowOpacity};--ma-camera-layer:${cameraModel.cameraLayer};--ma-camera-line-layer:${cameraModel.lineLayer};--ma-camera-line-length:${cameraModel.lineLength}px;--ma-camera-line-angle:${cameraModel.lineAngle}deg;--ma-camera-face-angle:${cameraModel.faceAngle}deg;--ma-camera-line-opacity:${cameraModel.lineOpacity};--ma-orbit-size:${cameraModel.orbitSize}px;" aria-label="纸张多角度视角：${escapeAttr(multiAngleReadoutText(view))}；${escapeAttr(multiAngleAspectReadoutText())}">
        <div class="multi-angle-orbit ${view.mode === "camera" ? "is-camera" : "is-subject"}" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="multi-angle-cube ${view.mode === "camera" ? "is-camera" : "is-subject"}" aria-hidden="true">
          <span class="multi-angle-cube-face is-front">${imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="" />` : ""}</span>
          <span class="multi-angle-cube-face is-right"><i>R</i></span>
          <span class="multi-angle-cube-face is-top"><b>T</b></span>
          <span class="multi-angle-cube-axis"></span>
        </div>
        <div class="multi-angle-camera-line" aria-hidden="true"></div>
        <div class="multi-angle-camera-shadow" aria-hidden="true"></div>
        <div class="multi-angle-camera" aria-hidden="true"><svg><use href="#icon-focus"></use></svg></div>
      </div>
      <div class="multi-angle-readout" data-multi-angle-readout>${escapeHtml(multiAngleReadoutText(view))}</div>
      <div class="multi-angle-aspect-readout" data-multi-angle-aspect-readout>${escapeHtml(multiAngleAspectReadoutText())}</div>
      <div class="multi-angle-sliders">
        ${sliders}
      </div>
      <div class="node-actions wrap multi-angle-actions">
        ${actions === "modal"
          ? `<button class="text-button" type="button" data-multi-angle-action="cancel">取消</button>
             <button class="primary-button" type="button" data-multi-angle-action="apply"><svg><use href="#icon-spark"></use></svg>立即使用</button>`
          : uiIconButton({ className: "secondary-button", icon: "icon-spark", label: "按此角度生成", attrs: `data-multi-angle-action="generate" ${state.primaryImage ? "" : "disabled"}` })}
      </div>
    </div>
  `;
}

function updateRenderedMultiAngleControls(root = document) {
  if (!root) return;
  const view = normalizedMultiAngleViewState();
  const subjectViewYaw = wrapSignedDegrees(view.subjectRotate - view.cameraX);
  const subjectCameraPitch = Math.round(clamp(-view.cameraY * 0.42, -42, 42));
  const cameraModel = multiAngleCameraModel(view);
  const cubeMetrics = multiAngleCubeMetrics();
  root.querySelectorAll("[data-multi-angle-stage]").forEach((stage) => {
    stage.style.setProperty("--ma-cube-w", `${cubeMetrics.width}px`);
    stage.style.setProperty("--ma-cube-h", `${cubeMetrics.height}px`);
    stage.style.setProperty("--ma-cube-d", `${cubeMetrics.depth}px`);
    stage.style.setProperty("--ma-cube-half-w", `${round4(cubeMetrics.width / 2)}px`);
    stage.style.setProperty("--ma-cube-half-h", `${round4(cubeMetrics.height / 2)}px`);
    stage.style.setProperty("--ma-cube-half-d", `${round4(cubeMetrics.depth / 2)}px`);
    stage.style.setProperty("--ma-image-aspect", String(cubeMetrics.aspect));
    stage.style.setProperty("--ma-subject-x", `${view.subjectX}px`);
    stage.style.setProperty("--ma-subject-y", `${view.subjectY}px`);
    stage.style.setProperty("--ma-subject-turn", `${view.subjectRotate}deg`);
    stage.style.setProperty("--ma-subject-view-yaw", `${subjectViewYaw}deg`);
    stage.style.setProperty("--ma-subject-camera-pitch", `${subjectCameraPitch}deg`);
    stage.style.setProperty("--ma-subject-lens-scale", String(cameraModel.subjectLensScale));
    stage.style.setProperty("--ma-camera-x", `${view.cameraX}deg`);
    stage.style.setProperty("--ma-camera-y", `${view.cameraY}deg`);
    stage.style.setProperty("--ma-camera-distance", String(view.cameraDistance));
    stage.style.setProperty("--ma-camera-pos-x", `${cameraModel.x}px`);
    stage.style.setProperty("--ma-camera-pos-y", `${cameraModel.y}px`);
    stage.style.setProperty("--ma-camera-scale", String(cameraModel.cameraScale));
    stage.style.setProperty("--ma-camera-opacity", String(cameraModel.cameraOpacity));
    stage.style.setProperty("--ma-camera-shadow-opacity", String(cameraModel.shadowOpacity));
    stage.style.setProperty("--ma-camera-layer", String(cameraModel.cameraLayer));
    stage.style.setProperty("--ma-camera-line-layer", String(cameraModel.lineLayer));
    stage.style.setProperty("--ma-camera-line-length", `${cameraModel.lineLength}px`);
    stage.style.setProperty("--ma-camera-line-angle", `${cameraModel.lineAngle}deg`);
    stage.style.setProperty("--ma-camera-face-angle", `${cameraModel.faceAngle}deg`);
    stage.style.setProperty("--ma-camera-line-opacity", String(cameraModel.lineOpacity));
    stage.style.setProperty("--ma-orbit-size", `${cameraModel.orbitSize}px`);
    stage.setAttribute("aria-label", `多角度视角：${multiAngleReadoutText(view)}；${multiAngleAspectReadoutText()}`);
  });
  root.querySelectorAll("[data-multi-angle-readout]").forEach((element) => {
    element.textContent = multiAngleReadoutText(view);
  });
  root.querySelectorAll("[data-multi-angle-aspect-readout]").forEach((element) => {
    element.textContent = multiAngleAspectReadoutText();
  });
  root.querySelectorAll("[data-multi-angle-tab]").forEach((button) => {
    const active = button.dataset.multiAngleTab === view.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  root.querySelectorAll("[data-multi-angle-value]").forEach((element) => {
    const key = element.dataset.multiAngleValue;
    element.textContent = key === "cameraDistance" ? multiAngleDistanceLabel(view.cameraDistance) : String(view[key] ?? "");
  });
  root.querySelectorAll("[data-multi-angle-range]").forEach((input) => {
    const key = input.dataset.multiAngleRange;
    if (key && key in view) input.value = String(view[key]);
  });
}

function ensureMultiAngleOverlay() {
  let overlay = document.getElementById("multiAngleOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "multiAngleOverlay";
  overlay.className = "multi-angle-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="multi-angle-dialog" role="dialog" aria-modal="true" aria-label="多角度">
      <div data-multi-angle-content></div>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeMultiAngleOverlay();
  });
  return overlay;
}

function bindMultiAngleOverlayEvents(overlay = ensureMultiAngleOverlay()) {
  overlay.querySelectorAll("[data-multi-angle-tab]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.multiAngleView = {
        ...normalizedMultiAngleViewState(state.multiAngleView),
        mode: button.dataset.multiAngleTab === "camera" ? "camera" : "subject",
        dragging: null
      };
      renderMultiAngleOverlay();
      scheduleCanvasStateSave({ delay: 180 });
    });
  });
  overlay.querySelectorAll("[data-multi-angle-range]").forEach((input) => {
    input.addEventListener("input", (event) => {
      event.stopPropagation();
      updateMultiAngleRange(input.dataset.multiAngleRange, input.value);
    });
  });
  overlay.querySelectorAll("[data-multi-angle-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleMultiAngleOverlayAction(button.dataset.multiAngleAction, button).catch((error) => toast(error.message));
    });
  });
  overlay.querySelectorAll("[data-multi-angle-stage]").forEach((stage) => {
    stage.addEventListener("pointerdown", startMultiAngleDrag);
    stage.addEventListener("pointermove", updateMultiAngleDrag);
    stage.addEventListener("pointerup", finishMultiAngleDrag);
    stage.addEventListener("pointercancel", finishMultiAngleDrag);
    stage.addEventListener("keydown", adjustMultiAngleByKeyboard);
  });
}

function renderMultiAngleOverlay() {
  const overlay = ensureMultiAngleOverlay();
  const content = overlay.querySelector("[data-multi-angle-content]");
  if (!content) return;
  content.innerHTML = multiAngleControlHtml({
    title: "多角度",
    actions: "modal",
    image: state.multiAnglePanel.sourceImage
  });
  bindMultiAngleOverlayEvents(overlay);
}

async function openMultiAngleOverlay(selected = null) {
  if (!selected?.url) return;
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
  const sourceImage = await imageSourceToPrimaryImage(selected);
  try {
    const bitmap = await loadImage(sourceImage.dataUrl);
    sourceImage.width = bitmap.naturalWidth || bitmap.width || 0;
    sourceImage.height = bitmap.naturalHeight || bitmap.height || 0;
  } catch {}
  state.multiAnglePanel = {
    open: true,
    selectedImage: selected,
    outputItem,
    sourceImage,
    busy: false
  };
  state.multiAngleView = {
    ...defaultMultiAngleViewState(),
    mode: normalizedMultiAngleViewState().mode
  };
  renderWorkflowCanvas();
  scheduleCanvasStateSave({ delay: 180 });
  requestAnimationFrame(() => {
    const node = document.querySelector(`[data-node-id="${CSS.escape(selected.id || "")}"]`);
    focusElement(node?.querySelector("[data-multi-angle-action='apply']"));
  });
}

function closeMultiAngleOverlay() {
  const overlay = document.getElementById("multiAngleOverlay");
  const wasOpen = overlay ? !overlay.hidden : state.multiAnglePanel.open;
  if (overlay) overlay.hidden = true;
  state.multiAnglePanel = {
    open: false,
    selectedImage: null,
    outputItem: null,
    sourceImage: null,
    busy: false
  };
  syncOverlayOpenClass();
  if (wasOpen) restoreOverlayFocus(overlay);
  renderWorkflowCanvas();
}

async function handleMultiAngleOverlayAction(action, button = null) {
  if (action === "cancel") {
    closeMultiAngleOverlay();
    return;
  }
  if (action === "reset") {
    const mode = normalizedMultiAngleViewState().mode;
    state.multiAngleView = {
      ...defaultMultiAngleViewState(),
      mode
    };
    renderMultiAngleOverlay();
    scheduleCanvasStateSave({ delay: 180 });
    return;
  }
  if (action === "apply") {
    const selected = state.multiAnglePanel.selectedImage;
    if (!selected?.url) return;
    setBusy(button, true, "生成中");
    state.multiAnglePanel.busy = true;
    try {
      closeMultiAngleOverlay();
      await generateMultiAngleFromCanvasImage(selected);
    } finally {
      setBusy(button, false);
      state.multiAnglePanel.busy = false;
    }
  }
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
  const detachedPrimaryInput = Boolean(primaryImage?.detachedPanelInput);
  const parentImageId = options.parentImageId || primaryImage?.parentImageId || (detachedPrimaryInput ? "" : primaryImage?.id) || state.canvas.branchAnchorOutputId || "";
  const sourceParentNodeId = primaryImage?.dataUrl && primaryImage === state.primaryImage ? "source" : "";
  const parentNodeId = options.parentNodeId || primaryImage?.parentNodeId || state.canvas.branchAnchorNodeId || sourceParentNodeId;
  const inputAnalysis = options.inputAnalysis || primaryImage?.inputAnalysis || state.primaryImageAnalysis || null;
  const inputImageType = inputAnalysis?.label || primaryImage?.sourceType || "";
  const isPlanColorStep = mode === "plan-axonometric";
  const isPlanAxonometricStep = mode === "plan-axonometric-view";
  const isPlanRenderStep = mode === "plan-render";
  const isPlanPaperAngleMode = isPlanPaperMode(mode);
  const isPlanMultiAngleStep = isPlanMultiAngleMode(mode);
  const planColorDecision = isPlanGuidanceMode(mode)
    ? { enabled: false, label: "推荐链路", reason: planWorkflowRecommendationText }
    : planColorPipelineDecision(null, mode);
  const usesPlanColorPipeline = false;
  const planPaperView = primaryImage && isPlanPaperAngleMode ? normalizedPlanPaperViewState() : null;
  const planPreflight = planGenerationPreflight(mode, primaryImage, inputAnalysis);
  const multiAngleMetrics = primaryImage && isPlanMultiAngleStep ? multiAngleCubeMetrics(primaryImage) : null;
  const multiAngleView = multiAngleMetrics
    ? {
        ...normalizedMultiAngleViewState(),
        sourceAspect: multiAngleMetrics.aspect,
        sourceWidth: multiAngleMetrics.sourceWidth,
        sourceHeight: multiAngleMetrics.sourceHeight
      }
    : null;
  const viewAngleReference = planPaperView
    ? await createPlanPaperViewReference(primaryImage, planPaperView, mode)
    : null;

  if (!primaryImage && !options.allowNoPrimary) {
    if (isPlanGuidanceMode(mode)) {
      setUploadStatus("error", config.missing, { target: "primary" });
    }
    toast(config.missing);
    return;
  }

  const useThinkingMode = Boolean(state.thinkingModeEnabled);
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
      text: usesPlanColorPipeline
      ? "正在按推荐链路生成：先把平面图转为彩色平面图，再用彩平和拖拽视角生成高精度轴测图。"
      : isPlanAxonometricStep && primaryImage
        ? `正在按${planPaperReadoutText()}生成高精度轴测图，并严格保留彩色平面布局。${planWorkflowRecommendationText}`
      : isPlanColorStep && primaryImage
        ? `正在按${planPaperReadoutText()}读取平面图，生成对应纸张视角的彩色平面图。${planWorkflowRecommendationText}`
      : isPlanRenderStep && primaryImage
        ? `正在按${planPaperReadoutText()}和选区关系，把轴测图区域生成人视角效果图。${planWorkflowRecommendationText}`
      : generationThinkingText(mode),
    detail: planPreflight?.text || ""
  };
  if (planPreflight?.text) {
    state.thinking.text = [state.thinking.text, planPreflight.text].filter(Boolean).join("\n");
  }
  renderWorkflowCanvas();
  const engineLabel = generationEngineLabel(mode);
  const pipelineLabel = useThinkingMode ? `gpt-5.5 → ${engineLabel}` : `预设提示词 → ${engineLabel}`;
  toast(usesPlanColorPipeline
    ? "推荐链路正在生成：彩色平面图 → 轴测图"
    : isPlanAxonometricStep && primaryImage
      ? "正在把彩色平面图整理成轴测图"
    : isPlanColorStep && primaryImage
      ? "正在按纸张拖拽角度生成彩色平面图"
    : isPlanRenderStep && primaryImage
      ? "正在按纸张拖拽角度生成效果图"
    : outputCount > 1 ? `${pipelineLabel}正在生成 ${outputCount} 张${config.resultTitle}` : `${pipelineLabel}正在生成${config.resultTitle}`);
  try {
    for (let index = 0; index < outputCount; index += 1) {
      updateActiveTask({
        current: index + 1,
        status: "running",
        phase: usesPlanColorPipeline ? "彩平中转" : useThinkingMode ? "提示词融合" : "生图中",
        endpoint: generationEndpointLabel(mode),
        event: usesPlanColorPipeline
          ? `开始推荐链路 ${index + 1}/${outputCount}：先彩色平面图，再高精度轴测图`
          : `开始生成第 ${index + 1}/${outputCount} 张`
      });
      const planPreflightPrompt = planPreflight?.text
        ? `生成前检查：\n${planPreflight.text}`
        : "";
      const baseVariantIntent = [intent, planPreflightPrompt].filter(Boolean).join("\n");
      const variantIntent = outputCount > 1
        ? `${baseVariantIntent}\n本次输出为第 ${index + 1}/${outputCount} 张变体，保持同一设计约束，但构图、陈列或灯光细节应有可比较差异。`
        : baseVariantIntent;
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
        viewAngleReference,
        planColorPipeline: usesPlanColorPipeline,
        planColorDecision,
        selection: renderSelection,
        planPaperView,
        multiAngleView,
        renderRegion: regionInfo,
        size: outputSize,
        quality: outputQuality,
        thinkingEnabled: useThinkingMode
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
        planPaperView,
        multiAngleView,
        planColorDecision,
        viewAngleReference: viewAngleReference
          ? {
              name: viewAngleReference.name,
              viewAngle: viewAngleReference.viewAngle,
              targetQuadrilateral: viewAngleReference.targetQuadrilateral,
              perspectiveMetrics: viewAngleReference.perspectiveMetrics,
              prompt: viewAngleReference.prompt
            }
          : null,
        renderRegion: regionInfo?.label || "",
        renderRegionPrompt: regionInfo?.prompt || "",
        intent: variantIntent,
        endpoint: data.render?.endpoint || "",
        referenceCount: data.render?.referenceCount ?? referenceImages.length,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      };
      state.render = record;
      state.renders.push(record);
      const latestOutputItem = {
        id: record.id,
        nodeId: `render${state.renders.length - 1}`,
        url: record.url,
        title: record.title,
        intent: record.intent || "",
        workflowId,
        parentImageId,
        parentNodeId
      };
      setCanvasBranchAnchor(outputItemToSelectedImage(latestOutputItem), latestOutputItem);
      updateActiveTask({
        success: state.activeTask.success + 1,
        phase: "保存结果",
        endpoint: data.render?.endpoint || state.activeTask.endpoint,
        finalPrompt: data.render?.prompt || state.activeTask.finalPrompt,
        outputs: [...state.activeTask.outputs, record],
        attempts: data.render?.attempts || [],
        event: `${regionInfo?.label ? `区域：${regionInfo.label} · ` : ""}第 ${index + 1}/${outputCount} 张完成`
      });
      state.thinking = {
        status: "done",
        target: record.title,
        text: record.pipeline?.enabled
          ? "推荐链路完成：原始平面图、彩色平面图和高精度轴测图已全部进入画布链路。"
          : data.render?.thinking || `已完成生成策略，并调用${generationEngineLabel(mode)}输出${config.resultTitle}。`
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
  updateActiveTask({ phase: "参考分析" });
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
    state.designSeriesAnalysis = enforceClientDesignSeriesProjectType(data.analysis);
    const fallbackReason = data.analysis?.fallback_reason || "";
    updateActiveTask({
      success: 1,
      phase: "完成",
      finalPrompt: state.designSeriesAnalysis?.image_prompt || state.designSeriesAnalysis?.series_strategy || "",
      event: fallbackReason ? `参考图分析降级，已用预设继续：${fallbackReason}` : "参考图识别完成"
    });
    applySeriesReferenceRoles(state.designSeriesAnalysis);
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

  const useThinkingMode = Boolean(state.thinkingModeEnabled);
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
      ? `${useThinkingMode ? "正在根据参考图识别结果组织成套设计策略" : "思考模式已关闭，正在使用设计系列预设"}，并调用 Image Gen 生成 ${outputCount} 张设计系列图。`
      : `${useThinkingMode ? "正在根据参考图识别结果组织成套设计策略" : "思考模式已关闭，正在使用设计系列预设"}，并调用 Image Gen 生成一套设计图。`
  };
  renderWorkflowCanvas();
  toast(outputCount > 1 ? `${useThinkingMode ? "gpt-5.5 → Image Gen" : "快速预设 → Image Gen"} 正在生成 ${outputCount} 张设计系列图，最多并发 ${DESIGN_SERIES_PARALLEL_LIMIT} 张` : `${useThinkingMode ? "gpt-5.5 → Image Gen" : "快速预设 → Image Gen"} 正在生成设计系列图`);
  try {
    let latestRecord = null;
    let reusableAnalysis = useThinkingMode ? state.designSeriesAnalysis : null;
    if (reusableAnalysis && !reusableAnalysis.project_dna && !reusableAnalysis.spatial_sequence && !reusableAnalysis.scene_briefs?.length) {
      reusableAnalysis = null;
      state.designSeriesAnalysis = null;
    }
    reusableAnalysis = enforceClientDesignSeriesProjectType(reusableAnalysis);
    let lockedSeriesAnalysis = reusableAnalysis ? cloneValue(reusableAnalysis) : null;
    const baseIntent = [
      buildCurrentIntent(),
      outputCount > 1 && outputCount !== state.generation.count ? designSeriesCountPrompt(outputCount) : ""
    ].filter(Boolean).join("\n");
    let analysisFallbackNotified = Boolean(reusableAnalysis?.fallback_reason);
    const taskBrief = readBrief();
    const taskUserPrompt = currentCanvasUserPrompt();
    const outputSize = selectedGenerationSize();
    const outputQuality = selectedGenerationQuality();
    const existingSeriesResults = [...state.designSeriesResults];
    const existingRenders = [...state.renders];
    const batchRecords = new Array(outputCount);
    const contiguousBatchCount = () => {
      let count = 0;
      while (count < batchRecords.length && batchRecords[count]) count += 1;
      return count;
    };
    const publishOrderedBatch = () => {
      const visibleRecords = batchRecords.slice(0, contiguousBatchCount());
      state.designSeriesResults = [...existingSeriesResults, ...visibleRecords];
      state.renders = [...existingRenders, ...visibleRecords];
      const visibleLatest = visibleRecords.at(-1);
      if (visibleLatest) state.render = visibleLatest;
      renderGeneratedResult();
      renderWorkflowCanvas();
    };
    const buildVariantIntent = (index, analysisForPrompt) => {
      const scenePrompt = designSeriesScenePrompt(index + 1, outputCount, analysisForPrompt);
      return outputCount > 1
        ? [
            baseIntent,
            scenePrompt,
            `本次输出为第 ${index + 1}/${outputCount} 张设计系列图。请让它承担这一套系列中的明确空间角色，并保持参考图风格、材质、元素、空间动线和项目DNA统一。`,
            `本轮锁定空间排布：${designSeriesScheduleText(outputCount, analysisForPrompt)}。第 ${index + 1} 张只能生成「${designSeriesLockedSchedule(outputCount, analysisForPrompt)[index]?.[0] || "当前锁定空间"}」。`,
            "唯一空间硬规则：整套图里每个空间角色只能出现一次；已经出现过的空间不能以换角度、换陈列、换灯光的形式再次出现。",
            "图片之间必须存在空间衔接关联：像同一个项目中的入口、公共区、私密区、过渡空间和细节节点，而不是同风格但互不相关的房间。",
            "统一风格不等于重复同一个角度；本张必须是多场域、多角度、多视角、多功能分区系列中的一个明确节点。",
            "本张需要和前后张共享可识别元素：连续墙地面材料、门洞/走廊/窗景、重复灯具、同款家具、木作/金属/石材节点、相同色彩分级或同一室外环境线索。",
            "构图、视角、陈列或灯光细节可以变化，但不能改变项目预算等级、家具年代、材质体系、灯光哲学、渲染风格和设计团队气质。",
            "必须按当前项目类型和出图数量执行空间排布；例如民宿/酒店项目不能只反复生成大堂或沙发区，必须覆盖大堂、公共客厅、主卧/客房、工区/茶室/餐吧、卫浴/泡池/走廊/材料节点等合适组合。",
            "禁止把同一个主视觉、同一个圆形大厅、同一个沙发区、同一个门头或同一个机位反复生成多张。"
          ].filter(Boolean).join("\n")
        : baseIntent;
    };
    const generateSeriesItem = async (index) => {
      const analysisForRequest = lockedSeriesAnalysis ? cloneValue(lockedSeriesAnalysis) : null;
      updateActiveTask({
        current: index + 1,
        phase: analysisForRequest ? "生图中" : "参考分析",
        endpoint: getActiveImageEndpoint(),
        event: `开始生成第 ${index + 1}/${outputCount} 张设计系列图`
      });
      const variantIntent = buildVariantIntent(index, analysisForRequest);
      const data = await api("/api/design-series", {
        brief: taskBrief,
        intent: variantIntent,
        userPrompt: taskUserPrompt,
        referenceImages,
        analysis: analysisForRequest,
        seriesIndex: index + 1,
        seriesCount: outputCount,
        size: outputSize,
        quality: outputQuality,
        thinkingEnabled: useThinkingMode,
        reuseSeriesReasoning: true,
        promptFusionEnabled: useThinkingMode
      });
      reusableAnalysis = enforceClientDesignSeriesProjectType(data.analysis);
      if (!lockedSeriesAnalysis && reusableAnalysis) {
        lockedSeriesAnalysis = cloneValue(reusableAnalysis);
      }
      state.designSeriesAnalysis = reusableAnalysis;
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
      batchRecords[index] = record;
      latestRecord = record;
      updateActiveTask({
        success: state.activeTask.success + 1,
        phase: "保存结果",
        endpoint: data.render?.endpoint || state.activeTask.endpoint,
        finalPrompt: data.render?.prompt || state.activeTask.finalPrompt,
        outputs: batchRecords.filter(Boolean),
        attempts: data.render?.attempts || [],
        event: `第 ${index + 1}/${outputCount} 张设计系列图完成`
      });
      publishOrderedBatch();
      return record;
    };

    if (!lockedSeriesAnalysis) {
      await generateSeriesItem(0);
    }
    const remainingIndexes = Array.from({ length: outputCount }, (_, index) => index)
      .filter((index) => !batchRecords[index]);
    await runWithConcurrency(remainingIndexes, DESIGN_SERIES_PARALLEL_LIMIT, (index) => generateSeriesItem(index));
    publishOrderedBatch();
    state.thinking = {
      status: "done",
      target: latestRecord?.title || "生成设计系列",
      text: outputCount > 1
        ? `${state.designSeriesAnalysis?.fallback_reason ? "参考图分析已降级为内置预设" : useThinkingMode ? "gpt-5.5 已完成参考图识别、系列建议和出图策略" : "已使用设计系列内置预设"}，并调用 Image Gen 生成 ${outputCount} 张设计系列图。`
        : `${state.designSeriesAnalysis?.fallback_reason ? "参考图分析已降级为内置预设" : useThinkingMode ? "gpt-5.5 已完成参考图识别、系列建议和出图策略" : "已使用设计系列内置预设"}，并调用 Image Gen 生成设计系列图。`
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
  const mode = normalizeClientMode(state.mode);
  const inputRequirement = generationInputRequirement(mode);
  if (!inputRequirement.ready) {
    setUploadStatus("error", inputRequirement.message, { target: inputRequirement.target || "primary" });
    toast(inputRequirement.message);
    refreshGenerationControls();
    renderWorkflowCanvas();
    return;
  }
  if (mode === "custom" && !hasCustomGenerationInput()) {
    const message = "请先描述设计目标，或上传主图 / 参考图后再生成。";
    setUploadStatus("error", message, { target: "primary" });
    toast(message);
    focusElement(els.canvasCommand);
    refreshGenerationControls();
    renderWorkflowCanvas();
    return;
  }
  if (mode === "custom") {
    await renderFromImages({ ...options, allowNoPrimary: true, ignorePrimaryImage: !state.primaryImage });
    return;
  }
  if (mode === "panorama") {
    await renderFromImages({ ...options, allowNoPrimary: true, ignorePrimaryImage: !state.primaryImage });
    return;
  }
  if (mode === "cad") {
    await convertPlanToCad(options);
    return;
  }
  if (normalizeClientMode(mode) === "image-modeling") {
    await convertPlanToCad({ ...options, fromImageModeling: true });
    return;
  }
  if (mode === "design-derivation") {
    await createPlan({ ...options, mode: "design-derivation" });
    return;
  }
  if (mode === "designseries") {
    await generateDesignSeries(options);
    return;
  }
  if (mode === "upscale") {
    await enhanceQualityCurrentImage(options);
    return;
  }
  if (mode === "sharpen") {
    await sharpenCurrentImage(options);
    return;
  }
  if (mode === "colorgrade") {
    await openPrimaryImageColorGrade();
    return;
  }
  if (mode === "cutout") {
    await openPrimaryImageCutout();
    return;
  }
  if (mode === "materialboard" && !state.primaryImage && activeReferenceImages().length) {
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

function imageModelingPreprocessMeta(action = "white-background", analysis = currentImageModelingAnalysis()) {
  if (action === "cad-reference") {
    return {
      type: "image-modeling-cad-reference",
      label: "生成CAD结构参考图",
      button: "生成中",
      target: "CAD结构参考图",
      toastStart: "正在生成CAD结构参考图",
      toastDone: "CAD结构参考图已生成，可以导出 DXF / SVG",
      doneText: "已生成 CAD 结构参考图。下一步会优先从这张结构参考图提取 DXF / SVG 线稿，原图只作为对照。"
    };
  }
  if (action === "outpaint") {
    return {
      type: "image-modeling-outpaint",
      label: "完善主体建筑扩图",
      button: "扩图中",
      target: "完善主体建筑",
      toastStart: "正在完善主体建筑扩图",
      toastDone: "主体建筑扩图已完成，可以继续生成 CAD 结构参考图",
      doneText: "主体建筑扩图已完成。现在可以继续生成白底图或 CAD 结构参考图，再导出 DXF / SVG。"
    };
  }
  if (action === "white-from-expanded") {
    return {
      type: "image-modeling-white-from-expanded",
      label: "可选生成白底图",
      button: "生成中",
      target: "可选白底图",
      toastStart: "正在从扩图结果生成白底主体图",
      toastDone: "白底主体图已生成，可以继续生成 CAD 结构参考图",
      doneText: "已基于扩图结果生成白底主体图。现在可以继续生成 CAD 结构参考图，或直接导出 DXF / SVG。"
    };
  }
  return {
    type: "image-modeling-white-background",
    label: "生成主体白底图",
    button: "生成中",
    target: "主体白底图",
    toastStart: "正在生成主体建筑白底图",
    toastDone: "白底主体图已生成，可以继续生成 CAD 结构参考图",
    doneText: analysis?.expandedSubjectImage
      ? "已生成主体白底图。现在可以继续生成 CAD 结构参考图，或直接导出 DXF / SVG。"
      : "已从原图生成主体建筑白底图。现在可以继续生成 CAD 结构参考图，或直接导出 DXF / SVG。"
  };
}

function imageModelingPreparedInputLabel(analysis = currentImageModelingAnalysis()) {
  if (currentImageModelingWhiteBackgroundImage(analysis)) return "白底图";
  if (currentImageModelingExpandedImage(analysis)) return "扩图";
  if (state.primaryImage) return "原始参考图";
  return "";
}

async function runImageModelingPreprocess(action = "white-background", button = els.imageModelingAnalyzeButton) {
  if (!state.primaryBitmap || !state.primaryImage) {
    toast(modeConfig("image-modeling").missing);
    return;
  }
  const previousAnalysis = currentImageModelingAnalysis();
  const expandedSubjectImage = currentImageModelingExpandedImage(previousAnalysis);
  const preparedModelingImage = currentImageModelingPreparedImage(previousAnalysis);
  const cadReferenceSourceImage = preparedModelingImage || state.primaryImage;
  if (action === "white-from-expanded" && !expandedSubjectImage?.dataUrl) {
    toast("请先完成主体建筑扩图");
    return;
  }
  const meta = imageModelingPreprocessMeta(action, previousAnalysis);
  const userPrompt = currentCanvasUserPrompt();
  startActiveTask({
    type: meta.type,
    label: meta.label,
    total: 1,
    userPrompt,
    referenceCount: activeReferenceImages().length,
    endpoint: getActiveImageEndpoint()
  });
  setBusy(button, true, meta.button);
  const startedAt = new Date();
  state.imageModelingAnalysisConfirmed = action === "cad-reference"
    ? Boolean(currentImageModelingPreparedImage(previousAnalysis))
    : false;
  state.thinking = {
    status: "active",
    target: meta.target,
    text: action === "cad-reference"
      ? `正在基于${currentImageModelingWhiteBackgroundImage(previousAnalysis) ? "白底主体图" : currentImageModelingExpandedImage(previousAnalysis) ? "主体扩图" : "原始参考图"}生成 CAD 结构参考图；后续会优先从这张结构参考图导出 DXF / SVG。`
      : action === "outpaint"
        ? "正在基于原始参考图完善主体建筑的缺失边界、屋顶、侧面、底部和透视延续；完成后可以直接建模，也可以选择再生成白底主体图。"
        : action === "white-from-expanded"
          ? "正在基于扩图结果提取完整主体建筑，生成纯白背景的建模参考图。"
          : "正在基于原始参考图提取主体建筑，直接生成纯白背景的建模参考图。"
  };
  renderWorkflowCanvas();
  toast(meta.toastStart);

  try {
    const primaryImage = await compactImageForApi(state.primaryImage, "primary");
    const data = await api("/api/image-modeling/analyze", {
      brief: readBrief(),
      intent: buildCurrentIntent(),
      userPrompt,
      primaryImage,
      preprocessAction: action,
      expandedSubjectImage: expandedSubjectImage ? await compactImageForApi(expandedSubjectImage, "reference") : null,
      cadReferenceSourceImage: action === "cad-reference" && cadReferenceSourceImage
        ? await compactImageForApi(cadReferenceSourceImage, "reference")
        : null,
      cadReferenceSourceRole: action === "cad-reference"
        ? currentImageModelingWhiteBackgroundImage(previousAnalysis)
          ? "white-background-subject-reference"
          : currentImageModelingExpandedImage(previousAnalysis)
            ? "expanded-subject-reference"
            : "original-photo-reference"
        : "",
      modelingAnalysis: previousAnalysis || null,
      inputAnalysis: state.primaryImageAnalysis || state.primaryImage.inputAnalysis || null
    });
    const nextAnalysis = action === "cad-reference"
      ? {
          ...(previousAnalysis || {}),
          ...data.analysis,
          expandedSubjectImage: previousAnalysis?.expandedSubjectImage || data.analysis?.expandedSubjectImage || null,
          whiteBackgroundImage: previousAnalysis?.whiteBackgroundImage || data.analysis?.whiteBackgroundImage || null,
          modelingPrepass: previousAnalysis?.modelingPrepass || data.analysis?.modelingPrepass || null,
          cadReferenceImage: data.analysis?.cadReferenceImage || previousAnalysis?.cadReferenceImage || null,
          modelingCadPrepass: data.analysis?.modelingCadPrepass || previousAnalysis?.modelingCadPrepass || null,
          cadReferenceParameters: data.analysis?.cadReferenceParameters || previousAnalysis?.cadReferenceParameters || null,
          sourceKey: imageModelingSourceKey()
        }
      : {
          ...(previousAnalysis || {}),
          ...data.analysis,
          expandedSubjectImage: data.analysis?.expandedSubjectImage || previousAnalysis?.expandedSubjectImage || null,
          whiteBackgroundImage: data.analysis?.whiteBackgroundImage || previousAnalysis?.whiteBackgroundImage || null,
          cadReferenceImage: data.analysis?.cadReferenceImage || null,
          modelingCadPrepass: data.analysis?.modelingCadPrepass || null,
          cadReferenceParameters: data.analysis?.cadReferenceParameters || null,
          sourceKey: imageModelingSourceKey()
        };
    state.imageModelingAnalysis = {
      ...nextAnalysis,
      sourceKey: imageModelingSourceKey()
    };
    const prepassImage = data.analysis?.whiteBackgroundImage
      || data.analysis?.expandedSubjectImage
      || data.analysis?.cadReferenceImage
      || data.analysis?.modelingCadPrepass?.image
      || data.analysis?.modelingPrepass?.image
      || null;
    addImageModelingPrepassRender(prepassImage);
    state.imageModelingAnalysisConfirmed = Boolean(currentImageModelingPreparedImage(state.imageModelingAnalysis));
    state.thinking = {
      status: "done",
      target: data.analysis?.subject || meta.target,
      text: meta.doneText
    };
    updateActiveTask({
      success: 1,
      phase: currentImageModelingWhiteBackgroundImage(state.imageModelingAnalysis)
        ? "白底图就绪"
        : currentImageModelingExpandedImage(state.imageModelingAnalysis)
          ? "扩图可建模"
          : currentImageModelingCadReferenceImage(state.imageModelingAnalysis)
            ? "CAD参考就绪"
            : "待预处理",
      finalPrompt: data.analysis?.summary || userPrompt,
      event: currentImageModelingWhiteBackgroundImage(state.imageModelingAnalysis)
        ? "白底主体图生成完成"
        : currentImageModelingExpandedImage(state.imageModelingAnalysis)
          ? "主体扩图完成，可直接建模"
          : currentImageModelingCadReferenceImage(state.imageModelingAnalysis)
            ? "CAD结构参考图生成完成"
            : "等待图片建模预处理"
    });
    logClientTask(meta.type, {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: {
        mode: "image-modeling",
        preprocessAction: action,
        primaryImage: { name: state.primaryImage.name, type: state.primaryImage.type },
        userPrompt
      },
      result: {
        title: data.analysis?.subject || meta.target,
        analysisTitle: data.analysis?.subject || "",
        analysisSummary: data.analysis?.summary || "",
        completeness: data.analysis?.completeness?.label || ""
      }
    });
    completeActiveTask("success", meta.label);
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();
    scheduleCanvasStateSave({ delay: 200 });
    toast(meta.toastDone);
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `${meta.label}失败：${error.message}` });
    state.thinking = {
      status: "idle",
      target: meta.target,
      text: `${meta.label}未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    setBusy(button, false);
    refreshGenerationControls();
    renderWorkflowCanvas();
  }
}

async function analyzeImageModelingSubjectFromPhoto(button = els.imageModelingAnalyzeButton) {
  return runImageModelingPreprocess("white-background", button);
}

async function generateImageModelingCadReference(button = els.imageModelingCadReferenceButton) {
  return runImageModelingPreprocess("cad-reference", button);
}

function confirmImageModelingSubject() {
  const analysis = currentImageModelingAnalysis();
  if (!state.primaryImage) {
    toast(modeConfig("image-modeling").missing);
    return;
  }
  if (currentImageModelingWhiteBackgroundImage(analysis)) {
    state.imageModelingAnalysisConfirmed = true;
    refreshGenerationControls();
    renderWorkflowCanvas();
    toast("白底主体图已就绪，可以生成3D模型");
    return;
  }
  const action = currentImageModelingExpandedImage(analysis) ? "white-from-expanded" : "outpaint";
  return runImageModelingPreprocess(action, els.imageModelingConfirmButton);
}

function imageModelingRenderFromMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const url = meta.url || meta.dataUrl || "";
  if (!url) return null;
  const stepMode = meta.stepMode || "image-modeling-white-background";
  const stepText = String(stepMode || "").toLowerCase();
  const createdAt = meta.createdAt
    ? new Date(meta.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return {
    id: meta.id || `image-modeling-white-${Date.now()}`,
    title: meta.title || "白底建模参考图",
    url,
    mode: "image-modeling",
    stepMode,
    inputImageType: meta.inputImageType || (stepText.includes("cad-reference")
      ? "cad-structure-reference"
      : stepText.includes("outpaint")
        ? "expanded-subject-reference"
        : "white-background-subject-reference"),
    intent: meta.intent || (stepText.includes("cad-reference")
      ? "生图模式生成 CAD 结构参考图，帮助 gpt-5.5 在正式建模时稳定识别体块、开口和层级。"
      : stepText.includes("outpaint")
        ? "生图模式完善主体建筑扩图，可直接作为 3D 建模输入，也可选生成白底主体图。"
        : "生图模式生成白底主体标准图，作为 3D 建模输入。"),
    prompt: meta.prompt || "",
    sourcePrompt: meta.prompt || "",
    endpoint: meta.endpoint || "",
    imageApi: meta.imageApi || "",
    actualParams: meta.actualParams || null,
    revisedPrompt: meta.revisedPrompt || "",
    createdAt
  };
}

function addImageModelingPrepassRender(meta) {
  const result = imageModelingRenderFromMeta(meta);
  if (!result) return null;
  const existingIndex = state.renders.findIndex((item) => item.url && item.url === result.url);
  if (existingIndex >= 0) return state.renders[existingIndex];
  state.imageToolResults.push(result);
  state.render = result;
  state.renders.push(result);
  return result;
}

async function generateImageModelFromPhoto(options = {}) {
  if (!state.primaryBitmap || !state.primaryImage) {
    toast(modeConfig(state.mode).missing);
    return;
  }
  const modelingAnalysis = currentImageModelingAnalysis();
  const preparedWhiteBackgroundImage = currentImageModelingWhiteBackgroundImage(modelingAnalysis);
  const preparedExpandedImage = currentImageModelingExpandedImage(modelingAnalysis);
  const activeCadReferenceImage = currentImageModelingCadReferenceImage(modelingAnalysis);
  const preparedModelingImage = preparedWhiteBackgroundImage || preparedExpandedImage || state.primaryImage;
  const modelingInputLabel = activeCadReferenceImage
    ? "CAD结构参考图"
    : preparedWhiteBackgroundImage
    ? "白底主体图"
    : preparedExpandedImage
      ? "主体扩图"
      : "原始参考图";

  const busyButton = options.busyButton || els.renderButton;
  const userPrompt = currentCanvasUserPrompt();
  startActiveTask({
    type: "image-modeling",
    label: "图片建模",
    total: 1,
    userPrompt,
    referenceCount: activeReferenceImages().length,
    endpoint: getReasoningEndpointLabel()
  });
  setBusy(busyButton, true, "建模中");
  const startedAt = new Date();
  state.thinking = {
    status: "active",
    target: "图片建模",
    text: activeCadReferenceImage
      ? `正在直接按照CAD结构参考图“${activeCadReferenceImage.title || activeCadReferenceImage.name || modelingAnalysis?.subject || "主体"}”生成可导入 CAD 的参数化 3D 模型，原图仅用于校验主体与颜色材质。`
      : `正在基于${modelingInputLabel}“${preparedModelingImage.title || preparedModelingImage.name || modelingAnalysis?.subject || "主体"}”生成可导入 CAD 的参数化 3D 模型。`
  };
  renderWorkflowCanvas();
  toast(activeCadReferenceImage
    ? "正在直接按CAD结构参考图建模"
    : preparedWhiteBackgroundImage
      ? "正在基于白底主体图建模"
      : preparedExpandedImage
        ? "正在基于扩图结果建模"
        : "正在基于原始参考图建模");

  try {
    const useExpandedDirectly = Boolean(preparedExpandedImage?.dataUrl && !preparedWhiteBackgroundImage?.dataUrl);
    const useOriginalDirectly = Boolean(!preparedWhiteBackgroundImage?.dataUrl && !preparedExpandedImage?.dataUrl);
    const modelingAnalysisForApi = useExpandedDirectly
      ? {
          ...modelingAnalysis,
          expandedSubjectImage: null,
          modelingPrepass: null,
          whiteBackgroundImage: null,
          preprocessAction: modelingAnalysis?.preprocessAction || "outpaint"
        }
      : useOriginalDirectly
        ? {
            ...(modelingAnalysis || {}),
            preprocessAction: modelingAnalysis?.preprocessAction || "original-direct",
            modelingScope: modelingAnalysis?.modelingScope || "final modeling uses the original uploaded image directly; white-background, outpaint, and CAD reference images are optional aids"
          }
        : modelingAnalysis;
    const modelingAnalysisWithCadReference = activeCadReferenceImage?.dataUrl
      ? {
          ...(modelingAnalysisForApi || {}),
          cadReferenceImage: activeCadReferenceImage,
          cadReferenceParameters: modelingAnalysisForApi?.cadReferenceParameters || modelingAnalysis?.cadReferenceParameters || null,
          modelingCadPrepass: {
            ...(modelingAnalysisForApi?.modelingCadPrepass || modelingAnalysis?.modelingCadPrepass || {}),
            used: true,
            reused: true,
            image: activeCadReferenceImage,
            originalImageName: state.primaryImage?.name || activeCadReferenceImage.originalImageName || null
          },
          modelingBasis: "cad-reference",
          modelingScope: "final modeling must use the generated CAD structure reference image as the primary geometry source; original photo is secondary evidence for subject identity, color/material zones, and omitted non-geometry."
        }
      : modelingAnalysisForApi;
    const data = await api("/api/image-modeling", {
      brief: readBrief(),
      intent: buildCurrentIntent(),
      userPrompt,
      primaryImage: await compactImageForApi(useExpandedDirectly ? preparedExpandedImage : state.primaryImage, "primary"),
      referenceImages: activeReferenceImages(),
      inputAnalysis: state.primaryImageAnalysis || state.primaryImage.inputAnalysis || null,
      modelingAnalysis: modelingAnalysisWithCadReference,
      modelingBasis: activeCadReferenceImage?.dataUrl ? "cad-reference" : "source-image",
      skipWhiteBackgroundPrepass: useExpandedDirectly || useOriginalDirectly,
      skipCadReferencePrepass: !activeCadReferenceImage?.dataUrl
    });
    const whiteBackgroundImage = data.model?.whiteBackgroundImage
      || data.model?.modelingPrepass?.image
      || data.model?.modelingAnalysis?.whiteBackgroundImage
      || null;
    const returnedCadReferenceImage = data.model?.cadReferenceImage
      || data.model?.modelingCadPrepass?.image
      || data.model?.modelingAnalysis?.cadReferenceImage
      || null;
    addImageModelingPrepassRender(whiteBackgroundImage);
    addImageModelingPrepassRender(returnedCadReferenceImage);
    const returnedModelingAnalysis = data.model?.modelingAnalysis || data.model?.analysis || null;
    state.imageModelingAnalysis = {
      ...(modelingAnalysis || {}),
      ...(returnedModelingAnalysis || {}),
      whiteBackgroundImage: whiteBackgroundImage || returnedModelingAnalysis?.whiteBackgroundImage || modelingAnalysis?.whiteBackgroundImage || null,
      modelingPrepass: data.model?.modelingPrepass || returnedModelingAnalysis?.modelingPrepass || modelingAnalysis?.modelingPrepass || null,
      cadReferenceImage: returnedCadReferenceImage || returnedModelingAnalysis?.cadReferenceImage || modelingAnalysis?.cadReferenceImage || null,
      modelingCadPrepass: data.model?.modelingCadPrepass || returnedModelingAnalysis?.modelingCadPrepass || modelingAnalysis?.modelingCadPrepass || null,
      cadReferenceParameters: data.model?.cadReferenceParameters || returnedModelingAnalysis?.cadReferenceParameters || modelingAnalysis?.cadReferenceParameters || null,
      sourceKey: imageModelingSourceKey()
    };
    const model = {
      ...data.model,
      id: data.model?.id || `image-model-${Date.now()}`,
      mode: "image-modeling",
      sourceImageDataUrl: whiteBackgroundImage?.dataUrl || preparedModelingImage.dataUrl || state.primaryImage.dataUrl,
      createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    };
    state.whiteModelResult = model;
    state.whiteModelResults.push(model);
    const subjectText = model.modelingAnalysis?.subject ? `主体：${model.modelingAnalysis.subject}。` : "";
    state.thinking = {
      status: "done",
      target: model.title || "图片建模",
      text: `${subjectText}${whiteBackgroundImage ? `白底主体标准图${model.modelingAnalysis?.completeness?.isComplete === false ? "（扩图补全）" : ""}已作为建模输入。` : ""}已生成 ${model.objectCount || model.objects?.length || 0} 个参数化对象。可在画布中旋转预览，并导出 GLB / SCAD / DXF 足迹继续进 CAD。`
    };
    updateActiveTask({
      success: 1,
      phase: "完成",
      finalPrompt: model.summary || userPrompt,
      outputs: [model],
      event: "图片建模完成"
    });
    renderWorkflowCanvas();
    renderWorkspaceHistoryPanel();
    logClientTask("image-modeling", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: {
        mode: "image-modeling",
        primaryImage: { name: state.primaryImage.name, type: state.primaryImage.type },
        referenceCount: activeReferenceImages().length,
        userPrompt
      },
      result: {
        title: model.title,
        objectCount: model.objectCount || model.objects?.length || 0,
        outputFile: model.fileBase,
        thinking: model.summary || "",
        analysisTitle: model.modelingAnalysis?.subject || "",
        analysisSummary: model.modelingAnalysis?.summary || "",
        completeness: model.modelingAnalysis?.completeness?.label || ""
      }
    });
    completeActiveTask("success", "3D 模型已生成");
    toast("图片建模完成");
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `图片建模失败：${error.message}` });
    state.thinking = {
      status: "idle",
      target: "图片建模",
      text: `图片建模未完成：${error.message}`
    };
    completeActiveTask("failed");
    toast(error.message);
  } finally {
    setBusy(busyButton, false);
    renderWorkflowCanvas();
  }
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
    toast(options.fromImageModeling ? "请先上传要转成 CAD 的图片" : "请先上传平面图图片");
    return;
  }

  const busyButton = options.busyButton || els.renderButton;
  const imageToCad = Boolean(options.fromImageModeling || normalizeClientMode(state.mode) === "image-modeling");
  const modelingAnalysis = imageToCad ? currentImageModelingAnalysis() : null;
  const cadReferenceImage = imageToCad ? currentImageModelingCadReferenceImage(modelingAnalysis) : null;
  const whiteBackgroundImage = imageToCad ? currentImageModelingWhiteBackgroundImage(modelingAnalysis) : null;
  const cadSourceImage = cadReferenceImage || whiteBackgroundImage || state.primaryImage;
  const cadSourceLabel = cadReferenceImage
    ? "CAD结构参考图"
    : whiteBackgroundImage
      ? "白底主体图"
      : "原始图片";
  const taskLabel = imageToCad ? "图片转 CAD" : "平面图转 CAD";
  const taskTarget = imageToCad ? "图片转CAD" : "平面图转CAD";
  startActiveTask({
    type: "local-cad",
    label: taskLabel,
    total: 1,
    userPrompt: currentCanvasUserPrompt(),
    referenceCount: 0
  });
  setBusy(busyButton, true, "提取中");
  const startedAt = new Date();
  state.thinking = {
    status: "active",
    target: taskTarget,
    text: imageToCad
      ? `正在优先读取${cadSourceLabel}里的深色墙线、水平/垂直线段、开口和主要轮廓，并生成 DXF / SVG 文件。${cadReferenceImage ? "" : "建议链路里也可以先生成白底图和 CAD 结构参考图，让线稿更稳。"}`
      : `正在识别图纸里的深色墙线、水平/垂直线段、开口和主要轮廓，并生成 DXF / SVG 文件。${featureOptimizationNotes.cad}`
  };
  renderWorkflowCanvas();

  try {
    const sourceBitmap = cadSourceImage === state.primaryImage
      ? state.primaryBitmap
      : await loadImage(cadSourceImage.dataUrl);
    const result = extractCadFromBitmap(sourceBitmap, readBrief().projectName || cadSourceImage.title || cadSourceImage.name || state.primaryImage.name || "image-cad", {
      title: imageToCad ? "图片转 CAD" : "平面图 CAD",
      mode: imageToCad ? "image-modeling" : "cad",
      sourceLabel: cadSourceLabel
    });
    state.cadResult = result;
    state.cadResults.push(result);
    state.thinking = {
      status: "done",
      target: taskTarget,
      text: `已从${cadSourceLabel}提取 ${result.lineCount} 条 CAD 线段。第一版采用轻量图像矢量化，适合快速描底；后续可继续人工清线或叠加 AI 识别墙、门、窗、房间。`
    };
    updateActiveTask({
      success: 1,
      finalPrompt: `${result.lineCount} 条线段 · ${result.fileBase}.dxf`,
      outputs: [result],
      event: "CAD 线段提取完成"
    });
    renderWorkflowCanvas();
    renderWorkspaceHistoryPanel();
    logClientTask("local-cad", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: {
        mode: imageToCad ? "image-modeling" : "cad",
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
      target: taskTarget,
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
  const referenceOnly = isReferenceOnlyMode() || (normalizeClientMode(state.mode) === "custom" && !state.primaryImage);
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
    : state.mode === "panorama"
      ? `图片比例：${selectedGenerationAspectLabel()}；画质：${state.generation.quality.toUpperCase()}；尺寸：${size.width}x${size.height}；出图数量：${state.generation.count}；生成形式：360 equirectangular panorama`
      : `图片比例：${selectedGenerationAspectLabel()}；画质：${state.generation.quality.toUpperCase()}；尺寸：${size.width}x${size.height}；出图数量：${state.generation.count}`;
  const designSeriesCountText = state.mode === "designseries" ? designSeriesCountPrompt(state.generation.count) : "";
  const designSeriesVisualTypeText = state.mode === "designseries"
    ? "设计系列识别优先级：先整体识别上传参考图的真实项目类型，再决定分镜排布；旧模板、旧 brief、隐藏预设或上一次项目上下文如果和参考图冲突，不能覆盖参考图视觉证据。"
    : "";
  const inputAnalysisText = state.primaryImageAnalysis
    ? `输入图识别：${state.primaryImageAnalysis.label}；建议模式：${suggestedModeLabel(state.primaryImageAnalysis.suggestedMode)}；判断理由：${state.primaryImageAnalysis.reason}。如果用户当前选择的按钮不同，不强制拦截，但最终提示词必须显式处理这种风险。`
    : "";
  const workflowText = state.primaryImage?.workflowId
    ? `连续工作流：workflowId=${state.primaryImage.workflowId}；parentImageId=${state.primaryImage.parentImageId || ""}；当前阶段=${workflowStepLabel(state.mode)}。`
    : isPlanWorkflowMode(state.mode)
      ? `连续工作流：当前阶段=${workflowStepLabel(state.mode)}；本次输出需要可作为下一步输入。`
      : "";
  const selectionText = state.selection
    ? `红框选区：x=${state.selection.x}, y=${state.selection.y}, width=${state.selection.width}, height=${state.selection.height}。如果当前是“轴测图转效果图”，最终人视角画面必须聚焦这个区域，同时保留整体空间逻辑。`
    : "";
  const planRenderRegionText = normalizeClientMode(state.mode) === "plan-render"
    ? planRenderRegionInfo(state.mode, state.selection, referenceImages)?.prompt || ""
    : "";
  const planPaperViewText = state.primaryImage && isPlanPaperMode(state.mode)
    ? planPaperPrompt(state.planPaperView, state.mode)
    : "";
  const multiAngleViewText = state.primaryImage && isPlanMultiAngleMode(state.mode)
    ? multiAnglePrompt()
    : "";
  const scenePresetText = state.selectedScenePreset && presets[state.selectedScenePreset] && modeAllowsScenePreset(state.mode)
    ? `场景模板：${presets[state.selectedScenePreset].spaceType}；${presets[state.selectedScenePreset].command}`
    : "";
  const styleText = state.selectedStylePreset && stylePresetDescriptions[state.selectedStylePreset] && modeAllowsStylePreset(state.mode)
    ? `风格按钮：${state.selectedStylePreset}；${stylePresetDescriptions[state.selectedStylePreset]}`
    : "";
  const hiddenPrompt = hiddenCanvasPromptBlock({ mode: state.mode });
  const userPrompt = userPromptPriorityBlock();
  const fastDirectMode = !state.thinkingModeEnabled;
  if (fastDirectMode) {
    return [
      `当前能力按钮：${meaning.label}`,
      `按钮意义：${meaning.meaning}`,
      "思考模式：关闭。不做额外提示词融合，使用快速预设和用户描述直接生图。",
      `保留重点：${meaning.preserve}`,
      `变化重点：${meaning.change}`,
      inputAnalysisText,
      workflowText,
      selectionText,
      planRenderRegionText,
      planPaperViewText,
      multiAngleViewText,
      referenceText,
      `输出类型：${els.outputType.value}`,
      generationText,
      designSeriesCountText,
      designSeriesVisualTypeText,
      scenePresetText ? compactTaskLogText(scenePresetText, 240) : "",
      styleText ? compactTaskLogText(styleText, 180) : "",
      resourceText ? compactTaskLogText(resourceText, 220) : "",
      els.renderIntent.value.trim(),
      userPrompt
    ].filter(Boolean).join("\n");
  }
  return [
    `当前能力按钮：${meaning.label}`,
    `按钮意义：${meaning.meaning}`,
    state.thinkingModeEnabled
      ? "思考模式：开启。先用 gpt-5.5 读取输入图、参考图、当前按钮功能、用户描述和预设模板，再优化最终提示词交给 Image Gen。"
      : "思考模式：关闭。不做额外提示词融合，使用快速预设和用户描述直接生图。",
    featureOptimizationNotes[normalizeClientMode(state.mode)],
    `保留重点：${meaning.preserve}`,
    `变化重点：${meaning.change}`,
    inputAnalysisText,
    workflowText,
    selectionText,
    planRenderRegionText,
    planPaperViewText,
    multiAngleViewText,
    referenceText,
    `输出类型：${els.outputType.value}`,
    structureText,
    generationText,
    designSeriesCountText,
    designSeriesVisualTypeText,
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
  if (isPanoramaMode()) return "2:1 全景";
  return state.generation.aspect === "source" ? "参考原图比例" : state.generation.aspect;
}

function selectedGenerationAspectShortLabel() {
  if (isPanoramaMode()) return "2:1 全景";
  return state.generation.aspect === "source" ? "原图比例" : state.generation.aspect;
}

function isPanoramaMode(mode = state.mode) {
  return normalizeClientMode(mode) === "panorama";
}

function updateAspectRatioSelectForMode(select, mode = state.mode, { lockWhenPanorama = false } = {}) {
  if (!select) return;
  const panoramaMode = isPanoramaMode(mode);
  Array.from(select.options).forEach((option) => {
    const allowed = !panoramaMode || option.value === PANORAMA_ASPECT_RATIO;
    option.hidden = !allowed;
    option.disabled = !allowed;
  });
  if (panoramaMode) select.value = PANORAMA_ASPECT_RATIO;
  select.disabled = panoramaMode && lockWhenPanorama;
  select.title = panoramaMode ? "全景图固定使用 2:1 比例" : "";
}

function refreshPanoramaSizePickerControls(mode = state.mode) {
  const panoramaMode = isPanoramaMode(mode);
  updateAspectRatioSelectForMode(els.sizePickerRatio, mode, { lockWhenPanorama: panoramaMode });
  [els.sizePickerWidth, els.sizePickerHeight].filter(Boolean).forEach((input) => {
    input.disabled = panoramaMode;
    input.title = panoramaMode ? "全景图尺寸由 2:1 比例和分辨率自动计算" : "";
  });
  if (els.sizePickerApplyButton) {
    els.sizePickerApplyButton.title = panoramaMode ? "应用 2:1 全景尺寸" : "应用自定义尺寸";
  }
}

function imageCountOptionsForMode(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (normalized === "designseries") return [4, 6, 8];
  if (["image-modeling", "panorama", "colorgrade", "cutout", "upscale", "sharpen"].includes(normalized)) return [1];
  return [1, 2, 3, 4];
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
    analysis?.project_type_key,
    analysis?.project_type_visual,
    ...(Array.isArray(analysis?.project_type_evidence) ? analysis.project_type_evidence : []),
    ...(Array.isArray(analysis?.context_conflicts) ? analysis.context_conflicts : []),
    analysis?.title,
    analysis?.summary,
    analysis?.series_strategy,
    analysis?.spatial_sequence,
    ...(Array.isArray(analysis?.suggested_outputs) ? analysis.suggested_outputs : []),
    ...(Array.isArray(analysis?.reference_read) ? analysis.reference_read.flatMap((item) => [item.observation, item.usable_design_language]) : []),
    ...(Array.isArray(analysis?.scene_briefs) ? analysis.scene_briefs.flatMap((scene) => [
      scene.title,
      scene.field_type,
      scene.spatial_role,
      scene.connects_from,
      scene.connects_to,
      scene.camera,
      scene.must_vary,
      scene.forbidden_repetition,
      ...(Array.isArray(scene.must_repeat) ? scene.must_repeat : [])
    ]) : []),
    ...(Array.isArray(analysis?.recurring_signatures) ? analysis.recurring_signatures : []),
    ...(Array.isArray(analysis?.materials) ? analysis.materials : []),
    ...(Array.isArray(analysis?.composition_rules) ? analysis.composition_rules : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function normalizeDesignSeriesProjectTypeKey(value = "") {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  if (/office|workplace|workspace|corporate|办公|办公室|办公空间|企业|工区|工位|开放办公|会议室|董事|专注间|电话间/.test(text)) return "office";
  if (/hospitality|hotel|homestay|guesthouse|guest house|resort|bnb|b&b|民宿|酒店|旅宿|旅馆|宾馆|客房|套房|度假|泡池/.test(text)) return "hospitality";
  if (/food|beverage|restaurant|cafe|coffee|bar|bistro|bakery|tearoom|餐饮|餐厅|咖啡|酒吧|茶饮|茶室|烘焙|面包店/.test(text)) return "foodbeverage";
  if (/retail|shop|store|showroom|display|boutique|pop.?up|零售|店铺|商店|展厅|展示|陈列|品牌空间|体验店/.test(text)) return "retail";
  if (/residential|apartment|villa|home|living room|bedroom|kitchen|住宅|公寓|别墅|家装|居住|客厅|卧室|主卧|厨房|书房/.test(text)) return "residential";
  if (/generic|通用/.test(text)) return "generic";
  return "";
}

function designSeriesProjectTypeLabel(key = "generic") {
  const labels = {
    office: "办公/企业接待",
    hospitality: "民宿/酒店/度假住宿",
    foodbeverage: "餐饮/咖啡/酒吧",
    retail: "零售/展厅/品牌空间",
    residential: "住宅/居住空间",
    generic: "通用空间项目"
  };
  return labels[key] || labels.generic;
}

function explicitDesignSeriesProjectType(analysis = {}) {
  const candidates = [
    analysis?.project_type_visual,
    analysis?.visual_project_type,
    analysis?.detected_visual_project_type,
    analysis?.dominant_project_type,
    analysis?.project_type_key,
    analysis?.project_type
  ];
  for (const value of candidates) {
    const key = normalizeDesignSeriesProjectTypeKey(value);
    if (key && key !== "generic") {
      return {
        key,
        label: designSeriesProjectTypeLabel(key),
        score: 120,
        source: value === analysis?.project_type ? "analysis" : "visual-analysis"
      };
    }
  }
  return null;
}

function detectDesignSeriesProjectType(analysis = state.designSeriesAnalysis) {
  const explicit = explicitDesignSeriesProjectType(analysis);
  if (explicit) return explicit;
  const text = designSeriesContextText(analysis);
  const hasOfficeProgramCue = [
    "办公空间", "办公室", "开放办公", "办公大堂", "企业大堂", "企业接待", "企业展厅", "工区", "工位", "办公桌", "会议室", "会议桌", "洽谈室", "董事办公室", "总裁办公室", "专注间", "电话间", "茶水间",
    "office", "workplace", "workspace", "workstation", "workstations", "desk", "desks", "task chair", "conference room", "meeting room", "boardroom", "pantry"
  ].some((keyword) => text.includes(keyword.toLowerCase()));
  const hasHospitalityProgramCue = [
    "民宿", "酒店", "旅宿", "旅馆", "宾馆", "客房", "套房", "度假村", "泡池",
    "hotel", "resort", "homestay", "guesthouse", "hospitality", "guestroom", "bedroom suite", "bnb", "b&b"
  ].some((keyword) => text.includes(keyword.toLowerCase()));
  if (hasOfficeProgramCue && !hasHospitalityProgramCue) return { key: "office", label: "办公/企业接待", score: 99 };
  const definitions = [
    { key: "office", label: "办公/企业接待", keywords: ["办公", "办公空间", "办公室", "企业", "会议", "会议室", "会议桌", "工区", "工位", "办公桌", "开放办公", "前厅", "前台", "接待区", "企业接待", "董事", "茶水间", "洽谈", "专注间", "电话间", "workplace", "office", "workspace", "workstation", "desk", "conference", "meeting", "reception", "pantry", "focus room"] },
    { key: "hospitality", label: "民宿/酒店/度假住宿", keywords: ["民宿", "酒店", "旅宿", "旅馆", "宾馆", "客房", "套房", "酒店大堂", "民宿大堂", "接待大堂", "度假", "度假村", "主卧", "泡池", "hotel", "resort", "homestay", "guesthouse", "hospitality", "guestroom", "suite", "bnb", "b&b"] },
    { key: "foodbeverage", label: "餐饮/咖啡/酒吧", keywords: ["咖啡", "餐厅", "餐饮", "酒吧", "茶饮", "茶室", "烘焙", "面包店", "小酒馆", "餐吧", "cafe", "coffee", "restaurant", "bar", "bistro", "bakery", "tearoom"] },
    { key: "retail", label: "零售/展厅/品牌空间", keywords: ["零售", "店铺", "商店", "买手店", "展厅", "展示", "陈列", "快闪", "品牌空间", "体验店", "retail", "shop", "store", "showroom", "display", "boutique", "pop-up"] },
    { key: "residential", label: "住宅/居住空间", keywords: ["住宅", "公寓", "别墅", "家装", "居住", "客厅", "餐厨", "厨房", "卧室", "主卧", "书房", "阳台", "residential", "apartment", "villa", "home", "living room", "bedroom", "kitchen"] }
  ];
  let best = { key: "generic", label: designSeriesProjectTypeLabel("generic"), score: 0 };
  definitions.forEach((definition) => {
    const score = definition.keywords.reduce((total, keyword) => total + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { key: definition.key, label: definition.label, score };
  });
  return best;
}

function designSeriesProjectTypeGuard(projectType = detectDesignSeriesProjectType()) {
  if (projectType.key === "office") {
    return [
      "项目类型锁定：办公/企业接待空间。",
      "视觉识别优先：如果上传参考图里有办公桌、工位、办公椅、会议桌、玻璃隔断、企业前台、开放工区、协作区、茶水间或办公照明，就按办公项目生成。",
      "办公项目禁止：卧室、主卧、床、床头柜、客房、套房、酒店房间、民宿房间、浴缸、泡池、spa、度假住宿、住宅厨房或私人家庭客厅。",
      "办公项目允许：前台/企业接待、开放工区、协作/项目讨论区、会议室、董事/独立办公室、专注间/电话间、茶水/休息区、走廊和材料节点。",
      "人物/动物硬性要求：所有画面无人物、无动物，禁止员工、客户、路人、剪影、脸、手、身体局部、人群、动物和宠物。"
    ].join("\n");
  }
  if (projectType.key === "hospitality") {
    return [
      "项目类型锁定：民宿/酒店/度假住宿。",
      "视觉识别优先：如果参考图里有客房、床、床头灯、套房、大堂、住客休闲区、庭院入口、泡池/卫浴、早餐/茶饮/餐吧或度假旅宿氛围，就按民宿/酒店项目生成；即使有书桌或阅读工区，也不能误判为办公。",
      "民宿/酒店项目禁止：开放工区、成排工位、企业会议室、董事办公室、电话间、企业前台、公司茶水间或办公空间系列。",
      "民宿/酒店项目允许：外观/到达、大堂/接待、公共客厅、茶室/餐吧/早餐区、阅读/活动区、客房/套房、卫浴/泡池/支持空间、走廊/楼梯/材料节点。",
      "人物/动物硬性要求：所有画面无人物、无动物。"
    ].join("\n");
  }
  return "人物/动物硬性要求：所有设计系列图片必须是无人、无动物的建筑/室内空间图，禁止出现任何人、剪影、脸、手、身体局部、人群、动物或宠物。";
}

function enforceClientDesignSeriesProjectType(analysis = null) {
  if (!analysis) return analysis;
  const detected = detectDesignSeriesProjectType(analysis);
  const sceneTexts = Array.isArray(analysis.scene_briefs)
    ? analysis.scene_briefs.map((scene) => [
        scene.title,
        scene.field_type,
        scene.spatial_role,
        scene.connects_from,
        scene.connects_to,
        scene.camera,
        scene.must_vary,
        scene.forbidden_repetition,
        ...(Array.isArray(scene.must_repeat) ? scene.must_repeat : [])
      ].filter(Boolean).join(" ").toLowerCase())
    : [];
  const count = clampImageCount(state.generation.count, "designseries");
  const duplicateFields = sceneTexts.some((text, index) => text && sceneTexts.indexOf(text) !== index);
  const missingFields = sceneTexts.length < count;
  const forbiddenByType = {
    office: /卧室|主卧|客房|套房|酒店房|民宿房|床|床头|卫浴|浴缸|泡池|spa|resort|hotel room|guestroom|suite|bedroom|bathtub|bath|pool|homestay/i,
    hospitality: /开放工区|工位|工位区|办公桌排|企业前台|企业接待|董事办公室|总裁办公室|专注间|电话间|boardroom|corporate office|open workspace|workstations|task chairs|office desk rows|executive office|phone booth|workplace planning/i,
    residential: /开放工区|工位|企业前台|酒店大堂|民宿大堂|客房套房|泡池|boardroom|corporate office|open workspace|workstations|hotel lobby|guestroom suite/i,
    foodbeverage: /卧室|主卧|客房|套房|开放工区|工位|董事办公室|bedroom|guestroom|suite|open workspace|workstations|executive office/i,
    retail: /卧室|主卧|客房|套房|开放工区|工位|酒店套房|bedroom|guestroom|suite|open workspace|workstations/i
  };
  const normalizedAnalysisKey = normalizeDesignSeriesProjectTypeKey(analysis.project_type);
  const analysisConflict = normalizedAnalysisKey
    && detected.key !== "generic"
    && normalizedAnalysisKey !== detected.key;
  const hasForbiddenScenes = Boolean(forbiddenByType[detected.key])
    && sceneTexts.some((text) => forbiddenByType[detected.key].test(text));
  const needsOverride = detected.key !== "generic"
    && (analysisConflict || missingFields || duplicateFields || hasForbiddenScenes);
  const lockedAnalysis = {
    ...analysis,
    project_type: detected.label,
    project_type_key: detected.key,
    project_type_source: detected.source || analysis.project_type_source || "client-detection"
  };
  const plan = designSeriesScenePlan(count, lockedAnalysis);
  if (!needsOverride) {
    return {
      ...lockedAnalysis,
      scene_allocation_strategy: analysis.scene_allocation_strategy || designSeriesAllocationSummary(count, lockedAnalysis),
      suggested_outputs: plan.slice(0, count).map((item) => item[0]),
      spatial_sequence: plan.slice(0, count).map((item) => item[0]).join(" -> ")
    };
  }
  return {
    ...lockedAnalysis,
    scene_allocation_strategy: designSeriesAllocationSummary(count, lockedAnalysis),
    suggested_outputs: plan.slice(0, count).map((item) => item[0]),
    spatial_sequence: plan.slice(0, count).map((item) => item[0]).join(" -> "),
    scene_briefs: plan.slice(0, count).map((item, index) => ({
      index: index + 1,
      title: item[0],
      field_type: detected.key,
      spatial_role: item[1],
      connects_from: index ? plan[index - 1][0] : "项目入口",
      connects_to: plan[index + 1]?.[0] || "项目记忆点",
      camera: item[2],
      must_repeat: [`同一${detected.label}材料系统`, `同一${detected.label}照明语言`, "同一家具/物件年代", "无人物和动物"],
      must_vary: "只变化功能区、镜头位置和焦点，不变化项目风格",
      forbidden_repetition: designSeriesProjectTypeGuard(detected)
    }))
  };
}

function designSeriesPlanCount(count = state.generation.count) {
  const outputCount = clampImageCount(count, "designseries");
  if (outputCount >= 7) return 8;
  if (outputCount >= 5) return 6;
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
        designSeriesRole("公共客厅/共享休闲区", "展示客人公共生活核心：会客、休闲、家具分组、墙顶地系统和完整材质灯光语言", "换一个轴线的开阔人视角，显示沙发/休闲座、通道、顶面和墙地面连续性"),
        designSeriesRole("主卧/客房套房", "展示私密住宿空间：主卧、客房或套房，把同一项目DNA转译到更安静的尺度", "安静人视角，包含床、窗景或坐榻/休息角，不能重复大堂和公共客厅机位"),
        designSeriesRole("工区/茶歇/餐吧或材料节点", "补足使用场景：工区、阅读、茶室、早餐餐吧，或一个能串联前面空间的材料/灯光节点", "中景功能视角或近景节点，强调同款灯具、木作、石材、肌理和收口")
      ],
      6: [
        designSeriesRole("室外/到达入口", "从场地、街巷、庭院或门头建立民宿/酒店外部识别度", "室外或半室外广角，显示路径、入口、立面/院落和项目气质"),
        designSeriesRole("大堂/接待", "第一处室内接待空间，承接入口并明确酒店/民宿运营功能", "宽阔人视角，显示接待台、等候区、主灯光层次和进入公共区的动线"),
        designSeriesRole("公共客厅/休闲会客区", "主要公共生活空间，让客人停留、交流、休闲", "新轴线开阔视角，显示家具分组、通道、墙顶地材料和氛围"),
        designSeriesRole("工区/茶室/餐吧/活动区", "第二公共功能：工作、阅读、茶饮、早餐、餐吧或小型活动，和客厅形成用途差异", "中广角运营视角，桌面/吧台/书架/活动家具清晰可见"),
        designSeriesRole("主卧/客房套房", "安静私密空间，展示住宿舒适度和同一材质灯光系统在客房里的表达", "安静人视角，床、床头灯、窗景或坐榻形成焦点"),
        designSeriesRole("卫浴/泡池/走廊材料节点", "支持空间或记忆节点：卫浴、泡池、走廊、楼梯、门洞或材料收口", "更窄或更近的受控视角，强调水、石材、木作、灯带、肌理和空间连续性")
      ],
      8: [
        designSeriesRole("外观/场地入口", "项目外部第一印象：院落、街巷、景观、门头或入口立面", "室外广角，建立环境、入口路径和项目识别度"),
        designSeriesRole("门厅/大堂接待", "第一处室内阈值和接待功能", "入口人视角，显示接待、等候、灯光和进入公共区的方向"),
        designSeriesRole("公共客厅/共享休闲区", "主公共区，承载会客、休闲和空间气质", "开阔室内视角，显示沙发/休闲座、通道和完整材料系统"),
        designSeriesRole("茶室/餐吧/早餐区", "餐饮或茶歇功能，补足民宿酒店运营场景", "中广角活动视角，桌面、吧台、餐椅、灯光和服务细节清晰"),
        designSeriesRole("工区/阅读/活动区", "工作、阅读、小会客或活动区，形成另一种公共使用方式", "中景功能视角，桌面、书架、工作灯或活动家具成为焦点"),
        designSeriesRole("主卧/客房套房", "住宿核心空间：主卧、客房或套房", "安静人视角，床、坐榻、窗景和床头灯光完整"),
        designSeriesRole("卫浴/泡池/更衣支持空间", "湿区或支持空间，证明设计语言不只停留在公共区", "受控视角，突出水、石、木作、柔光和细腻收口"),
        designSeriesRole("走廊/楼梯/材料节点特写", "串联空间的走廊、楼梯、门洞、墙地收口或灯光节点", "线性透视或近景细节，重复前面出现的材料和灯具语言")
      ]
    },
    residential: {
      4: [
        designSeriesRole("玄关/客厅主视觉", "建立住宅入户到客厅的整体气质", "开阔人视角，显示玄关线索、客厅家具和墙顶地系统"),
        designSeriesRole("餐厨/家庭活动区", "展示餐厅、厨房或家庭活动空间", "中广角，桌面/岛台/柜体和动线清晰"),
        designSeriesRole("主卧/书房安静区", "展示卧室、主卧套房或书房的安静尺度", "安静人视角，床/书桌/窗景/收纳形成焦点"),
        designSeriesRole("卫浴/阳台/收纳材料节点", "补足支持空间或材料节点", "近景或中景，显示灯光、收口、墙地面材质和功能细节")
      ],
      6: [
        designSeriesRole("玄关/入户收纳", "入户、收纳和第一材料线索", "入口视角，柜体、灯光和通向客厅的关系清晰"),
        designSeriesRole("客厅/家庭核心区", "家庭主要生活空间", "开阔客厅视角，显示家具分组和空间尺度"),
        designSeriesRole("餐厨/岛台/家庭活动", "餐厅、厨房、岛台或家庭活动区", "中广角，餐桌/岛台/柜体和操作关系清晰"),
        designSeriesRole("书房/儿童/多功能房", "不同功能房间，拉开空间用途", "中景房间视角，桌面/书架/灵活家具清晰"),
        designSeriesRole("主卧/套房", "私密卧室尺度", "安静人视角，床、床头、窗景和储物逻辑可读"),
        designSeriesRole("卫浴/阳台/材料节点", "支持空间或细节节点", "受控视角，显示湿区/阳台/收口和材料连续性")
      ],
      8: [
        designSeriesRole("玄关/门厅", "住宅入口和收纳系统", "入口视角"),
        designSeriesRole("客厅", "主要生活空间", "开阔客厅视角"),
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
        designSeriesRole("前台/企业接待", "企业入口和接待形象", "开阔前台视角，避免可读文字和logo"),
        designSeriesRole("开放工区/协作区", "主要工作空间", "开阔工位/协作视角，显示桌面节奏和通道"),
        designSeriesRole("会议/洽谈/专注空间", "正式或半私密办公功能", "中广角会议/专注视角"),
        designSeriesRole("茶水/走廊/材料节点", "支持空间和材料连续性", "受控支持或节点视角")
      ],
      6: [
        designSeriesRole("入口/前台接待", "企业到达与接待", "开阔接待视角"),
        designSeriesRole("开放工区", "主要工位空间", "开阔工位节奏视角"),
        designSeriesRole("协作/项目讨论区", "团队讨论功能", "中广角协作视角"),
        designSeriesRole("会议室/洽谈室", "正式会议或客户沟通", "受控会议视角"),
        designSeriesRole("独立办公室/专注间/电话间", "私密或专注尺度", "安静小空间视角"),
        designSeriesRole("茶水区/走廊/材料节点", "支持和过渡空间", "线性或近景节点视角")
      ],
      8: [
        designSeriesRole("前台/品牌入口", "到达与接待", "开阔前台视角"),
        designSeriesRole("开放工区", "工位空间", "开阔工区视角"),
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
        designSeriesRole("堂食/休闲座位区", "主要客座体验", "开阔堂食视角"),
        designSeriesRole("包间/卡座/材料氛围节点", "次级座位或细节记忆", "中景座位或近景节点")
      ],
      6: [
        designSeriesRole("外立面/入口", "街边或场地到达", "外部广角"),
        designSeriesRole("点单/接待吧台", "服务核心", "吧台运营视角"),
        designSeriesRole("主堂食区", "主要用餐空间", "开阔堂食视角"),
        designSeriesRole("卡座/包间/多人桌", "第二座位类型", "中广角卡座/包间视角"),
        designSeriesRole("开放厨房/展示/零售陈列", "运营或陈列细节", "运营/展示视角"),
        designSeriesRole("灯光/材料/餐具氛围特写", "餐饮记忆节点", "近景氛围细节")
      ],
      8: [
        designSeriesRole("外立面/门头", "店铺识别", "外立面视角"),
        designSeriesRole("入口/等候", "到达和等候", "入口视角"),
        designSeriesRole("点单/吧台", "服务核心", "吧台视角"),
        designSeriesRole("主堂食区", "主要客座", "开阔堂食视角"),
        designSeriesRole("卡座/包间", "第二座位类型", "卡座视角"),
        designSeriesRole("露台/窗边/外摆", "边界座位氛围", "窗边或外摆视角"),
        designSeriesRole("厨房/陈列/运营细节", "运营细节", "运营节点视角"),
        designSeriesRole("材料/灯光/餐具特写", "记忆节点", "近景细节")
      ]
    },
    retail: {
      4: [
        designSeriesRole("门头/入口展示", "品牌入口和第一陈列", "门头或入口广角"),
        designSeriesRole("主陈列/销售核心区", "主要销售陈列空间", "开阔陈列视角"),
        designSeriesRole("体验/洽谈/试衣/产品场景", "客户体验功能", "中广角体验视角"),
        designSeriesRole("收银/橱窗/材料节点", "交易、橱窗或展具细节", "支持或近景节点")
      ],
      6: [
        designSeriesRole("外立面/橱窗", "店铺外部识别", "橱窗外观视角"),
        designSeriesRole("入口/迎宾陈列", "第一室内陈列", "入口陈列视角"),
        designSeriesRole("主陈列区", "主要销售空间", "开阔陈列视角"),
        designSeriesRole("体验/试衣/洽谈区", "客户体验空间", "中景体验视角"),
        designSeriesRole("收银/包装/后场支持", "交易和支持功能", "受控支持空间视角"),
        designSeriesRole("展具/材料/灯光节点", "展具和材料记忆", "近景节点视角")
      ],
      8: [
        designSeriesRole("外立面/橱窗", "外部识别", "外观视角"),
        designSeriesRole("入口迎宾", "入口阈值", "入口视角"),
        designSeriesRole("主陈列区", "主要销售陈列", "开阔陈列视角"),
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
        designSeriesRole("公共核心/主要功能区", "承接入口，展示主要公共活动区和动线", "开阔人视角，显示家具分组、通道、墙顶地系统和主要功能场景"),
        designSeriesRole("次级功能/安静场域", "从公共区进入另一种功能尺度", "换一个人视角或更安静的镜头，展示办公、餐厨、洽谈、休息、展示、学习、康养或其他由项目类型决定的不同功能区"),
        designSeriesRole("过渡空间/材料节点", "把材料节点和前面空间连接起来", "近景或中景，强调走廊、门洞、楼梯、收口、灯光节点或重复材质细节")
      ],
      6: [
        designSeriesRole("室外/入口", "从场地进入项目", "竖向主视觉或入口视角，建立项目外部语言"),
        designSeriesRole("接待/公共主空间", "从入口进入公共核心", "宽阔人视角，显示主空间、动线和第一组材料系统"),
        designSeriesRole("休闲/餐厨/办公/展示等次级功能区", "公共空间的延伸功能区", "中广角，展示第二个功能场景但复用同一材质和灯光"),
        designSeriesRole("安静/私密/套房/会议等不同尺度空间", "从公共区过渡到更安静或更聚焦的功能尺度", "安静人视角，展示同一设计语言在不同尺度中的表达"),
        designSeriesRole("走廊/楼梯/服务等过渡或支持空间", "连接前后空间和细节节点", "更窄或更聚焦的过渡空间视角，证明空间连续性"),
        designSeriesRole("材料节点/氛围特写", "收束整个项目的记忆点", "近景/中景，重复核心材料、灯具、木作或肌理")
      ],
      8: [
        designSeriesRole("外观/入口", "场地到项目入口", "建立外部识别度"),
        designSeriesRole("门厅/接待", "入口到公共区", "显示第一处室内阈值"),
        designSeriesRole("公共休闲区", "公共区主体", "展示主要活动空间"),
        designSeriesRole("餐厨/吧台/办公/展示/活动区", "公共区的功能延伸", "展示运营、办公、陈列或生活场景"),
        designSeriesRole("安静/专注/会议/洽谈区", "公共到安静、专注或私密尺度", "展示由项目类型决定的更克制空间尺度"),
        designSeriesRole("服务/后勤/支持空间", "支持空间", "展示服务区、后勤区或支持空间的材质和灯光"),
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
    designSeriesProjectTypeGuard(projectType),
    `本次数量排布：${plan.map((item, index) => `${index + 1}.${item[0]}`).join("；")}。`,
    "如果用户文字明确点名空间，优先覆盖用户点名空间；未点名时按项目类型自动选择最能形成完整设计提案的空间组合。"
  ].join("\n");
}

function designSeriesLockedSchedule(count = state.generation.count, analysis = state.designSeriesAnalysis) {
  const outputCount = clampImageCount(count, "designseries");
  return designSeriesScenePlan(outputCount, analysis).slice(0, outputCount);
}

function designSeriesScheduleText(count = state.generation.count, analysis = state.designSeriesAnalysis) {
  return designSeriesLockedSchedule(count, analysis)
    .map((item, index) => `${index + 1}.${item[0]}`)
    .join("；");
}

function designSeriesOtherSceneTitles(index, count = state.generation.count, analysis = state.designSeriesAnalysis, direction = "previous") {
  return designSeriesLockedSchedule(count, analysis)
    .filter((_, itemIndex) => {
      const ordinal = itemIndex + 1;
      if (direction === "previous") return ordinal < index;
      if (direction === "future") return ordinal > index;
      return ordinal !== index;
    })
    .map((item) => item[0]);
}

function designSeriesCountPrompt(count = state.generation.count) {
  const outputCount = clampImageCount(count, "designseries");
  const scenePlan = designSeriesAllocationSummary(outputCount);
  const lockedSchedule = designSeriesScheduleText(outputCount);
  return [
    `设计系列数量规划：本次按当前生图设置生成 ${outputCount} 张，不使用普通单图数量逻辑。`,
    "功能本意：站在项目大局观层面，从一张或多张参考图推断完整设计项目，再按用户选择的数量给出这套设计中最有价值的对应空间图片。",
    "参考图读取：精准分析参考图并提取品牌元素、色彩元素、材料系统、空间组织、灯光氛围、构图节奏、家具/工位/物件语言和细部收口。",
    scenePlan,
    `锁定空间排布：${lockedSchedule}。`,
    "唯一空间规则：每个空间角色整套图只出现一次；前台/接待只出现一张，开放工区只出现一张，会议/洽谈只出现一张，后续图片必须切换到其他功能空间。",
    "办公系列规则：如果参考图识别为办公项目，必须按办公项目生成，不得混入卧室、客房、酒店套房、民宿、床、泡池或住宅私密空间。",
    "数量策略：4张时优先覆盖最能说明项目的入口/公共核心/关键私密或重点功能/节点；6张时补足室外到达、支持空间和更完整动线；8张时拆出更多真实使用场景，形成完整项目图集。",
    "参数策略：图片比例、清晰度/分辨率、质量档位和生成数量全部服从当前生图设置；不要在提示词里固定横屏、4:3、4K或固定8张。",
    "思考模式：开启时要更多保留原参考图的视觉 DNA，包括品牌线索、色彩、材质、灯光、构图、空间节奏、家具物件语言和关键细节，但仍然要推演为不同空间而不是复制同一角度。",
    "先建立系列圣经：项目DNA、空间动线、材质系统、灯光系统、重复母题、家具语言、镜头节奏、渲染质感。",
    "所有图片必须像同一个项目、同一套材质系统、同一个设计团队、同一次渲染输出；每张图空间或视角不同，但风格、材料、元素和审美 DNA 保持一致。",
    "深层设计系列定义：统一风格不是重复同一张图；必须把参考图扩展为多场域、多视角、多角度、多功能分区的项目图集。",
    "视觉项目类型优先：先看参考图整体判断它是办公、民宿/酒店、住宅、餐饮还是零售；如果旧模板、旧 brief 或隐藏预设与参考图冲突，以参考图的视觉项目类型为准。",
    "空间衔接硬性要求：每张图至少出现一个可连接其他图片的线索，例如相同墙地面材料、同款灯具、重复吊顶/格栅/拱形/木作节点、连续门洞/走廊/窗景、同一家具语言或相同室外景观。",
    "人物/动物硬性要求：所有图片必须是无人、无动物的建筑/室内空间图；禁止出现员工、客户、住客、路人、人物剪影、脸、手、身体局部、人群、动物、宠物或生活方式摆拍。",
    "禁止：每张图像来自不同项目、不同预算等级、不同渲染风格、不同色彩分级、不同家具年代；禁止孤立单图、拼贴感、风格漂移、同一角度多风格变体和无空间关系的随机美图。"
  ].join("\n");
}

function designSeriesScenePrompt(index, count, analysis = state.designSeriesAnalysis) {
  const projectType = detectDesignSeriesProjectType(analysis);
  const plan = designSeriesLockedSchedule(count, analysis);
  const fallback = plan[Math.max(0, index - 1)] || plan[0];
  const scene = analysis?.scene_briefs?.find?.((item) => Number(item.index) === index) || analysis?.scene_briefs?.[index - 1] || {};
  const title = fallback[0];
  const role = [fallback[1], scene.spatial_role ? `参考图扩展方向：${scene.spatial_role}` : ""].filter(Boolean).join("；");
  const camera = [fallback[2], scene.camera ? `参考图建议镜头：${scene.camera}` : ""].filter(Boolean).join("；");
  const previousScenes = designSeriesOtherSceneTitles(index, count, analysis, "previous");
  const otherScenes = designSeriesOtherSceneTitles(index, count, analysis, "all");
  const repeat = [
    ...(scene.must_repeat || []),
    ...(analysis?.recurring_signatures || [])
  ].filter(Boolean).slice(0, 8).join("；");
  return [
    `项目类型：${analysis?.project_type || projectType.label}。`,
    designSeriesProjectTypeGuard(projectType),
    `本张分镜：第 ${index}/${count} 张，空间角色为「${title}」。`,
    `锁定整套排布：${designSeriesScheduleText(count, analysis)}。`,
    `当前图片只能生成：「${title}」。`,
    previousScenes.length ? `前面已经覆盖，当前禁止重复：${previousScenes.join("；")}。` : "",
    otherScenes.length ? `当前也不要抢占其他分镜空间：${otherScenes.join("；")}。` : "",
    "唯一空间规则：每个空间角色整套只出现一次；不能把前台、开放工区、会议室、沙发区或同一个主视觉换角度重复生成。",
    `空间衔接：${scene.connects_from ? `来自 ${scene.connects_from}，` : ""}${role}${scene.connects_to ? `，并连接到 ${scene.connects_to}` : ""}。`,
    `镜头任务：${camera}。`,
    "深层系列要求：本张必须是不同场域、不同功能分区或不同机位的独立空间画面，不是同一个角度/同一个主视觉的轻微变体，也不是同一空间换不同风格。",
    "大局观要求：本张是完整设计项目中的一个关键空间，必须能和其他张共同构成一套方案，而不是孤立美图。",
    "参数要求：本张比例、清晰度/分辨率和质量只服从当前生图设置，不在提示词里额外固定横屏、4:3或4K。",
    "人物/动物硬性要求：本张必须是无人、无动物空间图，不能出现任何人、员工、客户、住客、路人、剪影、脸、手、身体局部、人群、动物或宠物。",
    repeat ? `必须重复的系列线索：${repeat}。` : "必须重复同一套墙地面材料、灯具语言、家具年代、木作/金属/石材节点、色彩分级和渲染质感。",
    scene.must_vary ? `本张允许变化：${scene.must_vary}。` : "本张只允许变化空间功能、镜头位置、焦点区域和陈列细节，不允许变化项目风格。"
  ].join("\n");
}

function generationDimensions() {
  if (isPanoramaMode()) {
    state.generation.aspect = PANORAMA_ASPECT_RATIO;
    state.generation.customSize = "";
  } else if (state.generation.aspect !== "source" && !aspectRatioMap[state.generation.aspect]) {
    state.generation.aspect = "source";
  }
  if (!qualitySizeMap[state.generation.quality]) state.generation.quality = "1k";
  state.generation.count = clampImageCount(state.generation.count, state.mode);
  const customMatch = String(state.generation.customSize || "").match(/^(\d+)x(\d+)$/);
  if (customMatch) {
    return normalizeImageDimensions(Number(customMatch[1]), Number(customMatch[2]));
  }
  const ratio = state.generation.aspect === "source" ? sourceAspectRatio() : (aspectRatioMap[state.generation.aspect] || aspectRatioMap["1:1"]);
  const [ratioWidth, ratioHeight] = ratio;
  let width;
  let height;
  if (ratioWidth === ratioHeight) {
    const side = qualitySizeMap[state.generation.quality] || qualitySizeMap["1k"];
    width = side;
    height = side;
  } else if (state.generation.quality === "1k") {
    const shortSide = 1024;
    width = ratioWidth > ratioHeight ? Math.round(shortSide * ratioWidth / ratioHeight) : shortSide;
    height = ratioWidth > ratioHeight ? shortSide : Math.round(shortSide * ratioHeight / ratioWidth);
  } else {
    const longSide = qualitySizeMap[state.generation.quality] || qualitySizeMap["2k"];
    width = ratioWidth > ratioHeight ? longSide : Math.round(longSide * ratioWidth / ratioHeight);
    height = ratioWidth > ratioHeight ? Math.round(longSide * ratioHeight / ratioWidth) : longSide;
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
  return state.thinkingModeEnabled ? "gpt-5.5 → Image Gen" : "快速预设 → Image Gen";
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
      ? "思考模式已开启：本次访问期间会先调用 gpt-5.5 读取输入图、参考图、当前按钮意义和用户描述；重新打开页面后默认关闭。"
      : "思考模式已关闭：不做额外提示词融合，使用快速预设提示词和用户描述直接交给 Image Gen。"
  };
  refreshThinkingModeButtons();
  renderWorkflowCanvas();
  scheduleCanvasStateSave({ delay: 400 });
  toast(state.thinkingModeEnabled ? "思考模式已开启，本次访问期间生效" : "思考模式已关闭");
}

function toggleThinkingMode() {
  setThinkingModeEnabled(!state.thinkingModeEnabled);
}

function isReferenceOnlyMode(mode = state.mode) {
  mode = normalizeClientMode(mode);
  return mode === "designseries";
}

function allowsNoPrimaryInput(mode = state.mode) {
  mode = normalizeClientMode(mode);
  return mode === "custom" || mode === "panorama" || mode === "design-derivation" || isReferenceOnlyMode(mode);
}

function generationInputRequirement(mode = state.mode) {
  mode = normalizeClientMode(mode);
  if (isReferenceOnlyMode(mode)) {
    return {
      ready: Boolean(state.referenceImages.length),
      message: modeConfig(mode).missing,
      target: "reference"
    };
  }
  if (allowsNoPrimaryInput(mode)) {
    return {
      ready: true,
      message: "",
      target: ""
    };
  }
  return {
    ready: Boolean(state.primaryImage),
    message: modeConfig(mode).missing,
    target: "primary"
  };
}

function generationDisabledAttrs(mode = state.mode) {
  const requirement = generationInputRequirement(mode);
  return requirement.ready ? "" : "disabled";
}

function hasVisiblePrimaryInput(mode = state.mode) {
  return !isReferenceOnlyMode(mode) && Boolean(state.primaryImage);
}

function refreshGenerationControls() {
  const size = generationDimensions();
  const normalizedMode = normalizeClientMode(state.mode);
  const panoramaMode = isPanoramaMode(normalizedMode);
  const referenceOnly = isReferenceOnlyMode(normalizedMode);
  const imageModelingMode = normalizedMode === "image-modeling";
  const reasoningOnlyMode = ["design-derivation", "image-modeling"].includes(normalizedMode);
  const hasVisibleInput = imageModelingMode
    ? Boolean(state.primaryImage)
    : referenceOnly
      ? Boolean(state.referenceImages.length)
      : Boolean(state.primaryImage || state.referenceImages.length);
  if (els.outputWidth) els.outputWidth.value = String(size.width);
  if (els.outputHeight) els.outputHeight.value = String(size.height);
  if (els.agentUploadZone) {
    els.agentUploadZone.classList.toggle("reference-only", referenceOnly);
    els.agentUploadZone.classList.toggle("image-modeling-upload", imageModelingMode);
    els.agentUploadZone.hidden = imageModelingMode && Boolean(state.primaryImage);
  }
  if (els.referenceUploadLabel) {
    const baseLabel = referenceOnly ? "上传参考图" : "素材参考图";
    const countText = state.referenceImages.length
      ? `（${state.referenceImages.length}/${referenceImageLimit}）`
      : `（最多 ${referenceImageLimit} 张）`;
    els.referenceUploadLabel.textContent = `${baseLabel}${countText}`;
  }
  document.body.classList.toggle("reference-only-mode", referenceOnly);
  document.body.classList.toggle("panorama-mode", panoramaMode);
  document.body.classList.remove("white-model-mode");
  if (els.imageOptionsPanel) els.imageOptionsPanel.hidden = reasoningOnlyMode;
  if (els.canvasFloatingParams) els.canvasFloatingParams.hidden = reasoningOnlyMode;
  if (els.uploadPreviewBlock) {
    els.uploadPreviewBlock.hidden = !hasVisibleInput;
  }
  if (els.referenceStrip) {
    els.referenceStrip.hidden = imageModelingMode || !state.referenceImages.length;
  }
  if (els.removePrimaryImageButton) {
    els.removePrimaryImageButton.hidden = !state.primaryImage;
  }
  els.aspectRatioButtons.forEach((button) => {
    const active = button.dataset.aspectRatio === state.generation.aspect;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateAspectRatioSelectForMode(els.aspectRatioSelect, normalizedMode, { lockWhenPanorama: panoramaMode });
  refreshPanoramaSizePickerControls(normalizedMode);
  if (els.aspectRatioSelect) els.aspectRatioSelect.value = state.generation.aspect;
  if (els.generationSummaryLabel) {
    els.generationSummaryLabel.textContent = `${selectedGenerationAspectShortLabel()} · ${state.generation.quality.toUpperCase()} · ${state.generation.count}张`;
  }
  if (els.sizePickerButton) {
    const exact = selectedGenerationSize().replace("x", "×");
    els.sizePickerButton.textContent = state.generation.customSize ? `自定义 ${exact}` : exact;
    els.sizePickerButton.title = `尺寸 ${exact}`;
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
  const inputRequirement = generationInputRequirement(normalizedMode);
  const canGenerate = inputRequirement.ready && state.activeTask?.status !== "running";
  const disabledGenerateTitle = inputRequirement.ready ? primaryActionLabel(normalizedMode) : inputRequirement.message;
  if (els.canvasGenerateButton) {
    els.canvasGenerateButton.disabled = !canGenerate;
    els.canvasGenerateButton.title = disabledGenerateTitle;
    els.canvasGenerateButton.setAttribute("aria-label", disabledGenerateTitle);
    if (!els.canvasGenerateButton.classList.contains("icon-only")) {
      els.canvasGenerateButton.textContent = inputRequirement.ready ? primaryActionLabel(normalizedMode) : "先上传图片";
    }
  }
  if (els.floatingGenerateButton) {
    els.floatingGenerateButton.disabled = !canGenerate;
    els.floatingGenerateButton.title = disabledGenerateTitle;
    els.floatingGenerateButton.setAttribute("aria-label", disabledGenerateTitle);
  }
  syncFloatingComposer();
}

function sizePickerIsOpen() {
  return Boolean(els.sizePickerOverlay && !els.sizePickerOverlay.hidden);
}

function currentSizePickerRatio() {
  if (isPanoramaMode()) return PANORAMA_ASPECT_RATIO;
  return els.sizePickerRatio?.value || state.generation.aspect || "source";
}

function sizeForTierAndRatio(tier = state.generation.quality, ratioValue = state.generation.aspect) {
  const previous = { ...state.generation };
  state.generation.quality = tier || "1k";
  state.generation.aspect = ratioValue || "source";
  state.generation.customSize = "";
  const size = generationDimensions();
  state.generation = previous;
  return size;
}

function updateSizePickerFieldsFromTierRatio() {
  if (!els.sizePickerWidth || !els.sizePickerHeight) return;
  const size = sizeForTierAndRatio(els.sizePickerTier?.value || state.generation.quality, currentSizePickerRatio());
  els.sizePickerWidth.value = String(size.width);
  els.sizePickerHeight.value = String(size.height);
}

function openSizePicker(trigger = document.activeElement) {
  if (!els.sizePickerOverlay) return;
  const size = generationDimensions();
  overlayFocusReturn.set(els.sizePickerOverlay, isFocusableTarget(trigger) ? trigger : els.sizePickerButton);
  els.sizePickerOverlay.hidden = false;
  els.sizePickerOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("settings-open");
  if (els.sizePickerTier) els.sizePickerTier.value = state.generation.quality || "1k";
  if (els.sizePickerRatio) els.sizePickerRatio.value = state.generation.aspect || "source";
  if (els.sizePickerWidth) els.sizePickerWidth.value = String(size.width);
  if (els.sizePickerHeight) els.sizePickerHeight.value = String(size.height);
  refreshPanoramaSizePickerControls(state.mode);
  focusOverlayControl(els.sizePickerOverlay, isPanoramaMode() ? "#sizePickerTier" : "#sizePickerWidth");
}

function closeSizePicker() {
  if (!sizePickerIsOpen()) return false;
  els.sizePickerOverlay.hidden = true;
  restoreOverlayFocus(els.sizePickerOverlay);
  if (!isSettingsOpen()) document.body.classList.remove("settings-open");
  return true;
}

function applySizePicker() {
  state.generation.quality = els.sizePickerTier?.value || state.generation.quality || "1k";
  if (isPanoramaMode()) {
    state.generation.aspect = PANORAMA_ASPECT_RATIO;
    state.generation.customSize = "";
    const size = generationDimensions();
    closeSizePicker();
    refreshGenerationControls();
    renderWorkflowCanvas();
    toast(`全景图固定为 ${size.width}×${size.height}`);
    return;
  }
  const width = Number(els.sizePickerWidth?.value || 0);
  const height = Number(els.sizePickerHeight?.value || 0);
  const size = normalizeImageDimensions(width, height);
  state.generation.aspect = els.sizePickerRatio?.value || state.generation.aspect || "source";
  state.generation.customSize = `${size.width}x${size.height}`;
  closeSizePicker();
  refreshGenerationControls();
  renderWorkflowCanvas();
  toast(`尺寸已设为 ${size.width}×${size.height}`);
}

function syncFloatingComposer() {
  if (els.floatingModeSelect) els.floatingModeSelect.value = normalizeClientMode(state.mode);
  if (els.floatingAspectRatioSelect) {
    updateAspectRatioSelectForMode(els.floatingAspectRatioSelect, state.mode, { lockWhenPanorama: isPanoramaMode() });
    els.floatingAspectRatioSelect.value = state.generation.aspect;
  }
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
    els.floatingContinueEditButton.disabled = !state.render || ["cad", "image-modeling"].includes(normalizeClientMode(state.mode));
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

function loadCanvasListCollapsedPreference() {
  let stored = "";
  try {
    stored = localStorage.getItem(CANVAS_LIST_COLLAPSED_STORAGE_KEY) || "";
  } catch {}
  state.canvasListCollapsed = stored === "1" || stored === "true";
  return state.canvasListCollapsed;
}

function applyCanvasListCollapsed(collapsed = state.canvasListCollapsed, options = {}) {
  const activeBefore = document.activeElement;
  state.canvasListCollapsed = Boolean(collapsed);
  document.body.classList.toggle("canvas-list-collapsed", state.canvasListCollapsed);
  if (els.canvasListPanel) {
    els.canvasListPanel.setAttribute("aria-label", state.canvasListCollapsed ? "画布列表，已收起" : "画布列表");
  }
  if (els.toggleCanvasListButton) {
    const label = state.canvasListCollapsed ? "展开画布栏" : "收起画布栏";
    const icon = state.canvasListCollapsed ? "icon-panel-show" : "icon-panel-hide";
    els.toggleCanvasListButton.innerHTML = `<svg><use href="#${icon}"></use></svg><span>${state.canvasListCollapsed ? "展开侧栏" : "收起侧栏"}</span>`;
    els.toggleCanvasListButton.title = label;
    els.toggleCanvasListButton.setAttribute("aria-label", label);
    els.toggleCanvasListButton.setAttribute("aria-pressed", String(state.canvasListCollapsed));
    els.toggleCanvasListButton.setAttribute("aria-expanded", String(!state.canvasListCollapsed));
  }
  if (state.canvasListCollapsed && els.canvasListPanel?.contains(activeBefore)) {
    focusElement(els.toggleCanvasListButton) || focusFirstControl(els.canvasListPanel);
  } else if (!state.canvasListCollapsed && activeBefore === els.toggleCanvasListButton) {
    focusFirstControl(els.canvasListPanel);
  }
  if (options.persist !== false) {
    try {
      localStorage.setItem(CANVAS_LIST_COLLAPSED_STORAGE_KEY, state.canvasListCollapsed ? "1" : "0");
    } catch {}
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
  state.generation.aspect = isPanoramaMode() ? PANORAMA_ASPECT_RATIO : (value || "source");
  state.generation.customSize = "";
  refreshGenerationControls();
  renderWorkflowCanvas();
}

function setGenerationQuality(value) {
  state.generation.quality = value || "1k";
  state.generation.customSize = "";
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
      ${analysis.project_type || analysis.project_type_visual ? `<p>${escapeHtml([
        analysis.project_type_visual ? `只看图识别：${analysis.project_type_visual}` : "",
        analysis.project_type ? `生成锁定：${analysis.project_type}` : "",
        analysis.project_type_confidence ? `置信度：${Math.round(Number(analysis.project_type_confidence || 0) * 100)}%` : ""
      ].filter(Boolean).join("；"))}</p>` : ""}
      <ul class="compact-list">
        ${referenceRead.map((item, index) => `<li>参考图 ${index + 1}：${escapeHtml(item.observation || item.usable_design_language || "")}</li>`).join("")}
      </ul>
    </div>
    ${analysis.project_type_evidence?.length || analysis.context_conflicts?.length ? `
      <div class="detail-block">
        <h3>类型依据</h3>
        <div class="tag-row">
          ${(analysis.project_type_evidence || []).slice(0, 6).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          ${(analysis.context_conflicts || []).slice(0, 4).map((item) => `<span class="tag">冲突：${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    ` : ""}
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
  const layoutMigrated = normalizeCanvasLayoutPositions();
  renderAgentBriefInsight();
  renderImageModelingFlowBlock();
  renderImageModelingSubjectPanel();
  renderResourceLibrary();
  renderAssetCount();
  const nodes = buildCanvasNodes();
  disposePanoramaViewers("canvas:");
  disposeWhiteModelViewers();
  els.canvasNodes.innerHTML = nodes.map(renderCanvasNode).join("");
  bindCanvasNodeEvents();
  mountWhiteModelViewers();
  mountPanoramaViewers(els.canvasNodes, "canvas");
  renderCanvasImageToolbar();
  renderOutputManager();
  renderTaskProgressPanel();
  renderCanvasList();
  observeCanvasNodeLayout(nodes);
  scheduleCanvasLinksRender(nodes);
  scheduleCanvasMinimapRender(nodes);
  if (layoutMigrated) {
    focusCanvasToNodes(nodes.map((node) => node.id));
  } else {
    applyCanvasTransform({ refreshMinimap: false });
  }
  scheduleCanvasStateSave();
}

function findWhiteModelResult(id) {
  const key = String(id || "");
  const model = state.whiteModelResults.find((item) => String(item.id || "") === key)
    || state.whiteModelResults[Number(key.replace(/^(?:white-model|ai-3d-model)-/, ""))]
    || null;
  return normalizeWhiteModelForPreview(model);
}

function findWhiteModelStateRecord(id) {
  const key = String(id || "");
  const byId = state.whiteModelResults.findIndex((item) => String(item?.id || "") === key);
  const index = byId >= 0 ? byId : Number(key.replace(/^(?:white-model|ai-3d-model)-/, ""));
  const model = Number.isInteger(index) && index >= 0 ? state.whiteModelResults[index] : null;
  return model ? { model, index } : null;
}

function patchWhiteModelObject(modelId, objectId, objectIndex, patch = {}) {
  const record = findWhiteModelStateRecord(modelId);
  if (!record?.model || !Array.isArray(record.model.objects)) return null;
  const id = String(objectId || "");
  let index = id
    ? record.model.objects.findIndex((object) => String(object?.id || "") === id)
    : -1;
  if (index < 0 && Number.isInteger(objectIndex)) index = objectIndex;
  if (index < 0 || !record.model.objects[index]) return null;

  const current = record.model.objects[index];
  const next = { ...current, ...patch };
  record.model.objects[index] = next;
  record.model.objectCount = record.model.objects.length;
  record.model.layers = whiteModelLayerCounts({ objects: record.model.objects });
  if (record.model.completeness) {
    record.model.completeness = {
      ...record.model.completeness,
      layerCounts: record.model.layers
    };
  }
  try {
    record.model.scadCode = clientWhiteModelToScad(record.model);
    record.model.dxfText = clientWhiteModelToDxf(record.model);
    record.model.footprintSvg = clientWhiteModelFootprintSvg(record.model);
  } catch {}
  scheduleCanvasStateSave({ delay: 260 });
  return next;
}

function disposeThreeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeThreeMaterial);
    return;
  }
  material?.dispose?.();
}

function disposeThreeObject(object) {
  object?.traverse?.((child) => {
    child.geometry?.dispose?.();
    disposeThreeMaterial(child.material);
  });
}

function disposeWhiteModelViewers() {
  whiteModelViewers.forEach((viewer) => {
    if (viewer.frame) cancelAnimationFrame(viewer.frame);
    viewer.resizeObserver?.disconnect?.();
    disposeThreeObject(viewer.scene);
    viewer.renderer?.dispose?.();
    viewer.container?.replaceChildren?.();
  });
  whiteModelViewers.clear();
}

function mountWhiteModelViewers() {
  els.canvasNodes.querySelectorAll("[data-white-model-viewer]").forEach((container) => {
    const model = findWhiteModelResult(container.dataset.whiteModelViewer);
    if (!model) return;
    try {
      const viewer = createWhiteModelViewer(container, model);
      whiteModelViewers.set(String(model.id || container.dataset.whiteModelViewer), viewer);
    } catch (error) {
      container.innerHTML = `<div class="white-model-fallback">${escapeHtml(error.message || "3D 预览初始化失败")}</div>`;
    }
  });
}

function panoramaViewerKey(scope, id) {
  return `${scope}:${String(id || "")}`;
}

function destroyPanoramaViewer(key) {
  const viewer = panoramaViewers.get(String(key || ""));
  if (!viewer) return;
  try {
    viewer.resizeObserver?.disconnect?.();
    viewer.destroy?.();
  } catch {}
  viewer.container?.replaceChildren?.();
  panoramaViewers.delete(String(key || ""));
}

function disposePanoramaViewers(prefix = "") {
  Array.from(panoramaViewers.keys()).forEach((key) => {
    if (!prefix || key.startsWith(prefix)) destroyPanoramaViewer(key);
  });
}

function createPanoramaViewer(container, url, { key = "", scope = "canvas" } = {}) {
  if (!container || !url) return null;
  const viewerKey = String(key || panoramaViewerKey(scope, container.dataset.panoramaViewer || container.id || "panorama"));
  destroyPanoramaViewer(viewerKey);
  const pannellumViewer = window.pannellum?.viewer;
  if (typeof pannellumViewer !== "function") {
    container.textContent = "Pannellum 未加载";
    return null;
  }
  container.replaceChildren();
  container.dataset.panoramaUrl = url;
  const viewer = pannellumViewer(container, {
    type: "equirectangular",
    panorama: url,
    autoLoad: true,
    showZoomCtrl: true,
    showFullscreenCtrl: true,
    showControls: true,
    compass: false,
    keyboardZoom: true,
    mouseZoom: true,
    hfov: 100,
    minHfov: 55,
    maxHfov: 120
  });
  viewer.container = container;
  viewer.resizeObserver = new ResizeObserver(() => {
    try {
      viewer.resize?.();
    } catch {}
  });
  viewer.resizeObserver.observe(container);
  panoramaViewers.set(viewerKey, viewer);
  return viewer;
}

function mountPanoramaViewers(root = document, scope = "canvas") {
  const queryRoot = root?.querySelectorAll ? root : document;
  queryRoot.querySelectorAll("[data-panorama-viewer]").forEach((container) => {
    const url = container.dataset.panoramaUrl;
    if (!url) return;
    const key = panoramaViewerKey(
      scope,
      container.dataset.panoramaViewer || container.id || `viewer-${Math.random().toString(16).slice(2, 8)}`
    );
    createPanoramaViewer(container, url, { key, scope });
  });
}

function resetWhiteModelViewer(id) {
  const viewer = whiteModelViewers.get(String(id || ""));
  if (!viewer) return;
  viewer.yaw = -Math.PI / 4;
  viewer.pitch = Math.PI / 5;
  viewer.distance = viewer.baseDistance;
  viewer.updateCamera();
  viewer.renderOnce();
}

function downloadWhiteModelJson(id) {
  const model = findWhiteModelResult(id);
  if (!model) return;
  const blob = new Blob([`${JSON.stringify(model, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugForFile(model.title || "ai-3d-model").replace(/\.json$/i, "")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 600);
}

function whiteModelFileBase(model) {
  return slugForFile(model?.title || "ai-3d-model").replace(/\.(?:json|glb|gltf)$/i, "") || "ai-3d-model";
}

function whiteModelSearchText(object = {}) {
  return [
    object.id,
    object.label,
    object.type,
    object.shape,
    object.layer,
    object.material,
    object.note
  ].filter(Boolean).join(" ").toLowerCase();
}

function architectureWhiteModelLooksLikeBuilding(model = {}) {
  const text = [
    model.sourceType,
    model.title,
    model.summary,
    model.intent,
    model.modelingAnalysis?.subject,
    model.modelingAnalysis?.summary,
    ...(Array.isArray(model.modelingAnalysis?.layers) ? model.modelingAnalysis.layers.map((layer) => `${layer.label || ""} ${layer.role || ""} ${layer.material || ""}`) : [])
  ].filter(Boolean).join(" ").toLowerCase();
  return /(architecture-photo|building|facade|exterior|house|villa|建筑|外观|外立面|立面|楼体|房屋|住宅|别墅)/i.test(text);
}

function roundedModelNumber(value) {
  return Number(Number(value || 0).toFixed(3));
}

function architecturePreviewLayerForObject(object = {}) {
  const text = whiteModelSearchText(object);
  if (object.type === "opening" || /(window|door|opening|glass|门|窗|开口|玻璃)/i.test(text)) return "openings";
  if (/(roof|eave|gable|canopy|parapet|chimney|slab|terrace|balcony|cornice|stair|step|column|beam|post|plinth|base|retaining|屋顶|屋面|檐|山墙|雨棚|女儿墙|烟囱|楼板|露台|阳台|檐口|台阶|楼梯|柱|梁|立柱|基座|勒脚|台基|挡墙)/i.test(text)) return "structure";
  if (/(building|facade|front wall|side wall|rear wall|mass|volume|wing|exterior wall|建筑|立面|外墙|侧墙|后墙|主楼体|体量|翼体|围护)/i.test(text)) return "shell";
  return object.layer || "fixed_furniture";
}

function architecturePreviewDimensionSwapReason(object = {}) {
  const [width = 0, depth = 0, height = 0] = object.size || [];
  const [, y = height / 2] = object.position || [];
  if (![width, depth, height, y].every(Number.isFinite)) return "";
  const text = whiteModelSearchText(object);
  const currentBottom = y - height / 2;
  const swappedBottom = y - depth / 2;
  const isOpeningOrPanel = object.type === "opening"
    || object.layer === "openings"
    || /(window|door|glass|railing|panel|cladding|facade|mullion|shutter|门|窗|玻璃|栏杆|面板|饰面|立面|百叶)/i.test(text);
  const isVerticalMember = object.type === "column" || /(column|post|pier|mullion|柱|立柱|墙垛|栏杆柱)/i.test(text);
  const isThinHorizontal = /(roof|slope|slab|floor|terrace|balcony|eave|ridge|cornice|beam|step|stair|plinth|base|屋顶|屋面|坡面|楼板|露台|阳台|檐|屋脊|檐口|梁|台阶|楼梯|基座|台基|勒脚)/i.test(text);
  const isMass = /(building|mass|volume|wing|level|story|main body|主体|主楼体|楼体|体量|翼体|层|别墅)/i.test(text);
  const isWallPanel = object.type === "wall" || /(wall|retaining|facade|墙|挡墙|立面)/i.test(text);
  if (isVerticalMember && depth > Math.max(width, height, 0.08) * 1.6 && depth > 0.45) return "vertical-member";
  if (isOpeningOrPanel && height <= 0.24 && depth > Math.max(0.42, height * 3)) return "vertical-opening-panel";
  if (isOpeningOrPanel && width <= 0.24 && depth > 0.45 && height > depth * 1.25) return "side-opening-panel";
  if (isWallPanel && height < 0.75 && depth > Math.max(0.72, height * 1.8)) return "vertical-wall-panel";
  if (isThinHorizontal && depth <= 0.9 && height > Math.max(0.9, depth * 2.2)) return "thin-horizontal-slab";
  if (isMass && depth >= 1.2 && depth <= 5.4 && height > depth * 1.65) return "story-mass-height-depth-order";
  if (height > depth * 1.6 && currentBottom < -0.2 && swappedBottom >= -0.2 && depth >= 0.08) return "below-ground-height-depth-order";
  return "";
}

function repairArchitecturePreviewObject(object = {}) {
  const next = {
    ...object,
    layer: architecturePreviewLayerForObject(object)
  };
  if (!architecturePreviewDimensionSwapReason(next)) return next;
  const [width = 1, depth = 1, height = 1] = next.size || [];
  return {
    ...next,
    size: [roundedModelNumber(width), roundedModelNumber(height), roundedModelNumber(depth)],
    note: String(next.note || "").includes("轴向纠偏")
      ? next.note
      : String(`${next.note || ""}${next.note ? " " : ""}轴向纠偏：已按 [宽,深,高] 修正预览。`).slice(0, 180)
  };
}

function architecturePreviewFootprint(objects = []) {
  const xs = [];
  const zs = [];
  objects.forEach((object) => {
    const text = whiteModelSearchText(object);
    if (object.type === "floor" || (object.layer === "context" && /(site|ground|场地|地面)/i.test(text))) return;
    const [width = 0, depth = 0] = object.size || [];
    const [x = 0, , z = 0] = object.position || [];
    if (![width, depth, x, z].every(Number.isFinite)) return;
    xs.push(x - width / 2, x + width / 2);
    zs.push(z - depth / 2, z + depth / 2);
  });
  if (!xs.length || !zs.length) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2
  };
}

function ensureArchitecturePreviewSiteBase(objects = []) {
  const footprint = architecturePreviewFootprint(objects);
  if (!footprint) return objects;
  const pad = clamp(Math.max(1.2, Math.max(footprint.width, footprint.depth) * 0.08), 1.2, 4.2);
  const sitePatch = {
    size: [roundedModelNumber(footprint.width + pad * 2), roundedModelNumber(footprint.depth + pad * 2), 0.08],
    position: [roundedModelNumber(footprint.centerX), 0.04, roundedModelNumber(footprint.centerZ)],
    layer: "context",
    material: "neutral site slab",
    note: "预览自动按建筑投影放大场地基底。"
  };
  const siteIndex = objects.findIndex((object) => {
    const text = whiteModelSearchText(object);
    return object.type === "floor" || (object.layer === "context" && /(site|ground|base|场地|地面|基底)/i.test(text));
  });
  if (siteIndex >= 0) {
    return objects.map((object, index) => index === siteIndex
      ? {
          ...object,
          ...sitePatch,
          type: "floor",
          shape: "box",
          label: object.label || "建筑场地基底",
          color: /^#[0-9a-f]{6}$/i.test(object.color || "") ? object.color : "#9a9588"
        }
      : object);
  }
  return [
    {
      id: "architecture-site-base",
      type: "floor",
      shape: "box",
      label: "建筑场地基底",
      color: "#9a9588",
      roughness: 0.7,
      metalness: 0.02,
      opacity: 1,
      ...sitePatch
    },
    ...objects
  ];
}

function normalizeWhiteModelForPreview(model) {
  if (!model || !Array.isArray(model.objects)) return model || null;
  if (!architectureWhiteModelLooksLikeBuilding(model)) return model;
  const objects = ensureArchitecturePreviewSiteBase(model.objects.map(repairArchitecturePreviewObject));
  const layerCounts = whiteModelLayerCounts({ objects, completeness: null, layers: null });
  const completeness = model.completeness
    ? { ...model.completeness, layerCounts }
    : null;
  const normalized = {
    ...model,
    objects,
    objectCount: objects.length,
    layers: layerCounts,
    completeness
  };
  return {
    ...normalized,
    scadCode: clientWhiteModelToScad(normalized),
    dxfText: clientWhiteModelToDxf(normalized),
    footprintSvg: clientWhiteModelFootprintSvg(normalized)
  };
}

function createWhiteModelExportScene(model) {
  model = normalizeWhiteModelForPreview(model);
  const group = new THREE.Group();
  group.name = whiteModelFileBase(model);
  group.userData = {
    title: model.title || "",
    summary: model.summary || "",
    completionScore: model.completionScore || model.completeness?.score || null,
    sourceType: model.sourceType || ""
  };
  (model.objects || []).forEach((object) => addWhiteModelObject(group, object, { edges: false }));
  return group;
}

function whiteModelExportNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(4)) : fallback;
}

function whiteModelExportVector(values = [], fallback = [0, 0, 0]) {
  return fallback.map((fallbackValue, index) => whiteModelExportNumber(values[index], fallbackValue));
}

function whiteModelExportString(value) {
  return JSON.stringify(String(value || "").replace(/[^\w\s#.,:+/-]/g, "").slice(0, 120));
}

function clientWhiteModelToScad(model) {
  const objects = Array.isArray(model?.objects) ? model.objects : [];
  const lines = [
    `// ${String(model?.title || "ai-image-model")}`,
    "// Generated by Laogui AI image modeling. Units: millimeters.",
    "unit_scale = 1000;",
    "$fn = 48;",
    "",
    "module obj_box(size_m, pos_m, rot_deg, color_hex) {",
    "  color(color_hex)",
    "    translate([pos_m[0] * unit_scale, pos_m[2] * unit_scale, pos_m[1] * unit_scale])",
    "      rotate([rot_deg[0], rot_deg[2], rot_deg[1]])",
    "        cube([max(size_m[0] * unit_scale, 1), max(size_m[1] * unit_scale, 1), max(size_m[2] * unit_scale, 1)], center=true);",
    "}",
    "",
    "module obj_cylinder(size_m, pos_m, rot_deg, color_hex) {",
    "  radius = max(max(size_m[0], size_m[1]) * unit_scale / 2, 1);",
    "  color(color_hex)",
    "    translate([pos_m[0] * unit_scale, pos_m[2] * unit_scale, pos_m[1] * unit_scale])",
    "      rotate([rot_deg[0], rot_deg[2], rot_deg[1]])",
    "        cylinder(h=max(size_m[2] * unit_scale, 1), r=radius, center=true);",
    "}",
    "",
    "module obj_sphere(size_m, pos_m, rot_deg, color_hex) {",
    "  color(color_hex)",
    "    translate([pos_m[0] * unit_scale, pos_m[2] * unit_scale, pos_m[1] * unit_scale])",
    "      rotate([rot_deg[0], rot_deg[2], rot_deg[1]])",
    "        scale([max(size_m[0] * unit_scale, 1), max(size_m[1] * unit_scale, 1), max(size_m[2] * unit_scale, 1)])",
    "          sphere(r=0.5);",
    "}",
    "",
    "union() {"
  ];
  objects.forEach((object, index) => {
    const shape = String(object?.shape || "box").toLowerCase();
    const moduleName = shape === "cylinder" ? "obj_cylinder" : shape === "sphere" ? "obj_sphere" : "obj_box";
    const size = whiteModelExportVector(object?.size, [1, 1, 1]);
    const position = whiteModelExportVector(object?.position, [0, size[2] / 2, 0]);
    const rotation = whiteModelExportVector(object?.rotation, [0, 0, 0]);
    const color = /^#[0-9a-f]{6}$/i.test(object?.color || "") ? object.color : "#a99986";
    lines.push(`  // ${index + 1}. ${String(object?.label || object?.id || object?.type || "object").slice(0, 80)}`);
    lines.push(`  ${moduleName}([${size.join(", ")}], [${position.join(", ")}], [${rotation.join(", ")}], ${whiteModelExportString(color)});`);
  });
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function clientWhiteModelFootprintLines(model) {
  const lines = [];
  (model?.objects || []).forEach((object) => {
    if (object.type === "ceiling" || object.layer === "lighting") return;
    const [width = 1, depth = 1] = object.size || [];
    const [x = 0, , z = 0] = object.position || [];
    const halfW = Math.max(0.01, Number(width) || 1) / 2;
    const halfD = Math.max(0.01, Number(depth) || 1) / 2;
    const left = (x - halfW) * 1000;
    const right = (x + halfW) * 1000;
    const top = (z - halfD) * 1000;
    const bottom = (z + halfD) * 1000;
    lines.push([left, top, right, top], [right, top, right, bottom], [right, bottom, left, bottom], [left, bottom, left, top]);
  });
  return lines.slice(0, 1200);
}

function clientWhiteModelToDxf(model) {
  let dxf = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  clientWhiteModelFootprintLines(model).forEach(([x1, y1, x2, y2]) => {
    dxf += "0\nLINE\n8\nAI_MODEL_FOOTPRINT\n";
    dxf += `10\n${whiteModelExportNumber(x1)}\n20\n${whiteModelExportNumber(y1)}\n30\n0\n`;
    dxf += `11\n${whiteModelExportNumber(x2)}\n21\n${whiteModelExportNumber(y2)}\n31\n0\n`;
  });
  return `${dxf}0\nENDSEC\n0\nEOF\n`;
}

function clientWhiteModelFootprintSvg(model) {
  const lines = clientWhiteModelFootprintLines(model);
  if (!lines.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><text x="40" y="60">No footprint</text></svg>`;
  const xs = lines.flatMap((line) => [line[0], line[2]]);
  const ys = lines.flatMap((line) => [line[1], line[3]]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const pad = Math.max(width, height) * 0.08;
  const viewBox = `${whiteModelExportNumber(minX - pad)} ${whiteModelExportNumber(minY - pad)} ${whiteModelExportNumber(width + pad * 2)} ${whiteModelExportNumber(height + pad * 2)}`;
  const segments = lines.map(([x1, y1, x2, y2]) => `<line x1="${whiteModelExportNumber(x1)}" y1="${whiteModelExportNumber(y1)}" x2="${whiteModelExportNumber(x2)}" y2="${whiteModelExportNumber(y2)}" />`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="${viewBox}"><rect x="${whiteModelExportNumber(minX - pad)}" y="${whiteModelExportNumber(minY - pad)}" width="${whiteModelExportNumber(width + pad * 2)}" height="${whiteModelExportNumber(height + pad * 2)}" fill="#f7f3ea"/><g fill="none" stroke="#161616" stroke-width="${Math.max(20, Math.max(width, height) * 0.004)}" stroke-linecap="square">${segments}</g></svg>`;
}

function clientWhiteModelFootprintBounds(model) {
  const lines = clientWhiteModelFootprintLines(model);
  if (!lines.length) return { width: 0, depth: 0 };
  const xs = lines.flatMap((line) => [line[0], line[2]]);
  const ys = lines.flatMap((line) => [line[1], line[3]]);
  return {
    width: (Math.max(...xs) - Math.min(...xs)) / 1000,
    depth: (Math.max(...ys) - Math.min(...ys)) / 1000
  };
}

function downloadWhiteModelGlb(id) {
  const model = findWhiteModelResult(id);
  if (!model) return;
  const exporter = new GLTFExporter();
  const root = createWhiteModelExportScene(model);
  exporter.parse(
    root,
    (result) => {
      if (result instanceof ArrayBuffer) {
        downloadBlob(new Blob([result], { type: "model/gltf-binary" }), `${whiteModelFileBase(model)}.glb`);
        toast("GLB 已导出");
        return;
      }
      downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: "model/gltf+json" }), `${whiteModelFileBase(model)}.gltf`);
      toast("GLTF 已导出");
    },
    (error) => toast(error?.message || "GLB 导出失败"),
    { binary: true, trs: false, onlyVisible: true }
  );
}

function downloadWhiteModelScad(id) {
  const model = findWhiteModelResult(id);
  if (!model?.objects?.length) {
    toast("这个模型没有 SCAD 数据");
    return;
  }
  downloadBlob(new Blob([clientWhiteModelToScad(model)], { type: "text/plain;charset=utf-8" }), `${whiteModelFileBase(model)}.scad`);
  toast("SCAD 已导出");
}

function downloadWhiteModelDxf(id) {
  const model = findWhiteModelResult(id);
  if (!model?.objects?.length) {
    toast("这个模型没有 DXF 足迹");
    return;
  }
  downloadBlob(new Blob([clientWhiteModelToDxf(model)], { type: "application/dxf" }), `${whiteModelFileBase(model)}-footprint.dxf`);
  toast("DXF 足迹已导出");
}

async function downloadUrlAsBlob(url, fileName) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取导出文件");
  const blob = await response.blob();
  downloadBlob(blob, fileName);
}

async function createWhiteModelForgeCad(id, action = "script", button = null) {
  const model = findWhiteModelResult(id);
  if (!model) {
    toast("未找到 3D 模型");
    return;
  }
  const studio = action === "studio";
  setBusy(button, true, studio ? "打开中" : "生成中");
  try {
    const data = await api("/api/modeling/forgecad", { model, action });
    const forgecad = data.forgecad || {};
    const source = forgecad.script?.source || "";
    if (studio) {
      if (forgecad.launched) {
        toast("ForgeCAD Studio 已尝试打开");
      } else if (source) {
        downloadBlob(new Blob([source], { type: "text/javascript;charset=utf-8" }), `${whiteModelFileBase(model)}.forge.js`);
        toast(forgecad.message || "ForgeCAD 未启动，已下载脚本");
      } else {
        toast(forgecad.message || "ForgeCAD 未启动");
      }
      return;
    }
    if (!source) throw new Error("ForgeCAD 脚本生成失败");
    downloadBlob(new Blob([source], { type: "text/javascript;charset=utf-8" }), `${whiteModelFileBase(model)}.forge.js`);
    toast("ForgeCAD 脚本已生成");
  } catch (error) {
    toast(error.message || "ForgeCAD 接入失败");
  } finally {
    setBusy(button, false);
  }
}

async function exportWhiteModelWithTextToCad(id, button = null) {
  const model = findWhiteModelResult(id);
  if (!model) {
    toast("未找到 3D 模型");
    return;
  }
  setBusy(button, true, "导出中");
  try {
    const data = await api("/api/modeling/cad-export", { model, formats: ["step", "stl", "glb"] });
    const cadExport = data.cadExport || {};
    const files = cadExport.files || {};
    if (files.step?.url) {
      await downloadUrlAsBlob(files.step.url, files.step.fileName || `${whiteModelFileBase(model)}.step`);
      toast("STEP 已由 text-to-cad 导出");
      return;
    }
    if (files.python?.source) {
      downloadBlob(new Blob([files.python.source], { type: "text/x-python;charset=utf-8" }), files.python.fileName || `${whiteModelFileBase(model)}.py`);
      toast(cadExport.message || "已生成 text-to-cad Python 源码");
      return;
    }
    toast(cadExport.message || "CAD 导出未完成");
  } catch (error) {
    toast(error.message || "text-to-cad 导出失败");
  } finally {
    setBusy(button, false);
  }
}

function importWhiteModelFootprintToCad(id) {
  const model = findWhiteModelResult(id);
  if (!model?.objects?.length) {
    toast("这个模型没有可导入的 CAD 足迹");
    return;
  }
  const footprintSvg = clientWhiteModelFootprintSvg(model);
  const dxfText = clientWhiteModelToDxf(model);
  const footprintBounds = clientWhiteModelFootprintBounds(model);
  const svgUrl = URL.createObjectURL(new Blob([footprintSvg], { type: "image/svg+xml" }));
  const dxfUrl = URL.createObjectURL(new Blob([dxfText], { type: "application/dxf" }));
  const lineCount = Math.max(0, (dxfText.match(/\nLINE\n/g) || []).length);
  const cad = {
    id: `cad-from-model-${Date.now()}`,
    title: `${model.title || "图片建模"} · CAD足迹`,
    svg: footprintSvg,
    svgUrl,
    dxfUrl,
    lineCount,
    width: footprintBounds.width,
    height: footprintBounds.depth,
    fileBase: `${whiteModelFileBase(model)}-footprint`,
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  };
  state.cadResult = cad;
  state.cadResults.push(cad);
  renderWorkflowCanvas();
  renderWorkspaceHistoryPanel();
  toast("已导入 CAD 足迹");
}

const whiteModelLayerLabelMap = {
  shell: "壳体",
  openings: "开口",
  structure: "结构",
  fixed_furniture: "固定",
  loose_furniture: "家具",
  lighting: "灯光",
  context: "环境"
};

function whiteModelLayerCounts(model) {
  const counts = {
    shell: 0,
    openings: 0,
    structure: 0,
    fixed_furniture: 0,
    loose_furniture: 0,
    lighting: 0,
    context: 0
  };
  if (model?.completeness?.layerCounts) {
    Object.entries(model.completeness.layerCounts).forEach(([key, value]) => {
      if (key in counts) counts[key] = Number(value) || 0;
    });
    return counts;
  }
  if (model?.layers) {
    Object.entries(model.layers).forEach(([key, value]) => {
      if (key in counts) counts[key] = Number(value) || 0;
    });
    return counts;
  }
  (model?.objects || []).forEach((object) => {
    const layer = object.layer || (
      ["floor", "wall", "ceiling"].includes(object.type) ? "shell"
        : object.type === "opening" ? "openings"
          : ["column", "beam", "stair"].includes(object.type) ? "structure"
            : object.type === "plant" ? "context"
              : object.type === "fixture" && /light|lamp|灯|吊灯|壁灯|射灯/i.test(`${object.label || ""} ${object.material || ""}`) ? "lighting"
                : ["table", "seat", "box"].includes(object.type) ? "loose_furniture"
                  : "fixed_furniture"
    );
    if (layer in counts) counts[layer] += 1;
  });
  return counts;
}

function whiteModelCompletenessHtml(model) {
  const score = clamp(Number(model?.completionScore || model?.completeness?.score || 0), 0, 100);
  const status = model?.completeness?.label || (score >= 86 ? "完整" : score >= 70 ? "可用" : "偏简略");
  const missing = Array.isArray(model?.completeness?.missing) ? model.completeness.missing.slice(0, 3) : [];
  const counts = whiteModelLayerCounts(model);
  const tags = Object.entries(whiteModelLayerLabelMap)
    .map(([key, label]) => `<span>${label}<b>${Number(counts[key] || 0)}</b></span>`)
    .join("");
  return `
    <div class="white-model-completeness" style="--score:${score}%">
      <div class="white-model-completeness-head">
        <strong>完整度 ${score}%</strong>
        <span>${escapeHtml(status)}</span>
      </div>
      <div class="white-model-meter" aria-hidden="true"><span></span></div>
      <div class="white-model-layer-tags">${tags}</div>
      ${missing.length ? `<p>待复核：${escapeHtml(missing.join("、"))}</p>` : ""}
    </div>
  `;
}

function whiteModelObjectMaterial(object) {
  const transparent = Number(object.opacity || 1) < 0.98 || object.type === "opening";
  return new THREE.MeshStandardMaterial({
    color: object.color || "#a99986",
    roughness: object.type === "opening" ? 0.25 : clamp(Number(object.roughness ?? 0.68), 0.05, 1),
    metalness: clamp(Number(object.metalness ?? (object.type === "fixture" ? 0.35 : 0.02)), 0, 1),
    transparent,
    opacity: transparent ? clamp(Number(object.opacity || 0.42), 0.18, 0.82) : 1
  });
}

function whiteModelObjectGeometry(object, width, depth, height, { minDimension = 0.03 } = {}) {
  const shape = String(object.shape || "").toLowerCase();
  if (shape === "cylinder") {
    const radius = Math.max(minDimension / 2, (Math.max(width, depth) || minDimension) / 2);
    return new THREE.CylinderGeometry(radius, radius, Math.max(minDimension, height), 28);
  }
  if (shape === "sphere") {
    const geometry = new THREE.SphereGeometry(0.5, 28, 18);
    geometry.scale(Math.max(minDimension, width), Math.max(minDimension, height), Math.max(minDimension, depth));
    return geometry;
  }
  if (shape === "plane") {
    return new THREE.BoxGeometry(Math.max(minDimension, width), Math.max(minDimension * 0.8, 0.025), Math.max(minDimension, depth));
  }
  return new THREE.BoxGeometry(Math.max(minDimension, width), Math.max(minDimension, height), Math.max(minDimension, depth));
}

function addWhiteModelObject(group, object, { edges: includeEdges = true, minDimension = 0.03 } = {}) {
  const [width = 1, depth = 1, height = 1] = object.size || [];
  const [x = 0, y = height / 2, z = 0] = object.position || [];
  const [rx = 0, ry = 0, rz = 0] = object.rotation || [];
  const geometry = whiteModelObjectGeometry(object, width, depth, height, { minDimension });
  const mesh = new THREE.Mesh(geometry, whiteModelObjectMaterial(object));
  mesh.position.set(x, y, z);
  mesh.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
  mesh.castShadow = object.type !== "opening";
  mesh.receiveShadow = true;
  mesh.name = object.label || object.id || object.type || "ai-3d-object";
  mesh.userData = {
    id: object.id || "",
    type: object.type || "",
    layer: object.layer || "",
    material: object.material || "",
    note: object.note || "",
    whiteModelObject: object
  };
  group.add(mesh);
  if (!includeEdges) return mesh;

  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: object.type === "opening" ? "#406478" : "#6e695f",
    transparent: true,
    opacity: object.type === "opening" ? 0.74 : 0.38
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.userData = {
    id: object.id || "",
    type: object.type || "",
    layer: object.layer || "",
    helper: "edges"
  };
  mesh.add(edges);
  return mesh;
}

function whiteModelObjectLabel(object = {}) {
  return String(object.label || object.id || object.type || "模型对象").trim();
}

function whiteModelObjectMetaText(object = {}) {
  return [
    object.type || "",
    object.layer ? whiteModelLayerLabelMap[object.layer] || object.layer : "",
    object.material || ""
  ].filter(Boolean).join(" · ");
}

function whiteModelNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(3)) : fallback;
}

function whiteModelVectorValue(values = [], fallback = [0, 0, 0]) {
  return fallback.map((fallbackValue, index) => whiteModelNumber(values[index], fallbackValue));
}

function whiteModelEditorInput({ label, vector, axis, value, step = "0.05" }) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input type="number" inputmode="decimal" step="${escapeAttr(step)}" value="${escapeAttr(value)}" data-white-model-vector="${escapeAttr(vector)}" data-white-model-axis="${escapeAttr(axis)}" />
    </label>
  `;
}

const whiteModelEditModes = [
  { mode: "move", label: "移动" },
  { mode: "rotate", label: "旋转" },
  { mode: "scale", label: "缩放" },
  { mode: "orbit", label: "视角" }
];

function whiteModelEditModeHint(mode = "move") {
  if (mode === "rotate") return "拖动选中对象旋转 / 拖空白处转视角";
  if (mode === "scale") return "拖动选中对象缩放 / 拖空白处转视角";
  if (mode === "orbit") return "拖拽旋转视角 / 滚轮缩放";
  return "拖动选中对象移动 / 拖空白处转视角";
}

function whiteModelEditorModeControls(editMode = "move") {
  return `
    <div class="white-model-editor-modes" role="toolbar" aria-label="模型编辑模式">
      ${whiteModelEditModes.map((item) => `
        <button class="${item.mode === editMode ? "active" : ""}" type="button" data-white-model-edit-mode="${escapeAttr(item.mode)}" aria-pressed="${item.mode === editMode ? "true" : "false"}">${escapeHtml(item.label)}</button>
      `).join("")}
    </div>
  `;
}

function whiteModelObjectEditorHtml(object = {}, editMode = "move") {
  const [x, y, z] = whiteModelVectorValue(object.position, [0, 0, 0]);
  const [rx, ry, rz] = whiteModelVectorValue(object.rotation, [0, 0, 0]);
  const [width, depth, height] = whiteModelVectorValue(object.size, [1, 1, 1]);
  const color = /^#[0-9a-f]{6}$/i.test(object.color || "") ? object.color : "#a99986";
  return `
    <div class="white-model-editor-head">
      <div>
        <strong>${escapeHtml(whiteModelObjectLabel(object))}</strong>
        <span>${escapeHtml(whiteModelObjectMetaText(object) || "可编辑对象")}</span>
      </div>
      <button class="text-button" type="button" data-white-model-clear-selection>取消选择</button>
    </div>
    ${whiteModelEditorModeControls(editMode)}
    <div class="white-model-editor-grid" aria-label="模型对象属性">
      ${whiteModelEditorInput({ label: "X", vector: "position", axis: 0, value: x })}
      ${whiteModelEditorInput({ label: "Y", vector: "position", axis: 1, value: y })}
      ${whiteModelEditorInput({ label: "Z", vector: "position", axis: 2, value: z })}
      ${whiteModelEditorInput({ label: "转X", vector: "rotation", axis: 0, value: rx, step: "1" })}
      ${whiteModelEditorInput({ label: "转Y", vector: "rotation", axis: 1, value: ry, step: "1" })}
      ${whiteModelEditorInput({ label: "转Z", vector: "rotation", axis: 2, value: rz, step: "1" })}
      ${whiteModelEditorInput({ label: "宽", vector: "size", axis: 0, value: width })}
      ${whiteModelEditorInput({ label: "深", vector: "size", axis: 1, value: depth })}
      ${whiteModelEditorInput({ label: "高", vector: "size", axis: 2, value: height })}
    </div>
    <div class="white-model-editor-row">
      <label>
        <span>颜色</span>
        <input type="color" value="${escapeAttr(color)}" data-white-model-color />
      </label>
      <label class="wide">
        <span>材质</span>
        <input type="text" value="${escapeAttr(object.material || "")}" data-white-model-material />
      </label>
    </div>
  `;
}

function emptyWhiteModelEditorHtml() {
  return `
    <div class="white-model-editor-empty">
      <strong>未选中对象</strong>
      <span>点击模型里的墙体、家具或构件后编辑。</span>
    </div>
  `;
}

function whiteModelLooksLikeInterior(model = {}) {
  const sourceText = [
    model.sourceType,
    model.spacePlan?.roomType,
    model.summary,
    model.title
  ].filter(Boolean).join(" ").toLowerCase();
  if (/(object|product|architecture-photo|exterior|facade|building exterior|产品|物体|外观|外立面)/i.test(sourceText)) return false;
  if (/(interior|room|space|lobby|office|retail|hotel|restaurant|cafe|living|bedroom|kitchen|室内|空间|房间|大堂|办公室|办公|展厅|门店|客厅|卧室|厨房|餐厅|商业空间)/i.test(sourceText)) return true;
  const counts = whiteModelLayerCounts(model);
  return Number(counts.shell || 0) >= 3 && (Number(counts.fixed_furniture || 0) + Number(counts.loose_furniture || 0)) >= 2;
}

function whiteModelPrimaryFloorObject(model = {}) {
  return (model.objects || [])
    .filter((object) => object.type === "floor")
    .sort((a, b) => (Number(b.size?.[0] || 0) * Number(b.size?.[1] || 0)) - (Number(a.size?.[0] || 0) * Number(a.size?.[1] || 0)))[0] || null;
}

function whiteModelCameraVector(value, fallback = [0, 0, 0]) {
  return fallback.map((fallbackValue, index) => {
    const number = Number(Array.isArray(value) ? value[index] : NaN);
    return Number.isFinite(number) ? number : fallbackValue;
  });
}

function whiteModelInteriorCameraPose(model = {}, box = new THREE.Box3(), radius = 4) {
  const explicit = model.previewCamera || {};
  if (/interior/i.test(String(explicit.mode || "")) && Array.isArray(explicit.position) && Array.isArray(explicit.target)) {
    return {
      position: new THREE.Vector3(...whiteModelCameraVector(explicit.position, [2.2, 1.55, 3.2])),
      target: new THREE.Vector3(...whiteModelCameraVector(explicit.target, [0, 1.35, -1.2]))
    };
  }
  const floor = whiteModelPrimaryFloorObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const [width = Math.max(4, radius), depth = Math.max(3, radius * 0.75)] = floor?.size || [];
  const [cx = center.x, , cz = center.z] = floor?.position || [];
  const eyeHeight = Math.min(1.72, Math.max(1.35, radius * 0.24));
  return {
    position: new THREE.Vector3(cx + width * 0.23, eyeHeight, cz + depth * 0.42),
    target: new THREE.Vector3(cx - width * 0.12, Math.max(1.1, eyeHeight - 0.12), cz - depth * 0.28)
  };
}

function applyWhiteModelCameraPose(viewer, pose, { minDistance = 0.35, maxDistance = 60 } = {}) {
  if (!viewer || !pose?.position || !pose?.target) return;
  const offset = pose.position.clone().sub(pose.target);
  const distance = Math.max(0.1, offset.length());
  viewer.target.copy(pose.target);
  viewer.distance = clamp(distance, minDistance, maxDistance);
  viewer.baseDistance = viewer.distance;
  viewer.yaw = Math.atan2(offset.x, offset.z);
  viewer.pitch = clamp(Math.asin(offset.y / distance), -0.2, Math.PI / 2.4);
}

function createWhiteModelViewer(container, model) {
  model = normalizeWhiteModelForPreview(model);
  const modelId = String(model?.id || container.dataset.whiteModelViewer || "");
  const escapedModelId = window.CSS?.escape ? window.CSS.escape(modelId) : modelId.replace(/["\\]/g, "\\$&");
  const editor = container.closest(".white-model-node")?.querySelector(`[data-white-model-editor="${escapedModelId}"]`)
    || container.closest(".white-model-node")?.querySelector("[data-white-model-editor]")
    || null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#151515");
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);
  container.tabIndex = 0;
  container.setAttribute("role", "application");

  const root = new THREE.Group();
  const objectScalePreview = /(object|product)/i.test(model?.sourceType || "");
  const minDimension = objectScalePreview ? 0.003 : 0.03;
  const interactiveMeshes = [];
  (model.objects || []).forEach((object, objectIndex) => {
    const mesh = addWhiteModelObject(root, object, { minDimension });
    if (!mesh) return;
    mesh.userData.whiteModelModelId = modelId;
    mesh.userData.whiteModelObjectIndex = objectIndex;
    mesh.userData.whiteModelObject = object;
    interactiveMeshes.push(mesh);
  });
  scene.add(root);

  const selectionBounds = new THREE.Box3();
  const selectionBox = new THREE.Box3Helper(selectionBounds, "#f1d19a");
  selectionBox.visible = false;
  selectionBox.material.depthTest = false;
  selectionBox.material.transparent = true;
  selectionBox.material.opacity = 0.95;
  scene.add(selectionBox);

  const box = new THREE.Box3().setFromObject(root);
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, objectScalePreview ? 0.16 : 1.5);
  const interiorPreview = whiteModelLooksLikeInterior(model);
  const gridSize = objectScalePreview ? Math.max(0.45, radius * 3.2) : Math.max(8, Math.ceil(radius * 1.5));
  const gridDivisions = objectScalePreview ? 16 : Math.max(8, Math.min(32, Math.round(gridSize * 2)));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, "#8c8577", "#3d3a34");
  grid.position.y = 0;
  scene.add(grid);
  camera.near = objectScalePreview ? 0.005 : 0.05;
  camera.updateProjectionMatrix();

  const hemi = new THREE.HemisphereLight("#f6efe2", "#222018", 2.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#fff4df", 2.4);
  key.position.set(radius * 1.8, radius * 2.5, radius * 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const fill = new THREE.DirectionalLight("#8fb4c7", 0.72);
  fill.position.set(-radius, radius, -radius);
  scene.add(fill);

  const viewer = {
    container,
    scene,
    renderer,
    camera,
    target,
    yaw: -Math.PI / 4,
    pitch: Math.PI / 5,
    baseDistance: radius * 2.45,
    distance: radius * 2.45,
    minDistance: interiorPreview ? Math.max(0.35, Math.min(1.2, radius * 0.16)) : radius * 0.8,
    maxDistance: interiorPreview ? radius * 3.4 : radius * 7,
    viewMode: interiorPreview ? "interior" : "orbit",
    selectedMesh: null,
    editMode: "move",
    frame: 0,
    resizeObserver: null,
    renderOnce() {
      updateSelectionBox();
      renderer.render(scene, camera);
    },
    updateCamera() {
      const cosPitch = Math.cos(this.pitch);
      camera.position.set(
        target.x + Math.sin(this.yaw) * cosPitch * this.distance,
        target.y + Math.sin(this.pitch) * this.distance,
        target.z + Math.cos(this.yaw) * cosPitch * this.distance
      );
      camera.lookAt(target);
    },
    selectMesh(mesh) {
      setWhiteModelMeshSelected(this.selectedMesh, false);
      this.selectedMesh = mesh || null;
      setWhiteModelMeshSelected(this.selectedMesh, true);
      updateSelectionBox();
      renderWhiteModelEditor();
      updateWhiteModelViewerHint();
      this.renderOnce();
    },
    setEditMode(mode) {
      this.editMode = whiteModelEditModes.some((item) => item.mode === mode) ? mode : "move";
      updateWhiteModelViewerHint();
      renderWhiteModelEditor();
      this.renderOnce();
    },
    applySelectedPatch(patch, { refreshEditor = false } = {}) {
      if (!this.selectedMesh) return;
      const mesh = this.selectedMesh;
      const objectIndex = Number(mesh.userData.whiteModelObjectIndex);
      const current = mesh.userData.whiteModelObject || {};
      const next = {
        ...current,
        ...patch
      };
      if (Number.isInteger(objectIndex) && model.objects?.[objectIndex]) model.objects[objectIndex] = next;
      mesh.userData.whiteModelObject = patchWhiteModelObject(
        modelId,
        next.id || mesh.userData.id || "",
        objectIndex,
        patch
      ) || next;
      applyWhiteModelObjectToMesh(mesh, mesh.userData.whiteModelObject, { minDimension });
      updateSelectionBox();
      if (refreshEditor) renderWhiteModelEditor();
      this.renderOnce();
    }
  };
  if (interiorPreview) {
    applyWhiteModelCameraPose(viewer, whiteModelInteriorCameraPose(model, box, radius), {
      minDistance: viewer.minDistance,
      maxDistance: viewer.maxDistance
    });
  }

  const cameraDirection = new THREE.Vector3();
  const dragRight = new THREE.Vector3();
  const dragForward = new THREE.Vector3();

  function updateWhiteModelViewerHint() {
    container.dataset.editMode = viewer.editMode;
    container.dataset.hint = viewer.selectedMesh
      ? whiteModelEditModeHint(viewer.editMode)
      : viewer.viewMode === "interior"
        ? "室内视角预览 / 点击对象选择 / 拖拽环视"
        : "点击对象选择 / 拖拽旋转 / 滚轮缩放";
  }

  function updateSelectionBox() {
    if (!viewer.selectedMesh) {
      selectionBox.visible = false;
      return;
    }
    selectionBounds.setFromObject(viewer.selectedMesh);
    selectionBox.visible = true;
  }

  function setWhiteModelMeshSelected(mesh, selected) {
    if (!mesh?.material) return;
    if (mesh.material.emissive) {
      mesh.material.emissive.set(selected ? "#e8c58e" : "#000000");
      mesh.material.emissiveIntensity = selected ? 0.28 : 0;
    }
    mesh.userData.selected = Boolean(selected);
  }

  function applyWhiteModelObjectToMesh(mesh, object = {}, { minDimension: minimumDimension = 0.03 } = {}) {
    const [width = 1, depth = 1, height = 1] = object.size || [];
    const [x = 0, y = height / 2, z = 0] = object.position || [];
    const [rx = 0, ry = 0, rz = 0] = object.rotation || [];
    mesh.position.set(x, y, z);
    mesh.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
    mesh.name = whiteModelObjectLabel(object);
    mesh.userData.id = object.id || mesh.userData.id || "";
    mesh.userData.type = object.type || "";
    mesh.userData.layer = object.layer || "";
    mesh.userData.material = object.material || "";
    mesh.userData.note = object.note || "";

    const nextGeometry = whiteModelObjectGeometry(object, width, depth, height, { minDimension: minimumDimension });
    mesh.geometry?.dispose?.();
    mesh.geometry = nextGeometry;
    const edge = mesh.children.find((child) => child.userData?.helper === "edges");
    if (edge) {
      edge.geometry?.dispose?.();
      edge.geometry = new THREE.EdgesGeometry(nextGeometry);
      edge.material.color.set(object.type === "opening" ? "#406478" : "#6e695f");
      edge.material.opacity = object.type === "opening" ? 0.74 : 0.38;
    }
    const material = mesh.material;
    if (material?.color) material.color.set(object.color || "#a99986");
    if (material) {
      const transparent = Number(object.opacity || 1) < 0.98 || object.type === "opening";
      material.roughness = object.type === "opening" ? 0.25 : clamp(Number(object.roughness ?? 0.68), 0.05, 1);
      material.metalness = clamp(Number(object.metalness ?? (object.type === "fixture" ? 0.35 : 0.02)), 0, 1);
      material.transparent = transparent;
      material.opacity = transparent ? clamp(Number(object.opacity || 0.42), 0.18, 0.82) : 1;
      material.needsUpdate = true;
    }
    setWhiteModelMeshSelected(mesh, mesh === viewer.selectedMesh);
  }

  function renderWhiteModelEditor() {
    if (!editor) return;
    const object = viewer.selectedMesh?.userData?.whiteModelObject || null;
    editor.innerHTML = object ? whiteModelObjectEditorHtml(object, viewer.editMode) : emptyWhiteModelEditorHtml();
  }

  function updateSelectedVector(vectorName, axis, value) {
    const mesh = viewer.selectedMesh;
    const object = mesh?.userData?.whiteModelObject;
    if (!object || !["position", "rotation", "size"].includes(vectorName)) return;
    const defaults = vectorName === "size" ? [1, 1, 1] : [0, 0, 0];
    const nextVector = whiteModelVectorValue(object[vectorName], defaults);
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    nextVector[axis] = vectorName === "size"
      ? whiteModelNumber(Math.max(minDimension, numericValue), defaults[axis])
      : whiteModelNumber(numericValue, defaults[axis]);
    viewer.applySelectedPatch({ [vectorName]: nextVector });
  }

  function pickWhiteModelMesh(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(interactiveMeshes, false)[0]?.object || null;
  }

  function whiteModelDragBasis() {
    camera.getWorldDirection(cameraDirection);
    dragForward.set(cameraDirection.x, 0, cameraDirection.z);
    if (dragForward.lengthSq() < 0.0001) dragForward.set(0, 0, -1);
    dragForward.normalize();
    dragRight.crossVectors(dragForward, new THREE.Vector3(0, 1, 0));
    if (dragRight.lengthSq() < 0.0001) dragRight.set(1, 0, 0);
    dragRight.normalize();
  }

  function updateWhiteModelObjectDrag(event) {
    if (!dragging || dragging.type !== "object" || !viewer.selectedMesh) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (dragging.mode === "move") {
      const rect = renderer.domElement.getBoundingClientRect();
      const moveScale = radius / Math.max(260, Math.max(rect.width, rect.height)) * (event.shiftKey ? 1.8 : 1);
      const position = [...dragging.position];
      if (event.altKey) {
        position[1] = whiteModelNumber(dragging.position[1] - dy * moveScale);
      } else {
        whiteModelDragBasis();
        position[0] = whiteModelNumber(dragging.position[0] + dragRight.x * dx * moveScale - dragForward.x * dy * moveScale);
        position[2] = whiteModelNumber(dragging.position[2] + dragRight.z * dx * moveScale - dragForward.z * dy * moveScale);
      }
      viewer.applySelectedPatch({ position });
      return;
    }
    if (dragging.mode === "rotate") {
      const rotateScale = event.shiftKey ? 0.15 : 0.42;
      const rotation = [...dragging.rotation];
      rotation[0] = whiteModelNumber(clamp(dragging.rotation[0] + dy * rotateScale * 0.5, -90, 90));
      rotation[1] = whiteModelNumber(dragging.rotation[1] + dx * rotateScale);
      viewer.applySelectedPatch({ rotation });
      return;
    }
    if (dragging.mode === "scale") {
      const scaleFactor = clamp(Math.exp((dx - dy) * (event.shiftKey ? 0.0025 : 0.006)), 0.08, 8);
      const size = dragging.size.map((value) => whiteModelNumber(Math.max(minDimension, value * scaleFactor), minDimension));
      viewer.applySelectedPatch({ size });
    }
  }

  if (editor) {
    editor.innerHTML = emptyWhiteModelEditorHtml();
    editor.addEventListener("input", (event) => {
      event.stopPropagation();
      const input = event.target.closest("input");
      if (!input || !viewer.selectedMesh) return;
      if (input.dataset.whiteModelVector) {
        updateSelectedVector(input.dataset.whiteModelVector, Number(input.dataset.whiteModelAxis), input.value);
        return;
      }
      if (input.dataset.whiteModelColor !== undefined) {
        viewer.applySelectedPatch({ color: input.value || "#a99986" });
        return;
      }
      if (input.dataset.whiteModelMaterial !== undefined) {
        viewer.applySelectedPatch({ material: input.value.slice(0, 80) });
      }
    });
    editor.addEventListener("click", (event) => {
      event.stopPropagation();
      const modeButton = event.target.closest("[data-white-model-edit-mode]");
      if (modeButton) {
        event.preventDefault();
        viewer.setEditMode(modeButton.dataset.whiteModelEditMode);
        return;
      }
      if (event.target.closest("[data-white-model-clear-selection]")) {
        event.preventDefault();
        viewer.selectMesh(null);
      }
    });
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height || 300));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewer.updateCamera();
    viewer.renderOnce();
  }

  let dragging = null;
  container.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    container.focus({ preventScroll: true });
    const pickedMesh = pickWhiteModelMesh(event);
    if (pickedMesh) viewer.selectMesh(pickedMesh);
    const objectDragMode = pickedMesh && viewer.selectedMesh === pickedMesh && viewer.editMode !== "orbit"
      ? viewer.editMode
      : "";
    if (objectDragMode) {
      const object = viewer.selectedMesh.userData.whiteModelObject || {};
      dragging = {
        type: "object",
        mode: objectDragMode,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        position: whiteModelVectorValue(object.position, [0, 0, 0]),
        rotation: whiteModelVectorValue(object.rotation, [0, 0, 0]),
        size: whiteModelVectorValue(object.size, [1, 1, 1])
      };
      container.classList.add("is-editing");
    } else {
      dragging = {
        type: "orbit",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        yaw: viewer.yaw,
        pitch: viewer.pitch
      };
      container.classList.add("is-orbiting");
    }
    try {
      container.setPointerCapture(event.pointerId);
    } catch {}
  });
  container.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragging.type === "object") {
      updateWhiteModelObjectDrag(event);
      return;
    }
    viewer.yaw = dragging.yaw - (event.clientX - dragging.x) * 0.008;
    viewer.pitch = clamp(dragging.pitch + (event.clientY - dragging.y) * 0.006, viewer.viewMode === "interior" ? -0.22 : -0.12, Math.PI / 2.25);
    viewer.updateCamera();
    viewer.renderOnce();
  });
  ["pointerup", "pointercancel"].forEach((type) => {
    container.addEventListener(type, (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      const moved = Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y);
      const shouldPick = dragging.type === "orbit" && type === "pointerup" && moved < 5;
      const shouldRefreshEditor = dragging.type === "object" && type === "pointerup" && moved >= 1;
      dragging = null;
      container.classList.remove("is-orbiting");
      container.classList.remove("is-editing");
      if (shouldPick) viewer.selectMesh(pickWhiteModelMesh(event));
      if (shouldRefreshEditor) renderWhiteModelEditor();
    });
  });
  container.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    viewer.distance = clamp(viewer.distance * Math.exp(wheelDeltaPixels(event) * 0.001), viewer.minDistance, viewer.maxDistance);
    viewer.updateCamera();
    viewer.renderOnce();
  }, { passive: false });
  container.addEventListener("keydown", (event) => {
    if (!viewer.selectedMesh) return;
    const object = viewer.selectedMesh.userData.whiteModelObject || {};
    const position = whiteModelVectorValue(object.position, [0, 0, 0]);
    const rotation = whiteModelVectorValue(object.rotation, [0, 0, 0]);
    const moveStep = event.shiftKey ? 0.5 : 0.1;
    const rotateStep = event.shiftKey ? 15 : 5;
    let handled = true;
    if (event.key === "ArrowLeft") position[0] = whiteModelNumber(position[0] - moveStep);
    else if (event.key === "ArrowRight") position[0] = whiteModelNumber(position[0] + moveStep);
    else if (event.key === "ArrowUp") position[2] = whiteModelNumber(position[2] - moveStep);
    else if (event.key === "ArrowDown") position[2] = whiteModelNumber(position[2] + moveStep);
    else if (event.key === "PageUp") position[1] = whiteModelNumber(position[1] + moveStep);
    else if (event.key === "PageDown") position[1] = whiteModelNumber(position[1] - moveStep);
    else if (event.key === "[") rotation[1] = whiteModelNumber(rotation[1] - rotateStep);
    else if (event.key === "]") rotation[1] = whiteModelNumber(rotation[1] + rotateStep);
    else if (event.key === "Escape") {
      viewer.selectMesh(null);
      return;
    } else {
      handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
    viewer.applySelectedPatch({ position, rotation }, { refreshEditor: true });
  });

  viewer.resizeObserver = new ResizeObserver(resize);
  viewer.resizeObserver.observe(container);
  resize();
  return viewer;
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
  if (mode === "plan-axonometric") {
    return state.primaryImage
      ? ["先生成彩色平面图", "再转高精度轴测图", "最后选区出效果图"]
      : ["上传平面图", "生成彩色平面图", "继续轴测图链路"];
  }
  if (mode === "plan-axonometric-view") {
    return state.primaryImage
      ? ["确认彩平信息完整", "调整轴测角度", "生成高精度轴测图"]
      : ["上传彩色平面图", "调整轴测角度", "生成轴测图"];
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
  if (mode === "image-modeling") {
    if (!state.primaryImage) return ["上传平面图或线稿", "生成白底图", "再生成CAD参考"];
    const analysis = currentImageModelingAnalysis();
    if (!currentImageModelingWhiteBackgroundImage(analysis)) return ["生成白底图", "再生成CAD参考", "最后导出DXF/SVG"];
    if (!currentImageModelingCadReferenceImage(analysis)) return ["白底图已就绪", "生成CAD参考图", "最后导出DXF/SVG"];
    return ["CAD参考图已就绪", "导出 CAD", "下载 DXF / SVG"];
  }
  if (state.render?.url || state.renders.length) {
    return ["选中结果继续优化", "对比收藏最佳图", "必要时高清/锐化"];
  }
  if (state.mode === "designseries") {
    return activeReferenceImages().length ? ["先识别参考图", "确认系列空间清单", "生成 4/6/8 张成套图"] : ["上传 2-8 张参考图", "让 Agent 识别设计语言"];
  }
  if (state.mode === "design-derivation") {
    return ["输入项目条件", "拆解设计元素", "推导三套方案方向"];
  }
  if (state.mode === "panorama") {
    return ["直接描述全景空间", "可选上传参考图", "生成 2:1 全景图"];
  }
  if (!state.primaryImage && !allowsNoPrimaryInput()) {
    return ["上传主图", "Agent 判断输入类型", "确认当前能力后生成"];
  }
  return ["上传参考图或主图", "描述想要的结果", "点击生成图片"];
}

function agentRiskNotes(analysis, advice) {
  const notes = [];
  if (state.activeTask?.status === "failed") notes.push("最近任务失败，先看状态面板复盘再复跑");
  if (analysis && advice?.mismatch) notes.push(`当前模式与识别结果不一致，建议先试「${advice.label}」`);
  notes.push(...promptPresetRiskNotes());
  if (!state.primaryImage && !allowsNoPrimaryInput()) notes.push("当前能力需要主图输入");
  if (state.mode === "plan-render" && state.primaryImage && !state.selection) notes.push("未框选区域，将自动选择与参考图最接近的区域生成");
  if (normalizeClientMode(state.mode) === "image-modeling" && state.primaryImage) {
    notes.push("推荐先生成白底图和 CAD 结构参考图；也可以直接导出第一版 CAD");
  }
  if (state.mode === "plan-axonometric" && state.primaryImage) notes.push(`当前纸张拖拽角度：${planPaperReadoutText()}；本步输出彩色平面图，不做墙体挤出或3D模型。`);
  if (state.mode === "plan-axonometric-view" && state.primaryImage) notes.push(`当前纸张拖拽角度：${planPaperReadoutText()}；本步输出高精度轴测图。`);
  if (state.mode === "plan-render" && state.primaryImage) notes.push(`当前纸张拖拽角度：${planPaperReadoutText()}；本步从轴测图区域生成效果图。`);
  if (isPlanGuidanceMode(state.mode)) notes.push(planWorkflowRecommendationText);
  if (state.mode === "designseries" && activeReferenceImages().length < 2) notes.push("设计系列建议至少 2 张参考图");
  if (state.mode === "design-derivation" && !currentCanvasUserPrompt() && !activeReferenceImages().length) notes.push("建议补充项目目标或参考图，推导会更具体");
  if (activeReferenceImages().length >= 6) notes.push("参考图较多，建议用权重控制主次");
  if (state.generation.count > 2) notes.push("多张生成更耗时，排障时可先用 1 张");
  return notes.length ? notes : ["暂无明显冲突"];
}

function renderPlanWorkflowAdvisoryHtml(mode = state.mode) {
  const normalizedMode = normalizeClientMode(mode);
  if (!isPlanGuidanceMode(normalizedMode)) return "";
  const currentStep = planWorkflowSteps[normalizedMode];
  return `
    <div class="plan-advisory">
      <div class="plan-advisory-head">
        <span>推荐链路</span>
        <b>${escapeHtml(currentStep ? `当前第 ${currentStep.index} 步` : "提示不强制")}</b>
      </div>
      <div class="plan-advisory-steps" aria-label="平面图推荐链路">
        ${Object.entries(planWorkflowSteps).map(([stepMode, step]) => `
          <span class="${stepMode === normalizedMode ? "is-current" : ""}">${step.index}. ${escapeHtml(step.label)}</span>
        `).join("")}
      </div>
      <p>${escapeHtml(planWorkflowRecommendationText)} 三个阶段都会显示纸张拖拽视角控制，用于锁定 yaw、tilt、取景和近远关系。</p>
    </div>
  `;
}

function imageModelingFlowSteps() {
  const hasPrimary = Boolean(state.primaryImage);
  const analysis = currentImageModelingAnalysis();
  const hasWhite = Boolean(currentImageModelingWhiteBackgroundImage(analysis));
  const hasCadReference = Boolean(currentImageModelingCadReferenceImage(analysis));
  const hasCad = Boolean(state.cadResults.length);
  return [
    {
      index: 1,
      title: "上传图片",
      detail: "平面图 / 截图 / 线稿",
      done: hasPrimary,
      current: !hasPrimary
    },
    {
      index: 2,
      title: "生成白底图",
      detail: "清理背景和主体边界",
      done: hasWhite,
      current: hasPrimary && !hasWhite
    },
    {
      index: 3,
      title: "生成CAD参考图",
      detail: "结构线稿更稳定",
      done: hasCadReference,
      current: hasWhite && !hasCadReference
    },
    {
      index: 4,
      title: "下载 CAD",
      detail: "DXF / SVG 描底",
      done: hasCad,
      current: hasPrimary && (hasCadReference || hasCad)
    }
  ];
}

function renderImageModelingWorkflowAdvisoryHtml({ compact = false } = {}) {
  const steps = imageModelingFlowSteps();
  return `
    <div class="image-modeling-flow ${compact ? "is-compact" : ""}">
      <div class="image-modeling-flow-head">
        <span>推荐链路</span>
        <b>${state.primaryImage ? "图片已可直接转 CAD" : "当前第 1 步"}</b>
      </div>
      <div class="image-modeling-flow-steps" aria-label="图片转 CAD 推荐链路">
        ${steps.map((step) => `
          <span class="${[
            step.done ? "is-done" : "",
            step.current ? "is-current" : "",
            step.optional ? "is-optional" : ""
          ].filter(Boolean).join(" ")}">
            <i>${step.index}</i>
            <strong>${escapeHtml(step.title)}</strong>
            <em>${escapeHtml(step.detail)}</em>
          </span>
        `).join("")}
      </div>
      <p>${escapeHtml(imageModelingWorkflowRecommendationText)}</p>
    </div>
  `;
}

function renderImageModelingFlowBlock() {
  const block = els.imageModelingFlowBlock;
  if (!block) return;
  block.hidden = true;
  block.innerHTML = "";
}

function imageModelingAnalysisStatusText() {
  if (!state.primaryImage) return "未上传";
  const analysis = currentImageModelingAnalysis();
  if (state.cadResults.length) return "CAD已生成";
  if (currentImageModelingCadReferenceImage(analysis)) return "CAD参考就绪";
  if (currentImageModelingWhiteBackgroundImage(analysis)) return "白底图就绪";
  return "可转CAD";
}

function renderImageModelingSubjectPanel() {
  if (!els.imageModelingSubjectPanel) return;
  const isModelingMode = normalizeClientMode(state.mode) === "image-modeling";
  const visible = isModelingMode && Boolean(state.primaryImage);
  els.imageModelingSubjectPanel.hidden = !visible;
  if (!visible) return;

  const analysis = currentImageModelingAnalysis();
  const whiteBackgroundImage = currentImageModelingWhiteBackgroundImage(analysis);
  const cadReferenceImage = currentImageModelingCadReferenceImage(analysis);
  const statusText = imageModelingAnalysisStatusText();
  const latestCad = state.cadResults.at(-1);

  if (els.imageModelingSubjectStatus) {
    els.imageModelingSubjectStatus.textContent = statusText;
    els.imageModelingSubjectStatus.classList.toggle("ready", Boolean(state.primaryImage));
    els.imageModelingSubjectStatus.classList.toggle("error", false);
  }
  if (els.imageModelingSubjectTitle) {
    els.imageModelingSubjectTitle.textContent = latestCad
      ? "图片已转换为 CAD 线稿"
      : cadReferenceImage
        ? "CAD结构参考图已就绪"
        : whiteBackgroundImage
          ? "白底主体图已就绪"
          : "图片已就绪，建议先生成白底图";
  }
  if (els.imageModelingSubjectSummary) {
    els.imageModelingSubjectSummary.textContent = latestCad
      ? `已提取 ${latestCad.lineCount || 0} 条线段，可在画布或下载管理里预览并下载 DXF / SVG。`
      : cadReferenceImage
        ? "已生成 CAD 结构参考图。下一步会优先从这张图导出 DXF / SVG，也可以重新生成参考图。"
        : whiteBackgroundImage
          ? "白底图已生成。建议继续生成 CAD 结构参考图，再导出 DXF / SVG。"
          : "推荐链路：先生成白底图，再生成 CAD 结构参考图，最后导出 DXF / SVG。也可以直接点击生成 CAD 得到第一版线稿。";
  }
  if (els.imageModelingLayerList) {
    els.imageModelingLayerList.innerHTML = [
      whiteBackgroundImage ? "<span>白底图：已就绪</span>" : "<span class=\"muted-layer\">待生成白底图</span>",
      cadReferenceImage ? "<span>CAD参考：已就绪</span>" : "<span class=\"muted-layer\">待生成CAD参考</span>",
      latestCad ? `<span>${Number(latestCad.lineCount || 0)} 条线段</span>` : "<span>输出：DXF / SVG</span>"
    ].join("");
  }
  if (els.imageModelingAnalyzeButton) {
    els.imageModelingAnalyzeButton.hidden = false;
    els.imageModelingAnalyzeButton.disabled = state.activeTask?.status === "running" || Boolean(whiteBackgroundImage);
    els.imageModelingAnalyzeButton.innerHTML = `<svg><use href="#icon-spark"></use></svg>${whiteBackgroundImage ? "白底图已生成" : "1 生成白底图"}`;
    els.imageModelingAnalyzeButton.title = whiteBackgroundImage ? "白底图已就绪" : "推荐第一步：生成白底主体图";
  }
  if (els.imageModelingConfirmButton) {
    els.imageModelingConfirmButton.hidden = true;
  }
  if (els.imageModelingCadReferenceButton) {
    els.imageModelingCadReferenceButton.hidden = false;
    els.imageModelingCadReferenceButton.disabled = state.activeTask?.status === "running" || !state.primaryImage;
    els.imageModelingCadReferenceButton.innerHTML = `<svg><use href="#icon-vector"></use></svg>${cadReferenceImage ? "更新CAD参考图" : "2 生成CAD参考图"}`;
    els.imageModelingCadReferenceButton.title = cadReferenceImage ? "重新生成 CAD 结构参考图" : "推荐第二步：基于白底图或原图生成 CAD 结构参考图";
  }
}

function renderAgentBriefInsight() {
  if (!els.agentBriefInsight) return;
  const mode = normalizeClientMode(state.mode);
  const meaning = workflowButtonMeanings[mode] || workflowButtonMeanings.custom;
  const analysis = state.primaryImageAnalysis || state.primaryImage?.inputAnalysis;
  const advice = inputWorkflowAdvice(analysis, mode);
  const activeReferences = activeReferenceImages();
  const planAdvisory = renderPlanWorkflowAdvisoryHtml(mode);
  const workflowAdvisory = mode === "image-modeling"
    ? renderImageModelingWorkflowAdvisoryHtml({ compact: true })
    : planAdvisory;
  renderPlanAngleSyncBlock();
  if (!analysis && !activeReferences.length && !state.render && !state.activeTask) {
    els.agentBriefInsight.innerHTML = `
      <div class="agent-brief-simple">
        <strong>${isPlanGuidanceMode(mode) ? `先上传${planPaperWorkflowSourceLabel(mode)}，再拖拽纸张确认视角。` : mode === "image-modeling" ? "上传图片后，可直接生成 CAD 线稿。" : "先上传参考图，也可以直接输入需求。"}</strong>
        <p>${isPlanGuidanceMode(mode) ? "Agent 会先识别图纸类型，提示推荐链路，并把当前纸张角度写入最终提示词；链路提示不会强制执行。" : mode === "image-modeling" ? imageModelingWorkflowRecommendationText : "Agent 会先理解输入与目标，再组织生成，而不是直接把图片扔给模型。"}</p>
      </div>
      ${workflowAdvisory}
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
    state.thinking?.status === "active" ? sanitizeLegacyPlanDisplayText(state.thinking.text) : meaning.change,
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
    ${workflowAdvisory}
  `;
}

function showHome() {
  captureActiveCanvasState();
  scheduleCanvasStateSave({ delay: 80 });
  document.body.classList.remove("workspace-active", "asset-library-active", "reference-only-mode", "agent-panel-collapsed");
  state.historyPanelOpen = false;
  state.statusPanelOpen = false;
  renderWorkspaceHistoryPanel();
  renderWorkspaceStatusPanel();
  els.homeView.hidden = false;
  els.workspaceView.hidden = true;
  if (els.assetLibraryView) els.assetLibraryView.hidden = true;
}

async function showWorkspace(mode = "canvas") {
  mode = mode === "canvas" ? mode : publicModeOrFallback(mode);
  document.body.classList.remove("asset-library-active");
  document.body.classList.add("workspace-active");
  applyAgentPanelCollapsed(state.agentPanelCollapsed);
  applyCanvasListCollapsed(true, { persist: false });
  els.homeView.hidden = true;
  els.workspaceView.hidden = false;
  if (els.assetLibraryView) els.assetLibraryView.hidden = true;
  ensureCanvasCollection(mode === "canvas" ? state.mode || "custom" : mode);
  await restoreCanvasRecord(activeCanvasRecord());
  requestAnimationFrame(() => {
    drawSelectionCanvas();
    renderWorkflowCanvas();
  });
  scheduleCanvasStateSave({ delay: 120 });
}

function showAssetLibraryPage() {
  captureActiveCanvasState();
  scheduleCanvasStateSave({ delay: 80 });
  document.body.classList.remove("workspace-active", "reference-only-mode", "agent-panel-collapsed");
  document.body.classList.add("asset-library-active");
  state.historyPanelOpen = false;
  state.statusPanelOpen = false;
  renderWorkspaceHistoryPanel();
  renderWorkspaceStatusPanel();
  els.homeView.hidden = true;
  els.workspaceView.hidden = true;
  if (els.assetLibraryView) els.assetLibraryView.hidden = false;
  renderAssetLibraryPage();
  refreshTaskLogs({ silent: true });
  focusElement(els.assetLibraryView);
}

function currentHomeToolFilter() {
  return els.homeToolFilterButtons.find((button) => button.classList.contains("active"))?.dataset.homeToolFilter || "all";
}

function renderHomeToolCenter() {
  if (!els.homeToolCards.length) return;
  const query = (els.homeToolSearch?.value || "").trim().toLowerCase();
  const activeFilter = currentHomeToolFilter();
  let visibleCount = 0;

  els.homeToolCards.forEach((card) => {
    const startMode = card.querySelector("[data-start-mode]")?.dataset.startMode || "custom";
    const group = card.dataset.taskGroup || "all";
    const keywords = `${card.dataset.keywords || ""} ${card.textContent || ""}`.toLowerCase();
    const matchesFilter = activeFilter === "all" || group === activeFilter;
    const matchesQuery = !query || keywords.includes(query);
    const visible = isFriendVisibleMode(startMode) && matchesFilter && matchesQuery;
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  if (els.homeToolEmpty) els.homeToolEmpty.hidden = visibleCount > 0;
}

function setHomeToolFilter(filter) {
  els.homeToolFilterButtons.forEach((button) => {
    const active = (button.dataset.homeToolFilter || "all") === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderHomeToolCenter();
}

function applyFriendExperienceUi() {
  document.body.classList.toggle("friend-experience-mode", friendExperienceMode);
  [els.settingsButton, els.workspaceSettingsButton].forEach((button) => {
    if (button) button.hidden = false;
  });
  els.startButtons.forEach((button) => {
    const visible = isFriendVisibleMode(button.dataset.startMode || "custom");
    const card = button.closest("[data-home-tool-card]");
    if (!card) button.hidden = !visible;
  });
  Array.from(els.floatingModeSelect?.options || []).forEach((option) => {
    option.hidden = !isFriendVisibleMode(option.value);
    option.disabled = !isFriendVisibleMode(option.value);
  });
  if (els.floatingModeSelect && !isFriendVisibleMode(els.floatingModeSelect.value)) {
    els.floatingModeSelect.value = "custom";
  }
  els.homeTemplateButtons.forEach((button) => {
    const mode = projectTemplates[button.dataset.homeTemplate]?.mode || "custom";
    button.hidden = !isFriendVisibleMode(mode);
  });
  els.projectLibraryFilterButtons.forEach((button) => {
    const filter = button.dataset.projectLibraryFilter || "images";
    button.hidden = friendExperienceMode && filter === "cad";
  });
  if (friendExperienceMode && state.projectLibraryFilter === "cad") {
    state.projectLibraryFilter = "images";
  }
  syncModeTabs(state.mode);
}

async function openHomeTemplate(templateId) {
  const template = projectTemplates[templateId];
  if (!template) return;
  await showWorkspace(template.mode || "designseries");
  applyProjectTemplate(templateId);
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
  resetImageModelingAnalysis();
  state.selection = null;
  resetImageViewStates();
  if (state.canvas.selectedImage?.id === "source") {
    state.canvas.selectedImage = null;
  }
  if (els.primaryImageInput) els.primaryImageInput.value = "";
  setUploadStatus("idle", "", { target: "primary" });
  state.thinking = defaultThinkingState();
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  toast("已删除原图");
}

function removeReferenceImage(index) {
  const referenceIndex = Number(index);
  if (!Number.isInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= state.referenceImages.length) return;
  const oldPositions = cloneValue(state.canvas.positions, {}) || {};
  state.referenceImages.splice(referenceIndex, 1);
  state.designSeriesAnalysis = null;
  if (state.canvas.selectedImage?.id === `reference${referenceIndex}` || state.canvas.selectedImage?.id?.startsWith("reference")) {
    state.canvas.selectedImage = null;
  }
  Object.keys(state.canvas.positions).forEach((key) => {
    if (/^reference\d+$/.test(key)) delete state.canvas.positions[key];
  });
  Object.keys(oldPositions).forEach((key) => {
    const match = key.match(/^reference(\d+)$/);
    if (!match) return;
    const oldIndex = Number(match[1]);
    if (oldIndex < referenceIndex) {
      state.canvas.positions[key] = oldPositions[key];
    } else if (oldIndex > referenceIndex) {
      state.canvas.positions[`reference${oldIndex - 1}`] = oldPositions[key];
    }
  });
  if (els.referenceImageInput) els.referenceImageInput.value = "";
  if (!state.referenceImages.length) setUploadStatus("idle", "", { target: "reference" });
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
    resetImageModelingAnalysis();
    state.selection = null;
    resetImageViewStates();
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

function renderPipelineSteps(render) {
  return Array.isArray(render?.pipeline?.steps)
    ? render.pipeline.steps.filter((step) => step && typeof step === "object")
    : [];
}

function renderPipelineImageSteps(render) {
  return renderPipelineSteps(render).filter((step) => step.url && step.id !== "tilted-3d-plan" && step.kind !== "Final");
}

function getOutputItems() {
  const renderItems = state.renders.flatMap((render, index) => {
    const finalId = render.id || `render-${index}`;
    const pipelineItems = renderPipelineImageSteps(render).map((step, pipelineIndex) => ({
      id: step.outputId || `${finalId}-pipeline-${step.id || pipelineIndex}`,
      nodeId: `render${index}Pipeline${pipelineIndex}`,
      source: "pipeline",
      index,
      pipelineIndex,
      render,
      url: step.url,
      title: step.title || `链路中间图 ${pipelineIndex + 1}`,
      mode: render.mode || state.mode,
      stepMode: step.stepMode || "plan-color",
      workflowId: render.workflowId || "",
      parentImageId: render.parentImageId || "",
      parentNodeId: render.parentNodeId || "",
      inputImageType: render.inputImageType || "",
      inputAnalysis: render.inputAnalysis || null,
      selection: render.selection || null,
      renderRegion: "",
      renderRegionPrompt: "",
      endpoint: step.endpoint || render.endpoint || "",
      attempts: step.attempts || [],
      imageApi: step.imageApi || "",
      actualParams: step.actualParams || null,
      revisedPrompt: step.revisedPrompt || "",
      intent: render.pipeline?.strategy || step.description || "",
      prompt: step.prompt || "",
      sourcePrompt: step.sourcePrompt || "",
      createdAt: step.createdAt || render.createdAt || "",
      referenceCount: render.referenceCount ?? 0,
      pipelineStep: step
    })).filter((item) => item.url);
    const finalItem = {
      id: finalId,
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
      imageApi: render.imageApi || "",
      actualParams: render.actualParams || null,
      revisedPrompt: render.revisedPrompt || "",
      intent: render.intent || "",
      prompt: render.prompt || "",
      sourcePrompt: render.sourcePrompt || "",
      createdAt: render.createdAt || "",
      referenceCount: render.referenceCount ?? 0,
      pipeline: render.pipeline || null
    };
    return [...pipelineItems, finalItem].filter((item) => item.url);
  });

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

function outputSearchText(item) {
  return [
    item.title,
    item.mode,
    workflowStepLabel(item.stepMode || item.mode),
    item.createdAt,
    item.intent,
    item.prompt,
    item.sourcePrompt,
    item.endpoint,
    item.inputImageType,
    item.renderRegion
  ].filter(Boolean).join(" ").toLowerCase();
}

function getFilteredOutputItems(items = getOutputItems()) {
  const query = String(state.outputSearch || "").trim().toLowerCase();
  return items.filter((item) => {
    if (query && !outputSearchText(item).includes(query)) return false;
    return true;
  });
}

function getCadDownloadItems() {
  const whiteModelItems = state.whiteModelResults.map((model, index) => {
    const displayModel = normalizeWhiteModelForPreview(model) || model || {};
    const objectCount = displayModel.objectCount || displayModel.objects?.length || 0;
    return {
      downloadKind: "white-model",
      downloadId: `white-model-${displayModel.id || index}`,
      modelId: String(displayModel.id || `white-model-${index}`),
      modelIndex: index,
      title: displayModel.title || `图片建模 ${index + 1}`,
      createdAt: displayModel.createdAt || "",
      meta: `${displayModel.createdAt || ""} · ${objectCount} 个对象 · GLB / SCAD / DXF / STEP`,
      note: displayModel.summary || "参数化 3D / CAD 资产，可导出模型、足迹线稿或继续接入 CAD 工具。",
      chips: ["图片建模", "GLB", "SCAD", "DXF", "STEP", index === state.whiteModelResults.length - 1 ? "最新" : ""].filter(Boolean),
      latest: index === state.whiteModelResults.length - 1,
      searchText: [
        displayModel.title,
        displayModel.createdAt,
        displayModel.summary,
        displayModel.sourceType,
        "图片建模 白模 3d cad glb scad dxf json step forgecad"
      ].filter(Boolean).join(" ").toLowerCase()
    };
  });

  const cadItems = state.cadResults.map((cad, index) => ({
    downloadKind: "cad",
    downloadId: `cad-${cad.id || index}`,
    cadIndex: index,
    title: cad.title || `CAD ${index + 1}`,
    createdAt: cad.createdAt || "",
    meta: `${cad.createdAt || ""} · ${cad.lineCount || 0} 条线段 · SVG / DXF`,
    note: "CAD 线稿资产，可下载 DXF / SVG，或先预览线稿确认内容。",
    chips: ["CAD", "DXF", "SVG", index === state.cadResults.length - 1 ? "最新" : ""].filter(Boolean),
    latest: index === state.cadResults.length - 1,
    cad,
    searchText: [
      cad.title,
      cad.createdAt,
      cad.lineCount,
      "cad dxf svg 平面图 线稿"
    ].filter(Boolean).join(" ").toLowerCase()
  }));

  return [...whiteModelItems, ...cadItems];
}

function getDownloadManagerItems(imageItems = getOutputItems()) {
  return [
    ...imageItems.map((item) => ({ ...item, downloadKind: "image", downloadId: `image-${item.id}` })),
    ...getCadDownloadItems()
  ];
}

function downloadManagerSearchText(item) {
  return item.downloadKind === "image"
    ? outputSearchText(item)
    : item.searchText || [
        item.title,
        item.meta,
        item.note,
        ...(item.chips || [])
      ].filter(Boolean).join(" ").toLowerCase();
}

function getFilteredDownloadManagerItems(items = getDownloadManagerItems()) {
  const query = String(state.outputSearch || "").trim().toLowerCase();
  return items.filter((item) => {
    if (query && !downloadManagerSearchText(item).includes(query)) return false;
    return true;
  });
}

function outputNextWorkflowButtons(item) {
  const nextModes = nextPlanWorkflowModes(item.stepMode || item.mode);
  return nextModes.map((nextMode) => {
    const label = nextMode === "plan-axonometric"
      ? "用这张生成彩色平面图"
      : nextMode === "plan-axonometric-view"
        ? "用这张生成轴测图"
      : nextMode === "plan-render"
        ? "用这张生成效果图"
        : `用这张继续${suggestedModeLabel(nextMode)}`;
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
    index === total - 1 ? "最新" : ""
  ].filter(Boolean);
  return chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
}

function cadDownloadActionButton({ action, icon, label, modelId = "", modelIndex = "", cadIndex = "" }) {
  return uiIconButton({
    className: "text-button",
    icon,
    label,
    attrs: `data-cad-download-action="${escapeAttr(action)}" data-model-id="${escapeAttr(modelId)}" data-model-index="${escapeAttr(modelIndex)}" data-cad-index="${escapeAttr(cadIndex)}"`
  });
}

function renderOutputManagerImageItem(item, imageItems) {
  const index = imageItems.findIndex((entry) => entry.id === item.id);
  const latest = index === imageItems.length - 1;
  const meta = outputMetaLine(item) || item.mode || "Output";
  const actual = formatActualImageParams(item.actualParams, item.imageApi);
  const note = String(item.intent || item.prompt || item.sourcePrompt || "可作为下一轮创作输入继续迭代。");
  const notePreview = `${note.slice(0, 140)}${note.length > 140 ? "…" : ""}`;
  const previewLabel = isPanoramaOutput(item) ? "全景预览" : "预览";
  return `
    <article class="output-manager-item ${latest ? "is-latest" : ""}" data-output-id="${escapeAttr(item.id)}">
      <button class="output-manager-thumb" type="button" data-output-action="preview" data-output-id="${escapeAttr(item.id)}" title="预览 ${escapeAttr(item.title)}" aria-label="预览 ${escapeAttr(item.title)}">
        <img src="${escapeAttr(item.url)}" data-cache-thumbnail="true" alt="${escapeAttr(item.title)}" />
        <span>${latest ? "Latest" : "Preview"}</span>
      </button>
      <div class="output-manager-copy">
        <div class="output-manager-title-row">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.createdAt || workflowStepLabel(item.stepMode || item.mode))}</small>
        </div>
        <div class="output-manager-chips">${outputManagerChips(item, index, imageItems.length)}</div>
        <p>${escapeHtml(notePreview)}</p>
        <span>${escapeHtml([meta, actual].filter(Boolean).join(" · "))}</span>
      </div>
      <div class="output-manager-buttons" aria-label="结果操作">
        ${outputActionButton({ action: "preview", outputId: item.id, icon: "icon-focus", label: previewLabel, className: "secondary-button" })}
        ${outputActionButton({ action: "download", outputId: item.id, icon: "icon-export", label: "下载", className: "text-button" })}
        ${outputActionButton({ action: "vector-export", outputId: item.id, icon: "icon-vector", label: "导出为矢量图", className: "text-button" })}
      </div>
    </article>
  `;
}

function renderOutputManagerCadItem(item) {
  const isWhiteModel = item.downloadKind === "white-model";
  const thumbAction = isWhiteModel ? "focus-white" : "preview-cad";
  const icon = isWhiteModel ? "icon-cube" : "icon-vector";
  const thumbLabel = isWhiteModel ? "3D" : "CAD";
  const notePreview = `${String(item.note || "").slice(0, 140)}${String(item.note || "").length > 140 ? "…" : ""}`;
  return `
    <article class="output-manager-item output-manager-cad-item ${item.latest ? "is-latest" : ""}" data-download-kind="${escapeAttr(item.downloadKind)}">
      <button class="output-manager-thumb output-manager-file-thumb" type="button" data-cad-download-action="${escapeAttr(thumbAction)}" data-model-index="${escapeAttr(item.modelIndex ?? "")}" data-cad-index="${escapeAttr(item.cadIndex ?? "")}" title="${escapeAttr(isWhiteModel ? "定位 3D 模型" : "预览 CAD")}" aria-label="${escapeAttr(isWhiteModel ? "定位 3D 模型" : "预览 CAD")}">
        <svg><use href="#${icon}"></use></svg>
        <span>${thumbLabel}</span>
      </button>
      <div class="output-manager-copy">
        <div class="output-manager-title-row">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.createdAt || thumbLabel)}</small>
        </div>
        <div class="output-manager-chips">${(item.chips || []).map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
        <p>${escapeHtml(notePreview)}</p>
        <span>${escapeHtml(item.meta || "")}</span>
      </div>
      <div class="output-manager-buttons" aria-label="CAD 下载操作">
        ${isWhiteModel
          ? `
            ${cadDownloadActionButton({ action: "focus-white", icon: "icon-focus", label: "定位模型", modelIndex: item.modelIndex })}
            ${cadDownloadActionButton({ action: "white-glb", icon: "icon-export", label: "导出 GLB", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-scad", icon: "icon-cube", label: "下载 SCAD", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-dxf", icon: "icon-vector", label: "下载 DXF 足迹", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-json", icon: "icon-copy", label: "下载 JSON", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-forgecad", icon: "icon-copy", label: "ForgeCAD 脚本", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-forgecad-studio", icon: "icon-play", label: "打开 ForgeCAD", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-cad-export", icon: "icon-export", label: "text-to-cad 导出 STEP", modelId: item.modelId })}
            ${cadDownloadActionButton({ action: "white-import-cad", icon: "icon-reference", label: "导入 CAD 足迹", modelId: item.modelId })}
          `
          : `
            ${cadDownloadActionButton({ action: "preview-cad", icon: "icon-focus", label: "预览 CAD", cadIndex: item.cadIndex })}
            ${item.cad?.dxfUrl ? uiIconLink({ className: "text-button", href: item.cad.dxfUrl, icon: "icon-export", label: "下载 DXF", attrs: `download="${escapeAttr(item.cad.fileBase || item.title)}.dxf"` }) : ""}
            ${item.cad?.svgUrl ? uiIconLink({ className: "text-button", href: item.cad.svgUrl, icon: "icon-image", label: "下载 SVG", attrs: `download="${escapeAttr(item.cad.fileBase || item.title)}.svg"` }) : ""}
          `}
      </div>
    </article>
  `;
}

function renderOutputManager() {
  if (!els.outputManagerList) return;
  const imageItems = getOutputItems();
  const validIds = new Set(imageItems.map((item) => item.id));
  [...state.favoriteOutputIds].forEach((id) => { if (!validIds.has(id)) state.favoriteOutputIds.delete(id); });
  [...state.compareOutputIds].forEach((id) => { if (!validIds.has(id)) state.compareOutputIds.delete(id); });
  if (els.outputManagerSearch && els.outputManagerSearch.value !== state.outputSearch) {
    els.outputManagerSearch.value = state.outputSearch || "";
  }
  const items = getDownloadManagerItems(imageItems);
  if (!items.length) {
    els.outputManagerList.innerHTML = `
      <article class="output-manager-empty">
        <strong>还没有可下载内容</strong>
        <span>生成后的图片和 CAD 线稿会在这里汇总下载。</span>
      </article>
    `;
    if (els.exportOutputsButton) els.exportOutputsButton.disabled = true;
    return;
  }

  const visibleItems = getFilteredDownloadManagerItems(items);
  const visibleImageItems = getFilteredOutputItems(imageItems);
  if (els.exportOutputsButton) els.exportOutputsButton.disabled = !visibleImageItems.length;
  if (!visibleItems.length) {
    els.outputManagerList.innerHTML = `
      <article class="output-manager-empty">
        <strong>没有匹配的下载项</strong>
        <span>换个关键词后再试。</span>
      </article>
    `;
    return;
  }

  els.outputManagerList.innerHTML = visibleItems.map((item) => item.downloadKind === "image"
    ? renderOutputManagerImageItem(item, imageItems)
    : renderOutputManagerCadItem(item)).join("");
  hydrateCachedThumbnails(els.outputManagerList);
  bindOutputActionEvents(els.outputManagerList);
  bindCadDownloadActionEvents(els.outputManagerList);
}

function outputNodeActions(outputId, url, item = null) {
  const favorite = state.favoriteOutputIds.has(outputId);
  const compare = state.compareOutputIds.has(outputId);
  const workflowButtons = item ? outputNextWorkflowButtons(item) : "";
  const previewLabel = item && isPanoramaOutput(item) ? "全景预览" : "预览";
  return `
    ${uiIconLink({ href: url, icon: "icon-export", label: "打开原图", attrs: `target="_blank" rel="noreferrer"` })}
    ${outputActionButton({ action: "preview", outputId, icon: "icon-focus", label: previewLabel })}
    ${outputActionButton({ action: "send-to-panel", outputId, icon: "icon-reference", label: "创作需求" })}
    ${workflowButtons}
    ${outputActionButton({ action: "favorite", outputId, icon: "icon-star", label: favorite ? "已收藏" : "收藏", attrs: `aria-pressed="${favorite ? "true" : "false"}"` })}
    ${outputActionButton({ action: "compare", outputId, icon: "icon-compare", label: compare ? "移出对比" : "对比", attrs: `aria-pressed="${compare ? "true" : "false"}"` })}
    ${outputActionButton({ action: "tool-upscale", outputId, icon: "icon-focus", label: "高清" })}
    ${outputActionButton({ action: "tool-sharpen", outputId, icon: "icon-detail", label: "锐化" })}
    ${outputActionButton({ action: "tool-colorgrade", outputId, icon: "icon-filter", label: "调色" })}
    ${outputActionButton({ action: "tool-cutout", outputId, icon: "icon-box-select", label: "抠图" })}
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

function bindCadDownloadActionEvents(root) {
  root.querySelectorAll("[data-cad-download-action]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleCadDownloadAction(control.dataset.cadDownloadAction, control)
        .catch((error) => toast(error.message));
    });
  });
}

async function handleCadDownloadAction(action, control) {
  if (action === "focus-white") {
    focusCanvasToNodes([`whiteModel${Number(control.dataset.modelIndex || 0)}`]);
    return;
  }
  if (action === "preview-cad") {
    const cad = state.cadResults[Number(control.dataset.cadIndex || 0)];
    if (!cad?.svgUrl && !cad?.previewSvgUrl) return;
    openImagePreview({
      url: cad.previewSvgUrl || cad.svgUrl,
      title: cad.title || "CAD",
      caption: `${cad.createdAt || ""} · ${cad.lineCount || 0} 条线段 · CAD 环境预览 · 下载仍为干净 SVG / DXF`,
      items: []
    });
    return;
  }
  if (action?.startsWith("white-")) return handleWhiteModelAssetAction(action, control);
}

function findOutputItem(outputId) {
  const items = getOutputItems();
  return items.find((item) => item.id === outputId) || items.find((item) => item.nodeId === outputId);
}

function outputItemForSelectedImage(selected = null) {
  if (!selected?.url && !selected?.outputId && !selected?.id) return null;
  return findOutputItem(selected.outputId)
    || getOutputItems().find((item) => item.url === selected.url || item.nodeId === selected.id || item.id === selected.outputId)
    || null;
}

function latestRenderBranchOutputItem() {
  const index = state.renders.length - 1;
  if (index < 0) return null;
  const render = state.renders[index];
  const outputId = render?.id || `render-${index}`;
  return findOutputItem(outputId) || {
    id: outputId,
    nodeId: `render${index}`,
    url: render?.url || "",
    title: render?.title || `效果图 ${index + 1}`,
    intent: render?.intent || "",
    workflowId: render?.workflowId || "",
    parentImageId: render?.parentImageId || "",
    parentNodeId: render?.parentNodeId || ""
  };
}

function referenceCanvasSelectedImage(index) {
  const referenceIndex = Number(index);
  const image = state.referenceImages[referenceIndex];
  if (!image?.dataUrl) return null;
  const weightLabel = referenceWeightOptions.find((item) => item.value === (image.weight || "default"))?.label || "默认参考";
  return {
    id: `reference${referenceIndex}`,
    url: image.dataUrl,
    title: image.name || `参考图 ${referenceIndex + 1}`,
    caption: `${weightLabel} · ${image.name || `参考图 ${referenceIndex + 1}`}`,
    kind: "Reference"
  };
}

function selectedCanvasBranchSource(selected = state.canvas.selectedImage) {
  if (!selected?.id || selected.id === "source") return null;
  if (/^reference\d+$/.test(selected.id)) {
    return { selectedImage: selected, outputItem: null };
  }
  const outputItem = outputItemForSelectedImage(selected);
  if (!outputItem?.nodeId) return null;
  return {
    selectedImage: outputItemToSelectedImage(outputItem),
    outputItem
  };
}

function attachDerivedCanvasResultMetadata(result, selected = null, outputItem = null) {
  if (!result || typeof result !== "object") return result;
  const parentItem = outputItem || outputItemForSelectedImage(selected);
  const parentNodeId = parentItem?.nodeId || selected?.id || "";
  result.workflowId = parentItem?.workflowId || result.workflowId || "";
  result.parentImageId = parentItem?.id || selected?.outputId || selected?.id || result.parentImageId || "";
  result.parentNodeId = parentNodeId || result.parentNodeId || "";
  result.inputImageType = parentItem?.inputImageType || result.inputImageType || "";
  result.inputAnalysis = parentItem?.inputAnalysis || result.inputAnalysis || null;
  result.referenceCount = result.referenceCount ?? activeReferenceImages().length;
  return result;
}

async function focusReferenceImageForEditing(index, { openEditor = false } = {}) {
  const selectedImage = referenceCanvasSelectedImage(index);
  if (!selectedImage) return false;
  state.canvas.selectedImage = selectedImage;
  state.canvas.imageActionBusy = "";
  renderWorkflowCanvas();
  if (openEditor) await openDeepEdit(selectedImage, { focusTarget: "canvas" });
  return true;
}

function isPanoramaOutput(item = {}) {
  const record = item || {};
  return normalizeClientMode(record.stepMode || record.mode) === "panorama";
}

async function handleOutputAction(action, outputId, nextMode = "") {
  const item = findOutputItem(outputId);
  if (!item) return;
  if (action === "download") {
    await downloadOutputItem(item, getOutputItems().findIndex((entry) => entry.id === item.id));
    return;
  }
  if (action === "vector-export") {
    await downloadOutputItemAsVectorSvg(item, getOutputItems().findIndex((entry) => entry.id === item.id));
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
    scheduleCanvasStateSave({ delay: 160 });
    renderWorkflowCanvas();
    renderWorkspaceHistoryPanel();
    renderAssetLibraryPage();
    return;
  }
  if (action === "compare") {
    if (!state.compareOutputIds.has(item.id) && state.compareOutputIds.size >= 4) {
      toast("最多同时对比 4 张图");
      return;
    }
    toggleSetValue(state.compareOutputIds, item.id);
    scheduleCanvasStateSave({ delay: 160 });
    renderWorkflowCanvas();
    return;
  }
  if (action === "preview") {
    const record = previewRecordFromOutputItem(item, "outputs");
    const payload = {
      url: record?.url || item.url,
      title: record?.title || item.title,
      caption: record?.caption || item.intent || item.mode,
      items: getPreviewRecords("outputs")
    };
    if (isPanoramaOutput(item)) openPanoramaPreview(payload);
    else openImagePreview(payload);
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
  if (!["upscale", "sharpen", "colorgrade", "cutout", "detail", "outpaint"].includes(toolMode)) return;
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
  if (["upscale", "sharpen", "colorgrade", "cutout"].includes(normalizeClientMode(item.mode)) && !item.endpoint) {
    state.canvas.selectedImage = outputItemToSelectedImage(item);
    await handleCanvasImageTool(normalizeClientMode(item.mode));
    return;
  }
  if (item.mode === "designseries") {
    await generateDesignSeries({ count: 1, allowSingle: true, title: item.title });
    return;
  }
  const parentPrimary = await primaryImageForOutputRegeneration(item);
  const regenerationMode = item.mode === "direction" ? state.mode : (item.stepMode || item.mode);
  await renderFromImages({
    mode: regenerationMode,
    primaryImage: parentPrimary || undefined,
    workflowId: item.workflowId || "",
    parentImageId: item.parentImageId || "",
    parentNodeId: item.parentNodeId || "",
    inputAnalysis: parentPrimary?.inputAnalysis || null,
    count: 1,
    allowNoPrimary: allowsNoPrimaryInput(regenerationMode),
    ignorePrimaryImage: allowsNoPrimaryInput(regenerationMode) && !parentPrimary && !state.primaryImage,
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
  resetImageModelingAnalysis();
  state.selection = null;
  resetImageViewStates();
  setMode(normalizedNext);
  setHiddenPromptContext("panelContext", canvasModeCommand(normalizedNext, outputItemToSelectedImage(item), item));
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  toast(`已把「${item.title}」设为输入，进入“${suggestedModeLabel(normalizedNext)}”。`);
}

function modeForOutputPanelSync(item, preferredMode = "") {
  const preferred = preferredMode ? normalizeClientMode(preferredMode) : "";
  if (preferred && isFriendVisibleMode(preferred) && canvasSelectableModes.some((entry) => entry.mode === preferred)) return preferred;
  const nextMode = nextPlanWorkflowModes(item.stepMode || item.mode)[0];
  if (nextMode && isFriendVisibleMode(nextMode)) return nextMode;
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

function setCanvasBranchAnchor(selectedImage = null, outputItem = null) {
  const nodeId = outputItem?.nodeId || selectedImage?.id || "";
  if (!nodeId || nodeId === "source") return;
  state.canvas.branchAnchorNodeId = nodeId;
  state.canvas.branchAnchorOutputId = outputItem?.id || selectedImage?.outputId || "";
  scheduleCanvasStateSave({ delay: 160 });
}

function ensureSessionCanvasBranchAnchor({ preferSelected = true } = {}) {
  const selectedSource = preferSelected ? selectedCanvasBranchSource() : null;
  if (selectedSource?.selectedImage) {
    setCanvasBranchAnchor(selectedSource.selectedImage, selectedSource.outputItem);
    return selectedSource;
  }
  const latestOutput = latestRenderBranchOutputItem();
  if (!latestOutput?.nodeId) return null;
  const selectedImage = outputItemToSelectedImage(latestOutput);
  setCanvasBranchAnchor(selectedImage, latestOutput);
  return { selectedImage, outputItem: latestOutput };
}

function clearCanvasBranchAnchor() {
  state.canvas.branchAnchorNodeId = "";
  state.canvas.branchAnchorOutputId = "";
}

function markDetachedCreativePanelInput(primaryImage, sourceOutputId = "") {
  if (!primaryImage) return primaryImage;
  primaryImage.detachedPanelInput = true;
  primaryImage.sourceOutputId = sourceOutputId || primaryImage.sourceOutputId || "";
  primaryImage.parentImageId = "";
  primaryImage.parentNodeId = "";
  return primaryImage;
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
  const preservedPlanPaperView = isPlanPaperMode(nextMode) && item.planPaperView
    ? cloneValue(item.planPaperView)
    : null;
  state.canvas.imageActionBusy = "send-to-panel";
  state.canvas.selectedImage = outputItemToSelectedImage(item);
  clearCanvasBranchAnchor();
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
    markDetachedCreativePanelInput(primaryImage, item.id);
    primaryImage.workflowId = isPlanWorkflowMode(nextMode)
      ? createWorkflowId(nextMode)
      : "";
    primaryImage.sourceType = analysis.key;
    primaryImage.inputAnalysis = analysis;

    state.primaryImage = primaryImage;
    state.primaryBitmap = bitmap;
    state.primaryImageAnalysis = analysis;
    resetImageModelingAnalysis();
    state.selection = null;
    resetImageViewStates();
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
    if (preservedPlanPaperView) {
      state.planPaperView = normalizedPlanPaperViewState(preservedPlanPaperView);
      state.viewControlOpen = true;
    }
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

async function useCanvasImageWithMode(mode, { detachFromCanvasParent = false } = {}) {
  const selected = state.canvas.selectedImage;
  if (!selected?.url) {
    toast("请先在画布中选择一张图片");
    return;
  }
  const normalizedMode = normalizeClientMode(mode);
  const allowed = isFriendVisibleMode(normalizedMode) && canvasSelectableModes.some((item) => item.mode === normalizedMode);
  if (!allowed) return;
  const currentPlanPaperView = isPlanPaperMode(normalizedMode) && isPlanPaperMode(state.mode)
    ? normalizedPlanPaperViewState(state.planPaperView)
    : null;

  state.canvas.imageActionBusy = "use-mode";
  renderCanvasImageToolbar();
  try {
    const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
    if (detachFromCanvasParent) clearCanvasBranchAnchor();
    else setCanvasBranchAnchor(selected, outputItem);
    const primaryImage = await imageSourceToPrimaryImage(selected);
    const generatedAnalysis = outputItem && isPlanWorkflowMode(outputItem.stepMode || outputItem.mode)
      ? inputTypeForGeneratedMode(outputItem.stepMode || outputItem.mode)
      : null;
    const bitmap = await loadImage(primaryImage.dataUrl);
    const analysis = generatedAnalysis || classifyUploadedImage(bitmap, { name: primaryImage.name, type: primaryImage.type });

    primaryImage.id = outputItem?.id || selected.id || `canvas-${Date.now()}`;
    if (detachFromCanvasParent) {
      markDetachedCreativePanelInput(primaryImage, outputItem?.id || selected.outputId || selected.id || "");
    } else {
      primaryImage.parentImageId = outputItem?.id || selected.id || "";
      primaryImage.parentNodeId = outputItem?.nodeId || selected.id || "";
    }
    primaryImage.workflowId = isPlanWorkflowMode(normalizedMode)
      ? (detachFromCanvasParent ? createWorkflowId(normalizedMode) : (outputItem?.workflowId || createWorkflowId(normalizedMode)))
      : (detachFromCanvasParent ? "" : (outputItem?.workflowId || ""));
    primaryImage.sourceType = analysis.key;
    primaryImage.inputAnalysis = analysis;

    state.primaryImage = primaryImage;
    state.primaryBitmap = bitmap;
    state.primaryImageAnalysis = analysis;
    resetImageModelingAnalysis();
    state.selection = null;
    const preservedPlanPaperView = isPlanPaperMode(normalizedMode) && (outputItem?.planPaperView || currentPlanPaperView)
      ? cloneValue(outputItem?.planPaperView || currentPlanPaperView)
      : null;
    resetImageViewStates();
    setMode(normalizedMode);
    if (preservedPlanPaperView) {
      state.planPaperView = normalizedPlanPaperViewState(preservedPlanPaperView);
      state.viewControlOpen = true;
    }
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
    "plan-axonometric": `使用画布中选中的「${title}」作为不可改动的平面底图。\n${planToColoredPlanFixedPrompt}\n${planWorkflowRecommendationText}`,
    "plan-axonometric-view": `使用画布中选中的「${title}」作为不可改动的彩色平面图底图。\n${planToAxonometricViewFixedPrompt}\n生成前先拖拽视角控制器确定斜俯视角，再按该角度生成高精度轴测图。${planWorkflowRecommendationText}`,
    "plan-render": `使用画布中选中的「${title}」作为轴测图：优先框选要生成效果图的区域；如果没有框选，则自动选择一个与参考图最接近的明确功能区生成人视角效果图，并在输出中标明对应区域。${planWorkflowRecommendationText}`,
    "design-derivation": `围绕画布中选中的「${title}」做设计元素推演与方案推导：先拆空间秩序、材料家族、灯光策略、色彩关系、家具语言、立面节奏和细部母题，再生成 3 套可继续出图的方案方向。`,
    "image-modeling": `使用画布中选中的「${title}」转 CAD：提取主要墙线、房间边界、开口、轮廓和长直图纸线段，生成可下载的 DXF / SVG 描底文件；暂时不做 3D 建模。`,
    cad: `使用画布中选中的「${title}」提取主要墙线、开口、轮廓和图纸线段，忽略阴影纹理和装饰噪点，生成可下载的 CAD / SVG 描底文件。`,
    cadrender: `使用画布中选中的「${title}」作为 CAD 或图纸底图：先锁定轴线、墙体、开口和空间关系，再生成真实空间效果图，最终不保留 CAD 线。`,
    photo: `使用画布中选中的「${title}」作为现场或现状图：保留结构、透视、开口、柱网和层高，只重新设计材料、灯光、家具和陈列。`,
    whitemodel: `使用画布中选中的「${title}」作为白模或建模截图：保留体块、视角、开口、层级和比例，补充真实材质、灯光、环境和尺度细节。`,
    panorama: `使用画布中选中的「${title}」作为全景图参考：生成 2:1 的 360 度 equirectangular 全景图，保持水平连续、地平线稳定、无缝闭合和连续环绕；如果是空间照片或效果图，重点提炼空间结构、开口、视高、材质、灯光和环绕关系，不要变成普通单视角广角照。`,
    sketch: `使用画布中选中的「${title}」作为手稿或草图：保留构图、透视、体块和设计意图，把线条转译成可建造的真实空间。`,
    colorgrade: `使用画布中选中的「${title}」做本地调色：只调整曝光、对比、高光、阴影、黑白场、色温、色调、饱和度和清晰度，不改变内容。`,
    cutout: `使用画布中选中的「${title}」做智能抠图：先识别候选主体图层，点击确认后输出透明背景 PNG。`,
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
  resetImageModelingAnalysis();
  state.selection = null;
  resetImageViewStates();
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
  const deletedLatest = state.render?.url && state.render.url === item.url;
  if (item.source === "render") {
    state.renders.splice(item.index, 1);
    Object.keys(state.canvas.positions).forEach((key) => {
      if (/^render\d+(?:Pipeline\d+)?$/.test(key)) delete state.canvas.positions[key];
    });
    state.render = state.renders[state.renders.length - 1] || null;
  } else if (item.source === "direction") {
    const direction = (state.plan?.directions || []).find((entry) => entry.id === item.directionId);
    if (direction) direction.image = null;
    if (deletedLatest) {
      state.render = getOutputItems().filter((output) => output.url && output.url !== item.url).at(-1) || null;
    }
  } else if (deletedLatest) {
    state.render = getOutputItems().filter((output) => output.url && output.url !== item.url).at(-1) || null;
  }
  if (state.canvas.selectedImage?.url === item.url) state.canvas.selectedImage = null;
  if (state.canvas.branchAnchorNodeId === item.nodeId || state.canvas.branchAnchorOutputId === item.id) {
    clearCanvasBranchAnchor();
  }
  renderGeneratedResult();
  renderWorkflowCanvas();
  renderWorkspaceHistoryPanel();
  renderAssetLibraryPage();
  scheduleCanvasStateSave({ delay: 120 });
  toast("已从画布记录中移除");
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function imageCanvasNode({ id, kind, title, url, width = 320, caption = "", contain = false, actions = "", outputId = "", advice = "", planPaper = false, multiAngle = false, panorama = false }) {
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
    planPaper,
    multiAngle,
    panorama,
    actions
  };
}

function latestPlanPipelineRender() {
  return [...state.renders].reverse().find((render) => render?.pipeline?.enabled && renderPipelineSteps(render).length) || null;
}

function planPipelineChainHtml() {
  const render = latestPlanPipelineRender();
  if (!render) {
    return `
      <div class="plan-chain-strip">
        <span>1 平面图</span>
        <span>2 彩色平面图</span>
        <span>3 高精度轴测图</span>
        <span>4 区域效果图</span>
      </div>
    `;
  }
  const steps = renderPipelineSteps(render);
  return `
    <div class="plan-chain-strip">
      ${steps.map((step, index) => `
        <span class="${step.status === "done" || step.status === "input" ? "is-done" : ""}">
          ${index + 1} ${escapeHtml(step.title || `链路 ${index + 1}`)}
        </span>
      `).join("")}
    </div>
    ${render.pipeline?.strategy ? `<p class="plan-chain-note">${escapeHtml(render.pipeline.strategy)}</p>` : ""}
  `;
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
  const normalizedMode = normalizeClientMode(state.mode);

  const hasCanvasContent = Boolean(
    visiblePrimary ||
    hasCustomGenerationInput() ||
    isPlanWorkflowMode(state.mode) ||
    normalizedMode === "designseries" ||
    state.referenceImages.length ||
    state.assets.length ||
    visibleSelection ||
    state.render ||
    state.renders.length ||
    state.cadResults.length ||
    state.whiteModelResults.length ||
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
    const normalizedMode = normalizeClientMode(state.mode);
    const planPaperStageMode = isPlanPaperMode(normalizedMode);
    const multiAngleStageMode = isPlanMultiAngleMode(normalizedMode);
    const inputAnalysis = state.primaryImageAnalysis || state.primaryImage.inputAnalysis;
    const advice = inputWorkflowAdvice(inputAnalysis);
    const recommendedMode = advice?.mode || inputAnalysis?.suggestedMode || "";
    const canSwitchToRecommended = recommendedMode && normalizeClientMode(recommendedMode) !== normalizedMode;
    const imageModelingAction = normalizedMode === "image-modeling"
      ? uiIconButton({ className: "secondary-button", icon: "icon-vector", label: primaryActionLabel(state.mode), attrs: `data-render-trigger="true"` })
      : "";
    nodes.push(imageCanvasNode({
      id: "source",
      kind: "Input",
      title: sourceTitle,
      width: planPaperStageMode ? planPaperFrameNodeWidth() : 320,
      url: state.primaryImage.dataUrl,
      contain: true,
      caption: [
        state.primaryImage.name || sourceTitle,
        inputAnalysis ? `识别：${inputAnalysis.label}` : "",
        advice ? `建议：${advice.label}` : ""
      ].filter(Boolean).join(" · "),
      advice: advice?.text || "",
      planPaper: planPaperStageMode,
      multiAngle: multiAngleStageMode,
      actions: `
          ${uiIconButton({ className: "text-button", icon: "icon-trash", label: "删除原图", attrs: `data-remove-primary-image="true"` })}
          ${advice ? `
          ${canSwitchToRecommended ? uiIconButton({ icon: "icon-refresh", label: "使用推荐模式", attrs: `data-switch-suggested-mode="${escapeAttr(advice.mode)}"` }) : ""}
          ${imageModelingAction || uiIconButton({ className: "secondary-button", icon: "icon-spark", label: primaryActionLabel(state.mode), attrs: `data-render-trigger="true"` })}
          ` : ""}
          ${!advice && imageModelingAction ? imageModelingAction : ""}
        `
    }));
  }

  if (visibleSelection) {
    const selectionTitle = normalizeClientMode(state.mode) === "image-modeling" ? "线稿框选" : "局部框选";
    const selectionDescription = normalizeClientMode(state.mode) === "image-modeling"
      ? "已添加辅助框选。图片转 CAD 仍会读取整张图，框选只用于提示重点区域。"
      : "已框选局部区域，生成时会优先输出该区域的特写效果。";
    nodes.push({
      id: "selection",
      kind: "Region",
      title: selectionTitle,
      width: 320,
      html: `
        <p>${escapeHtml(selectionDescription)}</p>
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

  const hasPlanWorkflow = isPlanWorkflowMode(state.mode) || state.renders.some((render) => isPlanWorkflowMode(render?.stepMode || render?.mode));
  if (hasPlanWorkflow) {
    const completedModes = new Set(state.renders.map((render) => normalizeClientMode(render?.stepMode || render?.mode)));
    nodes.push({
      id: "planWorkflow",
      kind: "Workflow",
      title: "平面工作流链路",
      width: 360,
      html: `
        <div class="workflow-step-list">
          ${planPipelineChainHtml()}
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

  const commandGenerateRequirement = generationInputRequirement(normalizedMode);
  const commandGenerateLabel = commandGenerateRequirement.ready
    ? (state.thinkingModeEnabled ? "思考并生成" : "直接生成")
    : commandGenerateRequirement.message;
  const generateAttrs = `data-canvas-generate="true" ${generationDisabledAttrs(normalizedMode)}`;
  const commandNodeActions = normalizedMode === "image-modeling" && state.primaryImage
    ? `${uiIconButton({ icon: "icon-vector", label: primaryActionLabel(state.mode), attrs: `data-canvas-generate="true"` })}`
    : `
        ${uiIconButton({ className: "secondary-button", icon: "icon-spark", label: commandGenerateLabel, attrs: generateAttrs })}
        ${uiIconButton({ icon: "icon-continue", label: "继续编辑最新图", attrs: `data-continue-edit="true" ${state.render ? "" : "disabled"}` })}
      `;
  nodes.push({
    id: "command",
    kind: "Command",
    title: "画布指令",
    width: 360,
    html: `
      <p>${escapeHtml(currentCanvasUserPrompt() || "描述框为空，系统会使用当前能力的后台预设；你也可以补充一句需求。")}</p>
      <div class="node-actions wrap">
        ${commandNodeActions}
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
      <p>${escapeHtml(sanitizeLegacyPlanDisplayText(state.thinking.text))}</p>
      <div class="tag-row">
        <span class="tag">${state.thinking.status === "active" ? (state.thinkingModeEnabled ? "推理中" : "生成中") : state.thinking.status === "done" ? "已完成" : "待命"}</span>
        <span class="tag">${state.thinkingModeEnabled ? "先思考" : "跳过思考"}</span>
        <span class="tag">再调用 ${escapeHtml(generationEngineLabel(state.mode))}</span>
      </div>
      ${state.thinking.target ? `<p>目标：${escapeHtml(normalizedMode === "image-modeling" ? suggestedModeLabel(normalizedMode) : sanitizeLegacyPlanDisplayText(state.thinking.target))}</p>` : ""}
    `
  });

  if (state.renders.length) {
    state.renders.forEach((render, index) => {
      const finalOutputId = render.id || `render-${index}`;
      renderPipelineImageSteps(render).forEach((step, pipelineIndex) => {
        const outputId = step.outputId || `${finalOutputId}-pipeline-${step.id || pipelineIndex}`;
        const outputItem = getOutputItems().find((item) => item.id === outputId) || {
          id: outputId,
          nodeId: `render${index}Pipeline${pipelineIndex}`,
          mode: render.mode || state.mode,
          stepMode: step.stepMode || "plan-color",
          workflowId: render.workflowId || "",
          inputImageType: render.inputImageType || "",
          title: step.title || `链路中间图 ${pipelineIndex + 1}`,
          url: step.url,
          prompt: step.prompt || "",
          sourcePrompt: step.sourcePrompt || "",
          intent: render.pipeline?.strategy || step.description || ""
        };
        nodes.push(imageCanvasNode({
          id: `render${index}Pipeline${pipelineIndex}`,
          outputId,
          kind: "Pipeline Step",
          title: step.title || `链路中间图 ${pipelineIndex + 1}`,
          width: 410,
          url: step.url,
          contain: true,
          caption: `${outputMetaLine(outputItem)}${render.pipeline?.strategy ? ` · ${render.pipeline.strategy}` : ""}`,
          panorama: isPanoramaOutput(outputItem),
          actions: outputNodeActions(outputId, step.url, outputItem)
        }));
      });
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
        panorama: isPanoramaOutput(outputItem),
        actions: outputNodeActions(outputId, render.url, outputItem)
      }));
    });
  } else {
    const normalizedMode = normalizeClientMode(state.mode);
    const actionLabel = primaryActionLabel(state.mode);
    const resultTitle = modeConfig(state.mode).resultTitle || "结果";
    const imageModelingReady = normalizedMode !== "image-modeling" || Boolean(state.primaryImage);
    const inputRequirement = generationInputRequirement(normalizedMode);
    nodes.push({
      id: "render",
      kind: "Output",
      title: outputSlotTitle(state.mode),
      width: 420,
      html: state.mode === "cad"
        ? `<p>点击生成按钮，系统会提取平面图线段并生成 DXF / SVG。</p>
           <div class="node-actions">${uiIconButton({ className: "secondary-button", icon: "icon-spark", label: "生成 CAD", attrs: `data-render-trigger="true"` })}</div>`
        : state.mode === "design-derivation"
          ? `<p>点击推导后，gpt-5.5 会先拆解设计元素，再整理为可继续出图的方案方向。</p>
             <div class="node-actions">${uiIconButton({ className: "secondary-button", icon: "icon-think", label: "推导方案", attrs: `data-render-trigger="true"` })}</div>`
        : normalizedMode === "image-modeling" && !imageModelingReady
          ? `<p>请先上传要转成 CAD 的图片。当前版本会生成 DXF / SVG 线稿，暂不做 3D 建模。</p>
             <div class="node-actions">${uiIconButton({ className: "secondary-button", icon: "icon-upload", label: "等待图片", attrs: "disabled" })}</div>`
          : !inputRequirement.ready
            ? `<p>${escapeHtml(inputRequirement.message)}。上传后这里会显示可生成的结果位。</p>
               <div class="node-actions">${uiIconButton({ className: "secondary-button", icon: "icon-upload", label: inputRequirement.message, attrs: "disabled" })}</div>`
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
      url: cad.previewSvgUrl || cad.svgUrl,
      contain: true,
      caption: `${cad.createdAt || ""} · ${cad.lineCount} 条线段 · SVG / DXF · 下载管理`
    }));
  });

  state.whiteModelResults.forEach((model, index) => {
    const displayModel = normalizeWhiteModelForPreview(model) || model;
    const modelId = String(displayModel.id || `white-model-${index}`);
    nodes.push({
      id: `whiteModel${index}`,
      kind: index === state.whiteModelResults.length - 1 ? "Latest 3D View" : "3D View",
      title: displayModel.title || `图片建模 ${index + 1}`,
      width: 470,
      whiteModel: true,
      modelId,
      caption: `${displayModel.createdAt || ""} · ${displayModel.objectCount || displayModel.objects?.length || 0} 个对象 · GLB / SCAD / ForgeCAD / STEP`,
      completenessHtml: whiteModelCompletenessHtml(displayModel),
      summary: displayModel.summary || "",
      actions: `
        ${uiIconButton({ className: "secondary-button", icon: "icon-refresh", label: "重置视角", attrs: `data-white-model-reset="${escapeAttr(modelId)}"` })}
      `
    });
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
          panorama: isPanoramaOutput({
            mode: direction.image?.mode || "",
            stepMode: direction.image?.stepMode || direction.image?.mode || ""
          }),
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
  if (node.whiteModel) {
    return `
      <article class="workflow-node white-model-node ${node.selected ? "selected" : ""}" data-node-id="${escapeAttr(node.id)}" style="left:${pos.x}px; top:${pos.y}px; width:${width}px;">
        <div class="node-head" data-node-drag-handle="true">
          <strong>${escapeHtml(node.title)}</strong>
          <span class="node-kind">${escapeHtml(node.kind)}</span>
        </div>
        <div class="node-body">
          <div class="white-model-viewer" data-white-model-viewer="${escapeAttr(node.modelId)}" data-hint="${escapeAttr(node.kind.includes("3D View") ? "点击对象选择 / 拖拽旋转 / 滚轮缩放" : "点击对象选择 / 拖拽旋转 / 滚轮缩放")}"></div>
          <div class="white-model-editor" data-white-model-editor="${escapeAttr(node.modelId)}"></div>
          ${node.caption ? `<p class="white-model-caption">${escapeHtml(node.caption)}</p>` : ""}
          ${node.completenessHtml || ""}
          ${node.summary ? `<p>${escapeHtml(node.summary)}</p>` : ""}
          <div class="node-actions wrap">${node.actions || ""}</div>
        </div>
      </article>
    `;
  }
  if (node.directImage) {
    const isPlanPaperStage = Boolean(node.planPaper);
    const isMultiAngleStage = Boolean(node.multiAngle);
    const isPanoramaStage = Boolean(node.panorama);
    const hasViewControl = isPlanPaperStage || isMultiAngleStage;
    const viewControlOpen = hasViewControl && Boolean(state.viewControlOpen);
    const activePlanPaperStage = isPlanPaperStage && viewControlOpen;
    const activeMultiAngleStage = isMultiAngleStage && viewControlOpen;
    const activeNodeMultiAnglePanel = state.multiAnglePanel.open
      && state.multiAnglePanel.selectedImage?.id === node.id
      && !isPlanWorkflowMode(state.mode)
      && !isPlanWorkflowMode(findOutputItem(node.outputId)?.stepMode || findOutputItem(node.outputId)?.mode);
    const paperView = normalizedPlanPaperViewState();
    const planPaperAttrs = activePlanPaperStage
      ? `data-plan-paper-stage tabindex="0" style="${planPaperStyleAttr(paperView)}"`
      : "";
    const viewControlButton = hasViewControl
      ? uiIconButton({
          className: `secondary-button view-control-toggle ${viewControlOpen ? "active" : ""}`,
          icon: isPlanPaperStage ? "icon-cube" : "icon-focus",
          label: viewControlOpen ? "收起视角控制" : "打开视角控制",
          attrs: `data-view-control-toggle="true" aria-pressed="${viewControlOpen ? "true" : "false"}"`
        })
      : "";
    if (isPanoramaStage) {
      return `
      <figure class="workflow-node canvas-image-object panorama-node ${node.selected ? "selected" : ""}" data-node-id="${escapeAttr(node.id)}" style="left:${pos.x}px; top:${pos.y}px; width:${width}px;">
        <div class="canvas-image-stage panorama-stage ${node.contain ? "contain" : ""}" data-preview-url="${escapeAttr(node.imageUrl)}" data-preview-title="${escapeAttr(node.title)}" data-preview-caption="${escapeAttr(node.caption || node.kind)}" data-output-id="${escapeAttr(node.outputId || "")}" title="双击全景预览；拖拽查看全景；右键加入创作面板">
          <div class="panorama-viewer" data-panorama-viewer="${escapeAttr(node.outputId || node.id)}" data-panorama-url="${escapeAttr(node.imageUrl)}" data-hint="${escapeAttr(PANORAMA_CANVAS_HINT)}"></div>
        </div>
        <figcaption class="canvas-image-meta" data-node-drag-handle="true">
          <div>
            <strong>${escapeHtml(node.title)}</strong>
            <span>${escapeHtml(node.kind)}</span>
          </div>
          ${canvasNodeImageToolsHtml(node)}
          ${node.actions ? `<div class="node-actions wrap">${node.actions}</div>` : ""}
          ${node.caption ? `<p>${escapeHtml(node.caption)}</p>` : ""}
          ${node.advice ? `<p class="canvas-image-advice">${escapeHtml(node.advice)}</p>` : ""}
        </figcaption>
      </figure>
    `;
    }
    return `
      <figure class="workflow-node canvas-image-object ${node.selected ? "selected" : ""}" data-node-id="${escapeAttr(node.id)}" style="left:${pos.x}px; top:${pos.y}px; width:${width}px;">
        <div class="canvas-image-stage ${node.contain ? "contain" : ""} ${activePlanPaperStage ? "plan-paper-stage plan-paper-image-stage" : ""}" data-node-drag-handle="true" data-preview-url="${escapeAttr(node.imageUrl)}" data-preview-title="${escapeAttr(node.title)}" data-preview-caption="${escapeAttr(node.caption || node.kind)}" data-output-id="${escapeAttr(node.outputId || "")}" ${planPaperAttrs} title="${activePlanPaperStage ? `双击预览；拖拽平面纸张调整${planPaperWorkflowOutputLabel(state.mode)}视角` : "双击全屏预览；单击打开底部工具；按住 Option/Alt 拖到创作面板可设为底图或参考图"}">
          ${activePlanPaperStage ? `
            <div class="plan-paper-grid" aria-hidden="true"></div>
            <div class="plan-paper-camera-plane" aria-hidden="true">
              <div class="plan-paper-shadow"></div>
              <img class="plan-paper-sheet" src="${escapeAttr(node.imageUrl)}" alt="" />
            </div>
            ${planPaperPanControlsHtml()}
          ` : ""}
          ${activePlanPaperStage ? "" : `<img src="${escapeAttr(node.imageUrl)}" alt="${escapeAttr(node.title)}" />`}
          <span class="canvas-image-zoom-hint" aria-hidden="true">${activePlanPaperStage ? `双击预览 / 拖拽${planPaperWorkflowOutputLabel(state.mode)}角度` : "双击预览 / Option拖到面板"}</span>
        </div>
        <figcaption class="canvas-image-meta" data-node-drag-handle="true">
          <div>
            <strong>${escapeHtml(node.title)}</strong>
            <span>${escapeHtml(node.kind)}</span>
          </div>
          ${activePlanPaperStage ? planPaperInlineControlHtml() : ""}
          ${activeMultiAngleStage ? multiAngleControlHtml() : ""}
          ${canvasNodeImageToolsHtml(node)}
          ${activeNodeMultiAnglePanel ? multiAngleControlHtml({
            title: "多角度",
            actions: "modal",
            image: state.multiAnglePanel.sourceImage,
            className: "canvas-node-multi-angle-panel"
          }) : ""}
          ${(viewControlButton || node.actions) && !node.outputId ? `<div class="node-actions wrap view-control-action-row">${viewControlButton}${node.actions || ""}</div>` : ""}
          ${node.caption ? `<p>${escapeHtml(node.caption)}</p>` : ""}
          ${node.advice ? `<p class="canvas-image-advice">${escapeHtml(node.advice)}</p>` : ""}
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

const imagePreviewState = {
  items: [],
  activeUrl: "",
  zoom: 1
};

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
        <div class="image-preview-toolbar" aria-label="预览操作">
          <span data-preview-zoom>100%</span>
          <button class="icon-button icon-only" type="button" data-preview-reset title="适应窗口" aria-label="适应窗口">
            <svg><use href="#icon-focus"></use></svg>
          </button>
          <a class="icon-button icon-only" href="#" data-preview-original target="_blank" rel="noreferrer" title="打开原图" aria-label="打开原图">
            <svg><use href="#icon-export"></use></svg>
          </a>
        </div>
        <button class="icon-button icon-only" type="button" data-preview-close title="关闭" aria-label="关闭">
          <svg><use href="#icon-close"></use></svg>
        </button>
      </div>
      <div class="image-preview-body">
        <div class="image-preview-stage" data-preview-stage>
          <img alt="放大预览" data-preview-image />
        </div>
        <aside class="image-preview-strip" data-preview-strip aria-label="生成图片列表"></aside>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-preview-close]")) closeImagePreview();
  });
  overlay.querySelector("[data-preview-stage]")?.addEventListener("wheel", handleImagePreviewWheel, { passive: false });
  overlay.querySelector("[data-preview-stage]")?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openImagePreviewOriginal();
  });
  overlay.querySelector("[data-preview-image]")?.addEventListener("load", () => {
    imagePreviewState.zoom = 1;
    updateImagePreviewZoom();
  });
  overlay.querySelector("[data-preview-reset]")?.addEventListener("click", (event) => {
    event.preventDefault();
    imagePreviewState.zoom = 1;
    updateImagePreviewZoom();
  });
  return overlay;
}

function normalizePreviewItems(items, active) {
  const records = uniquePreviewRecords((Array.isArray(items) ? items : []).filter(Boolean));
  if (!active?.url) return records;
  if (records.some((record) => record.url === active.url)) return records;
  return uniquePreviewRecords([active, ...records]);
}

function setImagePreviewRecord(record) {
  if (!record?.url) return;
  const overlay = ensureImagePreviewOverlay();
  const image = overlay.querySelector("[data-preview-image]");
  const original = overlay.querySelector("[data-preview-original]");
  imagePreviewState.activeUrl = record.url;
  imagePreviewState.zoom = 1;
  image.src = record.url;
  overlay.querySelector("[data-preview-title]").textContent = record.title || "图片预览";
  overlay.querySelector("[data-preview-caption]").textContent = record.caption || "滚轮缩放查看细节，双击打开原图";
  if (original) original.href = record.url;
  renderImagePreviewStrip();
  updateImagePreviewZoom();
}

function renderImagePreviewStrip() {
  const overlay = document.getElementById("imagePreviewOverlay");
  const strip = overlay?.querySelector("[data-preview-strip]");
  if (!strip) return;
  const items = imagePreviewState.items;
  strip.hidden = items.length <= 1;
  strip.innerHTML = items.length > 1
    ? `
      <div class="image-preview-strip-head">
        <strong>生成图片</strong>
        <span>${items.length} 张</span>
      </div>
      <div class="image-preview-thumbs">
        ${items.map((item) => `
          <button class="image-preview-thumb ${item.url === imagePreviewState.activeUrl ? "active" : ""}" type="button" data-preview-select="${escapeAttr(item.url)}" title="${escapeAttr(item.title || "生成图片")}" aria-label="查看 ${escapeAttr(item.title || "生成图片")}" aria-pressed="${item.url === imagePreviewState.activeUrl ? "true" : "false"}">
            <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.title || "生成图片")}" data-cache-thumbnail="true" />
            <span>${escapeHtml(item.title || "生成图片")}</span>
          </button>
        `).join("")}
      </div>
    `
    : "";
  hydrateCachedThumbnails(strip);
  strip.querySelectorAll("[data-preview-select]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const record = imagePreviewState.items.find((item) => item.url === button.dataset.previewSelect);
      setImagePreviewRecord(record);
    });
  });
}

function openImagePreview({ url, title = "", caption = "", items = null, source = "all" }) {
  if (!url) return;
  closePanoramaPreview();
  const overlay = ensureImagePreviewOverlay();
  const active = { id: `active-${url}`, source, url, title: title || "图片预览", caption };
  imagePreviewState.items = normalizePreviewItems(items || getPreviewRecords(source), active);
  setImagePreviewRecord(active);
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  requestAnimationFrame(updateImagePreviewZoom);
  focusOverlayControl(overlay, "[data-preview-close]");
}

function closeImagePreview() {
  const overlay = document.getElementById("imagePreviewOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  overlay.querySelector("[data-preview-image]").removeAttribute("src");
  overlay.querySelector("[data-preview-stage]")?.classList.remove("is-zoomed");
  overlay.querySelector("[data-preview-strip]").innerHTML = "";
  imagePreviewState.items = [];
  imagePreviewState.activeUrl = "";
  imagePreviewState.zoom = 1;
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function updateImagePreviewZoom() {
  const overlay = document.getElementById("imagePreviewOverlay");
  if (!overlay || overlay.hidden) return;
  const stage = overlay.querySelector("[data-preview-stage]");
  const image = overlay.querySelector("[data-preview-image]");
  const zoomLabel = overlay.querySelector("[data-preview-zoom]");
  if (!stage || !image || !image.naturalWidth || !image.naturalHeight) {
    if (zoomLabel) zoomLabel.textContent = `${Math.round(imagePreviewState.zoom * 100)}%`;
    return;
  }
  const fitWidth = Math.max(1, stage.clientWidth - 24);
  const fitHeight = Math.max(1, stage.clientHeight - 24);
  const fit = Math.min(1, fitWidth / image.naturalWidth, fitHeight / image.naturalHeight);
  image.style.width = `${Math.max(1, Math.round(image.naturalWidth * fit * imagePreviewState.zoom))}px`;
  image.style.height = `${Math.max(1, Math.round(image.naturalHeight * fit * imagePreviewState.zoom))}px`;
  stage.classList.toggle("is-zoomed", imagePreviewState.zoom > 1.01);
  if (zoomLabel) zoomLabel.textContent = `${Math.round(imagePreviewState.zoom * 100)}%`;
}

function handleImagePreviewWheel(event) {
  if (!imagePreviewState.activeUrl) return;
  event.preventDefault();
  event.stopPropagation();
  const stage = event.currentTarget;
  const previousZoom = imagePreviewState.zoom;
  const direction = event.deltaY < 0 ? 1 : -1;
  const nextZoom = clamp(previousZoom * (direction > 0 ? 1.16 : 1 / 1.16), 1, 8);
  if (Math.abs(nextZoom - previousZoom) < 0.001) return;
  const rect = stage.getBoundingClientRect();
  const pointerX = event.clientX - rect.left + stage.scrollLeft;
  const pointerY = event.clientY - rect.top + stage.scrollTop;
  imagePreviewState.zoom = round4(nextZoom);
  updateImagePreviewZoom();
  const scale = nextZoom / previousZoom;
  stage.scrollLeft = pointerX * scale - (event.clientX - rect.left);
  stage.scrollTop = pointerY * scale - (event.clientY - rect.top);
}

function openImagePreviewOriginal() {
  const url = imagePreviewState.activeUrl;
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function ensurePanoramaPreviewOverlay() {
  let overlay = document.getElementById("panoramaPreviewOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "panoramaPreviewOverlay";
  overlay.className = "panorama-preview-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="panorama-preview-dialog" role="dialog" aria-modal="true" aria-label="全景预览">
      <div class="image-preview-head">
        <div>
          <strong data-panorama-title></strong>
          <span data-panorama-caption></span>
        </div>
        <button class="icon-button icon-only" type="button" data-panorama-close title="关闭" aria-label="关闭">
          <svg><use href="#icon-close"></use></svg>
        </button>
      </div>
      <div class="panorama-preview-stage">
        <div class="panorama-viewer" data-panorama-viewer="panoramaPreview" data-panorama-url="" data-hint="${PANORAMA_PREVIEW_HINT}"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-panorama-close]")) closePanoramaPreview();
  });
  return overlay;
}

function openPanoramaPreview({ url, title = "", caption = "" }) {
  if (!url) return;
  closeImagePreview();
  const overlay = ensurePanoramaPreviewOverlay();
  const viewer = overlay.querySelector("[data-panorama-viewer]");
  viewer.dataset.panoramaUrl = url;
  viewer.dataset.hint = PANORAMA_PREVIEW_HINT;
  overlay.querySelector("[data-panorama-title]").textContent = title || "全景预览";
  overlay.querySelector("[data-panorama-caption]").textContent = caption || PANORAMA_PREVIEW_HINT;
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  createPanoramaViewer(viewer, url, { key: panoramaViewerKey("preview", "panoramaPreview"), scope: "preview" });
  focusOverlayControl(overlay, "[data-panorama-close]");
}

function closePanoramaPreview() {
  const overlay = document.getElementById("panoramaPreviewOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  destroyPanoramaViewer(panoramaViewerKey("preview", "panoramaPreview"));
  overlay.hidden = true;
  const viewer = overlay.querySelector("[data-panorama-viewer]");
  viewer?.removeAttribute("data-panorama-url");
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function openCanvasStagePreview(stage) {
  if (!stage?.dataset?.previewUrl) return;
  openCanvasPreviewPayload({
    url: stage.dataset.previewUrl,
    title: stage.dataset.previewTitle || "",
    caption: stage.dataset.previewCaption || "",
    outputId: stage.dataset.outputId || "",
    items: []
  });
}

function openCanvasPreviewPayload(payload = {}) {
  if (!payload.url) return;
  const outputId = payload.outputId || "";
  const outputItem = outputId
    ? (findOutputItem(outputId) || getOutputItems().find((item) => item.url === payload.url))
    : getOutputItems().find((item) => item.url === payload.url);
  if (outputItem && isPanoramaOutput(outputItem)) {
    openPanoramaPreview(payload);
    return;
  }
  openImagePreview(payload);
}

function handleCanvasPreviewClick(nodeId, preview = {}) {
  const payload = {
    id: nodeId,
    url: preview.url || "",
    title: preview.title || "",
    caption: preview.caption || "",
    outputId: preview.outputId || "",
    items: []
  };
  if (!payload.url) return;
  if (canvasPreviewClickTimer && canvasPreviewClickPayload?.id === nodeId) {
    clearTimeout(canvasPreviewClickTimer);
    canvasPreviewClickTimer = 0;
    canvasPreviewClickPayload = null;
    openCanvasPreviewPayload(payload);
    return;
  }
  clearTimeout(canvasPreviewClickTimer);
  canvasPreviewClickPayload = payload;
  canvasPreviewClickTimer = window.setTimeout(() => {
    canvasPreviewClickTimer = 0;
    const next = canvasPreviewClickPayload;
    canvasPreviewClickPayload = null;
    if (!next) return;
    selectCanvasImage(next);
  }, 240);
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
        <canvas data-deep-edit-canvas tabindex="0"></canvas>
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

async function openDeepEdit(selected, { focusTarget = "prompt" } = {}) {
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
  focusOverlayControl(overlay, focusTarget === "canvas" ? "[data-deep-edit-canvas]" : "[data-deep-edit-prompt]");
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

function ensureColorGradeOverlay() {
  let overlay = document.getElementById("colorGradeOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "colorGradeOverlay";
  overlay.className = "color-grade-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="color-grade-dialog" role="dialog" aria-modal="true" aria-label="调色">
      <header class="color-grade-head">
        <div>
          <span>本地调色</span>
          <strong data-color-grade-title>选中图片</strong>
        </div>
        <div class="color-grade-head-actions">
          ${uiIconButton({ className: "text-button", icon: "icon-refresh", label: "重置调色", attrs: `data-color-grade-action="reset"` })}
          <button class="icon-button icon-only" type="button" data-color-grade-action="cancel" title="关闭" aria-label="关闭">
            <svg><use href="#icon-close"></use></svg>
          </button>
        </div>
      </header>
      <div class="color-grade-tabs" role="tablist" aria-label="调色类别">
        ${colorGradeTabs.map((tab) => `
          <button type="button" data-color-grade-tab="${escapeAttr(tab.id)}" title="${escapeAttr(tab.label)}" aria-label="${escapeAttr(tab.label)}">
            <svg><use href="#${tab.icon}"></use></svg>
          </button>
        `).join("")}
      </div>
      <div class="color-grade-stage">
        <canvas data-color-grade-canvas></canvas>
      </div>
      <div class="color-grade-controls" data-color-grade-controls></div>
      <footer class="color-grade-footer">
        <span data-color-grade-status>调整参数后实时预览</span>
        <button class="primary-button" type="button" data-color-grade-action="apply">
          <svg><use href="#icon-spark"></use></svg>
          应用调色
        </button>
      </footer>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) closeColorGradeOverlay();
  });
  overlay.querySelectorAll("[data-color-grade-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.colorGrade.tab = button.dataset.colorGradeTab || "light";
      renderColorGradeOverlay();
      drawColorGradeCanvas();
    });
  });
  overlay.querySelector("[data-color-grade-action='reset']").addEventListener("click", () => {
    state.colorGrade.adjustments = { ...defaultColorGradeAdjustments };
    renderColorGradeOverlay();
    drawColorGradeCanvas();
  });
  overlay.querySelector("[data-color-grade-action='cancel']").addEventListener("click", closeColorGradeOverlay);
  overlay.querySelector("[data-color-grade-action='apply']").addEventListener("click", () => {
    submitColorGrade().catch((error) => toast(error.message));
  });
  return overlay;
}

async function openPrimaryImageColorGrade() {
  if (!state.primaryImage?.dataUrl) {
    toast(modeConfig(state.mode).missing);
    return;
  }
  await openColorGrade({
    id: "source",
    url: state.primaryImage.dataUrl,
    title: state.primaryImage.name || "调色原图",
    caption: "Primary"
  });
}

async function openColorGrade(selected) {
  if (!selected?.url) return;
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url) || null;
  state.colorGrade = {
    ...state.colorGrade,
    open: true,
    tab: "light",
    selectedImage: selected,
    outputItem,
    image: null,
    adjustments: { ...defaultColorGradeAdjustments },
    previewBusy: false,
    busy: false
  };
  const overlay = ensureColorGradeOverlay();
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  renderColorGradeOverlay();
  focusOverlayControl(overlay, "[data-color-grade-action='apply']");
  try {
    state.colorGrade.image = await loadImage(selected.url);
    drawColorGradeCanvas();
  } catch {
    closeColorGradeOverlay();
    toast("无法载入这张图片进行调色");
  }
}

function closeColorGradeOverlay() {
  const overlay = document.getElementById("colorGradeOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  state.colorGrade.open = false;
  state.colorGrade.image = null;
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function renderColorGradeOverlay() {
  const overlay = ensureColorGradeOverlay();
  const selected = state.colorGrade.selectedImage;
  overlay.querySelector("[data-color-grade-title]").textContent = selected?.title || "选中图片";
  overlay.querySelectorAll("[data-color-grade-tab]").forEach((button) => {
    const active = button.dataset.colorGradeTab === state.colorGrade.tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-pressed", String(active));
  });
  const fields = colorGradeFields[state.colorGrade.tab] || colorGradeFields.light;
  overlay.querySelector("[data-color-grade-controls]").innerHTML = fields.map((name) => {
    const value = Number(state.colorGrade.adjustments[name] || 0);
    return `
      <label class="color-grade-slider">
        <span>${escapeHtml(colorGradeFieldLabels[name] || name)}</span>
        <strong data-color-grade-value="${escapeAttr(name)}">${escapeHtml(String(value))}</strong>
        <input type="range" name="${escapeAttr(`color-grade-${name}`)}" min="-100" max="100" value="${escapeAttr(value)}" data-color-grade-range="${escapeAttr(name)}" aria-label="${escapeAttr(colorGradeFieldLabels[name] || name)}" />
      </label>
    `;
  }).join("");
  overlay.querySelectorAll("[data-color-grade-range]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.colorGradeRange;
      state.colorGrade.adjustments = {
        ...normalizeColorGradeAdjustments(state.colorGrade.adjustments),
        [key]: Math.round(clamp(Number(input.value) || 0, -100, 100))
      };
      const valueLabel = overlay.querySelector(`[data-color-grade-value="${key}"]`);
      if (valueLabel) valueLabel.textContent = String(state.colorGrade.adjustments[key]);
      drawColorGradeCanvas();
    });
  });
  const apply = overlay.querySelector("[data-color-grade-action='apply']");
  apply.disabled = state.colorGrade.busy || !state.colorGrade.image;
  apply.innerHTML = state.colorGrade.busy
    ? `<span class="icon-busy-dot" aria-hidden="true"></span>处理中`
    : `<svg><use href="#icon-spark"></use></svg>应用调色`;
  overlay.querySelector("[data-color-grade-status]").textContent = state.colorGrade.busy
    ? "正在输出调色结果"
    : "本地算法实时预览，不消耗模型生成";
}

function drawColorGradeCanvas() {
  const overlay = ensureColorGradeOverlay();
  const canvas = overlay.querySelector("[data-color-grade-canvas]");
  const image = state.colorGrade.image;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(360, Math.round(rect.width * dpr));
  const height = Math.max(260, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10100f";
  ctx.fillRect(0, 0, width, height);
  if (!image) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const dx = Math.round((width - drawWidth) / 2);
  const dy = Math.round((height - drawHeight) / 2);
  const preview = document.createElement("canvas");
  preview.width = drawWidth;
  preview.height = drawHeight;
  const previewCtx = preview.getContext("2d", { willReadFrequently: true });
  previewCtx.imageSmoothingEnabled = true;
  previewCtx.imageSmoothingQuality = "high";
  previewCtx.drawImage(image, 0, 0, drawWidth, drawHeight);
  const imageData = previewCtx.getImageData(0, 0, drawWidth, drawHeight);
  applyColorGradeToImageData(imageData, drawWidth, drawHeight, state.colorGrade.adjustments);
  previewCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(preview, dx, dy);
}

async function submitColorGrade() {
  const image = state.colorGrade.image;
  const selected = state.colorGrade.selectedImage;
  if (!image || !selected?.url) return;
  state.colorGrade.busy = true;
  renderColorGradeOverlay();
  const startedAt = new Date();
  startActiveTask({
    type: "local-colorgrade",
    label: "调色",
    total: 1,
    userPrompt: colorGradeSummaryText(state.colorGrade.adjustments),
    referenceCount: activeReferenceImages().length
  });
  try {
    const result = localColorGradeImage(image, selected.title || "color-grade", state.colorGrade.adjustments);
    attachDerivedCanvasResultMetadata(result, selected, state.colorGrade.outputItem);
    state.imageToolResults.push(result);
    state.render = result;
    state.renders.push(result);
    state.canvas.selectedImage = {
      id: `render${state.renders.length - 1}`,
      outputId: result.id,
      url: result.url,
      title: result.title,
      kind: "Output",
      caption: result.intent
    };
    state.thinking = {
      status: "done",
      target: "调色",
      text: `已完成本地调色：${colorGradeSummaryText(state.colorGrade.adjustments)}。${featureOptimizationNotes.colorgrade}`
    };
    updateActiveTask({
      success: 1,
      finalPrompt: result.intent,
      outputs: [result],
      event: "本地调色完成"
    });
    logClientTask("local-colorgrade", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: { mode: "colorgrade", adjustments: normalizeColorGradeAdjustments(state.colorGrade.adjustments) },
      result: { title: result.title, mode: result.mode, intent: result.intent }
    });
    renderGeneratedResult();
    closeColorGradeOverlay();
    renderWorkflowCanvas();
    toast("调色完成");
    completeActiveTask("success");
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `调色失败：${error.message}` });
    completeActiveTask("failed");
    throw error;
  } finally {
    state.colorGrade.busy = false;
    renderColorGradeOverlay();
  }
}

function ensureCutoutOverlay() {
  let overlay = document.getElementById("cutoutOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "cutoutOverlay";
  overlay.className = "cutout-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="cutout-dialog" role="dialog" aria-modal="true" aria-label="抠图">
      <header class="cutout-head">
        <div>
          <span>智能抠图</span>
          <strong data-cutout-title>选中图片</strong>
        </div>
        <button class="icon-button icon-only" type="button" data-cutout-action="cancel" title="关闭" aria-label="关闭">
          <svg><use href="#icon-close"></use></svg>
        </button>
      </header>
      <div class="cutout-tools">
        ${uiIconButton({ className: "secondary-button", icon: "icon-refresh", label: "重新识别图层", attrs: `data-cutout-action="reanalyze"` })}
        <span data-cutout-status>正在识别候选图层</span>
      </div>
      <div class="cutout-stage">
        <canvas data-cutout-canvas></canvas>
        <span>移动鼠标预览淡蓝色候选区，单击选中，再次单击或点按钮抠图</span>
      </div>
      <footer class="cutout-footer">
        <span data-cutout-count>0 个候选区域</span>
        <button class="primary-button" type="button" data-cutout-action="apply">
          <svg><use href="#icon-box-select"></use></svg>
          抠出选区
        </button>
      </footer>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) closeCutoutOverlay();
  });
  overlay.querySelector("[data-cutout-action='cancel']").addEventListener("click", closeCutoutOverlay);
  overlay.querySelector("[data-cutout-action='reanalyze']").addEventListener("click", () => {
    analyzeCurrentCutoutImage({ force: true }).catch((error) => toast(error.message));
  });
  overlay.querySelector("[data-cutout-action='apply']").addEventListener("click", () => {
    submitCutout().catch((error) => toast(error.message));
  });
  const canvas = overlay.querySelector("[data-cutout-canvas]");
  canvas.addEventListener("pointermove", updateCutoutHover);
  canvas.addEventListener("pointerleave", () => {
    state.cutout.hoverCandidateId = "";
    drawCutoutCanvas();
  });
  canvas.addEventListener("click", handleCutoutCanvasClick);
  return overlay;
}

async function openPrimaryImageCutout() {
  if (!state.primaryImage?.dataUrl) {
    toast(modeConfig(state.mode).missing);
    return;
  }
  await openCutout({
    id: "source",
    url: state.primaryImage.dataUrl,
    title: state.primaryImage.name || "抠图原图",
    caption: "Primary"
  });
}

async function openCutout(selected) {
  if (!selected?.url) return;
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url) || null;
  state.cutout = {
    ...state.cutout,
    open: true,
    selectedImage: selected,
    outputItem,
    image: null,
    imageBox: null,
    analysis: null,
    aiAnalysis: null,
    analysisMethod: "",
    analysisError: "",
    selectedCandidateId: "",
    hoverCandidateId: "",
    busy: false,
    analyzing: true
  };
  const overlay = ensureCutoutOverlay();
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  renderCutoutOverlay();
  focusOverlayControl(overlay, "[data-cutout-action='apply']");
  try {
    state.cutout.image = await loadImage(selected.url);
    drawCutoutCanvas();
    await analyzeCurrentCutoutImage({ force: true });
  } catch {
    closeCutoutOverlay();
    toast("无法载入这张图片进行抠图");
  }
}

function closeCutoutOverlay() {
  const overlay = document.getElementById("cutoutOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  state.cutout.open = false;
  state.cutout.image = null;
  state.cutout.imageBox = null;
  state.cutout.analysis = null;
  state.cutout.aiAnalysis = null;
  state.cutout.analysisMethod = "";
  state.cutout.analysisError = "";
  state.cutout.selectedCandidateId = "";
  state.cutout.hoverCandidateId = "";
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function renderCutoutOverlay() {
  const overlay = ensureCutoutOverlay();
  const selected = state.cutout.selectedImage;
  const candidates = state.cutout.analysis?.candidates || [];
  const selectedCandidate = selectedCutoutCandidate();
  overlay.querySelector("[data-cutout-title]").textContent = selected?.title || "选中图片";
  const method = state.cutout.analysisMethod || "";
  overlay.querySelector("[data-cutout-status]").textContent = state.cutout.analyzing
    ? "正在调用 AI 视觉识别主体轮廓"
    : selectedCandidate
      ? method === "ai"
        ? "AI 已描绘主体轮廓，单击同一区域或点按钮确认抠图"
        : state.cutout.analysisError
          ? "AI 识别暂不可用，已回退本地候选区域"
          : "已选中候选区域，再次点击同一区域可直接抠图"
      : candidates.length
        ? method === "ai"
          ? "AI 已识别主体轮廓，单击淡蓝区域确认"
          : "点击图中淡蓝候选区域进行选择"
        : state.cutout.analysisError
          ? `AI 识别失败，已回退本地算法：${state.cutout.analysisError}`
          : "未识别到明显主体，可尝试重新识别";
  overlay.querySelector("[data-cutout-count]").textContent = method === "ai"
    ? `AI 主体轮廓 · ${candidates.length} 个候选区域`
    : `${candidates.length} 个候选区域`;
  const apply = overlay.querySelector("[data-cutout-action='apply']");
  apply.disabled = state.cutout.busy || state.cutout.analyzing || !selectedCandidate;
  apply.innerHTML = state.cutout.busy
    ? `<span class="icon-busy-dot" aria-hidden="true"></span>抠图中`
    : `<svg><use href="#icon-box-select"></use></svg>抠出选区`;
}

async function requestAiCutoutAnalysis(selected, image) {
  const primary = await imageSourceToPrimaryImage(selected);
  const sourceDataUrl = await optimizeImageDataUrl(primary.dataUrl, {
    maxEdge: 1400,
    targetBytes: IMAGE_UPLOAD_PRIMARY_TARGET_BYTES,
    cacheLabel: "ai-cutout-analysis"
  });
  const payload = {
    mode: "cutout",
    title: selected?.title || "抠图原图",
    imageWidth: image?.naturalWidth || image?.width || 0,
    imageHeight: image?.naturalHeight || image?.height || 0,
    primaryImage: {
      name: primary.name,
      type: primary.type,
      dataUrl: sourceDataUrl
    }
  };
  const data = await requestJson(clientScopedApiPath("/api/ai-cutout-analysis"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.analysis;
}

async function analyzeCurrentCutoutImage({ force = false } = {}) {
  if (!state.cutout.image) return;
  if (state.cutout.analysis && !force) return;
  state.cutout.analyzing = true;
  state.cutout.analysisError = "";
  renderCutoutOverlay();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const aiAnalysis = await requestAiCutoutAnalysis(state.cutout.selectedImage, state.cutout.image);
    state.cutout.aiAnalysis = aiAnalysis;
    state.cutout.analysis = buildAiGuidedCutoutAnalysis(state.cutout.image, aiAnalysis);
    state.cutout.analysisMethod = "ai";
    state.cutout.selectedCandidateId = state.cutout.analysis.candidates[0]?.id || "";
    state.cutout.hoverCandidateId = "";
  } catch (error) {
    state.cutout.aiAnalysis = null;
    state.cutout.analysis = buildCutoutAnalysis(state.cutout.image);
    state.cutout.analysisMethod = "local";
    state.cutout.analysisError = error.message;
    state.cutout.selectedCandidateId = state.cutout.analysis.candidates[0]?.id || "";
    state.cutout.hoverCandidateId = "";
  }
  state.cutout.analyzing = false;
  renderCutoutOverlay();
  drawCutoutCanvas();
}

function selectedCutoutCandidate() {
  const id = state.cutout.selectedCandidateId;
  return (state.cutout.analysis?.candidates || []).find((candidate) => candidate.id === id) || null;
}

function hoverCutoutCandidate() {
  const id = state.cutout.hoverCandidateId;
  return (state.cutout.analysis?.candidates || []).find((candidate) => candidate.id === id) || null;
}

function drawCutoutCanvas() {
  const overlay = ensureCutoutOverlay();
  const canvas = overlay.querySelector("[data-cutout-canvas]");
  const image = state.cutout.image;
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
  if (!image) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  state.cutout.imageBox = { dx, dy, drawWidth, drawHeight, width, height };
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  const hover = hoverCutoutCandidate();
  const selected = selectedCutoutCandidate();
  if (hover && hover !== selected) drawCutoutMaskOverlay(ctx, hover, state.cutout.analysis, { dx, dy, drawWidth, drawHeight }, "hover");
  if (selected) drawCutoutMaskOverlay(ctx, selected, state.cutout.analysis, { dx, dy, drawWidth, drawHeight }, "selected");
}

function drawCutoutMaskOverlay(ctx, candidate, analysis, box, mode) {
  if (!candidate || !analysis) return;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = analysis.width;
  maskCanvas.height = analysis.height;
  const maskCtx = maskCanvas.getContext("2d");
  const maskData = maskCtx.createImageData(analysis.width, analysis.height);
  const selected = mode === "selected";
  for (let i = 0; i < candidate.mask.length; i++) {
    if (!candidate.mask[i]) continue;
    const idx = i * 4;
    maskData.data[idx] = selected ? 150 : 235;
    maskData.data[idx + 1] = selected ? 210 : 245;
    maskData.data[idx + 2] = 255;
    maskData.data[idx + 3] = selected ? 108 : 76;
  }
  maskCtx.putImageData(maskData, 0, 0);
  ctx.drawImage(maskCanvas, box.dx, box.dy, box.drawWidth, box.drawHeight);
  const sx = box.drawWidth / analysis.width;
  const sy = box.drawHeight / analysis.height;
  ctx.strokeStyle = selected ? "rgba(169, 222, 255, 0.92)" : "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
  ctx.strokeRect(
    box.dx + candidate.bounds.x * sx,
    box.dy + candidate.bounds.y * sy,
    candidate.bounds.width * sx,
    candidate.bounds.height * sy
  );
}

function cutoutCanvasPoint(event) {
  const box = state.cutout.imageBox;
  if (!box || !state.cutout.analysis) return null;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = (event.clientX - rect.left) * dpr;
  const py = (event.clientY - rect.top) * dpr;
  if (px < box.dx || py < box.dy || px > box.dx + box.drawWidth || py > box.dy + box.drawHeight) return null;
  const x = clamp(Math.floor(((px - box.dx) / box.drawWidth) * state.cutout.analysis.width), 0, state.cutout.analysis.width - 1);
  const y = clamp(Math.floor(((py - box.dy) / box.drawHeight) * state.cutout.analysis.height), 0, state.cutout.analysis.height - 1);
  return { x, y };
}

function cutoutCandidateAtPoint(point) {
  if (!point || !state.cutout.analysis) return null;
  const index = point.y * state.cutout.analysis.width + point.x;
  return state.cutout.analysis.candidates
    .filter((candidate) => candidate.mask[index])
    .sort((a, b) => a.area - b.area)[0] || null;
}

function updateCutoutHover(event) {
  if (state.cutout.busy || state.cutout.analyzing) return;
  const candidate = cutoutCandidateAtPoint(cutoutCanvasPoint(event));
  const nextId = candidate?.id || "";
  if (nextId === state.cutout.hoverCandidateId) return;
  state.cutout.hoverCandidateId = nextId;
  drawCutoutCanvas();
}

function handleCutoutCanvasClick(event) {
  if (state.cutout.busy || state.cutout.analyzing) return;
  const candidate = cutoutCandidateAtPoint(cutoutCanvasPoint(event));
  if (!candidate) {
    toast("这里没有识别到独立候选区域，请换主体位置点击");
    return;
  }
  if (state.cutout.selectedCandidateId === candidate.id) {
    submitCutout().catch((error) => toast(error.message));
    return;
  }
  state.cutout.selectedCandidateId = candidate.id;
  renderCutoutOverlay();
  drawCutoutCanvas();
}

async function submitCutout() {
  const image = state.cutout.image;
  const selected = state.cutout.selectedImage;
  const candidate = selectedCutoutCandidate();
  if (!image || !selected?.url || !candidate || !state.cutout.analysis) {
    toast("请先选择要抠出的淡蓝区域");
    return;
  }
  state.cutout.busy = true;
  renderCutoutOverlay();
  const startedAt = new Date();
  const usedAiVision = state.cutout.analysisMethod === "ai";
  startActiveTask({
    type: usedAiVision ? "ai-cutout" : "local-cutout",
    label: "抠图",
    total: 1,
    userPrompt: usedAiVision ? "AI 视觉主体轮廓抠图" : "智能候选图层抠图",
    referenceCount: activeReferenceImages().length
  });
  try {
    const result = localCutoutImage(image, selected.title || "cutout", candidate, state.cutout.analysis);
    attachDerivedCanvasResultMetadata(result, selected, state.cutout.outputItem);
    state.imageToolResults.push(result);
    state.render = result;
    state.renders.push(result);
    state.canvas.selectedImage = {
      id: `render${state.renders.length - 1}`,
      outputId: result.id,
      url: result.url,
      title: result.title,
      kind: "Output",
      caption: result.intent
    };
    state.thinking = {
      status: "done",
      target: "抠图",
      text: `已完成${usedAiVision ? "AI 视觉识别" : "本地"}抠图：识别并抠出 ${Math.round(candidate.area / Math.max(1, state.cutout.analysis.width * state.cutout.analysis.height) * 100)}% 的主体区域。${featureOptimizationNotes.cutout}`
    };
    updateActiveTask({
      success: 1,
      finalPrompt: result.intent,
      outputs: [result],
      event: usedAiVision ? "AI 视觉抠图完成" : "本地抠图完成"
    });
    logClientTask(usedAiVision ? "ai-cutout" : "local-cutout", {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input: { mode: "cutout", candidateId: candidate.id, analysisMethod: state.cutout.analysisMethod },
      result: { title: result.title, mode: result.mode, intent: result.intent }
    });
    renderGeneratedResult();
    closeCutoutOverlay();
    renderWorkflowCanvas();
    toast("抠图完成");
    completeActiveTask("success");
  } catch (error) {
    updateActiveTask({ status: "failed", failed: 1, error: error.message, event: `抠图失败：${error.message}` });
    completeActiveTask("failed");
    throw error;
  } finally {
    state.cutout.busy = false;
    renderCutoutOverlay();
  }
}

function cropAspectLabel(aspect = "source") {
  const option = cropAspectOptions.find((item) => item.value === aspect);
  return option?.label || "原图";
}

function cropAspectRatio(aspect = "source", image = null) {
  if (aspect === "source") {
    const width = Number(image?.naturalWidth || image?.width || 1);
    const height = Number(image?.naturalHeight || image?.height || 1);
    return width / Math.max(1, height);
  }
  const match = String(aspect || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width / Math.max(0.001, height);
}

function cropBoxCenter(box = {}) {
  return {
    x: Number(box.x || 0) + Number(box.width || 0) / 2,
    y: Number(box.y || 0) + Number(box.height || 0) / 2
  };
}

function cropBoxFromAspect(image, aspect = "source", center = null, coverage = 0.92) {
  const imgW = Math.max(1, Number(image?.naturalWidth || image?.width || 1));
  const imgH = Math.max(1, Number(image?.naturalHeight || image?.height || 1));
  if (aspect === "source") {
    return { x: 0, y: 0, width: imgW, height: imgH };
  }
  const ratio = cropAspectRatio(aspect, image);
  if (!ratio || !Number.isFinite(ratio)) {
    return { x: 0, y: 0, width: imgW, height: imgH };
  }
  let width = imgW * clamp(coverage, 0.08, 1);
  let height = width / ratio;
  if (height > imgH * coverage) {
    height = imgH * clamp(coverage, 0.08, 1);
    width = height * ratio;
  }
  width = clamp(width, 1, imgW);
  height = clamp(height, 1, imgH);
  const focus = center || { x: imgW / 2, y: imgH / 2 };
  const maxX = Math.max(0, imgW - width);
  const maxY = Math.max(0, imgH - height);
  const x = clamp(focus.x - width / 2, 0, maxX);
  const y = clamp(focus.y - height / 2, 0, maxY);
  return { x, y, width, height };
}

function clampCropBox(box, image) {
  const imgW = Math.max(1, Number(image?.naturalWidth || image?.width || 1));
  const imgH = Math.max(1, Number(image?.naturalHeight || image?.height || 1));
  const width = clamp(Number(box?.width || 1), 1, imgW);
  const height = clamp(Number(box?.height || 1), 1, imgH);
  const x = clamp(Number(box?.x || 0), 0, Math.max(0, imgW - width));
  const y = clamp(Number(box?.y || 0), 0, Math.max(0, imgH - height));
  return { x, y, width, height };
}

function cropCanvasPoint(event) {
  const box = state.crop.imageBox;
  if (!box || !state.crop.image) return null;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = (event.clientX - rect.left) * dpr;
  const py = (event.clientY - rect.top) * dpr;
  if (px < box.dx || py < box.dy || px > box.dx + box.drawWidth || py > box.dy + box.drawHeight) return null;
  const imgW = Math.max(1, Number(state.crop.image.naturalWidth || state.crop.image.width || 1));
  const imgH = Math.max(1, Number(state.crop.image.naturalHeight || state.crop.image.height || 1));
  return {
    x: clamp(((px - box.dx) / box.drawWidth) * imgW, 0, imgW),
    y: clamp(((py - box.dy) / box.drawHeight) * imgH, 0, imgH)
  };
}

function cropPointInBox(point, box) {
  return Boolean(point && box)
    && point.x >= box.x && point.x <= box.x + box.width
    && point.y >= box.y && point.y <= box.y + box.height;
}

function cropBoxToCanvasRect(box, imageBox, image) {
  const imgW = Math.max(1, Number(image?.naturalWidth || image?.width || 1));
  const imgH = Math.max(1, Number(image?.naturalHeight || image?.height || 1));
  const scaleX = imageBox.drawWidth / imgW;
  const scaleY = imageBox.drawHeight / imgH;
  return {
    x: imageBox.dx + box.x * scaleX,
    y: imageBox.dy + box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY
  };
}

function ensureCropOverlay() {
  let overlay = document.getElementById("cropOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "cropOverlay";
  overlay.className = "crop-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="crop-dialog" role="dialog" aria-modal="true" aria-label="裁切">
      <header class="crop-head">
        <div>
          <span>本地裁切</span>
          <strong data-crop-title>选中图片</strong>
        </div>
        <div class="crop-head-actions">
          ${uiIconButton({ className: "text-button", icon: "icon-refresh", label: "重置裁切框", attrs: `data-crop-action="reset"` })}
          <button class="icon-button icon-only" type="button" data-crop-action="cancel" title="关闭" aria-label="关闭">
            <svg><use href="#icon-close"></use></svg>
          </button>
        </div>
      </header>
      <div class="crop-tools">
        <span data-crop-status>先选比例，再拖动裁切框调整构图</span>
      </div>
      <div class="aspect-grid crop-aspect-grid" role="tablist" aria-label="裁切比例">
        ${cropAspectOptions.map((item) => `
          <button type="button" data-crop-aspect="${escapeAttr(item.value)}" title="${escapeAttr(item.label)}" aria-label="${escapeAttr(item.label)}">${escapeHtml(item.label)}</button>
        `).join("")}
      </div>
      <div class="crop-stage">
        <canvas data-crop-canvas></canvas>
        <span data-crop-hint>拖动裁切框改变位置，点比例按钮切换构图比例</span>
      </div>
      <footer class="crop-footer">
        <span data-crop-summary>比例：原图</span>
        <button class="primary-button" type="button" data-crop-action="apply">
          <svg><use href="#icon-crop"></use></svg>
          裁切图片
        </button>
      </footer>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) closeCropOverlay();
  });
  overlay.querySelectorAll("[data-crop-aspect]").forEach((button) => {
    button.addEventListener("click", () => setCropAspect(button.dataset.cropAspect || "source"));
  });
  overlay.querySelector("[data-crop-action='reset']").addEventListener("click", () => {
    resetCropBox();
  });
  overlay.querySelector("[data-crop-action='cancel']").addEventListener("click", closeCropOverlay);
  overlay.querySelector("[data-crop-action='apply']").addEventListener("click", () => {
    submitCrop().catch((error) => toast(error.message));
  });
  const canvas = overlay.querySelector("[data-crop-canvas]");
  canvas.addEventListener("pointerdown", startCropPointer);
  canvas.addEventListener("pointermove", moveCropPointer);
  canvas.addEventListener("pointerup", endCropPointer);
  canvas.addEventListener("pointercancel", endCropPointer);
  return overlay;
}

async function openCrop(selected) {
  if (!selected?.url) return;
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url) || null;
  state.crop = {
    ...state.crop,
    open: true,
    selectedImage: selected,
    outputItem,
    image: null,
    imageBox: null,
    cropBox: null,
    dragStart: null,
    dragOffset: null,
    busy: false,
    aspect: state.crop.aspect || "source"
  };
  const overlay = ensureCropOverlay();
  rememberOverlayFocus(overlay);
  overlay.hidden = false;
  syncOverlayOpenClass();
  renderCropOverlay();
  focusOverlayControl(overlay, "[data-crop-action='apply']");
  try {
    state.crop.image = await loadImage(selected.url);
    state.crop.cropBox = cropBoxFromAspect(state.crop.image, state.crop.aspect);
    drawCropCanvas();
    renderCropOverlay();
  } catch {
    closeCropOverlay();
    toast("无法载入这张图片进行裁切");
  }
}

function closeCropOverlay() {
  const overlay = document.getElementById("cropOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  state.crop.open = false;
  state.crop.image = null;
  state.crop.imageBox = null;
  state.crop.cropBox = null;
  state.crop.dragStart = null;
  state.crop.dragOffset = null;
  if (wasOpen) restoreOverlayFocus(overlay);
  syncOverlayOpenClass();
}

function setCropAspect(aspect) {
  if (!state.crop.image) return;
  state.crop.aspect = aspect || "source";
  const center = state.crop.cropBox ? cropBoxCenter(state.crop.cropBox) : null;
  state.crop.cropBox = cropBoxFromAspect(state.crop.image, state.crop.aspect, center);
  renderCropOverlay();
  drawCropCanvas();
}

function resetCropBox() {
  if (!state.crop.image) return;
  state.crop.cropBox = cropBoxFromAspect(state.crop.image, state.crop.aspect);
  renderCropOverlay();
  drawCropCanvas();
}

function renderCropOverlay() {
  const overlay = ensureCropOverlay();
  const selected = state.crop.selectedImage;
  const busy = state.crop.busy;
  overlay.querySelector("[data-crop-title]").textContent = selected?.title || "选中图片";
  overlay.querySelectorAll("[data-crop-aspect]").forEach((button) => {
    const active = button.dataset.cropAspect === state.crop.aspect;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-pressed", String(active));
  });
  const summary = overlay.querySelector("[data-crop-summary]");
  summary.textContent = `比例：${cropAspectLabel(state.crop.aspect)}${state.crop.cropBox ? " · 可拖动裁切框" : ""}`;
  const apply = overlay.querySelector("[data-crop-action='apply']");
  apply.disabled = busy || !state.crop.image || !state.crop.cropBox;
  apply.innerHTML = busy
    ? `<span class="icon-busy-dot" aria-hidden="true"></span>裁切中`
    : `<svg><use href="#icon-crop"></use></svg>裁切图片`;
  overlay.querySelector("[data-crop-status]").textContent = busy
    ? "正在输出裁切结果"
    : "选好比例后拖动裁切框，再点击裁切图片";
  overlay.querySelector("[data-crop-hint]").textContent = busy
    ? "处理中，请稍候"
    : "拖动裁切框改变位置，点比例按钮切换构图比例";
}

function drawCropCanvas() {
  const overlay = ensureCropOverlay();
  const canvas = overlay.querySelector("[data-crop-canvas]");
  const image = state.crop.image;
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
  if (!image) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  state.crop.imageBox = { dx, dy, drawWidth, drawHeight, width, height };
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  const box = state.crop.cropBox ? clampCropBox(state.crop.cropBox, image) : cropBoxFromAspect(image, state.crop.aspect);
  state.crop.cropBox = box;
  const rectBox = cropBoxToCanvasRect(box, state.crop.imageBox, image);

  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.fillRect(dx, dy, drawWidth, drawHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rectBox.x, rectBox.y, rectBox.width, rectBox.height);
  ctx.clip();
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  ctx.restore();

  ctx.strokeStyle = "rgba(214, 180, 87, 0.96)";
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(rectBox.x, rectBox.y, rectBox.width, rectBox.height);
  ctx.fillStyle = "rgba(214, 180, 87, 0.14)";
  ctx.fillRect(rectBox.x, rectBox.y, rectBox.width, rectBox.height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(rectBox.x + rectBox.width / 3, rectBox.y);
  ctx.lineTo(rectBox.x + rectBox.width / 3, rectBox.y + rectBox.height);
  ctx.moveTo(rectBox.x + rectBox.width * 2 / 3, rectBox.y);
  ctx.lineTo(rectBox.x + rectBox.width * 2 / 3, rectBox.y + rectBox.height);
  ctx.moveTo(rectBox.x, rectBox.y + rectBox.height / 3);
  ctx.lineTo(rectBox.x + rectBox.width, rectBox.y + rectBox.height / 3);
  ctx.moveTo(rectBox.x, rectBox.y + rectBox.height * 2 / 3);
  ctx.lineTo(rectBox.x + rectBox.width, rectBox.y + rectBox.height * 2 / 3);
  ctx.stroke();

  ctx.fillStyle = "rgba(18, 18, 16, 0.88)";
  ctx.font = `${Math.max(12, 12 * dpr)}px sans-serif`;
  const label = cropAspectLabel(state.crop.aspect);
  const labelWidth = ctx.measureText(label).width + 16 * dpr;
  const labelX = clamp(rectBox.x, 0, width - labelWidth);
  const labelY = clamp(rectBox.y - 26 * dpr, 0, height - 24 * dpr);
  ctx.fillRect(labelX, labelY, labelWidth, 22 * dpr);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, labelX + 8 * dpr, labelY + 16 * dpr);
}

function startCropPointer(event) {
  if (!state.crop.open || !state.crop.imageBox || state.crop.busy) return;
  event.preventDefault();
  event.stopPropagation();
  const point = cropCanvasPoint(event);
  if (!point) return;
  const canvas = event.currentTarget;
  canvas.setPointerCapture(event.pointerId);
  const box = state.crop.cropBox || cropBoxFromAspect(state.crop.image, state.crop.aspect);
  if (!cropPointInBox(point, box)) {
    state.crop.cropBox = cropBoxFromAspect(state.crop.image, state.crop.aspect, point);
  }
  const nextBox = state.crop.cropBox || box;
  state.crop.dragStart = point;
  state.crop.dragOffset = {
    x: point.x - nextBox.x,
    y: point.y - nextBox.y
  };
  drawCropCanvas();
}

function moveCropPointer(event) {
  if (!state.crop.open || state.crop.busy || !state.crop.dragStart || !state.crop.dragOffset) return;
  event.preventDefault();
  event.stopPropagation();
  const point = cropCanvasPoint(event);
  if (!point) return;
  const image = state.crop.image;
  const box = {
    x: point.x - state.crop.dragOffset.x,
    y: point.y - state.crop.dragOffset.y,
    width: state.crop.cropBox?.width || 1,
    height: state.crop.cropBox?.height || 1
  };
  state.crop.cropBox = clampCropBox(box, image);
  drawCropCanvas();
  renderCropOverlay();
}

function endCropPointer(event) {
  if (!state.crop.open) return;
  event.preventDefault();
  event.stopPropagation();
  state.crop.dragStart = null;
  state.crop.dragOffset = null;
  drawCropCanvas();
  renderCropOverlay();
}

async function submitCrop() {
  if (!state.crop.image || !state.crop.cropBox) {
    toast("请先选择裁切比例并拖动裁切框");
    return;
  }
  state.crop.busy = true;
  renderCropOverlay();
  const aspectLabel = cropAspectLabel(state.crop.aspect);
  try {
    await runLocalCanvasImageTool({
      mode: "crop",
      title: "裁切结果",
      toastText: "裁切完成",
      run: (image, name) => localCropImage(image, name, state.crop.cropBox, state.crop.aspect)
    });
    state.thinking = {
      status: "done",
      target: "裁切",
      text: `已完成裁切：${aspectLabel}比例，输出新的构图版本。${featureOptimizationNotes.crop}`
    };
    closeCropOverlay();
    renderWorkflowCanvas();
  } finally {
    state.crop.busy = false;
    renderCropOverlay();
  }
}

function localCropImage(image, name, cropBox, aspect) {
  const maxDim = 2400;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const baseCtx = base.getContext("2d", { willReadFrequently: true });
  baseCtx.imageSmoothingEnabled = true;
  baseCtx.imageSmoothingQuality = "high";
  baseCtx.drawImage(image, 0, 0, width, height);
  const sx = width / Math.max(1, image.naturalWidth);
  const sy = height / Math.max(1, image.naturalHeight);
  const cropX = clamp(Math.floor(cropBox.x * sx), 0, width - 1);
  const cropY = clamp(Math.floor(cropBox.y * sy), 0, height - 1);
  const cropRight = clamp(Math.ceil((cropBox.x + cropBox.width) * sx), cropX + 1, width);
  const cropBottom = clamp(Math.ceil((cropBox.y + cropBox.height) * sy), cropY + 1, height);
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);
  const out = document.createElement("canvas");
  out.width = cropWidth;
  out.height = cropHeight;
  const outCtx = out.getContext("2d", { willReadFrequently: true });
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(base, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return {
    id: `crop-${Date.now()}`,
    title: "裁切结果",
    url: out.toDataURL("image/png"),
    mode: "crop",
    intent: `本地裁切：${cropAspectLabel(aspect)}比例 PNG`,
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    fileBase: slugForFile(name || "crop"),
    aspect: aspect || "source"
  };
}

function ensureCanvasImageToolbar() {
  return document.getElementById("canvasImageToolbar");
}

function renderCanvasImageToolbar() {
  ensureCanvasImageToolbar()?.remove();
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
    const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
    const payload = {
      url: selected.url,
      title: selected.title,
      caption: selected.caption || selected.kind,
      items: []
    };
    if (outputItem && isPanoramaOutput(outputItem)) openPanoramaPreview(payload);
    else openImagePreview(payload);
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
  if (action === "multi-angle") {
    await openMultiAngleOverlay(selected);
    return;
  }
  if (action === "colorgrade") {
    state.canvas.imageActionBusy = "";
    renderCanvasImageToolbar();
    await openColorGrade(selected);
    return;
  }
  if (action === "crop") {
    state.canvas.imageActionBusy = "";
    renderCanvasImageToolbar();
    await openCrop(selected);
    return;
  }
  if (action === "cutout") {
    state.canvas.imageActionBusy = "";
    renderCanvasImageToolbar();
    await openCutout(selected);
    return;
  }
  if (action === "use-mode") {
    await useCanvasImageWithMode(targetMode);
    return;
  }
  if (["favorite", "compare", "promote", "regenerate", "continue", "plan-next", "send-to-panel", "copy-prompt", "lock-layout"].includes(action)) {
    const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
    if (!outputItem) {
      if (action === "send-to-panel") await useCanvasImageWithMode("custom", { detachFromCanvasParent: true });
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

function multiAngleCanvasCommand(selected = {}, outputItem = null, sourceImage = null) {
  const title = selected.title || outputItem?.title || "当前图片";
  return [
    `基于「${title}」生成多角度设计图。`,
    "把这张图作为强参考，保留项目的空间气质、材质家族、灯光氛围、家具语言、色彩关系和渲染品质。",
    "每张图必须变化镜头方向、视距、空间角色或焦点区域，形成同一项目下的多角度/多视角结果；不要只是同一个画面轻微改色或换局部陈列。",
    "如果原图是室内或建筑效果图，优先扩展为入口/主视觉/次级功能区/安静区/过渡或材料节点等连续空间视角。",
    multiAnglePrompt(state.multiAngleView, sourceImage)
  ].join("\n");
}

async function generateMultiAngleFromCanvasImage(selected = {}) {
  const outputItem = findOutputItem(selected.outputId) || getOutputItems().find((item) => item.url === selected.url);
  const image = await imageSourceToPrimaryImage(selected);
  const bitmap = await loadImage(image.dataUrl);
  image.width = bitmap.naturalWidth || bitmap.width || 0;
  image.height = bitmap.naturalHeight || bitmap.height || 0;
  const command = multiAngleCanvasCommand(selected, outputItem, image);
  const reference = {
    ...image,
    id: `multi-angle-ref-${Date.now()}`,
    title: selected.title || outputItem?.title || "多角度参考图",
    weight: "strong",
    usage: "space",
    width: image.width,
    height: image.height,
    sourceOutputId: outputItem?.id || selected.outputId || selected.id || "",
    prompt: command
  };
  const remainingReferences = state.referenceImages
    .filter((item) => item?.dataUrl !== reference.dataUrl && item?.id !== reference.sourceOutputId)
    .slice(0, Math.max(0, referenceImageLimit - 1));
  state.referenceImages = [reference, ...remainingReferences];
  state.designSeriesAnalysis = null;
  state.selection = null;
  setMode("designseries");
  setHiddenPromptContext("quickIntent", command);
  state.generation.count = clampImageCount(state.generation.count || 4, "designseries");
  refreshGenerationControls();
  renderWorkflowCanvas();
  await generateDesignSeries({
    referenceImages: activeReferenceImages(state.referenceImages),
    count: state.generation.count,
    busyButton: els.canvasGenerateButton
  });
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
  const outputItem = outputItemForSelectedImage(selected);
  const result = run(image, primary.name);
  attachDerivedCanvasResultMetadata(result, selected, outputItem);
  result.title = title;
  state.imageToolResults.push(result);
  state.render = result;
  state.renders.push(result);
  state.canvas.selectedImage = {
    id: `render${state.renders.length - 1}`,
    outputId: result.id,
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
  if (/全景|panorama|360|equirectangular/i.test(text)) {
    return imageAnalysisResult({ key: "panorama", label: "全景图", suggestedMode: "panorama", confidence: 0.9 }, {}, "由画布输出记录识别为全景图");
  }
  if (/3D平面|三维平面|轴测|axon|isometric/i.test(text)) {
    return imageAnalysisResult({ key: "axonometric", label: "轴测图", suggestedMode: "plan-render", confidence: 0.9 }, {}, "由画布输出记录识别为轴测图");
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
  if (!analysis || ["custom", "design-derivation", "designseries"].includes(normalizedMode)) return { ok: true };
  if (isInputCompatibleWithMode(analysis, normalizedMode)) return { ok: true };
  if (Number(analysis.confidence || 0) < 0.55) return { ok: true, lowConfidence: true };
  const imageEditModes = ["materialreplace", "lightingadjust", "styletransfer", "colorgrade", "crop", "cutout", "upscale", "detail", "sharpen", "outpaint"];
  const extraCompatibleModes = {
    "line-plan": ["plan-axonometric", "cad", "cadrender", "upscale", "sharpen"],
    "cad-screenshot": ["cad", "cadrender", "plan-axonometric", "upscale", "sharpen"],
    "colored-plan": ["plan-axonometric", "upscale", "detail", "sharpen"],
    axonometric: ["plan-axonometric-view", "plan-render", ...imageEditModes],
    panorama: ["panorama", "photo", "materialboard", ...imageEditModes],
    render: ["photo", "materialboard", ...imageEditModes],
    "generated-output": ["photo", "materialboard", ...imageEditModes],
    "site-photo": ["photo", "materialboard", ...imageEditModes],
    "object-photo": [...imageEditModes],
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
  return `这张图识别为「${analysis?.label || "未知图片"}」，当前能力是「${current}」。它更适合「${suggested}」。已阻止设为底图；可以在功能区切换能力，或拖到“素材参考图”。`;
}

async function setCanvasImageAsPrimaryInput(selectedImage, outputItem = null) {
  const preservedPlanPaperView = isPlanPaperMode(state.mode) && outputItem?.planPaperView
    ? cloneValue(outputItem.planPaperView)
    : null;
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
  setCanvasBranchAnchor(selectedImage, outputItem);
  state.primaryImage = primaryImage;
  state.primaryBitmap = bitmap;
  state.primaryImageAnalysis = analysis;
  resetImageModelingAnalysis();
  state.selection = null;
  resetImageViewStates();
  if (preservedPlanPaperView) {
    state.planPaperView = normalizedPlanPaperViewState(preservedPlanPaperView);
    state.viewControlOpen = true;
  }
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
  setCanvasBranchAnchor(selectedImage, outputItem);
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
  const imageModelingMode = normalizeClientMode(state.mode) === "image-modeling";
  const primaryTargetLabel = imageModelingMode ? "松手：添加为图片转CAD输入" : "松手：添加为底图";
  const label = drag.target === "primary"
    ? primaryTargetLabel
    : drag.target === "reference"
      ? "松手：添加为参考图"
      : imageModelingMode
        ? "拖到图片转CAD输入"
        : "拖到主图或参考图";
  ghost.querySelector("span").textContent = label;
}

function startCanvasPanelDropDrag(event, nodeEl, previewStage) {
  applyCanvasListCollapsed(true);
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
      toast(normalizeClientMode(state.mode) === "image-modeling"
        ? "按住 Option/Alt 拖到“上传要转 CAD 的图片”区域后松手。"
        : "按住 Option/Alt 拖到“上传底图”或“素材参考图”区域后松手。");
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
  els.canvasNodes.querySelectorAll("[data-image-modeling-analyze]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      analyzeImageModelingSubjectFromPhoto(button).catch((error) => toast(error.message));
    });
  });
  els.canvasNodes.querySelectorAll("[data-image-modeling-confirm]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      Promise.resolve(confirmImageModelingSubject()).catch((error) => toast(error.message));
    });
  });
  els.canvasNodes.querySelectorAll("[data-image-modeling-cad-reference]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      generateImageModelingCadReference(button).catch((error) => toast(error.message));
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
  els.canvasNodes.querySelectorAll("[data-view-control-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.viewControlOpen = !state.viewControlOpen;
      renderWorkflowCanvas();
      scheduleCanvasStateSave({ delay: 180 });
    });
  });
  els.canvasNodes.querySelectorAll("[data-plan-paper-stage]").forEach((stage) => {
    stage.addEventListener("pointerdown", startPlanPaperDrag);
    stage.addEventListener("pointermove", updatePlanPaperDrag);
    stage.addEventListener("pointerup", finishPlanPaperDrag);
    stage.addEventListener("pointercancel", finishPlanPaperDrag);
    stage.addEventListener("keydown", adjustPlanPaperByKeyboard);
    stage.addEventListener("wheel", zoomPlanPaperByWheel, { passive: false });
  });
  els.canvasNodes.querySelectorAll("[data-plan-paper-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlePlanPaperAction(button.dataset.planPaperAction, button).catch((error) => toast(error.message));
    });
  });
  els.canvasNodes.querySelectorAll("[data-plan-paper-pan]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      adjustPlanPaperPan(button.dataset.planPaperPan, { large: event.shiftKey });
    });
  });
  els.canvasNodes.querySelectorAll("[data-multi-angle-stage]").forEach((stage) => {
    stage.addEventListener("pointerdown", startMultiAngleDrag);
    stage.addEventListener("pointermove", updateMultiAngleDrag);
    stage.addEventListener("pointerup", finishMultiAngleDrag);
    stage.addEventListener("pointercancel", finishMultiAngleDrag);
    stage.addEventListener("keydown", adjustMultiAngleByKeyboard);
  });
  els.canvasNodes.querySelectorAll("[data-multi-angle-tab]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.multiAngleView = {
        ...normalizedMultiAngleViewState(state.multiAngleView),
        mode: button.dataset.multiAngleTab === "camera" ? "camera" : "subject",
        dragging: null
      };
      renderWorkflowCanvas();
      scheduleCanvasStateSave({ delay: 180 });
    });
  });
  els.canvasNodes.querySelectorAll("[data-multi-angle-range]").forEach((input) => {
    input.addEventListener("input", (event) => {
      event.stopPropagation();
      updateMultiAngleRange(input.dataset.multiAngleRange, input.value);
    });
  });
  els.canvasNodes.querySelectorAll("[data-multi-angle-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleMultiAngleAction(button.dataset.multiAngleAction, button).catch((error) => toast(error.message));
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-download]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadWhiteModelJson(button.dataset.whiteModelDownload);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-glb]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadWhiteModelGlb(button.dataset.whiteModelGlb);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-scad]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadWhiteModelScad(button.dataset.whiteModelScad);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-dxf]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadWhiteModelDxf(button.dataset.whiteModelDxf);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-import-cad]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      importWhiteModelFootprintToCad(button.dataset.whiteModelImportCad);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-forgecad]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      createWhiteModelForgeCad(button.dataset.whiteModelForgecad, "script", button);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-forgecad-studio]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      createWhiteModelForgeCad(button.dataset.whiteModelForgecadStudio, "studio", button);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-cad-export]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportWhiteModelWithTextToCad(button.dataset.whiteModelCadExport, button);
    });
  });
  els.canvasNodes.querySelectorAll("[data-white-model-reset]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetWhiteModelViewer(button.dataset.whiteModelReset);
    });
  });
  els.canvasNodes.querySelectorAll("[data-canvas-image-tool]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeEl = button.closest("[data-node-id]");
      const stage = nodeEl?.querySelector("[data-preview-url]");
      if (!stage?.dataset?.previewUrl) return;
      state.canvas.selectedImage = {
        id: nodeEl?.dataset.nodeId || "",
        url: stage.dataset.previewUrl,
        title: stage.dataset.previewTitle || "",
        caption: stage.dataset.previewCaption || "",
        outputId: stage.dataset.outputId || ""
      };
      state.canvas.imageActionBusy = "";
      button.closest("[data-canvas-node-tool-menu]")?.removeAttribute("open");
      handleCanvasImageTool(button.dataset.canvasImageTool, button.dataset.nextMode, button.dataset.mode)
        .catch((error) => toast(error.message));
    });
  });
  bindOutputActionEvents(els.canvasNodes);
  els.canvasNodes.querySelectorAll("[data-preview-url]").forEach((stage) => {
    stage.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      event.preventDefault();
      event.stopPropagation();
      state.canvas.nodeDrag = null;
      openCanvasStagePreview(stage);
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
        await useCanvasImageWithMode("custom", { detachFromCanvasParent: true });
      }
    });
  });
  els.canvasNodes.querySelectorAll(".workflow-node").forEach((nodeEl) => {
    nodeEl.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, a, input, textarea, select, summary, details")) return;
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
      applyCanvasListCollapsed(true);
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
  els.canvasLinks.setAttribute("viewBox", `0 0 ${CANVAS_WORKSPACE_WIDTH} ${CANVAS_WORKSPACE_HEIGHT}`);
  const visibleIds = new Set(nodes.map((node) => node.id));
  const link = (from, to, kind = "support") => [from, to, kind];
  const renderLinks = state.renders.length
    ? state.renders.flatMap((render, index) => {
        const outputNode = `render${index}`;
        const pipelineNodes = renderPipelineImageSteps(render)
          .map((_, pipelineIndex) => `render${index}Pipeline${pipelineIndex}`)
          .filter((id) => visibleIds.has(id));
        const parent = render.parentNodeId && visibleIds.has(render.parentNodeId) ? render.parentNodeId : "";
        if (pipelineNodes.length) {
          const chainLinks = [
            [parent || "think", pipelineNodes[0], "main"],
            ...pipelineNodes.slice(1).map((nodeId, pipelineIndex) => [pipelineNodes[pipelineIndex], nodeId, "main"]),
            [pipelineNodes[pipelineNodes.length - 1], outputNode, "main"]
          ];
          return chainLinks;
        }
        return [[parent || "think", outputNode, "main"]];
      })
    : [link("think", "render", "main")];
  const cadLinks = state.cadResults.map((_, index) => link("think", `cad${index}`, "main"));
  const whiteModelLinks = state.whiteModelResults.map((_, index) => link("think", `whiteModel${index}`, "main"));
  const assetLinks = state.assets.map((asset) => link(asset.instanceId, "command"));
  const referenceIds = nodes.map((node) => node.id).filter((id) => /^reference\d+$/.test(id));
  const referenceLinks = referenceIds.flatMap((id) => [
    link(id, visibleIds.has("seriesAdvice") ? "seriesAdvice" : "command")
  ]);
  const directionImageLinks = (state.plan?.directions || []).map((_, index) => link(`direction${index}`, `directionImage${index}`, "main"));
  const directionDriver = visibleIds.has("plan") ? "plan" : "think";
  const sourceMainTarget = state.selection
    ? "selection"
    : visibleIds.has("planWorkflow")
      ? "planWorkflow"
      : "command";
  const rawLinks = [
    link("resources", "command"),
    ...assetLinks,
    link("source", sourceMainTarget, "main"),
    link("selection", "command", "main"),
    link("planWorkflow", "command", "main"),
    ...referenceLinks,
    link("seriesAdvice", "command", "main"),
    link("command", "think", "main"),
    ...renderLinks,
    ...cadLinks,
    ...whiteModelLinks,
    link(directionDriver, "direction0"),
    link(directionDriver, "direction1"),
    link(directionDriver, "direction2"),
    ...directionImageLinks
  ];
  const seenLinks = new Set();
  const links = rawLinks.filter(([from, to]) => {
    if (!visibleIds.has(from) || !visibleIds.has(to)) return false;
    const key = `${from}->${to}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });

  const ports = new Map();
  const addPort = (point, kind, side) => {
    const key = `${Math.round(point.x * 10) / 10}:${Math.round(point.y * 10) / 10}:${kind}:${side}`;
    if (!ports.has(key)) ports.set(key, { ...point, kind, side });
  };
  const pathMarkup = links.map(([from, to, kind]) => {
    const linkKind = kind || "support";
    const route = routeCanvasLink(from, to);
    if (linkKind === "main") {
      addPort(route.start, linkKind, "from");
      addPort(route.end, linkKind, "to");
    }
    const halo = linkKind === "main"
      ? `<path class="canvas-link-halo canvas-link-halo-main" d="${route.d}"></path>`
      : "";
    return `${halo}<path class="canvas-link canvas-link-${linkKind}" d="${route.d}"></path>`;
  }).join("");
  const portMarkup = Array.from(ports.values()).map((point) => `
    <circle
      class="canvas-link-port canvas-link-port-${point.kind || "support"} canvas-link-port-${point.side}"
      cx="${formatCanvasLinkNumber(point.x)}"
      cy="${formatCanvasLinkNumber(point.y)}"
      r="${point.kind === "main" ? 4.2 : 3.4}"
    ></circle>
  `).join("");

  els.canvasLinks.innerHTML = `${pathMarkup}${portMarkup}`;
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

function observeCanvasNodeLayout(nodes) {
  canvasNodeResizeObserver?.disconnect();
  canvasNodeResizeObserver = null;
  if (!window.ResizeObserver || !els.canvasNodes) {
    requestAnimationFrame(() => scheduleCanvasLinksRender(nodes));
    return;
  }
  canvasNodeResizeObserver = new ResizeObserver(() => {
    scheduleCanvasLinksRender(nodes);
    scheduleCanvasMinimapRender(nodes);
  });
  els.canvasNodes.querySelectorAll(".workflow-node").forEach((nodeEl) => {
    canvasNodeResizeObserver.observe(nodeEl);
  });
  els.canvasNodes.querySelectorAll("img").forEach((image) => {
    if (!image.complete) {
      image.addEventListener("load", () => scheduleCanvasLinksRender(nodes), { once: true });
      image.addEventListener("error", () => scheduleCanvasLinksRender(nodes), { once: true });
    }
  });
  requestAnimationFrame(() => requestAnimationFrame(() => scheduleCanvasLinksRender(nodes)));
}

function getNodeAnchor(id, side) {
  const box = getNodeBox(id);
  if (side === "left") return { x: box.left, y: box.cy };
  if (side === "right") return { x: box.right, y: box.cy };
  if (side === "top") return { x: box.cx, y: box.top };
  if (side === "bottom") return { x: box.cx, y: box.bottom };
  return { x: box.cx, y: box.cy };
}

function getNodeBox(id) {
  const pos = getNodePosition(id);
  const nodeEl = els.canvasNodes.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  const width = nodeEl?.offsetWidth || pos.w || 320;
  const height = nodeEl?.offsetHeight || 150;
  return {
    x: pos.x,
    y: pos.y,
    w: width,
    h: height,
    left: pos.x,
    right: pos.x + width,
    top: pos.y,
    bottom: pos.y + height,
    cx: pos.x + width / 2,
    cy: pos.y + height / 2
  };
}

function formatCanvasLinkNumber(value) {
  return Number(value.toFixed(1));
}

function canvasLinkPath(points) {
  if (!points.length) return "";
  const [first, ...rest] = points;
  return [
    `M ${formatCanvasLinkNumber(first.x)} ${formatCanvasLinkNumber(first.y)}`,
    ...rest.map((point) => `L ${formatCanvasLinkNumber(point.x)} ${formatCanvasLinkNumber(point.y)}`)
  ].join(" ");
}

function canvasLinkRoute(points) {
  return {
    d: canvasLinkPath(points),
    start: points[0] || { x: 0, y: 0 },
    end: points[points.length - 1] || { x: 0, y: 0 }
  };
}

function intervalOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function routeVerticalCanvasLink(fromBox, toBox) {
  const toBelow = toBox.cy >= fromBox.cy;
  const start = getNodeAnchor(fromBox.id, toBelow ? "bottom" : "top");
  const end = getNodeAnchor(toBox.id, toBelow ? "top" : "bottom");
  if (Math.abs(start.x - end.x) <= 32) {
    const x = (start.x + end.x) / 2;
    return canvasLinkRoute([{ x, y: start.y }, { x, y: end.y }]);
  }
  const midY = toBelow
    ? (fromBox.bottom + toBox.top) / 2
    : (toBox.bottom + fromBox.top) / 2;
  return canvasLinkRoute([
    start,
    { x: start.x, y: midY },
    { x: end.x, y: midY },
    end
  ]);
}

function routeHorizontalCanvasLink(fromBox, toBox) {
  const toRight = toBox.cx >= fromBox.cx;
  const start = getNodeAnchor(fromBox.id, toRight ? "right" : "left");
  const end = getNodeAnchor(toBox.id, toRight ? "left" : "right");
  if (Math.abs(start.y - end.y) <= 32) {
    const y = (start.y + end.y) / 2;
    return canvasLinkRoute([{ x: start.x, y }, { x: end.x, y }]);
  }
  const midX = toRight
    ? (fromBox.right + toBox.left) / 2
    : (toBox.right + fromBox.left) / 2;
  return canvasLinkRoute([
    start,
    { x: midX, y: start.y },
    { x: midX, y: end.y },
    end
  ]);
}

function routeCompactCanvasLink(fromBox, toBox) {
  const dx = toBox.cx - fromBox.cx;
  const dy = toBox.cy - fromBox.cy;
  const horizontalBias = Math.abs(dx) >= Math.abs(dy) * 0.72;
  if (horizontalBias) return routeHorizontalCanvasLink(fromBox, toBox);
  return routeVerticalCanvasLink(fromBox, toBox);
}

function routeOutputCanvasLink(fromBox, toBox) {
  const start = getNodeAnchor(fromBox.id, "right");
  const end = getNodeAnchor(toBox.id, "left");
  const lift = Math.max(44, Math.min(96, Math.abs(end.y - start.y) * 0.22));
  const laneY = Math.min(start.y, end.y) - lift;
  const midX = Math.max(fromBox.right + 42, Math.min(toBox.left - 42, (fromBox.right + toBox.left) / 2));
  return canvasLinkRoute([
    start,
    { x: midX, y: start.y },
    { x: midX, y: laneY },
    { x: end.x, y: laneY },
    end
  ]);
}

function routeCanvasLink(from, to) {
  const fromBox = getNodeBox(from);
  fromBox.id = from;
  const toBox = getNodeBox(to);
  toBox.id = to;
  if (
    from === "think" &&
    /^(render\d+|cad\d+|whiteModel\d+|render\d+Pipeline\d+)$/.test(String(to || "")) &&
    toBox.left > fromBox.right
  ) {
    return routeOutputCanvasLink(fromBox, toBox);
  }
  const overlapX = intervalOverlap(fromBox.left, fromBox.right, toBox.left, toBox.right);
  const overlapY = intervalOverlap(fromBox.top, fromBox.bottom, toBox.top, toBox.bottom);
  const horizontalGap = toBox.left > fromBox.right
    ? toBox.left - fromBox.right
    : fromBox.left > toBox.right
      ? fromBox.left - toBox.right
      : 0;
  const verticalGap = toBox.top > fromBox.bottom
    ? toBox.top - fromBox.bottom
    : fromBox.top > toBox.bottom
      ? fromBox.top - toBox.bottom
      : 0;
  const stackedVertically = verticalGap > 0 && overlapX >= Math.min(fromBox.w, toBox.w) * 0.24;
  const stackedHorizontally = horizontalGap > 0 && overlapY >= Math.min(fromBox.h, toBox.h) * 0.18;

  if (stackedVertically) return routeVerticalCanvasLink(fromBox, toBox);
  if (stackedHorizontally) return routeHorizontalCanvasLink(fromBox, toBox);
  return routeCompactCanvasLink(fromBox, toBox);
}

function supportsCanvasCssZoom() {
  return Boolean(els.canvasZoomLayer && "zoom" in els.canvasZoomLayer.style);
}

function applyCanvasTransform({ refreshMinimap = true } = {}) {
  const { x, y, zoom } = state.canvas;
  if (!els.canvasZoomLayer) {
    els.canvasViewport.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  } else {
    els.canvasViewport.style.transform = `translate(${x}px, ${y}px)`;
    if (supportsCanvasCssZoom()) {
      els.canvasZoomLayer.style.zoom = String(zoom);
      els.canvasZoomLayer.style.transform = "";
    } else {
      els.canvasZoomLayer.style.zoom = "";
      els.canvasZoomLayer.style.transform = `scale(${zoom})`;
    }
  }
  els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  if (refreshMinimap) scheduleCanvasMinimapRender();
}

function resetCanvasView() {
  state.canvas.x = 48;
  state.canvas.y = 28;
  state.canvas.zoom = 1;
  applyCanvasTransform();
  scheduleCanvasStateSave({ delay: 300 });
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
  const floatingComposerOpen = document.body.classList.contains("agent-panel-collapsed")
    && !document.body.classList.contains("canvas-floating-collapsed");
  const occludedRight = floatingComposerOpen && rect.width >= 900 ? 430 : 0;
  const padX = 180 + occludedRight;
  const padY = 170;
  const availableWidth = Math.max(320, rect.width - 72 - occludedRight);
  const availableHeight = Math.max(260, rect.height - 132);
  const minFocusZoom = rect.width < 900 ? 0.34 : 0.48;
  const zoom = clamp(Math.min(availableWidth / Math.max(1, maxX - minX + padX), availableHeight / Math.max(1, maxY - minY + padY)), minFocusZoom, 1.18);
  state.canvas.zoom = zoom;
  state.canvas.x = (rect.width - occludedRight - (maxX - minX) * zoom) / 2 - minX * zoom;
  state.canvas.y = Math.max(84, (rect.height - (maxY - minY) * zoom) / 2) - minY * zoom;
  applyCanvasTransform();
  scheduleCanvasStateSave({ delay: 300 });
}

function focusCanvasToResults() {
  if (normalizeClientMode(state.mode) === "image-modeling" && state.cadResults.length) {
    focusCanvasToNodes([`cad${state.cadResults.length - 1}`]);
    return;
  }
  if (normalizeClientMode(state.mode) === "image-modeling" && state.whiteModelResults.length) {
    focusCanvasToNodes([`whiteModel${state.whiteModelResults.length - 1}`]);
    return;
  }
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
  scheduleCanvasStateSave({ delay: 900 });
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
    const h = node.planPaper ? 330 : node.multiAngle ? 560 : node.directImage ? 260 : 160;
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

function updateMultiAngleRange(key, rawValue) {
  const current = normalizedMultiAngleViewState();
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  const next = { ...current, dragging: null };
  if (key === "subjectX" || key === "subjectY") next[key] = Math.round(clamp(value, -100, 100));
  else if (key === "subjectRotate") next.subjectRotate = wrapSignedDegrees(value);
  else if (key === "cameraX") next.cameraX = wrapSignedDegrees(value);
  else if (key === "cameraY") next.cameraY = Math.round(clamp(value, -90, 90));
  else if (key === "cameraDistance") next.cameraDistance = Math.round(clamp(value, -100, 100));
  else return;
  state.multiAngleView = next;
  updateRenderedMultiAngleControls();
  renderAgentBriefInsight();
  scheduleCanvasStateSave({ delay: 180 });
}

function startMultiAngleDrag(event) {
  if (event.target.closest?.("button, a, input")) return;
  event.preventDefault();
  event.stopPropagation();
  applyCanvasListCollapsed(true);
  const view = normalizedMultiAngleViewState();
  state.multiAngleView = {
    ...view,
    dragging: {
      pointerId: event.pointerId,
      mode: view.mode,
      startX: event.clientX,
      startY: event.clientY,
      subjectX: view.subjectX,
      subjectY: view.subjectY,
      cameraX: view.cameraX,
      cameraY: view.cameraY
    }
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.currentTarget.classList.add("is-dragging");
  event.currentTarget.focus?.({ preventScroll: true });
}

function updateMultiAngleDrag(event) {
  const drag = state.multiAngleView?.dragging;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const current = normalizedMultiAngleViewState(state.multiAngleView);
  const next = { ...current, dragging: drag };
  if (drag.mode === "camera") {
    next.cameraX = wrapSignedDegrees(drag.cameraX + dx * 0.7);
    next.cameraY = Math.round(clamp(drag.cameraY - dy * 0.45, -90, 90));
  } else {
    next.subjectX = Math.round(clamp(drag.subjectX + dx * 0.45, -100, 100));
    next.subjectY = Math.round(clamp(drag.subjectY + dy * 0.45, -100, 100));
  }
  state.multiAngleView = next;
  updateRenderedMultiAngleControls();
}

function finishMultiAngleDrag(event) {
  const drag = state.multiAngleView?.dragging;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  updateMultiAngleDrag(event);
  state.multiAngleView = {
    ...normalizedMultiAngleViewState(state.multiAngleView),
    dragging: null
  };
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  event.currentTarget.classList.remove("is-dragging");
  renderAgentBriefInsight();
  scheduleCanvasStateSave({ delay: 180 });
}

function adjustMultiAngleByKeyboard(event) {
  const stage = event.target.closest?.("[data-multi-angle-stage]");
  if (!stage) return false;
  applyCanvasListCollapsed(true);
  const current = normalizedMultiAngleViewState();
  const moveStep = event.shiftKey ? 12 : 4;
  const angleStep = event.shiftKey ? 15 : 5;
  const distanceStep = event.shiftKey ? 20 : 8;
  const next = { ...current, dragging: null };
  if (current.mode === "camera") {
    if (event.key === "ArrowLeft") next.cameraX = wrapSignedDegrees(current.cameraX - angleStep);
    else if (event.key === "ArrowRight") next.cameraX = wrapSignedDegrees(current.cameraX + angleStep);
    else if (event.key === "ArrowUp") next.cameraY = Math.round(clamp(current.cameraY + angleStep, -90, 90));
    else if (event.key === "ArrowDown") next.cameraY = Math.round(clamp(current.cameraY - angleStep, -90, 90));
    else if (event.key === "+" || event.key === "=") next.cameraDistance = Math.round(clamp(current.cameraDistance - distanceStep, -100, 100));
    else if (event.key === "-" || event.key === "_") next.cameraDistance = Math.round(clamp(current.cameraDistance + distanceStep, -100, 100));
    else if (event.key === "Home") Object.assign(next, defaultMultiAngleViewState(), { mode: "camera" });
    else return false;
  } else {
    if (event.key === "ArrowLeft") next.subjectX = Math.round(clamp(current.subjectX - moveStep, -100, 100));
    else if (event.key === "ArrowRight") next.subjectX = Math.round(clamp(current.subjectX + moveStep, -100, 100));
    else if (event.key === "ArrowUp") next.subjectY = Math.round(clamp(current.subjectY - moveStep, -100, 100));
    else if (event.key === "ArrowDown") next.subjectY = Math.round(clamp(current.subjectY + moveStep, -100, 100));
    else if (event.key === "+" || event.key === "=") next.subjectRotate = wrapSignedDegrees(current.subjectRotate + angleStep);
    else if (event.key === "-" || event.key === "_") next.subjectRotate = wrapSignedDegrees(current.subjectRotate - angleStep);
    else if (event.key === "Home") Object.assign(next, defaultMultiAngleViewState(), { mode: "subject" });
    else return false;
  }
  event.preventDefault();
  event.stopPropagation();
  state.multiAngleView = next;
  updateRenderedMultiAngleControls();
  renderAgentBriefInsight();
  scheduleCanvasStateSave({ delay: 180 });
  return true;
}

async function handleMultiAngleAction(action, busyButton = null) {
  if (action === "cancel") {
    closeMultiAngleOverlay();
    return;
  }
  if (action === "reset") {
    const mode = normalizedMultiAngleViewState().mode;
    state.multiAngleView = {
      ...defaultMultiAngleViewState(),
      mode
    };
    renderWorkflowCanvas();
    scheduleCanvasStateSave({ delay: 180 });
    toast("已重置纸张角度");
    return;
  }
  if (action === "apply") {
    const selected = state.multiAnglePanel.selectedImage;
    if (!selected?.url) return;
    setBusy(busyButton, true, "生成中");
    try {
      closeMultiAngleOverlay();
      await generateMultiAngleFromCanvasImage(selected);
    } finally {
      setBusy(busyButton, false);
    }
    return;
  }
  if (action === "generate") {
    await runPrimaryAction({ busyButton: busyButton || els.canvasGenerateButton });
  }
}

function startPlanPaperDrag(event) {
  if (event.altKey) return;
  if (event.target.closest?.("button, a")) return;
  event.preventDefault();
  event.stopPropagation();
  applyCanvasListCollapsed(true);
  const view = normalizedPlanPaperViewState();
  state.planPaperView = {
    ...view,
    dragging: {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      yaw: view.yaw,
      pitch: view.pitch
    }
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.currentTarget.classList.add("is-dragging");
  event.currentTarget.focus?.({ preventScroll: true });
}

function updatePlanPaperDrag(event) {
  const drag = state.planPaperView?.dragging;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  state.planPaperView = {
    ...normalizedPlanPaperViewState(state.planPaperView),
    yaw: wrapDegrees(drag.yaw + dx * 0.58),
    pitch: wrapDegrees(drag.pitch - dy * 0.58),
    dragging: drag
  };
  updateRenderedPlanPaperControls(document);
}

function finishPlanPaperDrag(event) {
  const drag = state.planPaperView?.dragging;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  updatePlanPaperDrag(event);
  state.planPaperView = {
    ...normalizedPlanPaperViewState(state.planPaperView),
    dragging: null
  };
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  event.currentTarget.classList.remove("is-dragging");
  renderAgentBriefInsight();
  renderPlanAngleSyncBlock();
  scheduleCanvasStateSave({ delay: 180 });
}

function adjustPlanPaperByKeyboard(event) {
  const stage = event.target.closest?.("[data-plan-paper-stage]");
  if (!stage) return false;
  applyCanvasListCollapsed(true);
  if (event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    const direction = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down"
    }[event.key];
    event.preventDefault();
    event.stopPropagation();
    adjustPlanPaperPan(direction, { large: event.shiftKey });
    return true;
  }
  const current = normalizedPlanPaperViewState();
  const yawStep = event.shiftKey ? 45 : 15;
  const pitchStep = event.shiftKey ? 45 : 15;
  const zoomStep = event.shiftKey ? 0.32 : 0.16;
  let next = { ...current };
  if (event.key === "ArrowLeft") {
    next.yaw = wrapDegrees(current.yaw - yawStep);
  } else if (event.key === "ArrowRight") {
    next.yaw = wrapDegrees(current.yaw + yawStep);
  } else if (event.key === "ArrowUp") {
    next.pitch = wrapDegrees(current.pitch + pitchStep);
  } else if (event.key === "ArrowDown") {
    next.pitch = wrapDegrees(current.pitch - pitchStep);
  } else if (event.key === "+" || event.key === "=") {
    next.zoom = round4(clamp(current.zoom + zoomStep, PLAN_PAPER_MIN_ZOOM, PLAN_PAPER_MAX_ZOOM));
  } else if (event.key === "-" || event.key === "_") {
    next.zoom = round4(clamp(current.zoom - zoomStep, PLAN_PAPER_MIN_ZOOM, PLAN_PAPER_MAX_ZOOM));
  } else if (event.key === "Home") {
    next = defaultPlanPaperViewState();
  } else {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  state.planPaperView = {
    ...next,
    yaw: wrapDegrees(next.yaw),
    pitch: wrapDegrees(next.pitch),
    dragging: null
  };
  updateRenderedPlanPaperControls(document);
  renderAgentBriefInsight();
  renderPlanAngleSyncBlock();
  scheduleCanvasStateSave({ delay: 180 });
  return true;
}

function adjustPlanPaperPan(direction, { large = false } = {}) {
  const current = normalizedPlanPaperViewState();
  const step = (large ? 2 : 1) * PLAN_PAPER_PAN_STEP;
  const next = { ...current, dragging: null };
  if (direction === "left") next.panX = Math.round(clamp(current.panX - step, -PLAN_PAPER_MAX_PAN, PLAN_PAPER_MAX_PAN));
  else if (direction === "right") next.panX = Math.round(clamp(current.panX + step, -PLAN_PAPER_MAX_PAN, PLAN_PAPER_MAX_PAN));
  else if (direction === "up") next.panY = Math.round(clamp(current.panY - step, -PLAN_PAPER_MAX_PAN, PLAN_PAPER_MAX_PAN));
  else if (direction === "down") next.panY = Math.round(clamp(current.panY + step, -PLAN_PAPER_MAX_PAN, PLAN_PAPER_MAX_PAN));
  else return;
  state.planPaperView = next;
  updateRenderedPlanPaperControls(document);
  renderAgentBriefInsight();
  renderPlanAngleSyncBlock();
  scheduleCanvasStateSave({ delay: 180 });
}

function zoomPlanPaperByWheel(event) {
  event.preventDefault();
  event.stopPropagation();
  const current = normalizedPlanPaperViewState();
  const delta = clamp(wheelDeltaPixels(event), -CANVAS_WHEEL_DELTA_LIMIT, CANVAS_WHEEL_DELTA_LIMIT);
  if (!delta) return;
  state.planPaperView = {
    ...current,
    zoom: round4(clamp(current.zoom * Math.exp(-delta * 0.00145), PLAN_PAPER_MIN_ZOOM, PLAN_PAPER_MAX_ZOOM)),
    dragging: null
  };
  updateRenderedPlanPaperControls(document);
  scheduleCanvasStateSave({ delay: 240 });
}

async function handlePlanPaperAction(action, busyButton = null) {
  if (action === "reset") {
    state.planPaperView = defaultPlanPaperViewState();
    renderWorkflowCanvas();
    renderPlanAngleSyncBlock();
    scheduleCanvasStateSave({ delay: 180 });
    toast("已重置图片视角");
    return;
  }
  if (action === "generate") {
    await runPrimaryAction({ busyButton: busyButton || els.canvasGenerateButton });
  }
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
  els.renderIntent.value = withSelectedStyleForMode(config.intent, mode);
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
  els.continueEditButton.disabled = ["cad", "image-modeling"].includes(mode) || !state.render;
  refreshPresetSelection();
  refreshGenerationControls();
  renderPlanAngleSyncBlock();
}

function setMode(mode) {
  mode = publicModeOrFallback(mode);
  const previousMode = normalizeClientMode(state.mode);
  state.mode = mode;
  state.selection = null;
  if (mode !== previousMode) {
    clearPromptPresetStateForModeChange();
  }
  if (isPlanPaperMode(mode) && !isPlanPaperMode(previousMode)) {
    state.planPaperView = defaultPlanPaperViewState();
  }
  if (isPlanMultiAngleMode(mode) && !isPlanMultiAngleMode(previousMode)) {
    state.multiAngleView = defaultMultiAngleViewState();
  } else if (!isPlanMultiAngleMode(mode) && isPlanMultiAngleMode(previousMode)) {
    state.multiAngleView = defaultMultiAngleViewState();
  }
  if (mode !== previousMode) {
    state.viewControlOpen = isPlanSeriesDynamicMode(mode) && Boolean(state.primaryImage?.dataUrl);
    closeColorGradeOverlay();
    closeCutoutOverlay();
    if (state.primaryImage?.dataUrl && !state.primaryImage?.parentNodeId && !state.primaryImage?.detachedPanelInput && state.renders.length) {
      ensureSessionCanvasBranchAnchor();
    }
  }
  state.generation.count = clampImageCount(state.generation.count, mode);
  if (mode === "panorama") {
    state.generation.aspect = PANORAMA_ASPECT_RATIO;
    state.generation.customSize = "";
  }
  syncDefaultCanvasCommand(mode);
  syncModeControls(mode);
  drawSelectionCanvas();
  renderPlanAngleSyncBlock();
  renderWorkflowCanvas();
  if (mode === "designseries" && state.referenceImages.length && !state.designSeriesAnalysis) {
    analyzeDesignSeriesReferences();
  }
}

function primaryActionLabel(mode) {
  mode = normalizeClientMode(mode);
  if (mode === "custom") return "生成图片";
  if (mode === "plan-axonometric") return "生成彩色平面图";
  if (mode === "plan-axonometric-view") return "生成轴测图";
  if (mode === "plan-render") return "生成效果图";
  if (mode === "image-modeling") return "生成CAD";
  if (mode === "design-derivation") return "推导方案";
  if (mode === "cad") return "生成CAD";
  if (mode === "designseries") return "生成设计系列";
  if (mode === "panorama") return "生成全景图";
  if (mode === "upscale") return "算法增强";
  if (mode === "sharpen") return "提高锐化";
  if (mode === "colorgrade") return "调色";
  if (mode === "cutout") return "抠图";
  if (mode === "materialreplace") return "替换材质";
  if (mode === "lightingadjust") return "调整灯光";
  if (mode === "styletransfer") return "迁移风格";
  if (mode === "materialboard") return "生成材料板";
  if (mode === "detail") return "细节增强";
  if (mode === "outpaint") return "扩图";
  return "生成效果图";
}

function primaryActionButtonHtml(mode) {
  mode = normalizeClientMode(mode);
  const icon = ["plan-axonometric", "plan-axonometric-view"].includes(mode) ? "icon-cube" : mode === "image-modeling" ? "icon-vector" : mode === "design-derivation" ? "icon-think" : mode === "colorgrade" ? "icon-filter" : mode === "cutout" ? "icon-box-select" : mode === "cad" || mode === "sharpen" ? "icon-spark" : "icon-image";
  return `<svg><use href="#${icon}"></use></svg>${primaryActionLabel(mode)}`;
}

function primaryActionIconButtonHtml(mode) {
  mode = normalizeClientMode(mode);
  const icon = ["plan-axonometric", "plan-axonometric-view"].includes(mode) ? "icon-cube" : mode === "image-modeling" ? "icon-vector" : mode === "design-derivation" ? "icon-think" : mode === "colorgrade" ? "icon-filter" : mode === "cutout" ? "icon-box-select" : mode === "cad" || mode === "sharpen" ? "icon-spark" : "icon-image";
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

function imageProcessMenuHtml(busyAttrs = "") {
  return `
    <details class="canvas-node-tool-menu" data-canvas-node-tool-menu>
      <summary class="secondary-button canvas-node-tool-menu-summary" title="深度编辑" aria-label="深度编辑">
        <svg><use href="#icon-zoom-in"></use></svg>深度编辑
      </summary>
      <div class="canvas-node-tool-menu-popover" aria-label="深度编辑工具">
        ${iconActionButton({ className: "text-button", action: "colorgrade", icon: "icon-filter", label: "调色", attrs: busyAttrs })}
        ${iconActionButton({ className: "text-button", action: "crop", icon: "icon-crop", label: "裁切", attrs: busyAttrs })}
        ${iconActionButton({ className: "text-button", action: "cutout", icon: "icon-box-select", label: "抠图", attrs: busyAttrs })}
      </div>
    </details>
  `;
}

function canvasNodeImageToolsHtml(node = {}) {
  if (!node.imageUrl) return "";
  const showBaseTools = Boolean(node.outputId) || node.kind === "Reference" || node.id === "source";
  if (!showBaseTools) return "";
  const outputItem = findOutputItem(node.outputId) || getOutputItems().find((item) => item.url === node.imageUrl);
  const favorite = outputItem ? state.favoriteOutputIds.has(outputItem.id) : false;
  const previewLabel = outputItem && isPanoramaOutput(outputItem) ? "全景预览" : "放大查看";
  const busy = state.canvas.selectedImage?.id === node.id ? state.canvas.imageActionBusy : "";
  const busyAttrs = busy ? "disabled" : "";
  const showOutputTools = Boolean(outputItem);
  const showMultiAngle = showOutputTools
    && !isPlanWorkflowMode(state.mode)
    && !isPlanWorkflowMode(outputItem?.stepMode || outputItem?.mode)
    && !isPanoramaOutput(outputItem);
  return `
    <div class="canvas-node-image-tools" aria-label="图片操作">
      ${imageProcessMenuHtml(busyAttrs)}
      ${iconActionButton({ action: "deep-edit", icon: "icon-spark", label: "图像处理", attrs: busyAttrs })}
      ${showOutputTools ? iconActionButton({ action: "send-to-panel", icon: "icon-panel-show", label: "加入创作面板", attrs: busyAttrs }) : ""}
      ${showMultiAngle ? iconActionButton({ action: "multi-angle", icon: "icon-series", label: "多角度", attrs: busyAttrs }) : ""}
      ${iconActionButton({ className: "text-button", action: "open-original", icon: "icon-image", label: "打开原图" })}
      ${iconActionButton({ className: "text-button", action: "preview", icon: "icon-focus", label: previewLabel })}
      ${showOutputTools ? iconActionButton({ action: "favorite", icon: "icon-star", label: favorite ? "已收藏" : "收藏", attrs: `aria-pressed="${favorite ? "true" : "false"}"` }) : ""}
      ${showOutputTools ? iconActionButton({ action: "regenerate", icon: "icon-refresh", label: "重新生成", attrs: busyAttrs }) : ""}
    </div>
  `;
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
  if (mode === "plan-axonometric") return "彩色平面图生成位";
  if (mode === "plan-axonometric-view") return "轴测图生成位";
  if (mode === "plan-render") return "效果图生成位";
  if (mode === "image-modeling") return "图片转CAD生成位";
  if (mode === "design-derivation") return "方案推导位";
  if (mode === "cad") return "CAD 生成位";
  if (mode === "designseries") return "设计系列生成位";
  if (mode === "panorama") return "全景图生成位";
  if (mode === "materialboard") return "材料板生成位";
  if (mode === "colorgrade") return "调色处理位";
  if (mode === "cutout") return "抠图处理位";
  if (["materialreplace", "lightingadjust", "styletransfer"].includes(mode)) return "AI 编辑生成位";
  if (["upscale", "detail", "sharpen", "outpaint"].includes(mode)) return "图片处理位";
  return "效果图生成位";
}

function generationEngineLabel(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (normalized === "design-derivation") return "gpt-5.5";
  if (normalized === "image-modeling") return "本地CAD提取";
  if (["colorgrade", "cutout", "upscale", "sharpen"].includes(normalized)) return "本地算法";
  return "Image Gen";
}

function generationEndpointLabel(mode = state.mode) {
  const normalized = normalizeClientMode(mode);
  if (normalized === "design-derivation") return getReasoningEndpointLabel();
  if (normalized === "image-modeling") return "Browser Canvas";
  if (["colorgrade", "cutout", "upscale", "sharpen"].includes(normalized)) return "Browser Canvas";
  return getActiveImageEndpoint();
}

function generationThinkingText(mode = state.mode) {
  const normalizedMode = normalizeClientMode(mode);
  if (normalizedMode === "plan-axonometric") {
    return `正在按${planPaperReadoutText()}生成彩色平面图，并严格保留平面布局。${planWorkflowRecommendationText}`;
  }
  if (normalizedMode === "plan-axonometric-view") {
    return `正在按${planPaperReadoutText()}生成高精度轴测图，并严格保留彩色平面布局。${planWorkflowRecommendationText}`;
  }
  if (normalizedMode === "plan-render") {
    return `正在按${planPaperReadoutText()}和选区关系，把轴测图区域生成人视角效果图。${planWorkflowRecommendationText}`;
  }
  if (normalizedMode === "panorama") {
    return "正在生成 2:1 的 360 度全景图，并保持水平连续、地平线稳定和无缝闭合。";
  }
  if (normalizedMode === "design-derivation") {
    return "正在读取项目条件、参考图和画布素材，先推演设计元素，再整理成多套方案方向。";
  }
  if (normalizedMode === "image-modeling") {
    return state.primaryImage
      ? "正在把上传图片提取为 CAD 线稿，输出 DXF / SVG；3D 建模暂时不进入主流程。"
      : "上传平面图、CAD 截图或清晰线稿后，可直接生成 DXF / SVG。";
  }
  if (normalizedMode === "colorgrade") return "正在打开本地调色面板，调节后直接输出新图片。";
  if (normalizedMode === "cutout") return "正在打开抠图面板，先用 AI 视觉识别主体轮廓。";
  if (!state.thinkingModeEnabled) return "思考模式已关闭：本次不做额外提示词融合，直接使用当前功能预设、隐藏提示词和用户描述交给 Image Gen。";
  if (normalizedMode === "plan-render") {
    return state.selection
      ? `正在读取轴测图，并锁定${selectionRegionLabel(state.selection)}生成人视角效果图。${planWorkflowRecommendationText}`
      : `正在读取轴测图和参考图，未框选时会自动选择与参考图最接近的明确区域生成人视角效果图。${planWorkflowRecommendationText}`;
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
      resultTitle: "彩色平面图",
      missing: "请先上传平面图",
      outputType: "colored architectural floor plan",
      intent: `平面图转彩色平面图。\n${planToColoredPlanFixedPrompt}\n${planWorkflowRecommendationText}`
    },
    "plan-axonometric-view": {
      uploadLabel: "上传彩色平面图",
      sourceTitle: "彩色平面图",
      resultTitle: "轴测图",
      missing: "请先上传彩色平面图或平面图",
      outputType: "high-precision axonometric view with 3D perspective depth",
      intent: `彩色平面图转高精度轴测图。\n${planToAxonometricViewFixedPrompt}\n${planWorkflowRecommendationText}`
    },
    "design-derivation": {
      uploadLabel: "可选上传项目底图",
      sourceTitle: "方案推导输入",
      resultTitle: "方案推导结果",
      missing: "可以直接开始方案推导，或上传参考图",
      outputType: "design derivation",
      intent: "设计元素推演与方案推导：先拆空间秩序、材料家族、灯光策略、色彩关系、家具语言、立面节奏和细部母题，再形成 3 套可继续出图的方案方向。"
    },
    "plan-render": {
      uploadLabel: "上传轴测图",
      sourceTitle: "轴测图",
      resultTitle: "人视角效果图",
      missing: "请先上传轴测图或带选区的空间参考图",
      outputType: "eye-level interior render",
      intent: `基于轴测图生成最终人视角室内/建筑效果图。优先要求用户在预览图上框选要生成的区域；如果没有框选，Agent 必须自动选择一个与参考图最接近、最适合出图的明确功能区，并在提示词和输出记录里标明效果图来自哪个区域。${planWorkflowRecommendationText}`
    },
    "image-modeling": {
      uploadLabel: "上传要转 CAD 的图片",
      sourceTitle: "图片转 CAD 输入",
      resultTitle: "CAD 线稿",
      missing: "请先上传一张要转成 CAD 的图片",
      outputType: "CAD linework",
      intent: "图片转 CAD：上传平面图、CAD 截图、手绘线稿或清晰图纸后，推荐先生成白底图，再生成 CAD 结构参考图，最后从参考图或原图提取主要墙线、房间边界、开口和长直轮廓，生成可下载的 DXF / SVG 描底文件。当前阶段暂不做 3D 建模、GLB、SCAD 或参数化模型。"
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
    panorama: {
      uploadLabel: "可选上传全景参考图",
      sourceTitle: "全景图输入",
      resultTitle: "全景图",
      missing: "可以直接写全景图描述，或上传参考图",
      outputType: "360 equirectangular panorama",
      intent: "全景图生成：输出 2:1 的 360 度环景图，保证水平连续、地平线稳定和无缝闭合；可以只靠文字生成，也可参考上传图片的空间结构、材质、灯光和氛围。"
    },
    sketch: {
      uploadLabel: "上传手稿 / 草图",
      sourceTitle: "手稿草图",
      resultTitle: "手稿实景图",
      missing: "请先上传手稿或草图",
      intent: "保留手稿的空间构图、主要体块和设计意图，生成真实建筑或室内空间效果图。"
    },
    colorgrade: {
      uploadLabel: "上传需要调色的图片",
      sourceTitle: "调色原图",
      resultTitle: "调色结果",
      missing: "请先上传需要调色的图片",
      intent: "本地调色：通过曝光、对比、高光、阴影、白色、黑色、色温、色调、饱和度和局部清晰度调整图片观感，不重新生成内容。"
    },
    cutout: {
      uploadLabel: "上传需要抠图的图片",
      sourceTitle: "抠图原图",
      resultTitle: "抠图结果",
      missing: "请先上传需要抠图的图片",
      intent: "智能抠图：先自动识别主体候选图层，再允许点击选中并输出透明背景 PNG。"
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

function applyProjectTemplate(name) {
  const template = projectTemplates[name];
  if (!template) return;
  if (template.mode) setMode(template.mode);
  state.selectedScenePreset = null;
  state.selectedProjectTemplate = name;
  clearHiddenPromptContext("scenePreset");
  writeBrief({
    spaceType: template.spaceType,
    style: template.style,
    functions: template.functions,
    constraints: template.constraints
  });
  setHiddenPromptContext("scenePreset", template.command);
  if (els.canvasCommand && !state.canvasCommandUserEdited) {
    els.canvasCommand.value = template.command;
  }
  if (els.floatingCanvasCommand && !state.canvasCommandUserEdited) {
    els.floatingCanvasCommand.value = template.command;
  }
  refreshPresetSelection();
  refreshGenerationControls();
  renderWorkflowCanvas();
  toast("已套用常用设计模板");
}

function stylePresetPromptForMode(mode, styleName, description) {
  if (!styleName || !description || !modeAllowsStylePreset(mode)) return "";
  const normalized = normalizeClientMode(mode);
  if (normalized === "custom" && customPromptRequestsNonSpatialArtifact(normalized)) {
    return `审美参考（低优先级）：${styleName}：${description}。只借用色彩、材质、情绪和排版气质，不要把它变成空间效果图。`;
  }
  if (normalized === "styletransfer") {
    return `目标风格：${styleName}：${description}。保持结构、镜头、尺度和动线不变，只迁移风格系统。`;
  }
  if (["materialreplace", "lightingadjust", "detail", "outpaint"].includes(normalized)) {
    return `风格参考（低优先级）：${styleName}：${description}。仅在不破坏当前模式的保留项和结构约束时，借用它的材料、灯光和审美方向，不要把它变成整体重做。`;
  }
  return `指定风格：${styleName}：${description}`;
}

function withSelectedStyleForMode(intent, mode = state.mode) {
  if (!state.selectedStylePreset || !modeAllowsStylePreset(mode)) return intent;
  const description = stylePresetDescriptions[state.selectedStylePreset];
  if (!description) return intent;
  const stylePrompt = stylePresetPromptForMode(mode, state.selectedStylePreset, description);
  return stylePrompt ? `${intent}\n${stylePrompt}` : intent;
}

function withSelectedStyle(intent) {
  return withSelectedStyleForMode(intent, state.mode);
}

function refreshPresetSelection() {
  els.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset !== "none" && button.dataset.preset === state.selectedScenePreset);
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
  });
  els.projectTemplateButtons.forEach((button) => {
    const active = button.dataset.projectTemplate === state.selectedProjectTemplate;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
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
    state.selectedProjectTemplate = null;
    clearHiddenPromptContext("scenePreset");
    refreshPresetSelection();
    renderWorkflowCanvas();
    toast("已取消场景模板");
    return;
  }
  const preset = presets[name];
  if (!preset) return;
  if (!modeAllowsScenePreset(state.mode)) {
    toast("当前模式不使用场景模板");
    return;
  }
  state.selectedScenePreset = name;
  state.selectedProjectTemplate = null;
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
  if (!modeAllowsStylePreset(state.mode)) {
    toast("当前模式不使用风格预设");
    return;
  }
  state.selectedStylePreset = styleName;
  refreshPresetSelection();
  const styleText = stylePresetPromptForMode(state.mode, styleName, description);
  writeBrief({ style: styleText });
  els.renderIntent.value = withSelectedStyleForMode(modeConfig(state.mode).intent, state.mode);
  setHiddenPromptContext("stylePreset", styleText);
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
    { test: /(彩平|color.?plan|colored.?plan)/i, key: "colored-plan", label: "彩色平面图", suggestedMode: "plan-axonometric-view", confidence: 0.88 },
    { test: /(3d平面|三维平面|轴测|axon|axo|isometric)/i, key: "axonometric", label: "轴测图", suggestedMode: "plan-render", confidence: 0.9 },
    { test: /(白模|灰模|模型|建模|sketchup|rhino|revit|white.?model|clay.?render|mass.?model)/i, key: "white-model", label: "白模 / 建模截图", suggestedMode: "whitemodel", confidence: 0.82 },
    { test: /(苹果|apple|fruit|产品|物体|主体|object|product|furniture|chair|table|lamp)/i, key: "object-photo", label: "产品 / 物体照片", suggestedMode: "custom", confidence: 0.78 },
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
  const softColorRatio = metrics.softColorRatio || 0;

  if (
    whiteRatio > 0.18 &&
    edgeRatio > 0.035 &&
    textureRatio < 0.3 &&
    (softColorRatio > 0.04 || colorfulness > 0.018 || saturation > 0.105)
  ) {
    return imageAnalysisResult({ key: "colored-plan", label: "彩色平面图", suggestedMode: "plan-axonometric-view", confidence: 0.8 }, metrics, "检测到平面图线条结构，同时存在低饱和彩色分区，可直接进入轴测图生成");
  }

  if (saturation < 0.025 && whiteRatio > 0.58 && edgeRatio > 0.045 && colorfulness < 0.012 && aspect > 1.45) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.86 }, metrics, "超宽白底图纸截图，低饱和且细线边缘密集，建议先生成彩色平面图，再生成轴测图");
  }
  if (saturation < 0.08 && whiteRatio > 0.46 && darkRatio > 0.015 && edgeRatio > 0.055) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.82 }, metrics, "高白底、低饱和、线条边缘密度高，建议先生成彩色平面图，再生成轴测图");
  }
  if (saturation < 0.06 && whiteRatio > 0.52 && darkRatio > 0.004 && edgeRatio > 0.024 && textureRatio < 0.18) {
    return imageAnalysisResult({ key: "line-plan", label: "黑白平面线稿", suggestedMode: "plan-axonometric", confidence: 0.78 }, metrics, "大面积白底、低饱和、细黑线和标注密集，建议先生成彩色平面图，再生成轴测图");
  }
  if (saturation < 0.1 && darkRatio > 0.08 && edgeRatio > 0.07) {
    return imageAnalysisResult({ key: "cad-screenshot", label: "CAD 截图 / 图纸线稿", suggestedMode: "cadrender", confidence: 0.72 }, metrics, "低饱和且深色线段密集，更像 CAD 或施工图");
  }
  if (saturation > 0.12 && whiteRatio > 0.24 && edgeRatio > 0.06 && textureRatio < 0.24) {
    return imageAnalysisResult({ key: "colored-plan", label: "彩色平面图", suggestedMode: "plan-axonometric-view", confidence: 0.72 }, metrics, "色块明显、白底占比较高、纹理复杂度低，可直接进入轴测图生成");
  }
  if (edgeRatio > 0.08 && textureRatio < 0.32 && colorfulness > 0.08 && whiteRatio > 0.12) {
    return imageAnalysisResult({ key: "axonometric", label: "轴测图", suggestedMode: "plan-render", confidence: 0.62 }, metrics, "空间边缘和色块都有，但不像真实照片纹理");
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
      colorfulness: round4(metrics.colorfulness || 0),
      softColorRatio: round4(metrics.softColorRatio || 0)
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
  let softColor = 0;
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
    if (sat > 0.07 && max - min > 10 && y > 76 && y < 244) softColor += 1;
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
    softColorRatio: softColor / count,
    edgeRatio: edge / edgeCount,
    textureRatio: texture / edgeCount
  };
}

function shouldWarnInputModeMismatch(analysis, mode = state.mode) {
  const normalizedMode = normalizeClientMode(mode);
  if (!analysis?.suggestedMode || analysis.suggestedMode === normalizedMode) return false;
  if (isInputCompatibleWithMode(analysis, normalizedMode)) return false;
  if (["custom", "design-derivation", "designseries"].includes(normalizedMode)) return false;
  if (analysis.confidence < 0.58) return false;
  return true;
}

function inputTypeForGeneratedMode(mode) {
  const normalizedMode = normalizeClientMode(mode);
  const map = {
    "plan-color": { key: "colored-plan", label: "彩色平面图", suggestedMode: "plan-axonometric-view", confidence: 0.94, reason: "由黑白平面图生成的彩色平面图中间稿" },
    "plan-axonometric": { key: "colored-plan", label: "彩色平面图", suggestedMode: "plan-axonometric-view", confidence: 0.92, reason: "由彩色平面图生成结果传递而来" },
    "plan-axonometric-view": { key: "axonometric", label: "轴测图", suggestedMode: "plan-render", confidence: 0.92, reason: "由轴测图生成结果传递而来" },
    "plan-render": { key: "render", label: "人视角效果图", suggestedMode: "photo", confidence: 0.8, reason: "由最终效果图结果传递而来" },
    panorama: { key: "panorama", label: "全景图", suggestedMode: "panorama", confidence: 0.9, reason: "由 360 全景图生成结果传递而来" },
    "design-derivation": { key: "design-logic", label: "设计推导结果", suggestedMode: "custom", confidence: 0.78, reason: "由方案推导结果传递而来" }
  };
  return map[normalizedMode] || { key: "generated-output", label: "生成结果", suggestedMode: normalizedMode, confidence: 0.7, reason: "由画布输出图传递而来" };
}

function formatUploadBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${Math.round(value)}B`;
}

function uploadTargetCard(target = "primary") {
  return target === "reference"
    ? els.agentUploadZone?.querySelector(".secondary-upload")
    : els.agentUploadZone?.querySelector(".primary-upload");
}

function setUploadStatus(status = "idle", text = "", options = {}) {
  if (!els.uploadStatusBar || !els.uploadStatusState || !els.uploadStatusText) return;
  const target = options.target || "primary";
  const card = uploadTargetCard(target);
  const visible = status !== "idle" && Boolean(text);
  els.uploadStatusBar.hidden = !visible;
  els.uploadStatusBar.classList.toggle("is-busy", status === "busy");
  els.uploadStatusBar.classList.toggle("is-ready", status === "ready");
  els.uploadStatusBar.classList.toggle("is-error", status === "error");
  els.uploadStatusState.textContent = status === "busy" ? "读取中" : status === "ready" ? "已读取" : status === "error" ? "失败" : "待上传";
  els.uploadStatusText.textContent = text || "";
  els.uploadStatusBar.dataset.target = target;
  ["primary", "reference"].forEach((item) => {
    const itemCard = uploadTargetCard(item);
    if (!itemCard) return;
    const active = item === target && visible;
    itemCard.classList.toggle("is-uploading", active && status === "busy");
    itemCard.classList.toggle("is-ready", active && status === "ready");
    itemCard.classList.toggle("is-error", active && status === "error");
    if (active && status === "busy") itemCard.setAttribute("aria-busy", "true");
    else itemCard.removeAttribute("aria-busy");
  });
}

async function handlePrimaryUpload(file) {
  if (!file) return;
  clearCanvasBranchAnchor();
  const lowerName = file.name.toLowerCase();
  const fileSizeText = formatUploadBytes(file.size);
  setUploadStatus("busy", `正在读取 ${file.name}${fileSizeText ? ` · ${fileSizeText}` : ""}，随后会压缩、识别并更新画布。`, { target: "primary" });

  if (state.mode === "cadrender" && lowerName.endsWith(".dwg")) {
    setUploadStatus("error", "DWG 暂不支持浏览器端直接解析，请先导出 DXF / SVG / PNG 后上传。", { target: "primary" });
    toast("浏览器端暂不直接解析 DWG，请先导出 DXF / SVG / PNG");
    return;
  }

  if (state.mode === "cadrender" && lowerName.endsWith(".dxf")) {
    setUploadStatus("busy", `正在解析 DXF：${file.name}`, { target: "primary" });
    const text = await file.text();
    const converted = dxfTextToImageDataUrl(text);
    state.primaryImageAnalysis = imageAnalysisResult({ key: "cad-screenshot", label: "CAD / DXF 图纸", suggestedMode: "cadrender", confidence: 0.95 }, {}, "DXF 文件已转换为可视化图纸");
    state.primaryImage = { name: file.name, type: "image/png", dataUrl: converted.dataUrl, sourceType: "dxf", lineCount: converted.lineCount, inputAnalysis: state.primaryImageAnalysis };
    state.primaryBitmap = await loadImage(converted.dataUrl);
    resetImageModelingAnalysis();
    state.selection = null;
    resetImageViewStates();
    openPlanDynamicControlForCurrentMode();
    setInputAdviceThinking(state.primaryImageAnalysis);
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();
    setUploadStatus("ready", `DXF 已解析：${converted.lineCount} 条线段，已作为当前 CAD 底图。`, { target: "primary" });
    toast(`已解析 DXF：${converted.lineCount} 条线段`);
    return;
  }

  if (state.mode === "cadrender" && lowerName.endsWith(".svg")) {
    setUploadStatus("busy", `正在转换 SVG：${file.name}`, { target: "primary" });
    const text = await file.text();
    const dataUrl = await svgTextToPngDataUrl(text);
    state.primaryImageAnalysis = imageAnalysisResult({ key: "cad-screenshot", label: "CAD / SVG 图纸", suggestedMode: "cadrender", confidence: 0.92 }, {}, "SVG 图纸已转换为可视化底图");
    state.primaryImage = { name: file.name, type: "image/png", dataUrl, sourceType: "svg", inputAnalysis: state.primaryImageAnalysis };
    state.primaryBitmap = await loadImage(dataUrl);
    resetImageModelingAnalysis();
    state.selection = null;
    resetImageViewStates();
    openPlanDynamicControlForCurrentMode();
    setInputAdviceThinking(state.primaryImageAnalysis);
    refreshGenerationControls();
    drawSelectionCanvas();
    renderWorkflowCanvas();
    setUploadStatus("ready", `SVG 已转换为可视化底图：${file.name}`, { target: "primary" });
    toast("已载入 SVG CAD 底图");
    return;
  }

  setUploadStatus("busy", `正在压缩并识别图片：${file.name}`, { target: "primary" });
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
  resetImageModelingAnalysis();
  state.selection = null;
  resetImageViewStates();
  openPlanDynamicControlForCurrentMode();
  setInputAdviceThinking(state.primaryImageAnalysis);
  refreshGenerationControls();
  drawSelectionCanvas();
  renderWorkflowCanvas();
  if (shouldWarnInputModeMismatch(state.primaryImageAnalysis)) {
    toast(`当前图片更像${state.primaryImageAnalysis.label}，建议使用“${suggestedModeLabel(state.primaryImageAnalysis.suggestedMode)}”。`);
  } else if (normalizeClientMode(state.mode) === "plan-axonometric") {
    const decision = planColorPipelineDecision();
    toast(decision.reason || "建议先生成彩色平面图，再进入轴测图和效果图链路");
  } else if (normalizeClientMode(state.mode) === "plan-axonometric-view") {
    toast(`已识别为：${state.primaryImageAnalysis.label}，可直接生成轴测图`);
  } else {
    toast(`已识别为：${state.primaryImageAnalysis.label}`);
  }
  setUploadStatus("ready", `已读取 ${file.name} · ${image.width}×${image.height} · 识别为 ${state.primaryImageAnalysis.label}。`, { target: "primary" });
}

async function processPrimaryImageInputSelection(source = "change") {
  const input = els.primaryImageInput;
  const file = input?.files?.[0];
  if (!file || primaryUploadProcessing) return;
  primaryUploadProcessing = true;
  try {
    await handlePrimaryUpload(file);
  } catch (error) {
    console.error(`[upload] primary image ${source} failed`, error);
    setUploadStatus("error", error?.message || "上传图片失败，请换一张图片或重新选择一次。", { target: "primary" });
    toast(error?.message || "上传图片失败，请换一张图片或重新选择一次");
  } finally {
    primaryUploadProcessing = false;
    if (input) input.value = "";
  }
}

async function handleReferenceUpload(files) {
  const incoming = Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));
  const remainingSlots = Math.max(0, referenceImageLimit - state.referenceImages.length);
  if (!incoming.length) {
    setUploadStatus("error", "请选择 PNG / JPG / WebP 等图片作为参考图。", { target: "reference" });
    toast("请选择图片作为参考图");
    return;
  }
  if (!remainingSlots) {
    setUploadStatus("error", `参考图最多上传 ${referenceImageLimit} 张，请先移除不需要的参考图。`, { target: "reference" });
    toast(`参考图最多上传 ${referenceImageLimit} 张`);
    return;
  }

  const selected = incoming.slice(0, remainingSlots);
  const startIndex = state.referenceImages.length;
  state.designSeriesAnalysis = null;
  setUploadStatus("busy", `正在读取 ${selected.length} 张参考图，最多保留 ${referenceImageLimit} 张。`, { target: "reference" });
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
  if (state.renders.length) ensureSessionCanvasBranchAnchor();
  refreshGenerationControls();
  renderReferenceStrip();
  renderWorkflowCanvas();
  toast(incoming.length > selected.length
    ? `已添加 ${selected.length} 张，参考图最多 ${referenceImageLimit} 张`
    : `已添加 ${selected.length} 张参考图`);
  setUploadStatus("ready", incoming.length > selected.length
    ? `已添加 ${selected.length} 张参考图；还有 ${incoming.length - selected.length} 张因数量上限未加入。`
    : `已添加 ${selected.length} 张参考图，当前共 ${state.referenceImages.length}/${referenceImageLimit} 张。`, { target: "reference" });
  if (selected.length === 1) {
    await focusReferenceImageForEditing(startIndex, { openEditor: true });
    toast("参考图已加入画布，已直接打开框选编辑");
  }
  if (state.mode === "designseries" && state.referenceImages.length) {
    analyzeDesignSeriesReferences();
  }
}

async function processReferenceImageInputSelection(source = "change") {
  const input = els.referenceImageInput;
  const files = Array.from(input?.files || []);
  if (!files.length || referenceUploadProcessing) return;
  referenceUploadProcessing = true;
  try {
    await handleReferenceUpload(files);
  } catch (error) {
    console.error(`[upload] reference image ${source} failed`, error);
    setUploadStatus("error", error?.message || "上传参考图失败，请换一张图片或重新选择一次。", { target: "reference" });
    toast(error?.message || "上传参考图失败，请换一张图片或重新选择一次");
  } finally {
    referenceUploadProcessing = false;
    if (input) input.value = "";
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
        <select class="reference-weight-select" name="${escapeAttr(`reference-${index + 1}-weight`)}" data-reference-weight="${index}" aria-label="参考图 ${index + 1} 权重">
          ${referenceWeightOptions.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === weight ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
        <select class="reference-usage-select" name="${escapeAttr(`reference-${index + 1}-usage`)}" data-reference-usage="${index}" aria-label="参考图 ${index + 1} 使用意图">
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

function normalizedModelingShapePoint(point) {
  const rawX = Array.isArray(point) ? point[0] : point?.x;
  const rawY = Array.isArray(point) ? point[1] : point?.y;
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp(x, 0, 1), clamp(y, 0, 1)];
}

function normalizedShapeNumber(value, fallback, min = 0, max = 1) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : fallback, min, max);
}

function modelingShapeFromAnalysis(analysis = {}) {
  const shape = analysis.targetShape || analysis.target_shape || null;
  const bounds = analysis.targetBounds || analysis.bounds || null;
  if (shape?.type === "polygon" || Array.isArray(shape?.points)) {
    const points = (shape.points || []).map(normalizedModelingShapePoint).filter(Boolean);
    if (points.length >= 3) return { type: "polygon", points };
  }
  if (shape?.type === "ellipse" || shape?.type === "circle" || shape?.type === "oval") {
    const fallbackCenterX = Number(bounds?.x || 0) + Number(bounds?.width || 1) / 2;
    const fallbackCenterY = Number(bounds?.y || 0) + Number(bounds?.height || 1) / 2;
    const fallbackRadiusX = Number(bounds?.width || 1) / 2;
    const fallbackRadiusY = Number(bounds?.height || 1) / 2;
    return {
      type: "ellipse",
      centerX: normalizedShapeNumber(shape.centerX ?? shape.cx, fallbackCenterX, 0, 1),
      centerY: normalizedShapeNumber(shape.centerY ?? shape.cy, fallbackCenterY, 0, 1),
      radiusX: normalizedShapeNumber(shape.radiusX ?? shape.rx ?? shape.radius, fallbackRadiusX, 0.001, 1),
      radiusY: normalizedShapeNumber(shape.radiusY ?? shape.ry ?? shape.radius, fallbackRadiusY, 0.001, 1)
    };
  }
  if (bounds && analysis.sourceType === "object-photo") {
    return {
      type: "ellipse",
      centerX: clamp(Number(bounds.x || 0) + Number(bounds.width || 1) / 2, 0, 1),
      centerY: clamp(Number(bounds.y || 0) + Number(bounds.height || 1) / 2, 0, 1),
      radiusX: clamp(Number(bounds.width || 1) / 2, 0.001, 1),
      radiusY: clamp(Number(bounds.height || 1) / 2, 0.001, 1)
    };
  }
  return bounds ? { type: "box", bounds } : null;
}

function drawModelingSubjectShape(ctx, analysis, imageBox, dpr) {
  const shape = modelingShapeFromAnalysis(analysis);
  if (!shape) return;
  const { dx, dy, drawWidth, drawHeight } = imageBox;
  const confirmed = hasConfirmedImageModelingSubject();
  const fill = confirmed ? "rgba(20, 121, 92, 0.14)" : "rgba(70, 145, 220, 0.16)";
  const stroke = confirmed ? "#14795c" : "#4691dc";
  let labelX = dx;
  let labelY = dy;

  const traceSubjectPath = () => {
    if (shape.type === "polygon") {
      const points = shape.points.map(([x, y]) => [dx + x * drawWidth, dy + y * drawHeight]);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      labelX = Math.min(...xs);
      labelY = Math.min(...ys);
      ctx.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
    } else if (shape.type === "ellipse") {
      const cx = dx + clamp(shape.centerX, 0, 1) * drawWidth;
      const cy = dy + clamp(shape.centerY, 0, 1) * drawHeight;
      const rx = clamp(shape.radiusX, 0.001, 1) * drawWidth;
      const ry = clamp(shape.radiusY, 0.001, 1) * drawHeight;
      labelX = cx - rx;
      labelY = cy - ry;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else {
      const bounds = shape.bounds || analysis.targetBounds;
      const x = dx + clamp(bounds.x || 0, 0, 1) * drawWidth;
      const y = dy + clamp(bounds.y || 0, 0, 1) * drawHeight;
      const w = clamp(bounds.width || 1, 0.001, 1) * drawWidth;
      const h = clamp(bounds.height || 1, 0.001, 1) * drawHeight;
      labelX = x;
      labelY = y;
      ctx.rect(x, y, w, h);
    }
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, drawWidth, drawHeight);
  traceSubjectPath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fill("evenodd");
  ctx.restore();

  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  traceSubjectPath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = confirmed ? "rgba(20, 121, 92, 0.92)" : "rgba(32, 92, 168, 0.92)";
  ctx.font = `${Math.max(12, 12 * dpr)}px sans-serif`;
  const subject = String(analysis?.subject || "主体").replace(/\s+/g, "").slice(0, 6) || "主体";
  const label = `辅助${subject}轮廓`;
  const labelWidth = ctx.measureText(label).width + 14 * dpr;
  const clampedX = clamp(labelX, 0, imageBox.width - labelWidth);
  const clampedY = Math.max(0, labelY - 24 * dpr);
  ctx.fillRect(clampedX, clampedY, labelWidth, 22 * dpr);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, clampedX + 7 * dpr, Math.max(14 * dpr, clampedY + 16 * dpr));
  ctx.restore();
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
    renderPlanAngleSyncBlock();
    els.emptyCanvasHint.hidden = false;
    els.emptyCanvasHint.textContent = normalizeClientMode(state.mode) === "plan-render"
      ? "上传轴测图后，请框选要生成效果图的区域"
      : normalizeClientMode(state.mode) === "image-modeling"
        ? "上传图片后可直接生成 CAD 线稿"
        : "上传图片后可拖拽框选局部区域";
    return;
  }

  const normalizedMode = normalizeClientMode(state.mode);
  const showRegionHint = (normalizedMode === "plan-render" || (normalizedMode === "image-modeling" && !hasConfirmedImageModelingSubject())) && !state.selection;
  els.emptyCanvasHint.hidden = !showRegionHint;
  if (showRegionHint) {
    els.emptyCanvasHint.textContent = normalizedMode === "image-modeling"
      ? "框选为可选辅助；也可以直接生成 CAD"
      : "建议框选要生成效果图的区域；不框选则自动选择与参考图最接近的区域";
  }
  renderPlanAngleSyncBlock();
  const image = state.primaryBitmap;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  state.canvasImageBox = { dx, dy, drawWidth, drawHeight, width, height };
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);

  const modelingAnalysis = normalizedMode === "image-modeling" ? currentImageModelingAnalysis() : null;
  if (modelingAnalysis) drawModelingSubjectShape(ctx, modelingAnalysis, state.canvasImageBox, dpr);

  if (state.selection) {
    const x = dx + state.selection.x * drawWidth;
    const y = dy + state.selection.y * drawHeight;
    const w = state.selection.width * drawWidth;
    const h = state.selection.height * drawHeight;
    ctx.fillStyle = normalizedMode === "image-modeling" ? "rgba(70, 145, 220, 0.16)" : "rgba(212, 175, 55, 0.16)";
    ctx.strokeStyle = normalizedMode === "image-modeling" ? "#4691dc" : "#d4af37";
    ctx.lineWidth = 2 * dpr;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    if (normalizedMode === "image-modeling") {
      ctx.save();
      ctx.fillStyle = "rgba(32, 92, 168, 0.9)";
      ctx.font = `${Math.max(12, 12 * dpr)}px sans-serif`;
      const label = modelingAnalysis ? "辅助框" : "可选框选";
      const labelWidth = ctx.measureText(label).width + 14 * dpr;
      const lx = clamp(x, 0, width - labelWidth);
      const ly = Math.max(0, y - 24 * dpr);
      ctx.fillRect(lx, ly, labelWidth, 22 * dpr);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx + 7 * dpr, Math.max(14 * dpr, ly + 16 * dpr));
      ctx.restore();
    }
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
  const panorama = isPanoramaOutput(state.render);
  if (!state.render?.url) {
    els.renderResult.hidden = true;
    els.renderResultImage.removeAttribute("src");
    els.renderResultImage.hidden = false;
    if (els.renderResultPanorama) {
      els.renderResultPanorama.hidden = true;
      els.renderResultPanorama.removeAttribute("data-panorama-url");
      destroyPanoramaViewer(panoramaViewerKey("result", "renderResultPanorama"));
    }
    els.renderResultLink.href = "#";
    els.continueEditButton.disabled = true;
    refreshGenerationControls();
    return;
  }
  els.renderResult.hidden = false;
  els.continueEditButton.disabled = false;
  els.renderResultTitle.textContent = state.render.title || modeConfig(state.mode).resultTitle || `${modeConfig(state.mode).sourceTitle}生成结果`;
  if (panorama && els.renderResultPanorama) {
    els.renderResultImage.removeAttribute("src");
    els.renderResultImage.hidden = true;
    els.renderResultPanorama.hidden = false;
    els.renderResultPanorama.dataset.panoramaViewer = "renderResultPanorama";
    els.renderResultPanorama.dataset.panoramaUrl = state.render.url;
    els.renderResultPanorama.dataset.hint = PANORAMA_CANVAS_HINT;
    mountPanoramaViewers(els.renderResult, "result");
  } else {
    els.renderResultImage.hidden = false;
    els.renderResultImage.src = state.render.url;
    if (els.renderResultPanorama) {
      els.renderResultPanorama.hidden = true;
      els.renderResultPanorama.removeAttribute("data-panorama-url");
      destroyPanoramaViewer(panoramaViewerKey("result", "renderResultPanorama"));
    }
  }
  els.renderResultLink.href = state.render.url;
  refreshGenerationControls();
  renderWorkflowCanvas();
}

function extractCadFromBitmap(image, projectName, options = {}) {
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const dark = buildCadInkMask(pixels, width, height);

  const minDim = Math.min(width, height);
  const minRun = Math.max(72, Math.round(minDim * 0.12));
  const maxMisses = Math.max(4, Math.round(Math.min(width, height) * 0.008));
  const horizontal = findRuns(dark, width, height, "h", minRun, { maxMisses, minDensity: 0.68 });
  const vertical = findRuns(dark, width, height, "v", minRun, { maxMisses, minDensity: 0.68 });
  const tracedLines = traceCadLinework(thinCadInkMask(dark, width, height), width, height, {
    minLength: Math.max(10, Math.round(minDim * 0.012)),
    simplifyTolerance: Math.max(1.8, minDim * 0.0024),
    maxLines: 2200
  });
  const houghLines = tracedLines.length >= 32
    ? []
    : findHoughCadLineSegments(dark, width, height, {
        minLength: Math.max(30, Math.round(minDim * 0.035)),
        maxGap: Math.max(4, Math.round(minDim * 0.006)),
        maxLines: 900
      });
  const rawLines = filterCadLines(
    mergeCadSegments([...mergeLines([...horizontal, ...vertical], 8), ...tracedLines, ...houghLines], 5, 8),
    width,
    height,
    { minLength: Math.max(28, Math.round(minDim * 0.03)) }
  ).slice(0, 1800);
  const lines = standardizeCadLines(rawLines, width, height, {
    minLength: Math.max(34, Math.round(minDim * 0.035)),
    snapTolerance: Math.max(7, Math.round(minDim * 0.009)),
    mergeGap: Math.max(10, Math.round(minDim * 0.012))
  });
  if (!lines.length) throw new Error("没有识别到足够清晰的图纸线段");

  const svg = buildCadSvg(lines, width, height);
  const previewSvg = buildCadPreviewSvg(lines, width, height, {
    title: options.title || "CAD",
    sourceLabel: options.sourceLabel || "原始图片"
  });
  const dxf = buildDxf(lines, width, height);
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const previewSvgUrl = URL.createObjectURL(new Blob([previewSvg], { type: "image/svg+xml" }));
  const dxfUrl = URL.createObjectURL(new Blob([dxf], { type: "application/dxf" }));
  const id = `cad-${Date.now()}`;
  return {
    id,
    title: options.title || "平面图 CAD",
    mode: options.mode || "cad",
    sourceLabel: options.sourceLabel || "原始图片",
    svg,
    previewSvg,
    svgUrl,
    previewSvgUrl,
    dxfUrl,
    lineCount: lines.length,
    rawLineCount: rawLines.length,
    extractionMethod: tracedLines.length ? "skeleton-linework" : (houghLines.length ? "hough-linework" : "axis-runs"),
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

function normalizeColorGradeAdjustments(adjustments = {}) {
  return Object.fromEntries(Object.keys(defaultColorGradeAdjustments).map((key) => [
    key,
    Math.round(clamp(Number(adjustments[key]) || 0, -100, 100))
  ]));
}

function colorGradeSummaryText(adjustments = {}) {
  const normalized = normalizeColorGradeAdjustments(adjustments);
  const parts = Object.entries(normalized)
    .filter(([, value]) => value)
    .map(([key, value]) => `${colorGradeFieldLabels[key] || key} ${value > 0 ? "+" : ""}${value}`);
  return parts.length ? parts.join("，") : "默认参数";
}

function localColorGradeImage(image, name, adjustments = {}) {
  const maxDim = 2400;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
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
  const normalized = normalizeColorGradeAdjustments(adjustments);
  applyColorGradeToImageData(src, width, height, normalized);
  ctx.putImageData(src, 0, 0);
  return {
    id: `colorgrade-${Date.now()}`,
    title: "调色结果",
    url: canvas.toDataURL("image/png"),
    mode: "colorgrade",
    adjustments: normalized,
    intent: `本地调色：${colorGradeSummaryText(normalized)}`,
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    fileBase: slugForFile(name || "color-grade")
  };
}

function applyColorGradeToImageData(imageData, width, height, adjustments = {}) {
  const a = normalizeColorGradeAdjustments(adjustments);
  const data = imageData.data;
  const exposure = Math.pow(2, a.exposure / 100);
  const contrast = 1 + a.contrast * 0.008;
  const light = a.light * 0.72;
  const temp = a.temperature;
  const tint = a.tint;
  const saturation = 1 + a.saturation * 0.009;
  const clarityAmount = a.clarity / 100;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 2) continue;
    let r = data[i] * exposure;
    let g = data[i + 1] * exposure;
    let b = data[i + 2] * exposure;
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    const highWeight = smoothstep(118, 255, luma);
    const shadowWeight = 1 - smoothstep(0, 150, luma);
    const whiteWeight = smoothstep(180, 255, luma);
    const blackWeight = 1 - smoothstep(0, 95, luma);
    const toneShift =
      light +
      a.highlights * 0.78 * highWeight +
      a.shadows * 0.82 * shadowWeight +
      a.whites * 0.62 * whiteWeight -
      a.blacks * 0.64 * blackWeight;
    r = (r + toneShift - 128) * contrast + 128;
    g = (g + toneShift - 128) * contrast + 128;
    b = (b + toneShift - 128) * contrast + 128;

    r += temp * 0.42 + tint * 0.16;
    g -= tint * 0.26;
    b -= temp * 0.42 + tint * -0.16;

    const nextLuma = r * 0.299 + g * 0.587 + b * 0.114;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const currentSat = clamp((max - min) / 255, 0, 1);
    const vibrance = 1 + (a.vibrance / 100) * (1 - currentSat) * 0.86;
    const satScale = saturation * vibrance;
    r = nextLuma + (r - nextLuma) * satScale;
    g = nextLuma + (g - nextLuma) * satScale;
    b = nextLuma + (b - nextLuma) * satScale;

    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
  }

  if (clarityAmount > 0.01) {
    const sharpened = unsharpImageData(data, width, height, clarityAmount * 0.72);
    data.set(sharpened);
  } else if (clarityAmount < -0.01) {
    const softened = smoothImageData(data, width, height, Math.min(0.62, Math.abs(clarityAmount) * 0.52));
    data.set(softened);
  }
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(1, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildCutoutAnalysis(image) {
  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(32, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(32, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const total = width * height;
  const luma = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    luma[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
  }
  const edge = sobelLumaEdges(luma, width, height);
  const borderMean = cutoutBorderMean(data, width, height);
  const background = edgeAwareBackgroundMask(data, luma, edge, width, height, borderMean);
  const candidates = foregroundComponentsFromBackground(data, background, width, height)
    .sort((a, b) => b.area - a.area)
    .slice(0, 8);
  if (!candidates.length) {
    candidates.push(fallbackCutoutCandidate(data, width, height));
  }
  candidates.forEach((candidate, index) => {
    candidate.id = candidate.id || `layer-${index + 1}`;
    candidate.label = `图层 ${index + 1}`;
  });
  return { width, height, data, luma, edge, candidates, method: "local" };
}

function buildAiGuidedCutoutAnalysis(image, aiAnalysis = {}) {
  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(32, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(32, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const total = width * height;
  const luma = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    luma[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
  }
  const edge = sobelLumaEdges(luma, width, height);
  const rawMask = maskFromAiCutoutPolygons(aiAnalysis, width, height);
  const mask = refineAiCutoutMask(rawMask, data, width, height);
  const bounds = boundsFromMask(mask, width, height);
  if (!bounds || bounds.area < Math.max(90, Math.round(total * 0.002))) {
    const fallback = buildCutoutAnalysis(image);
    return { ...fallback, method: "local", ai: aiAnalysis };
  }
  const candidate = {
    id: "ai-main-subject",
    label: aiAnalysis.subject || "AI 主体",
    mask,
    area: bounds.area,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    confidence: aiAnalysis.confidence || 0,
    source: "ai"
  };
  return {
    width,
    height,
    data,
    luma,
    edge,
    candidates: [candidate],
    ai: aiAnalysis,
    method: "ai"
  };
}

function maskFromAiCutoutPolygons(aiAnalysis = {}, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  const polygons = Array.isArray(aiAnalysis.polygons) ? aiAnalysis.polygons : [];
  for (const polygon of polygons) {
    const points = normalizeAiCutoutPoints(polygon.points, width, height);
    if (points.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fill();
  }
  const holes = Array.isArray(aiAnalysis.holes) ? aiAnalysis.holes : [];
  if (holes.length) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    for (const hole of holes) {
      const points = normalizeAiCutoutPoints(hole.points || hole, width, height);
      if (points.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  const hasPolygon = polygons.some((polygon) => normalizeAiCutoutPoints(polygon.points, width, height).length >= 3);
  if (!hasPolygon && aiAnalysis.bounds) {
    const x = clamp(Math.round((Number(aiAnalysis.bounds.x) || 0) * width), 0, width - 1);
    const y = clamp(Math.round((Number(aiAnalysis.bounds.y) || 0) * height), 0, height - 1);
    const w = clamp(Math.round((Number(aiAnalysis.bounds.width) || 1) * width), 1, width - x);
    const h = clamp(Math.round((Number(aiAnalysis.bounds.height) || 1) * height), 1, height - y);
    ctx.fillRect(x, y, w, h);
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = imageData.data[i * 4 + 3] > 0 ? 1 : 0;
  return mask;
}

function normalizeAiCutoutPoints(points = [], width, height) {
  if (!Array.isArray(points)) return [];
  return points.map((point) => {
    const rawX = Array.isArray(point) ? point[0] : point?.x;
    const rawY = Array.isArray(point) ? point[1] : point?.y;
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [
      clamp(x > 1 ? x : x * width, 0, width - 1),
      clamp(y > 1 ? y : y * height, 0, height - 1)
    ];
  }).filter(Boolean);
}

function refineAiCutoutMask(mask, data, width, height) {
  const closed = closeMask(mask, width, height);
  const eroded = erodeMask(closed, width, height, 2);
  const dilated = dilateMask(closed, width, height, 8);
  const foreground = meanColorForMask(data, eroded, true) || meanColorForMask(data, closed, true);
  const background = meanColorForMask(data, dilated, false) || [255, 255, 255];
  if (!foreground || !background) return closed;
  const refined = new Uint8Array(closed.length);
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i]) continue;
    const boundary = !eroded[i];
    if (!boundary) {
      refined[i] = 1;
      continue;
    }
    const fgDistance = pixelDistanceToColor(data, i, foreground);
    const bgDistance = pixelDistanceToColor(data, i, background);
    refined[i] = bgDistance + 10 < fgDistance ? 0 : 1;
  }
  return closeMask(refined, width, height);
}

function boundsFromMask(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    area += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!area) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area };
}

function erodeMask(mask, width, height, radius = 1) {
  let current = new Uint8Array(mask);
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!current[i]) continue;
        let keep = 1;
        for (let ky = -1; ky <= 1 && keep; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height || !current[ny * width + nx]) {
              keep = 0;
              break;
            }
          }
        }
        next[i] = keep;
      }
    }
    current = next;
  }
  return current;
}

function dilateMask(mask, width, height, radius = 1) {
  let current = new Uint8Array(mask);
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(current);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!current[i]) continue;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) next[ny * width + nx] = 1;
          }
        }
      }
    }
    current = next;
  }
  return current;
}

function meanColorForMask(data, mask, include = true) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(mask.length / 30000));
  for (let i = 0; i < mask.length; i += step) {
    if (Boolean(mask[i]) !== include) continue;
    const idx = i * 4;
    if (data[idx + 3] < 20) continue;
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
    count += 1;
  }
  return count ? [r / count, g / count, b / count] : null;
}

function sobelLumaEdges(luma, width, height) {
  const edge = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -luma[i - width - 1] - luma[i - 1] * 2 - luma[i + width - 1] +
        luma[i - width + 1] + luma[i + 1] * 2 + luma[i + width + 1];
      const gy =
        -luma[i - width - 1] - luma[i - width] * 2 - luma[i - width + 1] +
        luma[i + width - 1] + luma[i + width] * 2 + luma[i + width + 1];
      edge[i] = clampByte(Math.sqrt(gx * gx + gy * gy) / 4);
    }
  }
  return edge;
}

function cutoutBorderMean(data, width, height) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const add = (x, y) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < 20) return;
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
    count += 1;
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }
  return count ? [r / count, g / count, b / count] : [255, 255, 255];
}

function edgeAwareBackgroundMask(data, luma, edge, width, height, borderMean) {
  const total = width * height;
  const background = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const push = (index) => {
    if (visited[index]) return;
    visited[index] = 1;
    background[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  const offsets = [-1, 1, -width, width];
  while (head < tail) {
    const current = queue[head++];
    const cx = current % width;
    for (const offset of offsets) {
      const next = current + offset;
      if (next < 0 || next >= total || visited[next]) continue;
      const nx = next % width;
      if ((offset === -1 && cx === 0) || (offset === 1 && cx === width - 1)) continue;
      const nextIdx = next * 4;
      if (data[nextIdx + 3] < 24) {
        push(next);
        continue;
      }
      const d = pixelDistance(data, current, next);
      const borderD = pixelDistanceToColor(data, next, borderMean);
      const ldiff = Math.abs(luma[current] - luma[next]);
      const hardEdge = edge[next] > 72 && d > 18;
      const allowed = !hardEdge && (d < 44 || ldiff < 18 || (borderD < 58 && edge[next] < 92));
      if (allowed) push(next);
    }
  }
  return background;
}

function foregroundComponentsFromBackground(data, background, width, height) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const candidates = [];
  const queue = new Int32Array(total);
  const minArea = Math.max(90, Math.round(total * 0.003));
  const maxArea = Math.round(total * 0.94);
  const offsets = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];
  for (let start = 0; start < total; start++) {
    if (visited[start] || background[start] || data[start * 4 + 3] < 20) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    const mask = new Uint8Array(total);
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      mask[current] = 1;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const offset of offsets) {
        const next = current + offset;
        if (next < 0 || next >= total || visited[next] || background[next] || data[next * 4 + 3] < 20) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (area >= minArea && area <= maxArea) {
      candidates.push({
        id: `layer-${candidates.length + 1}`,
        mask: closeMask(mask, width, height),
        area,
        bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      });
    }
  }
  return candidates;
}

function fallbackCutoutCandidate(data, width, height) {
  const total = width * height;
  const mask = new Uint8Array(total);
  let area = 0;
  const padX = Math.round(width * 0.12);
  const padY = Math.round(height * 0.12);
  for (let y = padY; y < height - padY; y++) {
    for (let x = padX; x < width - padX; x++) {
      const i = y * width + x;
      if (data[i * 4 + 3] < 20) continue;
      mask[i] = 1;
      area += 1;
    }
  }
  return {
    id: "layer-center",
    mask,
    area,
    bounds: { x: padX, y: padY, width: width - padX * 2, height: height - padY * 2 }
  };
}

function localCutoutImage(image, name, candidate, analysis) {
  const maxDim = 2400;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const baseCtx = base.getContext("2d", { willReadFrequently: true });
  baseCtx.imageSmoothingEnabled = true;
  baseCtx.imageSmoothingQuality = "high";
  baseCtx.drawImage(image, 0, 0, width, height);
  const sx = width / analysis.width;
  const sy = height / analysis.height;
  const pad = 10;
  const cropX = Math.max(0, Math.floor(candidate.bounds.x * sx) - pad);
  const cropY = Math.max(0, Math.floor(candidate.bounds.y * sy) - pad);
  const cropRight = Math.min(width, Math.ceil((candidate.bounds.x + candidate.bounds.width) * sx) + pad);
  const cropBottom = Math.min(height, Math.ceil((candidate.bounds.y + candidate.bounds.height) * sy) + pad);
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);
  const out = document.createElement("canvas");
  out.width = cropWidth;
  out.height = cropHeight;
  const outCtx = out.getContext("2d", { willReadFrequently: true });
  outCtx.drawImage(base, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const outData = outCtx.getImageData(0, 0, cropWidth, cropHeight);
  const softMask = featherMask(candidate.mask, analysis.width, analysis.height, 2);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const sourceX = clamp(Math.round(((cropX + x) / width) * analysis.width), 0, analysis.width - 1);
      const sourceY = clamp(Math.round(((cropY + y) / height) * analysis.height), 0, analysis.height - 1);
      const alpha = softMask[sourceY * analysis.width + sourceX] / 255;
      const idx = (y * cropWidth + x) * 4 + 3;
      outData.data[idx] = clampByte(outData.data[idx] * alpha);
    }
  }
  outCtx.putImageData(outData, 0, 0);
  return {
    id: `cutout-${Date.now()}`,
    title: "抠图结果",
    url: out.toDataURL("image/png"),
    mode: "cutout",
    intent: analysis.method === "ai" ? "AI 视觉主体轮廓抠图：透明背景 PNG" : "本地智能抠图：透明背景 PNG",
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    fileBase: slugForFile(name || "cutout")
  };
}

function closeMask(mask, width, height) {
  const expanded = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) expanded[ny * width + nx] = 1;
        }
      }
    }
  }
  return expanded;
}

function featherMask(mask, width, height, iterations = 1) {
  let current = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) current[i] = mask[i] ? 255 : 0;
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8ClampedArray(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            sum += current[ny * width + nx];
            count += 1;
          }
        }
        next[y * width + x] = Math.round(sum / Math.max(1, count));
      }
    }
    current = next;
  }
  return current;
}

function pixelDistance(data, a, b) {
  const ai = a * 4;
  const bi = b * 4;
  const dr = data[ai] - data[bi];
  const dg = data[ai + 1] - data[bi + 1];
  const db = data[ai + 2] - data[bi + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function pixelDistanceToColor(data, index, color) {
  const i = index * 4;
  const dr = data[i] - color[0];
  const dg = data[i + 1] - color[1];
  const db = data[i + 2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
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

function findRuns(dark, width, height, orientation, minRun, options = {}) {
  const lines = [];
  const outer = orientation === "h" ? height : width;
  const inner = orientation === "h" ? width : height;
  const maxMisses = Math.max(2, Number(options.maxMisses || 4));
  const minDensity = clamp(Number(options.minDensity || 0.68), 0.2, 1);
  for (let o = 0; o < outer; o++) {
    let start = -1;
    let misses = 0;
    let darkCount = 0;
    const pushRun = (end) => {
      const span = end - start + 1;
      if (span >= minRun && darkCount / Math.max(1, span) >= minDensity) {
        lines.push(orientation === "h"
          ? { x1: start, y1: o, x2: end, y2: o }
          : { x1: o, y1: start, x2: o, y2: end });
      }
    };
    for (let i = 0; i < inner; i++) {
      const x = orientation === "h" ? i : o;
      const y = orientation === "h" ? o : i;
      const isDark = dark[y * width + x] === 1;
      if (isDark && start < 0) {
        start = i;
        misses = 0;
        darkCount = 1;
      } else if (!isDark && start >= 0) {
        misses += 1;
        if (misses > maxMisses) {
          pushRun(i - misses);
          start = -1;
          misses = 0;
          darkCount = 0;
        }
      } else if (isDark) {
        misses = 0;
        darkCount += 1;
      }
    }
    if (start >= 0 && inner - start >= minRun) {
      pushRun(inner - 1);
    }
  }
  return lines;
}

function buildCadInkMask(pixels, width, height) {
  const samplePoints = [
    [0.04, 0.04],
    [0.5, 0.04],
    [0.96, 0.04],
    [0.04, 0.5],
    [0.96, 0.5],
    [0.04, 0.96],
    [0.5, 0.96],
    [0.96, 0.96]
  ];
  const samples = samplePoints.map(([px, py]) => {
    const x = clamp(Math.round(px * (width - 1)), 0, width - 1);
    const y = clamp(Math.round(py * (height - 1)), 0, height - 1);
    const i = (y * width + x) * 4;
    return pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
  }).sort((a, b) => a - b);
  const background = samples[Math.floor(samples.length / 2)] || 255;
  const lightBackground = background >= 128;
  const threshold = lightBackground
    ? clamp(background - 26, 142, 232)
    : clamp(background + 34, 42, 196);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] <= 20) continue;
      const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      mask[y * width + x] = lightBackground ? (luma < threshold ? 1 : 0) : (luma > threshold ? 1 : 0);
    }
  }
  return mask;
}

function findHoughCadLineSegments(mask, width, height, options = {}) {
  const minDim = Math.min(width, height);
  const minLength = Math.max(20, Number(options.minLength || Math.round(minDim * 0.04)));
  const maxGap = Math.max(3, Number(options.maxGap || Math.round(minDim * 0.01)));
  const maxLines = Math.max(100, Number(options.maxLines || 1200));
  const points = [];
  const stride = width * height > 1200 * 1200 ? 2 : 1;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (!mask[y * width + x]) continue;
      points.push([x, y]);
    }
  }
  if (points.length < minLength) return [];

  const maxPoints = 52000;
  const pointStep = Math.max(1, Math.ceil(points.length / maxPoints));
  const sampledPoints = pointStep === 1 ? points : points.filter((_, index) => index % pointStep === 0);
  const thetaStep = 1;
  const thetaCount = Math.ceil(180 / thetaStep);
  const diag = Math.ceil(Math.hypot(width, height));
  const rhoCount = diag * 2 + 1;
  const accumulator = new Uint16Array(thetaCount * rhoCount);
  const trig = [];
  for (let thetaIndex = 0; thetaIndex < thetaCount; thetaIndex++) {
    const degrees = thetaIndex * thetaStep;
    const radians = degrees * Math.PI / 180;
    trig.push({ degrees, radians, cos: Math.cos(radians), sin: Math.sin(radians) });
  }
  for (const [x, y] of sampledPoints) {
    for (let thetaIndex = 0; thetaIndex < thetaCount; thetaIndex++) {
      const t = trig[thetaIndex];
      const rho = Math.round(x * t.cos + y * t.sin) + diag;
      accumulator[thetaIndex * rhoCount + rho] += 1;
    }
  }

  const voteScale = Math.max(1, pointStep / stride);
  const minVotes = Math.max(22, Math.round(minLength * 0.42 / voteScale));
  const candidates = [];
  for (let thetaIndex = 0; thetaIndex < thetaCount; thetaIndex++) {
    const row = thetaIndex * rhoCount;
    for (let rho = 1; rho < rhoCount - 1; rho++) {
      const votes = accumulator[row + rho];
      if (votes < minVotes) continue;
      if (votes < accumulator[row + rho - 1] || votes < accumulator[row + rho + 1]) continue;
      candidates.push({
        ...trig[thetaIndex],
        rho: rho - diag,
        votes
      });
    }
  }

  candidates.sort((a, b) => b.votes - a.votes);
  const peaks = [];
  for (const candidate of candidates) {
    if (peaks.length >= 520) break;
    const duplicate = peaks.some((peak) => (
      Math.abs(angleDelta180(peak.degrees, candidate.degrees)) <= 2 &&
      Math.abs(peak.rho - candidate.rho) <= Math.max(5, minDim * 0.007)
    ));
    if (!duplicate) peaks.push(candidate);
  }

  const segments = [];
  for (const peak of peaks) {
    const next = segmentsOnHoughLine(mask, width, height, peak, {
      minLength,
      maxGap,
      minDensity: 0.24
    });
    segments.push(...next);
    if (segments.length >= maxLines * 1.4) break;
  }
  return mergeCadSegments(segments, 5, Math.max(6, Math.round(minDim * 0.012))).slice(0, maxLines);
}

function thinCadInkMask(mask, width, height) {
  let current = new Uint8Array(mask);
  const index = (x, y) => y * width + x;
  let changed = true;
  let iterations = 0;
  const maxIterations = 70;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;
    for (let pass = 0; pass < 2; pass++) {
      const remove = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = index(x, y);
          if (!current[i]) continue;
          const p2 = current[index(x, y - 1)];
          const p3 = current[index(x + 1, y - 1)];
          const p4 = current[index(x + 1, y)];
          const p5 = current[index(x + 1, y + 1)];
          const p6 = current[index(x, y + 1)];
          const p7 = current[index(x - 1, y + 1)];
          const p8 = current[index(x - 1, y)];
          const p9 = current[index(x - 1, y - 1)];
          const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (neighbors < 2 || neighbors > 6) continue;
          const transitions = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
            (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (transitions !== 1) continue;
          if (pass === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          remove.push(i);
        }
      }
      if (remove.length) {
        changed = true;
        remove.forEach((i) => { current[i] = 0; });
      }
    }
  }
  return current;
}

function traceCadLinework(skeleton, width, height, options = {}) {
  const minLength = Math.max(4, Number(options.minLength || 12));
  const tolerance = Math.max(0.5, Number(options.simplifyTolerance || 2));
  const maxLines = Math.max(100, Number(options.maxLines || 1800));
  const total = width * height;
  const degree = new Uint8Array(total);
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
  ];
  const neighborsFor = (indexValue) => {
    const x = indexValue % width;
    const y = Math.floor(indexValue / width);
    const neighbors = [];
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (skeleton[ni]) neighbors.push(ni);
    }
    return neighbors;
  };

  for (let i = 0; i < total; i++) {
    if (skeleton[i]) degree[i] = neighborsFor(i).length;
  }

  const visitedEdges = new Set();
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const pointFromIndex = (i) => ({ x: i % width, y: Math.floor(i / width) });
  const lines = [];

  const addPolyline = (indexes) => {
    if (indexes.length < 2) return;
    const points = indexes.map(pointFromIndex);
    const simplified = simplifyPolyline(points, tolerance);
    for (let i = 0; i < simplified.length - 1; i++) {
      const a = simplified[i];
      const b = simplified[i + 1];
      const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      if (lineLength(line) >= minLength) lines.push(line);
    }
  };

  const walk = (start, next) => {
    const indexes = [start];
    let previous = start;
    let current = next;
    visitedEdges.add(edgeKey(previous, current));
    while (true) {
      indexes.push(current);
      if (degree[current] !== 2) break;
      const neighbors = neighborsFor(current).filter((candidate) => candidate !== previous);
      const nextIndex = neighbors.find((candidate) => !visitedEdges.has(edgeKey(current, candidate))) ?? neighbors[0];
      if (nextIndex === undefined || visitedEdges.has(edgeKey(current, nextIndex))) break;
      previous = current;
      current = nextIndex;
      visitedEdges.add(edgeKey(previous, current));
      if (indexes.length > total) break;
    }
    addPolyline(indexes);
  };

  for (let i = 0; i < total; i++) {
    if (!skeleton[i] || degree[i] === 0 || degree[i] === 2) continue;
    for (const neighbor of neighborsFor(i)) {
      if (!visitedEdges.has(edgeKey(i, neighbor))) walk(i, neighbor);
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    }
  }

  for (let i = 0; i < total; i++) {
    if (!skeleton[i] || degree[i] !== 2) continue;
    const neighbors = neighborsFor(i);
    const startNeighbor = neighbors.find((neighbor) => !visitedEdges.has(edgeKey(i, neighbor)));
    if (startNeighbor === undefined) continue;
    walk(i, startNeighbor);
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }

  return lines.slice(0, maxLines);
}

function simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDistance = 0;
    let split = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = pointLineDistance(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        split = i;
      }
    }
    if (split > -1 && maxDistance > tolerance) {
      keep[split] = 1;
      stack.push([start, split], [split, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

function segmentsOnHoughLine(mask, width, height, line, options = {}) {
  const minLength = Number(options.minLength || 32);
  const maxGap = Number(options.maxGap || 8);
  const minDensity = clamp(Number(options.minDensity || 0.24), 0.05, 1);
  const directionX = -line.sin;
  const directionY = line.cos;
  const diag = Math.hypot(width, height);
  const segments = [];
  let startT = null;
  let lastHitT = null;
  let hitCount = 0;
  let missCount = 0;

  const pushSegment = () => {
    if (startT === null || lastHitT === null) return;
    const length = lastHitT - startT;
    const density = hitCount / Math.max(1, length + 1);
    if (length >= minLength && density >= minDensity) {
      const x1 = line.rho * line.cos + startT * directionX;
      const y1 = line.rho * line.sin + startT * directionY;
      const x2 = line.rho * line.cos + lastHitT * directionX;
      const y2 = line.rho * line.sin + lastHitT * directionY;
      segments.push({
        x1: round2(clamp(x1, 0, width - 1)),
        y1: round2(clamp(y1, 0, height - 1)),
        x2: round2(clamp(x2, 0, width - 1)),
        y2: round2(clamp(y2, 0, height - 1))
      });
    }
  };

  for (let t = -diag; t <= diag; t += 1) {
    const x = Math.round(line.rho * line.cos + t * directionX);
    const y = Math.round(line.rho * line.sin + t * directionY);
    const inside = x >= 0 && x < width && y >= 0 && y < height;
    const hit = inside && maskHasPixelNear(mask, width, height, x, y, 1);
    if (hit) {
      if (startT === null) startT = t;
      lastHitT = t;
      hitCount += 1;
      missCount = 0;
    } else if (startT !== null) {
      missCount += 1;
      if (missCount > maxGap || !inside) {
        pushSegment();
        startT = null;
        lastHitT = null;
        hitCount = 0;
        missCount = 0;
      }
    }
  }
  pushSegment();
  return segments;
}

function maskHasPixelNear(mask, width, height, x, y, radius = 1) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) return true;
    }
  }
  return false;
}

function filterCadLines(lines, width, height, options = {}) {
  const minLength = Math.max(1, Number(options.minLength || Math.max(72, Math.round(Math.min(width, height) * 0.105))));
  const maxLength = Math.max(width, height) * 1.2;
  return lines
    .map((line) => {
      const length = lineLength(line);
      return { ...line, length };
    })
    .filter((line) => line.length >= minLength && line.length <= maxLength)
    .filter((line) => {
      const inset = Math.round(Math.min(width, height) * 0.012);
      const coordinates = [line.x1, line.y1, line.x2, line.y2];
      if (!coordinates.every(Number.isFinite)) return false;
      const inside = coordinates.every((value, index) => index % 2 === 0
        ? value >= -inset && value <= width + inset
        : value >= -inset && value <= height + inset);
      const touchesImageEdge = coordinates.some((value, index) => index % 2 === 0
        ? value <= inset || value >= width - inset
        : value <= inset || value >= height - inset);
      return inside && (!touchesImageEdge || line.length > minLength * 1.45);
    })
    .sort((a, b) => b.length - a.length)
    .map(({ length, ...line }) => line);
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

function mergeCadSegments(lines, angleTolerance = 5, gapTolerance = 10) {
  const normalized = lines
    .map((line) => normalizeCadSegment(line))
    .filter((line) => line.length > 0)
    .sort((a, b) => a.normalAngle - b.normalAngle || a.rho - b.rho || a.t1 - b.t1);
  const merged = [];
  for (const line of normalized) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(angleDelta180(last.normalAngle, line.normalAngle)) <= angleTolerance &&
      Math.abs(last.rho - line.rho) <= gapTolerance &&
      line.t1 <= last.t2 + gapTolerance * 1.8
    ) {
      const totalLength = Math.max(1, last.length + line.length);
      last.rho = (last.rho * last.length + line.rho * line.length) / totalLength;
      last.normalAngle = (last.normalAngle * last.length + line.normalAngle * line.length) / totalLength;
      last.t1 = Math.min(last.t1, line.t1);
      last.t2 = Math.max(last.t2, line.t2);
      last.length = last.t2 - last.t1;
      continue;
    }
    merged.push({ ...line });
  }
  return merged.map(lineFromCadSegment).filter((line, index, all) => {
    const key = roundedLineKey(line, 2);
    return all.findIndex((candidate) => roundedLineKey(candidate, 2) === key) === index;
  });
}

function normalizeCadSegment(line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  let directionAngle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (directionAngle < 0) directionAngle += 180;
  if (directionAngle >= 180) directionAngle -= 180;
  const normalAngle = (directionAngle + 90) % 180;
  const normalRadians = normalAngle * Math.PI / 180;
  const directionRadians = directionAngle * Math.PI / 180;
  const normalX = Math.cos(normalRadians);
  const normalY = Math.sin(normalRadians);
  const directionX = Math.cos(directionRadians);
  const directionY = Math.sin(directionRadians);
  const rho1 = line.x1 * normalX + line.y1 * normalY;
  const rho2 = line.x2 * normalX + line.y2 * normalY;
  const t1 = line.x1 * directionX + line.y1 * directionY;
  const t2 = line.x2 * directionX + line.y2 * directionY;
  return {
    normalAngle,
    directionAngle,
    rho: (rho1 + rho2) / 2,
    t1: Math.min(t1, t2),
    t2: Math.max(t1, t2),
    length: Math.hypot(dx, dy)
  };
}

function lineFromCadSegment(segment) {
  const normalRadians = segment.normalAngle * Math.PI / 180;
  const directionRadians = segment.directionAngle * Math.PI / 180;
  const normalX = Math.cos(normalRadians);
  const normalY = Math.sin(normalRadians);
  const directionX = Math.cos(directionRadians);
  const directionY = Math.sin(directionRadians);
  return {
    x1: round2(segment.rho * normalX + segment.t1 * directionX),
    y1: round2(segment.rho * normalY + segment.t1 * directionY),
    x2: round2(segment.rho * normalX + segment.t2 * directionX),
    y2: round2(segment.rho * normalY + segment.t2 * directionY)
  };
}

function lineLength(line) {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

function angleDelta180(a, b) {
  const diff = Math.abs(((a - b + 90) % 180 + 180) % 180 - 90);
  return diff;
}

function roundedLineKey(line, precision = 1) {
  const factor = 10 ** precision;
  return [line.x1, line.y1, line.x2, line.y2].map((value) => Math.round(value * factor) / factor).join(",");
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function standardizeCadLines(lines, width, height, options = {}) {
  const minDim = Math.min(width, height);
  const minLength = Math.max(1, Number(options.minLength || minDim * 0.035));
  const snapTolerance = Math.max(2, Number(options.snapTolerance || minDim * 0.008));
  const mergeGap = Math.max(4, Number(options.mergeGap || minDim * 0.012));
  const allowedAngles = dominantCadAngles(lines);
  const cleaned = removeDenseCadHatches(lines, width, height, minLength)
    .filter((line) => lineLength(line) >= minLength)
    .map((line) => snapLineToCadAngle(line, allowedAngles))
    .map((line) => ({
      x1: round2(clamp(line.x1, 0, width - 1)),
      y1: round2(clamp(line.y1, 0, height - 1)),
      x2: round2(clamp(line.x2, 0, width - 1)),
      y2: round2(clamp(line.y2, 0, height - 1))
    }));
  const merged = mergeCadSegments(cleaned, 2.5, mergeGap);
  const snapped = snapCadEndpoints(merged, snapTolerance);
  const standardized = mergeCadSegments(snapped, 2.5, mergeGap)
    .map((line) => ({ ...line, layer: cadLayerName(line) }))
    .filter((line, index, all) => {
      const key = roundedLineKey(line, 1);
      return all.findIndex((candidate) => roundedLineKey(candidate, 1) === key) === index;
    })
    .sort((a, b) => lineLength(b) - lineLength(a));
  return filterCadLines(standardized, width, height, { minLength }).slice(0, 1400);
}

function dominantCadAngles(lines) {
  const preferred = [0, 30, 45, 60, 90, 120, 135, 150];
  const bins = new Map();
  for (const line of lines) {
    const length = lineLength(line);
    if (length < 12) continue;
    const angle = cadLineAngle(line);
    const rounded = Math.round(angle / 5) * 5;
    bins.set(rounded, (bins.get(rounded) || 0) + length);
  }
  const peaks = [...bins.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([angle]) => angle)
    .filter((angle) => angle >= 0 && angle < 180);
  const result = [...preferred];
  for (const angle of peaks) {
    if (result.length >= 14) break;
    if (!result.some((existing) => angleDelta180(existing, angle) <= 6)) result.push(angle);
  }
  return result;
}

function snapLineToCadAngle(line, allowedAngles) {
  const length = lineLength(line);
  if (length <= 0) return line;
  const angle = cadLineAngle(line);
  const target = allowedAngles
    .map((candidate) => ({ angle: candidate, delta: angleDelta180(candidate, angle) }))
    .sort((a, b) => a.delta - b.delta)[0];
  if (!target || target.delta > 9) return line;
  const radians = target.angle * Math.PI / 180;
  const cx = (line.x1 + line.x2) / 2;
  const cy = (line.y1 + line.y2) / 2;
  const half = length / 2;
  const dx = Math.cos(radians) * half;
  const dy = Math.sin(radians) * half;
  return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
}

function snapCadEndpoints(lines, tolerance) {
  const points = [];
  lines.forEach((line, lineIndex) => {
    points.push({ x: line.x1, y: line.y1, lineIndex, key: "a" });
    points.push({ x: line.x2, y: line.y2, lineIndex, key: "b" });
  });
  const used = new Uint8Array(points.length);
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const cluster = [i];
    used[i] = 1;
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <= tolerance) {
        used[j] = 1;
        cluster.push(j);
      }
    }
    if (cluster.length > 1) clusters.push(cluster);
  }
  const next = lines.map((line) => ({ ...line }));
  for (const cluster of clusters) {
    const x = cluster.reduce((sum, index) => sum + points[index].x, 0) / cluster.length;
    const y = cluster.reduce((sum, index) => sum + points[index].y, 0) / cluster.length;
    for (const pointIndex of cluster) {
      const point = points[pointIndex];
      const line = next[point.lineIndex];
      if (point.key === "a") {
        line.x1 = round2(x);
        line.y1 = round2(y);
      } else {
        line.x2 = round2(x);
        line.y2 = round2(y);
      }
    }
  }
  return next.filter((line) => lineLength(line) > 1);
}

function removeDenseCadHatches(lines, width, height, minLength) {
  const minDim = Math.min(width, height);
  return lines.filter((line, index) => {
    const length = lineLength(line);
    if (length >= minLength * 2.3) return true;
    const angle = cadLineAngle(line);
    const midX = (line.x1 + line.x2) / 2;
    const midY = (line.y1 + line.y2) / 2;
    let neighbors = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i === index) continue;
      const other = lines[i];
      if (lineLength(other) >= minLength * 2.8) continue;
      if (angleDelta180(angle, cadLineAngle(other)) > 4) continue;
      const otherMidX = (other.x1 + other.x2) / 2;
      const otherMidY = (other.y1 + other.y2) / 2;
      if (Math.abs(midX - otherMidX) <= minDim * 0.055 && Math.abs(midY - otherMidY) <= minDim * 0.055) {
        neighbors += 1;
      }
      if (neighbors >= 6) return false;
    }
    return true;
  });
}

function cadLineAngle(line) {
  let angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI;
  if (angle < 0) angle += 180;
  if (angle >= 180) angle -= 180;
  return angle;
}

function cadLayerName(line) {
  const angle = cadLineAngle(line);
  const normalized = angle > 90 ? 180 - angle : angle;
  if (normalized <= 6) return "A-WALL-H";
  if (normalized >= 84) return "A-WALL-V";
  if (lineLength(line) >= 90) return "A-OUTLINE";
  return "A-DETAIL";
}

function buildCadSvg(lines, width, height) {
  const body = lines.map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" data-layer="${escapeAttr(line.layer || cadLayerName(line))}" />`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/><g stroke="#111" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter">${body}</g></svg>`;
}

function buildCadPreviewSvg(lines, width, height, options = {}) {
  const minor = Math.max(24, Math.round(Math.min(width, height) / 32));
  const major = minor * 5;
  const lineWidth = Math.max(1.2, Math.min(2.2, Math.max(width, height) / 900));
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const body = lines.map((line, index) => {
    const layer = cadPreviewLayer(line);
    return `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${layer.stroke}" data-layer="${layer.name}" data-index="${index + 1}" vector-effect="non-scaling-stroke" />`;
  }).join("");
  const edge = `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#64748b" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  const title = escapeXml(options.title || "CAD Preview");
  const source = escapeXml(options.sourceLabel || "image");
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-cad-preview="true">
  <defs>
    <pattern id="cadMinorGrid" width="${minor}" height="${minor}" patternUnits="userSpaceOnUse">
      <path d="M ${minor} 0 L 0 0 0 ${minor}" fill="none" stroke="#1e293b" stroke-width="0.7"/>
    </pattern>
    <pattern id="cadMajorGrid" width="${major}" height="${major}" patternUnits="userSpaceOnUse">
      <rect width="${major}" height="${major}" fill="url(#cadMinorGrid)"/>
      <path d="M ${major} 0 L 0 0 0 ${major}" fill="none" stroke="#334155" stroke-width="1.1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="#050b12"/>
  <rect width="100%" height="100%" fill="url(#cadMajorGrid)" opacity="0.92"/>
  <line x1="0" y1="${centerY}" x2="${width}" y2="${centerY}" stroke="#7f1d1d" stroke-width="1" opacity="0.7" vector-effect="non-scaling-stroke"/>
  <line x1="${centerX}" y1="0" x2="${centerX}" y2="${height}" stroke="#14532d" stroke-width="1" opacity="0.7" vector-effect="non-scaling-stroke"/>
  ${edge}
  <g fill="none" stroke-width="${lineWidth}" stroke-linecap="square" stroke-linejoin="miter">${body}</g>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${Math.max(12, Math.round(Math.min(width, height) / 52))}" fill="#94a3b8">
    <text x="${minor}" y="${height - minor * 1.8}">${title} · ${lines.length} LINE · source: ${source}</text>
    <text x="${minor}" y="${height - minor * 0.75}">Layer H cyan / V blue / DIAG amber-purple · grid ${minor}px / major ${major}px</text>
  </g>
</svg>`.trim();
}

function cadPreviewLayer(line) {
  if (line.layer === "A-WALL-H") return { name: "A-WALL-H", stroke: "#5eead4" };
  if (line.layer === "A-WALL-V") return { name: "A-WALL-V", stroke: "#93c5fd" };
  if (line.layer === "A-OUTLINE") return { name: "A-OUTLINE", stroke: "#fbbf24" };
  if (line.layer === "A-DETAIL") return { name: "A-DETAIL", stroke: "#c084fc" };
  const angle = Math.abs(Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI);
  const normalized = angle > 90 ? 180 - angle : angle;
  if (normalized <= 8) return { name: "WALL-H", stroke: "#5eead4" };
  if (normalized >= 82) return { name: "WALL-V", stroke: "#93c5fd" };
  if (normalized < 45) return { name: "DIAG-A", stroke: "#fbbf24" };
  return { name: "DIAG-B", stroke: "#c084fc" };
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDxf(lines, width, height) {
  const header = [
    "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER", "70", "5",
    ...dxfLayerTableEntry("A-OUTLINE", 2),
    ...dxfLayerTableEntry("A-WALL-H", 4),
    ...dxfLayerTableEntry("A-WALL-V", 5),
    ...dxfLayerTableEntry("A-DETAIL", 6),
    ...dxfLayerTableEntry("A-REFERENCE", 8),
    "0", "ENDTAB", "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES"
  ];
  const entities = [];
  for (const line of lines) {
    const layer = line.layer || cadLayerName(line);
    entities.push(
      "0", "LINE", "8", layer,
      "10", String(line.x1), "20", String(height - line.y1), "30", "0",
      "11", String(line.x2), "21", String(height - line.y2), "31", "0"
    );
  }
  return [...header, ...entities, "0", "ENDSEC", "0", "EOF"].join("\n");
}

function dxfLayerTableEntry(name, color) {
  return ["0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS"];
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

function openImageCacheDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_CACHE_DB_NAME, IMAGE_CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      if (!db.objectStoreNames.contains("thumbnails")) db.createObjectStore("thumbnails", { keyPath: "id" });
      if (!db.objectStoreNames.contains("urlIndex")) db.createObjectStore("urlIndex", { keyPath: "url" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function imageCacheStore(storeName, mode, callback) {
  const db = await openImageCacheDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function hashDataUrlForCache(dataUrl) {
  if (window.crypto?.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

async function createCachedThumbnail(dataUrl) {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new Error("图片尺寸无效");
  const scale = Math.min(1, IMAGE_CACHE_THUMBNAIL_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    thumbnailDataUrl: canvas.toDataURL("image/webp", IMAGE_CACHE_THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: IMAGE_CACHE_THUMBNAIL_VERSION
  };
}

async function cacheImageUrlThumbnail(url) {
  if (!url) return "";
  if (state.thumbnailUrlCache.has(url)) return state.thumbnailUrlCache.get(url);
  const existingIndex = await imageCacheStore("urlIndex", "readonly", (store) => store.get(url)).catch(() => null);
  if (existingIndex?.id) {
    const cachedThumb = await imageCacheStore("thumbnails", "readonly", (store) => store.get(existingIndex.id)).catch(() => null);
    if (cachedThumb?.thumbnailVersion === IMAGE_CACHE_THUMBNAIL_VERSION && cachedThumb.thumbnailDataUrl) {
      state.thumbnailUrlCache.set(url, cachedThumb.thumbnailDataUrl);
      return cachedThumb.thumbnailDataUrl;
    }
  }

  const dataUrl = url.startsWith("data:")
    ? url
    : (await localImageUrlToDataUrl(url, "cached-image")).dataUrl;
  const id = await hashDataUrlForCache(dataUrl);
  const existingImage = await imageCacheStore("images", "readonly", (store) => store.get(id)).catch(() => null);
  const thumbnail = await createCachedThumbnail(existingImage?.dataUrl || dataUrl);
  if (!existingImage) {
    await imageCacheStore("images", "readwrite", (store) => store.put({ id, dataUrl, createdAt: Date.now(), source: "generated", width: thumbnail.width, height: thumbnail.height })).catch(() => null);
  }
  await imageCacheStore("thumbnails", "readwrite", (store) => store.put({ id, ...thumbnail })).catch(() => null);
  await imageCacheStore("urlIndex", "readwrite", (store) => store.put({ url, id, updatedAt: Date.now() })).catch(() => null);
  state.thumbnailUrlCache.set(url, thumbnail.thumbnailDataUrl);
  return thumbnail.thumbnailDataUrl;
}

function hydrateCachedThumbnails(root = document) {
  root.querySelectorAll?.("img[data-cache-thumbnail]").forEach((image) => {
    const fullSrc = image.dataset.fullSrc || image.getAttribute("src") || "";
    if (!fullSrc || image.dataset.cacheBusy === "true") return;
    image.dataset.fullSrc = fullSrc;
    image.dataset.cacheBusy = "true";
    cacheImageUrlThumbnail(fullSrc)
      .then((thumbnail) => {
        if (thumbnail && image.dataset.fullSrc === fullSrc) image.src = thumbnail;
      })
      .catch(() => {})
      .finally(() => {
        image.dataset.cacheBusy = "false";
      });
  });
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

function defaultImageResponsesPathForBaseUrl(baseUrl = "") {
  try {
    const host = new URL(String(baseUrl || "")).host.toLowerCase();
    return /(^|\.)yybb\.(codes|dog)$/.test(host) ? "/responses" : "/v1/responses";
  } catch {
    return "/v1/responses";
  }
}

function applyDayTheme() {
  state.theme = "day";
  document.body.dataset.theme = state.theme;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = "light";
  try {
    localStorage.setItem("laogui-theme", state.theme);
  } catch {}
}

function renderThemeControls() {
  els.themeChoiceButtons.forEach((button) => {
    const active = button.dataset.themeChoice === state.theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (els.themeSettingsStatus) {
    els.themeSettingsStatus.textContent = state.theme === "day" ? "白天玻璃" : "黑夜玻璃";
    els.themeSettingsStatus.className = `api-endpoint-status ${state.theme === "day" ? "available" : "unknown"}`;
  }
}

function applyTheme(theme = "day") {
  if (theme === "day") {
    applyDayTheme();
    renderThemeControls();
    applyCanvasBackgroundSettings();
    return;
  }
  state.theme = "night";
  document.body.dataset.theme = state.theme;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = "dark";
  try {
    localStorage.setItem("laogui-theme", state.theme);
  } catch {}
  renderThemeControls();
  applyCanvasBackgroundSettings();
}

function loadThemePreference() {
  const stored = (() => {
    try {
      const value = localStorage.getItem("laogui-theme");
      return value === "day" || value === "night" ? value : "";
    } catch {
      return "";
    }
  })();
  const bootTheme = window.__LAOGUI_INITIAL_THEME__ === "night" ? "night" : "day";
  applyTheme(stored || bootTheme || "day");
}

function clampWorkspaceGlassSettings(settings = {}) {
  const defaults = defaultWorkspaceGlassSettings();
  const merged = { ...defaults, ...(settings || {}) };
  const transparency = Number(merged.transparency ?? defaults.transparency);
  const blur = Number(merged.blur ?? defaults.blur);
  return {
    transparency: clamp(Number.isFinite(transparency) ? transparency : defaults.transparency, 0, 100),
    blur: clamp(Number.isFinite(blur) ? blur : defaults.blur, 0, 100)
  };
}

function loadWorkspaceGlassSettings() {
  try {
    const raw = localStorage.getItem(WORKSPACE_GLASS_STORAGE_KEY);
    state.workspaceGlass = clampWorkspaceGlassSettings(raw ? JSON.parse(raw) : {});
  } catch {
    state.workspaceGlass = defaultWorkspaceGlassSettings();
  }
  applyWorkspaceGlassSettings();
}

function saveWorkspaceGlassSettings() {
  try {
    localStorage.setItem(WORKSPACE_GLASS_STORAGE_KEY, JSON.stringify(state.workspaceGlass));
  } catch {}
}

function rgbaFromRgb(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(Number(alpha), 0, 1).toFixed(3)})`;
}

function applyWorkspaceGlassSettings(options = {}) {
  const settings = clampWorkspaceGlassSettings(state.workspaceGlass || defaultWorkspaceGlassSettings());
  state.workspaceGlass = settings;
  const transparency = settings.transparency / 100;
  const blur = settings.blur / 100;
  const isNight = state.theme === "night";
  const canvasSettings = resolvedCanvasBackgroundSettings(state.canvasBackground || defaultCanvasBackgroundSettings(), state.theme);
  const canvasRgb = hexToRgb(canvasSettings.backgroundColor);
  const surfaceRgb = isNight ? { r: 24, g: 28, b: 38 } : { r: 255, g: 255, b: 255 };
  const softSurfaceRgb = isNight ? { r: 36, g: 42, b: 55 } : { r: 255, g: 255, b: 255 };
  const mainAlpha = isNight
    ? clamp(0.48 - transparency * 0.4, 0.08, 0.44)
    : clamp(0.56 - transparency * 0.52, 0.06, 0.5);
  const strongAlpha = isNight
    ? clamp(0.56 - transparency * 0.42, 0.12, 0.52)
    : clamp(0.64 - transparency * 0.54, 0.1, 0.58);
  const softAlpha = isNight
    ? clamp(0.4 - transparency * 0.32, 0.06, 0.36)
    : clamp(0.46 - transparency * 0.42, 0.04, 0.4);
  const fieldAlpha = isNight
    ? clamp(0.42 - transparency * 0.34, 0.08, 0.38)
    : clamp(0.5 - transparency * 0.44, 0.06, 0.44);
  const canvasWashAlpha = isNight
    ? clamp(0.18 - transparency * 0.11, 0.055, 0.16)
    : clamp(0.2 - transparency * 0.13, 0.06, 0.18);
  const highlightAlpha = isNight
    ? clamp(0.22 - transparency * 0.08, 0.11, 0.2)
    : clamp(0.36 - transparency * 0.18, 0.16, 0.32);
  const borderAlpha = isNight
    ? clamp(0.34 - transparency * 0.12, 0.16, 0.3)
    : clamp(0.72 - transparency * 0.2, 0.46, 0.68);
  const blurPx = Math.round(2 + blur * 58);
  const innerBlurPx = Math.round(1 + blur * 43);
  const fieldBlurPx = Math.round(1 + blur * 28);
  const saturate = (1.08 + blur * 0.34).toFixed(2);

  document.body.style.setProperty("--workspace-glass-tint", rgbaFromRgb(surfaceRgb, mainAlpha));
  document.body.style.setProperty("--workspace-glass-tint-strong", rgbaFromRgb(surfaceRgb, strongAlpha));
  document.body.style.setProperty("--workspace-glass-tint-soft", rgbaFromRgb(softSurfaceRgb, softAlpha));
  document.body.style.setProperty("--workspace-glass-field", rgbaFromRgb(surfaceRgb, fieldAlpha));
  document.body.style.setProperty("--workspace-glass-canvas-wash", rgbaFromRgb(canvasRgb, canvasWashAlpha));
  document.body.style.setProperty("--workspace-glass-highlight", `rgba(255, 255, 255, ${highlightAlpha.toFixed(3)})`);
  document.body.style.setProperty("--workspace-glass-border", isNight ? `rgba(236, 242, 250, ${borderAlpha.toFixed(3)})` : `rgba(255, 255, 255, ${borderAlpha.toFixed(3)})`);
  document.body.style.setProperty("--workspace-glass-blur", `blur(${blurPx}px) saturate(${saturate})`);
  document.body.style.setProperty("--workspace-glass-inner-blur", `blur(${innerBlurPx}px) saturate(${saturate})`);
  document.body.style.setProperty("--workspace-glass-field-blur", `blur(${fieldBlurPx}px) saturate(${saturate})`);

  if (els.workspaceGlassTransparencyInput) {
    els.workspaceGlassTransparencyInput.value = String(Math.round(settings.transparency));
  }
  if (els.workspaceGlassTransparencyValue) {
    els.workspaceGlassTransparencyValue.textContent = `${Math.round(settings.transparency)}%`;
  }
  if (els.workspaceGlassBlurInput) {
    els.workspaceGlassBlurInput.value = String(Math.round(settings.blur));
  }
  if (els.workspaceGlassBlurValue) {
    els.workspaceGlassBlurValue.textContent = `${Math.round(settings.blur)}%`;
  }
  if (els.themeSettingsStatus) {
    els.themeSettingsStatus.textContent = `${state.theme === "day" ? "白天" : "黑夜"} · 透${Math.round(settings.transparency)} · 糊${Math.round(settings.blur)}`;
    els.themeSettingsStatus.className = `api-endpoint-status ${state.theme === "day" ? "available" : "unknown"}`;
  }
  if (options.persist) saveWorkspaceGlassSettings();
}

function updateWorkspaceGlassSettings(partial = {}, options = {}) {
  state.workspaceGlass = clampWorkspaceGlassSettings({
    ...(state.workspaceGlass || defaultWorkspaceGlassSettings()),
    ...partial
  });
  applyWorkspaceGlassSettings({ persist: options.persist !== false });
}

function clampCanvasBackgroundSettings(settings = {}) {
  const defaults = defaultCanvasBackgroundSettings();
  const merged = { ...defaults, ...(settings || {}) };
  const preset = canvasBackgroundPresets[merged.preset] ? merged.preset : "custom";
  return {
    ...merged,
    preset,
    backgroundColor: normalizeHexColor(merged.backgroundColor, defaults.backgroundColor),
    gridColor: normalizeHexColor(merged.gridColor, defaults.gridColor),
    gridOpacity: clamp(Number(merged.gridOpacity ?? defaults.gridOpacity), 0, 100),
    gridSize: clamp(Number(merged.gridSize ?? defaults.gridSize), 72, 220),
    imageDataUrl: String(merged.imageDataUrl || "").startsWith("data:image") ? String(merged.imageDataUrl) : "",
    imageUrl: normalizeCanvasBackgroundImageUrl(merged.imageUrl),
    imageOpacity: clamp(Number(merged.imageOpacity ?? defaults.imageOpacity), 0, 100)
  };
}

function normalizeCanvasBackgroundImageUrl(value) {
  const url = String(value || "").trim().replace(/^\//, "");
  if (!url) return "";
  if (/^assets\/canvas-backgrounds\/[-\w./]+\.png$/i.test(url)) return url;
  return "";
}

function normalizeHexColor(value, fallback = "#000000") {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function hexToRgb(hex) {
  const color = normalizeHexColor(hex, "#000000").slice(1);
  return {
    r: parseInt(color.slice(0, 2), 16),
    g: parseInt(color.slice(2, 4), 16),
    b: parseInt(color.slice(4, 6), 16)
  };
}

function colorWithOpacity(hex, opacityPercent) {
  const { r, g, b } = hexToRgb(hex);
  const opacity = clamp(Number(opacityPercent || 0), 0, 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(3)})`;
}

function resolvedCanvasBackgroundSettings(settings = state.canvasBackground, theme = state.theme) {
  const base = clampCanvasBackgroundSettings(settings || defaultCanvasBackgroundSettings());
  if (theme !== "night") return base;
  const nightPreset = canvasBackgroundNightPresets[base.preset] || canvasBackgroundNightPresets.custom;
  const usingPreset = Boolean(canvasBackgroundPresets[base.preset]) && !base.imageDataUrl;
  return clampCanvasBackgroundSettings({
    ...base,
    backgroundColor: usingPreset ? nightPreset.backgroundColor : blendHexColors(base.backgroundColor, nightPreset.backgroundColor, 0.78),
    gridColor: usingPreset ? nightPreset.gridColor : blendHexColors(base.gridColor, nightPreset.gridColor, 0.72),
    gridOpacity: usingPreset ? nightPreset.gridOpacity : clamp(Math.max(base.gridOpacity, nightPreset.gridOpacity), 0, 100),
    imageOpacity: base.imageDataUrl ? Math.min(base.imageOpacity, nightPreset.imageOpacity) : nightPreset.imageOpacity
  });
}

function blendHexColors(from, to, amount = 0.5) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const t = clamp(Number(amount), 0, 1);
  const channel = (start, end) => Math.round(start + (end - start) * t).toString(16).padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

function loadCanvasBackgroundSettings() {
  try {
    const raw = localStorage.getItem(CANVAS_BACKGROUND_STORAGE_KEY);
    state.canvasBackground = clampCanvasBackgroundSettings(raw ? JSON.parse(raw) : {});
  } catch {
    state.canvasBackground = defaultCanvasBackgroundSettings();
  }
  applyCanvasBackgroundSettings();
}

function saveCanvasBackgroundSettings() {
  try {
    localStorage.setItem(CANVAS_BACKGROUND_STORAGE_KEY, JSON.stringify(state.canvasBackground));
  } catch {}
}

function applyCanvasBackgroundSettings(options = {}) {
  const settings = clampCanvasBackgroundSettings(state.canvasBackground || defaultCanvasBackgroundSettings());
  state.canvasBackground = settings;
  const resolvedSettings = resolvedCanvasBackgroundSettings(settings, state.theme);
  applyCanvasBackgroundVariables(document.body, "canvas", resolvedSettings);
  applyCanvasBackgroundVariables(els.infiniteCanvas, "canvas", resolvedSettings);
  applyCanvasBackgroundVariables(els.canvasBackgroundPreview, "canvas-preview", resolvedSettings);
  renderCanvasBackgroundControls();
  applyWorkspaceGlassSettings();
  if (options.persist) saveCanvasBackgroundSettings();
}

function applyCanvasBackgroundVariables(element, prefix, settings) {
  if (!element) return;
  const majorColor = colorWithOpacity(settings.gridColor, settings.gridOpacity);
  const minorColor = colorWithOpacity(settings.gridColor, settings.gridOpacity * 0.45);
  const gridSize = `${Math.round(settings.gridSize)}px`;
  const subGridSize = `${Math.max(12, Math.round(settings.gridSize / 4))}px`;
  const presetImageUrl = canvasBackgroundPresets[settings.preset]?.imageUrl || "";
  const imageUrl = settings.imageUrl || presetImageUrl;
  const imageValue = settings.imageDataUrl
    ? `url("${settings.imageDataUrl}")`
    : imageUrl
      ? `url(${JSON.stringify(imageUrl)})`
      : "none";
  const imageOpacity = settings.imageDataUrl || imageUrl ? String(settings.imageOpacity / 100) : "0";
  element.style.setProperty(`--${prefix}-bg`, settings.backgroundColor);
  element.style.setProperty(`--${prefix}-bg-color`, settings.backgroundColor);
  element.style.setProperty(`--${prefix}-grid-major`, majorColor);
  element.style.setProperty(`--${prefix}-grid-major-color`, majorColor);
  element.style.setProperty(`--${prefix}-grid-minor`, minorColor);
  element.style.setProperty(`--${prefix}-grid-minor-color`, minorColor);
  element.style.setProperty(`--${prefix}-grid-size`, gridSize);
  element.style.setProperty(`--${prefix}-grid-sub-size`, subGridSize);
  element.style.setProperty(`--${prefix}-image`, imageValue);
  element.style.setProperty(`--${prefix}-bg-image`, imageValue);
  element.style.setProperty(`--${prefix}-image-opacity`, imageOpacity);
  element.style.setProperty(`--${prefix}-bg-image-opacity`, imageOpacity);
}

function renderCanvasBackgroundControls() {
  const settings = clampCanvasBackgroundSettings(state.canvasBackground || defaultCanvasBackgroundSettings());
  const presetImageUrl = canvasBackgroundPresets[settings.preset]?.imageUrl || "";
  const hasBackgroundImage = Boolean(settings.imageDataUrl || settings.imageUrl || presetImageUrl);
  if (els.canvasBackgroundStatus) {
    const baseLabel = settings.imageDataUrl
      ? "自定义底图"
      : hasBackgroundImage
        ? "内置底图"
      : canvasBackgroundPresets[settings.preset]
        ? "预设底图"
        : "自定义网格";
    els.canvasBackgroundStatus.textContent = `${baseLabel} · ${state.theme === "night" ? "黑夜" : "白天"}`;
    els.canvasBackgroundStatus.className = `api-endpoint-status ${settings.imageDataUrl ? "available" : "unknown"}`;
  }
  els.canvasBackgroundPresetButtons.forEach((button) => {
    const active = button.dataset.canvasBackgroundPreset === settings.preset && !settings.imageDataUrl;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (els.canvasBackgroundColorInput) els.canvasBackgroundColorInput.value = settings.backgroundColor;
  if (els.canvasGridColorInput) els.canvasGridColorInput.value = settings.gridColor;
  if (els.canvasGridOpacityInput) els.canvasGridOpacityInput.value = String(Math.round(settings.gridOpacity));
  if (els.canvasGridSizeInput) els.canvasGridSizeInput.value = String(Math.round(settings.gridSize));
  if (els.canvasBackgroundImageOpacityInput) {
    els.canvasBackgroundImageOpacityInput.value = String(Math.round(settings.imageOpacity));
    els.canvasBackgroundImageOpacityInput.disabled = !hasBackgroundImage;
  }
  if (els.clearCanvasBackgroundButton) els.clearCanvasBackgroundButton.disabled = !hasBackgroundImage;
}

function updateCanvasBackgroundSettings(partial = {}, options = {}) {
  state.canvasBackground = clampCanvasBackgroundSettings({
    ...(state.canvasBackground || defaultCanvasBackgroundSettings()),
    ...partial
  });
  applyCanvasBackgroundSettings({ persist: options.persist !== false });
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
  if (els.appSettingsBody) els.appSettingsBody.scrollTop = 0;
  document.body.classList.add("settings-open");
  setSettingsButtonState(true);
  renderStorageAccess();
  renderLocalApiSettings({ providers: state.runtimeProviders, providerProbes: state.providerProbes });
  renderApiSettings();
  refreshStorageSummary({ silent: true });
  refreshApiSettings({ silent: true });
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
  const items = getFilteredOutputItems();
  if (!items.length) {
    toast("当前筛选下暂无可下载的图片");
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

async function downloadAssetLibraryImages(button = null) {
  const items = assetLibraryImageItems();
  if (!items.length) {
    toast("方案资产库暂无可下载图片");
    return;
  }
  setBusy(button, true, "下载中");
  try {
    for (const [index, item] of items.entries()) {
      await downloadAssetLibraryImageItem(item, index);
      if (index < items.length - 1) await sleep(220);
    }
    toast(`已开始下载 ${items.length} 张方案资产`);
  } finally {
    setBusy(button, false);
  }
}

async function downloadAssetLibraryImageItem(item, index = -1) {
  if (item?.kind === "output") {
    const output = findOutputItem(item.outputId) || item.item;
    if (output) {
      await downloadOutputItem(output, index);
      return;
    }
  }
  await downloadImageRecord({
    id: item?.logId || item?.key || item?.url,
    title: item?.title || "方案资产",
    url: item?.url
  }, index);
}

async function downloadHistoryLogImage(log) {
  const record = historyLogToOutputRecord(log);
  if (!record.url) {
    toast("这条记录没有可下载图片");
    return;
  }
  await downloadImageRecord(record);
  toast("已开始下载历史资产");
}

async function downloadOutputItem(item, index = -1) {
  await downloadImageRecord(item, index);
}

async function downloadImageRecord(item, index = -1) {
  const blob = await fetchImageBlobForDownload(item.url, item.title || item.id || "图片");
  downloadBlob(blob, outputDownloadFileName(item, index, blob));
}

async function fetchImageBlobForDownload(url, title = "图片") {
  if (!url) throw new Error(`无法读取图片：${title}`);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return await response.blob();
    throw new Error(`HTTP ${response.status}`);
  } catch {
    if (isDownloadProxyCandidate(url)) {
      const response = await fetch(`/api/download-image?url=${encodeURIComponent(url)}`, { cache: "no-store" });
      if (response.ok) return await response.blob();
    }
    throw new Error(`无法读取图片：${title}`);
  }
}

function isDownloadProxyCandidate(url = "") {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function downloadOutputItemAsVectorSvg(item, index = -1) {
  if (isSvgImageUrl(item.url)) {
    await downloadOutputItem(item, index);
    toast("已下载原始 SVG 矢量图");
    return;
  }

  const primary = await imageSourceToPrimaryImage({
    id: item.id,
    url: item.url,
    title: item.title
  });
  const image = await loadImage(primary.dataUrl);
  const vector = vectorizeImageToSvg(image, item.title || item.id || "output");
  downloadBlob(
    new Blob([vector.svg], { type: "image/svg+xml;charset=utf-8" }),
    outputVectorFileName(item, index)
  );
  toast(`已导出 SVG 矢量图：${vector.shapeCount} 个色块，${vector.lineCount} 条轮廓线`);
}

function outputDownloadFileName(item, index = -1, blob = null) {
  const prefix = index >= 0 ? `${String(index + 1).padStart(2, "0")}-` : "";
  return `${prefix}${slugForFile(item.title || item.id || "output")}.${outputFileExtension(item, blob)}`;
}

function outputVectorFileName(item, index = -1) {
  const prefix = index >= 0 ? `${String(index + 1).padStart(2, "0")}-` : "";
  return `${prefix}${slugForFile(item.title || item.id || "output")}-vector.svg`;
}

function outputFileExtension(item, blob = null) {
  const urlExtension = outputUrlExtension(item?.url);
  if (urlExtension) return urlExtension;
  const type = String(blob?.type || "").split(";")[0].toLowerCase();
  const typeMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "application/svg+xml": "svg"
  };
  return typeMap[type] || "png";
}

function outputUrlExtension(url) {
  try {
    const match = new URL(url, window.location.href).pathname.match(/\.([a-z0-9]{2,5})$/i);
    const extension = match?.[1]?.toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)) return extension === "jpeg" ? "jpg" : extension;
  } catch {}
  return "";
}

function isSvgImageUrl(url = "") {
  const raw = String(url || "");
  if (/^data:image\/svg\+xml/i.test(raw)) return true;
  return outputUrlExtension(raw) === "svg";
}

function vectorizeImageToSvg(image, title = "vector-output") {
  const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const gridMax = 160;
  const scale = Math.min(1, gridMax / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(32, Math.round(naturalWidth * scale));
  const height = Math.max(32, Math.round(naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const rects = [];
  const luma = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    let runStart = 0;
    let previous = "";
    for (let x = 0; x <= width; x++) {
      const index = y * width + x;
      let key = "";
      if (x < width) {
        const offset = index * 4;
        const alpha = data[offset + 3];
        if (alpha >= 10) {
          const r = quantizeVectorChannel(data[offset]);
          const g = quantizeVectorChannel(data[offset + 1]);
          const b = quantizeVectorChannel(data[offset + 2]);
          const a = quantizeVectorAlpha(alpha);
          key = `${r},${g},${b},${a}`;
          luma[index] = r * 0.299 + g * 0.587 + b * 0.114;
        }
      }

      if (x === 0) {
        previous = key;
        runStart = 0;
        continue;
      }

      if (key !== previous) {
        if (previous) rects.push({ x: runStart, y, width: x - runStart, color: previous });
        previous = key;
        runStart = x;
      }
    }
  }

  const edge = sobelLumaEdges(luma, width, height);
  const edgeHist = new Uint32Array(256);
  let edgeCount = 0;
  for (let i = 0; i < edge.length; i++) {
    if (data[i * 4 + 3] < 18) continue;
    edgeHist[edge[i]] += 1;
    edgeCount += 1;
  }
  const edgeThreshold = edgeCount ? clamp(histPercentile(edgeHist, edgeCount, 0.82), 26, 110) : 42;
  const edgeMask = new Uint8Array(width * height);
  for (let i = 0; i < edge.length; i++) {
    if (data[i * 4 + 3] >= 18 && edge[i] >= edgeThreshold) edgeMask[i] = 1;
  }
  const minRun = Math.max(3, Math.round(Math.min(width, height) * 0.025));
  const horizontal = findRuns(edgeMask, width, height, "h", minRun);
  const vertical = findRuns(edgeMask, width, height, "v", minRun);
  const lines = mergeLines([...horizontal, ...vertical], 2).slice(0, 2600);
  const svg = buildVectorExportSvg({
    title,
    naturalWidth,
    naturalHeight,
    width,
    height,
    rects,
    lines
  });
  return { svg, shapeCount: rects.length, lineCount: lines.length, width, height };
}

function quantizeVectorChannel(value) {
  return clampByte(Math.round(Number(value || 0) / 24) * 24);
}

function quantizeVectorAlpha(value) {
  return clampByte(Math.round(Number(value || 0) / 32) * 32);
}

function vectorColorAttrs(colorKey) {
  const [r, g, b, a] = String(colorKey || "0,0,0,255").split(",").map((value) => clampByte(Number(value) || 0));
  const opacity = a >= 250 ? "" : ` fill-opacity="${(a / 255).toFixed(3)}"`;
  return `fill="rgb(${r} ${g} ${b})"${opacity}`;
}

function buildVectorExportSvg({ title, naturalWidth, naturalHeight, width, height, rects, lines }) {
  const safeTitle = escapeHtml(title || "矢量图");
  const rectMarkup = rects.map((rect) => (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="1" ${vectorColorAttrs(rect.color)} />`
  )).join("");
  const strokeWidth = Math.max(0.55, Math.min(1.2, Math.min(width, height) / 150));
  const lineMarkup = lines.map((line) => (
    `<line x1="${round4(line.x1)}" y1="${round4(line.y1)}" x2="${round4(line.x2)}" y2="${round4(line.y2)}" />`
  )).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${naturalWidth}" height="${naturalHeight}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">`,
    `<title>${safeTitle}</title>`,
    `<desc>自动从位图生成的 SVG 矢量图，包含海报化色块和轮廓线。</desc>`,
    `<g id="posterized-color">${rectMarkup}</g>`,
    `<g id="edge-trace" fill="none" stroke="#171511" stroke-width="${round4(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.72">${lineMarkup}</g>`,
    `</svg>`
  ].join("");
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

function wrapDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(((numeric % 360) + 360) % 360);
}

function wrapSignedDegrees(value) {
  const wrapped = wrapDegrees(value);
  return wrapped > 180 ? wrapped - 360 : wrapped;
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
    if (details.classList.contains("task-log-drawer")) return;
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
  if (
    element.closest("#canvasImageToolbar") ||
    element.closest("#deepEditOverlay") ||
    element.closest("#colorGradeOverlay") ||
    element.closest("#multiAngleOverlay") ||
    element.closest("#cutoutOverlay") ||
    element.closest("#cropOverlay") ||
    element.closest("[data-preview-url]")
  ) return;
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
els.assetLibraryBackButton?.addEventListener("click", () => showWorkspace("canvas"));
els.assetLibraryDownloadAllButton?.addEventListener("click", () => {
  downloadAssetLibraryImages(els.assetLibraryDownloadAllButton).catch((error) => toast(error.message));
});
els.assetLibraryRefreshButton?.addEventListener("click", () => refreshTaskLogs());
els.workspaceHistoryButton?.addEventListener("click", showAssetLibraryPage);
els.workspaceHistoryRefreshButton?.addEventListener("click", () => refreshTaskLogs());
els.workspaceHistoryCloseButton?.addEventListener("click", () => {
  state.historyPanelOpen = false;
  renderWorkspaceHistoryPanel();
  focusElement(els.workspaceHistoryButton);
});
els.projectLibraryFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.projectLibraryFilter = button.dataset.projectLibraryFilter || "images";
    renderWorkspaceHistoryPanel();
  });
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
els.themeChoiceButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeChoice === "day" ? "day" : "night"));
});
const handleWorkspaceGlassTransparencyInput = () => {
  updateWorkspaceGlassSettings({ transparency: els.workspaceGlassTransparencyInput.value });
};
els.workspaceGlassTransparencyInput?.addEventListener("input", handleWorkspaceGlassTransparencyInput);
els.workspaceGlassTransparencyInput?.addEventListener("change", handleWorkspaceGlassTransparencyInput);
const handleWorkspaceGlassBlurInput = () => {
  updateWorkspaceGlassSettings({ blur: els.workspaceGlassBlurInput.value });
};
els.workspaceGlassBlurInput?.addEventListener("input", handleWorkspaceGlassBlurInput);
els.workspaceGlassBlurInput?.addEventListener("change", handleWorkspaceGlassBlurInput);
els.canvasBackgroundPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const preset = button.dataset.canvasBackgroundPreset || "default";
    updateCanvasBackgroundSettings({
      ...canvasBackgroundPresets[preset],
      preset,
      imageDataUrl: ""
    });
  });
});
els.uploadCanvasBackgroundButton?.addEventListener("click", () => els.canvasBackgroundImageInput?.click());
els.clearCanvasBackgroundButton?.addEventListener("click", () => {
  updateCanvasBackgroundSettings({
    preset: "custom",
    imageDataUrl: "",
    imageUrl: "",
    imageOpacity: canvasBackgroundPresets[state.canvasBackground?.preset]?.imageOpacity ?? 18
  });
});
els.canvasBackgroundImageInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    const optimized = await optimizeImageDataUrl(dataUrl, {
      maxEdge: 1800,
      targetBytes: 900 * 1024,
      force: true,
      cacheLabel: "canvas-background"
    });
    updateCanvasBackgroundSettings({
      preset: "custom",
      imageDataUrl: optimized,
      imageUrl: "",
      imageOpacity: state.canvasBackground?.imageOpacity || 18
    });
    toast("画布底图已替换。");
  } catch {
    toast("底图读取失败，请换一张图片再试。");
  }
});
[
  [els.canvasBackgroundColorInput, "backgroundColor"],
  [els.canvasGridColorInput, "gridColor"],
  [els.canvasGridOpacityInput, "gridOpacity"],
  [els.canvasGridSizeInput, "gridSize"],
  [els.canvasBackgroundImageOpacityInput, "imageOpacity"]
].forEach(([input, key]) => {
  input?.addEventListener("input", () => {
    const current = state.canvasBackground || defaultCanvasBackgroundSettings();
    const presetImageUrl = canvasBackgroundPresets[current.preset]?.imageUrl || "";
    updateCanvasBackgroundSettings({
      preset: "custom",
      imageUrl: current.imageDataUrl ? "" : current.imageUrl || presetImageUrl,
      [key]: input.value
    });
  });
});
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
els.topNewCanvasButton?.addEventListener("click", () => {
  createNewCanvas().catch((error) => toast(error.message));
});
els.renameCanvasButton?.addEventListener("click", () => promptRenameCanvas());
els.deleteCanvasButton?.addEventListener("click", () => {
  deleteActiveCanvas().catch((error) => toast(error.message));
});
els.clearAllCanvasesButton?.addEventListener("click", () => {
  clearAllCanvases().catch((error) => toast(error.message));
});
els.toggleCanvasListButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  applyCanvasListCollapsed(!state.canvasListCollapsed);
});
els.canvasListPanel?.addEventListener("click", (event) => {
  if (event.target?.closest?.(".canvas-list-brand")) return;
  if (state.canvasListCollapsed) applyCanvasListCollapsed(false);
});
els.toggleAgentPanelButton?.addEventListener("click", () => toggleAgentPanel());
els.agentPanelRailButton?.addEventListener("click", () => toggleAgentPanel(false));
els.agentPanel?.addEventListener("click", (event) => {
  if (event.target?.closest?.("#toggleAgentPanelButton, #agentPanelRailButton")) return;
  if (state.agentPanelCollapsed) toggleAgentPanel(false);
});
els.canvasFloatingExpandButton?.addEventListener("click", () => toggleAgentPanel(false));
els.canvasFloatingCollapseButton?.addEventListener("click", () => applyCanvasFloatingCollapsed(true));
els.canvasFloatingRestoreButton?.addEventListener("click", () => applyCanvasFloatingCollapsed(false));
els.startButtons.forEach((button) => button.addEventListener("click", () => {
  window.__LAOGUI_PENDING_START_MODE__ = "";
  showWorkspace(button.dataset.startMode).catch((error) => toast(error.message));
}));
els.homeToolSearch?.addEventListener("input", renderHomeToolCenter);
els.homeToolFilterButtons.forEach((button) => {
  button.addEventListener("click", () => setHomeToolFilter(button.dataset.homeToolFilter || "all"));
});
els.homeTemplateButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openHomeTemplate(button.dataset.homeTemplate).catch((error) => toast(error.message));
  });
});
els.renderButton.addEventListener("click", () => runPrimaryAction());
els.canvasGenerateButton.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  runPrimaryAction({ busyButton: els.canvasGenerateButton });
});
els.floatingGenerateButton?.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  runPrimaryAction({ busyButton: els.floatingGenerateButton });
});
els.thinkingModeButton?.addEventListener("click", toggleThinkingMode);
els.floatingThinkingModeButton?.addEventListener("click", toggleThinkingMode);
els.continueEditButton.addEventListener("click", continueEditFromLatest);
els.floatingContinueEditButton?.addEventListener("click", continueEditFromLatest);
els.modeTabs.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
  button.addEventListener("keydown", handleModeTabKeydown);
});
document.querySelectorAll(".mode-switcher").forEach((switcher) => {
  switcher.addEventListener("pointerleave", () => {
    switcher.open = false;
  });
  switcher.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (!switcher.contains(document.activeElement)) switcher.open = false;
    });
  });
});
els.floatingModeSelect?.addEventListener("change", () => setMode(els.floatingModeSelect.value));
els.presetButtons.forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
els.projectTemplateButtons.forEach((button) => button.addEventListener("click", () => applyProjectTemplate(button.dataset.projectTemplate)));
els.stylePresetButtons.forEach((button) => button.addEventListener("click", () => applyStylePreset(button.dataset.stylePreset)));
els.refreshApiSettingsButton?.addEventListener("click", () => refreshApiSettings());
els.refreshStorageButton?.addEventListener("click", () => refreshStorageSummary());
els.chooseStorageDirButton?.addEventListener("click", chooseStorageDirectory);
els.saveStorageSettingsButton?.addEventListener("click", () => saveStorageSettings({ markPrompted: true }));
els.resetStorageDirButton?.addEventListener("click", resetStorageDirectory);
els.storagePromptButtons.forEach((button) => {
  button.addEventListener("click", () => setStoragePromptMode(button.dataset.storagePromptMode || "ask"));
});
els.cleanupTestGeneratedButton?.addEventListener("click", () => runStorageMaintenance("cleanup-test-generated", {}, els.cleanupTestGeneratedButton));
els.archiveGeneratedButton?.addEventListener("click", () => runStorageMaintenance("archive-generated", { olderThanDays: 30 }, els.archiveGeneratedButton));
els.pruneLogsButton?.addEventListener("click", () => runStorageMaintenance("prune-task-logs", { keepDays: 30 }, els.pruneLogsButton));
els.saveReasoningApiSettingsButton?.addEventListener("click", saveReasoningApiSettings);
els.saveImageApiSettingsButton?.addEventListener("click", saveImageApiSettings);
els.probeReasoningApiButton?.addEventListener("click", () => probeRuntimeProvider("reasoning"));
els.probePrimaryImageApiButton?.addEventListener("click", () => probeRuntimeProvider("image"));
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
els.sizePickerButton?.addEventListener("click", () => openSizePicker(els.sizePickerButton));
els.sizePickerOverlay?.addEventListener("click", (event) => {
  if (event.target.closest("[data-size-picker-close]")) closeSizePicker();
});
els.sizePickerTier?.addEventListener("change", updateSizePickerFieldsFromTierRatio);
els.sizePickerRatio?.addEventListener("change", updateSizePickerFieldsFromTierRatio);
els.sizePickerApplyButton?.addEventListener("click", applySizePicker);
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
els.imageModelingAnalyzeButton?.addEventListener("click", () => {
  analyzeImageModelingSubjectFromPhoto(els.imageModelingAnalyzeButton).catch((error) => toast(error.message));
});
els.imageModelingConfirmButton?.addEventListener("click", () => {
  Promise.resolve(confirmImageModelingSubject()).catch((error) => toast(error.message));
});
els.imageModelingCadReferenceButton?.addEventListener("click", () => {
  generateImageModelingCadReference(els.imageModelingCadReferenceButton).catch((error) => toast(error.message));
});
els.canvasFloatingComposer?.addEventListener("pointerdown", (event) => event.stopPropagation());
els.canvasFloatingComposer?.addEventListener("click", (event) => event.stopPropagation());
els.canvasFloatingComposer?.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
els.primaryImageInput?.addEventListener("click", () => {
  els.primaryImageInput.value = "";
});
els.primaryImageInput?.addEventListener("input", () => {
  processPrimaryImageInputSelection("input");
});
els.primaryImageInput?.addEventListener("change", () => {
  processPrimaryImageInputSelection("change");
});
window.addEventListener("focus", () => {
  window.setTimeout(() => {
    processPrimaryImageInputSelection("focus");
    processReferenceImageInputSelection("focus");
  }, 120);
});
els.removePrimaryImageButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  removePrimaryImage();
});
els.referenceImageInput?.addEventListener("click", () => {
  els.referenceImageInput.value = "";
});
els.referenceImageInput?.addEventListener("input", () => {
  processReferenceImageInputSelection("input");
});
els.referenceImageInput?.addEventListener("change", () => {
  processReferenceImageInputSelection("change");
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
  applyCanvasListCollapsed(true);
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
  applyCanvasListCollapsed(true);
  zoomCanvasByWheel(event);
}, { passive: false });
els.infiniteCanvas.addEventListener("dragover", (event) => {
  event.preventDefault();
  applyCanvasListCollapsed(true);
  event.dataTransfer.dropEffect = "copy";
});
els.infiniteCanvas.addEventListener("drop", (event) => {
  event.preventDefault();
  applyCanvasListCollapsed(true);
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
  const wasPanning = Boolean(state.canvas.panning);
  state.canvas.panning = null;
  state.canvas.nodeDrag = null;
  els.infiniteCanvas.classList.remove("is-panning");
  if (drag?.preview && !drag.moved) {
    handleCanvasPreviewClick(drag.nodeId, drag.preview);
  } else if (drag?.moved || wasPanning) {
    clearTimeout(canvasPreviewClickTimer);
    canvasPreviewClickTimer = 0;
    canvasPreviewClickPayload = null;
    scheduleCanvasStateSave({ delay: 240 });
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (closeSizePicker()) return;
    if (closeSettings()) return;
    if (state.deepEdit.open) {
      closeDeepEditOverlay();
      return;
    }
    if (state.colorGrade.open) {
      closeColorGradeOverlay();
      return;
    }
    if (isOverlayOpen("multiAngleOverlay")) {
      closeMultiAngleOverlay();
      return;
    }
    if (state.cutout.open) {
      closeCutoutOverlay();
      return;
    }
    if (isOverlayOpen("imageCompareOverlay")) {
      closeCompareOverlay();
      return;
    }
    if (isOverlayOpen("panoramaPreviewOverlay")) {
      closePanoramaPreview();
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
els.canvasFitButton.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  resetCanvasView();
});
els.canvasFocusResultsButton?.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  focusCanvasToResults();
});
els.canvasMinimap?.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  focusCanvasToNodes();
});
els.zoomOutButton.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  zoomCanvas(1 - CANVAS_BUTTON_ZOOM_STEP);
});
els.zoomInButton.addEventListener("click", () => {
  applyCanvasListCollapsed(true);
  zoomCanvas(1 + CANVAS_BUTTON_ZOOM_STEP);
});
els.refreshTaskLogsButton?.addEventListener("click", () => refreshTaskLogs());
els.taskLogFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.taskLogFilter = button.dataset.taskLogFilter || "all";
    refreshTaskLogs({ silent: true });
  });
});
els.outputManagerSearch?.addEventListener("input", () => {
  state.outputSearch = els.outputManagerSearch.value || "";
  renderOutputManager();
  scheduleCanvasStateSave({ delay: 500 });
});
els.outputFavoritesOnlyButton?.addEventListener("click", () => {
  state.outputFavoritesOnly = !state.outputFavoritesOnly;
  renderOutputManager();
  scheduleCanvasStateSave({ delay: 200 });
});
els.exportOutputsButton?.addEventListener("click", () => {
  downloadCurrentCanvasOutputs(els.exportOutputsButton).catch((error) => toast(error.message));
});
document.querySelectorAll("input, textarea, select").forEach((field) => {
  field.addEventListener("input", () => {
    if (field.type === "file") return;
    if (field === els.homeToolSearch) return;
    if (field === els.canvasCommand) {
      state.canvasCommandUserEdited = Boolean(field.value.trim());
      syncFloatingComposer();
    }
    if (field === els.primaryImageApiBaseUrl && els.primaryImageApiResponsesPath) {
      const currentPath = els.primaryImageApiResponsesPath.value.trim();
      if (!currentPath || currentPath === "/responses" || currentPath === "/v1/responses") {
        els.primaryImageApiResponsesPath.value = defaultImageResponsesPathForBaseUrl(field.value.trim());
      }
    }
    if (!state.plan) {
      els.projectTitle.textContent = activeCanvasDisplayTitle();
    }
    scheduleWorkflowCanvasRender();
  });
  field.addEventListener("change", () => {
    if (field.type === "file") return;
    if (field === els.homeToolSearch) return;
    scheduleWorkflowCanvasRender();
  });
});
els.sampleButton?.addEventListener("click", () => {
  const current = readBrief().projectName;
  writeBrief(current === sampleBrief.projectName ? sampleAlt : sampleBrief);
});

function initializeHomeVideoSequence() {
  const video = document.querySelector(".home-hero-video");
  if (!video) return;

  const sequence = (video.dataset.homeVideoSequence || "")
    .split("|")
    .map((src) => src.trim())
    .filter(Boolean);
  if (sequence.length < 2) return;

  const posters = (video.dataset.homePosterSequence || "")
    .split("|")
    .map((src) => src.trim());
  let activeIndex = Math.max(0, sequence.findIndex((src) => {
    const sourceSrc = video.querySelector("source")?.getAttribute("src") || "";
    return sourceSrc === src || video.getAttribute("src") === src || video.currentSrc.endsWith(src);
  }));
  let failedAdvanceCount = 0;
  let previousTime = 0;
  let switchingVideo = false;
  let switchingFallbackTimer = 0;
  const videoBackdrop = video.closest(".home-video-backdrop");

  const syncActiveVideoTone = () => {
    const index = String(activeIndex);
    video.dataset.activeSequenceIndex = index;
    if (videoBackdrop) videoBackdrop.dataset.activeSequenceIndex = index;
  };

  const playCurrentVideo = () => {
    const playPromise = video.play();
    if (playPromise?.catch) playPromise.catch(() => {});
  };

  const activateVideo = (nextIndex) => {
    switchingVideo = true;
    window.clearTimeout(switchingFallbackTimer);
    activeIndex = ((nextIndex % sequence.length) + sequence.length) % sequence.length;
    syncActiveVideoTone();
    video.loop = false;
    video.removeAttribute("loop");
    if (posters[activeIndex]) video.poster = posters[activeIndex];

    const nextSrc = sequence[activeIndex];
    const source = video.querySelector("source");
    if (source) source.setAttribute("src", nextSrc);
    video.pause();
    video.src = nextSrc;
    previousTime = 0;

    const resumeAfterMetadataLoad = () => {
      if (!switchingVideo) return;
      switchingVideo = false;
      previousTime = 0;
      window.clearTimeout(switchingFallbackTimer);
      playCurrentVideo();
    };

    video.addEventListener("loadedmetadata", resumeAfterMetadataLoad, { once: true });
    video.load();
    switchingFallbackTimer = window.setTimeout(resumeAfterMetadataLoad, 800);
  };

  const advanceWhenSequenceBoundaryIsReached = () => {
    if (switchingVideo) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const nearEnd = video.currentTime >= video.duration - 0.08;
    const wrappedToStart = video.currentTime < 0.35 && previousTime > video.duration - 0.5;
    previousTime = video.currentTime;
    if (!nearEnd && !wrappedToStart) return;
    failedAdvanceCount = 0;
    activateVideo(activeIndex + 1);
  };

  video.loop = false;
  video.removeAttribute("loop");
  syncActiveVideoTone();
  video.addEventListener("ended", () => {
    failedAdvanceCount = 0;
    activateVideo(activeIndex + 1);
  });
  video.addEventListener("timeupdate", () => {
    advanceWhenSequenceBoundaryIsReached();
  });
  video.addEventListener("error", () => {
    failedAdvanceCount += 1;
    if (failedAdvanceCount < sequence.length) activateVideo(activeIndex + 1);
  });
  window.setInterval(advanceWhenSequenceBoundaryIsReached, 160);
  playCurrentVideo();
}

initializeHomeVideoSequence();
state.anonymousClientId = getOrCreateClientId();
state.clientId = state.anonymousClientId;
loadThemePreference();
loadWorkspaceGlassSettings();
loadCanvasBackgroundSettings();
loadCanvasListCollapsedPreference();
const restoredPersistedCanvasState = await loadPersistedCanvasState();
state.mode = publicModeOrFallback(state.mode);
applyFriendExperienceUi();
syncDefaultCanvasCommand(state.mode);
applyAgentPanelCollapsed(false);
applyCanvasFloatingCollapsed(false);
refreshPresetSelection();
refreshGenerationControls();
renderHomeToolCenter();
renderTaskProgressPanel();
refreshHealth();
scheduleDeferredStartupRefresh();
if (!restoredPersistedCanvasState) {
  ensureCanvasCollection(state.mode);
  drawSelectionCanvas();
  renderWorkflowCanvas();
}
if (window.__LAOGUI_PENDING_START_MODE__) {
  const pendingStartMode = window.__LAOGUI_PENDING_START_MODE__;
  window.__LAOGUI_PENDING_START_MODE__ = "";
  showWorkspace(pendingStartMode).catch((error) => toast(error.message));
}
window.addEventListener("resize", () => {
  scheduleSelectionCanvasDraw();
  applyCanvasTransform();
});
