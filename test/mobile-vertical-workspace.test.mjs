import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const html = readFileSync(path.join(root, "mobile", "index.html"), "utf8");
const app = readFileSync(path.join(root, "mobile", "app.js"), "utf8");
const styles = readFileSync(path.join(root, "mobile", "styles.css"), "utf8");
const aiEditor = readFileSync(path.join(root, "mobile", "ai-edit", "editor.js"), "utf8");
const basicEditor = readFileSync(path.join(root, "mobile", "basic-editor.js"), "utf8");
const nativePlugin = readFileSync(path.join(root, "android", "app", "src", "main", "java", "cn", "laogui", "ai", "mobile", "LaoguiNativePlugin.java"), "utf8");

test("手机版使用创作工作台、结果画布和固定生成按钮", () => {
  assert.match(html, /id="infiniteCanvas"/);
  assert.match(html, /id="canvasWorld"/);
  assert.match(html, /id="canvasNodes"/);
  assert.match(html, /id="workspacePromptInput"/);
  assert.match(html, /id="quickGenerateButton"/);
  assert.match(styles, /position: fixed;[\s\S]*composer-generate/);
  assert.match(html, /id="canvasConnections"/);
  assert.match(app, /function renderInfiniteCanvas\(\)/);
  assert.match(app, /defaultCanvasPlacement/);
  assert.match(styles, /\.infinite-canvas/);
  assert.doesNotMatch(html, /class="bottom-nav"/);
});

test("手机版保留全屏预览、独立 AI 编辑和明暗主题", () => {
  assert.match(html, /id="imageEditorStage"/);
  assert.match(app, /createAiEditor/);
  assert.match(app, /openMobileAiEdit/);
  assert.doesNotMatch(html, /id="canvasEditDock"/);
  assert.match(app, /setupImageEditor/);
  assert.match(styles, /data-theme="light"/);
});

test("手机版启动后直接进入纵向创作工作台", () => {
  assert.match(html, /class="infinite-canvas"/);
  assert.match(html, /今天想设计什么/);
  assert.match(html, /可只输入文字/);
  assert.match(html, /生成结果会显示在这里/);
  assert.match(html, /id="canvasMenuButton"/);
  assert.match(html, /id="canvasList"/);
  assert.match(html, /data-nav="projects"/);
  assert.doesNotMatch(html, /data-nav="tasks"/);
  assert.match(app, /navigate\("home"\);\s*\n}/);
  assert.doesNotMatch(app, /if \(!state\.settings\.profiles\.length\) navigate\("settings"\)/);
});

test("手机创作面板可以收起并保留关键信息", () => {
  assert.match(html, /id="toggleWorkbenchButton"/);
  assert.match(html, /id="workbenchCollapsedSummary"/);
  assert.match(html, /id="collapsedCapabilityLabel"/);
  assert.match(html, /id="collapsedMediaSummary"/);
  assert.match(html, /id="collapsedParameterSummary"/);
  assert.match(app, /workbenchCollapsed: localStorage\.getItem/);
  assert.match(app, /function setWorkbenchCollapsed/);
  assert.match(app, /function renderWorkbenchVisibility/);
  assert.match(styles, /\.creation-workbench\.collapsed \+ \.infinite-canvas/);
  assert.match(styles, /\.workbench-collapse-button \{[^}]*min-height: 44px/);
});

test("画布图片显示编辑、下载和删除快捷操作，参数保持抽屉", () => {
  assert.match(app, /function canvasNodeMarkup\(asset, index\)/);
  assert.match(app, /\["ai-edit", "AI 编辑"/);
  assert.match(app, /\["basic-edit", "基础编辑"/);
  assert.match(app, /\["download", "下载", "i-download"\]/);
  assert.match(app, /\["delete", "删除", "i-trash"\]/);
  assert.doesNotMatch(app, /\["preset", "功能预设"/);
  assert.doesNotMatch(app, /action === "preset"/);
  assert.doesNotMatch(app, /\["color-edit", "调色"/);
  assert.doesNotMatch(app, /const common = .*\["mask"/);
  assert.match(app, /function handleObjectAction\(/);
  assert.match(app, /workspaceComposer\.hidden = false/);
  assert.match(html, /id="quickParameterPanel"/);
  assert.match(html, /id="parameterSummary"/);
  assert.match(html, /id="toolPopover"/);
  assert.doesNotMatch(html, /id="toolDrawer"/);
  assert.match(html, /id="parameterDialog"/);
  assert.match(html, /id="objectMoreDrawer"/);
});

test("纵向画布保存关系并实时绘制连接线", () => {
  assert.match(app, /CANVAS_LAYOUT_VERSION/);
  assert.match(app, /migrateVerticalLayout/);
  assert.match(app, /renderCanvasConnections/);
  assert.match(app, /asset\.parentId/);
  assert.match(styles, /\.canvas-connection\.active/);
  assert.match(app, /addAsset\(\{ dataUrl: raw, name, kind: "reference", parentId: state\.primary\?\.assetId/);
});

test("能力选择不再依赖 AI 对话并在生成前集中确认", () => {
  assert.doesNotMatch(html, /id="designConversationPanel"/);
  assert.doesNotMatch(html, /id="conversationForm"/);
  assert.match(html, /id="generationConfirmDialog"/);
  assert.match(html, /返回修改/);
  assert.match(html, /确认生成/);
  assert.match(app, /function generationReadiness/);
  assert.match(app, /function openGenerationConfirmation/);
  assert.doesNotMatch(app, /continueDesignConversation/);
  assert.doesNotMatch(app, /请先在 AI 对话中确认设计方案/);
  assert.match(app, /浏览器用于界面测试，请在安卓端正式生成/);
  assert.match(app, /if \(!isNative \|\| !Plugins\.LaoguiNative\?\.generateImage\)/);
});

test("图片支持双击和双击触摸全屏预览", () => {
  assert.match(app, /addEventListener\("dblclick"/);
  assert.match(app, /event\.pointerType === "touch"/);
  assert.match(app, /openAssetPreview/);
  assert.match(app, /gesture\.type === "pinch"/);
  assert.match(app, /Math\.max\(1, Math\.min\(5/);
  assert.match(html, /双击放大 · 双指缩放 · 拖动查看/);
  assert.match(html, /data-image-action="download"/);
  assert.match(app, /async function downloadAsset/);
  assert.match(app, /图片已保存到手机相册/);
});

test("手机端支持动态流和无限画布双模式", () => {
  assert.match(html, /id="canvasModeSwitch"/);
  assert.match(html, /data-canvas-mode="flow"/);
  assert.match(html, /data-canvas-mode="canvas"/);
  assert.match(app, /canvas: \{ mode: "flow"/);
  assert.match(app, /async function setCanvasMode/);
  assert.match(app, /function renderFlowCanvas/);
  assert.match(app, /state\.canvas\.mode === "flow"/);
  assert.match(styles, /\.infinite-canvas\.mode-flow/);
  assert.match(styles, /touch-action: pan-y/);
  assert.match(styles, /\.infinite-canvas\.mode-canvas \{ touch-action: none/);
});

test("手机顶部工具保持单行并把历史生成收进更多菜单", () => {
  assert.match(html, /id="workspaceMenu"[^>]*>[\s\S]*id="taskStatusButton"[^>]*>[\s\S]*历史生成/);
  assert.doesNotMatch(html, /class="icon-button canvas-status-button"/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.topbar \{[^}]*min-height: calc\(62px/);
  assert.match(styles, /\.canvas-mode-switch \{ position: static;[^}]*width: 96px/);
});

test("手机端设计能力清单移除用户指定的精简项", () => {
  const removedNames = ["设计推导", "全景图生成", "材质替换", "灯光调整", "局部消除", "局部替换", "智能扩图", "智能抠图", "细节增强", "清晰放大", "智能锐化", "专业调色", "多角度生成"];
  for (const name of removedNames) assert.doesNotMatch(app, new RegExp(`name: "${name}"`));
  assert.match(app, /if \(project\.selectedToolId && !selectedTool\)/);
  assert.match(html, /src="\.\/app\.js\?v=20260812-desktop-glass"/);
});

test("手机基础编辑使用独立的大图底栏工作区", () => {
  assert.match(app, /createBasicEditor/);
  assert.match(app, /basic-editor\.js\?v=20260812-basic-editor-final/);
  assert.match(app, /if \(mode === "basic"\)/);
  for (const category of ["crop", "adjust", "filter", "markup", "more"]) assert.match(basicEditor, new RegExp(`\\["${category}"`));
  assert.match(basicEditor, /data-basic-category="\$\{id\}"/);
  for (const ratio of ["free", "original", "1:1", "4:3", "3:4", "4:5", "9:16", "16:9"]) assert.match(basicEditor, new RegExp(`\\["${ratio}"`));
  assert.match(basicEditor, /拉直/);
  assert.match(basicEditor, /横向透视/);
  assert.match(basicEditor, /纵向透视/);
  for (const feature of ["自动优化", "亮度", "对比度", "高光", "阴影", "饱和度", "色温", "清晰度", "锐化", "暗角"]) assert.match(basicEditor, new RegExp(feature));
  for (const filter of ["自然", "通透", "暖阳", "冷调", "电影", "黑白", "建筑", "室内"]) assert.match(basicEditor, new RegExp(filter));
  for (const markup of ["画笔", "荧光笔", "马赛克", "橡皮擦", "文字"]) assert.match(basicEditor, new RegExp(markup));
  assert.match(basicEditor, /image\/png/);
  assert.match(basicEditor, /image\/jpeg/);
  assert.match(basicEditor, /image\/webp/);
  assert.match(basicEditor, /state\.compare = true/);
  assert.match(basicEditor, /_compareStart/);
  assert.match(basicEditor, /drawMarkupStroke\(\[last, point\]\)/);
  assert.match(basicEditor, /data-basic-filter\] i/);
  assert.match(basicEditor, /还有未保存的修改/);
  assert.match(basicEditor, /保存为新图片，不覆盖原图/);
  assert.match(basicEditor, /revision !== state\.previewRevision/);
  assert.match(basicEditor, /state\.outputFormat === "image\/jpeg"/);
  assert.match(styles, /\.basic-editor-overlay/);
  assert.match(styles, /\.basic-category-bar/);
  assert.match(app, /const editor = mode === "basic" \? mobileBasicEditor : mobileDeepEditor/);
  assert.match(app, /editor\?\.close\?\.\(true\)/);
});

test("动态流关系、能力小窗和液态玻璃样式完整", () => {
  assert.match(app, /function flowNodeMarkup/);
  assert.match(app, /flowScrollTop/);
  assert.match(styles, /\.flow-node-children::before/);
  assert.match(styles, /\.flow-node-context/);
  assert.match(html, /class="tool-popover capabilities-only glass-panel"/);
  assert.doesNotMatch(html, /data-action="toggle-tool-search"/);
  assert.doesNotMatch(html, /data-action="show-all-tools"/);
  assert.doesNotMatch(html, /id="toolFilters"/);
  assert.doesNotMatch(html, /id="toolSearch"/);
  assert.match(styles, /backdrop-filter: blur\(22px\) saturate\(1\.18\)/);
  assert.match(styles, /@supports not \(\(backdrop-filter/);
});

test("浅色主题统一功能浮层与深度编辑器外壳", () => {
  assert.match(styles, /--lg-warm-glass/);
  assert.match(styles, /html\[data-theme="light"\] \.task-status-panel/);
  assert.match(styles, /html\[data-theme="light"\] \.tool-popover/);
  assert.match(styles, /html\[data-theme="light"\] \.design-conversation-panel/);
  assert.match(styles, /html\[data-theme="light"\] \.canvas-node-context/);
  assert.match(styles, /html\[data-theme="light"\] \.deep-workspace-overlay/);
  assert.match(styles, /html\[data-theme="light"\] \.deep-stage \{ background: #302f2b; \}/);
});

test("画布层级支持新建、切换、重命名和二次确认删除", () => {
  assert.match(html, /data-action="new-project"/);
  assert.match(app, /data-canvas-action="rename"/);
  assert.match(app, /data-canvas-action="delete"/);
  assert.match(app, /confirm\(`确定删除/);
  assert.match(app, /async function openProject/);
});

test("画布对象保存位置并支持拖动缩放旋转和更多操作", () => {
  assert.match(app, /project\.canvasView/);
  assert.match(app, /asset\.canvas\.x/);
  assert.match(app, /gesture\.type === "pinch"/);
  assert.match(app, /gesture\.type === "resize"/);
  assert.match(app, /gesture\.type === "rotate"/);
  assert.match(html, /data-object-action="duplicate"/);
  assert.match(html, /data-object-action="replace-image"/);
});

test("手机版源码不内置生图接口和密钥", () => {
  const source = `${html}\n${app}`;
  assert.doesNotMatch(source, /https?:\/\/(?:www\.)?(?:fhl|yybb|aiwanwu)/i);
  assert.doesNotMatch(source, /["'`]sk-[A-Za-z0-9_-]{12,}["'`]/);
});

test("手机版 AI 编辑使用沉浸大画布和单指涂抹双指缩放", () => {
  assert.match(app, /createAiEditor/);
  assert.match(app, /ai-edit\/editor\.js\?v=20260812-mobile-lasso/);
  assert.match(app, /deep-edit\/editor\.js\?v=20260812-simple-crop/);
  assert.match(aiEditor, /region-engine\.js\?v=20260812-ai-edit-lite-3/);
  assert.match(app, /requestMobileAiEdit/);
  assert.match(aiEditor, /矩形框选/);
  assert.match(aiEditor, /画笔填充/);
  assert.match(aiEditor, /画笔擦除/);
  assert.match(aiEditor, /自由套索/);
  assert.match(aiEditor, /data-ai-tool="lasso"/);
  assert.match(aiEditor, /polygonMask/);
  assert.match(aiEditor, /gesture\.type === "lasso"/);
  assert.doesNotMatch(aiEditor, /椭圆框选|多边形套索|编号|data-ai-region=/);
  assert.match(aiEditor, /提示词优化/);
  assert.match(aiEditor, /onEditRegion/);
  assert.match(styles, /ai-edit-overlay/);
  assert.match(aiEditor, /data-ai-mobile-prompt/);
  assert.match(aiEditor, /data-ai-navigator-canvas/);
  assert.doesNotMatch(aiEditor, /data-ai-loupe|mobile-brush-loupe/);
  assert.match(aiEditor, /function beginPinchGesture/);
  assert.match(aiEditor, /state\.pointers\.size >= 2/);
  assert.match(aiEditor, /canvas\.addEventListener\("dblclick"/);
});

test("手机深度编辑器使用包含自由套索的五项底栏", () => {
  assert.match(styles, /\.deep-workspace-overlay:not\(\.ai-edit-overlay\) \.deep-workspace-body/);
  assert.match(styles, /grid-template-rows: minmax\(0, 1fr\) 68px/);
  assert.match(styles, /\.deep-mobile-toolbar/);
  assert.match(styles, /grid-template-columns: repeat\(5, minmax\(0,1fr\)\)/);
  assert.match(app, /initialTab: mode, initialTool: "move"/);
  const deepEditor = readFileSync(path.join(root, "mobile", "deep-edit", "editor.js"), "utf8");
  assert.match(deepEditor, /data-mobile-deep-mode="crop"/);
  assert.match(deepEditor, /data-mobile-deep-mode="lasso"/);
  assert.match(deepEditor, /data-mobile-deep-mode="adjust"/);
  assert.match(deepEditor, /data-mobile-deep-mode="paint"/);
  assert.match(deepEditor, /data-mobile-deep-mode="more"/);
  assert.match(deepEditor, /data-mobile-crop-ratio="free"/);
  assert.match(deepEditor, /data-mobile-crop-ratio="4:3"/);
  assert.match(deepEditor, /data-mobile-crop-ratio="3:4"/);
  assert.match(deepEditor, /data-mobile-crop-ratio="16:9"/);
  assert.match(deepEditor, /data-mobile-crop-ratio="9:16"/);
  assert.match(deepEditor, />完成裁剪</);
  assert.match(deepEditor, /function constrainedCropPoint/);
  assert.match(deepEditor, /gesture\.type === "rect" && state\.mobileMode === "crop"/);
  assert.doesNotMatch(deepEditor, /deep-mobile-crop-controls[\s\S]{0,1000}data-local-action="rotate-right"/);
  assert.doesNotMatch(deepEditor, /deep-mobile-crop-controls[\s\S]{0,1000}data-local-action="flip-x"/);
  assert.match(styles, /\.deep-mobile-crop-ratios/);
  assert.match(deepEditor, /function beginPinchGesture/);
  assert.match(deepEditor, /state\.lassoMode = "free"/);
  assert.match(deepEditor, /pathLength\(gesture\.points\) >= 18/);
  assert.match(styles, /data-mobile-mode="lasso"[^\n]*\.deep-inspector/);
  assert.match(deepEditor, /data-deep-navigator-canvas/);
  assert.doesNotMatch(deepEditor, /data-deep-loupe|mobile-brush-loupe/);
  assert.doesNotMatch(styles, /\.mobile-brush-loupe/);
});

test("AI 编辑和深度编辑使用与主页一致的暖白磨砂玻璃", () => {
  assert.match(styles, /AI \/ 深度编辑：与主页一致的暖白磨砂玻璃/);
  assert.match(styles, /--editor-glass: rgba\(246, 247, 244, \.82\)/);
  assert.match(styles, /\.mobile-ai-edit-controls,[\s\S]*\.deep-mobile-toolbar/);
  assert.match(styles, /\.deep-mobile-crop-controls,[\s\S]*\.deep-workspace-overlay:not\(\.ai-edit-overlay\) \.deep-inspector/);
  assert.match(styles, /backdrop-filter: blur\(24px\) saturate\(1\.18\)/);
  assert.match(styles, /\.mobile-ai-tool-row button\[aria-pressed="true"\]/);
  assert.match(styles, /background-color: #eef0ec/);
  assert.match(styles, /\.deep-workspace-overlay \.deep-stage-hint/);
});
