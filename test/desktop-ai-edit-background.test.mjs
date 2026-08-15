import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editor = await readFile(new URL("../public/ai-edit/editor.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("画笔粗细面板支持悬停展开和延迟收起", () => {
  assert.match(editor, /pointerenter[\s\S]*setBrushControlsOpen\(true/);
  assert.match(editor, /setTimeout\(\(\) => setBrushControlsOpen\(false\), 150\)/);
  assert.match(editor, /canvas\.addEventListener\("pointerenter", \(\) => setBrushControlsOpen\(false\)\)/);
});

test("AI 编辑支持转到后台并聚合任务日志", () => {
  assert.match(editor, /data-ai-command="background"/);
  assert.match(editor, /已有 AI 编辑任务正在后台运行/);
  assert.match(editor, /data-ai-command="stop"/);
  assert.match(app, /cancelNumberedAiEdit/);
  assert.match(app, /onTaskEvent: recordAiEditTaskEvent/);
  assert.match(server, /async function upsertTaskLog/);
  assert.match(server, /body\.suppressTaskLog === true/);
});

test("AI 编辑后台入口醒目且顶部实时显示任务进度", () => {
  assert.match(editor, /ai-background-task-button/);
  assert.match(editor, /ai-stop-task-button/);
  assert.match(editor, /classList\.toggle\("ai-task-running"/);
  assert.match(editor, /顶部“任务状态”查看进度/);
  assert.doesNotMatch(editor, /validJobs\(\)/);
  assert.match(app, /function syncAiEditActiveTask/);
  assert.match(app, /workspace-task-status-label/);
  assert.match(styles, /workspace-task-status-button\.has-task\.running/);
  assert.match(styles, /ai-stop-task-button:not\(\[hidden\]\)/);
});

test("AI 编辑结果在无限画布显示来源标记", () => {
  assert.match(app, /sourceBadge:[^\n]+"AI 编辑"/);
  assert.match(app, /canvas-image-source-badge/);
  assert.match(styles, /\.canvas-image-source-badge/);
});

test("AI 编辑图片载入失败时保留窗口并支持本地恢复", () => {
  assert.match(editor, /data-ai-command="retry-image"/);
  assert.match(editor, /onResolveImage/);
  assert.match(editor, /原图载入失败，请重新载入或返回画布/);
  assert.match(app, /resolveAiEditImage/);
  assert.match(server, /\/api\/diagnostics\/image/);
});

test("电脑端提供七天诊断包和三层日志", () => {
  assert.match(app, /\/api\/diagnostics\/export\?days=7/);
  assert.match(server, /createZipBuffer/);
  assert.match(server, /diagnostic-events\.jsonl/);
  assert.match(server, /desktop-events\.jsonl/);
});

test("画布大图落盘去重且图片内核日志自动清理", () => {
  assert.match(server, /async function persistCanvasOutputImage/);
  assert.match(server, /canvas-edit-\$\{digest\}/);
  assert.match(server, /pruneLogDirectory\(path\.join\(logsDir, "image-studio-engine"\)/);
  assert.match(server, /pruneLogDirectory\(path\.join\(logsDir, "image-studio-fhl"\)/);
});

test("Mac 和 Windows 的 AI 编辑只使用软件内置图片引擎", () => {
  assert.match(server, /const generated = await runImageStudioEngine\(\{/);
  assert.match(server, /for \(const filePath of references\) args\.push\("--reference-image", filePath\)/);
  assert.match(server, /if \(maskPath\) args\.push\("--mask", maskPath\)/);
  assert.doesNotMatch(server, /aggregate-image-generation/);
  assert.doesNotMatch(server, /runImageStudioFhlSkill/);
  assert.doesNotMatch(server, /runCommand\("python3"/);
});
