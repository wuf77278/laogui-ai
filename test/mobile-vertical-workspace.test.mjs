import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const html = readFileSync(path.join(root, "mobile", "index.html"), "utf8");
const app = readFileSync(path.join(root, "mobile", "app.js"), "utf8");
const styles = readFileSync(path.join(root, "mobile", "styles.css"), "utf8");
const aiEditor = readFileSync(path.join(root, "mobile", "ai-edit", "editor.js"), "utf8");
const nativePlugin = readFileSync(path.join(root, "android", "app", "src", "main", "java", "cn", "laogui", "ai", "mobile", "LaoguiNativePlugin.java"), "utf8");

test("手机版使用无限画布和固定底部创作栏", () => {
  assert.match(html, /id="infiniteCanvas"/);
  assert.match(html, /id="canvasWorld"/);
  assert.match(html, /id="canvasNodes"/);
  assert.doesNotMatch(html, /id="workspacePromptInput"/);
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

test("手机版启动后直接进入先画布后功能的极简入口", () => {
  assert.match(html, /class="infinite-canvas"/);
  assert.match(html, /添加图片开始创作/);
  assert.match(html, /id="canvasMenuButton"/);
  assert.match(html, /id="canvasList"/);
  assert.match(html, /data-nav="projects"/);
  assert.doesNotMatch(html, /data-nav="tasks"/);
  assert.match(app, /navigate\("home"\);\s*\n}/);
  assert.doesNotMatch(app, /if \(!state\.settings\.profiles\.length\) navigate\("settings"\)/);
});

test("上传图片后显示画布上下文工具，参数保持抽屉", () => {
  assert.match(app, /function canvasNodeMarkup\(asset, index\)/);
  assert.match(app, /\["preset", "功能预设"/);
  assert.match(app, /\["ai-edit", "AI 编辑"/);
  assert.match(app, /\["basic-edit", "基础编辑"/);
  assert.doesNotMatch(app, /\["color-edit", "调色"/);
  assert.match(app, /\["delete", "删除"/);
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

test("能力选择使用画布小窗并通过 AI 对话确认方案", () => {
  assert.match(html, /id="designConversationPanel"/);
  assert.match(html, /id="conversationForm"/);
  assert.match(html, /确认生成/);
  assert.match(app, /continueDesignConversation/);
  assert.match(app, /designBrief\?\.ready/);
  assert.match(app, /请先在 AI 对话中确认设计方案/);
  assert.match(nativePlugin, /public void continueDesignConversation/);
  assert.match(nativePlugin, /responsesPath/);
  assert.match(nativePlugin, /绝不能声称已经生成图片/);
});

test("图片支持双击和双击触摸全屏预览", () => {
  assert.match(app, /addEventListener\("dblclick"/);
  assert.match(app, /event\.pointerType === "touch"/);
  assert.match(app, /openAssetPreview/);
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
  assert.match(html, /src="\.\/app\.js\?v=20260807-pruned3"/);
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

test("手机版 AI 编辑复用网页端的完整选区和自然语言流程", () => {
  assert.match(app, /createAiEditor/);
  assert.match(app, /requestMobileAiEdit/);
  assert.match(aiEditor, /自由套索/);
  assert.match(aiEditor, /多边形套索/);
  assert.match(aiEditor, /画笔补选/);
  assert.match(aiEditor, /画笔减选/);
  assert.match(aiEditor, /最多 2 个/);
  assert.match(aiEditor, /提示词优化/);
  assert.match(aiEditor, /onEditRegion/);
  assert.match(styles, /ai-edit-overlay/);
});
