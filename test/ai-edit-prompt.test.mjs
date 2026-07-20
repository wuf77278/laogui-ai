import test from "node:test";
import assert from "node:assert/strict";
import {
  aiEditIntentKind,
  buildAiEditFinalPrompt,
  buildAiEditOptimizerInput,
  fallbackAiEditInstruction,
  normalizeAiEditInstruction
} from "../public/ai-edit/prompt-engine.js";

test("简单材质要求会被识别并扩展为专业编辑要求", () => {
  const userPrompt = "把石头换成暖灰色微水泥";
  assert.equal(aiEditIntentKind("replace", userPrompt), "material");
  const instruction = fallbackAiEditInstruction("replace", userPrompt);
  assert.match(instruction, /微水泥/);
  assert.match(instruction, /几何/);
  assert.match(instruction, /光向/);
});

test("优化器输入要求忠实保留用户原意", () => {
  const input = buildAiEditOptimizerInput({ operation: "material", userPrompt: "改成木饰面", regionNumber: 2 });
  assert.match(input, /框选编号：2/);
  assert.match(input, /改成木饰面/);
  assert.match(input, /不擅自增加/);
});

test("最终提示词把蒙版、原图和优化结果交给图片大模型", () => {
  const prompt = buildAiEditFinalPrompt({
    operation: "material",
    optimizedInstruction: "把选中柱面改成细腻哑光的暖灰色微水泥。",
    userPrompt: "换成微水泥",
    regionNumber: 1
  });
  assert.match(prompt, /transparent area/);
  assert.match(prompt, /source image/);
  assert.match(prompt, /微水泥/);
  assert.match(prompt, /outside the editable region/);
});

test("关闭提示词优化时保留用户原始要求", () => {
  const userPrompt = "把柱子改成暖灰色微水泥";
  const prompt = buildAiEditFinalPrompt({
    operation: "material",
    optimizedInstruction: userPrompt,
    userPrompt,
    regionNumber: 2
  });
  assert.match(prompt, new RegExp(`OPTIMIZED_EDIT_INSTRUCTION: ${userPrompt}$`));
});

test("大模型返回的标题和代码块会被清理", () => {
  assert.equal(
    normalizeAiEditInstruction("```text\n优化后的提示词：只修改选区材质，保留结构。\n```", "备用"),
    "只修改选区材质，保留结构。"
  );
});

test("矩形和椭圆使用智能范围语义而不是强制重画全部像素", () => {
  const prompt = buildAiEditFinalPrompt({
    operation: "custom",
    optimizedInstruction: "只给泳池底部增加暖白色隐藏灯带。",
    userPrompt: "给泳池底部加灯光",
    regionNumber: 2,
    selectionMode: "semantic"
  });
  assert.match(prompt, /SEMANTIC_REGION_IMAGE_EDIT/);
  assert.match(prompt, /visual search area/);
  assert.match(prompt, /preserve unrelated content inside the same area/);
  assert.match(prompt, /unless the user's instruction explicitly asks to change them/);
});

test("套索使用精准蒙版并严格限制边界", () => {
  const prompt = buildAiEditFinalPrompt({
    operation: "replace",
    optimizedInstruction: "把套索内的椅子换成木椅。",
    selectionMode: "precise"
  });
  assert.match(prompt, /PRECISE_MASKED_IMAGE_EDIT/);
  assert.match(prompt, /exact allowed edit boundary/);
});

test("灯光要求不会再被误写成材质替换", () => {
  assert.equal(aiEditIntentKind("material", "给泳池底部增加暖白色水下灯光"), "custom");
  const prompt = buildAiEditFinalPrompt({
    operation: "material",
    optimizedInstruction: "给泳池底部增加暖白色水下灯光。",
    userPrompt: "给泳池底部增加暖白色水下灯光",
    selectionMode: "semantic"
  });
  assert.match(prompt, /Follow the user's requested edit directly/);
  assert.doesNotMatch(prompt, /Replace only the selected surface material/);
});

test("自定义能力中的清除要求会自动使用真正的消除规则", () => {
  assert.equal(aiEditIntentKind("custom", "去除掉我框选的植物"), "remove");
  assert.equal(aiEditIntentKind("replace", "清除框选中的植物"), "remove");
  const prompt = buildAiEditFinalPrompt({
    operation: "custom",
    optimizedInstruction: "去除掉我框选的植物。",
    userPrompt: "去除掉我框选的植物。",
    selectionMode: "semantic"
  });
  assert.match(prompt, /Remove the selected content and reconstruct/);
  assert.doesNotMatch(prompt, /Follow the user's requested edit directly/);
});
