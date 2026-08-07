export const AI_EDIT_OPERATION_LABELS = {
  remove: "局部消除",
  replace: "局部替换",
  material: "材质替换",
  detail: "细节增强",
  custom: "自定义编辑"
};

const MATERIAL_WORDS = /(材质|材料|微水泥|大理石|石材|木材|木饰面|金属|玻璃|涂料|瓷砖|砖|皮革|织物|混凝土|水磨石|漆)/i;
const LIGHTING_WORDS = /(灯光|灯带|照明|水下灯|补光|光效|光线效果|色温)/i;
const REMOVE_WORDS = /(去除|移除|删除|清除|擦掉|消除|不要这些|去掉)/i;

export function normalizeAiEditSelectionMode(value = "precise") {
  return value === "semantic" ? "semantic" : "precise";
}

export function aiEditIntentKind(operation, userPrompt = "") {
  if (REMOVE_WORDS.test(String(userPrompt || ""))) return "remove";
  if (operation === "custom") {
    return "custom";
  }
  if (operation !== "remove" && LIGHTING_WORDS.test(String(userPrompt || ""))) return "custom";
  if (operation === "material" || MATERIAL_WORDS.test(String(userPrompt || ""))) return "material";
  return operation;
}

export function fallbackAiEditInstruction(operation, userPrompt = "") {
  const request = String(userPrompt || "").trim();
  const intentKind = aiEditIntentKind(operation, request);
  if (intentKind === "remove") {
    return request || "移除选区中的目标物体，根据周围真实环境自然补全被遮挡的背景、材质、光影和透视。";
  }
  if (intentKind === "material") {
    return [
      request || "替换选区中的表面材质。",
      "只改变选中表面的材质、颜色、纹理、粗糙度和反射表现，保留原有几何、尺寸、位置、边缘、接缝、透视、光向和阴影。",
      "去除原材质的可见特征，让新材质尺度真实、铺贴连续，并与相邻区域自然收口。"
    ].join(" ");
  }
  if (intentKind === "detail") {
    return [
      request || "增强选区中的真实细节。",
      "只提升纹理、边缘、接缝和微小光影层次，不重新设计物体，不改变结构、比例、颜色体系和构图。"
    ].join(" ");
  }
  if (intentKind === "custom") {
    return [
      request || "按照用户要求编辑选中的目标。",
      "只执行用户明确要求的变化，不擅自改写成消除、材质替换、整体重绘或其他固定任务。"
    ].join(" ");
  }
  return [
    request || "按照用户要求替换选区中的内容。",
    "只替换选中的目标，保持目标所在位置、尺度、透视、遮挡关系、光照方向和相邻结构不变。"
  ].join(" ");
}

export function buildAiEditOptimizerInput({ operation, userPrompt = "", regionNumber = 1, selectionMode = "precise" } = {}) {
  const operationLabel = AI_EDIT_OPERATION_LABELS[operation] || "局部编辑";
  const normalizedSelectionMode = normalizeAiEditSelectionMode(selectionMode);
  const selectionRule = normalizedSelectionMode === "semantic"
    ? "这是智能范围选区：先根据原图上下文和用户描述识别范围内真正要修改的对象，只修改匹配目标，不要把范围内全部像素统一重画。"
    : "这是精准蒙版选区：严格遵守套索或画笔边界，只允许修改蒙版内部，不得越界。";
  return [
    "你是专业图片局部编辑提示词优化师。",
    `任务类型：${operationLabel}。`,
    `框选编号：${regionNumber}。`,
    selectionRule,
    `用户原始要求：${String(userPrompt || "").trim() || "未补充要求，请按任务类型完成。"}`,
    "请把用户要求优化为一段简洁、可直接交给 GPT-Image-2 的专业局部编辑指令。",
    "必须忠实保留用户原意，不擅自增加风格、物体、颜色或设计方案。",
    "材质修改要明确新材质的表面特征，并说明保留几何、尺寸、位置、透视、光向、阴影和相邻结构。",
    "物体消除要说明根据周围环境自然补全背景。",
    "只返回优化后的编辑要求正文，不要解释，不要标题，不要 Markdown。"
  ].join("\n");
}

export function normalizeAiEditInstruction(value, fallback = "") {
  const text = String(value || "")
    .replace(/^```[a-z-]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(优化后的提示词|优化提示词|编辑指令|prompt)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 8) return String(fallback || "").trim();
  return text.slice(0, 1600);
}

export function buildAiEditFinalPrompt({ operation, optimizedInstruction, userPrompt = "", regionNumber = 1, selectionMode = "precise" } = {}) {
  const intentKind = aiEditIntentKind(operation, userPrompt);
  const normalizedSelectionMode = normalizeAiEditSelectionMode(selectionMode);
  const operationRules = {
    remove: "Remove the selected content and reconstruct the newly exposed background naturally from surrounding visual evidence.",
    replace: "Replace only the selected target according to the optimized instruction.",
    material: "Replace only the selected surface material while preserving the object's geometry and construction.",
    detail: "Enhance realistic fine detail only inside the selected area without redesigning the object.",
    custom: "Follow the user's requested edit directly. Do not force it into removal, replacement, material, or detail enhancement behavior."
  };
  const selectionRules = normalizedSelectionMode === "semantic"
    ? [
        "SEMANTIC_REGION_IMAGE_EDIT.",
        "The transparent mask defines a visual search area, not the contour of an object that must all be repainted.",
        "Use the source-image context and the instruction to identify the intended target inside that area. Change only the matching target and preserve unrelated content inside the same area."
      ]
    : [
        "PRECISE_MASKED_IMAGE_EDIT.",
        "The transparent mask is the exact allowed edit boundary. Do not change pixels beyond that boundary."
      ];
  return [
    ...selectionRules,
    `This request edits numbered selection region ${regionNumber}.`,
    operationRules[intentKind] || operationRules.replace,
    "The transparent area of the PNG mask is the only editable area. Opaque mask pixels are protected.",
    "Use the supplied source image as the mandatory visual base. Preserve image dimensions, camera, composition, geometry, perspective and every pixel outside the editable region. Preserve lighting, shadows, materials and structure unless the user's instruction explicitly asks to change them.",
    "Make the smallest visual change needed to satisfy the instruction. Blend the edited boundary naturally with matching texture scale, light, shadow, focus and noise.",
    "Do not add text, logos, frames, watermarks, unrelated objects or a new overall design.",
    `OPTIMIZED_EDIT_INSTRUCTION: ${String(optimizedInstruction || fallbackAiEditInstruction(operation, userPrompt)).trim()}`
  ].join("\n");
}
